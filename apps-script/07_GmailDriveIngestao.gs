function importarAnexosGmailParaDriveWMGJ(){
  registrarLogWMGJ_('GMAIL_DRIVE','START','importacao anexos');

  const pasta=garantirPastaEntradaDriveWMGJ_();
  const labelProcessado=garantirLabelGmailWMGJ_('WMGJ_PROCESSADO');
  const labelImportado=garantirLabelGmailWMGJ_('WMGJ_IMPORTADO_DRIVE');
  const query=PropertiesService.getScriptProperties().getProperty('WMGJ_GMAIL_QUERY')||'has:attachment -label:WMGJ_PROCESSADO newer_than:90d';
  const threads=GmailApp.search(query,0,50);

  let anexos=0;

  threads.forEach(function(thread){
    const msgs=thread.getMessages();
    msgs.forEach(function(msg){
      msg.getAttachments({includeInlineImages:false,includeAttachments:true}).forEach(function(att){
        const nome=att.getName()||'ANEXO_SEM_NOME';
        if(!arquivoPermitidoWMGJ_(nome))return;
        const chave=msg.getId()+'_'+nome;
        if(jaImportadoWMGJ_(chave))return;

        const file=pasta.createFile(att.copyBlob()).setName(nome);
        registrarArquivoImportadoWMGJ_(chave,file,msg,thread);
        anexos++;
      });
    });
    thread.addLabel(labelProcessado);
    thread.addLabel(labelImportado);
  });

  registrarLogWMGJ_('GMAIL_DRIVE','OK','anexos='+anexos);
  return {ok:true,anexos:anexos,threads:threads.length};
}

function garantirPastaEntradaDriveWMGJ_(){
  const props=PropertiesService.getScriptProperties();
  const id=props.getProperty('WMGJ_PASTA_ENTRADA_DRIVE_ID');
  if(id){
    try{return DriveApp.getFolderById(id);}catch(e){}
  }
  const pasta=DriveApp.createFolder('WMGJ_01_ENTRADA_DOCUMENTOS_AUTOMATICA');
  props.setProperty('WMGJ_PASTA_ENTRADA_DRIVE_ID',pasta.getId());
  return pasta;
}

function garantirLabelGmailWMGJ_(nome){
  return GmailApp.getUserLabelByName(nome)||GmailApp.createLabel(nome);
}

function arquivoPermitidoWMGJ_(nome){
  const n=String(nome||'').toLowerCase();
  return /\.(pdf|xlsx|xls|csv|txt|doc|docx|png|jpg|jpeg)$/i.test(n);
}

function jaImportadoWMGJ_(chave){
  const props=PropertiesService.getScriptProperties();
  return props.getProperty('GMAIL_FILE_'+chave)==='1';
}

function registrarArquivoImportadoWMGJ_(chave,file,msg,thread){
  const props=PropertiesService.getScriptProperties();
  props.setProperty('GMAIL_FILE_'+chave,'1');

  const ss=getPlanilhaWMGJ();
  const aba=garantirAbaWMGJ_(ss,'13_INDICE_DOCUMENTOS_DRIVE',['DATA_HORA','ORIGEM','FILE_ID','NOME','URL','MIME','ASSUNTO','STATUS','HASH_LOGICO']);
  aba.appendRow([
    nowWMGJ_(),
    'GMAIL',
    file.getId(),
    file.getName(),
    file.getUrl(),
    file.getMimeType(),
    msg.getSubject(),
    'IMPORTADO_DRIVE',
    chave
  ]);
}
