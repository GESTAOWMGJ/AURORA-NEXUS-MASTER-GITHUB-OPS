/** Render only after the existing session and membership checks. No new identity store. */
export function setupPage(member: { orgId: string; mfaVerified: boolean }, refreshCsrf = ''): string {
  const org = member.orgId.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA NEXUS | Instalação e conexões</title><style>
  :root{color-scheme:dark}body{margin:0;background:#071f25;color:#f7f1e7;font:16px system-ui;line-height:1.6}main{max-width:800px;margin:auto;padding:32px 20px}article{background:#0d2d34;border:1px solid #2e5f68;border-radius:14px;padding:20px;margin:16px 0}h1{line-height:1.2}h2{font-size:20px;margin-top:0}a,button{display:inline-block;color:#08191d;background:#c6a45d;border:0;border-radius:8px;padding:10px 16px;font:inherit;text-decoration:none;cursor:pointer}a:focus-visible,button:focus-visible{outline:3px solid white;outline-offset:4px}.pending{color:#f0d99c}small{color:#b9c7c6}button:disabled{opacity:.6}</style></head><body><main>
  <p>AURORA NEXUS · INSTALAÇÃO GUIADA</p><h1>Vamos preparar seu acesso</h1><p>Conclua cada etapa. Este assistente usa a conta e a operação existentes da sua empresa.</p>
  <article><h2>1. Sua conta</h2><p>Sessão e vínculo com a empresa <strong>${org}</strong> verificados.</p><p>${member.mfaVerified ? 'Segundo fator confirmado neste acesso.' : 'Segundo fator não confirmado neste acesso. Entre novamente e selecione a configuração do autenticador.'}</p><small>A sessão pode expirar ou ser revogada. Use seu próprio acesso AURORA; contas administrativas de infraestrutura não são necessárias.</small></article>
  <article><h2>2. Confirmar comunicação</h2><p id="connection" role="status" aria-live="polite">Aguardando verificação do acesso à operação.</p><button id="check" type="button">Verificar agora</button></article>
  <article><h2>3. Conectar as fontes da empresa</h2><p>Abra Integrações no painel para verificar as credenciais AURORA e fontes autorizadas. Uma configuração salva ainda precisa de teste de leitura.</p><p class="pending">Login OAuth de plataformas externas ainda não está disponível neste assistente. Não digite senhas dessas plataformas no instalador.</p><a href="/#integrations">Abrir integrações</a></article>
  <article><h2>4. Conhecer a operação</h2><p>O Motor Mestre analisa as projeções disponíveis e aponta pendências com evidências. A memória operacional é separada por empresa. A instalação não lê automaticamente seus documentos.</p><p>A política da IA Master desabilita chamadas externas. Processamento nativo usa os serviços existentes; JSON é o formato de dados. A continuidade entre nuvem e servidor físico ainda exige verificação conjunta.</p><a href="/#native-intelligence">Abrir Motor Mestre</a></article>
  <article><h2>5. Atualizações e segundo plano</h2><p>Patches do portal usam o atualizador existente. Novos instaladores ficam em Downloads. Esta versão do cliente de acesso ainda não instala execução automática em segundo plano; o componente IA Master do servidor possui seu próprio gerenciador.</p><small>Esta página não comprova instalação no dispositivo, sincronização do servidor físico ou funcionamento sem conexão.</small></article>
  <article><h2>6. Primeiros dados da empresa</h2><p id="ingestion" role="status" aria-live="polite">Verificando a primeira ingestão…</p><small>O cadastro preserva seu acesso. A preparação operacional só conclui após dados autorizados persistidos e processados pela operação da sua empresa. Sem fonte configurada, abra Integrações.</small></article>
  <button id="complete" type="button" disabled>Concluir e abrir a operação</button><script>
  const button=document.getElementById('check'), status=document.getElementById('connection');
  const complete=document.getElementById('complete'), ingestion=document.getElementById('ingestion');
  const expectedOrg=${JSON.stringify(member.orgId).replace(/</g,'\\u003c')};
  const messages={PENDING_SOURCE:'Fonte autorizada ainda sem primeiro recibo. Abra Integrações para conectar sua fonte.',PENDING_CANONICAL_DATA:'Dados recebidos; aguardando validação dos campos e da fonte.',PENDING_PROJECTION:'Dados persistidos; aguardando processamento da operação.'};
  const refreshCsrf=${JSON.stringify(refreshCsrf).replace(/</g,'\\u003c')};
  const MAX_ATTEMPTS=12;
  let attempts=0,timer=null,checking=false;
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
    if(checking||attempts>=MAX_ATTEMPTS)return;
    checking=true;attempts++;clearTimeout(timer);complete.disabled=true;button.disabled=true;status.textContent='Verificando…';
    try{
      const data=await bootstrap();
      status.textContent='Comunicação autenticada confirmada. Isso não comprova ingestão ou sincronização com o servidor físico.';
      let proof=data.installation;
      if(proof?.state==='PENDING_PROJECTION'){
        ingestion.textContent='Preparando o processamento da operação da sua empresa…';
        await refresh({});
        proof=(await bootstrap()).installation;
      }
      if(verified(proof)){
        ingestion.textContent='Primeira ingestão e processamento confirmados. Registrando conclusão…';
        const result=await refresh({operation:'COMPLETE_INSTALLATION'});
        const committed=result.installation;
        if(result.orgId!==expectedOrg||!verified(committed)||committed.operationalComplete!==true||committed.documentId!==proof.documentId||committed.sourceVersion!==proof.sourceVersion||['revision','versionId','canonicalSnapshotHash','sourceSystem'].some(key=>committed[key]!==proof[key]))throw Error('COMPLETION_UNCONFIRMED');
        complete.disabled=false;
        ingestion.textContent='Primeira ingestão, processamento e conclusão operacional confirmados para sua empresa.';
      }else{
        ingestion.textContent=messages[proof?.state]||'Aguardando evidência atual da primeira ingestão.';
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
  </script></main></body></html>`;
}
