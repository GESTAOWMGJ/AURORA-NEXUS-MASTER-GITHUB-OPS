/**
 * WMGJ — Testes controlados de confiabilidade do pipeline
 *
 * Entrada pública mantida:
 *   testeSuiteConfiabilidadePipelineWMGJ()
 *
 * As rotinas específicas deste arquivo usam sufixo _CONTROLADO para não
 * colidir com os wrappers oficiais definidos em 01_PIPELINE_CONFIABILIDADE_WMGJ.gs.
 * Apps Script não tem namespace decente; então a gente cria um no braço,
 * como se estivéssemos montando avião com fita crepe.
 *
 * Estes testes NÃO escrevem na base financeira.
 * Eles validam JSON, memória-base, deduplicação e fila.
 */

function testeValidarJsonIAWMGJ_CONTROLADO() {
  var casos = [];

  casos.push({
    nome: "JSON_VALIDO_DIRETO",
    entrada: {
      categoria: "financeiro",
      tipo_documento: "nota_fiscal",
      competencia: "2026-04",
      valor_total: 1000,
      atendimentos: 0,
      resumo_operacional: "Teste JSON válido",
      confianca: 0.91
    },
    esperado: true
  });

  casos.push({
    nome: "JSON_VALIDO_MARKDOWN",
    entrada: "```json\n{\"categoria\":\"produtividade\",\"tipo_documento\":\"relatorio\",\"competencia\":\"2026-04\",\"atendimentos\":12,\"resumo_operacional\":\"Teste\",\"confianca\":0.82}\n```",
    esperado: true
  });

  casos.push({
    nome: "CATEGORIA_INVALIDA",
    entrada: { categoria: "banana_contabil", confianca: 0.9 },
    esperado: false
  });

  casos.push({
    nome: "CONFIANCA_BAIXA",
    entrada: { categoria: "financeiro", confianca: 0.2 },
    esperado: false
  });

  casos.push({
    nome: "JSON_QUEBRADO",
    entrada: "{ categoria: financeiro, confianca: }",
    esperado: false
  });

  var resultados = casos.map(function(caso) {
    var validacao = validarDocumentoJsonWMGJ_(caso.entrada);
    var passou = validacao.ok === caso.esperado;

    if (!passou) {
      throw new Error("Falha no caso " + caso.nome + ": esperado " + caso.esperado + ", recebido " + validacao.ok + " | " + JSON.stringify(validacao));
    }

    return {
      caso: caso.nome,
      ok: validacao.ok,
      erro: validacao.erro || ""
    };
  });

  registrarLogWMGJ_("TESTE_OK", "testeValidarJsonIAWMGJ_CONTROLADO", "AppsScript", JSON.stringify(resultados));

  return {
    ok: true,
    teste: "testeValidarJsonIAWMGJ_CONTROLADO",
    resultados: resultados
  };
}

function testeDeduplicacaoMemoriaWMGJ_CONTROLADO() {
  garantirAbasControlePipelineWMGJ_();

  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();
  var memoria = ss.getSheetByName(cfg.SHEETS.MEMORIA);

  var idTeste = "TESTE_DEDUP_WMGJ";
  var hashTeste = "HASH_TESTE_DEDUP_WMGJ_001";

  removerRegistrosTesteDedupWMGJ_(memoria, idTeste);

  if (documentoJaProcessadoWMGJ_(idTeste, hashTeste)) {
    throw new Error("Deduplicação acusou duplicado antes do registro de teste. Isso indica sujeira residual na memória-base.");
  }

  registrarDocumentoMemoriaWMGJ_(memoria, {
    origem: "TESTE_CONTROLADO",
    idOrigem: idTeste,
    nome: "arquivo_teste_deduplicacao.txt",
    mimeType: "text/plain",
    hash: hashTeste,
    competencia: "TESTE",
    categoria: "outro",
    status: "PROCESSADO",
    resumo: "Registro controlado para validar ID_ORIGEM + HASH"
  });

  var duplicadoDepois = documentoJaProcessadoWMGJ_(idTeste, hashTeste);

  if (!duplicadoDepois) {
    throw new Error("Deduplicação não reconheceu ID_ORIGEM + HASH após registro na memória-base.");
  }

  registrarLogWMGJ_("TESTE_OK", "testeDeduplicacaoMemoriaWMGJ_CONTROLADO", "AppsScript", "Deduplicação validada por ID_ORIGEM + HASH");

  return {
    ok: true,
    teste: "testeDeduplicacaoMemoriaWMGJ_CONTROLADO",
    criterio: "ID_ORIGEM + HASH",
    idOrigem: idTeste,
    hash: hashTeste,
    duplicadoReconhecido: duplicadoDepois
  };
}

function testePipelineArquivosReaisWMGJ_CONTROLADO() {
  var preparo = prepararPipelineConfiavelWMGJ();
  var processamento = processarFilaWMGJ(3);

  var resultado = {
    ok: true,
    teste: "testePipelineArquivosReaisWMGJ_CONTROLADO",
    preparo: preparo,
    processamento: processamento,
    criterio: "Nenhuma falha individual deve derrubar o lote inteiro"
  };

  registrarLogWMGJ_("TESTE_OK", "testePipelineArquivosReaisWMGJ_CONTROLADO", "AppsScript", JSON.stringify(resultado));

  return resultado;
}

function testeSuiteConfiabilidadePipelineWMGJ() {
  var json = testeValidarJsonIAWMGJ_CONTROLADO();
  var dedup = testeDeduplicacaoMemoriaWMGJ_CONTROLADO();
  var pipeline = testePipelineArquivosReaisWMGJ_CONTROLADO();

  var resultado = {
    ok: true,
    teste: "testeSuiteConfiabilidadePipelineWMGJ",
    json: json,
    deduplicacao: dedup,
    pipeline: pipeline
  };

  registrarLogWMGJ_("TESTE_OK", "testeSuiteConfiabilidadePipelineWMGJ", "AppsScript", "Suite de confiabilidade finalizada");

  return resultado;
}

function removerRegistrosTesteDedupWMGJ_(memoria, idTeste) {
  if (!memoria || memoria.getLastRow() < 2) return 0;

  var dados = memoria.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_(dados[0]);
  var removidos = 0;

  for (var i = dados.length - 1; i >= 1; i--) {
    if (String(dados[i][idx.ID_ORIGEM] || "") === String(idTeste)) {
      memoria.deleteRow(i + 1);
      removidos++;
    }
  }

  return removidos;
}
