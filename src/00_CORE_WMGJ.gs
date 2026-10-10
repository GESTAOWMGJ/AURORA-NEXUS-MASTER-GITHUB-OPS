function getConfigWMGJ_() {
  return {
    SPREADSHEET_ID: "15LgI2U2dtM7vnrxFsiQMPTvBapBDg5ftgGttx7Pw0Cw",
    WEBAPP_URL: "https://script.google.com/macros/s/AKfycbwqoyfMxLs4p_IRxEmt-Uo9OUF9q8LmJ84T4ydwGWx4yqrMOoxYy_3Q3NdtGPAQ-Ivc/exec",
    PASTA_RAIZ_ID: "1womnmIbaNQ8qkNlnkS2Ni71LVwtdrNj5",
    PASTA_ENTRADA_ID: "1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-",
    SHEETS: {
      CADASTRO: "01_CADASTRO_ARQUIVOS",
      PRODUTIVIDADE: "02_PRODUTIVIDADE_MENSAL",
      FINANCEIRO: "05_FINANCEIRO_MENSAL",
      NFSE: "06_NFS_E",
      DASHBOARD: "09_INDICADORES_DASHBOARD",
      LOG: "10_LOG_AUTOMACAO",
      REGRAS: "10_AUTOMACOES_REGRAS",
      PENDENCIAS: "11_PENDENCIAS_SANEAMENTO",
      MEMORIA: "14_MEMORIA_BASE_DOCUMENTOS",
      FILA: "15_FILA_PROCESSAMENTO"
    },
    GMAIL: {
      IMPORTAR: "WMGJ_IMPORTAR",
      PROCESSADO: "WMGJ_PROCESSADO"
    }
  };
}

function getPlanilha() {
  var cfg = getConfigWMGJ_();
  return SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
}

function doGet(e) {
  try {
    var parametros = e && e.parameter ? e.parameter : {};
    var resultado = executarComandoWMGJ({
      comando: parametros.comando || "status",
      token: parametros.token || parametros.apiToken || parametros.api_token || "",
      origem: "doGet"
    });
    return respostaJson_(resultado);
  } catch (erro) {
    registrarLogWMGJ_("ERRO", "doGet", "AppsScript", erro && erro.message ? erro.message : String(erro));
    return respostaJson_({
      ok: false,
      etapa: "doGet",
      erro: erro && erro.message ? erro.message : String(erro)
    });
  }
}

function doPost(e) {
  try {
    var contents = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    var payload = JSON.parse(contents);
    var resultado = executarComandoWMGJ(payload || {});
    return respostaJson_(resultado);
  } catch (erro) {
    registrarLogWMGJ_("ERRO", "doPost", "AppsScript", erro && erro.message ? erro.message : String(erro));
    return respostaJson_({
      ok: false,
      etapa: "doPost",
      erro: erro && erro.message ? erro.message : String(erro)
    });
  }
}

function executarComandoWMGJ(payload) {
  payload = payload || {};
  var comando = String(payload.comando || "").trim();

  if (comando === "" || comando === "status") return obterStatusWMGJ();
  if (comando === "teste_execucao") return testarExecucaoWMGJ(payload);

  if (comandoRequerAutorizacaoApiWMGJ_(comando)) {
    var autorizacao = validarAutorizacaoApiWMGJ_(payload);
    if (!autorizacao.ok) {
      registrarLogWMGJ_("API_BLOQUEADA", comando || "SEM_COMANDO", payload.origem || "API", autorizacao.motivo);
      return {
        ok: false,
        erro: "Comando operacional bloqueado por segurança",
        codigo: "API_TOKEN_AUSENTE_OU_INVALIDO",
        comando: comando,
        detalhe: autorizacao.motivo
      };
    }
  }

  if (comando === "run" || comando === "runWMGJ" || comando === "operacao_total") return runWMGJ();
  if (comando === "gmail" || comando === "gmail_bancario") return importarGmailWMGJ();
  if (comando === "organizar") return organizarPastasWMGJ();
  if (comando === "dashboard") return atualizarDashboardWMGJ();
  if (comando === "conciliar" && typeof conciliacaoCompletaWMGJ === "function") return conciliacaoCompletaWMGJ();

  registrarLogWMGJ_("ERRO", comando || "SEM_COMANDO", payload.origem || "", "Comando não reconhecido");
  return {
    ok: false,
    erro: "Comando não reconhecido",
    comando: comando
  };
}

function comandoRequerAutorizacaoApiWMGJ_(comando) {
  var comandosMutaveis = {
    run: true,
    runWMGJ: true,
    operacao_total: true,
    gmail: true,
    gmail_bancario: true,
    organizar: true,
    dashboard: true,
    conciliar: true
  };
  return comandosMutaveis[String(comando || "")] === true;
}

function validarAutorizacaoApiWMGJ_(payload) {
  payload = payload || {};

  var esperado = String(PropertiesService.getScriptProperties().getProperty("WMGJ_API_TOKEN") || "").trim();
  if (!esperado) {
    return {
      ok: false,
      motivo: "WMGJ_API_TOKEN não configurado em ScriptProperties"
    };
  }

  var recebido = String(payload.token || payload.apiToken || payload.api_token || "").trim();
  if (!recebido || recebido !== esperado) {
    return {
      ok: false,
      motivo: "Token de API ausente ou inválido"
    };
  }

  return {
    ok: true,
    motivo: "Token de API validado"
  };
}

function auditarSegurancaApiWMGJ() {
  var tokenConfigurado = String(PropertiesService.getScriptProperties().getProperty("WMGJ_API_TOKEN") || "").trim() !== "";
  var testes = [];

  testes.push({
    caso: "status_sem_token",
    resultado: executarComandoWMGJ({ comando: "status", origem: "auditoria_api" }).ok === true
  });

  var bloqueio = executarComandoWMGJ({ comando: "run", origem: "auditoria_api" });
  testes.push({
    caso: "run_sem_token_bloqueado",
    resultado: bloqueio.ok === false && bloqueio.codigo === "API_TOKEN_AUSENTE_OU_INVALIDO"
  });

  var ok = testes.every(function(t) { return t.resultado === true; });
  var resultado = {
    ok: ok,
    etapa: "auditarSegurancaApiWMGJ",
    tokenConfigurado: tokenConfigurado,
    testes: testes,
    auditadoEm: new Date().toISOString()
  };

  registrarLogWMGJ_(ok ? "OK" : "ERRO", "auditarSegurancaApiWMGJ", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function runWMGJ() {
  var resultados = [];

  try {
    registrarLogWMGJ_("INICIO", "runWMGJ", "AppsScript", "Pipeline iniciado");

    if (typeof organizarPastasWMGJ === "function") resultados.push(organizarPastasWMGJ());
    if (typeof importarGmailWMGJ === "function") resultados.push(importarGmailWMGJ());
    if (typeof importarArquivosFinanceirosPDFExcel === "function") resultados.push(importarArquivosFinanceirosPDFExcel());
    if (typeof classificarLancamentosFinanceiros === "function") resultados.push(classificarLancamentosFinanceiros());
    if (typeof executarIAAutonomaWMGJ === "function") resultados.push(executarIAAutonomaWMGJ());
    if (typeof atualizarResultadoFinanceiro === "function") resultados.push(atualizarResultadoFinanceiro());
    if (typeof conciliacaoCompletaWMGJ === "function") resultados.push(conciliacaoCompletaWMGJ());
    if (typeof analisarConciliacaoComIAWMGJ === "function") resultados.push(analisarConciliacaoComIAWMGJ());
    if (typeof atualizarDashboardFinanceiro === "function") resultados.push(atualizarDashboardFinanceiro());
    if (typeof atualizarDashboardWMGJ === "function") resultados.push(atualizarDashboardWMGJ());

    registrarLogWMGJ_("FIM", "runWMGJ", "AppsScript", "Pipeline finalizado");

    return {
      ok: true,
      comando: "runWMGJ",
      resultados: resultados
    };
  } catch (erro) {
    registrarLogWMGJ_("ERRO", "runWMGJ", "AppsScript", erro && erro.message ? erro.message : String(erro));
    return {
      ok: false,
      comando: "runWMGJ",
      erro: erro && erro.message ? erro.message : String(erro)
    };
  }
}

function testarExecucaoWMGJ(payload) {
  payload = payload || {};

  registrarLogWMGJ_(
    "TESTE_OK",
    payload.comando || "teste_execucao",
    payload.origem || "ChatGPT",
    "Pipeline respondeu corretamente sem alterar base financeira"
  );

  return {
    ok: true,
    comando: payload.comando || "teste_execucao",
    status: "TESTE_OK",
    mensagem: "Webhook, Apps Script e Sheets responderam corretamente",
    escrita: getConfigWMGJ_().SHEETS.LOG
  };
}

function garantirAbaLogAutomacaoWMGJ() {
  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();
  var header = ["Data/Hora", "Status", "Comando", "Origem", "Mensagem"];
  var aba = ss.getSheetByName(cfg.SHEETS.LOG);

  if (!aba) {
    aba = ss.insertSheet(cfg.SHEETS.LOG);
  }

  if (aba.getLastRow() === 0) {
    aba.appendRow(header);
    return aba;
  }

  var largura = Math.max(header.length, aba.getLastColumn());
  var primeiraLinha = aba.getRange(1, 1, 1, largura).getValues()[0];
  var headerAtual = primeiraLinha.slice(0, header.length).join("|");
  var headerEsperado = header.join("|");

  if (headerAtual !== headerEsperado) {
    aba.insertRowsBefore(1, 1);
    aba.getRange(1, 1, 1, header.length).setValues([header]);
  }

  return aba;
}

function registrarLogWMGJ_(status, comando, origem, mensagem) {
  var aba = garantirAbaLogAutomacaoWMGJ();
  aba.appendRow([
    new Date(),
    status || "INFO",
    comando || "",
    origem || "AppsScript",
    mensagem || ""
  ]);
}

function registrarLogWMGJ(status, comando, origem, mensagem) {
  registrarLogWMGJ_(status, comando, origem, mensagem);
}

function registrarLog(evento, detalhe) {
  registrarLogWMGJ_("INFO", evento || "", "AppsScript", detalhe || "");
}

function obterStatusWMGJ() {
  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();
  var sheets = ss.getSheets().map(function(sheet) {
    return sheet.getName();
  });

  return {
    ok: true,
    status: "ONLINE",
    sistema: "WMGJ",
    planilha: ss.getName(),
    abas: sheets.length,
    log: cfg.SHEETS.LOG,
    gmailImportar: cfg.GMAIL.IMPORTAR,
    gmailProcessado: cfg.GMAIL.PROCESSADO,
    atualizadoEm: new Date().toISOString()
  };
}

function importarGmailWMGJ() {
  return comTravaIngestaoGmailWMGJ_(function() { return importarGmailWMGJ_SobTrava_(); });
}

function importarGmailWMGJ_SobTrava_() {
  var cfg = getConfigWMGJ_();
  garantirLabelsGmail_();

  var ss = getPlanilha();
  var fila = obterOuCriarAba_(ss, cfg.SHEETS.FILA, ["DATA_ENTRADA", "ORIGEM", "ID_ORIGEM", "NOME", "TIPO", "STATUS", "OBSERVACAO"]);
  var memoria = obterOuCriarAba_(ss, cfg.SHEETS.MEMORIA, ["DATA_REGISTRO", "ORIGEM", "ID_ORIGEM", "NOME", "HASH", "STATUS", "RESUMO"]);
  var ids = carregarIds_(memoria, 2);
  var labelImportar = GmailApp.getUserLabelByName(cfg.GMAIL.IMPORTAR);
  var labelProcessado = GmailApp.getUserLabelByName(cfg.GMAIL.PROCESSADO);
  var threads = labelImportar ? labelImportar.getThreads(0, 50) : [];
  var importados = 0;

  threads.forEach(function(thread) {
    var temMensagemReservada = false;
    thread.getMessages().forEach(function(msg) {
      var id = msg.getId();
      if (mensagemReservadaReplayGmailWMGJ_(id)) { temMensagemReservada = true; return; }
      if (ids.has(id)) return;

      var assunto = msg.getSubject();
      var anexos = msg.getAttachments() || [];

      fila.appendRow([new Date(), "GMAIL", id, assunto, "EMAIL", "PENDENTE", "Mensagem importada"]);
      memoria.appendRow([new Date(), "GMAIL", id, assunto, "", "IMPORTADO", msg.getFrom()]);

      anexos.forEach(function(anexo) {
        salvarAnexoGmail_(anexo, id, fila, memoria);
      });

      msg.addLabel(labelProcessado);
      importados++;
    });

    if (!temMensagemReservada) thread.removeLabel(labelImportar);
  });

  registrarLogWMGJ_("OK", "gmail", "AppsScript", "Mensagens importadas: " + importados);

  return {
    ok: true,
    etapa: "gmail",
    importados: importados
  };
}

function salvarAnexoGmail_(anexo, messageId, fila, memoria) {
  var cfg = getConfigWMGJ_();
  var pasta = DriveApp.getFolderById(cfg.PASTA_ENTRADA_ID);
  var arquivo = pasta.createFile(anexo.copyBlob());

  fila.appendRow([new Date(), "GMAIL_ANEXO", arquivo.getId(), arquivo.getName(), arquivo.getMimeType(), "PENDENTE", "Origem messageId: " + messageId]);
  memoria.appendRow([new Date(), "GMAIL_ANEXO", arquivo.getId(), arquivo.getName(), "", "SALVO_DRIVE", messageId]);
}

function organizarPastasWMGJ() {
  var cfg = getConfigWMGJ_();
  var raiz = DriveApp.getFolderById(cfg.PASTA_RAIZ_ID);
  var nomes = ["00_GOVERNANCA", "01_ENTRADA_DOCUMENTOS", "02_FINANCEIRO", "03_PRODUTIVIDADE", "04_RELATORIOS", "05_GLOSAS", "06_CONTRATOS", "07_BACKUP"];
  var criadas = 0;

  nomes.forEach(function(nome) {
    var existe = raiz.getFoldersByName(nome);
    if (!existe.hasNext()) {
      raiz.createFolder(nome);
      criadas++;
    }
  });

  registrarLogWMGJ_("OK", "organizar", "AppsScript", "Pastas criadas: " + criadas);

  return {
    ok: true,
    etapa: "organizar",
    pastasCriadas: criadas
  };
}

function atualizarDashboardWMGJ() {
  var cfg = getConfigWMGJ_();
  var ss = getPlanilha();
  var fin = ss.getSheetByName(cfg.SHEETS.FINANCEIRO);
  var dash = obterOuCriarAba_(ss, cfg.SHEETS.DASHBOARD, ["INDICADOR", "VALOR", "ATUALIZADO_EM"]);
  var dados = fin ? fin.getDataRange().getValues() : [];
  var receita = 0;
  var recebido = 0;
  var aberto = 0;
  var despesa = 0;
  var resultado = 0;

  if (dados.length > 1) {
    var h = dados[0];
    var iReceita = h.indexOf("RECEITA_BRUTA");
    var iRecebido = h.indexOf("RECEBIDO");
    var iAberto = h.indexOf("EM_ABERTO");
    var iDespesa = h.indexOf("DESPESA");
    var iResultado = h.indexOf("RESULTADO");

    dados.slice(1).forEach(function(l) {
      receita += iReceita >= 0 ? Number(l[iReceita]) || 0 : 0;
      recebido += iRecebido >= 0 ? Number(l[iRecebido]) || 0 : 0;
      aberto += iAberto >= 0 ? Number(l[iAberto]) || 0 : 0;
      despesa += iDespesa >= 0 ? Number(l[iDespesa]) || 0 : 0;
      resultado += iResultado >= 0 ? Number(l[iResultado]) || 0 : 0;
    });
  }

  dash.clearContents();
  dash.appendRow(["INDICADOR", "VALOR", "ATUALIZADO_EM"]);
  dash.appendRow(["RECEITA_BRUTA", receita, new Date()]);
  dash.appendRow(["RECEBIDO", recebido, new Date()]);
  dash.appendRow(["EM_ABERTO", aberto, new Date()]);
  dash.appendRow(["DESPESA", despesa, new Date()]);
  dash.appendRow(["RESULTADO", resultado, new Date()]);

  registrarLogWMGJ_("OK", "dashboard", "AppsScript", "Dashboard recalculado");

  return {
    ok: true,
    etapa: "dashboard",
    receita: receita,
    resultado: resultado
  };
}

function obterOuCriarAba_(ss, nome, cabecalho) {
  var aba = ss.getSheetByName(nome);

  if (!aba) {
    aba = ss.insertSheet(nome);
  }

  if (aba.getLastRow() === 0 && cabecalho && cabecalho.length) {
    aba.appendRow(cabecalho);
  }

  return aba;
}

function carregarIds_(aba, colunaIndexZeroBased) {
  var dados = aba.getDataRange().getValues();
  return new Set(dados.slice(1).map(function(linha) {
    return linha[colunaIndexZeroBased];
  }).filter(Boolean));
}

function garantirLabelsGmail_() {
  var cfg = getConfigWMGJ_();

  if (!GmailApp.getUserLabelByName(cfg.GMAIL.IMPORTAR)) {
    GmailApp.createLabel(cfg.GMAIL.IMPORTAR);
  }

  if (!GmailApp.getUserLabelByName(cfg.GMAIL.PROCESSADO)) {
    GmailApp.createLabel(cfg.GMAIL.PROCESSADO);
  }
}

function respostaJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function responderJsonWMGJ(obj) {
  return respostaJson_(obj);
}

function montarEventoTesteExecucaoWMGJ_() {
  return {
    postData: {
      contents: JSON.stringify({
        comando: "teste_execucao",
        origem: "AppsScript",
        ambiente: "teste_interno",
        timestamp: new Date().toISOString()
      })
    }
  };
}

function testarWebhookInterno() {
  var response = doPost(montarEventoTesteExecucaoWMGJ_());
  var texto = response.getContent();
  Logger.log(texto);
  return texto;
}

function testarWebhookInternoTesteExecucao() {
  return testarWebhookInterno();
}

function testarWebhookPublicadoWMGJ() {
  var cfg = getConfigWMGJ_();
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      comando: "teste_execucao",
      origem: "UrlFetchApp",
      ambiente: "webapp_publicado",
      timestamp: new Date().toISOString()
    }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(cfg.WEBAPP_URL, options);
  var texto = response.getContentText();
  Logger.log(texto);
  return texto;
}

function garantirEstruturaIaWMGJ_() {
  const ss = getPlanilha();
  const definicoes = [
    { nome: "02_EXTRATO_CLASSIFICADO", colunas: ["ROW_KEY", "STATUS_IA", "DECISION_ID", "PROMPT_HASH", "CLASSIFICACAO_IA", "CONFIANCA_IA", "OBS_IA", "ATUALIZADO_IA_EM"] },
    { nome: "11_PENDENCIAS_IA", colunas: ["PENDENCIA_ID", "ROW_KEY", "STATUS_IA", "TIPO", "ORIGEM_ABA", "ORIGEM_LINHA", "CLAIM_EXEC_ID", "CLAIM_EM", "DECISION_ID", "ERRO", "UPDATED_AT", "SNAPSHOT_JSON"] }
  ];
  const resultado = [];
  definicoes.forEach(d => {
    const aba = obterOuCriarAba_(ss, d.nome, d.colunas);
    const existentes = aba.getLastColumn() > 0 ? aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0] : [];
    let adicionadas = 0;
    d.colunas.forEach(col => {
      if (existentes.indexOf(col) === -1) {
        aba.getRange(1, aba.getLastColumn() + 1).setValue(col);
        existentes.push(col);
        adicionadas++;
      }
    });
    resultado.push({ aba: d.nome, colunasAdicionadas: adicionadas });
  });
  return { ok: true, estrutura: resultado };
}

function hashLancamentoWMGJ_(obj) {
  const obrigatorios = ["data", "descricao", "valor", "origem"];
  obrigatorios.forEach(c => {
    if (obj[c] === undefined || obj[c] === null || obj[c] === "") throw new Error("Erro de modelagem: campo obrigatório ausente: " + c);
  });
  const payload = JSON.stringify({
    data: String(obj.data),
    descricao: String(obj.descricao).trim(),
    valor: Number(obj.valor),
    origem: String(obj.origem).trim(),
    documento: String(obj.documento || "").trim()
  });
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload));
}

function gerarFilaPendenciasIaWMGJ_() {
  garantirEstruturaIaWMGJ_();
  const ss = getPlanilha();
  const extrato = ss.getSheetByName("02_EXTRATO_CLASSIFICADO");
  const pend = ss.getSheetByName("11_PENDENCIAS_IA");
  if (!extrato || !pend) return { ok: false, erro: "Abas obrigatórias ausentes" };
  const dados = extrato.getDataRange().getValues();
  const h = dados[0] || [];
  const iStatus = h.indexOf("STATUS_IA");
  const iRowKey = h.indexOf("ROW_KEY");
  const existentes = indexarPendencias_(pend);
  let upserts = 0;
  let erros = 0;
  for (let i = 1; i < dados.length; i++) {
    try {
      const row = dados[i];
      const status = iStatus >= 0 ? String(row[iStatus] || "") : "";
      if (status && status !== "PENDENTE" && status !== "REPROCESSAR") continue;
      const rowKey = iRowKey >= 0 && row[iRowKey] ? String(row[iRowKey]) : hashLancamentoWMGJ_({ data: row[0], descricao: row[1], valor: row[2], origem: "EXTRATO" });
      const pendId = rowKey;
      upsertPendencia_(pend, existentes, { PENDENCIA_ID: pendId, ROW_KEY: rowKey, STATUS_IA: "PENDENTE", TIPO: "CONCILIACAO", ORIGEM_ABA: "02_EXTRATO_CLASSIFICADO", ORIGEM_LINHA: i + 1 });
      upserts++;
    } catch (e) {
      erros++;
      registrarLog("ERRO_GERAR_PEND_IA", "linha " + (i + 1) + " - " + (e.message || e));
    }
  }
  return { ok: true, upserts: upserts, erros: erros };
}

function claimPendenciaIaWMGJ_(pendenciaId, execId) {
  const ss = getPlanilha();
  const pend = ss.getSheetByName("11_PENDENCIAS_IA");
  const dados = pend.getDataRange().getValues();
  const h = dados[0];
  const idx = headerMap_(h);
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idx.PENDENCIA_ID] || "") !== String(pendenciaId)) continue;
    const claimed = String(dados[i][idx.CLAIM_EXEC_ID] || "");
    if (claimed && claimed !== String(execId)) return false;
    pend.getRange(i + 1, idx.CLAIM_EXEC_ID + 1).setValue(execId);
    pend.getRange(i + 1, idx.CLAIM_EM + 1).setValue(new Date());
    return true;
  }
  return false;
}

function montarPromptConciliacaoWMGJ_(contexto) {
  if (!contexto || !contexto.rowKey || !contexto.descricao || contexto.valor === undefined) {
    return { revisarHumano: true, motivo: "Dados insuficientes", prompt: "" };
  }
  const prompt = "Classifique lançamento financeiro em JSON estrito: {categoria,subcategoria,confianca,justificativa}. Linha=" +
    JSON.stringify({ rowKey: contexto.rowKey, data: contexto.data, descricao: contexto.descricao, valor: contexto.valor, historico: contexto.historico || "" });
  return { prompt: prompt, promptHash: toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, prompt + "|" + contexto.rowKey)) };
}

function chamarGeminiStructuredWMGJ_(contexto, model) {
  const versao = "v1";
  const promptData = montarPromptConciliacaoWMGJ_(contexto);
  if (promptData.revisarHumano) return { decision: null, usage: null, raw: null, erro: promptData.motivo };
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente em Script Properties");
  const modelo = model || "gemini-1.5-pro";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelo) + ":generateContent";
  const payload = {
    generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    contents: [{ role: "user", parts: [{ text: promptData.prompt }] }]
  };
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    headers: { "x-goog-api-key": apiKey },
    muteHttpExceptions: true
  };

  const resp = fetchComRetryIaWMGJ_(url, options, 4, 800);
  const rawText = resp.body || "";
  const parsed = safeJsonParse_(rawText);
  const decision = extrairDecisaoGeminiWMGJ_(parsed);
  if (!decision) throw new Error("Resposta Gemini sem JSON de decisão válido");

  const usage = (parsed && parsed.usageMetadata) ? {
    promptTokens: Number(parsed.usageMetadata.promptTokenCount || 0),
    completionTokens: Number(parsed.usageMetadata.candidatesTokenCount || 0),
    totalTokens: Number(parsed.usageMetadata.totalTokenCount || 0)
  } : null;

  const decisionId = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contexto.rowKey + "|" + versao + "|" + modelo));
  return { decision: decision, usage: usage, raw: { status: resp.status, latencyMs: resp.latencyMs, body: rawText, promptHash: promptData.promptHash }, decisionId: decisionId };
}

function validarDecisaoIaWMGJ_(decision, contexto) {
  const reasons = [];
  const categoriasPermitidas = ["RECEITA", "DESPESA", "TRANSFERENCIA", "REVISAR"];
  if (!decision || categoriasPermitidas.indexOf(decision.categoria) === -1) reasons.push("categoria inválida");
  if (Number(decision.confianca) < 0 || Number(decision.confianca) > 100) reasons.push("confianca fora da faixa");
  if (contexto && Number(contexto.valor) === 0 && decision.categoria !== "TRANSFERENCIA") reasons.push("conflito com valor zero");
  const ok = reasons.length === 0;
  return { ok: ok, autoApply: ok && Number(decision.confianca) >= 85 && decision.categoria !== "REVISAR", reasons: reasons };
}

function processarPendenciasIaBatchWMGJ(limite) {
  garantirEstruturaIaWMGJ_();
  const ss = getPlanilha();
  const pend = ss.getSheetByName("11_PENDENCIAS_IA");
  const dados = pend.getDataRange().getValues();
  const h = dados[0] || [];
  const idx = headerMap_(h);
  const execId = Utilities.getUuid();
  let processados = 0;
  let erros = 0;
  for (let i = 1; i < dados.length && processados < (Number(limite) || 20); i++) {
    const status = String(dados[i][idx.STATUS_IA] || "");
    if (status !== "PENDENTE" && status !== "REPROCESSAR") continue;
    try {
      const pendId = String(dados[i][idx.PENDENCIA_ID]);
      if (!claimPendenciaIaWMGJ_(pendId, execId)) continue;
      const contexto = { rowKey: String(dados[i][idx.ROW_KEY] || ""), valor: 1, descricao: "PENDENCIA " + pendId };
      const ai = chamarGeminiStructuredWMGJ_(contexto, "gemini-1.5-pro");
      const validacao = validarDecisaoIaWMGJ_(ai.decision || {}, contexto);
      aplicarDecisaoIaWMGJ_({ pendenciaId: pendId, rowKey: contexto.rowKey }, { ai: ai, validacao: validacao });
      processados++;
    } catch (e) {
      erros++;
      registrarLog("ERRO_PROC_PEND_IA", e.message || String(e));
    }
  }
  return { ok: true, execId: execId, processados: processados, erros: erros };
}

function aplicarDecisaoIaWMGJ_(contexto, resultado) {
  const ss = getPlanilha();
  const pend = ss.getSheetByName("11_PENDENCIAS_IA");
  const dados = pend.getDataRange().getValues();
  const idx = headerMap_(dados[0]);
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idx.PENDENCIA_ID]) !== String(contexto.pendenciaId)) continue;
    const snapshot = JSON.stringify(dados[i]);
    pend.getRange(i + 1, idx.SNAPSHOT_JSON + 1).setValue(snapshot);
    pend.getRange(i + 1, idx.DECISION_ID + 1).setValue(resultado.ai.decisionId || "");
    pend.getRange(i + 1, idx.STATUS_IA + 1).setValue(resultado.validacao.ok ? "PROCESSADO" : "REJEITADO");
    pend.getRange(i + 1, idx.ERRO + 1).setValue(resultado.validacao.reasons.join("; "));
    pend.getRange(i + 1, idx.UPDATED_AT + 1).setValue(new Date());
    return { ok: true };
  }
  return { ok: false, erro: "Pendência não encontrada" };
}

function rollbackDecisaoIaWMGJ_(decisionId) {
  const ss = getPlanilha();
  const pend = ss.getSheetByName("11_PENDENCIAS_IA");
  const dados = pend.getDataRange().getValues();
  const idx = headerMap_(dados[0]);
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idx.DECISION_ID] || "") !== String(decisionId)) continue;
    if (String(dados[i][idx.STATUS_IA]) === "ROLLBACK_OK") return { ok: true, idempotente: true };
    const snapshot = String(dados[i][idx.SNAPSHOT_JSON] || "");
    if (!snapshot) {
      pend.getRange(i + 1, idx.STATUS_IA + 1).setValue("ROLLBACK_INCONCLUSIVO");
      return { ok: false, erro: "Snapshot anterior inexistente" };
    }
    pend.getRange(i + 1, idx.STATUS_IA + 1).setValue("ROLLBACK_OK");
    pend.getRange(i + 1, idx.UPDATED_AT + 1).setValue(new Date());
    return { ok: true };
  }
  return { ok: false, erro: "decisionId não encontrado" };
}


function fetchComRetryIaWMGJ_(url, options, maxTentativas, baseDelayMs) {
  const tentativas = Math.max(1, Number(maxTentativas) || 4);
  let ultimoErro = "";
  for (let t = 1; t <= tentativas; t++) {
    const inicio = Date.now();
    const response = UrlFetchApp.fetch(url, options);
    const status = response.getResponseCode();
    const body = response.getContentText() || "";
    const latencyMs = Date.now() - inicio;
    registrarLog("IA_HTTP", "tentativa=" + t + " status=" + status + " latenciaMs=" + latencyMs);
    if (status >= 200 && status < 300) return { status: status, body: body, latencyMs: latencyMs };
    const retryable = status === 429 || (status >= 500 && status <= 599);
    ultimoErro = "HTTP " + status + " body=" + body.slice(0, 500);
    if (!retryable || t === tentativas) throw new Error("Falha IA: " + ultimoErro);
    Utilities.sleep((Number(baseDelayMs) || 800) * Math.pow(2, t - 1));
  }
  throw new Error("Falha IA: " + ultimoErro);
}

function extrairDecisaoGeminiWMGJ_(parsed) {
  const txt = extrairTextoCandidatoGeminiWMGJ_(parsed);
  if (!txt) return null;
  const json = safeJsonParse_(txt);
  if (!json || typeof json !== "object") return null;
  if (json.decision && typeof json.decision === "object") return json.decision;
  if (json.categoria !== undefined) return json;
  return null;
}

function extrairTextoCandidatoGeminiWMGJ_(parsed) {
  try {
    const candidates = parsed && parsed.candidates;
    if (!candidates || !candidates.length) return "";
    const parts = (((candidates[0] || {}).content || {}).parts || []);
    const text = parts.map(p => p.text || "").join("\n");
    return String(text || "").trim();
  } catch (e) {
    return "";
  }
}

function safeJsonParse_(txt) {
  try {
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

function upsertPendencia_(aba, index, item) {
  const chave = String(item.PENDENCIA_ID || item.ROW_KEY);
  const rowNum = index[chave];
  const header = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  if (rowNum) {
    header.forEach((col, i) => {
      if (item[col] !== undefined) aba.getRange(rowNum, i + 1).setValue(item[col]);
    });
    aba.getRange(rowNum, header.indexOf("UPDATED_AT") + 1).setValue(new Date());
  } else {
    const nova = header.map(col => item[col] !== undefined ? item[col] : "");
    if (header.indexOf("UPDATED_AT") >= 0) nova[header.indexOf("UPDATED_AT")] = new Date();
    aba.appendRow(nova);
    index[chave] = aba.getLastRow();
  }
}

function indexarPendencias_(aba) {
  const dados = aba.getDataRange().getValues();
  const idx = headerMap_(dados[0] || []);
  const out = {};
  for (let i = 1; i < dados.length; i++) {
    const chave = String(dados[i][idx.PENDENCIA_ID] || dados[i][idx.ROW_KEY] || "");
    if (chave) out[chave] = i + 1;
  }
  return out;
}

function headerMap_(h) {
  const m = {};
  (h || []).forEach((v, i) => m[String(v)] = i);
  return m;
}

function toHex_(bytes) {
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}
