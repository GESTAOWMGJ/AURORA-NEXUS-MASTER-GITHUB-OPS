'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const os = require('node:os');
const coordinator = require('./aurora-cloud-synthetic-probe.cjs');
const canonical = require('./aurora-cloud-synthetic-readback.cjs');
const ROOT = path.resolve(__dirname,'..');
const MODULES = ['04_EXTRACAO_DOCUMENTAL_WMGJ','35_AURORA_FIRESTORE_BRIDGE_WMGJ','38_AURORA_HML_SYNTHETIC_PROBE'];
const NONCE = '0123456789abcdef0123456789abcdef';
const NOW = Date.parse('2026-10-15T00:00:00Z');
const DEADLINE = Date.parse('2026-10-15T03:00:00Z');
const WINDOW = {expiresAt:new Date(NOW+600000).toISOString(),deadline:DEADLINE,now:()=>NOW};
const hash = canonical.sha;
const clone = value => JSON.parse(JSON.stringify(value));
const iter = values => { let n=0;return {hasNext:()=>n<values.length,next:()=>values[n++]}; };
const removeOwnTemporary = (directory,prefix) => {
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith(prefix));
  fs.rmSync(directory,{recursive:true,force:true});
};

function fixture(options={}) {
  const calls = {configReads:0,propertiesWritten:0,globalLogs:0,triggers:0,filesCreated:0,foldersCreated:0,http:[],sourceReads:[],trashed:[]};
  const storage = new Map(), canonicalDocs = new Map(), receipts = new Map();
  let sequence=0;
  let clockNow=options.now??NOW;
  const expiresAt=Math.min(clockNow+600000,DEADLINE);
  const expireAfter=name=>{if(options.expireAfterOperation===name)clockNow=options.expireTo??expiresAt;};
  const props = {WMGJ_FIRESTORE_ORG_ID:'wmgj',WMGJ_FIRESTORE_INGEST_URL:'https://southamerica-east1-wmgj-hml-jfn-20260927.cloudfunctions.net/ingestWmgjEvent',
    WMGJ_FIRESTORE_HMAC_KEY_ID:'synthetic-key',WMGJ_FIRESTORE_HMAC_SECRET:'ab'.repeat(32),WMGJ_FIRESTORE_DRY_RUN:'true',...options.properties};
  class Clock extends Date { constructor(...args) { super(...(args.length?args:[clockNow])); } static now(){return clockNow;} }
  const rootFolder = {getId:()=> 'synthetic-root'};
  class Blob {
    constructor(text,name='',mime='text/plain'){this.text=text;this.name=name;this.mime=mime;}
    setName(name){this.name=name;return this;} getName(){return this.name;}
    getBytes(){return [...Buffer.from(this.text)];} getDataAsString(){return this.text;}
  }
  class File {
    constructor(name,mime,text=''){this.id='synthetic-file-'+(++sequence);this.name=name;this.mime=mime;this.text=text;this.parent=rootFolder;this.description='';this.trashed=false;storage.set(this.id,this);calls.filesCreated++;}
    getId(){return this.id;}getName(){return this.name;}getMimeType(){return this.mime;}
    getDescription(){return options.badMarker && this.name.endsWith('_PDF.pdf')?'foreign-marker':this.description;}
    setDescription(value){this.description=value;return this;}moveTo(folder){this.parent=folder;return this;}
    getParents(){return iter([this.parent]);}getSize(){return this.text.length;}
    getLastUpdated(){return new Clock();}getUrl(){return 'https://drive.google.com/file/d/'+this.id;}
    getBlob(){return new Blob(this.text,this.name,this.mime);}
    getAs(mime){return new Blob(this.text,this.name,mime);}
    setTrashed(value){assert.equal(value,true);this.trashed=true;calls.trashed.push(this.id);if(this.name.endsWith('_DOC'))expireAfter('cleanup');}
  }
  class Folder {
    constructor(name){this.id='synthetic-folder-'+(++sequence);this.name=name;this.description='';this.trashed=false;calls.foldersCreated++;}
    getId(){return this.id;}getName(){return this.name;}getDescription(){return this.description;}
    setDescription(value){this.description=value;}getParents(){return iter([rootFolder]);}
    createFile(...args){const b=args[0] instanceof Blob?args[0]:new Blob(args[1],args[0],args[2]);const f=new File(b.name,b.mime,b.text);f.parent=this;return f;}
    getFiles(){return iter([...storage.values()].filter(f=>f.parent===this&&!f.trashed));}
    getFolders(){return iter([]);}setTrashed(value){assert.equal(value,true);this.trashed=true;calls.trashed.push(this.id);}
  }
  const ownFile = id => {
    if(!storage.has(id))throw Error('Forbidden foreign file lookup');
    const file=storage.get(id);
    if((options.failCreateLookup==='DOC'&&file.mime===M.GOOGLE_DOCS)||(options.failCreateLookup==='SHEETS'&&file.mime===M.GOOGLE_SHEETS))throw Error('Synthetic post-create lookup failure');
    return file;
  };
  const M = {GOOGLE_DOCS:'application/vnd.google-apps.document',GOOGLE_SHEETS:'application/vnd.google-apps.spreadsheet',PLAIN_TEXT:'text/plain',PDF:'application/pdf'};
  const makeDoc = file => ({getId:()=>file.id,getBody:()=>({setText:value=>{file.text=value;},getText:()=>{
    calls.sourceReads.push(file.id);expireAfter('extraction');return options.noNonce?'metadata without proof':file.text;
  }}),saveAndClose(){}});
  const makeSheet = file => ({getId:()=>file.id,getSheets:()=>[{getRange:()=>({setValues:rows=>{file.rows=rows;file.text=JSON.stringify(rows);}}),
    getDataRange:()=>({getDisplayValues:()=>file.rows}),getName:()=> 'Synthetic'}]});
  const c=vm.createContext({Date:Clock,Number,JSON,MimeType:M,
    Session:{getActiveUser:()=>({getEmail:()=>options.active??'owner@synthetic.invalid'}),getEffectiveUser:()=>({getEmail:()=>options.effective??'owner@synthetic.invalid'})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>{calls.configReads++;return props[key]??null;},
      setProperty(){calls.propertiesWritten++;throw Error('Forbidden property write');},setProperties(){calls.propertiesWritten++;throw Error('Forbidden property write');}})},
    DriveApp:{createFolder:name=>new Folder(name),getFileById:ownFile,getFolderById(){throw Error('Forbidden configured root lookup');}},
    DocumentApp:{create:name=>{const file=new File(name,M.GOOGLE_DOCS);expireAfter('createDoc');if(options.createThrowsAfterCommit)throw Error('Synthetic creation response lost');return makeDoc(file);},openById:id=>makeDoc(ownFile(id))},
    SpreadsheetApp:{create:name=>makeSheet(new File(name,M.GOOGLE_SHEETS)),openById:id=>makeSheet(ownFile(id)),flush(){},getActiveSpreadsheet(){throw Error('Forbidden global sheet');}},
    Drive:{Files:{copy:(resource,id)=>{
      if(options.ocrFail)throw Error('Private OCR response must not leak');
      const source=ownFile(id);assert.equal(source.mime,M.PDF);const f=new File(resource.title,M.GOOGLE_DOCS,source.text);f.parent=source.parent;return {id:f.id};
    }}},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:()=> 'synthetic-uuid-'+(++sequence),sleep(){expireAfter('retrySleep');},newBlob:value=>new Blob(value),
      computeDigest:(_,value)=>[...crypto.createHash('sha256').update(Array.isArray(value)?Buffer.from(value):String(value)).digest()],
      computeHmacSha256Signature:(value,key)=>[...crypto.createHmac('sha256',Buffer.from(key.map(x=>(x+256)%256))).update(Array.isArray(value)?Buffer.from(value):String(value)).digest()]},
    ScriptApp:{newTrigger(){calls.triggers++;throw Error('Forbidden trigger');}},
    registrarLogWMGJ_:()=>{calls.globalLogs++;},Logger:{log(){calls.globalLogs++;}},
    getPlanilha(){throw Error('Forbidden global sheet');},getConfigWMGJ_(){throw Error('Forbidden global config');},
    UrlFetchApp:{fetch:(url,config)=>{
      assert.equal(url,props.WMGJ_FIRESTORE_INGEST_URL);assert.equal(config.followRedirects,false);
      calls.http.push({nonce:config.headers['X-WMGJ-Nonce'],signature:config.headers['X-WMGJ-Signature']});
      const event=JSON.parse(config.payload);
      const bodyHash=hash(config.payload);
      const canonicalHmac=['WMGJ-HMAC-V2','POST','application/json',config.headers['X-WMGJ-Timestamp'],config.headers['X-WMGJ-Nonce'],props.WMGJ_FIRESTORE_HMAC_KEY_ID,'wmgj',event.idempotencyKey,bodyHash].join('\n');
      assert.equal(config.headers['X-WMGJ-Signature'],crypto.createHmac('sha256',Buffer.from(props.WMGJ_FIRESTORE_HMAC_SECRET,'hex')).update(canonicalHmac).digest('hex'));
      if(options.httpFail)return {getResponseCode:()=>403,getContentText:()=>JSON.stringify({ok:false,code:'KEY_SCOPE_VIOLATION',private:'must-not-leak'})};
      if(options.retryThenExpire)return {getResponseCode:()=>503,getContentText:()=>JSON.stringify({ok:false})};
      const entityId=hash('sourceDocument:'+event.entityKey).slice(0,48);
      const versionId=hash('v1:sourceDocument:'+event.entityKey+':revision:1').slice(0,48);
      const idem=hash(event.idempotencyKey),duplicate=receipts.has(idem);
      if(!duplicate){
        const canonicalEntity={...event.record,orgId:'wmgj',schemaVersion:1,entityType:'sourceDocument',entityKey:event.entityKey,
          revision:1,sourceVersion:event.sourceVersion,competence:event.competence,documentType:event.documentType,
          workflowState:event.workflowState,reviewState:event.reviewState,riskLevel:event.riskLevel,sensitivity:event.sensitivity,
          source:event.source,migration:{eventId:event.eventId,idempotencyId:idem,sourceSystem:'DRIVE'}};
        canonicalDocs.set('sourceDocuments/'+entityId,{...clone(canonicalEntity),createdAt:'test',updatedAt:'test',migration:{...canonicalEntity.migration,importedAt:'test'}});
        canonicalDocs.set('entityVersions/'+versionId,{orgId:'wmgj',entityType:'sourceDocument',entityId,entityKey:event.entityKey,revision:1,
          sourceVersion:event.sourceVersion,eventId:event.eventId,idempotencyId:idem,beforeHash:null,afterHash:hash(canonical.stable(canonicalEntity)),snapshot:canonicalEntity});
        canonicalDocs.set('integrationEvents/'+idem,{orgId:'wmgj',entityType:'sourceDocument',entityId,revision:1,sourceVersion:event.sourceVersion,
          eventId:event.eventId,versionId,sourceId:event.source.sourceId,sourceSystem:'DRIVE',payloadHash:bodyHash,status:'ACCEPTED'});
        receipts.set(idem,{eventId:event.eventId,entityId,versionId,revision:1});
      }
      const response={ok:true,accepted:!duplicate,duplicate,...receipts.get(idem)};
      if(options.badReceipt)delete response.versionId;
      if(options.badReplay&&duplicate){response.accepted=true;response.duplicate=false;}
      expireAfter('post');
      return {getResponseCode:()=>duplicate?200:202,getContentText:()=>JSON.stringify(response)};
    }}
  });
  for(const module of MODULES)vm.runInContext(fs.readFileSync(path.join(ROOT,'src',module+'.gs'),'utf8'),c,{filename:module+'.gs'});
  c.AURORA_HML_SYNTHETIC_MASTER_HASH=hash('owner@synthetic.invalid');
  const request=()=>({confirmation:'RUN_ISOLATED_SYNTHETIC_HML_PROBE',projectId:'wmgj-hml-jfn-20260927',orgId:'wmgj',
    sourceSha:'a'.repeat(40),runNonce:NONCE,expiresAt:new Date(expiresAt).toISOString(),runtimeFunctionHashes:clone(c.auroraHmlSyntheticRuntimeHashes_())});
  const execute=change=>{const input=request();if(change)change(input);return clone(c.auroraExecutarProbeNuvemSinteticaHml(input));};
  return {c,calls,props,storage,canonicalDocs,request,execute};
}

test('real extractor and sender code run four synthetic formats, authentic HMAC, replay and exact cleanup in VM',async()=>{
  const f=fixture(),result=f.execute();
  assert.equal(result.status,'PASS');assert.equal(result.formats.length,4);
  assert.ok(result.formats.every(row=>row.extractionVerified&&row.replayVerified&&row.canonicalCommitAcknowledged));
  assert.equal(f.calls.http.length,8);assert.equal(new Set(f.calls.http.map(row=>row.nonce)).size,8);
  assert.equal(f.calls.propertiesWritten,0);assert.equal(f.calls.triggers,0);assert.equal(f.calls.globalLogs,0);
  assert.ok([...f.storage.values()].every(file=>file.trashed));
  assert.equal(f.props.WMGJ_FIRESTORE_DRY_RUN,'true');assert.equal(result.runtimeProcessingVerified,false);
  canonical.validatePlan(result.canonicalReadbackPlan,NONCE);
  for(const item of result.canonicalReadbackPlan)assert.equal(canonical.verifyDocuments(item,[f.canonicalDocs.get('sourceDocuments/'+item.entityId),f.canonicalDocs.get('entityVersions/'+item.versionId),f.canonicalDocs.get('integrationEvents/'+item.idempotencyId)],NONCE).canonicalMaterializationVerified,true);
  const safe=coordinator.sanitizeSummary({response:result},f.request().runtimeFunctionHashes);
  assert.equal(safe.canonicalReadbackPlan,undefined);assert.doesNotMatch(JSON.stringify(safe),/synthetic-file-|owner@|synthetic-key/);
});

test('ordinary sender wrapper preserves dry-run config and existing logger',()=>{
  const f=fixture();const result=f.c.wmgjFirestoreEnviarEvento_({orgId:'wmgj',idempotencyKey:'synthetic-idem',eventId:'synthetic-event',entityType:'sourceDocument'});
  assert.equal(result.dryRun,true);assert.equal(f.calls.http.length,0);assert.equal(f.calls.globalLogs,1);
});
test('ordinary sender wrapper preserves live config and configured logger',()=>{
  const f=fixture({properties:{WMGJ_FIRESTORE_DRY_RUN:'false'}});const scope=f.c.auroraHmlSyntheticCreateScope_(NONCE,WINDOW.expiresAt);f.c.auroraHmlSyntheticCreateFolder_(scope);scope.folder.setDescription(scope.marker);
  const file=f.c.auroraHmlSyntheticCreateFiles_(scope)[0].file;
  const event=f.c.wmgjFirestoreEventoArquivo_(file,{categoria:'outro',tipo_documento:'OTHER',competencia:'2026-05',status:'PROCESSADO',metodo_extracao:'google_docs_text'},{});
  const result=f.c.wmgjFirestoreEnviarEvento_(event);assert.equal(result.accepted,true);assert.equal(f.calls.http.length,1);assert.equal(f.calls.globalLogs,1);
});
for(const [name,options]of [['blank active',{active:''}],['blank effective',{effective:''}],['different users',{active:'other@synthetic.invalid'}],['foreign identity',{active:'other@synthetic.invalid',effective:'other@synthetic.invalid'}]]){
  test('caller guard blocks '+name+' before configuration or Drive',()=>{
    const f=fixture(options),result=f.execute();assert.equal(result.code,'PROBE_CALLER_NOT_AUTHORIZED');
    assert.equal(f.calls.configReads,0);assert.equal(f.calls.filesCreated,0);assert.equal(f.calls.foldersCreated,0);
    assert.doesNotMatch(JSON.stringify(result),/@synthetic|other|owner/);
  });
}
test('arbitrary IDs, unknown fields, destination, tenant and missing confirmation are rejected',()=>{
  for(const change of [r=>r.folderId='foreign',r=>r.documentId='foreign',r=>r.projectId='production',r=>r.orgId='foreign',r=>r.confirmation='wrong',r=>r.expiresAt='2027-01-01T00:00:00Z']){
    const f=fixture(),result=f.execute(change);assert.equal(result.status,'FAIL');assert.equal(f.calls.configReads,0);assert.equal(f.calls.foldersCreated,0);
  }
});
test('runtime function mismatch fails before config or creation rather than echoing SHA',()=>{
  const f=fixture(),result=f.execute(r=>r.runtimeFunctionHashes.sender='b'.repeat(64));
  assert.equal(result.code,'PROBE_RUNTIME_SOURCE_MISMATCH');assert.equal(f.calls.configReads,0);assert.equal(f.calls.filesCreated,0);
});
test('deadline cannot be extended by request',()=>{
  const f=fixture({now:Date.parse('2026-10-15T03:00:01Z')}),result=f.execute();assert.equal(result.code,'PROBE_REQUEST_REJECTED');assert.equal(f.calls.configReads,0);
});
for(const [name,options]of [
  ['lease after an in-flight extractor',{expireAfterOperation:'extraction'}],
  ['hard deadline after an in-flight extractor',{now:DEADLINE-10000,expireAfterOperation:'extraction',expireTo:DEADLINE}]
]){
  test(name+' blocks the next effect while permitting scoped cleanup',()=>{
    const f=fixture(options),result=f.execute();
    assert.equal(result.status,'FAIL');assert.equal(result.code,'PROBE_WINDOW_EXPIRED');assert.equal(f.calls.http.length,0);
    assert.equal(result.cleanupVerified,true);assert.ok([...f.storage.values()].every(file=>file.trashed));
  });
}
test('expiry after an accepted POST blocks replay and following writes without inventing rollback',()=>{
  const f=fixture({expireAfterOperation:'post'}),result=f.execute();
  assert.equal(result.status,'FAIL');assert.equal(result.code,'PROBE_WINDOW_EXPIRED');assert.equal(f.calls.http.length,1);
  assert.equal(f.canonicalDocs.size,3);assert.equal(result.cleanupVerified,true);
});
test('expiry during retry delay blocks the next bridge POST',()=>{
  const f=fixture({retryThenExpire:true,expireAfterOperation:'retrySleep'}),result=f.execute();
  assert.equal(result.status,'FAIL');assert.equal(result.code,'PROBE_WINDOW_EXPIRED');assert.equal(f.calls.http.length,1);
  assert.equal(result.cleanupVerified,true);
});
test('expiry during permitted cleanup cannot become a final PASS',()=>{
  const f=fixture({expireAfterOperation:'cleanup'}),result=f.execute();
  assert.equal(f.calls.http.length,8);assert.ok(result.formats.every(row=>row.status==='PASS'));
  assert.equal(result.cleanupVerified,true);assert.equal(result.status,'FAIL');assert.equal(result.code,'PROBE_WINDOW_EXPIRED');
  assert.ok([...f.storage.values()].every(file=>file.trashed));
});
for(const kind of ['DOC','SHEETS']){
  test(kind+' creation followed by a failed handle lookup cannot claim verified cleanup',()=>{
    const f=fixture({failCreateLookup:kind}),result=f.execute();
    assert.equal(result.status,'FAIL');assert.equal(result.cleanupVerified,false);assert.equal(result.unresolvedCreationCount,1);
    assert.ok(result.cleanupRemainingCount>=1);assert.equal(f.calls.http.length,0);
    assert.ok([...f.storage.values()].some(file=>!file.trashed));
  });
}
test('lost creation response or expiry before handle lookup retains explicit creation uncertainty',()=>{
  for(const options of [{createThrowsAfterCommit:true},{expireAfterOperation:'createDoc'}]){
    const f=fixture(options),result=f.execute();
    assert.equal(result.status,'FAIL');assert.equal(result.cleanupVerified,false);assert.equal(result.unresolvedCreationCount,1);
    assert.ok(result.cleanupRemainingCount>=1);assert.equal(f.calls.http.length,0);
    assert.ok([...f.storage.values()].some(file=>!file.trashed));
  }
});
test('foreign endpoint or tenant fails before creating sources',()=>{
  for(const properties of [{WMGJ_FIRESTORE_INGEST_URL:'https://foreign.invalid/ingest'},{WMGJ_FIRESTORE_ORG_ID:'foreign'}]){
    const f=fixture({properties}),result=f.execute();assert.equal(result.code,'PROBE_HML_CONFIG_REJECTED');assert.equal(f.calls.foldersCreated,0);
  }
});
test('OCR failure leaves PDF pending, never substitutes text or metadata, and cleans new files',()=>{
  const f=fixture({ocrFail:true}),result=f.execute();assert.equal(result.status,'FAIL');
  const pdf=result.formats.find(row=>row.format==='PDF');assert.equal(pdf.extractionVerified,false);assert.equal(pdf.code,'PROBE_EXTRACTION_PENDING');
  assert.equal(f.calls.http.length,6);assert.equal(result.cleanupVerified,true);assert.doesNotMatch(JSON.stringify(result),/Private OCR/);
});
test('missing nonce cannot become a document fact',()=>{
  const f=fixture({noNonce:true}),result=f.execute();assert.equal(result.status,'FAIL');assert.equal(result.formats.find(r=>r.format==='DOC').extractionVerified,false);
});
test('HMAC scope rejection is failure, sanitized, with no config or global log changes',()=>{
  const f=fixture({httpFail:true}),result=f.execute();assert.equal(result.status,'FAIL');assert.ok(result.formats.every(row=>!row.canonicalCommitAcknowledged));
  assert.equal(result.cleanupVerified,true);assert.equal(f.calls.globalLogs,0);assert.equal(f.calls.propertiesWritten,0);assert.doesNotMatch(JSON.stringify(result),/must-not-leak|KEY_SCOPE/);
});
test('incomplete canonical ACK and nonduplicate replay cannot pass',()=>{
  for(const options of [{badReceipt:true},{badReplay:true}]){const f=fixture(options),result=f.execute();assert.equal(result.status,'FAIL');assert.ok(result.formats.every(row=>!row.replayVerified));}
});
test('changed marker fails cleanup closed and never trashes an unverified item',()=>{
  const f=fixture({badMarker:true}),result=f.execute();assert.equal(result.status,'FAIL');assert.equal(result.cleanupVerified,false);
  assert.ok([...f.storage.values()].filter(file=>file.name.endsWith('_PDF.pdf')).every(file=>!file.trashed));
});

test('published source selection fails ambiguity, old SHA or absent immutable version',()=>{
  const good={description:'AURORA_EXECUTION_API_CANONICAL '+'a'.repeat(40),versionNumber:4,deploymentId:'synthetic-deployment'};
  assert.equal(coordinator.selectDeployment([good],'a'.repeat(40)).versionNumber,4);
  for(const rows of [[],[good,good],[{...good,versionNumber:0}],[{...good,description:'AURORA_EXECUTION_API_CANONICAL '+'b'.repeat(40)}]])assert.throws(()=>coordinator.selectDeployment(rows,'a'.repeat(40)));
});
test('versioned pull must match probe, extractor, bridge and manifest before execution',()=>{
  const remote=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-probe-public-fixture-'));
  try{
    for(const module of MODULES)fs.copyFileSync(path.join(ROOT,'src',module+'.gs'),path.join(remote,module+'.js'));
    fs.copyFileSync(path.join(ROOT,'appsscript.json'),path.join(remote,'appsscript.json'));
    assert.equal(Object.keys(coordinator.publishedHashes(ROOT,remote)).length,4);
    fs.appendFileSync(path.join(remote,MODULES[0]+'.js'),'\n// changed runtime');
    assert.throws(()=>coordinator.publishedHashes(ROOT,remote),/PROBE_PUBLISHED_SOURCE_MISMATCH/);
  }finally{removeOwnTemporary(remote,'aurora-probe-public-fixture-');}
});
test('public sanitizer rejects credentials, invented processing, missing target and source mismatch',()=>{
  const f=fixture(),value=f.execute(),expected=f.request().runtimeFunctionHashes;
  for(const change of [r=>r.token='forbidden',r=>r.runtimeProcessingVerified=true,r=>r.formats.pop(),r=>r.runtimeFunctionHashes.sender='f'.repeat(64),r=>r.unresolvedCreationCount=1]){
    const changed=clone(value);change(changed);assert.throws(()=>coordinator.sanitizeSummary({response:changed},expected));
  }
});
test('private readback plan rejects foreign paths, marker and mixed immutable version',()=>{
  const f=fixture(),value=f.execute();
  for(const change of [p=>p[0].sourceId='../foreign',p=>p[0].entityId='f'.repeat(48),p=>p[0].versionId='f'.repeat(48),p=>p[0].markerSha256='f'.repeat(64)]){
    const plan=clone(value.canonicalReadbackPlan);change(plan);assert.throws(()=>canonical.validatePlan(plan,NONCE));
  }
});
test('canonical readback rejects absent processing fields, content mismatch and inconsistent version/receipt',()=>{
  const f=fixture(),value=f.execute(),item=value.canonicalReadbackPlan[0];
  const docs=[f.canonicalDocs.get('sourceDocuments/'+item.entityId),f.canonicalDocs.get('entityVersions/'+item.versionId),f.canonicalDocs.get('integrationEvents/'+item.idempotencyId)];
  for(const change of [d=>d[0].extractionComplete=false,d=>d[0].source.contentHash='f'.repeat(64),d=>d[1].snapshot.sourceContext='wrong',d=>d[2].status='PENDING',d=>d[0].competence='2026-10']){
    const changed=clone(docs);change(changed);assert.throws(()=>canonical.verifyDocuments(item,changed,NONCE));
  }
});

function firestoreValue(value) {
  if(value===null)return {nullValue:null};
  if(typeof value==='string')return {stringValue:value};
  if(typeof value==='boolean')return {booleanValue:value};
  if(typeof value==='number')return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
  if(Array.isArray(value))return {arrayValue:{values:value.map(firestoreValue)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,firestoreValue(item)]))}};
}
function syntheticFetcher(f,requests,options={}) {
  return async(url,init)=>{
    requests.push({url,method:init.method});
    assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer synthetic-access-token');
    const base='https://firestore.googleapis.com/v1/projects/wmgj-hml-jfn-20260927/databases/(default)/documents/organizations/wmgj/';
    assert.ok(url.startsWith(base));assert.ok(!url.includes('?'));const relative=url.slice(base.length);
    assert.match(relative,/^(sourceDocuments|entityVersions|integrationEvents)\/[a-f0-9]{48,64}$/);
    const value=f.canonicalDocs.get(relative);assert.ok(value,'Only a document created by the probe may be read');
    if(options.missing)return {status:404,text:async()=>''};
    return {status:200,text:async()=>JSON.stringify({name:(options.wrongName?'projects/foreign/':'projects/wmgj-hml-jfn-20260927/databases/(default)/documents/organizations/wmgj/')+relative,
      fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,firestoreValue(item)]))})};
  };
}
test('readback performs exactly12 authenticated GETs of created documents and exports no IDs or bearer',async()=>{
  const f=fixture(),value=f.execute(),requests=[];
  const proof=await canonical.readback(value.canonicalReadbackPlan,NONCE,'synthetic-access-token',syntheticFetcher(f,requests),WINDOW);
  assert.equal(requests.length,12);assert.equal(proof.canonicalMaterializationVerified,true);assert.equal(proof.processingOrInstallationAcceptanceVerified,false);
  assert.doesNotMatch(JSON.stringify(proof),/synthetic-file|Bearer|access-token|sourceDocuments\//);
});
test('missing canonical document or wrong project cannot become a processing receipt',async()=>{
  for(const options of [{missing:true},{wrongName:true}]){
    const f=fixture(),value=f.execute(),requests=[];
    await assert.rejects(canonical.readback(value.canonicalReadbackPlan,NONCE,'synthetic-access-token',syntheticFetcher(f,requests,options),WINDOW),/PROBE_CANONICAL_READBACK_UNCONFIRMED/);
    assert.equal(requests.length,1);
  }
});
test('readback expiry blocks the next request and a late final PASS',async()=>{
  for(const mode of ['first-response','last-body']){
    const f=fixture(),value=f.execute(),requests=[];let now=NOW;
    const underlying=syntheticFetcher(f,requests);
    const fetcher=async(...args)=>{
      const response=await underlying(...args);
      if(mode==='first-response')now=NOW+600000;
      if(mode==='last-body'&&requests.length===12){
        const text=response.text;response.text=async()=>{const body=await text();now=NOW+600000;return body;};
      }
      return response;
    };
    await assert.rejects(canonical.readback(value.canonicalReadbackPlan,NONCE,'synthetic-access-token',fetcher,{...WINDOW,now:()=>now}),/PROBE_WINDOW_EXPIRED/);
    assert.equal(requests.length,mode==='first-response'?1:12);
  }
  assert.throws(()=>canonical.assertWindow({expiresAt:'2026-10-15T03:10:00Z',deadline:DEADLINE+600000,now:()=>DEADLINE}),/PROBE_WINDOW_EXPIRED/);
});
test('coordinator binds immutable source, actual runtime hashes, exact readback and unchanged deployment',async()=>{
  const f=fixture(),value=f.execute(),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-probe-coordinator-fixture-'));
  const previous={ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA};
  process.env.GITHUB_REF='refs/heads/main';process.env.GITHUB_SHA='a'.repeat(40);
  const expected=coordinator.expectedRuntimeHashes(ROOT);value.runtimeFunctionHashes=expected;
  let probes=0,pulls=0,deploymentReads=0,drift=false,coordinatorNow=NOW,expireAtCommand=null,gcloudCalls=0;
  const run=(executable,args,cwd)=>{
    if(executable==='git')return args[0]==='rev-parse'?'a'.repeat(40):'';
    if(executable==='clasp'&&args[0]==='deployments'){
      deploymentReads++;
      if(expireAtCommand==='deployment')coordinatorNow=NOW+600000;
      return JSON.stringify([{deploymentId:'synthetic-deployment',versionNumber:drift&&deploymentReads%2===0?8:7,description:'AURORA_EXECUTION_API_CANONICAL '+'a'.repeat(40)}]);
    }
    if(executable==='clasp'&&args[0]==='pull'){
      pulls++;assert.equal(args[0],'pull');assert.equal(args[1],'--versionNumber');assert.equal(args[3],'--json');assert.ok(['7','8'].includes(args[2]));
      for(const module of MODULES)fs.copyFileSync(path.join(ROOT,'src',module+'.gs'),path.join(cwd,module+'.js'));
      fs.copyFileSync(path.join(ROOT,'appsscript.json'),path.join(cwd,'appsscript.json'));return '{}';
    }
    if(executable==='bash'){
      probes++;const request=JSON.parse(args[3])[0];assert.equal(request.runNonce,NONCE);assert.equal(request.sourceSha,'a'.repeat(40));
      assert.deepEqual(request.runtimeFunctionHashes,expected);fs.writeFileSync(args[2],JSON.stringify({response:value}));
      if(expireAtCommand==='probe')coordinatorNow=NOW+600000;return '';
    }
    if(executable==='gcloud'){gcloudCalls++;return 'synthetic-access-token';}
    throw Error('Unexpected test command');
  };
  try{
    const evidence=await coordinator.run({repo:ROOT,temporary,sourceSha:'a'.repeat(40),run,now:()=>NOW,nonceFactory:()=>NONCE,
      readback:(plan,nonce,token,unused,window)=>canonical.readback(plan,nonce,token,syntheticFetcher(f,[]),window)});
    assert.equal(probes,1);assert.equal(pulls,2);assert.equal(evidence.status,'PASS');
    assert.equal(evidence.publishedVersionStable,true);assert.equal(evidence.canonicalMaterialization.documentsRead,12);
    assert.doesNotMatch(JSON.stringify(evidence),/synthetic-file|synthetic-access-token|canonicalReadbackPlan/);
    drift=true;deploymentReads=0;
    await assert.rejects(coordinator.run({repo:ROOT,temporary,sourceSha:'a'.repeat(40),run,now:()=>NOW,nonceFactory:()=>NONCE,
      readback:(plan,nonce,token,unused,window)=>canonical.readback(plan,nonce,token,syntheticFetcher(f,[]),window)}),/PROBE_PUBLISHED_VERSION_CHANGED/);
    drift=false;deploymentReads=0;expireAtCommand='deployment';const probesBeforeExpiry=probes;
    await assert.rejects(coordinator.run({repo:ROOT,temporary,sourceSha:'a'.repeat(40),run,now:()=>coordinatorNow,nonceFactory:()=>NONCE}),/PROBE_WINDOW_EXPIRED/);
    assert.equal(probes,probesBeforeExpiry);
    coordinatorNow=NOW;expireAtCommand='probe';const tokensBeforeExpiry=gcloudCalls;
    await assert.rejects(coordinator.run({repo:ROOT,temporary,sourceSha:'a'.repeat(40),run,now:()=>coordinatorNow,nonceFactory:()=>NONCE}),/PROBE_WINDOW_EXPIRED/);
    assert.equal(gcloudCalls,tokensBeforeExpiry);
  }finally{
    if(previous.ref===undefined)delete process.env.GITHUB_REF;else process.env.GITHUB_REF=previous.ref;
    if(previous.sha===undefined)delete process.env.GITHUB_SHA;else process.env.GITHUB_SHA=previous.sha;
    removeOwnTemporary(temporary,'aurora-probe-coordinator-fixture-');
  }
});
test('existing wrapper has a private seam and workflow is protected dispatch-only without publish or global workflow reuse',()=>{
  const source=fs.readFileSync(path.join(ROOT,'src/35_AURORA_FIRESTORE_BRIDGE_WMGJ.gs'),'utf8');
  assert.match(source,/function wmgjFirestoreEnviarEventoComConfig_\(event, cfg, logger, beforeRequest\)/);
  const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/aurora-cloud-synthetic-hml.yml'),'utf8');
  for(const text of ['workflow_dispatch:','environment: firebase-homologation',"inputs.expected_sha == github.sha",'CLASPRC_JSON','vars.GCP_WIF_PROVIDER','vars.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT','aurora-cloud-synthetic-probe.cjs'])assert.ok(workflow.includes(text));
  assert.doesNotMatch(workflow,/clasp push|clasp redeploy|clasp deploy |aurora-rc11-recovery|newTrigger|secrets versions add/);
});
