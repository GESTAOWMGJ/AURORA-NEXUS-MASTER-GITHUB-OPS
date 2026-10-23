'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createMaster } = require(path.join(process.env.AURORA_TEST_BUILD, 'server.cjs'));
const build = process.env.AURORA_TEST_BUILD;
const xml = fs.readFileSync(path.join(build, 'tiss-fixtures/sadt-valid.xml'), 'utf8');
const token = 't'.repeat(43), orgId = 'synthetic-org';
function pythonExecutable() {
  if (process.env.AURORA_TISS_TEST_PYTHON) return fs.realpathSync(process.env.AURORA_TISS_TEST_PYTHON);
  for (const directory of (process.env.PATH || '').split(path.delimiter)) for (const name of process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']) {
    const candidate = path.join(directory, name);
    try { if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate); } catch { /* Discovery is test-only. */ }
  }
  throw Error('AURORA_TISS_TEST_PYTHON is required.');
}
const python = pythonExecutable();

async function fixture(t, options = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-tiss-http-test-'));
  const inferCalls = [], controls = { time: Date.parse('2026-10-21T15:00:00Z') };
  const app = createMaster({ stateDir, orgId, controlToken: token, port: 0,
    tissConfig: { schemaVersion: 'aurora.tiss.config.v1', orgId, pythonExecutable: python },
    infer: async (...args) => { inferCalls.push(args); return { text: 'unused' }; },
    readModelState: async () => 'UNAVAILABLE', now: () => controls.time, ...options });
  await app.listen();
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const initialEntries = fs.readdirSync(stateDir);
  t.after(async () => {
    app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(stateDir, { recursive: true, force: true });
  });
  const request = (route, body, headers = {}) => fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST', headers: {
      Authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Aurora-Local': '1' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function session() {
    const ticket = (await (await request('/api/pair-ticket', {})).json()).ticket;
    const response = await request('/api/session', { ticket }, { Authorization: '' });
    assert.equal(response.status, 200);
    return { Authorization: '', Cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  return { ...app, request, session, base, stateDir, inferCalls, controls, initialEntries };
}

test('TISS HTTP routes reuse authenticated owner, origin, CSRF and DNS-rebinding gates', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/tiss/status', undefined, { Authorization: '' })).status, 401);
  assert.equal((await f.request('/api/tiss/analyze', { xml }, { Authorization: '' })).status, 401);
  assert.equal((await f.request('/api/tiss/analyze', { xml }, { 'X-Aurora-Local': '' })).status, 403);
  assert.equal((await f.request('/api/tiss/analyze', { xml }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.request('/api/tiss/analyze', { xml }, { Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await f.request('/api/tiss/analyze', { xml }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const rebinding = await new Promise((resolve, reject) => {
    const req = http.get(f.base + '/api/tiss/status', { headers: { Host: 'foreign.invalid', Authorization: 'Bearer ' + token } }, response => {
      response.resume(); resolve(response.statusCode);
    }); req.on('error', reject);
  });
  assert.equal(rebinding, 403);
  const status = await (await f.request('/api/tiss/status')).json();
  assert.equal(status.xsdValidationImplemented, true); assert.equal(status.xsdValidated, false);
  assert.equal(status.id, 'AURORA-TISS-SADT-001'); assert.equal(status.state, 'LOCAL_ANALYSIS_CONFIGURED');
  assert.equal(status.realPortalEnabled, false); assert.equal(status.submissionEnabled, false);
  assert.equal(status.rawDataPersistence, false); assert.equal(status.externalAiCalls, 0);
  assert.equal(f.inferCalls.length, 0);
});

test('built HTTP tool invokes real packaged parser and keeps XML out of audit and AI', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/tiss/analyze', { xml });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.analysis.standardVersion, '4.03.00'); assert.equal(result.analysis.orgId, orgId);
  assert.equal(result.analysis.summary.totalCents, 10700); assert.equal(result.analysis.validation.xsdValidated, true);
  assert.equal(result.dataMode, 'PACKAGED_SYNTHETIC_FIXTURE'); assert.equal(result.externalAiCalls, 0);
  const replay = await (await f.request('/api/tiss/analyze', { xml })).json();
  assert.equal(replay.analysisId, result.analysisId); assert.equal(replay.reused, true);
  const audit = fs.readFileSync(path.join(f.stateDir, 'audit.jsonl'), 'utf8');
  assert.doesNotMatch(audit, /CARTEIRA-SINTETICA|GUIA-SINTETICA|TESTE000001|<ans:/);
  assert.deepEqual(fs.readdirSync(f.stateDir).filter(name => !f.initialEntries.includes(name)), ['audit.jsonl']);
  assert.equal(f.inferCalls.length, 0);
  const master = await (await f.request('/api/status')).json();
  assert.equal(master.metrics.localModelCalls, 0); assert.equal(master.metrics.externalAiCalls, 0);
  assert.equal(master.tiss.version, '1.0.1');
});

test('TISS HTTP schema refuses caller tenant/path/commands and never reports unsafe source text', async t => {
  const f = await fixture(t);
  for (const extra of [{ orgId: 'foreign-org' }, { parserPath: '/tmp/other.py' }, { command: 'arbitrary' }]) {
    const response = await f.request('/api/tiss/analyze', { xml, ...extra });
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'TISS_INVALID_FIELDS');
  }
  const response = await f.request('/api/tiss/analyze', { xml: '<private>SYNTHETIC_PRIVATE_MARKER</private>' });
  assert.equal(response.status, 400); const text = await response.text();
  assert.doesNotMatch(text, /SYNTHETIC_PRIVATE_MARKER/); assert.match(text, /TISS_XML_NAMESPACE_REJECTED/);
  assert.equal((await f.request('/api/tiss/nonexistent', {})).status, 404);
  assert.equal(f.inferCalls.length, 0);
});

test('TISS memory and authorization are scoped to paired sessions and logout clears data', async t => {
  const f = await fixture(t), first = await f.session(), second = await f.session();
  const one = await (await f.request('/api/tiss/analyze', { xml }, first)).json();
  const two = await (await f.request('/api/tiss/analyze', { xml }, second)).json();
  assert.notEqual(one.analysisId, two.analysisId);
  const foreign = await f.request('/api/tiss/plan', { analysisId: one.analysisId, guideIndex: 0 }, second);
  assert.equal(foreign.status, 409); assert.equal((await foreign.json()).code, 'TISS_REIMPORT_REQUIRED');
  assert.equal((await f.request('/api/tiss/clear', {}, first)).status, 200);
  const cleared = await f.request('/api/tiss/plan', { analysisId: one.analysisId, guideIndex: 0 }, first);
  assert.equal(cleared.status, 409); assert.equal((await cleared.json()).code, 'TISS_REIMPORT_REQUIRED');
  const stillCached = await (await f.request('/api/tiss/analyze', { xml }, second)).json();
  assert.equal(stillCached.reused, true);
  assert.equal((await f.request('/api/logout', {}, second)).status, 200);
  assert.equal((await f.request('/api/tiss/status', undefined, second)).status, 401);
  const next = await f.session();
  const reimported = await (await f.request('/api/tiss/analyze', { xml }, next)).json();
  assert.equal(reimported.reused, false); assert.notEqual(reimported.analysisId, two.analysisId);
});

test('TISS-specific body limit supports bounded XML beyond ordinary master prompt size', async t => {
  const f = await fixture(t);
  const expanded = xml.replace('</ans:mensagemTISS>', '<!--' + 's'.repeat(70000) + '--></ans:mensagemTISS>');
  const response = await f.request('/api/tiss/analyze', { xml: expanded });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).dataMode, 'CLINICAL_SENSITIVE_EPHEMERAL');
  const rejected = await f.request('/api/tiss/analyze', { xml: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(rejected.status, 400); assert.equal((await rejected.json()).code, 'TISS_XML_LIMIT');
  assert.equal(f.inferCalls.length, 0);
});

test('TISS plans expire even while owner authentication remains valid', async t => {
  const f = await fixture(t), headers = await f.session();
  const first = await (await f.request('/api/tiss/analyze', { xml }, headers)).json();
  f.controls.time += 15 * 60 * 1000 + 1;
  const stale = await f.request('/api/tiss/plan', { analysisId: first.analysisId, guideIndex: 0 }, headers);
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'TISS_REIMPORT_REQUIRED');
  assert.equal((await f.request('/api/tiss/status', undefined, headers)).status, 200);
  const next = await (await f.request('/api/tiss/analyze', { xml }, headers)).json();
  assert.equal(next.reused, false);
});

test('packaged runtime rejects XSD-incompatible fields with sanitized HTTP errors', async t => {
  const f = await fixture(t);
  const marker = 'SYNTHETIC_PRIVATE_XSD_VALUE';
  const invalid = xml.replace('<ans:nomeProfissional>PROFISSIONAL SINTETICO</ans:nomeProfissional>',
    '<ans:nomeProfissional>' + marker.repeat(4) + '</ans:nomeProfissional>');
  const response = await f.request('/api/tiss/analyze', { xml: invalid });
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.equal(JSON.parse(text).code, 'TISS_XSD_DOCUMENT_INVALID');
  assert.doesNotMatch(text, new RegExp(marker));
  const audit = fs.existsSync(path.join(f.stateDir, 'audit.jsonl')) ? fs.readFileSync(path.join(f.stateDir, 'audit.jsonl'), 'utf8') : '';
  assert.doesNotMatch(audit, /SYNTHETIC_PRIVATE_XSD_VALUE|TISS_XML_ANALYZED/);
  assert.equal(f.inferCalls.length, 0);
});
