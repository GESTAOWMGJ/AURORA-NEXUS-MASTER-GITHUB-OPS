import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {DOCUMENT_OBSERVATION_SCHEMA,DOCUMENT_OBSERVATION_RECEIPT_SCHEMA,documentObservationHash,
  documentObservationIdentity,observationAcquisitionHash,observationPayloadHash,parseDocumentObservationPayload,
  recordDocumentObservation,type DocumentObservationPayload} from '../src/auroraDocumentObservation.ts';
import {canonicalIntegrationDocument,integrationDocumentVersionDecision,parseIntegrationDocumentPayload} from '../src/auroraIntegrationDocument.ts';
import {immutableEntityVersionId,persistedDocumentHash,stableValue} from '../src/auroraCanonicalVersions.ts';
import {installationReadiness} from '../src/auroraInstallationReadiness.ts';
import {readInstallationAcceptance,manualIntegrationKeyId} from '../src/auroraInstallationAcceptance.ts';

const org='synthetic',base=`organizations/${org}`,keyId='ik_'+'a'.repeat(16);
const principal={orgId:org,keyId,name:'Synthetic technical connector'};
const now=new Date('2026-10-20T12:00:00.000Z');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function observation():DocumentObservationPayload {
  return {schemaVersion:DOCUMENT_OBSERVATION_SCHEMA,operation:'OBSERVE_DOCUMENT_EXTRACTION',sourceSystem:'ERP',
    externalDocumentId:'synthetic-document-1',observedAt:'2026-10-20T11:00:00.000Z',
    expectedRevision:0,expectedPreviousObservationHash:null,
    acquisition:{provider:'MANUAL',sourceObjectIdHash:sha('synthetic-source'),versionKind:'CLIENT_REVISION',observedVersion:'r1',
      representation:'ORIGINAL_BYTES',sourceMimeType:'text/plain',acquiredMimeType:'text/plain',
      byteSha256:sha('synthetic content'),byteLength:17},
    extraction:{status:'COMPLETE',method:'TEXT_UTF8',methodVersion:'1.0.0',textSha256:sha('synthetic content'),textByteLength:17,
      coverage:{basis:'EXPECTED_PARTS',totalUnits:1,processedUnits:1},code:'CONTENT_EXTRACTED'}};
}
test('PDF text observation accepts partial evidence only, preserving OCR/review and MIME/page boundaries',()=>{
  const value=observation();value.acquisition.sourceMimeType=value.acquisition.acquiredMimeType='application/pdf';
  value.extraction={...value.extraction,status:'PARTIAL',method:'PDF_TEXT',code:'BOUNDED_EXTRACTION_PARTIAL',
    coverage:{basis:'BOUNDED_REPRESENTATION',totalUnits:2,processedUnits:2}};
  assert.ok(parseDocumentObservationPayload(value));
  for(const mutate of [(v:any)=>{v.extraction.status='COMPLETE';v.extraction.code='CONTENT_EXTRACTED';},
    (v:any)=>{v.extraction.coverage.basis='EXPECTED_PARTS';},(v:any)=>{v.extraction.coverage.totalUnits=33;},
    (v:any)=>{v.acquisition.sourceMimeType=v.acquisition.acquiredMimeType='text/plain';}]){
    const invalid=structuredClone(value);mutate(invalid);assert.equal(parseDocumentObservationPayload(invalid),null);
  }
});
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function fixture(manual=false) {
  const member={orgId:org,uid:'synthetic-admin',email:'synthetic@example.invalid',role:'org_admin',
    allFacilities:true,facilityIds:[],permissions:[],mfaVerified:true};
  const who=manual?{orgId:org,keyId:manualIntegrationKeyId(org,member.uid),name:'Synthetic browser import',member}:principal;
  const state=new Map<string,any>([[base,{active:true,projectionEnabled:true,projectionMode:'SHADOW'}],
    [`${base}/integrationCredentials/${keyId}`,{orgId:org,keyId,active:true,scopes:['documents.ingest'],createdBy:member.uid,
      expiresAt:{toDate:()=>new Date('2099-01-01T00:00:00Z')}}],
    [`${base}/members/${member.uid}`,{active:true,role:'org_admin',allFacilities:true,permissions:[]}]]);
  const reads:string[]=[],writes:{path:string;data:any;create:boolean}[]=[];
  const run=async (payload:any=observation(),idempotency='synthetic-observation-request-1',caller:any=who,crash=false)=>{
    const pending:typeof writes=[];
    let writing=false;
    const result=await recordDocumentObservation(caller,payload,idempotency,{
      read:async path=>{assert.equal(writing,false,'all transactional reads precede writes');reads.push(path);return state.get(path)??null;},
      create:(path,data)=>{writing=true;assert.equal(state.has(path),false,'create is exclusive');pending.push({path,data,create:true});},
      replace:(path,data)=>{writing=true;pending.push({path,data,create:false});},
      timestamp:'2026-10-20T12:00:00.000Z'
    },now);
    if(crash)throw Error('SYNTHETIC_CRASH_BEFORE_COMMIT');
    for(const write of pending){state.set(write.path,write.data);writes.push(write);}
    return result;
  };
  const path=`${base}/sourceDocuments/${documentObservationIdentity(org,observation()).id}`;
  return {state,run,reads,writes,path,member,who};
}

test('closed observation accepts structural proof only and canonicalizes object key ordering',()=>{
  const value=observation(),parsed=parseDocumentObservationPayload(value);
  assert.ok(parsed);assert.deepEqual(parsed,value);
  const shuffled=Object.fromEntries(Object.entries(value).reverse());
  assert.equal(observationPayloadHash(parseDocumentObservationPayload(shuffled)!),observationPayloadHash(parsed));
  for(const field of ['narrative','text','amountCents','count','competence','sourceVersion','nativeReady','sourceIndependent','occurredAt','orgId']) {
    assert.equal(parseDocumentObservationPayload({...value,[field]:'forbidden'}),null,field);
  }
  for(const [part,field] of [['acquisition','token'],['acquisition','path'],['extraction','text'],['extraction','confidence'],['extraction','rawXml']]) {
    const bad:any=clone(value);bad[part!][field!]='forbidden';assert.equal(parseDocumentObservationPayload(bad),null,`${part}.${field}`);
  }
  const bad:any=clone(value);bad.extraction.coverage.complete=true;assert.equal(parseDocumentObservationPayload(bad),null);
});
test('source system is explicitly configured and identifiers cannot carry paths or clinical identities',()=>{
  for(const system of ['MV','TASY','ERP'])assert.ok(parseDocumentObservationPayload({...observation(),sourceSystem:system}));
  for(const sourceSystem of ['GOOGLE_DRIVE','MANUAL','erp','UNKNOWN','ERP/other'])assert.equal(parseDocumentObservationPayload({...observation(),sourceSystem}),null);
  for(const externalDocumentId of ['12345678901','patient:123','cpf:123','C:/private/path','../../other','name with spaces'])
    assert.equal(parseDocumentObservationPayload({...observation(),externalDocumentId}),null,externalDocumentId);
  assert.notEqual(documentObservationIdentity(org,observation()).id,documentObservationIdentity('other-org',observation()).id);
  const factual=parseIntegrationDocumentPayload({sourceSystem:'ERP',externalDocumentId:observation().externalDocumentId,sourceVersion:42,
    occurredAt:now.toISOString(),documentType:'OTHER',competence:null,amountCents:null,count:null,workflowState:'QUEUED',slaDueAt:null,
    documentFragility:'NONE',missingFieldsCount:0,nativeReady:false,sourceIndependent:false})!;
  assert.equal(documentObservationIdentity(org,observation()).id,canonicalIntegrationDocument(org,factual).id);
});
test('all eight methods require their reviewed acquired MIME and bounded evidence',()=>{
  const methods={TEXT_UTF8:'text/plain',CSV_UTF8:'text/csv',JSON_UTF8:'application/json',XML_TEXT:'application/xml',
    DOCX_XML:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    XLSX_XML:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ODT_XML:'application/vnd.oasis.opendocument.text',ODS_XML:'application/vnd.oasis.opendocument.spreadsheet'};
  for(const [method,mime] of Object.entries(methods)) {
    const value:any=observation();value.extraction.method=method;value.acquisition.sourceMimeType=mime;value.acquisition.acquiredMimeType=mime;
    assert.ok(parseDocumentObservationPayload(value),method);value.acquisition.acquiredMimeType='application/pdf';
    assert.equal(parseDocumentObservationPayload(value),null,method);
  }
  for(const [part,field,value] of [['acquisition','byteLength',0],['acquisition','byteLength',1048577],
    ['acquisition','byteLength',1.5],['acquisition','byteSha256','invalid'],['extraction','textByteLength',262145],
    ['extraction','textSha256',null],['extraction','method','PDF_UNREVIEWED'],['extraction','methodVersion','2.0.0']]) {
    const bad:any=observation();bad[part!][field!]=value;assert.equal(parseDocumentObservationPayload(bad),null,`${part}.${field}`);
  }
});
test('complete, partial, pending and failed have distinct content and coverage gates',()=>{
  const partial:any=observation();partial.extraction.status='PARTIAL';partial.extraction.code='BOUNDED_EXTRACTION_PARTIAL';
  partial.extraction.coverage.totalUnits=2;assert.ok(parseDocumentObservationPayload(partial));
  partial.extraction.coverage.totalUnits=1;assert.equal(parseDocumentObservationPayload(partial),null);
  partial.extraction.coverage.basis='BOUNDED_REPRESENTATION';assert.ok(parseDocumentObservationPayload(partial));
  for(const status of ['PENDING','FAILED']) {
    const value:any=observation();Object.assign(value.extraction,{status,method:null,textSha256:null,textByteLength:0,
      code:status==='PENDING'?'BACKEND_REQUIRED':'MALFORMED_DOCUMENT'});value.extraction.coverage.processedUnits=0;
    assert.ok(parseDocumentObservationPayload(value));value.extraction.textSha256=sha('unexpected');
    assert.equal(parseDocumentObservationPayload(value),null);
  }
  for(const patch of [{totalUnits:0,processedUnits:0},{totalUnits:10001,processedUnits:1},{totalUnits:1,processedUnits:2},
    {totalUnits:2,processedUnits:1},{totalUnits:1,processedUnits:0},{totalUnits:1.1,processedUnits:1}]) {
    const value:any=observation();Object.assign(value.extraction.coverage,patch);assert.equal(parseDocumentObservationPayload(value),null);
  }
  const empty:any=observation();empty.extraction.textByteLength=0;assert.equal(parseDocumentObservationPayload(empty),null);
});
test('version kinds preserve byte identity and provider revisions without guessing order from time',()=>{
  const local:any=observation();Object.assign(local.acquisition,{provider:'LOCAL_AGENT',versionKind:'LOCAL_CONTENT_HASH',observedVersion:local.acquisition.byteSha256});
  assert.ok(parseDocumentObservationPayload(local));local.acquisition.observedVersion=sha('wrong');assert.equal(parseDocumentObservationPayload(local),null);
  const drive:any=observation();Object.assign(drive.acquisition,{provider:'GOOGLE_DRIVE',versionKind:'PROVIDER_REVISION',observedVersion:'7'});
  assert.ok(parseDocumentObservationPayload(drive));
  for(const observedVersion of ['0','r7','-1','0007','7.1'])assert.equal(parseDocumentObservationPayload({...drive,acquisition:{...drive.acquisition,observedVersion}}),null);
  const exportValue:any=observation();Object.assign(exportValue.acquisition,{sourceMimeType:'application/vnd.google-apps.document',representation:'PROVIDER_EXPORT'});
  assert.ok(parseDocumentObservationPayload(exportValue));exportValue.acquisition.representation='ORIGINAL_BYTES';assert.equal(parseDocumentObservationPayload(exportValue),null);
  for(const observedAt of ['yesterday','2026-02-30T11:00:00.000Z','2026-10-20','2026-10-20T11:00:00Z'])
    assert.equal(parseDocumentObservationPayload({...observation(),observedAt}),null);
});
test('semantic observation hash ignores capture time and CAS but binds tenant, acquisition, method and coverage',()=>{
  const value=observation(),hash=documentObservationHash(org,value);
  assert.equal(documentObservationHash(org,{...value,observedAt:now.toISOString(),expectedRevision:25,expectedPreviousObservationHash:sha('previous')}),hash);
  assert.notEqual(observationPayloadHash(value),observationPayloadHash({...value,observedAt:now.toISOString()}));
  for(const change of [(v:any)=>{v.acquisition.byteSha256=sha('changed');},(v:any)=>{v.acquisition.observedVersion='r2';},
    (v:any)=>{v.extraction.textSha256=sha('changed');},(v:any)=>{v.extraction.coverage.basis='BOUNDED_REPRESENTATION';},
    (v:any)=>{v.sourceSystem='MV';}]) {const changed=clone(value);change(changed);assert.notEqual(documentObservationHash(org,changed),hash);}
  assert.notEqual(documentObservationHash('other-org',value),hash);
});
test('transaction records a pending document, immutable version, own receipt and audit in the existing tenant paths',async()=>{
  const f=fixture(),payload=observation(),result=await f.run(payload),document=f.state.get(f.path);
  assert.equal(result.kind,'RECORDED');assert.equal(result.schemaVersion,DOCUMENT_OBSERVATION_RECEIPT_SCHEMA);
  assert.equal(result.sourceVersion,null);assert.equal(result.nativeReady,false);assert.equal(result.firstIngestionVerified,false);
  assert.equal(result.operationalComplete,false);assert.equal(document.sourceVersion,null);assert.equal(document.revision,1);
  assert.equal(document.workflowState,'PENDING_HUMAN_REVIEW');assert.equal(document.nativeReady,false);
  assert.equal(document.sourceIndependent,false);assert.equal(document.canonicalSnapshotHash,null);
  assert.equal(document.amountCents,null);assert.equal(document.count,null);assert.equal(document.competence,null);
  assert.equal(document.documentObservation.acquisitionHash,observationAcquisitionHash(payload.acquisition));
  assert.equal(document.source.acquisitionAuthority,'AUTHENTICATED_CLIENT_OBSERVATION_NOT_CONTENT_VERIFICATION');
  const version=f.state.get(`${base}/entityVersions/${result.versionId}`),receipt=f.state.get(`${base}/apiIdempotency/${result.receiptId}`);
  assert.equal(version.afterHash,persistedDocumentHash(null,document));assert.equal(version.afterHash,persistedDocumentHash(null,version.snapshot));
  assert.equal(receipt.observationHash,result.observationHash);assert.equal(receipt.sourceVersion,null);
  assert.equal(f.writes.filter(w=>w.path.includes('/auditEvents/')).length,1);
  assert.equal(f.writes.length,4);assert.ok([...f.reads,...f.writes.map(w=>w.path)].every(p=>p===base||p.startsWith(base+'/')));
  const persisted=JSON.stringify(f.writes);assert.doesNotMatch(persisted,/synthetic-document-1|synthetic content|tokenHash|FIRST_INGESTION_VERIFIED|installationAcceptance/);
  assert.equal(f.writes.some(w=>w.path.includes('/runtimeCheckpoints/')),false);
});
test('same request replay and a new-time rescan keep one document revision and immutable version',async()=>{
  const f=fixture(),payload=observation(),first=await f.run(payload),snapshot=clone(f.state.get(f.path));
  const repeated=await f.run(payload);assert.equal(repeated.kind,'DUPLICATE');assert.equal(repeated.revision,1);
  assert.equal(f.state.get(`${base}/apiIdempotency/${first.receiptId}`).replayCount,1);
  const rescanned=await f.run({...payload,observedAt:now.toISOString()},'synthetic-observation-new-capture');
  assert.equal(rescanned.kind,'DUPLICATE');assert.equal(rescanned.versionId,first.versionId);assert.equal(rescanned.observationHash,first.observationHash);
  assert.deepEqual(f.state.get(f.path),snapshot);
  assert.equal([...f.state.keys()].filter(p=>p.includes('/entityVersions/')).length,1);
  assert.equal([...f.state.keys()].filter(p=>p.includes('/sourceDocuments/')).length,1);
  assert.equal([...f.state.keys()].filter(p=>p.includes('/auditEvents/')).length,1);
});
test('CAS owns observation revisions and new opaque versions cannot silently replace a concurrent update',async()=>{
  const f=fixture(),first=await f.run(),next=observation();next.acquisition.observedVersion='r2';
  await assert.rejects(f.run(next,'synthetic-cas-stale-request'),/OBSERVATION_CAS_CONFLICT/);
  next.expectedRevision=1;next.expectedPreviousObservationHash=sha('incorrect');
  await assert.rejects(f.run(next,'synthetic-cas-wrong-hash'),/OBSERVATION_CAS_CONFLICT/);
  next.expectedPreviousObservationHash=first.observationHash;
  const second=await f.run(next,'synthetic-cas-correct-request');assert.equal(second.revision,2);
  assert.equal(f.state.get(f.path).documentObservation.previousObservationHash,first.observationHash);
  const concurrent=clone(next);concurrent.acquisition.observedVersion='r3';
  await assert.rejects(f.run(concurrent,'synthetic-cas-concurrent-request'),/OBSERVATION_CAS_CONFLICT/);
  await assert.rejects(f.run(observation()),/OBSERVATION_SUPERSEDED/);
  assert.equal([...f.state.keys()].filter(p=>p.includes('/entityVersions/')).length,2);
});
test('same source version with different evidence and source identity changes fail closed',async()=>{
  for(const mutate of [(v:any)=>{v.extraction.textSha256=sha('changed');},(v:any)=>{v.acquisition.byteSha256=sha('changed');},
    (v:any)=>{v.acquisition.sourceObjectIdHash=sha('other-object');v.acquisition.observedVersion='r2';},
    (v:any)=>{v.acquisition.provider='API_TOKEN';v.acquisition.observedVersion='r2';}]) {
    const f=fixture(),first=await f.run(),changed=observation();changed.expectedRevision=1;changed.expectedPreviousObservationHash=first.observationHash;
    mutate(changed);await assert.rejects(f.run(changed,'synthetic-acquisition-conflict'),/SOURCE_ACQUISITION_CONFLICT/);
    assert.equal(f.writes.length,4);
  }
  const f=fixture(),payload=observation();Object.assign(payload.acquisition,{provider:'GOOGLE_DRIVE',versionKind:'PROVIDER_REVISION',observedVersion:'7'});
  const first=await f.run(payload),regressed=clone(payload);regressed.expectedRevision=1;regressed.expectedPreviousObservationHash=first.observationHash;
  regressed.acquisition.observedVersion='6';await assert.rejects(f.run(regressed,'synthetic-drive-regression'),/SOURCE_ACQUISITION_REGRESSION/);
});
test('replacing an existing factual document clears amounts/counts/competence instead of recursive merge',async()=>{
  const f=fixture(),identity=documentObservationIdentity(org,observation());
  const old={orgId:org,entityType:'sourceDocument',entityKey:identity.entityKey,revision:9,sourceVersion:42,
    amountCents:123456,count:17,competence:'2026-09',nativeReady:true,sourceIndependent:true,
    source:{system:'ERP',acquisition:{privateOldValue:'must disappear'}},oldUnrelatedFact:'must disappear',createdAt:'2026-10-01T00:00:00Z'};
  f.state.set(f.path,old);
  const previousId=immutableEntityVersionId('sourceDocument',identity.entityKey,9);
  f.state.set(`${base}/entityVersions/${previousId}`,{orgId:org,entityType:'sourceDocument',entityId:identity.id,
    entityKey:identity.entityKey,revision:9,sourceVersion:42,snapshot:stableValue(old),afterHash:persistedDocumentHash(null,old)});
  const payload=observation();payload.expectedRevision=9;
  const next=await f.run(payload),current=f.state.get(f.path);
  assert.equal(next.revision,10);assert.equal(current.sourceVersion,null);assert.equal(current.amountCents,null);
  assert.equal(current.count,null);assert.equal(current.competence,null);assert.equal(current.oldUnrelatedFact,undefined);
  assert.equal(current.source.acquisition,undefined);assert.equal(current.createdAt,old.createdAt);
  assert.equal(f.state.get(`${base}/entityVersions/${previousId}`).snapshot.amountCents,123456);
});
test('all extraction statuses remain pending canonical review and cannot qualify as installed processing',async()=>{
  for(const status of ['COMPLETE','PARTIAL','PENDING','FAILED']) {
    const f=fixture(),payload:any=observation();
    if(status==='PARTIAL'){payload.extraction.status=status;payload.extraction.code='BOUNDED_EXTRACTION_PARTIAL';payload.extraction.coverage.totalUnits=2;}
    if(status==='PENDING'||status==='FAILED'){Object.assign(payload.extraction,{status,method:null,textSha256:null,textByteLength:0,
      code:status==='PENDING'?'EXTRACTION_REQUIRED':'EMPTY_CONTENT'});payload.extraction.coverage.processedUnits=0;}
    const result=await f.run(payload),document=f.state.get(f.path),version=f.state.get(`${base}/entityVersions/${result.versionId}`);
    const readback=installationReadiness(org,{orgId:org,state:'HEALTHY',lastDocumentId:result.documentId},document,null,version);
    assert.equal(readback.firstIngestionVerified,false,status);assert.equal(readback.operationalComplete,false,status);
    const acceptance=await readInstallationAcceptance(org,result,document,version,null,async path=>f.state.get(path)??null,now);
    assert.equal(acceptance.eligible,false,status);assert.equal(acceptance.state,'PENDING_PROCESSING',status);
    const hypotheticalFacts=parseIntegrationDocumentPayload({sourceSystem:'ERP',externalDocumentId:payload.externalDocumentId,sourceVersion:99,
      occurredAt:now.toISOString(),documentType:'OTHER',competence:null,amountCents:null,count:null,workflowState:'VALIDATED',slaDueAt:null,
      documentFragility:'NONE',missingFieldsCount:0,nativeReady:true,sourceIndependent:true})!;
    assert.equal(integrationDocumentVersionDecision(document,hypotheticalFacts,sha('hypothetical'),sha('body'),null),'DOCUMENT_OBSERVATION_PENDING_REVIEW');
  }
});
test('authorization is re-read in transaction and rejected before writes on revocation or tenant mismatch',async()=>{
  for(const mutate of [(f:any)=>{f.state.get(base).active=false;},
    (f:any)=>{f.state.get(`${base}/integrationCredentials/${keyId}`).active=false;},
    (f:any)=>{f.state.get(`${base}/integrationCredentials/${keyId}`).scopes=['integration.read'];},
    (f:any)=>{f.state.get(`${base}/integrationCredentials/${keyId}`).orgId='other-org';},
    (f:any)=>{f.state.get(`${base}/integrationCredentials/${keyId}`).expiresAt={toDate:()=>new Date('2000-01-01')};}]) {
    const f=fixture();mutate(f);await assert.rejects(f.run(),/ORGANIZATION_DISABLED|INVALID_INTEGRATION_KEY/);assert.equal(f.writes.length,0);
  }
  const f=fixture(true);await f.run();f.state.get(`${base}/members/${f.member.uid}`).active=false;
  await assert.rejects(f.run(),/MEMBERSHIP_REVOKED/);assert.equal(f.writes.length,4);
  const other=fixture(true);await assert.rejects(other.run(observation(),'synthetic-context-invalid',
    {...other.who,member:{...other.member,mfaVerified:false}}),/MEMBERSHIP_REVOKED/);assert.equal(other.writes.length,0);
});
test('idempotency conflicts, corrupt current evidence and immutable version mismatch never overwrite history',async()=>{
  const f=fixture(),first=await f.run(),changed=observation();changed.observedAt=now.toISOString();
  await assert.rejects(f.run(changed),/IDEMPOTENCY_CONFLICT/);assert.equal(f.writes.length,4);
  f.state.get(`${base}/entityVersions/${first.versionId}`).afterHash=sha('corrupt');
  await assert.rejects(f.run(),/OBSERVATION_BINDING_CONFLICT/);assert.equal(f.writes.length,4);
  const g=fixture();await g.run();g.state.get(g.path).documentObservation.acquisition.byteSha256=sha('corrupt');
  await assert.rejects(g.run(),/OBSERVATION_BINDING_CONFLICT/);assert.equal(g.writes.length,4);
});
test('current credential issuer and optional configurer remain authorized on first write and replay without requiring automation enabled',async()=>{
  for(const replay of [false,true])for(const type of ['issuer','issuer-role','configurer','missing-issuer']) {
    const f=fixture(),credential=f.state.get(`${base}/integrationCredentials/${keyId}`);
    if(replay)await f.run();const before=f.writes.length;
    if(type==='issuer')f.state.get(`${base}/members/${f.member.uid}`).active=false;
    if(type==='issuer-role')f.state.get(`${base}/members/${f.member.uid}`).role='viewer';
    if(type==='missing-issuer')delete credential.createdBy;
    if(type==='configurer'){credential.automation={configuredBy:'revoked-configurer',enabled:false};
      f.state.set(`${base}/members/revoked-configurer`,{active:false,allFacilities:true,role:'org_admin'});}
    await assert.rejects(f.run(),/CREDENTIAL_AUTHORITY_INACTIVE/);assert.equal(f.writes.length,before);
  }
  const f=fixture();f.state.get(`${base}/integrationCredentials/${keyId}`).automation={configuredBy:f.member.uid,enabled:false};
  assert.equal((await f.run()).kind,'RECORDED');
});
test('interruption before commit resumes the exact original operation without partial receipts',async()=>{
  const f=fixture();await assert.rejects(f.run(observation(),'synthetic-crash-before-commit',f.who,true),/SYNTHETIC_CRASH_BEFORE_COMMIT/);
  assert.equal(f.writes.length,0);assert.equal(f.state.has(f.path),false);
  const resumed=await f.run(observation(),'synthetic-crash-before-commit');assert.equal(resumed.kind,'RECORDED');assert.equal(resumed.revision,1);
});
test('runtime routes observations only after common authentication and keeps legacy receipts behind the observation guard',()=>{
  const runtime=fs.readFileSync('src/auroraIntegrationRuntime.ts','utf8');
  const endpoint=runtime.slice(runtime.indexOf('export const auroraNexusIntegrationDocuments'));
  assert.ok(endpoint.indexOf('authorizeDocumentIngestion')<endpoint.indexOf('recordDocumentObservation'));
  assert.ok(endpoint.indexOf('NATIVE_INGESTION_MAX_BYTES')<endpoint.indexOf('recordDocumentObservation'));
  assert.ok(endpoint.indexOf('documentObservationBlocksFacts(currentSnap.data() ?? null)')<endpoint.indexOf('if (idemSnap.exists)'));
  const branch=endpoint.slice(endpoint.indexOf('req.body?.operation===DOCUMENT_OBSERVATION_OPERATION'),endpoint.indexOf('const payload=parseIntegrationDocumentPayload'));
  assert.doesNotMatch(branch,/loadInstallationReadiness|installationAcceptance|integrationReplayPatch/);
  assert.match(branch,/tx\.set\(auroraDb\.doc\(path\),data\)/);assert.match(branch,/accepted:false/);
});
