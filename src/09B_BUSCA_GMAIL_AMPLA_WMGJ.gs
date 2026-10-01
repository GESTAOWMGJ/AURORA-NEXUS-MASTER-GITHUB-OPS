/**
 * WMGJ — Patch de busca ampla adaptativa no Gmail
 * Versão: v1.1.8-busca-gmail-ampla
 *
 * Motivo:
 * - a query v1.1.7 retornou 0 threads;
 * - este módulo não altera a V3 nem apaga o indexador anterior;
 * - ele adiciona funções V2 que fazem múltiplas buscas menores e mais robustas;
 * - usa os mesmos helpers do arquivo 09_INDEXADOR_GMAIL_FATURAMENTO_WMGJ.
 *
 * Cole este arquivo inteiro em: 09B_BUSCA_GMAIL_AMPLA_WMGJ
 */

var WMGJ_GMAIL_BUSCA_AMPLA_VERSAO = 'v1.1.8-busca-gmail-ampla';

function rodarDiagnosticoBuscaGmailWMGJ_V2() {
  var queries = montarQueriesGmailFaturamentoWMGJ_V2_({
    dias: 730,
    incluirBuscaBruta: true
  });

  var resultados = [];
  var totalAmostra = 0;

  queries.forEach(function(q) {
    try {
      var threads = GmailApp.search(q, 0, 10);
      resultados.push({ query: q, threadsAmostra: threads.length, ok: true });
      totalAmostra += threads.length;
    } catch (erro) {
      resultados.push({ query: q, threadsAmostra: 0, ok: false, erro: erro && erro.message ? erro.message : String(erro) });
    }
  });

  var resultado = {
    ok: true,
    versao: WMGJ_GMAIL_BUSCA_AMPLA_VERSAO,
    objetivo: 'diagnosticar quais buscas Gmail retornam anexos antes de copiar arquivos',
    totalAmostra: totalAmostra,
    queries: resultados,
    proximaFuncao: 'rodarIndexacaoGmailFaturamentoWMGJ_Ampla_50'
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function rodarIndexacaoGmailFaturamentoWMGJ_Ampla_20() {
  return indexarGmailFaturamentoWMGJ_V2({
    limiteThreadsTotal: 20,
    limiteThreadsPorQuery: 10,
    dias: 730,
    executarPipelineDepois: false,
    incluirBuscaBruta: true
  });
}

function rodarIndexacaoGmailFaturamentoWMGJ_Ampla_50() {
  return indexarGmailFaturamentoWMGJ_V2({
    limiteThreadsTotal: 50,
    limiteThreadsPorQuery: 15,
    dias: 730,
    executarPipelineDepois: false,
    incluirBuscaBruta: true
  });
}

function rodarIndexacaoGmailFaturamentoEProcessarWMGJ_Ampla_50() {
  return indexarGmailFaturamentoWMGJ_V2({
    limiteThreadsTotal: 50,
    limiteThreadsPorQuery: 15,
    dias: 730,
    executarPipelineDepois: true,
    incluirBuscaBruta: true
  });
}

function rodarIndexacaoGmailFaturamentoWMGJ_TodosLotes_100() {
  return indexarGmailFaturamentoWMGJ_V2({
    limiteThreadsTotal: 100,
    limiteThreadsPorQuery: 25,
    dias: 1825,
    executarPipelineDepois: false,
    incluirBuscaBruta: true
  });
}

function indexarGmailFaturamentoWMGJ_V2(opcoes) {
  opcoes = opcoes || {};

  var ss = getPlanilhaWMGJ_Gmail_();
  var aba = garantirAbaIndexacaoGmailWMGJ_(ss);
  var pastaEntrada = obterPastaBrutoAClassificarGmailWMGJ_();
  var jaIndexados = carregarChavesGmailJaIndexadasWMGJ_(aba);

  var queries = montarQueriesGmailFaturamentoWMGJ_V2_(opcoes);
  var busca = buscarThreadsGmailFaturamentoWMGJ_V2_(queries, Number(opcoes.limiteThreadsTotal || 50), Number(opcoes.limiteThreadsPorQuery || 15));
  var threads = busca.threads;

  var estat = {
    queriesExecutadas: busca.estatisticas.length,
    threadsLidas: threads.length,
    mensagensLidas: 0,
    anexosEncontrados: 0,
    anexosPertinentes: 0,
    copiadosParaBruto: 0,
    duplicados: 0,
    ignorados: 0,
    erros: 0
  };

  threads.forEach(function(thread) {
    var mensagens = thread.getMessages();

    mensagens.forEach(function(msg) {
      estat.mensagensLidas++;

      var anexos = msg.getAttachments({
        includeInlineImages: false,
        includeAttachments: true
      });

      if (!anexos || anexos.length === 0) {
        estat.ignorados++;
        return;
      }

      anexos.forEach(function(anexo) {
        estat.anexosEncontrados++;

        try {
          var meta = montarMetadadosAnexoGmailWMGJ_(thread, msg, anexo);
          var chave = meta.messageId + '|' + meta.attachmentName + '|' + meta.attachmentHash;

          if (jaIndexados[chave]) {
            estat.duplicados++;
            return;
          }

          var classificacao = classificarAnexoGmailFaturamentoWMGJ_(meta);

          if (!classificacao.pertinente) {
            registrarLinhaGmailIndexacaoWMGJ_(aba, meta, classificacao, '', 'IGNORADO_NAO_PERTINENTE_V2', '');
            jaIndexados[chave] = true;
            estat.ignorados++;
            return;
          }

          estat.anexosPertinentes++;

          var arquivo = salvarAnexoGmailNaPastaBrutoWMGJ_(pastaEntrada, meta, anexo, classificacao);
          registrarLinhaGmailIndexacaoWMGJ_(aba, meta, classificacao, arquivo.getId(), 'COPIADO_BRUTO_A_CLASSIFICAR_V2', arquivo.getUrl());

          jaIndexados[chave] = true;
          estat.copiadosParaBruto++;
        } catch (erro) {
          estat.erros++;
          registrarErroGmailIndexacaoWMGJ_(aba, thread, msg, anexo, erro);
        }
      });
    });
  });

  aplicarFormatacaoAbaIndexacaoGmailWMGJ_(aba);

  var pipeline = null;
  if (opcoes.executarPipelineDepois) {
    pipeline = executarPipelineDepoisDaIndexacaoGmailWMGJ_();
  }

  var resultado = {
    ok: estat.erros === 0,
    versao: WMGJ_GMAIL_BUSCA_AMPLA_VERSAO,
    pastaEntradaId: pastaEntrada.getId(),
    pastaEntradaNome: pastaEntrada.getName(),
    estatisticas: estat,
    busca: busca.estatisticas,
    pipeline: pipeline,
    abaDestino: '21_GMAIL_INDEXACAO_FATURAMENTO'
  };

  logGmailIndexadorWMGJ_(resultado.ok ? 'OK' : 'ERRO', 'indexarGmailFaturamentoWMGJ_V2', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function buscarThreadsGmailFaturamentoWMGJ_V2_(queries, limiteTotal, limitePorQuery) {
  var mapa = {};
  var threadsUnicas = [];
  var estatisticas = [];

  queries.forEach(function(q) {
    if (threadsUnicas.length >= limiteTotal) return;

    try {
      var restantes = Math.max(1, limiteTotal - threadsUnicas.length);
      var limiteBusca = Math.min(limitePorQuery, restantes);
      var encontrados = GmailApp.search(q, 0, limiteBusca);
      var adicionados = 0;

      encontrados.forEach(function(thread) {
        var id = thread.getId();
        if (!mapa[id] && threadsUnicas.length < limiteTotal) {
          mapa[id] = true;
          threadsUnicas.push(thread);
          adicionados++;
        }
      });

      estatisticas.push({
        query: q,
        encontrados: encontrados.length,
        adicionados: adicionados,
        ok: true
      });
    } catch (erro) {
      estatisticas.push({
        query: q,
        encontrados: 0,
        adicionados: 0,
        ok: false,
        erro: erro && erro.message ? erro.message : String(erro)
      });
    }
  });

  return {
    threads: threadsUnicas,
    estatisticas: estatisticas
  };
}

function montarQueriesGmailFaturamentoWMGJ_V2_(opcoes) {
  opcoes = opcoes || {};

  if (opcoes.query) return [String(opcoes.query)];

  var dias = Number(opcoes.dias || 730);
  var janela = 'newer_than:' + dias + 'd';

  var termos = [
    '"nota fiscal"',
    'nfse',
    '"nfs-e"',
    '"nf-e"',
    'danfe',
    'faturamento',
    'fatura',
    'boleto',
    'recibo',
    'comprovante',
    'pagamento',
    'extrato',
    'demonstrativo',
    'repasse',
    'honorarios',
    'honorários',
    '"produção médica"',
    '"producao medica"'
  ];

  var queries = [];

  termos.forEach(function(t) {
    queries.push('has:attachment ' + t + ' ' + janela);
  });

  [
    'pdf',
    'xls',
    'xlsx',
    'csv',
    'xml',
    'zip',
    'jpg',
    'jpeg',
    'png'
  ].forEach(function(ext) {
    queries.push('has:attachment filename:' + ext + ' ' + janela);
  });

  if (opcoes.incluirBuscaBruta) {
    queries.push('has:attachment ' + janela);
  }

  return queries;
}
