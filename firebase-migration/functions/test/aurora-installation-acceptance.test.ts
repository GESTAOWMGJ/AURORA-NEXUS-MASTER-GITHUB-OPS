import test from 'node:test';
import assert from 'node:assert/strict';
import {configureCanonicalAutomation, integrationReplayPatch, readInstallationAcceptance, manualIntegrationKeyId,publicAutomationConfiguration} from '../src/auroraInstallationAcceptance.ts';
const org='synthetic', base=`organizations/${org}`, now=new Date('2026-10-14T12:00:00.000Z');
const actor={orgId:org,uid:'synthetic-admin',email:'synthetic@example.test',role:'org_admin',allFacilities:true,
  facilityIds:[],permissions:[],mfaVerified:true};
function fixture(manual=false){
  const keyId=manual?manualIntegrationKeyId(org,actor.uid):'ik_'+'a'.repeat(16),documentId='b'.repeat(48),versionId='c'.repeat(48);
  const hash='d'.repeat(64),receiptId='e'.repeat(64),bodyHash='f'.repeat(64);
  const processing={firstIngestionVerified:true,documentId,versionId,sourceVersion:1,revision:1,canonicalSnapshotHash:hash};
  const document={orgId:org,source:{system:'ERP'},sourceVersion:1,revision:1,canonicalSnapshotHash:hash,
    integration:{keyId,payloadHash:bodyHash,transport:manual?'AURORA_NATIVE_SESSION_IMPORT':'AURORA_INTEGRATION_API'}};
  const version={orgId:org,idempotencyId:receiptId,sourceVersion:1,revision:1,_readVersionId:versionId,
    actor:manual?{uid:actor.uid}:{keyId}};
  const receipt={schemaVersion:'aurora.ingestion.receipt.v1',orgId:org,keyId,bodyHash,documentId,versionId,
    sourceVersion:1,revision:1,canonicalSnapshotHash:hash,acceptedAt:'2026-10-14T11:00:00.000Z',replayCount:0};
  const state=new Map<string,any>([[base,{active:true,projectionEnabled:true,projectionMode:'SHADOW'}],
    [`${base}/members/${actor.uid}`,{active:true,role:'org_admin',allFacilities:true}],
    [`${base}/apiIdempotency/${receiptId}`,receipt],
    [`${base}/integrationCredentials/${keyId}`,{orgId:org,keyId,createdBy:actor.uid,active:true,
      scopes:['integration.read','documents.ingest'],expiresAt:{toDate:()=>new Date('2099-01-01T00:00:00Z')}}]]);
  const paths:string[]=[],writes:string[]=[];
  const read=async(path:string)=>{paths.push(path);return state.get(path)??null;};
  const configure=(patch:any={},caller=actor)=>configureCanonicalAutomation(caller,{action:'CONFIGURE_AUTOMATION',
    method:manual?'MANUAL':'API_TOKEN',...(!manual?{keyId}:{}),sourceSystem:'ERP',enabled:true,expectedRevision:0,...patch},
    {read,merge:(path,data)=>{writes.push(path);state.set(path,{...state.get(path),...data});},timestamp:'2026-10-14T11:00:01.000Z'});
  const assess=()=>readInstallationAcceptance(org,processing,document,version,state.get(`${base}/runtimeCheckpoints/installation`)??null,read,now);
  const replay=()=>{const patch=integrationReplayPatch(org,{orgId:org,keyId,name:'synthetic'},receipt,document,version,bodyHash,documentId,'2026-10-14T11:00:02.000Z');assert.ok(patch);Object.assign(receipt,patch);};
  return {keyId,receiptId,processing,document,version,receipt,state,paths,writes,read,configure,assess,replay};
}
test('configuration alone, ping, processing and a cached first receipt cannot finish installation',async()=>{
  const f=fixture();assert.equal((await f.assess()).state,'PENDING_REPLAY');await f.configure();
  const before=await f.assess();assert.equal(before.automationVerified,false);assert.equal(before.eligible,false);
  f.replay();const after=await f.assess();assert.equal(after.state,'INSTALLATION_INTEGRATION_VERIFIED');assert.equal(after.eligible,true);
  assert.equal(after.method,'API_TOKEN');assert.equal(after.automationScope,'AURORA_CANONICAL_PIPELINE');
  assert.equal(after.providerAccessVerified,false);assert.equal(after.agentExecutionVerified,false);
  assert.equal(after.localCollectionVerified,false);assert.equal(after.globalDocumentAcquisitionVerified,false);
  assert.equal(after.processedFormat,'CANONICAL_STRUCTURED_JSON');
  assert.equal(after.acquisitionModes.CLOUD_OAUTH,'PENDING_ADAPTER_EVIDENCE');
  assert.equal(after.acquisitionModes.LOCAL_AGENT,'PENDING_ADAPTER_EVIDENCE');
  assert.ok(f.paths.every(path=>path===base||path.startsWith(base+'/')));
  assert.doesNotMatch(JSON.stringify(after),/synthetic-admin|tokenHash|expiresAt|payloadHash/);
});
test('configuration CAS, current membership, MFA, scopes and exact methods fail closed before writes',async()=>{
  const f=fixture();await f.configure();assert.equal(f.writes.length,1);
  await assert.rejects(f.configure(),/CONFIGURATION_CONFLICT/);assert.equal(f.writes.length,1);
  for(const method of ['CLOUD_OAUTH','LOCAL_AGENT'])await assert.rejects(f.configure({method}),/ADAPTER_EVIDENCE_REQUIRED/);
  for(const patch of [{method:'GLOBAL'},{keyId:'../../other'},{expectedRevision:-1},{enabled:'true'},
    {sourceSystem:'ERP/other'},{providerAccessVerified:true},{orgId:'other-org'}])await assert.rejects(f.configure(patch),/INVALID_AUTOMATION_CONFIGURATION/);
  await assert.rejects(f.configure({}, {...actor,mfaVerified:false}),/MFA_AND_INTEGRATION_ADMIN_REQUIRED/);
  const credential=f.state.get(`${base}/integrationCredentials/${f.keyId}`);credential.keyId='ik_'+'9'.repeat(16);
  await assert.rejects(f.configure({expectedRevision:1}),/AUTOMATION_CREDENTIAL_INACTIVE/);credential.keyId=f.keyId;
  f.state.set(`${base}/members/${actor.uid}`,{active:false,role:'org_admin',allFacilities:true});
  await assert.rejects(f.configure({expectedRevision:1}),/MEMBERSHIP_REVOKED/);
  assert.equal(f.writes.length,1);
});
test('configuration projections expose only bounded public metadata; corrupted CAS bindings cannot be adopted',async()=>{
  const f=fixture();await f.configure();const binding=f.state.get(`${base}/integrationCredentials/${f.keyId}`).automation;
  const projection=publicAutomationConfiguration({...binding,secret:'NEVER',configuredBy:'NEVER'});
  assert.ok(projection);assert.doesNotMatch(JSON.stringify(projection),/NEVER|configuredBy|orgId/);
  assert.equal(publicAutomationConfiguration({...binding,sourceSystem:{secret:'NEVER'}}),null);
  binding.sourceSystem='MV';await assert.rejects(f.configure({expectedRevision:1}),/CONFIGURATION_CONFLICT/);
  assert.equal(f.writes.length,1);
});
test('receipt and replay must bind the same tenant, key, payload, document and immutable revision',async()=>{
  for(const [field,value] of Object.entries({orgId:'other-org',keyId:'ik_'+'1'.repeat(16),bodyHash:'0'.repeat(64),
    documentId:'0'.repeat(48),versionId:'0'.repeat(48),sourceVersion:2,revision:2,canonicalSnapshotHash:'0'.repeat(64),schemaVersion:'client.self.signed'})){
    const f=fixture();await f.configure();f.replay();(f.receipt as any)[field]=value;
    assert.equal((await f.assess()).eligible,false,field);
    assert.equal(integrationReplayPatch(org,{orgId:org,keyId:f.keyId,name:'synthetic'},f.receipt,f.document,f.version,'f'.repeat(64),'b'.repeat(48),'2026-10-14T11:00:03Z'),null,field);
  }
  const f=fixture();await f.configure();f.replay();f.receipt.lastReplayAt='2026-10-14T12:00:01Z';
  assert.equal((await f.assess()).state,'PENDING_REPLAY');
});
test('revocation, changed configuration, wrong source and stopped pipeline revoke current eligibility',async()=>{
  for(const corrupt of [(f:any)=>{f.state.get(base).active=false;},(f:any)=>{f.state.get(base).projectionEnabled=false;},
    (f:any)=>{f.state.get(`${base}/members/${actor.uid}`).active=false;},
    (f:any)=>{f.state.get(`${base}/integrationCredentials/${f.keyId}`).active=false;},
    (f:any)=>{f.state.get(`${base}/integrationCredentials/${f.keyId}`).scopes=['integration.read'];},
    (f:any)=>{f.state.get(`${base}/integrationCredentials/${f.keyId}`).expiresAt={toDate:()=>new Date('2000-01-01')};},
    (f:any)=>{f.state.get(`${base}/integrationCredentials/${f.keyId}`).automation.configurationHash='0'.repeat(64);},
    (f:any)=>{f.document.source.system='MV';}]){
    const f=fixture();await f.configure();f.replay();assert.equal((await f.assess()).eligible,true);corrupt(f);
    assert.equal((await f.assess()).eligible,false);
  }
});
test('manual upload uses the authenticated author identity, never a token or inferred local collector',async()=>{
  const f=fixture(true);await f.configure();f.replay();const ready=await f.assess();assert.equal(ready.eligible,true);
  assert.equal(ready.method,'MANUAL');assert.equal(ready.acquisitionModes.MANUAL,'CANONICAL_PIPELINE_VERIFIED');
  assert.deepEqual(f.writes,[`${base}/runtimeCheckpoints/installation`]);
  f.version.actor={uid:'different-admin'};assert.equal((await f.assess()).eligible,false);
});
test('credential expiration during asynchronous issuer verification cannot finish integration',async()=>{
  const f=fixture();await f.configure();f.replay();let reads=0;
  f.state.get(`${base}/integrationCredentials/${f.keyId}`).expiresAt={toDate:()=>new Date(now.getTime()+1000)};
  const proof=await readInstallationAcceptance(org,f.processing,f.document,f.version,null,async path=>{
    if(path.includes('/members/'))reads++;return f.read(path);
  },()=>new Date(now.getTime()+(reads>=2?2000:0)));
  assert.equal(proof.eligible,false);assert.equal(proof.state,'PENDING_AUTHORITY');
});
test('client methods and boolean reports cannot fabricate receipt, provider access or automation',async()=>{
  const f=fixture();const client={...f.processing,method:'CLOUD_OAUTH',automationVerified:true,providerAccessVerified:true,operationalComplete:true};
  const proof=await readInstallationAcceptance(org,client,f.document,f.version,{state:'COMPLETE',automationConfigured:true},f.read,now);
  assert.equal(proof.eligible,false);assert.equal(proof.providerAccessVerified,false);assert.equal(proof.replayVerified,false);
  const missing=await readInstallationAcceptance(org,{firstIngestionVerified:false},null,null,null,async()=>{throw Error('MUST_NOT_READ');},now);
  assert.equal(missing.state,'PENDING_PROCESSING');assert.equal(missing.eligible,false);
});
