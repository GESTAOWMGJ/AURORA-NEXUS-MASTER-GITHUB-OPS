/**
 * WMGJ → Firestore Bridge
 * Instalação: adicionar ao projeto Apps Script apenas após revisão.
 * Estado padrão: DRY_RUN=true. Não altera a planilha-fonte.
 */

var WMGJ_FIRESTORE_BRIDGE_VERSION = 'v1.0.0-firestore-bridge';
var WMGJ_FIRESTORE_SIGNATURE_VERSION = 'v2';

function wmgjFirestoreConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    url: String(props.getProperty('WMGJ_FIRESTORE_INGEST_URL') || '').trim(),
    keyId: String(props.getProperty('WMGJ_FIRESTORE_HMAC_KEY_ID') || '').trim(),
    secret: String(props.getProperty('WMGJ_FIRESTORE_HMAC_SECRET') || ''),
    orgId: String(props.getProperty('WMGJ_FIRESTORE_ORG_ID') || 'wmgj').trim(),
    dryRun: String(props.getProperty('WMGJ_FIRESTORE_DRY_RUN') || 'true').toLowerCase() !== 'false',
    maxRows: Math.max(1, Math.min(200, Number(props.getProperty('WMGJ_FIRESTORE_MAX_ROWS') || 50)))
  };
}

function wmgjFirestoreDiagnostico() {
  var cfg = wmgjFirestoreConfig_();
  var productionReady = Boolean(
    cfg.url && cfg.keyId && cfg.secret.length >= 32 && cfg.orgId
  );
  var result = {
    ok: cfg.dryRun ? Boolean(cfg.orgId) : productionReady,
    version: WMGJ_FIRESTORE_BRIDGE_VERSION,
    urlConfigured: Boolean(cfg.url),
    keyIdConfigured: Boolean(cfg.keyId),
    secretConfigured: cfg.secret.length >= 32,
    orgId: cfg.orgId,
    dryRun: cfg.dryRun,
    maxRows: cfg.maxRows,
    sourceMutation: false,
    checkedAt: new Date().toISOString()
  };
  wmgjFirestoreLog_('DIAGNOSTICO', result.ok ? 'OK' : 'ERRO', result);
  return result;
}

function wmgjFirestoreEnviarEvento_(event) {
  var cfg = wmgjFirestoreConfig_();
  if (!event || !event.idempotencyKey || !event.orgId) {
    throw new Error('EVENTO_FIRESTORE_INVALIDO');
  }

  var body = JSON.stringify(event);
  if (cfg.dryRun) {
    var dry = {
      ok: true,
      accepted: false,
      dryRun: true,
      eventId: event.eventId,
      entityType: event.entityType,
      idempotencyKey: event.idempotencyKey
    };
    wmgjFirestoreLog_('DRY_RUN', 'OK', dry);
    return dry;
  }

  if (!cfg.url || !cfg.keyId || cfg.secret.length < 32) {
    throw new Error('CONFIG_FIRESTORE_INCOMPLETA');
  }

  var lastError = '';
  for (var attempt = 1; attempt <= 3; attempt++) {
    // Cada tentativa recebe nonce/timestamp próprios. Assim, uma resposta perdida
    // pode ser repetida pela idempotency key sem reutilizar um nonce antirreplay.
    var timestamp = String(Math.floor(Date.now() / 1000));
    var nonce = Utilities.getUuid();
    var canonical = wmgjFirestoreCanonicalHmacV2_(body, {
      timestamp: timestamp,
      nonce: nonce,
      keyId: cfg.keyId,
      orgId: event.orgId,
      idempotencyKey: event.idempotencyKey
    });
    var signature = wmgjFirestoreHmacHex_(canonical, cfg.secret);
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      muteHttpExceptions: true,
      followRedirects: false,
      headers: {
        'X-WMGJ-Signature-Version': WMGJ_FIRESTORE_SIGNATURE_VERSION,
        'X-WMGJ-Timestamp': timestamp,
        'X-WMGJ-Nonce': nonce,
        'X-WMGJ-Key-Id': cfg.keyId,
        'X-WMGJ-Signature': signature,
        'X-WMGJ-Org-Id': event.orgId,
        'X-WMGJ-Idempotency-Key': event.idempotencyKey
      }
    };
    var response = UrlFetchApp.fetch(cfg.url, options);
    var code = response.getResponseCode();
    var text = response.getContentText();
    var parsed = wmgjFirestoreParseJson_(text);

    if (code >= 200 && code < 300) {
      if (!wmgjFirestoreRespostaAceita_(parsed)) {
        lastError = 'INVALID_SUCCESS_RESPONSE';
        break;
      }
      wmgjFirestoreLog_('ENVIO', 'OK', {
        attempt: attempt,
        eventId: event.eventId,
        entityType: event.entityType,
        httpCode: code,
        accepted: parsed.accepted,
        duplicate: parsed.duplicate
      });
      return parsed;
    }

    lastError = 'HTTP_' + code + ':' + String(text || '').slice(0, 300);
    if (code !== 429 && code < 500) break;
    Utilities.sleep(attempt * 750);
  }

  wmgjFirestoreLog_('ENVIO', 'ERRO', {
    eventId: event.eventId,
    entityType: event.entityType,
    error: lastError
  });
  throw new Error('FIRESTORE_INGEST_FAILED:' + lastError);
}

function wmgjFirestoreRespostaAceita_(response) {
  return Boolean(
    response &&
    response.ok === true &&
    (response.accepted === true || response.duplicate === true) &&
    !(response.accepted === true && response.duplicate === true) &&
    response.eventId &&
    response.entityId
  );
}

function wmgjFirestoreEventoArquivo_(file, classification, context) {
  context = context || {};
  classification = classification || {};
  var cfg = wmgjFirestoreConfig_();
  var hash = wmgjFirestoreHashArquivo_(file);
  var sourceId = file.getId();
  var entityKey = ['DRIVE', sourceId].join(':');
  var occurredAt = new Date();
  var sourceUpdatedAt = file.getLastUpdated();
  var sourceVersion = wmgjFirestoreSourceVersion_(sourceUpdatedAt, occurredAt);

  return {
    schemaVersion: 1,
    eventId: Utilities.getUuid(),
    eventType: 'DOCUMENT_UPSERT',
    orgId: cfg.orgId,
    occurredAt: occurredAt.toISOString(),
    sourceVersion: sourceVersion,
    idempotencyKey: [cfg.orgId, 'DRIVE', sourceId, hash.value].join(':'),
    entityType: 'sourceDocument',
    entityKey: entityKey,
    actor: {
      type: 'SYSTEM',
      id: wmgjFirestoreActorId_(),
      source: 'WMGJ_APPS_SCRIPT'
    },
    source: {
      system: 'DRIVE',
      sourceId: sourceId,
      mimeType: file.getMimeType(),
      url: file.getUrl(),
      contentHash: hash.value,
      hashMethod: hash.method
    },
    workflowState: classification.status === 'PROCESSADO' ? 'VALIDATED' : 'PENDING_HUMAN_REVIEW',
    reviewState: classification.status === 'PROCESSADO' ? 'NOT_REQUIRED' : 'PENDING',
    riskLevel: wmgjFirestoreRiskLevel_(classification.nivel_risco),
    sensitivity: 'RESTRICTED',
    competence: wmgjFirestoreCompetencia_(classification.competencia),
    documentType: String(classification.tipo_documento || classification.categoria || 'outro').slice(0, 128),
    record: {
      category: classification.categoria || 'outro',
      confidence: Number(classification.confianca || 0),
      extractionMethod: classification.metodo_extracao || '',
      legacyStatus: classification.status || '',
      sourceContext: String(context.sourceContext || 'pipeline-v3')
    },
    metadata: {
      bridgeVersion: WMGJ_FIRESTORE_BRIDGE_VERSION,
      pipelineVersion: context.pipelineVersion || '',
      fileNameWithheld: true,
      narrativeWithheld: true,
      nonBlockingMirror: true
    }
  };
}

function wmgjFirestoreHashArquivo_(file) {
  try {
    var bytes = file.getBlob().getBytes();
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
    return { value: wmgjFirestoreBytesHex_(digest), method: 'content_sha256' };
  } catch (error) {
    var base = [file.getId(), file.getName(), file.getSize(), file.getLastUpdated().getTime()].join('|');
    var digestFallback = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      base,
      Utilities.Charset.UTF_8
    );
    return { value: wmgjFirestoreBytesHex_(digestFallback), method: 'metadata_sha256_fallback' };
  }
}

function wmgjFirestoreHashString_(value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return wmgjFirestoreBytesHex_(digest);
}

function wmgjFirestoreActorId_() {
  var email = '';
  try { email = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase(); }
  catch (ignore) {}
  return email ? 'apps-script:' + wmgjFirestoreHashString_(email).slice(0, 32) : 'apps-script';
}

function wmgjFirestoreHmacHex_(value, secret) {
  var signature = Utilities.computeHmacSha256Signature(
    String(value || ''),
    String(secret || ''),
    Utilities.Charset.UTF_8
  );
  return wmgjFirestoreBytesHex_(signature);
}

function wmgjFirestoreCanonicalHmacV2_(body, headers) {
  return [
    'WMGJ-HMAC-V2',
    'POST',
    'application/json',
    String(headers.timestamp || ''),
    String(headers.nonce || ''),
    String(headers.keyId || ''),
    String(headers.orgId || ''),
    String(headers.idempotencyKey || ''),
    wmgjFirestoreHashString_(String(body || ''))
  ].join('\n');
}

function wmgjFirestoreRiskLevel_(value) {
  var normalized = String(value || 'MEDIUM')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toUpperCase();
  var mapping = {
    'BAIXO': 'LOW',
    'LOW': 'LOW',
    'MEDIO': 'MEDIUM',
    'MEDIUM': 'MEDIUM',
    'ALTO': 'HIGH',
    'HIGH': 'HIGH',
    'CRITICO': 'CRITICAL',
    'CRITICAL': 'CRITICAL'
  };
  return mapping[normalized] || 'MEDIUM';
}

function wmgjFirestoreSourceVersion_(sourceDate, fallbackDate) {
  var sourceMillis = sourceDate instanceof Date ? sourceDate.getTime() : NaN;
  if (Number.isSafeInteger(sourceMillis) && sourceMillis > 0) return sourceMillis;
  var fallbackMillis = fallbackDate instanceof Date ? fallbackDate.getTime() : Date.now();
  if (!Number.isSafeInteger(fallbackMillis) || fallbackMillis < 1) {
    throw new Error('SOURCE_VERSION_INVALIDA');
  }
  return fallbackMillis;
}

function wmgjFirestoreBytesHex_(bytes) {
  return bytes.map(function(value) {
    var normalized = value < 0 ? value + 256 : value;
    var hex = normalized.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function wmgjFirestoreCompetencia_(value) {
  var text = String(value || '').trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return text;
  var br = text.match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);
  return br ? br[2] + '-' + br[1] : '';
}

function wmgjFirestoreParseJson_(text) {
  try { return JSON.parse(text || '{}'); }
  catch (error) { return { ok: false, raw: String(text || '').slice(0, 500) }; }
}

function wmgjFirestoreLog_(action, status, detail) {
  try {
    if (typeof registrarLogWMGJ_ === 'function') {
      registrarLogWMGJ_(status, 'FIRESTORE_' + action, 'FirestoreBridge', JSON.stringify(detail || {}));
      return;
    }
    Logger.log(JSON.stringify({ action: action, status: status, detail: detail || {} }));
  } catch (ignore) {}
}
