const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createMaster } = require(path.join(process.env.AURORA_TEST_BUILD, 'server.cjs'));
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

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const release = { component: 'AURORA_IA_MASTER', version: '1.0.0', sourceRevision: 'a'.repeat(40), dirty: false, externalAiEnabled: false };
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
  const files = { 'server.cjs': Buffer.from('synthetic server'), 'manage.cjs': Buffer.from('synthetic manager'), 'kernel/auroraMasterEngine.js': Buffer.from('synthetic kernel') };
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
      const relative = path.relative(directory, file).split(path.sep).join('/');
      if (files[relative]) return files[relative];
      throw Error('UNEXPECTED_FILE_READ');
    },
    existsSync: () => true, openSync(file) { writes.push(file); return 1; }, closeSync() {},
    writeFileSync(file) { writes.push(file); }
  };
  const mockChildProcess = {
    execFileSync(executable, args) {
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
      return { ok: responseStatus === 200, text: async () => responseText ?? JSON.stringify(observed) };
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
