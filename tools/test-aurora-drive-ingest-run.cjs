'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {parseScope,makeRequest,parseDriveMode,sanitizeBatch,verifyReadback,verifyCoverage,sanitizePendingRow,readDriveCoverage,sha,rejectRuntimeFailure,withSharedLockRetry,runDriveBatches,completionFromCoverage,selectDriveDeployment,verifyPublishedDriveProject,driveAuthorizationDeadline}=require('./aurora-drive-ingest-run.cjs');
const scope=()=>({schemaVersion:'aurora.authorized-drive-source-scope.v1',orgId:'wmgj',projectId:'wmgj-hml-jfn-20260927',authorization:{realDataAuthorized:true,sourceMutationAllowed:false},sources:[{sourceId:'fixture-root',system:'DRIVE',folderId:'synthetic-folder-only',active:true,slaMinutes:1440}],fileIds:['synthetic-file-only'],excludedFolderIds:[]});
function encoded(v){if(v===null)return{nullValue:null};if(typeof v==='string')return{stringValue:v};if(typeof v==='boolean')return{booleanValue:v};if(typeof v==='number')return{integerValue:String(v)};return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encoded(x)]))}};}
function readbackFixture(){
  const row={entityId:'a'.repeat(48),sourceId:'synthetic-file-only',contentHash:'b'.repeat(64),contentSha256:'b'.repeat(64),textSha256:'c'.repeat(64),canonicalSnapshotHash:'d'.repeat(64),sourceVersion:1,revision:2,versionId:'e'.repeat(64),replayVerified:true};
  const data={orgId:'wmgj',entityType:'sourceDocument',source:{system:'DRIVE',sourceId:row.sourceId,contentHash:row.contentHash},sourceVersion:1,revision:2,extractionComplete:true,nativeReady:false,sourceIndependent:false,externalFetchRequired:true,workflowState:'PENDING_HUMAN_REVIEW',reviewState:'PENDING',canonicalSnapshotHash:row.canonicalSnapshotHash,
    extractionEvidence:{schemaVersion:1,contentSha256:row.contentHash,textSha256:row.textSha256,textLength:100,method:'blob_text',coverage:'TEXT_EXTRACTED_REVIEW_PENDING',sourceVersion:1,financialFactsApproved:false}};
  const version={orgId:'wmgj',entityId:row.entityId,entityType:'sourceDocument',revision:2,sourceVersion:1,snapshot:JSON.parse(JSON.stringify(data))};
  const fetcher=async url=>({ok:true,json:async()=>({fields:encoded(String(url).includes('/entityVersions/')?version:data).mapValue.fields})});
  return{row,data,version,fetcher};
}
test('Drive runtime selects the newest canonical Apps Script version independently of unrelated repository commits',()=>{
  const older='1'.repeat(40),newer='2'.repeat(40);
  const selected=selectDriveDeployment([
    {description:'AURORA_EXECUTION_API_CANONICAL '+older,versionNumber:41,deploymentId:'deployment_old_41'},
    {description:'AURORA_EXECUTION_API_CANONICAL '+newer,versionNumber:44,deploymentId:'deployment_new_44'},
    {description:'non-canonical',versionNumber:99,deploymentId:'deployment_other'}
  ]);
  assert.equal(selected.versionNumber,44);assert.equal(selected.publishedSourceSha,newer);
  assert.throws(()=>selectDriveDeployment([{description:'AURORA_EXECUTION_API_CANONICAL manual',versionNumber:45,deploymentId:'deployment_bad_45'}]),/DRIVE_PUBLISHED_VERSION_MISMATCH/);
  assert.throws(()=>selectDriveDeployment([
    {description:'AURORA_EXECUTION_API_CANONICAL '+newer,versionNumber:44,deploymentId:'deployment_new_44'},
    {description:'AURORA_EXECUTION_API_CANONICAL manual',versionNumber:45,deploymentId:'deployment_bad_45'}
  ]),/DRIVE_PUBLISHED_VERSION_MISMATCH/);
});
test('continuous Drive renewal extends only the exact authorized source scope, never the global HML window',()=>{
  const policy={scope:{validUntilUtc:'2026-10-26T03:00:00.000Z'},reaffirmations:[{
    decisionId:'AURORA-HML-CONTINUOUS-DRIVE-20261026',
    exactPrivateScopeSha256:'d'.repeat(64),validUntilUtc:'2026-10-27T04:30:00.000Z',
    continuousDriveTriggerAuthorized:true,processExistingAuthorized:true,queueMetadataRemediationAuthorized:true,
    realSourceActivationAuthorized:true,sourceMutationAuthorized:false,newSourceEnrollmentAuthorized:false,
    productionAuthorized:false,clinicalSensitiveAuthorized:false
  }]};
  const afterLegacy=Date.parse('2026-10-26T04:00:00.000Z');
  assert.equal(driveAuthorizationDeadline(policy,'d'.repeat(64),afterLegacy),Date.parse('2026-10-27T04:30:00.000Z'));
  assert.throws(()=>driveAuthorizationDeadline(policy,'e'.repeat(64),afterLegacy),/DRIVE_HML_WINDOW_INVALID/);
  const beforeLegacy=Date.parse('2026-10-26T02:00:00.000Z');
  assert.equal(driveAuthorizationDeadline(policy,'e'.repeat(64),beforeLegacy),Date.parse('2026-10-26T03:00:00.000Z'));
  policy.reaffirmations[0].sourceMutationAuthorized=true;
  assert.throws(()=>driveAuthorizationDeadline(policy,'d'.repeat(64),afterLegacy),/DRIVE_HML_WINDOW_INVALID/);
});

test('Drive runtime requires the complete published Apps Script project to match the checked-out source',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-drive-published-'));
  const src=path.join(root,'src'),published=path.join(root,'published');fs.mkdirSync(src);fs.mkdirSync(published);
  try{
    fs.writeFileSync(path.join(src,'00_CORE_WMGJ.gs'),'function core(){ return 1; }\n');
    fs.writeFileSync(path.join(src,'37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'function connector(){ return 2; }\n');
    fs.writeFileSync(path.join(root,'appsscript.json'),JSON.stringify({runtimeVersion:'V8',timeZone:'America/Sao_Paulo'},null,2));
    fs.writeFileSync(path.join(published,'00_CORE_WMGJ.js'),'function core(){ return 1; }\n');
    fs.writeFileSync(path.join(published,'37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'function connector(){ return 2; }\n');
    fs.writeFileSync(path.join(published,'appsscript.json'),JSON.stringify({timeZone:'America/Sao_Paulo',runtimeVersion:'V8'}));
    const verified=verifyPublishedDriveProject(root,published);assert.equal(verified.modulesVerified,2);assert.match(verified.manifestSha256,/^[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(published,'99_UNEXPECTED.gs'),'function unexpected(){}\n');
    assert.throws(()=>verifyPublishedDriveProject(root,published),/DRIVE_PUBLISHED_SOURCE_MISMATCH/);
    fs.rmSync(path.join(published,'99_UNEXPECTED.gs'));
    fs.writeFileSync(path.join(published,'00_CORE_WMGJ.js'),'function core(){ return 9; }\n');
    assert.throws(()=>verifyPublishedDriveProject(root,published),/DRIVE_PUBLISHED_SOURCE_MISMATCH/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('private source configuration must match the exact authorized hash',()=>{const raw=JSON.stringify(scope());assert.equal(parseScope(raw,sha(raw)).orgId,'wmgj');assert.throws(()=>parseScope(raw+' ',sha(raw)),/SCOPE_HASH_MISMATCH/);});
test('a different tenant cannot inherit the source authorization',()=>{const value=scope();value.orgId='other';const raw=JSON.stringify(value);assert.throws(()=>parseScope(raw,sha(raw)),/PRIVATE_SCOPE_REJECTED/);});
test('duplicate roots and exclusion of an allowed root are rejected',()=>{const value=scope();value.sources.push({...value.sources[0],sourceId:'another'});let raw=JSON.stringify(value);assert.throws(()=>parseScope(raw,sha(raw)),/SOURCE_SCOPE_REJECTED/);value.sources.pop();value.excludedFolderIds.push(value.sources[0].folderId);raw=JSON.stringify(value);assert.throws(()=>parseScope(raw,sha(raw)),/SCOPE_OVERLAP_REJECTED/);});
test('only the acquisition scope is sent to the published runtime',()=>{const value=scope();value.operatorPrivateNotes='PRIVATE_NOT_FOR_RUNTIME';const request=makeRequest(value,'EXECUTE','a'.repeat(64));assert.equal(JSON.stringify(request).includes('PRIVATE_NOT_FOR_RUNTIME'),false);assert.equal(request.expectedScopeSha256,'a'.repeat(64));});
test('public evidence drops private receipts, content and unexpected fields',()=>{const response={ok:true,code:'DRIVE_BATCH_OK',scopeSha256:'a'.repeat(64),triggersChanged:false,globalSettingsChanged:false,scan:{examined:1,queued:1,aliases:0,complete:false},processing:{attempted:1,accepted:1,duplicates:0,pending:0,failed:0,review:1,extractionErrors:0,replayVerified:1},privateReadbackPlan:[{sourceId:'PRIVATE_SOURCE_ID'}],secret:'DO_NOT_PRINT',text:'PRIVATE_DOCUMENT_TEXT'};const result=sanitizeBatch({response});assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(JSON.stringify(result).includes('DO_NOT_PRINT'),false);assert.throws(()=>sanitizeBatch({response:{...response,triggersChanged:true}}),/BATCH_RESPONSE_REJECTED/);});
test('canonical readback rejects a cross-tenant result',async()=>{const f=readbackFixture();f.data.orgId='other';await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/CANONICAL_IDENTITY_MISMATCH/);});
test('readback proves exact content, text, revision and immutable version',async()=>{const f=readbackFixture();const result=await verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher);assert.equal(result.verified,1);assert.equal(result.evidence[0].immutableVersionVerified,true);assert.equal(result.evidence[0].nativeReady,false);f.data.source.contentHash='f'.repeat(64);await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/CANONICAL_IDENTITY_MISMATCH/);});
test('review intake rejects unproved extraction and financial readiness claims',async()=>{for(const mutate of [f=>{f.data.extractionComplete=false;},f=>{f.data.nativeReady=true;},f=>{f.data.extractionEvidence.textSha256='f'.repeat(64);},f=>{f.data.extractionEvidence.financialFactsApproved=true;},f=>{f.data.canonicalSnapshotHash='f'.repeat(64);}]){const f=readbackFixture();mutate(f);await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/EXTRACTION_READBACK_MISMATCH/);}});
test('canonical readback accepts only governed manifest method and coverage pairs',async()=>{
  for(const method of ['google_sheets_manifest','zip_manifest','pdf_encrypted_manifest']){
    const f=readbackFixture();
    f.data.extractionEvidence.method=method;
    f.data.extractionEvidence.coverage='SOURCE_MANIFESTED_REVIEW_PENDING';
    f.version.snapshot=JSON.parse(JSON.stringify(f.data));
    const result=await verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher);
    assert.equal(result.verified,1);
  }
  for(const pair of [
    ['google_sheets_manifest','TEXT_EXTRACTED_REVIEW_PENDING'],
    ['zip_manifest','TEXT_EXTRACTED_REVIEW_PENDING'],
    ['pdf_encrypted_manifest','TEXT_EXTRACTED_REVIEW_PENDING'],
    ['blob_text','SOURCE_MANIFESTED_REVIEW_PENDING'],
    ['arbitrary_manifest','SOURCE_MANIFESTED_REVIEW_PENDING']
  ]){
    const f=readbackFixture();
    f.data.extractionEvidence.method=pair[0];
    f.data.extractionEvidence.coverage=pair[1];
    f.version.snapshot=JSON.parse(JSON.stringify(f.data));
    await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/EXTRACTION_READBACK_MISMATCH/);
  }
});
test('an unrelated immutable version cannot prove the receipt',async()=>{const f=readbackFixture();f.version.entityId='f'.repeat(48);await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/IMMUTABLE_READBACK_MISMATCH/);});
test('a revision mismatch and absent replay evidence cannot verify',async()=>{const f=readbackFixture();f.data.revision=3;await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/CANONICAL_IDENTITY_MISMATCH/);f.row.replayVerified=false;await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/READBACK_IDENTITY_REJECTED/);});

function coveragePage(row,offset){return {ok:true,code:'AURORA_DRIVE_READBACK_PLAN',triggersChanged:false,globalSettingsChanged:false,privateReadbackPlan:[row],privateAliasRows:offset===1?[{fileId:'synthetic-alias-only',primaryFileId:row.sourceId,contentHash:row.contentHash,entityId:row.entityId}]:[],coverage:{offset,nextOffset:offset===0?1:null,total:2,documents:1,aliases:1,pending:0,complete:offset===1,returned:1,pageDocuments:offset===0?1:0,pageAliases:offset===1?1:0,pagePending:0}};}
test('restart verifies durable receipts and aliases even with no newly accepted event',async()=>{const f=readbackFixture();let checks=0;const result=await verifyCoverage(async offset=>coveragePage(f.row,offset),async plan=>{checks++;return verifyReadback(plan,'wmgj','synthetic-token',f.fetcher);});assert.equal(checks,1);assert.equal(result.total,2);assert.equal(result.canonicalDocumentsVerified,1);assert.equal(result.aliasReferencesVerified,1);assert.equal(result.pending,0);});
test('coverage cannot omit a durable receipt or change a page total',async()=>{const f=readbackFixture();await assert.rejects(()=>verifyCoverage(async offset=>{const page=coveragePage(f.row,offset);page.privateReadbackPlan=[];return page;},async()=>({verified:1})),/COVERAGE_PAGINATION_REJECTED/);await assert.rejects(()=>verifyCoverage(async offset=>{const page=coveragePage(f.row,offset);if(offset){page.coverage.total=3;page.coverage.pending=1;}return page;},async()=>({verified:1})),/COVERAGE_CHANGED/);});
test('an alias requires the primary content hash and actual receipt',async()=>{const f=readbackFixture();await assert.rejects(()=>verifyCoverage(async offset=>{const page=coveragePage(f.row,offset);if(offset)page.privateAliasRows[0].contentHash='f'.repeat(64);return page;},async()=>({verified:1})),/ALIAS_PROOF_REJECTED/);});

function busyResponse(){return {response:{ok:false,code:'AURORA_DRIVE_ENGINE_BUSY',failureStage:'SHARED_LOCK',scopeSha256:'a'.repeat(64),triggersChanged:false,globalSettingsChanged:false,sourceMutation:false,privateReadbackPlan:[],scan:{examined:0,queued:0,aliases:0,complete:false},processing:{attempted:0,accepted:0,duplicates:0,pending:0,failed:0,review:0,extractionErrors:0,aliases:0,replayVerified:0}}};}
test('runtime failure retains the closed cause and stage instead of hiding it behind missing counters',()=>{
  assert.throws(()=>sanitizeBatch({response:{ok:false,code:'AURORA_DRIVE_SERVICE_QUOTA',failureStage:'EXECUTE'}}),error=>error.message==='AURORA_DRIVE_SERVICE_QUOTA'&&error.failureStage==='EXECUTE');
  assert.throws(()=>rejectRuntimeFailure({response:{ok:false,code:'PRIVATE_CONTENT',failureStage:'PRIVATE_CONTENT'}}),error=>error.message==='DRIVE_RUNTIME_REJECTED'&&error.failureStage===undefined);
});
test('only a proved shared-lock refusal is retried with bounded wait and source recheck',async()=>{
  let calls=0,rechecks=0;const waits=[];
  const accepted={response:{ok:true,code:'AURORA_DRIVE_BATCH_EXECUTED'}};
  const result=await withSharedLockRetry(()=>++calls<3?busyResponse():accepted,()=>{rechecks++;},async ms=>{waits.push(ms);});
  assert.equal(result,accepted);assert.equal(calls,3);assert.equal(rechecks,2);assert.deepEqual(waits,[10000,20000]);
  calls=0;await assert.rejects(()=>withSharedLockRetry(()=>{calls++;return busyResponse();},()=>{},async()=>{}),/AURORA_DRIVE_ENGINE_BUSY/);assert.equal(calls,5);
});
test('a partial write or non-lock failure cannot enter the shared-lock retry path',async()=>{
  for(const alter of [v=>{v.processing.accepted=1;},v=>{v.processing.aliases=1;},v=>{v.scan.complete=true;},v=>{v.failureStage='EXECUTE';},v=>{v.privateReadbackPlan=[{}];}]){
    let calls=0;const value=busyResponse();alter(value.response);
    await assert.rejects(()=>withSharedLockRetry(()=>{calls++;return value;},()=>{},async()=>{}),/DRIVE_BUSY_RESPONSE_REJECTED/);assert.equal(calls,1);
  }
  let calls=0;const quota={response:{ok:false,code:'AURORA_DRIVE_SERVICE_QUOTA'}};
  assert.equal(await withSharedLockRetry(()=>{calls++;return quota;},()=>{},async()=>{}),quota);assert.equal(calls,1);
});

test('scanner and process-cursor failures preserve the fixed cause and are never retried automatically',async()=>{
  for(const suffix of ['CURSOR_CONFLICT','CURSOR_LIMIT','DEPTH_OR_CYCLE','INFLIGHT_RECONCILIATION_REQUIRED','LIMIT_INVALID',
    'QUEUE_CONTRACT','QUEUE_SCOPE_INVALID','QUEUE_TENANT_CONFLICT','SCOPE_LIMIT','SCOPE_REQUIRED','SOURCE_INVALID','PROCESS_CURSOR_INVALID']) {
    const code='AURORA_DRIVE_'+suffix,envelope={response:{ok:false,code,failureStage:'EXECUTE',
      cursorDiagnostics:{privateUnexpected:'PRIVATE_TOKEN'}}};
    let calls=0;
    const result=await withSharedLockRetry(()=>{calls++;return envelope;},()=>{throw Error('RETRY_FORBIDDEN');},async()=>{throw Error('WAIT_FORBIDDEN');});
    assert.equal(result,envelope);assert.equal(calls,1);
    assert.throws(()=>sanitizeBatch(result),error=>error.message===code && error.failureStage==='EXECUTE'
      && !JSON.stringify(error).includes('PRIVATE_TOKEN'));
  }
  assert.throws(()=>rejectRuntimeFailure({response:{ok:false,code:'AURORA_DRIVE_CURSOR_LIMIT:PRIVATE_TOKEN',failureStage:'EXECUTE'}}),
    error=>error.message==='DRIVE_RUNTIME_REJECTED' && error.failureStage==='EXECUTE');
});

function batchResponse({attempted=0,accepted=0,duplicates=0,aliases=0,pending=0,failed=0,complete=false,plan=[]}={}) {
  return {response:{ok:failed===0,code:failed?'AURORA_DRIVE_BATCH_PENDING':'AURORA_DRIVE_BATCH_EXECUTED',
    scopeSha256:'a'.repeat(64),triggersChanged:false,globalSettingsChanged:false,
    scan:{examined:0,queued:0,aliases,complete},
    processing:{attempted,accepted,duplicates,pending,failed,review:accepted+duplicates,
      extractionErrors:0,replayVerified:plan.length},privateReadbackPlan:plan}};
}
function batchHarness(responses,mode='PROCESS_EXISTING',maxBatches=20,verifyPlan=async plan=>({verified:plan.length,evidence:[]})) {
  const requests=[],saved=[],events=[];let index=0,guards=0;
  const execute=()=>runDriveBatches({scope:scope(),mode,maxBatches,
    beforeBatch:()=>{guards++;events.push('guard');},
    call:async request=>{
      requests.push(request);
      if(request.mode==='PREVIEW')return {response:{ok:true,scopeSha256:'a'.repeat(64)}};
      assert.equal(request.mode,parseDriveMode(mode));
      assert.equal(request.expectedScopeSha256,'a'.repeat(64));
      return responses[Math.min(index++,responses.length-1)];
    },
    verifyPlan:async plan=>{events.push('readback');return verifyPlan(plan);},
    onBatch:batch=>{events.push('saved');saved.push(batch);}});
  return {execute,requests,saved,events,get guards(){return guards;}};
}
test('Drive mode is closed, defaults to EXECUTE, and invalid mode fails before any request',async()=>{
  assert.equal(parseDriveMode(undefined),'EXECUTE');assert.equal(parseDriveMode(''),'EXECUTE');
  assert.equal(parseDriveMode('PROCESS_EXISTING'),'PROCESS_EXISTING');
  assert.equal(parseDriveMode('READBACK'),'READBACK');
  for(const mode of ['PROCESS_EXISTING private',null,{}]) {
    const f=batchHarness([batchResponse()],mode);
    await assert.rejects(f.execute,/DRIVE_MODE_REJECTED/);assert.equal(f.guards,0);assert.deepEqual(f.requests,[]);
  }
});
test('PROCESS_EXISTING uses the same preview scope, verifies every receipt, and stops when its queue drains',async()=>{
  const proof=readbackFixture();
  const f=batchHarness([batchResponse({attempted:1,accepted:1,pending:1,plan:[proof.row]}),
    batchResponse({attempted:1,aliases:1})],'PROCESS_EXISTING',20,
    plan=>verifyReadback(plan,'wmgj','synthetic-token',proof.fetcher));
  const result=await f.execute();
  assert.equal(result.stopReason,'SCOPED_QUEUE_DRAINED');assert.equal(result.scopeSha256,'a'.repeat(64));
  assert.equal(f.guards,2);assert.equal(f.saved.length,2);
  assert.deepEqual(f.requests.map(x=>x.mode),['PREVIEW','PROCESS_EXISTING','PREVIEW','PROCESS_EXISTING']);
  assert.equal(f.saved[0].canonicalReadback.verified,1);assert.equal(f.saved[1].scan.aliases,1);
  assert.equal(f.saved.every(x=>x.scan.complete===false),true);
  const coverage=await verifyCoverage(async offset=>coveragePage(proof.row,offset),
    plan=>verifyReadback(plan,'wmgj','synthetic-token',proof.fetcher));
  const summary=completionFromCoverage('PROCESS_EXISTING',result.lastBatch,coverage);
  assert.equal(summary.scopedQueueDrained,true);assert.equal(summary.complete,false);
  assert.equal(summary.fullSynchronizationVerified,false);assert.equal(coverage.canonicalDocumentsVerified,1);
});
test('PROCESS_EXISTING resume recovers earlier receipts through final READBACK even with an empty new batch',async()=>{
  const proof=readbackFixture(),f=batchHarness([batchResponse()]);
  const result=await f.execute();assert.equal(f.saved.length,1);assert.equal(f.saved[0].canonicalReadback.verified,0);
  let pages=0;
  const coverage=await verifyCoverage(async offset=>{pages++;return coveragePage(proof.row,offset);},
    plan=>verifyReadback(plan,'wmgj','synthetic-token',proof.fetcher));
  assert.equal(pages,2);assert.equal(coverage.canonicalDocumentsVerified,1);assert.equal(coverage.aliasReferencesVerified,1);
  assert.equal(coverage.pending,0);assert.equal(coverage.allReceiptsVerified,true);
  assert.equal(completionFromCoverage('PROCESS_EXISTING',result.lastBatch,coverage).complete,false);
});
test('PROCESS_EXISTING stops on no attempts, bounded retry budget or max batches without claiming distinct IDs were visited',async()=>{
  for(const fixture of [
    {response:batchResponse({pending:5}),max:300,count:1,reason:'NO_ATTEMPTS'},
    {response:batchResponse({attempted:2,pending:5}),max:300,count:3,reason:'NO_PROGRESS_BUDGET'},
    {response:batchResponse({attempted:1,pending:100}),max:2,count:2,reason:'BATCH_LIMIT'}
  ]) {
    const f=batchHarness([fixture.response],'PROCESS_EXISTING',fixture.max),result=await f.execute();
    assert.equal(result.stopReason,fixture.reason);assert.equal(f.saved.length,fixture.count);
    assert.equal(result.lastBatch.processing.pending,fixture.response.response.processing.pending);
    assert.equal(result.lastBatch.scan.complete,false);assert.equal(result.allPendingIdsAttempted,undefined);
  }
});
test('PROCESS_EXISTING rejects enumeration claims and saves verified partial receipts before a blocking failure',async()=>{
  for(const mutate of [v=>{v.scan.examined=1;},v=>{v.scan.queued=1;},v=>{v.scan.complete=true;}]) {
    const response=batchResponse();mutate(response.response);const f=batchHarness([response]);
    await assert.rejects(f.execute,/DRIVE_PROCESS_ONLY_SCAN_REJECTED/);assert.equal(f.saved.length,0);
  }
  const proof=readbackFixture(),f=batchHarness([batchResponse({attempted:2,accepted:1,pending:1,failed:1,plan:[proof.row]})],
    'PROCESS_EXISTING',20,plan=>verifyReadback(plan,'wmgj','synthetic-token',proof.fetcher));
  await assert.rejects(f.execute,/DRIVE_BATCH_HAS_UNRESOLVED_FAILURE/);
  assert.equal(f.saved.length,1);assert.equal(f.saved[0].canonicalReadback.verified,1);
  assert.deepEqual(f.events,['guard','readback','saved']);
});
test('default EXECUTE keeps enumeration completion and does not silently fall back from a scanner failure',async()=>{
  const f=batchHarness([batchResponse({attempted:1,pending:1}),batchResponse({complete:true})],'',20);
  const result=await f.execute();assert.equal(result.stopReason,'ENUMERATION_AND_QUEUE_DRAINED');assert.equal(f.saved.length,2);
  assert.deepEqual(f.requests.map(x=>x.mode),['PREVIEW','EXECUTE','PREVIEW','EXECUTE']);
  const complete=completionFromCoverage('EXECUTE',result.lastBatch,{allReceiptsVerified:true,pending:0});
  assert.equal(complete.complete,true);
  assert.equal(completionFromCoverage('PROCESS_EXISTING',result.lastBatch,{allReceiptsVerified:true,pending:0,complete:true}).complete,false);
  assert.throws(()=>completionFromCoverage('PROCESS_EXISTING',result.lastBatch,{pending:0}),/COVERAGE_INCOMPLETE/);
  const blocked=batchHarness([{response:{ok:false,code:'AURORA_DRIVE_INFLIGHT_RECONCILIATION_REQUIRED',failureStage:'EXECUTE'}}],'EXECUTE');
  await assert.rejects(blocked.execute,/INFLIGHT_RECONCILIATION_REQUIRED/);
  assert.deepEqual(blocked.requests.map(x=>x.mode),['PREVIEW','EXECUTE']);assert.equal(blocked.saved.length,0);
});
test('drive_mode stays inside DRIVE_TOTAL and preserves workflow execution, source, environment and cleanup gates',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/aurora-rc11-recovery-real-ingest.yml'),'utf8').replace(/\r\n/g,'\n');
  assert.match(workflow,/options: \[RC11_SAMPLE, DRIVE_TOTAL\]/);
  assert.match(workflow,/drive_mode:\n(?:[^\n]*\n){0,5}\s+default: EXECUTE\n\s+options: \[EXECUTE, PROCESS_EXISTING, READBACK\]/);
  assert.match(workflow,/if: github\.event_name != 'workflow_dispatch' \|\| inputs\.operation != 'DRIVE_TOTAL'/);
  const drive=workflow.split('\n  drive_total:\n')[1];assert.ok(drive);
  assert.match(drive,/if: github\.event_name == 'workflow_dispatch' && inputs\.operation == 'DRIVE_TOTAL' && github\.ref == 'refs\/heads\/main' && inputs\.expected_sha == github\.sha && inputs\.confirmation == 'RUN_AUTHORIZED_REAL_DRIVE_INTAKE'/);
  assert.match(drive,/environment: firebase-homologation/);
  assert.match(drive,/AURORA_DRIVE_MODE: \$\{\{ inputs\.drive_mode \|\| 'EXECUTE' \}\}/);
  assert.match(drive,/run: node tools\/aurora-drive-ingest-run\.cjs/);
  assert.match(drive,/Remove runner OAuth and private execution responses\n\s+if: always\(\)/);
  assert.match(workflow,/group: aurora-rc11-hml\n\s+cancel-in-progress: false/);
});

function pendingRow(fileId='synthetic-pending-0001',extra={}){
  return {fileId,sourceVersion:10000,attempts:3,queueStatus:'ERRO_REPROCESSAR',
    code:'AURORA_DRIVE_CONVERSION_UNSUPPORTED',mediaType:'PDF',...extra};
}
function pendingPage(offset,total=2){
  return {ok:true,code:'AURORA_DRIVE_READBACK_PLAN',triggersChanged:false,globalSettingsChanged:false,
    privateReadbackPlan:[],privateAliasRows:[],privatePendingRows:[pendingRow('synthetic-pending-'+offset)],
    coverage:{offset,nextOffset:offset+1===total?null:offset+1,total,documents:0,aliases:0,pending:total,
      complete:offset+1===total,returned:1,pageDocuments:0,pageAliases:0,pagePending:1}};
}
function readOnlyEnvelope(value){
  return {response:{scopeSha256:'a'.repeat(64),sourceMutation:false,triggersChanged:false,globalSettingsChanged:false,
    scan:{examined:0,queued:0,aliases:0,complete:false},
    processing:{attempted:0,accepted:0,duplicates:0,pending:0,failed:0,review:0,extractionErrors:0,aliases:0,replayVerified:0},...value}};
}
test('pending diagnostics retain only fixed labels and distinguish unknown counters from zero',()=>{
  const result=sanitizePendingRow(pendingRow('PRIVATE_FILE_IDENTIFIER',{code:'SECRET_CUSTOMER_TOKEN',
    sourceVersion:null,attempts:null,text:'PRIVATE_DOCUMENT_TEXT',lastError:'PRIVATE_URL'}));
  assert.equal(result.code,'UNKNOWN');assert.equal(result.attempts,null);assert.equal(result.sourceVersion,null);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('SECRET'));
  for(const extra of [{fileId:'bad'},{sourceVersion:0},{sourceVersion:'10000'},{attempts:-1},
    {queueStatus:'SECRET_CUSTOMER_TOKEN'},{mediaType:'PRIVATE_DOCUMENT_NAME'}])
    assert.throws(()=>sanitizePendingRow(pendingRow(undefined,extra)),/DRIVE_PENDING_IDENTITY_REJECTED/);
});
test('all pending pages are counted once without publishing identifiers or free-form errors',async()=>{
  const coverage=await verifyCoverage(async offset=>{
    const page=pendingPage(offset);
    if(offset)Object.assign(page.privatePendingRows[0],{code:'SECRET_CUSTOMER_TOKEN',attempts:null,sourceVersion:null,extra:'PRIVATE'});
    return page;
  },()=>{throw Error('UNEXPECTED_CANONICAL_READ');});
  assert.equal(coverage.allReceiptsVerified,true);assert.equal(coverage.pending,2);
  assert.deepEqual(coverage.pendingDiagnostics,{schemaVersion:'aurora.drive-pending-diagnostics.v1',queueMetadataOnly:true,
    count:2,byCode:{AURORA_DRIVE_CONVERSION_UNSUPPORTED:1,UNKNOWN:1},byStatus:{ERRO_REPROCESSAR:2},
    byMediaType:{PDF:2},unknownSourceVersion:1,unknownAttempts:1,totalRecordedAttempts:3,
    justifiedHumanReview:0,unjustifiedPending:2});
  assert.ok(!JSON.stringify(coverage).includes('synthetic-pending'));assert.ok(!JSON.stringify(coverage).includes('SECRET'));
});
test('pending coverage rejects omitted rows, repeated identities, and overlap with a later primary or alias',async()=>{
  for(const mutate of [p=>{delete p.privatePendingRows;},p=>{p.privatePendingRows=[];},
    p=>{p.privatePendingRows[0].fileId='same-pending-file';}]){
    await assert.rejects(()=>verifyCoverage(async offset=>{const p=pendingPage(offset);mutate(p);return p;},async()=>({verified:1})),
      /DRIVE_PENDING_(COVERAGE|IDENTITY)_REJECTED/);
  }
  const f=readbackFixture();
  for(const collision of [f.row.sourceId,'synthetic-alias-only']){
    await assert.rejects(()=>verifyCoverage(async offset=>{
      if(offset===0){const p=pendingPage(0,3);p.coverage.documents=1;p.coverage.aliases=1;p.coverage.pending=1;
        p.privatePendingRows[0].fileId=collision;return p;}
      const p=coveragePage(f.row,offset-1);Object.assign(p.coverage,{offset,total:3,pending:1,
        nextOffset:offset===1?2:null,complete:offset===2});return p;
    },plan=>verifyReadback(plan,'wmgj','synthetic-token',f.fetcher)),/DRIVE_COVERAGE_INCOMPLETE/);
  }
});
test('READBACK-only verifies guards and all pages without entering the mutating batch loop',async()=>{
  const requests=[];let checks=0;
  const result=await readDriveCoverage({scope:scope(),beforeRead:()=>{checks++;},
    call:async request=>{requests.push(request);return readOnlyEnvelope(request.mode==='PREVIEW'
      ?{ok:true,code:'AURORA_DRIVE_PREVIEW_VERIFIED'}:pendingPage(request.readbackOffset));},
    verifyPlan:()=>{throw Error('UNEXPECTED_CANONICAL_READ');}});
  assert.deepEqual(requests.map(x=>x.mode),['PREVIEW','READBACK','READBACK']);assert.equal(checks,3);
  assert.ok(requests.slice(1).every(x=>x.expectedScopeSha256==='a'.repeat(64)));
  assert.equal(result.coverage.pendingDiagnostics.count,2);
  const f=batchHarness([batchResponse()],'READBACK');
  await assert.rejects(f.execute,/DRIVE_MUTATING_MODE_REQUIRED/);assert.equal(f.guards,0);assert.deepEqual(f.requests,[]);
  assert.deepEqual(completionFromCoverage('READBACK',{scan:{complete:true}},{allReceiptsVerified:true,pending:0}),
    {complete:false,scopedQueueDrained:true,scopedQueueRemediated:true,fullSynchronizationVerified:false,documentReviewRequired:false});
});
test('read-only proof rejects scope/source drift and any claimed operational write',async()=>{
  for(const mutate of [v=>{v.scopeSha256='b'.repeat(64);},v=>{v.processing.attempted=1;},
    v=>{v.scan.complete=true;},v=>{v.sourceMutation=true;}]){
    let calls=0;
    await assert.rejects(()=>readDriveCoverage({scope:scope(),scopeSha256:'a'.repeat(64),beforeRead:()=>{},
      call:async()=>{calls++;const e=readOnlyEnvelope(pendingPage(0,1));mutate(e.response);return e;},verifyPlan:async()=>({verified:0})}),
      /DRIVE_(COVERAGE_SCOPE_MISMATCH|READ_ONLY_RESPONSE_REJECTED)/);
    assert.equal(calls,1);
  }
  let calls=0,guards=0;
  await assert.rejects(()=>readDriveCoverage({scope:scope(),scopeSha256:'a'.repeat(64),
    beforeRead:()=>{if(++guards===2)throw Error('DRIVE_PUBLISHED_SOURCE_CHANGED');},
    call:async request=>{calls++;return readOnlyEnvelope(pendingPage(request.readbackOffset));},verifyPlan:async()=>({verified:0})}),
    /DRIVE_PUBLISHED_SOURCE_CHANGED/);assert.equal(calls,1);
});
test('READBACK verifies an empty queue without asserting enumeration or full synchronization',async()=>{
  const page={...pendingPage(0),privatePendingRows:[],coverage:{offset:0,nextOffset:null,total:0,documents:0,aliases:0,
    pending:0,complete:true,returned:0,pageDocuments:0,pageAliases:0,pagePending:0}};
  const result=await readDriveCoverage({scope:scope(),scopeSha256:'a'.repeat(64),beforeRead:()=>{},
    call:async()=>readOnlyEnvelope(page),verifyPlan:async()=>({verified:0})});
  assert.equal(result.coverage.pendingDiagnostics.count,0);assert.equal(result.coverage.pages,1);
  assert.equal(completionFromCoverage('READBACK',null,result.coverage).complete,false);
});
test('READBACK-only recovers the existing canonical document and every alias with zero ingestion batches',async()=>{
  const f=readbackFixture(),requests=[];let canonicalReads=0;
  const result=await readDriveCoverage({scope:scope(),scopeSha256:'a'.repeat(64),beforeRead:()=>{},
    call:async request=>{requests.push(request);return readOnlyEnvelope(coveragePage(f.row,request.readbackOffset));},
    verifyPlan:plan=>{canonicalReads++;return verifyReadback(plan,'wmgj','synthetic-token',f.fetcher);}});
  assert.deepEqual(requests.map(x=>x.mode),['READBACK','READBACK']);assert.equal(canonicalReads,1);
  assert.equal(result.coverage.canonicalDocumentsVerified,1);assert.equal(result.coverage.aliasReferencesVerified,1);
  assert.equal(result.coverage.pendingDiagnostics.count,0);assert.equal(result.coverage.allReceiptsVerified,true);
});


test('justified human review closes scoped remediation without claiming queue drain or global synchronization',async()=>{
  const rows=[
    pendingRow('synthetic-review-0001',{queueStatus:'REVISAR_HUMANO',attempts:10,code:'AURORA_DRIVE_RETRY_BUDGET_EXHAUSTED',mediaType:'OTHER'}),
    pendingRow('synthetic-review-0002',{queueStatus:'REVISAR_HUMANO',attempts:0,code:'AURORA_DRIVE_LEGACY_REVIEW_REASON_UNRECORDED',mediaType:'PDF'})
  ];
  const coverage=await verifyCoverage(async offset=>({
    ok:true,code:'AURORA_DRIVE_READBACK_PLAN',triggersChanged:false,globalSettingsChanged:false,
    privateReadbackPlan:[],privateAliasRows:[],privatePendingRows:[rows[offset]],
    coverage:{offset,nextOffset:offset===0?1:null,total:2,documents:0,aliases:0,pending:2,
      complete:offset===1,returned:1,pageDocuments:0,pageAliases:0,pagePending:1}
  }),()=>{throw Error('UNEXPECTED_CANONICAL_READ');});
  assert.equal(coverage.pendingDiagnostics.justifiedHumanReview,2);
  assert.equal(coverage.pendingDiagnostics.unjustifiedPending,0);
  assert.deepEqual(coverage.pendingDiagnostics.byCode,
    {AURORA_DRIVE_RETRY_BUDGET_EXHAUSTED:1,AURORA_DRIVE_LEGACY_REVIEW_REASON_UNRECORDED:1});
  const state=completionFromCoverage('PROCESS_EXISTING',null,coverage);
  assert.equal(state.scopedQueueDrained,false);assert.equal(state.scopedQueueRemediated,true);
  assert.equal(state.fullSynchronizationVerified,false);assert.equal(state.documentReviewRequired,true);
});

test('closed remediation diagnostic codes are accepted but arbitrary values stay UNKNOWN',()=>{
  assert.equal(sanitizePendingRow(pendingRow('synthetic-review-closed1',{
    queueStatus:'REVISAR_HUMANO',code:'AURORA_DRIVE_RETRY_BUDGET_EXHAUSTED'})).code,'AURORA_DRIVE_RETRY_BUDGET_EXHAUSTED');
  assert.equal(sanitizePendingRow(pendingRow('synthetic-review-closed2',{
    queueStatus:'REVISAR_HUMANO',code:'AURORA_DRIVE_LEGACY_REVIEW_REASON_UNRECORDED'})).code,'AURORA_DRIVE_LEGACY_REVIEW_REASON_UNRECORDED');
  assert.equal(sanitizePendingRow(pendingRow('synthetic-review-secret',{code:'PRIVATE_CUSTOM_CODE'})).code,'UNKNOWN');
});


test('continuous Drive workflow is exact-scope, protected, serialized, and cleans private OAuth material',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/aurora-drive-continuous-feed.yml'),'utf8').replace(/\r\n/g,'\n');
  assert.match(workflow,/options: \[ACTIVATE, REMEDIATE, STATUS\]/);
  assert.match(workflow,/environment: firebase-homologation/);
  assert.match(workflow,/group: aurora-rc11-hml\n\s+cancel-in-progress: false/);
  assert.match(workflow,/inputs\.expected_sha == github\.sha/);
  assert.match(workflow,/AURORA_DRIVE_SCOPE_JSON: \$\{\{ secrets\.AURORA_WMGJ_DRIVE_SOURCE_SCOPE \}\}/);
  assert.match(workflow,/EXPECTED_SCOPE_SHA256: \$\{\{ inputs\.scope_sha256 \}\}/);
  assert.match(workflow,/d3978b0f743ab22021c586b5d85c731beca34a6c03306609f33e64d512ab19fa/);
  assert.match(workflow,/auroraAtivarAlimentacaoContinuaDriveAutorizada/);
  assert.match(workflow,/auroraSanearPendenciasDriveAutorizadas/);
  assert.match(workflow,/auroraLerStatusAlimentacaoContinuaDriveAutorizada/);
  assert.match(workflow,/sourceCount>=1 and \.response\.sourceCount<=12/);
  assert.match(workflow,/duplicateCollectors==0/);
  assert.match(workflow,/newSourceEnrolled:false,sourceMutation:false,productionMutation:false/);
  assert.match(workflow,/Remove runner OAuth and private execution responses\n\s+if: always\(\)/);
  assert.doesNotMatch(workflow,/echo\s+"?\$AURORA_DRIVE_SCOPE_JSON/);
});
