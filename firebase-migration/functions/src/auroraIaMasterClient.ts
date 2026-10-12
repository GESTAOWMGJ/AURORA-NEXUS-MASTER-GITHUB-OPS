import { canAccessIaMaster, type IaMasterStudioMember } from "./auroraIaMasterView.js";

/** A paired loopback session stays in this closure; no cloud identity is forwarded. */
export function iaMasterClient(member?: IaMasterStudioMember): string {
  if (!canAccessIaMaster(member)) return "";
  const org = JSON.stringify(member!.orgId).replace(/</g, "\\u003c");
  return `(()=>{
const expectedOrg=${org}, localBase='http://127.0.0.1:38765';
const portalOrigins=new Set(['https://auroranexus.com.br','https://wmgj-hml-jfn-20260927.web.app']);
const el=id=>document.getElementById(id), supportedOrigin=portalOrigins.has(location.origin);
if(!el('ia-master'))return;
let token=null, connected=false, modelAvailable=false, busy=false, stopped=false, generation=0;
let studio=null, selected=null, prepared=null, reviewedFingerprint=null;
const controllers=new Set();
const set=(id,value)=>{el(id).textContent=String(value)};
const validId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const validTask=value=>value&&validId(value.id)&&Number.isSafeInteger(value.version)&&value.version>0&&typeof value.state==='string'&&(value.orgId===undefined||value.orgId===expectedOrg);
const sensitive=value=>/-----BEGIN .*PRIVATE KEY|\\bBearer\\s+[\\w.-]+|\\bsk-[a-zA-Z0-9]{12,}|\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b/i.test(value);
const stateNames={CONTEXT_BOUND:'Pedido registrado',PROPOSED:'Proposta gerada',VALIDATED:'Proposta validada',PATCH_STAGED:'Área isolada criada',STATIC_CHECKS_PASSED:'Verificação estática concluída',VERSION_PREPARED:'Versão local preparada',CHECK_FAILED:'Verificação pendente',STAGING_BLOCKED:'Área isolada pendente',PREPARATION_BLOCKED:'Preparo pendente'};
function renderFileCatalog(repository){
  const paths=repository?.allowedPaths;
  const list=el('master-file-catalog');list.replaceChildren();
  if(!Array.isArray(paths)||paths.length<1||paths.length>100||paths.some(path=>typeof path!=='string'||path.length>240||!/^[-A-Za-z0-9_./]+$/.test(path)||path.includes('..')||path.startsWith('/'))){set('master-file-catalog','Catálogo de arquivos ainda não confirmado. Use a seleção avançada somente com arquivos autorizados.');return;}
  const names={'auroraDesignSystem.ts':'Identidade visual','auroraExperience.ts':'Navegação e leitura','auroraIaMasterView.ts':'Estúdio Master','auroraFinancialPresentation.ts':'Apresentação dos valores','auroraFrontend.ts':'Painel de gestão'};
  const records=Array.isArray(repository.fileCatalog)?repository.fileCatalog:[];
  for(const path of paths){const record=records.find(item=>item&&item.path===path),label=document.createElement('label'),input=document.createElement('input'),title=document.createElement('span'),detail=document.createElement('small');label.className='module catalog-file';input.type='checkbox';input.value=path;if(records.length)input.disabled=!record||record.state!=='EDITABLE';title.textContent=names[path.split('/').pop()]||path.split('/').pop();const limits={CONTENT_LIMIT:'Escolha um módulo menor; este arquivo excede o limite.',SENSITIVE_CONTENT:'Conteúdo indisponível para o modelo.',UNAVAILABLE:'Arquivo não confirmado no projeto.'};detail.textContent=path+(input.disabled?' · '+(limits[record?.state]||'Edição não confirmada'):'');title.appendChild(detail);label.appendChild(input);label.appendChild(title);list.appendChild(label);}
}
function selectedContextPaths(){const list=el('master-file-catalog'),checked=typeof list.querySelectorAll==='function'?Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).filter(input=>!input.disabled).map(input=>input.value):[];return checked.length?checked:el('master-context-paths').value.split(/\\r?\\n/).map(path=>path.trim()).filter(Boolean);}
function selectedContextFocus(paths){
  const raw=el('master-context-focus').value.trim();if(!raw)return undefined;
  if(raw.length>4000)throw Error('INVALID_FOCUS');
  const entries=raw.split(/\\r?\\n/).map(value=>value.trim()).filter(Boolean),seen=new Set();
  if(entries.length>paths.length)throw Error('INVALID_FOCUS');
  return entries.map(value=>{const match=value.match(/^(.+)@([1-9][0-9]{0,6})-([1-9][0-9]{0,6})$/);if(!match||!paths.includes(match[1])||seen.has(match[1]))throw Error('INVALID_FOCUS');const startLine=Number(match[2]),endLine=Number(match[3]);if(endLine<startLine)throw Error('INVALID_FOCUS');seen.add(match[1]);return {path:match[1],startLine,endLine};});
}
function supports(operation){
  const ops=studio&&studio.operations;if(!connected||studio.repository?.state!=='AVAILABLE'||!ops)return false;
  const contracts={tasks:['history','IMPLEMENTED'],context:['context','IMPLEMENTED'],createTask:['context','IMPLEMENTED'],propose:['proposal','LOCAL_MODEL_REQUIRED'],proposal:['manualProposal','IMPLEMENTED'],diff:['diff','IMPLEMENTED'],validate:['validate','IMPLEMENTED'],stage:['stage','IMPLEMENTED'],verify:['verify','STATIC_SYNTAX_AND_DIFF_ONLY'],prepare:['prepare','LOCAL_BRANCH_ONLY']};
  const contract=contracts[operation];return Boolean(contract&&ops[contract[0]]===contract[1]);
}
function stageAllowed(operation){
  if(!selected)return false;
  const states={propose:['CONTEXT_BOUND','PROPOSED'],proposal:['CONTEXT_BOUND','PROPOSED','VALIDATED'],diff:['PROPOSED','VALIDATED','PATCH_STAGED','STATIC_CHECKS_PASSED','VERSION_PREPARED','CHECK_FAILED','PREPARATION_BLOCKED'],validate:['PROPOSED','VALIDATED'],stage:['VALIDATED'],verify:['PATCH_STAGED','CHECK_FAILED'],prepare:['STATIC_CHECKS_PASSED']};
  return Boolean(states[operation]?.includes(selected.state));
}
function canPrepare(){return Boolean(selected&&supports('prepare')&&stageAllowed('prepare')&&reviewedFingerprint&&reviewedFingerprint===selected.proposalFingerprint&&el('master-apply-confirm').checked)}
function controls(){
  el('master-connect').disabled=busy||stopped||!supportedOrigin||connected;
  el('master-pair-ticket').disabled=busy||stopped||!supportedOrigin||connected;
  el('master-health').disabled=busy||stopped||!supportedOrigin;
  el('master-disconnect').disabled=busy||!connected;
  el('master-improve').disabled=busy||!connected||!modelAvailable;
  el('master-native').disabled=busy||!connected;
  el('master-history-refresh').disabled=busy||!supports('tasks');
  el('master-task-create').disabled=busy||!supports('context')||!supports('createTask');
  el('master-task-propose').disabled=busy||!modelAvailable||!supports('propose')||!stageAllowed('propose');
  el('master-manual-proposal-submit').disabled=busy||!supports('proposal')||!stageAllowed('proposal');
  for(const [id,op] of [['master-diff','diff'],['master-validate','validate'],['master-stage','stage'],['master-verify','verify']])el(id).disabled=busy||!supports(op)||!stageAllowed(op);
  el('master-prepare').disabled=busy||!canPrepare();
  el('master-apply-confirm').disabled=busy||!supports('prepare')||!stageAllowed('prepare')||!reviewedFingerprint;
}
function clearTask(){selected=null;prepared=null;reviewedFingerprint=null;el('master-apply-confirm').checked=false;set('master-selected-status','Selecione uma tarefa confirmada.');set('master-diff-output','Nenhuma diferença confirmada.');set('master-validation-output','Nenhuma validação confirmada.');set('master-apply-status','Aplicação no cliente indisponível. O preparo cria somente uma versão local isolada.');}
function clearSession(message){
  generation++;for(const controller of controllers)controller.abort();controllers.clear();
  token=null;connected=false;modelAvailable=false;studio=null;clearTask();
  el('master-file-catalog').replaceChildren();set('master-file-catalog','Catálogo de arquivos ainda não confirmado.');
  for(const id of ['master-pair-ticket','master-prompt','master-snapshot','master-context-paths','master-context-focus','master-task-prompt','master-manual-proposal'])el(id).value='';
  set('master-model-status','Não verificado');set('master-external-status','Política ainda não confirmada');set('master-cloud-status','Não confirmada');set('master-knowledge-status','Não confirmado');
  set('master-connection-badge','Sem conexão confirmada');set('master-proposal-output','Nenhuma proposta confirmada.');set('master-native-output','Nenhuma leitura local confirmada.');
  set('master-context-output','Nenhum contexto confirmado.');
  el('master-history-list').replaceChildren();set('master-history-list','Histórico local indisponível.');set('master-studio-status',message);controls();
}
function message(error){
  const code=error&&error.message;
  const messages={LOCAL_AUTH_REQUIRED:'A sessão local expirou. Gere outro ticket para parear.',PAIRING_REQUIRED:'Ticket inválido ou expirado. Gere outro ticket no acesso local.',
    ORIGIN_REJECTED:'A ponte local ainda não autoriza a origem deste portal.',CROSS_SITE_REJECTED:'Esta versão local não oferece a ponte autorizada do portal.',
    LOCAL_MODEL_BUSY:'O modelo está ocupado. Aguarde e tente novamente.',LOCAL_MODEL_UNAVAILABLE:'O modelo local está indisponível; nenhum provedor externo será chamado.',
    TENANT_MISMATCH:'A sessão local pertence a outra empresa. Pareamento cancelado.',LOCAL_POLICY_UNCONFIRMED:'A política local sem IA externa não foi confirmada.',
    SESSION_CONTRACT_UNAVAILABLE:'Esta versão local não oferece uma sessão compatível com o estúdio do portal.',INVALID_TICKET:'Cole somente um ticket local de uso único válido.',
    INVALID_SNAPSHOT:'Revise o JSON sanitizado, a empresa e a classificação PUBLIC ou INTERNAL.',SENSITIVE_INPUT_REJECTED:'Retire dados sensíveis e credenciais antes de enviar.',
    INVALID_CONTEXT:'Informe caminhos relativos de arquivos autorizados, sem travessia ou diretórios privados.',INVALID_FOCUS:'Informe um trecho por arquivo selecionado, no formato caminho@20-60, com linhas positivas em ordem.',INVALID_PROMPT:'Descreva a melhoria com 8 a 6000 caracteres.',
    TASK_UNCONFIRMED:'A tarefa ou sua versão não foi confirmada pelo serviço local.',STUDIO_NOT_AVAILABLE:'O Studio local ou o repositório autorizado ainda está indisponível.',
    VERSION_CONFLICT:'A tarefa mudou durante a operação. Atualize o histórico antes de continuar.',PREPARATION_REVIEW_REQUIRED:'Revise as diferenças e confirme a criação da versão local antes de preparar.',
    STUDIO_CONTENT_LIMIT:'O arquivo ou conjunto ultrapassa o limite do modelo. Escolha módulos menores no catálogo.',STUDIO_MODEL_CONTEXT_LIMIT:'O contexto selecionado não cabe na leitura local. Escolha um módulo menor para esta proposta.',STUDIO_MODEL_OUTPUT_TRUNCATED:'O modelo não concluiu a proposta. Nenhuma alteração foi aplicada.',LOCAL_MODEL_OUTPUT_TRUNCATED:'O modelo não concluiu a proposta. Nenhuma alteração foi aplicada.',STUDIO_EDIT_AMBIGUOUS:'A proposta não identificou uma mudança única no arquivo. Solicite uma revisão mais precisa.',STUDIO_STATE_CONFLICT:'Esta tarefa está em outra etapa. Atualize o histórico para conferir o estado confirmado.',
    LOCAL_RESPONSE_INVALID:'A resposta local não confirmou o resultado esperado.',LOCAL_STALE_RESPONSE:'A sessão mudou; a resposta anterior foi descartada.'};
  return messages[code]||'Operação local não confirmada. Confira o serviço e a ponte autorizada antes de repetir.';
}
async function request(route,body,unauthenticated=false,timeoutMs=15000){
  if(stopped||!supportedOrigin)throw Error('ORIGIN_REJECTED');
  if(!/^\\/(health|api\\/(session|logout|status|native|improve|studio\\/(capabilities|context|tasks(?:\\/[a-f0-9]{32}(?:\\/(propose|proposal|diff|validate|stage|verify|prepare))?)?)))$/.test(route))throw Error('LOCAL_RESPONSE_INVALID');
  if(!unauthenticated&&!token)throw Error('LOCAL_AUTH_REQUIRED');
  const current=generation,controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),timeoutMs),headers={Accept:'application/json'};
  if(!unauthenticated)headers.Authorization='Bearer '+token;
  if(body!==undefined){headers['Content-Type']='application/json';headers['X-Aurora-Local']='1';}
  try{
    const response=await fetch(localBase+route,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    if(current!==generation)throw Error('LOCAL_STALE_RESPONSE');
    if(!String(response.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw Error('LOCAL_RESPONSE_INVALID');
    const result=await response.json();if(current!==generation)throw Error('LOCAL_STALE_RESPONSE');
    if(!response.ok){
      if(response.status===401||response.status===403){clearSession('Acesso local não confirmado. Pareie novamente quando a ponte estiver autorizada.');}
      throw Error(response.status===409?'VERSION_CONFLICT':typeof result?.code==='string'?result.code:'LOCAL_OPERATION_UNAVAILABLE');
    }
    if(!result||typeof result!=='object'||Array.isArray(result))throw Error('LOCAL_RESPONSE_INVALID');
    return result;
  }catch(error){if(current===generation&&['TypeError','AbortError','SyntaxError'].includes(error?.name))clearSession('Comunicação local não reconfirmada. Pareie novamente quando o serviço estiver disponível.');throw error;}
  finally{clearTimeout(timer);controllers.delete(controller);}
}
async function operate(action){if(busy||stopped)return;busy=true;controls();try{await action();}catch(error){reviewedFingerprint=null;el('master-apply-confirm').checked=false;if(['LOCAL_MODEL_UNAVAILABLE','LOCAL_MODEL_BUSY'].includes(error?.message)){modelAvailable=false;set('master-model-status','Modelo local indisponível nesta consulta. Verifique o serviço novamente.');}if(error?.message==='VERSION_CONFLICT'||error?.message==='TASK_UNCONFIRMED')clearTask();if(!stopped)set('master-studio-status',message(error));}finally{busy=false;controls();}}
async function health(){const h=await request('/health',undefined,true);if(h.service!=='AURORA_IA_MASTER'||typeof h.version!=='string')throw Error('LOCAL_RESPONSE_INVALID');set('master-studio-status','Serviço local detectado · v'+h.version+'. Isto não comprova sessão, modelo disponível ou sincronização.');if(token)await loadStatus();}
async function loadStatus(){
  const s=await request('/api/status');
  if(s.orgId!==expectedOrg){clearSession('A sessão local pertence a outra empresa.');throw Error('TENANT_MISMATCH');}
  if(s.policy?.externalAiEnabled!==false||s.policy?.maxExternalAiCalls!==0||s.metrics?.externalAiCalls!==0||s.metrics?.externalTokens!==0){clearSession('Política local não confirmada.');throw Error('LOCAL_POLICY_UNCONFIRMED');}
  connected=true;modelAvailable=s.modelState==='AVAILABLE'&&s.busy!==true;
  set('master-model-status',String(s.model||'Modelo não informado')+' · '+(s.modelState==='AVAILABLE'?'disponível':'indisponível')+(s.busy===true?' · ocupado':''));
  set('master-external-status','Desativada · chamadas externas observadas: 0');set('master-cloud-status','Não confirmada');set('master-connection-badge','Sessão local confirmada');
  set('master-knowledge-status',s.knowledge?.status==='LOADED'&&Number.isSafeInteger(s.knowledge.loadedCount)&&s.knowledge.loadedCount>=0?s.knowledge.loadedCount+' registros disponíveis · seleção limitada por pedido':'Registro de conhecimento não confirmado nesta consulta');
  set('master-studio-status','Sessão local confirmada para esta empresa. A operação canônica e o deploy têm verificações próprias.');
  try{const capabilities=await request('/api/studio/capabilities');if(capabilities.externalAiEnabled!==false)throw Error('LOCAL_POLICY_UNCONFIRMED');studio=capabilities;renderFileCatalog(studio.repository?.state==='AVAILABLE'?studio.repository:null);if(studio.repository?.state==='AVAILABLE')await history();else set('master-history-list','Repositório local ainda não configurado.');}
  catch(error){studio=null;set('master-history-list','Studio não confirmado nesta versão local.');if(error?.message==='LOCAL_POLICY_UNCONFIRMED'){clearSession('Política local não confirmada.');throw error;}if(!connected)throw error;set('master-studio-status','Sessão local confirmada; histórico e preparo do Studio ainda indisponíveis.');}
}
async function history(){
  if(!supports('tasks'))throw Error('STUDIO_NOT_AVAILABLE');
  const result=await request('/api/studio/tasks');if(!Array.isArray(result.tasks)||result.tasks.length>100||result.tasks.some(task=>!validTask(task)))throw Error('TASK_UNCONFIRMED');
  const list=el('master-history-list');list.replaceChildren();
  if(selected){const updated=result.tasks.find(task=>task.id===selected.id);if(!updated||updated.version!==selected.version)clearTask();}
  for(const task of result.tasks){const button=document.createElement('button');button.className='btn';button.type='button';button.textContent=String(task.summary||task.id)+' · '+(stateNames[task.state]||'Estado não reconhecido')+' · revisão '+task.version;button.addEventListener('click',()=>operate(async()=>{const detail=await request('/api/studio/tasks/'+encodeURIComponent(task.id));acceptTask(detail.task);set('master-studio-status','Pedido e revisão confirmados pelo serviço local.');}));list.appendChild(button);}
  if(!result.tasks.length)set('master-history-list','Nenhuma tarefa local registrada.');
}
function acceptTask(task,preserveReview=false){
  if(!validTask(task)||task.orgId!==expectedOrg||task.projectId!==studio?.repository?.projectId)throw Error('TASK_UNCONFIRMED');
  const review=preserveReview&&reviewedFingerprint&&reviewedFingerprint===task.proposalFingerprint?reviewedFingerprint:null;
  const previousDiff=review?el('master-diff-output').textContent:null,previousValidation=review?el('master-validation-output').textContent:null;clearTask();selected=task;reviewedFingerprint=review;
  if(previousDiff)set('master-diff-output',previousDiff);
  if(previousValidation)set('master-validation-output',previousValidation);
  if(task.modelContext&&typeof task.modelContext==='object')set('master-context-output',(task.modelContext.complete===true?'O modelo recebeu os arquivos completos selecionados.':'O modelo recebeu somente os trechos indicados abaixo; a fonte completa permanece no contexto local da tarefa.')+'\\n\\n'+JSON.stringify(task.modelContext,null,2));
  if(task.knowledge&&typeof task.knowledge==='object')set('master-context-output',el('master-context-output').textContent+'\\n\\nConhecimento selecionado para este pedido (recibo; não inclui o conteúdo dos registros):\\n'+JSON.stringify(task.knowledge,null,2));
  if(task.preparedVersion){prepared=task.preparedVersion;set('master-apply-status','Versão local isolada preparada. Aplicação no cliente e deploy não executados.');}
  set('master-selected-status',String(task.summary||task.id)+' · '+(stateNames[task.state]||'Estado não reconhecido')+' · revisão '+task.version);controls();
}
async function taskAction(operation,extra={}){
  if(!selected||!supports(operation)||!stageAllowed(operation))throw Error('STUDIO_NOT_AVAILABLE');
  if(operation==='prepare'&&!canPrepare())throw Error('PREPARATION_REVIEW_REQUIRED');
  const current={id:selected.id,version:selected.version};
  const result=await request('/api/studio/tasks/'+encodeURIComponent(current.id)+'/'+operation,{expectedVersion:current.version,...extra},false,operation==='propose'?185000:45000);
  if(!validTask(result.task)||result.task.id!==current.id||result.task.version<=current.version)throw Error('TASK_UNCONFIRMED');
  acceptTask(result.task,true);
  if(result.validation)set('master-validation-output',JSON.stringify(result.validation,null,2));
  if(result.verification)set('master-validation-output','Verificação de sintaxe e diferenças (não são os testes gerais do projeto)\\n'+JSON.stringify(result.verification,null,2));
  if(result.preparedVersion){prepared=result.preparedVersion;set('master-apply-status','Versão local isolada preparada. Aplicação no cliente e deploy não executados.');}
  set('master-studio-status',(stateNames[result.task.state]||'Etapa confirmada')+' · revisão '+result.task.version);controls();
}
el('master-pair-form').addEventListener('submit',event=>{event.preventDefault();return operate(async()=>{
  const ticket=el('master-pair-ticket').value.trim();el('master-pair-ticket').value='';
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(ticket))throw Error('INVALID_TICKET');
  const result=await request('/api/session',{ticket},true);
    if(result.ok!==true||typeof result.sessionToken!=='string'||!/^[A-Za-z0-9_-]{40,100}$/.test(result.sessionToken))throw Error('SESSION_CONTRACT_UNAVAILABLE');
  if(result.orgId!==expectedOrg)throw Error('TENANT_MISMATCH');token=result.sessionToken;await loadStatus();
});});
el('master-health').addEventListener('click',()=>operate(health));
el('master-disconnect').addEventListener('click',()=>operate(async()=>{let confirmed=false;try{const result=await request('/api/logout',{});confirmed=result.ok===true;}finally{clearSession(confirmed?'Sessão local encerrada e dados removidos deste painel.':'Dados locais removidos deste painel; encerramento remoto não confirmado.');}}));
el('master-improve-form').addEventListener('submit',event=>{event.preventDefault();return operate(async()=>{
  if(!connected||!modelAvailable)throw Error('LOCAL_MODEL_UNAVAILABLE');const prompt=el('master-prompt').value.trim();if(prompt.length<8||prompt.length>6000)throw Error('INVALID_PROMPT');if(sensitive(prompt))throw Error('SENSITIVE_INPUT_REJECTED');
  set('master-proposal-output','Processando no modelo local…');let result;try{result=await request('/api/improve',{prompt,classification:'INTERNAL'},false,185000);}catch(error){set('master-proposal-output','Proposta não confirmada.');throw error;}
  if(result.state!=='PROPOSAL_ONLY'||result.applied!==false||result.externalAiCalls!==0||typeof result.proposal?.text!=='string'||result.proposal.text.length>50000)throw Error('LOCAL_RESPONSE_INVALID');
  set('master-proposal-output',result.proposal.text+'\\n\\nProposta para revisão. Código aplicado: não. Deploy: não.');
});});
el('master-native-form').addEventListener('submit',event=>{event.preventDefault();return operate(async()=>{
  if(!connected)throw Error('LOCAL_AUTH_REQUIRED');let snapshot;const raw=el('master-snapshot').value;if(raw.length>60000||sensitive(raw))throw Error('INVALID_SNAPSHOT');try{snapshot=JSON.parse(raw);}catch{throw Error('INVALID_SNAPSHOT');}
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.orgId!==expectedOrg||!['PUBLIC','INTERNAL'].includes(snapshot.sensitivity))throw Error('INVALID_SNAPSHOT');
  set('master-native-output','Consultando prévia local…');let result;try{result=await request('/api/native',{snapshot,classification:'INTERNAL'});}catch(error){set('master-native-output','Leitura local não confirmada.');throw error;}
  if(result.authority!=='LOCAL_UNVERIFIED_PREVIEW'||result.cloudSyncVerified!==false||result.externalAiCalls!==0||!result.master)throw Error('LOCAL_RESPONSE_INVALID');
  set('master-native-output','Prévia local; autenticidade da origem não comprovada.\\n'+JSON.stringify(result.master,null,2));
});});
el('master-history-refresh').addEventListener('click',()=>operate(history));
el('master-task-form').addEventListener('submit',event=>{event.preventDefault();return operate(async()=>{
  if(!supports('context')||!supports('createTask'))throw Error('STUDIO_NOT_AVAILABLE');
  const paths=selectedContextPaths(),prompt=el('master-task-prompt').value.trim();
  const limit=Number.isSafeInteger(studio?.limits?.maxFiles)&&studio.limits.maxFiles>0&&studio.limits.maxFiles<=20?studio.limits.maxFiles:10;
  if(paths.length<1||paths.length>limit||new Set(paths).size!==paths.length||paths.some(path=>path.length>240||!/^[-A-Za-z0-9_./]+$/.test(path)||path.startsWith('/')||path.includes('..')||path.split('/').some(part=>['.git','node_modules','control.key'].includes(part)||part==='.env'||part.startsWith('.env.'))))throw Error('INVALID_CONTEXT');
  if(prompt.length<8||prompt.length>6000)throw Error('INVALID_PROMPT');if(sensitive(prompt))throw Error('SENSITIVE_INPUT_REJECTED');
  const focus=selectedContextFocus(paths);
  const context=await request('/api/studio/context',{paths,classification:'INTERNAL',...(focus?{focus}:{})});if(!validId(context.context?.id)||!Array.isArray(context.context.files))throw Error('LOCAL_RESPONSE_INVALID');
  set('master-context-output',JSON.stringify(context.context.files,null,2));
  const result=await request('/api/studio/tasks',{contextId:context.context.id,prompt,classification:'INTERNAL'});acceptTask(result.task);set('master-studio-status','Tarefa criada com contexto local confirmado.');await history();
});});
el('master-manual-proposal-form').addEventListener('submit',event=>{event.preventDefault();return operate(async()=>{const raw=el('master-manual-proposal').value;let proposal;if(raw.length>60000||sensitive(raw))throw Error('SENSITIVE_INPUT_REJECTED');try{proposal=JSON.parse(raw);}catch{throw Error('LOCAL_RESPONSE_INVALID');}if(!proposal||typeof proposal.summary!=='string'||!Array.isArray(proposal.files))throw Error('LOCAL_RESPONSE_INVALID');await taskAction('proposal',{proposal});el('master-manual-proposal').value='';});});
el('master-task-propose').addEventListener('click',()=>operate(()=>taskAction('propose')));
el('master-diff').addEventListener('click',()=>operate(async()=>{if(!selected||!supports('diff')||!stageAllowed('diff'))throw Error('STUDIO_NOT_AVAILABLE');const result=await request('/api/studio/tasks/'+encodeURIComponent(selected.id)+'/diff');if(result.taskId!==selected.id||result.version!==selected.version||typeof result.diff!=='string'||result.validation?.proposalFingerprint!==selected.proposalFingerprint)throw Error('TASK_UNCONFIRMED');reviewedFingerprint=typeof selected.proposalFingerprint==='string'&&/^[a-f0-9]{64}$/.test(selected.proposalFingerprint)?selected.proposalFingerprint:null;el('master-apply-confirm').checked=false;set('master-diff-output',result.diff||'Nenhuma alteração neste diff.');if(result.validation)set('master-validation-output',JSON.stringify(result.validation,null,2));}));
el('master-validate').addEventListener('click',()=>operate(()=>taskAction('validate')));
el('master-stage').addEventListener('click',()=>operate(()=>taskAction('stage')));
el('master-verify').addEventListener('click',()=>operate(()=>taskAction('verify',{recipeId:'SYNTAX_AND_DIFF_V1'})));
el('master-prepare').addEventListener('click',()=>operate(()=>taskAction('prepare')));
el('master-apply-confirm').addEventListener('change',controls);
// No apply endpoint exists. This disabled control never sends a mutation.
function exit(permanent){const session=token;if(permanent)stopped=true;clearSession('Sessão local removida deste painel.');if(session&&supportedOrigin){void fetch(localBase+'/api/logout',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',keepalive:true,headers:{'Content-Type':'application/json','X-Aurora-Local':'1',Authorization:'Bearer '+session},body:'{}'}).catch(()=>{});}}
window.addEventListener('pagehide',()=>exit(true));window.addEventListener('aurora:session-ended',()=>exit(true));
if(!supportedOrigin)set('master-studio-status','Este estúdio requer uma origem de portal autorizada.');controls();
})();`;
}
