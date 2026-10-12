import assert from 'node:assert/strict';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { canAccessIaMaster, iaMasterSection } from '../src/auroraIaMasterView.js';
import { iaMasterClient } from '../src/auroraIaMasterClient.js';

const member = {orgId:'synthetic-company',role:'org_admin',allFacilities:true,mfaVerified:true};
const token = 'S'.repeat(43), ticket = 'T'.repeat(43), fingerprint='f'.repeat(64), taskId='c'.repeat(32);
class Element {
  value=''; textContent=''; hidden=false; disabled=false; checked=false; className=''; type='';
  children:Element[]=[]; handlers=new Map<string,any>();
  addEventListener(name:string,handler:any){this.handlers.set(name,handler);}
  replaceChildren(){this.children=[];this.textContent='';}
  appendChild(child:Element){this.children.push(child);}
  querySelectorAll(){const found:Element[]=[];const walk=(node:Element)=>{for(const child of node.children){if(child.type==='checkbox'&&child.checked&&!child.disabled)found.push(child);walk(child);}};walk(this);return found;}
}

function fixture(origin='https://auroranexus.com.br') {
  const elements=new Map<string,Element>(), windowHandlers=new Map<string,any>(), calls:any[]=[];
  const el=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!;};
  let sessionResponse:any={ok:true,sessionToken:token,orgId:member.orgId,expiresAt:'2026-10-08T20:00:00Z'};
  let status:any={orgId:member.orgId,version:'1.0.3',model:'qwen3:8b',modelState:'AVAILABLE',busy:false,
    policy:{externalAiEnabled:false,maxExternalAiCalls:0},metrics:{externalAiCalls:0,externalTokens:0},cloudSync:'NOT_VERIFIED'};
  let capabilities:any={externalAiEnabled:false,repository:{state:'AVAILABLE',projectId:'synthetic-project'},operations:{
    history:'IMPLEMENTED',context:'IMPLEMENTED',proposal:'LOCAL_MODEL_REQUIRED',manualProposal:'IMPLEMENTED',
    diff:'IMPLEMENTED',validate:'IMPLEMENTED',stage:'IMPLEMENTED',verify:'STATIC_SYNTAX_AND_DIFF_ONLY',prepare:'LOCAL_BRANCH_ONLY'}};
  let task:any={id:taskId,orgId:member.orgId,projectId:'synthetic-project',version:1,state:'CONTEXT_BOUND',summary:'Mudança sintética'};
  let taskList:any[]=[];
  let overrides=new Map<string,any>();
  const reply=(data:any,statusCode=200,contentType='application/json')=>({ok:statusCode>=200&&statusCode<300,status:statusCode,headers:{get:()=>contentType},json:async()=>data});
  const sandbox={
    document:{getElementById:el,createElement:()=>new Element()},location:{origin},
    window:{addEventListener:(name:string,handler:any)=>windowHandlers.set(name,handler)},
    AbortController,setTimeout,clearTimeout,
    fetch:async(url:string,options:any)=>{
      const route=url.replace('http://127.0.0.1:38765','');calls.push({url,route,options});
      if(overrides.has(route)){const value=overrides.get(route);return typeof value==='function'?value(options):value;}
      if(route==='/health')return reply({service:'AURORA_IA_MASTER',version:'1.0.3'});
      if(route==='/api/session')return reply(sessionResponse);
      if(route==='/api/status')return reply(status);
      if(route==='/api/logout')return reply({ok:true});
      if(route==='/api/studio/capabilities')return reply(capabilities);
      if(route==='/api/studio/context')return reply({context:{id:'d'.repeat(32),files:[{path:'src/example.js',beforeSha256:'e'.repeat(64),content:'const synthetic=true;'}]}});
      if(route==='/api/studio/tasks'){
        if(options.method==='POST'){taskList=[{...task}];return reply({task});}
        return reply({tasks:taskList});
      }
      if(route==='/api/studio/tasks/'+task.id)return reply({task});
      if(route.endsWith('/diff'))return reply({taskId:task.id,version:task.version,diff:'--- before\n+++ after\n+synthetic change',validation:{proposalFingerprint:fingerprint}});
      const operation=route.split('/').pop()!;
      const states:any={propose:'PROPOSED',proposal:'PROPOSED',validate:'VALIDATED',stage:'PATCH_STAGED',verify:'STATIC_CHECKS_PASSED',prepare:'VERSION_PREPARED'};
      if(states[operation]){
        const payload=JSON.parse(options.body);assert.equal(payload.expectedVersion,task.version);
        task={...task,version:task.version+1,state:states[operation],proposalFingerprint:fingerprint};taskList=[{...task}];
        return reply({task,validation:operation==='validate'?{valid:true}:undefined,
          verification:operation==='verify'?{state:'STATIC_CHECKS_PASSED',projectTestRunner:'NOT_IMPLEMENTED'}:undefined,
          preparedVersion:operation==='prepare'?{branch:'refs/heads/aurora-studio/'+task.id,commit:'a'.repeat(40)}:undefined});
      }
      if(route==='/api/improve')return reply({state:'PROPOSAL_ONLY',applied:false,externalAiCalls:0,proposal:{text:'Proposta sintética para revisão.'}});
      if(route==='/api/native')return reply({authority:'LOCAL_UNVERIFIED_PREVIEW',cloudSyncVerified:false,externalAiCalls:0,master:{state:'ATTENTION'}});
      return reply({code:'NOT_FOUND'},404);
    },
  };
  new Script(iaMasterClient(member)).runInContext(createContext(sandbox));
  const click=async(id:string)=>{await el(id).handlers.get('click')?.();};
  const submit=async(id:string)=>{await el(id).handlers.get('submit')({preventDefault(){}});};
  const connect=async()=>{el('master-pair-ticket').value=ticket;await submit('master-pair-form');};
  const createTask=async()=>{el('master-context-paths').value='src/example.js';el('master-task-prompt').value='Melhore o exemplo com teste e reversão.';await submit('master-task-form');};
  return {el,calls,windowHandlers,click,submit,connect,createTask,reply,
    status:(patch:any)=>{status={...status,...patch};},capabilities:(value:any)=>{capabilities=value;},
    session:(value:any)=>{sessionResponse=value;},override:(route:string,value:any)=>{overrides.set(route,value);},
    task:(value:any)=>{task={...task,...value};taskList=[{...task}];},tasks:(value:any[])=>{taskList=value;}};
}

test('Master requires full-scope administrator MFA and never embeds a runtime credential',()=>{
  for(const patch of [{role:'director'},{role:'viewer'},{allFacilities:false},{mfaVerified:false},{orgId:'</script>'}]){
    const denied={...member,...patch};assert.equal(canAccessIaMaster(denied),false);assert.equal(iaMasterSection(denied),'');assert.equal(iaMasterClient(denied),'');
  }
  assert.equal(canAccessIaMaster({...member,role:'platform_admin'}),true);
  const html=iaMasterSection(member);assert.match(html,/type="password" autocomplete="off"/);assert.doesNotMatch(html,/id="master-apply"/);
  assert.doesNotMatch(html,/<iframe|<script|ChatGPT|token=|http:\/\//);
  assert.doesNotThrow(()=>new Script(iaMasterClient(member)));
});

test('no automatic probe and unsupported origins cannot call the local bridge',async()=>{
  const fresh=fixture();assert.equal(fresh.calls.length,0);assert.equal(fresh.el('master-improve').disabled,true);
  const denied=fixture('https://untrusted.example.invalid');assert.equal(denied.el('master-connect').disabled,true);
  await denied.connect();await denied.click('master-health');assert.equal(denied.calls.length,0);
});

test('manual one-use ticket creates only an in-memory loopback session without cloud cookies',async()=>{
  const f=fixture();await f.connect();assert.equal(f.el('master-pair-ticket').value,'');assert.equal(f.el('master-improve').disabled,false);
  const pairing=f.calls.find(c=>c.route==='/api/session');assert.deepEqual(JSON.parse(pairing.options.body),{ticket});
  assert.equal(pairing.options.headers.Authorization,undefined);
  for(const call of f.calls){assert.ok(call.url.startsWith('http://127.0.0.1:38765/'));assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');}
  assert.equal(f.calls.find(c=>c.route==='/api/status').options.headers.Authorization,'Bearer '+token);
  assert.equal(f.el('master-cloud-status').textContent,'Não confirmada');
  assert.doesNotMatch(iaMasterClient(member),/localStorage|sessionStorage|location\.(?:search|hash)|URLSearchParams|console\.|firebase-admin|gstatic|document\.cookie/);
});

test('legacy session, wrong tenant, foreign policy and unavailable model remain blocked',async()=>{
  const legacy=fixture();legacy.session({ok:true});await legacy.connect();assert.equal(legacy.el('master-improve').disabled,true);assert.match(legacy.el('master-studio-status').textContent,/versão local/);
  const wrong=fixture();wrong.session({ok:true,sessionToken:token,orgId:'other-company'});await wrong.connect();assert.equal(wrong.calls.some(c=>c.route==='/api/status'),false);
  const statusWrong=fixture();statusWrong.status({orgId:'other-company'});await statusWrong.connect();assert.equal(statusWrong.el('master-native').disabled,true);
  const external=fixture();external.status({metrics:{externalAiCalls:1,externalTokens:1}});await external.connect();assert.equal(external.el('master-improve').disabled,true);
  const unavailable=fixture();unavailable.status({modelState:'UNAVAILABLE'});await unavailable.connect();assert.equal(unavailable.el('master-improve').disabled,true);assert.equal(unavailable.el('master-native').disabled,false);
});

test('proposals are explicit local previews and missing responses clear the pending result',async()=>{
  const f=fixture();await f.connect();f.el('master-prompt').value='Proponha uma melhoria sintética com reversão.';await f.submit('master-improve-form');
  assert.match(f.el('master-proposal-output').textContent,/Código aplicado: não/);assert.equal(f.calls.some(c=>c.route.endsWith('/apply')),false);
  f.override('/api/improve',f.reply({code:'LOCAL_MODEL_UNAVAILABLE'},503));await f.submit('master-improve-form');
  assert.equal(f.el('master-proposal-output').textContent,'Proposta não confirmada.');assert.doesNotMatch(f.el('master-studio-status').textContent,/503/);
});

test('native input enforces tenant and nonclinical classification before transferring a snapshot',async()=>{
  const f=fixture();await f.connect();
  for(const snapshot of [{orgId:'other-company',sensitivity:'INTERNAL'},{orgId:member.orgId,sensitivity:'CLINICAL_SENSITIVE'}]){
    f.el('master-snapshot').value=JSON.stringify(snapshot);await f.submit('master-native-form');
  }
  assert.equal(f.calls.some(c=>c.route==='/api/native'),false);
  f.el('master-snapshot').value=JSON.stringify({orgId:member.orgId,sensitivity:'INTERNAL'});await f.submit('master-native-form');
  assert.match(f.el('master-native-output').textContent,/autenticidade.*não comprovada/);assert.equal(f.el('master-cloud-status').textContent,'Não confirmada');
});

test('Studio paths and sensitive prompts are rejected before reading repository context',async()=>{
  const f=fixture();await f.connect();f.el('master-task-prompt').value='Melhore o exemplo sintético.';
  for(const path of ['../private.txt','/absolute.js','.env.production','control.key','node_modules/code.js','C:\\secret.js']){
    f.el('master-context-paths').value=path;await f.submit('master-task-form');
  }
  f.el('master-context-paths').value='src/example.js';f.el('master-task-prompt').value='Bearer SECRET_SYNTHETIC_CREDENTIAL';await f.submit('master-task-form');
  assert.equal(f.calls.some(c=>c.route==='/api/studio/context'),false);
});

test('confirmed task follows diff, validation, isolated stage and static check; prepare needs explicit review',async()=>{
  const f=fixture();await f.connect();await f.createTask();assert.equal(f.el('master-validate').disabled,true);
  await f.click('master-task-propose');await f.click('master-diff');await f.click('master-validate');await f.click('master-stage');await f.click('master-verify');
  assert.match(f.el('master-validation-output').textContent,/não são os testes gerais/);assert.equal(f.el('master-prepare').disabled,true);
  await f.click('master-prepare');assert.equal(f.calls.some(c=>c.route.endsWith('/prepare')),false);
  await f.click('master-diff');
  f.el('master-apply-confirm').checked=true;await f.el('master-apply-confirm').handlers.get('change')();assert.equal(f.el('master-prepare').disabled,false);
  await f.click('master-prepare');assert.match(f.el('master-apply-status').textContent,/local isolada preparada/);
  assert.equal(f.calls.some(c=>c.route.endsWith('/apply')),false);assert.equal(f.calls.some(c=>/push|deploy/.test(c.route)),false);
});

test('chosen line range is bound to the selected file and discarded on session end',async()=>{
  const f=fixture();await f.connect();
  f.el('master-context-focus').value='src/example.js@20-60';await f.createTask();
  const body=JSON.parse(f.calls.find(c=>c.route==='/api/studio/context').options.body);
  assert.deepEqual(body.focus,[{path:'src/example.js',startLine:20,endLine:60}]);
  f.windowHandlers.get('aurora:session-ended')();assert.equal(f.el('master-context-focus').value,'');
});

test('Master exposes a knowledge receipt without treating loaded records as complete absorption',async()=>{
  const f=fixture();f.status({knowledge:{status:'LOADED',loadedCount:20,completeHistoricalAbsorption:false}});await f.connect();
  assert.match(f.el('master-knowledge-status').textContent,/20 registros disponíveis/);
  const receipt={status:'LOADED',corpusHash:'a'.repeat(64),recordIds:['synthetic-method'],selectedContextBytes:400,maxContextBytes:600,completeHistoricalAbsorption:false};
  f.task({knowledge:receipt,modelContext:{complete:false,files:[]}});await f.click('master-history-refresh');await f.el('master-history-list').children[0].handlers.get('click')();
  assert.match(f.el('master-context-output').textContent,/somente os trechos/);
  assert.match(f.el('master-context-output').textContent,/recibo; não inclui o conteúdo/);
  assert.match(f.el('master-context-output').textContent,/synthetic-method/);
  f.windowHandlers.get('aurora:session-ended')();assert.equal(f.el('master-knowledge-status').textContent,'Não confirmado');
});

test('invalid or unselected line ranges do not read context or create a task',async()=>{
  const f=fixture();await f.connect();
  for(const value of ['src/other.js@20-60','src/example.js@0-60','src/example.js@60-20','src/example.js@1-90000000','src/example.js@1-20\nsrc/example.js@30-60','../private.js@1-20']){
    f.el('master-context-focus').value=value;await f.createTask();
    assert.match(f.el('master-studio-status').textContent,/um trecho por arquivo selecionado/);
  }
  assert.equal(f.calls.some(c=>c.route==='/api/studio/context'),false);
  assert.equal(f.calls.some(c=>c.route==='/api/studio/tasks'&&c.options.method==='POST'),false);
});

test('version conflict clears task review and prevents replay of a prepared mutation',async()=>{
  const f=fixture();await f.connect();await f.createTask();await f.click('master-task-propose');await f.click('master-diff');
  f.override('/api/studio/tasks/'+taskId+'/validate',f.reply({code:'SENSITIVE_INTERNAL_REVISION'},409));await f.click('master-validate');
  assert.match(f.el('master-studio-status').textContent,/tarefa mudou/);assert.equal(f.el('master-prepare').disabled,true);assert.equal(f.el('master-apply-confirm').checked,false);
  assert.doesNotMatch(f.el('master-studio-status').textContent,/SENSITIVE/);
});

test('unauthorized local responses clear all private inputs and outputs',async()=>{
  const f=fixture();await f.connect();f.el('master-prompt').value='Proposta sintética de teste';f.el('master-snapshot').value='PRIVATE_SYNTHETIC_INPUT';
  f.override('/api/improve',f.reply({code:'LOCAL_AUTH_REQUIRED'},401));await f.submit('master-improve-form');
  assert.equal(f.el('master-prompt').value,'');assert.equal(f.el('master-snapshot').value,'');assert.equal(f.el('master-native').disabled,true);assert.equal(f.el('master-disconnect').disabled,true);
});

test('page exit and root session end revoke memory-only session and discard in-flight responses',async()=>{
  for(const event of ['pagehide','aurora:session-ended']){
    const f=fixture();await f.connect();f.el('master-prompt').value='Melhore o exemplo sintético.';let finish:any;
    f.override('/api/improve',()=>new Promise(resolve=>{finish=resolve;}));const pending=f.submit('master-improve-form');await new Promise(resolve=>setImmediate(resolve));
    f.windowHandlers.get(event)();finish(f.reply({state:'PROPOSAL_ONLY',applied:false,externalAiCalls:0,proposal:{text:'LATE_SYNTHETIC_RESPONSE'}}));await pending;
    assert.equal(f.el('master-prompt').value,'');assert.doesNotMatch(f.el('master-proposal-output').textContent,/LATE/);assert.equal(f.el('master-connect').disabled,true);
    assert.ok(f.calls.some(c=>c.route==='/api/logout'&&c.options.keepalive===true));
  }
});

test('concurrent clicks cannot duplicate a task or inference',async()=>{
  const f=fixture();await f.connect();f.el('master-prompt').value='Melhore o exemplo sintético.';let finish:any;
  f.override('/api/improve',()=>new Promise(resolve=>{finish=resolve;}));const pending=f.submit('master-improve-form');await new Promise(resolve=>setImmediate(resolve));
  await f.submit('master-improve-form');assert.equal(f.calls.filter(c=>c.route==='/api/improve').length,1);
  finish(f.reply({state:'PROPOSAL_ONLY',applied:false,externalAiCalls:0,proposal:{text:'SYNTHETIC_PROPOSAL'}}));await pending;
});

test('confirmed file catalog selects bounded authorized context without raw path typing',async()=>{
  const f=fixture();f.override('/api/studio/capabilities',f.reply({externalAiEnabled:false,repository:{state:'AVAILABLE',projectId:'synthetic-project',allowedPaths:['src/example.js']},operations:{history:'IMPLEMENTED',context:'IMPLEMENTED',proposal:'LOCAL_MODEL_REQUIRED',manualProposal:'IMPLEMENTED',diff:'IMPLEMENTED',validate:'IMPLEMENTED',stage:'IMPLEMENTED',verify:'STATIC_SYNTAX_AND_DIFF_ONLY',prepare:'LOCAL_BRANCH_ONLY'}}));
  await f.connect();const catalog=f.el('master-file-catalog');assert.equal(catalog.children.length,1);
  const checkbox=catalog.children[0].children[0];assert.equal(checkbox.type,'checkbox');assert.equal(checkbox.value,'src/example.js');checkbox.checked=true;
  f.el('master-task-prompt').value='Aprimore o exemplo sintético para revisão.';await f.submit('master-task-form');
  const call=f.calls.find(c=>c.route==='/api/studio/context');assert.deepEqual(JSON.parse(call.options.body).paths,['src/example.js']);
  f.windowHandlers.get('aurora:session-ended')();assert.equal(catalog.children.length,0);
});

test('unconfirmed or traversing catalog does not become a selectable context',async()=>{
  const f=fixture();f.override('/api/studio/capabilities',f.reply({externalAiEnabled:false,repository:{state:'AVAILABLE',projectId:'synthetic-project',allowedPaths:['../private/key.txt']},operations:{history:'IMPLEMENTED',context:'IMPLEMENTED'}}));
  await f.connect();assert.equal(f.el('master-file-catalog').children.length,0);assert.match(f.el('master-file-catalog').textContent,/não confirmado/);
  f.el('master-task-prompt').value='Pedido sintético para revisão.';await f.submit('master-task-form');assert.equal(f.calls.filter(c=>c.route==='/api/studio/context').length,0);
});

test('catalog distinguishes editable modules from files beyond the confirmed model limit',async()=>{
  const f=fixture();f.override('/api/studio/capabilities',f.reply({externalAiEnabled:false,repository:{state:'AVAILABLE',projectId:'synthetic-project',allowedPaths:['src/example.js','src/oversized.js'],fileCatalog:[{path:'src/example.js',state:'EDITABLE',byteLength:150},{path:'src/oversized.js',state:'CONTENT_LIMIT',byteLength:58000}]},operations:{history:'IMPLEMENTED',context:'IMPLEMENTED'}}));
  await f.connect();const rows=f.el('master-file-catalog').children;assert.equal(rows.length,2);assert.equal(rows[0].children[0].disabled,false);assert.equal(rows[1].children[0].disabled,true);assert.match(rows[1].children[1].children[0].textContent,/módulo menor/);
});

test('partial Git preparation does not offer a retry mutation on a blocked task',async()=>{
  for(const state of ['STAGING_BLOCKED','PREPARATION_BLOCKED']){
    const f=fixture();await f.connect();f.task({state,proposalFingerprint:fingerprint});await f.click('master-history-refresh');await f.el('master-history-list').children[0].handlers.get('click')();
    assert.equal(f.el('master-stage').disabled,true);assert.equal(f.el('master-prepare').disabled,true);
    await f.click('master-stage');await f.click('master-prepare');assert.equal(f.calls.filter(c=>c.route.endsWith('/stage')||c.route.endsWith('/prepare')).length,0);
  }
});
