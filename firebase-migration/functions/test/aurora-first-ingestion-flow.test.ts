import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldValue, Timestamp} from 'firebase-admin/firestore';
import {auroraDb} from '../src/firebase.ts';
import {auroraNexusIntegrationDocuments} from '../src/auroraIntegrationRuntime.ts';
import {issueIntegrationCredential} from '../src/auroraIntegrationCredential.ts';

// Exercise the real HTTP handler and native projection against an isolated transactional fixture.
// This is not a cloud/Xeon handoff or a production Firestore test.
test('committed ingest resumes projection with the same key and one source effect',async(t)=>{
 const db:any=auroraDb, org='synthetic', base=`organizations/${org}`;
 const credential=issueIntegrationCredential(['integration.read','documents.ingest'],1);
 const state=new Map<string,any>([[base,{active:true,projectionEnabled:true,projectionMode:'SHADOW',projectionCompetence:'2026-10'}]]);
 const creates=new Map<string,number>();
 const snapshot=(path:string)=>({id:path.split('/').pop(),exists:state.has(path),data:()=>state.get(path)});
 const stamp=Timestamp.fromDate(new Date('2026-10-08T05:00:00Z'));
 const materialize=(data:any):any=>{
  if(data instanceof FieldValue && data.isEqual(FieldValue.serverTimestamp()))return stamp;
  if(data instanceof FieldValue && data.isEqual(FieldValue.increment(1)))return 1;
  if(data instanceof Timestamp)return data;
  if(Array.isArray(data))return data.map(materialize);
  if(data&&typeof data==='object')return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,materialize(v)]));
  return data;
 };
 t.mock.method(db,'doc',(path:string)=>({path,id:path.split('/').pop(),get:async()=>snapshot(path)}));
 let interrupt=true;
 t.mock.method(db,'collection',(path:string)=>({limit:()=>({get:async()=>{
  if(interrupt){interrupt=false;throw Error('SYNTHETIC_INTERRUPTION_AFTER_COMMIT');}
  const docs=[...state.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')).map(snapshot);
  return {size:docs.length,docs};
 }})}));
 t.mock.method(db,'collectionGroup',()=>({where:()=>({limit:()=>({get:async()=>({size:1,docs:[{data:()=>({
  ...credential,orgId:org,name:'synthetic-source',active:true,expiresAt:Timestamp.fromDate(credential.expiresAt)
 })}]})})})}));
 let queue=Promise.resolve();
 t.mock.method(db,'runTransaction',(callback:any)=>{
  const job=queue.then(async()=>{
   const writes:any[]=[];
   const result=await callback({get:async(ref:any)=>snapshot(ref.path),
    create:(ref:any,data:any)=>writes.push({path:ref.path,data,create:true}),
    set:(ref:any,data:any)=>writes.push({path:ref.path,data,create:false})});
   for(const write of writes){if(write.create&&state.has(write.path))throw Error('ALREADY_EXISTS');}
   for(const write of writes){state.set(write.path,materialize(write.data));creates.set(write.path,(creates.get(write.path)||0)+1);}
   return result;
  });queue=job.then(()=>{},()=>{});return job;
 });
 const body={sourceSystem:'ERP',externalDocumentId:'synthetic-document',sourceVersion:1,
  occurredAt:'2026-10-08T04:00:00Z',documentType:'PRODUCTION',competence:'2026-10',amountCents:null,count:1,
  workflowState:'VALIDATED',slaDueAt:null,documentFragility:'NONE',missingFieldsCount:0,nativeReady:true,sourceIndependent:true};
 const call=async()=>{
  let result:any,status=0;
  const req:any={method:'POST',headers:{},body,get:(name:string)=>({'content-type':'application/json',authorization:`Bearer ${credential.apiKey}`,'idempotency-key':'synthetic-same-key-20261008'} as any)[name]};
  const res:any={on(){return this;},set(){return this;},status(value:number){status=value;return this;},json(value:any){result=value;return this;}};
  await (auroraNexusIntegrationDocuments as any)(req,res);return {status,result};
 };
 const first=await call();assert.equal(first.status,202);
 assert.equal(first.result.installation.firstIngestionVerified,false);
 const replay=await call();assert.equal(replay.status,200);assert.equal(replay.result.duplicate,true);
 assert.equal(replay.result.installation.firstIngestionVerified,true);
 const concurrent=await Promise.all([call(),call()]);
 assert.ok(concurrent.every(reply=>reply.result.installation.firstIngestionVerified));
 assert.equal(creates.get(`${base}/sourceDocuments/${first.result.documentId}`),1);
 assert.equal([...state.keys()].filter(path=>path.includes('/dashboardSnapshotHistory/')).length,1);
 assert.equal([...creates.entries()].filter(([path])=>path.includes('/dashboardSnapshotHistory/')).reduce((n,[,count])=>n+count,0),1);
 assert.equal([...state.keys()].filter(path=>path.includes('/apiIdempotency/')).length,1);
});
