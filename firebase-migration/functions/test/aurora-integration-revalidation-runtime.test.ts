import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FieldValue,Timestamp} from 'firebase-admin/firestore';
import {auroraDb} from '../src/firebase.ts';
import {auroraNexusIntegrationDocuments,auroraNexusIntegrationPing} from '../src/auroraIntegrationRuntime.ts';
import {issueIntegrationCredential} from '../src/auroraIntegrationCredential.ts';
import {canonicalIntegrationDocument,parseIntegrationDocumentPayload} from '../src/auroraIntegrationDocument.ts';
import {immutableEntityVersionId,persistedDocumentHash,stableValue} from '../src/auroraCanonicalVersions.ts';
import {configureCanonicalAutomation} from '../src/auroraInstallationAcceptance.ts';

// Runs the real HTTP handlers against an isolated transaction fixture. Every DB
// entry point they can reach is replaced; no credential or cloud service is used.
async function fixture(t:any){
  const db:any=auroraDb,org='synthetic',base=`organizations/${org}`,oldKey='ik_'+'1'.repeat(16);
  const issued=issueIntegrationCredential(['integration.read','documents.ingest'],1),keyId=issued.keyId;
  const idemKey='synthetic-revalidation-key',receiptId=createHash('sha256').update(`integration-document:${keyId}:${idemKey}`).digest('hex');
  const originalReceiptId='4'.repeat(64),stamp=Timestamp.fromDate(new Date(Date.now()-1000));
  const payload=parseIntegrationDocumentPayload({sourceSystem:'ERP',externalDocumentId:'synthetic-revalidation-document',sourceVersion:1,
    occurredAt:'2026-10-14T10:00:00Z',documentType:'PRODUCTION',competence:'2026-10',amountCents:null,count:1,
    workflowState:'VALIDATED',slaDueAt:null,documentFragility:'NONE',missingFieldsCount:0,nativeReady:true,sourceIndependent:true})!;
  const canonical=canonicalIntegrationDocument(org,payload),documentId=canonical.id;
  const bodyHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const entityKey=`ERP:${canonical.sourceIdHash.slice(0,32)}`,versionId=immutableEntityVersionId('sourceDocument',entityKey,1);
  const document:any={...canonical.facts,orgId:org,schemaVersion:1,entityType:'sourceDocument',entityKey,revision:1,
    sourceVersion:1,occurredAt:Timestamp.fromDate(new Date(payload.occurredAt)),competence:'2026-10',documentType:'PRODUCTION',
    workflowState:'VALIDATED',reviewState:'NOT_REQUIRED',riskLevel:'LOW',sensitivity:'RESTRICTED',
    canonicalSnapshotHash:canonical.canonicalSnapshotHash,source:{system:'ERP'},
    integration:{keyId:oldKey,connector:'synthetic-original',transport:'AURORA_INTEGRATION_API',payloadHash:bodyHash}};
  const version={orgId:org,schemaVersion:1,entityType:'sourceDocument',entityId:documentId,entityKey,revision:1,
    sourceVersion:1,idempotencyId:originalReceiptId,actor:{keyId:oldKey},snapshot:stableValue(document),afterHash:persistedDocumentHash(null,document)};
  const original={schemaVersion:'aurora.ingestion.receipt.v1',orgId:org,keyId:oldKey,bodyHash,documentId,versionId,
    sourceVersion:1,revision:1,canonicalSnapshotHash:canonical.canonicalSnapshotHash,acceptedAt:stamp,replayCount:1,lastReplayAt:stamp};
  const credential:any={orgId:org,keyId,name:'synthetic-renewed',tokenHash:issued.tokenHash,scopes:issued.scopes,active:true,
    expiresAt:Timestamp.fromDate(issued.expiresAt),createdBy:'synthetic-admin'};
  const member:any={active:true,role:'org_admin',allFacilities:true,permissions:[]};
  const state=new Map<string,any>([[base,{active:true,projectionEnabled:true,projectionMode:'SHADOW'}],
    [`${base}/sourceDocuments/${documentId}`,document],[`${base}/entityVersions/${versionId}`,version],
    [`${base}/apiIdempotency/${originalReceiptId}`,original],[`${base}/integrationCredentials/${keyId}`,credential],
    [`${base}/integrationCredentials/${oldKey}`,{...credential,keyId:oldKey,expiresAt:Timestamp.fromDate(new Date('2000-01-01'))}],
    [`${base}/members/synthetic-admin`,member],
    [`${base}/runtimeCheckpoints/integration-documents`,{orgId:org,state:'HEALTHY',lastDocumentId:documentId,acceptedCount:18}],
    [`${base}/dashboardSnapshots/current`,{orgId:org,competence:'2026-10',state:'SHADOW',dataQuality:{complete:true,sourcePresent:true},
      generatedAt:stamp,integrationReadback:[{documentId,versionId,revision:1,sourceVersion:1,canonicalSnapshotHash:canonical.canonicalSnapshotHash}]}]]);
  const read=async(path:string)=>state.get(path)??null;
  await configureCanonicalAutomation({orgId:org,uid:'synthetic-admin',email:'synthetic@example.test',role:'org_admin',
    allFacilities:true,facilityIds:[],permissions:[],mfaVerified:true},{action:'CONFIGURE_AUTOMATION',method:'API_TOKEN',keyId,
    sourceSystem:'ERP',enabled:true,expectedRevision:0},{read,merge:(path,data)=>Object.assign(state.get(path),data),
    create:(path,data)=>{assert.equal(state.has(path),false);state.set(path,data);},timestamp:stamp});
  const reads:string[]=[],writes:{path:string;data:any;merge:boolean}[]=[];
  const snapshot=(path:string)=>({readTime:Timestamp.now(),exists:state.has(path),id:path.split('/').pop(),data:()=>state.get(path)});
  const materialize=(value:any):any=>{
    if(value instanceof FieldValue){assert.ok(value.isEqual(FieldValue.serverTimestamp()),'revalidation must never increment ingest counters');return stamp;}
    if(value instanceof Timestamp)return value;
    if(Array.isArray(value))return value.map(materialize);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,materialize(v)]));
    return value;
  };
  t.mock.method(db,'doc',(path:string)=>({path,id:path.split('/').pop(),get:async()=>{reads.push(path);return snapshot(path);}}));
  t.mock.method(db,'collection',()=>{throw Error('REVALIDATION_MUST_NOT_REFRESH_PROJECTION');});
  t.mock.method(db,'collectionGroup',()=>({where:()=>({limit:()=>({get:async()=>({size:1,docs:[{data:()=>({...credential})}]})})})}));
  let beforeTransaction:(()=>void)|null=null;
  t.mock.method(db,'runTransaction',async(callback:any)=>{
    if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;hook();}
    const pending:{path:string;data:any;merge:boolean;create:boolean}[]=[];
    const result=await callback({get:async(ref:any)=>{assert.equal(pending.length,0,'all reads must precede writes');reads.push(ref.path);return snapshot(ref.path);},
      create:(ref:any,data:any)=>pending.push({path:ref.path,data,merge:false,create:true}),
      set:(ref:any,data:any,opt?:any)=>pending.push({path:ref.path,data,merge:opt?.merge===true,create:false})});
    for(const write of pending){if(write.create)assert.equal(state.has(write.path),false);
      const data=materialize(write.data);state.set(write.path,write.merge?{...state.get(write.path),...data}:data);
      if(!write.path.includes("/runtimeLocks/")) writes.push({path:write.path,data,merge:write.merge});}
    return result;
  });
  const call=async(method='POST',query:any={},body:any=payload)=>{
    let status=0,result:any;const headers:any={'content-type':'application/json',authorization:`Bearer ${issued.apiKey}`,'idempotency-key':idemKey};
    const req:any={method,path:method==='GET'?'/api/integration/ping':'/api/integration/documents',query,body,get:(name:string)=>headers[name]};
    const res:any={on(){return this;},set(){return this;},status(value:number){status=value;return this;},json(value:any){result=value;return this;}};
    await (method==='GET'?auroraNexusIntegrationPing:auroraNexusIntegrationDocuments as any)(req,res);return {status,result};
  };
  return {org,base,state,reads,writes,credential,member,documentId,versionId,receiptId,originalReceiptId,bodyHash,keyId,payload,call,
    revokeDuringAuthorization:(fn:()=>void)=>{beforeTransaction=fn;}};
}

test('HTTP POST rebinds only the receipt, second POST proves replay, selected GET retains authenticated key',async(t)=>{
  const f=await fixture(t),before=new Map([...f.state].map(([path,data])=>[path,JSON.stringify(data)]));
  const empty=await f.call('GET',{documentId:f.documentId,receiptId:f.receiptId});
  assert.equal(empty.result.installation.acceptance.eligible,false);assert.equal(f.writes.length,0);
  const first=await f.call();assert.equal(first.status,200);assert.equal(first.result.receiptId,f.receiptId);
  assert.equal(first.result.duplicate,true);assert.equal(first.result.installation.acceptance.receiptId,f.receiptId);
  assert.equal(first.result.installation.acceptance.state,'PENDING_REPLAY');
  const replay=await f.call();assert.equal(replay.status,200);assert.equal(replay.result.installation.acceptance.eligible,true);
  assert.equal(replay.result.installation.versionId,f.versionId);assert.equal(replay.result.installation.acceptance.receiptId,f.receiptId);
  assert.equal(f.writes.length,2);assert.ok(f.writes.every(row=>row.path===`${f.base}/apiIdempotency/${f.receiptId}`));
  for(const [path,bytes] of before)assert.equal(JSON.stringify(f.state.get(path)),bytes,path);
  assert.equal(f.state.get(`${f.base}/apiIdempotency/${f.receiptId}`).replayCount,1);
  const selected=await f.call('GET',{documentId:f.documentId,receiptId:f.receiptId,keyId:'ik_'+'9'.repeat(16)});
  assert.equal(selected.result.keyId,f.keyId);assert.equal(selected.result.installation.acceptance.eligible,true);
  const legacy=await f.call('GET',{documentId:f.documentId});assert.equal(legacy.result.installation.acceptance.eligible,false);
  assert.equal(legacy.result.installation.acceptance.receiptId,f.originalReceiptId);
  const wrongOriginal=await f.call('GET',{documentId:f.documentId,receiptId:f.originalReceiptId});
  assert.equal(wrongOriginal.result.installation.acceptance.receiptPersisted,false);
  const other=await f.call('GET',{documentId:'9'.repeat(48),receiptId:f.receiptId});
  assert.equal(other.result.installation.acceptance.eligible,false);assert.equal(f.writes.length,2);
});

test('HTTP GET never upgrades legacy minimal receipt; validated POST plus replay can do so',async(t)=>{
  const f=await fixture(t),path=`${f.base}/apiIdempotency/${f.receiptId}`;
  f.state.set(path,{bodyHash:f.bodyHash,documentId:f.documentId,keyId:f.keyId,createdAt:Timestamp.now()});
  const before=JSON.stringify(f.state.get(path));const get=await f.call('GET',{documentId:f.documentId,receiptId:f.receiptId});
  assert.equal(get.result.installation.acceptance.eligible,false);assert.equal(JSON.stringify(f.state.get(path)),before);
  assert.equal(f.writes.length,0);const upgraded=await f.call();assert.equal(upgraded.status,200);
  assert.equal(upgraded.result.installation.acceptance.state,'PENDING_REPLAY');assert.equal(f.state.get(path).replayCount,0);
  assert.equal((await f.call()).result.installation.acceptance.eligible,true);
});

for(const stage of ['create','replay']) for(const field of ['revoked','expired','read-only','issuer','automation','tenant'])
test(`HTTP authority change after bearer authentication blocks revalidation ${stage}: ${field}`,async(t)=>{
  const f=await fixture(t);
  if(stage==='replay')assert.equal((await f.call()).result.installation.acceptance.state,'PENDING_REPLAY');
  const before=f.writes.length;
  f.revokeDuringAuthorization(()=>{
    if(field==='revoked')f.credential.active=false;
    if(field==='expired')f.credential.expiresAt=Timestamp.fromDate(new Date('2000-01-01'));
    if(field==='read-only')f.credential.scopes=['integration.read'];
    if(field==='issuer')f.member.active=false;
    if(field==='automation')f.credential.automation.enabled=false;
    if(field==='tenant')f.credential.orgId='other-org';
  });
  const result=await f.call();assert.equal(result.status,412);assert.equal(result.result.ok,false);
  assert.equal(f.writes.length,before);assert.equal(f.state.has(`${f.base}/apiIdempotency/${f.receiptId}`),stage==='replay');
  if(stage==='replay')assert.equal(f.state.get(`${f.base}/apiIdempotency/${f.receiptId}`).replayCount,0);
});

test('HTTP selector validation and altered payload fail without writing a receipt',async(t)=>{
  const f=await fixture(t);
  for(const query of [{receiptId:f.receiptId},{documentId:f.documentId,receiptId:'../other'},
    {documentId:f.documentId,receiptId:[f.receiptId]},{documentId:'../other',receiptId:f.receiptId}]){
    assert.equal((await f.call('GET',query)).status,400);
  }
  const conflict=await f.call('POST',{}, {...f.payload,count:2});
  assert.equal(conflict.status,409);assert.equal(conflict.result.code,'SOURCE_VERSION_CONFLICT');assert.equal(f.writes.length,0);
});
