/** Public configuration of the existing canonical pipeline, never a credential input. */
export function automationConfigurationSection():string {
  return `<form id="automation-configuration-form" class="control-grid"><h3>Processamento da API técnica</h3>
  <p>Vincule uma credencial ativa ao processamento canônico desta empresa. Configure o sistema de origem para enviar e repetir a mesma operação. Recibo, replay e processamento serão conferidos pelo servidor.</p>
  <label>ID público da credencial<input id="automation-key-id" pattern="ik_[a-f0-9]{16}" required placeholder="ik_…"></label>
  <label>Sistema da exportação<select id="automation-source-system"><option value="ERP">ERP</option><option value="MV">MV</option><option value="TASY">TASY</option></select></label>
  <label><input id="automation-configuration-consent" type="checkbox" required> Autorizo configurar o processamento canônico desta credencial para esta empresa.</label>
  <button class="btn" type="submit">Configurar processamento</button><p id="automation-configuration-status" role="status" aria-live="polite">A configuração não certifica OAuth, coleta local, execução de agente ou extração de documentos brutos.</p></form>`;
}

export function automationConfigurationClient(orgId:string, csrf:string):string {
  if(!csrf) return '';
  return `(()=>{const org=${JSON.stringify(orgId).replace(/</g,'\\u003c')},csrf=${JSON.stringify(csrf).replace(/</g,'\\u003c')};
  const form=document.getElementById('automation-configuration-form'),status=document.getElementById('automation-configuration-status');if(!form||!status)return;
  let busy=false,blocked=false;window.addEventListener('aurora:session-ended',()=>{blocked=true;form.reset();for(const n of form.elements||[])n.disabled=true;status.textContent='Sessão encerrada.'});
  async function json(options){if(blocked)throw Error('AUTH_REQUIRED');const r=await fetch('/api/integration-keys',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),...options});if(blocked||r.status===401||r.status===403)throw Error('AUTH_REQUIRED');if(!r.ok||!String(r.headers.get('content-type')).startsWith('application/json'))throw Error('CONFIGURATION_PENDING');const d=await r.json();if(blocked)throw Error('AUTH_REQUIRED');if(d.ok!==true||d.orgId!==org)throw Error('SCOPE_MISMATCH');return d;}
  form.addEventListener('submit',async e=>{e.preventDefault();if(busy||blocked)return;const id=document.getElementById('automation-key-id').value,sourceSystem=document.getElementById('automation-source-system').value;
    if(!/^ik_[a-f0-9]{16}$/.test(id)||!['ERP','MV','TASY'].includes(sourceSystem)||document.getElementById('automation-configuration-consent').checked!==true)return;
    busy=true;const button=form.querySelector('button');button.disabled=true;
    try{const current=await json({}),credential=current.credentials?.find(c=>c.keyId===id);if(!credential||credential.active!==true||!['integration.read','documents.ingest'].every(s=>credential.scopes?.includes(s)))throw Error('CREDENTIAL_INACTIVE');
      const expectedRevision=credential.automation===null?0:credential.automation?.revision;if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('CONFIGURATION_PENDING');
      const result=await json({method:'POST',headers:{'content-type':'application/json','x-aurora-csrf':csrf},body:JSON.stringify({action:'CONFIGURE_AUTOMATION',method:'API_TOKEN',keyId:id,sourceSystem,enabled:true,expectedRevision})});
      if(result.method!=='API_TOKEN'||result.configured!==true||result.revision!==expectedRevision+1||!/^[a-f0-9]{64}$/.test(result.configurationHash||''))throw Error('CONFIGURATION_PENDING');
      form.reset();status.textContent='Processamento configurado. Envie os dados autorizados pela API e repita a mesma operação para confirmar recibo, replay e processamento. OAuth e coleta local continuam com provas próprias.';
    }catch{if(!blocked)status.textContent='Configuração não confirmada. Confira sua sessão, a credencial, seus escopos e a revisão atual antes de tentar novamente.';}finally{button.disabled=blocked;busy=false;}
  });})();`;
}
