import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CANONICAL_ORIGIN = 'https://auroranexus.com.br';
export const MAX_RESPONSE_BYTES = 262144;
const TIMEOUT_MS = 20000;
const ROUTING_ONLY_SCOPE = 'routing-only';
const TECHNICAL_API_SCOPE = 'technical-api';
const FULL_SCOPE = 'full';

export class CanonicalPreflightError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new CanonicalPreflightError(code);
}

// The selected origin is fixed. TLS verification and redirect rejection are never optional.
export function requestOrigin(origin, path) {
  return new Promise((resolveResponse, reject) => {
    const url = new URL(path, origin);
    if (url.origin !== origin) {
      reject(new CanonicalPreflightError('CANONICAL_ORIGIN_REQUIRED'));
      return;
    }
    const fail = code => reject(new CanonicalPreflightError(code));
    const req = request(url, {
      method: 'GET', rejectUnauthorized: true, minVersion: 'TLSv1.2',
      headers: {Accept: path === '/portal' ? 'text/html' : 'application/json'},
    }, res => {
      if (!res.socket.authorized) {
        res.destroy();
        fail('CANONICAL_TLS_FAILED');
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          res.destroy();
          fail('CANONICAL_RESPONSE_TOO_LARGE');
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', () => fail('CANONICAL_HTTPS_FAILED'));
      res.on('end', () => resolveResponse({
        status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    const timer = setTimeout(() => {
      req.destroy();
      fail('CANONICAL_HTTPS_TIMEOUT');
    }, TIMEOUT_MS);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => fail('CANONICAL_HTTPS_FAILED'));
    req.end();
  });
}

export function requestCanonical(path) {
  return requestOrigin(CANONICAL_ORIGIN, path);
}

function usable(attributes) {
  return !attributes.has('disabled') && !attributes.has('hidden')
    && !attributes.has('readonly')
    && !/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attributes.get('style') || '');
}

const SPACE = /[\t\n\f\r ]/;
const NAME = /[a-z0-9_:-]/i;
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'xmp',
  'noembed', 'noframes', 'noscript']);

// Read one token in the original bytes. Quoted attribute delimiters are never tags.
function readTag(html, start) {
  let cursor = start + 1;
  const closing = html[cursor] === '/';
  if (closing) cursor++;
  if (!/[a-z]/i.test(html[cursor] || '')) return null;
  const nameStart = cursor;
  while (cursor < html.length && NAME.test(html[cursor])) cursor++;
  const name = html.slice(nameStart, cursor).toLowerCase();
  const attributes = new Map();
  while (cursor < html.length) {
    const beforeSpace = cursor;
    while (cursor < html.length && SPACE.test(html[cursor])) cursor++;
    if (html[cursor] === '>') return {name, closing, attributes, end: cursor + 1};
    if (!closing && html[cursor] === '/' && html[cursor + 1] === '>') {
      return VOID_ELEMENTS.has(name) ? {name, closing, attributes, end: cursor + 2} : null;
    }
    if (closing || cursor === beforeSpace || !/[a-z_:]/i.test(html[cursor] || '')) return null;
    const attributeStart = cursor;
    while (cursor < html.length && NAME.test(html[cursor])) cursor++;
    const attribute = html.slice(attributeStart, cursor).toLowerCase();
    if (attributes.has(attribute)) return null;
    const afterName = cursor;
    while (cursor < html.length && SPACE.test(html[cursor])) cursor++;
    let value = '';
    if (html[cursor] === '=') {
      cursor++;
      while (cursor < html.length && SPACE.test(html[cursor])) cursor++;
      const quote = html[cursor];
      if (quote === '"' || quote === "'") {
        const valueStart = ++cursor;
        while (cursor < html.length && html[cursor] !== quote) cursor++;
        if (cursor === html.length) return null;
        value = html.slice(valueStart, cursor++);
      } else {
        const valueStart = cursor;
        while (cursor < html.length && !SPACE.test(html[cursor]) && html[cursor] !== '>') {
          if ('"\'`=<'.includes(html[cursor])) return null;
          cursor++;
        }
        if (cursor === valueStart) return null;
        value = html.slice(valueStart, cursor);
      }
    } else cursor = afterName;
    attributes.set(attribute, value);
  }
  return null;
}

export function hasUsableLoginForm(html) {
  const lower = html.toLowerCase();
  const stack = [];
  let cursor = 0, inactiveDepth = 0, raw = null, form = null, found = false;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    if (raw) {
      cursor = start + 1;
      // Legacy escaped script states need a full HTML parser; reject them conservatively.
      if (raw === 'script' && html.startsWith('<!--', start)) return false;
      if (!lower.startsWith('</' + raw, start)) continue;
      const next = html[start + raw.length + 2];
      if (next !== '>' && !SPACE.test(next || '')) continue;
      const tag = readTag(html, start);
      if (!tag || tag.name !== raw || !tag.closing) return false;
      const frame = stack.pop();
      if (frame.inactive) inactiveDepth--;
      raw = null;
      cursor = tag.end;
      continue;
    }
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) return false;
      const nested = html.indexOf('<!--', start + 4);
      if (nested >= 0 && nested < end) return false;
      cursor = end + 3;
      continue;
    }
    if (lower.startsWith('<!doctype ', start)) {
      const end = html.indexOf('>', start + 10);
      if (end < 0 || html.slice(start + 10, end).includes('<')) return false;
      cursor = end + 1;
      continue;
    }
    if (!/[a-z/]/i.test(html[start + 1] || '')) {
      if (html[start + 1] === '!' || html[start + 1] === '?') return false;
      cursor = start + 1;
      continue;
    }
    const tag = readTag(html, start);
    if (!tag) return false;
    cursor = tag.end;
    if (tag.closing) {
      const frame = stack.pop();
      if (!frame || frame.name !== tag.name) return false;
      if (frame.inactive) inactiveDepth--;
      if (frame.form) {
        found ||= form.valid && form.email && form.password && form.submit;
        form = null;
      }
      continue;
    }
    const attributes = tag.attributes;
    const inactive = RAW_ELEMENTS.has(tag.name) || ['template', 'svg', 'math'].includes(tag.name)
      || !usable(attributes);
    const frame = {name: tag.name, inactive};
    if (tag.name === 'form' && inactiveDepth === 0) {
      if (form) return false;
      form = {valid: attributes.get('id') === 'login-form' && !inactive,
        email: false, password: false, submit: false};
      frame.form = true;
    }
    if (form && inactiveDepth === 0 && tag.name === 'fieldset' && attributes.has('disabled')) form.valid = false;
    if (form && inactiveDepth === 0 && !inactive) {
      if (tag.name === 'input' && attributes.get('type') === 'email' && attributes.get('name') === 'email') form.email = true;
      if (tag.name === 'input' && attributes.get('type') === 'password' && attributes.get('name') === 'password') form.password = true;
      if (tag.name === 'button' && attributes.get('id') === 'submit' && attributes.get('type') === 'submit') form.submit = true;
    }
    if (!VOID_ELEMENTS.has(tag.name)) {
      stack.push(frame);
      if (inactive) inactiveDepth++;
      if (RAW_ELEMENTS.has(tag.name)) raw = tag.name;
    }
  }
  return found && stack.length === 0 && !raw && !form;
}

export function hasCanonicalPortalShell(html) {
  const lower = html.toLowerCase();
  const hasHtmlDocument = /<!doctype\s+html/i.test(html) && /<html(?:\s|>)/i.test(html);
  const hasNextRuntime = /(?:href|src)=["']\/_next\/(?:static|image)\//i.test(html)
    || html.includes('self.__next_f')
    || html.includes('__NEXT_DATA__');
  const exposesPrivateShell = lower.includes('centro de gestão wmgj')
    || lower.includes('id="session-identity"')
    || lower.includes('id="logout"');
  return hasHtmlDocument && hasNextRuntime && !exposesPrivateShell;
}

async function checkedResponse(transport, path) {
  let response;
  try { response = await transport(path); }
  catch (error) {
    if (error instanceof CanonicalPreflightError) throw error;
    throw new CanonicalPreflightError('CANONICAL_HTTPS_FAILED');
  }
  requireCondition(response && typeof response.body === 'string', 'CANONICAL_RESPONSE_INVALID');
  requireCondition(Buffer.byteLength(response.body) <= MAX_RESPONSE_BYTES, 'CANONICAL_RESPONSE_TOO_LARGE');
  requireCondition(!(response.status >= 300 && response.status < 400), 'CANONICAL_REDIRECT_REJECTED');
  return response;
}

function jsonBody(response, code) {
  requireCondition(/^application\/json\b/i.test(response.headers?.['content-type'] || ''), code);
  try { return JSON.parse(response.body); }
  catch { throw new CanonicalPreflightError(code); }
}

// Anonymous GETs only: this proves routing readiness, never login or release approval.
export async function checkCanonicalPreflight(expectedProject, {
  resolveHost = hostname => lookup(hostname, {all: true}), transport,
  scope = process.env.CANONICAL_PREFLIGHT_SCOPE || 'full',
} = {}) {
  requireCondition(/^wmgj-hml-jfn-[a-z0-9-]+$/.test(expectedProject || '')
    && !/prod|production|live|principal/i.test(expectedProject), 'HML_PROJECT_REQUIRED');
  requireCondition([FULL_SCOPE, ROUTING_ONLY_SCOPE, TECHNICAL_API_SCOPE].includes(scope),
    'CANONICAL_PREFLIGHT_SCOPE_INVALID');
  const technicalApi = scope === TECHNICAL_API_SCOPE;
  const origin = technicalApi ? `https://${expectedProject}.web.app` : CANONICAL_ORIGIN;
  const selectedTransport = transport || (path => requestOrigin(origin, path));
  let addresses;
  let dnsTimer;
  try {
    addresses = await Promise.race([
      resolveHost(new URL(origin).hostname),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), TIMEOUT_MS); }),
    ]);
  }
  catch { throw new CanonicalPreflightError('CANONICAL_DNS_FAILED'); }
  finally { clearTimeout(dnsTimer); }
  requireCondition(Array.isArray(addresses) && addresses.length > 0
    && addresses.every(entry => isIP(entry.address)), 'CANONICAL_DNS_FAILED');

  let portalShellVerified = false;
  if (!technicalApi) {
    const portal = await checkedResponse(selectedTransport, '/portal');
    requireCondition(portal.status === 200
      && /^text\/html\b/i.test(portal.headers?.['content-type'] || ''), 'CANONICAL_PORTAL_HTTP_INVALID');
    requireCondition(hasCanonicalPortalShell(portal.body), 'CANONICAL_PORTAL_SHELL_REQUIRED');
    requireCondition(/(?:^|,)\s*no-store\b/i.test(portal.headers?.['cache-control'] || '')
      && /^DENY$/i.test(portal.headers?.['x-frame-options'] || '')
      && /^nosniff$/i.test(portal.headers?.['x-content-type-options'] || ''), 'CANONICAL_PORTAL_HEADERS_REQUIRED');
    portalShellVerified = true;
  }

  let anonymousDenied = false;
  let firebaseProjectMatched = false;
  if (scope !== ROUTING_ONLY_SCOPE) {
    const init = await checkedResponse(selectedTransport, '/__/firebase/init.json');
    const config = jsonBody(init, 'CANONICAL_HML_PROJECT_MISMATCH');
    requireCondition(init.status === 200 && config?.projectId === expectedProject, 'CANONICAL_HML_PROJECT_MISMATCH');
    firebaseProjectMatched = true;
    const bootstrap = await checkedResponse(selectedTransport, '/api/bootstrap');
    const anonymous = jsonBody(bootstrap, 'CANONICAL_ANONYMOUS_DENIAL_REQUIRED');
    requireCondition(bootstrap.status === 401 && anonymous?.ok === false
      && anonymous?.code === 'AUTH_REQUIRED', 'CANONICAL_ANONYMOUS_DENIAL_REQUIRED');
    anonymousDenied = true;
  }
  return {
    code: technicalApi ? 'HML_TECHNICAL_API_READY' : 'CANONICAL_ROUTE_READY', origin, expectedProject,
    dnsResolved: true, httpsVerified: true, portalShellVerified,
    anonymousDenied, firebaseProjectMatched, authenticated: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCondition(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'CANONICAL_TLS_CONFIGURATION_REJECTED');
    console.log(JSON.stringify(await checkCanonicalPreflight(process.argv[2])));
  } catch (error) {
    console.error(error instanceof CanonicalPreflightError ? error.code : 'CANONICAL_PREFLIGHT_FAILED');
    process.exitCode = 1;
  }
}
