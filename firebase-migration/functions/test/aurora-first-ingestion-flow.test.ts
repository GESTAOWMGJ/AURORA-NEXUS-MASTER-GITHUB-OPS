import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldValue, Timestamp} from 'firebase-admin/firestore';
import {auroraDb,auroraAuth} from '../src/firebase.ts';
import {csrfTokenForSession,CSRF_PURPOSES} from '../src/auroraAccess.ts';
import {auroraNexusIntegrationDocuments,auroraNexusIntegrationKeys} from '../src/auroraIntegrationRuntime.ts';
import {issueIntegrationCredential} from '../src/auroraIntegrationCredential.ts';
import {completeInstallation} from '../src/auroraRuntime.ts';

// Exercise the real HTTP handler and native projection against an isolated transactional fixture.
// This is not a cloud/Xeon handoff or a production Firestore test.
test('committed ingest resumes projection with the same key and one source effect',async(t)=>{
 const db:any=auroraDb, org='synthetic', base=`organizations/${org}`;
 const credential=issueIntegrationCredential(['integration.read','documents.ingest'],1);
 const state=new Map<string,any>([[base,{active:true,projectionEnabled:true,projectionMode:'SHADOW',projectionCompetence:'2026-10'}]]);
 state.set(`${base}/integrationCredentials/${credential.keyId}`,{orgId:org,keyId:credential.keyId,name:'synthetic-source',active:true,
  scopes:credential.scopes,expiresAt:Timestamp.fromDate(credential.expiresAt),createdBy:'synthetic-user'});
 state.set(`${base}/members/synthetic-user`,{active:true,role:'org_admin',allFacilities:true,permissions:[]});
 const originalAllowed=process.env.AURORA_NEXUS_ALLOWED_EMAILS,originalCsrf=process.env.AURORA_NEXUS_CSRF_HMAC_KEY;
 process.env.AURORA_NEXUS_ALLOWED_EMAILS='synthetic@example.test';process.env.AURORA_NEXUS_CSRF_HMAC_KEY='a'.repeat(64);
 t.after(()=>{if(originalAllowed===undefined)delete process.env.AURORA_NEXUS_ALLOWED_EMAILS;else process.env.AURORA_NEXUS_ALLOWED_EMAILS=originalAllowed;
   if(originalCsrf===undefined)delete process.env.AURORA_NEXUS_CSRF_HMAC_KEY;else process.env.AURORA_NEXUS_CSRF_HMAC_KEY=originalCsrf;});
 let mfa=true;
 t.mock.method(auroraAuth,'verifySessionCookie',async()=>({uid:'synthetic-user',email:'synthetic@example.test',auroraOrgId:org,
   firebase:{sign_in_second_factor:mfa?'totp':undefined}}));
 const cookie='__session=synthetic-session';
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
 t.mock.method(db,'collection',(path:string)=>({limit:()=>({__query:true,get:async()=>{
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
   const result=await callback({get:async(ref:any)=>ref.__query ? ref.get() : snapshot(ref.path),
    create:(ref:any,data:any)=>writes.push({path:ref.path,data,create:true}),
    set:(ref:any,data:any,options:any)=>writes.push({path:ref.path,data,create:false,merge:options?.merge===true})});
   for(const write of writes){if(write.create&&state.has(write.path))throw Error('ALREADY_EXISTS');}
   for(const write of writes){state.set(write.path,write.merge?{...state.get(write.path),...materialize(write.data)}:materialize(write.data));creates.set(write.path,(creates.get(write.path)||0)+1);}
   return result;
  });queue=job.then(()=>{},()=>{});return job;
 });
 const body={sourceSystem:'ERP',externalDocumentId:'synthetic-document',sourceVersion:1,
  occurredAt:'2026-10-08T04:00:00Z',documentType:'PRODUCTION',competence:'2026-10',amountCents:null,count:1,
  workflowState:'VALIDATED',slaDueAt:null,documentFragility:'NONE',missingFieldsCount:0,nativeReady:true,sourceIndependent:true};
 const call=async(override:any={},key='synthetic-same-key-20261008')=>{
  let result:any,status=0;
  const req:any={method:'POST',headers:{},body:{...body,...override},get:(name:string)=>({'content-type':'application/json',authorization:`Bearer ${credential.apiKey}`,'idempotency-key':key} as any)[name]};
  const res:any={on(){return this;},set(){return this;},status(value:number){status=value;return this;},json(value:any){result=value;return this;}};
  await (auroraNexusIntegrationDocuments as any)(req,res);return {status,result};
 };
 const first=await call();assert.equal(first.status,202);
 assert.equal(first.result.installation.firstIngestionVerified,false);
 const replay=await call();assert.equal(replay.status,200);assert.equal(replay.result.duplicate,true);
 assert.equal(replay.result.installation.firstIngestionVerified,true);
 assert.equal(replay.result.installation.acceptance.receiptPersisted,true);
 assert.equal(replay.result.installation.acceptance.replayVerified,true);
 assert.equal(replay.result.installation.acceptance.automationConfigured,false);
 await assert.rejects(completeInstallation(org,'synthetic-user'),/INSTALLATION_INTEGRATION_PENDING/);
 const configure=async(method='API_TOKEN',expectedRevision=0)=>{
  let status=0,result:any;const headers:any={'content-type':'application/json',origin:'https://auroranexus.com.br','sec-fetch-site':'same-origin',cookie,
    'x-aurora-csrf':csrfTokenForSession(cookie,'a'.repeat(64),CSRF_PURPOSES.integrationKey)};
  const req:any={method:'POST',body:{action:'CONFIGURE_AUTOMATION',method,sourceSystem:'ERP',enabled:true,expectedRevision,
    ...(method==='API_TOKEN'?{keyId:credential.keyId}:{})},get:(name:string)=>headers[name]};
  const res:any={on(){return this;},set(){return this;},status(value:number){status=value;return this;},json(value:any){result=value;return this;}};
  await (auroraNexusIntegrationKeys as any)(req,res);return {status,result};
 };
 assert.equal((await configure()).status,200);
 assert.equal((await configure()).status,409); // Stale configuration CAS cannot silently rebind.
 const configured=await call();assert.equal(configured.result.installation.acceptance.eligible,true);
 assert.equal(configured.result.installation.acceptance.method,'API_TOKEN');
 assert.equal(configured.result.installation.acceptance.providerAccessVerified,false);
 assert.equal(configured.result.installation.acceptance.globalDocumentAcquisitionVerified,false);
 const concurrent=await Promise.all([call(),call()]);
 assert.ok(concurrent.every(reply=>reply.result.installation.firstIngestionVerified));
 assert.equal(creates.get(`${base}/sourceDocuments/${first.result.documentId}`),1);
 assert.equal([...state.keys()].filter(path=>path.includes('/dashboardSnapshotHistory/')).length,1);
 assert.equal([...creates.entries()].filter(([path])=>path.includes('/dashboardSnapshotHistory/')).reduce((n,[,count])=>n+count,0),1);
 assert.equal([...state.keys()].filter(path=>path.includes('/apiIdempotency/')).length,1);
 const versions=[...state.keys()].filter(path=>path.includes('/entityVersions/'));
 assert.equal(versions.length,1);assert.equal(creates.get(versions[0]),1);
 assert.equal(replay.result.installation.revision,1);
 assert.equal(replay.result.installation.versionId,versions[0].split('/').pop());
 assert.equal(replay.result.installation.operationalComplete,false);
 const conflict=await call({workflowState:'FAILED'},'synthetic-new-key-20261008');
 assert.equal(conflict.status,409);assert.equal(conflict.result.code,'SOURCE_VERSION_CONFLICT');
 assert.equal([...state.keys()].filter(path=>path.includes('/apiIdempotency/')).length,1);
 const projected=state.get(`${base}/dashboardSnapshots/current`);
 // A previously committed history receipt must repair a stale current view on replay,
 // with no second history or source/immutable-version effect.
 state.set(`${base}/dashboardSnapshots/current`,{...projected,sourceHash:'old',integrationReadback:[]});
 const repaired=await call();assert.equal(repaired.result.installation.firstIngestionVerified,true);
 assert.equal(state.get(`${base}/dashboardSnapshots/current`).sourceHash,projected.sourceHash);
 assert.equal(creates.get(versions[0]),1);
 assert.equal([...creates.entries()].filter(([path])=>path.includes('/dashboardSnapshotHistory/')).reduce((n,[,count])=>n+count,0),1);
 const completed=await completeInstallation(org,'synthetic-user');
 assert.equal(completed.operationalComplete,true);
 await completeInstallation(org,'synthetic-user');
 assert.equal(creates.get(`${base}/runtimeCheckpoints/installation`),1);
 state.delete(versions[0]);
 await assert.rejects(completeInstallation(org,'synthetic-user'),/FIRST_INGESTION_PENDING/);
 assert.equal(creates.get(`${base}/runtimeCheckpoints/installation`),1);
 state.set(`${base}/members/synthetic-user`,{active:true,role:'org_admin',allFacilities:true,permissions:[]});
 const csrf=csrfTokenForSession(cookie,'a'.repeat(64),CSRF_PURPOSES.documentIngest)!;
 const nativeCall=async()=>{
   let result:any,status=0;const h:any={'content-type':'application/json',origin:'https://auroranexus.com.br','sec-fetch-site':'same-origin',
     cookie,'x-aurora-csrf':csrf,'idempotency-key':'synthetic-native-import-key'};
   const req:any={method:'POST',body:{...body,externalDocumentId:'synthetic-native-source'},get:(name:string)=>h[name]};
   const res:any={on(){return this;},set(){return this;},status(value:number){status=value;return this;},json(value:any){result=value;return this;}};
   await (auroraNexusIntegrationDocuments as any)(req,res);return {status,result};
 };
 const native=await nativeCall();assert.equal(native.status,202);assert.equal(native.result.orgId,org);
 assert.equal(native.result.installation.firstIngestionVerified,true);
 const nativeReplay=await nativeCall();assert.equal(nativeReplay.status,200);assert.equal(nativeReplay.result.duplicate,true);
 assert.equal(nativeReplay.result.installation.acceptance.eligible,false);
 assert.equal(nativeReplay.result.installation.acceptance.method,'MANUAL');
 const manualConfig=await configure('MANUAL');assert.equal(manualConfig.status,200);
 const manualReady=await nativeCall();assert.equal(manualReady.result.installation.acceptance.eligible,true);
 assert.equal(manualReady.result.installation.acceptance.localCollectionVerified,false);
 assert.equal(manualReady.result.installation.acceptance.acquisitionModes.CLOUD_OAUTH,'PENDING_ADAPTER_EVIDENCE');
 const manualComplete=await completeInstallation(org,'synthetic-user');assert.equal(manualComplete.operationalComplete,true);
 assert.equal(manualComplete.acceptance?.method,'MANUAL');
 assert.equal((await configure('CLOUD_OAUTH')).result.code,'ADAPTER_EVIDENCE_REQUIRED');
 assert.equal((await configure('LOCAL_AGENT')).result.code,'ADAPTER_EVIDENCE_REQUIRED');
 assert.equal(creates.get(`${base}/sourceDocuments/${native.result.documentId}`),1);
 mfa=false;assert.equal((await nativeCall()).status,403);
 assert.equal((await configure('MANUAL',1)).status,403);
 assert.equal(creates.get(`${base}/sourceDocuments/${native.result.documentId}`),1);
});
