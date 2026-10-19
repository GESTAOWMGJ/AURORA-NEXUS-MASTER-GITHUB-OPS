import assert from 'node:assert/strict';
import test from 'node:test';
import { Script,createContext } from 'node:vm';
import ts from 'typescript';
import { loginClient } from '../src/auroraLoginClient.js';
import { auroraProtectedShell } from '../src/auroraFrontend.js';

const script=loginClient('synthetic-company');
class Element {
  value='';textContent='';hidden=false;disabled=false;checked=false;required=false;children:Element[]=[]; handlers=new Map<string,any>();
  parentElement:Element|null=null; cssHidden=false; ownerDocument?:{activeElement:Element|null};
  nativeValid=true; requestSubmitCalls=0; submitTasks:Promise<unknown>[]=[]; nativeSubmitPrevented:boolean[]=[];
  addEventListener(event:string,handler:any){this.handlers.set(event,handler);}
  replaceChildren(){this.children=[];}
  appendChild(child:Element){child.parentElement=this;this.children.push(child);}
  closest(selector:string):Element|null{for(let node:Element|null=this;node;node=node.parentElement)if(selector==='[hidden]'&&node.hidden)return node;return null;}
  getClientRects():object[]{return this.hidden||this.cssHidden||this.parentElement?.getClientRects().length===0?[]:[{}];}
  focus(){if(!this.disabled&&this.getClientRects().length&&this.ownerDocument)this.ownerDocument.activeElement=this;}
  requestSubmit(){
    this.requestSubmitCalls++;if(!this.nativeValid)return;
    let prevented=false;const task=this.handlers.get('submit')({preventDefault(){prevented=true;}});
    this.nativeSubmitPrevented.push(prevented);this.submitTasks.push(Promise.resolve(task));
  }
}
async function fixture(managed=true, sessionLoginResponse:any={ok:true,status:204,json:async()=>({})}) {
  const document={activeElement:null as Element|null,body:new Element(),getElementById:(id:string)=>el(id),createElement:()=>new Element()};
  const parents:Record<string,string>={email:'login-form',password:'login-form',submit:'login-form','open-password-recovery':'login-form','mfa-form':'mfa-panel','mfa-code':'mfa-form','mfa-factor':'mfa-form','mfa-submit':'mfa-form','mfa-login-again':'mfa-form','recovery-email':'password-recovery-panel','recovery-link':'password-recovery-panel','verify-recovery-link':'password-recovery-panel','recovery-back':'password-recovery-panel','new-password-form':'password-recovery-panel','recovery-new-password':'new-password-form','recovery-confirm-password':'new-password-form'};
  const elements=new Map<string,Element>();const el=(id:string):Element=>{if(!elements.has(id)){const node=new Element();node.ownerDocument=document;elements.set(id,node);if(parents[id])node.parentElement=el(parents[id]);}return elements.get(id)!;};
  for(const id of ['mfa-panel','mfa-login-again','activation-panel','onboarding-panel','password-recovery-panel','new-password-form','totp-setup','enrollment-input'])el(id).hidden=true;
  const calls:any[]=[]; const redirects:string[]=[];let claims:any=managed?{auroraProfileVersion:1}:{};
  const user={emailVerified:false,getIdToken:async(forceRefresh:boolean)=>{calls.push({name:'getIdToken',forceRefresh});return 'synthetic-id-token';}};
  let signIn:any=async()=>({user}); let redemption:any={ok:true,json:async()=>({})};
  let currentSessionResponses=Array.isArray(sessionLoginResponse)?[...sessionLoginResponse]:[sessionLoginResponse];
  const factors:any[]=[]; const winHandlers=new Map();
  const sandbox={URL,URLSearchParams,history:{replaceState:()=>{}},document,window:{addEventListener:(n:string,h:any)=>{const previous=winHandlers.get(n);winHandlers.set(n,()=>{previous?.();h();});}},navigator:{},
    location:{origin:'https://auroranexus.com.br',hostname:'auroranexus.com.br',pathname:'/portal',search:'',replace:(path:string)=>redirects.push(path)},
    fetch:async(url:string,options:any)=>{calls.push({name:'fetch',url,options});if(url==='/__sessionLogin'){const value=currentSessionResponses.length>1?currentSessionResponses.shift():currentSessionResponses[0];return typeof value==='function'?await value():value;}return url==='/api/user-profiles'?(typeof redemption==='function'?await redemption():redemption):{ok:true,status:200,json:async()=>({})};},
    initializeApp:()=>({}),getAuth:()=>({languageCode:null}),setPersistence:async()=>{},inMemoryPersistence:{},
    signInWithEmailAndPassword:async(_auth:any,email:string)=>{calls.push({name:'passwordSignIn',email});return signIn();},getIdTokenResult:async()=>({claims}),signOut:async()=>{calls.push({name:'signOut'});},
    sendPasswordResetEmail:async(_auth:any,email:string)=>{calls.push({name:'reset',email});},sendEmailVerification:async()=>{calls.push({name:'verify'});},reload:async()=>{},
    multiFactor:()=>({enrolledFactors:factors,getSession:async()=>({}),enroll:async()=>{calls.push({name:'enroll'});}}),
    getMultiFactorResolver:()=>({hints:[{factorId:'totp',uid:'synthetic-factor'}],resolveSignIn:async()=>{calls.push({name:'resolveMfa'});const credential=await resolveMfa();claims={...claims,firebase:{sign_in_second_factor:'totp'}};return credential;}}),
    TotpMultiFactorGenerator:{FACTOR_ID:'totp',assertionForSignIn:()=>({}),assertionForEnrollment:()=>({}),generateSecret:async()=>({secretKey:'SYNTHETIC-NOT-A-SECRET'})}};
  let resolveMfa:any=async()=>({user});
  const executable=ts.transpileModule(script,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  // Strip only static SDK imports; all behavior below is the emitted product code.
  const withoutImports=script.replace(/^import[\s\S]*?from 'https:\/\/[^']+';\n/gm,'');
  assert.ok(executable); const context=createContext(sandbox);
  await new Script('(async()=>{'+withoutImports+'})()').runInContext(context);
  return {el,document,calls,redirects,user,factors,winHandlers,claims:(value:any)=>{claims=value;},sessionResponse:(value:any)=>{currentSessionResponses=[value];},redemption:(value:any)=>{redemption=value;},signIn:(fn:any)=>{signIn=fn;},resolveMfa:(fn:any)=>{resolveMfa=fn;},async click(id:string){el(id).focus();await el(id).handlers.get('click')();},async submit(){await el('login-form').handlers.get('submit')({preventDefault(){}});},async submitMfa(){let prevented=false;await el('mfa-form').handlers.get('submit')({preventDefault(){prevented=true;}});assert.equal(prevented,true);},async keyMfa(options:Record<string,unknown>={}){const form=el('mfa-form'),before=form.submitTasks.length;let prevented=false;el('mfa-code').handlers.get('keydown')({key:'Enter',isComposing:false,repeat:false,...options,preventDefault(){prevented=true;}});await Promise.all(form.submitTasks.slice(before));return prevented;}};
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
  assert.equal(f.document.activeElement,f.el('password'));
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();await f.submitMfa();
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
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();await f.submitMfa();
  assert.equal(f.el('mfa-status').textContent,'Conta autenticada, mas ainda sem vínculo operacional provisionado na organização.');
  assert.equal(f.redirects.length,0);
});

test('password submission reveals and focuses the MFA code without issuing an app session',async()=>{
  const f=await fixture();f.el('email').value='synthetic@example.invalid';f.el('password').value='synthetic-password';f.el('password').focus();
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();
  assert.equal(f.el('login-form').hidden,true);assert.equal(f.el('mfa-panel').hidden,false);
  assert.equal(f.document.activeElement,f.el('mfa-code'));assert.equal(f.el('password').value,'');
  assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),false);
  assert.equal(f.el('mfa-submit').handlers.has('click'),false);
});

test('MFA form submission preserves invalid-code retry and accepts only one concurrent confirmation',async()=>{
  const f=await fixture();f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();f.el('mfa-code').value='123456';
  f.resolveMfa(async()=>{throw Error('synthetic-provider-detail');});await f.submitMfa();
  assert.equal(f.el('mfa-submit').disabled,false);assert.equal(f.el('mfa-code').value,'123456');
  assert.match(f.el('mfa-status').textContent,/Segundo fator inválido ou expirado/);
  assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),false);
  let resolve!:(value:any)=>void;const pending=new Promise(r=>{resolve=r;});f.resolveMfa(()=>pending);
  const first=f.submitMfa();assert.equal(f.el('mfa-submit').disabled,true);await f.submitMfa();
  assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,2);
  resolve({user:f.user});await first;
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,1);
  assert.equal(f.el('mfa-code').value,'');assert.deepEqual(f.redirects,['/portal']);
});

test('Enter in the focused MFA code requests the same native form and opens one private session',async()=>{
  const f=await fixture();f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();
  assert.equal(f.document.activeElement,f.el('mfa-code'));f.el('mfa-code').value='123456';
  assert.equal(await f.keyMfa(),true);
  assert.equal(f.el('mfa-form').requestSubmitCalls,1);assert.deepEqual(f.el('mfa-form').nativeSubmitPrevented,[true]);
  assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1);
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,1);
  assert.equal(f.el('mfa-code').value,'');assert.deepEqual(f.redirects,['/portal']);
});

test('MFA Enter leaves composing and unrelated keys alone before accepting a completed code',async()=>{
  const f=await fixture();f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();f.el('mfa-code').value='123456';
  for(const event of [{key:'Tab'},{isComposing:true},{keyCode:229}])assert.equal(await f.keyMfa(event),false);
  assert.equal(f.el('mfa-form').requestSubmitCalls,0);assert.equal(f.calls.some(c=>c.name==='resolveMfa'),false);
  assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),false);
  assert.equal(await f.keyMfa(),true);assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1);
});

test('held Enter suppresses implicit repeats without starting MFA authentication',async()=>{
  const f=await fixture();f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();f.el('mfa-code').value='123456';
  assert.equal(await f.keyMfa({repeat:true}),true);assert.equal(await f.keyMfa({repeat:true}),true);
  assert.equal(f.el('mfa-form').requestSubmitCalls,0);assert.equal(f.calls.some(c=>c.name==='resolveMfa'),false);
  assert.equal(f.el('mfa-submit').disabled,false);assert.equal(f.el('mfa-code').value,'123456');
  await f.keyMfa();assert.equal(f.el('mfa-form').requestSubmitCalls,1);
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,1);
});

test('Enter preserves the native validity gate instead of invoking the MFA resolver directly',async()=>{
  const f=await fixture();f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();
  f.el('mfa-form').nativeValid=false;assert.equal(await f.keyMfa(),true);
  assert.equal(f.el('mfa-form').requestSubmitCalls,1);assert.equal(f.el('mfa-form').submitTasks.length,0);
  assert.equal(f.calls.some(c=>c.name==='resolveMfa'),false);assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),false);
  f.el('mfa-code').value='123456';f.el('mfa-form').nativeValid=true;await f.keyMfa();
  assert.equal(f.el('mfa-form').requestSubmitCalls,2);assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1);
});

test('pending Enter confirmation blocks keyboard repeats and concurrent submits then permits rejected-code retry',async()=>{
  const f=await fixture();f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();f.el('mfa-code').value='123456';
  let reject!:(error:Error)=>void;f.resolveMfa(()=>new Promise((_resolve,rejected)=>{reject=rejected;}));
  const first=f.keyMfa();assert.equal(f.el('mfa-submit').disabled,true);
  assert.equal(await f.keyMfa({repeat:true}),true);assert.equal(await f.keyMfa(),true);await f.submitMfa();
  assert.equal(f.el('mfa-form').requestSubmitCalls,1);assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1);
  reject(Error('synthetic-invalid-code'));await first;
  assert.equal(f.el('mfa-submit').disabled,false);assert.match(f.el('mfa-status').textContent,/Segundo fator inválido ou expirado/);
  assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),false);assert.equal(f.el('mfa-code').value,'123456');
  f.resolveMfa(async()=>({user:f.user}));await f.keyMfa();
  assert.equal(f.el('mfa-form').requestSubmitCalls,2);assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,2);
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,1);assert.deepEqual(f.redirects,['/portal']);
});

test('MFA network failure preserves retry without claiming an invalid code or exposing provider details',async()=>{
  const f=await fixture();f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();
  f.el('mfa-code').value='123456';
  f.resolveMfa(async()=>{throw Object.assign(Error('sensitive-provider-network-detail'),{code:'auth/network-request-failed'});});
  await f.keyMfa();
  assert.match(f.el('mfa-status').textContent,/Confira a conexão/);
  assert.doesNotMatch(f.el('mfa-status').textContent,/inválido|expirado|sensitive-provider/);
  assert.equal(f.el('mfa-submit').disabled,false);assert.equal(f.el('mfa-code').value,'123456');
  assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),false);assert.equal(f.redirects.length,0);
});

test('late MFA response does not take focus away from an explicitly opened recovery flow',async()=>{
  const f=await fixture();let reject!:(error:any)=>void;
  f.signIn(()=>new Promise((_resolve,rejected)=>{reject=rejected;}));f.el('password').focus();
  const login=f.submit();await f.click('open-password-recovery');
  assert.equal(f.document.activeElement,f.el('recovery-email'));
  reject({code:'auth/multi-factor-auth-required'});await login;
  assert.equal(f.document.activeElement,f.el('recovery-email'));
  assert.equal(f.calls.some(c=>c.url==='/__sessionLogin'),false);
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

test('accepted MFA session failures retain a memory-only retry and never label the code invalid',async()=>{
  const cases=[
    {name:'temporary',response:{ok:false,status:503,json:async()=>({code:'TEMPORARY'})},message:/sessão está temporariamente indisponível/,posts:2},
    {name:'cross-site',response:{ok:false,status:403,json:async()=>({code:'CROSS_SITE_LOGIN_REJECTED'})},message:/neste endereço/,posts:1},
    {name:'invalid-login',response:{ok:false,status:401,json:async()=>({code:'INVALID_LOGIN'})},message:/serviço não conseguiu validar a sessão/,posts:1},
    {name:'upstream-html',response:{ok:false,status:403,json:async()=>{throw Error('sensitive-upstream-html');}},message:/serviço recusou a abertura da sessão/,posts:1},
    {name:'unknown',response:{ok:false,status:409,json:async()=>({code:'sensitive-provider-detail'})},message:/não foi possível abrir a sessão/,posts:1}
  ];
  for(const item of cases){
    const f=await fixture(true,item.response);f.user.emailVerified=true;
    f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();f.el('mfa-code').value='123456';await f.submitMfa();
    assert.match(f.el('mfa-status').textContent,item.message,item.name);
    assert.doesNotMatch(f.el('mfa-status').textContent,/inválido|expirado|autorização do ambiente|sensitive/);
    assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1);
    assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,item.posts);
    assert.equal(f.el('mfa-code').value,'');assert.equal(f.el('mfa-code').disabled,true);assert.equal(f.el('mfa-code').required,false);
    assert.equal(f.el('mfa-factor').disabled,true);assert.equal(f.el('mfa-submit').textContent,'Tentar abrir sessão');
    assert.equal(f.el('mfa-login-again').hidden,false);assert.equal(f.redirects.length,0);
    f.sessionResponse({ok:true,status:204,json:async()=>({})});await f.submitMfa();
    assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1,'session retry does not consume another MFA assertion');
    assert.equal(f.calls.filter(c=>c.name==='getIdToken').length,2);assert.ok(f.calls.filter(c=>c.name==='getIdToken').every(c=>c.forceRefresh===true));
    const posts=f.calls.filter(c=>c.url==='/__sessionLogin');assert.equal(posts.length,item.posts+1);
    assert.ok(posts.every(c=>JSON.parse(c.options.body).orgId==='synthetic-company'));
    assert.deepEqual(f.redirects,['/portal']);
  }
});

test('session retry preserves explicit access denials without automatically retrying or bypassing them',async()=>{
  for(const [code,message] of [['EMAIL_NOT_ALLOWED',/lista autorizada/],['MEMBERSHIP_NOT_PROVISIONED',/sem vínculo operacional/],['COMPANY_ACCESS_DENIED',/empresa selecionada/]] as const){
    const f=await fixture(true,{ok:false,status:403,json:async()=>({code})});f.user.emailVerified=true;
    f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();await f.submitMfa();
    assert.match(f.el('mfa-status').textContent,message);assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,1);
    await f.submitMfa();
    assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1);assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,2);
    assert.match(f.el('mfa-status').textContent,message);assert.equal(f.redirects.length,0);
  }
});

test('retry after session transport loss refreshes the token without resolving MFA again',async()=>{
  const f=await fixture(true,async()=>{throw Error('sensitive-network-detail');});f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();await f.submitMfa();
  assert.match(f.el('mfa-status').textContent,/sessão está temporariamente indisponível/);
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,2);
  f.sessionResponse({ok:true,status:204,json:async()=>({})});await f.submitMfa();
  assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1);assert.deepEqual(f.redirects,['/portal']);
});

test('accepted MFA session retry serializes concurrent attempts and offers fresh login',async()=>{
  const f=await fixture(true,{ok:false,status:401,json:async()=>({code:'INVALID_LOGIN'})});f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();await f.submitMfa();
  let resolve!:(value:any)=>void;f.sessionResponse(()=>new Promise(r=>{resolve=r;}));
  const pending=f.submitMfa();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.el('mfa-submit').disabled,true);assert.equal(f.el('mfa-login-again').disabled,true);
  await f.submitMfa();await f.click('mfa-login-again');
  assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,1);
  resolve({ok:false,status:401,json:async()=>({code:'INVALID_LOGIN'})});await pending;
  await f.click('mfa-login-again');
  assert.equal(f.el('mfa-panel').hidden,true);assert.equal(f.el('login-form').hidden,false);
  assert.equal(f.el('mfa-code').disabled,false);assert.equal(f.el('mfa-code').required,true);
  assert.equal(f.el('mfa-submit').textContent,'Confirmar segundo fator');assert.equal(f.el('mfa-login-again').hidden,true);
  assert.equal(f.document.activeElement,f.el('password'));
  f.sessionResponse({ok:false,status:401,json:async()=>({code:'INVALID_LOGIN'})});
  await f.submit();await f.submitMfa();
  assert.equal(f.calls.filter(c=>c.name==='resolveMfa').length,2,'fresh login requires a new MFA assertion');
});

test('page exit clears a cached session retry and ignores an MFA result that arrives after exit',async()=>{
  const f=await fixture(true,{ok:false,status:401,json:async()=>({code:'INVALID_LOGIN'})});f.user.emailVerified=true;
  f.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await f.submit();await f.submitMfa();
  f.winHandlers.get('pagehide')();await f.submitMfa();
  assert.equal(f.calls.filter(c=>c.url==='/__sessionLogin').length,1);assert.equal(f.el('mfa-login-again').hidden,true);
  const late=await fixture();late.user.emailVerified=true;
  late.signIn(async()=>{throw {code:'auth/multi-factor-auth-required'};});await late.submit();
  let resolve!:(value:any)=>void;late.resolveMfa(()=>new Promise(r=>{resolve=r;}));const pending=late.submitMfa();
  late.winHandlers.get('pagehide')();resolve({user:late.user});await pending;
  assert.equal(late.calls.some(c=>c.url==='/__sessionLogin'),false);assert.equal(late.el('mfa-login-again').hidden,true);
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
