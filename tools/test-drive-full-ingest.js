const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const code = ['01_PIPELINE_CONFIABILIDADE_WMGJ.gs','04_EXTRACAO_DOCUMENTAL_WMGJ.gs'].map(n=>fs.readFileSync(path.join(root,'src',n),'utf8')).join('\n');
const H='a'.repeat(64), ORG='synthetic';
function fixture() {
  const props=new Map(), tokens=new Map(), files=new Map(), folders=new Map(),receipts=new Map(),sent=[];
  const head=['DATA_ENTRADA','ORIGEM','ID_ORIGEM','NOME_ARQUIVO','MIME_TYPE','STATUS','TENTATIVAS','ACAO_SUGERIDA','ULTIMO_ERRO','OBSERVACAO'];
  const rows=[head];let serial=0;
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
    SpreadsheetApp:{},MimeType:{},Utilities:{}});
  vm.runInContext(code,context);
  context.garantirAbasControleExtracaoWMGJ_V1_=()=>{};
  context.getConfigWMGJ_Compat_=()=>({SHEETS:{FILA:'queue'}});
  context.getPlanilhaWMGJ_Compat_=()=>({getSheetByName:()=>sheet});
  context.wmgjFirestoreHashArquivo_=file=>({value:crypto.createHash('sha256').update(file._text).digest('hex'),method:'content_sha256'});
  context.wmgjFirestoreHashString_=text=>crypto.createHash('sha256').update(text).digest('hex');
  context.extrairConteudoArquivoWMGJ_V1_=file=>({ok:true,metodo:'blob_text',texto:file._text,tamanhoTexto:file._text.length});
  context.wmgjFirestoreEventoArquivo_=(file,classification)=>{
    assert.equal(classification.valor_total,null);assert.equal(classification.competencia,null);assert.equal(classification.confianca,0);
    return {orgId:ORG,sourceVersion:file.getLastUpdated().getTime(),eventId:'event-'+file.getId(),source:{sourceId:file.getId(),contentHash:context.wmgjFirestoreHashArquivo_(file).value},record:{canonicalSnapshotHash:H},metadata:{}};
  };
  context.wmgjFirestoreEnviarEventoComConfig_=(event,cfg,logger,check)=>{
    check();sent.push(event);const key=event.source.sourceId+':'+event.source.contentHash;
    const prior=receipts.get(key);if(prior)return {...prior,accepted:false,duplicate:true};
    const receipt={accepted:true,duplicate:false,entityId:crypto.createHash('sha256').update(key).digest('hex').slice(0,48),
      eventId:event.eventId,revision:1,versionId:crypto.createHash('sha256').update(key).digest('hex')};
    receipts.set(key,receipt);return receipt;
  };
  context.registrarExtracaoDocumentalWMGJ_V1_=()=>{};context.registrarFirestoreMirrorWMGJ_=()=>{};
  const options={orgId:ORG,scopeSha256:H,sources:[],fileIds:[],excludedFolderIds:[],maxScan:1,processLimit:0,
    config:{orgId:ORG,dryRun:false},deadlineMs:Date.now()+140000};
  return {context,props,tokens,files,folders,rows,sent,addFile,addFolder,options};
}
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
