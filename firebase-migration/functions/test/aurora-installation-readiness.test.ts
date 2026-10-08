import test from 'node:test';
import assert from 'node:assert/strict';
import {installationReadiness, readInstallationReadiness} from '../src/auroraInstallationReadiness.ts';
import {immutableEntityVersionId,persistedDocumentHash} from '../src/auroraCanonicalVersions.ts';
const org='synthetic', id='a'.repeat(48), hash='b'.repeat(64);
const checkpoint={orgId:org,state:'HEALTHY',lastDocumentId:id};
const document={orgId:org,entityType:'sourceDocument',entityKey:'DRIVE:synthetic',revision:1,
  source:{system:'DRIVE'},nativeReady:true,sourceIndependent:true,externalFetchRequired:false,
  sanitized:true,workflowState:'VALIDATED',documentFragility:'NONE',missingFieldsCount:0,
  sourceVersion:1,canonicalSnapshotHash:hash,competence:'2026-10'};
const versionOf=(doc:any)=>({orgId:org,entityType:'sourceDocument',entityId:id,entityKey:doc.entityKey,
  revision:doc.revision,sourceVersion:doc.sourceVersion,snapshot:doc,afterHash:persistedDocumentHash(null,doc)});
const version=versionOf(document), versionId=immutableEntityVersionId('sourceDocument',document.entityKey,1);
const projection={orgId:org,competence:'2026-10',state:'SHADOW',dataQuality:{complete:true,sourcePresent:true},
  generatedAt:'2026-10-08T05:00:00Z',integrationReadback:[{documentId:id,sourceVersion:1,revision:1,versionId,canonicalSnapshotHash:hash}]};
test('empty tenant, transport, and document without immutable ledger cannot complete onboarding',()=>{
  assert.equal(installationReadiness(org,null,null,null).firstIngestionVerified,false);
  assert.equal(installationReadiness(org,checkpoint,null,projection).state,'PENDING_CANONICAL_DATA');
  assert.equal(installationReadiness(org,checkpoint,document,projection).firstIngestionVerified,false);
});
test('first ingestion requires the actual immutable snapshot and exact projected revision',()=>{
  const proof=installationReadiness(org,checkpoint,document,projection,version);
  assert.equal(proof.firstIngestionVerified,true);assert.equal(proof.versionId,versionId);
  assert.equal(proof.operationalComplete,false);assert.equal(proof.sourceSystem,'DRIVE');
  for(const patch of [{sourceVersion:2},{canonicalSnapshotHash:'c'.repeat(64)},{nativeReady:false},
    {sourceIndependent:false},{workflowState:'FAILED'},{missingFieldsCount:1},{orgId:'other-org'},
    {revision:2},{entityType:'invoice'},{entityKey:'DRIVE:other'},{revoked:true}]){
    assert.equal(installationReadiness(org,checkpoint,{...document,...patch},projection,version).firstIngestionVerified,false);
  }
  for(const patch of [{orgId:'other-org'},{afterHash:'c'.repeat(64)},{snapshot:{...document,count:200}},
    {entityId:'c'.repeat(48)},{revision:2},{sourceVersion:2}]){
    assert.equal(installationReadiness(org,checkpoint,document,projection,{...version,...patch}).firstIngestionVerified,false);
  }
  for(const patch of [{orgId:'other-org'},{competence:'2026-09'},{integrationReadback:[]},
    {generatedAt:'invalid'},{generatedAt:null},{generatedAt:0},{generatedAt:true},
    {state:'NO_SOURCE'},{dataQuality:{complete:false,sourcePresent:true}},
    {integrationReadback:[{...projection.integrationReadback[0],versionId:'c'.repeat(48)}]}]){
    assert.equal(installationReadiness(org,checkpoint,document,{...projection,...patch},version).firstIngestionVerified,false);
  }
});
test('resume waits for the projection; completion cannot survive a changed source revision',()=>{
  const next={...document,sourceVersion:2,revision:2}, nextVersion=versionOf(next);
  assert.equal(installationReadiness(org,checkpoint,next,projection,nextVersion).state,'PENDING_PROJECTION');
  const replay={...projection,integrationReadback:[{documentId:id,sourceVersion:2,revision:2,
    versionId:immutableEntityVersionId('sourceDocument',next.entityKey,2),canonicalSnapshotHash:hash}]};
  assert.equal(installationReadiness(org,checkpoint,next,replay,nextVersion).state,'FIRST_INGESTION_VERIFIED');
  const completion={orgId:org,state:'COMPLETE',documentId:id,versionId,sourceVersion:1,canonicalSnapshotHash:hash};
  assert.equal(installationReadiness(org,checkpoint,document,projection,version,completion).operationalComplete,true);
  assert.equal(installationReadiness(org,checkpoint,next,replay,nextVersion,completion).operationalComplete,false);
});
test('test-marked sources cannot complete onboarding through an unrelated operational projection',()=>{
  for (const marker of [{isTest:true},{is_test:true},{environment:'TEST'}, {ambiente:'Teste'},
    {recordType:'TEST'},{record_type:'TESTE'},{tipo_registro:'teste'}]) {
    const flagged={...document,...marker};
    assert.equal(installationReadiness(org,checkpoint,flagged,projection,versionOf(flagged)).firstIngestionVerified,false);
  }
});
test('Drive historical readback resolves only server IDs in the authenticated tenant',async()=>{
  const paths:string[]=[];
  const value=await readInstallationReadiness(org,async path=>{
    paths.push(path);
    if(path.endsWith('/current'))return projection;
    if(path.includes('/sourceDocuments/'))return document;
    if(path.includes('/entityVersions/'))return version;
    return null;
  });
  assert.equal(value.firstIngestionVerified,true);
  assert.ok(paths.every(path=>path.startsWith(`organizations/${org}/`)));
  assert.ok(paths.includes(`organizations/${org}/entityVersions/${versionId}`));
  let reads=0;
  await assert.rejects(readInstallationReadiness(org,async()=>{reads++;return null;},'../../other-org'),/INVALID_DOCUMENT_ID/);
  assert.equal(reads,0);
});
test('specific document receipt never substitutes the tenant latest document',async()=>{
  const otherId='c'.repeat(48), paths:string[]=[];
  const value=await readInstallationReadiness(org,async path=>{
    paths.push(path);
    return path.endsWith('integration-documents')?checkpoint:path.endsWith('/current')?projection:null;
  },otherId);
  assert.equal(value.firstIngestionVerified,false);
  assert.ok(paths.includes(`organizations/${org}/sourceDocuments/${otherId}`));
  assert.ok(!paths.includes(`organizations/${org}/sourceDocuments/${id}`));
});
test('path injection in stored checkpoints/readback cannot reach another tenant',async()=>{
  const paths:string[]=[];
  await readInstallationReadiness(org,async path=>{
    paths.push(path);
    return path.endsWith('/current')?{...projection,integrationReadback:[{documentId:'../../other'}]}
      :{...checkpoint,lastDocumentId:'../../other',lastEntityId:'../../other'};
  });
  assert.equal(paths.length,4);assert.ok(paths.every(path=>path.startsWith(`organizations/${org}/`)));
});
