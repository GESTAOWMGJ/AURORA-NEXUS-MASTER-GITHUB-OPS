import assert from 'node:assert/strict';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { passwordRecoveryClient, passwordRecoveryMarkup } from '../src/auroraPasswordRecovery.js';

class Element {
  value=''; textContent=''; hidden=false; disabled=false;
  handlers=new Map<string, any>();
  addEventListener(event:string, handler:any) { this.handlers.set(event,handler); }
}
async function fixture(options:{search?:string;invalid?:boolean;resetError?:boolean;resetErrorCode?:string;signOutError?:boolean}={}) {
  const elements=new Map<string,Element>();
  const el=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!;};
  const calls:any[]=[]; const events=new Map<string,any>();
  const recoveryQueryAtEntry = options.search || '';
  const params = new URLSearchParams(recoveryQueryAtEntry);
  const recoveryQueryPresent = params.has('oobCode') || params.getAll('mode').includes('resetPassword');
  const sandbox={URL,URLSearchParams,auth:{},element:el,form:el('login-form'),recoveryQueryAtEntry,recoveryQueryPresent,
    window:{addEventListener:(name:string,handler:any)=>events.set(name,handler)},
    location:{origin:'https://auroranexus.com.br',pathname:'/account-recovery',search:options.search||''},
    history:{replaceState:(_state:any,_title:any,path:string)=>calls.push({name:'history',path})},
    sendPasswordResetEmail:async(_auth:any,email:string)=>{calls.push({name:'send',email});if(options.resetError)throw new Error('private-provider-details');if(options.resetErrorCode)throw {code:options.resetErrorCode};},
    verifyPasswordResetCode:async(_auth:any,code:string)=>{calls.push({name:'verify',code});if(options.invalid)throw new Error('private-provider-details');return 'synthetic@example.invalid';},
    confirmPasswordReset:async(_auth:any,code:string,password:string)=>{calls.push({name:'confirm',code,password});},
    signOut:async()=>{calls.push({name:'signOut'});if(options.signOutError)throw new Error('synthetic-signout-failure');}};
  await new Script('(async()=>{'+passwordRecoveryClient()+'})()').runInContext(createContext(sandbox));
  return {el,calls,events,async click(id:string){await el(id).handlers.get('click')();},async submit(){await el('new-password-form').handlers.get('submit')({preventDefault(){}});}};
}
const link='https://auroranexus.com.br/__/auth/action?mode=resetPassword&oobCode=synthetic-one-use-code';

test('password recovery never reveals account existence and sends only on explicit action',async()=>{
  for(const resetError of [false,true]) {
    const f=await fixture({resetError}); assert.equal(f.calls.length,0);
    f.el('email').value='synthetic@example.invalid';await f.click('open-password-recovery');
    assert.equal(f.el('recovery-email').value,'synthetic@example.invalid');assert.equal(f.calls.length,0);
    await f.click('reset-password');assert.equal(f.calls.filter(c=>c.name==='send').length,1);
    assert.match(f.el('recovery-status').textContent,/Se o e-mail estiver autorizado/);
    assert.doesNotMatch(f.el('recovery-status').textContent,/private-provider-details/);
  }
});
test('reset requires a verified action code and matching strong password, never an app API',async()=>{
  const f=await fixture();await f.submit();assert.equal(f.calls.length,0);
  f.el('recovery-link').value=link;await f.click('verify-recovery-link');
  assert.equal(f.el('recovery-link').value,'');assert.equal(f.el('new-password-form').hidden,false);
  f.el('recovery-new-password').value='synthetic-strong-password';f.el('recovery-confirm-password').value='different';await f.submit();
  assert.equal(f.calls.some(c=>c.name==='confirm'),false);
  f.el('recovery-confirm-password').value='synthetic-strong-password';await f.submit();
  assert.deepEqual(f.calls.find(c=>c.name==='confirm'),{name:'confirm',code:'synthetic-one-use-code',password:'synthetic-strong-password'});
  assert.equal(f.el('recovery-new-password').value,'');assert.equal(f.el('recovery-confirm-password').value,'');
  await f.submit();assert.equal(f.calls.filter(c=>c.name==='confirm').length,1);
  assert.doesNotMatch(passwordRecoveryClient(),/fetch\(|localStorage|sessionStorage|console\./);
});
test('expired/malformed/non-reset links never expose password form or provider details',async()=>{
  for(const value of ['not-a-link','http://example.invalid/?mode=resetPassword&oobCode=synthetic','https://example.invalid/?mode=resetPassword&oobCode=synthetic','https://example.invalid/?mode=verifyEmail&oobCode=synthetic']) {
    const f=await fixture();f.el('recovery-link').value=value;await f.click('verify-recovery-link');assert.equal(f.calls.length,0);
  }
  const f=await fixture({invalid:true});f.el('recovery-link').value=link;await f.click('verify-recovery-link');
  assert.equal(f.el('new-password-form').hidden,true);assert.doesNotMatch(f.el('recovery-status').textContent,/private-provider-details/);
  await f.submit();assert.equal(f.calls.some(c=>c.name==='confirm'),false);
});
test('direct action URLs use verified code and page exit erases pending recovery material',async()=>{
  const f=await fixture({search:'?mode=resetPassword&oobCode=synthetic-one-use-code'});
  assert.equal(f.calls[0].name,'verify');assert.equal(f.calls[0].code,'synthetic-one-use-code');
  f.el('recovery-new-password').value='synthetic-password';f.events.get('pagehide')();
  assert.equal(f.el('recovery-new-password').value,'');assert.equal(f.el('new-password-form').hidden,true);
  await f.submit();assert.equal(f.calls.some(c=>c.name==='confirm'),false);
});
test('direct action URLs reject duplicated parameters, missing mode and malformed codes before Firebase',async()=>{
  for(const search of [
    '?mode=resetPassword&mode=resetPassword&oobCode=synthetic',
    '?mode=resetPassword&oobCode=first&oobCode=second',
    '?mode=resetPassword&oobCode=synthetic%0Avalue',
    '?mode=verifyEmail&oobCode=synthetic',
    '?oobCode=synthetic',
    '?mode=resetPassword&oobCode=',
    '?mode=resetPassword&oobCode=bad%2Fcharacter'
  ]) {
    const f=await fixture({search});
    assert.equal(f.calls.filter(c=>c.name==='verify').length,0,search);
    assert.equal(f.el('new-password-form').hidden,true,search);
    assert.match(f.el('recovery-status').textContent,/Link inválido/);
  }
});
test('Firebase throttling does not disclose account state and suppresses duplicate recovery sends',async()=>{
  for(const resetErrorCode of ['auth/too-many-requests','auth/user-not-found','auth/invalid-email']) {
    const f=await fixture({resetErrorCode});
    f.el('recovery-email').value='synthetic@example.invalid';
    await f.click('reset-password');
    assert.match(f.el('recovery-status').textContent,/Se o e-mail estiver autorizado/,resetErrorCode);
    await f.click('reset-password');
    assert.equal(f.calls.filter(c=>c.name==='send').length,1,resetErrorCode);
  }
});
test('a logout failure after completed provider reset does not claim reset failed',async()=>{
  const f=await fixture({signOutError:true});f.el('recovery-link').value=link;await f.click('verify-recovery-link');
  f.el('recovery-new-password').value='synthetic-password';f.el('recovery-confirm-password').value='synthetic-password';await f.submit();
  assert.match(f.el('recovery-status').textContent,/Senha redefinida/);
});
test('recovery markup offers separate email/link/new-password fields and no MFA bypass',()=>{
  const html=passwordRecoveryMarkup();assert.match(html,/id="recovery-email"/);assert.match(html,/id="recovery-new-password"/);
  assert.match(html,/id="recovery-confirm-password"/);assert.match(html,/type="password" autocomplete="off"/);
  assert.match(html,/mantém o segundo fator/);
});
