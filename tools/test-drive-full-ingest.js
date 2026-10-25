const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {stripTypeScriptTypes} = require('node:module');
const root = path.resolve(__dirname, '..');
const code = ['01_PIPELINE_CONFIABILIDADE_WMGJ.gs','04_EXTRACAO_DOCUMENTAL_WMGJ.gs'].map(n=>fs.readFileSync(path.join(root,'src',n),'utf8')).join('\n');
const backendIdempotency={};
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path.join(root,'firebase-migration/functions/src/idempotency.ts'),'utf8'))
  .replace(/^export /gm,''),backendIdempotency);
const H='a'.repeat(64), ORG='synthetic';
function fixture() {
  const props=new Map(), tokens=new Map(), files=new Map(), folders=new Map(),receipts=new Map(),entities=new Map(),sent=[];
  const head=['DATA_ENTRADA','ORIGEM','ID_ORIGEM','NOME_ARQUIVO','MIME_TYPE','STATUS','TENTATIVAS','ACAO_SUGERIDA','ULTIMO_ERRO','OBSERVACAO'];
  const rows=[head];let serial=0,eventSerial=0;
  const sheet={getDataRange:()=>({getValues:()=>rows.map(r=>r.slice())}),getLastRow:()=>rows.length,
    appendRow:r=>rows.push(r.slice()),getRange:(r,c)=>({setValue:v=>{rows[r-1][c-1]=v;}})};
  const property={getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)};
  props.set('WMGJ_FIRESTORE_ORG_ID',ORG);
  function iterator(array,index=0) {return {hasNext:()=>index<array.length,next:()=>array[index++],getContinuationToken:()=>{const t='cursor-'+(++serial);tokens.set(t,{array,index});return t;}};}
  function addFolder(id,parent,children=[]) {
    const f={getId:()=>id,getFiles:()=>iterator(children.filter(x=>files.has(x)).map(x=>files.get(x))),getFolders:()=>iterator(children.filter(x=>folders.has(x)).map(x=>folders.get(x))),getParents:()=>iterator(parent?[folders.get(parent)]:[])};
    folders.set(id,f);return f;
  }
  function addFile(id,parent,text='real extracted text',mime='text/plain') {
    const f={getId:()=>id,getName:()=>id,getMimeType:()=>mime,getLastUpdated:()=>new Date(10000),getSize:()=>text.length,
      getParents:()=>iterator(parent?[folders.get(parent)]:[]),_text:text};files.set(id,f);return f;
  }
  const context=vm.createContext({console,Date,JSON,Number,Array,Object,String,Math,Error,
    PropertiesService:{getScriptProperties:()=>property},
    DriveApp:{getFileById:id=>{if(!files.has(id))throw Error('MISSING_FILE');return files.get(id);},getFolderById:id=>{if(!folders.has(id))throw Error('MISSING_FOLDER');return folders.get(id);},
      continueFileIterator:t=>{const x=tokens.get(t);if(!x)throw Error('CURSOR_EXPIRED');return iterator(x.array,x.index);},
      continueFolderIterator:t=>{const x=tokens.get(t);if(!x)throw Error('CURSOR_EXPIRED');return iterator(x.array,x.index);}},
    SpreadsheetApp:{},MimeType:{GOOGLE_DOCS:'application/vnd.google-apps.document',
      GOOGLE_SHEETS:'application/vnd.google-apps.spreadsheet',PLAIN_TEXT:'text/plain',PDF:'application/pdf'},Utilities:{sleep:()=>{}}});
  vm.runInContext(code,context);
  const realExtract=context.extrairConteudoArquivoWMGJ_V1_;
  context.garantirAbasControleExtracaoWMGJ_V1_=()=>{};
  context.getConfigWMGJ_Compat_=()=>({SHEETS:{FILA:'queue'}});
  context.getPlanilhaWMGJ_Compat_=()=>({getSheetByName:()=>sheet});
  context.wmgjFirestoreHashArquivo_=file=>({value:crypto.createHash('sha256').update(file._text).digest('hex'),method:'content_sha256'});
  context.wmgjFirestoreHashString_=text=>crypto.createHash('sha256').update(text).digest('hex');
  context.extrairConteudoArquivoWMGJ_V1_=file=>({ok:true,metodo:'blob_text',texto:file._text,tamanhoTexto:file._text.length});
  context.wmgjFirestoreEventoArquivo_=(file,classification)=>{
    assert.equal(classification.valor_total,null);assert.equal(classification.competencia,null);assert.equal(classification.confianca,0);
    eventSerial++;
    return {orgId:ORG,sourceVersion:file.getLastUpdated().getTime(),eventId:'event-'+file.getId()+'-'+eventSerial,
      occurredAt:new Date(100000+eventSerial).toISOString(),entityType:'sourceDocument',entityKey:'DRIVE:'+file.getId(),
      source:{system:'DRIVE',sourceId:file.getId(),contentHash:context.wmgjFirestoreHashArquivo_(file).value},record:{canonicalSnapshotHash:H},metadata:{}};
  };
  context.wmgjFirestoreEnviarEventoComConfig_=(event,cfg,logger,check)=>{
    check();sent.push(event);const key=event.idempotencyKey;
    assert.equal(typeof key,'string');
    const payloadHash=crypto.createHash('sha256').update(JSON.stringify(backendIdempotency.semanticEventForIdempotency(event))).digest('hex');
    const decision=backendIdempotency.decideIdempotency(receipts.get(key),payloadHash);
    if(decision.kind==='CONFLICT')throw Error('IDEMPOTENCY_CONFLICT');
    if(decision.kind==='DUPLICATE')return {...decision,accepted:false,duplicate:true};
    const previous=entities.get(event.entityKey);
    if(backendIdempotency.decideSourceVersion(previous?.sourceVersion,event.sourceVersion)!=='ACCEPT')throw Error('SOURCE_VERSION_CONFLICT');
    const revision=(previous?.revision||0)+1;
    const receipt={accepted:true,duplicate:false,entityId:crypto.createHash('sha256').update(event.entityKey).digest('hex').slice(0,48),
      eventId:event.eventId,revision,versionId:crypto.createHash('sha256').update(event.entityKey+':'+revision).digest('hex')};
    receipts.set(key,{...receipt,payloadHash});entities.set(event.entityKey,{sourceVersion:event.sourceVersion,revision});return receipt;
  };
  context.registrarExtracaoDocumentalWMGJ_V1_=()=>{};context.registrarFirestoreMirrorWMGJ_=()=>{};
  const options={orgId:ORG,scopeSha256:H,sources:[],fileIds:[],excludedFolderIds:[],maxScan:1,processLimit:0,
    config:{orgId:ORG,dryRun:false},deadlineMs:Date.now()+140000};
  return {context,props,tokens,files,folders,rows,sent,receipts,entities,addFile,addFolder,options,realExtract};
}

function addAuthenticatedWrapper(f) {
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  f.context.Utilities.DigestAlgorithm={SHA_256:'sha256'};f.context.Utilities.Charset={UTF_8:'utf8'};
  f.context.Utilities.computeDigest=(_algorithm,value)=>[...crypto.createHash('sha256').update(value).digest()];
  f.context.Session={getActiveUser:()=>({getEmail:()=> 'owner@fixture.test'}),getEffectiveUser:()=>({getEmail:()=> 'owner@fixture.test'})};
  f.context.ScriptApp={getProjectTriggers(){throw Error('TRIGGER_READ_FORBIDDEN');},newTrigger(){throw Error('TRIGGER_WRITE_FORBIDDEN');}};
  f.context.Logger={log(){throw Error('LOG_FORBIDDEN');}};
  f.context.wmgjFirestoreConfig_=()=>({orgId:ORG,url:'https://synthetic.example/ingestWmgjEvent',keyId:'synthetic-key',secret:'d'.repeat(64),dryRun:true,maxRows:50});
  let locked=false;
  f.context.comTravaIngestaoGmailWMGJ_=callback=>{assert.equal(locked,false);locked=true;try{return callback();}finally{locked=false;}};
  const process=f.context.auroraProcessarFilaDriveAutorizada_;
  f.context.auroraProcessarFilaDriveAutorizada_=(...args)=>{assert.equal(locked,true);return process(...args);};
  vm.runInContext(fs.readFileSync(path.join(root,'src/37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'utf8'),f.context);
  f.context.AURORA_CONNECTOR_REUSE_OWNER_HASH=hash('owner@fixture.test');
  return request=>JSON.parse(JSON.stringify(f.context.auroraExecutarIngestaoDriveAutorizada(request)));
}

test('PROCESS_EXISTING resumes 245 scoped documents, preserves 43 legacy rows and never enumerates or advances the scanner',()=>{
  const f=fixture(),call=addAuthenticatedWrapper(f),rootId='synthetic-root-00001';
  const folder=f.addFolder(rootId,null,[]);
  folder.getFiles=()=>{throw Error('ENUMERATION_FORBIDDEN');};folder.getFolders=()=>{throw Error('ENUMERATION_FORBIDDEN');};
  f.context.auroraExecutarCicloDriveAutorizado_=()=>{throw Error('SCANNER_FORBIDDEN');};
  f.context.garantirAbasControleExtracaoWMGJ_V1_=()=>{throw Error('SHEET_CREATION_FORBIDDEN');};
  const request={mode:'PREVIEW',orgId:ORG,sources:[{sourceId:'drive-primary',system:'DRIVE',folderId:rootId,active:true,slaMinutes:1440}],
    fileIds:[],excludedFolderIds:[],maxScan:300,limit:20,expectedScopeSha256:null};
  const preview=call(request);assert.equal(preview.ok,true);const scopeHash=preview.scopeSha256;
  for(let n=0;n<43;n++)f.rows.push(['2026-09-01','DRIVE','legacy-file-'+String(n).padStart(4,'0'),'private legacy name',
    'text/plain',n<38?'EXTRAINDO':'CLASSIFICANDO',2,'','',n<38?'Extração real iniciada':'Conteúdo extraído por blob_text']);
  const legacy=JSON.stringify(f.rows.slice(1));
  for(let n=0;n<245;n++) {
    const fileId='scoped-file-'+String(n).padStart(4,'0');f.addFile(fileId,rootId,'synthetic extracted content '+n);
    const metadata={schemaVersion:1,orgId:ORG,scopeSha256:scopeHash,sourceId:'drive-primary',rootId,folderId:rootId,
      fileId,explicit:false,sourceVersion:'10000',coverage:'PENDING_EXTRACTION'};
    f.rows.push(['2026-10-23','DRIVE',fileId,'private scoped name','text/plain','PENDENTE',0,'','',f.context.auroraDriveScopeWrite_(metadata)]);
  }
  const foreign=['2026-10-23','DRIVE','other-org-file-00001','private other org','text/plain','PENDENTE',0,'','',
    f.context.auroraDriveScopeWrite_({orgId:'other',scopeSha256:scopeHash,fileId:'other-org-file-00001'})];
  f.rows.push(foreign.slice());
  const cursorKey='AURORA_DRIVE_CURSOR_'+ORG+'_'+scopeHash.slice(0,24);
  const savedCursor=JSON.stringify({schemaVersion:1,scopeSha256:scopeHash,explicitIndex:0,rootIndex:1,
    stack:[{folderId:rootId,rootId,sourceId:'drive-primary',stage:'FILES',token:'PRIVATE_BLOCKED_TOKEN'}],
    scanned:255,folders:1,excluded:0,complete:false});
  f.props.set(cursorKey,savedCursor);f.props.set('WMGJ_FIRESTORE_DRY_RUN','true');
  const processRequest={...request,mode:'PROCESS_EXISTING',expectedScopeSha256:scopeHash};
  // The first successful response is deliberately not consumed by the coordinator.
  const lostResponse=call(processRequest);assert.equal(lostResponse.processing.accepted,20);
  let result,batches=1;
  do {
    result=call(processRequest);batches++;
    assert.equal(result.ok,true);assert.equal(result.scopeSha256,scopeHash);
    assert.equal(result.scan.examined,0);assert.equal(result.scan.queued,0);assert.equal(result.scan.complete,false);
    assert.equal(result.processing.replayVerified,result.privateReadbackPlan.length);
  } while(result.processing.pending>0 && batches<20);
  assert.equal(batches,13);assert.equal(result.processing.pending,0);assert.equal(f.entities.size,245);
  assert.equal(f.sent.length,490);assert.equal(f.tokens.size,0);
  assert.equal(JSON.stringify(f.rows.slice(1,44)),legacy);assert.deepEqual(f.rows.at(-1),foreign);
  assert.equal(f.props.get(cursorKey),savedCursor);assert.equal(f.props.get('WMGJ_FIRESTORE_DRY_RUN'),'true');
  const empty=call(processRequest);assert.equal(empty.processing.attempted,0);assert.equal(empty.processing.pending,0);
  assert.equal(empty.scan.complete,false);assert.equal(empty.fullSynchronizationVerified,false);
  let offset=0,recovered=0,page;
  do {
    page=call({...request,mode:'READBACK',expectedScopeSha256:scopeHash,readbackOffset:offset});
    assert.equal(page.ok,true);assert.equal(page.coverage.total,245);assert.equal(page.coverage.pending,0);
    assert.equal(page.coverage.documents,245);assert.equal(page.cursorDiagnostics.cursor.complete,false);
    recovered+=page.privateReadbackPlan.length;offset=page.coverage.nextOffset;
  } while(offset!==null);
  assert.equal(recovered,245);assert.equal(page.coverage.complete,true);
  assert.equal(page.scan.complete,false);assert.equal(page.fullSynchronizationVerified,false);
  assert.equal(f.props.get(cursorKey),savedCursor);assert.equal(JSON.stringify(f.rows.slice(1,44)),legacy);
});
test('recursive cursor resumes beyond duplicates and preserves one row per source',()=>{
  const f=fixture();f.addFile('file000000001','folder000001');f.addFile('file000000002','folder000002');
  f.addFolder('folder000002','folder000001',['file000000002']);f.addFolder('folder000001',null,['file000000001','folder000002']);
  f.options.sources=[{sourceId:'drive-primary',folderId:'folder000001',system:'DRIVE'}];
  let result;for(let i=0;i<8;i++)result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.enumerationComplete,true);assert.equal(f.rows.length,3);
  assert.equal(result.fullSynchronizationVerified,false);
});
test('explicit documents precede root enumeration and excluded folders remain unread',()=>{
  const f=fixture();f.addFile('fileexplicit1',null);f.addFile('filesecret001','excluded0001');
  f.addFolder('excluded0001','folder000001',['filesecret001']);f.addFolder('folder000001',null,['excluded0001']);
  f.options.fileIds=['fileexplicit1'];f.options.sources=[{sourceId:'drive-primary',folderId:'folder000001'}];f.options.excludedFolderIds=['excluded0001'];
  for(let i=0;i<5;i++)f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(f.rows.length,2);assert.equal(f.rows[1][2],'fileexplicit1');
});
test('a lost cursor write replays the same source without a second queue row',()=>{
  const f=fixture();f.addFile('fileexplicit1',null);f.options.fileIds=['fileexplicit1'];
  f.context.auroraExecutarCicloDriveAutorizado_(f.options);f.props.delete('AURORA_DRIVE_CURSOR_'+ORG+'_'+H.slice(0,24));
  f.context.auroraExecutarCicloDriveAutorizado_(f.options);assert.equal(f.rows.length,2);
});
test('extraction sends a review-only document and deduplicates equal bytes without another OCR/send',()=>{
  const f=fixture();f.addFile('fileexplicit1',null,'R$ 123.456,78 not an approved fact');f.addFile('fileexplicit2',null,'R$ 123.456,78 not an approved fact');
  f.options.fileIds=['fileexplicit1','fileexplicit2'];f.options.maxScan=2;f.options.processLimit=2;
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.process.processed,1);assert.equal(result.process.accepted,1);assert.equal(result.process.duplicates,0);assert.equal(result.process.aliases,1);assert.equal(f.sent.length,2);
  assert.equal(f.rows[1][5],'REVISAR_HUMANO');assert.equal(f.rows[2][5],'DUPLICADO');
  assert.equal(f.sent[0].record.extractionEvidence.financialFactsApproved,false);
  assert.match(result.privateReadbackPlan[0].textSha256,/^[a-f0-9]{64}$/);
});
test('failed extraction remains pending and does not starve later files',()=>{
  const f=fixture();f.addFile('fileexplicit1',null,'fail');f.addFile('fileexplicit2',null,'success');
  f.options.fileIds=['fileexplicit1','fileexplicit2'];f.options.maxScan=2;f.options.processLimit=1;
  const extraction=f.context.extrairConteudoArquivoWMGJ_V1_;f.context.extrairConteudoArquivoWMGJ_V1_=file=>file._text==='fail'?{ok:false}:extraction(file);
  let result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);assert.equal(result.process.pending,2);assert.equal(result.ok,true);assert.equal(f.sent.length,0);
  result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);assert.equal(result.process.processed,1);assert.equal(f.rows[1][5],'ERRO_REPROCESSAR');
});
test('folder moved outside authorized root is rejected before extraction',()=>{
  const f=fixture();f.addFile('file000000001','folder000002');f.addFolder('folder000002','folder000001',['file000000001']);f.addFolder('folder000001',null,['folder000002']);
  f.options.sources=[{sourceId:'drive-primary',folderId:'folder000001'}];f.options.maxScan=10;
  f.context.auroraExecutarCicloDriveAutorizado_(f.options);f.addFolder('folder000002',null,['file000000001']);f.options.processLimit=1;
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);assert.equal(result.process.pending,1);assert.equal(f.sent.length,0);
});
test('Sheets extraction includes rows beyond 200 and fails explicitly at bounded limits',()=>{
  const f=fixture(),calls=[];f.context.SpreadsheetApp.openById=()=>({getSheets:()=>[{getName:()=> 'sheet',getLastRow:()=>401,getLastColumn:()=>1,
    getRange:(start,col,count)=>{calls.push([start,count]);return {getDisplayValues:()=>Array.from({length:count},(_,i)=>['row'+(start+i)])};}}]});
  const text=f.context.auroraExtrairTextoSheetsCompleto_('sheetid');assert.match(text,/row401/);assert.equal(calls.length,3);
  f.context.SpreadsheetApp.openById=()=>({getSheets:()=>[{getName:()=> 'sheet',getLastRow:()=>1000001,getLastColumn:()=>1}]});
  assert.throws(()=>f.context.auroraExtrairTextoSheetsCompleto_('sheetid'),/CELL_LIMIT/);
});

test('readback plan matches original file, hashes and stable replay revision',()=>{
  const f=fixture();f.addFile('fileexplicit1',null);f.options.fileIds=['fileexplicit1'];f.options.processLimit=1;
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options),receipt=result.privateReadbackPlan[0];
  assert.equal(result.process.attempted,1);assert.equal(result.process.pending,0);assert.equal(result.process.review,1);
  assert.equal(result.process.accepted+result.process.duplicates,result.privateReadbackPlan.length);
  assert.equal(receipt.sourceId,'fileexplicit1');assert.equal(receipt.contentHash,receipt.contentSha256);
  assert.equal(receipt.sourceVersion,10000);assert.equal(receipt.revision,1);assert.equal(receipt.replayVerified,true);
  assert.equal(f.sent[0],f.sent[1]);assert.equal(f.sent[0].metadata.extractionEvidence,undefined);
});
test('replay divergence is blocking and never emits a successful readback',()=>{
  const f=fixture();f.addFile('fileexplicit1',null);f.options.fileIds=['fileexplicit1'];f.options.processLimit=1;
  const send=f.context.wmgjFirestoreEnviarEventoComConfig_;let count=0;
  f.context.wmgjFirestoreEnviarEventoComConfig_=(...args)=>{const receipt=send(...args);if(++count===2)receipt.revision=2;return receipt;};
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.ok,false);assert.equal(result.process.blockingErrors,1);assert.equal(result.process.pending,1);
  assert.equal(result.privateReadbackPlan.length,0);assert.match(f.rows[1][8],/REPLAY_NOT_IDEMPOTENT/);
});
test('authority callback is required before each HMAC transmission and fails closed',()=>{
  const f=fixture();f.addFile('fileexplicit1',null);f.options.fileIds=['fileexplicit1'];f.options.processLimit=1;
  let checks=0;f.options.beforeRequest=()=>{if(++checks===3)throw Error('REVOKED');};
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.ok,false);assert.equal(checks,3);assert.equal(f.sent.length,1);assert.equal(result.process.pending,1);
});
test('expired continuation restarts a folder and reaches remaining source without duplicates',()=>{
  const f=fixture();f.addFile('file000000001','folder000001');f.addFile('file000000002','folder000001');
  f.addFolder('folder000001',null,['file000000001','file000000002']);f.options.sources=[{sourceId:'drive-primary',folderId:'folder000001'}];
  f.context.auroraExecutarCicloDriveAutorizado_(f.options);f.tokens.clear();
  let result;for(let i=0;i<6;i++) result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.enumerationComplete,true);assert.equal(f.rows.length,3);
});
test('source changed after completed scan refreshes authorized queue version and proceeds',()=>{
  const f=fixture();const file=f.addFile('fileexplicit1',null);f.options.fileIds=['fileexplicit1'];f.options.maxScan=10;
  const scan=f.context.auroraExecutarCicloDriveAutorizado_(f.options);assert.equal(scan.enumerationComplete,true);
  file.getLastUpdated=()=>new Date(20000);f.options.processLimit=1;
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.ok,true);assert.equal(result.process.processed,1);assert.equal(result.privateReadbackPlan[0].sourceVersion,20000);
});
test('retry after accepted write preserves semantic idempotency despite a new event ID and time',()=>{
  const f=fixture();f.addFile('fileexplicit1',null,'same bytes');
  f.options.fileIds=['fileexplicit1'];f.options.maxScan=10;f.options.processLimit=1;
  let failPersistence=true;
  f.context.registrarExtracaoDocumentalWMGJ_V1_=()=>{if(failPersistence){failPersistence=false;throw Error('PERSISTENCE_INTERRUPTED');}};
  const interrupted=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(interrupted.ok,false);assert.equal(f.entities.get('DRIVE:fileexplicit1').revision,1);
  const retried=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(retried.ok,true);assert.equal(retried.process.accepted,0);assert.equal(retried.process.duplicates,1);
  assert.equal(retried.privateReadbackPlan[0].sourceVersion,10000);assert.equal(retried.privateReadbackPlan[0].revision,1);
  assert.equal(f.sent[0].idempotencyKey,f.sent[2].idempotencyKey);
  assert.match(f.sent[0].idempotencyKey,/:drive-extraction-v1:10000:/);
  assert.notEqual(f.sent[0].eventId,f.sent[2].eventId);assert.notEqual(f.sent[0].occurredAt,f.sent[2].occurredAt);
  assert.equal(JSON.stringify(backendIdempotency.semanticEventForIdempotency(f.sent[0])),
    JSON.stringify(backendIdempotency.semanticEventForIdempotency(f.sent[2])));
  assert.equal(f.receipts.size,1);assert.equal(f.entities.get('DRIVE:fileexplicit1').revision,1);
});
test('new source version with unchanged bytes gets a new key and canonical revision on retry',()=>{
  const f=fixture();const file=f.addFile('fileexplicit1',null,'same bytes');
  f.options.fileIds=['fileexplicit1'];f.options.maxScan=10;f.options.processLimit=1;
  let failPersistence=true;
  f.context.registrarExtracaoDocumentalWMGJ_V1_=()=>{if(failPersistence){failPersistence=false;throw Error('PERSISTENCE_INTERRUPTED');}};
  const interrupted=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(interrupted.ok,false);file.getLastUpdated=()=>new Date(20000);
  const retried=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(retried.ok,true);assert.equal(retried.process.accepted,1);assert.equal(retried.process.duplicates,0);
  assert.equal(retried.privateReadbackPlan[0].sourceVersion,20000);assert.equal(retried.privateReadbackPlan[0].revision,2);
  assert.equal(f.sent[0].source.contentHash,f.sent[2].source.contentHash);
  assert.notEqual(f.sent[0].idempotencyKey,f.sent[2].idempotencyKey);
  assert.equal(f.sent[0].entityKey,f.sent[2].entityKey);assert.equal(f.receipts.size,2);
  assert.deepEqual(f.entities.get('DRIVE:fileexplicit1'),{sourceVersion:20000,revision:2});
  const oldKeyEvent={...f.sent[2],idempotencyKey:f.sent[0].idempotencyKey};
  const oldKeyPayloadHash=crypto.createHash('sha256').update(JSON.stringify(backendIdempotency.semanticEventForIdempotency(oldKeyEvent))).digest('hex');
  assert.equal(backendIdempotency.decideIdempotency(f.receipts.get(f.sent[0].idempotencyKey),oldKeyPayloadHash).kind,'CONFLICT');
});
test('durable readback plan recovers receipts and content aliases after lost coordinator response',()=>{
  const f=fixture();f.addFile('fileexplicit1',null,'same');f.addFile('fileexplicit2',null,'same');
  f.options.fileIds=['fileexplicit1','fileexplicit2'];f.options.maxScan=10;f.options.processLimit=2;
  f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  const next=f.context.auroraExecutarCicloDriveAutorizado_(f.options);assert.equal(next.privateReadbackPlan.length,0);
  const first=f.context.auroraLerPlanoReadbackDriveAutorizado_({...f.options,readbackOffset:0,readbackLimit:1});
  assert.equal(first.coverage.documents,1);assert.equal(first.coverage.aliases,1);assert.equal(first.coverage.pending,0);assert.equal(first.coverage.total,2);
  assert.equal(first.privateReadbackPlan.length,1);assert.equal(first.coverage.complete,false);
  const second=f.context.auroraLerPlanoReadbackDriveAutorizado_({...f.options,readbackLimit:1,readbackOffset:first.coverage.nextOffset});
  assert.equal(second.privateAliasRows.length,1);assert.equal(second.privateAliasRows[0].primaryFileId,'fileexplicit1');
  assert.equal(second.privateAliasRows[0].fileId,'fileexplicit2');assert.equal(second.coverage.complete,true);
  assert.equal(second.fullSynchronizationVerified,false);
});

test('READBACK coverage keeps receipts without replay proof pending',()=>{
  const f=fixture();f.addFile('fileexplicit1',null);f.options.fileIds=['fileexplicit1'];f.options.maxScan=10;f.options.processLimit=1;
  f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  const scope=f.context.auroraDriveScopeRead_(f.rows[1][9]);scope.receipt.replayVerified=false;
  f.rows[1][9]=f.context.auroraDriveScopeWrite_(scope);
  const page=f.context.auroraLerPlanoReadbackDriveAutorizado_({...f.options,readbackOffset:0});
  assert.equal(page.coverage.total,1);assert.equal(page.coverage.pending,1);assert.equal(page.coverage.documents,0);
  assert.equal(page.coverage.pagePending,1);assert.equal(page.privateReadbackPlan.length,0);
  assert.equal(page.fullSynchronizationVerified,false);
});
test('READBACK rejects a proven document or alias attached to a different queue source identifier',()=>{
  for(const rowIndex of [1,2]){
    const f=fixture();f.addFile('fileexplicit1',null,'same');f.addFile('fileexplicit2',null,'same');
    f.options.fileIds=['fileexplicit1','fileexplicit2'];f.options.maxScan=10;f.options.processLimit=2;
    f.context.auroraExecutarCicloDriveAutorizado_(f.options);
    f.rows[rowIndex][2]='unrelated-source-0001';
    assert.throws(()=>f.context.auroraLerPlanoReadbackDriveAutorizado_({...f.options,readbackOffset:0}),
      /AURORA_DRIVE_QUEUE_SCOPE_INVALID/);
  }
});
test('READBACK diagnoses only scoped queue metadata without processing, changing attempts, or exposing free-form fields',()=>{
  const f=fixture(),call=addAuthenticatedWrapper(f),rootId='diagnostic-root-00001';
  const folder=f.addFolder(rootId,null,[]);
  folder.getFiles=()=>{throw Error('ENUMERATION_FORBIDDEN');};folder.getFolders=()=>{throw Error('ENUMERATION_FORBIDDEN');};
  f.context.auroraExecutarCicloDriveAutorizado_=()=>{throw Error('SCANNER_FORBIDDEN');};
  f.context.auroraProcessarFilaDriveAutorizada_=()=>{throw Error('PROCESSOR_FORBIDDEN');};
  f.context.extrairConteudoArquivoWMGJ_V1_=()=>{throw Error('EXTRACTION_FORBIDDEN');};
  const request={mode:'PREVIEW',orgId:ORG,sources:[{sourceId:'drive-primary',system:'DRIVE',folderId:rootId,active:true,slaMinutes:1440}],
    fileIds:[],excludedFolderIds:[],maxScan:300,limit:2,expectedScopeSha256:null};
  const preview=call(request);assert.equal(preview.ok,true);const scopeHash=preview.scopeSha256;
  for(let n=0;n<3;n++){
    const fileId='diagnostic-file-'+n,scope={schemaVersion:1,orgId:ORG,scopeSha256:scopeHash,fileId,
      sourceVersion:'10000',coverage:'PENDING_EXTRACTION'};
    if(n===0)scope.lastCode='AURORA_SHEETS_TEXT_LIMIT';
    if(n===1)scope.lastCode='SECRET_CUSTOMER_TOKEN';
    f.rows.push(['2026-10-23','DRIVE',fileId,'PRIVATE_NAME',n===0?'application/vnd.google-apps.spreadsheet':n===1?'application/zip':'PRIVATE_MIME',
      n===2?'PRIVATE_STATUS':'ERRO_REPROCESSAR',n===2?'':3,'PRIVATE_ACTION','PRIVATE_FREE_FORM_ERROR',f.context.auroraDriveScopeWrite_(scope)]);
  }
  f.rows.push(['2026-10-23','DRIVE','other-org-file-001','PRIVATE_OTHER','text/plain','PENDENTE',0,'','',
    f.context.auroraDriveScopeWrite_({orgId:'other',scopeSha256:scopeHash})]);
  f.rows.push(['2026-09-01','DRIVE','legacy-file-001','PRIVATE_LEGACY','text/plain','EXTRAINDO',2,'','','legacy observation']);
  const beforeRows=JSON.stringify(f.rows),beforeProperties=JSON.stringify([...f.props]);
  const first=call({...request,mode:'READBACK',expectedScopeSha256:scopeHash,readbackOffset:0});
  assert.equal(first.ok,true);assert.equal(first.coverage.pending,3);assert.equal(first.privatePendingRows.length,2);
  assert.equal(first.privatePendingRows[0].code,'AURORA_SHEETS_TEXT_LIMIT');
  assert.equal(first.privatePendingRows[0].mediaType,'GOOGLE_SHEETS');assert.equal(first.privatePendingRows[0].attempts,3);
  assert.equal(first.privatePendingRows[1].code,'UNKNOWN');assert.equal(first.privatePendingRows[1].mediaType,'ZIP');
  const last=call({...request,mode:'READBACK',expectedScopeSha256:scopeHash,readbackOffset:2});
  assert.equal(last.ok,true);assert.equal(last.coverage.complete,true);assert.equal(last.coverage.pagePending,1);
  assert.equal(last.privatePendingRows[0].code,'NOT_RECORDED');assert.equal(last.privatePendingRows[0].queueStatus,'UNKNOWN');
  assert.equal(last.privatePendingRows[0].attempts,null);assert.equal(last.privatePendingRows[0].mediaType,'OTHER');
  assert.ok(!JSON.stringify([first,last]).includes('PRIVATE'));assert.ok(!JSON.stringify([first,last]).includes('SECRET'));
  assert.equal(JSON.stringify(f.rows),beforeRows);assert.equal(JSON.stringify([...f.props]),beforeProperties);
  assert.equal(f.sent.length,0);assert.equal(f.entities.size,0);assert.equal(last.fullSynchronizationVerified,false);
  f.rows[1][2]='mismatched-file-0001';
  const invalid=call({...request,mode:'READBACK',expectedScopeSha256:scopeHash,readbackOffset:0});
  assert.equal(invalid.ok,false);assert.equal(invalid.code,'AURORA_DRIVE_QUEUE_SCOPE_INVALID');
});
test('pending diagnostic transport codes are normalized only for closed forms and versions remain unknown when invalid',()=>{
  const f=fixture(),idx={ID_ORIGEM:0,STATUS:1,TENTATIVAS:2,MIME_TYPE:3};
  const scope={fileId:'diagnostic-file-0001',sourceVersion:'not-a-version'},row=[scope.fileId,'PROCESSADO',0,'application/pdf'];
  for(const lastCode of ['FIRESTORE_INGEST_FAILED:INVALID_SUCCESS_RESPONSE',
    'FIRESTORE_INGEST_FAILED:HTTP_409:IDEMPOTENCY_CONFLICT','FIRESTORE_INGEST_FAILED:HTTP_OTHER:UNRECOGNIZED_RESPONSE']){
    const value=f.context.auroraDrivePendingDiagnostic_({...scope,lastCode},row,idx);
    assert.equal(value.code,'FIRESTORE_INGEST_FAILED');assert.equal(value.sourceVersion,null);assert.equal(value.attempts,0);
  }
  for(const lastCode of ['FIRESTORE_INGEST_FAILED:HTTP_409:SECRET_CUSTOMER_TOKEN',
    'FIRESTORE_INGEST_FAILED:HTTP_999:IDEMPOTENCY_CONFLICT','SECRET_CUSTOMER_TOKEN'])
    assert.equal(f.context.auroraDrivePendingDiagnostic_({...scope,lastCode},row,idx).code,'UNKNOWN');
});
test('twenty-item process cap uses the requested bounded throughput',()=>{
  const f=fixture();for(let i=0;i<8;i++){const id='explicitfile'+String(i).padStart(2,'0');f.addFile(id,null,'content '+i);f.options.fileIds.push(id);}
  f.options.maxScan=20;f.options.processLimit=20;
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.process.attempted,8);assert.equal(result.process.accepted,8);assert.equal(result.process.pending,0);
});

test('content dedup cannot reuse a canonical receipt outside the current authorized scope',()=>{
  const f=fixture();f.addFile('fileexplicit1',null,'same bytes');f.addFile('fileexplicit2',null,'same bytes');
  f.options.fileIds=['fileexplicit1'];f.options.maxScan=10;f.options.processLimit=1;
  f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  f.options.fileIds=['fileexplicit2'];f.options.scopeSha256='b'.repeat(64);
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.process.aliases,0);assert.equal(result.process.accepted,1);assert.equal(result.privateReadbackPlan[0].sourceId,'fileexplicit2');
  const readback=f.context.auroraLerPlanoReadbackDriveAutorizado_({...f.options,readbackOffset:0});
  assert.equal(readback.coverage.total,1);assert.equal(readback.coverage.documents,1);assert.equal(readback.coverage.aliases,0);
});

test('replacement characters or NUL in decoded plain text stay pending while valid documents continue',()=>{
  for(const character of ['\uFFFD','\u0000']) {
    const f=fixture();f.addFile('fileexplicit1',null,'unverified '+character+' decoded bytes');f.addFile('fileexplicit2',null,'valid UTF-8 document');
    f.options.fileIds=['fileexplicit1','fileexplicit2'];f.options.maxScan=10;f.options.processLimit=2;
    const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
    assert.equal(result.ok,true);assert.equal(result.process.accepted,1);assert.equal(result.process.pending,1);
    assert.equal(result.process.errors,1);assert.equal(result.process.blockingErrors,0);
    assert.equal(f.rows[1][5],'ERRO_REPROCESSAR');assert.equal(f.rows[1][8],'AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED');
    assert.equal(result.privateReadbackPlan[0].sourceId,'fileexplicit2');assert.equal(f.sent.length,2);
    const coverage=f.context.auroraLerPlanoReadbackDriveAutorizado_({...f.options,readbackOffset:0});
    assert.equal(coverage.coverage.documents,1);assert.equal(coverage.coverage.pending,1);
  }
});

test('XLSX and XLS convert to temporary Sheets and extract every populated tab before cleanup',()=>{
  for(const mime of ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel']) {
    const f=fixture(),copied=[],trashed=[],readRanges=[];
    const original=f.addFile('fileexcel0001',null,'binary workbook',mime);
    original.getName=()=>mime.endsWith('ms-excel')?'synthetic.XLS':'synthetic.xlsx';
    const temporary=f.addFile('temporarysheet01',null,'',f.context.MimeType.GOOGLE_SHEETS);
    temporary.setTrashed=value=>trashed.push([temporary.getId(),value]);
    f.context.Drive={Files:{copy:(resource,id,options)=>{copied.push({resource,id,options});
      return {id:temporary.getId(),mimeType:f.context.MimeType.GOOGLE_SHEETS};}}};
    f.context.SpreadsheetApp.openById=id=>{assert.equal(id,temporary.getId());return {getSheets:()=>[
      {getName:()=> 'First',getLastRow:()=>201,getLastColumn:()=>1,
        getRange:(start,col,count)=>{readRanges.push([start,count]);return {getDisplayValues:()=>Array.from({length:count},(_,i)=>['row'+(start+i)])};}},
      {getName:()=> 'Second',getLastRow:()=>1,getLastColumn:()=>1,getRange:()=>({getDisplayValues:()=>[['last tab value']]})}
    ]};};
    const result=f.realExtract(original);
    assert.equal(result.ok,true);assert.equal(result.metodo,'google_sheets_values');
    assert.equal(f.context.extracaoDocumentalCompletaWMGJ_(result),true);
    assert.match(result.texto,/row201/);assert.match(result.texto,/last tab value/);
    assert.deepEqual(readRanges,[[1,200],[201,1]]);
    assert.equal(copied.length,1);assert.equal(copied[0].id,original.getId());
    assert.equal(copied[0].resource.mimeType,f.context.MimeType.GOOGLE_SHEETS);
    assert.equal(copied[0].options.convert,true);assert.equal(copied[0].options.ocr,undefined);
    assert.deepEqual(trashed,[[temporary.getId(),true]]);
  }
});

test('Excel conversion failure reports fixed codes and cleans only the temporary copy',()=>{
  const f=fixture(),trashed=[];
  const original=f.addFile('fileexcel0001',null,'binary workbook','application/vnd.ms-excel');
  const temporary=f.addFile('temporarysheet01',null);temporary.setTrashed=value=>trashed.push(value);
  f.context.Drive={Files:{copy:()=>({id:temporary.getId(),mimeType:f.context.MimeType.GOOGLE_SHEETS})}};
  f.context.SpreadsheetApp.openById=()=>{throw Error('Service unavailable: PRIVATE_FILE_NAME PRIVATE_SOURCE_ID');};
  let result=f.realExtract(original);
  assert.equal(result.ok,false);assert.equal(result.code,'AURORA_DRIVE_CONVERSION_NOT_READY');assert.deepEqual(trashed,[true]);
  assert.equal(result.observacao.includes('PRIVATE_'),false);
  f.context.Drive.Files.copy=()=>{throw Error('User quota exceeded PRIVATE_FILE_NAME');};
  result=f.realExtract(original);assert.equal(result.code,'AURORA_DRIVE_EXTRACTION_QUOTA');
  f.context.Drive.Files.copy=()=>{throw Error('Permission denied PRIVATE_SOURCE_ID');};
  result=f.realExtract(original);assert.equal(result.code,'AURORA_DRIVE_EXTRACTION_AUTH_FAILED');
});

function setupPdfOcr(options={}) {
  const f=fixture(),copies=[],trashed=[],opened=[];
  const original=f.addFile('filepdf000001',null,'synthetic original PDF bytes',f.context.MimeType.PDF);
  original.getName=()=> 'synthetic.pdf';
  original.setTrashed=()=>{throw Error('ORIGINAL_MUST_NOT_BE_TRASHED');};
  const temporary=f.addFile('temporarypdf001',null,'',f.context.MimeType.GOOGLE_DOCS);
  temporary.setTrashed=value=>trashed.push({id:temporary.getId(),value});
  f.context.Drive={Files:{copy:(resource,id,parameters)=>{
    copies.push({resource,id,parameters});
    if(options.copyError) throw Error(options.copyError);
    // Verify the request contract; this fixture does not prove conversion of a real source.
    if(parameters.convert!==true) throw Error('PDF_CONVERSION_NOT_REQUESTED');
    return Object.prototype.hasOwnProperty.call(options,'copyResponse')?options.copyResponse:
      {id:temporary.getId(),mimeType:f.context.MimeType.GOOGLE_DOCS};
  }}};
  f.context.DocumentApp={openById:id=>{
    opened.push(id);assert.equal(id,temporary.getId());
    if(options.readError) throw Error(options.readError);
    return {getBody:()=>({getText:()=>options.text===undefined?'Texto do PDF extraído para revisão.':options.text})};
  }};
  f.context.extrairConteudoArquivoWMGJ_V1_=f.realExtract;
  f.options.fileIds=[original.getId()];f.options.maxScan=10;f.options.processLimit=1;
  return {f,original,temporary,copies,trashed,opened};
}

test('PDF OCR requests Drive v2 conversion and preserves original identity and replay',()=>{
  const {f,original,temporary,copies,trashed,opened}=setupPdfOcr();
  const contentHash=crypto.createHash('sha256').update(original._text).digest('hex');
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.ok,true);assert.equal(result.process.accepted,1);assert.equal(result.process.pending,0);
  assert.equal(copies.length,1);assert.equal(copies[0].id,original.getId());
  assert.equal(copies[0].resource.mimeType,f.context.MimeType.GOOGLE_DOCS);
  assert.equal(copies[0].parameters.convert,true);assert.equal(copies[0].parameters.ocr,true);
  assert.equal(copies[0].parameters.ocrLanguage,'pt');
  assert.deepEqual(opened,[temporary.getId()]);assert.deepEqual(trashed,[{id:temporary.getId(),value:true}]);
  assert.equal(f.sent.length,2);assert.equal(f.sent[0],f.sent[1]);
  const event=f.sent[0],receipt=result.privateReadbackPlan[0];
  assert.equal(event.source.sourceId,original.getId());assert.equal(event.source.contentHash,contentHash);
  assert.equal(event.record.extractionEvidence.method,'drive_api_ocr_convert');
  assert.equal(event.record.extractionEvidence.financialFactsApproved,false);
  assert.equal(event.record.extractionEvidence.coverage,'TEXT_EXTRACTED_REVIEW_PENDING');
  assert.equal(event.idempotencyKey,'synthetic:DRIVE:'+original.getId()+':drive-extraction-v1:10000:'+contentHash);
  assert.equal(receipt.sourceId,original.getId());assert.equal(receipt.sourceVersion,10000);
  assert.equal(receipt.contentHash,contentHash);assert.equal(receipt.replayVerified,true);
  assert.equal(f.rows[1][5],'REVISAR_HUMANO');
});

test('PDF OCR validates the converted identity and MIME before reading or cleaning it',()=>{
  for(const response of [null,{}, {id:'bad'}, {id:'filepdf000001',mimeType:'application/vnd.google-apps.document'},
    {id:'temporarypdf001',mimeType:'application/pdf'}]) {
    const {f,original,temporary,trashed,opened}=setupPdfOcr({copyResponse:response});
    const result=f.realExtract(original);
    assert.equal(result.ok,false);assert.equal(result.code,'AURORA_DRIVE_CONVERSION_UNSUPPORTED');
    assert.deepEqual(opened,[]);
    assert.deepEqual(trashed,response?.id===temporary.getId()?[{id:temporary.getId(),value:true}]:[]);
  }
});

test('PDF copy and document-read failures remain pending with sanitized stage codes',()=>{
  const cases=[
    {options:{copyError:'Service unavailable PRIVATE_FILE_NAME PRIVATE_SOURCE_ID'},code:'AURORA_DRIVE_CONVERSION_FAILED',temporary:false},
    {options:{readError:'Service unavailable PRIVATE_FILE_NAME PRIVATE_SOURCE_ID'},code:'AURORA_DRIVE_CONVERSION_NOT_READY',temporary:true},
    {options:{copyError:'User quota exceeded PRIVATE_FILE_NAME'},code:'AURORA_DRIVE_EXTRACTION_QUOTA',temporary:false}
  ];
  for(const item of cases) {
    const {f,temporary,trashed}=setupPdfOcr(item.options);
    const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
    assert.equal(result.ok,true);assert.equal(result.process.accepted,0);assert.equal(result.process.pending,1);
    assert.equal(result.process.errors,1);assert.equal(result.process.blockingErrors,0);
    assert.equal(f.sent.length,0);assert.equal(result.privateReadbackPlan.length,0);
    assert.equal(f.rows[1][5],'ERRO_REPROCESSAR');assert.equal(f.rows[1][8],item.code);
    assert.equal(f.rows[1][8].includes('PRIVATE_'),false);
    assert.deepEqual(trashed,item.temporary?[{id:temporary.getId(),value:true}]:[]);
  }
  const denied=setupPdfOcr({copyError:'Permission denied PRIVATE_SOURCE_ID'});
  const result=denied.f.realExtract(denied.original);
  assert.equal(result.ok,false);assert.equal(result.code,'AURORA_DRIVE_EXTRACTION_AUTH_FAILED');
  assert.equal(result.observacao.includes('PRIVATE_'),false);assert.deepEqual(denied.trashed,[]);
  const unreadableIdentity=setupPdfOcr();
  unreadableIdentity.original.getId=()=>{throw Error('Permission denied PRIVATE_SOURCE_ID');};
  const identityFailure=unreadableIdentity.f.context.converterArquivoParaGoogleDocWMGJ_V1_(unreadableIdentity.original);
  assert.equal(identityFailure.ok,false);assert.equal(identityFailure.code,'AURORA_DRIVE_EXTRACTION_AUTH_FAILED');
  assert.equal(identityFailure.erro.includes('PRIVATE_'),false);
  assert.deepEqual(unreadableIdentity.copies,[]);assert.deepEqual(unreadableIdentity.trashed,[]);
});

test('an empty OCR document remains pending and its temporary copy is cleaned',()=>{
  const {f,temporary,trashed}=setupPdfOcr({text:''});
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.ok,true);assert.equal(result.process.accepted,0);assert.equal(result.process.pending,1);
  assert.equal(result.process.blockingErrors,0);assert.equal(f.sent.length,0);
  assert.equal(f.rows[1][8],'AURORA_DRIVE_EXTRACTION_EMPTY');
  assert.deepEqual(trashed,[{id:temporary.getId(),value:true}]);
});


test('PDF OCR prefers Drive v2 insert with source bytes when available',()=>{
  const {f,original,temporary,trashed,opened}=setupPdfOcr(),inserted=[];
  original.getBlob=()=>({getBytes:()=>Array.from(Buffer.from(original._text))});
  f.context.Drive.Files.insert=(resource,blob,parameters)=>{
    inserted.push({resource,blob,parameters});
    assert.deepEqual(blob.getBytes(),Array.from(Buffer.from(original._text)));
    return {id:temporary.getId(),mimeType:f.context.MimeType.GOOGLE_DOCS};
  };
  f.context.Drive.Files.copy=()=>{throw Error('COPY_MUST_NOT_RUN_WHEN_INSERT_EXISTS');};
  const result=f.realExtract(original);
  assert.equal(result.ok,true);assert.equal(result.metodo,'drive_api_ocr_convert');
  assert.equal(inserted.length,1);assert.equal(inserted[0].parameters.convert,true);
  assert.equal(inserted[0].parameters.ocr,true);assert.equal(inserted[0].parameters.ocrLanguage,'pt');
  assert.deepEqual(opened,[temporary.getId()]);assert.deepEqual(trashed,[{id:temporary.getId(),value:true}]);
});

test('large Google Sheet falls back to bounded cryptographic manifest after full-text limit',()=>{
  const f=fixture(),file=f.addFile('sheetfile00001',null,'sheet bytes',f.context.MimeType.GOOGLE_SHEETS);
  const values=[['HEADER','VALUE'],['A','1'],['B','2']];
  const sheet={
    getName:()=> 'Financeiro',
    getLastRow:()=>values.length,
    getLastColumn:()=>2,
    getRange:(start,col,count,width)=>({getDisplayValues:()=>values.slice(start-1,start-1+count).map(r=>r.slice(0,width))})
  };
  f.context.SpreadsheetApp.openById=id=>{assert.equal(id,file.getId());return {getSheets:()=>[sheet]};};
  f.context.extrairTextoGoogleSheetsWMGJ_V1_=()=>{throw Error('AURORA_SHEETS_TEXT_LIMIT');};
  const result=f.realExtract(file);
  assert.equal(result.ok,true);assert.equal(result.metodo,'google_sheets_manifest');
  assert.match(result.texto,/^AURORA_SHEETS_MANIFEST_V1\nSHEETS:1\nPOPULATED_ROWS:3/m);
  assert.equal(result.texto.includes('HEADER'),false);assert.equal(result.texto.includes('Financeiro'),false);
  assert.equal(f.context.extracaoDocumentalCompletaWMGJ_(result),true);
});

test('ZIP extraction produces bounded member manifest without exposing member names',()=>{
  const f=fixture(),file=f.addFile('zipfile0000001',null,'zip bytes','application/zip');
  file.getBlob=()=>({getBytes:()=>[1,2,3]});
  const members=[
    {name:'nota.pdf',mime:'application/pdf',bytes:[1,2,3,4]},
    {name:'recibo.txt',mime:'text/plain',bytes:[5,6,7]}
  ];
  f.context.Utilities.DigestAlgorithm={SHA_256:'SHA_256'};
  f.context.Utilities.computeDigest=(_alg,bytes)=>Array.from(crypto.createHash('sha256').update(Buffer.from(bytes.map(x=>(x+256)%256))).digest(),b=>b>127?b-256:b);
  f.context.Utilities.unzip=()=>members.map(m=>({getName:()=>m.name,getContentType:()=>m.mime,getBytes:()=>m.bytes}));
  const result=f.realExtract(file);
  assert.equal(result.ok,true);assert.equal(result.metodo,'zip_manifest');
  assert.match(result.texto,/^AURORA_ZIP_MANIFEST_V1\nENTRIES:2\nUNCOMPRESSED_BYTES:7/m);
  assert.equal(result.texto.includes('nota.pdf'),false);assert.equal(result.texto.includes('recibo.txt'),false);
  assert.equal(f.context.extracaoDocumentalCompletaWMGJ_(result),true);
});

test('ZIP manifest fails closed on unzip errors and excessive expansion',()=>{
  const f=fixture(),file=f.addFile('zipfile0000002',null,'zip bytes','application/zip');
  file.getBlob=()=>({getBytes:()=>[1]});
  f.context.Utilities.DigestAlgorithm={SHA_256:'SHA_256'};
  f.context.Utilities.computeDigest=()=>Array(32).fill(0);
  f.context.Utilities.unzip=()=>{throw Error('PRIVATE_ZIP_FAILURE');};
  let result=f.realExtract(file);assert.equal(result.ok,false);assert.equal(result.code,'AURORA_ZIP_EXTRACTION_FAILED');
  f.context.Utilities.unzip=()=>Array.from({length:201},(_,i)=>({getName:()=>String(i),getContentType:()=> 'text/plain',getBytes:()=>[1]}));
  result=f.realExtract(file);assert.equal(result.ok,false);assert.equal(result.code,'AURORA_ZIP_ENTRY_LIMIT');
});

function ofxFile(f,name,content) {
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
  const file=f.addFile('fileofx000001',null,'','application/octet-stream');file.getName=()=>name;
  file.getBlob=()=>({getBytes:()=>Array.from(bytes,b=>b>127?b-256:b),
    getDataAsString:encoding=>new TextDecoder(encoding).decode(bytes)});
  return file;
}
const ofxHeader='\r\nOFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:USASCII\r\nCHARSET:1252\r\nCOMPRESSION:NONE\r\n\r\n';
test('actual OFX signature shape accepts leading CRLF and declared ASCII/1252 as review-only text',()=>{
  const f=fixture(),text=ofxHeader+'<OFX>\r\n<STATUS><CODE>0</STATUS>\r\n</OFX>\r\n';
  const result=f.realExtract(ofxFile(f,'synthetic.OFX',text));
  assert.equal(result.ok,true);assert.equal(result.metodo,'blob_text');assert.equal(result.texto,text);
  assert.equal(result.tamanhoTexto,text.length);assert.equal(f.context.extracaoDocumentalCompletaWMGJ_(result),true);
  assert.equal(result.financialFactsApproved,undefined);assert.equal(result.valor_total,undefined);
});
test('octet-stream rejects wrong extension, invalid OFX signature, unsupported encoding and damaged text',()=>{
  const cases=[
    ['synthetic.bin',ofxHeader+'<OFX></OFX>','AURORA_DRIVE_FORMAT_UNSUPPORTED'],
    ['synthetic.ofx','not an OFX file','AURORA_DRIVE_OFX_SIGNATURE_INVALID'],
    ['synthetic.ofx',ofxHeader+'<OFX>unclosed','AURORA_DRIVE_OFX_SIGNATURE_INVALID'],
    ['synthetic.ofx',ofxHeader.replace('CHARSET:1252','CHARSET:UNKNOWN')+'<OFX></OFX>','AURORA_DRIVE_OFX_ENCODING_UNSUPPORTED'],
    ['synthetic.ofx',ofxHeader+'<OFX>\0</OFX>','AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED'],
    ['synthetic.ofx',Buffer.concat([Buffer.from('<?xml version="1.0" encoding="UTF-8"?><OFX>'),Buffer.from([0xff]),Buffer.from('</OFX>')]),'AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED']
  ];
  for(const [name,content,code] of cases) {
    const f=fixture(),result=f.realExtract(ofxFile(f,name,content));
    assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(result.observacao,code);
    assert.equal(f.context.extracaoDocumentalCompletaWMGJ_(result),false);
  }
});

test('processing honors explicit request order and source order ahead of legacy rows and cursor',()=>{
  const f=fixture();f.addFile('rawfile000001','folderraw001','raw');f.addFile('firstfile0001','folderfirst1','first source');
  f.addFile('explicit00001',null,'explicit first');f.addFile('explicit00002',null,'explicit second');
  f.addFolder('folderraw001',null,['rawfile000001']);f.addFolder('folderfirst1',null,['firstfile0001']);
  f.options.sources=[{sourceId:'01-first',folderId:'folderfirst1'},{sourceId:'99-raw',folderId:'folderraw001'}];
  f.options.fileIds=['explicit00001','explicit00002'];f.options.maxScan=10;
  f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  const byId=new Map(f.rows.slice(1).map(row=>[row[2],row]));
  f.rows.splice(1,4,...['rawfile000001','explicit00002','firstfile0001','explicit00001'].map(id=>byId.get(id)));
  f.props.set('AURORA_DRIVE_PROCESS_'+ORG+'_'+H.slice(0,24),'4000');
  f.options.processLimit=20;
  const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.equal(result.process.accepted,4);
  assert.deepEqual(f.sent.filter((_,index)=>index%2===0).map(event=>event.source.sourceId),
    ['explicit00001','explicit00002','firstfile0001','rawfile000001']);
});
test('a recoverable explicit failure does not starve a healthy root and retries rotate within their group',()=>{
  const f=fixture();f.addFile('explicit00001',null,'bad first');f.addFile('explicit00002',null,'bad second');
  f.addFile('rootfile00001','folderroot01','healthy');f.addFolder('folderroot01',null,['rootfile00001']);
  f.options.fileIds=['explicit00001','explicit00002'];f.options.sources=[{sourceId:'drive-main',folderId:'folderroot01'}];
  f.options.maxScan=10;f.options.processLimit=1;
  const calls=[],extract=f.context.extrairConteudoArquivoWMGJ_V1_;
  f.context.extrairConteudoArquivoWMGJ_V1_=file=>{calls.push(file.getId());return file.getId().startsWith('explicit')?
    {ok:false,code:'AURORA_DRIVE_CONVERSION_NOT_READY'}:extract(file);};
  for(let i=0;i<5;i++)f.context.auroraExecutarCicloDriveAutorizado_(f.options);
  assert.deepEqual(calls,['explicit00001','explicit00002','rootfile00001','explicit00001','explicit00002']);
  assert.equal(f.sent.length,2);assert.equal(f.sent[0].source.sourceId,'rootfile00001');
  assert.equal(f.rows[1][8],'AURORA_DRIVE_CONVERSION_NOT_READY');
});

// Provider-backed recovery keeps the original bytes authoritative and requires human review.
function setupProviderTextRecovery(sourceBytes,providerText,copyMime='application/vnd.google-apps.document',copyIsOriginal=false) {
  const f=fixture(),copies=[],trashed=[],extractions=[];
  const file=f.addFile('explicittext001',null,'original source','text/plain');
  file.getName=()=> 'synthetic-legacy.txt';file.getSize=()=>sourceBytes.length;
  file.getBlob=()=>({getBytes:()=>Array.from(sourceBytes,b=>b>127?b-256:b),getDataAsString:()=>sourceBytes.toString('utf8')});
  file.setTrashed=()=>{throw Error('ORIGINAL_MUST_NOT_BE_TRASHED');};
  const temporary=f.addFile('temporarydoc001',null,'',copyMime);
  temporary.setTrashed=value=>trashed.push({id:temporary.getId(),value});
  f.context.Utilities.getUuid=()=> 'synthetic-temporary-name';
  f.context.Drive={Files:{copy:(resource,id,options)=>{
    copies.push({resource,id,options});return {id:copyIsOriginal?file.getId():temporary.getId(),mimeType:copyMime};
  }}};
  f.context.DocumentApp={openById:id=>{
    assert.equal(id,temporary.getId());return {getBody:()=>({getText:()=>providerText})};
  }};
  const contentHash=crypto.createHash('sha256').update(sourceBytes).digest('hex');
  f.context.wmgjFirestoreHashArquivo_=()=>({method:'content_sha256',value:contentHash});
  f.context.extrairConteudoArquivoWMGJ_V1_=f.realExtract;
  f.context.registrarExtracaoDocumentalWMGJ_V1_=(source,hash,extraction)=>extractions.push({source,hash,extraction});
  f.options.fileIds=[file.getId()];f.options.maxScan=10;f.options.processLimit=1;
  return {f,file,temporary,copies,trashed,extractions,contentHash};
}

test('provider recovery keeps original byte identity and sends valid Unicode only for human review',()=>{
  for(const sourceBytes of [Buffer.from([0x41,0xc7,0x42]),Buffer.from([0x41,0,0x42])]) {
    const text='Texto recuperado pelo provedor: operação, ação e revisão.';
    const {f,file,temporary,copies,trashed,extractions,contentHash}=setupProviderTextRecovery(sourceBytes,text);
    assert.equal(f.context.auroraBytesTextoUtf8Validos_(Array.from(sourceBytes)),false);
    const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
    assert.equal(result.ok,true);assert.equal(result.process.accepted,1);assert.equal(result.process.pending,0);
    assert.equal(copies.length,1);assert.equal(copies[0].id,file.getId());
    assert.equal(copies[0].resource.mimeType,'application/vnd.google-apps.document');assert.equal(copies[0].options.convert,true);
    assert.equal(copies[0].options.ocr,undefined);assert.deepEqual(trashed,[{id:temporary.getId(),value:true}]);
    assert.equal(f.sent.length,2);assert.equal(f.sent[0],f.sent[1]);
    const event=f.sent[0],receipt=result.privateReadbackPlan[0];
    assert.equal(event.source.sourceId,file.getId());assert.equal(event.source.contentHash,contentHash);
    assert.equal(event.sourceVersion,10000);assert.equal(event.idempotencyKey,
      'synthetic:DRIVE:'+file.getId()+':drive-extraction-v1:10000:'+contentHash);
    assert.equal(event.record.extractionEvidence.method,'google_docs_text');
    assert.equal(event.record.extractionEvidence.financialFactsApproved,false);
    assert.equal(event.record.extractionEvidence.coverage,'TEXT_EXTRACTED_REVIEW_PENDING');
    assert.equal(event.record.extractionEvidence.textSha256,crypto.createHash('sha256').update(text).digest('hex'));
    assert.equal(f.rows[1][5],'REVISAR_HUMANO');assert.equal(receipt.contentHash,contentHash);
    assert.equal(receipt.sourceVersion,10000);assert.equal(receipt.replayVerified,true);
    assert.equal(extractions[0].extraction.texto,text);
    assert.match(extractions[0].extraction.observacao,/codificação da fonte não verificada/);
  }
});

test('damaged or unconfirmed provider output remains pending and cleanup never targets the original',()=>{
  const cases=[
    {text:'damaged \uFFFD text',code:'AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED'},
    {text:'damaged \u0000 text',code:'AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED'},
    {text:' \n\t',code:'AURORA_DRIVE_EXTRACTION_EMPTY'},
    {text:'x'.repeat(1048577),code:'AURORA_DRIVE_TEXT_LIMIT'},
    {text:'readable',mime:'text/plain',code:'AURORA_DRIVE_CONVERSION_UNSUPPORTED'},
    {text:'readable',original:true,code:'AURORA_DRIVE_CONVERSION_UNSUPPORTED'}
  ];
  for(const item of cases) {
    const {f,temporary,trashed}=setupProviderTextRecovery(Buffer.from([0x41,0xc7,0x42]),item.text,item.mime,item.original);
    const result=f.context.auroraExecutarCicloDriveAutorizado_(f.options);
    assert.equal(result.ok,true);assert.equal(result.process.accepted,0);assert.equal(result.process.pending,1);
    assert.equal(result.process.blockingErrors,0);assert.equal(f.sent.length,0);assert.equal(result.privateReadbackPlan.length,0);
    assert.equal(f.rows[1][5],'ERRO_REPROCESSAR');assert.equal(f.rows[1][8],item.code);
    assert.deepEqual(trashed,item.original?[]:[{id:temporary.getId(),value:true}]);
  }
  const bounded=setupProviderTextRecovery(Buffer.from([0xc7]),'valid provider text');
  const deferred=bounded.f.context.auroraConverterTextoProviderDrive_(bounded.file,Date.now()+1000);
  assert.equal(deferred.ok,false);assert.equal(deferred.code,'AURORA_DRIVE_CONVERSION_DEFERRED');
  assert.equal(bounded.copies.length,0);assert.equal(bounded.trashed.length,0);
});
