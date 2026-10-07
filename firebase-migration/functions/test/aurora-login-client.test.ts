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
async function fixture(managed=true, sessionLoginResponse:any={ok:true,json:async()=>({})}) {
  const elements=new Map<string,Element>();const el=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!;};
  const calls:any[]=[]; const redirects:string[]=[];let claims:any=managed?{auroraProfileVersion:1}:{};
  const user={emailVerified:false,getIdToken:async()=> 'synthetic-id-token'};
  let signIn:any=async()=>({user});
  const factors:any[]=[]; const winHandlers=new Map();
  const sandbox={document:{getElementById:el,createElement:()=>new Element()},window:{addEventListener:(n:string,h:any)=>winHandlers.set(n,h)},navigator:{},location:{replace:(path:string)=>redirects.push(path)},
    fetch:async(url:string,options:any)=>{calls.push({name:'fetch',url,options});return url==='/__sessionLogin'?sessionLoginResponse:{ok:true,json:async()=>({})};},
    initializeApp:()=>({}),getAuth:()=>({}),setPersistence:async()=>{},inMemoryPersistence:{},
    signInWithEmailAndPassword:async()=>signIn(),getIdTokenResult:async()=>({claims}),signOut:async()=>{calls.push({name:'signOut'});},
    sendPasswordResetEmail:async()=>{calls.push({name:'reset'});},sendEmailVerification:async()=>{calls.push({name:'verify'});},reload:async()=>{},
    multiFactor:()=>({enrolledFactors:factors,getSession:async()=>({}),enroll:async()=>{calls.push({name:'enroll'});}}),
    getMultiFactorResolver:()=>({hints:[{factorId:'totp',uid:'synthetic-factor'}],resolveSignIn:async()=>{claims={...claims,firebase:{sign_in_second_factor:'totp'}};return {user};}}),
    TotpMultiFactorGenerator:{FACTOR_ID:'totp',assertionForSignIn:()=>({}),assertionForEnrollment:()=>({}),generateSecret:async()=>({secretKey:'SYNTHETIC-NOT-A-SECRET'})}};
  const executable=ts.transpileModule(script,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  // Strip only static SDK imports; all behavior below is the emitted product code.
  const withoutImports=script.replace(/^import[\s\S]*?from 'https:\/\/[^']+';\n/gm,'');
  assert.ok(executable); const context=createContext(sandbox);
  await new Script('(async()=>{'+withoutImports+'})()').runInContext(context);
  return {el,calls,redirects,user,factors,winHandlers,claims:(value:any)=>{claims=value;},signIn:(fn:any)=>{signIn=fn;},async click(id:string){await el(id).handlers.get('click')();},async submit(){await el('login-form').handlers.get('submit')({preventDefault(){}});}};
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
  assert.deepEqual(f.redirects,['/synthetic-company']);
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

test('admin profile shell script parses; unprivileged or first-factor sessions get no profile controls',()=>{
  const member={uid:'synthetic',email:'synthetic@example.invalid',orgId:'synthetic-company',role:'org_admin',permissions:[],facilityIds:[],allFacilities:true,mfaVerified:true};
  const csrf={action:'a',refresh:'b',integrationKey:'c',distributionApproval:'d',logout:'e',userProfile:'f'};
  const html=auroraProtectedShell(member,csrf);
  assert.match(html,/id="user-profile-form"/);for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Script(match[1]));
  for(const patch of [{role:'viewer'},{mfaVerified:false},{allFacilities:false}])assert.doesNotMatch(auroraProtectedShell({...member,...patch},csrf),/id="user-profile-form"/);
});
