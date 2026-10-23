'use strict';

// The existing local master owns authentication, the operation lock and its
// durable receipt. This adapter has no scheduler, credentials or persistence.
const crypto = require('node:crypto');
const MAX_FIELDS = 500, MAX_RESPONSE_BYTES = 262144, TIMEOUT_MS = 6000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
class TissBrowserError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new TissBrowserError(code, status); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const semanticKey = key => typeof key === 'string' && key.length <= 120 &&
  /^[A-Za-z][A-Za-z0-9]*(?:\.(?:[A-Za-z][A-Za-z0-9]*|0|[1-9][0-9]{0,2}))*$/.test(key) &&
  !key.split('.').some(part => ['constructor', 'prototype', '__proto__'].includes(part));

function normalizedConfig(config, orgId) {
  if (!record(config) || config.orgId !== orgId || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(orgId)) fail('TISS_BROWSER_CONFIGURATION_REQUIRED');
  let debug, portal;
  try { debug = new URL(config.debuggingOrigin); portal = new URL(config.portalOrigin); } catch { fail('TISS_BROWSER_CONFIGURATION_INVALID'); }
  if (debug.protocol !== 'http:' || debug.hostname !== '127.0.0.1' || !debug.port ||
      Number(debug.port) < 1024 || config.debuggingOrigin !== debug.origin ||
      portal.protocol !== 'https:' || config.portalOrigin !== portal.origin || portal.username || portal.password) fail('TISS_BROWSER_CONFIGURATION_INVALID');
  const prefix = config.allowedPathPrefix;
  if (typeof prefix !== 'string' || !prefix.startsWith('/') || prefix.length > 512 || /[\\?#%\u0000-\u0020]/.test(prefix) || prefix.includes('..')) fail('TISS_BROWSER_CONFIGURATION_INVALID');
  if (!record(config.fieldMap) || !Object.keys(config.fieldMap).length || Object.keys(config.fieldMap).length > MAX_FIELDS) fail('TISS_BROWSER_MAPPING_REQUIRED');
  const mappings = Object.create(null), selectors = new Set();
  for (const [key, raw] of Object.entries(config.fieldMap)) {
    const item = typeof raw === 'string' ? { selector: raw } : raw;
    if (!semanticKey(key) || !record(item) || Object.keys(item).some(k => !['selector', 'format'].includes(k)) ||
        typeof item.selector !== 'string' || !item.selector.trim() || item.selector.length > 512 || /[\u0000-\u001f]/.test(item.selector) ||
        !['raw', 'date-br', 'decimal-comma'].includes(item.format ?? 'raw') || selectors.has(item.selector)) fail('TISS_BROWSER_MAPPING_INVALID');
    selectors.add(item.selector);
    mappings[key] = Object.freeze({ selector: item.selector, format: item.format ?? 'raw' });
  }
  return Object.freeze({ orgId, debuggingOrigin: debug.origin, portalOrigin: portal.origin,
    allowedPathPrefix: prefix === '/' ? '/' : prefix.replace(/\/$/, ''), fieldMap: Object.freeze(mappings) });
}

function allowedUrl(raw, config) {
  try {
    const url = new URL(raw), prefix = config.allowedPathPrefix;
    return raw.length <= 4096 && !url.username && !url.password && url.origin === config.portalOrigin &&
      (prefix === '/' || url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
  } catch { return false; }
}

async function readJson(response) {
  if (!response.ok || response.redirected || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) fail('TISS_BROWSER_UNAVAILABLE', 503);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail('TISS_BROWSER_RESPONSE_LIMIT');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength; if (size > MAX_RESPONSE_BYTES) fail('TISS_BROWSER_RESPONSE_LIMIT');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('TISS_BROWSER_INVALID_RESPONSE'); }
}

async function openCdp(url, WebSocketImpl) {
  let socket;
  try { socket = new WebSocketImpl(url); } catch { fail('TISS_BROWSER_UNAVAILABLE', 503); }
  const pending = new Map(); let nextId = 0, dead = false;
  function stop(code) {
    dead = true;
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new TissBrowserError(code, 503)); }
    pending.clear();
  }
  socket.addEventListener('error', () => stop('TISS_BROWSER_CONNECTION_LOST'));
  socket.addEventListener('close', () => stop('TISS_BROWSER_CONNECTION_LOST'));
  socket.addEventListener('message', event => {
    if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > MAX_RESPONSE_BYTES) { stop('TISS_BROWSER_RESPONSE_LIMIT'); socket.close(); return; }
    let message;
    try { message = JSON.parse(event.data); } catch { stop('TISS_BROWSER_INVALID_RESPONSE'); socket.close(); return; }
    const job = pending.get(message.id); if (!job) return;
    pending.delete(message.id); clearTimeout(job.timer);
    if (message.error) job.reject(new TissBrowserError('TISS_BROWSER_PROTOCOL_ERROR', 503));
    else job.resolve(message.result);
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new TissBrowserError('TISS_BROWSER_TIMEOUT', 503)), TIMEOUT_MS);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new TissBrowserError('TISS_BROWSER_UNAVAILABLE', 503)); }, { once: true });
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new TissBrowserError('TISS_BROWSER_CONNECTION_LOST', 503)); }, { once: true });
    });
  } catch (error) { try { socket.close(); } catch { /* Already closed. */ } throw error; }
  return {
    call(method, params = {}) {
      if (dead) return Promise.reject(new TissBrowserError('TISS_BROWSER_CONNECTION_LOST', 503));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new TissBrowserError('TISS_BROWSER_TIMEOUT', 503)); }, TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch { pending.delete(id); clearTimeout(timer); reject(new TissBrowserError('TISS_BROWSER_CONNECTION_LOST', 503)); }
      });
    },
    close() { stop('TISS_BROWSER_CONNECTION_CLOSED'); try { socket.close(); } catch { /* Already closed. */ } }
  };
}

// Executed in a CDP isolated world, with literal JSON arguments. Portal content
// and imported values can never provide executable code or additional selectors.
async function fillMappedFields(input) {
  let changed = 0, matched = 0;
  const result = (state, code, readbackCount = 0) => ({ state, code, changedCount: changed, matchedCount: matched, readbackCount });
  const visible = node => node.isConnected && node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility === 'visible' && getComputedStyle(node).display !== 'none';
  const samePage = () => location.href === input.expectedUrl && location.origin === input.portalOrigin;
  const challenge = () => Array.from(document.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],[data-sitekey]')).some(visible);
  const valueDescriptor = node => Object.getOwnPropertyDescriptor(
    node instanceof HTMLInputElement ? HTMLInputElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype, 'value');
  const readValue = node => valueDescriptor(node).get.call(node);
  const resolved = [];
  try {
    if (!samePage()) return result('NOT_FILLED', 'TISS_BROWSER_PAGE_CHANGED');
    if (challenge()) return result('NOT_FILLED', 'TISS_BROWSER_INTERACTIVE_LOGIN_REQUIRED');
    for (const field of input.fields) {
      const nodes = document.querySelectorAll(field.selector);
      if (nodes.length !== 1) return result('NOT_FILLED', 'TISS_BROWSER_SELECTOR_NOT_UNIQUE');
      const node = nodes[0];
      if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) ||
          !visible(node) || node.disabled || node.readOnly || (node instanceof HTMLInputElement && !['text','number','date','tel','search'].includes(node.type)) ||
          (node instanceof HTMLSelectElement && node.multiple)) return result('NOT_FILLED', 'TISS_BROWSER_FIELD_NOT_EDITABLE');
      if (resolved.some(item => item.node === node)) return result('NOT_FILLED', 'TISS_BROWSER_DUPLICATE_TARGET_FIELD');
      if (node instanceof HTMLSelectElement && !Array.from(node.options).some(option => option.value === field.value && !option.disabled && !option.parentElement?.disabled)) return result('NOT_FILLED', 'TISS_BROWSER_OPTION_UNAVAILABLE');
      if (node.maxLength >= 0 && field.value.length > node.maxLength) return result('NOT_FILLED', 'TISS_BROWSER_VALUE_REJECTED');
      const current = readValue(node);
      if (current !== '' && current !== field.value) return result('NOT_FILLED', 'TISS_BROWSER_EXISTING_VALUE_CONFLICT');
      resolved.push({ node, selector: field.selector, value: field.value, previous: current });
    }
    // All fields pass before the first DOM write. A subsequent conflict produces
    // a partial/unknown receipt and must be reconciled, never blindly replayed.
    for (const field of resolved) {
      if (!samePage() || challenge()) return result(changed ? 'PARTIAL_REVIEW_REQUIRED' : 'NOT_FILLED', 'TISS_BROWSER_PAGE_CHANGED');
      const nodes = document.querySelectorAll(field.selector);
      if (nodes.length !== 1 || nodes[0] !== field.node || !visible(field.node) || field.node.disabled || field.node.readOnly || readValue(field.node) !== field.previous) return result(changed ? 'PARTIAL_REVIEW_REQUIRED' : 'NOT_FILLED', 'TISS_BROWSER_PAGE_CHANGED');
      if (field.previous === field.value) { matched++; continue; }
      valueDescriptor(field.node).set.call(field.node, field.value); changed++;
      if (readValue(field.node) !== field.value) return result('PARTIAL_REVIEW_REQUIRED', 'TISS_BROWSER_VALUE_REJECTED');
      field.node.dispatchEvent(new Event('input', { bubbles: true }));
      if (!samePage() || !field.node.isConnected) return result('PARTIAL_REVIEW_REQUIRED', 'TISS_BROWSER_PAGE_CHANGED');
      field.node.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(resolve => setTimeout(resolve, 75));
    if (!samePage() || challenge()) return result('PARTIAL_REVIEW_REQUIRED', 'TISS_BROWSER_PAGE_CHANGED');
    let verified = 0;
    for (const field of resolved) {
      const nodes = document.querySelectorAll(field.selector);
      if (nodes.length !== 1 || nodes[0] !== field.node || !visible(field.node) || readValue(field.node) !== field.value) return result('PARTIAL_REVIEW_REQUIRED', 'TISS_BROWSER_READBACK_MISMATCH', verified);
      verified++;
    }
    return result('FILLED_DRAFT', 'TISS_BROWSER_DOM_VERIFIED', verified);
  } catch { return result(changed ? 'PARTIAL_REVIEW_REQUIRED' : 'NOT_FILLED', 'TISS_BROWSER_PAGE_UNSUPPORTED'); }
}

function mappedFields(fields, config) {
  if (!record(fields) || !Object.keys(fields).length || Object.keys(fields).length > MAX_FIELDS) fail('TISS_BROWSER_FIELDS_INVALID', 400);
  const output = []; let bytes = 0;
  for (const [key, raw] of Object.entries(fields)) {
    if (!semanticKey(key) || !Object.hasOwn(config.fieldMap, key) || typeof raw !== 'string' || !raw || raw.length > 4000 || /[\u0000-\u001f]/.test(raw)) fail('TISS_BROWSER_FIELD_UNMAPPED', 400);
    const mapping = config.fieldMap[key]; let value = raw;
    if (mapping.format === 'date-br') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail('TISS_BROWSER_FIELD_FORMAT_INVALID', 400);
      const date = new Date(raw + 'T00:00:00Z');
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) fail('TISS_BROWSER_FIELD_FORMAT_INVALID', 400);
      value = raw.slice(8, 10) + '/' + raw.slice(5, 7) + '/' + raw.slice(0, 4);
    }
    if (mapping.format === 'decimal-comma') {
      if (!/^\d+(?:\.\d{1,8})?$/.test(raw)) fail('TISS_BROWSER_FIELD_FORMAT_INVALID', 400);
      value = raw.replace('.', ',');
    }
    bytes += Buffer.byteLength(value); if (bytes > 131072) fail('TISS_BROWSER_FIELDS_LIMIT', 400);
    output.push({ key, selector: mapping.selector, value });
  }
  return output;
}

function createBrowserAdapter({ config, orgId, fetchImpl = fetch, WebSocketImpl = WebSocket } = {}) {
  const settings = normalizedConfig(config, orgId);
  let busy = false;
  async function target() {
    let rows;
    try { rows = await readJson(await fetchImpl(settings.debuggingOrigin + '/json/list', { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })); }
    catch (error) { if (error instanceof TissBrowserError) throw error; fail('TISS_BROWSER_UNAVAILABLE', 503); }
    if (!Array.isArray(rows) || rows.length > 100) fail('TISS_BROWSER_INVALID_RESPONSE');
    const eligible = rows.filter(row => record(row) && row.type === 'page' && typeof row.url === 'string' && allowedUrl(row.url, settings));
    if (eligible.length !== 1) fail(eligible.length ? 'TISS_BROWSER_TARGET_AMBIGUOUS' : 'TISS_BROWSER_PORTAL_NOT_OPEN');
    const row = eligible[0];
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(row.id)) fail('TISS_BROWSER_INVALID_TARGET');
    let ws;
    try { ws = new URL(row.webSocketDebuggerUrl); } catch { fail('TISS_BROWSER_INVALID_TARGET'); }
    const debug = new URL(settings.debuggingOrigin);
    if (ws.protocol !== 'ws:' || ws.hostname !== '127.0.0.1' || ws.port !== debug.port || ws.username || ws.password || ws.search || ws.hash ||
        ws.pathname !== '/devtools/page/' + row.id) fail('TISS_BROWSER_INVALID_TARGET');
    return { id: row.id, url: row.url, webSocketDebuggerUrl: ws.href };
  }
  async function inspect() {
    const observed = await target();
    return { state: 'BROWSER_TARGET_READY', targetId: observed.id, url: observed.url,
      mappedFieldCount: Object.keys(settings.fieldMap).length, transport: 'LOOPBACK_CDP', submissionSupported: false };
  }
  async function fill({ fields, expectedTargetId, expectedUrl, planHash } = {}) {
    if (busy) fail('TISS_BROWSER_BUSY', 429);
    if (!/^[a-f0-9]{64}$/.test(planHash || '') || !allowedUrl(expectedUrl, settings) || typeof expectedTargetId !== 'string') fail('TISS_BROWSER_PLAN_INVALID', 400);
    const mapped = mappedFields(fields, settings);
    busy = true; let cdp, dispatched = false;
    const receipt = value => ({ schemaVersion: 'aurora.tiss.browser-receipt.v1', ...value, planHash,
      fieldCount: mapped.length, targetHash: hash(settings.orgId + '\n' + expectedTargetId + '\n' + expectedUrl),
      submissionAttempted: false, submissionAttemptedByAdapter: false, portalSideEffects: 'NOT_VERIFIED',
      protocolReceived: false, paymentVerified: false, portalPersistenceVerified: false,
      automaticRetryAllowed: false });
    try {
      const observed = await target();
      if (observed.id !== expectedTargetId || observed.url !== expectedUrl) fail('TISS_BROWSER_TARGET_CHANGED');
      cdp = await openCdp(observed.webSocketDebuggerUrl, WebSocketImpl);
      const tree = await cdp.call('Page.getFrameTree');
      if (tree?.frameTree?.frame?.url !== expectedUrl || typeof tree.frameTree.frame.id !== 'string') fail('TISS_BROWSER_PAGE_CHANGED');
      const world = await cdp.call('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'aurora-tiss-mapped-fill-v1' });
      if (!Number.isSafeInteger(world?.executionContextId)) fail('TISS_BROWSER_INVALID_RESPONSE');
      dispatched = true;
      const evaluated = await cdp.call('Runtime.callFunctionOn', { functionDeclaration: fillMappedFields.toString(),
        executionContextId: world.executionContextId, arguments: [{ value: { expectedUrl, portalOrigin: settings.portalOrigin, fields: mapped } }],
        returnByValue: true, awaitPromise: true, userGesture: false });
      const value = evaluated?.result?.value;
      if (evaluated?.exceptionDetails || !record(value) || !['NOT_FILLED', 'FILLED_DRAFT', 'PARTIAL_REVIEW_REQUIRED'].includes(value.state) ||
          !/^TISS_BROWSER_[A-Z_]+$/.test(value.code || '') || ['changedCount','matchedCount','readbackCount'].some(k => !Number.isInteger(value[k]) || value[k] < 0 || value[k] > mapped.length)) fail('TISS_BROWSER_INVALID_RESPONSE');
      if (value.state === 'FILLED_DRAFT' && value.readbackCount !== mapped.length) fail('TISS_BROWSER_INVALID_RESPONSE');
      return receipt({ state: value.state, code: value.code, changedCount: value.changedCount,
        matchedCount: value.matchedCount, readbackCount: value.readbackCount });
    } catch (error) {
      if (dispatched) return receipt({ state: 'UNKNOWN_RESULT_REVIEW_REQUIRED', code: 'TISS_BROWSER_RESULT_UNCERTAIN', changedCount: null, matchedCount: null, readbackCount: null });
      if (error instanceof TissBrowserError) throw error;
      fail('TISS_BROWSER_UNAVAILABLE', 503);
    } finally { if (cdp) cdp.close(); busy = false; }
  }
  return Object.freeze({ inspect, fill });
}

module.exports = { createBrowserAdapter, TissBrowserError };
