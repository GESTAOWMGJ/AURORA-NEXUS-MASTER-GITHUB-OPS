'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createBrowserAdapter } = require('./tiss-browser.cjs');

const PORTAL = 'https://portal.example.invalid', URL = PORTAL + '/billing/sadt';
const ORG = 'synthetic-org', PLAN = 'a'.repeat(64);

// A tiny synthetic CDP peer exercises the Node native HTTP/WebSocket transport.
// The DOM is deliberately a fixture; it is not evidence for an operator portal.
async function fixture(t, options = {}) {
  const location = { href: URL, origin: PORTAL };
  let hooks = {};
  class Input {
    constructor(value = '', type = 'text') { this._value = value; this.type = type; this.isConnected = true;
      this.disabled = false; this.readOnly = false; this.maxLength = -1; this.visible = true; this.events = []; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getClientRects() { return this.visible ? [1] : []; }
    dispatchEvent(event) { this.events.push(event.type); hooks[event.type]?.(this); return true; }
  }
  class Select extends Input { constructor() { super(); this.multiple = false; this.options = [{ value: '22', disabled: false }]; } get value() { return this._value; } set value(v) { this._value = v; } }
  class Textarea extends Input { get value() { return this._value; } set value(v) { this._value = v; } }
  const guide = new Input(), code = new Input(), table = new Select(), date = new Input(), price = new Input();
  const nodes = new Map([['#guide', [guide]], ['#code', [code]], ['#table', [table]], ['#date', [date]], ['#price', [price]]]);
  let challenges = [], targetRows, frameUrl = URL, dropOnCall = false;
  const calls = [], connections = new Set();
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/json/list');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(targetRows));
  });
  function textFrame(value) {
    const payload = Buffer.from(JSON.stringify(value));
    const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
    return Buffer.concat([header, payload]);
  }
  server.on('upgrade', (req, socket) => {
    assert.equal(req.url, '/devtools/page/TARGET-1');
    connections.add(socket); socket.on('close', () => connections.delete(socket)); socket.on('error', () => {});
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        let length = pending[1] & 127, offset = 2;
        if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); offset = 4; }
        if (length === 127) { if (pending.length < 10) return; length = Number(pending.readBigUInt64BE(2)); offset = 10; }
        const masked = (pending[1] & 128) !== 0;
        if (pending.length < offset + (masked ? 4 : 0) + length) return;
        const opcode = pending[0] & 15;
        const mask = masked ? pending.subarray(offset, offset + 4) : null; if (masked) offset += 4;
        const payload = Buffer.from(pending.subarray(offset, offset + length));
        if (mask) for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
        pending = pending.subarray(offset + length);
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (opcode !== 1) continue;
        const command = JSON.parse(payload.toString()); calls.push(command);
        (async () => {
          let result;
          if (command.method === 'Page.getFrameTree') result = { frameTree: { frame: { id: 'FRAME-1', url: frameUrl } } };
          else if (command.method === 'Page.createIsolatedWorld') result = { executionContextId: 42 };
          else if (command.method === 'Runtime.callFunctionOn') {
            if (dropOnCall) { socket.destroy(); return; }
            assert.equal(command.params.executionContextId, 42);
            assert.equal(command.params.userGesture, false);
            const value = await vm.runInNewContext('(' + command.params.functionDeclaration + ')(argument)', {
              argument: command.params.arguments[0].value, location, setTimeout, Event,
              HTMLInputElement: Input, HTMLSelectElement: Select, HTMLTextAreaElement: Textarea,
              document: { querySelectorAll(selector) { return selector.includes('input[type="password"]') ? challenges : nodes.get(selector) ?? []; } },
              getComputedStyle(node) { return { visibility: node.visible ? 'visible' : 'hidden', display: 'block' }; }
            }, { timeout: 1000 });
            result = { result: { type: 'object', value } };
          } else throw Error('Unexpected CDP method: ' + command.method);
          if (!socket.destroyed) socket.write(textFrame({ id: command.id, result }));
        })().catch(error => { if (!socket.destroyed) socket.write(textFrame({ id: command.id, error: { message: error.message } })); });
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const debuggingOrigin = 'http://127.0.0.1:' + server.address().port;
  const target = { id: 'TARGET-1', type: 'page', url: URL, webSocketDebuggerUrl: debuggingOrigin.replace('http:', 'ws:') + '/devtools/page/TARGET-1' };
  targetRows = [target];
  t.after(async () => { for (const socket of connections) socket.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const config = { orgId: ORG, debuggingOrigin, portalOrigin: PORTAL, allowedPathPrefix: '/billing',
    fieldMap: { providerGuideNumber: '#guide', 'procedures.0.procedureCode': '#code', 'procedures.0.tableCode': '#table',
      requestDate: { selector: '#date', format: 'date-br' }, 'procedures.0.unitPrice': { selector: '#price', format: 'decimal-comma' } } };
  const adapter = createBrowserAdapter({ config, orgId: ORG });
  return { adapter, config, target, calls, nodes, guide, code, table, date, price, location,
    setTargets(value) { targetRows = value; }, setChallenges(value) { challenges = value; }, setHooks(value) { hooks = value; },
    setFrameUrl(value) { frameUrl = value; }, drop() { dropOnCall = true; }, input: () => new Input(),
    fill(fields = { providerGuideNumber: '0000123', 'procedures.0.procedureCode': '10101012' }, overrides = {}) {
      return adapter.fill({ fields, expectedTargetId: 'TARGET-1', expectedUrl: URL, planHash: PLAN, ...overrides });
    } };
}

test('native loopback CDP fills mapped fields, formats literals and reads back without submit', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.adapter.inspect(), { state: 'BROWSER_TARGET_READY', targetId: 'TARGET-1', url: URL,
    mappedFieldCount: 5, transport: 'LOOPBACK_CDP', submissionSupported: false });
  const result = await f.fill({ providerGuideNumber: '0000123', 'procedures.0.procedureCode': '10101012', 'procedures.0.tableCode': '22',
    requestDate: '2026-10-21', 'procedures.0.unitPrice': '150.25' });
  assert.equal(result.state, 'FILLED_DRAFT'); assert.equal(result.changedCount, 5); assert.equal(result.readbackCount, 5);
  assert.equal(result.submissionAttempted, false); assert.equal(result.protocolReceived, false); assert.equal(result.paymentVerified, false);
  assert.equal(result.portalPersistenceVerified, false); assert.equal(result.automaticRetryAllowed, false);
  assert.equal(f.guide.value, '0000123'); assert.equal(f.code.value, '10101012'); assert.equal(f.date.value, '21/10/2026'); assert.equal(f.price.value, '150,25');
  assert.deepEqual(f.guide.events, ['input', 'change']);
  assert.deepEqual(f.calls.map(call => call.method), ['Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.callFunctionOn']);
  assert.equal(JSON.stringify(result).includes('0000123'), false);
});

test('existing identical values are observed without a second DOM effect', async t => {
  const f = await fixture(t); f.guide.value = '0000123'; f.code.value = '10101012';
  const result = await f.fill();
  assert.equal(result.state, 'FILLED_DRAFT'); assert.equal(result.changedCount, 0); assert.equal(result.matchedCount, 2);
  assert.deepEqual(f.guide.events, []); assert.deepEqual(f.code.events, []);
});

test('imported script-like content is passed as data to the fixed isolated function', async t => {
  const f = await fixture(t), literal = "'); document.submit(); throw Error('injected'); //";
  const result = await f.fill({ providerGuideNumber: literal });
  assert.equal(result.state, 'FILLED_DRAFT'); assert.equal(f.guide.value, literal);
  const command = f.calls.find(call => call.method === 'Runtime.callFunctionOn');
  assert.equal(command.params.functionDeclaration.includes(literal), false);
  assert.equal(command.params.arguments[0].value.fields[0].value, literal);
});

test('configuration rejects other tenants, non-loopback transport and non-HTTPS portal', async t => {
  const f = await fixture(t);
  for (const change of [{ orgId: 'other-org' }, { debuggingOrigin: 'http://localhost:9222' }, { debuggingOrigin: 'https://127.0.0.1:9222' },
    { debuggingOrigin: 'http://127.0.0.1:9222/path' }, { debuggingOrigin: 'http://127.0.0.1:80' }, { portalOrigin: 'http://portal.example.invalid' },
    { portalOrigin: PORTAL + '/billing' }, { allowedPathPrefix: '/billing/../admin' }, { allowedPathPrefix: '/billing%2fadmin' }]) {
    assert.throws(() => createBrowserAdapter({ config: { ...f.config, ...change }, orgId: ORG }), { code: /TISS_BROWSER_CONFIGURATION/ });
  }
});

test('mapping is fixed, unique and closed; unmapped values or invalid dates never reach CDP', async t => {
  const f = await fixture(t);
  assert.throws(() => createBrowserAdapter({ config: { ...f.config, fieldMap: { first: '#guide', second: '#guide' } }, orgId: ORG }), { code: 'TISS_BROWSER_MAPPING_INVALID' });
  for (const fields of [{ unknown: 'value' }, { requestDate: '2026-02-30' }, { providerGuideNumber: 'line\nvalue' }, { 'procedures.0.unitPrice': '1e7' }]) await assert.rejects(f.fill(fields), { code: /TISS_BROWSER_FIELD/ });
  assert.equal(f.calls.length, 0);
});

test('ambiguous tabs and a lookalike path remain blocked', async t => {
  const f = await fixture(t);
  f.setTargets([f.target, { ...f.target, id: 'TARGET-2' }]); await assert.rejects(f.adapter.inspect(), { code: 'TISS_BROWSER_TARGET_AMBIGUOUS' });
  f.setTargets([{ ...f.target, url: PORTAL + '/billing-evil/sadt' }]); await assert.rejects(f.adapter.inspect(), { code: 'TISS_BROWSER_PORTAL_NOT_OPEN' });
  assert.equal(f.calls.length, 0);
});

test('websocket endpoint cannot change host, port or target', async t => {
  const f = await fixture(t);
  for (const webSocketDebuggerUrl of ['ws://example.invalid:9222/devtools/page/TARGET-1',
    f.target.webSocketDebuggerUrl.replace('TARGET-1', 'OTHER'), f.target.webSocketDebuggerUrl + '?token=synthetic',
    f.target.webSocketDebuggerUrl.replace('127.0.0.1', 'localhost')]) {
    f.setTargets([{ ...f.target, webSocketDebuggerUrl }]); await assert.rejects(f.adapter.inspect(), { code: 'TISS_BROWSER_INVALID_TARGET' });
  }
});

test('a changed target or frame is rejected before DOM mutation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.fill(undefined, { expectedTargetId: 'OLD-TARGET' }), { code: 'TISS_BROWSER_TARGET_CHANGED' });
  f.setFrameUrl(PORTAL + '/billing/other');
  await assert.rejects(f.fill(), { code: 'TISS_BROWSER_PAGE_CHANGED' });
  assert.equal(f.guide.value, ''); assert.equal(f.calls.filter(call => call.method === 'Runtime.callFunctionOn').length, 0);
});

test('preflight finds conflicts before changing an earlier field', async t => {
  const f = await fixture(t); f.code.value = 'OTHER';
  const result = await f.fill();
  assert.equal(result.state, 'NOT_FILLED'); assert.equal(result.code, 'TISS_BROWSER_EXISTING_VALUE_CONFLICT');
  assert.equal(result.changedCount, 0); assert.equal(f.guide.value, ''); assert.deepEqual(f.guide.events, []);
});

test('non-unique selectors and noneditable controls fail closed', async t => {
  const f = await fixture(t);
  f.nodes.set('#code', [f.code, f.input()]);
  assert.equal((await f.fill()).code, 'TISS_BROWSER_SELECTOR_NOT_UNIQUE');
  f.nodes.set('#code', [f.code]); f.code.type = 'password';
  assert.equal((await f.fill()).code, 'TISS_BROWSER_FIELD_NOT_EDITABLE');
  f.code.type = 'text'; f.code.disabled = true;
  assert.equal((await f.fill()).code, 'TISS_BROWSER_FIELD_NOT_EDITABLE');
  f.code.disabled = false; f.code.visible = false;
  assert.equal((await f.fill()).code, 'TISS_BROWSER_FIELD_NOT_EDITABLE');
  assert.equal(f.guide.value, '');
});

test('visible authentication challenge stops fill without reading its value', async t => {
  const f = await fixture(t), password = f.input(); password.type = 'password';
  Object.defineProperty(password, 'value', { get() { throw Error('Must never read credentials'); } });
  f.setChallenges([password]);
  const result = await f.fill();
  assert.equal(result.state, 'NOT_FILLED'); assert.equal(result.code, 'TISS_BROWSER_INTERACTIVE_LOGIN_REQUIRED'); assert.equal(f.guide.value, '');
});

test('unavailable select option and overlapping targets block the whole preflight', async t => {
  const f = await fixture(t);
  assert.equal((await f.fill({ providerGuideNumber: '123', 'procedures.0.tableCode': '99' })).code, 'TISS_BROWSER_OPTION_UNAVAILABLE');
  f.nodes.set('#code', [f.guide]);
  assert.equal((await f.fill()).code, 'TISS_BROWSER_DUPLICATE_TARGET_FIELD'); assert.equal(f.guide.value, '');
});

test('page changed by an input handler returns a partial receipt without continuing', async t => {
  const f = await fixture(t);
  f.setHooks({ input(node) { if (node === f.guide) f.location.href = PORTAL + '/other'; } });
  const result = await f.fill();
  assert.equal(result.state, 'PARTIAL_REVIEW_REQUIRED'); assert.equal(result.changedCount, 1); assert.equal(f.code.value, '');
  assert.deepEqual(f.guide.events, ['input']); assert.equal(result.automaticRetryAllowed, false);
});

test('delayed portal replacement is not mistaken for verified filling', async t => {
  const f = await fixture(t);
  f.setHooks({ change(node) { if (node === f.code) setTimeout(() => { f.code.value = 'DIFFERENT'; }, 10); } });
  const result = await f.fill();
  assert.equal(result.state, 'PARTIAL_REVIEW_REQUIRED'); assert.equal(result.code, 'TISS_BROWSER_READBACK_MISMATCH');
});

test('lost connection after dispatch preserves unknown outcome and does not retry', async t => {
  const f = await fixture(t); f.drop();
  const result = await f.fill();
  assert.equal(result.state, 'UNKNOWN_RESULT_REVIEW_REQUIRED'); assert.equal(result.changedCount, null);
  assert.equal(result.automaticRetryAllowed, false);
  assert.equal(f.calls.filter(call => call.method === 'Runtime.callFunctionOn').length, 1);
});

test('concurrent filling uses a single owner', async t => {
  const f = await fixture(t), first = f.fill();
  await assert.rejects(f.fill(), { code: 'TISS_BROWSER_BUSY' });
  assert.equal((await first).state, 'FILLED_DRAFT');
});
