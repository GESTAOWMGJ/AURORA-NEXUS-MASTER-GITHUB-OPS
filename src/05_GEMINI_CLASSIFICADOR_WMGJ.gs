/**
 * WMGJ — Classificador Gemini
 * Versão: v1.2.0-gemini-api-validada
 *
 * Não grava dados diretamente em planilhas.
 * Lê a configuração exclusivamente de Script Properties.
 * Mantém fallback local quando a API estiver indisponível.
 * Nunca registra ou retorna a chave da API.
 *
 * Script Properties:
 * GEMINI_API_KEY = chave da API
 * GEMINI_MODEL = modelo validado no projeto
 */

var WMGJ_GEMINI_VERSAO = "v1.2.0-gemini-api-validada";
var WMGJ_GEMINI_MODELO_PADRAO = "gemini-3.5-flash";

function diagnosticarGeminiWMGJ_V1() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = String(props.getProperty("GEMINI_API_KEY") || "").trim();
  var model = normalizarModeloGeminiWMGJ_(
    props.getProperty("GEMINI_MODEL") || WMGJ_GEMINI_MODELO_PADRAO
  );

  var resultado = {
    ok: true,
    versao: WMGJ_GEMINI_VERSAO,
    configurado: apiKey.length > 0,
    modelo: model,
    mensagem: apiKey
      ? "Gemini configurado nas Propriedades do script"
      : "GEMINI_API_KEY ausente nas Propriedades do script"
  };

  Logger.log(JSON.stringify(resultado));
  return resultado;
}

function classificarDocumentoGeminiWMGJ_V1(extracao, file) {
  extracao = extracao || {};

  var diag = diagnosticarGeminiWMGJ_V1();
  var textoFallback = String(extracao.texto || "");

  if (!diag.configurado) {
    registrarLogGeminiWMGJ_(
      "AVISO",
      "classificarDocumentoGeminiWMGJ_V1",
      "Gemini sem chave; usando fallback local"
    );

    return aplicarMetadadosFallbackGeminiWMGJ_(
      classificarDocumentoFallbackWMGJ_(textoFallback, file),
      "GEMINI_API_KEY_NAO_CONFIGURADA"
    );
  }

  try {
    var prompt = montarPromptGeminiDocumentoWMGJ_V1_(extracao, file);
    var resposta = chamarGeminiWMGJ(prompt);
    var limpo = limparRespostaJsonWMGJ_(resposta);
    var dados = JSON.parse(limpo);
    var validacao = validarDocumentoJsonWMGJ_(dados);

    if (!validacao || validacao.ok !== true) {
      throw new Error(
        "GEMINI_JSON_REPROVADO: " +
        JSON.stringify(validacao || {}).slice(0, 700)
      );
    }

    dados = validacao.dados || dados;
    dados.origem_classificacao = "gemini";
    dados.modelo = diag.modelo;
    dados.versao_classificador = WMGJ_GEMINI_VERSAO;

    registrarLogGeminiWMGJ_(
      "OK",
      "classificarDocumentoGeminiWMGJ_V1",
      JSON.stringify({
        origem: "gemini",
        modelo: diag.modelo,
        categoria: dados.categoria || "",
        confianca: Number(dados.confianca || 0)
      })
    );

    return dados;

  } catch (erro) {
    var mensagem = sanitizarErroGeminiWMGJ_(erro);

    registrarLogGeminiWMGJ_(
      "ERRO",
      "classificarDocumentoGeminiWMGJ_V1",
      mensagem
    );

    return aplicarMetadadosFallbackGeminiWMGJ_(
      classificarDocumentoFallbackWMGJ_(textoFallback, file),
      mensagem
    );
  }
}

function chamarGeminiWMGJ(prompt) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = String(props.getProperty("GEMINI_API_KEY") || "").trim();
  var model = normalizarModeloGeminiWMGJ_(
    props.getProperty("GEMINI_MODEL") || WMGJ_GEMINI_MODELO_PADRAO
  );

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_NAO_CONFIGURADA");
  }

  var url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  var payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: String(prompt || "") }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: 2048,
      responseMimeType: "application/json"
    }
  };

  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(
      "GEMINI_HTTP_" + code + ": " + extrairErroGeminiWMGJ_(body)
    );
  }

  var json = JSON.parse(body);
  var parts =
    json &&
    json.candidates &&
    json.candidates[0] &&
    json.candidates[0].content &&
    json.candidates[0].content.parts
      ? json.candidates[0].content.parts
      : [];

  var text = parts.map(function(part) {
    return part && part.text ? String(part.text) : "";
  }).join("\n").trim();

  if (!text) {
    throw new Error(
      "GEMINI_RESPOSTA_SEM_TEXTO: " + body.slice(0, 700)
    );
  }

  return text;
}

function montarPromptGeminiDocumentoWMGJ_V1_(extracao, file) {
  var texto = String((extracao && extracao.texto) || "").slice(0, 24000);
  var nome = file && typeof file.getName === "function"
    ? file.getName()
    : ((extracao && extracao.nome) || "");
  var mime = file && typeof file.getMimeType === "function"
    ? file.getMimeType()
    : ((extracao && extracao.mimeType) || "");

  return [
    "Você é o agente operacional documental da WMGJ.",
    "Retorne APENAS JSON válido, sem markdown e sem explicação externa.",
    "Não invente dados ausentes.",
    "Categorias: financeiro, produtividade, contrato, glosa, relatorio, cadastro, outro.",
    "A confiança deve ser número entre 0 e 1.",
    "Use confiança abaixo de 0.6 quando a conclusão não for segura.",
    "Campos obrigatórios:",
    "{",
    "  \"categoria\": \"financeiro|produtividade|contrato|glosa|relatorio|cadastro|outro\",",
    "  \"tipo_documento\": \"\",",
    "  \"data_documento\": \"YYYY-MM-DD ou vazio\",",
    "  \"competencia\": \"YYYY-MM ou vazio\",",
    "  \"valor_total\": 0,",
    "  \"atendimentos\": 0,",
    "  \"nome_prestador\": \"\",",
    "  \"cnpj\": \"\",",
    "  \"medico\": \"\",",
    "  \"paciente\": \"\",",
    "  \"descricao\": \"\",",
    "  \"pendencias\": [],",
    "  \"nivel_risco\": \"baixo|medio|alto\",",
    "  \"resumo_operacional\": \"\",",
    "  \"destino_drive\": \"\",",
    "  \"aba_planilha_destino\": \"\",",
    "  \"confianca\": 0",
    "}",
    "Nome do arquivo: " + nome,
    "MIME type: " + mime,
    "Método de extração: " + ((extracao && extracao.metodo) || ""),
    "Texto extraído:",
    texto
  ].join("\n");
}

function testeGeminiClassificadorWMGJ_V1() {
  var fakeFile = {
    getName: function() { return "TESTE_GEMINI_WMGJ.txt"; },
    getMimeType: function() { return "text/plain"; }
  };

  var extracao = {
    texto: "Relatório de produtividade WMGJ. Competência 2026-04. Foram realizados 42 atendimentos. Valor total R$ 4.200,00.",
    metodo: "teste_texto",
    tamanhoTexto: 116
  };

  var dados = classificarDocumentoGeminiWMGJ_V1(extracao, fakeFile);
  var validacao = validarDocumentoJsonWMGJ_(dados);

  var resultado = {
    ok: validacao.ok === true && dados.origem_classificacao === "gemini",
    versao: WMGJ_GEMINI_VERSAO,
    origem_classificacao: dados.origem_classificacao || "",
    modelo: dados.modelo || diagnosticarGeminiWMGJ_V1().modelo,
    dados: dados,
    validacao: validacao
  };

  registrarLogGeminiWMGJ_(
    resultado.ok ? "TESTE_OK" : "ERRO",
    "testeGeminiClassificadorWMGJ_V1",
    JSON.stringify(resultado)
  );

  Logger.log(JSON.stringify(resultado));
  return resultado;
}

function testeDiretoGeminiWMGJ() {
  var resposta = chamarGeminiWMGJ(
    'Retorne somente este JSON válido: {"ok":true,"origem":"gemini"}'
  );

  var dados = JSON.parse(limparRespostaJsonWMGJ_(resposta));

  if (dados.ok !== true || dados.origem !== "gemini") {
    throw new Error(
      "GEMINI_TESTE_RESPOSTA_INESPERADA: " + resposta.slice(0, 500)
    );
  }

  Logger.log(JSON.stringify(dados));
  registrarLogGeminiWMGJ_(
    "TESTE_OK",
    "testeDiretoGeminiWMGJ",
    JSON.stringify(dados)
  );

  return dados;
}

function normalizarModeloGeminiWMGJ_(model) {
  var valor = String(model || "")
    .trim()
    .replace(/^['\"]+|['\"]+$/g, "")
    .replace(/^models\//i, "")
    .replace(/:generateContent.*$/i, "")
    .trim();

  if (!valor) {
    valor = WMGJ_GEMINI_MODELO_PADRAO;
  }

  if (!/^[a-z0-9._-]+$/i.test(valor)) {
    throw new Error("GEMINI_MODEL_FORMATO_INVALIDO");
  }

  return valor;
}

function extrairErroGeminiWMGJ_(body) {
  var texto = String(body || "");

  try {
    var json = JSON.parse(texto);
    var erro = json && json.error ? json.error : null;

    if (erro) {
      return [
        erro.status || "",
        erro.message || "",
        erro.code !== undefined ? "code=" + erro.code : ""
      ].filter(function(item) {
        return item !== "";
      }).join(" | ").slice(0, 900);
    }
  } catch (ignorar) {
    // Mantém retorno textual abaixo.
  }

  return texto.slice(0, 900);
}

function sanitizarErroGeminiWMGJ_(erro) {
  var mensagem = erro && erro.message
    ? erro.message
    : String(erro || "ERRO_DESCONHECIDO");

  return mensagem
    .replace(/([?&]key=)[^&\s]+/gi, "$1***")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "***API_KEY_OCULTA***")
    .slice(0, 1200);
}

function aplicarMetadadosFallbackGeminiWMGJ_(dados, erroGemini) {
  var saida = dados && typeof dados === "object"
    ? dados
    : { dados: dados };

  saida.origem_classificacao = "fallback_local";
  saida.erro_gemini = sanitizarErroGeminiWMGJ_(erroGemini);
  saida.versao_classificador = WMGJ_GEMINI_VERSAO;

  return saida;
}

function registrarLogGeminiWMGJ_(status, comando, mensagem) {
  if (typeof registrarLogWMGJ_ === "function") {
    registrarLogWMGJ_(
      status,
      comando,
      "AppsScript",
      sanitizarErroGeminiWMGJ_(mensagem)
    );
  }
}
