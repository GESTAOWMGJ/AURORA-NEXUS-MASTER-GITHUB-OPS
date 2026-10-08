const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Execute the real Apps Script orchestration with isolated service fixtures.
// No Google calls, deployed trigger, business source or runtime acceptance.
function fixture(required = true) {
  const calls = [], props = new Map([['WMGJ_FIRESTORE_ORG_ID', 'synthetic'],
    ['AURORA_FIRESTORE_MIRROR_REQUIRED', String(required)]]);
  let owned = false, busy = false;
  const lock = {hasLock: () => owned, tryLock: () => {
    calls.push('lock'); if (busy) return false; owned = true; return true;
  }, releaseLock: () => {calls.push('unlock'); owned = false;}};
  const c = vm.createContext({
    PropertiesService: {getScriptProperties: () => ({
      getProperty: name => props.get(name),
      setProperties: values => {calls.push('configure'); for (const [key, value] of Object.entries(values)) props.set(key, value);}
    })},
    LockService: {getScriptLock: () => lock},
    SpreadsheetApp: {flush: () => calls.push('flush'), openById: () => ({getId: () => 'synthetic-sheet'})},
    DriveApp: {getFolderById: () => {calls.push('scope'); return {getName: () => 'synthetic-export'};}},
    ScriptApp: {newTrigger: handler => {
      calls.push('trigger:' + handler);
      return {timeBased() {return this;}, everyMinutes(n) {calls.push('cadence:' + n); return this;},
        create() {calls.push('create-trigger'); return {};}};
    }},
    Logger: {log() {}},
    prepararPipelineConfiavelWMGJ_V3: limit => {calls.push('prepare:' + limit); return {ok:true};},
    processarFilaWMGJ_V3: limit => {calls.push('v3:' + limit); return {ok:true, processados:1};},
    processarFilaComExtracaoRealWMGJ_V1: limit => {calls.push('mirror:' + limit); return {ok:true, processados:1, erros:0, revisar:0};},
    executarRoboGmailDashboardWMGJ: () => {calls.push('existing-robot'); return {ok:true};}
  });
  for (const name of ['09D_REPLAY_MENSAGEM_GMAIL_WMGJ.gs', '06_AUTOMACAO_APPSCRIPT_WMGJ.gs', '37_AURORA_CONECTORES_PLUG_AND_PLAY.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8'), c, {filename:name});
  }
  c.registrarStatusAutomacaoWMGJ_ = () => {};
  c.registrarLogAutomacaoWMGJ_ = () => {};
  c.auditarOrganizarAppsScriptWMGJ = () => ({});
  c.removerGatilhosAutomacaoWMGJ_ = () => [];
  c.auroraConnectorLogSafe_ = () => {};
  return {c, calls, props, busy(value) {busy=value;}};
}

function config(activate) {
  return {orgId:'synthetic', driveFolderId:'synthetic-folder',
    firestoreIngestUrl:'https://auroranexus.com.br/api/fixture',
    firestoreHmacKeyId:'synthetic-key', firestoreHmacSecret:'a'.repeat(64), activate};
}

test('required mirror uses the real extraction queue instead of consuming V3 memory first', () => {
  const {c, calls} = fixture();
  assert.equal(c.executarAutomacaoOperacionalWMGJ().ok, true);
  assert.ok(calls.includes('prepare:100'));
  assert.ok(calls.includes('mirror:20'));
  assert.ok(!calls.some(call => call.startsWith('v3:')));
  assert.ok(calls.indexOf('prepare:100') < calls.indexOf('mirror:20'));
  assert.ok(calls.indexOf('mirror:20') < calls.indexOf('existing-robot'));
});

test('optional mirror preserves the existing V3 path', () => {
  const {c, calls} = fixture(false);
  assert.equal(c.executarAutomacaoOperacionalWMGJ().ok, true);
  assert.ok(calls.includes('v3:20'));
  assert.ok(!calls.some(call => call.startsWith('mirror:')));
});

test('missing required extractor never falls back to local memory', () => {
  const {c, calls} = fixture();
  delete c.processarFilaComExtracaoRealWMGJ_V1;
  const result = c.executarAutomacaoOperacionalWMGJ();
  assert.equal(result.ok, false);
  assert.equal(result.erro, 'AURORA_DOCUMENT_EXTRACTOR_MISSING');
  assert.ok(!calls.some(call => call.startsWith('v3:') || call === 'existing-robot'));
  assert.equal(calls.filter(call => call === 'unlock').length, 1);
});

test('authorized activation starts exactly one bounded pass on the existing trigger', () => {
  const {c, calls} = fixture();
  const result = c.auroraConfigurarConectoresPlugAndPlay(config(true));
  assert.equal(result.triggerInstalled, true);
  assert.equal(calls.filter(call => call === 'create-trigger').length, 1);
  assert.ok(calls.includes('trigger:executarAutomacaoOperacionalWMGJ'));
  assert.ok(calls.includes('cadence:15'));
  assert.equal(calls.filter(call => call === 'prepare:5').length, 1);
  assert.equal(calls.filter(call => call === 'mirror:5').length, 1);
  assert.ok(calls.indexOf('configure') < calls.indexOf('prepare:5'));
  assert.ok(calls.indexOf('prepare:5') < calls.indexOf('mirror:5'));
  assert.ok(!calls.includes('existing-robot')); // No broad Gmail/financial run during setup.
  assert.equal(calls.filter(call => call === 'lock').length, 1); // Shared lock is borrowed, not reacquired.
  assert.equal(calls.filter(call => call === 'unlock').length, 1);
  assert.equal(result.firstCycle.processedDocuments, 1);
  assert.equal(result.firstCycle.limit, 5);
  assert.equal(result.firstCycle.state, 'PENDING_CANONICAL_READBACK');
  assert.equal(result.firstIngestionVerified, false);
  assert.equal(result.operationalReady, false);
});

test('configuration without activation reads no contents and creates no trigger', () => {
  const {c, calls} = fixture();
  const result = c.auroraConfigurarConectoresPlugAndPlay(config(false));
  assert.equal(result.firstCycle, null);
  assert.equal(result.triggerInstalled, false);
  assert.ok(!calls.some(call => /^(prepare:|mirror:|v3:|trigger:)/.test(call)));
});

test('a foreign tenant cannot overwrite the existing source registry', () => {
  const {c, calls, props} = fixture();
  assert.throws(() => c.auroraConfigurarConectoresPlugAndPlay({...config(true), orgId:'foreign'}),
    /AURORA_CONNECTOR_TENANT_REBINDING_REJECTED/);
  assert.equal(props.get('WMGJ_FIRESTORE_ORG_ID'), 'synthetic');
  assert.ok(!calls.includes('configure') && !calls.includes('scope') && !calls.includes('create-trigger'));
});

test('missing activation dependencies block before configuration or scheduling', () => {
  const {c, calls} = fixture();
  delete c.processarFilaComExtracaoRealWMGJ_V1;
  assert.throws(() => c.auroraConfigurarConectoresPlugAndPlay(config(true)), /AURORA_DOCUMENT_EXECUTOR_MISSING/);
  assert.ok(!calls.includes('configure') && !calls.includes('create-trigger'));
});

test('contention keeps the first pass pending without touching its queue', () => {
  const {c, calls, busy} = fixture(); busy(true);
  const result = c.auroraConfigurarConectoresPlugAndPlay(config(true));
  assert.equal(result.firstCycle.ok, false);
  assert.equal(result.firstCycle.code, 'GMAIL_REPLAY_LOCK_BUSY');
  assert.equal(result.firstIngestionVerified, false);
  assert.ok(!calls.some(call => /^(prepare:|mirror:|v3:)/.test(call)));
});

test('source preparation failure preserves pending status and skips extraction', () => {
  const {c, calls} = fixture();
  c.prepararPipelineConfiavelWMGJ_V3 = () => ({ok:false});
  const result = c.auroraConfigurarConectoresPlugAndPlay(config(true));
  assert.equal(result.firstCycle.code, 'AURORA_DOCUMENT_SOURCE_PENDING');
  assert.ok(!calls.some(call => /^(mirror:|v3:)/.test(call)));
});

test('an unconfirmed trigger never claims continuous extraction or starts the first pass', () => {
  const {c, calls} = fixture();
  c.instalarGatilhoAutomacaoWMGJ = () => ({ok:false});
  const result = c.auroraConfigurarConectoresPlugAndPlay(config(true));
  assert.equal(result.continuousExtraction, false);
  assert.equal(result.triggerInstalled, false);
  assert.equal(result.firstCycle.code, 'AURORA_DOCUMENT_TRIGGER_PENDING');
  assert.ok(!calls.some(call => /^(prepare:|mirror:|v3:)/.test(call)));
});

test('extraction failure is bounded and sanitized instead of implying cloud completion', () => {
  const {c, calls} = fixture();
  c.processarFilaComExtracaoRealWMGJ_V1 = () => {throw Error('private transport response');};
  const result = c.auroraConfigurarConectoresPlugAndPlay(config(true));
  assert.equal(result.firstCycle.code, 'AURORA_DOCUMENT_INITIAL_CYCLE_PENDING');
  assert.equal(result.firstCycle.firstIngestionVerified, false);
  assert.ok(!JSON.stringify(result).includes('private transport response'));
  assert.equal(calls.filter(call => call === 'unlock').length, 1);
});

test('partial review and empty queue remain pending canonical readback', () => {
  for (const counts of [{processados:0, erros:0, revisar:0}, {processados:1, erros:0, revisar:1}]) {
    const {c} = fixture();
    c.processarFilaComExtracaoRealWMGJ_V1 = () => ({ok:true, ...counts});
    const result = c.auroraConfigurarConectoresPlugAndPlay(config(true));
    assert.equal(result.firstCycle.ok, counts.revisar === 0);
    assert.equal(result.operationalReady, false);
    assert.equal(result.firstCycle.firstIngestionVerified, false);
  }
});

test('document processing limits reject unbounded or invalid input before execution', () => {
  const {c, calls} = fixture();
  for (const value of [0, 21, -1, Infinity, 1.5, '5', undefined]) {
    assert.throws(() => c.processarFilaFonteCanonicaWMGJ_(value), /AURORA_DOCUMENT_LIMIT_INVALID/);
  }
  assert.ok(!calls.some(call => /^(lock|mirror:|v3:)/.test(call)));
});
