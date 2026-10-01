/**
 * WMGJ — Orquestrador Gmail + Fiscal + Financeiro + Relatório
 * Versão: v1.2.0-orquestrador-gmail-fiscal-financeiro
 *
 * Objetivo:
 * - encadear a busca ampla do Gmail;
 * - copiar anexos pertinentes para 99_ARQUIVO_BRUTO_A_CLASSIFICAR;
 * - processar XMLs fiscais;
 * - acionar pipeline documental/financeiro já existente;
 * - consolidar relatório executivo para sócios;
 * - registrar status central em 23_CONTROLE_CICLOS_AUTOMATICOS.
 *
 * Cole este arquivo inteiro em: 11_ORQUESTRADOR_GMAIL_FISCAL_FINANCEIRO_WMGJ
 */

var WMGJ_ORQUESTRADOR_GMAIL_FISCAL_VERSAO = 'v1.2.0-orquestrador-gmail-fiscal-financeiro';

function rodarCicloCompletoGmailFiscalFinanceiroWMGJ() {
  return executarCicloCompletoGmailFiscalFinanceiroWMGJ({
    limiteGmailThreads: 50,
    limiteXml: 100,
    executarGmail: true,
    executarXml: true,
    executarPipelineDocumental: true,
    executarRelatorioSocios: true
  });
}

function rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20() {
  return executarCicloCompletoGmailFiscalFinanceiroWMGJ({
    limiteGmailThreads: 20,
    limiteXml: 20,
    executarGmail: true,
    executarXml: true,
    executarPipelineDocumental: true,
    executarRelatorioSocios: false
  });
}

function rodarCicloFiscalFinanceiroSemGmailWMGJ() {
  return executarCicloCompletoGmailFiscalFinanceiroWMGJ({
    limiteGmailThreads: 0,
    limiteXml: 100,
    executarGmail: false,
    executarXml: true,
    executarPipelineDocumental: true,
    executarRelatorioSocios: true
  });
}

function diagnosticarOrquestradorGmailFiscalFinanceiroWMGJ() {
  var resultado = {
    ok: true,
    versao: WMGJ_ORQUESTRADOR_GMAIL_FISCAL_VERSAO,
    funcoes: {
      gmailAmplo: typeof indexarGmailFaturamentoWMGJ_V2 === 'function',
      parserXml: typeof processarNotasFiscaisXmlWMGJ === 'function',
      pipelineFinanceiroDocumental: typeof executarCicloFinanceiroDocumentalWMGJ === 'function' || typeof rodarCicloFinanceiroDocumentalWMGJ === 'function' || typeof executarExtracaoRealWMGJ_V1 === 'function',
      relatorioSocios: typeof gerarRelatorioExecutivoSociosWMGJ === 'function' || typeof rodarRelatorioExecutivoSociosWMGJ === 'function'
    },
    abasPrevistas: [
      '21_GMAIL_INDEXACAO_FATURAMENTO',
      '22_NOTAS_FISCAIS_EXTRAIDAS',
      '23_CONTROLE_CICLOS_AUTOMATICOS'
    ],
    proximaFuncao: 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20'
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function executarCicloCompletoGmailFiscalFinanceiroWMGJ(opcoes) {
  opcoes = opcoes || {};

  var inicio = new Date();
  var ss = getPlanilhaWMGJ_Orquestrador_();
  var abaControle = garantirAbaControleCiclosWMGJ_(ss);
  var cicloId = montarIdCicloWMGJ_(inicio);

  var resultado = {
    ok: true,
    versao: WMGJ_ORQUESTRADOR_GMAIL_FISCAL_VERSAO,
    cicloId: cicloId,
    inicio: inicio,
    fim: null,
    etapas: {
      gmail: null,
      notasFiscaisXml: null,
      pipelineDocumentalFinanceiro: null,
      relatorioSocios: null
    },
    erros: []
  };

  registrarEventoCicloWMGJ_(abaControle, cicloId, 'INICIO', 'executarCicloCompletoGmailFiscalFinanceiroWMGJ', 'OK', JSON.stringify(opcoes));

  if (opcoes.executarGmail !== false) {
    resultado.etapas.gmail = executarEtapaSeguraWMGJ_(abaControle, cicloId, 'GMAIL_BUSCA_AMPLA', function() {
      return chamarIndexacaoGmailAmplaWMGJ_(opcoes);
    });
  }

  if (opcoes.executarXml !== false) {
    resultado.etapas.notasFiscaisXml = executarEtapaSeguraWMGJ_(abaControle, cicloId, 'PARSER_NOTAS_FISCAIS_XML', function() {
      return chamarParserNotasFiscaisXmlWMGJ_(opcoes);
    });
  }

  if (opcoes.executarPipelineDocumental !== false) {
    resultado.etapas.pipelineDocumentalFinanceiro = executarEtapaSeguraWMGJ_(abaControle, cicloId, 'PIPELINE_DOCUMENTAL_FINANCEIRO', function() {
      return chamarPipelineDocumentalFinanceiroWMGJ_(opcoes);
    });
  }

  if (opcoes.executarRelatorioSocios !== false) {
    resultado.etapas.relatorioSocios = executarEtapaSeguraWMGJ_(abaControle, cicloId, 'RELATORIO_EXECUTIVO_SOCIOS', function() {
      return chamarRelatorioExecutivoSociosWMGJ_(opcoes);
    });
  }

  Object.keys(resultado.etapas).forEach(function(k) {
    var etapa = resultado.etapas[k];
    if (etapa && etapa.ok === false) {
      resultado.ok = false;
      resultado.erros.push({ etapa: k, erro: etapa.erro || etapa.resultado });
    }
  });

  resultado.fim = new Date();
  resultado.duracaoSegundos = Math.round((resultado.fim.getTime() - inicio.getTime()) / 1000);

  registrarEventoCicloWMGJ_(abaControle, cicloId, 'FIM', 'executarCicloCompletoGmailFiscalFinanceiroWMGJ', resultado.ok ? 'OK' : 'ERRO', JSON.stringify(resultado));
  aplicarFormatacaoControleCiclosWMGJ_(abaControle);

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function executarEtapaSeguraWMGJ_(abaControle, cicloId, nomeEtapa, fn) {
  var inicio = new Date();
  registrarEventoCicloWMGJ_(abaControle, cicloId, nomeEtapa, 'INICIO', 'OK', '');

  try {
    var retorno = fn();
    var fim = new Date();
    var etapa = {
      ok: retorno && retorno.ok !== false,
      etapa: nomeEtapa,
      inicio: inicio,
      fim: fim,
      duracaoSegundos: Math.round((fim.getTime() - inicio.getTime()) / 1000),
      resultado: retorno
    };

    registrarEventoCicloWMGJ_(abaControle, cicloId, nomeEtapa, 'FIM', etapa.ok ? 'OK' : 'ALERTA', JSON.stringify(retorno));
    return etapa;
  } catch (erro) {
    var falha = {
      ok: false,
      etapa: nomeEtapa,
      inicio: inicio,
      fim: new Date(),
      erro: erro && erro.message ? erro.message : String(erro)
    };

    registrarEventoCicloWMGJ_(abaControle, cicloId, nomeEtapa, 'ERRO', 'ERRO', JSON.stringify(falha));
    return falha;
  }
}

function chamarIndexacaoGmailAmplaWMGJ_(opcoes) {
  if (typeof indexarGmailFaturamentoWMGJ_V2 === 'function') {
    return indexarGmailFaturamentoWMGJ_V2({
      limiteThreadsTotal: Number(opcoes.limiteGmailThreads || 50),
      limiteThreadsPorQuery: Number(opcoes.limiteThreadsPorQuery || 15),
      dias: Number(opcoes.diasGmail || 730),
      executarPipelineDepois: false,
      incluirBuscaBruta: true
    });
  }

  if (typeof rodarIndexacaoGmailFaturamentoWMGJ_Ampla_50 === 'function') {
    return rodarIndexacaoGmailFaturamentoWMGJ_Ampla_50();
  }

  return { ok: false, erro: 'INDEXADOR_GMAIL_AMPLA_NAO_ENCONTRADO' };
}

function chamarParserNotasFiscaisXmlWMGJ_(opcoes) {
  if (typeof processarNotasFiscaisXmlWMGJ === 'function') {
    return processarNotasFiscaisXmlWMGJ({
      limiteArquivos: Number(opcoes.limiteXml || 100)
    });
  }

  if (typeof rodarParserNotasFiscaisXmlWMGJ_100 === 'function') {
    return rodarParserNotasFiscaisXmlWMGJ_100();
  }

  return { ok: false, erro: 'PARSER_NOTAS_FISCAIS_XML_NAO_ENCONTRADO' };
}

function chamarPipelineDocumentalFinanceiroWMGJ_(opcoes) {
  if (typeof executarCicloFinanceiroDocumentalWMGJ === 'function') {
    return executarCicloFinanceiroDocumentalWMGJ({
      limiteExtracao: Number(opcoes.limiteExtracao || 20),
      limiteFormatacao: Number(opcoes.limiteFormatacao || 40),
      limiteParser: Number(opcoes.limiteParser || 40)
    });
  }

  if (typeof rodarCicloFinanceiroDocumentalWMGJ === 'function') {
    return rodarCicloFinanceiroDocumentalWMGJ();
  }

  if (typeof executarExtracaoRealWMGJ_V1 === 'function') {
    return executarExtracaoRealWMGJ_V1(Number(opcoes.limiteExtracao || 20));
  }

  return { ok: false, erro: 'PIPELINE_DOCUMENTAL_FINANCEIRO_NAO_ENCONTRADO' };
}

function chamarRelatorioExecutivoSociosWMGJ_(opcoes) {
  if (typeof gerarRelatorioExecutivoSociosWMGJ === 'function') {
    return gerarRelatorioExecutivoSociosWMGJ({
      competencia: String(opcoes.competencia || ''),
      incluirLancamentos: true,
      limiteLancamentos: Number(opcoes.limiteLancamentosRelatorio || 50)
    });
  }

  if (typeof rodarRelatorioExecutivoSociosWMGJ === 'function') {
    return rodarRelatorioExecutivoSociosWMGJ();
  }

  return { ok: false, erro: 'RELATORIO_EXECUTIVO_SOCIOS_NAO_ENCONTRADO' };
}

function garantirAbaControleCiclosWMGJ_(ss) {
  var nome = '23_CONTROLE_CICLOS_AUTOMATICOS';
  var sheet = ss.getSheetByName(nome);
  var cabecalho = [
    'DATA_EVENTO', 'VERSAO', 'CICLO_ID', 'ETAPA', 'ACAO', 'STATUS', 'MENSAGEM_JSON'
  ];

  if (!sheet) sheet = ss.insertSheet(nome);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }

  return sheet;
}

function registrarEventoCicloWMGJ_(sheet, cicloId, etapa, acao, status, mensagemJson) {
  sheet.appendRow([
    new Date(),
    WMGJ_ORQUESTRADOR_GMAIL_FISCAL_VERSAO,
    cicloId,
    etapa,
    acao,
    status,
    mensagemJson || ''
  ]);
}

function aplicarFormatacaoControleCiclosWMGJ_(sheet) {
  if (!sheet) return;

  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);

  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('top').setWrap(true);
  sheet.autoResizeColumns(1, Math.min(lastCol, 6));
  sheet.setColumnWidth(7, 720);
}

function montarIdCicloWMGJ_(data) {
  return 'CICLO_' + Utilities.formatDate(data || new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
}

function getPlanilhaWMGJ_Orquestrador_() {
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
