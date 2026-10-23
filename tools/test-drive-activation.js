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
  const state = {owner:'owner@fixture.test',effective:'owner@fixture.test',org:'synthetic',secret:'a'.repeat(64),calls:[],lock:false};
  const props = {getProperty:key=>key==='WMGJ_FIRESTORE_ORG_ID'?state.org:null,
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
    comTravaIngestaoGmailWMGJ_:callback=>{state.calls.push('lock');state.lock=true;try{return callback();}finally{state.lock=false;}},
    auroraExecutarCicloDriveAutorizado_:options=>{assert.equal(state.lock,true);state.calls.push('execute');state.options=options;options.beforeRequest();return data;},
    auroraLerPlanoReadbackDriveAutorizado_:options=>{
      assert.equal(state.lock,true);state.calls.push('readback');state.readbackOptions=options;
      const count=options.readbackOffset===0?1:0;
      return {privateReadbackPlan:count?[receipt]:[],privateAliasRows:[],coverage:{offset:options.readbackOffset,nextOffset:null,
        total:1,documents:1,aliases:0,pending:0,complete:true,returned:count,pageDocuments:count,pageAliases:0,pagePending:0}};
    }
  });
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
