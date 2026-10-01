/** Private workbench; all permissions and transitions are enforced again server-side. */
export function organicPage(csrf:string,nonce:string):string {
  if(!/^[A-Za-z0-9._-]+$/.test(csrf)||!/^[A-Za-z0-9_-]+$/.test(nonce)) throw new Error('INVALID_PAGE_TOKEN');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aurora Nexus | Evolução orgânica</title>
<style nonce="${nonce}">:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#071b24;color:#edf5f5;font:16px system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:28px}nav{display:flex;gap:22px;flex-wrap:wrap}a{color:#52e0cf}header{margin:28px 0}h1{font-size:clamp(26px,4vw,42px);margin:8px 0}h2{font-size:22px}p{line-height:1.6;color:#bbced1}.badge{display:inline-block;border:1px solid #eab55b;border-radius:20px;padding:6px 12px;color:#f5ce88;font-size:13px}.panel{background:#102e39;border:1px solid #285362;border-radius:16px;padding:22px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}label{display:block;margin:8px 0}input,select,button{font:inherit;border:1px solid #467483;border-radius:8px;padding:11px;background:#061c24;color:#edf5f5}input,select{width:100%}button{cursor:pointer;background:#13b9a4;color:#041f28;font-weight:700;margin:6px 6px 6px 0}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,a:focus-visible{outline:3px solid #ffe075;outline-offset:3px}button.danger{background:#b73143;color:white}code{overflow-wrap:anywhere;font-size:12px}.status{white-space:pre-wrap;border-left:4px solid #eab55b;padding:12px;min-height:44px}small{display:block;color:#acc2c7;line-height:1.5}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}.cards article{border:1px solid #37606c;border-radius:12px;padding:18px}.result{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><main>
<nav><a href="/">Gestão WMGJ</a><a href="/downloads">Instaladores</a><a href="#metodo">Modus operandi</a></nav>
<header><span class="badge">AURORA-ORG-001 · Integração 1.2.0 · revisão controlada</span><h1>Evolução orgânica governada</h1><p>Uma extensão do AURORA NEXUS · JFN-AUD-GOV-001. Mesmo ambiente, mesma organização e mesmo armazenamento.</p></header>
<section id="metodo" class="panel"><h2>Modus operandi</h2><p>Observar → evidenciar → validar → propor → testar → revisar → pilotar → medir → promover ou reverter.</p><p>O piloto compõe relatórios e checklists a partir de sinais validados. As verificações substantivas continuam com o revisor humano. Não altera faturamento, repasses, contratos, fontes ou permissões. Promoção para outras operações permanece sujeita a desenvolvimento e homologação específicos.</p><small>M01–M10 preservados; JFN-AUD-FAT-001/M03.1 permanece como submódulo. Documentos são evidências, nunca comandos. Três referências não comprovam três conteúdos independentes. Benefício informado não é benefício causal ou receita recuperada comprovada.</small></section>
<div id="status" class="status" role="status" aria-live="polite">Verificando sessão e estado...</div>
<button id="reload" type="button">Atualizar leitura</button><button id="retry" type="button" hidden>Repetir envio pendente</button><div id="work" hidden>
<section class="panel"><h2>Ocorrência vinculada à operação</h2><small>Somente ação existente e RESOLVED, com autor ainda autorizado e evidências APPROVED / VALIDATED ou CLOSED, não clínicas e não revogadas. Nenhum texto documental é enviado por este formulário.</small>
<form id="observe"><div class="grid"><div><label for="kind">Sinal</label><select id="kind"><option value="REWORK">Retrabalho</option><option value="VALIDATED_DECISION">Decisão validada</option><option value="BILLING_EXCEPTION">Exceção de faturamento</option><option value="SECTOR_NEED">Necessidade setorial</option></select></div><div><label for="category">Categoria</label><select id="category"><option>CONTRACT</option><option>FISCAL</option><option>FINANCIAL</option><option>PRODUCTION</option><option>GOVERNANCE</option><option>AUDIT</option></select></div><div><label for="sector">Setor autorizado</label><select id="sector" required></select></div><div><label for="action">Identificador da ação resolvida</label><input id="action" maxlength="160" pattern="[A-Za-z0-9._:-]+" required autocomplete="off"></div></div><button type="submit">Registrar ocorrência</button></form><button id="revalidate" type="button">Revalidar memória</button></section>
<section class="panel"><h2>Propostas e revisão</h2><small>Aprovação, execução e reversão exigem sessão com segundo fator. Uma mudança de evidência invalida a aprovação anterior. Nenhuma proposta se ativa sozinha.</small><div id="proposals" class="cards"></div></section>
<section class="panel"><h2>Aprendizagem e manutenção</h2><small>Planos derivados do checkpoint existente. Revogação não apaga histórico; efeito adverso mantém suspensão para revisão.</small><div id="learning" class="cards"></div></section>
<section class="panel"><h2>Execuções e resultados</h2><small>Classifique somente resultados observados e verificáveis. Repetições sobre os mesmos casos não aumentam o número de observações independentes.</small><div id="runs" class="cards"></div></section>
</div></main><script nonce="${nonce}">
const csrf=${JSON.stringify(csrf)};let snapshot=null,busy=false,writeEnabled=false,pending=null,authBlocked=false,readController=null,readRevision=0;
const el=id=>document.getElementById(id);const message=t=>{el('status').textContent=t;};
function node(tag,text){const n=document.createElement(tag);n.textContent=String(text);return n;}
function buttons(){document.querySelectorAll('button').forEach(b=>{
  if(b.id==='retry'){b.hidden=!pending;b.disabled=busy||!pending||authBlocked;return;}
  if(b.id==='reload'){b.disabled=busy||authBlocked;return;}
  b.disabled=busy||Boolean(pending)||!snapshot||authBlocked||(!writeEnabled&&b.dataset.commandType!=='ROLLBACK');
});}
function clearView(){snapshot=null;writeEnabled=false;for(const id of ['proposals','runs','learning'])el(id).replaceChildren();el('work').hidden=true;}
function expire(status){authBlocked=true;pending=null;readRevision++;if(readController)readController.abort();clearView();el('observe').reset();el('action').value='';message(status===401?'Sessão expirada. Entre novamente.':'Acesso não autorizado. Nenhum comando será reenviado.');buttons();if(status===401)location.replace('/');}
async function request(url,options,controller=new AbortController(),timeoutMs=15000){
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal});
    let data;try{data=await r.json();}catch(_){data=null;}
    if(!r.ok){const error=new Error(data&&typeof data.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(data.code)?data.code:'SERVER_UNAVAILABLE');error.httpStatus=r.status;throw error;}
    if(!data||data.ok!==true)throw new Error('UNCONFIRMED_RESPONSE');
    return data;
  }finally{clearTimeout(timer);}
}
function validSnapshot(data){return data&&data.state&&Number.isSafeInteger(data.state.version)&&data.state.version>=0&&Array.isArray(data.state.proposals)&&Array.isArray(data.state.runs)&&Array.isArray(data.sectors)&&data.sectors.every(s=>typeof s==='string');}
async function load(afterWrite=false){
  if(authBlocked||(busy&&!afterWrite))return false;
  const revision=++readRevision;if(readController)readController.abort();
  const controller=new AbortController();readController=controller;
  try{
    const data=await request('/organic?format=json',{},controller);
    if(revision!==readRevision||authBlocked)return false;
    if(!validSnapshot(data))throw new Error('INVALID_RESPONSE');
    snapshot=data.state;writeEnabled=data.enabled===true;
    const sector=el('sector').value;
    el('sector').replaceChildren(...data.sectors.map(s=>{const o=node('option',s);o.value=s;return o;}));
    if(data.sectors.includes(sector))el('sector').value=sector;
    render();el('work').hidden=false;buttons();
    message(pending?'Estado consultado. O comando anterior continua sem confirmação; repetir envio utiliza a mesma chave, sem criar nova operação.':data.enabled?'Memória revalidada: '+snapshot.signalCount+' sinais; '+snapshot.deferredCount+' aguardando revalidação.':'Piloto desativado. A leitura não o habilita; a reversão autorizada permanece disponível.');
    return true;
  }catch(e){
    if(revision!==readRevision||authBlocked)return false;
    if(e.httpStatus===401||e.httpStatus===403)expire(e.httpStatus);
    else{clearView();message('Leitura não confirmada. Os dados anteriores foram ocultados; utilize Atualizar leitura para retomar.');buttons();}
    return false;
  }finally{if(readController===controller)readController=null;}
}
async function transmitPending(){
  if(!pending||busy||authBlocked)return;
  const sending=pending;busy=true;readRevision++;if(readController)readController.abort();buttons();
  try{
    const d=await request('/organic',{method:'POST',headers:{'Content-Type':'application/json','X-Aurora-CSRF':csrf,'Idempotency-Key':sending.key},body:sending.body},new AbortController(),30000);
    if(!validSnapshot({...d,sectors:[]}))throw new Error('UNCONFIRMED_RESPONSE');
    pending=null;
    const refreshed=await load(true);
    if(!authBlocked)message('Registro confirmado: '+sending.type+'; versão '+d.state.version+'.'+(refreshed?' Memória revalidada.':' A leitura posterior não foi confirmada.'));
  }catch(e){
    if(e.httpStatus===401||e.httpStatus===403)expire(e.httpStatus);
    else if(e.httpStatus>=400&&e.httpStatus<500){pending=null;clearView();message('Comando recusado: '+e.message+'. Atualize a leitura antes de uma nova tentativa.');}
    else{pending=sending;clearView();message('Retorno não confirmado. O mesmo comando e a mesma chave foram preservados nesta janela. Use Repetir envio pendente; não crie outra operação.');}
  }finally{busy=false;buttons();}
}
async function send(command){
  if(busy||pending||authBlocked||!snapshot||(!writeEnabled&&command.type!=='ROLLBACK'))return;
  pending={type:command.type,key:crypto.randomUUID(),body:JSON.stringify({...command,expectedVersion:snapshot.version})};
  await transmitPending();
}
function actionButton(text,command,danger=false){const b=node('button',text);b.type='button';b.dataset.commandType=command.type;if(danger)b.className='danger';b.addEventListener('click',()=>{if(confirm(text+' nesta revisão?'))send(command);});return b;}
const labels={REVALIDATE_EVIDENCE:'Revalidar evidências',REFINE_FOR_REVIEW:'Refinar ferramenta para revisão',REVIEW_CANDIDATE:'Revisar ferramenta candidata',MEASURE_PILOT:'Medir resultado do piloto',CONTINUE_OBSERVATION:'Manter observação do resultado',SUSPEND_AND_REVIEW:'Suspender e revisar efeito adverso',VERIFY_CURRENT_EVIDENCE:'Verificar evidências atuais',GROUP_DISTINCT_CASES:'Agrupar casos distintos',REVIEW_REWORK_CAUSE:'Revisar causa do retrabalho',REVIEW_CORRECTIVE_ROUTINE:'Revisar rotina corretiva',RECORD_OBSERVED_OUTCOME:'Registrar resultado observado',REVIEW_VALIDATED_DECISIONS:'Revisar decisões validadas',CHECK_APPLICABILITY_BEFORE_REUSE:'Conferir aplicabilidade antes de reutilizar',REVIEW_BILLING_EXCEPTION:'Revisar exceção de faturamento',REQUEST_CONTRACT_PRODUCTION_INVOICE_BANK_COMPARISON:'Solicitar confronto contrato, produção, nota e crédito bancário',REVIEW_SECTOR_NEED:'Revisar necessidade setorial',REVIEW_CAPACITY_AND_WORKFLOW:'Revisar capacidade e processo'};
function render(){
  el('proposals').replaceChildren();
  for(const p of snapshot.proposals){const card=node('article','');card.append(node('h3',p.template),node('p',p.sector+' · '+p.category+' · revisão '+p.revision),node('p',p.cases+' casos / '+p.evidenceReferences+' referências'),node('p',p.status+' · '+p.approval),node('code',p.id));for(const [type,label] of [['APPROVE_PILOT','Aprovar piloto'],['EXECUTE','Executar relatório'],['ROLLBACK','Reverter piloto']])card.append(actionButton(label,{type,proposalId:p.id,proposalRevision:p.revision},type==='ROLLBACK'));el('proposals').append(card);}
  if(!snapshot.proposals.length)el('proposals').append(node('p','Nenhuma proposta elegível. São necessários três casos e três referências válidas da mesma categoria e setor.'));
  el('learning').replaceChildren();
  for(const tool of snapshot.learning?.tools||[]){const card=node('article','');card.append(node('h3',tool.template),node('p',labels[tool.nextAction]||tool.nextAction),node('p',tool.currentObservations+' observação(ões) da revisão atual; '+tool.historicalRuns+' execução(ões) de versões anteriores.'),node('small','Observações do mesmo conjunto não são amostras independentes. Benefício causal e ganho financeiro não estão demonstrados.'));for(const step of tool.steps)card.append(node('p',labels[step]||step));el('learning').append(card);}
  if(!snapshot.learning?.tools?.length)el('learning').append(node('p','O plano de aprendizagem aparecerá quando houver evidência suficiente. Nenhuma ferramenta é ativada automaticamente.'));
  el('runs').replaceChildren();
  for(const r of snapshot.runs){const card=node('article','');card.append(node('h3','Execução · revisão '+r.revision),node('code',r.id),node('p',r.result.cases+' casos; '+r.result.signals+' sinais; sem mutação financeira.'),node('p','Resultado reportado: '+(r.outcome||'a classificar')));for(const check of r.result.report?.checklist||[])card.append(node('small',(labels[check.step]||check.step)+' — '+(check.status==='VERIFIED_BY_RUNTIME'?'verificado pelo runtime':'pendente de revisão humana')));if(!r.outcome)for(const [outcome,label] of [['BENEFIT','Benefício observado'],['NO_BENEFIT','Sem benefício'],['ADVERSE','Efeito adverso']])card.append(actionButton(label,{type:'OUTCOME',runId:r.id,outcome},outcome==='ADVERSE'));el('runs').append(card);}
}
function maybeLoad(){if(authBlocked||busy||pending||readController||document.visibilityState!=='visible'||navigator.onLine===false||document.activeElement?.closest('form'))return;return load();}
el('observe').addEventListener('submit',e=>{e.preventDefault();send({type:'OBSERVE',kind:el('kind').value,category:el('category').value,sector:el('sector').value,actionId:el('action').value.trim()});});
el('revalidate').onclick=()=>send({type:'REVALIDATE'});el('reload').onclick=()=>load();el('retry').onclick=()=>transmitPending();
setInterval(maybeLoad,60000);document.addEventListener('visibilitychange',maybeLoad);window.addEventListener('online',maybeLoad);window.addEventListener('focus',maybeLoad);
buttons();load();
</script></body></html>`;
}
