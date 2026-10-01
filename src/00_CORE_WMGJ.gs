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
    thread.getMessages().forEach(function(msg) {
      var id = msg.getId();
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

    thread.removeLabel(labelImportar);
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
