/**
 * WMGJ — Trava de concorrência + Watchdog operacional
 * Versão: v1.2.2-trava-concorrencia-watchdog
 *
 * Objetivo:
 * - impedir execuções simultâneas do ciclo automático;
 * - criar wrapper blindado para os gatilhos;
 * - registrar início, heartbeat, fim, bloqueio e falha;
 * - detectar execução travada ou antiga demais;
 * - limpar estado lógico travado sem mexer na V3 estável.
 *
 * Cole este arquivo inteiro em: 13_TRAVA_CONCORRENCIA_WATCHDOG_WMGJ
 */

var WMGJ_TRAVA_WATCHDOG_VERSAO = 'v1.2.2-trava-concorrencia-watchdog';
var WMGJ_LOCK_TIMEOUT_MS = 5000;
var WMGJ_EXECUCAO_MAX_MINUTOS_PADRAO = 45;

function executarAutomacaoWMGJBlindada() {
  return executarComTravaConcorrenciaWMGJ_('CICLO_COMPLETO_PRODUCAO', function() {
    if (typeof rodarCicloCompletoGmailFiscalFinanceiroWMGJ !== 'function') {
      return { ok: false, erro: 'ORQUESTRADOR_COMPLETO_NAO_ENCONTRADO' };
    }
    return rodarCicloCompletoGmailFiscalFinanceiroWMGJ();
  }, WMGJ_EXECUCAO_MAX_MINUTOS_PADRAO);
}

function executarAutomacaoWMGJBlindada_Teste20() {
  return executarComTravaConcorrenciaWMGJ_('CICLO_TESTE20_SEGURO', function() {
    if (typeof rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20 !== 'function') {
      return { ok: false, erro: 'ORQUESTRADOR_TESTE20_NAO_ENCONTRADO' };
    }
    return rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20();
  }, 30);
}

function diagnosticarTravaWatchdogWMGJ() {
  var props = PropertiesService.getScriptProperties();
  var ss = getPlanilhaWMGJ_Watchdog_();
  var aba = garantirAbaWatchdogWMGJ_(ss);

  var estado = obterEstadoExecucaoWMGJ_();
  var triggers = ScriptApp.getProjectTriggers().map(function(t) {
    return {
      funcao: t.getHandlerFunction(),
      origemEvento: String(t.getEventType()),
      idUnico: t.getUniqueId ? t.getUniqueId() : ''
    };
  });

  var resultado = {
    ok: true,
    versao: WMGJ_TRAVA_WATCHDOG_VERSAO,
    abaControle: '25_TRAVA_WATCHDOG',
    estadoExecucao: estado,
    funcoesBase: {
      cicloCompleto: typeof rodarCicloCompletoGmailFiscalFinanceiroWMGJ === 'function',
      cicloTeste20: typeof rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20 === 'function',
      wrapperProducao: typeof executarAutomacaoWMGJBlindada === 'function',
      wrapperTeste20: typeof executarAutomacaoWMGJBlindada_Teste20 === 'function'
    },
    triggersAtivos: triggers,
    quantidadeTriggers: triggers.length,
    ultimaExecucaoId: props.getProperty('WMGJ_ULTIMA_EXECUCAO_ID') || '',
    ultimaExecucaoStatus: props.getProperty('WMGJ_ULTIMA_EXECUCAO_STATUS') || ''
  };

  registrarWatchdogWMGJ_(aba, 'DIAGNOSTICO', 'OK', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function instalarAutomacaoBlindadaWMGJModoSeguro() {
  removerAutomacaoBlindadaWMGJ();

  var ss = getPlanilhaWMGJ_Watchdog_();
  var aba = garantirAbaWatchdogWMGJ_(ss);
  var triggers = [];

  triggers.push(criarTriggerDiarioWatchdogWMGJ_('executarAutomacaoWMGJBlindada_Teste20', 8, 10));
  triggers.push(criarTriggerWatchdogHorarioWMGJ_());

  var resultado = {
    ok: true,
    versao: WMGJ_TRAVA_WATCHDOG_VERSAO,
    modo: 'SEGURO',
    gatilhos: triggers,
    funcaoCiclo: 'executarAutomacaoWMGJBlindada_Teste20',
    funcaoWatchdog: 'rodarWatchdogWMGJ'
  };

  registrarWatchdogWMGJ_(aba, 'INSTALAR_MODO_SEGURO', 'OK', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function instalarAutomacaoBlindadaWMGJProducao() {
  removerAutomacaoBlindadaWMGJ();

  var ss = getPlanilhaWMGJ_Watchdog_();
  var aba = garantirAbaWatchdogWMGJ_(ss);
  var triggers = [];

  triggers.push(criarTriggerDiarioWatchdogWMGJ_('executarAutomacaoWMGJBlindada', 7, 35));
  triggers.push(criarTriggerDiarioWatchdogWMGJ_('executarAutomacaoWMGJBlindada', 18, 35));
  triggers.push(criarTriggerWatchdogHorarioWMGJ_());

  var resultado = {
    ok: true,
    versao: WMGJ_TRAVA_WATCHDOG_VERSAO,
    modo: 'PRODUCAO',
    gatilhos: triggers,
    funcaoCiclo: 'executarAutomacaoWMGJBlindada',
    funcaoWatchdog: 'rodarWatchdogWMGJ'
  };

  registrarWatchdogWMGJ_(aba, 'INSTALAR_PRODUCAO', 'OK', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function removerAutomacaoBlindadaWMGJ() {
  var removidos = removerTriggersWatchdogWMGJ_([
    'executarAutomacaoWMGJBlindada',
    'executarAutomacaoWMGJBlindada_Teste20',
    'rodarWatchdogWMGJ'
  ]);

  var ss = getPlanilhaWMGJ_Watchdog_();
  var aba = garantirAbaWatchdogWMGJ_(ss);

  var resultado = {
    ok: true,
    versao: WMGJ_TRAVA_WATCHDOG_VERSAO,
    removidos: removidos
  };

  registrarWatchdogWMGJ_(aba, 'REMOVER_AUTOMACAO_BLINDADA', 'OK', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function rodarWatchdogWMGJ() {
  var ss = getPlanilhaWMGJ_Watchdog_();
  var aba = garantirAbaWatchdogWMGJ_(ss);
  var props = PropertiesService.getScriptProperties();
  var estado = obterEstadoExecucaoWMGJ_();

  var agora = new Date();
  var maxMinutos = Number(props.getProperty('WMGJ_EXECUCAO_MAX_MINUTOS') || WMGJ_EXECUCAO_MAX_MINUTOS_PADRAO);
  var status = 'OK';
  var acao = 'WATCHDOG_OK';
  var mensagem = {
    ok: true,
    versao: WMGJ_TRAVA_WATCHDOG_VERSAO,
    estado: estado,
    limiteMinutos: maxMinutos
  };

  if (estado.emExecucao) {
    var inicio = estado.inicioIso ? new Date(estado.inicioIso) : null;
    var idadeMin = inicio ? Math.round((agora.getTime() - inicio.getTime()) / 60000) : 9999;

    mensagem.idadeMinutos = idadeMin;

    if (idadeMin > maxMinutos) {
      status = 'ALERTA';
      acao = 'WATCHDOG_EXECUCAO_TRAVADA';
      mensagem.ok = false;
      mensagem.alerta = 'Execucao marcada como ativa ha tempo superior ao limite. Limpando estado logico.';
      limparEstadoExecucaoWMGJ_('WATCHDOG_TIMEOUT_' + idadeMin + '_MIN');
    }
  }

  registrarWatchdogWMGJ_(aba, acao, status, JSON.stringify(mensagem));
  Logger.log(JSON.stringify(mensagem, null, 2));
  return mensagem;
}

function executarComTravaConcorrenciaWMGJ_(nomeCiclo, fn, maxMinutos) {
  var ss = getPlanilhaWMGJ_Watchdog_();
  var aba = garantirAbaWatchdogWMGJ_(ss);
  var lock = LockService.getScriptLock();
  var execucaoId = montarIdExecucaoWatchdogWMGJ_(nomeCiclo);

  if (!lock.tryLock(WMGJ_LOCK_TIMEOUT_MS)) {
    var bloqueado = {
      ok: false,
      versao: WMGJ_TRAVA_WATCHDOG_VERSAO,
      execucaoId: execucaoId,
      ciclo: nomeCiclo,
      status: 'BLOQUEADO_CONCORRENCIA',
      motivo: 'Outra execucao esta em andamento ou o lock ainda nao foi liberado.',
      estadoAtual: obterEstadoExecucaoWMGJ_()
    };

    registrarWatchdogWMGJ_(aba, 'BLOQUEADO_CONCORRENCIA', 'ALERTA', JSON.stringify(bloqueado));
    Logger.log(JSON.stringify(bloqueado, null, 2));
    return bloqueado;
  }

  try {
    marcarInicioExecucaoWMGJ_(execucaoId, nomeCiclo, maxMinutos || WMGJ_EXECUCAO_MAX_MINUTOS_PADRAO);
    registrarWatchdogWMGJ_(aba, 'INICIO_EXECUCAO_BLINDADA', 'OK', JSON.stringify(obterEstadoExecucaoWMGJ_()));

    atualizarHeartbeatWMGJ_('ANTES_CICLO');
    var resultado = fn();
    atualizarHeartbeatWMGJ_('DEPOIS_CICLO');

    var ok = resultado && resultado.ok !== false;
    marcarFimExecucaoWMGJ_(execucaoId, ok ? 'OK' : 'ALERTA');

    var saida = {
      ok: ok,
      versao: WMGJ_TRAVA_WATCHDOG_VERSAO,
      execucaoId: execucaoId,
      ciclo: nomeCiclo,
      resultado: resultado
    };

    registrarWatchdogWMGJ_(aba, 'FIM_EXECUCAO_BLINDADA', ok ? 'OK' : 'ALERTA', JSON.stringify(saida));
    return saida;
  } catch (erro) {
    marcarFimExecucaoWMGJ_(execucaoId, 'ERRO');

    var falha = {
      ok: false,
      versao: WMGJ_TRAVA_WATCHDOG_VERSAO,
      execucaoId: execucaoId,
      ciclo: nomeCiclo,
      erro: erro && erro.message ? erro.message : String(erro)
    };

    registrarWatchdogWMGJ_(aba, 'ERRO_EXECUCAO_BLINDADA', 'ERRO', JSON.stringify(falha));
    Logger.log(JSON.stringify(falha, null, 2));
    return falha;
  } finally {
    limparEstadoExecucaoSeMesmoIdWMGJ_(execucaoId);
    try { lock.releaseLock(); } catch (erroLock) {}
  }
}

function marcarInicioExecucaoWMGJ_(execucaoId, nomeCiclo, maxMinutos) {
  var props = PropertiesService.getScriptProperties();
  var agora = new Date().toISOString();
  props.setProperty('WMGJ_EXECUCAO_EM_ANDAMENTO', 'SIM');
  props.setProperty('WMGJ_EXECUCAO_ID', execucaoId);
  props.setProperty('WMGJ_EXECUCAO_CICLO', nomeCiclo);
  props.setProperty('WMGJ_EXECUCAO_INICIO_ISO', agora);
  props.setProperty('WMGJ_EXECUCAO_HEARTBEAT_ISO', agora);
  props.setProperty('WMGJ_EXECUCAO_HEARTBEAT_ETAPA', 'INICIO');
  props.setProperty('WMGJ_EXECUCAO_MAX_MINUTOS', String(maxMinutos || WMGJ_EXECUCAO_MAX_MINUTOS_PADRAO));
  props.setProperty('WMGJ_ULTIMA_EXECUCAO_ID', execucaoId);
  props.setProperty('WMGJ_ULTIMA_EXECUCAO_STATUS', 'EM_ANDAMENTO');
}

function atualizarHeartbeatWMGJ_(etapa) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('WMGJ_EXECUCAO_HEARTBEAT_ISO', new Date().toISOString());
  props.setProperty('WMGJ_EXECUCAO_HEARTBEAT_ETAPA', String(etapa || 'HEARTBEAT'));
}

function marcarFimExecucaoWMGJ_(execucaoId, status) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('WMGJ_ULTIMA_EXECUCAO_ID', execucaoId);
  props.setProperty('WMGJ_ULTIMA_EXECUCAO_STATUS', status || 'OK');
  props.setProperty('WMGJ_ULTIMA_EXECUCAO_FIM_ISO', new Date().toISOString());
}

function limparEstadoExecucaoSeMesmoIdWMGJ_(execucaoId) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('WMGJ_EXECUCAO_ID') === execucaoId) {
    limparEstadoExecucaoWMGJ_('FIM_NORMAL');
  }
}

function limparEstadoExecucaoWMGJ_(motivo) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('WMGJ_EXECUCAO_LIMPEZA_MOTIVO', String(motivo || 'LIMPEZA_MANUAL'));
  props.setProperty('WMGJ_EXECUCAO_LIMPEZA_ISO', new Date().toISOString());
  props.deleteProperty('WMGJ_EXECUCAO_EM_ANDAMENTO');
  props.deleteProperty('WMGJ_EXECUCAO_ID');
  props.deleteProperty('WMGJ_EXECUCAO_CICLO');
  props.deleteProperty('WMGJ_EXECUCAO_INICIO_ISO');
  props.deleteProperty('WMGJ_EXECUCAO_HEARTBEAT_ISO');
  props.deleteProperty('WMGJ_EXECUCAO_HEARTBEAT_ETAPA');
}

function obterEstadoExecucaoWMGJ_() {
  var props = PropertiesService.getScriptProperties();
  return {
    emExecucao: props.getProperty('WMGJ_EXECUCAO_EM_ANDAMENTO') === 'SIM',
    execucaoId: props.getProperty('WMGJ_EXECUCAO_ID') || '',
    ciclo: props.getProperty('WMGJ_EXECUCAO_CICLO') || '',
    inicioIso: props.getProperty('WMGJ_EXECUCAO_INICIO_ISO') || '',
    heartbeatIso: props.getProperty('WMGJ_EXECUCAO_HEARTBEAT_ISO') || '',
    heartbeatEtapa: props.getProperty('WMGJ_EXECUCAO_HEARTBEAT_ETAPA') || '',
    maxMinutos: Number(props.getProperty('WMGJ_EXECUCAO_MAX_MINUTOS') || WMGJ_EXECUCAO_MAX_MINUTOS_PADRAO),
    ultimaLimpezaMotivo: props.getProperty('WMGJ_EXECUCAO_LIMPEZA_MOTIVO') || '',
    ultimaLimpezaIso: props.getProperty('WMGJ_EXECUCAO_LIMPEZA_ISO') || ''
  };
}

function criarTriggerDiarioWatchdogWMGJ_(funcao, hora, minuto) {
  var builder = ScriptApp.newTrigger(funcao).timeBased().everyDays(1).atHour(Number(hora || 8));
  if (typeof builder.nearMinute === 'function') builder = builder.nearMinute(Number(minuto || 0));
  var trigger = builder.create();
  return {
    funcao: funcao,
    tipo: 'DIARIO',
    hora: hora,
    minuto: minuto,
    triggerId: trigger.getUniqueId ? trigger.getUniqueId() : ''
  };
}

function criarTriggerWatchdogHorarioWMGJ_() {
  var trigger = ScriptApp.newTrigger('rodarWatchdogWMGJ').timeBased().everyHours(1).create();
  return {
    funcao: 'rodarWatchdogWMGJ',
    tipo: 'HORARIO',
    frequencia: 'A_CADA_1_HORA',
    triggerId: trigger.getUniqueId ? trigger.getUniqueId() : ''
  };
}

function removerTriggersWatchdogWMGJ_(funcoes) {
  var alvo = {};
  (funcoes || []).forEach(function(f) { alvo[f] = true; });

  var triggers = ScriptApp.getProjectTriggers();
  var removidos = [];

  triggers.forEach(function(t) {
    var funcao = t.getHandlerFunction();
    if (alvo[funcao]) {
      ScriptApp.deleteTrigger(t);
      removidos.push({
        funcao: funcao,
        triggerId: t.getUniqueId ? t.getUniqueId() : ''
      });
    }
  });

  return removidos;
}

function garantirAbaWatchdogWMGJ_(ss) {
  var nome = '25_TRAVA_WATCHDOG';
  var sheet = ss.getSheetByName(nome);
  var cabecalho = [
    'DATA_EVENTO', 'VERSAO', 'ACAO', 'STATUS', 'MENSAGEM_JSON'
  ];

  if (!sheet) sheet = ss.insertSheet(nome);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  aplicarFormatacaoWatchdogWMGJ_(sheet);
  return sheet;
}

function registrarWatchdogWMGJ_(sheet, acao, status, mensagemJson) {
  sheet.appendRow([
    new Date(),
    WMGJ_TRAVA_WATCHDOG_VERSAO,
    acao,
    status,
    mensagemJson || ''
  ]);
}

function aplicarFormatacaoWatchdogWMGJ_(sheet) {
  if (!sheet) return;
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('top').setWrap(true);
  sheet.autoResizeColumns(1, Math.min(lastCol, 4));
  sheet.setColumnWidth(5, 800);
}

function montarIdExecucaoWatchdogWMGJ_(nomeCiclo) {
  var limpo = String(nomeCiclo || 'CICLO').replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
  return limpo + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
}

function getPlanilhaWMGJ_Watchdog_() {
  if (typeof getPlanilhaWMGJ_Automacao_ === 'function') {
    try {
      var aut = getPlanilhaWMGJ_Automacao_();
      if (aut) return aut;
    } catch (erroAut) {}
  }

  if (typeof getPlanilhaWMGJ_Orquestrador_ === 'function') {
    try {
      var orq = getPlanilhaWMGJ_Orquestrador_();
      if (orq) return orq;
    } catch (erroOrq) {}
  }

  if (typeof getPlanilhaWMGJ_NF_ === 'function') {
    try {
      var nf = getPlanilhaWMGJ_NF_();
      if (nf) return nf;
    } catch (erroNF) {}
  }

  if (typeof getPlanilhaWMGJ_Gmail_ === 'function') {
    try {
      var gmail = getPlanilhaWMGJ_Gmail_();
      if (gmail) return gmail;
    } catch (erroGmail) {}
  }

  if (typeof getPlanilhaWMGJ_Compat_ === 'function') {
    try {
      var compat = getPlanilhaWMGJ_Compat_();
      if (compat) return compat;
    } catch (erroCompat) {}
  }

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WMGJ_SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);

  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (!ativa) throw new Error('PLANILHA_NAO_ENCONTRADA');
  return ativa;
}
