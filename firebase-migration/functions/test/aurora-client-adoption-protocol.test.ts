import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildClientAdoptionPlan, clientAdoptionPolicy, generatedWindowsPathsFit } from '../src/auroraNativeRoutines.js';
import { readInstallationReadiness } from '../src/auroraInstallationReadiness.js';
import { configureCanonicalAutomation, integrationReplayPatch, manualIntegrationKeyId } from '../src/auroraInstallationAcceptance.js';
import { immutableEntityVersionId, persistedDocumentHash } from '../src/auroraCanonicalVersions.js';
import { buildMasterOperationalState } from '../src/auroraMasterEngine.js';
const hash = (s:string) => createHash('sha256').update(s).digest('hex');

/** Entirely synthetic existing-store adapter, with real configure/read/replay reducers. */
function tenant(org:string, manual=false) {
  const base=`organizations/${org}`, actor={orgId:org,uid:`${org}-operator`,email:'operator@example.test',
    role:'org_admin',allFacilities:true,facilityIds:[],permissions:[],mfaVerified:true};
  const keyId=manual?manualIntegrationKeyId(org,actor.uid):'ik_'+hash(org).slice(0,16);
  const id=hash(org+'document').slice(0,48), receiptId=hash(org+'receipt'), bodyHash=hash(org+'payload');
  const doc={orgId:org,entityType:'sourceDocument',entityKey:'ERP:'+org,revision:1,sourceVersion:1,
    source:{system:'ERP'},nativeReady:true,sourceIndependent:true,externalFetchRequired:false,sanitized:true,
    workflowState:'VALIDATED',documentFragility:'NONE',missingFieldsCount:0,competence:'2025-01',
    canonicalSnapshotHash:hash(org+'facts'),integration:{keyId,payloadHash:bodyHash,
      transport:manual?'AURORA_NATIVE_SESSION_IMPORT':'AURORA_INTEGRATION_API'}};
  const versionId=immutableEntityVersionId('sourceDocument',doc.entityKey,1);
  const version={orgId:org,entityType:'sourceDocument',entityId:id,entityKey:doc.entityKey,revision:1,
    sourceVersion:1,snapshot:doc,afterHash:persistedDocumentHash(null,doc),idempotencyId:receiptId,
    actor:manual?{uid:actor.uid}:{keyId},_readVersionId:versionId};
  const receipt={schemaVersion:'aurora.ingestion.receipt.v1',orgId:org,keyId,bodyHash,documentId:id,versionId,
    sourceVersion:1,revision:1,canonicalSnapshotHash:doc.canonicalSnapshotHash,acceptedAt:'2025-01-01T00:00:00Z',replayCount:0};
  const records=new Map<string,any>([[base,{active:true,projectionEnabled:true,projectionMode:'SHADOW'}],
    [`${base}/members/${actor.uid}`,{active:true,role:'org_admin',allFacilities:true}],
    [`${base}/integrationCredentials/${keyId}`,{orgId:org,keyId,createdBy:actor.uid,active:true,
      scopes:['integration.read','documents.ingest'],expiresAt:{toDate:()=>new Date('2099-01-01T00:00:00Z')}}],
    [`${base}/runtimeCheckpoints/integration-documents`,{orgId:org,state:'HEALTHY',lastDocumentId:id}],
    [`${base}/runtimeCheckpoints/installation`,{orgId:org,state:'COMPLETE',documentId:id,versionId,
      sourceVersion:1,canonicalSnapshotHash:doc.canonicalSnapshotHash,acceptanceSchemaVersion:'aurora.installation.acceptance.v1'}],
    [`${base}/sourceDocuments/${id}`,doc],[`${base}/entityVersions/${versionId}`,version],
    [`${base}/apiIdempotency/${receiptId}`,receipt],
    [`${base}/dashboardSnapshots/current`,{orgId:org,competence:doc.competence,state:'SHADOW',
      dataQuality:{complete:true,sourcePresent:true},generatedAt:'2025-01-01T00:00:02Z',
      integrationReadback:[{documentId:id,versionId,sourceVersion:1,revision:1,canonicalSnapshotHash:doc.canonicalSnapshotHash}]}]]);
  const paths:string[]=[];
  const read=async(path:string)=>{paths.push(path);return records.get(path)??null;};
  const configure=()=>configureCanonicalAutomation(actor,{action:'CONFIGURE_AUTOMATION',method:manual?'MANUAL':'API_TOKEN',
    ...(!manual?{keyId}:{}),sourceSystem:'ERP',enabled:true,expectedRevision:0},
    {read,merge:(path,data)=>records.set(path,{...records.get(path),...data}),
      create:(path,data)=>{assert.ok(!records.has(path));records.set(path,data);},timestamp:'2025-01-01T00:00:01Z'});
  const replay=()=>{const patch=integrationReplayPatch(org,{orgId:org,keyId,name:'synthetic'},receipt,doc,version,
    bodyHash,id,'2025-01-01T00:00:02Z');assert.ok(patch);Object.assign(receipt,patch);};
  const complete=async()=>{await configure();replay();const proof=await readInstallationReadiness(org,read);
    Object.assign(records.get(`${base}/runtimeCheckpoints/installation`),{
      configurationHash:proof.acceptance?.configurationHash,receiptId});return readInstallationReadiness(org,read);};
  return {org,actor,keyId,records,paths,read,configure,replay,complete,doc,version,receipt,receiptId};
}

test('two tenants complete only their own canonical event, automation and persisted replay',async()=>{
  for(const org of ['synthetic-alpha','synthetic-beta']) {
    const f=tenant(org), before=await readInstallationReadiness(org,f.read);
    assert.notEqual(buildClientAdoptionPlan(org,{member:f.actor,installation:before}).state,'SCOPED_PIPELINE_VERIFIED');
    const proof=await f.complete(), plan=buildClientAdoptionPlan(org,{member:f.actor,installation:proof});
    assert.equal(plan.state,'SCOPED_PIPELINE_VERIFIED');assert.equal(plan.proofStages.completionCommit,'VERIFIED');
    assert.equal(plan.executionAllowed,false);assert.equal(plan.installationAuthorized,false);
    assert.equal(plan.globalDocumentIngestionVerified,false);assert.equal(plan.allClientsSynchronized,false);
    assert.equal(plan.proofStages.extraction,'DISTINCT_EXTRACTION_PROOF_REQUIRED');
    assert.equal(plan.proofStages.deviceAcceptance,'NOT_ATTESTED_BY_PIPELINE_READBACK');
    assert.ok(f.paths.every(path=>path===`organizations/${org}`||path.startsWith(`organizations/${org}/`)));
    assert.doesNotMatch(JSON.stringify(plan),new RegExp(`${f.keyId}|${f.receiptId}|${f.actor.email}`));
  }
});

test('a second tenant cannot inherit another tenant readback, membership or source selection',async()=>{
  const a=tenant('synthetic-alpha'),b=tenant('synthetic-beta'),proof=await a.complete();
  assert.equal(buildClientAdoptionPlan(b.org,{member:b.actor,installation:proof}).state,'BLOCKED_SCOPE_CONFLICT');
  assert.equal(buildClientAdoptionPlan(b.org,{member:a.actor,installation:proof}).state,'PENDING_AUTHORIZATION');
  assert.equal(buildClientAdoptionPlan(a.org,{member:a.actor,installation:proof,
    selection:{method:'API_TOKEN',sourceSystem:'OTHER_SOURCE',targets:['CANONICAL_PIPELINE']}}).state,'BLOCKED_SCOPE_CONFLICT');
  for(const change of [{mfaVerified:false},{role:'viewer'},{allFacilities:false}]) {
    assert.equal(buildClientAdoptionPlan(a.org,{member:{...a.actor,...change},installation:proof}).state,'PENDING_AUTHORIZATION');
  }
});

test('positive processing, persisted replay and completion never attest acceptance of document facts',async()=>{
  const f=tenant('synthetic-alpha'),proof=await f.complete();
  assert.equal(proof.firstIngestionVerified,true);
  assert.equal(proof.acceptance?.processingVerified,true);
  assert.equal(proof.acceptance?.replayVerified,true);
  assert.equal(proof.operationalComplete,true);
  // VALIDATED/nativeReady are supplied by a structured input in this fixture,
  // without a human factual-review receipt. The pipeline readback is still valid.
  assert.equal(f.doc.workflowState,'VALIDATED');assert.equal(f.doc.nativeReady,true);
  const plan=buildClientAdoptionPlan(f.org,{member:f.actor,installation:proof});
  assert.equal(plan.state,'SCOPED_PIPELINE_VERIFIED');
  assert.equal(plan.proofStages.canonicalProcessing,'VERIFIED_FOR_SELECTED_DOCUMENT');
  assert.equal(plan.proofStages.acceptedCanonicalFacts,'NOT_ATTESTED_BY_PIPELINE_READBACK');
  assert.equal(plan.proofStages.completionCommit,'VERIFIED');
  assert.equal(buildClientAdoptionPlan(f.org).proofStages.acceptedCanonicalFacts,'NOT_ATTESTED_BY_PIPELINE_READBACK');
});

test('readiness loses eligibility after revocation, changed source, missing scope or altered immutable bytes',async()=>{
  for(const mutate of [
    (f:ReturnType<typeof tenant>)=>{f.records.get(`organizations/${f.org}/integrationCredentials/${f.keyId}`).active=false;},
    (f:ReturnType<typeof tenant>)=>{f.records.get(`organizations/${f.org}/integrationCredentials/${f.keyId}`).scopes=['integration.read'];},
    (f:ReturnType<typeof tenant>)=>{f.doc.source.system='OTHER_SOURCE';},
    (f:ReturnType<typeof tenant>)=>{f.version.afterHash=hash('changed');}
  ]) {
    const f=tenant('synthetic-beta');await f.complete();mutate(f);
    const plan=buildClientAdoptionPlan(f.org,{member:f.actor,installation:await readInstallationReadiness(f.org,f.read)});
    assert.notEqual(plan.state,'SCOPED_PIPELINE_VERIFIED');assert.notEqual(plan.proofStages.canonicalAutomation,'VERIFIED');
  }
});

test('manual is a proved event and never a cloud poller or a provider grant',async()=>{
  const f=tenant('synthetic-manual',true),proof=await f.complete();
  const plan=buildClientAdoptionPlan(f.org,{member:f.actor,installation:proof});
  assert.equal(plan.state,'SCOPED_PIPELINE_VERIFIED');assert.equal(plan.selectedMethod,'MANUAL');
  assert.equal(plan.sourcePollingEnabled,false);assert.equal(plan.permissionsGranted,false);
});

test('selected provider and device targets need their own evidence, not all future clouds',async()=>{
  const f=tenant('synthetic-alpha'),proof=await f.complete();
  for(const method of ['CLOUD_OAUTH','LOCAL_AGENT'] as const) {
    const plan=buildClientAdoptionPlan(f.org,{member:f.actor,selection:{method,sourceSystem:'DRIVE',targets:['CANONICAL_PIPELINE']}});
    assert.equal(plan.state,'PENDING_ADAPTER_EVIDENCE');assert.equal(plan.executionAllowed,false);
  }
  for(const target of ['WINDOWS','MACOS','IOS_NATIVE'] as const) {
    const plan=buildClientAdoptionPlan(f.org,{member:f.actor,installation:proof,
      selection:{method:'API_TOKEN',sourceSystem:'ERP',targets:['CANONICAL_PIPELINE',target]}});
    assert.equal(plan.state,'PENDING_DEVICE_ACCEPTANCE');assert.equal(plan.platformPublicationBlockedByThisTenant,false);
  }
});

test('partial, offline and unknown outcomes cannot become global success or an automatic retry',async()=>{
  const f=tenant('synthetic-alpha'),proof=await f.complete();
  for(const state of ['PARTIAL','PENDING']) {
    const plan=buildClientAdoptionPlan(f.org,{member:f.actor,installation:{...proof,state} as any});
    assert.equal(plan.state,'PENDING_CANONICAL_PROCESSING');
  }
  const unknown=buildClientAdoptionPlan(f.org,{member:f.actor,installation:proof,previousOperation:'UNKNOWN'});
  assert.equal(unknown.state,'PENDING_RECOVERY');assert.equal(unknown.preserveLocksAndProofs,true);
  assert.equal(unknown.automaticRetryPermitted,false);assert.equal(unknown.proofStages.completionCommit,'PENDING');
  assert.equal(buildClientAdoptionPlan(f.org,{member:f.actor,installation:proof,availability:'UNAVAILABLE'}).state,'PENDING_AVAILABILITY');
});

test('all prospective Windows paths, including future receipt, must fit 240 UTF16 units',()=>{
  assert.equal(generatedWindowsPathsFit([]),false);
  assert.equal(generatedWindowsPathsFit(['D:/'+('x'.repeat(237))]),true);
  assert.equal(generatedWindowsPathsFit(['D:/'+('x'.repeat(238))]),false);
  assert.equal(generatedWindowsPathsFit(['D:/'+('x'.repeat(236))+'\u{1f600}']),false);
  assert.equal(generatedWindowsPathsFit(['relative/receipt.json']),false);
  const actor=tenant('synthetic-alpha').actor;
  assert.equal(buildClientAdoptionPlan(actor.orgId,{member:actor,
    selection:{method:'MANUAL',sourceSystem:'ERP',targets:['WINDOWS']},
    generatedWindowsPaths:['D:/'+('x'.repeat(241))]}).state,'BLOCKED_PATH_CAPACITY');
});

test('the real Master planner carries the reusable protocol without creating authority or scheduler',()=>{
  for(const org of ['synthetic-alpha','synthetic-beta']) {
    const result=buildMasterOperationalState({orgId:org},{adoption:{member:tenant(org).actor}}) as any;
    assert.equal(result.clientAdoption.orgId,org);assert.equal(result.clientAdoption.state,'PENDING_SOURCE_SELECTION');
    assert.equal(result.routines.cloudIntakePolicy.adoptionProtocol.automaticLegacyBootstrapImplemented,false);
    assert.equal(result.clientAdoption.executionAllowed,false);
  }
  assert.equal(clientAdoptionPolicy().tenantPendingBlocksPlatformPublication,false);
  assert.equal(clientAdoptionPolicy().executorCreated,false);
  assert.equal(clientAdoptionPolicy().ancestryProfiles,'EACH_HISTORICAL_PACKAGE_USED_REQUIRES_ITS_OWN_EXACT_REGISTERED_PROFILE');
  assert.equal(clientAdoptionPolicy().historicalByteAudit,'CURRENT_AND_IMMEDIATE_BACKUP_BYTES_WITH_AUTHENTICATED_ANCESTRY_LINKS_NOT_ALL_DEEP_BACKUP_COPIES');
  assert.equal(clientAdoptionPolicy().currentProfileAppliedToHistory,false);
  assert.equal(clientAdoptionPolicy().countOnlyProfileAcceptance,false);
});
