import { can, type AuroraMember } from './auroraAccess.js';
import { createHash } from 'node:crypto';
import { canImportNativeDocuments } from './auroraNativeIngestion.js';
import { installationAcceptanceClientGuard } from './auroraInstallationAcceptance.js';
import { documentIntakeClientEngine } from './auroraDocumentIntakeCore.js';
import { documentFactMapperClientSource } from './auroraDocumentFactMapping.js';
import { pdfTextBrowserClientSource } from './auroraDocumentPdfBrowser.js';

export function nativeIngestionSection(member: AuroraMember): string {
  return `<article class="card" id="native-ingestion"><h2>Documentos da empresa</h2>
  <p id="native-ingestion-status" role="status" aria-live="polite">Conferindo dados e processamento da sua empresa…</p>
  ${canImportNativeDocuments(member) ? `<form id="native-ingestion-form"><label>Exportação da operação (JSON)
  <input id="native-ingestion-file" type="file" accept=".json,application/json" required></label>
  <label><input id="native-ingestion-consent" type="checkbox" required> Autorizo importar esta fonte administrativa e configurar seu processamento canônico para a empresa deste acesso, com confirmação de replay.</label>
  <button type="submit" class="btn primary">Importar e preparar a operação</button></form>
  <p class="sub">Use a exportação estruturada do seu sistema, sem dados de pacientes. Os originais permanecem na fonte. Até 50 registros por envio. A mesma versão não é duplicada.</p>`
    : '<p class="sub">A conexão de novas fontes exige um administrador da empresa com segundo fator confirmado. As leituras já autorizadas continuam disponíveis.</p>'}
  ${canImportNativeDocuments(member)?`<form id="document-intake-form"><label>Documento administrativo
  <input id="document-intake-file" type="file" accept=".txt,.md,.csv,.json,.xml,.docx,.xlsx,.odt,.ods,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.doc,.xls,.rtf" required></label>
  <label>Origem administrativa<select id="document-intake-system"><option value="ERP">Sistema administrativo da empresa</option><option value="MV">MV</option><option value="TASY">TASY</option></select></label>
  <label><input id="document-intake-consent" type="checkbox" required> Confirmo que selecionei um documento administrativo autorizado, sem prontuário ou dados de pacientes.</label>
  <button type="submit" class="btn">Ler documento e registrar a pendência</button></form>
  <p id="document-intake-status" role="status" aria-live="polite">Texto, CSV, XML, DOCX, planilhas e texto de PDF são lidos neste navegador. PDF conserva revisão parcial; páginas digitalizadas e imagens aguardam OCR. Formatos antigos permanecem pendentes. Limite atual: 1 MB.</p>
  <pre id="document-intake-preview" class="native-output" hidden></pre>
  <p class="sub">O conteúdo fica somente na memória desta aba. O comprovante registra o resumo da leitura; valores encontrados continuam sujeitos a revisão. Isso não conclui a instalação nem valida finanças. Cada conteúdo enviado manualmente recebe um comprovante próprio; uma alteração não substitui o envio anterior.</p>`:''}
  <p class="sub">Pastas e provedores de e-mail usam o agente e os conectores autorizados da empresa. Login sozinho não concede acesso ao computador ou aos provedores.</p></article>`;
}

export function nativeIngestionClient(member: AuroraMember, tokens:{ingest:string;refresh:string;integrationKey?:string}, autoPrepare=true): string {
  if(!tokens.ingest || !tokens.refresh) return '';
  const context={orgId:member.orgId,canImport:canImportNativeDocuments(member),
    observationKeyId:'web_'+createHash('sha256').update(`${member.orgId}:${member.uid}`).digest('hex').slice(0,32),
    canRefresh:member.allFacilities && can(member,'dashboard.refresh',['platform_admin','org_admin','director','auditor']),autoPrepare,...tokens};
  return `(()=>{
  const context=${JSON.stringify(context).replace(/</g,'\\u003c')};
  const status=document.getElementById('native-ingestion-status'),form=context.canImport?document.getElementById('native-ingestion-form'):null;
  if(!status)return;
  ${documentIntakeClientEngine()}
  ${documentFactMapperClientSource()}
  ${pdfTextBrowserClientSource()}
  const documentForm=context.canImport?document.getElementById('document-intake-form'):null;
  const documentStatus=document.getElementById('document-intake-status'),documentPreview=document.getElementById('document-intake-preview');
  let documentBytes=null;
  function clearDocument(){if(documentBytes)documentBytes.fill(0);documentBytes=null;documentForm?.reset();if(documentPreview){documentPreview.textContent='';documentPreview.hidden=true;}}
  let blocked=false,busy=false,cycleRunning=false,preparation=null,controller=null;const controllers=new Set();
  ${installationAcceptanceClientGuard()}
  const display=text=>{status.textContent=text};
  const verified=p=>p?.state==='FIRST_INGESTION_VERIFIED'&&p.firstIngestionVerified===true&&/^[a-f0-9]{48}$/.test(p.documentId||'')&&Number.isSafeInteger(p.sourceVersion)&&p.sourceVersion>0&&Number.isSafeInteger(p.revision)&&p.revision>0&&/^[a-f0-9]{48}$/.test(p.versionId||'')&&/^[a-f0-9]{64}$/.test(p.canonicalSnapshotHash||'')&&typeof p.sourceSystem==='string'&&p.sourceSystem.length>0&&typeof p.verifiedAt==='string'&&Number.isFinite(Date.parse(p.verifiedAt));
  function stop(){blocked=true;for(const active of controllers)active.abort();controllers.clear();clearDocument();if(documentForm)for(const node of documentForm.elements)node.disabled=true;if(form){form.reset();for(const node of form.elements)node.disabled=true;}display('Sessão encerrada. Entre novamente para retomar.');}
  window.addEventListener('aurora:session-ended',stop);
  window.addEventListener('pagehide',()=>{blocked=true;for(const active of controllers)active.abort();controllers.clear();form?.reset();clearDocument();});
  async function json(url,options={}){
    if(blocked)throw Error('AUTH_REQUIRED');
    const active=new AbortController();controller=active;controllers.add(active);const timer=setTimeout(()=>active.abort(),125000);
    try{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',...options,signal:active.signal});
      if(r.status===401||r.status===403){stop();throw Error('AUTH_REQUIRED');}
      if(!String(r.headers.get('content-type')).startsWith('application/json'))throw Error('IMPORT_PENDING');
      const data=await r.json();
      if(!r.ok||data.ok!==true){const codes=['INVALID_DOCUMENT_PAYLOAD','SOURCE_VERSION_CONFLICT','SOURCE_VERSION_REGRESSION','IDEMPOTENCY_CONFLICT','DOCUMENT_PAYLOAD_TOO_LARGE'];throw Error(codes.includes(data.code)?data.code:'IMPORT_PENDING');}
      if(blocked)throw Error('AUTH_REQUIRED');
      if((data.organization&&data.organization.id!==context.orgId)||(data.orgId!==undefined&&data.orgId!==context.orgId)){stop();throw Error('SCOPE_MISMATCH');}
      return data;
    }finally{clearTimeout(timer);controllers.delete(active);if(controller===active)controller=null;}
  }
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  const webDigest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),value=>value.toString(16).padStart(2,'0')).join('');
  documentForm?.addEventListener('submit',async event=>{
    event.preventDefault();if(blocked||busy||!context.canImport)return;
    const file=document.getElementById('document-intake-file').files?.[0],consent=document.getElementById('document-intake-consent').checked;
    const sourceSystem=document.getElementById('document-intake-system').value;
    if(!consent||!file||file.size<1||file.size>1048576||!['ERP','MV','TASY'].includes(sourceSystem)){documentStatus.textContent='Selecione um documento administrativo de até 1 MB e confirme a autorização.';return;}
    busy=true;const button=documentForm.querySelector('button');button.disabled=true;let extracted=null,mapped=null;
    try{
      if(preparation)await preparation;if(blocked)throw Error('AUTH_REQUIRED');
      const extension=String(file.name).toLowerCase().split('.').pop();
      const mimes={txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',xml:'application/xml',
        docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',tif:'image/tiff',tiff:'image/tiff',doc:'application/msword',xls:'application/vnd.ms-excel',rtf:'application/rtf'};
      const mime=mimes[extension];if(!mime)throw Error('UNSUPPORTED_FORMAT');
      documentStatus.textContent='Lendo os bytes e conferindo a cobertura neste navegador…';
      documentBytes=new Uint8Array(await file.arrayBuffer());if(blocked)throw Error('AUTH_REQUIRED');
      const pdfController=new AbortController();controllers.add(pdfController);
      try{extracted=await documentIntakeEngine.extract(documentBytes,mime,{extractPdfText:bytes=>extractPdfText(bytes,pdfController.signal)});}
      finally{controllers.delete(pdfController);}
      if(blocked)throw Error('AUTH_REQUIRED');
      mapped=documentFactMapper.mapDocumentFactCandidates(extracted);
      // Text is local-only and rendered as textContent, never HTML or a request field.
      documentPreview.textContent=extracted.text?extracted.text.slice(0,4000)+'\\n\\nPrévia limitada a 4.000 caracteres; fatos encontrados: '+mapped.candidates.length+'. Revisão humana pendente.':'Texto ainda indisponível; extração pendente.';
      documentPreview.hidden=false;
      const externalDocumentId='manual-'+extracted.byteSha256;
      const payload={schemaVersion:'aurora.document.observation.v1',operation:'OBSERVE_DOCUMENT_EXTRACTION',sourceSystem,externalDocumentId,
        observedAt:new Date().toISOString(),expectedRevision:0,expectedPreviousObservationHash:null,
        acquisition:{provider:'MANUAL',sourceObjectIdHash:await webDigest(context.orgId+':manual:'+extracted.byteSha256),versionKind:'LOCAL_CONTENT_HASH',
          observedVersion:extracted.byteSha256,representation:'ORIGINAL_BYTES',sourceMimeType:mime,acquiredMimeType:mime,byteSha256:extracted.byteSha256,byteLength:extracted.byteLength},extraction:extracted.extraction};
      const acquisitionHash=await webDigest(JSON.stringify(stable(payload.acquisition)));
      const sourceIdHash=await webDigest(context.orgId+':'+sourceSystem+':'+externalDocumentId);
      const observationHash=await webDigest(JSON.stringify(stable({schemaVersion:payload.schemaVersion,sourceSystem,
        sourceIdHash,acquisition:payload.acquisition,extraction:payload.extraction})));
      const body=JSON.stringify(payload),idempotency='web-observe:'+await webDigest(body);
      const expectedReceiptId=await webDigest('document-observation:'+context.observationKeyId+':'+idempotency);
      const request={method:'POST',headers:{'content-type':'application/json','x-aurora-csrf':context.ingest,'idempotency-key':idempotency},body};
      if(blocked)throw Error('AUTH_REQUIRED');
      const receipt=await json('/api/integration/documents',request);
      const valid=async value=>value.schemaVersion==='aurora.document.observation.receipt.v1'&&value.code==='DOCUMENT_OBSERVATION_RECORDED'
        &&value.orgId===context.orgId&&value.observationHash===observationHash&&value.acquisitionHash===acquisitionHash
        &&value.receiptId===expectedReceiptId&&value.documentId===sourceIdHash.slice(0,48)
        &&value.versionId===(await webDigest('v1:sourceDocument:'+sourceSystem+':'+sourceIdHash.slice(0,32)+':revision:'+value.revision)).slice(0,48)
        &&Number.isSafeInteger(value.revision)&&value.revision>0&&value.nativeReady===false&&value.sourceIndependent===false
        &&value.sourceVersion===null&&value.firstIngestionVerified===false&&value.operationalComplete===false&&value.accepted===false;
      if(!await valid(receipt))throw Error('RECEIPT_REQUIRED');
      const replay=await json('/api/integration/documents',request);
      if(!await valid(replay)||replay.duplicate!==true||['receiptId','documentId','versionId','revision','observationHash','acquisitionHash'].some(key=>replay[key]!==receipt[key]))throw Error('REPLAY_REQUIRED');
      documentStatus.textContent=extracted.extraction.status==='COMPLETE'?'Texto extraído e observação registrada com repetição confirmada. Fatos e operação continuam pendentes de revisão.':
        'Observação registrada com repetição confirmada. Extração parcial ou indisponível; revisão e instalação permanecem pendentes.';
    }catch{if(!blocked)documentStatus.textContent='Leitura ou recibo ainda não confirmado. Preserve o original e retome; nenhuma conclusão operacional foi declarada.';}
    finally{if(documentBytes)documentBytes.fill(0);documentBytes=null;extracted=null;mapped=null;busy=false;button.disabled=blocked;documentForm.reset();}
  });
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
