/**
 * WMGJ — Orquestrador do ciclo financeiro documental
 * Versão: v1.1.5-orquestrador-financeiro
 *
 * Objetivo:
 * - executar em sequência controlada:
 *   1. extração real/OCR;
 *   2. formatação do texto extraído;
 *   3. parser de extrato bancário;
 *   4. resumo financeiro mensal;
 * - gerar log único do ciclo;
 * - impedir que uma falha silenciosa pareça sucesso, essa praga elegante.
 *
 * Cole este arquivo inteiro em: 07_ORQUESTRADOR_FINANCEIRO_WMGJ
 */

var WMGJ_ORQUESTRADOR_FINANCEIRO_VERSAO = 'v1.1.5-orquestrador-financeiro';

function rodarCicloFinanceiroDocumentalWMGJ() {
  return executarCicloFinanceiroDocumentalWMGJ({
    limiteExtracao: 5,
    limiteFormatacao: 10,
    limiteParser: 10
  });
}

function rodarCicloFinanceiroDocumentalWMGJ_Amplo() {
  return executarCicloFinanceiroDocumentalWMGJ({
    limiteExtracao: 20,
    limiteFormatacao: 1000,
    limiteParser: 1000
  });
}

function executarCicloFinanceiroDocumentalWMGJ(opcoes) {
  opcoes = opcoes || {};

  var inicio = new Date();
  var resultado = {
    ok: true,
    versao: WMGJ_ORQUESTRADOR_FINANCEIRO_VERSAO,
    inicio: inicio,
    etapas: {},
    alertas: [],
    erros: []
  };

  resultado.etapas.extracao = executarEtapaOrquestradorWMGJ_(
    'extracao_real_ocr',
    'executarExtracaoRealWMGJ_V1',
    function() {
      if (typeof executarExtracaoRealWMGJ_V1 !== 'function') {
        throw new Error('FUNCAO_AUSENTE: executarExtracaoRealWMGJ_V1');
      }
      return executarExtracaoRealWMGJ_V1(Number(opcoes.limiteExtracao || 5));
    }
  );

  resultado.etapas.formatacao = executarEtapaOrquestradorWMGJ_(
    'formatacao_texto_extraido',
    'formatarExtracoesDocumentaisWMGJ',
    function() {
      if (typeof formatarExtracoesDocumentaisWMGJ !== 'function') {
        throw new Error('FUNCAO_AUSENTE: formatarExtracoesDocumentaisWMGJ');
      }
      return formatarExtracoesDocumentaisWMGJ(Number(opcoes.limiteFormatacao || 10));
    }
  );

  resultado.etapas.parser = executarEtapaOrquestradorWMGJ_(
    'parser_extrato_bancario',
    'processarExtratosBancariosFormatadosWMGJ',
    function() {
      if (typeof processarExtratosBancariosFormatadosWMGJ !== 'function') {
        throw new Error('FUNCAO_AUSENTE: processarExtratosBancariosFormatadosWMGJ');
      }
      return processarExtratosBancariosFormatadosWMGJ(Number(opcoes.limiteParser || 10));
    }
  );

  resultado.etapas.resumo = executarEtapaOrquestradorWMGJ_(
    'resumo_financeiro_mensal',
    'consolidarResumoFinanceiroMensalWMGJ',
    function() {
      if (typeof consolidarResumoFinanceiroMensalWMGJ !== 'function') {
        throw new Error('FUNCAO_AUSENTE: consolidarResumoFinanceiroMensalWMGJ');
      }
      return consolidarResumoFinanceiroMensalWMGJ();
    }
  );

  Object.keys(resultado.etapas).forEach(function(nome) {
    var etapa = resultado.etapas[nome];
    if (!etapa.ok) {
      resultado.ok = false;
      resultado.erros.push(nome + ': ' + etapa.erro);
    }
  });

  resultado.fim = new Date();
  resultado.duracaoSegundos = Math.round((resultado.fim.getTime() - inicio.getTime()) / 1000);
  resultado.statusExecutivo = montarStatusExecutivoCicloWMGJ_(resultado);

  logOrquestradorFinanceiroWMGJ_(resultado.ok ? 'OK' : 'ERRO', 'executarCicloFinanceiroDocumentalWMGJ', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));

  return resultado;
}

function executarEtapaOrquestradorWMGJ_(nomeEtapa, nomeFuncao, executor) {
  var inicio = new Date();

  try {
    var retorno = executor();
    return {
      ok: true,
      etapa: nomeEtapa,
      funcao: nomeFuncao,
      inicio: inicio,
      fim: new Date(),
      retorno: retorno || {}
    };
  } catch (erro) {
    return {
      ok: false,
      etapa: nomeEtapa,
      funcao: nomeFuncao,
      inicio: inicio,
      fim: new Date(),
      erro: erro && erro.message ? erro.message : String(erro)
    };
  }
}

function montarStatusExecutivoCicloWMGJ_(resultado) {
  var extracao = resultado.etapas.extracao && resultado.etapas.extracao.retorno;
  var formatacao = resultado.etapas.formatacao && resultado.etapas.formatacao.retorno;
  var parser = resultado.etapas.parser && resultado.etapas.parser.retorno;
  var resumo = resultado.etapas.resumo && resultado.etapas.resumo.retorno;

  return {
    status: resultado.ok ? 'CICLO_EXECUTADO' : 'CICLO_COM_ERRO',
    extracaoProcessados: extracao && extracao.processamento ? Number(extracao.processamento.processados || 0) : 0,
    formatados: formatacao ? Number(formatacao.formatados || 0) : 0,
    lancamentosExtraidos: parser ? Number(parser.lancamentos || 0) : 0,
    competenciasConsolidadas: resumo ? Number(resumo.competencias || 0) : 0,
    erros: resultado.erros || []
  };
}

function logOrquestradorFinanceiroWMGJ_(status, funcao, mensagem) {
  if (typeof registrarLogWMGJ_Compat_ === 'function') {
    registrarLogWMGJ_Compat_(status, funcao, 'AppsScript', mensagem);
    return;
  }

  Logger.log([status, funcao, mensagem].join(' | '));
}
