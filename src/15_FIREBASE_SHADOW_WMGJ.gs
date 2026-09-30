/**
 * WMGJ — ponte Firebase em shadow mode
 *
 * A operação Sheets/Apps Script V3 permanece oficial. Esta ponte envia somente
 * contagens e indicadores agregados, nunca linhas, nomes, documentos, conteúdo
 * clínico, texto livre, URLs ou IDs de arquivos.
 *
 * ScriptProperties necessárias para ativação controlada:
 * - WMGJ_FIREBASE_SHADOW_ENABLED=true
 * - WMGJ_FIREBASE_SHADOW_ENDPOINT=https://.../ingestShadowSnapshot
 * - WMGJ_FIREBASE_SHADOW_HMAC_SECRET=<mínimo 32 caracteres>
 * - WMGJ_FIREBASE_SHADOW_TENANT_ID=<identificador opaco>
 * - WMGJ_FIREBASE_SHADOW_SITE_ID=<identificador opaco, opcional>
 *
 * Enquanto ENABLED não for exatamente "true", a função retorna SKIPPED e não
 * realiza chamada externa. Falha do shadow nunca interrompe o pipeline oficial.
 */

var WMGJ_FIREBASE_SHADOW_VERSAO = "v1.0.0-shadow-safe";

function getConfigFirebaseShadowWMGJ_() {
  var propriedades = PropertiesService.getScriptProperties();
  return {
    enabled: String(propriedades.getProperty("WMGJ_FIREBASE_SHADOW_ENABLED") || "") === "true",
    endpoint: String(propriedades.getProperty("WMGJ_FIREBASE_SHADOW_ENDPOINT") || "").trim(),
    secret: String(propriedades.getProperty("WMGJ_FIREBASE_SHADOW_HMAC_SECRET") || ""),
    tenantId: String(propriedades.getProperty("WMGJ_FIREBASE_SHADOW_TENANT_ID") || "wmgj-shadow").trim(),
    siteId: String(propriedades.getProperty("WMGJ_FIREBASE_SHADOW_SITE_ID") || "").trim() || null
  };
}

function publicarSnapshotFirebaseShadowWMGJ() {
  var config = getConfigFirebaseShadowWMGJ_();
  if (!config.enabled) {
    return {
      ok: true,
      status: "SKIPPED",
      motivo: "SHADOW_DISABLED",
      productionChanged: false
    };
  }
  validarConfigFirebaseShadowWMGJ_(config);

  var snapshot = construirSnapshotFirebaseShadowWMGJ_();
  var body = JSON.stringify(snapshot);
  var timestamp = String(Math.floor(new Date().getTime() / 1000));
  var signature = "sha256=" + bytesParaHexFirebaseShadowWMGJ_(
    Utilities.computeHmacSha256Signature(timestamp + "." + body, config.secret)
  );
  var response = UrlFetchApp.fetch(config.endpoint, {
    method: "post",
    contentType: "application/json",
    payload: body,
    headers: {
      "X-WMGJ-Timestamp": timestamp,
      "X-WMGJ-Signature": signature
    },
    muteHttpExceptions: true,
    followRedirects: false
  });
  var statusCode = response.getResponseCode();
  var parsed = parseRespostaFirebaseShadowWMGJ_(response.getContentText());
  if (statusCode < 200 || statusCode >= 300 || parsed.ok !== true) {
    throw new Error("FIREBASE_SHADOW_REJECTED:" + statusCode + ":" + String(parsed.code || "UNKNOWN"));
  }

  registrarLogWMGJ_(
    "SHADOW_OK",
    "publicarSnapshotFirebaseShadowWMGJ",
    "FirebaseShadow",
    JSON.stringify({
      snapshotId: parsed.snapshotId,
      state: parsed.state,
      reused: parsed.reused === true,
      productionChanged: false,
      learningAutoApplied: false
    })
  );
  return parsed;
}

function tentarPublicarSnapshotFirebaseShadowWMGJ_() {
  try {
    return publicarSnapshotFirebaseShadowWMGJ();
  } catch (erro) {
    var codigo = erro && erro.message ? erro.message : String(erro);
    registrarLogWMGJ_(
      "SHADOW_ERRO_ISOLADO",
      "publicarSnapshotFirebaseShadowWMGJ",
      "FirebaseShadow",
      codigo
    );
    return {
      ok: false,
      status: "ISOLATED_FAILURE",
      code: codigo,
      productionChanged: false
    };
  }
}

function construirSnapshotFirebaseShadowWMGJ_() {
  var config = getConfigFirebaseShadowWMGJ_();
  var agora = new Date();
  var metricas = calcularMetricasAgregadasFirebaseShadowWMGJ_();
  var totalAvaliavel = metricas.processed + metricas.humanReview + metricas.errors;
  var cobertura = totalAvaliavel > 0 ? metricas.processed / totalAvaliavel : 1;
  var sequence = proximaSequenciaFirebaseShadowWMGJ_();

  return {
    snapshotId: Utilities.getUuid(),
    tenantId: config.tenantId,
    siteId: config.siteId,
    schemaVersion: 1,
    sourceSystem: "APPS_SCRIPT_V3",
    mode: "SHADOW",
    observedAt: agora.toISOString(),
    sequence: sequence,
    pipelineVersion: typeof WMGJ_PIPELINE_VERSAO !== "undefined"
      ? String(WMGJ_PIPELINE_VERSAO)
      : "v3-unknown",
    competence: Utilities.formatDate(agora, Session.getScriptTimeZone() || "America/Sao_Paulo", "yyyy-MM"),
    dataClass: "AGGREGATED_NON_CLINICAL",
    safeguards: {
      identifiersExcluded: true,
      clinicalFieldsExcluded: true,
      rawRowsExcluded: true,
      freeTextExcluded: true
    },
    metrics: metricas,
    sla: {
      queueOldestAgeMinutes: calcularIdadeFilaFirebaseShadowWMGJ_(),
      humanReviewOverdue: 0,
      lastSuccessfulRunAt: localizarUltimaExecucaoFirebaseShadowWMGJ_()
    },
    governance: {
      evidenceCoverageRate: Math.round(cobertura * 10000) / 10000,
      reconciliationState: "NOT_EVALUATED",
      productionCutoverRequested: false
    }
  };
}

function calcularMetricasAgregadasFirebaseShadowWMGJ_() {
  var metricas = {
    pending: 0,
    processing: 0,
    processed: 0,
    humanReview: 0,
    duplicates: 0,
    errors: 0
  };
  var cfg = getConfigWMGJ_();
  var aba = getPlanilha().getSheetByName(cfg.SHEETS.FILA);
  if (!aba || aba.getLastRow() < 2) return metricas;

  var dados = aba.getDataRange().getValues();
  var cabecalho = mapearCabecalhoFirebaseShadowWMGJ_(dados[0]);
  if (typeof cabecalho.STATUS !== "number") return metricas;
  for (var i = 1; i < dados.length; i++) {
    var status = String(dados[i][cabecalho.STATUS] || "").toUpperCase();
    if (status === "PENDENTE") metricas.pending++;
    else if (status === "PROCESSANDO") metricas.processing++;
    else if (status === "PROCESSADO") metricas.processed++;
    else if (status === "REVISAR_HUMANO") metricas.humanReview++;
    else if (status === "DUPLICADO") metricas.duplicates++;
    else if (status === "ERRO_REPROCESSAR" || status === "ERRO") metricas.errors++;
  }
  return metricas;
}

function calcularIdadeFilaFirebaseShadowWMGJ_() {
  var cfg = getConfigWMGJ_();
  var aba = getPlanilha().getSheetByName(cfg.SHEETS.FILA);
  if (!aba || aba.getLastRow() < 2) return null;
  var dados = aba.getDataRange().getValues();
  var cabecalho = mapearCabecalhoFirebaseShadowWMGJ_(dados[0]);
  if (typeof cabecalho.STATUS !== "number" || typeof cabecalho.DATA_ENTRADA !== "number") return null;
  var maisAntigo = null;
  for (var i = 1; i < dados.length; i++) {
    var status = String(dados[i][cabecalho.STATUS] || "").toUpperCase();
    var data = dados[i][cabecalho.DATA_ENTRADA];
    if ((status === "PENDENTE" || status === "ERRO_REPROCESSAR") && data instanceof Date) {
      if (!maisAntigo || data.getTime() < maisAntigo.getTime()) maisAntigo = data;
    }
  }
  if (!maisAntigo) return null;
  return Math.max(0, Math.floor((new Date().getTime() - maisAntigo.getTime()) / 60000));
}

function localizarUltimaExecucaoFirebaseShadowWMGJ_() {
  var cfg = getConfigWMGJ_();
  var aba = getPlanilha().getSheetByName(cfg.SHEETS.LOG);
  if (!aba || aba.getLastRow() < 2) return null;
  var inicio = Math.max(2, aba.getLastRow() - 199);
  var dados = aba.getRange(inicio, 1, aba.getLastRow() - inicio + 1, Math.min(5, aba.getLastColumn())).getValues();
  for (var i = dados.length - 1; i >= 0; i--) {
    var data = dados[i][0];
    var status = String(dados[i][1] || "").toUpperCase();
    var comando = String(dados[i][2] || "");
    if (data instanceof Date && (status === "FIM" || status === "OK") && comando !== "publicarSnapshotFirebaseShadowWMGJ") {
      return data.toISOString();
    }
  }
  return null;
}

function proximaSequenciaFirebaseShadowWMGJ_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var propriedades = PropertiesService.getScriptProperties();
    var atual = Number(propriedades.getProperty("WMGJ_FIREBASE_SHADOW_SEQUENCE") || 0);
    var proxima = atual + 1;
    propriedades.setProperty("WMGJ_FIREBASE_SHADOW_SEQUENCE", String(proxima));
    return proxima;
  } finally {
    lock.releaseLock();
  }
}

function validarConfigFirebaseShadowWMGJ_(config) {
  if (!/^https:\/\//.test(config.endpoint)) throw new Error("SHADOW_ENDPOINT_INVALID");
  if (config.secret.length < 32) throw new Error("SHADOW_SECRET_INVALID");
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(config.tenantId)) throw new Error("SHADOW_TENANT_INVALID");
  if (config.siteId !== null && !/^[A-Za-z0-9_-]{3,128}$/.test(config.siteId)) throw new Error("SHADOW_SITE_INVALID");
}

function mapearCabecalhoFirebaseShadowWMGJ_(linha) {
  var mapa = {};
  linha.forEach(function(valor, indice) {
    mapa[String(valor || "").trim().toUpperCase()] = indice;
  });
  return mapa;
}

function bytesParaHexFirebaseShadowWMGJ_(bytes) {
  return bytes.map(function(byte) {
    var valor = byte < 0 ? byte + 256 : byte;
    return ("0" + valor.toString(16)).slice(-2);
  }).join("");
}

function parseRespostaFirebaseShadowWMGJ_(texto) {
  try {
    return JSON.parse(String(texto || "{}"));
  } catch (erro) {
    return { ok: false, code: "INVALID_RESPONSE_JSON" };
  }
}

function testarFirebaseShadowWMGJ() {
  var snapshot = {
    snapshotId: "00000000-0000-4000-8000-000000000001",
    tenantId: "wmgj-test",
    siteId: "site-test",
    schemaVersion: 1,
    sourceSystem: "APPS_SCRIPT_V3",
    mode: "SHADOW",
    observedAt: "2026-09-12T18:00:00.000Z",
    sequence: 1,
    pipelineVersion: WMGJ_FIREBASE_SHADOW_VERSAO,
    competence: "2026-09",
    dataClass: "AGGREGATED_NON_CLINICAL",
    safeguards: {
      identifiersExcluded: true,
      clinicalFieldsExcluded: true,
      rawRowsExcluded: true,
      freeTextExcluded: true
    },
    metrics: { pending: 1, processing: 0, processed: 9, humanReview: 0, duplicates: 0, errors: 0 },
    sla: { queueOldestAgeMinutes: 5, humanReviewOverdue: 0, lastSuccessfulRunAt: "2026-09-12T17:55:00.000Z" },
    governance: { evidenceCoverageRate: 1, reconciliationState: "NOT_EVALUATED", productionCutoverRequested: false }
  };
  var texto = JSON.stringify(snapshot);
  var proibidos = ["patientName", "cpf", "cns", "prontuario", "diagnostico", "rawRows", "freeText"];
  return {
    ok: proibidos.every(function(campo) { return texto.indexOf('"' + campo + '"') === -1; }),
    status: "SYNTHETIC_CONTRACT_ONLY",
    externalWrites: 0,
    productionChanged: false
  };
}
