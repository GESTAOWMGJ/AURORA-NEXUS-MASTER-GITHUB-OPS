/**
 * WMGJ — Camada de extração documental real
 * Versão: v1.1.2-extracao-documental-compat-total
 *
 * Objetivo:
 * - manter a V3 estável intocada;
 * - rodar extração real com Gemini/OCR;
 * - evitar ReferenceError quando algum helper privado do Apps Script não estiver colado.
 *
 * Cole este arquivo inteiro em: 04_EXTRACAO_DOCUMENTAL_WMGJ
 */

var WMGJ_EXTRACAO_VERSAO = "v1.1.2-extracao-documental-compat-total";
var WMGJ_EXTRACAO_PASTA_PADRAO_ID = "1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-";

function executarExtracaoRealWMGJ(limite) {
  return executarExtracaoRealWMGJ_V1(limite || 20);
}

function executarExtracaoRealWMGJ_V1(limite) {
  limite = Number(limite) || 20;

  var preparo = prepararPipelineConfiavelWMGJ_Compat_(limite || 100);
  var processamento = processarFilaComExtracaoRealWMGJ_V1(limite || 20);

  var resultado = {
    ok: true,
    versao: WMGJ_EXTRACAO_VERSAO,
    etapa: "executarExtracaoRealWMGJ_V1",
    preparo: preparo,
    processamento: processamento
  };

  registrarLogWMGJ_Compat_("OK", "executarExtracaoRealWMGJ_V1", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function processarFilaComExtracaoRealWMGJ_V1(limite) {
  garantirAbasControleExtracaoWMGJ_V1_();
  garantirAbaExtracoesDocumentaisWMGJ_V1_();

  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();
  var fila = ss.getSheetByName(cfg.SHEETS.FILA);
  var memoria = ss.getSheetByName(cfg.SHEETS.MEMORIA);

  if (!fila || fila.getLastRow() < 2) {
    var vazio = {
      ok: true,
      versao: WMGJ_EXTRACAO_VERSAO,
      processados: 0,
      erros: 0,
      duplicados: 0,
      revisar: 0,
      mensagem: "Fila vazia"
    };
    registrarLogWMGJ_Compat_("OK", "processarFilaComExtracaoRealWMGJ_V1", "AppsScript", JSON.stringify(vazio));
    return vazio;
  }

  var dados = fila.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Compat_(dados[0]);
  var max = Number(limite) || 20;

  var avaliados = 0;
  var processados = 0;
  var erros = 0;
  var duplicados = 0;
  var revisar = 0;

  for (var i = 1; i < dados.length && avaliados < max; i++) {
    var linha = dados[i];
    var status = String(linha[idx.STATUS] || "").toUpperCase();
    var idOrigem = String(linha[idx.ID_ORIGEM] || "");

    if (status !== "PENDENTE" && status !== "ERRO_REPROCESSAR") {
      continue;
    }

    avaliados++;

    try {
      if (!idOrigem) {
        throw new Error("ID_ORIGEM vazio na fila");
      }

      atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
        STATUS: "EXTRAINDO",
        ULTIMO_ERRO: "",
        OBSERVACAO: "Extração real iniciada"
      });

      var file = DriveApp.getFileById(idOrigem);
      var hash = gerarHashArquivoWMGJ_Compat_(file);

      var jaProcessado = documentoJaProcessadoWMGJ_Compat_(idOrigem, hash);
      var mirrorRequired = firestoreMirrorObrigatorioWMGJ_();
      var mirrorConfirmed = firestoreMirrorJaConfirmadoWMGJ_(idOrigem, hash);
      if (jaProcessado && (!mirrorRequired || mirrorConfirmed)) {
        atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
          STATUS: "DUPLICADO",
          ULTIMO_ERRO: "",
          OBSERVACAO: mirrorConfirmed
            ? "Arquivo já reconhecido por ID_ORIGEM + HASH e Firebase confirmado"
            : "Arquivo já reconhecido por ID_ORIGEM + HASH"
        });
        duplicados++;
        continue;
      }
      if (jaProcessado && mirrorRequired && !mirrorConfirmed) {
        atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
          STATUS: "EXTRAINDO",
          ULTIMO_ERRO: "",
          OBSERVACAO: "Backfill idempotente: memória local existe, Firebase ainda não confirmado"
        });
      }

      var extracao = extrairConteudoArquivoWMGJ_V1_(file);
      registrarExtracaoDocumentalWMGJ_V1_(file, hash, extracao);

      atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
        STATUS: "CLASSIFICANDO",
        OBSERVACAO: "Conteúdo extraído por " + extracao.metodo
      });

      var classificacao = classificarDocumentoGeminiOuFallbackWMGJ_V1_(extracao, file);
      var validacao = validarDocumentoJsonWMGJ_Compat_(classificacao);

      if (!validacao.ok) {
        atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
          STATUS: "REVISAR_HUMANO",
          TENTATIVAS: Number(linha[idx.TENTATIVAS] || 0) + 1,
          ULTIMO_ERRO: validacao.erro,
          OBSERVACAO: "Extração feita, mas classificação JSON exige revisão"
        });
        revisar++;
        continue;
      }

      var firestoreMirror = espelharDocumentoProcessadoFirestoreWMGJ_(file, validacao.dados, extracao);
      if (firestoreMirror.required && !firestoreMirror.ok) {
        registrarFirestoreMirrorWMGJ_(file, hash, firestoreMirror);
        throw new Error("FIRESTORE_MIRROR_REQUIRED:" + firestoreMirror.status);
      }
      if (firestoreMirror.ok) registrarFirestoreMirrorWMGJ_(file, hash, firestoreMirror);

      registrarDocumentoMemoriaWMGJ_Compat_(memoria, {
        origem: "DRIVE_EXTRACAO_REAL",
        idOrigem: idOrigem,
        nome: file.getName(),
        mimeType: file.getMimeType(),
        hash: hash,
        competencia: validacao.dados.competencia || "",
        categoria: validacao.dados.categoria || "outro",
        status: "PROCESSADO",
        resumo: montarResumoMemoriaExtracaoWMGJ_V1_(validacao.dados, extracao)
      });

      atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
        STATUS: "PROCESSADO",
        ULTIMO_ERRO: "",
        OBSERVACAO: "Extração real + classificação + memória-base OK; Firebase=" + firestoreMirror.status
      });

      processados++;

    } catch (erro) {
      atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
        STATUS: "ERRO_REPROCESSAR",
        TENTATIVAS: Number(linha[idx.TENTATIVAS] || 0) + 1,
        ULTIMO_ERRO: erro && erro.message ? erro.message : String(erro),
        OBSERVACAO: "Falha isolada na extração real; lote continua"
      });
      erros++;
    }
  }

  var resultado = {
    ok: true,
    versao: WMGJ_EXTRACAO_VERSAO,
    etapa: "processarFilaComExtracaoRealWMGJ_V1",
    avaliados: avaliados,
    processados: processados,
    erros: erros,
    duplicados: duplicados,
    revisar: revisar
  };

  registrarLogWMGJ_Compat_("OK", "processarFilaComExtracaoRealWMGJ_V1", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function firestoreMirrorObrigatorioWMGJ_() {
  return String(PropertiesService.getScriptProperties().getProperty("AURORA_FIRESTORE_MIRROR_REQUIRED") || "false").toLowerCase() === "true";
}

function garantirAbaFirestoreMirrorWMGJ_() {
  var ss = getPlanilhaWMGJ_Compat_();
  return obterOuCriarAbaWMGJ_Compat_(ss, "17_FIRESTORE_MIRROR", [
    "DATA",
    "ID_ORIGEM",
    "HASH",
    "STATUS",
    "ENTITY_ID",
    "EVENT_ID",
    "REQUIRED"
  ]);
}

function registrarFirestoreMirrorWMGJ_(file, hash, mirror) {
  var aba = garantirAbaFirestoreMirrorWMGJ_();
  aba.appendRow([
    new Date(),
    file.getId(),
    hash,
    mirror && mirror.status || "UNKNOWN",
    mirror && mirror.entityId || "",
    mirror && mirror.eventId || "",
    !!(mirror && mirror.required)
  ]);
}

function firestoreMirrorJaConfirmadoWMGJ_(idOrigem, hash) {
  var ss = getPlanilhaWMGJ_Compat_();
  var aba = ss.getSheetByName("17_FIRESTORE_MIRROR");
  if (!aba || aba.getLastRow() < 2) return false;
  var values = aba.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Compat_(values[0]);
  for (var i = values.length - 1; i >= 1; i--) {
    if (
      String(values[i][idx.ID_ORIGEM] || "") === String(idOrigem || "")
      && String(values[i][idx.HASH] || "") === String(hash || "")
    ) {
      var status = String(values[i][idx.STATUS] || "").toUpperCase();
      return status === "ACCEPTED" || status === "DUPLICATE_CONFIRMED";
    }
  }
  return false;
}

function espelharDocumentoProcessadoFirestoreWMGJ_(file, dados, extracao) {
  var props = PropertiesService.getScriptProperties();
  var required = String(props.getProperty("AURORA_FIRESTORE_MIRROR_REQUIRED") || "false").toLowerCase() === "true";

  if (typeof wmgjFirestoreEventoArquivo_ !== "function" || typeof wmgjFirestoreEnviarEvento_ !== "function") {
    return { ok: !required, required: required, status: "BRIDGE_UNAVAILABLE" };
  }

  try {
    var classification = JSON.parse(JSON.stringify(dados || {}));
    classification.status = "PROCESSADO";
    classification.metodo_extracao = String(extracao && extracao.metodo || "");
    var event = wmgjFirestoreEventoArquivo_(file, classification, {
      sourceContext: "drive-continuous-extraction",
      pipelineVersion: WMGJ_EXTRACAO_VERSAO
    });
    var response = wmgjFirestoreEnviarEvento_(event);
    if (response && (response.accepted === true || response.duplicate === true)) {
      return {
        ok: true,
        required: required,
        status: response.duplicate === true ? "DUPLICATE_CONFIRMED" : "ACCEPTED",
        entityId: response.entityId || "",
        eventId: response.eventId || event.eventId
      };
    }
    if (response && response.dryRun === true) {
      return { ok: !required, required: required, status: "DRY_RUN" };
    }
    return { ok: false, required: required, status: "UNCONFIRMED" };
  } catch (error) {
    return {
      ok: false,
      required: required,
      status: "ERROR",
      error: error && error.message ? String(error.message).slice(0, 240) : "unknown"
    };
  }
}

function extrairConteudoArquivoWMGJ_V1_(file) {
  var mime = file.getMimeType();
  var resultado = {
    ok: true,
    versao: WMGJ_EXTRACAO_VERSAO,
    arquivoId: file.getId(),
    nome: file.getName(),
    mimeType: mime,
    metodo: "metadata_fallback",
    texto: "",
    tamanhoTexto: 0,
    observacao: ""
  };

  try {
    if (mime === MimeType.GOOGLE_DOCS) {
      resultado.metodo = "google_docs_text";
      resultado.texto = DocumentApp.openById(file.getId()).getBody().getText();
      resultado.tamanhoTexto = resultado.texto.length;
      return resultado;
    }

    if (mime === MimeType.GOOGLE_SHEETS) {
      resultado.metodo = "google_sheets_values";
      resultado.texto = extrairTextoGoogleSheetsWMGJ_V1_(file.getId());
      resultado.tamanhoTexto = resultado.texto.length;
      return resultado;
    }

    if (mime === MimeType.PLAIN_TEXT || mime.indexOf("text/") === 0 || mime.indexOf("csv") >= 0 || mime.indexOf("json") >= 0) {
      resultado.metodo = "blob_text";
      resultado.texto = file.getBlob().getDataAsString("UTF-8");
      resultado.tamanhoTexto = resultado.texto.length;
      return resultado;
    }

    if (mime === MimeType.PDF || mime.indexOf("pdf") >= 0 || mime.indexOf("image/") === 0 || mime.indexOf("officedocument") >= 0 || mime.indexOf("ms-excel") >= 0 || mime.indexOf("msword") >= 0) {
      var convertido = converterArquivoParaGoogleDocWMGJ_V1_(file);
      if (convertido.ok && convertido.texto) {
        resultado.metodo = convertido.metodo;
        resultado.texto = convertido.texto;
        resultado.tamanhoTexto = convertido.texto.length;
        resultado.observacao = convertido.observacao || "";
        return resultado;
      }
      resultado.observacao = convertido.erro || "Conversão não retornou texto";
    }
  } catch (erro) {
    resultado.ok = false;
    resultado.observacao = erro && erro.message ? erro.message : String(erro);
  }

  resultado.texto = [
    "NOME_ARQUIVO: " + file.getName(),
    "MIME_TYPE: " + mime,
    "ID: " + file.getId(),
    "OBS: " + resultado.observacao
  ].join("\n");

  resultado.tamanhoTexto = resultado.texto.length;
  return resultado;
}

function converterArquivoParaGoogleDocWMGJ_V1_(file) {
  if (typeof Drive === "undefined" || !Drive.Files || typeof Drive.Files.copy !== "function") {
    return {
      ok: false,
      metodo: "drive_api_indisponivel",
      erro: "Serviço avançado Drive API não habilitado no Apps Script"
    };
  }

  var copiaId = "";

  try {
    var resource = {
      title: "WMGJ_OCR_TMP_" + file.getName(),
      mimeType: MimeType.GOOGLE_DOCS
    };

    var copia = Drive.Files.copy(resource, file.getId(), {
      ocr: true,
      ocrLanguage: "pt"
    });

    copiaId = copia.id;
    Utilities.sleep(1500);

    var texto = DocumentApp.openById(copiaId).getBody().getText();

    try {
      DriveApp.getFileById(copiaId).setTrashed(true);
    } catch (erroTrash) {}

    return {
      ok: true,
      metodo: "drive_api_ocr_convert",
      texto: texto || "",
      observacao: "Arquivo convertido temporariamente para Google Docs e removido após leitura"
    };

  } catch (erro) {
    if (copiaId) {
      try {
        DriveApp.getFileById(copiaId).setTrashed(true);
      } catch (erroTrash2) {}
    }

    return {
      ok: false,
      metodo: "drive_api_ocr_convert",
      erro: erro && erro.message ? erro.message : String(erro)
    };
  }
}

function extrairTextoGoogleSheetsWMGJ_V1_(spreadsheetId) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var partes = [];

  ss.getSheets().forEach(function(sheet) {
    var dados = sheet.getDataRange().getDisplayValues();
    partes.push("ABA: " + sheet.getName());

    dados.slice(0, 200).forEach(function(linha) {
      partes.push(linha.join(" | "));
    });
  });

  return partes.join("\n");
}

function classificarDocumentoGeminiOuFallbackWMGJ_V1_(extracao, file) {
  if (typeof classificarDocumentoGeminiWMGJ_V1 === "function") {
    return classificarDocumentoGeminiWMGJ_V1(extracao, file);
  }

  return classificarDocumentoFallbackLocalWMGJ_V1_(extracao.texto || "", file);
}

function classificarDocumentoFallbackLocalWMGJ_V1_(texto, file) {
  texto = String(texto || "");
  var lower = texto.toLowerCase();
  var categoria = "outro";

  if (lower.indexOf("glosa") >= 0) categoria = "glosa";
  else if (lower.indexOf("contrato") >= 0) categoria = "contrato";
  else if (lower.indexOf("atendimento") >= 0 || lower.indexOf("produtividade") >= 0) categoria = "produtividade";
  else if (lower.indexOf("r$") >= 0 || lower.indexOf("valor") >= 0 || lower.indexOf("pagamento") >= 0 || lower.indexOf("receita") >= 0) categoria = "financeiro";
  else if (lower.indexOf("relatório") >= 0 || lower.indexOf("relatorio") >= 0) categoria = "relatorio";

  var valor = extrairValorMonetarioWMGJ_V1_(texto);
  var atendimentos = extrairNumeroAtendimentosWMGJ_V1_(texto);
  var competencia = extrairCompetenciaWMGJ_V1_(texto);
  var confianca = categoria !== "outro" || valor > 0 || atendimentos > 0 ? 0.62 : 0.4;

  return {
    categoria: categoria,
    tipo_documento: "classificacao_fallback_local",
    data_documento: "",
    competencia: competencia,
    valor_total: valor,
    atendimentos: atendimentos,
    nome_prestador: "",
    cnpj: "",
    medico: "",
    paciente: "",
    descricao: "Classificação local por fallback. Gemini indisponível ou não carregado.",
    pendencias: [],
    nivel_risco: confianca >= 0.6 ? "baixo" : "medio",
    resumo_operacional: String(texto || "").slice(0, 500),
    destino_drive: "",
    aba_planilha_destino: "",
    confianca: confianca,
    origem_classificacao: "fallback_local"
  };
}

function extrairValorMonetarioWMGJ_V1_(texto) {
  var match = String(texto || "").match(/R\$\s*([0-9\.]+,[0-9]{2})/i);
  if (!match) return 0;
  var normalizado = match[1].replace(/\./g, "").replace(",", ".");
  var valor = Number(normalizado);
  return isNaN(valor) ? 0 : valor;
}

function extrairNumeroAtendimentosWMGJ_V1_(texto) {
  var t = String(texto || "");
  var match = t.match(/(\d{1,6})\s+atendimentos?/i) || t.match(/atendimentos?\D+(\d{1,6})/i);
  if (!match) return 0;
  var n = Number(match[1]);
  return isNaN(n) ? 0 : n;
}

function extrairCompetenciaWMGJ_V1_(texto) {
  var t = String(texto || "");
  var direta = t.match(/(20\d{2})[-\/](0[1-9]|1[0-2])/);
  if (direta) return direta[1] + "-" + direta[2];

  var meses = {
    janeiro: "01",
    fevereiro: "02",
    marco: "03",
    março: "03",
    abril: "04",
    maio: "05",
    junho: "06",
    julho: "07",
    agosto: "08",
    setembro: "09",
    outubro: "10",
    novembro: "11",
    dezembro: "12"
  };

  var lower = t.toLowerCase();
  for (var nome in meses) {
    var re = new RegExp(nome + "\\s+(20\\d{2})", "i");
    var m = lower.match(re);
    if (m) return m[1] + "-" + meses[nome];
  }

  return "";
}

function validarDocumentoJsonWMGJ_Compat_(entrada) {
  if (typeof validarDocumentoJsonWMGJ_ === "function") {
    try {
      return validarDocumentoJsonWMGJ_(entrada);
    } catch (erroValidadorOriginal) {}
  }

  var dados = entrada;

  if (typeof dados === "string") {
    try {
      dados = JSON.parse(limparRespostaJsonWMGJ_Compat_(dados));
    } catch (erroParse) {
      return {
        ok: false,
        erro: "JSON_PARSE_ERROR: " + (erroParse.message || String(erroParse)),
        dados: null
      };
    }
  }

  if (!dados || typeof dados !== "object") {
    return {
      ok: false,
      erro: "JSON_INVALIDO",
      dados: null
    };
  }

  var permitidas = {
    financeiro: true,
    produtividade: true,
    contrato: true,
    glosa: true,
    relatorio: true,
    cadastro: true,
    outro: true
  };

  dados.categoria = String(dados.categoria || "outro").toLowerCase();

  if (!permitidas[dados.categoria]) {
    return {
      ok: false,
      erro: "CATEGORIA_INVALIDA",
      dados: dados
    };
  }

  dados.confianca = Number(dados.confianca || 0);

  if (dados.confianca < 0.6) {
    return {
      ok: false,
      erro: "CONFIANCA_BAIXA",
      dados: dados
    };
  }

  return {
    ok: true,
    erro: "",
    dados: dados
  };
}

function limparRespostaJsonWMGJ_Compat_(texto) {
  texto = String(texto || "").trim();
  texto = texto.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  var inicio = texto.indexOf("{");
  var fim = texto.lastIndexOf("}");
  if (inicio >= 0 && fim > inicio) return texto.slice(inicio, fim + 1);
  return texto;
}

function montarResumoMemoriaExtracaoWMGJ_V1_(dados, extracao) {
  var resumo = {
    versao_extracao: WMGJ_EXTRACAO_VERSAO,
    metodo_extracao: extracao.metodo,
    tamanho_texto: extracao.tamanhoTexto,
    categoria: dados.categoria || "",
    tipo_documento: dados.tipo_documento || "",
    competencia: dados.competencia || "",
    valor_total: dados.valor_total || 0,
    atendimentos: dados.atendimentos || 0,
    confianca: dados.confianca || 0,
    origem_classificacao: dados.origem_classificacao || "",
    resumo_operacional: dados.resumo_operacional || dados.descricao || ""
  };

  return JSON.stringify(resumo);
}

function diagnosticarExtracaoRealWMGJ_V1() {
  var gemini = typeof diagnosticarGeminiWMGJ_V1 === "function"
    ? diagnosticarGeminiWMGJ_V1()
    : {
        ok: false,
        configurado: false,
        erro: "diagnosticarGeminiWMGJ_V1 indisponivel"
      };

  var driveApi = typeof Drive !== "undefined" && !!Drive.Files;
  var pasta = diagnosticarPastaEntradaWMGJ_Compat_();
  var cfg = getConfigWMGJ_Compat_();

  var resultado = {
    ok: true,
    versao: WMGJ_EXTRACAO_VERSAO,
    pastaEntrada: pasta,
    gemini: gemini,
    driveApiAvancadoDisponivel: driveApi,
    abas: {
      fila: cfg.SHEETS.FILA,
      memoria: cfg.SHEETS.MEMORIA,
      extracoes: "16_EXTRACOES_DOCUMENTAIS"
    }
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  registrarLogWMGJ_Compat_("DIAGNOSTICO", "diagnosticarExtracaoRealWMGJ_V1", "AppsScript", JSON.stringify({
    ok: resultado.ok,
    geminiConfigurado: !!(gemini && gemini.configurado),
    driveApiAvancadoDisponivel: driveApi
  }));

  return resultado;
}

function prepararPipelineConfiavelWMGJ_Compat_(limite) {
  if (typeof prepararPipelineConfiavelWMGJ_V3 === "function") {
    return prepararPipelineConfiavelWMGJ_V3(limite || 100);
  }

  return prepararPipelineConfiavelWMGJ_Local_(limite || 100);
}

function prepararPipelineConfiavelWMGJ_Local_(limite) {
  garantirAbasControleExtracaoWMGJ_V1_();

  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();
  var fila = ss.getSheetByName(cfg.SHEETS.FILA);
  var pastaId = obterPastaEntradaIdWMGJ_Compat_();
  var pasta = DriveApp.getFolderById(pastaId);
  var files = pasta.getFiles();

  var existentes = carregarIdsFilaWMGJ_Compat_(fila);
  var lidos = 0;
  var enfileirados = 0;
  var duplicados = 0;
  var max = Number(limite) || 100;

  while (files.hasNext() && lidos < max) {
    var file = files.next();
    lidos++;

    if (existentes[file.getId()]) {
      duplicados++;
      continue;
    }

    fila.appendRow([
      new Date(),
      "DRIVE",
      file.getId(),
      file.getName(),
      file.getMimeType(),
      "PENDENTE",
      0,
      "EXTRAIR_CONTEUDO",
      "",
      "Enfileirado por compat local"
    ]);

    existentes[file.getId()] = true;
    enfileirados++;
  }

  var resultado = {
    ok: true,
    etapa: "prepararPipelineConfiavelWMGJ_Local_",
    resultado: {
      ok: true,
      pastaEntradaId: pastaId,
      pastaEntradaNome: pasta.getName(),
      lidos: lidos,
      enfileirados: enfileirados,
      duplicados: duplicados
    }
  };

  registrarLogWMGJ_Compat_("OK", "prepararPipelineConfiavelWMGJ_Local_", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function diagnosticarPastaEntradaWMGJ_Compat_() {
  if (typeof diagnosticarPastaEntradaWMGJ_V3 === "function") {
    try {
      return diagnosticarPastaEntradaWMGJ_V3();
    } catch (erroDiagOriginal) {}
  }

  try {
    var pastaId = obterPastaEntradaIdWMGJ_Compat_();
    var pasta = DriveApp.getFolderById(pastaId);
    return {
      ok: true,
      pastaId: pastaId,
      nome: pasta.getName()
    };
  } catch (erro) {
    return {
      ok: false,
      pastaId: obterPastaEntradaIdWMGJ_Compat_(),
      erro: erro && erro.message ? erro.message : String(erro)
    };
  }
}

function obterPastaEntradaIdWMGJ_Compat_() {
  var props = PropertiesService.getScriptProperties();
  var propId = props.getProperty("WMGJ_PASTA_ENTRADA_ID");
  if (propId) return propId;

  var cfg = getConfigWMGJ_Compat_();

  if (cfg.PASTA_ENTRADA_ID) return cfg.PASTA_ENTRADA_ID;
  if (cfg.FOLDER_ID_ENTRADA) return cfg.FOLDER_ID_ENTRADA;
  if (cfg.PASTAS && cfg.PASTAS.ENTRADA) return cfg.PASTAS.ENTRADA;
  if (cfg.FOLDERS && cfg.FOLDERS.ENTRADA) return cfg.FOLDERS.ENTRADA;

  return WMGJ_EXTRACAO_PASTA_PADRAO_ID;
}

function garantirAbasControleExtracaoWMGJ_V1_() {
  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();

  obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.LOG, [
    "DATA",
    "STATUS",
    "FUNCAO",
    "ORIGEM",
    "MENSAGEM"
  ]);

  obterOuCriarAbaWMGJ_Compat_(ss, "13_CONTROLE_PIPELINE", [
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

  obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.MEMORIA, cabecalhoMemoriaExtracaoWMGJ_V1_());
  obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.FILA, cabecalhoFilaExtracaoWMGJ_V1_());

  return {
    ok: true,
    versao: WMGJ_EXTRACAO_VERSAO,
    mensagem: "Abas de controle da extração garantidas por compatibilidade local"
  };
}

function garantirAbaExtracoesDocumentaisWMGJ_V1_() {
  var ss = getPlanilhaWMGJ_Compat_();
  return obterOuCriarAbaWMGJ_Compat_(ss, "16_EXTRACOES_DOCUMENTAIS", [
    "DATA_EXTRACAO",
    "VERSAO",
    "ID_ORIGEM",
    "NOME_ARQUIVO",
    "MIME_TYPE",
    "HASH",
    "METODO_EXTRACAO",
    "TAMANHO_TEXTO",
    "STATUS",
    "OBSERVACAO",
    "AMOSTRA_TEXTO"
  ]);
}

function registrarExtracaoDocumentalWMGJ_V1_(file, hash, extracao) {
  var aba = garantirAbaExtracoesDocumentaisWMGJ_V1_();

  aba.appendRow([
    new Date(),
    WMGJ_EXTRACAO_VERSAO,
    file.getId(),
    file.getName(),
    file.getMimeType(),
    hash,
    extracao.metodo,
    extracao.tamanhoTexto || 0,
    extracao.ok ? "OK" : "FALLBACK",
    extracao.observacao || "",
    String(extracao.texto || "").slice(0, 2000)
  ]);
}

function registrarDocumentoMemoriaWMGJ_Compat_(memoria, doc) {
  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();
  memoria = memoria || ss.getSheetByName(cfg.SHEETS.MEMORIA);
  memoria = memoria || obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.MEMORIA, cabecalhoMemoriaExtracaoWMGJ_V1_());

  memoria.appendRow([
    new Date(),
    doc.origem || "",
    doc.idOrigem || "",
    doc.nome || "",
    doc.mimeType || "",
    doc.hash || "",
    doc.competencia || "",
    doc.categoria || "outro",
    doc.status || "PROCESSADO",
    doc.resumo || ""
  ]);
}

function documentoJaProcessadoWMGJ_Compat_(idOrigem, hash) {
  if (typeof documentoJaProcessadoWMGJ_ === "function") {
    try {
      return documentoJaProcessadoWMGJ_(idOrigem, hash);
    } catch (erroDedupOriginal) {}
  }

  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();
  var memoria = ss.getSheetByName(cfg.SHEETS.MEMORIA);

  if (!memoria || memoria.getLastRow() < 2) return false;

  var dados = memoria.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Compat_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var mesmoId = String(dados[i][idx.ID_ORIGEM] || "") === String(idOrigem || "");
    var mesmoHash = String(dados[i][idx.HASH] || "") === String(hash || "");
    var status = String(dados[i][idx.STATUS] || "").toUpperCase();

    if (mesmoId && mesmoHash && status === "PROCESSADO") {
      return true;
    }
  }

  return false;
}

function gerarHashArquivoWMGJ_Compat_(file) {
  if (typeof gerarHashArquivoWMGJ_ === "function") {
    try {
      return gerarHashArquivoWMGJ_(file);
    } catch (erroHashOriginal) {}
  }

  try {
    var bytes = file.getBlob().getBytes();
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes);
    return digest.map(function(byte) {
      var v = (byte < 0 ? byte + 256 : byte).toString(16);
      return v.length === 1 ? "0" + v : v;
    }).join("");
  } catch (erro) {
    return [file.getId(), file.getName(), file.getLastUpdated().getTime()].join("|");
  }
}

function atualizarLinhaFilaWMGJ_Compat_(sheet, rowNumber, idx, campos) {
  Object.keys(campos).forEach(function(nomeCampo) {
    if (idx[nomeCampo] === undefined || idx[nomeCampo] === null || idx[nomeCampo] < 0) return;
    sheet.getRange(rowNumber, idx[nomeCampo] + 1).setValue(campos[nomeCampo]);
  });
}

function carregarIdsFilaWMGJ_Compat_(fila) {
  var mapa = {};
  if (!fila || fila.getLastRow() < 2) return mapa;

  var dados = fila.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Compat_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var id = String(dados[i][idx.ID_ORIGEM] || "");
    if (id) mapa[id] = true;
  }

  return mapa;
}

function mapearCabecalhoWMGJ_Compat_(headers) {
  var mapa = {};
  headers = headers || [];

  for (var i = 0; i < headers.length; i++) {
    var chave = String(headers[i] || "").trim();
    if (chave) mapa[chave] = i;
  }

  return mapa;
}

function obterOuCriarAbaWMGJ_Compat_(ss, nome, cabecalho) {
  var sheet = ss.getSheetByName(nome);
  if (!sheet) {
    sheet = ss.insertSheet(nome);
  }

  cabecalho = cabecalho || [];

  if (cabecalho.length > 0) {
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
    } else {
      garantirCabecalhosMinimosWMGJ_Compat_(sheet, cabecalho);
    }
  }

  return sheet;
}

function garantirCabecalhosMinimosWMGJ_Compat_(sheet, cabecalhoNecessario) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var atual = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var existentes = {};

  atual.forEach(function(h) {
    existentes[String(h || "").trim()] = true;
  });

  var faltantes = [];
  cabecalhoNecessario.forEach(function(h) {
    if (!existentes[h]) faltantes.push(h);
  });

  if (faltantes.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, faltantes.length).setValues([faltantes]);
  }
}

function getConfigWMGJ_Compat_() {
  var cfg = {};

  if (typeof getConfigWMGJ_ === "function") {
    try {
      cfg = getConfigWMGJ_() || {};
    } catch (erroConfigOriginal) {
      cfg = {};
    }
  }

  cfg.SHEETS = cfg.SHEETS || {};
  cfg.SHEETS.LOG = cfg.SHEETS.LOG || "10_LOG_AUTOMACAO";
  cfg.SHEETS.CONTROLE = cfg.SHEETS.CONTROLE || "13_CONTROLE_PIPELINE";
  cfg.SHEETS.MEMORIA = cfg.SHEETS.MEMORIA || "14_MEMORIA_BASE_DOCUMENTOS";
  cfg.SHEETS.FILA = cfg.SHEETS.FILA || "15_FILA_PROCESSAMENTO";

  return cfg;
}

function getPlanilhaWMGJ_Compat_() {
  if (typeof getPlanilha === "function") {
    try {
      var original = getPlanilha();
      if (original) return original;
    } catch (erroPlanilhaOriginal) {}
  }

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("WMGJ_SPREADSHEET_ID");
  if (id) return SpreadsheetApp.openById(id);

  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (!ativa) {
    throw new Error("PLANILHA_NAO_ENCONTRADA: vincule o Apps Script à planilha ou defina WMGJ_SPREADSHEET_ID");
  }

  return ativa;
}

function registrarLogWMGJ_Compat_(status, funcao, origem, mensagem) {
  if (typeof registrarLogWMGJ_ === "function") {
    try {
      registrarLogWMGJ_(status, funcao, origem, mensagem);
      return;
    } catch (erroLogOriginal) {}
  }

  try {
    var cfg = getConfigWMGJ_Compat_();
    var ss = getPlanilhaWMGJ_Compat_();
    var log = obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.LOG, [
      "DATA",
      "STATUS",
      "FUNCAO",
      "ORIGEM",
      "MENSAGEM"
    ]);

    log.appendRow([
      new Date(),
      status || "INFO",
      funcao || "",
      origem || "AppsScript",
      mensagem || ""
    ]);
  } catch (erro) {
    Logger.log("LOG_FALLBACK: " + [status, funcao, origem, mensagem].join(" | "));
  }
}

function cabecalhoFilaExtracaoWMGJ_V1_() {
  return [
    "DATA_ENTRADA",
    "ORIGEM",
    "ID_ORIGEM",
    "NOME_ARQUIVO",
    "MIME_TYPE",
    "STATUS",
    "TENTATIVAS",
    "PROXIMA_ACAO",
    "ULTIMO_ERRO",
    "OBSERVACAO"
  ];
}

function cabecalhoMemoriaExtracaoWMGJ_V1_() {
  return [
    "DATA_PROCESSAMENTO",
    "ORIGEM",
    "ID_ORIGEM",
    "NOME_ARQUIVO",
    "MIME_TYPE",
    "HASH",
    "COMPETENCIA",
    "CATEGORIA",
    "STATUS",
    "RESUMO"
  ];
}

function rodarDiagnosticoExtracaoRealWMGJ() {
  return diagnosticarExtracaoRealWMGJ_V1();
}

function rodarExtracaoRealWMGJ_5() {
  return executarExtracaoRealWMGJ_V1(5);
}