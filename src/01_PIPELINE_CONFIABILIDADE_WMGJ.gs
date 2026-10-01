/**
 * WMGJ — Pipeline de confiabilidade V3
 * Versão oficial: v1.0.1-pipeline-estavel
 *
 * Este arquivo substitui a lógica antiga do pipeline.
 * Regra de ouro, porque aparentemente até planilha gosta de drama:
 * - PENDENTE fica apenas na fila;
 * - memória-base só recebe PROCESSADO;
 * - deduplicação usa ID_ORIGEM + HASH;
 * - falha individual não derruba o lote;
 * - funções antigas viram wrappers para V3, sem duplicar lógica.
 *
 * Depende de src/00_CORE_WMGJ.gs:
 * - getConfigWMGJ_()
 * - getPlanilha()
 * - obterOuCriarAba_(ss, nome, cabecalho)
 * - registrarLogWMGJ_(status, comando, origem, mensagem)
 */

var WMGJ_PIPELINE_VERSAO = "v1.0.1-pipeline-estavel";

/**
 * =========================
 * ENTRADAS OFICIAIS V3
 * =========================
 */

function diagnosticarPastaEntradaWMGJ_V3() {
  var cfg = getConfigWMGJ_();
  var pastaId = cfg.PASTA_ENTRADA_ID;

  if (!pastaId) {
    var semId = {
      ok: false,
      erro: "PASTA_ENTRADA_ID_NAO_CONFIGURADA",
      pastaId: pastaId || ""
    };
    registrarLogWMGJ_("ERRO", "diagnosticarPastaEntradaWMGJ_V3", "AppsScript", JSON.stringify(semId));
    return semId;
  }

  try {
    var pasta = DriveApp.getFolderById(pastaId);
    var arquivos = pasta.getFiles();
    var amostra = [];
    var totalAmostra = 0;

    while (arquivos.hasNext() && totalAmostra < 20) {
      var file = arquivos.next();
      amostra.push({
        id: file.getId(),
        nome: file.getName(),
        mimeType: file.getMimeType(),
        tamanho: file.getSize(),
        atualizadoEm: file.getLastUpdated()
      });
      totalAmostra++;
    }

    var resultado = {
      ok: true,
      versao: WMGJ_PIPELINE_VERSAO,
      pastaId: pastaId,
      nome: pasta.getName(),
      amostra: amostra
    };

    registrarLogWMGJ_("DIAGNOSTICO", "diagnosticarPastaEntradaWMGJ_V3", "AppsScript", JSON.stringify({
      ok: true,
      pastaId: resultado.pastaId,
      nome: resultado.nome,
      arquivosAmostra: amostra.length
    }));

    return resultado;

  } catch (erro) {
    var falha = {
      ok: false,
      versao: WMGJ_PIPELINE_VERSAO,
      pastaId: pastaId,
      erro: erro && erro.message ? erro.message : String(erro)
    };
    registrarLogWMGJ_("ERRO", "diagnosticarPastaEntradaWMGJ_V3", "AppsScript", JSON.stringify(falha));
    return falha;
  }
}

function prepararPipelineConfiavelWMGJ_V3(limite) {
  garantirAbasControlePipelineWMGJ_V3_();

  var diagnostico = diagnosticarPastaEntradaWMGJ_V3();
  if (!diagnostico.ok) {
    return {
      ok: false,
      versao: WMGJ_PIPELINE_VERSAO,
      etapa: "prepararPipelineConfiavelWMGJ_V3",
      erro: diagnostico.erro,
      diagnostico: diagnostico
    };
  }

  var resultado = enfileirarArquivosEntradaWMGJ_V3(limite || 100);

  registrarLogWMGJ_(
    "OK",
    "prepararPipelineConfiavelWMGJ_V3",
    "AppsScript",
    JSON.stringify(resultado)
  );

  return {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    etapa: "prepararPipelineConfiavelWMGJ_V3",
    diagnostico: diagnostico,
    resultado: resultado
  };
}

function processarFilaWMGJ_V3(limite) {
  garantirAbasControlePipelineWMGJ_V3_();

  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();

  var fila = obterOuCriarAba_(ss, cfg.SHEETS.FILA, cabecalhoFilaWMGJ_V3_());
  var memoria = obterOuCriarAba_(ss, cfg.SHEETS.MEMORIA, cabecalhoMemoriaWMGJ_V3_());

  if (fila.getLastRow() < 2) {
    var vazia = {
      ok: true,
      versao: WMGJ_PIPELINE_VERSAO,
      etapa: "processarFilaWMGJ_V3",
      processados: 0,
      erros: 0,
      duplicados: 0,
      mensagem: "Fila vazia"
    };
    registrarLogWMGJ_("OK", "processarFilaWMGJ_V3", "AppsScript", JSON.stringify(vazia));
    return vazia;
  }

  var dados = fila.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_(dados[0]);
  var max = Number(limite) || 20;

  var avaliados = 0;
  var processados = 0;
  var erros = 0;
  var duplicados = 0;

  for (var i = 1; i < dados.length && avaliados < max; i++) {
    var linha = dados[i];
    var status = String(linha[idx.STATUS] || "").toUpperCase();
    var idOrigem = String(linha[idx.ID_ORIGEM] || "");

    if (status !== "PENDENTE" && status !== "ERRO_REPROCESSAR") {
      continue;
    }

    avaliados++;

    if (!idOrigem) {
      atualizarLinhaFilaWMGJ_(fila, i + 1, idx, {
        STATUS: "ERRO_REPROCESSAR",
        TENTATIVAS: Number(linha[idx.TENTATIVAS] || 0) + 1,
        ULTIMO_ERRO: "ID_ORIGEM vazio",
        OBSERVACAO: "Registro de fila sem ID_ORIGEM"
      });
      erros++;
      continue;
    }

    try {
      atualizarLinhaFilaWMGJ_(fila, i + 1, idx, {
        STATUS: "PROCESSANDO",
        ULTIMO_ERRO: ""
      });

      var file = DriveApp.getFileById(idOrigem);
      var hash = gerarHashArquivoWMGJ_(file);

      if (documentoJaProcessadoWMGJ_(idOrigem, hash)) {
        atualizarLinhaFilaWMGJ_(fila, i + 1, idx, {
          STATUS: "DUPLICADO",
          ULTIMO_ERRO: "",
          OBSERVACAO: "Arquivo já reconhecido por ID_ORIGEM + HASH"
        });
        duplicados++;
        continue;
      }

      var texto = extrairTextoBasicoArquivoWMGJ_(file);
      var resultadoIA = classificarDocumentoComIASeDisponivelWMGJ_(texto, file);
      var validacao = validarDocumentoJsonWMGJ_(resultadoIA);

      if (!validacao.ok) {
        atualizarLinhaFilaWMGJ_(fila, i + 1, idx, {
          STATUS: "REVISAR_HUMANO",
          TENTATIVAS: Number(linha[idx.TENTATIVAS] || 0) + 1,
          ULTIMO_ERRO: validacao.erro,
          OBSERVACAO: "JSON inválido, incompleto ou baixa confiança"
        });
        erros++;
        continue;
      }

      registrarDocumentoMemoriaWMGJ_(memoria, {
        origem: "DRIVE",
        idOrigem: idOrigem,
        nome: file.getName(),
        mimeType: file.getMimeType(),
        hash: hash,
        competencia: validacao.dados.competencia || "",
        categoria: validacao.dados.categoria || "outro",
        status: "PROCESSADO",
        resumo: validacao.dados.resumo_operacional || validacao.dados.descricao || "Processado sem resumo"
      });

      atualizarLinhaFilaWMGJ_(fila, i + 1, idx, {
        STATUS: "PROCESSADO",
        ULTIMO_ERRO: "",
        OBSERVACAO: "Processado e registrado na memória-base"
      });

      processados++;

    } catch (erro) {
      atualizarLinhaFilaWMGJ_(fila, i + 1, idx, {
        STATUS: "ERRO_REPROCESSAR",
        TENTATIVAS: Number(linha[idx.TENTATIVAS] || 0) + 1,
        ULTIMO_ERRO: erro && erro.message ? erro.message : String(erro),
        OBSERVACAO: "Erro isolado no arquivo; lote continua"
      });
      erros++;
    }
  }

  var resultado = {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    etapa: "processarFilaWMGJ_V3",
    avaliados: avaliados,
    processados: processados,
    erros: erros,
    duplicados: duplicados
  };

  registrarLogWMGJ_("OK", "processarFilaWMGJ_V3", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function limparTestesPipelineWMGJ_V3() {
  garantirAbasControlePipelineWMGJ_V3_();

  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();
  var removidos = {};

  [cfg.SHEETS.FILA, cfg.SHEETS.MEMORIA].forEach(function(nomeAba) {
    var aba = ss.getSheetByName(nomeAba);
    var total = 0;

    if (!aba || aba.getLastRow() < 2) {
      removidos[nomeAba] = 0;
      return;
    }

    var dados = aba.getDataRange().getValues();

    for (var i = dados.length - 1; i >= 1; i--) {
      var linha = dados[i].join(" ");
      if (linha.indexOf("TESTE_PIPELINE_WMGJ") >= 0 || linha.indexOf("TESTE_DEDUP_WMGJ") >= 0) {
        aba.deleteRow(i + 1);
        total++;
      }
    }

    removidos[nomeAba] = total;
  });

  var arquivosRemovidos = 0;

  try {
    var pasta = DriveApp.getFolderById(cfg.PASTA_ENTRADA_ID);
    var arquivos = pasta.getFiles();

    while (arquivos.hasNext()) {
      var file = arquivos.next();
      if (file.getName().indexOf("TESTE_PIPELINE_WMGJ") === 0) {
        file.setTrashed(true);
        arquivosRemovidos++;
      }
    }
  } catch (erroDrive) {
    removidos.erroDrive = erroDrive && erroDrive.message ? erroDrive.message : String(erroDrive);
  }

  removidos.ARQUIVOS_DRIVE_TESTE = arquivosRemovidos;

  registrarLogWMGJ_(
    "TESTE_OK",
    "limparTestesPipelineWMGJ_V3",
    "AppsScript",
    JSON.stringify(removidos)
  );

  return {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    removidos: removidos
  };
}

function criarArquivoTestePipelineWMGJ_V3() {
  var cfg = getConfigWMGJ_();
  var pasta = DriveApp.getFolderById(cfg.PASTA_ENTRADA_ID);
  var nome = "TESTE_PIPELINE_WMGJ_" + new Date().getTime() + ".txt";

  var conteudo = [
    "Documento de teste WMGJ",
    "Categoria: produtividade",
    "Competencia: 2026-05",
    "Atendimentos: 12",
    "Valor: R$ 1.000,00",
    "Observacao: arquivo criado para validar Drive -> Fila -> Memoria-base -> Log"
  ].join("\n");

  var arquivo = pasta.createFile(nome, conteudo, MimeType.PLAIN_TEXT);

  var resultado = {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    pastaId: cfg.PASTA_ENTRADA_ID,
    nome: arquivo.getName(),
    id: arquivo.getId(),
    mimeType: arquivo.getMimeType()
  };

  registrarLogWMGJ_("TESTE_OK", "criarArquivoTestePipelineWMGJ_V3", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function testePipelineArquivosReaisWMGJ_V3() {
  var preparo = prepararPipelineConfiavelWMGJ_V3(100);
  var processamento = processarFilaWMGJ_V3(20);

  var resultado = {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    teste: "testePipelineArquivosReaisWMGJ_V3",
    preparo: preparo,
    processamento: processamento,
    criterio: "Nenhuma falha individual deve derrubar o lote inteiro"
  };

  registrarLogWMGJ_("TESTE_OK", "testePipelineArquivosReaisWMGJ_V3", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function testeSuiteConfiabilidadePipelineWMGJ_V3() {
  var json = testeValidarJsonIAWMGJ();
  var dedup = testeDeduplicacaoMemoriaWMGJ_V3();
  var arquivo = criarArquivoTestePipelineWMGJ_V3();
  var pipeline = testePipelineArquivosReaisWMGJ_V3();

  var resultado = {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    teste: "testeSuiteConfiabilidadePipelineWMGJ_V3",
    json: json,
    deduplicacao: dedup,
    arquivoTeste: arquivo,
    pipeline: pipeline
  };

  registrarLogWMGJ_("TESTE_OK", "testeSuiteConfiabilidadePipelineWMGJ_V3", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

/**
 * =========================
 * WRAPPERS LEGADOS
 * =========================
 * Mantidos só para não quebrar gatilhos antigos.
 * A lógica real está na V3. Chega de zoológico funcional.
 */

function diagnosticarPastaEntradaWMGJ() {
  return diagnosticarPastaEntradaWMGJ_V3();
}

function prepararPipelineConfiavelWMGJ(limite) {
  return prepararPipelineConfiavelWMGJ_V3(limite);
}

function enfileirarArquivosEntradaWMGJ(limite) {
  return enfileirarArquivosEntradaWMGJ_V3(limite);
}

function processarFilaWMGJ(limite) {
  return processarFilaWMGJ_V3(limite);
}

function limparTestesPipelineWMGJ() {
  return limparTestesPipelineWMGJ_V3();
}

function criarArquivoTestePipelineWMGJ() {
  return criarArquivoTestePipelineWMGJ_V3();
}

function testePipelineArquivosReaisWMGJ() {
  return testePipelineArquivosReaisWMGJ_V3();
}

function testarControleConfiabilidadeWMGJ() {
  return testePipelineArquivosReaisWMGJ_V3();
}

/**
 * =========================
 * IMPLEMENTAÇÃO INTERNA
 * =========================
 */

function garantirAbasControlePipelineWMGJ_V3_() {
  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();

  obterOuCriarAba_(ss, "13_CONTROLE_PIPELINE", [
    "ETAPA",
    "COMPONENTE",
    "STATUS_ATUAL",
    "EVIDENCIA",
    "RISCO",
    "ACAO_CORRETIVA",
    "RESPONSAVEL",
    "SLA",
    "BLOQUEIA_PRODUCAO",
    "ULTIMA_VALIDACAO",
    "OBS"
  ]);

  obterOuCriarAba_(ss, cfg.SHEETS.MEMORIA, cabecalhoMemoriaWMGJ_V3_());
  obterOuCriarAba_(ss, cfg.SHEETS.FILA, cabecalhoFilaWMGJ_V3_());

  return {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    mensagem: "Abas de controle garantidas"
  };
}

function enfileirarArquivosEntradaWMGJ_V3(limite) {
  garantirAbasControlePipelineWMGJ_V3_();

  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();
  var fila = obterOuCriarAba_(ss, cfg.SHEETS.FILA, cabecalhoFilaWMGJ_V3_());
  obterOuCriarAba_(ss, cfg.SHEETS.MEMORIA, cabecalhoMemoriaWMGJ_V3_());

  var pasta = DriveApp.getFolderById(cfg.PASTA_ENTRADA_ID);
  var arquivos = pasta.getFiles();
  var idsNaFila = carregarIdsFilaWMGJ_(fila);

  var lidos = 0;
  var enfileirados = 0;
  var duplicados = 0;
  var max = Number(limite) || 100;

  while (arquivos.hasNext() && lidos < max) {
    var file = arquivos.next();
    lidos++;

    var id = file.getId();
    var nome = file.getName();
    var mime = file.getMimeType();
    var hash = gerarHashArquivoWMGJ_(file);

    if (idsNaFila[id] || documentoJaProcessadoWMGJ_(id, hash)) {
      duplicados++;
      continue;
    }

    fila.appendRow([
      new Date(),
      "DRIVE",
      id,
      nome,
      mime,
      "PENDENTE",
      0,
      "PROCESSAR_ARQUIVO_V3",
      "",
      "Arquivo enfileirado automaticamente pela V3"
    ]);

    idsNaFila[id] = true;
    enfileirados++;
  }

  return {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    pastaEntradaId: cfg.PASTA_ENTRADA_ID,
    lidos: lidos,
    enfileirados: enfileirados,
    duplicados: duplicados
  };
}

function cabecalhoFilaWMGJ_V3_() {
  return [
    "DATA_ENTRADA",
    "ORIGEM",
    "ID_ORIGEM",
    "NOME",
    "TIPO",
    "STATUS",
    "TENTATIVAS",
    "PROXIMA_ACAO",
    "ULTIMO_ERRO",
    "OBSERVACAO"
  ];
}

function cabecalhoMemoriaWMGJ_V3_() {
  return [
    "DATA_REGISTRO",
    "ORIGEM",
    "ID_ORIGEM",
    "NOME_ARQUIVO",
    "MIME_TYPE",
    "HASH",
    "COMPETENCIA",
    "CATEGORIA",
    "STATUS",
    "RESUMO_AI"
  ];
}

function validarDocumentoJsonWMGJ_(entrada) {
  var dados = entrada;

  if (typeof entrada === "string") {
    var limpo = limparRespostaJsonWMGJ_(entrada);
    try {
      dados = JSON.parse(limpo);
    } catch (erro) {
      return {
        ok: false,
        erro: "JSON_PARSE_ERROR: " + (erro.message || String(erro)),
        bruto: entrada
      };
    }
  }

  if (!dados || typeof dados !== "object") {
    return {
      ok: false,
      erro: "JSON_NAO_OBJETO",
      bruto: entrada
    };
  }

  var categorias = {
    financeiro: true,
    produtividade: true,
    contrato: true,
    glosa: true,
    relatorio: true,
    cadastro: true,
    outro: true
  };

  var categoria = String(dados.categoria || "").toLowerCase();
  if (!categoria || !categorias[categoria]) {
    return {
      ok: false,
      erro: "CATEGORIA_INVALIDA",
      dados: dados
    };
  }

  var confianca = Number(dados.confianca);
  if (isNaN(confianca)) {
    dados.confianca = 0;
    confianca = 0;
  }

  if (confianca < 0.6) {
    return {
      ok: false,
      erro: "CONFIANCA_BAIXA",
      dados: dados
    };
  }

  dados.categoria = categoria;

  return {
    ok: true,
    dados: dados
  };
}

function limparRespostaJsonWMGJ_(texto) {
  var t = String(texto || "").trim();

  t = t
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  var inicio = t.indexOf("{");
  var fim = t.lastIndexOf("}");

  if (inicio >= 0 && fim > inicio) {
    return t.substring(inicio, fim + 1);
  }

  return t;
}

function classificarDocumentoComIASeDisponivelWMGJ_(texto, file) {
  if (typeof chamarGeminiWMGJ === "function") {
    return chamarGeminiWMGJ(montarPromptDocumentoWMGJ_(texto, file));
  }

  return classificarDocumentoFallbackWMGJ_(texto, file);
}

function montarPromptDocumentoWMGJ_(texto, file) {
  return [
    "Você é o agente operacional WMGJ.",
    "Retorne APENAS JSON válido com estes campos:",
    "categoria, tipo_documento, data_documento, competencia, valor_total, atendimentos, nome_prestador, cnpj, medico, paciente, descricao, pendencias, nivel_risco, resumo_operacional, destino_drive, aba_planilha_destino, confianca.",
    "Categorias permitidas: financeiro, produtividade, contrato, glosa, relatorio, cadastro, outro.",
    "Nome do arquivo: " + file.getName(),
    "Documento:",
    String(texto || "").slice(0, 12000)
  ].join("\n");
}

function classificarDocumentoFallbackWMGJ_(texto, file) {
  var t = String(texto || "").toLowerCase();
  var nome = file ? file.getName() : "";
  var categoria = "outro";

  if (t.indexOf("nota fiscal") >= 0 || t.indexOf("nf-e") >= 0 || t.indexOf("valor") >= 0 || t.indexOf("r$") >= 0) {
    categoria = "financeiro";
  }

  if (t.indexOf("atendimento") >= 0 || t.indexOf("atendimentos") >= 0 || t.indexOf("consulta") >= 0 || t.indexOf("ecocardiograma") >= 0) {
    categoria = "produtividade";
  }

  if (t.indexOf("contrato") >= 0) {
    categoria = "contrato";
  }

  if (t.indexOf("glosa") >= 0) {
    categoria = "glosa";
  }

  return {
    categoria: categoria,
    tipo_documento: "fallback_sem_ia",
    competencia: extrairCompetenciaTextoWMGJ_(texto) || "",
    valor_total: extrairValorTextoWMGJ_(texto) || 0,
    atendimentos: extrairAtendimentosTextoWMGJ_(texto) || 0,
    descricao: "Classificação local sem IA para " + nome,
    pendencias: categoria === "outro" ? ["Revisar manualmente"] : [],
    nivel_risco: categoria === "outro" ? "medio" : "baixo",
    resumo_operacional: "Documento classificado por fallback local V3",
    destino_drive: "",
    aba_planilha_destino: "14_MEMORIA_BASE_DOCUMENTOS",
    confianca: categoria === "outro" ? 0.6 : 0.75
  };
}

function extrairTextoBasicoArquivoWMGJ_(file) {
  var mime = file.getMimeType();

  if (mime === MimeType.GOOGLE_DOCS) {
    return DocumentApp.openById(file.getId()).getBody().getText();
  }

  if (mime === MimeType.PLAIN_TEXT || mime.indexOf("text/") === 0 || mime.indexOf("csv") >= 0) {
    return file.getBlob().getDataAsString("UTF-8");
  }

  return "NOME_ARQUIVO: " + file.getName() + "\nMIME_TYPE: " + mime + "\nID: " + file.getId();
}

function gerarHashArquivoWMGJ_(file) {
  var base = [
    file.getId(),
    file.getName(),
    file.getSize(),
    file.getLastUpdated().getTime()
  ].join("|");

  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    base,
    Utilities.Charset.UTF_8
  );

  return digest.map(function(byte) {
    var valor = byte < 0 ? byte + 256 : byte;
    var hex = valor.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

function montarChaveDocumentoWMGJ_(idOrigem, hash) {
  return String(idOrigem || "") + "|" + String(hash || "");
}

function carregarControleDocumentosWMGJ_(memoria) {
  var controle = {};

  if (!memoria || memoria.getLastRow() < 2) {
    return controle;
  }

  var dados = memoria.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var id = dados[i][idx.ID_ORIGEM];
    var hash = dados[i][idx.HASH];
    var status = String(dados[i][idx.STATUS] || "").toUpperCase();

    if (id && hash && (status === "PROCESSADO" || status === "DUPLICADO")) {
      controle[montarChaveDocumentoWMGJ_(id, hash)] = true;
    }
  }

  return controle;
}

function carregarIdsFilaWMGJ_(fila) {
  var ids = {};

  if (!fila || fila.getLastRow() < 2) {
    return ids;
  }

  var dados = fila.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var id = dados[i][idx.ID_ORIGEM];
    var status = String(dados[i][idx.STATUS] || "").toUpperCase();

    if (id && status !== "PROCESSADO" && status !== "DUPLICADO") {
      ids[String(id)] = true;
    }
  }

  return ids;
}

function documentoJaProcessadoWMGJ_(idOrigem, hash) {
  var cfg = getConfigWMGJ_();
  var memoria = getPlanilha().getSheetByName(cfg.SHEETS.MEMORIA);
  var controle = carregarControleDocumentosWMGJ_(memoria);
  return !!controle[montarChaveDocumentoWMGJ_(idOrigem, hash)];
}

function registrarDocumentoMemoriaWMGJ_(memoria, doc) {
  memoria.appendRow([
    new Date(),
    doc.origem || "",
    doc.idOrigem || "",
    doc.nome || "",
    doc.mimeType || "",
    doc.hash || "",
    doc.competencia || "",
    doc.categoria || "",
    doc.status || "",
    doc.resumo || ""
  ]);
}

function atualizarLinhaFilaWMGJ_(fila, rowNumber, idx, campos) {
  Object.keys(campos).forEach(function(nome) {
    if (idx[nome] === undefined || idx[nome] < 0) {
      return;
    }
    fila.getRange(rowNumber, idx[nome] + 1).setValue(campos[nome]);
  });
}

function mapearCabecalhoWMGJ_(header) {
  var out = {};
  header.forEach(function(nome, i) {
    out[String(nome || "").trim()] = i;
  });
  return out;
}

function extrairCompetenciaTextoWMGJ_(texto) {
  var t = String(texto || "");
  var m = t.match(/(20\d{2})[-\/](0[1-9]|1[0-2])/);

  if (m) {
    return m[1] + "-" + m[2];
  }

  return "";
}

function extrairValorTextoWMGJ_(texto) {
  var t = String(texto || "");
  var m = t.match(/R\$\s*([0-9\.]+,[0-9]{2})/i);

  if (!m) {
    return 0;
  }

  return Number(m[1].replace(/\./g, "").replace(",", ".")) || 0;
}

function extrairAtendimentosTextoWMGJ_(texto) {
  var t = String(texto || "");
  var m = t.match(/(\d+)\s+atendimentos?/i);

  if (!m) {
    return 0;
  }

  return Number(m[1]) || 0;
}

/**
 * =========================
 * TESTES
 * =========================
 */

function testeValidarJsonIAWMGJ() {
  var casos = [
    {
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
    },
    {
      nome: "JSON_VALIDO_MARKDOWN",
      entrada: "```json\n{\"categoria\":\"produtividade\",\"tipo_documento\":\"relatorio\",\"competencia\":\"2026-04\",\"atendimentos\":12,\"resumo_operacional\":\"Teste\",\"confianca\":0.82}\n```",
      esperado: true
    },
    {
      nome: "CATEGORIA_INVALIDA",
      entrada: { categoria: "banana_contabil", confianca: 0.9 },
      esperado: false
    },
    {
      nome: "CONFIANCA_BAIXA",
      entrada: { categoria: "financeiro", confianca: 0.2 },
      esperado: false
    },
    {
      nome: "JSON_QUEBRADO",
      entrada: "{ categoria: financeiro, confianca: }",
      esperado: false
    }
  ];

  var resultados = casos.map(function(caso) {
    var validacao = validarDocumentoJsonWMGJ_(caso.entrada);
    var passou = validacao.ok === caso.esperado;

    if (!passou) {
      throw new Error("Falha no caso " + caso.nome + ": " + JSON.stringify(validacao));
    }

    return {
      caso: caso.nome,
      ok: validacao.ok,
      erro: validacao.erro || ""
    };
  });

  registrarLogWMGJ_("TESTE_OK", "testeValidarJsonIAWMGJ", "AppsScript", JSON.stringify(resultados));

  return {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    teste: "testeValidarJsonIAWMGJ",
    resultados: resultados
  };
}

function testeDeduplicacaoMemoriaWMGJ_V3() {
  garantirAbasControlePipelineWMGJ_V3_();

  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();
  var memoria = ss.getSheetByName(cfg.SHEETS.MEMORIA);

  var idTeste = "TESTE_DEDUP_WMGJ";
  var hashTeste = "HASH_TESTE_DEDUP_WMGJ_001";

  removerRegistrosPorIdWMGJ_(memoria, idTeste);

  if (documentoJaProcessadoWMGJ_(idTeste, hashTeste)) {
    throw new Error("Deduplicação acusou duplicado antes do registro de teste.");
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
    throw new Error("Deduplicação não reconheceu ID_ORIGEM + HASH após registro.");
  }

  registrarLogWMGJ_(
    "TESTE_OK",
    "testeDeduplicacaoMemoriaWMGJ_V3",
    "AppsScript",
    "Deduplicação validada por ID_ORIGEM + HASH"
  );

  return {
    ok: true,
    versao: WMGJ_PIPELINE_VERSAO,
    teste: "testeDeduplicacaoMemoriaWMGJ_V3",
    criterio: "ID_ORIGEM + HASH",
    duplicadoReconhecido: duplicadoDepois
  };
}

function testeDeduplicacaoMemoriaWMGJ() {
  return testeDeduplicacaoMemoriaWMGJ_V3();
}

function removerRegistrosPorIdWMGJ_(aba, idOrigem) {
  if (!aba || aba.getLastRow() < 2) {
    return 0;
  }

  var dados = aba.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_(dados[0]);
  var removidos = 0;

  for (var i = dados.length - 1; i >= 1; i--) {
    if (String(dados[i][idx.ID_ORIGEM] || "") === String(idOrigem)) {
      aba.deleteRow(i + 1);
      removidos++;
    }
  }

  return removidos;
}
