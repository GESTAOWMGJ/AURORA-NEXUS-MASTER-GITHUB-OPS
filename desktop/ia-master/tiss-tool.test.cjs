'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTissTool, runParser, readTissConfiguration } = require('./tiss-tool.cjs');
const root = path.resolve(__dirname, '../..');
const parserPath = path.join(root, 'aurora-coletor/aurora_tiss.py');
const fixturePath = path.join(root, 'aurora-coletor/fixtures/tiss/sp-sadt-4.03.00.synthetic.xml');
const xml = fs.readFileSync(fixturePath, 'utf8');
const orgId = 'synthetic-org', caller = 'a'.repeat(64), anotherCaller = 'b'.repeat(64);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function pythonExecutable() {
  if (process.env.AURORA_TISS_TEST_PYTHON) return fs.realpathSync(process.env.AURORA_TISS_TEST_PYTHON);
  for (const directory of (process.env.PATH || '').split(path.delimiter)) for (const name of process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']) {
    const candidate = path.join(directory, name);
    try { if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate); } catch { /* Test discovery only. */ }
  }
  throw Error('AURORA_TISS_TEST_PYTHON is required for the real-parser test.');
}
const python = pythonExecutable();
function config() {
  const keys = ['batchNumber', 'operatorRegistration', 'providerGuideNumber', 'operatorGuideNumber',
    'authorizationNumber', 'beneficiaryNumber', 'providerCode', 'requestDate', 'executionDate',
    'generalTotal', 'proceduresTotal', 'otherExpensesTotal'];
  for (const key of ['sequence', 'executionDate', 'tableCode', 'procedureCode', 'description', 'quantity', 'adjustmentFactor', 'unitPrice', 'totalPrice']) keys.push('procedures.0.' + key);
  for (const key of ['sequence', 'expenseCode', 'executionDate', 'tableCode', 'procedureCode', 'description', 'quantity', 'unit', 'adjustmentFactor', 'unitPrice', 'totalPrice']) keys.push('otherExpenses.0.' + key);
  return { schemaVersion: 'aurora.tiss.config.v1', orgId, pythonExecutable: python,
    operatorRegistration: '999999', providerIdentity: { type: 'CODE', value: 'TESTE000001' },
    environment: 'SYNTHETIC_HOMOLOGATION', reviewReference: 'synthetic-review-1', mappingVersion: 'synthetic-v1',
    browser: { orgId, debuggingOrigin: 'http://127.0.0.1:9222', portalOrigin: 'https://synthetic.invalid',
      allowedPathPrefix: '/billing', fieldMap: Object.fromEntries(keys.map((key, index) => [key, '#field-' + index])) } };
}
function fixture(t, options = {}) {
  const stateDir = options.stateDir || fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-tiss-tool-test-'));
  if (!options.stateDir) t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const events = [], calls = [], controls = { time: Date.parse('2026-10-21T15:00:00Z') };
  const audit = (action, metadata) => {
    const event = { orgId, action, ...metadata }; events.push(event);
    fs.appendFileSync(path.join(stateDir, 'audit.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
  };
  const browserFactory = () => ({
    inspect: async () => ({ state: 'TARGET_AVAILABLE', targets: [{ targetId: 'synthetic-tab', url: 'https://synthetic.invalid/billing' }] }),
    fill: async input => {
      calls.push(input);
      if (options.fill) return options.fill(input, { stateDir, events, calls });
      return { state: 'FILLED_DRAFT', code: 'TISS_BROWSER_DOM_VERIFIED', changedCount: Object.keys(input.fields).length,
        matchedCount: 0, readbackCount: Object.keys(input.fields).length };
    }
  });
  const configuration = Object.hasOwn(options, 'config') ? options.config : config();
  const tool = createTissTool({ stateDir, orgId, config: configuration, audit, now: () => controls.time,
    parserPath, fixturePath, browserFactory, ...(options.parser ? { parser: options.parser } : {}),
    ...(options.fixturePath ? { fixturePath: options.fixturePath } : {}) });
  t.after(() => tool.dispose());
  const route = (name, body, identity = caller) => tool.route('POST', '/api/tiss/' + name, body, identity);
  return { tool, route, stateDir, events, calls, controls, configuration };
}
async function prepare(f, identity = caller, source = xml) {
  const analyzed = (await f.route('analyze', { xml: source }, identity)).value;
  const plan = (await f.route('plan', { analysisId: analyzed.analysisId, guideIndex: 0 }, identity)).value;
  return { analyzed, plan };
}
function fillBody(plan) {
  return { planId: plan.planId, expectedPlanHash: plan.planHash, targetId: 'synthetic-tab', expectedUrl: 'https://synthetic.invalid/billing' };
}
function code(expected) { return error => error.code === expected; }

test('real stdin parser extracts SP-SADT and sanitizes rejected XML errors', async () => {
  const result = await runParser({ executable: python, parserPath, xml, orgId });
  assert.equal(result.schemaVersion, 'aurora.tiss.analysis.v1');
  assert.equal(result.standardVersion, '4.03.00');
  assert.equal(result.sourceSha256, digest(xml));
  assert.equal(result.summary.totalCents, 10700);
  assert.equal(result.validation.xsdValidated, true);
  await assert.rejects(runParser({ executable: python, parserPath, xml: '<private-data>SYNTHETIC_SECRET_MARKER</private-data>', orgId }), error => {
    assert.doesNotMatch(error.message, /SYNTHETIC_SECRET_MARKER/); return error.code === 'TISS_XML_NAMESPACE_REJECTED';
  });
});

test('configuration binds organization, explicit executable and reviewed synthetic portal', async t => {
  assert.equal(fixture(t, { config: null }).tool.status().state, 'PENDING_CONFIGURATION');
  const wrongOrg = config(); wrongOrg.orgId = 'another-org';
  assert.equal(fixture(t, { config: wrongOrg }).tool.status().state, 'CONFIGURATION_REQUIRES_REVIEW');
  const unreviewed = config(); unreviewed.reviewReference = '';
  assert.equal(fixture(t, { config: unreviewed }).tool.status().state, 'CONFIGURATION_REQUIRES_REVIEW');
  const wrongBrowserOrg = config(); wrongBrowserOrg.browser.orgId = 'another-org';
  assert.equal(fixture(t, { config: wrongBrowserOrg }).tool.status().state, 'CONFIGURATION_REQUIRES_REVIEW');
  const production = config(); production.environment = 'PRODUCTION';
  assert.equal(fixture(t, { config: production }).tool.status().state, 'CONFIGURATION_REQUIRES_REVIEW');
  const f = fixture(t, { config: { schemaVersion: 'aurora.tiss.config.v1', orgId, pythonExecutable: python } });
  assert.equal(f.tool.status().state, 'LOCAL_ANALYSIS_CONFIGURED');
  assert.equal((await f.route('analyze', { xml })).status, 200);
  assert.equal(f.tool.status().realPortalEnabled, false);
  assert.equal(f.tool.status().submissionEnabled, false);
  assert.equal(readTissConfiguration(f.stateDir, orgId), null);
  fs.writeFileSync(path.join(f.stateDir, 'tiss-configuration.json'), JSON.stringify({ orgId: 'foreign' }));
  assert.deepEqual(readTissConfiguration(f.stateDir, orgId), { invalid: true });
});

test('analysis is replayed in memory and only sanitized metadata reaches existing audit', async t => {
  let parses = 0;
  const f = fixture(t, { parser: async input => { parses++; return runParser(input); } });
  const first = (await f.route('analyze', { xml })).value;
  const again = (await f.route('analyze', { xml })).value;
  assert.equal(again.analysisId, first.analysisId); assert.equal(again.reused, true); assert.equal(parses, 1);
  assert.equal(first.dataMode, 'PACKAGED_SYNTHETIC_FIXTURE');
  assert.equal(first.rawDataPersistence, false);
  const audit = fs.readFileSync(path.join(f.stateDir, 'audit.jsonl'), 'utf8');
  for (const sensitive of ['CARTEIRA-SINTETICA', 'GUIA-SINTETICA', '<ans:', '107.00', 'TESTE000001']) assert.equal(audit.includes(sensitive), false);
  assert.deepEqual(fs.readdirSync(f.stateDir), ['audit.jsonl']);
  assert.equal(f.events.filter(event => event.action === 'TISS_XML_ANALYZED').length, 1);
  await assert.rejects(f.route('analyze', { xml, orgId: 'foreign-org' }), code('TISS_INVALID_FIELDS'));
});

test('cached analyses and plans cannot cross sessions or survive TTL/clear', async t => {
  const f = fixture(t); const { analyzed, plan } = await prepare(f);
  await assert.rejects(f.route('plan', { analysisId: analyzed.analysisId, guideIndex: 0 }, anotherCaller), code('TISS_REIMPORT_REQUIRED'));
  await assert.rejects(f.route('inspect', { planId: plan.planId }, anotherCaller), code('TISS_REIMPORT_REQUIRED'));
  await assert.rejects(f.route('fill', fillBody(plan), anotherCaller), code('TISS_REIMPORT_REQUIRED'));
  await assert.rejects(f.route('analyze', { xml }, 'unscoped'), code('TISS_SESSION_REQUIRED'));
  const second = (await f.route('analyze', { xml }, anotherCaller)).value;
  assert.notEqual(second.analysisId, analyzed.analysisId);
  await f.route('clear', {});
  await assert.rejects(f.route('plan', { analysisId: analyzed.analysisId, guideIndex: 0 }), code('TISS_REIMPORT_REQUIRED'));
  assert.equal((await f.route('plan', { analysisId: second.analysisId, guideIndex: 0 }, anotherCaller)).status, 200);
  f.controls.time += 15 * 60 * 1000;
  await assert.rejects(f.route('plan', { analysisId: second.analysisId, guideIndex: 0 }, anotherCaller), code('TISS_REIMPORT_REQUIRED'));
  assert.equal(f.calls.length, 0);
});

test('any source difference and unavailable packaged fixture block browser effects', async t => {
  const f = fixture(t);
  const analyzed = (await f.route('analyze', { xml: xml + '\n' })).value;
  assert.equal(analyzed.dataMode, 'CLINICAL_SENSITIVE_EPHEMERAL');
  await assert.rejects(f.route('plan', { analysisId: analyzed.analysisId, guideIndex: 0 }), code('TISS_REAL_PORTAL_GATE_BLOCKED'));
  const missing = fixture(t, { fixturePath: path.join(f.stateDir, 'absent.xml') });
  assert.equal(missing.tool.status().syntheticFixtureAvailable, false);
  const imported = (await missing.route('analyze', { xml })).value;
  await assert.rejects(missing.route('plan', { analysisId: imported.analysisId, guideIndex: 0 }), code('TISS_REAL_PORTAL_GATE_BLOCKED'));
  assert.equal(f.calls.length + missing.calls.length, 0);
});

test('configured operator and provider identities are checked before planning', async t => {
  for (const [key, expected] of [['operatorRegistration', 'TISS_OPERATOR_MISMATCH'], ['providerIdentity', 'TISS_PROVIDER_MISMATCH']]) {
    const configuration = config();
    configuration[key] = key === 'operatorRegistration' ? '888888' : { type: 'CODE', value: 'OTHER-SYNTHETIC' };
    const f = fixture(t, { config: configuration });
    const analyzed = (await f.route('analyze', { xml })).value;
    await assert.rejects(f.route('plan', { analysisId: analyzed.analysisId, guideIndex: 0 }), code(expected));
    assert.equal(f.calls.length, 0);
  }
});

test('missing procedure/expense mapping or unavailable mapped values never silently drop items', async t => {
  for (const missing of ['providerGuideNumber', 'procedures.0.totalPrice', 'otherExpenses.0.quantity']) {
    const configuration = config(); delete configuration.browser.fieldMap[missing];
    const f = fixture(t, { config: configuration });
    const analyzed = (await f.route('analyze', { xml })).value;
    await assert.rejects(f.route('plan', { analysisId: analyzed.analysisId, guideIndex: 0 }), code('TISS_MAPPING_INCOMPLETE'));
  }
  const configuration = config(); configuration.browser.fieldMap.providerCnpj = '#no-value';
  const f = fixture(t, { config: configuration });
  const analyzed = (await f.route('analyze', { xml })).value;
  await assert.rejects(f.route('plan', { analysisId: analyzed.analysisId, guideIndex: 0 }), code('TISS_MAPPED_VALUE_MISSING'));
});

test('fill is preceded by durable intent, verifies plan hash and cannot repeat after restart', async t => {
  const f = fixture(t, { fill: async (input, state) => {
    const events = fs.readFileSync(path.join(state.stateDir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).action, 'TISS_FILL_INTENT');
    assert.equal(events.at(-1).planHash, input.planHash);
    const count = Object.keys(input.fields).length;
    return { state: 'FILLED_DRAFT', code: 'TISS_BROWSER_DOM_VERIFIED', changedCount: count, matchedCount: 0, readbackCount: count };
  } });
  const { plan } = await prepare(f);
  await assert.rejects(f.route('fill', { ...fillBody(plan), expectedPlanHash: '0'.repeat(64) }), code('TISS_PLAN_CHANGED'));
  assert.equal(f.calls.length, 0);
  const filled = (await f.route('fill', fillBody(plan))).value;
  assert.equal(filled.state, 'FILLED_DRAFT'); assert.equal(filled.readbackCount, plan.fieldCount);
  for (const key of ['submissionAttemptedByAdapter', 'portalPersistenceVerified', 'protocolVerified', 'paymentVerified', 'autoRetryAllowed']) assert.equal(filled[key], false);
  await assert.rejects(f.route('fill', fillBody(plan)), code('TISS_GUIDE_ALREADY_ATTEMPTED_REVIEW_REQUIRED'));
  const restarted = fixture(t, { stateDir: f.stateDir });
  const analyzed = (await restarted.route('analyze', { xml })).value;
  await assert.rejects(restarted.route('plan', { analysisId: analyzed.analysisId, guideIndex: 0 }), code('TISS_GUIDE_ALREADY_ATTEMPTED_REVIEW_REQUIRED'));
  assert.equal(f.calls.length, 1); assert.equal(restarted.calls.length, 0);
  assert.equal(fs.existsSync(path.join(f.stateDir, 'tiss-fill.lock')), false);
});

test('uncertain browser result is durably blocked without leaking exception text', async t => {
  const f = fixture(t, { fill: async () => { throw Object.assign(Error('PRIVATE_SYNTHETIC_MARKER'), { code: 'NETWORK_DETAIL' }); } });
  const { plan } = await prepare(f);
  await assert.rejects(f.route('fill', fillBody(plan)), code('TISS_FILL_UNCERTAIN_REVIEW_REQUIRED'));
  assert.equal(f.events.at(-1).state, 'UNCERTAIN_REQUIRES_REVIEW');
  await assert.rejects(f.route('fill', fillBody(plan)), code('TISS_GUIDE_ALREADY_ATTEMPTED_REVIEW_REQUIRED'));
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(f.stateDir, 'audit.jsonl'), 'utf8'), /PRIVATE_SYNTHETIC_MARKER|NETWORK_DETAIL/);
});

test('partial and no-effect receipts stay explicit and require reconciliation before retry', async t => {
  for (const state of ['NOT_FILLED', 'PARTIAL_REVIEW_REQUIRED', 'UNKNOWN_RESULT_REVIEW_REQUIRED']) {
    const f = fixture(t, { fill: async () => ({ state, code: 'TISS_BROWSER_READBACK_MISMATCH', changedCount: 0, matchedCount: 0, readbackCount: 0 }) });
    const { plan } = await prepare(f);
    assert.equal((await f.route('fill', fillBody(plan))).value.state, state);
    await assert.rejects(f.route('fill', fillBody(plan)), code('TISS_GUIDE_ALREADY_ATTEMPTED_REVIEW_REQUIRED'));
    assert.equal(f.calls.length, 1);
  }
});

test('stale lock and corrupt audit block without deleting evidence or touching browser', async t => {
  const f = fixture(t); const { plan } = await prepare(f);
  const lock = path.join(f.stateDir, 'tiss-fill.lock'); fs.writeFileSync(lock, 'unreconciled-owner');
  await assert.rejects(f.route('fill', fillBody(plan)), code('TISS_EXECUTOR_RECONCILIATION_REQUIRED'));
  assert.equal(fs.readFileSync(lock, 'utf8'), 'unreconciled-owner'); assert.equal(f.calls.length, 0);
  const corrupt = fixture(t); const ready = await prepare(corrupt);
  fs.appendFileSync(path.join(corrupt.stateDir, 'audit.jsonl'), '{broken\n');
  await assert.rejects(corrupt.route('fill', fillBody(ready.plan)), code('TISS_AUDIT_RECONCILIATION_REQUIRED'));
  assert.equal(corrupt.calls.length, 0);
});

test('two tool instances sharing the owner ledger cannot fill concurrently', async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const first = fixture(t, { fill: async input => {
    started(); await gate; const count = Object.keys(input.fields).length;
    return { state: 'FILLED_DRAFT', code: 'TISS_BROWSER_DOM_VERIFIED', changedCount: count, matchedCount: 0, readbackCount: count };
  } });
  const second = fixture(t, { stateDir: first.stateDir });
  const one = await prepare(first), two = await prepare(second);
  const pending = first.route('fill', fillBody(one.plan));
  await entered;
  try { await assert.rejects(second.route('fill', fillBody(two.plan)), code('TISS_EXECUTOR_RECONCILIATION_REQUIRED')); }
  finally { release(); }
  assert.equal((await pending).value.state, 'FILLED_DRAFT');
  assert.equal(first.calls.length, 1); assert.equal(second.calls.length, 0);
});

test('parser organization/hash mismatches cannot enter the tool cache', async t => {
  for (const field of ['orgId', 'sourceSha256']) {
    const f = fixture(t, { parser: async input => ({ ...(await runParser(input)), [field]: 'unexpected' }) });
    await assert.rejects(f.route('analyze', { xml }), code('TISS_PARSER_CONTRACT_INVALID'));
    assert.equal(f.events.length, 0);
  }
});

test('filled-state receipt without full readback is uncertain and cannot be retried', async t => {
  for (const invalid of [{ readbackCount: 0 }, { changedCount: -1 }, { matchedCount: 99999 }, { readbackCount: undefined }]) {
    const f = fixture(t, { fill: async input => ({ state: 'FILLED_DRAFT', code: 'TISS_BROWSER_DOM_VERIFIED',
      changedCount: Object.keys(input.fields).length, matchedCount: 0, readbackCount: Object.keys(input.fields).length, ...invalid }) });
    const { plan } = await prepare(f);
    await assert.rejects(f.route('fill', fillBody(plan)), code('TISS_FILL_UNCERTAIN_REVIEW_REQUIRED'));
    assert.equal(f.events.at(-1).state, 'UNCERTAIN_REQUIRES_REVIEW');
    assert.equal(f.events.at(-1).code, 'TISS_BROWSER_RECEIPT_INVALID');
    await assert.rejects(f.route('fill', fillBody(plan)), code('TISS_GUIDE_ALREADY_ATTEMPTED_REVIEW_REQUIRED'));
    assert.equal(f.calls.length, 1);
  }
});

test('clear during an in-flight parser prevents late raw-data recaching or audit success', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { parser: async input => { entered(); await waiting; return runParser(input); } });
  const pending = f.route('analyze', { xml });
  await started;
  await f.route('clear', {});
  release();
  await assert.rejects(pending, code('TISS_ANALYSIS_CANCELLED'));
  assert.equal(f.events.filter(event => event.action === 'TISS_XML_ANALYZED').length, 0);
  const reimport = (await f.route('analyze', { xml })).value;
  assert.equal(reimport.reused, false);
});

test('dispose cancels unfinished analysis and discards cached sensitive data', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { parser: async input => { entered(); await waiting; return runParser(input); } });
  const pending = f.route('analyze', { xml });
  await started; f.tool.dispose(); release();
  await assert.rejects(pending, code('TISS_ANALYSIS_CANCELLED'));
  assert.equal(f.events.filter(event => event.action === 'TISS_XML_ANALYZED').length, 0);
});

test('XSD rejection cannot cache an analysis or authorize a synthetic plan', async t => {
  const f = fixture(t);
  const invalid = xml.replace('<ans:UF>41</ans:UF>', '<ans:UF>ZZ</ans:UF>');
  await assert.rejects(f.route('analyze', { xml: invalid }), code('TISS_XSD_DOCUMENT_INVALID'));
  assert.equal(f.events.length, 0); assert.equal(f.calls.length, 0);
  assert.equal((await f.route('analyze', { xml })).value.analysis.validation.xsdValidated, true);
});

test('server requires current schema provenance and preserves independent billing gates', async t => {
  const baseline = await runParser({ executable: python, parserPath, xml, orgId });
  for (const mutate of [
    result => { result.validation.xsdValidated = false; },
    result => { delete result.validation.xsd; },
    result => { result.validation.xsd.schemaSetSha256 = '0'.repeat(64); },
    result => { result.validation.xsd.standardVersion = '4.02.00'; },
    result => { result.validation.catalogValidated = true; },
    result => { result.validation.contractValidated = true; },
    result => { result.validation.billingApproved = true; }
  ]) {
    const result = structuredClone(baseline); mutate(result);
    const f = fixture(t, { parser: async () => result });
    await assert.rejects(f.route('analyze', { xml }), code('TISS_PARSER_CONTRACT_INVALID'));
    assert.equal(f.events.length, 0); assert.equal(f.calls.length, 0);
  }
});
