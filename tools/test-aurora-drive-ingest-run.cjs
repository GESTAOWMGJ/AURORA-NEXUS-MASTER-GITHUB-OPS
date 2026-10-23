'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseScope,makeRequest,sanitizeBatch,verifyReadback,verifyCoverage,sha,rejectRuntimeFailure,withSharedLockRetry}=require('./aurora-drive-ingest-run.cjs');
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
test('private source configuration must match the exact authorized hash',()=>{const raw=JSON.stringify(scope());assert.equal(parseScope(raw,sha(raw)).orgId,'wmgj');assert.throws(()=>parseScope(raw+' ',sha(raw)),/SCOPE_HASH_MISMATCH/);});
test('a different tenant cannot inherit the source authorization',()=>{const value=scope();value.orgId='other';const raw=JSON.stringify(value);assert.throws(()=>parseScope(raw,sha(raw)),/PRIVATE_SCOPE_REJECTED/);});
test('duplicate roots and exclusion of an allowed root are rejected',()=>{const value=scope();value.sources.push({...value.sources[0],sourceId:'another'});let raw=JSON.stringify(value);assert.throws(()=>parseScope(raw,sha(raw)),/SOURCE_SCOPE_REJECTED/);value.sources.pop();value.excludedFolderIds.push(value.sources[0].folderId);raw=JSON.stringify(value);assert.throws(()=>parseScope(raw,sha(raw)),/SCOPE_OVERLAP_REJECTED/);});
test('only the acquisition scope is sent to the published runtime',()=>{const value=scope();value.operatorPrivateNotes='PRIVATE_NOT_FOR_RUNTIME';const request=makeRequest(value,'EXECUTE','a'.repeat(64));assert.equal(JSON.stringify(request).includes('PRIVATE_NOT_FOR_RUNTIME'),false);assert.equal(request.expectedScopeSha256,'a'.repeat(64));});
test('public evidence drops private receipts, content and unexpected fields',()=>{const response={ok:true,code:'DRIVE_BATCH_OK',scopeSha256:'a'.repeat(64),triggersChanged:false,globalSettingsChanged:false,scan:{examined:1,queued:1,aliases:0,complete:false},processing:{attempted:1,accepted:1,duplicates:0,pending:0,failed:0,review:1,extractionErrors:0,replayVerified:1},privateReadbackPlan:[{sourceId:'PRIVATE_SOURCE_ID'}],secret:'DO_NOT_PRINT',text:'PRIVATE_DOCUMENT_TEXT'};const result=sanitizeBatch({response});assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);assert.equal(JSON.stringify(result).includes('DO_NOT_PRINT'),false);assert.throws(()=>sanitizeBatch({response:{...response,triggersChanged:true}}),/BATCH_RESPONSE_REJECTED/);});
test('canonical readback rejects a cross-tenant result',async()=>{const f=readbackFixture();f.data.orgId='other';await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/CANONICAL_IDENTITY_MISMATCH/);});
test('readback proves exact content, text, revision and immutable version',async()=>{const f=readbackFixture();const result=await verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher);assert.equal(result.verified,1);assert.equal(result.evidence[0].immutableVersionVerified,true);assert.equal(result.evidence[0].nativeReady,false);f.data.source.contentHash='f'.repeat(64);await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/CANONICAL_IDENTITY_MISMATCH/);});
test('review intake rejects unproved extraction and financial readiness claims',async()=>{for(const mutate of [f=>{f.data.extractionComplete=false;},f=>{f.data.nativeReady=true;},f=>{f.data.extractionEvidence.textSha256='f'.repeat(64);},f=>{f.data.extractionEvidence.financialFactsApproved=true;},f=>{f.data.canonicalSnapshotHash='f'.repeat(64);}]){const f=readbackFixture();mutate(f);await assert.rejects(()=>verifyReadback([f.row],'wmgj','synthetic-token',f.fetcher),/EXTRACTION_READBACK_MISMATCH/);}});
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
