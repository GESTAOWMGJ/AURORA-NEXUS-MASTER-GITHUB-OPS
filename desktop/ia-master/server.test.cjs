const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createMaster } = require(path.join(process.env.AURORA_TEST_BUILD, 'server.cjs'));
const token = 'x'.repeat(43);
async function fixture(t, infer = async () => ({ text: 'Proposta sintética de revisão.', outputTokens: 8 }), options = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-master-test-'));
  const app = createMaster({ stateDir, orgId: 'tenant-test', controlToken: token, port: 0, infer, ...options });
  await app.listen(); const base = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => { app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); fs.rmSync(stateDir, { recursive: true, force: true }); });
  const request = (route, body, headers = {}) => fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json', 'X-Aurora-Local': '1' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { ...app, base, request, stateDir };
}
const task = { prompt: 'Propor testes idempotentes para filas.', classification: 'INTERNAL' };
test('private routes require authentication and reject foreign origins / DNS rebinding', async t => {
  const a = await fixture(t);
  assert.equal((await a.request('/api/status', null, { Authorization: '' })).status, 401);
  assert.equal((await a.request('/api/improve', task, { Origin: 'https://evil.invalid' })).status, 403);
  const rebound = await new Promise(resolve => { const req = http.get(a.base + '/health', { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', err => { throw err; }); });
  assert.equal(rebound, 403);
  assert.equal((await a.request('/api/improve', task, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await a.request('/api/improve', task, { 'X-Aurora-Local': '' })).status, 403);
  assert.equal((await a.request('/api/improve', task, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(a.metrics.localModelCalls, 0);
});
test('single-use pairing, expiry and logout revoke browser sessions', async t => {
  let time = Date.now(); const a = await fixture(t, undefined, { now: () => time });
  const ticket = (await (await a.request('/api/pair-ticket', {})).json()).ticket;
  const r = await a.request('/api/session', { ticket }, { Authorization: '' });
  assert.equal(r.status, 200); const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await a.request('/api/session', { ticket }, { Authorization: '' })).status, 401);
  const headers = { Authorization: '', Cookie: cookie };
  assert.equal((await a.request('/api/improve', task, headers)).status, 200);
  assert.equal((await a.request('/api/logout', {}, headers)).status, 200);
  assert.equal((await a.request('/api/improve', task, headers)).status, 401);
  const expired = (await (await a.request('/api/pair-ticket', {})).json()).ticket;
  time += 61000;
  assert.equal((await a.request('/api/session', { ticket: expired }, { Authorization: '' })).status, 401);
});
test('rejects clinical/restricted data, raw secret patterns and arbitrary commands', async t => {
  const a = await fixture(t);
  for (const classification of ['CLINICAL_SENSITIVE', 'RESTRICTED', undefined]) assert.equal((await a.request('/api/improve', { ...task, classification })).status, 403);
  assert.equal((await a.request('/api/improve', { ...task, command: 'whoami' })).status, 400);
  assert.equal((await a.request('/api/improve', { ...task, prompt: 'Bearer abcdef0123456789' })).status, 403);
  assert.equal((await a.request('/api/native', { classification: 'INTERNAL', snapshot: { orgId: 'other', sensitivity: 'INTERNAL' } })).status, 403);
  assert.equal((await a.request('/api/improve', { ...task, prompt: 'x'.repeat(70000) })).status, 400);
  assert.equal(a.metrics.localModelCalls, 0);
});
test('native preview reuses the canonical kernel and cannot claim authenticated origin', async t => {
  const a = await fixture(t);
  const r = await (await a.request('/api/native', { classification: 'INTERNAL', snapshot: { orgId: 'tenant-test', sensitivity: 'INTERNAL' } })).json();
  assert.equal(r.authority, 'LOCAL_UNVERIFIED_PREVIEW');
  assert.equal(r.master.operationalState, 'BLOCKED');
  assert.equal(r.master.governance.arbitraryCodeExecution, false);
  assert.equal(r.master.financialGate.canApproveDistribution, false);
  assert.equal(r.master.source.authenticity, 'NOT_VERIFIED_BY_LOCAL_IMPORT');
  assert.equal(a.metrics.nativeEvaluations, 1); assert.equal(a.metrics.localModelCalls, 0);
});
test('cache avoids repeated inference; audit records hashes without prompt or output', async t => {
  let calls = 0; const output = '<script>alert("not executable")</script>';
  const a = await fixture(t, async () => { calls++; return { text: output }; });
  const first = await (await a.request('/api/improve', task)).json();
  const second = await (await a.request('/api/improve', task)).json();
  assert.equal(calls, 1); assert.equal(a.metrics.cacheHits, 1);
  assert.equal(first.proposalId, second.proposalId); assert.equal(first.applied, false);
  assert.equal(first.externalAiCalls, 0); assert.equal(a.metrics.externalTokens, 0);
  const log = fs.readFileSync(path.join(a.stateDir, 'audit.jsonl'), 'utf8');
  assert.ok(!log.includes(task.prompt)); assert.ok(!log.includes(output)); assert.ok(!log.includes(token));
  assert.match(log, /inputHash/);
});
test('model failure does not invoke an external fallback or poison the cache', async t => {
  let calls = 0; const a = await fixture(t, async () => { calls++; throw Error('LOCAL_DOWN'); });
  const r = await a.request('/api/improve', task); assert.equal(r.status, 503);
  assert.equal((await r.json()).externalFallbackUsed, false);
  await a.request('/api/improve', task); assert.equal(calls, 2); assert.equal(a.metrics.externalAiCalls, 0);
});
test('only one local generation runs at a time', async t => {
  let finish, started; const ready = new Promise(r => started = r);
  const a = await fixture(t, async () => { started(); return new Promise(r => finish = r); });
  const first = a.request('/api/improve', task); await ready;
  assert.equal((await a.request('/api/improve', { ...task, prompt: 'Outra proposta independente.' })).status, 429);
  finish({ text: 'Proposta final.' }); assert.equal((await first).status, 200);
});
