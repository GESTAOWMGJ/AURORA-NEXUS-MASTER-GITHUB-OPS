import assert from 'node:assert/strict';
import test from 'node:test';
import { Script,createContext } from 'node:vm';
import ts from 'typescript';
import { loginClient } from '../src/auroraLoginClient.js';
import { auroraProtectedShell } from '../src/auroraFrontend.js';

const script=loginClient('synthetic-company');
class Element {
  value='';textContent='';hidden=false;disabled=false;checked=false;children:Element[]=[]; handlers=new Map<string,any>();
  addEventListener(event:string,handler:any){this.handlers.set(event,handler);}
  replaceChildren(){this.children=[];}
  appendChild(child:Element){this.children.push(child);}
}
async function fixture(managed=true, sessionLoginResponse:any={ok:true,status:204,json:async()=>({})}, search='') {
  const elements=new Map<string,Element>();const el=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!;};
  const calls:any[]=[]; const redirects:string[]=[];let claims:any=managed?{auroraProfileVersion:1}:{};
  const user={emailVerified:false,getIdToken:async()=> 'synthetic-id-token'};
  let signIn:any=async()=>({user}); let redemption:any={ok:true,json:async()=>({})};
  let currentSessionResponses=Array.isArray(sessionLoginResponse)?[...sessionLoginResponse]:[sessionLoginResponse];
  const factors:any[]=[]; const winHandlers=new Map();
  const sandbox={URL,URLSearchParams,history:{replaceState:(_state:any,_title:any,path:string)=>calls.push({name:'history',path})},document:{getElementById:el,createElement:()=>new Element()},window:{addEventListener:(n:string,h:any)=>{const previous=winHandlers.get(n);winHandlers.set(n,()=>{previous?.();h();});}},navigator:{},
    location:{origin:'https://auroranexus.com.br',hostname:'auroranexus.com.br',pathname:'/portal',search,replace:(path:string)=>redirects.push(path)},
    fetch:async(url:string,options:any)=>{calls.push({name:'fetch',url,options});if(url==='/__sessionLogin'){const value=currentSessionResponses.length>1?currentSessionResponses.shift():currentSessionResponses[0];return typeof value==='function'?await value():value;}return url==='/api/user-profiles'?(typeof redemption==='function'?await redemption():redemption):{ok:true,status:200,json:async()=>({})};},
    initializeApp:()=>({}),getAuth:()=>({languageCode:null}),setPersistence:async()=>{},inMemoryPersistence:{},
    signInWithEmailAndPassword:async(_auth:any,email:string)=>{calls.push({name:'passwordSignIn',email});return signIn();},getIdTokenResult:async()=>({claims}),signOut:async()=>{calls.push({name:'signOut'});},
    verifyPasswordResetCode:async(_auth:any,code:string)=>{calls.push({name:'recoveryVerify',code});return 'synthetic@example.invalid';},confirmPasswordReset:async()=>{},
    sendPasswordResetEmail:async(_auth:any,email:string)=>{calls.push({name:'reset',email});},sendEmailVerification:async()=>{calls.push({name:'verify'});},reload:async()=>{},
    multiFactor:()=>({enrolledFactors:factors,getSession:async()=>({}),enroll:async()=>{calls.push({name:'enroll'});}}),
    getMultiFactorResolver:()=>({hints:[{factorId:'totp',uid:'synthetic-factor'}],resolveSignIn:async()=>{claims={...claims,firebase:{sign_in_second_factor:'totp'}};return {user};}}),
    TotpMultiFactorGenerator:{FACTOR_ID:'totp',assertionForSignIn:()=>({}),assertionForEnrollment:()=>({}),generateSecret:async()=>({secretKey:'SYNTHETIC-NOT-A-SECRET'})}};
  const executable=ts.transpileModule(script,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  // Strip only static SDK imports; all behavior below is the emitted product code.
  const withoutImports=script.replace(/^import[\s\S]*?from 'https:\/\/[^']+';\n/gm,'');
  assert.ok(executable); const context=createContext(sandbox);
  await new Script('(async()=>{'+withoutImports+'})()').runInContext(context);
  return {el,calls,redirects,user,factors,winHandlers,claims:(value:any)=>{claims=value;},sessionResponse:(value:any)=>{currentSessionResponses=[value];},redemption:(value:any)=>{redemption=value;},signIn:(fn:any)=>{signIn=fn;},async click(id:string){await el(id).handlers.get('click')();},async submit(){await el('login-form').handlers.get('submit')({preventDefault(){}});}};
}

test('managed first access does not issue app session or send verification before user action',async()=>{
  const f=await fixture();f.el('password').value='synthetic-password';await f.submit();
  assert.equal(f.el('password').value,'');assert.equal(f.el('activation-panel').hidden,false);
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,0);assert.equal(f.calls.some(c=>c.name==='verify'),false);
  await f.click('verify-email');assert.equal(f.calls.filter(c=>c.name==='verify').length,1);
});

test('enrollment clears secret and requires a fresh MFA login before issuing app session',async()=>{
  const f=await fixture();f.user.emailVerified=true;await f.submit();await f.click('start-totp');
  assert.equal(f.el('enrollment-key').textContent,'SYNTHETIC-NOT-A-SECRET');await f.click('enroll-totp');
  assert.equal(f.el('enrollment-key').textContent,'');assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),false);
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();await f.click('mfa-submit');
  const session=f.calls.find(c=>c.url==='/__sessionLogin');assert.ok(session);
  assert.deepEqual(JSON.parse(session.options.body),{idToken:'synthetic-id-token',orgId:'synthetic-company'});
  assert.deepEqual(f.redirects,['/portal']);
});

test('legacy login remains compatible and explicit setup can opt in to MFA enrollment',async()=>{
  const f=await fixture(false);await f.submit();assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),true);
  const setup=await fixture(false);setup.el('secure-setup').checked=true;await setup.submit();assert.equal(setup.calls.some(c=>c.url==='/__sessionLogin'),false);
});

test('page exit clears enrollment material; bad credentials never display provider details',async()=>{
  const f=await fixture();f.user.emailVerified=true;await f.submit();await f.click('start-totp');f.winHandlers.get('pagehide')();
  assert.equal(f.el('enrollment-key').textContent,'');
  const denied=await fixture();denied.signIn(async()=>{throw new Error('sensitive-provider-detail');});await denied.submit();
  assert.doesNotMatch(denied.el('status').textContent,/sensitive-provider-detail/);
});

test('MFA success separates second-factor errors from authorization provisioning gaps',async()=>{
  const response={ok:false,json:async()=>({code:'MEMBERSHIP_NOT_PROVISIONED'})};
  const f=await fixture(true,response);f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();await f.click('mfa-submit');
  assert.equal(f.el('mfa-status').textContent,'Conta autenticada, mas ainda sem vínculo operacional provisionado na organização.');
  assert.equal(f.redirects.length,0);
});

test('login normalizes email identity before Firebase authentication',async()=>{
  const f=await fixture(false);f.el('email').value='  USER@Example.Invalid  ';f.el('password').value='synthetic-password';await f.submit();
  const call=f.calls.find(c=>c.name==='passwordSignIn');assert.equal(call.email,'user@example.invalid');
});

test('session exchange retries one transient server failure and then continues',async()=>{
  const f=await fixture(false,[{ok:false,status:503,json:async()=>({code:'TEMPORARY'})},{ok:true,status:204,json:async()=>({})}]);
  f.el('email').value='user@example.invalid';f.el('password').value='synthetic-password';await f.submit();
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,2);assert.deepEqual(f.redirects,['/portal']);
});

test('direct recovery query is scrubbed before Firebase initialization and uses strict parsing',async()=>{
  const f=await fixture(false,undefined,'?mode=resetPassword&oobCode=synthetic-code');
  assert.equal(f.calls[0].name,'history');
  assert.equal(f.calls[0].path,'/portal');
  assert.equal(f.calls[1].url,'/__/firebase/init.json');
  assert.deepEqual(f.calls.filter(c=>c.name==='recoveryVerify').map(c=>c.code),['synthetic-code']);
  const invalid=await fixture(false,undefined,'?mode=resetPassword&oobCode=first&oobCode=second');
  assert.equal(invalid.calls[0].name,'history');
  assert.equal(invalid.calls.filter(c=>c.name==='recoveryVerify').length,0);
  assert.match(invalid.el('recovery-status').textContent,/Link inválido/);
});

test('exhausted session 5xx retries report temporary outage rather than invalid login or MFA',async()=>{
  const outage={ok:false,status:503,json:async()=>({code:'ACCESS_LIST_NOT_CONFIGURED'})};
  const f=await fixture(false,[outage,outage]);await f.submit();
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,2);
  assert.match(f.el('status').textContent,/sessão está temporariamente indisponível/);
  assert.equal(f.redirects.length,0);
  const mfa=await fixture(true,[outage,outage]);
  mfa.user.emailVerified=true;
  mfa.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});
  await mfa.submit();await mfa.click('mfa-submit');
  assert.equal(mfa.calls.filter(c=>c.url==='/__sessionLogin').length,2);
  assert.match(mfa.el('mfa-status').textContent,/sessão está temporariamente indisponível/);
  assert.equal(mfa.redirects.length,0);
});

test('authorization denial is terminal and never retried as a transient network failure',async()=>{
  const denied=await fixture(false,{ok:false,status:403,json:async()=>({code:'COMPANY_ACCESS_DENIED'})});
  await denied.submit();
  assert.equal(denied.calls.filter(c=>c.url==='/__sessionLogin').length,1);
  assert.equal(denied.redirects.length,0);
});

test('password recovery normalizes email and suppresses immediate duplicate requests',async()=>{
  const f=await fixture(false);f.el('recovery-email').value='  USER@Example.Invalid  ';await f.click('reset-password');await f.click('reset-password');
  assert.equal(f.calls.filter(c=>c.name==='reset').length,1);assert.equal(f.calls.find(c=>c.name==='reset').email,'user@example.invalid');
});

test('admin profile shell script parses; unprivileged or first-factor sessions get no profile controls',()=>{
  const member={uid:'synthetic',email:'synthetic@example.invalid',orgId:'synthetic-company',role:'org_admin',permissions:[],facilityIds:[],allFacilities:true,mfaVerified:true};
  const csrf={action:'a',refresh:'b',integrationKey:'c',distributionApproval:'d',logout:'e',userProfile:'f'};
  const html=auroraProtectedShell(member,csrf);
  assert.match(html,/id="user-profile-form"/);for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Script(match[1]));
  for(const patch of [{role:'viewer'},{mfaVerified:false},{allFacilities:false}])assert.doesNotMatch(auroraProtectedShell({...member,...patch},csrf),/id="user-profile-form"/);
});

test('emitted onboarding client redeems only after verified email/MFA, clears credential and opens private session',async()=>{
  const f=await fixture(true,{ok:false,json:async()=>({code:'EMAIL_NOT_ALLOWED'})});
  f.user.emailVerified=true; f.claims({auroraProfileVersion:1,auroraOnboardingRequired:true,firebase:{sign_in_second_factor:'totp'}});
  await f.submit(); assert.equal(f.el('onboarding-panel').hidden,false); assert.equal(f.redirects.length,0);
  f.el('registration-password').value='ANX1-'+'A'.repeat(43); f.sessionResponse({ok:true,json:async()=>({})});
  await f.click('onboarding-submit');
  const call=f.calls.find(c=>c.url==='/api/user-profiles');
  assert.deepEqual(JSON.parse(call.options.body),{action:'REDEEM_ONBOARDING',idToken:'synthetic-id-token',registrationPassword:'ANX1-'+'A'.repeat(43)});
  assert.equal(f.el('registration-password').value,''); assert.deepEqual(f.redirects,['/portal']);
});

test('consumed onboarding identity reenters without redeeming a credential; page exit clears invitation input',async()=>{
  const f=await fixture(); f.user.emailVerified=true;
  f.claims({auroraProfileVersion:1,auroraOnboardingRequired:true,firebase:{sign_in_second_factor:'totp'}});
  await f.submit(); assert.deepEqual(f.redirects,['/portal']); assert.equal(f.calls.some(c=>c.url==='/api/user-profiles'),false);
  f.el('registration-password').value='synthetic-one-use'; f.winHandlers.get('pagehide')(); assert.equal(f.el('registration-password').value,'');
});

test('lost redemption response and failed post-consumption session resume without replaying one-use password',async()=>{
  for (const lostResponse of [false,true]) {
    const f=await fixture(true,{ok:false,json:async()=>({code:'EMAIL_NOT_ALLOWED'})});
    f.user.emailVerified=true; f.claims({auroraProfileVersion:1,auroraOnboardingRequired:true,firebase:{sign_in_second_factor:'totp'}});
    await f.submit(); f.el('registration-password').value='ANX1-'+'B'.repeat(43);
    f.redemption(async()=>{if(lostResponse)throw new Error('synthetic-response-lost-after-commit');return {ok:true};});
    await f.click('onboarding-submit'); assert.equal(f.redirects.length,0); assert.equal(f.el('registration-password').value,'');
    f.sessionResponse({ok:true,json:async()=>({})}); await f.click('onboarding-submit');
    assert.deepEqual(f.redirects,['/portal']); assert.equal(f.calls.filter(c=>c.url==='/api/user-profiles').length,1);
  }
});
