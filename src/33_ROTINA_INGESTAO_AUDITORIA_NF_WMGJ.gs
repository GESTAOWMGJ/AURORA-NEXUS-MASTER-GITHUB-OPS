/**
 * WMGJ — Rotina diária de ingestão, auditoria documental e conferência de solicitações de NFS-e.
 * Versão: v1.0.0-ingestao-auditoria-nf
 *
 * Objetivo operacional:
 * - indexar diariamente mensagens com anexos e solicitações fiscais/operacionais;
 * - encaminhar anexos pertinentes para o fluxo bruto/pipeline já existente;
 * - registrar auditoria de arquivos indexados;
 * - confrontar solicitações de NFS-e com atendimentos x R$ 90,00;
 * - notificar o operador quando houver novo documento, solicitação de NF ou divergência.
 */

var WMGJ_ROTINA_INGESTAO_NF_VERSAO = 'v1.0.0-ingestao-auditoria-nf';
var WMGJ_VALOR_BRUTO_ATENDIMENTO = 90;

function executarRotinaDiariaIngestaoAuditoriaNfWMGJ(opcoes) {
  opcoes = opcoes || {};
  var inicio = new Date();
  var resultado = {
    ok: true,
    versao: WMGJ_ROTINA_INGESTAO_NF_VERSAO,
    etapa: 'executarRotinaDiariaIngestaoAuditoriaNfWMGJ',
    modo: opcoes.modo || 'ROTINA_DIARIA',
    inicio: inicio.toISOString(),
    gmailLabelAplicado: null,
    indexacao: null,
    auditoria: null,
    conferenciaNf: null,
    notificacao: null,
    erros: []
  };

  try {
    resultado.gmailLabelAplicado = aplicarLabelGmailParaIngestaoWMGJ_(opcoes);
  } catch (erroLabel) {
    resultado.ok = false;
    resultado.erros.push({ etapa: 'aplicarLabelGmailParaIngestaoWMGJ_', erro: normalizarErroIngestaoWMGJ_(erroLabel) });
  }

  try {
    resultado.indexacao = executarIndexacaoGmailOperacionalWMGJ_(opcoes);
    if (resultado.indexacao && resultado.indexacao.ok === false) resultado.ok = false;
  } catch (erroIndexacao) {
    resultado.ok = false;
    resultado.erros.push({ etapa: 'executarIndexacaoGmailOperacionalWMGJ_', erro: normalizarErroIngestaoWMGJ_(erroIndexacao) });
  }

  try {
    resultado.auditoria = auditarArquivosIndexadosOperacionalWMGJ({ limiteLinhas: Number(opcoes.limiteAuditoria || 5000) });
    if (resultado.auditoria && resultado.auditoria.ok === false) resultado.ok = false;
  } catch (erroAuditoria) {
    resultado.ok = false;
    resultado.erros.push({ etapa: 'auditarArquivosIndexadosOperacionalWMGJ', erro: normalizarErroIngestaoWMGJ_(erroAuditoria) });
  }

  try {
    resultado.conferenciaNf = confrontarSolicitacoesNfComAtendimentosWMGJ({ limiteLinhas: Number(opcoes.limiteNf || 1000) });
    if (resultado.conferenciaNf && resultado.conferenciaNf.ok === false) resultado.ok = false;
  } catch (erroNf) {
    resultado.ok = false;
    resultado.erros.push({ etapa: 'confrontarSolicitacoesNfComAtendimentosWMGJ', erro: normalizarErroIngestaoWMGJ_(erroNf) });
  }

  try {
    resultado.notificacao = notificarResumoIngestaoAuditoriaNfWMGJ_(resultado, opcoes);
  } catch (erroNotif) {
    resultado.ok = false;
    resultado.erros.push({ etapa: 'notificarResumoIngestaoAuditoriaNfWMGJ_', erro: normalizarErroIngestaoWMGJ_(erroNotif) });
  }

  resultado.fim = new Date().toISOString();
  registrarStatusIngestaoAuditoriaNfWMGJ_(resultado);
  registrarLogIngestaoAuditoriaNfWMGJ_(resultado.ok ? 'OK' : 'ALERTA', 'executarRotinaDiariaIngestaoAuditoriaNfWMGJ', resultado);
  return resultado;
}

function rodarRotinaDiariaIngestaoAuditoriaNfWMGJ() {
  return executarRotinaDiariaIngestaoAuditoriaNfWMGJ({
    modo: 'MANUAL_OU_GATILHO_DIARIO',
    diasBusca: 3,
    limiteThreadsTotal: 80,
    limiteThreadsPorQuery: 20,
    notificarSempre: false
  });
}

function instalarGatilhoDiarioIngestaoAuditoriaNfWMGJ() {
  removerGatilhosPorFuncaoIngestaoWMGJ_('rodarRotinaDiariaIngestaoAuditoriaNfWMGJ');
  ScriptApp.newTrigger('rodarRotinaDiariaIngestaoAuditoriaNfWMGJ')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  var resultado = {
    ok: true,
    versao: WMGJ_ROTINA_INGESTAO_NF_VERSAO,
    etapa: 'instalarGatilhoDiarioIngestaoAuditoriaNfWMGJ',
    funcao: 'rodarRotinaDiariaIngestaoAuditoriaNfWMGJ',
    frequencia: 'DIARIA_07H',
    instaladoEm: new Date().toISOString()
  };
  registrarStatusIngestaoAuditoriaNfWMGJ_(resultado);
  registrarLogIngestaoAuditoriaNfWMGJ_('OK', 'instalarGatilhoDiarioIngestaoAuditoriaNfWMGJ', resultado);
  return resultado;
}

function aplicarLabelGmailParaIngestaoWMGJ_(opcoes) {
  opcoes = opcoes || {};
  var cfg = getConfigWMGJ_();
  garantirLabelsGmail_();
  var labelImportar = GmailApp.getUserLabelByName(cfg.GMAIL.IMPORTAR);
  var labelProcessado = GmailApp.getUserLabelByName(cfg.GMAIL.PROCESSADO);
  var dias = Number(opcoes.diasBusca || 3);
  var limite = Number(opcoes.limiteLabel || 100);
  var query = [
    'newer_than:' + dias + 'd',
    '-in:spam',
    '-in:trash',
    '(' + [
      'has:attachment',
      '"nota fiscal"',
      'nfse',
      '"nfs-e"',
      'faturamento',
      'extrato',
      'bradesco',
      'repasse',
      'honorarios',
      'honorários',
      '"produção médica"',
      '"producao medica"',
      'escala',
      'atendimentos'
    ].join(' OR ') + ')'
  ].join(' ');

  var threads = GmailApp.search(query, 0, limite);
  var novas = 0;
  threads.forEach(function(thread) {
    var labels = thread.getLabels().map(function(l) { return l.getName(); });
    if (labels.indexOf(cfg.GMAIL.PROCESSADO) >= 0) return;
    if (labels.indexOf(cfg.GMAIL.IMPORTAR) < 0) {
      thread.addLabel(labelImportar);
      novas++;
    }
  });

  return { ok: true, query: query, threadsEncontradas: threads.length, novasMarcadasParaImportar: novas };
}

function executarIndexacaoGmailOperacionalWMGJ_(opcoes) {
  opcoes = opcoes || {};
  if (typeof indexarGmailFaturamentoWMGJ_V2 === 'function') {
    return indexarGmailFaturamentoWMGJ_V2({
      limiteThreadsTotal: Number(opcoes.limiteThreadsTotal || 80),
      limiteThreadsPorQuery: Number(opcoes.limiteThreadsPorQuery || 20),
      dias: Number(opcoes.diasBusca || 3),
      executarPipelineDepois: true,
      incluirBuscaBruta: true
    });
  }
  if (typeof importarGmailWMGJ === 'function') return importarGmailWMGJ();
  return { ok: false, erro: 'INDEXADOR_GMAIL_NAO_DISPONIVEL' };
}

function auditarArquivosIndexadosOperacionalWMGJ(opcoes) {
  opcoes = opcoes || {};
  var ss = getPlanilha();
  var origem = ss.getSheetByName('21_GMAIL_INDEXACAO_FATURAMENTO');
  var destino = obterOuCriarAba_(ss, '33_AUDITORIA_ARQUIVOS_INDEXADOS', [
    'DATA_AUDITORIA', 'TOTAL_INDEXADOS', 'COPIADOS_BRUTO', 'IGNORADOS', 'ERROS', 'SEM_COMPETENCIA', 'SEM_ARQUIVO_DRIVE_ID', 'CATEGORIAS_JSON', 'ALERTAS_JSON'
  ]);

  if (!origem || origem.getLastRow() < 2) {
    var vazio = { ok: false, motivo: 'SEM_INDEXACAO_GMAIL', totalIndexados: 0 };
    destino.appendRow([new Date(), 0, 0, 0, 0, 0, 0, '{}', JSON.stringify([vazio])]);
    return vazio;
  }

  var limite = Math.min(origem.getLastRow(), Number(opcoes.limiteLinhas || 5000));
  var dados = origem.getRange(1, 1, limite, origem.getLastColumn()).getValues();
  var h = mapearCabecalhoIngestaoWMGJ_(dados[0]);
  var total = 0, copiados = 0, ignorados = 0, erros = 0, semCompetencia = 0, semDrive = 0;
  var categorias = {};

  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    total++;
    var status = String(r[h.STATUS] || '');
    var categoria = String(r[h.CATEGORIA] || 'SEM_CATEGORIA');
    categorias[categoria] = (categorias[categoria] || 0) + 1;
    if (/COPIADO/.test(status)) copiados++;
    if (/IGNORADO/.test(status)) ignorados++;
    if (/ERRO/.test(status)) erros++;
    if (!r[h.COMPETENCIA]) semCompetencia++;
    if (/COPIADO/.test(status) && !r[h.ARQUIVO_DRIVE_ID]) semDrive++;
  }

  var alertas = [];
  if (erros > 0) alertas.push({ tipo: 'ERROS_INDEXACAO', quantidade: erros });
  if (semCompetencia > 0) alertas.push({ tipo: 'DOCUMENTOS_SEM_COMPETENCIA', quantidade: semCompetencia });
  if (semDrive > 0) alertas.push({ tipo: 'COPIADOS_SEM_DRIVE_ID', quantidade: semDrive });

  destino.appendRow([new Date(), total, copiados, ignorados, erros, semCompetencia, semDrive, JSON.stringify(categorias), JSON.stringify(alertas)]);

  return { ok: erros === 0, totalIndexados: total, copiadosBruto: copiados, ignorados: ignorados, erros: erros, semCompetencia: semCompetencia, semArquivoDriveId: semDrive, categorias: categorias, alertas: alertas };
}

function confrontarSolicitacoesNfComAtendimentosWMGJ(opcoes) {
  opcoes = opcoes || {};
  var ss = getPlanilha();
  var gmail = ss.getSheetByName('21_GMAIL_INDEXACAO_FATURAMENTO');
  var destino = obterOuCriarAba_(ss, '34_CONFERENCIA_SOLICITACOES_NF', [
    'DATA_CONFERENCIA', 'COMPETENCIA', 'ORIGEM', 'REMETENTE', 'ASSUNTO', 'DOCUMENTO', 'ATENDIMENTOS_SOLICITADOS', 'ATENDIMENTOS_BASE', 'VALOR_BRUTO_ESPERADO', 'VALOR_SOLICITADO_OU_DOCUMENTO', 'TRIBUTO_RETIDO_ESTIMADO', 'VALOR_LIQUIDO_ESPERADO', 'DIFERENCA_BRUTO', 'STATUS', 'OBSERVACAO'
  ]);

  if (!gmail || gmail.getLastRow() < 2) return { ok: false, motivo: 'SEM_INDEXACAO_GMAIL_PARA_CONFERENCIA_NF' };

  var baseAtendimentos = montarMapaAtendimentosPorCompetenciaWMGJ_(ss);
  var limite = Math.min(gmail.getLastRow(), Number(opcoes.limiteLinhas || 1000));
  var dados = gmail.getRange(1, 1, limite, gmail.getLastColumn()).getValues();
  var h = mapearCabecalhoIngestaoWMGJ_(dados[0]);
  var novas = 0, divergencias = 0, analisadas = 0;
  var chavesExistentes = carregarChavesConferenciaNfWMGJ_(destino);

  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    var texto = [r[h.ASSUNTO], r[h.ANEXO_NOME], r[h.TIPO_DOCUMENTO], r[h.CATEGORIA], r[h.JUSTIFICATIVA]].join(' ').toLowerCase();
    if (!/(solicita|solicitação|solicitacao|emitir|emissão|emissao|nota fiscal|nfs-e|nfse|faturamento)/.test(texto)) continue;

    var competencia = String(r[h.COMPETENCIA] || extrairCompetenciaGmailWMGJ_(texto, r[h.DATA_EMAIL]) || '');
    var atendSolic = extrairAtendimentosSolicitadosNfWMGJ_(texto);
    var atendBase = baseAtendimentos[competencia] || 0;
    var brutoEsperado = (atendSolic || atendBase) * WMGJ_VALOR_BRUTO_ATENDIMENTO;
    var valorDocumento = Number(r[h.VALOR] || 0);
    var tributoRetido = brutoEsperado > valorDocumento && valorDocumento > 0 ? brutoEsperado - valorDocumento : 0;
    var liquidoEsperado = brutoEsperado - tributoRetido;
    var diferenca = valorDocumento > 0 ? brutoEsperado - valorDocumento - tributoRetido : 0;
    var status = 'OK_PRELIMINAR';
    var obs = 'Regra: bruto = atendimentos x R$ 90,00; na emissão, deduzir apenas tributo retido inicial da Prefeitura de Londrina.';

    if (!competencia) { status = 'PENDENTE_COMPETENCIA'; divergencias++; }
    else if (!atendSolic && !atendBase) { status = 'PENDENTE_ATENDIMENTOS'; divergencias++; }
    else if (atendSolic && atendBase && atendSolic !== atendBase) { status = 'DIVERGENCIA_ATENDIMENTOS'; divergencias++; }
    else if (valorDocumento > 0 && Math.abs(diferenca) > 1) { status = 'DIVERGENCIA_VALOR'; divergencias++; }

    var chave = [competencia, r[h.MESSAGE_ID], r[h.ANEXO_HASH], status].join('|');
    if (chavesExistentes[chave]) continue;

    destino.appendRow([new Date(), competencia, 'GMAIL_INDEXACAO', r[h.REMETENTE], r[h.ASSUNTO], r[h.ANEXO_NOME], atendSolic || '', atendBase || '', brutoEsperado || '', valorDocumento || '', tributoRetido || '', liquidoEsperado || '', diferenca || '', status, obs]);
    chavesExistentes[chave] = true;
    novas++;
    analisadas++;
  }

  return { ok: divergencias === 0, analisadas: analisadas, novasLinhas: novas, divergencias: divergencias, valorBrutoPorAtendimento: WMGJ_VALOR_BRUTO_ATENDIMENTO };
}

function montarMapaAtendimentosPorCompetenciaWMGJ_(ss) {
  var mapa = {};
  ['02_PRODUTIVIDADE_MENSAL', '03_PRODUTIVIDADE_MEDICO'].forEach(function(nome) {
    var aba = ss.getSheetByName(nome);
    if (!aba || aba.getLastRow() < 2) return;
    var dados = aba.getDataRange().getValues();
    var h = mapearCabecalhoIngestaoWMGJ_(dados[0]);
    var idxComp = h.COMPETENCIA >= 0 ? h.COMPETENCIA : (h.COMPETENCIA_ASSISTENCIAL >= 0 ? h.COMPETENCIA_ASSISTENCIAL : 0);
    var idxAt = h.ATENDIMENTOS >= 0 ? h.ATENDIMENTOS : (h.REALIZADAS >= 0 ? h.REALIZADAS : -1);
    if (idxAt < 0) return;
    for (var i = 1; i < dados.length; i++) {
      var comp = String(dados[i][idxComp] || '');
      if (!comp) continue;
      mapa[comp] = (mapa[comp] || 0) + (Number(dados[i][idxAt]) || 0);
    }
  });
  return mapa;
}

function extrairAtendimentosSolicitadosNfWMGJ_(texto) {
  texto = String(texto || '').toLowerCase();
  var padroes = [
    /(\d{1,5})\s*(?:atendimentos|consultas|exames|procedimentos)/i,
    /(?:atendimentos|consultas|exames|procedimentos)\s*[:=]?\s*(\d{1,5})/i,
    /produção\s*[:=]?\s*(\d{1,5})/i,
    /producao\s*[:=]?\s*(\d{1,5})/i
  ];
  for (var i = 0; i < padroes.length; i++) {
    var m = texto.match(padroes[i]);
    if (m) return Number(m[1]) || 0;
  }
  return 0;
}

function carregarChavesConferenciaNfWMGJ_(aba) {
  var mapa = {};
  if (!aba || aba.getLastRow() < 2) return mapa;
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    var chave = [dados[i][1], dados[i][4], dados[i][5], dados[i][13]].join('|');
    mapa[chave] = true;
  }
  return mapa;
}

function notificarResumoIngestaoAuditoriaNfWMGJ_(resultado, opcoes) {
  opcoes = opcoes || {};
  var indexacao = resultado.indexacao && resultado.indexacao.estatisticas ? resultado.indexacao.estatisticas : {};
  var auditoria = resultado.auditoria || {};
  var nf = resultado.conferenciaNf || {};
  var deveNotificar = opcoes.notificarSempre === true || Number(indexacao.copiadosParaBruto || 0) > 0 || Number(nf.divergencias || 0) > 0 || Number(auditoria.erros || 0) > 0 || resultado.ok === false;
  if (!deveNotificar) return { ok: true, enviado: false, motivo: 'SEM_NOVIDADE_RELEVANTE' };

  var destinatario = obterEmailOperadorIngestaoWMGJ_();
  if (!destinatario) return { ok: false, enviado: false, motivo: 'EMAIL_OPERADOR_NAO_CONFIGURADO' };

  var assunto = '[WMGJ] Ingestão documental e conferência NF - ' + (resultado.ok ? 'OK/ALERTA' : 'ERRO');
  var corpo = [
    'Rotina WMGJ executada em ' + new Date().toLocaleString(),
    '',
    'Novos anexos copiados para bruto: ' + Number(indexacao.copiadosParaBruto || 0),
    'Anexos pertinentes: ' + Number(indexacao.anexosPertinentes || 0),
    'Erros de indexação: ' + Number(auditoria.erros || 0),
    'Documentos sem competência: ' + Number(auditoria.semCompetencia || 0),
    'Solicitações NF analisadas: ' + Number(nf.analisadas || 0),
    'Divergências NF/atendimentos/valor: ' + Number(nf.divergencias || 0),
    '',
    'Regra de conferência: bruto = número de atendimentos x R$ 90,00. Na emissão da nota, deduzir apenas o tributo retido inicialmente pela Prefeitura de Londrina.',
    '',
    'Detalhes nas abas: 21_GMAIL_INDEXACAO_FATURAMENTO, 33_AUDITORIA_ARQUIVOS_INDEXADOS e 34_CONFERENCIA_SOLICITACOES_NF.',
    '',
    'Resumo técnico:',
    JSON.stringify(resultado, null, 2).slice(0, 12000)
  ].join('\n');

  GmailApp.sendEmail(destinatario, assunto, corpo);
  return { ok: true, enviado: true, destinatario: destinatario };
}

function obterEmailOperadorIngestaoWMGJ_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('WMGJ_OPERADOR_EMAIL') || props.getProperty('OPERADOR_EMAIL') || props.getProperty('JOAO_EMAIL') || '';
}

function mapearCabecalhoIngestaoWMGJ_(headers) {
  var mapa = {};
  headers = headers || [];
  for (var i = 0; i < headers.length; i++) mapa[String(headers[i] || '').trim()] = i;
  ['STATUS','CATEGORIA','COMPETENCIA','COMPETENCIA_ASSISTENCIAL','ARQUIVO_DRIVE_ID','MESSAGE_ID','ANEXO_HASH','ANEXO_NOME','TIPO_DOCUMENTO','JUSTIFICATIVA','REMETENTE','ASSUNTO','VALOR','DATA_EMAIL','ATENDIMENTOS','REALIZADAS'].forEach(function(k) {
    if (typeof mapa[k] === 'undefined') mapa[k] = -1;
  });
  return mapa;
}

function removerGatilhosPorFuncaoIngestaoWMGJ_(funcao) {
  var removidos = [];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === funcao) {
      ScriptApp.deleteTrigger(trigger);
      removidos.push(trigger.getUniqueId ? trigger.getUniqueId() : funcao);
    }
  });
  return removidos;
}

function registrarStatusIngestaoAuditoriaNfWMGJ_(payload) {
  if (typeof registrarStatusAutomacaoWMGJ_ === 'function') return registrarStatusAutomacaoWMGJ_(payload);
  return null;
}

function registrarLogIngestaoAuditoriaNfWMGJ_(status, comando, payload) {
  if (typeof registrarLogWMGJ_ === 'function') return registrarLogWMGJ_(status, comando, 'IngestaoAuditoriaNF', JSON.stringify(payload));
  Logger.log([status, comando, JSON.stringify(payload)].join(' | '));
}

function normalizarErroIngestaoWMGJ_(erro) {
  return erro && erro.message ? erro.message : String(erro);
}
