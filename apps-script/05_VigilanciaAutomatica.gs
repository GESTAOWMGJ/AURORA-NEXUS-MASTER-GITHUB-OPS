function executarVigilanciaAutomaticaWMGJ(){
  const inicio=nowWMGJ_();
  registrarLogWMGJ_('VIGILANCIA','START',inicio);

  const ss=getPlanilhaWMGJ();
  const quarentena=garantirPlanilhaQuarentenaWMGJ_();
  const aba=garantirAbaQuarentenaWMGJ_(quarentena);
  const pasta=garantirPastaQuarentenaWMGJ_();

  const termos=[
    'WMGJ_Relatorio_Mensal_Automatico_Socios',
    'QUICK_START_WMGJ_INDEXACAO',
    'proposta_credito_JFNeto',
    'WGMJ',
    'Apps Script WMGJ',
    'WMGJ_APPS_SCRIPT'
  ];

  const vistos={};
  let total=0;
  let suspeitos=0;

  termos.forEach(function(termo){
    const arquivos=DriveApp.searchFiles("title contains '"+termo.replace(/'/g,"\\'")+"' and trashed=false");
    while(arquivos.hasNext()){
      const f=arquivos.next();
      total++;
      const nome=f.getName();
      const chave=normalizarNomeWMGJ_(nome);
      const motivo=classificarSuspeitaWMGJ_(nome,chave,vistos);
      if(motivo){
        suspeitos++;
        registrarArquivoSuspeitoWMGJ_(aba,f,motivo);
        moverParaQuarentenaSePossivelWMGJ_(f,pasta);
      }
      vistos[chave]=true;
    }
  });

  registrarLogWMGJ_('VIGILANCIA','OK','total='+total+' suspeitos='+suspeitos);
  return {ok:true,total:total,suspeitos:suspeitos};
}

function normalizarNomeWMGJ_(nome){
  return String(nome||'')
    .toUpperCase()
    .replace(/WGMJ/g,'WMGJ')
    .replace(/\s*\(\d+\)/g,'')
    .replace(/-\d+(?=\.)/g,'')
    .replace(/COPY|COPIA|CÓPIA/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

function classificarSuspeitaWMGJ_(nome,chave,vistos){
  const n=String(nome||'').toUpperCase();
  if(n.indexOf('WGMJ')>=0)return 'ALIAS_WGMJ_LEGADO';
  if(/\(\d+\)/.test(n))return 'SUFIXO_DUPLICADO';
  if(/-\d+\./.test(n))return 'VERSAO_INTERMEDIARIA';
  if(n.indexOf('COPY')>=0||n.indexOf('COPIA')>=0||n.indexOf('CÓPIA')>=0)return 'COPIA_NOMINAL';
  if(vistos[chave])return 'DUPLICIDADE_NOME_NORMALIZADO';
  if(n.indexOf('APPS_SCRIPT')>=0&&n.indexOf('DOCUMENT')>=0)return 'CODIGO_FORA_GITHUB';
  return '';
}

function garantirPlanilhaQuarentenaWMGJ_(){
  const props=PropertiesService.getScriptProperties();
  const id=props.getProperty('WMGJ_QUARENTENA_ID');
  if(id){
    try{return SpreadsheetApp.openById(id);}catch(e){}
  }
  const nova=SpreadsheetApp.create('WMGJ_ARQUIVOS_LEGADOS_DUPLICADOS');
  props.setProperty('WMGJ_QUARENTENA_ID',nova.getId());
  return nova;
}

function garantirAbaQuarentenaWMGJ_(ss){
  let aba=ss.getSheetByName('QUARENTENA');
  if(!aba){
    aba=ss.getSheets()[0];
    aba.setName('QUARENTENA');
    aba.clear();
    aba.appendRow(['DATA_HORA','FILE_ID','NOME','URL','STATUS','MOTIVO','ACAO']);
  }
  return aba;
}

function garantirPastaQuarentenaWMGJ_(){
  const props=PropertiesService.getScriptProperties();
  const id=props.getProperty('WMGJ_PASTA_QUARENTENA_ID');
  if(id){
    try{return DriveApp.getFolderById(id);}catch(e){}
  }
  const pasta=DriveApp.createFolder('WMGJ_ARQUIVO_LEGADO_DUPLICADO_IGNORAR');
  props.setProperty('WMGJ_PASTA_QUARENTENA_ID',pasta.getId());
  return pasta;
}

function registrarArquivoSuspeitoWMGJ_(aba,file,motivo){
  aba.appendRow([
    nowWMGJ_(),
    file.getId(),
    file.getName(),
    file.getUrl(),
    'IGNORAR',
    motivo,
    'QUARENTENA_LOGICA'
  ]);
}

function moverParaQuarentenaSePossivelWMGJ_(file,pasta){
  try{
    pasta.addFile(file);
    const parents=file.getParents();
    while(parents.hasNext()){
      const p=parents.next();
      if(p.getId()!==pasta.getId())p.removeFile(file);
    }
  }catch(e){
    registrarLogWMGJ_('VIGILANCIA_MOVE','FALHA',file.getName());
  }
}

function instalarGatilhoVigilanciaWMGJ(){
  removerGatilhosVigilanciaWMGJ_();
  ScriptApp.newTrigger('executarVigilanciaAutomaticaWMGJ')
    .timeBased()
    .everyHours(1)
    .create();
  registrarLogWMGJ_('VIGILANCIA_TRIGGER','OK','hourly');
  return {ok:true,trigger:'hourly'};
}

function removerGatilhosVigilanciaWMGJ_(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==='executarVigilanciaAutomaticaWMGJ'){
      ScriptApp.deleteTrigger(t);
    }
  });
}

function validarPromptWMGJ(prompt){
  const p=String(prompt||'').toUpperCase();
  const bloqueios=[];
  if(p.indexOf('WGMJ')>=0)bloqueios.push('USE_WMGJ_NAO_WGMJ');
  if(p.indexOf('CRIAR NOVA PLANILHA')>=0)bloqueios.push('EVITAR_NOVA_PLANILHA_SE_EXISTE_BASE_MESTRE');
  if(p.indexOf('APAGAR')>=0||p.indexOf('EXCLUIR')>=0)bloqueios.push('EXCLUSAO_REQUER_REVISAO');
  if(p.indexOf('CODIGO NO DRIVE')>=0)bloqueios.push('CODIGO_DEVE_FICAR_NO_GITHUB');
  return {ok:bloqueios.length===0,bloqueios:bloqueios};
}
