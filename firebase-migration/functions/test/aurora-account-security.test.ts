import assert from 'node:assert/strict';
import test from 'node:test';
import {Script, createContext} from 'node:vm';
import {accountSecurityPage} from '../src/auroraAccountSecurity.js';
import {accountSecurityClient} from '../src/auroraAccountSecurityClient.js';

const member = {uid:'synthetic-master', email:'master@example.invalid', orgId:'synthetic-company',
  role:'platform_admin', permissions:[], facilityIds:[], allFacilities:true, mfaVerified:true};
const csrf = 'SYNTHETIC_ORIGINAL_LOGOUT_CSRF';
class Element {
  value=''; textContent=''; hidden=false; disabled=false; children:Element[]=[]; handlers=new Map<string,any>();
  addEventListener(name:string, handler:any) { this.handlers.set(name,handler); }
  replaceChildren() { this.children=[]; this.value=''; }
  appendChild(child:Element) { this.children.push(child); if(!this.value)this.value=child.value; }
}

async function fixture(initialFactors?:any[]) {
  let now = 1700000000000;
  const elements = new Map<string,Element>();
  const el = (id:string) => { if(!elements.has(id))elements.set(id,new Element()); return elements.get(id)!; };
  const calls:any[] = [], redirects:string[] = [], windowHandlers = new Map<string,any>();
  const enrolled:any[] = initialFactors ? structuredClone(initialFactors) : [{uid:'old-totp',factorId:'totp',displayName:'Antigo',enrollmentTime:'2031-10-01T12:00:00Z'},
    {uid:'backup-totp',factorId:'totp',displayName:'Reserva',enrollmentTime:'2031-10-02T12:00:00Z'}, {uid:'phone-factor',factorId:'phone',displayName:'Telefone'}];
  const user = {uid:member.uid,email:member.email,emailVerified:true};
  const auth:any = {currentUser:null};
  let claims:any = {sub:member.uid,aud:'synthetic-project',email:member.email,email_verified:true,
    auth_time:now/1000,firebase:{sign_in_second_factor:'totp'}};
  let signInFailure:any = null, signInDirect=false, mfaFailure:any = null, enrollFailure:any = null, removeFailure:any = null;
  let enrollAfterFailure=false, removeAfterFailure=false, logoutOk=true, configOk=true, reloadFailure=false;
  let generate:any = async () => ({secretKey:'SYNTHETIC_TOTP_SECRET'});
  const resolver = {
    get hints() { return [...enrolled]; },
    resolveSignIn:async(assertion:any) => {
      calls.push({name:'resolveSignIn',factorId:assertion.factorId});
      if(mfaFailure)throw mfaFailure;
      if(!enrolled.some(f=>f.uid===assertion.factorId)||assertion.code!=='123456')throw Error('SENSITIVE_INVALID_OTP');
      auth.currentUser=user; return {user};
    },
  };
  const sandbox = {
    document:{getElementById:el,createElement:()=>new Element()},
    window:{addEventListener:(name:string,handler:any)=>windowHandlers.set(name,handler)},
    location:{replace:(path:string)=>redirects.push(path)}, Date:class extends Date { static override now(){return now;} },
    fetch:async(url:string,options:any) => {
      calls.push({name:'fetch',url,options});
      return url==='/__sessionLogout'?{ok:logoutOk}:{ok:configOk,json:async()=>({projectId:'synthetic-project'})};
    },
    initializeApp:()=>({}),getAuth:()=>auth,inMemoryPersistence:{},
    setPersistence:async(_:any,persistence:any)=>calls.push({name:'setPersistence',persistence}),
    signInWithEmailAndPassword:async(_:any,email:string,password:string) => {
      calls.push({name:'signIn',email,password});
      if(signInFailure)throw signInFailure;
      if(signInDirect) {auth.currentUser=user;return {user};}
      throw {code:'auth/multi-factor-auth-required'};
    },
    getIdTokenResult:async()=>({claims}),
    signOut:async()=>{calls.push({name:'signOut'});auth.currentUser=null;},
    reload:async()=>{if(reloadFailure)throw Error('SENSITIVE_RELOAD_ERROR');},
    updatePassword:async(_:any,password:string)=>calls.push({name:'updatePassword',password}),
    getMultiFactorResolver:()=>resolver,
    multiFactor:()=>({
      enrolledFactors:enrolled,getSession:async()=>({}),
      enroll:async()=> {
        calls.push({name:'enroll'});
        if(enrollFailure&&!enrollAfterFailure)throw enrollFailure;
        enrolled.push({uid:'new-totp',factorId:'totp',displayName:'Novo',enrollmentTime:'2031-10-03T12:00:00Z'});
        if(enrollFailure)throw enrollFailure;
      },
      unenroll:async(uid:string)=> {
        calls.push({name:'unenroll',uid});
        if(removeFailure&&!removeAfterFailure)throw removeFailure;
        const index=enrolled.findIndex(f=>f.uid===uid);if(index>=0)enrolled.splice(index,1);
        if(removeFailure)throw removeFailure;
      },
    }),
    TotpMultiFactorGenerator:{FACTOR_ID:'totp',
      generateSecret:async()=>{calls.push({name:'generateSecret'});return generate();},
      assertionForSignIn:(factorId:string,code:string)=>({factorId,code}),
      assertionForEnrollment:(_:any,code:string)=>{if(code!=='123456')throw Error('SENSITIVE_BAD_ENROLLMENT_CODE');return {};},
    },
  };
  const source=accountSecurityClient(member,csrf);
  const executable=source.replace(/^import[\s\S]*?from 'https:\/\/[^']+';\n/gm,'');
  await new Script('(async()=>{'+executable+'})()').runInContext(createContext(sandbox));
  async function submit(id:string) { await el(id).handlers.get('submit')({preventDefault(){}}); }
  async function click(id:string) { await el(id).handlers.get('click')(); }
  async function authenticate(factor='old-totp') {
    el('security-password').value='SYNTHETIC_CURRENT_PASSWORD';await submit('security-auth-form');
    el('security-mfa-factor').value=factor;el('security-mfa-code').value='123456';await click('security-mfa-confirm');
  }
  async function enroll() {
    await click('security-start-totp');el('security-enrollment-code').value='123456';await click('security-enroll-totp');
  }
  return {el,calls,redirects,user,enrolled,auth,windowHandlers,submit,click,authenticate,enroll,
    claims:(patch:any)=>{claims={...claims,...patch};},advance:(seconds:number)=>{now+=seconds*1000;},
    signInFailure:(value:any)=>{signInFailure=value;},mfaFailure:(value:any)=>{mfaFailure=value;},
    signInDirect:(value:boolean)=>{signInDirect=value;},
    enrollFailure:(value:any,after=false)=>{enrollFailure=value;enrollAfterFailure=after;},
    removeFailure:(value:any,after=false)=>{removeFailure=value;removeAfterFailure=after;},
    reloadFailure:(value:boolean)=>{reloadFailure=value;},logoutOk:(value:boolean)=>{logoutOk=value;},
    generate:(value:any)=>{generate=value;},configOk:(value:boolean)=>{configOk=value;},
  };
}

test('private account page escapes identity and emits password and TOTP fields with no account selector',()=>{
  const html=accountSecurityPage({...member,email:'<script>"@example.invalid',uid:'</script><script>bad</script>'},csrf);
  assert.match(html,/id="security-email"[^>]*readonly/);
  assert.match(html,/id="security-new-password"/);assert.match(html,/id="security-enrollment-code"/);
  assert.match(html,/recuperação administrativa/);assert.doesNotMatch(html,/<script>bad<\/script>/);
  const emitted=/<script type="module">([\s\S]*?)<\/script>/.exec(html)![1]!;
  assert.doesNotThrow(()=>new Script('(async()=>{'+emitted.replace(/^import[\s\S]*?from 'https:\/\/[^']+';\n/gm,'')+'})()'));
});

test('configuration uses in-memory auth; no changes occur before explicit recent password and TOTP',async()=>{
  const f=await fixture();assert.equal(f.calls.filter(c=>c.name==='setPersistence').length,1);
  assert.equal(f.el('security-change-password').disabled,true);
  assert.equal(f.el('security-start-totp').disabled,true);
  await f.authenticate();assert.equal(f.el('security-change-password').disabled,false);
  assert.equal(f.el('security-password').value,'');assert.equal(f.el('security-mfa-code').value,'');
  assert.equal(f.calls.some(c=>['updatePassword','enroll','unenroll'].includes(c.name)),false);
});

test('UID, email, project, token identity, unverified email and missing MFA deny all mutations',async()=>{
  for(const patch of [{sub:'other-user'},{aud:'other-project'},{email:'other@example.invalid'},
    {email_verified:false},{firebase:{}},{firebase:{sign_in_second_factor:'phone'}}]) {
    const f=await fixture();f.claims(patch);await f.authenticate();
    await f.click('security-start-totp');assert.equal(f.calls.some(c=>c.name==='generateSecret'),false);
    assert.equal(f.el('security-change-password').disabled,true);
  }
  const mismatch=await fixture();mismatch.user.uid='other-user';await mismatch.authenticate();
  assert.match(mismatch.el('security-status').textContent,/não corresponde/);
  const unverified=await fixture();unverified.user.emailVerified=false;await unverified.authenticate();
  assert.equal(unverified.el('security-change-password').disabled,true);
});

test('confirmation older than five minutes or future timestamp is rejected on every mutation',async()=>{
  const f=await fixture();await f.authenticate();f.advance(301);await f.click('security-start-totp');
  assert.equal(f.calls.some(c=>c.name==='generateSecret'),false);assert.match(f.el('security-status').textContent,/expirou/);
  const future=await fixture();future.claims({auth_time:1700000100});await future.authenticate();
  assert.equal(future.el('security-change-password').disabled,true);
});

test('password change checks confirmation, clears inputs and logs out with original cookie CSRF only',async()=>{
  const f=await fixture();await f.authenticate();
  f.el('security-new-password').value=f.el('security-confirm-password').value='12345678901';
  await f.submit('security-password-form');assert.equal(f.calls.some(c=>c.name==='updatePassword'),false);
  assert.match(f.el('security-status').textContent,/12 caracteres/);
  f.el('security-new-password').value='SYNTHETIC_NEW_PASSWORD';f.el('security-confirm-password').value='different';
  await f.submit('security-password-form');assert.equal(f.calls.some(c=>c.name==='updatePassword'),false);
  f.el('security-new-password').value=f.el('security-confirm-password').value='SYNTHETIC_NEW_PASSWORD';
  await f.submit('security-password-form');assert.equal(f.calls.filter(c=>c.name==='updatePassword').length,1);
  assert.equal(f.el('security-new-password').value,'');assert.equal(f.el('security-confirm-password').value,'');
  const logout=f.calls.find(c=>c.url==='/__sessionLogout');assert.equal(logout.options.headers['X-Aurora-CSRF'],csrf);
  assert.equal(logout.options.body,'{}');assert.equal(logout.options.credentials,'same-origin');
  assert.equal(f.enrolled.length,3);assert.deepEqual(f.redirects,['/portal']);
});

test('fresh page resumes an interrupted rotation only after resolving MFA with the factor to retain',async()=>{
  const f=await fixture([
    {uid:'old-totp',factorId:'totp',displayName:'Aurora Nexus',enrollmentTime:'2031-10-01T12:00:00Z'},
    {uid:'new-totp',factorId:'totp',displayName:'Aurora Nexus',enrollmentTime:'2031-10-03T12:00:00Z'},
    {uid:'phone-factor',factorId:'phone',displayName:'Telefone'}
  ]);
  assert.equal(f.el('security-resume-totp').disabled,true);
  await f.authenticate('new-totp');assert.equal(f.el('security-resume-totp').disabled,false);
  assert.equal(f.el('security-remove-old').disabled,true);
  const labels=f.el('security-mfa-factor').children.map(x=>x.textContent);
  assert.ok(labels.every(x=>x.includes('cadastro:')));assert.notEqual(labels[0],labels[1]);
  await f.click('security-resume-totp');
  assert.deepEqual(f.el('security-old-factor').children.map(x=>x.value),['old-totp']);
  assert.match(f.el('security-old-factor').children[0]!.textContent,/cadastro:/);
  f.el('security-old-factor').value='old-totp';await f.click('security-remove-old');
  assert.deepEqual(f.enrolled.map(x=>x.uid),['new-totp','phone-factor']);
  assert.equal(f.calls.some(c=>['enroll','generateSecret'].includes(c.name)),false);
  assert.equal(f.calls.find(c=>c.name==='unenroll').uid,'old-totp');
  assert.deepEqual(f.redirects,['/portal']);
});

test('password-only success and forged UI factor selection cannot resume or remove enrolled factors',async()=>{
  const f=await fixture();f.signInDirect(true);
  f.el('security-password').value='SYNTHETIC_CURRENT_PASSWORD';await f.submit('security-auth-form');
  f.el('security-mfa-factor').value='old-totp';
  assert.equal(f.el('security-resume-totp').disabled,true);await f.click('security-resume-totp');
  f.el('security-old-factor').value='backup-totp';await f.click('security-remove-old');
  assert.equal(f.calls.some(c=>['unenroll','enroll','updatePassword'].includes(c.name)),false);
  assert.equal(f.el('security-change-password').disabled,true);
  const forged=await fixture();forged.el('security-password').value='SYNTHETIC_CURRENT_PASSWORD';await forged.submit('security-auth-form');
  forged.el('security-mfa-factor').value='unknown';forged.el('security-mfa-code').value='123456';await forged.click('security-mfa-confirm');
  await forged.click('security-resume-totp');assert.equal(forged.calls.some(c=>c.name==='resolveSignIn'),false);
});

test('resume rechecks the enrolled list and never permits deleting the confirmed or last factor',async()=>{
  for(const selected of ['old-totp','phone-factor','unknown']) {
    const f=await fixture();await f.authenticate('old-totp');await f.click('security-resume-totp');
    f.el('security-old-factor').value=selected;await f.click('security-remove-old');
    assert.equal(f.calls.some(c=>c.name==='unenroll'),false);
  }
  const last=await fixture();await last.authenticate();last.enrolled.splice(1);await last.click('security-resume-totp');
  assert.equal(last.el('security-remove-old').disabled,true);assert.equal(last.calls.some(c=>c.name==='unenroll'),false);
  const gone=await fixture();await gone.authenticate();gone.enrolled.splice(0,1);await gone.click('security-resume-totp');
  assert.equal(gone.el('security-remove-old').disabled,true);
  const stale=await fixture();await stale.authenticate();stale.advance(301);await stale.click('security-resume-totp');
  assert.equal(stale.el('security-remove-old').disabled,true);assert.match(stale.el('security-status').textContent,/expirou/);
});

test('new factor is confirmed first; fresh login using the new factor precedes selective old removal',async()=>{
  const f=await fixture();await f.authenticate();await f.enroll();
  assert.deepEqual(f.enrolled.map(x=>x.uid),['old-totp','backup-totp','phone-factor','new-totp']);
  assert.equal(f.calls.some(c=>c.name==='unenroll'),false);assert.equal(f.el('security-remove-old').disabled,true);
  assert.equal(f.el('security-enrollment-key').textContent,'');assert.equal(f.auth.currentUser,null);
  await f.authenticate('new-totp');f.el('security-old-factor').value='old-totp';await f.click('security-remove-old');
  assert.deepEqual(f.enrolled.map(x=>x.uid),['backup-totp','phone-factor','new-totp']);
  assert.ok(f.calls.findIndex(c=>c.name==='enroll')<f.calls.findIndex(c=>c.name==='unenroll'));
  assert.equal(f.calls.find(c=>c.name==='unenroll').uid,'old-totp');assert.deepEqual(f.redirects,['/portal']);
});

test('cannot remove a factor before replacement, the new factor, an unknown factor, phone or last factor',async()=>{
  const initial=await fixture();await initial.authenticate();initial.el('security-old-factor').value='old-totp';await initial.click('security-remove-old');
  assert.equal(initial.calls.some(c=>c.name==='unenroll'),false);
  for(const selected of ['new-totp','unknown','phone-factor']) {
    const f=await fixture();await f.authenticate();await f.enroll();await f.authenticate('new-totp');
    f.el('security-old-factor').value=selected;await f.click('security-remove-old');
    assert.equal(f.calls.some(c=>c.name==='unenroll'),false);
  }
  const last=await fixture();await last.authenticate();await last.enroll();await last.authenticate('new-totp');
  last.enrolled.splice(0,last.enrolled.length,{uid:'new-totp',factorId:'totp'});
  last.el('security-old-factor').value='old-totp';await last.click('security-remove-old');
  assert.equal(last.calls.some(c=>c.name==='unenroll'),false);
});

test('old-factor reauthentication cannot unlock removal after enrollment',async()=>{
  const f=await fixture();await f.authenticate();await f.enroll();await f.authenticate('old-totp');
  assert.equal(f.el('security-remove-old').disabled,true);assert.equal(f.calls.filter(c=>c.name==='resolveSignIn').length,1);
  assert.equal(f.calls.some(c=>c.name==='unenroll'),false);
});

test('lost enrollment response is a partial state, reconciled without repeating enrollment or deleting factors',async()=>{
  const f=await fixture();await f.authenticate();f.enrollFailure(Error('SENSITIVE_ENROLL_RESPONSE_LOST'),true);await f.enroll();
  assert.equal(f.enrolled.length,4);assert.match(f.el('security-status').textContent,/Troca parcial/);
  assert.equal(f.el('security-remove-old').disabled,true);assert.equal(f.calls.some(c=>c.name==='unenroll'),false);
  f.enrollFailure(null);await f.authenticate('old-totp');assert.match(f.el('security-status').textContent,/Novo fator localizado/);
  await f.authenticate('new-totp');assert.equal(f.el('security-remove-old').disabled,false);
  assert.equal(f.calls.filter(c=>c.name==='enroll').length,1);
});

test('failure before enrollment preserves old factors and can restart only after confirmed reauthentication',async()=>{
  const f=await fixture();await f.authenticate();f.enrollFailure(Error('SENSITIVE_ENROLL_FAIL'));await f.enroll();
  assert.equal(f.enrolled.length,3);assert.equal(f.calls.some(c=>c.name==='unenroll'),false);
  f.enrollFailure(null);await f.authenticate();assert.match(f.el('security-status').textContent,/não há novo cadastro/);
  assert.equal(f.el('security-start-totp').disabled,false);
});

test('failed old removal retains new and old factors and reports partial state without raw errors',async()=>{
  const f=await fixture();await f.authenticate();await f.enroll();await f.authenticate('new-totp');
  f.removeFailure(Error('SENSITIVE_UNENROLL_FAILURE'));f.el('security-old-factor').value='old-totp';await f.click('security-remove-old');
  assert.equal(f.enrolled.length,4);assert.match(f.el('security-status').textContent,/novo e os fatores antigos continuam/);
  assert.doesNotMatch(f.el('security-status').textContent,/SENSITIVE/);assert.equal(f.redirects.length,0);
});

test('a lost removal response is reconciled from remaining factors before reporting success',async()=>{
  const f=await fixture();await f.authenticate();await f.enroll();await f.authenticate('new-totp');
  f.removeFailure(Error('SENSITIVE_RESPONSE_LOST'),true);f.el('security-old-factor').value='old-totp';await f.click('security-remove-old');
  assert.deepEqual(f.enrolled.map(x=>x.uid),['backup-totp','phone-factor','new-totp']);
  assert.match(f.el('security-status').textContent,/Retirada conferida/);assert.deepEqual(f.redirects,['/portal']);
  assert.equal(f.calls.filter(c=>c.name==='unenroll').length,1);
});

test('original app logout failure is explicit and can retry without replaying password mutation',async()=>{
  const f=await fixture();await f.authenticate();f.logoutOk(false);
  f.el('security-new-password').value=f.el('security-confirm-password').value='SYNTHETIC_NEW_PASSWORD';
  await f.submit('security-password-form');assert.equal(f.redirects.length,0);
  assert.match(f.el('security-status').textContent,/encerramento.*não foi confirmado/);
  f.logoutOk(true);await f.click('security-exit');assert.deepEqual(f.redirects,['/portal']);
  assert.equal(f.calls.filter(c=>c.name==='updatePassword').length,1);
  assert.ok(f.calls.filter(c=>c.url==='/__sessionLogout').every(c=>c.options.headers['X-Aurora-CSRF']===csrf));
});

test('page exit clears secret and every password/code field and signs out browser authentication',async()=>{
  const f=await fixture();await f.authenticate();await f.click('security-start-totp');
  assert.equal(f.el('security-enrollment-key').textContent,'SYNTHETIC_TOTP_SECRET');
  for(const id of ['security-password','security-mfa-code','security-new-password','security-confirm-password','security-enrollment-code'])f.el(id).value='SYNTHETIC_PRIVATE_INPUT';
  f.windowHandlers.get('pagehide')();
  for(const id of ['security-password','security-mfa-code','security-new-password','security-confirm-password','security-enrollment-code'])assert.equal(f.el(id).value,'');
  assert.equal(f.el('security-enrollment-key').textContent,'');assert.equal(f.auth.currentUser,null);
});

test('in-flight operations prevent duplicate enrollments and overlapping mutations',async()=>{
  const f=await fixture();await f.authenticate();let complete:any;
  f.generate(()=>new Promise(resolve=>{complete=resolve;}));
  const pending=f.click('security-start-totp');await new Promise(resolve=>setImmediate(resolve));
  await f.click('security-start-totp');assert.equal(f.calls.filter(c=>c.name==='generateSecret').length,1);
  complete({secretKey:'SYNTHETIC_TOTP_SECRET'});await pending;
});

test('no password, token or TOTP secret is sent to application APIs or persisted by emitted code',async()=>{
  const f=await fixture();await f.authenticate();await f.enroll();await f.click('security-exit');
  for(const call of f.calls.filter(c=>c.name==='fetch')) {
    assert.ok(['/__/firebase/init.json','/__sessionLogout'].includes(call.url));
    assert.doesNotMatch(JSON.stringify(call.options),/SYNTHETIC_CURRENT_PASSWORD|SYNTHETIC_TOTP_SECRET|idToken/);
  }
  assert.doesNotMatch(accountSecurityClient(member,csrf),/localStorage|sessionStorage|console\.|setCustomUserClaims|firebase-admin/);
});
