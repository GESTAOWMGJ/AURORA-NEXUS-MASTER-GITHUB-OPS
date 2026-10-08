const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {sanitizeConnectorStatus} = require('./sanitize-connector-status.js');

const privateMarker = 'PRIVATE_SOURCE_VALUE_MUST_NOT_ESCAPE';
function complete() {
  return {response:{ok:true, code:'AURORA_CONNECTOR_STATUS_READ_COMPLETE', tenantConfigured:true,
    tenantMatches:true, configurationRead:true, configurationValid:true, endpointConfigured:true,
    hmacConfigured:true, mirrorRequired:true, dryRun:false, registryConfigured:true, registryValid:true,
    legacySourceSelected:false, sourceCount:1, reachableSourceCount:1, sourceAccessChecked:true,
    triggerRead:true, triggerCount:1, handlerCounts:{operational:1, legacyQueue:0, fiscal:0, watchdog:0, other:0},
    firstIngestionVerified:false, operationalReady:false}};
}
function errorRead() {
  return {response:{ok:false, code:'AURORA_CONNECTOR_STATUS_TENANT_MISMATCH', tenantConfigured:true,
    tenantMatches:false, configurationRead:false, configurationValid:false, endpointConfigured:false,
    hmacConfigured:false, mirrorRequired:false, dryRun:true, registryConfigured:false, registryValid:false,
    legacySourceSelected:false, sourceCount:null, reachableSourceCount:null, sourceAccessChecked:false,
    triggerRead:false, triggerCount:null, handlerCounts:{operational:null, legacyQueue:null, fiscal:null, watchdog:null, other:null},
    firstIngestionVerified:false, operationalReady:false}};
}
function cli(raw) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-status-output-'));
  const input = path.join(dir, privateMarker + '.json');
  try {
    fs.writeFileSync(input, raw);
    return spawnSync(process.execPath, [path.join(__dirname, 'sanitize-connector-status.js'), input], {encoding:'utf8'});
  } finally {fs.rmSync(dir, {recursive:true, force:true});}
}

test('sanitizer drops source identifiers, payloads, arbitrary handlers and envelope fields before stdout', () => {
  const input = complete();
  input.logs = privateMarker; input.response.checkedAt = privateMarker;
  input.response.sourceId = privateMarker; input.response.url = 'https://' + privateMarker;
  input.response.handlerCounts[privateMarker] = privateMarker;
  const run = cli(JSON.stringify(input));
  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.ok(!run.stdout.includes(privateMarker));
  assert.deepEqual(JSON.parse(run.stdout), sanitizeConnectorStatus(complete()));
});

test('negative tenant read is preserved as unknown counts rather than false operational proof', () => {
  const r = sanitizeConnectorStatus(errorRead());
  assert.equal(r.ok, false); assert.equal(r.tenantMatches, false);
  assert.equal(r.sourceCount, null); assert.equal(r.handlerCounts.operational, null);
  assert.equal(r.firstIngestionVerified, false); assert.equal(r.operationalReady, false);
});

test('malformed envelopes and private values in known fields emit one fixed error and no stdout', () => {
  const bad = [privateMarker, JSON.stringify({response:null}), JSON.stringify({response:{code:privateMarker}})];
  const arbitraryCode = complete(); arbitraryCode.response.code = 'AURORA_CONNECTOR_STATUS_' + privateMarker;
  bad.push(JSON.stringify(arbitraryCode));
  const privateFlag = complete(); privateFlag.response.hmacConfigured = privateMarker;
  bad.push(JSON.stringify(privateFlag));
  const apiError = complete(); apiError.error = {message:privateMarker}; bad.push(JSON.stringify(apiError));
  for (const raw of bad) {
    const run = cli(raw);
    assert.equal(run.status, 1); assert.equal(run.stdout, '');
    assert.equal(run.stderr, 'AURORA_CONNECTOR_STATUS_OUTPUT_REJECTED\n');
  }
});

test('counts are bounded numeric observations with consistent source and trigger totals', () => {
  const mutations = [r => {r.sourceCount=13;}, r => {r.reachableSourceCount=2;},
    r => {r.sourceCount='1';}, r => {r.handlerCounts.operational=2;},
    r => {r.triggerCount=101;}, r => {r.handlerCounts.other=-1;},
    r => {r.registryValid=false;}, r => {r.sourceAccessChecked=false;}, r => {r.triggerRead=false;}];
  for (const mutate of mutations) {
    const input = complete(); mutate(input.response);
    assert.throws(() => sanitizeConnectorStatus(input), /^Error: AURORA_CONNECTOR_STATUS_OUTPUT_REJECTED$/);
  }
});

test('read-only status cannot be converted into ingestion or installation acceptance', () => {
  for (const key of ['firstIngestionVerified', 'operationalReady']) {
    const input = complete(); input.response[key] = true;
    assert.throws(() => sanitizeConnectorStatus(input), /OUTPUT_REJECTED/);
  }
  const input = complete(); input.response.ok = false;
  assert.throws(() => sanitizeConnectorStatus(input), /OUTPUT_REJECTED/);
  const foreign = complete(); foreign.response.tenantMatches = false;
  assert.throws(() => sanitizeConnectorStatus(foreign), /OUTPUT_REJECTED/);
});

test('large unexpected responses are rejected without reading their private body into logs', () => {
  const run = cli(privateMarker.repeat(3000));
  assert.equal(run.status, 1); assert.equal(run.stdout, '');
  assert.equal(run.stderr, 'AURORA_CONNECTOR_STATUS_OUTPUT_REJECTED\n');
});

test('deploy status logs and artifact select only the sanitized output, not raw execution JSON', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-appscript.yml'), 'utf8');
  const status = workflow.match(/      - name: Read authorized connector binding without operational activation\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(status);
  assert.ok(status.includes('auroraLerStatusConectoresPlugAndPlay'));
  assert.ok(status.includes('sanitize-connector-status.js'));
  assert.ok(!/cat[^\n]*raw\.json/.test(status));
  assert.ok(!/auroraConfigurar|instalarGatilho|auroraRc11Ativar|auroraRc11Enviar/.test(status));
  const artifact = workflow.match(/      - name: Preserve sanitized connector status\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(artifact.includes('path: ${{ runner.temp }}/connector-status.json'));
  assert.ok(!artifact.includes('raw.json') && !artifact.includes('*.json') && !artifact.includes('build-appscript'));
});
