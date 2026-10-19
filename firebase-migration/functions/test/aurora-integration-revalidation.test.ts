import test from 'node:test';
import assert from 'node:assert/strict';
import { immutableEntityVersionId,persistedDocumentHash } from '../src/auroraCanonicalVersions.ts';
import { configureCanonicalAutomation,integrationReplayPatch,readInstallationAcceptance } from '../src/auroraInstallationAcceptance.ts';
import { readInstallationReadiness } from '../src/auroraInstallationReadiness.ts';
import { buildIntegrationRevalidationReceipt,integrationRevalidationMatches,isLegacyMinimalIntegrationReceipt,
  revalidationAuthorityActive } from '../src/auroraIntegrationRevalidation.ts';

const org='synthetic',base=`organizations/${org}`,now=new Date('2026-10-19T12:00:00Z');
const originalKey='ik_'+'1'.repeat(16),keyId='ik_'+'2'.repeat(16),documentId='3'.repeat(48);
const originalReceiptId='4'.repeat(64),receiptId='5'.repeat(64),bodyHash='6'.repeat(64),snapshotHash='7'.repeat(64);
const actor={orgId:org,uid:'synthetic-admin',email:'synthetic@example.test',role:'org_admin',allFacilities:true,
  facilityIds:[],permissions:[],mfaVerified:true};
function fixture(){
  const document:any={orgId:org,entityType:'sourceDocument',entityKey:'ERP:synthetic',revision:1,sourceVersion:1,
    competence:'2026-10',canonicalSnapshotHash:snapshotHash,source:{system:'ERP'},nativeReady:true,
    sourceIndependent:true,externalFetchRequired:false,sanitized:true,workflowState:'VALIDATED',
    documentFragility:'NONE',missingFieldsCount:0,integration:{keyId:originalKey,payloadHash:bodyHash,transport:'AURORA_INTEGRATION_API'}};
  const versionId=immutableEntityVersionId('sourceDocument',document.entityKey,1);
  const version:any={orgId:org,entityType:'sourceDocument',entityId:documentId,entityKey:document.entityKey,
    revision:1,sourceVersion:1,idempotencyId:originalReceiptId,actor:{keyId:originalKey},snapshot:structuredClone(document),
    afterHash:persistedDocumentHash(null,document),_readVersionId:versionId};
  const original:any={schemaVersion:'aurora.ingestion.receipt.v1',orgId:org,keyId:originalKey,documentId,
    versionId,sourceVersion:1,revision:1,canonicalSnapshotHash:snapshotHash,bodyHash,
    acceptedAt:'2026-10-14T11:00:00Z',replayCount:1,lastReplayAt:'2026-10-14T11:00:01Z',_readReceiptId:originalReceiptId};
  const credential:any={orgId:org,keyId,createdBy:actor.uid,active:true,scopes:['integration.read','documents.ingest'],
    expiresAt:{toDate:()=>new Date('2099-01-01T00:00:00Z')}};
  const issuer:any={active:true,role:'org_admin',allFacilities:true};
  const organization:any={active:true,projectionEnabled:true,projectionMode:'SHADOW'};
  const principal={orgId:org,keyId,name:'synthetic'};
  const projection={orgId:org,competence:'2026-10',state:'SHADOW',generatedAt:'2026-10-19T11:00:00Z',
    dataQuality:{complete:true,sourcePresent:true},integrationReadback:[{documentId,versionId,revision:1,
      sourceVersion:1,canonicalSnapshotHash:snapshotHash}]};
  const state=new Map<string,any>([[base,organization],[`${base}/sourceDocuments/${documentId}`,document],
    [`${base}/entityVersions/${versionId}`,version],[`${base}/apiIdempotency/${originalReceiptId}`,original],
    [`${base}/integrationCredentials/${keyId}`,credential],
    [`${base}/integrationCredentials/${originalKey}`,{...credential,keyId:originalKey,expiresAt:{toDate:()=>new Date('2026-10-16T00:00:00Z')}}],
    [`${base}/members/${actor.uid}`,issuer],[`${base}/dashboardSnapshots/current`,projection],
    [`${base}/runtimeCheckpoints/integration-documents`,{orgId:org,state:'HEALTHY',lastDocumentId:documentId,acceptedCount:18}]]);
  const reads:string[]=[],writes:string[]=[];
  const read=async(path:string)=>{reads.push(path);return state.get(path)??null;};
  const processing={firstIngestionVerified:true,documentId,versionId,revision:1,sourceVersion:1,canonicalSnapshotHash:snapshotHash};
  const authority={org:organization,credential,issuer,configurer:issuer};
  const build=(patch:any={})=>buildIntegrationRevalidationReceipt({orgId:org,principal,receiptId,documentId,
    document,version,originalReceipt:original,bodyHash,timestamp:'2026-10-19T11:30:00Z',authority,now,...patch});
  const selected=()=>readInstallationAcceptance(org,processing,document,version,null,read,now,{receiptId,keyId});
  const post=()=>{
    const stored=state.get(`${base}/apiIdempotency/${receiptId}`);
    if (!stored || isLegacyMinimalIntegrationReceipt(stored,principal,bodyHash,documentId)) {
      const complete=build();if(!complete)return false;
      state.set(`${base}/apiIdempotency/${receiptId}`,complete);writes.push(`${base}/apiIdempotency/${receiptId}`);return true;
    }
    if(!revalidationAuthorityActive(org,keyId,authority,now,document.source.system))return false;
    const replay=integrationReplayPatch(org,principal,stored,document,version,bodyHash,documentId,'2026-10-19T11:30:01Z',
      {receiptId,originalReceipt:original});
    if(!replay)return false;Object.assign(stored,replay);writes.push(`${base}/apiIdempotency/${receiptId}`);return true;
  };
  const configure=async(targetKey=keyId)=>configureCanonicalAutomation(actor,{action:'CONFIGURE_AUTOMATION',method:'API_TOKEN',keyId:targetKey,
    sourceSystem:'ERP',enabled:true,expectedRevision:0},{read,merge:(path,data)=>state.set(path,Object.assign(state.get(path)??{},data)),
    create:(path,data)=>{assert.equal(state.has(path),false);state.set(path,data);},timestamp:'2026-10-19T11:00:00Z'});
  return {document,version,versionId,original,credential,issuer,organization,principal,projection,state,reads,writes,
    processing,authority,build,selected,post,configure,read};
}

test('new credential needs validated POST and replay; both retain the same historical immutable bytes',async()=>{
  const f=fixture();await f.configure();
  const before=JSON.stringify([f.document,f.version,f.original,f.projection,
    f.state.get(`${base}/runtimeCheckpoints/integration-documents`)]);
  assert.equal((await f.selected()).state,'PENDING_RECEIPT');assert.equal(f.writes.length,0);
  assert.equal(f.post(),true);const first=await f.selected();
  assert.equal(first.receiptPersisted,true);assert.equal(first.replayVerified,false);assert.equal(first.eligible,false);
  assert.equal(first.state,'PENDING_REPLAY');assert.equal(first.receiptId,receiptId);
  const created=f.state.get(`${base}/apiIdempotency/${receiptId}`);
  assert.equal(created.replayCount,0);assert.equal(created.revalidation.originalReceiptId,originalReceiptId);
  assert.equal(created.revalidation.originalVersionId,f.versionId);assert.equal(created.revalidation.originalKeyId,originalKey);
  assert.equal(f.post(),true);const replay=await f.selected();
  assert.equal(replay.eligible,true);assert.equal(replay.receiptId,receiptId);assert.equal(replay.versionId,f.versionId);
  assert.equal(replay.method,'API_TOKEN');assert.equal(replay.globalDocumentAcquisitionVerified,false);
  assert.equal(created.replayCount,1);assert.deepEqual(f.writes,Array(2).fill(`${base}/apiIdempotency/${receiptId}`));
  assert.equal(JSON.stringify([f.document,f.version,f.original,f.projection,
    f.state.get(`${base}/runtimeCheckpoints/integration-documents`)]),before);
  const legacy=await readInstallationAcceptance(org,f.processing,f.document,f.version,null,f.read,now);
  assert.equal(legacy.receiptId,originalReceiptId);assert.equal(legacy.eligible,false,'expired original authority stays expired');
  const ready=await readInstallationReadiness(org,f.read,documentId,{receiptId,keyId});
  assert.equal(ready.firstIngestionVerified,true);assert.equal(ready.acceptance?.receiptId,receiptId);
  assert.equal(ready.acceptance?.eligible,true);assert.equal(ready.versionId,f.versionId);
});

test('selected GET is read-only and never upgrades a legacy minimal receipt; POST starts replay at zero',async()=>{
  const f=fixture();await f.configure();
  f.state.set(`${base}/apiIdempotency/${receiptId}`,{bodyHash,documentId,keyId,createdAt:'2026-10-15T11:00:00Z'});
  const before=JSON.stringify([...f.state]);
  assert.equal((await f.selected()).eligible,false);assert.equal(JSON.stringify([...f.state]),before);
  assert.equal(f.writes.length,0);assert.equal(f.post(),true);assert.equal((await f.selected()).state,'PENDING_REPLAY');
  assert.equal(f.post(),true);assert.equal((await f.selected()).eligible,true);
  assert.equal(isLegacyMinimalIntegrationReceipt({...f.original,keyId},f.principal,bodyHash,documentId),false);
  assert.equal(isLegacyMinimalIntegrationReceipt({bodyHash,documentId,keyId,createdAt:'2026-10-15',extra:true},f.principal,bodyHash,documentId),false);
});

test('explicit selection of the original API receipt preserves legacy acceptance under its current valid key',async()=>{
  const f=fixture(),oldCredential=f.state.get(`${base}/integrationCredentials/${originalKey}`);
  oldCredential.expiresAt={toDate:()=>new Date('2099-01-01')};await f.configure(originalKey);
  const legacy=await readInstallationAcceptance(org,f.processing,f.document,f.version,null,f.read,now);
  const selected=await readInstallationAcceptance(org,f.processing,f.document,f.version,null,f.read,now,
    {receiptId:originalReceiptId,keyId:originalKey});
  assert.equal(legacy.eligible,true);assert.deepEqual(selected,legacy);assert.equal(f.writes.length,0);
});

test('read-only, expired, revoked or tenant-mismatched credentials cannot create or replay revalidation',async()=>{
  for(const corrupt of [
    (f:any)=>{f.credential.scopes=['integration.read'];},
    (f:any)=>{f.credential.scopes=['documents.ingest'];},
    (f:any)=>{f.credential.active=false;},
    (f:any)=>{f.credential.expiresAt={toDate:()=>new Date('2026-10-18')};},
    (f:any)=>{f.credential.orgId='other-org';},
    (f:any)=>{f.credential.keyId=originalKey;},
    (f:any)=>{f.issuer.active=false;},
    (f:any)=>{f.issuer.allFacilities=false;},
    (f:any)=>{f.organization.active=false;},
    (f:any)=>{f.organization.projectionEnabled=false;}
  ]){
    const fresh=fixture();await fresh.configure();corrupt(fresh);assert.equal(fresh.post(),false);assert.equal(fresh.writes.length,0);
    const f=fixture();await f.configure();assert.equal(f.post(),true);assert.equal(f.post(),true);
    assert.equal((await f.selected()).eligible,true);corrupt(f);
    assert.equal(f.post(),false);assert.equal((await f.selected()).eligible,false);
  }
});

test('receipt selection cannot cross key, document, immutable version, hash, revision or source version',async()=>{
  const fields={orgId:'other-org',keyId:originalKey,documentId:'a'.repeat(48),versionId:'b'.repeat(48),
    bodyHash:'c'.repeat(64),sourceVersion:2,revision:2,canonicalSnapshotHash:'d'.repeat(64),schemaVersion:'client.claim'};
  for(const [field,value] of Object.entries(fields)){
    const f=fixture();await f.configure();f.post();f.post();
    f.state.get(`${base}/apiIdempotency/${receiptId}`)[field]=value;
    assert.equal((await f.selected()).eligible,false,field);assert.equal(f.post(),false,field);
  }
  const f=fixture();await f.configure();f.post();f.post();
  const other=await readInstallationAcceptance(org,f.processing,f.document,f.version,null,f.read,now,
    {receiptId,keyId:'ik_'+'8'.repeat(16)});
  assert.equal(other.eligible,false);assert.equal(other.receiptPersisted,false);
  const originalSelected=await readInstallationAcceptance(org,f.processing,f.document,f.version,null,f.read,now,
    {receiptId:originalReceiptId,keyId});
  assert.equal(originalSelected.eligible,false);assert.equal(originalSelected.receiptPersisted,false);
});

test('all original receipt/version pointers are checked, not trusted from the selected receipt',async()=>{
  for(const patch of [{originalReceiptId:'a'.repeat(64)},{originalVersionId:'b'.repeat(48)},
    {originalKeyId:keyId},{immutableAfterHash:'c'.repeat(64)},{schemaVersion:'self.signed'}]){
    const f=fixture();await f.configure();f.post();f.post();
    Object.assign(f.state.get(`${base}/apiIdempotency/${receiptId}`).revalidation,patch);
    assert.equal((await f.selected()).eligible,false);assert.equal(f.post(),false);
    assert.ok(!f.reads.includes(`${base}/apiIdempotency/${'a'.repeat(64)}`));
  }
  for(const patch of [{orgId:'other-org'},{keyId},{bodyHash:'a'.repeat(64)},{versionId:'b'.repeat(48)},
    {documentId:'c'.repeat(48)},{sourceVersion:2},{revision:2},{canonicalSnapshotHash:'d'.repeat(64)}]){
    const f=fixture();await f.configure();f.post();f.post();Object.assign(f.original,patch);
    assert.equal((await f.selected()).eligible,false);assert.equal(f.post(),false);
  }
});

test('payload or immutable bytes cannot be changed to acquire new authority over a historical document',async()=>{
  const f=fixture();await f.configure();assert.equal(f.build({bodyHash:'a'.repeat(64)}),null);
  assert.equal(f.build({principal:{...f.principal,orgId:'other-org'}}),null);
  assert.equal(f.build({principal:{...f.principal,member:actor}}),null);
  for(const mutate of [(f:any)=>{f.document.count=99;},(f:any)=>{f.version.snapshot.count=99;},
    (f:any)=>{f.version.afterHash='0'.repeat(64);},(f:any)=>{f.version.entityId='0'.repeat(48);},
    (f:any)=>{f.version.idempotencyId='0'.repeat(64);},(f:any)=>{f.document.revoked=true;}]){
    const f=fixture();await f.configure();mutate(f);assert.equal(f.build(),null);
  }
});

test('replay absence, disabled automation or revoked issuer/configurer never grants acceptance',async()=>{
  const f=fixture();await f.configure();f.post();assert.equal((await f.selected()).state,'PENDING_REPLAY');
  f.post();assert.equal((await f.selected()).eligible,true);
  f.credential.automation.enabled=false;assert.equal((await f.selected()).eligible,false);
  const g=fixture();await g.configure();g.post();g.post();g.issuer.active=false;
  assert.equal((await g.selected()).state,'PENDING_AUTHORITY');
  const h=fixture();await h.configure();h.post();h.post();
  h.state.get(`${base}/apiIdempotency/${receiptId}`).replayCount=0;
  assert.equal((await h.selected()).state,'PENDING_REPLAY');
});

test('malformed selectors fail before any reads and do not fall back to the historical receipt',async()=>{
  const f=fixture();await f.configure();let reads=0;const read=async()=>{reads++;return null;};
  for(const selection of [{receiptId:'../other',keyId},{receiptId,keyId:'../other'}, {receiptId:'a'.repeat(63),keyId}]){
    await assert.rejects(readInstallationReadiness(org,read,documentId,selection),/INVALID_RECEIPT_SELECTION/);
  }
  await assert.rejects(readInstallationReadiness(org,read,undefined,{receiptId,keyId}),/INVALID_RECEIPT_SELECTION/);
  assert.equal(reads,0);
  const receipt=f.build()!;
  assert.equal(integrationRevalidationMatches(org,keyId,receiptId,receipt,documentId,f.document,f.version,f.original,bodyHash),true);
  assert.equal(integrationReplayPatch(org,f.principal,receipt,f.document,f.version,bodyHash,documentId,now.toISOString()),null);
});
