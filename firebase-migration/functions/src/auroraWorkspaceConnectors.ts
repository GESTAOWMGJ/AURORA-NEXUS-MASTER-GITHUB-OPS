/** Public capability descriptions, never credentials or an inherited ChatGPT grant. */
export const WORKSPACE_CONNECTORS = Object.freeze([
  {provider:'NOTION',label:'Notion',scope:'Páginas autorizadas pela empresa',setup:'Autorize páginas específicas para a integração da sua empresa e configure-as no agente instalado.'},
  {provider:'SLACK',label:'Slack',scope:'Workspace e canais autorizados pela empresa',setup:'Autorize o aplicativo de leitura no workspace e escolha os canais da empresa no agente instalado.'}
]);

export function workspaceConnectorReadback(agents: readonly {state?:string;providers?:unknown}[]) {
  return WORKSPACE_CONNECTORS.map(connector=>{
    const reports=agents.flatMap(agent=>Array.isArray(agent.providers)?agent.providers
      .filter(row=>row&&typeof row==='object'&&row.provider===connector.provider)
      .map(row=>({agent,row})):[]);
    const fresh=reports.filter(report=>report.agent.state==='CONNECTED_REPORTED');
    const confirmed=fresh.some(report=>report.row.state==='READ_CONFIRMED');
    return {...connector,state:confirmed?'READ_REPORTED':fresh.length?'CONNECTION_PENDING':reports.length?'STALE':'NOT_REPORTED',
      scopeConfiguredReported:reports.length>0,coverageLimited:confirmed&&(fresh.some(report=>report.row.coverageLimited===true||report.row.state!=='READ_CONFIRMED')||reports.length!==fresh.length),
      physicalInstallationVerified:false,fullSynchronizationVerified:false,sourceMutationAllowed:false};
  });
}

export function workspaceConnectorSection():string {
  return `<div id="workspace-connectors" class="source-status-list">${WORKSPACE_CONNECTORS.map(connector=>
    `<article class="activity-row"><div><b>${connector.label}</b><p>${connector.scope}</p><p>${connector.setup}</p><p id="workspace-connector-${connector.provider}" role="status" aria-live="polite">Conexão pendente de autorização e configuração da empresa.</p></div></article>`).join('')}</div>
    <p class="sub">Após configurar, o agente continua o escopo autorizado e o painel confere o status ao entrar e durante a consulta automática. Cada empresa autoriza seu próprio acesso no AURORA. Conteúdo ainda não extraído permanece pendente.</p>`;
}

/** Setup's first read is bounded; ongoing portal checks use its existing polling cycle. */
export function workspaceConnectorSetupClient(orgId:string,enabled:boolean):string {
  if(!enabled)return '';
  return `(()=>{const orgId=${JSON.stringify(orgId).replace(/</g,'\\u003c')};const controller=new AbortController();let closed=false;
  const update=(provider,text)=>{const node=document.getElementById('workspace-connector-'+provider);if(node)node.textContent=text};
  window.addEventListener('pagehide',()=>{closed=true;controller.abort();for(const provider of ['NOTION','SLACK'])update(provider,'Sessão encerrada.');});
  const timer=setTimeout(()=>controller.abort(),10000);
  fetch('/api/integration-keys',{headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store',signal:controller.signal})
  .then(async response=>{if(!response.ok)throw Error('CONNECTION_PENDING');const data=await response.json();if(closed)return;
    if(data.ok!==true||data.orgId!==orgId||!Array.isArray(data.workspaceConnectors))throw Error('SCOPE_MISMATCH');
    for(const connector of data.workspaceConnectors){if(!['NOTION','SLACK'].includes(connector.provider))continue;
      update(connector.provider,connector.state==='READ_REPORTED'?'Leitura relatada no escopo autorizado'+(connector.coverageLimited?' · cobertura parcial.':'.'):connector.state==='STALE'?'Comunicação antiga; aguardando nova confirmação.':'Conexão pendente de autorização e configuração da empresa.');}
  }).catch(()=>{if(!closed)for(const provider of ['NOTION','SLACK'])update(provider,'Conexão não reconfirmada. Confira as fontes em Integrações.');}).finally(()=>clearTimeout(timer));
})();`;
}
