'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', '37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'), 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const state = {owner:'owner@fixture.test',effective:'owner@fixture.test',org:'synthetic',secret:'a'.repeat(64),calls:[],lock:false,properties:new Map(),propertyReads:[]};
  const props = {getProperty:key=>{
    if(key.startsWith('AURORA_DRIVE_')) {assert.equal(state.lock,true);state.propertyReads.push(key);}
    return key==='WMGJ_FIRESTORE_ORG_ID'?state.org:state.properties.has(key)?state.properties.get(key):null;
  },
    setProperty(){throw Error('GLOBAL_WRITE_FORBIDDEN');},setProperties(){throw Error('GLOBAL_WRITE_FORBIDDEN');}};
  const receipt = {entityId:'b'.repeat(48),sourceId:'synthetic-file-00001',contentHash:'c'.repeat(64),
    contentSha256:'c'.repeat(64),textSha256:'d'.repeat(64),canonicalSnapshotHash:'f'.repeat(64),sourceVersion:1,revision:1,versionId:'e'.repeat(64),replayVerified:true};
  const data = {ok:true,scan:{visited:3,enqueued:1,duplicates:0,enumerationComplete:true},
    process:{attempted:1,processed:1,accepted:1,duplicates:0,aliases:0,pending:0,review:1,errors:0,blockingErrors:0},
    privateReadbackPlan:[receipt]};
  const context = vm.createContext({Date,JSON,Number,Object,Array,String,Error,
    PropertiesService:{getScriptProperties:()=>props},
    Session:{getActiveUser:()=>({getEmail:()=>state.owner}),getEffectiveUser:()=>({getEmail:()=>state.effective})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_alg,text)=>[...crypto.createHash('sha256').update(text).digest()]},
    DriveApp:{getFolderById:id=>{state.calls.push('folder');return{getId:()=>id};},
      getFileById:id=>{state.calls.push('file');return{getId:()=>id,isTrashed:()=>false};}},
    ScriptApp:{getProjectTriggers(){throw Error('TRIGGER_READ_FORBIDDEN');},newTrigger(){throw Error('TRIGGER_WRITE_FORBIDDEN');}},
    Logger:{log(){throw Error('LOG_FORBIDDEN');}},
    wmgjFirestoreConfig_:()=>({orgId:state.org,url:'https://synthetic.example/ingestWmgjEvent',keyId:'synthetic-key',secret:state.secret,dryRun:true,maxRows:50}),
    getConfigWMGJ_Compat_:()=>({SHEETS:{FILA:'existing-queue'}}),
    getPlanilhaWMGJ_Compat_:()=>({getSheetByName:name=>{assert.equal(state.lock,true);assert.equal(name,'existing-queue');return state.queue;}}),
    comTravaIngestaoGmailWMGJ_:callback=>{state.calls.push('lock');state.lock=true;try{return callback();}finally{state.lock=false;}},
    auroraExecutarCicloDriveAutorizado_:options=>{assert.equal(state.lock,true);state.calls.push('execute');state.options=options;options.beforeRequest();return data;},
    auroraProcessarFilaDriveAutorizada_:(sheet,options,limit,deadline)=>{
      assert.equal(state.lock,true);assert.equal(sheet,state.queue);assert.equal(limit,20);
      assert.equal(deadline,options.deadlineMs);assert.ok(deadline>Date.now());
      state.calls.push('process-existing');state.options=options;options.beforeRequest();
      return {...data.process,privateReadbackPlan:data.privateReadbackPlan};
    },
    auroraLerPlanoReadbackDriveAutorizado_:options=>{
      assert.equal(state.lock,true);state.calls.push('readback');state.readbackOptions=options;
      const count=options.readbackOffset===0?1:0;
      return {privateReadbackPlan:count?[receipt]:[],privateAliasRows:[],coverage:{offset:options.readbackOffset,nextOffset:null,
        total:1,documents:1,aliases:0,pending:0,complete:true,returned:count,pageDocuments:count,pageAliases:0,pagePending:0}};
    }
  });
  state.queue={name:'synthetic-existing-queue',getDataRange:()=>({getValues:()=>[['ID_ORIGEM','STATUS','OBSERVACAO']]})};
  vm.runInContext(source,context);
  context.AURORA_CONNECTOR_REUSE_OWNER_HASH=sha('owner@fixture.test');
  const request = {mode:'PREVIEW',orgId:'synthetic',sources:[{sourceId:'drive-primary',system:'DRIVE',folderId:'synthetic-root-00001',slaMinutes:1440,active:true}],
    fileIds:['synthetic-file-00001'],excludedFolderIds:[],maxScan:300,limit:20,expectedScopeSha256:null};
  const call = input=>plain(context.auroraExecutarIngestaoDriveAutorizada(input||request));
  const execute = () => {const preview=call();return call({...request,mode:'EXECUTE',expectedScopeSha256:preview.scopeSha256});};
  return {state,context,request,data,receipt,call,execute};
}
test('preview verifies private scope without execution, logs, triggers or global writes',()=>{
  const f=fixture(),r=f.call();
  assert.equal(r.ok,true);assert.equal(r.code,'AURORA_DRIVE_PREVIEW_VERIFIED');
  assert.match(r.scopeSha256,/^[a-f0-9]{64}$/);assert.deepEqual(f.state.calls,['folder','file']);
  assert.equal(r.triggersChanged,false);assert.equal(r.globalSettingsChanged,false);
  assert.ok(!JSON.stringify(r).includes(f.state.secret));assert.ok(!JSON.stringify(r).includes(f.request.sources[0].folderId));
});
test('execute retains the shared lock and uses isolated real config with canonical replay evidence',()=>{
  const f=fixture(),r=f.execute();
  assert.equal(r.ok,true);assert.equal(r.processing.accepted,1);assert.equal(r.processing.replayVerified,1);
  assert.equal(r.privateReadbackPlan.length,1);assert.equal(f.state.options.config.dryRun,false);
  assert.equal(f.context.wmgjFirestoreConfig_().dryRun,true);assert.equal(f.state.calls.filter(x=>x==='execute').length,1);
  assert.equal(r.firstIngestionVerified,false);assert.equal(r.fullSynchronizationVerified,false);
  assert.ok(!JSON.stringify(r).includes(f.state.secret));
});
test('owner and tenant mismatch reject before source access or execution',()=>{
  const f=fixture();f.state.effective='other@fixture.test';
  assert.equal(f.call().code,'AURORA_CONNECTOR_REUSE_OWNER_REQUIRED');assert.deepEqual(f.state.calls,[]);
  f.state.effective=f.state.owner;f.state.org='other';
  assert.equal(f.call().code,'AURORA_DRIVE_TENANT_MISMATCH');assert.deepEqual(f.state.calls,[]);
});
test('changed source or credential after preview rejects the execution fingerprint',()=>{
  const f=fixture(),preview=f.call();f.state.secret='f'.repeat(64);
  const r=f.call({...f.request,mode:'EXECUTE',expectedScopeSha256:preview.scopeSha256});
  assert.equal(r.ok,false);assert.equal(r.code,'AURORA_DRIVE_SCOPE_CHANGED');assert.ok(!f.state.calls.includes('execute'));
  const g=fixture(),p=g.call();const request=plain(g.request);request.fileIds.push('another-file-00001');
  assert.equal(g.call({...request,mode:'EXECUTE',expectedScopeSha256:p.scopeSha256}).code,'AURORA_DRIVE_SCOPE_CHANGED');
});
test('per-request authority recheck catches configuration change before transport',()=>{
  const f=fixture();f.context.auroraExecutarCicloDriveAutorizado_=options=>{f.state.secret='9'.repeat(64);options.beforeRequest();return f.data;};
  const r=f.execute();assert.equal(r.ok,false);assert.equal(r.code,'AURORA_DRIVE_SCOPE_CHANGED');
});
test('malformed scope, duplicate roots and excluded selected root cannot execute',()=>{
  const f=fixture();
  assert.equal(f.call({...f.request,secret:'forbidden'}).code,'AURORA_DRIVE_REQUEST_REJECTED');
  assert.equal(f.call({...f.request,sources:[f.request.sources[0],f.request.sources[0]]}).code,'AURORA_DRIVE_SOURCE_SCOPE_REJECTED');
  assert.equal(f.call({...f.request,excludedFolderIds:[f.request.sources[0].folderId]}).code,'AURORA_DRIVE_SOURCE_SCOPE_REJECTED');
  assert.ok(!f.state.calls.includes('execute'));
});
test('receipt response strips unexpected private body and rejects absent replay evidence',()=>{
  const f=fixture();f.receipt.text='PRIVATE_DOCUMENT_CONTENT';f.data.secret=f.state.secret;
  let r=f.execute();assert.equal(r.ok,true);assert.ok(!JSON.stringify(r).includes('PRIVATE_DOCUMENT_CONTENT'));
  f.receipt.replayVerified=false;r=f.execute();assert.equal(r.ok,false);assert.equal(r.code,'AURORA_DRIVE_RESULT_INVALID');
  assert.ok(!JSON.stringify(r).includes(f.state.secret));
});

test('READBACK uses the same fingerprint and shared lock without enumeration or HMAC submission',()=>{
  const f=fixture(),preview=f.call();
  const request={...f.request,mode:'READBACK',expectedScopeSha256:preview.scopeSha256,readbackOffset:0};
  const first=f.call(request);assert.equal(first.ok,true);assert.equal(first.code,'AURORA_DRIVE_READBACK_PLAN');
  assert.equal(first.coverage.total,1);assert.equal(first.coverage.documents,1);assert.equal(first.coverage.pending,0);
  assert.equal(first.privateReadbackPlan.length,1);assert.equal(first.scopeSha256,preview.scopeSha256);
  assert.ok(!f.state.calls.includes('execute'));assert.equal(f.state.readbackOptions.readbackOffset,0);
  const second=f.call({...request,readbackOffset:1});assert.equal(second.ok,true);assert.equal(second.scopeSha256,preview.scopeSha256);
  assert.equal(second.privateReadbackPlan.length,0);assert.equal(second.firstIngestionVerified,false);
  assert.equal(second.fullSynchronizationVerified,false);
});
test('READBACK offset is closed and cannot alter PREVIEW or EXECUTE scope',()=>{
  const f=fixture(),preview=f.call();
  assert.equal(f.call({...f.request,readbackOffset:0}).code,'AURORA_DRIVE_REQUEST_REJECTED');
  for(const readbackOffset of [-1,0.5,'0']) {
    assert.equal(f.call({...f.request,mode:'READBACK',expectedScopeSha256:preview.scopeSha256,readbackOffset}).code,'AURORA_DRIVE_REQUEST_REJECTED');
  }
  assert.ok(!f.state.calls.includes('readback'));
});
test('READBACK rejects uncovered aliases and strips noncontract private fields',()=>{
  const f=fixture(),preview=f.call();
  const request={...f.request,mode:'READBACK',expectedScopeSha256:preview.scopeSha256,readbackOffset:0};
  f.context.auroraLerPlanoReadbackDriveAutorizado_=()=>({privateReadbackPlan:[{...f.receipt,text:'PRIVATE'}],
    privateAliasRows:[{fileId:'alias-file-00001',primaryFileId:f.receipt.sourceId,contentHash:f.receipt.contentHash,entityId:f.receipt.entityId,text:'PRIVATE'}],
    coverage:{offset:0,nextOffset:null,total:1,documents:0,aliases:1,pending:0,complete:true,returned:1,pageDocuments:0,pageAliases:1,pagePending:0}});
  let result=f.call(request);assert.equal(result.ok,true);assert.equal(result.privateAliasRows.length,1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  f.receipt.contentHash='8'.repeat(64);result=f.call(request);assert.equal(result.ok,false);
});

test('shared-lock refusal has a complete zero-write contract and a distinct bounded code',()=>{
  const f=fixture();f.context.comTravaIngestaoGmailWMGJ_=()=>{throw Error('GMAIL_REPLAY_LOCK_BUSY');};
  const result=f.execute();assert.equal(result.code,'AURORA_DRIVE_ENGINE_BUSY');assert.equal(result.failureStage,'SHARED_LOCK');
  assert.equal(result.ok,false);assert.equal(result.privateReadbackPlan.length,0);assert.ok(!f.state.calls.includes('execute'));
  for(const key of ['attempted','accepted','duplicates','pending','failed','review','extractionErrors','aliases','replayVerified'])assert.equal(result.processing[key],0);
});
test('exceptions after entering the engine cannot masquerade as a safe lock refusal',()=>{
  const f=fixture();f.context.auroraExecutarCicloDriveAutorizado_=()=>{throw Error('GMAIL_REPLAY_LOCK_BUSY');};
  let result=f.execute();assert.equal(result.code,'AURORA_DRIVE_EXECUTION_UNCONFIRMED');assert.equal(result.failureStage,'EXECUTE');
  f.context.auroraExecutarCicloDriveAutorizado_=()=>{throw Error('Service invoked too many times: PRIVATE_IDENTIFIER');};
  result=f.execute();assert.equal(result.code,'AURORA_DRIVE_SERVICE_QUOTA');assert.equal(result.failureStage,'EXECUTE');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_IDENTIFIER'));
});

function diagnosticRequest(f) {
  const preview=f.call();
  return {...f.request,mode:'READBACK',expectedScopeSha256:preview.scopeSha256,readbackOffset:0};
}
function diagnosticKeys(f,request) {
  const suffix=f.request.orgId+'_'+request.expectedScopeSha256.slice(0,24);
  return ['AURORA_DRIVE_CURSOR_'+suffix,'AURORA_DRIVE_PROCESS_'+suffix+'_PRIORITY_V1'];
}
function diagnosticState(f,request,token='PRIVATE_TOKEN_ç🙂') {
  return {schemaVersion:1,scopeSha256:request.expectedScopeSha256,explicitIndex:1,rootIndex:1,
    scanned:255,folders:12,excluded:0,complete:false,privateExtra:'PRIVATE_DOCUMENT_CONTENT',
    stack:[{folderId:'private-folder-00001',rootId:f.request.sources[0].folderId,
      sourceId:f.request.sources[0].sourceId,stage:'FILES',token}]};
}
test('READBACK measures only scoped cursor properties under the shared lock and never returns their values',()=>{
  const f=fixture(),request=diagnosticRequest(f),keys=diagnosticKeys(f,request),state=diagnosticState(f,request);
  const raw=JSON.stringify(state);f.state.properties.set(keys[0],raw);f.state.properties.set(keys[1],JSON.stringify({explicit:1,'source:drive-primary':255}));
  const before=[...f.state.properties];
  const response=f.call(request),d=response.cursorDiagnostics;
  assert.equal(response.ok,true);assert.equal(d.schemaVersion,'aurora.drive-resume-diagnostics.v1');assert.equal(d.readOnly,true);
  assert.deepEqual(f.state.propertyReads,keys);assert.deepEqual([...f.state.properties],before);
  assert.equal(d.cursor.jsonValid,true);assert.equal(d.cursor.contractValid,true);assert.equal(d.cursor.scopeMatches,true);
  assert.equal(d.cursor.characters,raw.length);assert.equal(d.cursor.utf8Bytes,Buffer.byteLength(raw));
  assert.equal(d.cursor.explicitIndex,1);assert.equal(d.cursor.rootIndex,1);assert.equal(d.cursor.scanned,255);
  assert.deepEqual(d.cursor.frames,[{index:0,stage:'FILES',folderIdValid:true,sourceIndex:0,tokenTypeValid:true,
    tokenCharacters:state.stack[0].token.length,tokenUtf8Bytes:Buffer.byteLength(state.stack[0].token)}]);
  assert.equal(d.priority.contractValid,true);assert.equal(d.priority.groupCount,2);assert.equal(d.priority.maxOrdinal,255);
  for(const privateValue of [state.stack[0].token,state.stack[0].folderId,state.stack[0].rootId,state.stack[0].sourceId,state.privateExtra,f.state.secret,request.expectedScopeSha256]) {
    assert.equal(JSON.stringify(d).includes(privateValue),false);
  }
  assert.ok(!f.state.calls.includes('execute'));assert.equal(response.processing.accepted,0);
  assert.equal(response.privateReadbackPlan.length,1);assert.equal(response.fullSynchronizationVerified,false);
});
test('READBACK reports absent or malformed state without resetting cursors or losing durable receipts',()=>{
  const f=fixture(),request=diagnosticRequest(f),keys=diagnosticKeys(f,request);
  let response=f.call(request);assert.equal(response.ok,true);assert.equal(response.cursorDiagnostics.cursor.readStatus,'ABSENT');
  assert.equal(response.cursorDiagnostics.cursor.present,false);assert.equal(response.cursorDiagnostics.priority.present,false);
  f.state.properties.set(keys[0],'{"PRIVATE_SOURCE_ID":');f.state.properties.set(keys[1],'["PRIVATE_SOURCE_ID"]');
  response=f.call(request);assert.equal(response.ok,true);assert.equal(response.cursorDiagnostics.cursor.jsonValid,false);
  assert.equal(response.cursorDiagnostics.cursor.contractValid,false);assert.equal(response.cursorDiagnostics.priority.jsonValid,true);
  assert.equal(response.cursorDiagnostics.priority.contractValid,false);assert.equal(response.privateReadbackPlan.length,1);
  assert.equal(JSON.stringify(response.cursorDiagnostics).includes('PRIVATE_SOURCE_ID'),false);
  assert.equal(f.state.properties.get(keys[0]),'{"PRIVATE_SOURCE_ID":');
});
test('cursor diagnostics survive a failed queue readback but do not change its failure or completeness',()=>{
  const f=fixture(),request=diagnosticRequest(f),keys=diagnosticKeys(f,request),state=diagnosticState(f,request,'x'.repeat(3908));
  state.stack.push({folderId:'private-child-00001',rootId:f.request.sources[0].folderId,sourceId:'drive-primary',stage:'FILES',token:null});
  const raw=JSON.stringify(state);assert.ok(raw.length<8000);f.state.properties.set(keys[0],raw);
  f.context.auroraLerPlanoReadbackDriveAutorizado_=()=>{throw Error('AURORA_DRIVE_QUEUE_SCOPE_INVALID');};
  const response=f.call(request);assert.equal(response.ok,false);assert.equal(response.code,'AURORA_DRIVE_QUEUE_SCOPE_INVALID');
  assert.equal(response.failureStage,'READBACK');assert.equal(response.cursorDiagnostics.cursor.characters,raw.length);
  assert.deepEqual(response.cursorDiagnostics.cursor.frames.map(x=>x.tokenCharacters),[3908,0]);
  assert.equal(response.cursorDiagnostics.cursor.contractValid,true);assert.equal(response.cursorDiagnostics.cursor.stackDepth,2);
  assert.equal(response.scan.complete,false);assert.equal(response.fullSynchronizationVerified,false);
  assert.equal(response.privateReadbackPlan.length,0);assert.ok(!f.state.calls.includes('execute'));
  assert.equal(response.cursorDiagnostics.resumable,undefined);assert.equal(response.cursorDiagnostics.healthy,undefined);
});
test('diagnostic arrays and values are bounded and malformed private fields cannot enter the response',()=>{
  const f=fixture(),request=diagnosticRequest(f),keys=diagnosticKeys(f,request),state=diagnosticState(f,request);
  state.stack=Array.from({length:25},()=>({folderId:'PRIVATE_FOLDER',rootId:'PRIVATE_ROOT',sourceId:'PRIVATE_SOURCE',
    stage:'PRIVATE_STAGE',token:{secret:'PRIVATE_TOKEN'}}));
  state.explicitIndex='PRIVATE_INDEX';state.complete='PRIVATE_COMPLETE';state.scopeSha256='PRIVATE_SCOPE';
  f.state.properties.set(keys[0],JSON.stringify(state));f.state.properties.set(keys[1],JSON.stringify({'PRIVATE_GROUP':'PRIVATE_ORDINAL'}));
  let response=f.call(request),d=response.cursorDiagnostics;
  assert.equal(response.ok,true);assert.equal(d.cursor.frames.length,24);assert.equal(d.cursor.framesTruncated,true);
  assert.equal(d.cursor.stackDepth,25);assert.equal(d.cursor.contractValid,false);assert.equal(d.cursor.scopeMatches,false);
  assert.equal(d.cursor.explicitIndex,null);assert.equal(d.cursor.complete,null);assert.equal(d.cursor.frames[0].stage,'INVALID');
  assert.equal(d.cursor.frames[0].tokenCharacters,null);assert.equal(d.priority.unknownGroupCount,1);assert.equal(d.priority.maxOrdinal,null);
  assert.equal(JSON.stringify(d).includes('PRIVATE_'),false);
  f.state.properties.set(keys[0],'x'.repeat(16385));response=f.call(request);
  assert.equal(response.cursorDiagnostics.cursor.readStatus,'OVERSIZE');assert.equal(response.cursorDiagnostics.cursor.characters,16385);
  assert.equal(response.cursorDiagnostics.cursor.jsonValid,false);assert.equal(response.cursorDiagnostics.cursor.utf8Bytes,null);
});
test('owner or scope rejection prevents even a diagnostic property read',()=>{
  const f=fixture(),request=diagnosticRequest(f);f.state.effective='other@fixture.test';
  assert.equal(f.call(request).code,'AURORA_CONNECTOR_REUSE_OWNER_REQUIRED');assert.deepEqual(f.state.propertyReads,[]);
  f.state.effective=f.state.owner;f.state.secret='b'.repeat(64);
  assert.equal(f.call(request).code,'AURORA_DRIVE_SCOPE_CHANGED');assert.deepEqual(f.state.propertyReads,[]);
});
test('closed scanner and process-cursor failures retain their cause while arbitrary error text stays redacted',()=>{
  const f=fixture();
  for(const suffix of ['CURSOR_CONFLICT','CURSOR_LIMIT','DEPTH_OR_CYCLE','INFLIGHT_RECONCILIATION_REQUIRED','LIMIT_INVALID',
    'QUEUE_CONTRACT','QUEUE_SCOPE_INVALID','QUEUE_TENANT_CONFLICT','SCOPE_LIMIT','SCOPE_REQUIRED','SOURCE_INVALID','PROCESS_CURSOR_INVALID']) {
    const code='AURORA_DRIVE_'+suffix;
    f.context.auroraExecutarCicloDriveAutorizado_=()=>{throw Error(code);};
    const response=f.execute();assert.equal(response.code,code);assert.equal(response.failureStage,'EXECUTE');assert.equal(response.ok,false);
  }
  f.context.auroraExecutarCicloDriveAutorizado_=()=>{throw new SyntaxError('PRIVATE_TOKEN PRIVATE_SOURCE_ID');};
  const response=f.execute();assert.equal(response.code,'AURORA_DRIVE_EXECUTION_UNCONFIRMED');assert.equal(response.failureStage,'EXECUTE');
  assert.equal(JSON.stringify(response).includes('PRIVATE_'),false);
});

test('PROCESS_EXISTING keeps the preview fingerprint, shared lock and receipts without the scanner or enumeration cursor',()=>{
  const f=fixture(),preview=f.call();
  delete f.context.auroraExecutarCicloDriveAutorizado_;
  const result=f.call({...f.request,mode:'PROCESS_EXISTING',expectedScopeSha256:preview.scopeSha256});
  assert.equal(result.ok,true);assert.equal(result.scopeSha256,preview.scopeSha256);
  assert.deepEqual(result.scan,{examined:0,queued:0,aliases:0,revisited:0,complete:false});
  assert.equal(result.processing.accepted,1);assert.equal(result.processing.pending,0);
  assert.equal(result.processing.replayVerified,1);assert.equal(result.privateReadbackPlan.length,1);
  assert.equal(result.fullSynchronizationVerified,false);assert.equal(result.firstIngestionVerified,false);
  assert.equal(f.state.options.config.dryRun,false);assert.equal(f.context.wmgjFirestoreConfig_().dryRun,true);
  assert.equal(f.state.calls.filter(x=>x==='process-existing').length,1);
  assert.equal(f.state.calls.includes('execute'),false);assert.deepEqual(f.state.propertyReads,[]);
  assert.equal(result.triggersChanged,false);assert.equal(result.globalSettingsChanged,false);
  assert.equal(JSON.stringify(result).includes(f.state.secret),false);
});
test('PROCESS_EXISTING preserves owner, tenant and scope guards before obtaining the queue',()=>{
  for(const mutate of [f=>{f.state.effective='other@fixture.test';},f=>{f.state.org='other';},f=>{f.state.secret='f'.repeat(64);}]) {
    const f=fixture(),preview=f.call();mutate(f);
    const result=f.call({...f.request,mode:'PROCESS_EXISTING',expectedScopeSha256:preview.scopeSha256});
    assert.equal(result.ok,false);assert.equal(f.state.calls.includes('process-existing'),false);
    assert.equal(f.state.calls.includes('lock'),false);assert.equal(f.state.calls.includes('execute'),false);
  }
});
test('PROCESS_EXISTING refuses a missing or malformed queue and missing processor without falling back to enumeration',()=>{
  const f=fixture(),preview=f.call(),request={...f.request,mode:'PROCESS_EXISTING',expectedScopeSha256:preview.scopeSha256};
  f.state.queue.getDataRange=()=>({getValues:()=>[['PRIVATE_QUEUE_FIELD','STATUS']]});
  const malformed=f.call(request);assert.equal(malformed.code,'AURORA_DRIVE_QUEUE_CONTRACT');
  assert.equal(JSON.stringify(malformed).includes('PRIVATE_QUEUE_FIELD'),false);
  f.state.queue=null;
  assert.equal(f.call(request).code,'AURORA_DRIVE_QUEUE_CONTRACT');
  f.context.auroraProcessarFilaDriveAutorizada_=undefined;
  assert.equal(f.call(request).code,'AURORA_DRIVE_DEPENDENCY_MISSING');
  assert.equal(f.state.calls.includes('execute'),false);assert.equal(f.state.calls.includes('process-existing'),false);
});
test('PROCESS_EXISTING rechecks per-request authority and rejects an unproved replay',()=>{
  const f=fixture(),preview=f.call(),request={...f.request,mode:'PROCESS_EXISTING',expectedScopeSha256:preview.scopeSha256};
  f.receipt.replayVerified=false;
  assert.equal(f.call(request).code,'AURORA_DRIVE_RESULT_INVALID');
  f.context.auroraProcessarFilaDriveAutorizada_=(_sheet,options)=>{f.state.secret='f'.repeat(64);options.beforeRequest();};
  assert.equal(f.call(request).code,'AURORA_DRIVE_SCOPE_CHANGED');
  assert.equal(f.state.calls.includes('execute'),false);
});
