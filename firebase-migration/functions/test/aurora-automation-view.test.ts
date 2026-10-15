import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {automationConfigurationClient,automationConfigurationSection} from '../src/auroraAutomationView.ts';
const org='synthetic',keyId='ik_'+'a'.repeat(16);
const reply=(data:any,status=200)=>({status,ok:status===200,headers:{get:()=> 'application/json'},json:async()=>data});
function harness(responses:any[]){
  let submit!:Function;const calls:any[]=[];const button={disabled:false};
  const status={textContent:''};const nodes:any={
    'automation-configuration-form':{elements:[],addEventListener:(_e:string,fn:Function)=>{submit=fn;},reset(){},querySelector:()=>button},
    'automation-configuration-status':status,'automation-key-id':{value:keyId},
    'automation-source-system':{value:'ERP'},'automation-configuration-consent':{checked:true}};
  const context=vm.createContext({document:{getElementById:(id:string)=>nodes[id]},window:{addEventListener(){}},AbortSignal,
    fetch:async(url:string,options:any)=>{calls.push({url,options});const next=responses.shift();if(next instanceof Error)throw next;return next;}});
  new vm.Script(automationConfigurationClient(org,'synthetic-session-bound-csrf')).runInContext(context);
  return {calls,button,status,nodes,submit:()=>submit({preventDefault(){}})};
}
const current=(patch:any={})=>({ok:true,orgId:org,credentials:[{keyId,active:true,scopes:['integration.read','documents.ingest'],automation:null,...patch}]});
test('configuration UI rereads credential revision then submits only a public CAS binding',async()=>{
  const h=harness([reply(current()),reply({ok:true,orgId:org,method:'API_TOKEN',configured:true,revision:1,configurationHash:'b'.repeat(64)})]);await h.submit();
  assert.equal(h.calls.length,2);assert.equal(h.calls[0].options.method,undefined);
  const request=h.calls[1].options;assert.equal(request.method,'POST');assert.equal(request.redirect,'error');assert.equal(request.credentials,'same-origin');
  assert.equal(request.headers['x-aurora-csrf'],'synthetic-session-bound-csrf');
  assert.deepEqual(JSON.parse(request.body),{action:'CONFIGURE_AUTOMATION',method:'API_TOKEN',keyId,sourceSystem:'ERP',enabled:true,expectedRevision:0});
  assert.match(h.status.textContent,/Envie os dados autorizados/);assert.doesNotMatch(request.body,/bearer|apiKey|tokenHash/);
});
test('foreign tenant, inactive credential, inadequate scopes and malformed revision cannot write',async()=>{
  for(const value of [{...current(),orgId:'other'},current({active:false}),current({scopes:['integration.read']}),current({automation:{revision:-1}})]){
    const h=harness([reply(value)]);await h.submit();assert.equal(h.calls.length,1);assert.match(h.status.textContent,/não confirmada/);
  }
});
test('CAS rejection and returned mismatches never become an installation or automatic acquisition claim',async()=>{
  for(const response of [reply({ok:false,code:'AUTOMATION_CONFIGURATION_CONFLICT',secret:'never display'},409),
    reply({ok:true,orgId:org,configured:true,method:'CLOUD_OAUTH',revision:1,configurationHash:'b'.repeat(64)})]){
    const h=harness([reply(current()),response]);await h.submit();assert.match(h.status.textContent,/não confirmada/);assert.doesNotMatch(h.status.textContent,/never display/);
  }
  assert.equal(automationConfigurationClient(org,''),'');
  assert.match(automationConfigurationSection(),/não certifica OAuth/);
  assert.doesNotMatch(automationConfigurationSection(),/type="password"/);
});
test('configuration requires explicit consent and valid public key ID without transport',async()=>{
  for(const mutate of [(h:any)=>{h.nodes['automation-configuration-consent'].checked=false;},(h:any)=>{h.nodes['automation-key-id'].value='anx_raw_secret';}]){
    const h=harness([]);mutate(h);await h.submit();assert.equal(h.calls.length,0);
  }
});
