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
  return { rows,users,calls,failures,engine:createProfileEngine(store,auth,()=>time), advance:(ms=181_000)=>{time+=ms;}, hook:(fn:typeof hook)=>{hook=fn;} };
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

const onboarding = { jobTitle:'Faturista', duties:['Conferir contas','Organizar prazos'], managerUid:actor.uid, welcomeDueHours:24 };
const welcomedRequest = {...request,onboarding};
const welcomedIdentity = profileIdentity(actor,normalizeProfileRequest(welcomedRequest));
const welcomedMember = `${base}/members/${welcomedIdentity.uid}`;
const welcomedOp = `${base}/apiIdempotency/${welcomedIdentity.operationId}`;
const welcomeId = `welcome-${welcomedIdentity.operationId.slice(8)}`;
const welcomeAction = `${base}/actionItems/${welcomeId}`;
const welcomeInput = `${base}/managerInputs/${welcomeId}`;

test('optional onboarding uses a closed bounded schema and canonical duties',()=>{
  const normalized=normalizeProfileRequest({...request,onboarding:{...onboarding,jobTitle:'  Faturista  ',duties:['Organizar   prazos',' Conferir contas ']}});
  assert.deepEqual(normalized.onboarding,onboarding);
  assert.equal(profileIdentity(actor,normalized).fingerprint,welcomedIdentity.fingerprint);
  for(const change of [null,[],{}, {...onboarding,role:'org_admin'}, {...onboarding,jobTitle:''}, {...onboarding,jobTitle:'<admin>'},
    {...onboarding,jobTitle:'x'.repeat(81)}, {...onboarding,duties:[]}, {...onboarding,duties:['Conferir contas',' Conferir contas ']},
    {...onboarding,duties:['x'.repeat(161)]}, {...onboarding,duties:Array.from({length:21},(_,i)=>`Atribuição ${i}`)},
    {...onboarding,managerUid:'../other'}, {...onboarding,managerUid:''}, {...onboarding,welcomeDueHours:0},
    {...onboarding,welcomeDueHours:721}, {...onboarding,welcomeDueHours:1.5}, {...onboarding,welcomeDueHours:'24'}]) {
    assert.throws(()=>normalizeProfileRequest({...request,onboarding:change}),rejects('INVALID_ONBOARDING'));
  }
});

test('legacy CREATE keeps its claims, response and collections unchanged',async()=>{
  const f=fixture();const result=await f.engine.create(actor,request);
  assert.equal('onboardingRequired' in result,false);assert.equal('onboarding' in f.rows.get(memberPath),false);
  assert.equal('auroraOnboardingRequired' in f.users.get(identity.uid).customClaims,false);
  assert.equal([...f.rows.keys()].some(path=>/\/(actionItems|managerInputs)\//.test(path)),false);
});

test('onboarding is INVITED from first PENDING membership, keeps explicit role and binds welcome SLA to manager',async()=>{
  const f=fixture();let checked=0;
  f.hook(async(method,data)=>{if(method==='createUser'||(method==='updateUser'&&!data.disabled)) {
    const member=f.rows.get(welcomedMember);assert.equal(member.active,false);assert.equal(member.profileState,'PENDING');
    assert.equal(member.onboardingRequired,true);assert.equal(member.onboardingState,'INVITED');checked++;
  }});
  const result=await f.engine.create(actor,welcomedRequest);
  assert.equal(checked,2);assert.equal(result.onboardingState,'INVITED');assert.equal(result.activationState,'INVITATION_EMAIL_AND_MFA_REQUIRED');
  assert.equal(f.rows.get(welcomedMember).active,true);assert.equal(f.rows.get(welcomedMember).role,'viewer');
  assert.deepEqual(f.rows.get(welcomedMember).permissions,[]);assert.deepEqual(f.rows.get(welcomedMember).onboarding,onboarding);
  assert.equal(f.users.get(welcomedIdentity.uid).customClaims.auroraOnboardingRequired,true);
  const action=f.rows.get(welcomeAction);const input=f.rows.get(welcomeInput);
  assert.equal(action.targetType,'managementInput');assert.equal(action.targetId,welcomeId);assert.equal(action.assignedToUid,actor.uid);
  assert.equal(action.subjectUid,welcomedIdentity.uid);assert.equal(action.profileOperationId,welcomedIdentity.operationId);
  assert.equal(action.status,'OPEN');assert.equal(action.revision,1);assert.equal(input.state,'OPEN');
  assert.equal(Date.parse(action.dueAt)-Date.parse(f.rows.get(welcomedOp).createdAtUtc),24*3_600_000);
  assert.equal(action.competence,f.rows.get(welcomedOp).createdAtUtc.slice(0,7));assert.equal(result.welcomeActionId,welcomeId);
  assert.equal([...f.rows.keys()].filter(path=>path.includes('/auditEvents/')).length,1);
});

test('job title and duties never confer administrative privileges',async()=>{
  const f=fixture();const changed={...request,onboarding:{...onboarding,jobTitle:'Master org_admin',duties:['Todos os acessos administrativos']}};
  const id=profileIdentity(actor,normalizeProfileRequest(changed));await f.engine.create(actor,changed);
  assert.equal(f.rows.get(`${base}/members/${id.uid}`).role,'viewer');assert.deepEqual(f.rows.get(`${base}/members/${id.uid}`).permissions,[]);
  assert.equal('role' in f.users.get(id.uid).customClaims,false);
});

for(const scenario of ['missing','inactive','other organization','invited']) test(`manager ${scenario} rejects before Auth changes`,async()=>{
  const f=fixture();const managerUid='legacy-manager-uid';const changed={...request,onboarding:{...onboarding,managerUid}};
  if(scenario==='inactive') f.rows.set(`${base}/members/${managerUid}`,{active:false});
  if(scenario==='other organization') f.rows.set(`organizations/other-company/members/${managerUid}`,{active:true});
  if(scenario==='invited') f.rows.set(`${base}/members/${managerUid}`,{active:true,onboardingRequired:true,onboardingState:'INVITED'});
  await assert.rejects(f.engine.create(actor,changed),rejects('PROFILE_MANAGER_NOT_ACTIVE'));assert.equal(f.calls.length,0);
  assert.equal([...f.rows.keys()].some(path=>path.includes('/apiIdempotency/')||path.includes('/actionItems/')),false);
});

test('a live legacy manager UID is supported without assigning the manager role to the employee',async()=>{
  const f=fixture();const managerUid='legacy-manager-uid';f.rows.set(`${base}/members/${managerUid}`,{active:true,role:'operator'});
  const result=await f.engine.create(actor,{...request,onboarding:{...onboarding,managerUid}});
  assert.equal(f.rows.get(`${base}/members/${result.uid}`).role,'viewer');
  assert.equal(f.rows.get(`${base}/actionItems/${result.welcomeActionId}`).assignedToUid,managerUid);
});

test('welcome deadline and completed enrollment survive delayed CREATE replay without duplicate writes',async()=>{
  const f=fixture();await f.engine.create(actor,welcomedRequest);
  const dueAt=f.rows.get(welcomeAction).dueAt;const writes=f.calls.filter(call=>call.method!=='getUser').length;
  Object.assign(f.rows.get(welcomeAction),{status:'RESOLVED',revision:3});f.rows.get(welcomedMember).onboardingState='COMPLETE';
  f.advance(48*3_600_000);const result=await f.engine.create(actor,welcomedRequest);
  assert.equal(result.idempotent,true);assert.equal(result.onboardingState,'COMPLETE');assert.equal(f.rows.get(welcomeAction).status,'RESOLVED');
  assert.equal(f.rows.get(welcomeAction).revision,3);assert.equal(f.rows.get(welcomeAction).dueAt,dueAt);
  assert.equal(f.calls.filter(call=>call.method!=='getUser').length,writes);
  assert.equal([...f.rows.keys()].filter(path=>path.includes('/actionItems/')).length,1);
});

test('interrupted onboarding resumes INVITED with SLA measured from original request',async()=>{
  const f=fixture();f.failures.set('claims',1);
  await assert.rejects(f.engine.create(actor,welcomedRequest),rejects('PROFILE_PROVISIONING_INTERRUPTED'));
  assert.equal(f.rows.get(welcomedMember).active,false);assert.equal(f.rows.get(welcomedMember).onboardingState,'INVITED');
  assert.equal(f.rows.has(welcomeAction),false);const createdAt=f.rows.get(welcomedOp).createdAtUtc;f.advance(3*3_600_000);
  await f.engine.create(actor,welcomedRequest);assert.equal(Date.parse(f.rows.get(welcomeAction).dueAt)-Date.parse(createdAt),24*3_600_000);
  assert.equal(f.calls.filter(call=>call.method==='createUser').length,1);
});

test('manager revocation during Auth call leaves onboarding inactive without welcome task',async()=>{
  const f=fixture();const managerUid='legacy-manager-uid';f.rows.set(`${base}/members/${managerUid}`,{active:true});
  const changed={...request,onboarding:{...onboarding,managerUid}};const id=profileIdentity(actor,normalizeProfileRequest(changed));
  f.hook(async(method,data)=>{if(method==='updateUser'&&!data.disabled) f.rows.get(`${base}/members/${managerUid}`).active=false;});
  await assert.rejects(f.engine.create(actor,changed),rejects('PROFILE_MANAGER_NOT_ACTIVE'));
  assert.equal(f.rows.get(`${base}/members/${id.uid}`).active,false);assert.equal(f.rows.get(`${base}/members/${id.uid}`).onboardingState,'INVITED');
  assert.equal([...f.rows.keys()].some(path=>path.includes('/actionItems/')||path.includes('/auditEvents/')),false);
});

test('onboarding payload change, altered metadata or claim, and missing welcome task require review',async()=>{
  const f=fixture();await f.engine.create(actor,welcomedRequest);
  await assert.rejects(f.engine.create(actor,{...request,onboarding:{...onboarding,welcomeDueHours:48}}),rejects('PROFILE_REQUEST_CONFLICT'));
  f.rows.get(welcomedMember).onboarding.jobTitle='Secretário';await assert.rejects(f.engine.create(actor,welcomedRequest),rejects('PROFILE_REQUIRES_REVIEW'));
  f.rows.get(welcomedMember).onboarding.jobTitle=onboarding.jobTitle;delete f.users.get(welcomedIdentity.uid).customClaims.auroraOnboardingRequired;
  await assert.rejects(f.engine.create(actor,welcomedRequest),rejects('PROFILE_REQUIRES_REVIEW'));
  f.users.get(welcomedIdentity.uid).customClaims.auroraOnboardingRequired=true;f.rows.delete(welcomeAction);
  await assert.rejects(f.engine.create(actor,welcomedRequest),rejects('PROFILE_WELCOME_TASK_CONFLICT'));
});

test('welcome identity collision is rejected rather than overwritten or repaired',async()=>{
  const f=fixture();f.rows.set(welcomeAction,{orgId:'other-company',status:'OPEN',revision:1});
  await assert.rejects(f.engine.create(actor,welcomedRequest),rejects('PROFILE_WELCOME_TASK_CONFLICT'));
  assert.equal(f.rows.get(welcomeAction).orgId,'other-company');assert.equal(f.calls.length,0);assert.equal(f.rows.has(welcomedMember),false);
});

test('onboarding revocation remains closed on replay and retains welcome evidence',async()=>{
  const f=fixture();await f.engine.create(actor,welcomedRequest);await f.engine.revoke(actor,welcomedIdentity.uid);
  assert.equal(f.rows.get(welcomedMember).onboardingState,'REVOKED');assert.equal(f.rows.get(welcomedMember).active,false);
  assert.equal(f.rows.has(welcomeAction),true);await assert.rejects(f.engine.create(actor,welcomedRequest),rejects('PROFILE_REVOKED'));
});
