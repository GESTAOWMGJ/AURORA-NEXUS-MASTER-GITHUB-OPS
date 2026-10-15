/**
 * AURORA NEXUS — conectores plug-and-play Drive/Firebase
 * Fonte canônica de configuração do tenant-piloto WMGJ.
 *
 * Segredos entram somente por parâmetro de uma chamada autenticada/administrativa
 * e são persistidos em ScriptProperties. Nunca são retornados ou logados.
 */
var AURORA_CONNECTOR_SETUP_VERSION = 'v1.1.3-inactive-source-reuse';
var AURORA_CONNECTOR_REUSE_OWNER_HASH = 'bb3a1e4a24554f0cd324e0fb8a14559df4fe22a1f3b40e8d7d1f454f9d2ffc09';
var AURORA_CONNECTOR_REUSE_FOLDER = '1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-';
var AURORA_CONNECTOR_REUSE_DEADLINE = '2026-10-16T03:00:00.000Z';

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
  return auroraResolverFontesDocumentais_(PropertiesService.getScriptProperties()).sources;
}

// Resolution is pure configuration inspection. A previously unregistered legacy
// source is only a candidate: it must never become executable through fallback.
function auroraResolverFontesDocumentais_(props) {
  var raw = props.getProperty('AURORA_DOCUMENT_SOURCE_REGISTRY');
  var registered;
  try { registered = raw ? JSON.parse(raw) : []; } catch (ignore) { throw new Error('AURORA_DOCUMENT_SOURCE_REGISTRY_INVALID'); }
  if (!Array.isArray(registered) || registered.length > 12) throw new Error('AURORA_DOCUMENT_SOURCE_REGISTRY_INVALID');
  var seen = {};
  registered.forEach(function(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(function(key) { return ['sourceId', 'system', 'mode', 'folderId', 'folderName', 'slaMinutes', 'active'].indexOf(key) < 0; })
      || (item.folderName !== undefined && (typeof item.folderName !== 'string' || item.folderName.length > 256))
      || !/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(item.sourceId || '') || seen[item.sourceId]
      || ['DRIVE', 'MV', 'TASY', 'ERP'].indexOf(item.system) < 0 || item.mode !== 'DRIVE_FOLDER'
      || !/^[A-Za-z0-9_-]{10,200}$/.test(item.folderId || '')
      || !Number.isSafeInteger(item.slaMinutes) || item.slaMinutes < 15 || item.slaMinutes > 43200
      || (item.active !== undefined && typeof item.active !== 'boolean')) throw new Error('AURORA_DOCUMENT_SOURCE_REGISTRY_INVALID');
    seen[item.sourceId] = true;
  });
  if (registered.length) {
    var primary = registered.filter(function(item) { return item.sourceId === 'drive-primary'; });
    var configured = props.getProperty('WMGJ_PASTA_ENTRADA_ID');
    if (props.getProperty('WMGJ_FIRESTORE_ORG_ID') === 'wmgj' && configured && primary.length
      && primary[0].folderId !== configured) throw new Error('AURORA_DOCUMENT_SOURCE_REGISTRY_INVALID');
    return {registered: true, legacy: false, candidates: registered,
      sources: registered.filter(function(item) { return item.active !== false; })};
  }
  var fallback = String(props.getProperty('WMGJ_PASTA_ENTRADA_ID') || '');
  var active = true;
  if (!fallback && props.getProperty('WMGJ_FIRESTORE_ORG_ID') === 'wmgj' && typeof getConfigWMGJ_ === 'function') {
    fallback = String(getConfigWMGJ_().PASTA_ENTRADA_ID || '');
    active = false;
  }
  if (fallback && !/^[A-Za-z0-9_-]{10,200}$/.test(fallback)) throw new Error('AURORA_DOCUMENT_SOURCE_REGISTRY_INVALID');
  var candidates = fallback ? [{sourceId: 'drive-primary', system: 'DRIVE', mode: 'DRIVE_FOLDER',
    folderId: fallback, slaMinutes: 1440, active: active}] : [];
  return {registered: false, legacy: !!fallback, candidates: candidates, sources: active ? candidates : []};
}

function auroraConnectorReuseSha_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function(n) { return ('0' + ((n + 256) % 256).toString(16)).slice(-2); }).join('');
}

function auroraConnectorReuseOwner_() {
  var active = '', effective = '';
  try {
    active = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (ignore) { throw new Error('AURORA_CONNECTOR_REUSE_OWNER_REQUIRED'); }
  if (!active || active !== effective || auroraConnectorReuseSha_(active) !== AURORA_CONNECTOR_REUSE_OWNER_HASH) {
    throw new Error('AURORA_CONNECTOR_REUSE_OWNER_REQUIRED');
  }
}

function auroraConnectorReuseWindow_() {
  if (Date.now() >= Date.parse(AURORA_CONNECTOR_REUSE_DEADLINE)) throw new Error('AURORA_CONNECTOR_REUSE_EXPIRED');
}

function auroraConnectorReuseTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  if (!Array.isArray(triggers) || triggers.length > 12) throw new Error('AURORA_CONNECTOR_REUSE_TRIGGER_REVIEW_REQUIRED');
  return triggers.map(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (typeof handler !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(handler)) throw new Error('AURORA_CONNECTOR_REUSE_TRIGGER_REVIEW_REQUIRED');
    return auroraConnectorReuseSha_(handler);
  }).sort();
}

function auroraConnectorReuseSnapshot_(props) {
  var keys = ['WMGJ_FIRESTORE_ORG_ID', 'WMGJ_FIRESTORE_INGEST_URL', 'WMGJ_FIRESTORE_HMAC_KEY_ID',
    'WMGJ_FIRESTORE_HMAC_SECRET', 'WMGJ_FIRESTORE_DRY_RUN', 'AURORA_FIRESTORE_MIRROR_REQUIRED',
    'WMGJ_PASTA_ENTRADA_ID', 'AURORA_DOCUMENT_SOURCE_REGISTRY', 'AURORA_CONNECTOR_SETUP_VERSION'];
  var value = {};
  keys.forEach(function(key) { var current = props.getProperty(key); value[key] = current == null ? null : current; });
  var registered;
  try { registered = value.AURORA_DOCUMENT_SOURCE_REGISTRY ? JSON.parse(value.AURORA_DOCUMENT_SOURCE_REGISTRY) : []; }
  catch (ignore) { throw new Error('AURORA_DOCUMENT_SOURCE_REGISTRY_INVALID'); }
  if (!Array.isArray(registered) || registered.length > 12) throw new Error('AURORA_DOCUMENT_SOURCE_REGISTRY_INVALID');
  value.legacyFolder = !registered.length && !value.WMGJ_PASTA_ENTRADA_ID && typeof getConfigWMGJ_ === 'function'
    ? String(getConfigWMGJ_().PASTA_ENTRADA_ID || '') : null;
  return value;
}

// No provider enrollment, secret argument, activation or operational execution.
// CONFIGURE only registers an INACTIVE candidate in the existing properties.
function auroraReaproveitarFonteWmgjConfigOnly(request) {
  var result = {ok: false, code: 'AURORA_CONNECTOR_REUSE_PENDING', state: 'PENDING_CONFIGURATION',
    scope: 'WMGJ_EXISTING_SOURCE_CONFIG_ONLY', sourceIdentified: false, sourceCount: 0,
    metadataAccessVerified: false, existingHmacReused: false, configurationSha256: null,
    triggerCount: null, handlerHashes: [], triggerReviewRequired: false, configurationWriteEligible: false,
    configurationChanged: false, configurationUncertain: false, rollbackVerified: false,
    configOnly: true, sourceActive: false, triggersChanged: false, contentRead: false,
    providerConsentVerified: false, firstIngestionVerified: false, operationalReady: false,
    installationComplete: false, complete: false};
  var lock = null, held = false, props = null, before = null, changes = null, attempted = false;
  try {
    auroraConnectorReuseOwner_();
    auroraConnectorReuseWindow_();
    var keys = ['confirmation', 'configOnly', 'mode', 'orgId', 'expectedFolderId', 'expectedSourceId', 'expectedSlaMinutes', 'expectedConfigurationSha256'];
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).sort().join(',') !== keys.sort().join(',')
      || request.confirmation !== 'REUSE_EXISTING_WMGJ_SOURCE_CONFIG_ONLY' || request.configOnly !== true
      || ['PREVIEW', 'CONFIGURE'].indexOf(request.mode) < 0 || request.orgId !== 'wmgj'
      || request.expectedFolderId !== AURORA_CONNECTOR_REUSE_FOLDER || request.expectedSourceId !== 'drive-primary'
      || !Number.isSafeInteger(request.expectedSlaMinutes) || request.expectedSlaMinutes < 15 || request.expectedSlaMinutes > 43200
      || (request.mode === 'PREVIEW' ? request.expectedConfigurationSha256 !== null
        : typeof request.expectedConfigurationSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedConfigurationSha256))) {
      throw new Error('AURORA_CONNECTOR_REUSE_REQUEST_REJECTED');
    }
    lock = LockService.getScriptLock();
    held = lock.tryLock(1000);
    if (!held) throw new Error('AURORA_CONNECTOR_REUSE_LOCK_BUSY');
    props = PropertiesService.getScriptProperties();
    if (props.getProperty('WMGJ_FIRESTORE_ORG_ID') !== 'wmgj') throw new Error('AURORA_CONNECTOR_REUSE_TENANT_MISMATCH');
    before = auroraConnectorReuseSnapshot_(props);
    if (before.WMGJ_FIRESTORE_INGEST_URL !== 'https://southamerica-east1-wmgj-hml-jfn-20260927.cloudfunctions.net/ingestWmgjEvent'
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(before.WMGJ_FIRESTORE_HMAC_KEY_ID || '')
      || !/^[a-fA-F0-9]{64}$/.test(before.WMGJ_FIRESTORE_HMAC_SECRET || '')) throw new Error('AURORA_CONNECTOR_REUSE_CONFIGURATION_INVALID');
    var resolved = auroraResolverFontesDocumentais_(props);
    var selected = resolved.candidates[0];
    if (resolved.candidates.length !== 1 || selected.folderId !== request.expectedFolderId
      || selected.sourceId !== request.expectedSourceId || selected.system !== 'DRIVE' || selected.slaMinutes !== request.expectedSlaMinutes
      || (before.WMGJ_PASTA_ENTRADA_ID && before.WMGJ_PASTA_ENTRADA_ID !== selected.folderId)) {
      throw new Error('AURORA_CONNECTOR_REUSE_SOURCE_CONFLICT');
    }
    auroraConnectorReuseWindow_();
    if (DriveApp.getFolderById(selected.folderId).getId() !== selected.folderId) throw new Error('AURORA_CONNECTOR_REUSE_SOURCE_CONFLICT');
    result.sourceIdentified = true; result.sourceCount = 1; result.metadataAccessVerified = true;
    result.existingHmacReused = true; result.state = 'SOURCE_IDENTIFIED';
    result.sourceActive = selected.active !== false;
    auroraConnectorReuseWindow_();
    var handlers = auroraConnectorReuseTriggers_();
    result.triggerCount = handlers.length; result.handlerHashes = handlers;
    result.triggerReviewRequired = handlers.length > 0;
    if (result.triggerReviewRequired) result.state = 'PENDING_TRIGGER_REVIEW';
    result.configurationWriteEligible = !result.sourceActive && before.WMGJ_FIRESTORE_DRY_RUN === 'true'
      && (before.AURORA_FIRESTORE_MIRROR_REQUIRED === null || before.AURORA_FIRESTORE_MIRROR_REQUIRED === 'false') && !handlers.length;
    var fingerprint = auroraConnectorReuseSha_(JSON.stringify(before));
    result.configurationSha256 = fingerprint;
    if (request.mode === 'CONFIGURE') {
      if (!result.configurationWriteEligible) throw new Error('AURORA_CONNECTOR_REUSE_ACTIVE_STATE_REQUIRES_REVIEW');
      if (request.expectedConfigurationSha256 !== fingerprint
        || auroraConnectorReuseSha_(JSON.stringify(auroraConnectorReuseSnapshot_(props))) !== fingerprint
        || JSON.stringify(auroraConnectorReuseTriggers_()) !== JSON.stringify(handlers)) throw new Error('AURORA_CONNECTOR_REUSE_CAS_CONFLICT');
      changes = {AURORA_DOCUMENT_SOURCE_REGISTRY: resolved.registered ? before.AURORA_DOCUMENT_SOURCE_REGISTRY
        : JSON.stringify([{sourceId: selected.sourceId, system: 'DRIVE', mode: 'DRIVE_FOLDER',
          folderId: selected.folderId, slaMinutes: selected.slaMinutes, active: false}]),
        AURORA_CONNECTOR_SETUP_VERSION: AURORA_CONNECTOR_SETUP_VERSION};
      auroraConnectorReuseWindow_();
      if (Object.keys(changes).some(function(key) { return changes[key] !== before[key]; })) {
        attempted = true;
        props.setProperties(changes, false);
      }
      var after = auroraConnectorReuseSnapshot_(props);
      // The committed registry now has precedence over the legacy fallback.
      var expectedAfter = Object.assign({}, before, changes, {legacyFolder: null});
      if (!Object.keys(expectedAfter).every(function(key) { return after[key] === expectedAfter[key]; })) {
        throw new Error('AURORA_CONNECTOR_REUSE_CAS_CONFLICT');
      }
      auroraConnectorReuseWindow_();
      result.configurationChanged = JSON.stringify(after) !== JSON.stringify(before);
      result.configurationSha256 = auroraConnectorReuseSha_(JSON.stringify(after));
      result.state = 'CONFIGURED_INACTIVE';
    } else {
      if (auroraConnectorReuseSha_(JSON.stringify(auroraConnectorReuseSnapshot_(props))) !== fingerprint) throw new Error('AURORA_CONNECTOR_REUSE_CAS_CONFLICT');
      auroraConnectorReuseWindow_();
    }
    result.ok = true; result.code = 'AURORA_CONNECTOR_REUSE_CONFIG_ONLY_VERIFIED';
  } catch (error) {
    result.configurationSha256 = null;
    result.configurationWriteEligible = false;
    if (attempted) {
      result.configurationChanged = null;
      result.configurationUncertain = true;
      try {
        var owned = Object.keys(changes).every(function(key) { var current = props.getProperty(key); current = current == null ? null : current;
          return current === before[key] || current === changes[key]; });
        if (owned) {
          Object.keys(changes).forEach(function(key) {
            var current = props.getProperty(key); current = current == null ? null : current;
            if (current !== before[key] && current !== changes[key]) throw new Error('CAS_CONFLICT');
            if (before[key] === null) props.deleteProperty(key); else props.setProperty(key, before[key]);
          });
          result.rollbackVerified = JSON.stringify(auroraConnectorReuseSnapshot_(props)) === JSON.stringify(before);
          result.configurationUncertain = !result.rollbackVerified;
          if (result.rollbackVerified) result.configurationChanged = false;
        }
      } catch (ignoreRollback) {}
    }
    var codes = ['OWNER_REQUIRED', 'EXPIRED', 'REQUEST_REJECTED', 'LOCK_BUSY', 'TENANT_MISMATCH', 'CONFIGURATION_INVALID',
      'SOURCE_CONFLICT', 'ACTIVE_STATE_REQUIRES_REVIEW', 'CAS_CONFLICT', 'TRIGGER_REVIEW_REQUIRED', 'REGISTRY_INVALID'];
    var message = String(error && error.message || '');
    if (message === 'AURORA_DOCUMENT_SOURCE_REGISTRY_INVALID') message = 'AURORA_CONNECTOR_REUSE_REGISTRY_INVALID';
    result.code = codes.some(function(code) { return message === 'AURORA_CONNECTOR_REUSE_' + code; })
      ? message : 'AURORA_CONNECTOR_REUSE_DEPENDENCY_FAILED';
    if (result.configurationUncertain) {
      result.code = 'AURORA_CONNECTOR_REUSE_CONFIGURATION_UNCERTAIN';
      result.state = 'PENDING_CONFIGURATION_RECONCILIATION';
    }
  } finally {
    if (held) {
      try { lock.releaseLock(); }
      catch (ignoreRelease) { result.ok = false; result.code = 'AURORA_CONNECTOR_REUSE_DEPENDENCY_FAILED'; }
    }
  }
  return result;
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

// Public Execution API status: read-only, bounded and free of source identifiers.
// A completed status read never proves canonical ingestion or operational readiness.
function auroraLerStatusConectoresPlugAndPlay(expectedOrgId) {
  var result = {
    ok: false, code: 'AURORA_CONNECTOR_STATUS_PENDING',
    tenantConfigured: false, tenantMatches: false,
    configurationRead: false, configurationValid: false,
    endpointConfigured: false, hmacConfigured: false,
    mirrorRequired: false, dryRun: true,
    registryConfigured: false, registryValid: false, legacySourceSelected: false,
    sourceCount: null, reachableSourceCount: null, sourceAccessChecked: false,
    triggerRead: false, triggerCount: null,
    handlerCounts: { operational: null, legacyQueue: null, fiscal: null, watchdog: null, other: null },
    firstIngestionVerified: false, operationalReady: false,
    checkedAt: new Date().toISOString()
  };
  if (typeof expectedOrgId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(expectedOrgId)) {
    result.code = 'AURORA_CONNECTOR_STATUS_TENANT_INVALID';
    return result;
  }
  var props;
  try {
    props = PropertiesService.getScriptProperties();
    var orgId = String(props.getProperty('WMGJ_FIRESTORE_ORG_ID') || '').trim();
    result.tenantConfigured = /^[a-z0-9][a-z0-9-]{1,62}$/.test(orgId);
    result.tenantMatches = result.tenantConfigured && orgId === expectedOrgId;
    if (!result.tenantMatches) {
      result.code = 'AURORA_CONNECTOR_STATUS_TENANT_MISMATCH';
      return result;
    }
    var url = String(props.getProperty('WMGJ_FIRESTORE_INGEST_URL') || '').trim();
    var keyId = String(props.getProperty('WMGJ_FIRESTORE_HMAC_KEY_ID') || '').trim();
    var secret = String(props.getProperty('WMGJ_FIRESTORE_HMAC_SECRET') || '');
    var mirror = String(props.getProperty('AURORA_FIRESTORE_MIRROR_REQUIRED') || 'false').toLowerCase();
    var dryRun = String(props.getProperty('WMGJ_FIRESTORE_DRY_RUN') || 'true').toLowerCase();
    result.endpointConfigured = /^https:\/\/[^\s]+\/ingestWmgjEvent$/.test(url);
    result.hmacConfigured = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(keyId) && /^[A-Fa-f0-9]{64}$/.test(secret);
    result.mirrorRequired = mirror === 'true';
    result.dryRun = dryRun !== 'false';
    result.configurationRead = true;
    result.configurationValid = result.endpointConfigured && result.hmacConfigured
      && /^(true|false)$/.test(mirror) && /^(true|false)$/.test(dryRun);
  } catch (ignoreConfig) {
    result.code = 'AURORA_CONNECTOR_STATUS_CONFIG_READ_FAILED';
    return result;
  }
  var sources;
  try {
    var raw = props.getProperty('AURORA_DOCUMENT_SOURCE_REGISTRY');
    result.registryConfigured = !!raw;
    var resolved = auroraResolverFontesDocumentais_(props);
    sources = resolved.sources;
    result.legacySourceSelected = resolved.legacy;
    result.registryValid = true;
    result.sourceCount = sources.length;
  } catch (ignoreRegistry) {
    result.code = 'AURORA_CONNECTOR_STATUS_REGISTRY_INVALID';
    return result;
  }
  if (typeof DriveApp === 'undefined' || typeof DriveApp.getFolderById !== 'function') {
    result.code = 'AURORA_CONNECTOR_STATUS_SOURCE_ACCESS_UNAVAILABLE';
    return result;
  }
  result.reachableSourceCount = 0;
  sources.forEach(function(source) {
    try { if (DriveApp.getFolderById(source.folderId)) result.reachableSourceCount++; }
    catch (ignoreAccess) {} // No source names, IDs or raw transport errors leave this function.
  });
  result.sourceAccessChecked = true;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var counts = { operational: 0, legacyQueue: 0, fiscal: 0, watchdog: 0, other: 0 };
    triggers.forEach(function(trigger) {
      var handler = trigger.getHandlerFunction();
      if (handler === 'executarAutomacaoOperacionalWMGJ') counts.operational++;
      else if (handler === 'jobProcessarFilaWMGJ') counts.legacyQueue++;
      else if (handler === 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ'
        || handler === 'rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20') counts.fiscal++;
      else if (handler === 'rodarWatchdogWMGJ' || handler === 'executarAutomacaoWMGJBlindada'
        || handler === 'executarAutomacaoWMGJBlindada_Teste20') counts.watchdog++;
      else counts.other++;
    });
    result.handlerCounts = counts;
    result.triggerCount = triggers.length;
    result.triggerRead = true;
  } catch (ignoreTriggers) {
    result.code = 'AURORA_CONNECTOR_STATUS_TRIGGER_READ_FAILED';
    return result;
  }
  result.ok = true;
  result.code = 'AURORA_CONNECTOR_STATUS_READ_COMPLETE';
  return result;
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
