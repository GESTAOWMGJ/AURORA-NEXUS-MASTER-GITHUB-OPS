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
    assert.equal(result.evidence[0].extractionCoverage,'SOURCE_MANIFESTED_REVIEW_PENDING');
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

function coveragePage(row,offset){return {ok:true,code:'AURORA_DRIVE_READBACK_PLAN',triggersChanged:false,globalSettingsChanged:false,privateReadbackPlan:[row],privateAliasRows:offset===1?[{fileId:'synthetic-alias-only',primaryFileId:row.sourceId,contentHash:row.contentHash,entityId:row.entityId}]:[],coverage:{offset,nextOffset:offset===0?1:null,total:2,documents:1,manifests:0,aliases:1,pending:0,complete:offset===1,returned:1,pageDocuments:offset===0?1:0,pageManifests:0,pageAliases:offset===1?1:0,pagePending:0}};}
test('restart verifies durable receipts and aliases even with no newly accepted event',async()=>{const f=readbackFixture();let checks=0;const result=await verifyCoverage(async offset=>coveragePage(f.row,offset),async plan=>{checks++;return verifyReadback(plan,'wmgj','synthetic-token',f.fetcher);});assert.equal(checks,1);assert.equal(result.total,2);assert.equal(result.canonicalDocumentsVerified,1);assert.equal(result.aliasReferencesVerified,1);assert.equal(result.pending,0);});
test('coverage cannot omit a durable receipt or change a page total',async()=>{const f=readbackFixture();await assert.rejects(()=>verifyCoverage(async offset=>{const page=coveragePage(f.row,offset);page.privateReadbackPlan=[];return page;},async plan=>verifyReadback(plan,'wmgj','synthetic-token',f.fetcher)),/COVERAGE_PAGINATION_REJECTED/);await assert.rejects(()=>verifyCoverage(async offset=>{const page=coveragePage(f.row,offset);if(offset){page.coverage.total=3;page.coverage.pending=1;}return page;},async plan=>verifyReadback(plan,'wmgj','synthetic-token',f.fetcher)),/COVERAGE_CHANGED/);});
test('an alias requires the primary content hash and actual receipt',async()=>{const f=readbackFixture();await assert.rejects(()=>verifyCoverage(async offset=>{const page=coveragePage(f.row,offset);if(offset)page.privateAliasRows[0].contentHash='f'.repeat(64);return page;},async plan=>verifyReadback(plan,'wmgj','synthetic-token',f.fetcher)),/ALIAS_PROOF_REJECTED/);});

function manifestCoverageScenario() {
  const text=readbackFixture();
  const manifests=['google_sheets_manifest','zip_manifest'].map(method=>{
    const f=readbackFixture();
    Object.assign(f.row,{entityId:sha(method).slice(0,48),sourceId:'synthetic-'+method+'-file',versionId:sha('version-'+method)});
    f.data.source.sourceId=f.row.sourceId;f.data.extractionEvidence.method=method;
    f.data.extractionEvidence.coverage='SOURCE_MANIFESTED_REVIEW_PENDING';
    f.version.entityId=f.row.entityId;f.version.snapshot=JSON.parse(JSON.stringify(f.data));
    return f;
  });
  // The alias precedes its manifest primary: canonical verification must be
  // unique and the classification must come from Firestore, not page order.
  const entries=[{kind:'aliases',fixture:manifests[1]},{kind:'documents',fixture:text},
    {kind:'pending'},{kind:'manifests',fixture:manifests[1]},{kind:'manifests',fixture:manifests[0]}];
  const fixtures=[text,...manifests],calls=[];
  const page=offset=>{
    const entry=entries[offset],row=entry.fixture?.row;
    return {ok:true,code:'AURORA_DRIVE_READBACK_PLAN',triggersChanged:false,globalSettingsChanged:false,
      privateReadbackPlan:row?[row]:[],
      privateAliasRows:entry.kind==='aliases'?[{fileId:'synthetic-manifest-alias',primaryFileId:row.sourceId,
        entityId:row.entityId,contentHash:row.contentHash}]:[],
      privatePendingRows:entry.kind==='pending'?[pendingRow('synthetic-still-pending')]:[],
      coverage:{offset,nextOffset:offset+1<entries.length?offset+1:null,total:5,documents:1,manifests:2,aliases:1,pending:1,
        returned:1,complete:offset+1===entries.length,pageDocuments:entry.kind==='documents'?1:0,
        pageManifests:entry.kind==='manifests'?1:0,pageAliases:entry.kind==='aliases'?1:0,pagePending:entry.kind==='pending'?1:0}};
  };
  const verify=plan=>{
    calls.push(plan[0].entityId);
    const f=fixtures.find(item=>item.row.entityId===plan[0].entityId);assert.ok(f);
    return verifyReadback(plan,'wmgj','synthetic-token',f.fetcher);
  };
  return {page,verify,calls,manifests};
}
test('coverage proves and counts text, manifests, aliases and pending rows separately across restart pages',async()=>{
  const f=manifestCoverageScenario(),coverage=await verifyCoverage(f.page,f.verify);
  assert.equal(coverage.total,5);assert.equal(coverage.documents,1);assert.equal(coverage.manifests,2);
  assert.equal(coverage.aliases,1);assert.equal(coverage.pending,1);assert.equal(coverage.pages,5);
  assert.equal(coverage.canonicalDocumentsVerified,3);assert.equal(coverage.canonicalTextDocumentsVerified,1);
  assert.equal(coverage.canonicalManifestDocumentsVerified,2);assert.equal(coverage.aliasReferencesVerified,1);
  assert.equal(coverage.pendingDiagnostics.count,1);assert.equal(coverage.allReceiptsVerified,true);
  assert.equal(f.calls.length,3);assert.equal(new Set(f.calls).size,3);
  assert.equal(JSON.stringify(coverage).includes('synthetic-'),false);
});
test('coverage cannot relabel canonical manifests as text or omit their readback proof',async()=>{
  const f=manifestCoverageScenario();
  await assert.rejects(()=>verifyCoverage(offset=>{
    const page=f.page(offset);page.coverage.documents=3;page.coverage.manifests=0;
    page.coverage.pageDocuments+=page.coverage.pageManifests;page.coverage.pageManifests=0;
    return page;
  },f.verify),/DRIVE_COVERAGE_INCOMPLETE/);
  const g=manifestCoverageScenario();
  await assert.rejects(()=>verifyCoverage(g.page,async()=>({verified:1})),/DRIVE_COVERAGE_READBACK_FAILED/);
  for(const mutate of [proof=>{proof.extractionCoverage='UNKNOWN';},proof=>{proof.entityIdSha256='f'.repeat(64);}]) {
    const h=manifestCoverageScenario();
    await assert.rejects(()=>verifyCoverage(h.page,async plan=>{
      const checked=await h.verify(plan);mutate(checked.evidence[0]);return checked;
    }),/DRIVE_COVERAGE_READBACK_FAILED/);
  }
  const invalid=manifestCoverageScenario();invalid.manifests[1].version.snapshot.extractionEvidence.textSha256='f'.repeat(64);
  await assert.rejects(()=>verifyCoverage(invalid.page,invalid.verify),/DRIVE_IMMUTABLE_READBACK_MISMATCH/);
});
test('coverage rejects absent, negative or changed manifest counters',async()=>{
  for(const mutate of [c=>{delete c.manifests;},c=>{c.manifests=-1;},c=>{c.pageManifests=NaN;}]) {
    const f=manifestCoverageScenario();
    await assert.rejects(()=>verifyCoverage(offset=>{const page=f.page(offset);mutate(page.coverage);return page;},f.verify),
      /DRIVE_COVERAGE_COUNTER_REJECTED/);
  }
  const f=manifestCoverageScenario();
  await assert.rejects(()=>verifyCoverage(offset=>{
    const page=f.page(offset);if(offset===1){page.coverage.manifests--;page.coverage.pending++;}return page;
  },f.verify),/DRIVE_COVERAGE_CHANGED/);
});
test('manifest-only coverage still requires content extraction and human review after enumeration finishes',()=>{
  const coverage={allReceiptsVerified:true,pending:0,manifests:2};
  for(const mode of ['EXECUTE','PROCESS_EXISTING','READBACK']) {
    const result=completionFromCoverage(mode,{scan:{complete:true}},coverage);
    assert.equal(result.complete,false);assert.equal(result.scopedQueueDrained,true);
    assert.equal(result.scopedQueueRemediated,true);assert.equal(result.fullSynchronizationVerified,false);
    assert.equal(result.documentReviewRequired,true);assert.equal(result.pendingExtractionRequiresFollowup,true);
  }
  assert.throws(()=>completionFromCoverage('READBACK',null,{...coverage,manifests:-1}),/DRIVE_COVERAGE_INCOMPLETE/);
  assert.throws(()=>completionFromCoverage('READBACK',null,{allReceiptsVerified:true,pending:0}),/DRIVE_COVERAGE_INCOMPLETE/);
});

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
  const complete=completionFromCoverage('EXECUTE',result.lastBatch,{allReceiptsVerified:true,manifests:0,pending:0});
  assert.equal(complete.complete,true);
  assert.equal(completionFromCoverage('PROCESS_EXISTING',result.lastBatch,{allReceiptsVerified:true,manifests:0,pending:0,complete:true}).complete,false);
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
    coverage:{offset,nextOffset:offset+1===total?null:offset+1,total,documents:0,manifests:0,aliases:0,pending:total,
      complete:offset+1===total,returned:1,pageDocuments:0,pageManifests:0,pageAliases:0,pagePending:1}};
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
  assert.deepEqual(completionFromCoverage('READBACK',{scan:{complete:true}},{allReceiptsVerified:true,manifests:0,pending:0}),
    {complete:false,scopedQueueDrained:true,scopedQueueRemediated:true,fullSynchronizationVerified:false,documentReviewRequired:false,pendingExtractionRequiresFollowup:false});
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
  const page={...pendingPage(0),privatePendingRows:[],coverage:{offset:0,nextOffset:null,total:0,documents:0,manifests:0,aliases:0,
    pending:0,complete:true,returned:0,pageDocuments:0,pageManifests:0,pageAliases:0,pagePending:0}};
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
    coverage:{offset,nextOffset:offset===0?1:null,total:2,documents:0,manifests:0,aliases:0,pending:2,
      complete:offset===1,returned:1,pageDocuments:0,pageManifests:0,pageAliases:0,pagePending:1}
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
  assert.equal(sanitizePendingRow(pendingRow('synthetic-review-closed3',{
    queueStatus:'REVISAR_HUMANO',code:'AURORA_DRIVE_BACKLOG_NON_BLOCKING_OWNER_ACCEPTED'})).code,'AURORA_DRIVE_BACKLOG_NON_BLOCKING_OWNER_ACCEPTED');
  assert.equal(sanitizePendingRow(pendingRow('synthetic-review-secret',{code:'PRIVATE_CUSTOM_CODE'})).code,'UNKNOWN');
});


test('continuous Drive workflow is exact-scope, protected, serialized, and cleans private OAuth material',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/aurora-drive-continuous-feed.yml'),'utf8').replace(/\r\n/g,'\n');
  assert.match(workflow,/options: \[ACTIVATE, REMEDIATE, ENABLE_LIVE, STATUS, DIAGNOSE_FIRST_CYCLE, QUARANTINE_FIRST_CYCLE\]/);
  assert.match(workflow,/environment: firebase-homologation/);
  assert.match(workflow,/group: aurora-rc11-hml\n\s+cancel-in-progress: false/);
  assert.match(workflow,/inputs\.expected_sha == github\.sha/);
  assert.match(workflow,/AURORA_DRIVE_SCOPE_JSON: \$\{\{ secrets\.AURORA_WMGJ_DRIVE_SOURCE_SCOPE \}\}/);
  assert.match(workflow,/EXPECTED_SCOPE_SHA256: \$\{\{ inputs\.scope_sha256 \}\}/);
  assert.match(workflow,/d3978b0f743ab22021c586b5d85c731beca34a6c03306609f33e64d512ab19fa/);
  assert.match(workflow,/auroraAtivarAlimentacaoContinuaDriveAutorizada/);
  assert.match(workflow,/auroraSanearPendenciasDriveAutorizadas/);
  assert.match(workflow,/auroraLerStatusAlimentacaoContinuaDriveAutorizada/);
  assert.match(workflow,/auroraDiagnosticarPrimeiroCicloDriveAutorizado/);
  assert.match(workflow,/auroraQuarentenarPrimeiroCicloDriveAutorizado/);
  assert.match(workflow,/auroraPromoverAlimentacaoContinuaDriveAutorizada/);
  assert.match(workflow,/ENABLE_LIVE_AUTHORIZED_WMGJ_DRIVE_CONTINUOUS_FEED/);
  assert.match(workflow,/expected_candidate_set_sha256/);
  assert.match(workflow,/QUARANTINE_FIRST_CONTINUOUS_DRIVE_ENUMERATION/);
  assert.match(workflow,/sourceCount>=1 and \.response\.sourceCount<=12/);
  assert.match(workflow,/duplicateCollectors==0/);
  assert.match(workflow,/newSourceEnrolled:false,sourceMutation:false,productionMutation:false/);
  assert.match(workflow,/Remove runner OAuth and private execution responses\n\s+if: always\(\)/);
  assert.doesNotMatch(workflow,/echo\s+"?\$AURORA_DRIVE_SCOPE_JSON/);
});


test('continuous Drive collector caps per-cycle processing below the daily conversion quota edge',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'utf8').replace(/\r\n/g,'\n');
  assert.match(source,/processLimit:Math\.min\(10,scope\.limit\)/);
  assert.match(source,/\.everyMinutes\(15\)\.create\(\)/);
});


test('first continuous Drive cycle quarantine is bounded by a fixed activation window and CAS evidence',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'utf8').replace(/\r\n/g,'\n');
  assert.match(source,/AURORA_CONTINUOUS_DRIVE_FIRST_CYCLE_FROM = '2026-10-26T05:19:00\.000Z'/);
  assert.match(source,/AURORA_CONTINUOUS_DRIVE_FIRST_CYCLE_TO = '2026-10-26T05:22:30\.000Z'/);
  assert.match(source,/coverage!=='PENDING_EXTRACTION'/);
  assert.match(source,/attempts<0\|\|attempts>1/);
  assert.match(source,/AURORA_DRIVE_FIRST_CYCLE_QUARANTINE_CAS_CONFLICT/);
  assert.match(source,/rollbackCandidateSetSha256=before\.candidateSetSha256/);
  assert.match(source,/scopeSha256=quarantineHash/);
  assert.match(source,/AURORA_DRIVE_ACTIVATION_ENUMERATION_ROLLED_BACK/);
  assert.match(source,/remainingCandidates=0/);
});


test('live continuous Drive promotion is gated by fully justified backlog and bounded sweep size',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'utf8').replace(/\r\n/g,'\n');
  assert.match(source,/function auroraPromoverAlimentacaoContinuaDriveAutorizada\(request\)/);
  assert.match(source,/AURORA_CONTINUOUS_DRIVE_LIVE_BACKLOG_NOT_CLOSED/);
  assert.match(source,/result\.unjustifiedPending!==0\|\|result\.justifiedHumanReview!==result\.pending/);
  assert.match(source,/AURORA_CONTINUOUS_DRIVE_PHASE:'LIVE_ENUMERATION'/);
  assert.match(source,/maxScan:Math\.min\(5,scope\.maxScan\)/);
  assert.match(source,/processLimit:Math\.min\(10,scope\.limit\)/);
  assert.match(source,/phase=String\(props\.getProperty\('AURORA_CONTINUOUS_DRIVE_PHASE'\)\|\|'REMEDIATE_ONLY'\)/);
});


const vmDriveGate=require('node:vm');
function makeContinuousGateFixture(rows) {
  const source=fs.readFileSync(path.join(__dirname,'../src/37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'utf8');
  const props=new Map([
    ['AURORA_CONTINUOUS_DRIVE_PHASE','REMEDIATE_ONLY'],
    ['AURORA_CONTINUOUS_DRIVE_LIVE_ENABLED_AT','2026-10-26T05:52:03.000Z'],
    ['AURORA_CONTINUOUS_DRIVE_LAST_CYCLE',JSON.stringify({ok:true,code:'AURORA_CONTINUOUS_DRIVE_REMEDIATION_GATE',checkedAt:'2026-10-26T05:52:04.000Z',scanExamined:0})],
    ['WMGJ_FIRESTORE_DRY_RUN','false'],['AURORA_FIRESTORE_MIRROR_REQUIRED','true']
  ]);
  const store={getProperty:key=>props.get(key)??null,
    setProperty:(key,value)=>props.set(key,value),
    setProperties:object=>{for(const [key,value] of Object.entries(object))props.set(key,value);}};
  const c=vmDriveGate.createContext({console,Date,JSON,Number,Array,Object,String,Math,Error,
    PropertiesService:{getScriptProperties:()=>store}});
  vmDriveGate.runInContext(source,c);
  const scope={orgId:'wmgj',sources:[{sourceId:'synthetic-root'}],
    fileIds:[],excludedFolderIds:[],maxScan:300,limit:20};
  c.auroraConnectorReuseOwner_=()=>{};
  c.auroraContinuousDriveWindow_=()=>Date.now()+300000;
  c.auroraContinuousDriveScopeFromProperties_=()=>({scope,runtimeHash:'a'.repeat(64)});
  c.auroraContinuousDriveSystemGuard_=()=>({scopeSha256:'b'.repeat(64),config:{orgId:'wmgj'}});
  c.auroraContinuousDriveCollectorState_=()=>({target:1,duplicateCollectors:0});
  c.auroraContinuousDriveRegistryMatchesScope_=()=>true;
  c.auroraResolverFontesDocumentais_=()=>({sources:[{sourceId:'synthetic-root'}]});
  c.comTravaIngestaoGmailWMGJ_=callback=>callback();
  c.getPlanilhaWMGJ_Compat_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>rows})})});
  c.getConfigWMGJ_Compat_=()=>({SHEETS:{FILA:'queue'}});
  c.mapearCabecalhoWMGJ_Compat_=header=>Object.fromEntries(header.map((name,i)=>[name,i]));
  c.auroraDriveScopeRead_=text=>text?JSON.parse(text):null;
  c.auroraExecutarCicloDriveAutorizado_=()=>({ok:true,scan:{visited:1,enqueued:0},process:{attempted:0,accepted:0}});
  const req={confirmation:c.AURORA_CONTINUOUS_DRIVE_LIVE_CONFIRMATION,
    expectedScopeSha256:c.AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256};
  return {c,props,req};
}
test('live promotion fails closed on renamed or absent queue headers, even when records exist',()=>{
  for(const missing of ['OBSERVACAO','STATUS','ID_ORIGEM','TENTATIVAS']){
    const header=['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO'].map(x=>x===missing?'RENAMED_'+x:x);
    const rows=[header,['synthetic-file','PENDENTE',0,JSON.stringify({
      orgId:'wmgj',scopeSha256:'a'.repeat(64),coverage:'PENDING_EXTRACTION'})]];
    const f=makeContinuousGateFixture(rows);
    const result=f.c.auroraPromoverAlimentacaoContinuaDriveAutorizada(f.req);
    assert.equal(result.ok,false);
    assert.equal(result.code,'AURORA_DRIVE_QUEUE_CONTRACT');
    assert.equal(f.props.get('AURORA_CONTINUOUS_DRIVE_PHASE'),'REMEDIATE_ONLY');
  }
  const f=makeContinuousGateFixture([]);
  const result=f.c.auroraPromoverAlimentacaoContinuaDriveAutorizada(f.req);
  assert.equal(result.code,'AURORA_DRIVE_QUEUE_CONTRACT');
});
test('live promotion requires all unproved current-scope items to have closed human-review reasons',()=>{
  const header=['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO'];
  const review={orgId:'wmgj',scopeSha256:'a'.repeat(64),coverage:'PENDING_EXTRACTION',
    lastCode:'AURORA_DRIVE_BACKLOG_NON_BLOCKING_OWNER_ACCEPTED',humanReviewJustified:true};
  const rows=[header,['synthetic-review','REVISAR_HUMANO',11,JSON.stringify(review)]];
  const f=makeContinuousGateFixture(rows);
  const accepted=f.c.auroraPromoverAlimentacaoContinuaDriveAutorizada(f.req);
  assert.equal(accepted.ok,true);
  assert.equal(accepted.pending,1);
  assert.equal(accepted.justifiedHumanReview,1);
  assert.equal(f.props.get('AURORA_CONTINUOUS_DRIVE_PHASE'),'LIVE_ENUMERATION');
  rows[1][1]='PENDENTE';
  const g=makeContinuousGateFixture(rows);
  const refused=g.c.auroraPromoverAlimentacaoContinuaDriveAutorizada(g.req);
  assert.equal(refused.ok,false);
  assert.equal(refused.code,'AURORA_CONTINUOUS_DRIVE_LIVE_BACKLOG_NOT_CLOSED');
  assert.equal(g.props.get('AURORA_CONTINUOUS_DRIVE_PHASE'),'REMEDIATE_ONLY');
});
test('scheduled Drive cycle rechecks phase after acquiring shared lock and refuses stale LIVE phase',()=>{
  const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]);
  f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','LIVE_ENUMERATION');
  let scans=0;
  f.c.auroraExecutarCicloDriveAutorizado_=()=>{scans++;return{ok:true}};
  f.c.comTravaIngestaoGmailWMGJ_=cb=>{f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','REMEDIATE_ONLY');return cb();};
  const result=f.c.auroraExecutarAlimentacaoContinuaDriveAutorizadaWmgj();
  assert.equal(result.ok,false);
  assert.equal(result.code,'AURORA_CONTINUOUS_DRIVE_PHASE_NOT_LIVE');
  assert.equal(scans,0);
});
test('per-request checkpoint prevents continuation when containment revokes LIVE phase',()=>{
  const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]);
  f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','LIVE_ENUMERATION');
  let attempted=0;
  f.c.auroraExecutarCicloDriveAutorizado_=options=>{
    attempted++;f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','REMEDIATE_ONLY');
    options.beforeRequest();return {ok:true,scan:{visited:1},process:{attempted:1}};
  };
  const result=f.c.auroraExecutarAlimentacaoContinuaDriveAutorizadaWmgj();
  assert.equal(attempted,1);
  assert.equal(result.ok,false);
  assert.equal(result.code,'AURORA_CONTINUOUS_DRIVE_PHASE_NOT_LIVE');
});
test('sanitized STATUS distinguishes a configured paused collector from verified live extraction',()=>{
  const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]);
  const paused=f.c.auroraLerStatusAlimentacaoContinuaDriveAutorizada(f.req.expectedScopeSha256);
  assert.equal(paused.ok,true);
  assert.equal(paused.phase,'REMEDIATE_ONLY');
  assert.equal(paused.liveEnumerationEnabled,false);
  assert.equal(paused.continuousExtractionVerified,false);
  f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','LIVE_ENUMERATION');
  const live=f.c.auroraLerStatusAlimentacaoContinuaDriveAutorizada(f.req.expectedScopeSha256);
  assert.equal(live.ok,true);
  assert.equal(live.liveEnumerationEnabled,true);
  assert.equal(live.continuousExtractionVerified,false);
});
test('protected ACTIVATE verifies paused phase and may not report live extraction',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/aurora-drive-continuous-feed.yml'),'utf8');
  const source=fs.readFileSync(path.join(__dirname,'../src/37_AURORA_CONECTORES_PLUG_AND_PLAY.gs'),'utf8');
  assert.match(workflow,/\.response\.continuousExtraction==false and \.response\.phase=="REMEDIATE_ONLY"/);
  assert.match(workflow,/\.response\.firstCycle\.code=="AURORA_CONTINUOUS_DRIVE_REMEDIATION_GATE"/);
  assert.match(source,/result\.phase='REMEDIATE_ONLY';result\.continuousExtraction=false;/);
});

test('STATUS never treats a successful scan or acceptance counters as canonical extraction proof',()=>{
  for(const counts of [{scanExamined:5},{scanExamined:5,attempted:1,accepted:1},{scanExamined:5,extractionErrors:5,pending:5}]) {
    const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]);
    f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','LIVE_ENUMERATION');
    f.props.set('AURORA_CONTINUOUS_DRIVE_LAST_CYCLE',JSON.stringify({ok:true,
      code:'AURORA_CONTINUOUS_DRIVE_CYCLE_VERIFIED',checkedAt:new Date().toISOString(),...counts}));
    const value=f.c.auroraLerStatusAlimentacaoContinuaDriveAutorizada(f.req.expectedScopeSha256);
    assert.equal(value.continuousExtractionVerified,false);
  }
});

test('STATUS rejects stale runtime configuration even with one installed trigger',()=>{
  for(const mutate of [f=>f.props.set('WMGJ_FIRESTORE_DRY_RUN','true'),
    f=>f.props.set('AURORA_FIRESTORE_MIRROR_REQUIRED','false'),
    f=>{f.c.auroraContinuousDriveSystemGuard_=()=>{throw Error('AURORA_DRIVE_SCOPE_CHANGED');};}]) {
    const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]);
    f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','LIVE_ENUMERATION');mutate(f);
    const value=f.c.auroraLerStatusAlimentacaoContinuaDriveAutorizada(f.req.expectedScopeSha256);
    assert.equal(value.ok,false);assert.equal(value.liveEnumerationEnabled,false);
  }
});

test('duplicate required headers cannot hide the observation column during promotion or remediation',()=>{
  const rows=[['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO',' OBSERVACAO '],
    ['synthetic-file','PENDENTE',0,JSON.stringify({orgId:'wmgj',scopeSha256:'a'.repeat(64)}),'']];
  for(const action of ['promote','remediate']) {
    const f=makeContinuousGateFixture(rows);
    f.c.mapearCabecalhoWMGJ_Compat_=h=>Object.fromEntries(h.map((v,i)=>[v.trim(),i]));
    const result=action==='promote'?f.c.auroraPromoverAlimentacaoContinuaDriveAutorizada(f.req)
      :f.c.auroraSanearPendenciasDriveAutorizadas({...f.req,confirmation:f.c.AURORA_CONTINUOUS_DRIVE_REMEDIATE_CONFIRMATION});
    assert.equal(result.ok,false);assert.equal(result.code,'AURORA_DRIVE_QUEUE_CONTRACT');
    assert.equal(f.props.get('AURORA_CONTINUOUS_DRIVE_PHASE'),'REMEDIATE_ONLY');
  }
});

test('hashless receipt and unproved alias cannot close a pending item for promotion',()=>{
  for(const extra of [{receipt:{replayVerified:true}},{coverage:'DUPLICATE_CONTENT'},
    {contentSha256:'a'.repeat(64),receipt:{replayVerified:true,contentHash:'a'.repeat(64),contentSha256:'a'.repeat(64)}}]) {
    const rows=[['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO'],['synthetic-file','PENDENTE',0,
      JSON.stringify({orgId:'wmgj',scopeSha256:'a'.repeat(64),...extra})]];
    const f=makeContinuousGateFixture(rows),result=f.c.auroraPromoverAlimentacaoContinuaDriveAutorizada(f.req);
    assert.equal(result.ok,false);assert.equal(result.code,'AURORA_CONTINUOUS_DRIVE_LIVE_BACKLOG_NOT_CLOSED');
    assert.equal(f.props.get('AURORA_CONTINUOUS_DRIVE_PHASE'),'REMEDIATE_ONLY');
  }
});

test('promotion rechecks authorization and configuration after lock acquisition',()=>{
  for(const failure of ['AURORA_CONTINUOUS_DRIVE_WINDOW_EXPIRED','AURORA_DRIVE_SCOPE_CHANGED']) {
    const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]);
    f.c.comTravaIngestaoGmailWMGJ_=cb=>{
      if(failure.includes('WINDOW'))f.c.auroraContinuousDriveWindow_=()=>{throw Error(failure);};
      else f.c.auroraContinuousDriveSystemGuard_=()=>{throw Error(failure);};
      return cb();
    };
    const result=f.c.auroraPromoverAlimentacaoContinuaDriveAutorizada(f.req);
    assert.equal(result.ok,false);assert.equal(result.code,failure);
    assert.equal(f.props.get('AURORA_CONTINUOUS_DRIVE_PHASE'),'REMEDIATE_ONLY');
  }
});

test('STATUS reports a recent scoped cycle separately from canonical readback and expires its evidence',()=>{
  const now=Date.now(),liveAt=new Date(now-10000).toISOString();
  const last={statusContractVersion:2,phase:'LIVE_ENUMERATION',runtimeScopeSha256:'a'.repeat(64),liveEnabledAt:liveAt,
    checkedAt:new Date(now-5000).toISOString(),completedAt:new Date(now-1000).toISOString(),ok:true,
    code:'AURORA_CONTINUOUS_DRIVE_CYCLE_VERIFIED',scanExamined:5,queued:1,attempted:1,accepted:1,duplicates:0,
    pending:0,failed:0,review:1,extractionErrors:0,canonicalReceiptsRecorded:1};
  for(const mutate of [null,x=>{x.checkedAt=new Date(now-3600000).toISOString();},
    x=>{x.completedAt=new Date(now+60000).toISOString();},x=>{x.runtimeScopeSha256='b'.repeat(64);},
    x=>{x.liveEnabledAt=new Date(now-20000).toISOString();},x=>{x.phase='REMEDIATE_ONLY';},
    x=>{x.scanExamined='5';},x=>{x.canonicalReceiptsRecorded=-1;},x=>{delete x.statusContractVersion;}]) {
    const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]),cycle={...last};
    f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','LIVE_ENUMERATION');
    f.props.set('AURORA_CONTINUOUS_DRIVE_LIVE_ENABLED_AT',liveAt);if(mutate)mutate(cycle);
    f.props.set('AURORA_CONTINUOUS_DRIVE_LAST_CYCLE',JSON.stringify(cycle));
    const result=f.c.auroraLerStatusAlimentacaoContinuaDriveAutorizada(f.req.expectedScopeSha256);
    assert.equal(result.ok,true);assert.equal(result.recentCycleVerified,!mutate);
    assert.equal(result.enumerationObserved,!mutate);assert.equal(result.continuousExtractionVerified,false);
    assert.equal(result.canonicalReadbackVerified,false);assert.equal(result.fullSynchronizationVerified,false);
  }
});

test('queue promotion accepts bound receipts and aliases, but rejects wrong versions and missing anchors',()=>{
  const receipt=readbackFixture().row;
  const canonical={orgId:'wmgj',scopeSha256:'a'.repeat(64),fileId:receipt.sourceId,sourceVersion:String(receipt.sourceVersion),
    coverage:'EXTRACTED_REVIEW_PENDING',contentSha256:receipt.contentHash,receipt};
  const alias={...canonical,fileId:'synthetic-alias-only',coverage:'DUPLICATE_CONTENT',aliasFileId:receipt.sourceId};
  const row=x=>[x.fileId,'REVISAR_HUMANO',0,JSON.stringify(x)];
  const header=['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO'];
  for(const items of [[canonical,alias],[{...canonical,sourceVersion:'2'}],[alias],
    [{...canonical,receipt:{...receipt,sourceId:'wrong-source-only'}}]]) {
    const f=makeContinuousGateFixture([header,...items.map(row)]);
    const result=f.c.auroraPromoverAlimentacaoContinuaDriveAutorizada(f.req);
    assert.equal(result.ok,items.length===2);
  }
});

test('scheduled summary stores scoped cycle metadata but refuses malformed receipt counters',()=>{
  for(const receipt of [readbackFixture().row,{replayVerified:true}]) {
    const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]);
    f.props.set('AURORA_CONTINUOUS_DRIVE_PHASE','LIVE_ENUMERATION');
    f.c.auroraExecutarCicloDriveAutorizado_=()=>({ok:true,scan:{visited:1},process:{attempted:1,accepted:1,privateReadbackPlan:[receipt]}});
    const result=f.c.auroraExecutarAlimentacaoContinuaDriveAutorizadaWmgj();
    assert.equal(result.ok,!!receipt.entityId);
    if(result.ok){assert.equal(result.canonicalReceiptsRecorded,1);assert.equal(result.statusContractVersion,2);
      assert.equal(result.runtimeScopeSha256,'a'.repeat(64));assert.ok(result.completedAt);}
  }
});

test('ACTIVATE refuses a failed or live first cycle without claiming extraction',()=>{
  for(const firstCycle of [{ok:false},{ok:true,phase:'LIVE_ENUMERATION',code:'AURORA_CONTINUOUS_DRIVE_CYCLE_VERIFIED'},
    {ok:true,phase:'REMEDIATE_ONLY',code:'AURORA_CONTINUOUS_DRIVE_REMEDIATION_GATE'}]) {
    const f=makeContinuousGateFixture([['ID_ORIGEM','STATUS','TENTATIVAS','OBSERVACAO']]);
    f.c.auroraContinuousDrivePrivateScope_=()=>({});
    f.c.auroraContinuousDriveNormalizedScope_=()=>f.c.auroraContinuousDriveScopeFromProperties_().scope;
    f.c.auroraResolverFontesDocumentais_=()=>({sources:[],candidates:[]});
    f.c.ScriptApp={getProjectTriggers:()=>[],newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({create:()=>{}})})})};
    f.c.auroraExecutarAlimentacaoContinuaDriveAutorizadaWmgj=()=>firstCycle;
    const result=f.c.auroraAtivarAlimentacaoContinuaDriveAutorizada({confirmation:f.c.AURORA_CONTINUOUS_DRIVE_CONFIRMATION,
      scopeJson:'{}',expectedScopeSha256:f.req.expectedScopeSha256});
    assert.equal(result.ok,firstCycle.phase==='REMEDIATE_ONLY');assert.equal(result.continuousExtraction,false);
    assert.equal(f.props.get('AURORA_CONTINUOUS_DRIVE_PHASE'),'REMEDIATE_ONLY');
  }
});

test('continuous workflow checks published bytes and deployment stability offline before accepting evidence',()=>{
  const cp=require('node:child_process'),repo=path.resolve(__dirname,'..');
  const workflow=fs.readFileSync(path.join(repo,'.github/workflows/aurora-drive-continuous-feed.yml'),'utf8');
  const script=name=>workflow.split('- name: '+name)[1].split('- name: ')[0]
    .match(/node <<'NODE'\n([\s\S]*?)\n\s*NODE/)[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
  const pre=script('Verify canonical published bytes before any operational action');
  const post=script('Verify one active collector and no duplicate Drive collector');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'continuous-published-'));
  const bin=path.join(root,'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'clasp'),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
if(process.argv[2]==='deployments') console.log(JSON.stringify([{description:'AURORA_EXECUTION_API_CANONICAL '+'a'.repeat(40),versionNumber:Number(process.env.SYNTHETIC_VERSION||1),deploymentId:'synthetic-deployment-only'}]));
else if(process.argv[2]==='pull') {
  for(const name of fs.readdirSync(path.join(process.env.GITHUB_WORKSPACE,'src')).filter(x=>x.endsWith('.gs')))
    fs.copyFileSync(path.join(process.env.GITHUB_WORKSPACE,'src',name),path.join(process.cwd(),name));
  fs.copyFileSync(path.join(process.env.GITHUB_WORKSPACE,'appsscript.json'),'appsscript.json');
  if(process.env.SYNTHETIC_BAD_BYTES)fs.appendFileSync('37_AURORA_CONECTORES_PLUG_AND_PLAY.gs','\\n// drift');
}else process.exit(2);
`,{mode:0o700});
  try {
    for(const bad of [false,true]) {
      const temp=path.join(root,bad?'bad':'good'),workspace=path.join(temp,'appscript-continuous');
      fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'.clasp.json'),'{}');
      const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,RUNNER_TEMP:temp,GITHUB_WORKSPACE:repo,
        SYNTHETIC_BAD_BYTES:bad?'1':'',SYNTHETIC_VERSION:'1'};
      const result=cp.spawnSync(process.execPath,['-e',pre],{cwd:repo,env,encoding:'utf8'});
      assert.equal(result.status,bad?1:0,result.stderr);
      if(bad){assert.match(result.stderr,/DRIVE_PUBLISHED_SOURCE_MISMATCH/);continue;}
      const proof=JSON.parse(fs.readFileSync(path.join(workspace,'published-proof.json')));
      assert.equal(proof.modulesVerified,30);assert.equal(proof.versionNumber,1);
      assert.equal(cp.spawnSync(process.execPath,['-e',post],{cwd:workspace,env}).status,0);
      const changed=cp.spawnSync(process.execPath,['-e',post],{cwd:workspace,env:{...env,SYNTHETIC_VERSION:'2'},encoding:'utf8'});
      assert.equal(changed.status,1);assert.match(changed.stderr,/DRIVE_PUBLISHED_SOURCE_CHANGED/);
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
