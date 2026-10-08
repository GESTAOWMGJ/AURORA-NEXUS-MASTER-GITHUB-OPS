import test from 'node:test';
import assert from 'node:assert/strict';
import {installationReadiness, readInstallationReadiness} from '../src/auroraInstallationReadiness.ts';
const org='synthetic', id='a'.repeat(48), hash='b'.repeat(64);
const checkpoint={orgId:org,state:'HEALTHY',lastDocumentId:id};
const document={orgId:org,nativeReady:true,sourceIndependent:true,externalFetchRequired:false,
  sanitized:true,workflowState:'VALIDATED',documentFragility:'NONE',missingFieldsCount:0,
  sourceVersion:1,canonicalSnapshotHash:hash,competence:'2026-10',integration:{transport:'AURORA_INTEGRATION_API'}};
const projection={orgId:org,competence:'2026-10',state:'SHADOW',dataQuality:{complete:true,sourcePresent:true},
  generatedAt:'2026-10-08T05:00:00Z',integrationReadback:[{documentId:id,sourceVersion:1,canonicalSnapshotHash:hash}]};
test('empty tenant and healthy transport cannot complete onboarding',()=>{
  assert.equal(installationReadiness(org,null,null,null).firstIngestionVerified,false);
  assert.equal(installationReadiness(org,checkpoint,null,projection).state,'PENDING_CANONICAL_DATA');
});
test('first ingestion requires native persisted data and the exact projected version',()=>{
  assert.equal(installationReadiness(org,checkpoint,document,projection).firstIngestionVerified,true);
  for(const patch of [{sourceVersion:2},{canonicalSnapshotHash:'c'.repeat(64)},{nativeReady:false},
    {sourceIndependent:false},{workflowState:'FAILED'},{missingFieldsCount:1},{orgId:'other-org'}]){
    assert.equal(installationReadiness(org,checkpoint,{...document,...patch},projection).firstIngestionVerified,false);
  }
  for(const patch of [{orgId:'other-org'},{competence:'2026-09'},{integrationReadback:[]},
    {generatedAt:'invalid'},{state:'NO_SOURCE'},{dataQuality:{complete:false,sourcePresent:true}}]){
    assert.equal(installationReadiness(org,checkpoint,document,{...projection,...patch}).firstIngestionVerified,false);
  }
});
test('resumed processing completes only when the projection catches up',()=>{
  const next={...document,sourceVersion:2};
  assert.equal(installationReadiness(org,checkpoint,next,projection).state,'PENDING_PROJECTION');
  const replay={...projection,integrationReadback:[{documentId:id,sourceVersion:2,canonicalSnapshotHash:hash}]};
  assert.equal(installationReadiness(org,checkpoint,next,replay).state,'FIRST_INGESTION_VERIFIED');
});
test('readback is scoped to authenticated tenant and rejects document path injection',async()=>{
  const paths:string[]=[];
  const value=await readInstallationReadiness(org,async path=>{
    paths.push(path);return path.endsWith('integration-documents')?checkpoint:path.endsWith('/current')?projection:document;
  });
  assert.equal(value.firstIngestionVerified,true);
  assert.deepEqual(paths,[`organizations/${org}/runtimeCheckpoints/integration-documents`,
    `organizations/${org}/sourceDocuments/${id}`,`organizations/${org}/dashboardSnapshots/current`]);
  let reads=0;
  await readInstallationReadiness(org,async()=>{reads++;return {...checkpoint,lastDocumentId:'../../other-org'};});
  assert.equal(reads,1);
});
