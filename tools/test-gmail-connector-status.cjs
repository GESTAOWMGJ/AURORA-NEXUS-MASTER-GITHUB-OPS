const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const privateMarker = 'private-source-marker';
function source(id = 'private-folder-one', overrides = {}) {
  return {sourceId:privateMarker, system:'DRIVE', mode:'DRIVE_FOLDER', folderId:id,
    folderName:privateMarker, slaMinutes:1440, active:true, ...overrides};
}
function fixture(sources = [source()]) {
  const calls = [], props = new Map([
    ['WMGJ_FIRESTORE_ORG_ID', 'synthetic'],
    ['WMGJ_FIRESTORE_INGEST_URL', 'https://private.example/ingestWmgjEvent'],
    ['WMGJ_FIRESTORE_HMAC_KEY_ID', privateMarker],
    ['WMGJ_FIRESTORE_HMAC_SECRET', 'd'.repeat(64)],
    ['WMGJ_FIRESTORE_DRY_RUN', 'false'],
    ['AURORA_FIRESTORE_MIRROR_REQUIRED', 'true'],
    ['AURORA_DOCUMENT_SOURCE_REGISTRY', JSON.stringify(sources)],
    ['WMGJ_PASTA_ENTRADA_ID', 'private-legacy-folder']
  ]);
  const write = () => {calls.push('MUTATION'); throw Error('read-only status attempted a mutation');};
  const context = vm.createContext({
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => {calls.push('property:' + key); return props.get(key);},
      setProperties:write, setProperty:write, deleteProperty:write
    })},
    DriveApp: {getFolderById: id => {
      calls.push('folder:' + id);
      return {getFiles:write, getName:write, getId:write, createFile:write};
    }},
    ScriptApp: {getProjectTriggers: () => {
      calls.push('triggers');
      return ['executarAutomacaoOperacionalWMGJ', 'executarAutomacaoOperacionalWMGJ',
        'jobProcessarFilaWMGJ', 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ',
        'executarAutomacaoWMGJBlindada', privateMarker].map(handler => ({
          getHandlerFunction: () => handler, getUniqueId:write, deleteTrigger:write
        }));
    }, newTrigger:write, deleteTrigger:write},
    SpreadsheetApp: {openById:write, getActiveSpreadsheet:write},
    UrlFetchApp: {fetch:write}, Logger:{log:write},
    registrarLogWMGJ_:write, auroraConnectorLogSafe_:write,
    prepararPipelineConfiavelWMGJ_V3:write, executarAutomacaoOperacionalWMGJ:write
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'), 'utf8'), context);
  return {c:context, calls, props};
}
function safeOutput(result) {
  const json = JSON.stringify(result);
  for (const value of [privateMarker, 'private-folder', 'private-legacy-folder', 'synthetic', 'private.example', 'd'.repeat(64)]) {
    assert.ok(!json.includes(value), 'private configuration escaped status result');
  }
  assert.equal(result.firstIngestionVerified, false);
  assert.equal(result.operationalReady, false);
}

test('public connector status reads bounded metadata and emits only flags and known-handler counts', () => {
  const {c, calls} = fixture([source(), source('private-folder-two', {sourceId:'source-two', system:'ERP'})]);
  assert.equal(typeof c.auroraLerStatusConectoresPlugAndPlay, 'function');
  const r = c.auroraLerStatusConectoresPlugAndPlay('synthetic');
  assert.equal(r.ok, true);
  assert.equal(r.configurationValid, true);
  assert.equal(r.tenantMatches, true);
  assert.equal(r.sourceCount, 2);
  assert.equal(r.reachableSourceCount, 2);
  assert.equal(r.triggerCount, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(r.handlerCounts)), {operational:2, legacyQueue:1, fiscal:1, watchdog:1, other:1});
  assert.equal(calls.filter(call => call.startsWith('folder:')).length, 2);
  assert.ok(!calls.includes('MUTATION'));
  safeOutput(r);
});

test('invalid expected tenant never reads configuration or reaches a source', () => {
  const {c, calls} = fixture();
  for (const input of [undefined, null, {}, 'SYnthetic', 'x', 'synthetic/foreign', ['synthetic']]) {
    const r = c.auroraLerStatusConectoresPlugAndPlay(input);
    assert.equal(r.code, 'AURORA_CONNECTOR_STATUS_TENANT_INVALID');
    safeOutput(r);
  }
  assert.equal(calls.length, 0);
});

test('foreign or unbound tenant stops before secrets, registry, source or trigger reads', () => {
  for (const binding of ['foreign', '', 'foreign/tenant']) {
    const {c, calls, props} = fixture(); props.set('WMGJ_FIRESTORE_ORG_ID', binding);
    const r = c.auroraLerStatusConectoresPlugAndPlay('synthetic');
    assert.equal(r.code, 'AURORA_CONNECTOR_STATUS_TENANT_MISMATCH');
    assert.equal(r.tenantMatches, false);
    assert.deepEqual(calls, ['property:WMGJ_FIRESTORE_ORG_ID']);
    assert.equal(r.sourceCount, null);
    safeOutput(r);
  }
});

test('malformed registries never silently fall back to a different source', () => {
  const invalid = ['{' + privateMarker, '{}', '[null]', '[false]', JSON.stringify([source(), source()]),
    JSON.stringify([source('bad-id')]), JSON.stringify([source(undefined, {mode:'API'})]),
    JSON.stringify([source(undefined, {slaMinutes:0})]), JSON.stringify([source(undefined, {active:'false'})]),
    JSON.stringify(Array.from({length:13}, (_, i) => source('private-folder-' + i, {sourceId:'source-' + i})))];
  for (const raw of invalid) {
    const {c, calls, props} = fixture(); props.set('AURORA_DOCUMENT_SOURCE_REGISTRY', raw);
    const r = c.auroraLerStatusConectoresPlugAndPlay('synthetic');
    assert.equal(r.code, 'AURORA_CONNECTOR_STATUS_REGISTRY_INVALID');
    assert.equal(r.registryValid, false);
    assert.ok(!calls.some(call => call.startsWith('folder:') || call === 'triggers'));
    safeOutput(r);
  }
});

test('existing legacy fallback is counted only when registry is absent or empty', () => {
  for (const raw of [undefined, '[]']) {
    const {c, props} = fixture(); props.set('AURORA_DOCUMENT_SOURCE_REGISTRY', raw);
    const r = c.auroraLerStatusConectoresPlugAndPlay('synthetic');
    assert.equal(r.sourceCount, 1);
    assert.equal(r.legacySourceSelected, true);
    safeOutput(r);
  }
  const {c, props} = fixture([source(undefined, {active:false})]);
  const r = c.auroraLerStatusConectoresPlugAndPlay('synthetic');
  assert.equal(r.sourceCount, 0);
  assert.equal(r.legacySourceSelected, false);
  props.delete('AURORA_DOCUMENT_SOURCE_REGISTRY'); props.delete('WMGJ_PASTA_ENTRADA_ID');
  assert.equal(c.auroraLerStatusConectoresPlugAndPlay('synthetic').sourceCount, 0);
});

test('inaccessible folders yield partial reachability without raw errors or content reads', () => {
  const {c, calls} = fixture([source(), source('private-folder-two', {sourceId:'source-two'})]);
  c.DriveApp.getFolderById = id => {calls.push('folder:' + id); if (id.endsWith('two')) throw Error(privateMarker); return {};};
  const r = c.auroraLerStatusConectoresPlugAndPlay('synthetic');
  assert.equal(r.ok, true); // Status read completed, independent of operational readiness.
  assert.equal(r.sourceAccessChecked, true);
  assert.equal(r.reachableSourceCount, 1);
  safeOutput(r);
});

test('configuration, registry and trigger read errors are sanitized and remain unverified', () => {
  const first = fixture();
  first.c.PropertiesService.getScriptProperties = () => {throw Error(privateMarker);};
  const config = first.c.auroraLerStatusConectoresPlugAndPlay('synthetic');
  assert.equal(config.code, 'AURORA_CONNECTOR_STATUS_CONFIG_READ_FAILED');
  assert.equal(config.configurationRead, false); safeOutput(config);
  const second = fixture();
  second.c.PropertiesService.getScriptProperties = () => ({getProperty: key => {
    if (key === 'AURORA_DOCUMENT_SOURCE_REGISTRY') throw Error(privateMarker);
    return second.props.get(key);
  }});
  const registry = second.c.auroraLerStatusConectoresPlugAndPlay('synthetic');
  assert.equal(registry.code, 'AURORA_CONNECTOR_STATUS_REGISTRY_INVALID'); safeOutput(registry);
  const third = fixture();
  third.c.ScriptApp.getProjectTriggers = () => [{getHandlerFunction: () => 'executarAutomacaoOperacionalWMGJ'},
    {getHandlerFunction: () => {throw Error(privateMarker);}}];
  const triggers = third.c.auroraLerStatusConectoresPlugAndPlay('synthetic');
  assert.equal(triggers.code, 'AURORA_CONNECTOR_STATUS_TRIGGER_READ_FAILED');
  assert.equal(triggers.triggerRead, false);
  assert.equal(triggers.handlerCounts.operational, null); safeOutput(triggers);
});

test('invalid configuration and unavailable Drive service cannot imply verified ingestion', () => {
  const {c, props} = fixture(); props.set('WMGJ_FIRESTORE_HMAC_SECRET', privateMarker);
  props.set('AURORA_FIRESTORE_MIRROR_REQUIRED', 'invalid');
  const invalid = c.auroraLerStatusConectoresPlugAndPlay('synthetic');
  assert.equal(invalid.configurationValid, false);
  assert.equal(invalid.hmacConfigured, false); safeOutput(invalid);
  delete c.DriveApp;
  const unavailable = c.auroraLerStatusConectoresPlugAndPlay('synthetic');
  assert.equal(unavailable.code, 'AURORA_CONNECTOR_STATUS_SOURCE_ACCESS_UNAVAILABLE');
  assert.equal(unavailable.sourceAccessChecked, false);
  assert.equal(unavailable.reachableSourceCount, null); safeOutput(unavailable);
});