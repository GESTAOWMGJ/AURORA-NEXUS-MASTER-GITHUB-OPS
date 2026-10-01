/**
 * WMGJ — Robô Gmail -> Classificação -> Extração -> Dashboard
 * Versão: v1.0.1-robo-gmail-dashboard-busca-ampla
 *
 * Objetivo:
 * - operar sobre a caixa Gmail autorizada no Apps Script, idealmente wmgjltda@gmail.com;
 * - buscar anexos financeiros/fiscais/operacionais;
 * - classificar e copiar documentos pertinentes para a pasta bruta;
 * - acionar parser fiscal/XML;
 * - acionar pipeline documental/financeiro;
 * - gerar relatório executivo;
 * - atualizar dashboard;
 * - registrar status central em 15_STATUS_AUTOMACAO e log em 10_LOG_AUTOMACAO.
 *
 * Observação operacional:
 * O Apps Script só lê o Gmail da conta que autorizou o projeto. Para processar wmgjltda@gmail.com,
 * o deploy/autorização precisa estar vinculado a essa conta ou a uma conta com acesso legítimo.
 */

var WMGJ_ROBO_GMAIL_DASHBOARD_VERSAO = 'v1.0.1-robo-gmail-dashboard-busca-ampla';
var WMGJ_GMAIL_CONTA_OPERACIONAL = 'wmgjltda@gmail.com';

function rodarRoboGmailDashboardWMGJ() {
  return executarRoboGmailDashboardWMGJ({
    modo: 'OPERACIONAL',
    limiteGmailThreads: 50,
    limiteThreadsPorQuery: 15,
    diasGmail: 730,
    limiteXml: 100,
    limiteExtracao: 20,
    limiteFormatacao: 40,
    limiteParser: 40,
    executarGmail: true,
    executarXml: true,
    executarPipelineDocumental: true,
    executarRelatorioSocios: true,
    executarDashboard: true
  });
}

function rodarRoboGmailDashboardWMGJ_Teste20() {
  return executarRoboGmailDashboardWMGJ({
    modo: 'TESTE_CONTROLADO',
    limiteGmailThreads: 20,
    limiteThreadsPorQuery: 10,
    diasGmail: 730,
    limiteXml: 20,
    limiteExtracao: 10,
    limiteFormatacao: 20,
    limiteParser: 20,
    executarGmail: true,
    executarXml: true,
    executarPipelineDocumental: true,
    executarRelatorioSocios: false,
    executarDashboard: true
  });
}

function diagnosticarRoboGmailDashboardWMGJ() {
  var ss = obterPlanilhaRoboGmailDashboardWMGJ_();
  var resultado = {
    ok: true,
    versao: WMGJ_ROBO_GMAIL_DASHBOARD_VERSAO,
    contaOperacionalEsperada: WMGJ_GMAIL_CONTA_OPERACIONAL,
    observacaoConta: 'Apps Script lê o Gmail da conta autorizada no projeto.',
    spreadsheetId: ss.getId(),
    planilha: ss.getName(),
    funcoes: {
      gmailV2: typeof indexarGmailFaturamentoWMGJ_V2 === 'function',
      gmailV1: typeof indexarGmailFaturamentoWMGJ === 'function',
      cicloCompleto: typeof executarCicloCompletoGmailFiscalFinanceiroWMGJ === 'function',
      parserXml: typeof processarNotasFiscaisXmlWMGJ === 'function',
      pipelineDocumental: typeof executarCicloFinanceiroDocumentalWMGJ === 'function' || typeof rodarCicloFinanceiroDocumentalWMGJ === 'function' || typeof executarExtracaoRealWMGJ_V1 === 'function',
      relatorioSocios: typeof gerarRelatorioExecutivoSociosWMGJ === 'function' || typeof rodarRelatorioExecutivoSociosWMGJ === 'function',
      dashboardCore: typeof atualizarDashboardWMGJ === 'function',
      dashboardFinanceiro: typeof atualizarDashboardFinanceiro === 'function'
    },
    abasDestino: [
      '21_GMAIL_INDEXACAO_FATURAMENTO',
      '22_NOTAS_FISCAIS_EXTRAIDAS',
      '18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS',
      '19_RESUMO_FINANCEIRO_MENSAL',
      '20_RELATORIOS_EXECUTIVOS_GERADOS',
      '05_DASHBOARD',
      '09_INDICADORES_DASHBOARD',
      '10_LOG_AUTOMACAO',
      '15_STATUS_AUTOMACAO'
    ],
    diagnosticadoEm: new Date().toISOString()
  };

  registrarStatusRoboGmailDashboardWMGJ_(resultado);
  registrarLogRoboGmailDashboardWMGJ_('OK', 'diagnosticarRoboGmailDashboardWMGJ', resultado);
  return resultado;
}

function executarRoboGmailDashboardWMGJ(opcoes) {
  opcoes = opcoes || {};
  var inicio = new Date();
  var cicloId = 'ROBO_GMAIL_' + Utilities.formatDate(inicio, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  var resultado = {
    ok: true,
    versao: WMGJ_ROBO_GMAIL_DASHBOARD_VERSAO,
    etapa: 'executarRoboGmailDashboardWMGJ',
    cicloId: cicloId,
    modo: opcoes.modo || 'OPERACIONAL',
    contaOperacionalEsperada: WMGJ_GMAIL_CONTA_OPERACIONAL,
    inicio: inicio.toISOString(),
    fim: null,
    etapas: {
      gmail: null,
      notasFiscaisXml: null,
      pipelineDocumentalFinanceiro: null,
      relatorioSocios: null,
      dashboard: null
    },
    erros: []
  };

  registrarLogRoboGmailDashboardWMGJ_('INICIO', 'executarRoboGmailDashboardWMGJ', {
    cicloId: cicloId,
    opcoes: opcoes
  });

  if (opcoes.executarGmail !== false) {
    resultado.etapas.gmail = executarEtapaRoboGmailDashboardWMGJ_('GMAIL_CLASSIFICACAO_EXTRACAO', function() {
      return executarEtapaGmailRoboDashboardWMGJ_(opcoes);
    });
  }

  if (opcoes.executarXml !== false) {
    resultado.etapas.notasFiscaisXml = executarEtapaRoboGmailDashboardWMGJ_('PARSER_NOTAS_FISCAIS_XML', function() {
      return executarEtapaXmlRoboDashboardWMGJ_(opcoes);
    });
  }

  if (opcoes.executarPipelineDocumental !== false) {
    resultado.etapas.pipelineDocumentalFinanceiro = executarEtapaRoboGmailDashboardWMGJ_('PIPELINE_DOCUMENTAL_FINANCEIRO', function() {
      return executarEtapaPipelineDocumentalRoboDashboardWMGJ_(opcoes);
    });
  }

  if (opcoes.executarRelatorioSocios !== false) {
    resultado.etapas.relatorioSocios = executarEtapaRoboGmailDashboardWMGJ_('RELATORIO_EXECUTIVO_SOCIOS', function() {
      return executarEtapaRelatorioSociosRoboDashboardWMGJ_(opcoes);
    });
  }

  if (opcoes.executarDashboard !== false) {
    resultado.etapas.dashboard = executarEtapaRoboGmailDashboardWMGJ_('ATUALIZAR_DASHBOARD', function() {
      return atualizarDashboardRoboGmailDashboardWMGJ_();
    });
  }

  Object.keys(resultado.etapas).forEach(function(nome) {
    var etapa = resultado.etapas[nome];
    if (etapa && etapa.ok === false) {
      resultado.ok = false;
      resultado.erros.push({ etapa: nome, erro: etapa.erro || etapa.resultado });
    }
  });

  resultado.fim = new Date().toISOString();
  resultado.duracaoSegundos = Math.round((new Date(resultado.fim).getTime() - inicio.getTime()) / 1000);

  registrarStatusRoboGmailDashboardWMGJ_(resultado);
  registrarLogRoboGmailDashboardWMGJ_(resultado.ok ? 'OK' : 'ERRO', 'executarRoboGmailDashboardWMGJ', resultado);
  return resultado;
}

function executarEtapaRoboGmailDashboardWMGJ_(nomeEtapa, fn) {
  var inicio = new Date();
  try {
    var retorno = fn();
    var fim = new Date();
    var etapa = {
      ok: retorno && retorno.ok !== false,
      etapa: nomeEtapa,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      duracaoSegundos: Math.round((fim.getTime() - inicio.getTime()) / 1000),
      resultado: retorno
    };
    registrarLogRoboGmailDashboardWMGJ_(etapa.ok ? 'OK' : 'ALERTA', nomeEtapa, retorno);
    return etapa;
  } catch (erro) {
    var falha = {
      ok: false,
      etapa: nomeEtapa,
      inicio: inicio.toISOString(),
      fim: new Date().toISOString(),
      erro: erro && erro.message ? erro.message : String(erro)
    };
    registrarLogRoboGmailDashboardWMGJ_('ERRO', nomeEtapa, falha);
    return falha;
  }
}

function executarEtapaGmailRoboDashboardWMGJ_(opcoes) {
  var queryRestrita = montarQueryGmailRoboDashboardWMGJ_(opcoes);

  if (typeof indexarGmailFaturamentoWMGJ_V2 === 'function') {
    var payloadV2 = {
      limiteThreadsTotal: Number(opcoes.limiteGmailThreads || 50),
      limiteThreadsPorQuery: Number(opcoes.limiteThreadsPorQuery || 15),
      dias: Number(opcoes.diasGmail || 730),
      executarPipelineDepois: false,
      incluirBuscaBruta: true
    };

    // Só usa query manual se o operador informar explicitamente.
    // Por padrão, deixa a V2 executar buscas amplas por termo/extensão + busca bruta.
    if (opcoes.queryManual || opcoes.queryForcada) {
      payloadV2.query = String(opcoes.queryManual || opcoes.queryForcada);
    }

    var resultadoV2 = indexarGmailFaturamentoWMGJ_V2(payloadV2);
    resultadoV2.queryRestritaReferencia = queryRestrita;
    resultadoV2.modoBuscaRobo = payloadV2.query ? 'QUERY_MANUAL_FORCADA' : 'BUSCA_AMPLA_ADAPTATIVA_V2';
    return resultadoV2;
  }

  if (typeof indexarGmailFaturamentoWMGJ === 'function') {
    return indexarGmailFaturamentoWMGJ({
      limiteThreads: Number(opcoes.limiteGmailThreads || 50),
      executarPipelineDepois: false,
      query: queryRestrita
    });
  }

  return { ok: false, erro: 'INDEXADOR_GMAIL_NAO_ENCONTRADO', query: queryRestrita };
}

function executarEtapaXmlRoboDashboardWMGJ_(opcoes) {
  if (typeof processarNotasFiscaisXmlWMGJ === 'function') {
    return processarNotasFiscaisXmlWMGJ({ limiteArquivos: Number(opcoes.limiteXml || 100) });
  }

  if (typeof rodarParserNotasFiscaisXmlWMGJ_100 === 'function') {
    return rodarParserNotasFiscaisXmlWMGJ_100();
  }

  return { ok: false, erro: 'PARSER_NOTAS_FISCAIS_XML_NAO_ENCONTRADO' };
}

function executarEtapaPipelineDocumentalRoboDashboardWMGJ_(opcoes) {
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

function executarEtapaRelatorioSociosRoboDashboardWMGJ_(opcoes) {
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

function atualizarDashboardRoboGmailDashboardWMGJ_() {
  var resultados = [];

  if (typeof atualizarDashboardWMGJ === 'function') {
    resultados.push(atualizarDashboardWMGJ());
  }

  if (typeof atualizarDashboardFinanceiro === 'function') {
    resultados.push(atualizarDashboardFinanceiro());
  }

  if (typeof gerarResumoFinanceiroMensalWMGJ === 'function') {
    resultados.push(gerarResumoFinanceiroMensalWMGJ());
  }

  if (!resultados.length) {
    return { ok: false, erro: 'FUNCAO_DASHBOARD_NAO_ENCONTRADA' };
  }

  return { ok: true, resultados: resultados };
}

function montarQueryGmailRoboDashboardWMGJ_(opcoes) {
  if (opcoes && (opcoes.queryManual || opcoes.queryForcada)) return String(opcoes.queryManual || opcoes.queryForcada);

  var dias = Number((opcoes && opcoes.diasGmail) || 730);
  return [
    'has:attachment',
    'newer_than:' + dias + 'd',
    '(' + ['to:' + WMGJ_GMAIL_CONTA_OPERACIONAL, 'from:' + WMGJ_GMAIL_CONTA_OPERACIONAL].join(' OR ') + ')',
    '(' + [
      'faturamento',
      'fatura',
      'nota fiscal',
      'NF-e',
      'NFS-e',
      'nfse',
      'xml',
      'boleto',
      'recibo',
      'pagamento',
      'extrato',
      'demonstrativo',
      'produção médica',
      'producao medica',
      'repasse',
      'honorários',
      'honorarios',
      'cardiologia'
    ].join(' OR ') + ')'
  ].join(' ');
}

function obterPlanilhaRoboGmailDashboardWMGJ_() {
  if (typeof getPlanilha === 'function') return getPlanilha();
  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (!ativa) throw new Error('PLANILHA_NAO_ENCONTRADA');
  return ativa;
}

function registrarStatusRoboGmailDashboardWMGJ_(payload) {
  if (typeof registrarStatusAutomacaoWMGJ_ === 'function') {
    return registrarStatusAutomacaoWMGJ_(payload);
  }
  return null;
}

function registrarLogRoboGmailDashboardWMGJ_(status, comando, payload) {
  if (typeof registrarLogWMGJ_ === 'function') {
    registrarLogWMGJ_(status, comando, 'RoboGmailDashboard', JSON.stringify(payload));
    return;
  }
  Logger.log([status, comando, JSON.stringify(payload)].join(' | '));
}
