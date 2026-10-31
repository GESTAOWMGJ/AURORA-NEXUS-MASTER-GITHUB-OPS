import test from 'node:test';
import {Readable} from 'node:stream';
import {getStorage} from 'firebase-admin/storage';
import assert from 'node:assert/strict';
import {FieldValue, Timestamp} from 'firebase-admin/firestore';
import {auroraAuth, auroraDb} from '../src/firebase.ts';
import {csrfTokenForSession, CSRF_PURPOSES} from '../src/auroraAccess.ts';
import {writerLeasePath, WRITER_GUARDIAN_ID, CANONICAL_WRITE_RESOURCE} from '../src/auroraWriterGuardian.ts';
import {auroraNexusOrganic} from '../src/auroraOrganicRuntime.ts';
import {autoObserveResolvedDocumentAction} from '../src/auroraOrganicAutoObserve.ts';
import {auroraNexusMedicalPartners} from '../src/auroraMedicalPartnerRuntime.ts';
import {auroraNexusCryptoSelfTest} from '../src/auroraCryptoRuntime.ts';
import {auroraNexusShareholderReportGenerator} from '../src/auroraShareholderReportRuntime.ts';
import {auroraNexusDistributionDecision, loadFinancialClosingStatus} from '../src/auroraFinancialDecisionRuntime.ts';
import {auroraNexusIntegrationKeys} from '../src/auroraIntegrationRuntime.ts';
import {profileStore, auroraNexusUserProfiles} from '../src/auroraUserProfileRuntime.ts';
import {syncDocumentGovernance} from '../src/auroraDocumentGovernance.ts';
import {expireLegacyRuntimeLock} from '../src/auroraWriterGuardian.ts';
import {runtimeWatchdog} from '../src/index.ts';
import {sha256} from '../src/auroraMedicalPartnerPolicy.ts';

// Exercise actual HTTP/trigger handlers. All database and identity entry points
// are replaced; fixtures cannot contact Firestore, Auth, KMS or Storage.
function fixture(t: any) {
  const base='organizations/wmgj', uid='synthetic-reviewer', cookie='__session=synthetic-session';
  const settings={AURORA_NEXUS_ALLOWED_EMAILS:'writer@example.test',AURORA_NEXUS_CSRF_HMAC_KEY:'ab'.repeat(32),
    AURORA_MEDICAL_PARTNERS_BUCKET:'wmgj-hml-jfn-20260927-medical-partners'};
  for(const [key,value] of Object.entries(settings)) {
    const old=process.env[key];process.env[key]=value;
    t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});
  }
  const member={uid,email:'writer@example.test',orgId:'wmgj',role:'org_admin',permissions:[],allFacilities:true,facilityIds:[],mfaVerified:true};
  const rows=new Map<string,any>([[base,{active:true,organicEnabled:true,organicSectors:['AUDIT'],
    medicalPartnersEnabled:true,medicalPartnersPrivacyApproved:true,userProfilesEnabled:true}],
    [`${base}/members/${uid}`,{active:true,role:'org_admin',allFacilities:true}]]);
  const snap=(path:string):any=>({id:path.split('/').pop(),ref:doc(path),exists:rows.has(path),readTime:Timestamp.now(),data:()=>rows.get(path)});
  const doc=(path:string):any=>({path,id:path.split('/').pop(),get:async()=>snap(path),collection:(name:string)=>collection(`${path}/${name}`),
    set:()=>{throw Error('UNGUARDED_WRITE');},create:()=>{throw Error('UNGUARDED_WRITE');},update:()=>{throw Error('UNGUARDED_WRITE');}});
  const query=(path:string,filter?:[string,string,unknown],limit=1001):any=>({path,filter,limitValue:limit,
    limit:(n:number)=>query(path,filter,n),where:(k:string,op:string,v:unknown)=>query(path,[k,op,v],limit),
    get:async()=>querySnapshot(path,filter,limit)});
  const querySnapshot=(path:string,filter?:[string,string,unknown],limit=1001)=>{
    const docs=[...rows.keys()].filter(k=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/'))
      .filter(k=>!filter||rows.get(k)[filter[0]]===filter[2]).slice(0,limit).map(snap);
    return {docs,size:docs.length};
  };
  const collection=(path:string):any=>({...query(path),doc:(id:string)=>doc(`${path}/${id}`)});
  t.mock.method(auroraDb,'doc',doc);t.mock.method(auroraDb,'collection',collection);
  t.mock.method(auroraDb,'batch',()=>{throw Error('UNGUARDED_BATCH');});
  t.mock.method(auroraDb,'collectionGroup',()=>{throw Error('NETWORK_READ_REJECTED');});
  t.mock.method(auroraAuth,'verifySessionCookie',async()=>({uid,email:member.email,auroraOrgId:'wmgj',firebase:{sign_in_second_factor:'totp'}}));
  let commits=0; let beforeTransaction=()=>{};
  const failReads=new Set<string>();
  const materialize=(value:any,old:any):any=>{
    if(value instanceof Timestamp)return value;
    if(value instanceof FieldValue){if(value.isEqual(FieldValue.serverTimestamp()))return Timestamp.now();
      assert.ok(value.isEqual(FieldValue.increment(1)));return (old??0)+1;}
    if(Array.isArray(value))return value.map((v,i)=>materialize(v,old?.[i]));
    return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,materialize(v,old?.[k])])):value;
  };
  t.mock.method(auroraDb,'runTransaction',async(body:any)=>{
    beforeTransaction();
    const pending:any[]=[];
    const tx={get:async(ref:any)=>{assert.equal(pending.length,0);if(failReads.has(ref.path))throw Error('SYNTHETIC_READ_FAILURE');return ref.limitValue!==undefined?querySnapshot(ref.path,ref.filter,ref.limitValue):snap(ref.path);},
      create:(ref:any,data:any)=>pending.push({path:ref.path,data,create:true}),
      set:(ref:any,data:any,opt:any={})=>pending.push({path:ref.path,data,merge:opt.merge}),
      update:(ref:any,data:any)=>pending.push({path:ref.path,data,merge:true})};
    const result=await body(tx),next=new Map(rows);
    for(const w of pending){if(w.create)assert.equal(next.has(w.path),false);const old=next.get(w.path);
      const data=materialize(w.data,old);next.set(w.path,w.merge?{...old,...data}:data);}
    if(pending.length){commits++;rows.clear();for(const [k,v] of next)rows.set(k,v);}
    return result;
  });
  const lock=()=>rows.set(writerLeasePath('wmgj'),{guardianId:WRITER_GUARDIAN_ID,orgId:'wmgj',resourceKey:CANONICAL_WRITE_RESOURCE,
    holder:'WINDOWS_XEON_PHYSICAL_SERVER',ownerId:'other-instance',epoch:5,state:'LOCKED',expiresAt:Date.now()+60000});
  const call=async(handler:any,body:any,purpose:any,method='POST',path='/organic')=>{
    let status=200,result:any;
    const headers:any={cookie,origin:'https://auroranexus.com.br','content-type':'application/json','sec-fetch-site':'same-origin',
      'idempotency-key':'synthetic-legacy-writer-operation','x-aurora-csrf':csrfTokenForSession(cookie,settings.AURORA_NEXUS_CSRF_HMAC_KEY,purpose)};
    const req:any={method,path,body,query:{format:'json'},get:(key:string)=>headers[key]};
    const res:any={on(){return this;},set(){return this;},status(n:number){status=n;return this;},json(value:any){result=value;return this;}};
    await handler(req,res);return {status,result};
  };
  return {rows,base,member,lock,call,commits:()=>commits, failReads, beforeTransaction:(fn:()=>void)=>{beforeTransaction=fn;}};
}

test('organic POST retains the same receipt; authorized GET works while another writer holds the lease',async t=>{
  const f=fixture(t),body={type:'REVALIDATE',expectedVersion:0};
  const first=await f.call(auroraNexusOrganic,body,CSRF_PURPOSES.organic);assert.equal(first.status,201);
  const replay=await f.call(auroraNexusOrganic,body,CSRF_PURPOSES.organic);assert.equal(replay.result.duplicate,true);
  assert.equal([...f.rows.keys()].filter(k=>k.includes('/apiIdempotency/')).length,1);assert.equal(f.commits(),1);
  f.lock();const before=f.commits();
  assert.equal((await f.call(auroraNexusOrganic,null,CSRF_PURPOSES.organic,'GET')).status,200);
  const blocked=await f.call(auroraNexusOrganic,{type:'REVALIDATE',expectedVersion:1},CSRF_PURPOSES.organic);
  assert.equal(blocked.status,503);assert.equal(blocked.result.code,'SPLIT_BRAIN_PREVENTED');assert.equal(f.commits(),before);
});

test('auto-observation cannot bypass a live foreign owner',async t=>{
  const f=fixture(t);f.lock();
  await assert.rejects(autoObserveResolvedDocumentAction('wmgj','synthetic-action',f.member),/SPLIT_BRAIN_PREVENTED/);
  assert.equal(f.commits(),0);
});

test('crypto lock denial cannot write an error checkpoint around the guard or call KMS',async t=>{
  const f=fixture(t);f.lock();
  const result=await f.call(auroraNexusCryptoSelfTest,{},CSRF_PURPOSES.crypto,'POST','/api/crypto/self-test');
  assert.equal(result.status,503);assert.equal(result.result.code,'SPLIT_BRAIN_PREVENTED');assert.equal(f.commits(),0);
  assert.equal(f.rows.has(`${f.base}/runtimeCheckpoints/crypto-self-test`),false);
});

const profile={fullName:'Dra. Camila Teste',email:'camila@example.test',phone:'(43) 99999-9999',crmNumber:'123456',crmState:'PR',
  city:'Londrina',state:'PR',specialty:'Clínica Médica',rqe:'12345',experienceYears:5,workAreas:['UTI_ADULTO'],availability:['DIURNO'],
  engagement:['PLANTAO'],companyOption:false,notes:null,noticeAccepted:true,futureOpportunitiesAccepted:false,preCredentialTermsAccepted:true};
test('medical submission and replay keep one application, receipt and epoch',async t=>{
  const f=fixture(t),token=Buffer.alloc(32,7).toString('base64url');
  f.rows.set(`${f.base}/medicalPartnerInvitations/synthetic-invite`,{tokenHash:sha256(token),state:'INVITED',expiresAtIso:'2099-01-01T00:00:00Z'});
  const call=()=>f.call(auroraNexusMedicalPartners,{action:'SUBMIT',token,application:profile},CSRF_PURPOSES.medicalPartner,'POST','/api/wmgj/medicos');
  const first=await call();assert.equal(first.status,200,JSON.stringify(first.result));
  const again=await call();assert.equal(again.result.status,'ALREADY_SUBMITTED');
  assert.equal([...f.rows.keys()].filter(k=>k.includes('/medicalPartnerApplications/')).length,1);
  assert.equal(f.rows.get(writerLeasePath('wmgj')).epoch,1);assert.equal(f.commits(),1);
});

test('medical invitation issue respects the same guardian before direct document creation',async t=>{
  const f=fixture(t);f.lock();
  const result=await f.call(auroraNexusMedicalPartners,{action:'ISSUE_INVITATION'},CSRF_PURPOSES.medicalPartner,'POST','/api/wmgj/medicos');
  assert.equal(result.status,503);assert.equal(result.result.code,'SPLIT_BRAIN_PREVENTED');assert.equal(f.commits(),0);
});

test('shareholder trigger is fenced, then atomically creates one version and replays without duplication',async t=>{
  const f=fixture(t),event:any={params:{orgId:'wmgj',competence:'2026-10'},data:{after:{exists:true,data:()=>({status:'CLOSED',approvedBy:'synthetic-reviewer',evidenceRefs:['synthetic-evidence']})}}};
  f.lock();await assert.rejects((auroraNexusShareholderReportGenerator as any).run(event),/SPLIT_BRAIN_PREVENTED/);
  f.rows.delete(writerLeasePath('wmgj'));
  await (auroraNexusShareholderReportGenerator as any).run(event);await (auroraNexusShareholderReportGenerator as any).run(event);
  assert.equal(f.commits(),1);assert.equal([...f.rows.keys()].filter(k=>k.includes('/shareholderReportVersions/')).length,1);
});

test('financial decision keeps its existing snapshot/idempotency and never moves money',async t=>{
  const f=fixture(t),competence='2026-10';f.rows.set(`${f.base}/monthlyClosings/${competence}`,{status:'CLOSED'});
  const summary=await loadFinancialClosingStatus('wmgj',competence);
  const body={competence,snapshotHash:summary.snapshotHash,decision:'REJECT',reason:'Synthetic review only',expectedRevision:0};
  f.lock();const blocked=await f.call(auroraNexusDistributionDecision,body,CSRF_PURPOSES.distributionApproval);
  assert.equal(blocked.status,503);assert.equal(f.commits(),0);f.rows.delete(writerLeasePath('wmgj'));
  const first=await f.call(auroraNexusDistributionDecision,body,CSRF_PURPOSES.distributionApproval);assert.equal(first.status,200);
  const replay=await f.call(auroraNexusDistributionDecision,body,CSRF_PURPOSES.distributionApproval);
  assert.equal(replay.result.duplicate,true);assert.equal(replay.result.decision.moneyMoved,false);assert.equal(f.commits(),1);
});


test('credential mutations reject another owner without returning a secret', async t => {
  const f=fixture(t); f.lock(); const keyId='ik_'+'a'.repeat(16);
  for (const body of [
    {action:'CREATE',name:'Synthetic key',scopes:['integration.read']},
    {action:'REGISTER_HASH',name:'Synthetic key',scopes:['integration.read'],keyId,tokenHash:'b'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()},
    {action:'REVOKE',keyId}
  ]) {
    const r=await f.call(auroraNexusIntegrationKeys,body,CSRF_PURPOSES.integrationKey);
    assert.equal(r.status,503);assert.equal(r.result.code,'SPLIT_BRAIN_PREVENTED');assert.equal(r.result.apiKey,undefined);
  }
  assert.equal(f.commits(),0);
});

test('credential registration conflict and revocation replay preserve one effect', async t => {
  const f=fixture(t),keyId='ik_'+'a'.repeat(16),path=`${f.base}/integrationCredentials/${keyId}`;
  const body={action:'REGISTER_HASH',name:'Synthetic key',scopes:['integration.read'],keyId,tokenHash:'b'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()};
  assert.equal((await f.call(auroraNexusIntegrationKeys,body,CSRF_PURPOSES.integrationKey)).status,201);
  assert.equal((await f.call(auroraNexusIntegrationKeys,body,CSRF_PURPOSES.integrationKey)).status,409);assert.equal(f.commits(),1);
  for(let i=0;i<2;i++)assert.equal((await f.call(auroraNexusIntegrationKeys,{action:'REVOKE',keyId},CSRF_PURPOSES.integrationKey)).status,200);
  assert.equal(f.commits(),2);assert.equal(f.rows.get(path).active,false);assert.equal(f.rows.get(writerLeasePath('wmgj')).epoch,2);
});

test('credential create rechecks administrator revocation inside the transaction', async t => {
  const f=fixture(t);
  f.beforeTransaction(()=>f.rows.set(`${f.base}/members/${f.member.uid}`,{active:false,role:'org_admin',allFacilities:true}));
  const r=await f.call(auroraNexusIntegrationKeys,{action:'CREATE',name:'Synthetic key',scopes:['integration.read']},CSRF_PURPOSES.integrationKey);
  assert.equal(r.status,403);assert.equal(r.result.code,'MEMBERSHIP_REVOKED');assert.equal(f.commits(),0);
});

test('profile runtime checks the shared lease before Auth provisioning', async t => {
  const f=fixture(t);f.lock();
  t.mock.method(auroraAuth,'getUser',async()=>{throw Error('AUTH_MUST_NOT_RUN');});
  t.mock.method(auroraAuth,'createUser',async()=>{throw Error('AUTH_MUST_NOT_RUN');});
  const r=await f.call(auroraNexusUserProfiles,{action:'CREATE',requestId:'synthetic-profile-request',email:'person@example.test',displayName:'Synthetic',role:'viewer',allFacilities:true,facilityIds:[]},CSRF_PURPOSES.userProfile);
  assert.equal(r.status,503);assert.equal(r.result.code,'SPLIT_BRAIN_PREVENTED');assert.equal(f.commits(),0);
});

test('profile persistence receives explicit tenant and rejects cross-tenant writes', async t => {
  const f=fixture(t);
  await assert.rejects(profileStore.transaction('wmgj',async tx=>{tx.create('organizations/other/members/test',{active:true});}),/WRITER_SCOPE_VIOLATION/);
  await profileStore.transaction('wmgj',async tx=>{tx.create(`${f.base}/members/new-synthetic`,{active:false});});
  assert.equal(f.commits(),1);assert.equal(f.rows.get(writerLeasePath('wmgj')).epoch,1);
});

const degraded={workflowState:'FAILED',sourceVersion:1,nativeReady:false,sourceIndependent:false,externalFetchRequired:true};
test('document watchdog re-reads scanned source and rejects stale findings', async t => {
  const f=fixture(t),path=`${f.base}/sourceDocuments/doc`; f.rows.set(path,degraded);
  f.beforeTransaction(()=>f.rows.set(path,{workflowState:'VALIDATED',nativeReady:true,sourceIndependent:true,externalFetchRequired:false}));
  assert.equal((await syncDocumentGovernance('wmgj')).changed,0);assert.equal(f.commits(),0);
});

test('document watchdog retains successful item, pending failure and revision on replay', async t => {
  const f=fixture(t);f.rows.set(`${f.base}/sourceDocuments/bad`,degraded);f.rows.set(`${f.base}/sourceDocuments/good`,degraded);f.failReads.add(`${f.base}/sourceDocuments/bad`);
  const result=await syncDocumentGovernance('wmgj');assert.equal(result.changed,1);assert.equal(result.pending,1);assert.equal(result.partial,true);
  assert.equal([...f.rows.keys()].filter(k=>k.includes('/auditFindings/')).length,1);
  assert.equal([...f.rows].find(([k])=>k.includes('/actionItems/'))![1].revision,1);assert.equal(f.commits(),1);
  assert.equal((await syncDocumentGovernance('wmgj')).changed,0);assert.equal(f.commits(),1);
  f.failReads.clear();const resumed=await syncDocumentGovernance('wmgj');assert.equal(resumed.changed,1);assert.equal(resumed.pending,0);assert.equal(f.commits(),2);
});

test('document watchdog honors shared lease and live organization', async t => {
  const f=fixture(t);f.rows.set(`${f.base}/sourceDocuments/doc`,degraded);f.lock();
  const result=await syncDocumentGovernance('wmgj');assert.equal(result.changed,0);assert.equal(result.pending,1);
  assert.deepEqual(result.failures,[{documentId:'doc',code:'SPLIT_BRAIN_PREVENTED'}]);
  f.rows.delete(writerLeasePath('wmgj'));f.beforeTransaction(()=>f.rows.set(f.base,{active:false}));
  assert.equal((await syncDocumentGovernance('wmgj')).pending,1);assert.equal(f.commits(),0);
});

test('legacy expiry checks live time and never rewrites the canonical epoch', async t => {
  const f=fixture(t),path=`${f.base}/runtimeLocks/legacy`;
  f.rows.set(path,{state:'LOCKED',leaseUntil:Timestamp.fromMillis(Date.now()+60000)});
  assert.equal(await expireLegacyRuntimeLock(auroraDb,'wmgj','legacy'),false);assert.equal(f.commits(),0);
  f.rows.set(path,{state:'LOCKED',leaseUntil:Timestamp.fromMillis(Date.now()-60000)});
  f.lock();await assert.rejects(expireLegacyRuntimeLock(auroraDb,'wmgj','legacy'),/SPLIT_BRAIN_PREVENTED/);
  assert.equal(f.rows.get(path).state,'LOCKED');f.rows.delete(writerLeasePath('wmgj'));
  assert.equal(await expireLegacyRuntimeLock(auroraDb,'wmgj','legacy'),true);assert.equal(await expireLegacyRuntimeLock(auroraDb,'wmgj','legacy'),false);
  assert.equal(f.commits(),1);assert.equal(f.rows.get(writerLeasePath('wmgj')).epoch,1);
  await assert.rejects(expireLegacyRuntimeLock(auroraDb,'wmgj',writerLeasePath('wmgj').split('/').pop()!),/INVALID_LEGACY_LOCK_SCOPE/);
  for(const data of [{guardianId:WRITER_GUARDIAN_ID},{orgId:'other'},{leaseUntil:'malformed'}]) {
    f.rows.set(path,{state:'LOCKED',leaseUntil:Timestamp.fromMillis(0),...data});
    await assert.rejects(expireLegacyRuntimeLock(auroraDb,'wmgj','legacy'),/INVALID_LEGACY_LOCK/);
  }
});

test('runtime watchdog continues after one blocked tenant', async t => {
  const f=fixture(t),a=`${f.base}/runtimeLocks/old`,b='organizations/other/runtimeLocks/old';
  f.rows.set(a,{state:'LOCKED',leaseUntil:Timestamp.fromMillis(0)});f.rows.set(b,{state:'LOCKED',leaseUntil:Timestamp.fromMillis(0)});f.lock();
  const docs=[a,b].map(path=>({ref:{path}}));const query:any={where:()=>query,limit:()=>query,get:async()=>({empty:false,docs,size:docs.length})};
  t.mock.method(auroraDb,'collectionGroup',()=>query);await (runtimeWatchdog as any).run({});
  assert.equal(f.rows.get(a).state,'LOCKED');assert.equal(f.rows.get(b).state,'EXPIRED');
  assert.equal(f.rows.get(writerLeasePath('wmgj')).epoch,5);assert.equal(f.rows.get(writerLeasePath('other')).epoch,1);
});


test('external upload receipt binds verified generation and preserves the original receipt on replay',async t=>{
  const f=fixture(t),token=Buffer.alloc(32,7).toString('base64url'),invitationId='synthetic-upload';
  const applicationId=sha256('aurora-credmed-application-v1:wmgj:'+invitationId),app=f.base+'/medicalPartnerApplications/'+applicationId;
  f.rows.set(f.base+'/medicalPartnerInvitations/'+invitationId,{tokenHash:sha256(token),state:'SUBMITTED',applicationId,expiresAtIso:'2099-01-01T00:00:00Z'});
  f.rows.set(app,{invitationId,documentCount:0});
  const bytes=Buffer.from('%PDF-1.7\nSynthetic content\n%%EOF'); let saves=0;
  t.mock.method(getStorage(),'bucket',()=>({file:(_key:string,options?:any)=>({
    save:async(_data:any,opts:any)=>{saves++;assert.equal(opts.preconditionOpts.ifGenerationMatch,0);},
    getMetadata:async()=>[{generation:'123',size:bytes.length,contentType:'application/pdf'}],
    createReadStream:()=>{assert.equal(options.generation,'123');return Readable.from([bytes]);}
  })}) as any);
  const call=()=>f.call(auroraNexusMedicalPartners,{action:'UPLOAD',token,document:{kind:'CRM_CERTIFICATE',mimeType:'application/pdf',base64:bytes.toString('base64')}},CSRF_PURPOSES.medicalPartner,'POST','/api/wmgj/medicos');
  const first=await call();assert.equal(first.status,200,JSON.stringify(first.result));
  const document=f.rows.get(app+'/documents/'+first.result.documentId);
  assert.equal(document.storageGeneration,'123');assert.equal(document.storageVerification,'GENERATION_BYTES_SHA256_VERIFIED');
  const again=await call();assert.equal(again.result.replay,true);assert.equal(saves,1);
  assert.equal(f.rows.get(app).receivedDocumentCount,1);
});

for(const boundary of ['tenant-disabled','foreign-lease','invitation-revoked'])test('external upload cannot confirm after '+boundary,async t=>{
  const f=fixture(t),token=Buffer.alloc(32,7).toString('base64url'),invitationId='synthetic-upload';
  const applicationId=sha256('aurora-credmed-application-v1:wmgj:'+invitationId),app=f.base+'/medicalPartnerApplications/'+applicationId;
  const invite=f.base+'/medicalPartnerInvitations/'+invitationId;
  f.rows.set(invite,{tokenHash:sha256(token),state:'SUBMITTED',applicationId,expiresAtIso:'2099-01-01T00:00:00Z'});
  f.rows.set(app,{invitationId,documentCount:0});const bytes=Buffer.from('%PDF-1.7\nSynthetic content\n%%EOF');
  t.mock.method(getStorage(),'bucket',()=>({file:()=>({save:async()=>{},
    getMetadata:async()=>[{generation:'123',size:bytes.length,contentType:'application/pdf'}],
    createReadStream:()=>{if(boundary==='tenant-disabled')f.rows.get(f.base).active=false;
      if(boundary==='foreign-lease')f.lock();if(boundary==='invitation-revoked')f.rows.get(invite).state='REVOKED';
      return Readable.from([bytes]);}
  })}) as any);
  const result=await f.call(auroraNexusMedicalPartners,{action:'UPLOAD',token,document:{kind:'CRM_CERTIFICATE',mimeType:'application/pdf',base64:bytes.toString('base64')}},CSRF_PURPOSES.medicalPartner,'POST','/api/wmgj/medicos');
  assert.equal(result.status,boundary==='invitation-revoked'?403:503,JSON.stringify(result.result));
  assert.equal(f.rows.get(app).receivedDocumentCount,undefined);
  assert.equal([...f.rows.entries()].find(([k])=>k.startsWith(app+'/documents/'))?.[1].state,'UPLOAD_PENDING');
});
