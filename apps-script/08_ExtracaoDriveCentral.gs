function processarDriveCentralWMGJ(){
  registrarLogWMGJ_('DRIVE_CENTRAL','START');

  const pasta=garantirPastaEntradaDriveWMGJ_();
  const files=pasta.getFiles();
  const ss=getPlanilhaWMGJ();

  const abaDocs=garantirAbaWMGJ_(ss,'13_INDICE_DOCUMENTOS_DRIVE',['DATA_HORA','ORIGEM','FILE_ID','NOME','URL','MIME','TIPO','STATUS']);
  const abaExtratos=garantirAbaWMGJ_(ss,'14_EXTRATOS_BANCARIOS',['DATA','BANCO','DESCRICAO','VALOR','ARQUIVO']);
  const abaEscalas=garantirAbaWMGJ_(ss,'15_ESCALAS_IMPORTADAS',['DATA','PROFISSIONAL','TURNO','ARQUIVO']);
  const abaAtend=garantirAbaWMGJ_(ss,'16_ATENDIMENTOS_IMPORTADOS',['DATA','PACIENTE','PROCEDIMENTO','ARQUIVO']);
  const abaPront=garantirAbaWMGJ_(ss,'17_PRONTUARIOS_IMPORTADOS',['DATA','PACIENTE','REFERENCIA','ARQUIVO']);

  let total=0;

  while(files.hasNext()){
    const file=files.next();
    total++;

    const nome=file.getName();
    const mime=file.getMimeType();
    const url=file.getUrl();
    const tipo=classificarDocumentoWMGJ_(nome,mime);

    abaDocs.appendRow([
      nowWMGJ_(),
      'DRIVE',
      file.getId(),
      nome,
      url,
      mime,
      tipo,
      'INDEXADO'
    ]);

    switch(tipo){
      case 'EXTRATO_BANCARIO':
        abaExtratos.appendRow([nowWMGJ_(),'BANCO_NAO_IDENTIFICADO',nome,'0',nome]);
        break;

      case 'ESCALA':
        abaEscalas.appendRow([nowWMGJ_(),'NAO_IDENTIFICADO','NAO_IDENTIFICADO',nome]);
        break;

      case 'ATENDIMENTO':
        abaAtend.appendRow([nowWMGJ_(),'NAO_IDENTIFICADO','NAO_IDENTIFICADO',nome]);
        break;

      case 'PRONTUARIO':
        abaPront.appendRow([nowWMGJ_(),'NAO_IDENTIFICADO','REFERENCIA_PENDENTE',nome]);
        break;
    }
  }

  registrarLogWMGJ_('DRIVE_CENTRAL','OK','arquivos='+total);
  return {ok:true,arquivos:total};
}

function classificarDocumentoWMGJ_(nome,mime){
  const n=String(nome||'').toUpperCase();

  if(/EXTRATO|BANK|BANCO|SICOOB|ITAU|BRADESCO|CAIXA|PIX/.test(n))return 'EXTRATO_BANCARIO';
  if(/ESCALA|PLANTAO|PLANTÃO/.test(n))return 'ESCALA';
  if(/ATENDIMENTO|PACIENTE|CONSULTA/.test(n))return 'ATENDIMENTO';
  if(/PRONTUARIO|PRONTUÁRIO|EVOLUCAO|EVOLUÇÃO/.test(n))return 'PRONTUARIO';
  if(/NF|NOTA FISCAL|NFS/.test(n))return 'NFS';

  return 'DOCUMENTO_GERAL';
}

function garantirAbaWMGJ_(ss,nome,headers){
  let aba=ss.getSheetByName(nome);
  if(!aba){
    aba=ss.insertSheet(nome);
    aba.appendRow(headers);
  }
  return aba;
}
