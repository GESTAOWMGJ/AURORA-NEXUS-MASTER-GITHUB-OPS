import assert from 'node:assert/strict';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { canAccessIaMaster, iaMasterSection } from '../src/auroraIaMasterView.js';
import { iaMasterClient } from '../src/auroraIaMasterClient.js';

const member = {orgId:'synthetic-company',role:'org_admin',allFacilities:true,mfaVerified:true};
const token = 'S'.repeat(43), ticket = 'T'.repeat(43), fingerprint='f'.repeat(64), taskId='c'.repeat(32);
class Element {
  value=''; textContent=''; hidden=false; disabled=false; checked=false; className=''; type='';
  href='';
  children:Element[]=[]; handlers=new Map<string,any>();
  addEventListener(name:string,handler:any){this.handlers.set(name,handler);}
  replaceChildren(){this.children=[];this.textContent='';}
  appendChild(child:Element){this.children.push(child);}
  removeAttribute(name:string){if(name==='href')this.href='';}
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
    task:(value:any)=>{task={...task,...value};taskList=[{...task}];},currentTask:()=>task,tasks:(value:any[])=>{taskList=value;}};
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

const publisherRepo='GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS',preparedHead='a'.repeat(40),preparedBase='b'.repeat(40),preparedTree='d'.repeat(40);
function publisherCapabilities(){
  return {schemaVersion:'aurora.master.studio.v1',authenticatedOrgId:member.orgId,externalAiEnabled:false,repository:{state:'AVAILABLE',projectId:'synthetic-project'},operations:{
    history:'IMPLEMENTED',context:'IMPLEMENTED',proposal:'LOCAL_MODEL_REQUIRED',manualProposal:'IMPLEMENTED',diff:'IMPLEMENTED',validate:'IMPLEMENTED',stage:'IMPLEMENTED',verify:'STATIC_SYNTAX_AND_DIFF_ONLY',prepare:'LOCAL_BRANCH_ONLY',publish:'DRAFT_PR_ONLY',ci:'REMOTE_METADATA_ONLY'},
    publisher:{schemaVersion:'aurora.master.publisher.v1',state:'CONFIGURED_AUTH_NOT_OBSERVED',repository:publisherRepo,baseBranch:'main',publish:'OPT_IN_DRAFT_ONLY_AUTH_NOT_OBSERVED',ci:'REMOTE_METADATA_ONLY',modelCanExecuteCommands:false,canMerge:false,canDeploy:false,canDispatch:false,credentialReadByApplication:false}};
}
function publicationReceipt(overrides:any={}){
  return {schemaVersion:'aurora.master.publisher.v1',state:'DRAFT_CONFIRMED',publicationVersion:1,orgId:member.orgId,taskId,taskVersion:9,repository:publisherRepo,
    headSha:preparedHead,baseSha:preparedBase,proposalFingerprint:fingerprint,pullRequest:{number:345,url:'https://github.com/'+publisherRepo+'/pull/345',draft:true,headSha:preparedHead,baseSha:preparedBase},
    ci:null,receiptSha256:'1'.repeat(64),history:[{at:'2026-10-12T12:00:00.000Z',version:1,state:'DRAFT_CONFIRMED',previousEventHash:null,eventHash:'2'.repeat(64)}],historyEventCount:1,deployed:false,merged:false,projectTestsRunLocally:false,...overrides};
}
async function preparedPublisherFixture(){
  const f=fixture();f.capabilities(publisherCapabilities());f.task({schemaVersion:'aurora.master.studio.v1',state:'VERSION_PREPARED',version:9,baseRevision:preparedBase,proposalFingerprint:fingerprint,
    verification:{state:'STATIC_CHECKS_PASSED',proposalFingerprint:fingerprint,arbitraryCodeExecuted:false},
    preparedVersion:{state:'PREPARED_LOCAL_ONLY',commit:preparedHead,tree:preparedTree,baseRevision:preparedBase,proposalFingerprint:fingerprint,branch:'refs/heads/aurora-studio/'+taskId,pushed:false,deployed:false}});
  await f.connect();await f.el('master-history-list').children[0].handlers.get('click')();return f;
}
async function publicationIntent(f:any){await f.click('master-diff');f.el('master-publish-confirm').checked=true;await f.el('master-publish-confirm').handlers.get('change')();}
function publicationReply(f:any,value:any,taskPatch:any={}){return f.reply({task:{...f.currentTask(),...taskPatch,publication:value},publication:value});}
function ciReceipt(overrides:any={}){
  return {state:'NO_CHECKS_OBSERVED',observedAt:'2026-10-12T12:01:00.000Z',proposedHeadSha:preparedHead,apiHeadSha:preparedHead,currentHeadSha:preparedHead,preparedBaseSha:preparedBase,
    currentBaseSha:preparedBase,baseCurrent:true,actualCheckout:'NOT_OBSERVED',ciVerified:false,requiredCoverage:'NOT_OBSERVED',completeRemoteListing:true,checks:[],runs:[],...overrides};
}
test('Publisher requires exact opt-in contracts, task proof, diff review and public draft intent',async()=>{
  const missing=fixture();await missing.connect();assert.equal(missing.el('master-publish-draft').disabled,true);await missing.click('master-publish-draft');assert.equal(missing.calls.some(c=>c.route.endsWith('/publish-draft')),false);
  for(const patch of [{canMerge:true},{canDeploy:true},{credentialReadByApplication:true},{repository:'other/repository'},{baseBranch:'other'},{state:'CONFIG_INVALID'}]){
    const f=fixture(),caps=publisherCapabilities();caps.publisher={...caps.publisher,...patch};f.capabilities(caps);await f.connect();await f.click('master-publish-draft');assert.equal(f.calls.some(c=>c.route.endsWith('/publish-draft')),false);
  }
  const f=await preparedPublisherFixture();assert.equal(f.el('master-publish-draft').disabled,true);await f.click('master-publish-draft');assert.equal(f.calls.some(c=>c.route.endsWith('/publish-draft')),false);
  await f.click('master-diff');assert.equal(f.el('master-publish-draft').disabled,true);f.el('master-publish-confirm').checked=true;await f.el('master-publish-confirm').handlers.get('change')();assert.equal(f.el('master-publish-draft').disabled,false);
  assert.match(f.el('master-publisher-capability').textContent,/autorização GitHub ainda não observada/);
  assert.match(iaMasterSection(member),/repositório público/);
});
test('valid draft receipt binds the exact prepared commit without incrementing task version or direct GitHub request',async()=>{
  const f=await preparedPublisherFixture();await publicationIntent(f);const receipt=publicationReceipt();f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,receipt));
  await f.click('master-publish-draft');const call=f.calls.find(c=>c.route.endsWith('/publish-draft'));assert.deepEqual(JSON.parse(call.options.body),{expectedVersion:9,proposalFingerprint:fingerprint});
  assert.equal(f.el('master-publication-link').href,receipt.pullRequest.url);assert.equal(f.el('master-publication-link').hidden,false);assert.match(f.el('master-publication-status').textContent,/PR draft confirmado/);
  assert.match(f.el('master-selected-status').textContent,/revisão 9/);assert.equal(f.el('master-publish-confirm').checked,false);assert.equal(f.el('master-publish-draft').disabled,true);
  assert(f.calls.every(c=>c.url.startsWith('http://127.0.0.1:38765/')));assert.equal(f.calls.some(c=>/merge|deploy|dispatch/.test(c.route)),false);
});
test('forged publication URL, draft status, tenant, fingerprint or task version never become a clickable receipt',async()=>{
  for(const changed of [
    {pullRequest:{...publicationReceipt().pullRequest,url:'https://evil.invalid/pull/345'}},
    {pullRequest:{...publicationReceipt().pullRequest,url:'https://github.com/'+publisherRepo+'/pull/345?token=unverified'}},
    {pullRequest:{...publicationReceipt().pullRequest,draft:false}},
    {orgId:'other-company'},{proposalFingerprint:'9'.repeat(64)},{headSha:'8'.repeat(40)},{taskVersion:10},
  ]){
    const f=await preparedPublisherFixture();await publicationIntent(f);const receipt=publicationReceipt(changed);f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,receipt));await f.click('master-publish-draft');
    assert.equal(f.el('master-publication-link').hidden,true);assert.equal(f.el('master-publication-link').href,'');assert.match(f.el('master-studio-status').textContent,/recibo não corresponde/);assert.equal(f.el('master-publish-draft').disabled,true);
  }
});
test('Publisher rejects an incremented task revision or changed prepared tree from the publication operation',async()=>{
  for(const patch of [{version:10},{preparedVersion:{state:'PREPARED_LOCAL_ONLY',commit:preparedHead,tree:'e'.repeat(40)}}]){
    const f=await preparedPublisherFixture();await publicationIntent(f);f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,publicationReceipt(),patch));await f.click('master-publish-draft');
    assert.equal(f.el('master-publication-link').hidden,true);assert.match(f.el('master-selected-status').textContent,/revisão 9/);
  }
});
test('CI exposes successful remote metadata with checkout unobserved and ciVerified false',async()=>{
  const f=await preparedPublisherFixture();await publicationIntent(f);f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,publicationReceipt()));await f.click('master-publish-draft');
  const ci=ciReceipt({state:'REMOTE_CHECKS_PASSED',checks:[{id:1,name:'Synthetic metadata check',apiHeadSha:preparedHead,status:'completed',conclusion:'success',actualCheckout:'NOT_OBSERVED'}]});
  const observed=publicationReceipt({state:'CI_OBSERVED',ci,publicationVersion:2,receiptSha256:'3'.repeat(64),historyEventCount:2,history:[...publicationReceipt().history,{at:'2026-10-12T12:01:00.000Z',version:2,state:'CI_OBSERVED',previousEventHash:'2'.repeat(64),eventHash:'4'.repeat(64)}]});
  f.override('/api/studio/tasks/'+taskId+'/read-ci',()=>publicationReply(f,observed));await f.click('master-read-ci');
  assert.match(f.el('master-publication-output').textContent,/CI não verificada/);assert.match(f.el('master-publication-output').textContent,/"ciVerified": false/);assert.match(f.el('master-publication-output').textContent,/"actualCheckout": "NOT_OBSERVED"/);
  assert.equal(f.calls.filter(c=>c.route.endsWith('/read-ci')).length,1);assert.match(f.el('master-selected-status').textContent,/revisão 9/);
});
test('empty remote CI is a single explicit observation and cannot become verified coverage',async()=>{
  const f=await preparedPublisherFixture();await publicationIntent(f);f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,publicationReceipt()));await f.click('master-publish-draft');
  const p=publicationReceipt({state:'CI_OBSERVED',ci:ciReceipt(),publicationVersion:2,receiptSha256:'3'.repeat(64),historyEventCount:2,history:[...publicationReceipt().history,{at:'2026-10-12T12:01:00.000Z',version:2,state:'CI_OBSERVED',previousEventHash:'2'.repeat(64),eventHash:'4'.repeat(64)}]});
  f.override('/api/studio/tasks/'+taskId+'/read-ci',()=>publicationReply(f,p));await f.click('master-read-ci');
  assert.match(f.el('master-publication-output').textContent,/NO_CHECKS_OBSERVED/);assert.match(f.el('master-publication-output').textContent,/"requiredCoverage": "NOT_OBSERVED"/);assert.equal(f.calls.filter(c=>c.route.endsWith('/read-ci')).length,1);
});
test('CI proposed SHA drift or forged checkout assurance is rejected; actual base drift remains visibly stale',async()=>{
  for(const changed of [{proposedHeadSha:'8'.repeat(40)},{apiHeadSha:'8'.repeat(40)},{ciVerified:true},{actualCheckout:'VERIFIED'}]){
    const f=await preparedPublisherFixture();await publicationIntent(f);f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,publicationReceipt()));await f.click('master-publish-draft');
    f.override('/api/studio/tasks/'+taskId+'/read-ci',()=>publicationReply(f,publicationReceipt({ci:ciReceipt(changed)})));await f.click('master-read-ci');assert.equal(f.el('master-publication-link').hidden,true);assert.match(f.el('master-studio-status').textContent,/recibo não corresponde/);
  }
  const f=await preparedPublisherFixture();await publicationIntent(f);f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,publicationReceipt()));await f.click('master-publish-draft');
  const ci=ciReceipt({state:'BASE_CHANGED',currentBaseSha:'8'.repeat(40),baseCurrent:false}),p=publicationReceipt({ci,receiptSha256:'3'.repeat(64),state:'CI_OBSERVED',publicationVersion:2,historyEventCount:2,history:[...publicationReceipt().history,{at:'2026-10-12T12:01:00.000Z',version:2,state:'CI_OBSERVED',previousEventHash:'2'.repeat(64),eventHash:'4'.repeat(64)}]});
  f.override('/api/studio/tasks/'+taskId+'/read-ci',()=>publicationReply(f,p));await f.click('master-read-ci');assert.match(f.el('master-publication-status').textContent,/base principal mudou/);assert.equal(f.el('master-publish-draft').disabled,true);
});
test('publication uncertainty requires explicit reconciliation without pushing or polling automatically',async()=>{
  const f=await preparedPublisherFixture();await publicationIntent(f);f.override('/api/studio/tasks/'+taskId+'/publish-draft',f.reply({code:'PUBLISH_RECOVERY_REQUIRED'},409));await f.click('master-publish-draft');
  assert.equal(f.el('master-publish-draft').disabled,true);assert.equal(f.el('master-reconcile-publication').disabled,false);assert.equal(f.calls.filter(c=>c.route.endsWith('/publish-draft')).length,1);assert.equal(f.calls.some(c=>c.route.endsWith('/reconcile-publication')),false);
  const p=publicationReceipt({state:'RETRY_OBSERVATION',pullRequest:null,history:[{at:'2026-10-12T12:00:00.000Z',version:1,state:'RETRY_OBSERVATION',previousEventHash:null,eventHash:'2'.repeat(64)}]});
  f.override('/api/studio/tasks/'+taskId+'/reconcile-publication',()=>publicationReply(f,p));await f.click('master-reconcile-publication');assert.equal(f.el('master-publish-draft').disabled,true);assert.equal(f.calls.filter(c=>c.route.endsWith('/reconcile-publication')).length,1);assert.match(f.el('master-publication-status').textContent,/nova conferência ainda necessária/);
});
test('publisher task conflict clears selection and cannot replay stale version on reconciliation',async()=>{
  const f=await preparedPublisherFixture();await publicationIntent(f);f.override('/api/studio/tasks/'+taskId+'/publish-draft',f.reply({code:'STUDIO_VERSION_CONFLICT'},409));await f.click('master-publish-draft');
  assert.match(f.el('master-studio-status').textContent,/revisão da tarefa mudou/);assert.equal(f.el('master-reconcile-publication').disabled,true);assert.equal(f.el('master-publish-draft').disabled,true);
  await f.click('master-reconcile-publication');assert.equal(f.calls.some(c=>c.route.endsWith('/reconcile-publication')),false);
});
test('publication timeout and session exit discard receipt, link and intent and never trigger automatic retry',async()=>{
  const f=await preparedPublisherFixture();await publicationIntent(f);f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>{const e=Error('synthetic timeout');e.name='AbortError';throw e;});await f.click('master-publish-draft');
  assert.equal(f.calls.filter(c=>c.route.endsWith('/publish-draft')).length,1);assert.equal(f.el('master-publication-link').hidden,true);assert.equal(f.el('master-publication-link').href,'');assert.equal(f.el('master-publish-confirm').checked,false);assert.equal(f.el('master-publish-draft').disabled,true);assert.equal(f.calls.some(c=>c.route.endsWith('/reconcile-publication')||c.route.endsWith('/read-ci')),false);
  for(const event of ['pagehide','aurora:session-ended']){
    const v=await preparedPublisherFixture();await publicationIntent(v);v.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(v,publicationReceipt()));await v.click('master-publish-draft');v.windowHandlers.get(event)();
    assert.equal(v.el('master-publication-link').href,'');assert.equal(v.el('master-publication-link').hidden,true);assert.equal(v.el('master-publication-output').textContent,'Nenhum recibo de publicação confirmado.');
  }
});
test('draft observed after base changed is read-only recovery, with exact link and separate observed base',async()=>{
  const f=await preparedPublisherFixture();await publicationIntent(f);const advancedBase='8'.repeat(40),observed={...publicationReceipt().pullRequest,baseSha:advancedBase};
  const p=publicationReceipt({state:'BASE_CHANGED',pullRequest:null,observedPullRequest:observed,history:[{at:'2026-10-12T12:00:00.000Z',version:1,state:'BASE_CHANGED',previousEventHash:null,eventHash:'2'.repeat(64)}]});
  f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,p));await f.click('master-publish-draft');
  assert.match(f.el('master-publication-status').textContent,/Draft encontrado; a base principal mudou/);assert.equal(f.el('master-publication-link').href,observed.url);assert.equal(f.el('master-publish-draft').disabled,true);assert.equal(f.el('master-read-ci').disabled,false);assert.equal(f.el('master-reconcile-publication').disabled,false);
  const ci=ciReceipt({state:'BASE_CHANGED',currentBaseSha:advancedBase,baseCurrent:false}),r={...p,state:'CI_OBSERVED',ci,publicationVersion:2,historyEventCount:2,receiptSha256:'3'.repeat(64),history:[...p.history,{at:'2026-10-12T12:01:00.000Z',version:2,state:'CI_OBSERVED',previousEventHash:'2'.repeat(64),eventHash:'4'.repeat(64)}]};
  f.override('/api/studio/tasks/'+taskId+'/read-ci',()=>publicationReply(f,r));await f.click('master-read-ci');
  assert.match(f.el('master-publication-output').textContent,/"baseObservadaSha": "8{40}"/);assert.match(f.el('master-publication-output').textContent,/"ciVerified": false/);assert.equal(f.el('master-publish-draft').disabled,true);assert.match(f.el('master-selected-status').textContent,/revisão 9/);
});
test('observed draft rejects forged URL, head, base hash or another PR identity',async()=>{
  for(const change of [{url:'https://evil.invalid/pull/345'},{headSha:'8'.repeat(40)},{baseSha:'not-a-sha'},{draft:false},{number:346,url:'https://github.com/'+publisherRepo+'/pull/346'}]){
    const f=await preparedPublisherFixture();await publicationIntent(f);const p=publicationReceipt({observedPullRequest:{...publicationReceipt().pullRequest,baseSha:'8'.repeat(40),...change}});
    f.override('/api/studio/tasks/'+taskId+'/publish-draft',()=>publicationReply(f,p));await f.click('master-publish-draft');assert.equal(f.el('master-publication-link').href,'');assert.equal(f.el('master-publication-link').hidden,true);
  }
});
test('scrolling context, diff and receipts are reachable by keyboard with a descriptive accessible name',()=>{
  const html=iaMasterSection(member);
  for(const id of ['master-context-output','master-diff-output','master-validation-output','master-publication-output'])assert.match(html,new RegExp('id="'+id+'" tabindex="0" aria-label="[^"]+"'));
  assert.match(html,/#ia-master \.studio-diff:focus-visible/);
});
