import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileEngine, type ProfileAuth, type ProfileStore, type ProfileTx } from '../src/auroraUserProfiles.js';
import { managedProfileMatches, normalizeProfileRequest, profileIdentity, type ProfileActor } from '../src/auroraUserProfilePolicy.js';

const actor: ProfileActor = { uid:'synthetic-admin', orgId:'synthetic-company', role:'org_admin', allFacilities:true, mfaVerified:true };
const request = { action:'CREATE', requestId:'synthetic-request-0001', email:'person@example.invalid', displayName:'Pessoa Sintética', role:'viewer', allFacilities:false, facilityIds:['unit-a'] };
const base = `organizations/${actor.orgId}`;
const identity = profileIdentity(actor, normalizeProfileRequest(request));
const memberPath = `${base}/members/${identity.uid}`;
const opPath = `${base}/apiIdempotency/${identity.operationId}`;
const rejects = (code: string) => (error: any) => { assert.equal(error.code, code); return true; };


import { createPracticeProvisioner } from '../src/auroraPracticeProvisioning.js';
import { practicePage } from '../src/auroraPracticeView.js';
import { PRACTICE_ROLES } from '../src/auroraPracticePolicy.js';
function fixture() {
  const rows = new Map<string, any>([[base,{active:true,userProfilesEnabled:true}], [`${base}/members/${actor.uid}`,{active:true,role:'org_admin',allFacilities:true}], [`${base}/facilities/unit-a`,{active:true}]]);
  const users = new Map<string, any>(); const calls: {method:string;data:any}[] = [];
  const failures = new Map<string, number>(); let hook: (method:string,data:any) => Promise<void> = async () => {};
  let time = 1_800_000_000_000; let lock = Promise.resolve();
  const store: ProfileStore = { transaction: async body => {
    const previous = lock; let release!: () => void; lock = new Promise(resolve => { release = resolve; }); await previous;
    const draft = new Map([...rows].map(([k,v]) => [k,structuredClone(v)])); let wrote = false;
    const tx: ProfileTx = {
      read: async path => { assert.equal(wrote,false,'Firestore reads precede writes'); return structuredClone(draft.get(path)); },
      create: (path,data) => { wrote = true; assert.equal(draft.has(path),false,'create must be absent'); draft.set(path,structuredClone(data)); },
      update: (path,data) => { wrote = true; assert.ok(draft.has(path)); draft.set(path,{...draft.get(path),...structuredClone(data)}); }
    };
    try { const result = await body(tx); rows.clear(); draft.forEach((v,k) => rows.set(k,v)); return result; } finally { release(); }
  } };
  async function call(method:string,data:any) {
    calls.push({method,data:structuredClone(data)}); await hook(method,data);
    if (failures.get(method)) { failures.set(method, failures.get(method)!-1); throw new Error('synthetic outage'); }
  }
  const auth: ProfileAuth = {
    getUser: async uid => { await call('getUser',uid); if (!users.has(uid)) throw Object.assign(new Error('absent'),{code:'auth/user-not-found'}); return structuredClone(users.get(uid)); },
    createUser: async data => { await call('createUser',data); if ([...users.values()].some(u => u.email === data.email)) throw Object.assign(new Error('exists'),{code:'auth/email-already-exists'}); users.set(data.uid,structuredClone(data)); },
    setCustomUserClaims: async (uid,claims) => { await call('claims',{uid,claims}); users.get(uid).customClaims = structuredClone(claims); },
    updateUser: async (uid,data) => { await call('updateUser',{uid,...data}); Object.assign(users.get(uid),data); },
    revokeRefreshTokens: async uid => { await call('revokeTokens',uid); }
  };
  return { store,auth,rows,users,calls,failures,engine:createProfileEngine(store,auth,()=>time), advance:(ms=181_000)=>{time+=ms;}, hook:(fn:typeof hook)=>{hook=fn;} };
}


const grantId='synthetic-practice-0001';
const grantPath=`${base}/runtimeCheckpoints/practice-grant-${grantId}`;
const target='organizations/synthetic-practice';
function practiceFixture(){
 const f=fixture();
 f.rows.set(`${base}/members/reviewer`,{active:true,allFacilities:true,permissions:['practice.validate']});
 f.rows.set(grantPath,{status:'APPROVED',actorUid:actor.uid,verifiedBy:'reviewer',expiresAt:2_000_000_000_000,
 entityVerified:true,professionalVerified:true,ownerConsent:true,entityRef:'synthetic-entity-01',professionalRef:'synthetic-professional-01',
 orgId:'synthetic-practice',email:'owner@example.invalid',displayName:'Titular Sintética'});
 return {...f,provision:createPracticeProvisioner(f.store,f.auth,()=>1_800_000_000_000)};
}
test('isolated organization and owner, no copied membership, no password, idempotent readback',async()=>{
 const f=practiceFixture();const before=structuredClone([...f.rows].filter(([p])=>p!==grantPath));
 const result=await f.provision(actor,grantId);
 assert.equal(result.loginPath,'/portal');assert.equal(result.role,'practice_owner');
 assert.equal(result.synchronization.engineVersion,'0.1.3');assert.equal(result.synchronization.state,'READY');
 assert.equal(f.rows.get(target).active,true);assert.equal(f.rows.get(target).clinicalStorageEnabled,false);
 assert.equal(f.rows.has(`${target}/members/${actor.uid}`),false);
 assert.deepEqual([...f.rows].filter(([p])=>p.startsWith(base)&&p!==grantPath),before);
 assert.deepEqual(f.rows.get(`${target}/members/${result.uid}`).permissions,[]);
 assert.equal(f.calls.find(c=>c.method==='createUser')!.data.password,undefined);
 assert.equal((await f.provision(actor,grantId)).uid,result.uid);
 assert.equal(f.calls.filter(c=>c.method==='createUser').length,1);
});

test('versioned readback is read-only before, during and after provisioning',async()=>{
 const f=practiceFixture(),before=structuredClone([...f.rows]);
 const absent=await f.provision.read(actor,grantId);
 assert.equal(absent.state,'NOT_STARTED');assert.equal(absent.schemaVersion,'aurora.webapp-sync.v1');
 assert.deepEqual([...f.rows],before);assert.equal(f.calls.length,0);
 f.failures.set('claims',1);await assert.rejects(f.provision(actor,grantId));
 const calls=f.calls.length,interrupted=structuredClone([...f.rows]);
 assert.equal((await f.provision.read(actor,grantId)).state,'IN_PROGRESS');
 assert.equal(f.calls.length,calls);assert.deepEqual([...f.rows],interrupted);
 await f.provision(actor,grantId);const completed=structuredClone([...f.rows]),readyCalls=f.calls.length;
 const ready=await f.provision.read(actor,grantId);
 assert.equal(ready.state,'READY');assert.equal(ready.loginVerified,false);assert.equal(ready.clinicalAccess,false);
 assert.equal(ready.profileVersion,'0.1.2');assert.equal(ready.observedAtUtc,new Date(1_800_000_000_000).toISOString());
 assert.deepEqual([...f.rows],completed);assert.equal(f.calls.length,readyCalls);
 assert.equal(f.calls.filter(c=>c.method==='createUser').length,1);
});
test('sync revalidates tenant, actor, MFA, independent reviewer and grant without provider access',async()=>{
 for(const change of ['tenant','mfa','reviewer','grant','expiry']) {
  const f=practiceFixture();await f.provision(actor,grantId);const calls=f.calls.length;
  const caller={...actor};if(change==='tenant')caller.orgId='other-tenant';if(change==='mfa')caller.mfaVerified=false;
  if(change==='reviewer')f.rows.get(`${base}/members/reviewer`).active=false;
  if(change==='grant')f.rows.get(grantPath).status='REVOKED';
  if(change==='expiry')f.rows.get(grantPath).expiresAt=1;
  await assert.rejects(f.provision.read(caller,grantId));assert.equal(f.calls.length,calls);
 }
});
test('sync does not report READY for a revoked or conflicting owner and preserves all rows',async()=>{
 const f=practiceFixture(),r=await f.provision(actor,grantId);
 f.rows.get(`${target}/members/${r.uid}`).active=false;const before=structuredClone([...f.rows]);
 assert.equal((await f.provision.read(actor,grantId)).state,'REQUIRES_REVIEW');assert.deepEqual([...f.rows],before);
});
for(const patch of [{orgId:'wmgj'},{orgId:actor.orgId},{entityVerified:false},{professionalVerified:false},{ownerConsent:false},
 {verifiedBy:actor.uid},{expiresAt:1},{status:'REVOKED'},{actorUid:'other'},{orgId:'../wmgj'},{email:'invalid'}])
 test('invalid grant fails before organization creation '+JSON.stringify(patch),async()=>{
 const f=practiceFixture();Object.assign(f.rows.get(grantPath),patch);
 await assert.rejects(f.provision(actor,grantId));assert.equal(f.rows.has(target),false);assert.equal(f.calls.length,0);
 });
test('reviewer and operator must remain active, independent and authorized',async()=>{
 for(const path of [`${base}/members/reviewer`,`${base}/members/${actor.uid}`]){
 const f=practiceFixture();f.rows.get(path).active=false;await assert.rejects(f.provision(actor,grantId));assert.equal(f.calls.length,0);
 }
 const f=practiceFixture();f.rows.get(`${base}/members/reviewer`).permissions=[];
 await assert.rejects(f.provision(actor,grantId));assert.equal(f.calls.length,0);
});
test('existing organization cannot be overwritten',async()=>{
 const f=practiceFixture();f.rows.set(target,{active:true,privateMarker:'preserve'});
 await assert.rejects(f.provision(actor,grantId));assert.equal(f.rows.get(target).privateMarker,'preserve');assert.equal(f.calls.length,0);
});
test('preexisting email is not adopted even in a new organization',async()=>{
 const f=practiceFixture();f.users.set('other',{uid:'other',email:'owner@example.invalid',disabled:false,customClaims:{auroraOrgId:'wmgj'}});
 await assert.rejects(f.provision(actor,grantId),rejects('PROFILE_IDENTITY_ALREADY_EXISTS'));
 assert.equal(f.rows.get(target).active,false);assert.equal(f.users.get('other').customClaims.auroraOrgId,'wmgj');
});
test('interrupted provider operation resumes without creating a second identity',async()=>{
 const f=practiceFixture();f.failures.set('claims',1);await assert.rejects(f.provision(actor,grantId));assert.equal(f.rows.get(target).active,false);
 const r=await f.provision(actor,grantId);assert.equal(f.rows.get(target).active,true);assert.equal(f.calls.filter(c=>c.method==='createUser').length,1);
 assert.equal(f.rows.get(`${target}/members/${r.uid}`).active,true);
});
test('revoked grant mid-flight cannot activate tenant',async()=>{
 const f=practiceFixture();f.hook(async method=>{if(method==='claims')f.rows.get(grantPath).status='REVOKED';});
 await assert.rejects(f.provision(actor,grantId));assert.equal(f.rows.get(target).active,false);
});
test('owner can create restricted staff, cannot create generic admin, owner or cross-tenant access',async()=>{
 const f=practiceFixture();const r=await f.provision(actor,grantId);
 const owner={...actor,uid:r.uid,orgId:r.orgId,role:'practice_owner'};
 const engine=createProfileEngine(f.store,f.auth);
 for(const role of ['org_admin','viewer','finance','practice_owner'])await assert.rejects(engine.create(owner,{...request,role,allFacilities:true,facilityIds:[]}));
 await assert.rejects(engine.create({...owner,orgId:'wmgj'},{...request,role:'practice_editor',allFacilities:true,facilityIds:[]}));
 const staff=await engine.create(owner,{...request,role:'practice_editor',allFacilities:true,facilityIds:[]});
 const m=f.rows.get(`${target}/members/${staff.uid}`);
 const token={...f.users.get(staff.uid).customClaims,email:request.email,email_verified:true,firebase:{sign_in_second_factor:'totp'}};
 assert.equal(managedProfileMatches(token,m,r.orgId),true);
 assert.equal(managedProfileMatches(token,m,'wmgj'),false);
 assert.equal(managedProfileMatches({...token,email_verified:false},m,r.orgId),false);
 assert.equal(managedProfileMatches({...token,firebase:{}},m,r.orgId),false);
 await engine.revoke(owner,staff.uid);assert.equal(managedProfileMatches(token,f.rows.get(`${target}/members/${staff.uid}`),r.orgId),false);
 assert.equal(f.users.get(staff.uid).disabled,true);assert.ok(f.calls.some(c=>c.method==='revokeTokens'&&c.data===staff.uid));
});
test('practice UI exposes only owner team form, never generic dashboard or clinical form',()=>{
 for(const role of PRACTICE_ROLES){const html=practicePage({...actor,role,email:'synthetic@example.invalid',permissions:[],facilityIds:[]},'csrf','logout');
 assert.equal(html.includes('id="team"'),role==='practice_owner');assert.equal(html.includes('/api/bootstrap'),false);
 assert.equal(html.includes('value="org_admin"'),false);assert.ok(html.includes('/account-security'));
 }
});

test('two simultaneous provisioning requests converge without duplicate identity',async()=>{
 const f=practiceFixture();const results=await Promise.allSettled([f.provision(actor,grantId),f.provision(actor,grantId)]);
 assert.ok(results.some(r=>r.status==='fulfilled'));
 const ready=await f.provision(actor,grantId);
 assert.equal(f.calls.filter(c=>c.method==='createUser').length,1);
 assert.equal(f.rows.get(`${target}/members/${ready.uid}`).active,true);
});

test('HTTP CREATE_PRACTICE wires verified session, CSRF, transaction adapter and provider readback',async context=>{
 const {auroraNexusUserProfiles,profileStore}=await import('../src/auroraUserProfileRuntime.js');
 const {auroraAuth,auroraDb}=await import('../src/firebase.js');
 const {csrfTokenForSession,CSRF_PURPOSES}=await import('../src/auroraAccess.js');
 const f=practiceFixture(),cookie='__session=synthetic-cookie',secret='a'.repeat(64);
 const oldAllow=process.env.AURORA_NEXUS_ALLOWED_EMAILS,oldSecret=process.env.AURORA_NEXUS_CSRF_HMAC_KEY;
 process.env.AURORA_NEXUS_ALLOWED_EMAILS='operator@example.invalid';process.env.AURORA_NEXUS_CSRF_HMAC_KEY=secret;
 context.after(()=>{for(const [key,value] of [['AURORA_NEXUS_ALLOWED_EMAILS',oldAllow],['AURORA_NEXUS_CSRF_HMAC_KEY',oldSecret]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}});
 context.mock.method(profileStore,'transaction',f.store.transaction);
 for(const name of ['getUser','createUser','setCustomUserClaims','updateUser','revokeRefreshTokens'] as const)context.mock.method(auroraAuth,name,f.auth[name] as any);
 context.mock.method(auroraAuth,'verifySessionCookie',async()=>({uid:actor.uid,email:'operator@example.invalid',auroraOrgId:actor.orgId,email_verified:true,firebase:{sign_in_second_factor:'totp'}}));
 context.mock.method(auroraDb,'doc',(path:string)=>({get:async()=>({exists:f.rows.has(path),data:()=>f.rows.get(path)})} as any));
 const headers:any={cookie,'content-type':'application/json','sec-fetch-site':'same-origin','x-aurora-csrf':csrfTokenForSession(cookie,secret,CSRF_PURPOSES.userProfile)};
 let status=200,result:any;const res:any={on:()=>res,set:()=>res,setHeader:()=>res,status:(v:number)=>{status=v;return res;},json:(v:any)=>{result=v;return res;}};
 await auroraNexusUserProfiles({method:'POST',body:{action:'CREATE_PRACTICE',grantId},get:(key:string)=>headers[key]} as any,res);
 assert.equal(status,200);assert.equal(result.orgId,'synthetic-practice');assert.equal(result.loginPath,'/portal');
 assert.equal(f.rows.get(target).active,true);assert.equal(result.activationState,'USER_EMAIL_AND_MFA_REQUIRED');
 const before=structuredClone([...f.rows]),calls=f.calls.length;
 await auroraNexusUserProfiles({method:'GET',query:{practiceGrantId:grantId},get:(key:string)=>headers[key]} as any,res);
 assert.equal(status,200);assert.equal(result.state,'READY');assert.equal(result.engineVersion,'0.1.3');
 assert.deepEqual([...f.rows],before);assert.equal(f.calls.length,calls);
 await auroraNexusUserProfiles({method:'GET',query:{practiceGrantId:[grantId]},get:(key:string)=>headers[key]} as any,res);
 assert.equal(status,400);assert.equal(result.code,'INVALID_SYNC_REQUEST');
});
