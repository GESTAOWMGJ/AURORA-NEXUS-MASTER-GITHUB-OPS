import { can, type AuroraMember } from './auroraAccess.js';
import { canImportNativeDocuments } from './auroraNativeIngestion.js';
import { installationAcceptanceClientGuard } from './auroraInstallationAcceptance.js';

export function nativeIngestionSection(member: AuroraMember): string {
  return `<article class="card" id="native-ingestion"><h2>Documentos da empresa</h2>
  <p id="native-ingestion-status" role="status" aria-live="polite">Conferindo dados e processamento da sua empresa…</p>
  ${canImportNativeDocuments(member) ? `<form id="native-ingestion-form"><label>Exportação da operação (JSON)
  <input id="native-ingestion-file" type="file" accept=".json,application/json" required></label>
  <label><input id="native-ingestion-consent" type="checkbox" required> Autorizo importar esta fonte administrativa e configurar seu processamento canônico para a empresa deste acesso, com confirmação de replay.</label>
  <button type="submit" class="btn primary">Importar e preparar a operação</button></form>
  <p class="sub">Use a exportação estruturada do seu sistema, sem dados de pacientes. Os originais permanecem na fonte. Até 50 registros por envio. A mesma versão não é duplicada.</p>`
    : '<p class="sub">A conexão de novas fontes exige um administrador da empresa com segundo fator confirmado. As leituras já autorizadas continuam disponíveis.</p>'}
  <p class="sub">Pastas e provedores de e-mail usam o agente e os conectores autorizados da empresa. Login sozinho não concede acesso ao computador ou aos provedores.</p></article>`;
}

export function nativeIngestionClient(member: AuroraMember, tokens:{ingest:string;refresh:string;integrationKey?:string}, autoPrepare=true): string {
  if(!tokens.ingest || !tokens.refresh) return '';
  const context={orgId:member.orgId,canImport:canImportNativeDocuments(member),
    canRefresh:member.allFacilities && can(member,'dashboard.refresh',['platform_admin','org_admin','director','auditor']),autoPrepare,...tokens};
  return `(()=>{
  const context=${JSON.stringify(context).replace(/</g,'\\u003c')};
  const status=document.getElementById('native-ingestion-status'),form=context.canImport?document.getElementById('native-ingestion-form'):null;
  if(!status)return;
  let blocked=false,busy=false,cycleRunning=false,preparation=null,controller=null;
  ${installationAcceptanceClientGuard()}
  const display=text=>{status.textContent=text};
  const verified=p=>p?.state==='FIRST_INGESTION_VERIFIED'&&p.firstIngestionVerified===true&&/^[a-f0-9]{48}$/.test(p.documentId||'')&&Number.isSafeInteger(p.sourceVersion)&&p.sourceVersion>0&&Number.isSafeInteger(p.revision)&&p.revision>0&&/^[a-f0-9]{48}$/.test(p.versionId||'')&&/^[a-f0-9]{64}$/.test(p.canonicalSnapshotHash||'')&&typeof p.sourceSystem==='string'&&p.sourceSystem.length>0&&typeof p.verifiedAt==='string'&&Number.isFinite(Date.parse(p.verifiedAt));
  function stop(){blocked=true;controller?.abort();if(form){form.reset();for(const node of form.elements)node.disabled=true;}display('Sessão encerrada. Entre novamente para retomar.');}
  window.addEventListener('aurora:session-ended',stop);
  window.addEventListener('pagehide',()=>{blocked=true;controller?.abort();form?.reset();});
  async function json(url,options={}){
    if(blocked)throw Error('AUTH_REQUIRED');
    controller=new AbortController();const timer=setTimeout(()=>controller.abort(),125000);
    try{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',...options,signal:controller.signal});
      if(r.status===401||r.status===403){stop();throw Error('AUTH_REQUIRED');}
      if(!String(r.headers.get('content-type')).startsWith('application/json'))throw Error('IMPORT_PENDING');
      const data=await r.json();
      if(!r.ok||data.ok!==true){const codes=['INVALID_DOCUMENT_PAYLOAD','SOURCE_VERSION_CONFLICT','SOURCE_VERSION_REGRESSION','IDEMPOTENCY_CONFLICT','DOCUMENT_PAYLOAD_TOO_LARGE'];throw Error(codes.includes(data.code)?data.code:'IMPORT_PENDING');}
      if(blocked)throw Error('AUTH_REQUIRED');
      if((data.organization&&data.organization.id!==context.orgId)||(data.orgId!==undefined&&data.orgId!==context.orgId)){stop();throw Error('SCOPE_MISMATCH');}
      return data;
    }finally{clearTimeout(timer);controller=null;}
  }
  async function bootstrap(){const data=await json('/api/bootstrap');if(data.organization?.id!==context.orgId){stop();throw Error('SCOPE_MISMATCH');}return data;}
  async function refresh(body){if(!context.refresh)throw Error('CSRF_REQUIRED');return json('/api/refresh',{method:'POST',headers:{'content-type':'application/json','x-aurora-csrf':context.refresh},body:JSON.stringify(body)});}
  function prepare(){
    if(blocked)return Promise.resolve();if(preparation)return preparation;
    preparation=prepareOnce().finally(()=>{preparation=null});return preparation;
  }
  async function prepareOnce(){
    cycleRunning=true;
    try{let data=await bootstrap(),proof=data.installation;
      if(proof?.state==='PENDING_PROJECTION'&&context.canRefresh){display('Dados recebidos. Preparando a leitura nativa…');await refresh({});proof=(await bootstrap()).installation;}
      if(verified(proof)){
        if(!proof.operationalComplete&&context.canRefresh&&acceptanceReady(proof,context.orgId)){const receipt=await refresh({operation:'COMPLETE_INSTALLATION'});
          if(receipt.orgId!==context.orgId||!verified(receipt.installation)||!acceptanceReady(receipt.installation,context.orgId)||receipt.installation.operationalComplete!==true||['documentId','sourceVersion','revision','versionId','canonicalSnapshotHash','sourceSystem'].some(key=>receipt.installation[key]!==proof[key])||['configurationHash','receiptId','method'].some(key=>receipt.installation.acceptance[key]!==proof.acceptance[key]))throw Error('COMPLETION_UNCONFIRMED');proof=receipt.installation;}
        display(proof.operationalComplete&&acceptanceReady(proof,context.orgId)?'Documentos recebidos, processados e operação preparada. OAuth, coleta local e extração global exigem provas próprias.':'Ingestão e processamento confirmados. Configuração autorizada, recibo e replay ainda precisam de confirmação para concluir.');
      }else display(proof?.state==='PENDING_PROJECTION'?'Documentos recebidos; processamento pendente.':proof?.state==='PENDING_CANONICAL_DATA'?'Documentos recebidos; validação dos dados e evidências pendente.':'Conecte uma fonte autorizada ou importe a exportação da operação para começar.');
    }catch{if(!blocked)display('Preparação pendente. Dados já recebidos foram preservados; retome com a mesma fonte.');}finally{cycleRunning=false;}
  }
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    if(blocked){display('Sessão encerrada. Entre novamente para retomar.');return;}
    if(busy){display('Importação em andamento. Aguarde o recibo antes de novo envio.');return;}
    if(!context.canImport){display('Importação exige administrador com segundo fator confirmado.');return;}
    const file=document.getElementById('native-ingestion-file').files?.[0],consent=document.getElementById('native-ingestion-consent').checked;
    if(!consent||!file||file.size>262144||file.size===0){display('Selecione uma exportação JSON de até 256 KB e confirme a fonte.');return;}
    busy=true;window.dispatchEvent(new Event('aurora:ingestion-started'));const button=form.querySelector('button');button.disabled=true;let confirmed=0;
    try{
      if(preparation){display('Aguardando a verificação inicial. O envio continuará automaticamente.');await preparation;}
      if(blocked)throw Error('AUTH_REQUIRED');
      display('Lendo e conferindo a exportação selecionada…');
      const raw=JSON.parse(await file.text()),rows=Array.isArray(raw)?raw:[raw];
      if(rows.length<1||rows.length>50||rows.some(item=>!item||typeof item!=='object'||Array.isArray(item)))throw Error('INVALID_EXPORT');
      let configuration=null;
      if(context.integrationKey){configuration=await json('/api/integration-keys');if(!Number.isSafeInteger(configuration.manualAutomationRevision)||configuration.manualAutomationRevision<0)throw Error('CONFIGURATION_PENDING');}
      for(const row of rows){if(blocked)throw Error('AUTH_REQUIRED');const body=JSON.stringify(row);
        const bytes=new TextEncoder().encode(body);if(bytes.length>131072)throw Error('INVALID_EXPORT');
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
        display('Importando registro '+(confirmed+1)+' de '+rows.length+'…');
        if(context.integrationKey){const configured=await json('/api/integration-keys',{method:'POST',headers:{'content-type':'application/json','x-aurora-csrf':context.integrationKey},body:JSON.stringify({action:'CONFIGURE_AUTOMATION',method:'MANUAL',sourceSystem:row.sourceSystem,enabled:true,expectedRevision:configuration.manualAutomationRevision})});if(configured.method!=='MANUAL'||!Number.isSafeInteger(configured.revision)||configured.revision!==configuration.manualAutomationRevision+1)throw Error('CONFIGURATION_PENDING');configuration.manualAutomationRevision=configured.revision;}
        const request={method:'POST',headers:{'content-type':'application/json','x-aurora-csrf':context.ingest,'idempotency-key':'web-import:'+digest},body};
        const receipt=await json('/api/integration/documents',request);
        if(receipt.orgId!==context.orgId||!/^[a-f0-9]{48}$/.test(receipt.documentId||'')||!/^[a-f0-9]{64}$/.test(receipt.canonicalSnapshotHash||'')||receipt.sourceVersion!==row.sourceVersion||!(receipt.accepted===true||receipt.duplicate===true))throw Error('RECEIPT_REQUIRED');confirmed++;
        const replay=await json('/api/integration/documents',request);
        if(replay.orgId!==context.orgId||replay.duplicate!==true||replay.accepted!==false||replay.documentId!==receipt.documentId||replay.sourceVersion!==receipt.sourceVersion||replay.canonicalSnapshotHash!==receipt.canonicalSnapshotHash)throw Error('REPLAY_REQUIRED');
      }
      form.reset();if(context.autoPrepare){await prepare();if(!blocked)display(confirmed+' registro(s) com recibo. '+status.textContent);}else display(confirmed+' registro(s) com recibo. Conferindo o processamento da instalação…');
    }catch(error){if(!blocked){
      const code=error?.name==='SyntaxError'?'INVALID_EXPORT':error?.message;
      const reasons={INVALID_EXPORT:'Arquivo JSON inválido ou fora do limite de 1 a 50 registros.',INVALID_DOCUMENT_PAYLOAD:'Registro fora do formato de importação aceito.',DOCUMENT_PAYLOAD_TOO_LARGE:'Registro excede o tamanho permitido.',SOURCE_VERSION_CONFLICT:'Esta versão já existe com conteúdo diferente. Preserve o arquivo e confira a origem.',SOURCE_VERSION_REGRESSION:'A origem possui uma versão mais recente.',IDEMPOTENCY_CONFLICT:'O envio conflita com um recibo anterior.',RECEIPT_REQUIRED:'O servidor não devolveu um recibo válido.',REPLAY_REQUIRED:'A repetição real do envio ainda não foi confirmada.',CONFIGURATION_PENDING:'Configuração do processamento ainda não confirmada.'};
      display(confirmed+' registro(s) com recibo. '+(reasons[code]||'Resposta do servidor não confirmada.')+' Importação pendente. Retome com o mesmo arquivo; registros confirmados não serão duplicados.');
    }}
    finally{busy=false;button.disabled=blocked;window.dispatchEvent(new Event('aurora:documents-imported'));}
  });
  if(context.autoPrepare)prepare();
})();`;
}
