/**
 * AURORA NEXUS — conectores plug-and-play Drive/Firebase
 * Fonte canônica de configuração do tenant-piloto WMGJ.
 *
 * Segredos entram somente por parâmetro de uma chamada autenticada/administrativa
 * e são persistidos em ScriptProperties. Nunca são retornados ou logados.
 */
var AURORA_CONNECTOR_SETUP_VERSION = 'v1.1.1-first-canonical-document';

function auroraNormalizarSistemaFonte_(value) {
  var system = String(value || 'DRIVE').trim().toUpperCase();
  if (system === 'GENERIC_ERP') system = 'ERP';
  if (['DRIVE', 'MV', 'TASY', 'ERP'].indexOf(system) < 0) {
    throw new Error('AURORA_DOCUMENT_SOURCE_SYSTEM_INVALID');
  }
  return system;
}

function auroraNormalizarFontesDocumentais_(sources, primaryFolderId) {
  var raw = Array.isArray(sources) && sources.length
    ? sources
    : [{ sourceId: 'drive-primary', system: 'DRIVE', folderId: primaryFolderId, slaMinutes: 1440 }];
  if (raw.length > 12) throw new Error('AURORA_DOCUMENT_SOURCE_LIMIT');

  var seen = {};
  return raw.map(function(item, index) {
    item = item || {};
    var sourceId = String(item.sourceId || ('source-' + (index + 1))).trim().toLowerCase();
    var folderId = String(item.folderId || '').trim();
    var system = auroraNormalizarSistemaFonte_(item.system);
    var slaMinutes = Number(item.slaMinutes || 1440);
    if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(sourceId)) throw new Error('AURORA_DOCUMENT_SOURCE_ID_INVALID');
    if (seen[sourceId]) throw new Error('AURORA_DOCUMENT_SOURCE_DUPLICATE');
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId)) throw new Error('AURORA_DOCUMENT_SOURCE_FOLDER_INVALID');
    if (!Number.isSafeInteger(slaMinutes) || slaMinutes < 15 || slaMinutes > 43200) throw new Error('AURORA_DOCUMENT_SOURCE_SLA_INVALID');
    var folder = DriveApp.getFolderById(folderId);
    seen[sourceId] = true;
    return {
      sourceId: sourceId,
      system: system,
      mode: 'DRIVE_FOLDER',
      folderId: folderId,
      folderName: folder.getName(),
      slaMinutes: slaMinutes,
      active: item.active !== false
    };
  });
}

function auroraFontesDocumentaisConfiguradas_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('AURORA_DOCUMENT_SOURCE_REGISTRY');
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed.filter(function(item) { return item && item.active !== false; });
    } catch (ignore) {}
  }
  var fallback = String(props.getProperty('WMGJ_PASTA_ENTRADA_ID') || '');
  return fallback ? [{ sourceId: 'drive-primary', system: 'DRIVE', mode: 'DRIVE_FOLDER', folderId: fallback, slaMinutes: 1440, active: true }] : [];
}


function auroraConfigurarConectoresPlugAndPlay(config) {
  config = config || {};
  var orgId = String(config.orgId || '').trim().toLowerCase();
  var driveFolderId = String(config.driveFolderId || '').trim();
  var spreadsheetId = String(config.spreadsheetId || '').trim();
  var ingestUrl = String(config.firestoreIngestUrl || '').trim();
  var keyId = String(config.firestoreHmacKeyId || '').trim();
  var hmacSecret = String(config.firestoreHmacSecret || '').trim();
  var externalName = String(config.externalSystemName || '').trim();
  var externalBaseUrl = String(config.externalBaseUrl || '').trim();
  var externalApiKey = String(config.externalApiKey || '');
  var activate = config.activate === true;
  var props = PropertiesService.getScriptProperties();
  var boundOrg = String(props.getProperty('WMGJ_FIRESTORE_ORG_ID') || '').trim();
  if (boundOrg && boundOrg !== orgId) throw new Error('AURORA_CONNECTOR_TENANT_REBINDING_REJECTED');
  if (activate && (typeof instalarGatilhoAutomacaoWMGJ !== 'function'
    || typeof prepararPipelineConfiavelWMGJ_V3 !== 'function'
    || typeof processarFilaFonteCanonicaWMGJ_ !== 'function'
    || typeof processarFilaComExtracaoRealWMGJ_V1 !== 'function'
    || typeof comTravaIngestaoGmailWMGJ_ !== 'function')) throw new Error('AURORA_DOCUMENT_EXECUTOR_MISSING');
  var documentSources = auroraNormalizarFontesDocumentais_(config.documentSources, driveFolderId);

  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(orgId)) throw new Error('AURORA_CONNECTOR_ORG_INVALID');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(driveFolderId)) throw new Error('AURORA_CONNECTOR_DRIVE_FOLDER_INVALID');
  if (!/^https:\/\/[^\s]+$/i.test(ingestUrl)) throw new Error('AURORA_CONNECTOR_INGEST_URL_INVALID');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(keyId)) throw new Error('AURORA_CONNECTOR_HMAC_KEY_ID_INVALID');
  if (!/^[A-Fa-f0-9]{64}$/.test(hmacSecret)) throw new Error('AURORA_CONNECTOR_HMAC_SECRET_INVALID');
  if ((externalName || externalBaseUrl || externalApiKey) && !(externalName && externalBaseUrl && externalApiKey)) {
    throw new Error('AURORA_EXTERNAL_CONNECTOR_INCOMPLETE');
  }
  if (externalBaseUrl && !/^https:\/\/[^\s]+$/i.test(externalBaseUrl)) throw new Error('AURORA_EXTERNAL_URL_INVALID');

  // Prova de escopo antes de persistir: a conta autorizada precisa enxergar a pasta.
  var folder = DriveApp.getFolderById(driveFolderId);
  var folderName = folder.getName();
  if (spreadsheetId) SpreadsheetApp.openById(spreadsheetId).getId();

  var values = {
    WMGJ_PASTA_ENTRADA_ID: driveFolderId,
    WMGJ_FIRESTORE_INGEST_URL: ingestUrl,
    WMGJ_FIRESTORE_HMAC_KEY_ID: keyId,
    WMGJ_FIRESTORE_HMAC_SECRET: hmacSecret.toLowerCase(),
    WMGJ_FIRESTORE_ORG_ID: orgId,
    WMGJ_FIRESTORE_DRY_RUN: activate ? 'false' : 'true',
    AURORA_FIRESTORE_MIRROR_REQUIRED: activate ? 'true' : 'false',
    AURORA_CONNECTOR_SETUP_VERSION: AURORA_CONNECTOR_SETUP_VERSION,
    AURORA_DOCUMENT_SOURCE_REGISTRY: JSON.stringify(documentSources),
    AURORA_EXTERNAL_AI_FALLBACK_ENABLED: config.externalAiFallbackEnabled === true ? 'true' : 'false'
  };
  if (spreadsheetId) values.WMGJ_SPREADSHEET_ID = spreadsheetId;
  if (externalName) {
    values.AURORA_EXTERNAL_SYSTEM_NAME = externalName;
    values.AURORA_EXTERNAL_BASE_URL = externalBaseUrl;
    values.AURORA_EXTERNAL_API_KEY = externalApiKey;
  }
  props.setProperties(values, false);

  var trigger = null;
  var firstCycle = null;
  if (activate) {
    trigger = instalarGatilhoAutomacaoWMGJ();
    firstCycle = trigger && trigger.ok === true ? auroraExecutarPrimeiraIngestaoDocumental_()
      : { ok:false, state:'PENDING_CANONICAL_READBACK', code:'AURORA_DOCUMENT_TRIGGER_PENDING', limit:5, firstIngestionVerified:false };
  }

  var result = {
    ok: true,
    version: AURORA_CONNECTOR_SETUP_VERSION,
    orgId: orgId,
    drive: {
      folderId: driveFolderId,
      folderName: folderName,
      contentReadAuthorizedByGoogle: true,
      sourceMutation: false
    },
    firebase: {
      ingestUrlConfigured: true,
      keyId: keyId,
      secretConfigured: true,
      dryRun: !activate,
      mirrorRequired: activate
    },
    externalSystem: externalName ? {
      name: externalName,
      baseUrl: externalBaseUrl,
      inboundSecretConfigured: true
    } : null,
    documentSources: documentSources.map(function(item) { return { sourceId: item.sourceId, system: item.system, mode: item.mode, folderId: item.folderId, slaMinutes: item.slaMinutes, active: item.active }; }),
    nativeDataPlane: { storage: 'FIRESTORE', sourceAccessRequiredAfterIngest: false, externalAiFallbackEnabled: config.externalAiFallbackEnabled === true },
    continuousExtraction: activate && !!trigger && trigger.ok === true,
    triggerInstalled: !!trigger && trigger.ok === true,
    firstCycle: firstCycle,
    firstIngestionVerified: false,
    operationalReady: false,
    checkedAt: new Date().toISOString()
  };
  auroraConnectorLogSafe_('CONFIGURE', result);
  return result;
}

// The authorized activation starts one bounded pass immediately instead of
// waiting for the existing 15-minute trigger. Counts never certify cloud state.
function auroraExecutarPrimeiraIngestaoDocumental_() {
  try {
    return comTravaIngestaoGmailWMGJ_(function() {
      var preparation = prepararPipelineConfiavelWMGJ_V3(5);
      if (!preparation || preparation.ok !== true) throw new Error('AURORA_DOCUMENT_SOURCE_PENDING');
      var processing = processarFilaFonteCanonicaWMGJ_(5);
      if (!processing || processing.ok !== true) throw new Error('AURORA_DOCUMENT_PROCESSING_PENDING');
      var processed = Number(processing.processados || 0);
      var errors = Number(processing.erros || 0);
      var review = Number(processing.revisar || 0);
      if (![processed, errors, review].every(function(n) { return Number.isSafeInteger(n) && n >= 0 && n <= 5; })) {
        throw new Error('AURORA_DOCUMENT_RESULT_INVALID');
      }
      return { ok: errors === 0 && review === 0, state: 'PENDING_CANONICAL_READBACK',
        processedDocuments: processed, failedDocuments: errors, reviewDocuments: review,
        limit: 5, firstIngestionVerified: false };
    });
  } catch (error) {
    var code = error && typeof error.message === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
      ? error.message : 'AURORA_DOCUMENT_INITIAL_CYCLE_PENDING';
    return { ok: false, state: 'PENDING_CANONICAL_READBACK', code: code, limit: 5, firstIngestionVerified: false };
  }
}

function auroraDiagnosticarFontesDocumentais_() {
  return auroraFontesDocumentaisConfiguradas_().map(function(item) {
    var accessible = false;
    var name = "";
    var error = "";
    try {
      var folder = DriveApp.getFolderById(String(item.folderId || ""));
      name = folder.getName();
      accessible = true;
    } catch (sourceError) {
      error = sourceError && sourceError.message ? String(sourceError.message).slice(0, 180) : "SOURCE_UNAVAILABLE";
    }
    return {
      sourceId: item.sourceId,
      system: item.system,
      mode: item.mode,
      folderId: item.folderId,
      folderName: name,
      slaMinutes: item.slaMinutes,
      active: item.active !== false,
      accessible: accessible,
      error: error
    };
  });
}

function auroraDiagnosticarConectoresPlugAndPlay() {
  var props = PropertiesService.getScriptProperties();
  var folderId = String(props.getProperty('WMGJ_PASTA_ENTRADA_ID') || '');
  var folderOk = false;
  var folderName = '';
  try {
    var folder = DriveApp.getFolderById(folderId);
    folderName = folder.getName();
    folderOk = true;
  } catch (ignore) {}

  var firestore = typeof wmgjFirestoreDiagnostico === 'function'
    ? wmgjFirestoreDiagnostico()
    : { ok: false, code: 'FIRESTORE_DIAGNOSTIC_MISSING' };

  var documentSources = auroraDiagnosticarFontesDocumentais_();
  var sourcesOk = documentSources.length > 0 && documentSources.every(function(item) { return item.accessible === true; });
  var result = {
    ok: folderOk && sourcesOk && firestore.ok === true,
    version: String(props.getProperty('AURORA_CONNECTOR_SETUP_VERSION') || ''),
    drive: {
      configured: !!folderId,
      accessible: folderOk,
      folderId: folderId,
      folderName: folderName
    },
    firebase: {
      configured: !!props.getProperty('WMGJ_FIRESTORE_INGEST_URL'),
      mirrorRequired: String(props.getProperty('AURORA_FIRESTORE_MIRROR_REQUIRED') || 'false') === 'true',
      dryRun: String(props.getProperty('WMGJ_FIRESTORE_DRY_RUN') || 'true') !== 'false',
      diagnostic: firestore
    },
    documentSources: documentSources,
    nativeDataPlane: {
      storage: 'FIRESTORE',
      sourceAccessRequiredAfterIngest: false,
      externalAiFallbackEnabled: String(props.getProperty('AURORA_EXTERNAL_AI_FALLBACK_ENABLED') || 'false') === 'true'
    },
    externalSystem: {
      configured: !!props.getProperty('AURORA_EXTERNAL_SYSTEM_NAME'),
      name: String(props.getProperty('AURORA_EXTERNAL_SYSTEM_NAME') || ''),
      apiKeyConfigured: !!props.getProperty('AURORA_EXTERNAL_API_KEY')
    },
    checkedAt: new Date().toISOString()
  };
  auroraConnectorLogSafe_('DIAGNOSE', result);
  return result;
}

function auroraConnectorLogSafe_(action, payload) {
  var safe = JSON.parse(JSON.stringify(payload || {}));
  if (safe.firebase && safe.firebase.secret) delete safe.firebase.secret;
  if (safe.externalSystem && safe.externalSystem.apiKey) delete safe.externalSystem.apiKey;
  try {
    if (typeof registrarLogWMGJ_ === 'function') {
      registrarLogWMGJ_('OK', 'AURORA_CONNECTOR_' + action, 'ConnectorSetup', JSON.stringify(safe));
    } else {
      Logger.log(JSON.stringify({ action: action, payload: safe }));
    }
  } catch (ignore) {}
}
