import assert from 'node:assert/strict';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { passwordRecoveryClient, passwordRecoveryMarkup } from '../src/auroraPasswordRecovery.js';

class Element {
  value=''; textContent=''; hidden=false; disabled=false;
  parentElement:Element|null=null; cssHidden=false; ownerDocument?:{activeElement:Element|null};
  handlers=new Map<string, any>();
  addEventListener(event:string, handler:any) { this.handlers.set(event,handler); }
  closest(selector:string):Element|null{for(let node:Element|null=this;node;node=node.parentElement)if(selector==='[hidden]'&&node.hidden)return node;return null;}
  getClientRects():object[]{return this.hidden||this.cssHidden||this.parentElement?.getClientRects().length===0?[]:[{}];}
  focus(){if(!this.disabled&&this.getClientRects().length&&this.ownerDocument)this.ownerDocument.activeElement=this;}
}
async function fixture(options:{search?:string;invalid?:boolean;resetError?:boolean;signOutError?:boolean}={}) {
  const document={activeElement:null as Element|null,body:new Element()};
  const parents:Record<string,string>={email:'login-form',password:'login-form','open-password-recovery':'login-form','recovery-email':'password-recovery-panel','recovery-link':'password-recovery-panel','verify-recovery-link':'password-recovery-panel','recovery-back':'password-recovery-panel','new-password-form':'password-recovery-panel','recovery-new-password':'new-password-form','recovery-confirm-password':'new-password-form'};
  const elements=new Map<string,Element>();
  const el=(id:string):Element=>{if(!elements.has(id)){const node=new Element();node.ownerDocument=document;elements.set(id,node);if(parents[id])node.parentElement=el(parents[id]);}return elements.get(id)!;};
  el('password-recovery-panel').hidden=true;el('new-password-form').hidden=true;
  const calls:any[]=[]; const events=new Map<string,any>();
  let verify:any=async()=>{if(options.invalid)throw new Error('private-provider-details');return 'synthetic@example.invalid';};
  const sandbox={URL,URLSearchParams,document,auth:{},element:el,form:el('login-form'),
    window:{addEventListener:(name:string,handler:any)=>events.set(name,handler)},
    location:{pathname:'/account-recovery',search:options.search||''},
    history:{replaceState:(_state:any,_title:any,path:string)=>calls.push({name:'history',path})},
    sendPasswordResetEmail:async(_auth:any,email:string)=>{calls.push({name:'send',email});if(options.resetError)throw new Error('private-provider-details');},
    verifyPasswordResetCode:async(_auth:any,code:string)=>{calls.push({name:'verify',code});return verify();},
    confirmPasswordReset:async(_auth:any,code:string,password:string)=>{calls.push({name:'confirm',code,password});},
    signOut:async()=>{calls.push({name:'signOut'});if(options.signOutError)throw new Error('synthetic-signout-failure');}};
  await new Script('(async()=>{'+passwordRecoveryClient()+'})()').runInContext(createContext(sandbox));
  return {el,document,calls,events,verification:(fn:any)=>{verify=fn;},async click(id:string){el(id).focus();await el(id).handlers.get('click')();},async submit(){await el('new-password-form').handlers.get('submit')({preventDefault(){}});}};
}
const link='https://auroranexus.com.br/__/auth/action?mode=resetPassword&oobCode=synthetic-one-use-code';

test('password recovery never reveals account existence and sends only on explicit action',async()=>{
  for(const resetError of [false,true]) {
    const f=await fixture({resetError}); assert.equal(f.calls.length,0);
    f.el('email').value='synthetic@example.invalid';await f.click('open-password-recovery');
    assert.equal(f.el('recovery-email').value,'synthetic@example.invalid');assert.equal(f.calls.length,0);
    assert.equal(f.document.activeElement,f.el('recovery-email'));
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
  assert.notEqual(f.document.activeElement,f.el('recovery-new-password'));
  await f.submit();assert.equal(f.calls.some(c=>c.name==='confirm'),false);
});
test('action URL is stripped from browser history and page exit erases pending recovery material',async()=>{
  const f=await fixture({search:'?mode=resetPassword&oobCode=synthetic-one-use-code'});
  assert.equal(f.calls[0].name,'history');assert.equal(f.calls[0].path,'/account-recovery');
  assert.equal(f.document.activeElement,null);
  f.el('recovery-new-password').value='synthetic-password';f.events.get('pagehide')();
  assert.equal(f.el('recovery-new-password').value,'');assert.equal(f.el('new-password-form').hidden,true);
  await f.submit();assert.equal(f.calls.some(c=>c.name==='confirm'),false);
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

test('explicit recovery validation focuses the new password only after the provider accepts the link',async()=>{
  const f=await fixture();await f.click('open-password-recovery');
  let resolve!:(email:string)=>void;f.verification(()=>new Promise(r=>{resolve=r;}));
  f.el('recovery-link').value=link;const verifying=f.click('verify-recovery-link');
  assert.equal(f.el('new-password-form').hidden,true);assert.equal(f.document.activeElement,f.el('verify-recovery-link'));
  resolve('synthetic@example.invalid');await verifying;
  assert.equal(f.el('new-password-form').hidden,false);assert.equal(f.document.activeElement,f.el('recovery-new-password'));
  assert.equal(f.calls.some(c=>c.name==='confirm'),false);
});

test('late recovery validation respects a moved focus, a hidden field, page exit and restoration',async()=>{
  for(const state of ['moved','hidden','pagehide','restored']){
    const f=await fixture();await f.click('open-password-recovery');
    let resolve!:(email:string)=>void;f.verification(()=>new Promise(r=>{resolve=r;}));
    f.el('recovery-link').value=link;const verifying=f.click('verify-recovery-link');
    if(state==='moved')f.el('recovery-email').focus();
    if(state==='hidden')f.el('recovery-new-password').cssHidden=true;
    if(state==='pagehide'||state==='restored')f.events.get('pagehide')();
    if(state==='restored')f.events.get('pageshow')();
    const active=f.document.activeElement;resolve('synthetic@example.invalid');await verifying;
    assert.equal(f.document.activeElement,active);assert.notEqual(f.document.activeElement,f.el('recovery-new-password'));
    assert.equal(f.calls.some(c=>c.name==='confirm'),false);
  }
});

test('page restoration permits a new explicit recovery action without automatic focus',async()=>{
  const f=await fixture();f.events.get('pagehide')();f.events.get('pageshow')();
  assert.equal(f.document.activeElement,null);await f.click('open-password-recovery');
  assert.equal(f.document.activeElement,f.el('recovery-email'));
  f.el('recovery-link').value=link;await f.click('verify-recovery-link');
  assert.equal(f.document.activeElement,f.el('recovery-new-password'));
});

test('completed recovery directs the user back to the ready login field without resending the link',async()=>{
  for(const email of ['', 'synthetic@example.invalid']){
    const f=await fixture();f.el('email').value=email;await f.click('open-password-recovery');
    f.el('recovery-link').value=link;await f.click('verify-recovery-link');
    f.el('recovery-new-password').value='synthetic-strong-password';f.el('recovery-confirm-password').value='synthetic-strong-password';
    f.el('recovery-confirm-password').focus();await f.submit();
    assert.equal(f.document.activeElement,f.el('recovery-back'));
    assert.match(f.el('recovery-status').textContent,/Senha redefinida/);await f.click('recovery-back');
    assert.equal(f.el('password-recovery-panel').hidden,true);assert.equal(f.el('login-form').hidden,false);
    assert.equal(f.document.activeElement,f.el(email?'password':'email'));
    assert.equal(f.el('recovery-new-password').value,'');assert.equal(f.calls.filter(c=>c.name==='confirm').length,1);
    assert.equal(f.calls.some(c=>c.name==='send'),false);
  }
});
