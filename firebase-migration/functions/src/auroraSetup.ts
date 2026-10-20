import { workspaceConnectorSection, workspaceConnectorSetupClient } from './auroraWorkspaceConnectors.js';
import { auroraDesignStyles } from "./auroraDesignSystem.js";
import type { AuroraMember } from './auroraAccess.js';
import { nativeIngestionSection, nativeIngestionClient } from './auroraNativeIngestionView.js';
import { canImportNativeDocuments } from './auroraNativeIngestion.js';
import { installationAcceptanceClientGuard } from './auroraInstallationAcceptance.js';

/** Render only after the existing session and membership checks. No new identity store. */
export function setupPage(member: { orgId: string; mfaVerified: boolean } & Partial<AuroraMember>, refreshCsrf = '', ingestCsrf = '', integrationCsrf = ''): string {
  const actor: AuroraMember={uid:'',email:'',role:'viewer',permissions:[],facilityIds:[],allFacilities:false,...member};
  const org = member.orgId.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aurora Nexus | Instalação e conexões</title><style>${auroraDesignStyles()}
  main{max-width:920px;margin:auto;padding:40px 24px}article{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;margin:20px 0;box-shadow:var(--shadow)}h1,h2{font-family:'Source Serif 4',Georgia,serif;font-weight:600;line-height:1.2}h1{font-size:38px;letter-spacing:-.02em;margin:12px 0}h2{font-size:24px;margin-top:0}article a,main button{display:inline-flex;align-items:center;min-height:44px;color:var(--panel);background:var(--ink);border:1px solid var(--ink);border-radius:9px;padding:10px 16px;text-decoration:none;cursor:pointer}.pending{color:var(--warn);background:#f4ead8;border-left:3px solid var(--gold);padding:14px 16px}small{color:var(--muted);font-size:13px}main button:disabled{opacity:.55;cursor:default}@media(max-width:600px){main{padding:28px 18px}h1{font-size:32px}article{padding:20px}}</style></head><body><header class="top"><a class="brand" href="/portal"><img src="/aurora-icon.svg" alt="" width="42" height="42"><div class="brand-name">Aurora Nexus</div></a><a class="btn" href="/portal">Voltar ao painel</a></header><main>
  <p class="eyebrow">Instalação guiada</p><h1>Vamos preparar seu acesso</h1><p>Conclua cada etapa. Este assistente usa a conta e a operação existentes da sua empresa.</p>
  <article><h2>1. Sua conta</h2><p>Sessão e vínculo com a empresa <strong>${org}</strong> verificados.</p><p>${member.mfaVerified ? 'Segundo fator confirmado neste acesso.' : 'Segundo fator não confirmado neste acesso. Entre novamente e selecione a configuração do autenticador.'}</p><small>A sessão pode expirar ou ser revogada. Use seu próprio acesso AURORA; contas administrativas de infraestrutura não são necessárias.</small></article>
  <article><h2>2. Confirmar comunicação</h2><p id="connection" role="status" aria-live="polite">Aguardando verificação do acesso à operação.</p><button id="check" type="button">Verificar agora</button></article>
  <article><h2>3. Conectar as fontes da empresa</h2>${workspaceConnectorSection()}<p>API técnica, envio manual, nuvem/OAuth e coleta local possuem autorizações e provas próprias. Configure o processamento canônico em Integrações e confirme recibo e repetição do mesmo envio.</p><p class="pending">Login OAuth de plataformas externas ainda não está disponível neste assistente. Conexão e extração de PDF, planilha ou e-mail precisam dos adaptadores reais. Exportações JSON já estruturadas não comprovam essa extração. Não digite senhas dessas plataformas no instalador.</p><a href="/portal#integrations">Abrir integrações</a></article>
  <article><h2>4. Conhecer a operação</h2><p>O Assistente Aurora analisa as leituras disponíveis e aponta pendências com evidências. A memória operacional é separada por empresa. A instalação não lê automaticamente seus documentos.</p><p>O processamento local da IA Master e a operação na nuvem têm verificações próprias. Confira a conexão de cada serviço antes de usar a leitura.</p><a href="/portal#native-intelligence">Abrir Assistente Aurora</a></article>
  <article><h2>5. Atualizações e segundo plano</h2><p>Patches do portal usam o atualizador existente. Novos instaladores ficam em Downloads. Esta versão do cliente de acesso ainda não instala execução automática em segundo plano; o componente IA Master do servidor possui seu próprio gerenciador.</p><small>Esta página não comprova instalação no dispositivo, sincronização do servidor físico ou funcionamento sem conexão.</small></article>
  <article><h2>6. Primeiros dados da empresa</h2><p id="ingestion" role="status" aria-live="polite">Verificando a primeira ingestão…</p><small>O cadastro preserva seu acesso. A integração do processamento só conclui com configuração autorizada, dados canônicos, recibo persistido e replay confirmado. Isso não comprova um coletor em execução nem acesso OAuth ou local.</small></article>
  ${nativeIngestionSection(actor)}
  <button id="complete" type="button" disabled>Concluir e abrir a operação</button><script>
  const button=document.getElementById('check'), status=document.getElementById('connection');
  const complete=document.getElementById('complete'), ingestion=document.getElementById('ingestion');
  const expectedOrg=${JSON.stringify(member.orgId).replace(/</g,'\\u003c')};
  const messages={PENDING_SOURCE:'Fonte autorizada ainda sem primeiro recibo. Abra Integrações para conectar sua fonte.',PENDING_CANONICAL_DATA:'Dados recebidos; aguardando validação dos campos e da fonte.',PENDING_PROJECTION:'Dados persistidos; aguardando processamento da operação.'};
  const refreshCsrf=${JSON.stringify(refreshCsrf).replace(/</g,'\\u003c')};
  const MAX_ATTEMPTS=12;
  let attempts=0,timer=null,checking=false,importing=false;
  ${installationAcceptanceClientGuard()}
  window.addEventListener?.('aurora:ingestion-started',()=>{importing=true;complete.disabled=true;clearTimeout(timer)});
  window.addEventListener?.('aurora:documents-imported',()=>{importing=false;attempts=0;retry()});
  function verified(proof){return proof?.state==='FIRST_INGESTION_VERIFIED'&&proof.firstIngestionVerified===true&&/^[a-f0-9]{48}$/.test(proof.documentId||'')&&Number.isSafeInteger(proof.sourceVersion)&&proof.sourceVersion>0&&Number.isSafeInteger(proof.revision)&&proof.revision>0&&/^[a-f0-9]{48}$/.test(proof.versionId||'')&&/^[a-f0-9]{64}$/.test(proof.canonicalSnapshotHash||'')&&typeof proof.sourceSystem==='string'&&proof.sourceSystem.trim().length>0&&typeof proof.verifiedAt==='string'&&Number.isFinite(Date.parse(proof.verifiedAt))}
  async function readJson(response){
    if(response.status===401||response.status===403)throw Error(response.status===401?'AUTH_REQUIRED':'ACCESS_DENIED');
    if(!response.ok||!String(response.headers.get('content-type')).toLowerCase().startsWith('application/json'))throw Error('UNAVAILABLE');
    const data=await response.json();
    if(data.ok!==true)throw Error('UNAVAILABLE');
    if((data.organization&&data.organization.id!==expectedOrg)||(data.orgId!==undefined&&data.orgId!==expectedOrg))throw Error('SCOPE_MISMATCH');
    return data;
  }
  async function refresh(body){
    if(!refreshCsrf)throw Error('CSRF_UNAVAILABLE');
    return readJson(await fetch('/api/refresh',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-aurora-csrf':refreshCsrf},body:JSON.stringify(body),signal:AbortSignal.timeout(125000)}));
  }
  async function bootstrap(){
    const data=await readJson(await fetch('/api/bootstrap',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)}));
    if(data.organization?.id!==expectedOrg)throw Error('SCOPE_MISMATCH');
    return data;
  }
  function retry(){if(attempts<MAX_ATTEMPTS)timer=setTimeout(check,5000)}
  async function check(){
    if(checking||importing||attempts>=MAX_ATTEMPTS)return;
    checking=true;attempts++;clearTimeout(timer);complete.disabled=true;button.disabled=true;status.textContent='Verificando…';
    try{
      const data=await bootstrap();
      if(importing)return;
      status.textContent='Comunicação autenticada confirmada. Isso não comprova ingestão ou sincronização com o servidor físico.';
      let proof=data.installation;
      if(proof?.state==='PENDING_PROJECTION'){
        ingestion.textContent='Preparando o processamento da operação da sua empresa…';
        await refresh({});
        proof=(await bootstrap()).installation;
      }
      if(verified(proof)&&acceptanceReady(proof,expectedOrg)){
        ingestion.textContent='Primeira ingestão e processamento confirmados. Registrando conclusão…';
        const result=await refresh({operation:'COMPLETE_INSTALLATION'});
        const committed=result.installation;
        if(result.orgId!==expectedOrg||!verified(committed)||!acceptanceReady(committed,expectedOrg)||committed.operationalComplete!==true||committed.documentId!==proof.documentId||committed.sourceVersion!==proof.sourceVersion||['revision','versionId','canonicalSnapshotHash','sourceSystem'].some(key=>committed[key]!==proof[key])||['configurationHash','receiptId','method'].some(key=>committed.acceptance[key]!==proof.acceptance[key]))throw Error('COMPLETION_UNCONFIRMED');
        complete.disabled=false;
        ingestion.textContent='Ingestão, processamento canônico, recibo, replay e configuração autorizada confirmados para sua empresa. Fontes OAuth, coleta local e extração global exigem provas próprias.';
      }else{
        const pending={PENDING_RECEIPT:'Processamento confirmado; aguardando recibo persistido.',PENDING_REPLAY:'Recibo persistido; aguardando repetição real do mesmo envio.',PENDING_AUTOMATION:'Processamento confirmado; configure a automação canônica em Integrações.',PENDING_AUTHORITY:'Configuração sem autoridade atual confirmada.',PENDING_ADAPTER_EVIDENCE:'Aguardando prova do adaptador e da fonte autorizada.'};
        ingestion.textContent=pending[proof?.acceptance?.state]||messages[proof?.state]||'Aguardando evidência atual da integração e da primeira ingestão.';
        retry();
      }
    }catch(error){
      const blocked=['AUTH_REQUIRED','ACCESS_DENIED','SCOPE_MISMATCH','CSRF_UNAVAILABLE'].includes(error.message);
      status.textContent=error.message==='AUTH_REQUIRED'?'Sessão expirada. Entre novamente.':blocked?'Acesso não confirmado. Verifique sua sessão e o vínculo com a empresa.':'Comunicação não confirmada. Verifique a conexão e tente novamente.';
      ingestion.textContent='Preparação pendente. Seu cadastro foi preservado.';
      if(!blocked)retry();
    }finally{button.disabled=false;checking=false}
  }
  button.addEventListener('click',()=>{if(!checking){attempts=0;check()}});
  complete.addEventListener('click',()=>{if(!complete.disabled)window.location.assign('/portal')});
  check();
  ${nativeIngestionClient(actor,{ingest:ingestCsrf,refresh:refreshCsrf,integrationKey:integrationCsrf},false)}
  ${workspaceConnectorSetupClient(actor.orgId,canImportNativeDocuments(actor))}</script></main></body></html>`;
}
