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
  return { rows,users,calls,failures,engine:createProfileEngine(store,auth,()=>time), advance:()=>{time+=181_000;}, hook:(fn:typeof hook)=>{hook=fn;} };
}

test('provisions within one company, with no password or automatic message; repeats do not duplicate',async()=>{
  const f=fixture(); const result=await f.engine.create(actor,request);
  assert.equal(result.profileState,'READY'); assert.equal(result.deliveryPerformed,false); assert.equal(result.loginPath,'/synthetic-company');
  assert.equal(result.activationState,'USER_EMAIL_AND_MFA_REQUIRED');
  assert.equal(f.rows.get(memberPath).active,true); assert.equal(f.rows.get(memberPath).mfaRequired,true);
  const created=f.calls.find(c=>c.method==='createUser')!.data;
  assert.equal(created.disabled,true); assert.equal(created.emailVerified,false); assert.equal('password' in created,false);
  const firstWrites=f.calls.filter(c=>c.method!=='getUser').length;
  assert.equal((await f.engine.create(actor,request)).idempotent,true);
  assert.equal(f.calls.filter(c=>c.method!=='getUser').length,firstWrites);
  assert.equal([...f.rows.keys()].filter(k=>k.includes('/auditEvents/')).length,1);
  assert.ok([...f.rows.keys()].every(k=>k===base || k.startsWith(base+'/')));
});

test('closed request rejects tenant, arbitrary claims, platform role, and inconsistent facility scopes',()=>{
  for (const change of [{orgId:'other-company'},{uid:'existing'},{password:'forbidden'},{role:'platform_admin'},{claims:{admin:true}},{allFacilities:true},{facilityIds:[]},{facilityIds:['../other']},{facilityIds:['unit-a','unit-a']},{role:'org_admin'},{displayName:'<script>'}]) {
    assert.throws(()=>normalizeProfileRequest({...request,...change}),rejects('INVALID_PROFILE'));
  }
});

test('server MFA, live administrator membership, company opt-in and active facilities are all required',async()=>{
  for(const change of [{mfaVerified:false},{allFacilities:false},{role:'viewer'}]) {
    const f=fixture(); await assert.rejects(f.engine.create({...actor,...change},request),rejects('PROFILE_ADMIN_MFA_REQUIRED')); assert.equal(f.calls.length,0);
  }
  for(const [path,patch,code] of [[base,{userProfilesEnabled:false},'PROFILE_ENGINE_NOT_ENABLED'],[base,{active:false},'PROFILE_ENGINE_NOT_ENABLED'],[`${base}/members/${actor.uid}`,{active:false},'PROFILE_ADMIN_REVOKED'],[`${base}/facilities/unit-a`,{active:false},'PROFILE_FACILITY_NOT_ACTIVE']] as const) {
    const f=fixture(); Object.assign(f.rows.get(path),patch); await assert.rejects(f.engine.create(actor,request),rejects(code)); assert.equal(f.calls.length,0);
  }
});

test('same idempotency key with changed payload conflicts; another tenant has a distinct identity',async()=>{
  const f=fixture(); await f.engine.create(actor,request);
  await assert.rejects(f.engine.create(actor,{...request,role:'operator'}),rejects('PROFILE_REQUEST_CONFLICT'));
  assert.notEqual(profileIdentity({...actor,orgId:'another-company'},normalizeProfileRequest(request)).uid,identity.uid);
});

test('existing email identity is never adopted, assigned claims, enabled or given a new password',async()=>{
  const f=fixture(); f.users.set('existing-person',{uid:'existing-person',email:request.email,disabled:false,customClaims:{auroraOrgId:'another-company'}});
  await assert.rejects(f.engine.create(actor,request),rejects('PROFILE_IDENTITY_ALREADY_EXISTS'));
  assert.equal(f.rows.has(memberPath),false); assert.equal(f.calls.some(c=>['claims','updateUser','revokeTokens'].includes(c.method)),false);
  assert.equal(f.users.get('existing-person').customClaims.auroraOrgId,'another-company');
});

for(const failure of ['claims','updateUser']) test(`interrupted ${failure} resumes the same identity while membership stays closed`,async()=>{
  const f=fixture(); f.failures.set(failure,1);
  await assert.rejects(f.engine.create(actor,request),rejects('PROFILE_PROVISIONING_INTERRUPTED'));
  assert.notEqual(f.rows.get(memberPath)?.active,true); assert.equal(f.rows.get(opPath).status,'PENDING');
  await f.engine.create(actor,request); assert.equal(f.rows.get(memberPath).active,true);
  assert.equal(f.calls.filter(c=>c.method==='createUser').length,1);
});

test('parallel duplicate is rejected during the lease and cannot double provision',async()=>{
  const f=fixture(); let entered!:()=>void, release!:()=>void;
  const reached=new Promise<void>(resolve=>entered=resolve); const gate=new Promise<void>(resolve=>release=resolve);
  f.hook(async method=>{if(method==='createUser'){entered();await gate;}});
  const first=f.engine.create(actor,request); await reached;
  await assert.rejects(f.engine.create(actor,request),rejects('PROFILE_BUSY')); release(); await first;
  assert.equal(f.calls.filter(c=>c.method==='createUser').length,1);
});

test('expired worker cannot activate; retry can resume after expiry',async()=>{
  const f=fixture(); f.hook(async method=>{if(method==='claims') f.advance();});
  await assert.rejects(f.engine.create(actor,request),rejects('PROFILE_LEASE_LOST'));
  assert.notEqual(f.rows.get(memberPath)?.active,true); f.hook(async()=>{});
  await f.engine.create(actor,request); assert.equal(f.rows.get(memberPath).active,true);
});

for(const scenario of ['admin revoked','scope altered','facility disabled']) test(`activation stops when ${scenario} during Firebase Auth call`,async()=>{
  const f=fixture(); f.hook(async(method,data)=>{if(method==='updateUser' && !data.disabled) {
    if(scenario==='admin revoked') f.rows.get(`${base}/members/${actor.uid}`).active=false;
    if(scenario==='scope altered') f.rows.get(memberPath).role='org_admin';
    if(scenario==='facility disabled') f.rows.get(`${base}/facilities/unit-a`).active=false;
  }});
  await assert.rejects(f.engine.create(actor,request)); assert.equal(f.rows.get(memberPath).active,false); assert.equal(f.rows.get(opPath).status,'PENDING');
});

test('revocation closes membership first, survives Auth outage, and cannot be undone by CREATE replay',async()=>{
  const f=fixture(); await f.engine.create(actor,request); f.failures.set('updateUser',1);
  await assert.rejects(f.engine.revoke(actor,identity.uid)); assert.equal(f.rows.get(memberPath).active,false); assert.equal(f.rows.get(opPath).status,'REVOKED');
  await assert.rejects(f.engine.create(actor,request),rejects('PROFILE_REVOKED'));
  await f.engine.revoke(actor,identity.uid); assert.equal(f.users.get(identity.uid).disabled,true);
  assert.equal(f.calls.filter(c=>c.method==='revokeTokens').length,1);
  assert.equal([...f.rows.keys()].filter(k=>k.includes('/auditEvents/')).length,2);
});

test('CREATE replay never re-enables an identity disabled outside the engine',async()=>{
  const f=fixture(); await f.engine.create(actor,request); f.users.get(identity.uid).disabled=true;
  await assert.rejects(f.engine.create(actor,request),rejects('PROFILE_REQUIRES_REVIEW')); assert.equal(f.users.get(identity.uid).disabled,true);
});

test('suspending new enrollments still allows revocation of existing managed users',async()=>{
  const f=fixture();await f.engine.create(actor,request);f.rows.get(base).userProfilesEnabled=false;
  await f.engine.revoke(actor,identity.uid);assert.equal(f.rows.get(memberPath).active,false);
});

test('signed managed profile alone cannot bypass email verification, MFA, state, or tenant',async()=>{
  const f=fixture(); await f.engine.create(actor,request);
  const decoded={email:request.email,email_verified:true,firebase:{sign_in_second_factor:'totp'},...f.users.get(identity.uid).customClaims};
  const member=f.rows.get(memberPath); assert.equal(managedProfileMatches(decoded,member,actor.orgId),true);
  for(const patch of [{email_verified:false},{firebase:{}},{auroraOrgId:'other-company'},{auroraProfileVersion:undefined},{auroraProfileOperation:'forged'},{email:'other@example.invalid'}]) assert.equal(managedProfileMatches({...decoded,...patch},member,actor.orgId),false);
  for(const patch of [{active:false},{profileState:'PENDING'},{profileState:'REVOKED'},{profileOperationId:'forged'}]) assert.equal(managedProfileMatches(decoded,{...member,...patch},actor.orgId),false);
});
