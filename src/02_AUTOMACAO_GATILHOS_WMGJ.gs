/**
 * WMGJ — Compatibilidade legada de gatilhos Apps Script
 *
 * Este módulo NÃO é mais a camada oficial de automação.
 * A automação oficial foi consolidada em:
 *   06_AUTOMACAO_APPSCRIPT_WMGJ.gs
 *
 * Mantemos estas funções apenas para não quebrar atalhos, menus ou chamadas antigas.
 * Elas delegam para a automação consolidada e evitam criar gatilhos paralelos.
 */

var WMGJ_AUTOMACAO_GATILHOS_LEGADO_VERSAO = 'v1.0.3-legado-delegado-para-06';

function instalarAutomacaoWMGJ() {
  if (typeof instalarGatilhoAutomacaoWMGJ !== 'function') {
    throw new Error('AUTOMACAO_CONSOLIDADA_NAO_CARREGADA: instalarGatilhoAutomacaoWMGJ ausente');
  }

  return instalarGatilhoAutomacaoWMGJ();
}

function removerAutomacaoWMGJ() {
  if (typeof removerGatilhosAutomacaoWMGJ !== 'function') {
    throw new Error('AUTOMACAO_CONSOLIDADA_NAO_CARREGADA: removerGatilhosAutomacaoWMGJ ausente');
  }

  return removerGatilhosAutomacaoWMGJ();
}

function reinstalarAutomacaoWMGJ() {
  removerAutomacaoWMGJ();
  return instalarAutomacaoWMGJ();
}

function listarAutomacaoWMGJ() {
  if (typeof diagnosticarAutomacaoAppsScriptWMGJ === 'function') {
    return diagnosticarAutomacaoAppsScriptWMGJ();
  }

  return {
    ok: true,
    versao: WMGJ_AUTOMACAO_GATILHOS_LEGADO_VERSAO,
    gatilhos: listarGatilhosWMGJ_()
  };
}

function jobPrepararPipelineWMGJ() {
  return executarAutomacaoOperacionalWMGJ_Legado_('jobPrepararPipelineWMGJ');
}

function jobProcessarFilaWMGJ() {
  return executarAutomacaoOperacionalWMGJ_Legado_('jobProcessarFilaWMGJ');
}

function jobTesteSaudeWMGJ() {
  if (typeof auditarOrganizarAppsScriptWMGJ === 'function') {
    return auditarOrganizarAppsScriptWMGJ({ modo: 'JOB_LEGADO_SAUDE' });
  }

  return executarAutomacaoOperacionalWMGJ_Legado_('jobTesteSaudeWMGJ');
}

function jobRelatorioMensalWMGJ() {
  try {
    if (typeof runWMGJ === 'function') {
      runWMGJ();
    }

    registrarLogWMGJ_Legado_('OK', 'jobRelatorioMensalWMGJ', {
      ok: true,
      versao: WMGJ_AUTOMACAO_GATILHOS_LEGADO_VERSAO,
      mensagem: 'Rotina mensal legada executada'
    });

    return {
      ok: true,
      versao: WMGJ_AUTOMACAO_GATILHOS_LEGADO_VERSAO,
      mensagem: 'Rotina mensal executada'
    };
  } catch (erro) {
    var falha = { ok: false, erro: erro && erro.message ? erro.message : String(erro) };
    registrarLogWMGJ_Legado_('ERRO', 'jobRelatorioMensalWMGJ', falha);
    return falha;
  }
}

function executarAutomacaoOperacionalWMGJ_Legado_(origem) {
  try {
    if (typeof executarAutomacaoOperacionalWMGJ !== 'function') {
      throw new Error('AUTOMACAO_CONSOLIDADA_NAO_CARREGADA: executarAutomacaoOperacionalWMGJ ausente');
    }

    var resultado = executarAutomacaoOperacionalWMGJ();
    resultado.origemLegada = origem;
    return resultado;
  } catch (erro) {
    var falha = {
      ok: false,
      versao: WMGJ_AUTOMACAO_GATILHOS_LEGADO_VERSAO,
      origemLegada: origem,
      erro: erro && erro.message ? erro.message : String(erro)
    };
    registrarLogWMGJ_Legado_('ERRO', origem, falha);
    return falha;
  }
}

function atualizarStatusSaudePipelineWMGJ_(resultado) {
  if (typeof registrarStatusAutomacaoWMGJ_ === 'function') {
    registrarStatusAutomacaoWMGJ_({
      ok: !!(resultado && resultado.ok),
      versao: WMGJ_AUTOMACAO_GATILHOS_LEGADO_VERSAO,
      etapa: 'atualizarStatusSaudePipelineWMGJ_legado',
      resultado: resultado,
      registradoEm: new Date().toISOString()
    });
  }
}

function removerGatilhosWMGJ_() {
  if (typeof removerGatilhosAutomacaoWMGJ === 'function') {
    var resultado = removerGatilhosAutomacaoWMGJ();
    return resultado && resultado.removidos ? resultado.removidos.length : 0;
  }

  var nomes = {
    jobPrepararPipelineWMGJ: true,
    jobProcessarFilaWMGJ: true,
    jobTesteSaudeWMGJ: true,
    jobRelatorioMensalWMGJ: true
  };

  var triggers = ScriptApp.getProjectTriggers();
  var removidos = 0;

  triggers.forEach(function(trigger) {
    if (nomes[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
      removidos++;
    }
  });

  return removidos;
}

function listarGatilhosWMGJ_() {
  return ScriptApp.getProjectTriggers().map(function(trigger) {
    return {
      funcao: trigger.getHandlerFunction(),
      origem: String(trigger.getEventType()),
      fonte: String(trigger.getTriggerSource()),
      triggerId: trigger.getUniqueId ? trigger.getUniqueId() : ''
    };
  });
}

function registrarLogWMGJ_Legado_(status, comando, payload) {
  if (typeof registrarLogWMGJ_ === 'function') {
    registrarLogWMGJ_(status, comando, 'AppsScript', JSON.stringify(payload));
  } else {
    Logger.log(JSON.stringify({ status: status, comando: comando, payload: payload }));
  }
}
