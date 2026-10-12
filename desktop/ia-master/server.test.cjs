const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createMaster, localChat, startupConfiguration } = require(path.join(process.env.AURORA_TEST_BUILD, 'server.cjs'));
const token = 'x'.repeat(43);
async function fixture(t, infer = async () => ({ text: 'Proposta sintética de revisão.', outputTokens: 8 }), options = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-master-test-'));
  const app = createMaster({ stateDir, orgId: 'tenant-test', controlToken: token, port: 0, infer, readModelState: async () => 'UNAVAILABLE', ...options });
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
test('pairing expiry is checked when a delayed request body finishes', async t => {
  for (const origin of [undefined, 'https://auroranexus.com.br']) {
    let time = Date.now(), observe = false, observed;
    const bodyStarted = new Promise(resolve => { observed = resolve; });
    const a = await fixture(t, undefined, { portalOrigins: origin ? [origin] : [], now: () => {
      if (observe) { observe = false; observed(); }
      return time;
    } });
    const ticket = (await (await a.request('/api/pair-ticket', {})).json()).ticket;
    observe = true;
    let request;
    const result = new Promise((resolve, reject) => {
      request = http.request(a.base + '/api/session', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Aurora-Local': '1', ...(origin ? { Origin: origin } : {})
      } }, response => {
        let text = ''; response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
      });
      request.on('error', reject);
      request.write('{"ticket":');
    });
    await bodyStarted;
    time += 60001;
    request.end(JSON.stringify(ticket) + '}');
    const response = await result;
    assert.equal(response.status, 401);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.deepEqual(JSON.parse(response.text), { code: 'PAIRING_REQUIRED' });
    assert.equal((await a.request('/api/session', { ticket }, { Authorization: '', ...(origin ? { Origin: origin } : {}) })).status, 401);
  }
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

test('structured local inference reserves input bytes and refuses length-truncated JSON', async t => {
  let calls = 0, submitted;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls++; assert.equal(url, 'http://127.0.0.1:11435/api/chat'); submitted = JSON.parse(options.body);
    return { ok: true, json: async () => ({ done: true, done_reason: 'length', message: { content: '{"summary":"synthetic valid JSON"}' } }) };
  });
  await assert.rejects(localChat('Synthetic structured edit request.', 'Internal sanitized method. '.repeat(2000), true), { code: 'STUDIO_MODEL_OUTPUT_TRUNCATED' });
  assert.equal(calls, 1); assert.equal(submitted.options.num_ctx, 8192); assert.equal(submitted.options.num_predict, 2048);
  assert.equal(submitted.format, 'json'); assert.equal(submitted.think, false);
  assert.ok(submitted.messages.reduce((size, message) => size + Buffer.byteLength(message.content), 0) + 256 + 2048 <= 8192);
  await assert.rejects(localChat('x'.repeat(7000), '', true), { code: 'STUDIO_MODEL_CONTEXT_LIMIT' }); assert.equal(calls, 1);
});

test('optional exact portal bridge uses org-bound single-use ticket and origin-bound session token', async t => {
  let time = Date.now(); const portal = 'https://auroranexus.com.br', hml = 'https://wmgj-hml-jfn-20260927.web.app';
  const a = await fixture(t, undefined, { now: () => time, portalOrigins: [portal, hml, 'https://evil.invalid'] });
  const preflight = await fetch(a.base + '/api/session', { method: 'OPTIONS', headers: { Origin: portal,
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-aurora-local', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), portal);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true'); assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  assert.equal((await fetch(a.base + '/api/session', { method: 'OPTIONS', headers: { Origin: portal, 'Access-Control-Request-Method': 'DELETE' } })).status, 403);
  assert.equal((await a.request('/api/status', null, { Origin: 'https://evil.invalid' })).status, 403);
  // The long-lived control credential is intentionally unusable from a portal origin.
  assert.equal((await a.request('/api/status', null, { Origin: portal })).status, 401);
  const ticket = (await (await a.request('/api/pair-ticket', {})).json()).ticket;
  assert.equal((await a.request('/api/session', { ticket, orgId: 'forged-tenant' }, { Authorization: '', Origin: portal })).status, 400);
  const paired = await a.request('/api/session', { ticket }, { Authorization: '', Origin: portal, 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(paired.status, 200); assert.equal(paired.headers.get('set-cookie'), null);
  const value = await paired.json(); assert.equal(value.orgId, 'tenant-test'); assert.match(value.sessionToken, /^[\w-]{43}$/);
  const headers = { Authorization: 'Bearer ' + value.sessionToken, Origin: portal, 'Sec-Fetch-Site': 'cross-site' };
  assert.equal((await a.request('/api/session', { ticket }, { Authorization: '', Origin: portal })).status, 401);
  const status = await (await a.request('/api/status', null, headers)).json(); assert.equal(status.bridge.orgId, 'tenant-test'); assert.equal(status.bridge.enabled, true);
  assert.equal((await a.request('/api/status', null, { ...headers, Origin: hml })).status, 401);
  assert.equal((await a.request('/api/status', null, { Authorization: headers.Authorization })).status, 401);
  assert.equal((await a.request('/api/pair-ticket', {}, headers)).status, 403);
  const capabilities = await (await a.request('/api/studio/capabilities', null, headers)).json();
  assert.equal(capabilities.repository.state, 'NOT_CONFIGURED'); assert.equal(capabilities.authenticatedOrgId, 'tenant-test');
  assert.equal((await a.request('/api/studio/context', { paths: ['app.cjs'], classification: 'INTERNAL' }, headers)).status, 503);
  const log = fs.readFileSync(path.join(a.stateDir, 'audit.jsonl'), 'utf8'); assert.ok(!log.includes(ticket)); assert.ok(!log.includes(value.sessionToken));
  assert.equal((await a.request('/api/logout', {}, headers)).status, 200); assert.equal((await a.request('/api/status', null, headers)).status, 401);
  const next = (await (await a.request('/api/pair-ticket', {})).json()).ticket;
  const expiry = await (await a.request('/api/session', { ticket: next }, { Authorization: '', Origin: portal })).json();
  time += 8 * 3600 * 1000 + 1; assert.equal((await a.request('/api/status', null, { ...headers, Authorization: 'Bearer ' + expiry.sessionToken })).status, 401);
});
test('portal bridge is disabled by default and rejects unrecognized preflight headers', async t => {
  const origin = 'https://auroranexus.com.br', a = await fixture(t);
  const response = await a.request('/api/status', null, { Origin: origin }); assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const b = await fixture(t, undefined, { portalOrigins: [origin] });
  assert.equal((await fetch(b.base + '/api/session', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-unrestricted' } })).status, 403);
});

test('persistent local configuration is organization-bound and invalid configuration disables the bridge', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-master-config-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'studio-configuration.json'), repository = { root: 'synthetic' }, origin = 'https://auroranexus.com.br';
  assert.deepEqual(startupConfiguration(directory, 'tenant-test', {}), { studioRepository: null, portalOrigins: [] });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'aurora.master.local-config.v1', orgId: 'tenant-test', repository, portalOrigins: [origin] }));
  assert.deepEqual(startupConfiguration(directory, 'tenant-test', { AURORA_MASTER_PORTAL_ORIGINS: '[]' }), { studioRepository: repository, portalOrigins: [origin] });
  assert.deepEqual(startupConfiguration(directory, 'other-tenant', {}), { studioRepository: { invalid: true }, portalOrigins: [] });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'aurora.master.local-config.v1', orgId: 'tenant-test', repository, portalOrigins: [origin], command: 'whoami' }));
  assert.deepEqual(startupConfiguration(directory, 'tenant-test', {}), { studioRepository: { invalid: true }, portalOrigins: [] });
});

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function syntheticRegistry(t, records, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-master-knowledge-synthetic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const registryPath = path.join(directory, 'synthetic-registry.json');
  const value = { schemaVersion: '1.0.0', version: 'synthetic-v1', classification: 'INTERNAL_SANITIZED_METHODS', records, ...extra };
  fs.writeFileSync(registryPath, JSON.stringify(value));
  return { directory, registryPath, value };
}
const syntheticMethod = { id: 'SYN-001', version: '1.0.0', title: 'Idempotent synthetic methods',
  knowledgeState: 'REGISTERED', technicalState: 'IMPLEMENTED', prompt: { text: 'SYNTHETIC_METHOD_CONTENT_NOT_FOR_AUDIT' } };
test('installed knowledge contract retains status, query selection, receipts, cache invalidation and sanitized audit', async t => {
  const corpus = syntheticRegistry(t, [syntheticMethod, { ...syntheticMethod, id: 'SYN-REVOKED', revoked: true }]);
  const contexts = []; const a = await fixture(t, async (_, context) => { contexts.push(context); return { text: 'Synthetic engineering result.' }; }, { registryPath: corpus.registryPath });
  const status = await (await a.request('/api/status')).json();
  assert.deepEqual(status.knowledge, { status: 'LOADED', corpusVersion: 'synthetic-v1', corpusHash: digest(fs.readFileSync(corpus.registryPath)),
    loadedCount: 1, rejectedCount: 1, completeHistoricalAbsorption: false });
  assert.ok(!JSON.stringify(status).includes(syntheticMethod.prompt.text));
  const first = await (await a.request('/api/improve', task)).json();
  assert.equal(first.knowledge.status, 'LOADED'); assert.deepEqual(first.knowledge.recordIds, ['SYN-001']);
  assert.equal(first.knowledge.selectionState, 'SELECTED'); assert.equal(first.knowledge.maxContextBytes, 11000);
  assert.equal(first.knowledge.selectedContextBytes, Buffer.byteLength(contexts[0]));
  const cached = await (await a.request('/api/improve', task)).json(); assert.equal(cached.proposalId, first.proposalId); assert.equal(contexts.length, 1);
  fs.writeFileSync(corpus.registryPath, JSON.stringify({ ...corpus.value, version: 'synthetic-v2' }));
  const changed = await (await a.request('/api/improve', task)).json(); assert.notEqual(changed.proposalId, first.proposalId); assert.equal(contexts.length, 2);
  fs.writeFileSync(corpus.registryPath, JSON.stringify(corpus.value));
  await a.request('/api/improve', task); assert.equal(contexts.length, 3);
  const log = fs.readFileSync(path.join(a.stateDir, 'audit.jsonl'), 'utf8');
  assert.ok(log.includes(first.knowledge.corpusHash)); assert.match(log, /knowledgeRecordIds/);
  for (const privateText of [syntheticMethod.prompt.text, task.prompt, 'Synthetic engineering result.', token, corpus.registryPath]) assert.ok(!log.includes(privateText));
  assert.equal(first.applied, false); assert.equal(first.externalAiCalls, 0); assert.equal(a.metrics.externalAiCalls, 0);
});
test('configured unavailable or oversized corpus never falls back silently or exceeds its method budget', async t => {
  const corpus = syntheticRegistry(t, [syntheticMethod]);
  const contexts = []; const a = await fixture(t, async (_, context) => { contexts.push(context); return { text: 'Synthetic proposal.' }; },
    { registryPath: corpus.registryPath, knowledge: 'LEGACY_METHOD_MUST_NOT_REPLACE_CONFIGURED_CORPUS' });
  fs.writeFileSync(corpus.registryPath, '{invalid');
  const unavailable = await (await a.request('/api/improve', task)).json();
  assert.equal(unavailable.knowledge.status, 'INVALID_OR_UNAVAILABLE'); assert.equal(unavailable.knowledge.selectionState, 'CORPUS_UNAVAILABLE');
  assert.equal(contexts[0], ''); assert.deepEqual(unavailable.knowledge.recordIds, []);
  fs.writeFileSync(corpus.registryPath, JSON.stringify({ ...corpus.value, coverage: 'x'.repeat(12000) }));
  const limited = await (await a.request('/api/improve', task)).json();
  assert.equal(limited.knowledge.status, 'LOADED'); assert.equal(limited.knowledge.selectionState, 'CONTEXT_LIMIT');
  assert.equal(limited.knowledge.selectedContextBytes, 0); assert.deepEqual(limited.knowledge.recordIds, []); assert.equal(contexts[1], '');
});
test('Studio preserves complete selected method receipts while keeping fixed model and source budgets', async t => {
  const corpus = syntheticRegistry(t, [syntheticMethod]);
  const root = path.join(corpus.directory, 'repo'); fs.mkdirSync(root);
  const gitExecutable = process.env.AURORA_STUDIO_TEST_GIT;
  assert.ok(gitExecutable && path.isAbsolute(gitExecutable), 'Set AURORA_STUDIO_TEST_GIT to the existing Git executable.');
  const git = args => require('node:child_process').execFileSync(gitExecutable, ['-c', 'core.fsmonitor=false', ...args], { cwd: root, windowsHide: true, stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Synthetic knowledge test']); git(['config', 'user.email', 'test@example.invalid']);
  const original = 'module.exports = 1;\n'; fs.writeFileSync(path.join(root, 'app.cjs'), original); git(['add', 'app.cjs']); git(['commit', '-m', 'Synthetic baseline']);
  const submitted = [], a = await fixture(t, async (prompt, method, structured) => {
    submitted.push({ prompt, method, structured }); return { text: JSON.stringify({ summary: 'Improve the synthetic module.',
      files: [{ path: 'app.cjs', beforeSha256: digest(original), edits: [{ before: '1', after: '2' }] }] }) };
  }, { registryPath: corpus.registryPath, studioRepository: { root, gitExecutable, allowedPaths: ['app.cjs'], projectId: 'synthetic-project' } });
  const ctx = await (await a.request('/api/studio/context', { paths: ['app.cjs'], classification: 'INTERNAL' })).json();
  const created = await (await a.request('/api/studio/tasks', { contextId: ctx.context.id, prompt: 'Improve idempotent synthetic module.', classification: 'INTERNAL' })).json();
  const response = await a.request('/api/studio/tasks/' + created.task.id + '/propose', { expectedVersion: created.task.version });
  assert.equal(response.status, 200); const proposed = (await response.json()).task;
  assert.equal(submitted[0].structured, true); assert.ok(Buffer.byteLength(submitted[0].prompt) <= 4096);
  assert.ok(Buffer.byteLength(submitted[0].method) <= 600); assert.equal(proposed.knowledge.maxContextBytes, 600);
  assert.equal(proposed.knowledge.selectedContextBytes, Buffer.byteLength(submitted[0].method));
  assert.deepEqual(proposed.knowledge.recordIds, submitted[0].method.split('\n').slice(1).map(line => JSON.parse(line).id));
  assert.deepEqual(proposed.knowledge.recordIds, ['SYN-001']); assert.equal(proposed.knowledge.selectionState, 'SELECTED');
  const readback = await (await a.request('/api/studio/tasks/' + proposed.id)).json(); assert.deepEqual(readback.task.knowledge, proposed.knowledge);
  assert.equal(proposed.history.at(-1).knowledgeHash, digest(JSON.stringify(proposed.knowledge)));
  const log = fs.readFileSync(path.join(a.stateDir, 'audit.jsonl'), 'utf8');
  assert.match(log, /STUDIO_ENGINEERING_KNOWLEDGE/); assert.ok(log.includes(proposed.knowledge.corpusHash));
  assert.ok(!log.includes(syntheticMethod.prompt.text)); assert.ok(!log.includes(original));
  assert.equal(fs.readFileSync(path.join(root, 'app.cjs'), 'utf8'), original);
  fs.writeFileSync(corpus.registryPath, JSON.stringify({ ...corpus.value, records: [{ ...syntheticMethod, prompt: { text: 'x'.repeat(1000) } }] }));
  const oversized = (await (await a.request('/api/studio/tasks/' + proposed.id + '/propose', { expectedVersion: proposed.version })).json()).task;
  assert.deepEqual(oversized.knowledge.recordIds, []); assert.equal(oversized.knowledge.selectionState, 'NO_RECORD_FITS');
  assert.ok(Buffer.byteLength(submitted[1].method) <= 600);
});
const release = { component: 'AURORA_IA_MASTER', version: '1.1.0', sourceRevision: 'a'.repeat(40), dirty: false, externalAiEnabled: false };
test('health and private status retain the process manifest and start time after disk replacement', async t => {
  let bytes = Buffer.from(JSON.stringify({ ...release, privateConfiguration: 'NEVER_RETURN_THIS' })), reads = 0, time = Date.parse('2026-10-08T00:00:00.000Z');
  const expectedDigest = digest(bytes);
  const a = await fixture(t, undefined, { now: () => time, readManifest: () => { reads++; return bytes; } });
  const health = await (await a.request('/health', null, { Authorization: '' })).json();
  bytes = Buffer.from(JSON.stringify({ ...release, sourceRevision: 'b'.repeat(40) })); time += 60000;
  const status = await (await a.request('/api/status')).json();
  const again = await (await a.request('/health', null, { Authorization: '' })).json();
  assert.equal(reads, 1); assert.equal(health.startedAt, '2026-10-08T00:00:00.000Z');
  assert.equal(status.startedAt, health.startedAt); assert.equal(again.startedAt, health.startedAt);
  assert.deepEqual(status.processManifest, health.processManifest); assert.deepEqual(again.processManifest, health.processManifest);
  assert.equal(health.processManifest.sourceRevision, release.sourceRevision); assert.equal(health.processManifest.manifestSha256, expectedDigest);
  assert.equal(health.processManifest.status, 'PROCESS_MANIFEST_OBSERVED');
  assert.equal(health.processManifest.activeReleasePin, 'NOT_OBSERVED');
  assert.equal(health.processManifest.fileIntegrityVerified, false); assert.equal(health.processManifest.deviceInstallationVerified, false);
  assert.ok(!JSON.stringify(health).includes('NEVER_RETURN_THIS')); assert.ok(!JSON.stringify(health).includes('tenant-test'));
  assert.equal(status.modelState, 'UNAVAILABLE'); assert.equal(status.cloudSync, 'NOT_VERIFIED');
});
test('missing, malformed and unreviewed manifests remain explicit observations', async t => {
  for (const [readManifest, expected] of [
    [() => { throw Error('PRIVATE_PATH_NOT_DISCLOSED'); }, 'PROCESS_MANIFEST_UNAVAILABLE'],
    [() => Buffer.from('{malformed'), 'INVALID_PROCESS_MANIFEST'],
    [() => Buffer.from(JSON.stringify({ ...release, sourceRevision: 'invalid' })), 'INVALID_PROCESS_MANIFEST'],
    [() => Buffer.from(JSON.stringify({ ...release, version: '9.0.0' })), 'INVALID_PROCESS_MANIFEST'],
    [() => Buffer.from(JSON.stringify({ ...release, dirty: true })), 'UNREVIEWED_PROCESS_MANIFEST']
  ]) {
    const a = await fixture(t, undefined, { readManifest });
    const health = await (await a.request('/health')).json();
    assert.equal(health.processManifest.status, expected); assert.equal(health.processManifest.activeReleasePin, 'NOT_OBSERVED');
    assert.ok(!JSON.stringify(health).includes('PRIVATE_PATH_NOT_DISCLOSED'));
  }
});

// Load the packaged manager with synthetic Windows/filesystem/process dependencies.
// These fixtures never enumerate, spawn, stop or probe an installed component.
function managerFixture({ masterPresent = true, modelPresent = true, healthOverride, responseStatus = 200,
  responseText, fetchFailure = false, foreignListener = false } = {}) {
  const directory = path.join(process.env.AURORA_TEST_BUILD, 'synthetic-installed-component');
  const fakeNode = path.join(directory, 'node.exe');
  const localRoot = path.join(directory, 'local', 'AuroraNexus');
  const files = { 'server.cjs': Buffer.from('synthetic server'), 'studio.cjs': Buffer.from('synthetic studio'), 'manage.cjs': Buffer.from('synthetic manager'), 'kernel/auroraMasterEngine.js': Buffer.from('synthetic kernel') };
  const manifest = { ...release, files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const expected = { ...manifest, manifestSha256: digest(manifestBytes) };
  const health = { service: 'AURORA_IA_MASTER', version: manifest.version, startedAt: '2026-10-08T00:00:00.000Z',
    processManifest: { ...release, status: 'PROCESS_MANIFEST_OBSERVED', manifestSha256: expected.manifestSha256, activeReleasePin: 'NOT_OBSERVED' } };
  const observed = healthOverride ? healthOverride(health) : health;
  const spawned = [], killed = [], writes = [], probes = [], messages = [];
  const mockFs = {
    readFileSync(file) {
      if (file === path.join(directory, 'manifest.json')) return manifestBytes;
      if (file === path.join(localRoot, 'integration', 'state', 'ia-master', 'organization.txt')) return 'tenant-test';
      if (file === path.join(localRoot, 'integration', 'state', 'ia-master', 'control.key')) return token;
      const relative = path.relative(directory, file).split(path.sep).join('/');
      if (files[relative]) return files[relative];
      throw Error('UNEXPECTED_FILE_READ');
    },
    existsSync: () => true, openSync(file) { writes.push(file); return 1; }, closeSync() {},
    writeFileSync(file) { writes.push(file); }
  };
  const mockChildProcess = {
    execFileSync(executable, args) {
      if (executable === 'clip.exe') { writes.push('MANUAL_CLIPBOARD_TICKET'); return ''; }
      assert.equal(executable, 'powershell.exe'); const port = Number(args.at(-1).match(/-LocalPort (\d+)/)[1]);
      if (!(port === 38765 ? masterPresent : modelPresent)) return '[]';
      return JSON.stringify([{ address: '127.0.0.1', pid: 100 + port,
        exe: port === 38765 ? (foreignListener ? 'unrelated.exe' : fakeNode) : path.join(localRoot, 'components', 'ollama', '0.35.1', 'ollama.exe'),
        command: path.join(directory, 'server.cjs') }]);
    },
    spawn(executable, args, options) { spawned.push({ executable, args, options }); return { pid: 900 + spawned.length, on() {}, unref() {} }; }
  };
  const fakeRequire = name => ({ 'node:fs': mockFs, 'node:path': path, 'node:crypto': crypto, 'node:child_process': mockChildProcess })[name];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(process.env.AURORA_TEST_BUILD, 'manage.cjs'), 'utf8'), {
    require: fakeRequire, module, __dirname: directory, Buffer, AbortSignal,
    process: { platform: 'win32', versions: { node: '22.23.3' }, execPath: fakeNode,
      env: { LOCALAPPDATA: path.join(directory, 'local'), APPDATA: path.join(directory, 'roaming') }, kill: pid => killed.push(pid) },
    console: { log: text => messages.push(text), error: text => messages.push(text) },
    fetch: async (url, options) => {
      probes.push({ url, options }); if (fetchFailure) throw Error('UNAVAILABLE');
      return { ok: responseStatus === 200, text: async () => responseText ?? JSON.stringify(observed), json: async () => ({ ticket: 't'.repeat(43) }) };
    }
  });
  return { ...module.exports, spawned, killed, writes, probes, messages, expected, health };
}
test('start accepts an observed matching process without restarting it or sending credentials', async () => {
  const a = managerFixture(); await a.start();
  assert.equal(a.spawned.length, 0); assert.equal(a.killed.length, 0); assert.equal(a.writes.length, 0);
  assert.equal(a.probes.length, 1); assert.equal(a.probes[0].url, 'http://127.0.0.1:38765/health');
  assert.equal(a.probes[0].options.redirect, 'error'); assert.equal(a.probes[0].options.headers, undefined);
  assert.equal(a.assessRunningProcess(a.health, a.expected), 'PROCESS_MANIFEST_MATCH_REPORTED');
});
test('start rejects source, manifest or version conflicts before starting a missing model', async () => {
  for (const change of [
    h => ({ ...h, processManifest: { ...h.processManifest, sourceRevision: 'b'.repeat(40) } }),
    h => ({ ...h, processManifest: { ...h.processManifest, manifestSha256: 'c'.repeat(64) } }),
    h => ({ ...h, version: '0.9.0' }),
    h => ({ ...h, version: '1.0.1', processManifest: { ...h.processManifest, version: '1.0.1' } }),
    h => ({ ...h, processManifest: { ...h.processManifest, version: '0.9.0' } })
  ]) {
    const a = managerFixture({ modelPresent: false, healthOverride: change });
    await assert.rejects(a.start(), { message: 'LOCAL_PROCESS_RELEASE_CONFLICT' });
    assert.equal(a.spawned.length, 0); assert.equal(a.killed.length, 0); assert.equal(a.writes.length, 0);
  }
});
test('legacy, unreviewed, malformed or unreachable processes block start without side effects', async () => {
  for (const options of [
    { healthOverride: h => ({ service: h.service, version: h.version }) },
    { healthOverride: h => ({ ...h, startedAt: 'invalid' }) },
    { healthOverride: h => ({ ...h, processManifest: { ...h.processManifest, status: 'UNREVIEWED_PROCESS_MANIFEST' } }) },
    { responseStatus: 503 }, { responseText: '{malformed' }, { responseText: 'x'.repeat(65537) }, { fetchFailure: true }
  ]) {
    const a = managerFixture({ modelPresent: false, ...options });
    await assert.rejects(a.start(), { message: 'LOCAL_PROCESS_RELEASE_UNVERIFIED' });
    assert.equal(a.spawned.length, 0); assert.equal(a.killed.length, 0); assert.equal(a.writes.length, 0);
  }
});
test('foreign listeners still block management before probing the service', async () => {
  const a = managerFixture({ foreignListener: true, modelPresent: false });
  await assert.rejects(a.start(), { message: 'PORT_OWNED_BY_DIFFERENT_COMPONENT' });
  assert.equal(a.probes.length, 0); assert.equal(a.spawned.length, 0); assert.equal(a.killed.length, 0);
});
test('start only launches missing components with local environment and preserves a matching process', async () => {
  for (const [options, expected] of [[{ masterPresent: false, modelPresent: false }, 2], [{ modelPresent: false }, 1], [{ masterPresent: false }, 1]]) {
    const a = managerFixture(options); await a.start();
    assert.equal(a.spawned.length, expected); assert.equal(a.killed.length, 0);
    assert.equal(a.probes.length, options.masterPresent === false ? 0 : 1);
    for (const child of a.spawned) {
      assert.equal(child.options.windowsHide, true); assert.equal(child.options.env.OLLAMA_NO_CLOUD, '1');
      assert.equal(child.options.env.OLLAMA_HOST, '127.0.0.1:11435');
      assert.equal(child.options.env.AURORA_ORG_ID, 'tenant-test');
    }
  }
});

test('manual portal pairing places only an ephemeral ticket in clipboard and never logs or opens its URL', async () => {
  const a = managerFixture(); await a.pair(true);
  assert.deepEqual(a.writes, ['MANUAL_CLIPBOARD_TICKET']); assert.equal(a.spawned.length, 0); assert.equal(a.killed.length, 0);
  assert.equal(a.probes[0].url, 'http://127.0.0.1:38765/api/pair-ticket');
  assert.equal(a.probes[0].options.redirect, 'error'); assert.equal(a.probes[0].options.headers.Authorization, 'Bearer ' + token);
  assert.ok(!a.messages.join('\n').includes(token)); assert.ok(!a.messages.join('\n').includes('t'.repeat(43)));
  assert.match(a.messages.join('\n'), /COPIED_VALID_60_SECONDS/);
});
