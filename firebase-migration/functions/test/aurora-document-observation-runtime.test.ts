import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FieldValue,Timestamp} from 'firebase-admin/firestore';
import {auroraDb} from '../src/firebase.ts';
import {auroraNexusIntegrationDocuments,auroraNexusIntegrationPing} from '../src/auroraIntegrationRuntime.ts';
import {issueIntegrationCredential} from '../src/auroraIntegrationCredential.ts';
import {DOCUMENT_OBSERVATION_SCHEMA,documentObservationIdentity} from '../src/auroraDocumentObservation.ts';
import {parseIntegrationDocumentPayload} from '../src/auroraIntegrationDocument.ts';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function observation():any {
  return {schemaVersion:DOCUMENT_OBSERVATION_SCHEMA,operation:'OBSERVE_DOCUMENT_EXTRACTION',sourceSystem:'ERP',
    externalDocumentId:'synthetic-http-document',observedAt:'2026-10-20T11:00:00.000Z',expectedRevision:0,expectedPreviousObservationHash:null,
    acquisition:{provider:'API_TOKEN',sourceObjectIdHash:sha('synthetic-http-source'),versionKind:'CLIENT_REVISION',observedVersion:'r1',
      representation:'ORIGINAL_BYTES',sourceMimeType:'text/plain',acquiredMimeType:'text/plain',byteSha256:sha('synthetic document'),byteLength:18},
    extraction:{status:'COMPLETE',method:'TEXT_UTF8',methodVersion:'1.0.0',textSha256:sha('synthetic document'),textByteLength:18,
      coverage:{basis:'EXPECTED_PARTS',totalUnits:1,processedUnits:1},code:'CONTENT_EXTRACTED'}};
}
// Every Firestore entry point reached by the actual handlers is replaced.
// Generated credentials and documents are synthetic; no network service is used.
function fixture(t:any) {
  const db:any=auroraDb,org='synthetic',base=`organizations/${org}`,issued=issueIntegrationCredential(['documents.ingest','integration.read'],1);
  const keyId=issued.keyId,stamp=Timestamp.fromMillis(Date.now()),payload=observation();
  const credential:any={orgId:org,keyId,name:'synthetic-http-observation',tokenHash:issued.tokenHash,scopes:issued.scopes,
    active:true,expiresAt:Timestamp.fromDate(issued.expiresAt),createdBy:'synthetic-admin'};
  const state=new Map<string,any>([[base,{active:true,projectionEnabled:false,projectionMode:'SHADOW',projectionCompetence:'2026-10'}],
    [`${base}/integrationCredentials/${keyId}`,credential],
    [`${base}/members/synthetic-admin`,{active:true,role:'org_admin',allFacilities:true,permissions:[]}]]);
  const writes:{path:string;data:any;merge:boolean}[]=[],reads:string[]=[];
  const snapshot=(path:string)=>({exists:state.has(path),id:path.split('/').pop(),data:()=>state.get(path)});
  const materialize=(value:any):any=>{
    if(value instanceof FieldValue){assert.ok(value.isEqual(FieldValue.serverTimestamp()),'observations cannot increment factual ingestion');return stamp;}
    if(value instanceof Timestamp)return value;
    if(Array.isArray(value))return value.map(materialize);
    return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,materialize(v)])):value;
  };
  t.mock.method(db,'doc',(path:string)=>({path,id:path.split('/').pop(),get:async()=>{reads.push(path);return snapshot(path);}}));
  t.mock.method(db,'collection',()=>{throw Error('SYNTHETIC_COLLECTION_NETWORK_REJECTED');});
  t.mock.method(db,'collectionGroup',()=>({where:()=>({limit:()=>({get:async()=>({size:1,docs:[{data:()=>({...credential})}]})})})}));
  let hook:(()=>void)|null=null;
  t.mock.method(db,'runTransaction',async(callback:any)=>{
    if(hook){const before=hook;hook=null;before();}
    const pending:{path:string;data:any;merge:boolean;create:boolean}[]=[];
    const result=await callback({get:async(ref:any)=>{assert.equal(pending.length,0);reads.push(ref.path);return snapshot(ref.path);},
      create:(ref:any,data:any)=>pending.push({path:ref.path,data,merge:false,create:true}),
      set:(ref:any,data:any,opt?:any)=>pending.push({path:ref.path,data,merge:opt?.merge===true,create:false})});
    for(const write of pending){if(write.create)assert.equal(state.has(write.path),false);
      const data=materialize(write.data);state.set(write.path,write.merge?{...state.get(write.path),...data}:data);
      writes.push({path:write.path,data,merge:write.merge});}
    return result;
  });
  const call=async(body:any=payload,idempotency='synthetic-http-observation-key',override:any={},method='POST',query:any={})=>{
    let status=0,result:any;
    const headers:any={'content-type':'application/json',authorization:`Bearer ${issued.apiKey}`,'idempotency-key':idempotency,...override};
    const req:any={method,body,query,path:method==='GET'?'/api/integration/ping':'/api/integration/documents',get:(name:string)=>headers[name]};
    const res:any={on(){return this;},set(){return this;},status(v:number){status=v;return this;},json(v:any){result=v;return this;}};
    await (method==='GET'?auroraNexusIntegrationPing:auroraNexusIntegrationDocuments as any)(req,res);return {status,result};
  };
  return {org,base,payload,keyId,state,writes,reads,credential,call,
    beforeTransaction:(fn:()=>void)=>{hook=fn;},documentId:documentObservationIdentity(org,payload).id};
}
test('HTTP observation records only pending evidence and exact replay has a separate receipt without installation acceptance',async t=>{
  const f=fixture(t),first=await f.call();assert.equal(first.status,202);assert.equal(first.result.recorded,true);
  assert.equal(first.result.accepted,false);assert.equal(first.result.firstIngestionVerified,false);
  assert.equal(first.result.operationalComplete,false);assert.equal(first.result.sourceVersion,null);
  assert.equal(Object.hasOwn(first.result,'installation'),false);assert.equal(Object.hasOwn(first.result,'acceptance'),false);
  const document=f.state.get(`${f.base}/sourceDocuments/${f.documentId}`);assert.equal(document.nativeReady,false);
  assert.equal(document.documentObservation.observationHash,first.result.observationHash);
  const versionPaths=[...f.state.keys()].filter(p=>p.includes('/entityVersions/'));assert.equal(versionPaths.length,1);
  assert.equal(f.writes.length,4);assert.ok(f.writes.every(w=>!w.merge));
  const replay=await f.call();assert.equal(replay.status,200);assert.equal(replay.result.duplicate,true);
  assert.equal(replay.result.observationHash,first.result.observationHash);assert.equal(replay.result.revision,1);
  assert.equal(f.state.get(`${f.base}/apiIdempotency/${first.result.receiptId}`).replayCount,1);
  assert.equal(f.writes.length,5);assert.equal([...f.state.keys()].filter(p=>p.includes('/entityVersions/')).length,1);
  const readback=await f.call(null,'unused',{},'GET',{documentId:f.documentId});
  assert.equal(readback.status,200);assert.equal(readback.result.installation.firstIngestionVerified,false);
  assert.equal(readback.result.installation.acceptance.eligible,false);
  assert.ok([...f.reads,...f.writes.map(w=>w.path)].every(p=>p===f.base||p.startsWith(f.base+'/')));
});
test('HTTP rescan changes capture time without creating another revision, then stale CAS and same-version changes conflict',async t=>{
  const f=fixture(t),first=await f.call();
  const rescan=await f.call({...f.payload,observedAt:'2026-10-20T11:01:00.000Z'},'synthetic-http-new-capture');
  assert.equal(rescan.status,200);assert.equal(rescan.result.versionId,first.result.versionId);assert.equal(rescan.result.duplicate,true);
  const before=f.writes.length;
  const changed={...f.payload,acquisition:{...f.payload.acquisition,observedVersion:'r2'}};
  const stale=await f.call(changed,'synthetic-http-stale-cas');assert.equal(stale.status,409);assert.equal(stale.result.code,'OBSERVATION_CAS_CONFLICT');
  const conflict=await f.call({...f.payload,expectedRevision:1,expectedPreviousObservationHash:first.result.observationHash,
    extraction:{...f.payload.extraction,textSha256:sha('changed')}},'synthetic-http-same-source-conflict');
  assert.equal(conflict.status,409);assert.equal(conflict.result.code,'SOURCE_ACQUISITION_CONFLICT');assert.equal(f.writes.length,before);
});
test('HTTP observation rejects invalid schema, raw text, oversized envelope and invalid bearer without a session fallback',async t=>{
  const f=fixture(t);
  assert.equal((await f.call({...f.payload,text:'synthetic forbidden document text'})).status,400);
  assert.equal((await f.call({...f.payload,schemaVersion:'unknown'})).status,400);
  assert.equal((await f.call({...f.payload,rawBytes:'x'.repeat(131072)})).status,413);
  assert.equal((await f.call(f.payload,'synthetic-invalid-bearer',{authorization:'Bearer invalid',cookie:'synthetic-unused-session'})).status,401);
  assert.equal((await f.call(f.payload,'short')).status,400);
  assert.equal(f.writes.length,0);
});
test('HTTP authority revoked after initial authentication cannot create an observation receipt',async t=>{
  const f=fixture(t);f.beforeTransaction(()=>{f.credential.active=false;});
  const response=await f.call();assert.equal(response.status,412);assert.equal(response.result.code,'INVALID_INTEGRATION_KEY');assert.equal(f.writes.length,0);
});
test('HTTP current issuer revoked after initial authentication cannot replay an observation receipt',async t=>{
  const f=fixture(t);assert.equal((await f.call()).status,202);const before=f.writes.length;
  f.beforeTransaction(()=>{f.state.get(`${f.base}/members/synthetic-admin`).active=false;});
  const response=await f.call();assert.equal(response.status,412);assert.equal(response.result.code,'CREDENTIAL_AUTHORITY_INACTIVE');
  assert.equal(f.writes.length,before);
});
test('HTTP v1 higher sourceVersion and historical idempotent receipt cannot overwrite pending observation',async t=>{
  const f=fixture(t),first=await f.call(),oldFacts=parseIntegrationDocumentPayload({sourceSystem:'ERP',externalDocumentId:f.payload.externalDocumentId,
    sourceVersion:99,occurredAt:'2026-10-20T11:00:00Z',documentType:'FINANCIAL',competence:'2026-10',amountCents:123456,count:null,
    workflowState:'VALIDATED',slaDueAt:null,documentFragility:'NONE',missingFieldsCount:0,nativeReady:true,sourceIndependent:true})!;
  const oldKey='synthetic-http-legacy-facts',oldReceipt=sha(`integration-document:${f.keyId}:${oldKey}`);
  f.state.set(`${f.base}/apiIdempotency/${oldReceipt}`,{bodyHash:sha(JSON.stringify(oldFacts)),documentId:f.documentId,keyId:f.keyId});
  const before=JSON.stringify(f.state.get(`${f.base}/sourceDocuments/${f.documentId}`)),count=f.writes.length;
  for(const idem of [oldKey,'synthetic-http-new-facts']) {
    const response=await f.call(oldFacts,idem);assert.equal(response.status,409);
    assert.equal(response.result.code,'DOCUMENT_OBSERVATION_PENDING_REVIEW');
  }
  assert.equal(f.writes.length,count);assert.equal(JSON.stringify(f.state.get(`${f.base}/sourceDocuments/${f.documentId}`)),before);
  assert.equal(f.state.get(`${f.base}/sourceDocuments/${f.documentId}`).documentObservation.observationHash,first.result.observationHash);
});
