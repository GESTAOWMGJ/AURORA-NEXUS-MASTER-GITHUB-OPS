'use strict';
// Deterministic, bounded tool inside the existing local master. XML and field
// values exist only in memory; the existing audit ledger receives hashes/counts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { readRegularFile } = require('./safe-read.cjs');
const { createBrowserAdapter } = require('./tiss-browser.cjs');

const TOOL_ID = 'AURORA-TISS-SADT-001';
const VERSION = '1.0.0';
const XML_LIMIT = 1024 * 1024;
const BODY_LIMIT = XML_LIMIT * 2;
const TTL = 15 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
class TissError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
function demand(ok, code, status) { if (!ok) throw new TissError(code, status); }
function closed(value, keys) {
  demand(plain(value) && Object.keys(value).every(key => keys.includes(key)), 'TISS_INVALID_FIELDS');
}
function errorCode(error) {
  return typeof error?.code === 'string' && /^TISS_[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code : 'TISS_OPERATION_UNAVAILABLE';
}
function readTissConfiguration(stateDir, orgId) {
  const file = path.join(stateDir, 'tiss-configuration.json');
  if (!fs.existsSync(file)) return null;
  try {
    const configuration = JSON.parse(readRegularFile(file, 131072).toString('utf8'));
    demand(configuration.orgId === orgId, 'TISS_CONFIG_TENANT_REJECTED');
    return configuration;
  } catch { return { invalid: true }; }
}
function configurationFor(value, orgId) {
  if (!value) return { state: 'PENDING_CONFIGURATION', configuration: null };
  try {
    closed(value, ['schemaVersion', 'orgId', 'pythonExecutable', 'browser', 'operatorRegistration',
      'providerIdentity', 'mappingVersion', 'reviewReference', 'environment']);
    demand(value.schemaVersion === 'aurora.tiss.config.v1' && value.orgId === orgId, 'TISS_CONFIG_TENANT_REJECTED');
    demand(typeof value.pythonExecutable === 'string' && path.isAbsolute(value.pythonExecutable) &&
      !value.pythonExecutable.includes('\0'), 'TISS_PYTHON_CONFIGURATION_REQUIRED');
    const python = fs.realpathSync(value.pythonExecutable);
    demand(fs.statSync(python).isFile(), 'TISS_PYTHON_CONFIGURATION_REQUIRED');
    if (value.browser) {
      demand(value.environment === 'SYNTHETIC_HOMOLOGATION' &&
        /^[A-Za-z0-9._:-]{1,120}$/.test(value.reviewReference || '') &&
        /^[A-Za-z0-9._-]{1,40}$/.test(value.mappingVersion || '') &&
        /^\d{6}$/.test(value.operatorRegistration || ''), 'TISS_PORTAL_REVIEW_REQUIRED');
      closed(value.providerIdentity, ['type', 'value']);
      demand(['CODE', 'CNPJ'].includes(value.providerIdentity.type) &&
        typeof value.providerIdentity.value === 'string' && value.providerIdentity.value.length > 0 &&
        value.providerIdentity.value.length <= 40 && value.browser.orgId === orgId, 'TISS_PROVIDER_CONFIGURATION_REQUIRED');
      createBrowserAdapter({ config: value.browser, orgId });
    }
    return { state: value.browser ? 'SYNTHETIC_BROWSER_CONFIGURED' : 'LOCAL_ANALYSIS_CONFIGURED',
      configuration: { ...value, pythonExecutable: python } };
  } catch { return { state: 'CONFIGURATION_REQUIRES_REVIEW', configuration: null }; }
}
function runParser({ executable, parserPath, xml, orgId }) {
  return new Promise((resolve, reject) => {
    const environment = {};
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) environment[name] = process.env[name];
    const child = execFile(executable, ['-I', '-B', '-X', 'utf8', parserPath], {
      windowsHide: true, shell: false, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8', env: environment
    }, (error, stdout) => {
      let result;
      try { result = JSON.parse(stdout); }
      catch { return reject(new TissError('TISS_PARSER_UNAVAILABLE', 503)); }
      if (error || result.ok === false) {
        const code = result.code || result.error?.code;
        return reject(new TissError(/^[A-Z][A-Z0-9_]{1,90}$/.test(code || '')
          ? (code.startsWith('TISS_') ? code : 'TISS_' + code) : 'TISS_XML_REJECTED'));
      }
      resolve(result.result || result);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ xml, orgId }));
  });
}
function decimal(cents) {
  demand(Number.isSafeInteger(cents) && cents >= 0, 'TISS_AMOUNT_INVALID');
  return String(Math.floor(cents / 100)) + '.' + String(cents % 100).padStart(2, '0');
}
function guideFields(analysis, guide) {
  const fields = {};
  for (const key of ['batchNumber', 'operatorRegistration', 'transactionId', 'standardVersion']) {
    if (typeof analysis[key] === 'string') fields[key] = analysis[key];
  }
  for (const key of ['providerGuideNumber', 'operatorGuideNumber', 'authorizationNumber', 'beneficiaryNumber',
    'providerCode', 'providerCnpj', 'requestDate', 'executionDate']) {
    if (typeof guide[key] === 'string' && guide[key] !== '') fields[key] = guide[key];
  }
  for (const [index, item] of guide.procedures.entries()) {
    for (const key of ['sequence', 'executionDate', 'tableCode', 'procedureCode', 'description', 'quantity',
      'adjustmentFactor', 'unitPrice', 'totalPrice']) {
      if (typeof item[key] === 'string' || Number.isSafeInteger(item[key])) fields['procedures.' + index + '.' + key] = String(item[key]);
    }
  }
  for (const [index, item] of (guide.otherExpenses || []).entries()) {
    for (const key of ['sequence', 'expenseCode', 'executionDate', 'tableCode', 'procedureCode', 'description', 'quantity',
      'unit', 'adjustmentFactor', 'unitPrice', 'totalPrice']) {
      if (typeof item[key] === 'string' || Number.isSafeInteger(item[key])) fields['otherExpenses.' + index + '.' + key] = String(item[key]);
    }
  }
  fields.generalTotal = decimal(guide.totals.generalCents);
  if (guide.totals.proceduresCents !== null) fields.proceduresTotal = decimal(guide.totals.proceduresCents);
  fields.otherExpensesTotal = decimal(guide.totals.otherExpensesCents);
  return fields;
}
function createTissTool({ stateDir, orgId, audit, config = null, now = () => Date.now(),
  parser = runParser, browserFactory = createBrowserAdapter,
  parserPath = path.join(__dirname, 'client-agent', 'aurora_tiss.py'),
  fixturePath = path.join(__dirname, 'tiss-fixtures', 'sadt-valid.xml') }) {
  demand(/^[a-z0-9][a-z0-9-]{1,63}$/.test(orgId), 'TISS_TENANT_REQUIRED');
  const configured = configurationFor(config, orgId);
  const configuration = configured.configuration;
  const analyses = new Map(), plans = new Map(), inflight = new Map();
  let busy = false;
  let fixtureHash = null;
  try { fixtureHash = hash(readRegularFile(fixturePath, XML_LIMIT)); } catch { /* Cannot enable browser without packaged synthetic fixture. */ }
  const mappingHash = configuration?.browser ? hash(JSON.stringify(configuration)) : null;
  const browser = configuration?.browser ? browserFactory({ config: configuration.browser, orgId }) : null;
  function status() {
    expire();
    return { id: TOOL_ID, version: VERSION, state: configured.state, mode: 'LOCAL_EPHEMERAL',
      standardVersion: '4.03.00', classification: 'CLINICAL_SENSITIVE', rawDataPersistence: false,
      externalAiCalls: 0, canonicalIngestionEnabled: false, realPortalEnabled: false,
      browserMode: 'PACKAGED_SYNTHETIC_FIXTURE_ONLY', browserConfigured: Boolean(browser),
      syntheticFixtureAvailable: Boolean(fixtureHash), submissionEnabled: false, xsdValidated: false,
      tussCatalogValidated: false, contractValidated: false, maxXmlBytes: XML_LIMIT, ttlSeconds: TTL / 1000 };
  }
  function forget(map, id) { const entry = map.get(id); if (entry?.timer) clearTimeout(entry.timer); map.delete(id); }
  function remember(map, id, entry) {
    forget(map, id);
    entry.timer = setTimeout(() => { if (map.get(id) === entry) forget(map, id); }, Math.max(0, entry.expiresAt - now()));
    entry.timer.unref();
    map.set(id, entry);
  }
  function expire() {
    for (const map of [analyses, plans]) for (const [id, value] of map) if (value.expiresAt <= now()) forget(map, id);
  }
  function owner(value, caller) {
    demand(value && value.caller === caller && value.orgId === orgId && value.expiresAt > now(), 'TISS_REIMPORT_REQUIRED', 409);
    return value;
  }
  function scopedCaller(caller) {
    demand(typeof caller === 'string' && /^[a-f0-9]{64}$/.test(caller), 'TISS_SESSION_REQUIRED', 403);
  }
  function existingEffect(guideKey) {
    const filename = path.join(stateDir, 'audit.jsonl');
    if (!fs.existsSync(filename)) return null;
    try {
      const lines = readRegularFile(filename, 16 * 1024 * 1024).toString('utf8').split('\n').filter(Boolean);
      let effect = null;
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.orgId === orgId && event.guideKey === guideKey && ['TISS_FILL_INTENT', 'TISS_FILL_RESULT'].includes(event.action)) effect = event;
      }
      return effect;
    } catch { throw new TissError('TISS_AUDIT_RECONCILIATION_REQUIRED', 409); }
  }
  function acquireLock() {
    const filename = path.join(stateDir, 'tiss-fill.lock');
    const lock = crypto.randomBytes(24).toString('hex');
    let fd;
    try { fd = fs.openSync(filename, 'wx', 0o600); fs.writeFileSync(fd, lock); fs.fsyncSync(fd); }
    catch { if (fd !== undefined) fs.closeSync(fd); throw new TissError('TISS_EXECUTOR_RECONCILIATION_REQUIRED', 409); }
    return () => {
      fs.closeSync(fd);
      // A stale/crashed/changed owner's lock is never silently removed.
      try { if (readRegularFile(filename, 256).toString() === lock) fs.unlinkSync(filename); } catch { /* Preserve for reconciliation. */ }
    };
  }
  function audited(action, metadata) { audit(action, { toolId: TOOL_ID, toolVersion: VERSION, ...metadata }); }
  async function route(method, url, body, caller) {
    scopedCaller(caller); expire();
    if (method === 'GET' && url === '/api/tiss/status') return { status: 200, value: status() };
    demand(method === 'POST', 'TISS_METHOD_NOT_ALLOWED', 405);
    demand(configuration, 'TISS_CONFIGURATION_REQUIRED', 409);
    if (url === '/api/tiss/analyze') {
      closed(body, ['xml']);
      demand(typeof body.xml === 'string' && body.xml.length > 0 && Buffer.byteLength(body.xml) <= XML_LIMIT,
        'TISS_XML_LIMIT');
      const sourceHash = hash(body.xml), analysisId = hash(JSON.stringify([orgId, caller, sourceHash]));
      if (analyses.has(analysisId)) return { status: 200, value: { ...analyses.get(analysisId).publicValue, reused: true } };
      demand(!busy && analyses.size < 8, 'TISS_TOOL_BUSY_OR_LIMIT', 429);
      busy = true; const pending = Symbol('analysis'); inflight.set(caller, pending);
      try {
        const result = await parser({ executable: configuration.pythonExecutable, parserPath, xml: body.xml, orgId });
        demand(inflight.get(caller) === pending, 'TISS_ANALYSIS_CANCELLED', 409);
        demand(result?.orgId === orgId && result.sourceSha256 === sourceHash && Array.isArray(result.guides) &&
          result.guides.length > 0 && result.guides.length <= 100 && result.validation?.xsdValidated === false,
        'TISS_PARSER_CONTRACT_INVALID', 503);
        const expiresAt = now() + TTL;
        const publicValue = { analysisId, analysis: result, expiresAt: new Date(expiresAt).toISOString(),
          dataMode: sourceHash === fixtureHash ? 'PACKAGED_SYNTHETIC_FIXTURE' : 'CLINICAL_SENSITIVE_EPHEMERAL',
          canonicalIngestionEnabled: false, realPortalEnabled: false, rawDataPersistence: false, reused: false };
        audited('TISS_XML_ANALYZED', { sourceHash, guideCount: result.guides.length, analysisId });
        remember(analyses, analysisId, { orgId, caller, expiresAt, result, publicValue });
        return { status: 200, value: publicValue };
      } finally { if (inflight.get(caller) === pending) inflight.delete(caller); busy = false; }
    }
    if (url === '/api/tiss/clear') {
      closed(body, []); clear(caller); return { status: 200, value: { state: 'MEMORY_CLEARED' } };
    }
    if (url === '/api/tiss/plan') {
      closed(body, ['analysisId', 'guideIndex']);
      const entry = owner(analyses.get(body.analysisId), caller), analysis = entry.result;
      demand(browser, 'TISS_PORTAL_CONFIGURATION_REQUIRED', 409);
      // Clinical gate stays unchanged. Generic parsing is useful on its own;
      // browser effects in this increment are limited to the bundled fixture.
      demand(fixtureHash && analysis.sourceSha256 === fixtureHash, 'TISS_REAL_PORTAL_GATE_BLOCKED', 403);
      demand(analysis.validation.status === 'VALIDATED_LOCAL', 'TISS_GUIDE_REVIEW_REQUIRED', 409);
      demand(Number.isInteger(body.guideIndex) && body.guideIndex >= 0 && body.guideIndex < analysis.guides.length,
        'TISS_GUIDE_SELECTION_INVALID');
      const guide = analysis.guides[body.guideIndex];
      demand(analysis.operatorRegistration === configuration.operatorRegistration,
        'TISS_OPERATOR_MISMATCH', 409);
      const providerKey = configuration.providerIdentity.type === 'CNPJ' ? 'providerCnpj' : 'providerCode';
      demand(guide[providerKey] === configuration.providerIdentity.value, 'TISS_PROVIDER_MISMATCH', 409);
      const allFields = guideFields(analysis, guide), fields = {};
      const required = ['providerGuideNumber', 'beneficiaryNumber', providerKey, 'generalTotal'];
      for (const [index] of guide.procedures.entries()) for (const key of ['sequence', 'executionDate', 'tableCode', 'procedureCode', 'quantity', 'adjustmentFactor', 'unitPrice', 'totalPrice']) required.push('procedures.' + index + '.' + key);
      for (const [index] of (guide.otherExpenses || []).entries()) for (const key of ['sequence', 'expenseCode', 'executionDate', 'tableCode', 'procedureCode', 'quantity', 'unit', 'adjustmentFactor', 'unitPrice', 'totalPrice']) required.push('otherExpenses.' + index + '.' + key);
      for (const key of required) demand(Object.hasOwn(configuration.browser.fieldMap, key) && Object.hasOwn(allFields, key), 'TISS_MAPPING_INCOMPLETE', 409);
      for (const key of Object.keys(configuration.browser.fieldMap)) {
        demand(Object.hasOwn(allFields, key), 'TISS_MAPPED_VALUE_MISSING', 409);
        fields[key] = allFields[key];
      }
      const guideKey = hash(JSON.stringify([orgId, analysis.operatorRegistration, providerKey, guide[providerKey], guide.providerGuideNumber]));
      demand(!existingEffect(guideKey), 'TISS_GUIDE_ALREADY_ATTEMPTED_REVIEW_REQUIRED', 409);
      const planHash = hash(JSON.stringify([orgId, analysis.sourceSha256, body.guideIndex, mappingHash, fields]));
      const planId = hash(JSON.stringify([caller, planHash]));
      demand(plans.has(planId) || plans.size < 16, 'TISS_PLAN_LIMIT', 429);
      audited('TISS_PLAN_PREPARED', { planHash, guideKey, mappingHash, fieldCount: Object.keys(fields).length });
      remember(plans, planId, { caller, orgId, expiresAt: entry.expiresAt, planHash, guideKey, fields });
      return { status: 200, value: { planId, planHash, guideKey, mappingVersion: configuration.mappingVersion,
        fieldCount: Object.keys(fields).length, fields, state: 'SYNTHETIC_DRAFT_READY', submissionEnabled: false,
        checksPending: ['OFFICIAL_XSD', 'TUSS_CATALOG_AND_DATES', 'CONTRACT', 'AUTHORIZATION', 'PORTAL_HOMOLOGATION'],
        expiresAt: new Date(entry.expiresAt).toISOString() } };
    }
    if (url === '/api/tiss/inspect') {
      closed(body, ['planId']); owner(plans.get(body.planId), caller);
      demand(browser, 'TISS_PORTAL_CONFIGURATION_REQUIRED', 409);
      return { status: 200, value: await browser.inspect() };
    }
    if (url === '/api/tiss/fill') {
      closed(body, ['planId', 'expectedPlanHash', 'targetId', 'expectedUrl']);
      const plan = owner(plans.get(body.planId), caller);
      demand(body.expectedPlanHash === plan.planHash && typeof body.targetId === 'string' && typeof body.expectedUrl === 'string',
        'TISS_PLAN_CHANGED', 409);
      demand(!busy, 'TISS_TOOL_BUSY_OR_LIMIT', 429);
      busy = true;
      let release, intent = false;
      try {
        release = acquireLock();
        demand(!existingEffect(plan.guideKey), 'TISS_GUIDE_ALREADY_ATTEMPTED_REVIEW_REQUIRED', 409);
        audited('TISS_FILL_INTENT', { planHash: plan.planHash, guideKey: plan.guideKey,
          targetHash: hash(JSON.stringify([body.targetId, body.expectedUrl])), state: 'RESULT_UNKNOWN_UNTIL_READBACK' });
        intent = true;
        const result = await browser.fill({ fields: plan.fields, expectedTargetId: body.targetId,
          expectedUrl: body.expectedUrl, planHash: plan.planHash });
        demand(['FILLED_DRAFT', 'NOT_FILLED', 'PARTIAL_REVIEW_REQUIRED', 'UNKNOWN_RESULT_REVIEW_REQUIRED'].includes(result?.state), 'TISS_BROWSER_RECEIPT_INVALID', 503);
        if (result.state !== 'UNKNOWN_RESULT_REVIEW_REQUIRED') {
          const count = Object.keys(plan.fields).length;
          demand(['changedCount', 'matchedCount', 'readbackCount'].every(key => Number.isSafeInteger(result[key]) && result[key] >= 0 && result[key] <= count) &&
            (result.state !== 'FILLED_DRAFT' || result.readbackCount === count), 'TISS_BROWSER_RECEIPT_INVALID', 503);
        }
        const receipt = { state: result.state, planHash: plan.planHash, guideKey: plan.guideKey,
          code: errorCode(result), fieldCount: Object.keys(plan.fields).length,
          changedCount: Number.isSafeInteger(result.changedCount) ? result.changedCount : null,
          matchedCount: Number.isSafeInteger(result.matchedCount) ? result.matchedCount : null,
          readbackCount: Number.isSafeInteger(result.readbackCount) ? result.readbackCount : null,
          submissionAttemptedByAdapter: false, portalPersistenceVerified: false,
          protocolVerified: false, paymentVerified: false,
          externalPortalEffects: 'INPUT_HANDLERS_REQUIRE_PORTAL_REVIEW', autoRetryAllowed: false };
        audited('TISS_FILL_RESULT', receipt);
        return { status: 200, value: receipt };
      } catch (error) {
        if (intent) {
          audited('TISS_FILL_RESULT', { planHash: plan.planHash, guideKey: plan.guideKey,
            state: 'UNCERTAIN_REQUIRES_REVIEW', code: errorCode(error), autoRetryAllowed: false });
          throw new TissError('TISS_FILL_UNCERTAIN_REVIEW_REQUIRED', 409);
        }
        throw error;
      } finally { if (release) release(); busy = false; }
    }
    throw new TissError('TISS_ROUTE_NOT_FOUND', 404);
  }
  function clear(caller) {
    inflight.delete(caller);
    for (const map of [analyses, plans]) for (const [key, entry] of map) if (entry.caller === caller) forget(map, key);
  }
  function dispose() {
    inflight.clear();
    for (const map of [analyses, plans]) for (const key of map.keys()) forget(map, key);
  }
  return { route, status, clear, dispose };
}
module.exports = { createTissTool, readTissConfiguration, runParser, TissError, TOOL_ID, VERSION, BODY_LIMIT, XML_LIMIT };
