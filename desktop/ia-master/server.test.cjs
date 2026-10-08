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
  const { registry = null, ...masterOptions } = options;
  const registryPath = registry ? path.join(stateDir, 'knowledge_registry.v1.json') : null;
  if (registryPath) fs.writeFileSync(registryPath, JSON.stringify(registry));
  const app = createMaster({ stateDir, orgId: 'tenant-test', controlToken: token, port: 0, infer, registryPath, ...masterOptions });
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
  assert.equal((await a.request('/', null, { Authorization: '', 'Sec-Fetch-Site': 'cross-site' })).status, 200);
  assert.equal((await a.request('/api/status', null, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
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

function registryFixture(version = '1.0.0') {
  return {
    schemaVersion: '1.0.0',
    taskId: 'AURORA-KNOW-HOW-XEON-001',
    version,
    classification: 'INTERNAL_SANITIZED_METHODS',
    coverage: 'INITIAL_CORPUS_PARTIAL_HISTORY',
    completeHistoricalAbsorption: false,
    records: [
      {
        id: 'KH-001',
        version: '1.0.0',
        title: 'Ciclo de melhoria contínua',
        knowledgeState: 'REGISTERED',
        technicalState: 'SPECIFIED',
        evidenceBasis: 'TEST',
        sourceRefs: ['S01'],
        problem: 'Hipóteses não podem virar regra ativa.',
        procedure: ['Registrar evidência e reversão.'],
        prompt: { text: 'Validar hipótese antes de promover.' },
        limits: ['Sem execução arbitrária.'],
        rollback: 'Reverter adoção.'
      },
      {
        id: 'KH-020',
        version: '1.0.0',
        title: 'Promoção de rotina sem executor duplicado',
        knowledgeState: 'REGISTERED',
        technicalState: 'SPECIFIED',
        evidenceBasis: 'TEST',
        sourceRefs: ['S05'],
        problem: 'Executor legado e nativo não podem produzir o mesmo efeito.',
        procedure: ['Confrontar auroraNativeRoutines.', 'Preservar um único executor.'],
        prompt: { text: 'Evite executor duplicado e prove não duplicidade.' },
        limits: ['Registro declarativo não ativa rotina.'],
        rollback: 'Restaurar executor anterior.'
      }
    ]
  };
}

test('retrieves a relevant historical lesson outside the leading record', async t => {
  let context = '';
  const a = await fixture(t, async (_prompt, selected) => { context = selected; return { text: 'Proposta rastreável.' }; }, { registry: registryFixture() });
  const response = await (await a.request('/api/improve', { prompt: 'Como evitar executor duplicado na rotina nativa?', classification: 'INTERNAL' })).json();
  assert.deepEqual(response.knowledge.recordIds, ['KH-020']);
  assert.match(context, /KH-020/);
  assert.equal(response.knowledge.completeHistoricalAbsorption, false);
});

test('corpus change invalidates the inference cache', async t => {
  let calls = 0;
  const a = await fixture(t, async () => { calls++; return { text: 'Proposta versionada.' }; }, { registry: registryFixture('1.0.0') });
  await a.request('/api/improve', task);
  await a.request('/api/improve', task);
  assert.equal(calls, 1);
  const registryPath = path.join(a.stateDir, 'knowledge_registry.v1.json');
  fs.writeFileSync(registryPath, JSON.stringify(registryFixture('1.0.1')));
  const response = await (await a.request('/api/improve', task)).json();
  assert.equal(calls, 2);
  assert.equal(response.knowledge.corpusVersion, '1.0.1');
});

test('revoked records are excluded from retrieval', async t => {
  const registry = registryFixture();
  registry.records[1].knowledgeState = 'REVOKED';
  let context = '';
  const a = await fixture(t, async (_prompt, selected) => { context = selected; return { text: 'Proposta segura.' }; }, { registry });
  const response = await (await a.request('/api/improve', { prompt: 'executor duplicado rotina nativa', classification: 'INTERNAL' })).json();
  assert.ok(!response.knowledge.recordIds.includes('KH-020'));
  assert.ok(!context.includes('KH-020'));
  assert.equal(response.knowledge.rejectedCount, 1);
});


test('corrupt configured corpus blocks model inference without external fallback', async t => {
  let calls = 0;
  const a = await fixture(t, async () => { calls++; return { text: 'Synthetic proposal.' }; }, { registry: registryFixture() });
  fs.writeFileSync(path.join(a.stateDir, 'knowledge_registry.v1.json'), '{invalid');
  const response = await a.request('/api/improve', task);
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'KNOWLEDGE_UNAVAILABLE');
  assert.equal(calls, 0); assert.equal(a.metrics.externalAiCalls, 0);
});

test('corpus revoked or changed during generation cannot return or cache stale proposal', async t => {
  let release, started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const a = await fixture(t, async () => {
    calls++;
    if (calls === 1) { started(); await new Promise(resolve => { release = resolve; }); }
    return { text: 'Synthetic version-bound proposal.' };
  }, { registry: registryFixture() });
  const pending = a.request('/api/improve', task); await ready;
  fs.writeFileSync(path.join(a.stateDir, 'knowledge_registry.v1.json'), JSON.stringify(registryFixture('1.0.1')));
  release(); const first = await pending;
  assert.equal(first.status, 409); assert.equal((await first.json()).code, 'CORPUS_CHANGED_DURING_INFERENCE');
  const second = await a.request('/api/improve', task); assert.equal(second.status, 200);
  assert.equal((await second.json()).knowledge.corpusVersion, '1.0.1'); assert.equal(calls, 2);
});
