import test from 'node:test';
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
    medicalPartnersEnabled:true,medicalPartnersPrivacyApproved:true}],
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
  let commits=0;
  const materialize=(value:any,old:any):any=>{
    if(value instanceof Timestamp)return value;
    if(value instanceof FieldValue){if(value.isEqual(FieldValue.serverTimestamp()))return Timestamp.now();
      assert.ok(value.isEqual(FieldValue.increment(1)));return (old??0)+1;}
    if(Array.isArray(value))return value.map((v,i)=>materialize(v,old?.[i]));
    return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,materialize(v,old?.[k])])):value;
  };
  t.mock.method(auroraDb,'runTransaction',async(body:any)=>{
    const pending:any[]=[];
    const tx={get:async(ref:any)=>{assert.equal(pending.length,0);return ref.limitValue!==undefined?querySnapshot(ref.path,ref.filter,ref.limitValue):snap(ref.path);},
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
  return {rows,base,member,lock,call,commits:()=>commits};
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
