/**
 * WMGJ — Automação sem execução humana por gatilhos Apps Script
 * Versão: v1.2.1-automacao-sem-execucao-humana
 *
 * Objetivo:
 * - instalar gatilhos automáticos do Apps Script;
 * - executar o ciclo central em horários definidos;
 * - manter logs de instalação, auditoria e remoção;
 * - evitar gatilhos duplicados;
 * - preservar a V3 estável e o orquestrador v1.2.0.
 *
 * Cole este arquivo inteiro em: 12_AUTOMACAO_SEM_EXECUCAO_HUMANA_WMGJ
 */

var WMGJ_AUTOMACAO_SEM_HUMANO_VERSAO = 'v1.2.1-automacao-sem-execucao-humana';

function instalarAutomacaoWMGJSemExecucaoHumana() {
  return configurarAutomacaoWMGJ({
    limparAntes: true,
    ciclos: [
      {
        nome: 'CICLO_MANHA_GMAIL_FISCAL_FINANCEIRO',
        funcao: 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20',
        hora: 7,
        minuto: 15,
        tipo: 'DIARIO'
      },
      {
        nome: 'CICLO_MEIO_DIA_GMAIL_FISCAL_FINANCEIRO',
        funcao: 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20',
        hora: 12,
        minuto: 15,
        tipo: 'DIARIO'
      },
      {
        nome: 'CICLO_FIM_DIA_GMAIL_FISCAL_FINANCEIRO',
        funcao: 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ',
        hora: 18,
        minuto: 30,
        tipo: 'DIARIO'
      }
    ]
  });
}

function instalarAutomacaoWMGJModoSeguro() {
  return configurarAutomacaoWMGJ({
    limparAntes: true,
    ciclos: [
      {
        nome: 'CICLO_DIARIO_SEGURO_WMGJ',
        funcao: 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20',
        hora: 8,
        minuto: 0,
        tipo: 'DIARIO'
      }
    ]
  });
}

function instalarAutomacaoWMGJCompletaProducao() {
  return configurarAutomacaoWMGJ({
    limparAntes: true,
    ciclos: [
      {
        nome: 'CICLO_PRODUCAO_MANHA_WMGJ',
        funcao: 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ',
        hora: 7,
        minuto: 30,
        tipo: 'DIARIO'
      },
      {
        nome: 'CICLO_PRODUCAO_FIM_DIA_WMGJ',
        funcao: 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ',
        hora: 18,
        minuto: 30,
        tipo: 'DIARIO'
      }
    ]
  });
}

function removerAutomacaoWMGJSemExecucaoHumana() {
  var ss = getPlanilhaWMGJ_Automacao_();
  var aba = garantirAbaAutomacaoWMGJ_(ss);
  var removidos = removerTriggersWMGJ_([
    'rodarCicloCompletoGmailFiscalFinanceiroWMGJ',
    'rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20',
    'executarAutomacaoWMGJBlindada'
  ]);

  var resultado = {
    ok: true,
    versao: WMGJ_AUTOMACAO_SEM_HUMANO_VERSAO,
    removidos: removidos
  };

  registrarAutomacaoWMGJ_(aba, 'REMOVER_AUTOMACAO', 'OK', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function diagnosticarAutomacaoWMGJSemExecucaoHumana() {
  var triggers = ScriptApp.getProjectTriggers().map(function(t) {
    return {
      funcao: t.getHandlerFunction(),
      origemEvento: String(t.getEventType()),
      idUnico: t.getUniqueId ? t.getUniqueId() : ''
    };
  });

  var resultado = {
    ok: true,
    versao: WMGJ_AUTOMACAO_SEM_HUMANO_VERSAO,
    funcoesBase: {
      orquestrador: typeof rodarCicloCompletoGmailFiscalFinanceiroWMGJ === 'function',
      orquestradorTeste: typeof rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20 === 'function',
      diagnosticoOrquestrador: typeof diagnosticarOrquestradorGmailFiscalFinanceiroWMGJ === 'function'
    },
    triggersAtivos: triggers,
    quantidadeTriggers: triggers.length,
    abaControle: '24_AUTOMACAO_GATILHOS'
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function configurarAutomacaoWMGJ(config) {
  config = config || {};
  var ss = getPlanilhaWMGJ_Automacao_();
  var aba = garantirAbaAutomacaoWMGJ_(ss);

  if (!config.ciclos || !config.ciclos.length) {
    throw new Error('CONFIG_SEM_CICLOS');
  }

  if (config.limparAntes !== false) {
    removerTriggersWMGJ_(config.ciclos.map(function(c) { return c.funcao; }));
  }

  var instalados = [];
  var erros = [];

  config.ciclos.forEach(function(ciclo) {
    try {
      if (typeof this[ciclo.funcao] !== 'function') {
        throw new Error('FUNCAO_NAO_EXISTE: ' + ciclo.funcao);
      }

      var trigger = criarTriggerDiarioWMGJ_(ciclo.funcao, ciclo.hora, ciclo.minuto);
      var item = {
        nome: ciclo.nome,
        funcao: ciclo.funcao,
        hora: ciclo.hora,
        minuto: ciclo.minuto,
        tipo: ciclo.tipo || 'DIARIO',
        triggerId: trigger.getUniqueId ? trigger.getUniqueId() : ''
      };

      instalados.push(item);
      registrarAutomacaoWMGJ_(aba, 'INSTALAR_TRIGGER', 'OK', JSON.stringify(item));
    } catch (erro) {
      var falha = {
        ciclo: ciclo,
        erro: erro && erro.message ? erro.message : String(erro)
      };
      erros.push(falha);
      registrarAutomacaoWMGJ_(aba, 'INSTALAR_TRIGGER', 'ERRO', JSON.stringify(falha));
    }
  });

  aplicarFormatacaoAutomacaoWMGJ_(aba);

  var resultado = {
    ok: erros.length === 0,
    versao: WMGJ_AUTOMACAO_SEM_HUMANO_VERSAO,
    instalados: instalados,
    erros: erros,
    proximaChecagem: 'diagnosticarAutomacaoWMGJSemExecucaoHumana'
  };

  registrarAutomacaoWMGJ_(aba, 'CONFIGURAR_AUTOMACAO', resultado.ok ? 'OK' : 'ERRO', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function criarTriggerDiarioWMGJ_(funcao, hora, minuto) {
  var builder = ScriptApp.newTrigger(funcao).timeBased().everyDays(1).atHour(Number(hora || 8));

  // Apps Script não garante minuto exato em todos os ambientes.
  // nearMinute orienta a janela de execução e reduz variação, quando aceito.
  if (typeof builder.nearMinute === 'function') {
    builder = builder.nearMinute(Number(minuto || 0));
  }

  return builder.create();
}

function removerTriggersWMGJ_(funcoes) {
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

function garantirAbaAutomacaoWMGJ_(ss) {
  var nome = '24_AUTOMACAO_GATILHOS';
  var sheet = ss.getSheetByName(nome);
  var cabecalho = [
    'DATA_EVENTO', 'VERSAO', 'ACAO', 'STATUS', 'MENSAGEM_JSON'
  ];

  if (!sheet) sheet = ss.insertSheet(nome);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }

  return sheet;
}

function registrarAutomacaoWMGJ_(sheet, acao, status, mensagemJson) {
  sheet.appendRow([
    new Date(),
    WMGJ_AUTOMACAO_SEM_HUMANO_VERSAO,
    acao,
    status,
    mensagemJson || ''
  ]);
}

function aplicarFormatacaoAutomacaoWMGJ_(sheet) {
  if (!sheet) return;

  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);

  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('top').setWrap(true);
  sheet.autoResizeColumns(1, Math.min(lastCol, 4));
  sheet.setColumnWidth(5, 760);
}

function getPlanilhaWMGJ_Automacao_() {
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

  if (typeof getPlanilhaWMGJ_Relatorio_ === 'function') {
    try {
      var rel = getPlanilhaWMGJ_Relatorio_();
      if (rel) return rel;
    } catch (erroRel) {}
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
