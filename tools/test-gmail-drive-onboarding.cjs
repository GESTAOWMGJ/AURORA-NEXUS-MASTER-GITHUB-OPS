const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

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

test('dedicated exact-scope Drive collector prevents duplicate Drive work while preserving Gmail/dashboard automation', () => {
  const {c, calls, props} = fixture();
  props.set('AURORA_CONTINUOUS_DRIVE_DECISION','AURORA-HML-CONTINUOUS-DRIVE-20261026');
  c.executarRoboGmailDashboardWMGJ = options => {
    assert.equal(options.executarPipelineDocumental,false);
    calls.push('existing-robot');
    return {ok:true};
  };
  const result=c.executarAutomacaoOperacionalWMGJ();
  assert.equal(result.ok,true);assert.equal(result.driveCollectorDelegated,true);
  assert.equal(result.preparo.code,'AURORA_CONTINUOUS_DRIVE_DELEGATED');
  assert.equal(result.processamento.code,'AURORA_CONTINUOUS_DRIVE_DELEGATED');
  assert.ok(calls.includes('existing-robot'));
  assert.ok(!calls.some(call => /^(prepare:|mirror:|v3:)/.test(call)));
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

const reuseFolder = '1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-';
const reuseHash = value => crypto.createHash('sha256').update(value).digest('hex');
function reuseFixture(options = {}) {
  const calls = [], props = new Map([
    ['WMGJ_FIRESTORE_ORG_ID','wmgj'],
    ['WMGJ_FIRESTORE_INGEST_URL','https://southamerica-east1-wmgj-hml-jfn-20260927.cloudfunctions.net/ingestWmgjEvent'],
    ['WMGJ_FIRESTORE_HMAC_KEY_ID','synthetic-existing-key'],['WMGJ_FIRESTORE_HMAC_SECRET','e'.repeat(64)],
    ['WMGJ_FIRESTORE_DRY_RUN','true'],['AURORA_FIRESTORE_MIRROR_REQUIRED','false']
  ]);
  let now = options.now ?? Date.parse('2026-10-15T01:00:00Z'), metadataHook = null, writeHook = null;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const forbidden = () => {calls.push('FORBIDDEN'); throw Error('private-content-or-command');};
  const context = vm.createContext({Date:Clock,Number,JSON,
    Session:{getActiveUser:()=>({getEmail:()=>options.active ?? 'owner@fixture.invalid'}),
      getEffectiveUser:()=>({getEmail:()=>options.effective ?? 'owner@fixture.invalid'})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
      computeDigest:(_,value)=>[...crypto.createHash('sha256').update(String(value)).digest()]},
    PropertiesService:{getScriptProperties:()=>({
      getProperty:key=>{calls.push('read:'+key); return props.get(key) ?? null;},
      setProperties:values=>{calls.push('configure'); if(writeHook) return writeHook(values);
        for(const [key,value]of Object.entries(values)) props.set(key,value);},
      setProperty:(key,value)=>{calls.push('restore:'+key); props.set(key,value);},
      deleteProperty:key=>{calls.push('delete:'+key); props.delete(key);}
    })},
    LockService:{getScriptLock:()=>({tryLock:()=>{calls.push('lock');return !options.busy;},releaseLock:()=>calls.push('unlock')})},
    getConfigWMGJ_:()=>({PASTA_ENTRADA_ID:options.legacyFolder ?? reuseFolder}),
    DriveApp:{getFolderById:id=>{calls.push('metadata'); assert.equal(id,reuseFolder); if(metadataHook)metadataHook();
      return {getId:()=>id,getName:forbidden,getFiles:forbidden,createFile:forbidden};}},
    ScriptApp:{getProjectTriggers:()=>{calls.push('trigger-metadata');return (options.handlers??[]).map(name=>({getHandlerFunction:()=>name,getUniqueId:forbidden}));},
      newTrigger:forbidden,deleteTrigger:forbidden},
    UrlFetchApp:{fetch:forbidden},SpreadsheetApp:{openById:forbidden},Logger:{log:forbidden},
    prepararPipelineConfiavelWMGJ_V3:forbidden,processarFilaComExtracaoRealWMGJ_V1:forbidden,
    instalarGatilhoAutomacaoWMGJ:forbidden,auroraConnectorLogSafe_:forbidden
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src','37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'utf8'),context);
  context.AURORA_CONNECTOR_REUSE_OWNER_HASH=reuseHash('owner@fixture.invalid');
  const request=(mode='PREVIEW',expected=null)=>({confirmation:'REUSE_EXISTING_WMGJ_SOURCE_CONFIG_ONLY',configOnly:true,mode,
    orgId:'wmgj',expectedFolderId:reuseFolder,expectedSourceId:'drive-primary',expectedSlaMinutes:1440,expectedConfigurationSha256:expected});
  const execute=input=>JSON.parse(JSON.stringify(context.auroraReaproveitarFonteWmgjConfigOnly(input??request())));
  return {c:context,calls,props,request,execute,onMetadata(fn){metadataHook=fn;},onWrite(fn){writeHook=fn;},at(value){now=Date.parse(value);},expire(){now=Date.parse(context.AURORA_CONNECTOR_REUSE_DEADLINE);}};
}
function assertReuseSafe(f,result) {
  assert.equal(result.operationalReady,false); assert.equal(result.installationComplete,false);
  assert.equal(result.firstIngestionVerified,false); assert.equal(result.providerConsentVerified,false);
  assert.equal(result.contentRead,false); assert.equal(result.triggersChanged,false); assert.equal(result.complete,false);
  assert.ok(!f.calls.includes('FORBIDDEN'));
  for(const privateValue of [reuseFolder,'synthetic-existing-key','e'.repeat(64),'owner@fixture.invalid','private-content-or-command']) {
    assert.ok(!JSON.stringify(result).includes(privateValue));
  }
}
function configureReuse(f) { return f.execute(f.request('CONFIGURE',f.execute().configurationSha256)); }

test('reuse PREVIEW identifies the existing legacy source as inactive without configuration or content reads',()=>{
  const f=reuseFixture(),before=[...f.props],r=f.execute();
  assert.equal(r.ok,true);assert.equal(r.state,'SOURCE_IDENTIFIED');assert.equal(r.sourceActive,false);
  assert.equal(r.configurationWriteEligible,true);assert.match(r.configurationSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual([...f.props],before);assert.equal(f.calls.filter(x=>x==='metadata').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.c.auroraFontesDocumentaisConfiguradas_())),[]);
  assertReuseSafe(f,r);
});
test('reuse CONFIGURE commits only an inactive registry and version marker, preserving credentials and runtime flags',()=>{
  const f=reuseFixture(),before=new Map(f.props),r=configureReuse(f);
  assert.equal(r.ok,true);assert.equal(r.state,'CONFIGURED_INACTIVE');assert.equal(r.configurationChanged,true);
  const sources=JSON.parse(f.props.get('AURORA_DOCUMENT_SOURCE_REGISTRY'));
  assert.equal(sources.length,1);assert.equal(sources[0].active,false);assert.equal(sources[0].folderId,reuseFolder);
  for(const [key,value]of before)assert.equal(f.props.get(key),value);
  assert.deepEqual([...f.props.keys()].filter(key=>!before.has(key)).sort(),['AURORA_CONNECTOR_SETUP_VERSION','AURORA_DOCUMENT_SOURCE_REGISTRY']);
  assert.equal(f.c.auroraFontesDocumentaisConfiguradas_().length,0);
  assert.equal(configureReuse(f).configurationChanged,false);assert.equal(f.calls.filter(x=>x==='configure').length,1);assertReuseSafe(f,r);
});
test('reuse endpoint honors a valid inactive registry before an incompatible legacy getter and preserves its bytes',()=>{
  const f=reuseFixture(),registry=JSON.stringify([{folderName:'retained private metadata',active:false,slaMinutes:1440,
    folderId:reuseFolder,mode:'DRIVE_FOLDER',system:'DRIVE',sourceId:'drive-primary'}],null,2);
  f.props.set('AURORA_DOCUMENT_SOURCE_REGISTRY',registry);
  f.c.getConfigWMGJ_=()=>{throw Error('forbidden legacy fallback');};
  const preview=f.execute();assert.equal(preview.ok,true);assert.equal(preview.sourceActive,false);
  const r=f.execute(f.request('CONFIGURE',preview.configurationSha256));
  assert.equal(r.ok,true);assert.equal(r.state,'CONFIGURED_INACTIVE');assert.equal(f.props.get('AURORA_DOCUMENT_SOURCE_REGISTRY'),registry);
  assert.equal(configureReuse(f).configurationChanged,false);assertReuseSafe(f,r);
});
test('reuse endpoint honors an explicitly configured Properties source without invoking legacy fallback',()=>{
  const f=reuseFixture();f.props.set('WMGJ_PASTA_ENTRADA_ID',reuseFolder);
  f.c.getConfigWMGJ_=()=>{throw Error('forbidden legacy fallback');};
  const r=f.execute();assert.equal(r.ok,true);assert.equal(r.sourceActive,true);
  assert.equal(configureReuse(f).code,'AURORA_CONNECTOR_REUSE_ACTIVE_STATE_REQUIRES_REVIEW');assert.ok(!f.calls.includes('configure'));assertReuseSafe(f,r);
});
test('reuse owner and tenant failures precede all private configuration and source reads',()=>{
  for(const options of [{active:''},{effective:''},{active:'foreign@fixture.invalid'},{active:'foreign@fixture.invalid',effective:'foreign@fixture.invalid'}]){
    const f=reuseFixture(options),r=f.execute();assert.equal(r.code,'AURORA_CONNECTOR_REUSE_OWNER_REQUIRED');assert.deepEqual(f.calls,[]);assertReuseSafe(f,r);
  }
  const f=reuseFixture();f.props.set('WMGJ_FIRESTORE_ORG_ID','foreign');const r=f.execute();
  assert.equal(r.code,'AURORA_CONNECTOR_REUSE_TENANT_MISMATCH');
  assert.deepEqual(f.calls,['lock','read:WMGJ_FIRESTORE_ORG_ID','unlock']);assertReuseSafe(f,r);
});
test('reuse accepts no activation, arbitrary source, tenant, destination, secret or extra request field',()=>{
  for(const change of [r=>r.configOnly=false,r=>r.activate=true,r=>r.orgId='foreign',r=>r.expectedFolderId='foreign-folder',
    r=>r.expectedSourceId='other',r=>r.firestoreHmacSecret='f'.repeat(64),r=>r.dryRun=false,r=>r.expectedConfigurationSha256='a'.repeat(64)]){
    const f=reuseFixture(),input=f.request();change(input);const r=f.execute(input);
    assert.equal(r.code,'AURORA_CONNECTOR_REUSE_REQUEST_REJECTED');assert.deepEqual(f.calls,[]);assertReuseSafe(f,r);
  }
});
test('reuse malformed or conflicting registry never falls back or writes',()=>{
  for(const raw of ['{','{}','[null]',JSON.stringify([{sourceId:'drive-primary',system:'DRIVE',mode:'DRIVE_FOLDER',folderId:reuseFolder,slaMinutes:1440,active:false,extra:true}])]){
    const f=reuseFixture();f.props.set('AURORA_DOCUMENT_SOURCE_REGISTRY',raw);const r=f.execute();
    assert.equal(r.code,'AURORA_CONNECTOR_REUSE_REGISTRY_INVALID');assert.ok(!f.calls.includes('metadata'));assertReuseSafe(f,r);
  }
  const f=reuseFixture();f.props.set('WMGJ_PASTA_ENTRADA_ID','foreign-folder');const before=[...f.props],r=f.execute();
  assert.equal(r.code,'AURORA_CONNECTOR_REUSE_SOURCE_CONFLICT');assert.deepEqual([...f.props],before);assertReuseSafe(f,r);
});
test('reuse preserves and rejects already active sources, live flags or any unreconciled trigger',()=>{
  for(const setup of [f=>f.props.set('WMGJ_PASTA_ENTRADA_ID',reuseFolder),f=>f.props.set('WMGJ_FIRESTORE_DRY_RUN','false'),
    f=>f.props.set('AURORA_FIRESTORE_MIRROR_REQUIRED','true')]){
    const f=reuseFixture();setup(f);const before=[...f.props],r=configureReuse(f);
    assert.equal(r.code,'AURORA_CONNECTOR_REUSE_ACTIVE_STATE_REQUIRES_REVIEW');assert.deepEqual([...f.props],before);assertReuseSafe(f,r);
  }
  for(const handler of ['executarAutomacaoOperacionalWMGJ','unknownExistingHandler']){
    const f=reuseFixture({handlers:[handler]}),preview=f.execute(),r=f.execute(f.request('CONFIGURE',preview.configurationSha256));
    assert.equal(preview.state,'PENDING_TRIGGER_REVIEW');assert.equal(preview.triggerCount,1);
    assert.deepEqual(preview.handlerHashes,[reuseHash(handler)]);assert.equal(preview.configurationWriteEligible,false);
    assert.equal(r.code,'AURORA_CONNECTOR_REUSE_ACTIVE_STATE_REQUIRES_REVIEW');assert.ok(!f.calls.includes('configure'));assertReuseSafe(f,r);
  }
});
test('reuse bounds trigger metadata and never exports names, IDs, code or arguments',()=>{
  for(const handlers of [Array(13).fill('existingHandler'),['private invalid handler!']]){
    const f=reuseFixture({handlers}),r=f.execute();assert.equal(r.code,'AURORA_CONNECTOR_REUSE_TRIGGER_REVIEW_REQUIRED');
    assert.equal(r.ok,false);assert.equal(r.configurationChanged,false);assertReuseSafe(f,r);
  }
});
test('reuse lock contention and stale or concurrently changed configuration cannot write',()=>{
  const busy=reuseFixture({busy:true}),blocked=busy.execute();assert.equal(blocked.code,'AURORA_CONNECTOR_REUSE_LOCK_BUSY');assert.deepEqual(busy.calls,['lock']);
  const stale=reuseFixture(),hash=stale.execute().configurationSha256;stale.props.set('WMGJ_FIRESTORE_HMAC_KEY_ID','changed-existing-key');
  assert.equal(stale.execute(stale.request('CONFIGURE',hash)).code,'AURORA_CONNECTOR_REUSE_CAS_CONFLICT');assert.ok(!stale.calls.includes('configure'));
  const f=reuseFixture(),request=f.request('CONFIGURE',f.execute().configurationSha256);
  f.onMetadata(()=>f.props.set('WMGJ_FIRESTORE_HMAC_KEY_ID','changed-existing-key'));
  const r=f.execute(request);assert.equal(r.code,'AURORA_CONNECTOR_REUSE_CAS_CONFLICT');assert.ok(!f.calls.includes('configure'));assertReuseSafe(f,r);
});
test('reuse partial configuration failure restores only its own writes with exact readback',()=>{
  const f=reuseFixture(),before=[...f.props];f.onWrite(values=>{f.props.set('AURORA_DOCUMENT_SOURCE_REGISTRY',values.AURORA_DOCUMENT_SOURCE_REGISTRY);throw Error('private-write-error');});
  const r=configureReuse(f);assert.equal(r.ok,false);assert.equal(r.rollbackVerified,true);assert.equal(r.configurationUncertain,false);
  assert.deepEqual([...f.props],before);assertReuseSafe(f,r);assert.ok(!JSON.stringify(r).includes('private-write-error'));
});
test('reuse rollback never overwrites a concurrent third-party registry',()=>{
  const f=reuseFixture(),foreign='concurrent-registry';f.onWrite(()=>{f.props.set('AURORA_DOCUMENT_SOURCE_REGISTRY',foreign);throw Error('private-write-error');});
  const r=configureReuse(f);assert.equal(r.code,'AURORA_CONNECTOR_REUSE_CONFIGURATION_UNCERTAIN');
  assert.equal(r.rollbackVerified,false);assert.equal(r.configurationUncertain,true);assert.equal(f.props.get('AURORA_DOCUMENT_SOURCE_REGISTRY'),foreign);
  assert.equal(r.configurationChanged,null);assert.equal(r.configurationSha256,null);assert.equal(r.state,'PENDING_CONFIGURATION_RECONCILIATION');
  assert.ok(!f.calls.some(x=>x.startsWith('restore:')||x.startsWith('delete:')));assertReuseSafe(f,r);
});
test('reuse deadline blocks new configuration and allows restoration after an in-flight write',()=>{
  const expired=reuseFixture();expired.expire();assert.equal(expired.execute().code,'AURORA_CONNECTOR_REUSE_EXPIRED');assert.deepEqual(expired.calls,[]);
  const f=reuseFixture(),request=f.request('CONFIGURE',f.execute().configurationSha256);f.onMetadata(()=>f.expire());
  assert.equal(f.execute(request).code,'AURORA_CONNECTOR_REUSE_EXPIRED');assert.ok(!f.calls.includes('configure'));
  const late=reuseFixture(),before=[...late.props];late.onWrite(values=>{for(const [key,value]of Object.entries(values))late.props.set(key,value);late.expire();});
  const r=configureReuse(late);assert.equal(r.code,'AURORA_CONNECTOR_REUSE_EXPIRED');assert.equal(r.rollbackVerified,true);assert.deepEqual([...late.props],before);assertReuseSafe(late,r);
});
test('reuse pilot owner, source and historical deadline remain separate from synthetic HML renewal',()=>{
  const code=fs.readFileSync(path.join(__dirname,'..','src','37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'utf8');
  const probe=fs.readFileSync(path.join(__dirname,'..','src','38_AURORA_HML_SYNTHETIC_PROBE.gs'),'utf8');
  const policy=JSON.parse(fs.readFileSync(path.join(__dirname,'..','firebase-migration/policy/hml-owner-release-approval-v1.json'),'utf8'));
  const raw=vm.createContext({});vm.runInContext(code,raw);
  assert.equal(raw.AURORA_CONNECTOR_REUSE_OWNER_HASH,probe.match(/AURORA_HML_SYNTHETIC_MASTER_HASH = '([a-f0-9]{64})'/)[1]);
  assert.equal(raw.AURORA_CONNECTOR_REUSE_FOLDER,reuseFolder);
  const historical=policy.reaffirmations.find(item=>item.decisionId==='AURORA-HML-OWNER-RENEWAL-20261014');
  assert.equal(raw.AURORA_CONNECTOR_REUSE_DEADLINE,historical.validUntilUtc);
  assert.equal(raw.AURORA_CONNECTOR_REUSE_DEADLINE,'2026-10-16T03:00:00.000Z');
  const current=policy.reaffirmations.find(item=>item.validUntilUtc===policy.scope.validUntilUtc
    && item.riskReviewDeadlineExtended===true);
  assert.equal(current.realSourceActivationAuthorized,false);
  assert.ok(Date.parse(raw.AURORA_CONNECTOR_REUSE_DEADLINE)<Date.parse(policy.scope.validUntilUtc));
});

test('synthetic HML renewal cannot revive an expired customer-source reuse pilot',()=>{
  const f=reuseFixture({now:Date.parse('2026-10-19T23:00:00Z')}),result=f.execute();
  assert.equal(result.code,'AURORA_CONNECTOR_REUSE_EXPIRED');
  assert.ok(!f.calls.includes('configure'));assert.ok(!f.calls.includes('metadata'));
  assertReuseSafe(f,result);
});

test('the later synthetic HML renewal cannot extend the separate source regularization window',()=>{
  const f=reuseFixture({now:Date.parse('2026-10-24T00:00:00Z')});
  const policy=JSON.parse(fs.readFileSync(path.join(__dirname,'..','firebase-migration/policy/hml-owner-release-approval-v1.json'),'utf8'));
  assert.ok(f.c.Date.now()<Date.parse(policy.scope.validUntilUtc));
  assert.equal(f.execute().code,'AURORA_CONNECTOR_REUSE_EXPIRED');
  assert.equal(repairSource(f).code,'AURORA_CONNECTOR_REUSE_EXPIRED');
  assert.deepEqual(f.calls,[]);
  assert.equal(f.c.AURORA_CONNECTOR_REPAIR_DEADLINE,'2026-10-23T23:27:22.000Z');
});

const repairTime = '2026-10-22T23:30:00Z';
function repairRequest(f, mode='PREVIEW', expected=null) {
  return {...f.request(mode,expected),confirmation:'REGULARIZE_EXISTING_WMGJ_SOURCE_CONFIG_ONLY'};
}
function repairSource(f, request=repairRequest(f)) {
  return JSON.parse(JSON.stringify(f.c.auroraRegularizarFonteWmgjConfigOnly(request)));
}

test('the separate owner repair window never revives the historical endpoint or accepts its confirmation',()=>{
  const f=reuseFixture({now:Date.parse(repairTime)});
  assert.equal(f.execute().code,'AURORA_CONNECTOR_REUSE_EXPIRED');
  assert.equal(repairSource(f,f.request()).code,'AURORA_CONNECTOR_REUSE_REQUEST_REJECTED');
  const preview=repairSource(f);
  assert.equal(preview.ok,true);assert.equal(preview.configurationChanged,false);
  assert.equal(preview.authorizationDecisionId,'AURORA-WMGJ-CONFIG-REGULARIZATION-20261022');
  const result=repairSource(f,repairRequest(f,'CONFIGURE',preview.configurationSha256));
  assert.equal(result.state,'CONFIGURED_INACTIVE');assertReuseSafe(f,result);
  assert.equal(JSON.parse(f.props.get('AURORA_DOCUMENT_SOURCE_REGISTRY'))[0].active,false);
  assert.equal(f.props.get('WMGJ_FIRESTORE_DRY_RUN'),'true');
  assert.equal(f.props.get('AURORA_FIRESTORE_MIRROR_REQUIRED'),'false');
});

test('source regularization retains owner, trigger, CAS and rollback controls',()=>{
  const foreign=reuseFixture({now:Date.parse(repairTime),active:'foreign@fixture.invalid'});
  assert.equal(repairSource(foreign).code,'AURORA_CONNECTOR_REUSE_OWNER_REQUIRED');assert.deepEqual(foreign.calls,[]);
  const triggered=reuseFixture({now:Date.parse(repairTime),handlers:['auroraNexusCaptureCycle']});
  const preview=repairSource(triggered);
  assert.equal(preview.configurationWriteEligible,false);
  assert.equal(repairSource(triggered,repairRequest(triggered,'CONFIGURE',preview.configurationSha256)).code,
    'AURORA_CONNECTOR_REUSE_ACTIVE_STATE_REQUIRES_REVIEW');
  const f=reuseFixture({now:Date.parse(repairTime)}),before=[...f.props],p=repairSource(f);
  f.onWrite(values=>{f.props.set('AURORA_DOCUMENT_SOURCE_REGISTRY',values.AURORA_DOCUMENT_SOURCE_REGISTRY);throw Error('private-write-error');});
  const failed=repairSource(f,repairRequest(f,'CONFIGURE',p.configurationSha256));
  assert.equal(failed.rollbackVerified,true);assert.deepEqual([...f.props],before);assertReuseSafe(f,failed);
});

test('repair window fails closed before its start, at expiry, and for invalid constants',()=>{
  for(const now of ['2026-10-22T23:27:21Z','2026-10-23T23:27:22Z']){
    const f=reuseFixture({now:Date.parse(now)});
    assert.equal(repairSource(f).code,'AURORA_CONNECTOR_REUSE_EXPIRED');assert.deepEqual(f.calls,[]);
  }
  for(const field of ['AURORA_CONNECTOR_REPAIR_DEADLINE','AURORA_CONNECTOR_REPAIR_NOT_BEFORE']){
    const f=reuseFixture({now:Date.parse(repairTime)});f.c[field]='invalid';
    assert.equal(repairSource(f).code,'AURORA_CONNECTOR_REUSE_EXPIRED');
  }
  const f=reuseFixture({now:Date.parse(repairTime)}),before=[...f.props],p=repairSource(f);
  f.onWrite(values=>{for(const [key,value]of Object.entries(values))f.props.set(key,value);f.at(f.c.AURORA_CONNECTOR_REPAIR_DEADLINE);});
  const result=repairSource(f,repairRequest(f,'CONFIGURE',p.configurationSha256));
  assert.equal(result.code,'AURORA_CONNECTOR_REUSE_EXPIRED');assert.equal(result.rollbackVerified,true);
  assert.deepEqual([...f.props],before);
});

function orphanFixture(options={}) {
  const f=reuseFixture({now:Date.parse(repairTime),...options});
  let entries=options.entries??[{id:'synthetic-orphan-id',handler:'auroraNexusCaptureCycle',event:'CLOCK',source:'CLOCK'}];
  let reads=0,hook=null,deleteHook=null;
  f.c.ScriptApp={
    getProjectTriggers:()=>{
      reads++;if(hook)hook(reads);
      return entries.map(e=>({getUniqueId:()=>e.id,getHandlerFunction:()=>e.handler,
        getEventType:()=>e.event,getTriggerSource:()=>e.source}));
    },
    deleteTrigger:t=>{f.calls.push('delete-trigger');entries=entries.filter(e=>e.id!==t.getUniqueId());if(deleteHook)deleteHook();},
    newTrigger:()=>{throw Error('forbidden-trigger-creation');}
  };
  const request=(mode='PREVIEW',expected=null)=>({confirmation:'REMOVE_MISSING_WMGJ_CAPTURE_HANDLER_CONFIG_ONLY',
    configOnly:true,orgId:'wmgj',mode,expectedTriggerSetSha256:expected});
  const execute=r=>JSON.parse(JSON.stringify(f.c.auroraRemoverGatilhoOrfaoWmgjConfigOnly(r??request())));
  return {...f,requestOrphan:request,orphan:execute,replace(values){entries=values;},onRead(fn){hook=fn;},onDelete(fn){deleteHook=fn;},resetReads(){reads=0;}};
}
function assertOrphanSafe(f,r){
  assert.equal(r.configurationChanged,false);assert.equal(r.contentRead,false);assert.equal(r.complete,false);
  assert.equal(r.operationalReady,false);assert.equal(r.configOnly,true);
  assert.ok(!f.calls.includes('configure')&&!f.calls.includes('FORBIDDEN'));
  for(const value of ['synthetic-orphan-id','auroraNexusCaptureCycle','owner@fixture.invalid','e'.repeat(64)]){
    assert.ok(!JSON.stringify(r).includes(value));
  }
}

test('orphan repair previews metadata, removes exactly one missing clock handler and verifies absence',()=>{
  const f=orphanFixture(),before=[...f.props],p=f.orphan();
  assert.equal(p.code,'AURORA_CONNECTOR_ORPHAN_PREVIEW_VERIFIED');assert.match(p.expectedTriggerSetSha256,/^[a-f0-9]{64}$/);
  assert.equal(f.calls.filter(x=>x==='delete-trigger').length,0);
  const request=f.requestOrphan('REMOVE',p.expectedTriggerSetSha256),r=f.orphan(request);
  assert.equal(r.ok,true);assert.equal(r.removedCount,1);assert.equal(r.absenceVerified,true);assert.equal(r.triggersChanged,true);
  assert.deepEqual([...f.props],before);assertOrphanSafe(f,r);
  const replay=f.orphan(request);
  assert.equal(replay.code,'AURORA_CONNECTOR_ORPHAN_ALREADY_ABSENT');assert.equal(replay.removedCount,0);
  assert.equal(replay.triggersChanged,false);assert.equal(f.calls.filter(x=>x==='delete-trigger').length,1);
});

test('orphan repair refuses an existing handler, live source, foreign tenant, unknown trigger or non-clock trigger',()=>{
  const cases=[
    f=>{f.c.auroraNexusCaptureCycle=()=>{};},f=>{f.c.auroraNexusCaptureCycle='present';},
    f=>f.props.set('WMGJ_FIRESTORE_ORG_ID','foreign'),f=>f.props.set('WMGJ_FIRESTORE_DRY_RUN','false'),
    f=>f.props.set('AURORA_FIRESTORE_MIRROR_REQUIRED','true'),f=>f.props.set('WMGJ_PASTA_ENTRADA_ID',reuseFolder),
    f=>f.replace([{id:'other',handler:'executarAutomacaoOperacionalWMGJ',event:'CLOCK',source:'CLOCK'}]),
    f=>f.replace([{id:'other',handler:'auroraNexusCaptureCycle',event:'ON_OPEN',source:'SPREADSHEETS'}]),
    f=>f.replace([{id:'one',handler:'auroraNexusCaptureCycle',event:'CLOCK',source:'CLOCK'},
      {id:'two',handler:'unknownHandler',event:'CLOCK',source:'CLOCK'}])
  ];
  for(const change of cases){const f=orphanFixture();change(f);const r=f.orphan();
    assert.equal(r.ok,false);assert.ok(!f.calls.includes('delete-trigger'));assertOrphanSafe(f,r);}
});

test('orphan repair rejects mismatched owner, malformed requests, busy lock and stale trigger fingerprints',()=>{
  const foreign=orphanFixture({active:'foreign@fixture.invalid'});assert.equal(foreign.orphan().code,'AURORA_CONNECTOR_ORPHAN_OWNER_REQUIRED');assert.deepEqual(foreign.calls,[]);
  const busy=orphanFixture({busy:true});assert.equal(busy.orphan().code,'AURORA_CONNECTOR_ORPHAN_LOCK_BUSY');
  for(const change of [r=>r.activate=true,r=>r.orgId='foreign',r=>r.configOnly=false,r=>r.mode='DELETE_ALL',r=>r.expectedTriggerSetSha256='bad']){
    const f=orphanFixture(),r=f.requestOrphan();change(r);assert.equal(f.orphan(r).code,'AURORA_CONNECTOR_ORPHAN_REQUEST_REJECTED');assert.deepEqual(f.calls,[]);
  }
  const f=orphanFixture();assert.equal(f.orphan(f.requestOrphan('REMOVE','0'.repeat(64))).code,'AURORA_CONNECTOR_ORPHAN_CAS_CONFLICT');assert.ok(!f.calls.includes('delete-trigger'));
});

test('orphan repair checks changed trigger identity and runtime flags immediately before deletion',()=>{
  for(const change of [f=>f.replace([{id:'replaced-id',handler:'auroraNexusCaptureCycle',event:'CLOCK',source:'CLOCK'}]),
    f=>f.props.set('WMGJ_FIRESTORE_DRY_RUN','false'),f=>f.at(f.c.AURORA_CONNECTOR_REPAIR_DEADLINE)]){
    const f=orphanFixture(),p=f.orphan();f.resetReads();f.onRead(n=>{if(n===2)change(f);});
    const r=f.orphan(f.requestOrphan('REMOVE',p.expectedTriggerSetSha256));
    assert.equal(r.ok,false);assert.ok(!f.calls.includes('delete-trigger'));assertOrphanSafe(f,r);
  }
});

test('an uncertain orphan deletion is reconciled by fresh absence rather than a second deletion',()=>{
  const f=orphanFixture(),p=f.orphan();f.onDelete(()=>{throw Error('private transport detail');});
  const request=f.requestOrphan('REMOVE',p.expectedTriggerSetSha256),r=f.orphan(request);
  assert.equal(r.code,'AURORA_CONNECTOR_ORPHAN_REMOVAL_UNCERTAIN');assert.equal(r.removalUncertain,true);
  assert.equal(r.triggersChanged,null);assert.equal(r.expectedTriggerSetSha256,null);
  assert.ok(!JSON.stringify(r).includes('private transport detail'));assertOrphanSafe(f,r);
  assert.equal(f.orphan().code,'AURORA_CONNECTOR_ORPHAN_ALREADY_ABSENT');
  assert.equal(f.calls.filter(x=>x==='delete-trigger').length,1);
});

test('orphan cleanup and source configuration stay separate and do not activate processing',()=>{
  const f=orphanFixture(),p=f.orphan();assert.equal(repairSource(f).configurationWriteEligible,false);
  assert.equal(f.orphan(f.requestOrphan('REMOVE',p.expectedTriggerSetSha256)).absenceVerified,true);
  const source=repairSource(f);assert.equal(source.configurationWriteEligible,true);
  const r=repairSource(f,repairRequest(f,'CONFIGURE',source.configurationSha256));
  assert.equal(r.state,'CONFIGURED_INACTIVE');assertReuseSafe(f,r);
});

test('configuration repair decision does not renew publication, risk acceptance or real ingestion',()=>{
  const policy=JSON.parse(fs.readFileSync(path.join(__dirname,'..','firebase-migration/policy/wmgj-connector-regularization-20261022.json'),'utf8'));
  const f=reuseFixture();
  assert.equal(policy.decisionId,f.c.AURORA_CONNECTOR_REPAIR_DECISION);
  assert.equal(policy.scope.notBeforeUtc,f.c.AURORA_CONNECTOR_REPAIR_NOT_BEFORE);
  assert.equal(policy.scope.validUntilUtc,f.c.AURORA_CONNECTOR_REPAIR_DEADLINE);
  assert.equal(Date.parse(policy.scope.validUntilUtc)-Date.parse(policy.scope.notBeforeUtc),86400000);
  for(const key of ['hmlPublicationRenewed','riskAcceptanceRenewed','realSourceActivationAuthorized','productionAuthorized','clinicalSensitiveAuthorized'])assert.equal(policy[key],false);
  assert.equal(f.c.AURORA_CONNECTOR_REUSE_DEADLINE,'2026-10-16T03:00:00.000Z');
});
