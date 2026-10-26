/**
 * AURORA NEXUS — conectores plug-and-play Drive/Firebase
 * Fonte canônica de configuração do tenant-piloto WMGJ.
 *
 * Segredos entram somente por parâmetro de uma chamada autenticada/administrativa
 * e são persistidos em ScriptProperties. Nunca são retornados ou logados.
 */
var AURORA_CONNECTOR_SETUP_VERSION = 'v1.1.4-scoped-configuration-repair';
var AURORA_CONNECTOR_REUSE_OWNER_HASH = 'bb3a1e4a24554f0cd324e0fb8a14559df4fe22a1f3b40e8d7d1f454f9d2ffc09';
var AURORA_CONNECTOR_REUSE_FOLDER = '1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-';
var AURORA_CONNECTOR_REUSE_DEADLINE = '2026-10-16T03:00:00.000Z';
// Separate, bounded owner instruction. This does not renew HML publication,
// R029, real-source activation, processing or the historical reuse pilot.
var AURORA_CONNECTOR_REPAIR_DECISION = 'AURORA-WMGJ-CONFIG-REGULARIZATION-20261022';
var AURORA_CONNECTOR_REPAIR_NOT_BEFORE = '2026-10-22T23:27:22.000Z';
var AURORA_CONNECTOR_REPAIR_DEADLINE = '2026-10-23T23:27:22.000Z';

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

function auroraConnectorReuseWindow_(authorization) {
  var deadline = Date.parse(authorization ? authorization.deadline : AURORA_CONNECTOR_REUSE_DEADLINE);
  var start = authorization && authorization.notBefore ? Date.parse(authorization.notBefore) : -Infinity;
  if (!Number.isFinite(deadline) || Number.isNaN(start) || Date.now() < start || Date.now() >= deadline) {
    throw new Error('AURORA_CONNECTOR_REUSE_EXPIRED');
  }
}

function auroraConnectorRepairAuthorization_() {
  return {confirmation: 'REGULARIZE_EXISTING_WMGJ_SOURCE_CONFIG_ONLY',
    notBefore: AURORA_CONNECTOR_REPAIR_NOT_BEFORE, deadline: AURORA_CONNECTOR_REPAIR_DEADLINE};
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
  return auroraReaproveitarFonteWmgjConfigOnly_(request, {
    confirmation: 'REUSE_EXISTING_WMGJ_SOURCE_CONFIG_ONLY', deadline: AURORA_CONNECTOR_REUSE_DEADLINE});
}

function auroraRegularizarFonteWmgjConfigOnly(request) {
  var result = auroraReaproveitarFonteWmgjConfigOnly_(request, auroraConnectorRepairAuthorization_());
  result.authorizationDecisionId = AURORA_CONNECTOR_REPAIR_DECISION;
  return result;
}

function auroraReaproveitarFonteWmgjConfigOnly_(request, authorization) {
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
    auroraConnectorReuseWindow_(authorization);
    var keys = ['confirmation', 'configOnly', 'mode', 'orgId', 'expectedFolderId', 'expectedSourceId', 'expectedSlaMinutes', 'expectedConfigurationSha256'];
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).sort().join(',') !== keys.sort().join(',')
      || request.confirmation !== authorization.confirmation || request.configOnly !== true
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
    auroraConnectorReuseWindow_(authorization);
    if (DriveApp.getFolderById(selected.folderId).getId() !== selected.folderId) throw new Error('AURORA_CONNECTOR_REUSE_SOURCE_CONFLICT');
    result.sourceIdentified = true; result.sourceCount = 1; result.metadataAccessVerified = true;
    result.existingHmacReused = true; result.state = 'SOURCE_IDENTIFIED';
    result.sourceActive = selected.active !== false;
    auroraConnectorReuseWindow_(authorization);
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
      auroraConnectorReuseWindow_(authorization);
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
      auroraConnectorReuseWindow_(authorization);
      result.configurationChanged = JSON.stringify(after) !== JSON.stringify(before);
      result.configurationSha256 = auroraConnectorReuseSha_(JSON.stringify(after));
      result.state = 'CONFIGURED_INACTIVE';
    } else {
      if (auroraConnectorReuseSha_(JSON.stringify(auroraConnectorReuseSnapshot_(props))) !== fingerprint) throw new Error('AURORA_CONNECTOR_REUSE_CAS_CONFLICT');
      auroraConnectorReuseWindow_(authorization);
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


// Repairs only the known orphan. Names/IDs never leave the authenticated
// script, and the caller must bind REMOVE to the exact PREVIEW fingerprint.
function auroraConnectorOrphanSnapshot_() {
  var triggers = ScriptApp.getProjectTriggers();
  if (!Array.isArray(triggers) || triggers.length > 12) throw new Error('AURORA_CONNECTOR_ORPHAN_TRIGGER_REVIEW_REQUIRED');
  var ids = {};
  var entries = triggers.map(function(trigger) {
    var id = String(trigger.getUniqueId() || '');
    var handler = String(trigger.getHandlerFunction() || '');
    var event = String(trigger.getEventType() || '');
    var source = String(trigger.getTriggerSource() || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || ids[id]
      || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(handler)
      || !/^[A-Z_]{1,64}$/.test(event) || !/^[A-Z_]{1,64}$/.test(source)) {
      throw new Error('AURORA_CONNECTOR_ORPHAN_TRIGGER_REVIEW_REQUIRED');
    }
    ids[id] = true;
    return {trigger: trigger, metadata: {id: id, handler: handler, event: event, source: source}};
  });
  entries.sort(function(a, b) { return a.metadata.id < b.metadata.id ? -1 : a.metadata.id > b.metadata.id ? 1 : 0; });
  return {entries: entries, sha256: auroraConnectorReuseSha_(JSON.stringify(entries.map(function(item) { return item.metadata; })))};
}

function auroraConnectorOrphanGuard_(props) {
  auroraConnectorReuseOwner_();
  auroraConnectorReuseWindow_(auroraConnectorRepairAuthorization_());
  if (props.getProperty('WMGJ_FIRESTORE_ORG_ID') !== 'wmgj') throw new Error('AURORA_CONNECTOR_ORPHAN_TENANT_MISMATCH');
  if (props.getProperty('WMGJ_FIRESTORE_DRY_RUN') !== 'true'
    || ['false', null].indexOf(props.getProperty('AURORA_FIRESTORE_MIRROR_REQUIRED')) < 0
    || auroraResolverFontesDocumentais_(props).sources.length) throw new Error('AURORA_CONNECTOR_ORPHAN_ACTIVE_STATE_REQUIRES_REVIEW');
  // Fail closed even if the symbol was reintroduced with a non-function value.
  if (typeof auroraNexusCaptureCycle !== 'undefined') throw new Error('AURORA_CONNECTOR_ORPHAN_HANDLER_PRESENT');
}

function auroraRemoverGatilhoOrfaoWmgjConfigOnly(request) {
  var result = {ok: false, code: 'AURORA_CONNECTOR_ORPHAN_PENDING',
    authorizationDecisionId: AURORA_CONNECTOR_REPAIR_DECISION, configOnly: true,
    triggerCount: null, expectedTriggerSetSha256: null, removedCount: 0,
    triggersChanged: false, removalUncertain: false, absenceVerified: false,
    configurationChanged: false, contentRead: false, operationalReady: false, complete: false};
  var lock = null, held = false, attempted = false;
  try {
    auroraConnectorReuseOwner_();
    auroraConnectorReuseWindow_(auroraConnectorRepairAuthorization_());
    var keys = ['confirmation', 'configOnly', 'orgId', 'mode', 'expectedTriggerSetSha256'];
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).sort().join(',') !== keys.sort().join(',')
      || request.confirmation !== 'REMOVE_MISSING_WMGJ_CAPTURE_HANDLER_CONFIG_ONLY'
      || request.configOnly !== true || request.orgId !== 'wmgj'
      || ['PREVIEW', 'REMOVE'].indexOf(request.mode) < 0
      || (request.mode === 'PREVIEW' ? request.expectedTriggerSetSha256 !== null
        : typeof request.expectedTriggerSetSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedTriggerSetSha256))) {
      throw new Error('AURORA_CONNECTOR_ORPHAN_REQUEST_REJECTED');
    }
    lock = LockService.getScriptLock(); held = lock.tryLock(1000);
    if (!held) throw new Error('AURORA_CONNECTOR_ORPHAN_LOCK_BUSY');
    var props = PropertiesService.getScriptProperties();
    auroraConnectorOrphanGuard_(props);
    var before = auroraConnectorOrphanSnapshot_();
    result.triggerCount = before.entries.length;
    if (before.entries.length > 1 || before.entries.some(function(item) {
      return item.metadata.handler !== 'auroraNexusCaptureCycle' || item.metadata.event !== 'CLOCK' || item.metadata.source !== 'CLOCK';
    })) throw new Error('AURORA_CONNECTOR_ORPHAN_TRIGGER_REVIEW_REQUIRED');
    result.expectedTriggerSetSha256 = before.sha256;
    if (!before.entries.length) {
      // A repeated call certifies current absence, not a second deletion.
      result.absenceVerified = true;
      result.code = 'AURORA_CONNECTOR_ORPHAN_ALREADY_ABSENT';
    } else if (request.mode === 'PREVIEW') {
      result.code = 'AURORA_CONNECTOR_ORPHAN_PREVIEW_VERIFIED';
    } else {
      if (request.expectedTriggerSetSha256 !== before.sha256) throw new Error('AURORA_CONNECTOR_ORPHAN_CAS_CONFLICT');
      auroraConnectorOrphanGuard_(props);
      var current = auroraConnectorOrphanSnapshot_();
      if (current.sha256 !== before.sha256) throw new Error('AURORA_CONNECTOR_ORPHAN_CAS_CONFLICT');
      // Recheck state after metadata retrieval, immediately before deletion.
      auroraConnectorOrphanGuard_(props);
      attempted = true;
      ScriptApp.deleteTrigger(current.entries[0].trigger);
      var after = auroraConnectorOrphanSnapshot_();
      if (after.entries.length) throw new Error('AURORA_CONNECTOR_ORPHAN_READBACK_FAILED');
      result.removedCount = 1; result.triggersChanged = true; result.absenceVerified = true;
      result.triggerCount = 0; result.expectedTriggerSetSha256 = after.sha256;
      result.code = 'AURORA_CONNECTOR_ORPHAN_REMOVAL_VERIFIED';
    }
    auroraConnectorReuseWindow_(auroraConnectorRepairAuthorization_());
    result.ok = true;
  } catch (error) {
    var message = String(error && error.message || '');
    var allowed = ['OWNER_REQUIRED', 'EXPIRED', 'REQUEST_REJECTED', 'LOCK_BUSY', 'TENANT_MISMATCH',
      'ACTIVE_STATE_REQUIRES_REVIEW', 'HANDLER_PRESENT', 'TRIGGER_REVIEW_REQUIRED', 'CAS_CONFLICT', 'READBACK_FAILED'];
    if (message === 'AURORA_CONNECTOR_REUSE_OWNER_REQUIRED') message = 'AURORA_CONNECTOR_ORPHAN_OWNER_REQUIRED';
    if (message === 'AURORA_CONNECTOR_REUSE_EXPIRED') message = 'AURORA_CONNECTOR_ORPHAN_EXPIRED';
    result.code = allowed.some(function(code) { return message === 'AURORA_CONNECTOR_ORPHAN_' + code; })
      ? message : 'AURORA_CONNECTOR_ORPHAN_DEPENDENCY_FAILED';
    if (attempted && !result.absenceVerified) {
      result.triggersChanged = null; result.removalUncertain = true;
      result.code = 'AURORA_CONNECTOR_ORPHAN_REMOVAL_UNCERTAIN';
    }
    result.expectedTriggerSetSha256 = null;
  } finally {
    if (held) {
      try { lock.releaseLock(); }
      catch (ignoreRelease) { result.ok = false; result.code = 'AURORA_CONNECTOR_ORPHAN_DEPENDENCY_FAILED'; }
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

// Bounded Drive-only intake. The authenticated operator supplies a private scope;
// credentials remain in existing ScriptProperties. No trigger or global mode changes.
function auroraDriveIntakeScope_(request) {
  var fields = ['mode','orgId','sources','fileIds','excludedFolderIds','maxScan','limit','expectedScopeSha256'];
  if(request && request.mode==='READBACK') fields.push('readbackOffset');
  var isId = function(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value); };
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).sort().join(',') !== fields.sort().join(',')
    || ['PREVIEW','EXECUTE','PROCESS_EXISTING','READBACK'].indexOf(request.mode) < 0
    || (request.mode==='READBACK' && (!Number.isSafeInteger(request.readbackOffset) || request.readbackOffset<0))
    || typeof request.orgId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(request.orgId)
    || !Array.isArray(request.sources) || request.sources.length < 1 || request.sources.length > 12
    || !Array.isArray(request.fileIds) || request.fileIds.length > 200 || !request.fileIds.every(isId)
    || !Array.isArray(request.excludedFolderIds) || request.excludedFolderIds.length > 100 || !request.excludedFolderIds.every(isId)
    || !Number.isSafeInteger(request.maxScan) || request.maxScan < 1 || request.maxScan > 1000
    || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 20
    || (request.mode === 'PREVIEW' ? request.expectedScopeSha256 !== null
      : !/^[a-f0-9]{64}$/.test(request.expectedScopeSha256 || ''))) throw new Error('AURORA_DRIVE_REQUEST_REJECTED');
  var sourceIds = Object.create(null), folders = Object.create(null), files = Object.create(null), excluded = Object.create(null);
  var sources = request.sources.map(function(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).sort().join(',') !== ['sourceId','system','folderId','slaMinutes','active'].sort().join(',')
      || typeof source.sourceId !== 'string' || !/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(source.sourceId)
      || source.system !== 'DRIVE' || source.active !== true || !isId(source.folderId)
      || !Number.isSafeInteger(source.slaMinutes) || source.slaMinutes < 15 || source.slaMinutes > 43200
      || sourceIds[source.sourceId] || folders[source.folderId]) throw new Error('AURORA_DRIVE_SOURCE_SCOPE_REJECTED');
    sourceIds[source.sourceId] = true; folders[source.folderId] = true;
    return {sourceId:source.sourceId,system:'DRIVE',folderId:source.folderId,slaMinutes:source.slaMinutes,active:true};
  }).sort(function(a,b) { return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0; });
  request.fileIds.forEach(function(id) {
    if (files[id] || folders[id]) throw new Error('AURORA_DRIVE_SOURCE_SCOPE_REJECTED');
    files[id] = true;
  });
  request.excludedFolderIds.forEach(function(id) {
    if (excluded[id] || folders[id] || files[id]) throw new Error('AURORA_DRIVE_SOURCE_SCOPE_REJECTED');
    excluded[id] = true;
  });
  return {orgId:request.orgId,sources:sources,fileIds:request.fileIds.slice(),
    excludedFolderIds:request.excludedFolderIds.slice().sort(),maxScan:request.maxScan,limit:request.limit};
}

function auroraDriveIntakeGuard_(scope, expectedHash, verifyAccess) {
  auroraConnectorReuseOwner_();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('WMGJ_FIRESTORE_ORG_ID') !== scope.orgId) throw new Error('AURORA_DRIVE_TENANT_MISMATCH');
  if (typeof wmgjFirestoreConfig_ !== 'function') throw new Error('AURORA_DRIVE_DEPENDENCY_MISSING');
  var existing = wmgjFirestoreConfig_();
  if (!existing || existing.orgId !== scope.orgId
    || typeof existing.url !== 'string' || !/^https:\/\/[^\s]+\/ingestWmgjEvent$/.test(existing.url)
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(existing.keyId || '')
    || !/^[a-fA-F0-9]{64}$/.test(existing.secret || '')) throw new Error('AURORA_DRIVE_CONFIGURATION_INVALID');
  var config = {url:existing.url,keyId:existing.keyId,secret:existing.secret,
    orgId:existing.orgId,dryRun:false,maxRows:existing.maxRows};
  var fingerprint = auroraConnectorReuseSha_(JSON.stringify({scope:scope,endpoint:config.url,
    keyId:config.keyId,secretSha256:auroraConnectorReuseSha_(config.secret)}));
  if (expectedHash !== null && expectedHash !== fingerprint) throw new Error('AURORA_DRIVE_SCOPE_CHANGED');
  if (verifyAccess) {
    scope.sources.forEach(function(source) {
      if (DriveApp.getFolderById(source.folderId).getId() !== source.folderId) throw new Error('AURORA_DRIVE_SOURCE_UNAVAILABLE');
    });
    scope.fileIds.forEach(function(id) {
      var file = DriveApp.getFileById(id);
      if (file.getId() !== id || (typeof file.isTrashed === 'function' && file.isTrashed())) throw new Error('AURORA_DRIVE_SOURCE_UNAVAILABLE');
    });
  }
  return {scopeSha256:fingerprint,config:config};
}

function auroraDriveIntakeReceipt_(item) {
    if (!item || !/^[a-f0-9]{48}$/.test(item.entityId || '') || !/^[A-Za-z0-9_-]{10,200}$/.test(item.sourceId || '')
      || !/^[a-f0-9]{64}$/.test(item.contentHash || '') || !/^[a-f0-9]{64}$/.test(item.contentSha256 || '')
      || item.contentHash!==item.contentSha256
      || !/^[a-f0-9]{64}$/.test(item.textSha256 || '')
      || !/^[a-f0-9]{64}$/.test(item.canonicalSnapshotHash || '')
      || !Number.isSafeInteger(item.sourceVersion) || item.sourceVersion < 1
      || !Number.isSafeInteger(item.revision) || item.revision < 1
      || typeof item.versionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(item.versionId)
      || item.replayVerified !== true) throw new Error('AURORA_DRIVE_RESULT_INVALID');
    return {entityId:item.entityId,sourceId:item.sourceId,contentHash:item.contentHash,
      contentSha256:item.contentSha256,textSha256:item.textSha256,canonicalSnapshotHash:item.canonicalSnapshotHash,sourceVersion:item.sourceVersion,
      revision:item.revision,versionId:item.versionId,replayVerified:true};
}

// Read-only, bounded diagnostics for this exact authorized continuation. Never
// return property values, source identifiers, group names or continuation tokens.
function auroraDriveResumeDiagnostics_(scope, scopeSha256) {
  var props=PropertiesService.getScriptProperties(),suffix=scope.orgId+'_'+scopeSha256.slice(0,24);
  var number=function(value) { return Number.isSafeInteger(value) && value>=0 ? value : null; };
  function utf8Bytes(text) {
    var length=0;
    for(var i=0;i<text.length;i++) {
      var c=text.charCodeAt(i);
      if(c<128) length++;
      else if(c<2048) length+=2;
      else if(c>=55296 && c<=56319 && i+1<text.length
        && text.charCodeAt(i+1)>=56320 && text.charCodeAt(i+1)<=57343) { length+=4;i++; }
      else length+=3;
    }
    return length;
  }
  function inspect(key) {
    var info={present:null,readStatus:'READ_FAILED',characters:null,utf8Bytes:null,jsonValid:false},value=null;
    try {
      var raw=props.getProperty(key);
      info.present=raw!==null;
      if(raw===null) { info.readStatus='ABSENT';return {info:info,value:value}; }
      if(typeof raw!=='string') return {info:info,value:value};
      info.characters=raw.length;
      if(raw.length>16384) { info.readStatus='OVERSIZE';return {info:info,value:value}; }
      info.utf8Bytes=utf8Bytes(raw);info.readStatus='PRESENT';
      try { value=JSON.parse(raw);info.jsonValid=true; } catch(ignoreJson) {}
    } catch(ignoreRead) {}
    return {info:info,value:value};
  }
  var cursorRead=inspect('AURORA_DRIVE_CURSOR_'+suffix),cursor=cursorRead.info,state=cursorRead.value;
  cursor.contractValid=false;cursor.scopeMatches=null;cursor.explicitIndex=null;cursor.rootIndex=null;
  cursor.scanned=null;cursor.folders=null;cursor.excluded=null;cursor.complete=null;
  cursor.stackDepth=null;cursor.framesTruncated=false;cursor.frames=[];
  if(state && typeof state==='object' && !Array.isArray(state)) {
    cursor.scopeMatches=state.scopeSha256===scopeSha256;
    cursor.explicitIndex=number(state.explicitIndex);cursor.rootIndex=number(state.rootIndex);
    cursor.scanned=number(state.scanned);cursor.folders=number(state.folders);cursor.excluded=number(state.excluded);
    cursor.complete=typeof state.complete==='boolean'?state.complete:null;
    if(Array.isArray(state.stack)) {
      cursor.stackDepth=state.stack.length;cursor.framesTruncated=state.stack.length>24;
      cursor.frames=state.stack.slice(0,24).map(function(frame,index) {
        var object=frame && typeof frame==='object' && !Array.isArray(frame);
        var token=object?frame.token:undefined;
        var sourceIndex=object?scope.sources.findIndex(function(source) {
          return source.sourceId===frame.sourceId && source.folderId===frame.rootId;
        }):-1;
        return {index:index,stage:object && (frame.stage==='FILES' || frame.stage==='FOLDERS')?frame.stage:'INVALID',
          folderIdValid:!!object && typeof frame.folderId==='string' && /^[A-Za-z0-9_-]{10,200}$/.test(frame.folderId),
          sourceIndex:sourceIndex>=0?sourceIndex:null,
          tokenTypeValid:token===null || typeof token==='string',
          tokenCharacters:token===null?0:typeof token==='string'?token.length:null,
          tokenUtf8Bytes:token===null?0:typeof token==='string'?utf8Bytes(token):null};
      });
      cursor.contractValid=state.schemaVersion===1 && cursor.scopeMatches && !cursor.framesTruncated
        && cursor.explicitIndex!==null && cursor.explicitIndex<=scope.fileIds.length
        && cursor.rootIndex!==null && cursor.rootIndex<=scope.sources.length
        && cursor.scanned!==null && cursor.folders!==null && cursor.excluded!==null && cursor.complete!==null
        && cursor.frames.every(function(frame) {
          return frame.stage!=='INVALID' && frame.folderIdValid && frame.sourceIndex!==null && frame.tokenTypeValid;
        });
    }
  }
  var priorityRead=inspect('AURORA_DRIVE_PROCESS_'+suffix+'_PRIORITY_V1'),priority=priorityRead.info,groups=priorityRead.value;
  priority.contractValid=false;priority.groupCount=null;priority.unknownGroupCount=null;priority.maxOrdinal=null;
  if(groups && typeof groups==='object' && !Array.isArray(groups)) {
    var keys=Object.keys(groups),valid=true,unknown=0,max=0;
    keys.forEach(function(key) {
      if(key!=='explicit' && key!=='unmapped' && !scope.sources.some(function(source) { return key==='source:'+source.sourceId; })) unknown++;
      var ordinal=number(groups[key]);if(ordinal===null) valid=false;else max=Math.max(max,ordinal);
    });
    priority.groupCount=keys.length;priority.unknownGroupCount=unknown;
    priority.maxOrdinal=valid?max:null;priority.contractValid=valid && unknown===0;
  }
  // A stored cursor below 8,000 characters can still overflow when the next
  // token is obtained. These measurements do not declare resumability or health.
  return {schemaVersion:'aurora.drive-resume-diagnostics.v1',readOnly:true,cursor:cursor,priority:priority};
}

function auroraDriveReadbackResult_(value, result, expectedOffset, limit) {
  if(!value || !value.coverage || !Array.isArray(value.privateReadbackPlan) || !Array.isArray(value.privateAliasRows))
    throw new Error('AURORA_DRIVE_RESULT_INVALID');
  var c=value.coverage;
  var pending=value.privatePendingRows===undefined && c.pagePending===0?[]:value.privatePendingRows;
  if(!Array.isArray(pending) || pending.length!==c.pagePending) throw new Error('AURORA_DRIVE_RECEIPT_COVERAGE_INVALID');
  ['offset','total','documents','aliases','pending','returned','pageDocuments','pageAliases','pagePending'].forEach(function(key) {
    if(!Number.isSafeInteger(c[key]) || c[key]<0) throw new Error('AURORA_DRIVE_RESULT_INVALID');
  });
  if(c.offset!==expectedOffset || c.documents+c.aliases+c.pending!==c.total
    || c.pageDocuments+c.pageAliases+c.pagePending!==c.returned || c.returned>limit
    || c.returned!==Math.min(limit,c.total-c.offset)
    || c.complete!==(c.offset+c.returned===c.total)
    || c.nextOffset!==(c.complete?null:c.offset+c.returned)
    || value.privateReadbackPlan.length!==c.pageDocuments+c.pageAliases
    || value.privateAliasRows.length!==c.pageAliases) throw new Error('AURORA_DRIVE_RECEIPT_COVERAGE_INVALID');
  result.privateReadbackPlan=value.privateReadbackPlan.map(auroraDriveIntakeReceipt_);
  result.privateAliasRows=value.privateAliasRows.map(function(alias) {
    if(!alias || !/^[A-Za-z0-9_-]{10,200}$/.test(alias.fileId||'')
      || !/^[A-Za-z0-9_-]{10,200}$/.test(alias.primaryFileId||'') || alias.fileId===alias.primaryFileId
      || !/^[a-f0-9]{64}$/.test(alias.contentHash||'') || !/^[a-f0-9]{48}$/.test(alias.entityId||'')
      || !result.privateReadbackPlan.some(function(receipt) {
        return receipt.sourceId===alias.primaryFileId && receipt.entityId===alias.entityId && receipt.contentHash===alias.contentHash;
      })) throw new Error('AURORA_DRIVE_RECEIPT_COVERAGE_INVALID');
    return {fileId:alias.fileId,primaryFileId:alias.primaryFileId,contentHash:alias.contentHash,entityId:alias.entityId};
  });
  result.privatePendingRows=pending.map(function(row) {
    if(!row || !/^[A-Za-z0-9_-]{10,200}$/.test(row.fileId||'')
      || !(row.sourceVersion===null || Number.isSafeInteger(row.sourceVersion) && row.sourceVersion>0)
      || !(row.attempts===null || Number.isSafeInteger(row.attempts) && row.attempts>=0)
      || !/^[A-Z_0-9]{1,100}$/.test(row.code||'')
      || ['PENDENTE','PROCESSANDO','EXTRAINDO','CLASSIFICANDO','PROCESSADO','ERRO_REPROCESSAR','DUPLICADO','REVISAR_HUMANO','UNKNOWN'].indexOf(row.queueStatus)<0
      || ['PDF','GOOGLE_SHEETS','GOOGLE_DOCS','ZIP','TEXT','OFFICE','IMAGE','OTHER'].indexOf(row.mediaType)<0)
      throw new Error('AURORA_DRIVE_RESULT_INVALID');
    return {fileId:row.fileId,sourceVersion:row.sourceVersion,queueStatus:row.queueStatus,
      attempts:row.attempts,code:row.code,mediaType:row.mediaType};
  });
  result.coverage={offset:c.offset,nextOffset:c.nextOffset,total:c.total,documents:c.documents,aliases:c.aliases,
    pending:c.pending,complete:c.complete,returned:c.returned,pageDocuments:c.pageDocuments,pageAliases:c.pageAliases,pagePending:c.pagePending};
  result.ok=true;result.code='AURORA_DRIVE_READBACK_PLAN';
  return result;
}

function auroraDriveIntakeResult_(value, result) {
  if (!value || typeof value !== 'object' || !value.scan || !value.process
    || typeof value.ok !== 'boolean' || value.triggersChanged === true || value.globalSettingsChanged === true
    || typeof value.scan.enumerationComplete !== 'boolean'
    || !Array.isArray(value.privateReadbackPlan) || value.privateReadbackPlan.length > 40) throw new Error('AURORA_DRIVE_RESULT_INVALID');
  var number = function(v) { if (!Number.isSafeInteger(v) || v < 0) throw new Error('AURORA_DRIVE_RESULT_INVALID'); return v; };
  var p = value.process;
  result.scan = {examined:number(value.scan.visited),queued:number(value.scan.enqueued),
    aliases:number(p.aliases),revisited:number(value.scan.duplicates),complete:value.scan.enumerationComplete};
  result.processing = {attempted:number(p.attempted),accepted:number(p.accepted),duplicates:number(p.duplicates),
    pending:number(p.pending),failed:number(p.blockingErrors),review:number(p.review),
    extractionErrors:number(p.errors),aliases:number(p.aliases),replayVerified:0};
  result.privateReadbackPlan = value.privateReadbackPlan.map(auroraDriveIntakeReceipt_);
  if (result.privateReadbackPlan.length !== result.processing.accepted + result.processing.duplicates
    || number(p.processed) !== result.privateReadbackPlan.length) throw new Error('AURORA_DRIVE_RECEIPT_COVERAGE_INVALID');
  result.processing.replayVerified = result.privateReadbackPlan.length;
  result.ok = value.ok;
  result.code = value.ok ? 'AURORA_DRIVE_BATCH_EXECUTED' : 'AURORA_DRIVE_BATCH_PENDING';
  return result;
}

// Public nondev Execution API entrypoint. Its private response must not be logged.
function auroraExecutarIngestaoDriveAutorizada(request) {
  var result = {ok:false,code:'AURORA_DRIVE_PENDING',scopeSha256:null,
    scan:{examined:0,queued:0,aliases:0,complete:false},
    processing:{attempted:0,accepted:0,duplicates:0,pending:0,failed:0,review:0,extractionErrors:0,aliases:0,replayVerified:0},privateReadbackPlan:[],
    triggersChanged:false,globalSettingsChanged:false,sourceMutation:false,
    firstIngestionVerified:false,fullSynchronizationVerified:false};
  var stage = 'GUARD';
  try {
    auroraConnectorReuseOwner_();
    var scope = auroraDriveIntakeScope_(request);
    var guarded = auroraDriveIntakeGuard_(scope, request.expectedScopeSha256, true);
    result.scopeSha256 = guarded.scopeSha256;
    if (request.mode === 'PREVIEW') {
      result.ok = true; result.code = 'AURORA_DRIVE_PREVIEW_VERIFIED'; return result;
    }
    if (typeof comTravaIngestaoGmailWMGJ_ !== 'function'
      || (request.mode==='READBACK' ? typeof auroraLerPlanoReadbackDriveAutorizado_ !== 'function'
        : request.mode==='PROCESS_EXISTING' ? typeof auroraProcessarFilaDriveAutorizada_ !== 'function'
          || typeof getPlanilhaWMGJ_Compat_ !== 'function' || typeof getConfigWMGJ_Compat_ !== 'function'
        : typeof auroraExecutarCicloDriveAutorizado_ !== 'function')) {
      throw new Error('AURORA_DRIVE_DEPENDENCY_MISSING');
    }
    stage = 'SHARED_LOCK';
    return comTravaIngestaoGmailWMGJ_(function() {
      stage = 'GUARD';
      var current = auroraDriveIntakeGuard_(scope, guarded.scopeSha256, false);
      if(request.mode==='READBACK') {
        stage = 'READBACK';
        result.cursorDiagnostics=auroraDriveResumeDiagnostics_(scope,current.scopeSha256);
        var plan=auroraLerPlanoReadbackDriveAutorizado_({orgId:scope.orgId,scopeSha256:current.scopeSha256,
          readbackOffset:request.readbackOffset,readbackLimit:scope.limit});
        return auroraDriveReadbackResult_(plan,result,request.readbackOffset,scope.limit);
      }
      var deadline = Date.now() + 150000;
      stage = 'EXECUTE';
      var options = {
        orgId:scope.orgId,sources:scope.sources,sourceIds:scope.sources.map(function(s) { return s.sourceId; }),
        fileIds:scope.fileIds,excludedFolderIds:scope.excludedFolderIds,maxScan:scope.maxScan,
        limit:scope.limit,processLimit:scope.limit,scopeSha256:current.scopeSha256,
        configurationHash:current.scopeSha256,config:current.config,deadlineMs:deadline,
        beforeRequest:function() {
          if (Date.now() >= deadline) throw new Error('AURORA_DRIVE_DEADLINE_EXCEEDED');
          auroraDriveIntakeGuard_(scope, current.scopeSha256, false);
        }
      };
      var value;
      if(request.mode==='PROCESS_EXISTING') {
        // Reuse only already scoped pending rows. Do not enumerate, adopt legacy
        // rows, create sheets, or read/write the enumeration checkpoint.
        var sheet=getPlanilhaWMGJ_Compat_().getSheetByName(getConfigWMGJ_Compat_().SHEETS.FILA);
        if(!sheet) throw new Error('AURORA_DRIVE_QUEUE_CONTRACT');
        var header=sheet.getDataRange().getValues()[0];
        if(!Array.isArray(header) || ['ID_ORIGEM','STATUS','OBSERVACAO'].some(function(name) {
          return !header.some(function(cell) {return String(cell || '').trim()===name;});
        })) throw new Error('AURORA_DRIVE_QUEUE_CONTRACT');
        var processing=auroraProcessarFilaDriveAutorizada_(sheet,options,scope.limit,deadline);
        value={ok:processing.blockingErrors===0,
          scan:{visited:0,enqueued:0,duplicates:0,enumerationComplete:false},
          process:processing,privateReadbackPlan:processing.privateReadbackPlan};
      } else {
        value=auroraExecutarCicloDriveAutorizado_(options);
      }
      stage = 'RESULT';
      return auroraDriveIntakeResult_(value, result);
    });
  } catch (error) {
    var allowed = ['AURORA_CONNECTOR_REUSE_OWNER_REQUIRED','AURORA_DRIVE_REQUEST_REJECTED',
      'AURORA_DRIVE_SOURCE_SCOPE_REJECTED','AURORA_DRIVE_TENANT_MISMATCH','AURORA_DRIVE_DEPENDENCY_MISSING',
      'AURORA_DRIVE_CONFIGURATION_INVALID','AURORA_DRIVE_SCOPE_CHANGED','AURORA_DRIVE_SOURCE_UNAVAILABLE',
      'AURORA_DRIVE_RESULT_INVALID','AURORA_DRIVE_RECEIPT_COVERAGE_INVALID','AURORA_DRIVE_DEADLINE_EXCEEDED',
      'AURORA_DRIVE_READBACK_CURSOR_INVALID','AURORA_DRIVE_CURSOR_CONFLICT','AURORA_DRIVE_CURSOR_LIMIT',
      'AURORA_DRIVE_DEPTH_OR_CYCLE','AURORA_DRIVE_INFLIGHT_RECONCILIATION_REQUIRED','AURORA_DRIVE_LIMIT_INVALID',
      'AURORA_DRIVE_QUEUE_CONTRACT','AURORA_DRIVE_QUEUE_SCOPE_INVALID','AURORA_DRIVE_QUEUE_TENANT_CONFLICT',
      'AURORA_DRIVE_SCOPE_LIMIT','AURORA_DRIVE_SCOPE_REQUIRED','AURORA_DRIVE_SOURCE_INVALID',
      'AURORA_DRIVE_PROCESS_CURSOR_INVALID'];
    var message = String(error && error.message || '');
    result.code = allowed.indexOf(message) >= 0 ? message
      : stage==='SHARED_LOCK' && message==='GMAIL_REPLAY_LOCK_BUSY' ? 'AURORA_DRIVE_ENGINE_BUSY'
      : /quota|too many times|limit exceeded|limite.*exced/i.test(message) ? 'AURORA_DRIVE_SERVICE_QUOTA'
      : 'AURORA_DRIVE_EXECUTION_UNCONFIRMED';
    result.failureStage = stage;
    result.ok = false;
    return result;
  }
}


/* AURORA-HML-CONTINUOUS-DRIVE-20261026
 * Bounded owner authorization for one exact existing WMGJ Drive scope.
 * The trigger never enrolls another provider, exports credentials, mutates source
 * files, or calls the broad Gmail/dashboard automation. */
var AURORA_CONTINUOUS_DRIVE_DECISION = 'AURORA-HML-CONTINUOUS-DRIVE-20261026';
var AURORA_CONTINUOUS_DRIVE_CONFIRMATION = 'ACTIVATE_AUTHORIZED_WMGJ_DRIVE_CONTINUOUS_FEED';
var AURORA_CONTINUOUS_DRIVE_REMEDIATE_CONFIRMATION = 'REMEDIATE_AUTHORIZED_WMGJ_DRIVE_PENDING';
var AURORA_CONTINUOUS_DRIVE_NOT_BEFORE = '2026-10-26T04:18:00.000Z';
var AURORA_CONTINUOUS_DRIVE_DEADLINE = '2026-10-27T04:30:00.000Z';
var AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256 = 'd3978b0f743ab22021c586b5d85c731beca34a6c03306609f33e64d512ab19fa';
var AURORA_CONTINUOUS_DRIVE_HANDLER = 'auroraExecutarAlimentacaoContinuaDriveAutorizadaWmgj';

function auroraContinuousDriveWindow_() {
  var start=Date.parse(AURORA_CONTINUOUS_DRIVE_NOT_BEFORE),deadline=Date.parse(AURORA_CONTINUOUS_DRIVE_DEADLINE);
  if(!Number.isFinite(start)||!Number.isFinite(deadline)||Date.now()<start||Date.now()>=deadline)
    throw new Error('AURORA_CONTINUOUS_DRIVE_WINDOW_EXPIRED');
  return deadline;
}

function auroraContinuousDrivePrivateScope_(scopeJson, expectedHash) {
  if(typeof scopeJson!=='string'||scopeJson.length<2||scopeJson.length>131072
    ||expectedHash!==AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256
    ||auroraConnectorReuseSha_(scopeJson)!==expectedHash) throw new Error('AURORA_CONTINUOUS_DRIVE_SCOPE_REJECTED');
  var value;
  try { value=JSON.parse(scopeJson); } catch(ignore) { throw new Error('AURORA_CONTINUOUS_DRIVE_SCOPE_REJECTED'); }
  var id=function(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{10,256}$/.test(v);};
  if(!value||value.schemaVersion!=='aurora.authorized-drive-source-scope.v1'||value.orgId!=='wmgj'
    ||value.projectId!=='wmgj-hml-jfn-20260927'||!value.authorization
    ||value.authorization.realDataAuthorized!==true||value.authorization.sourceMutationAllowed!==false
    ||!Array.isArray(value.sources)||value.sources.length!==1
    ||!Array.isArray(value.fileIds)||value.fileIds.length>200||!value.fileIds.every(id)
    ||!Array.isArray(value.excludedFolderIds)||value.excludedFolderIds.length>100||!value.excludedFolderIds.every(id))
    throw new Error('AURORA_CONTINUOUS_DRIVE_SCOPE_REJECTED');
  var source=value.sources[0];
  if(!source||source.sourceId!=='drive-primary'||source.system!=='DRIVE'||source.active!==true
    ||source.folderId!==AURORA_CONNECTOR_REUSE_FOLDER||!Number.isSafeInteger(source.slaMinutes)
    ||source.slaMinutes<15||source.slaMinutes>43200
    ||value.fileIds.some(function(x){return x===source.folderId;})
    ||value.excludedFolderIds.some(function(x){return x===source.folderId;}))
    throw new Error('AURORA_CONTINUOUS_DRIVE_SCOPE_REJECTED');
  if(value.fileIds.length!==value.fileIds.filter(function(v,i,a){return a.indexOf(v)===i;}).length
    ||value.excludedFolderIds.length!==value.excludedFolderIds.filter(function(v,i,a){return a.indexOf(v)===i;}).length)
    throw new Error('AURORA_CONTINUOUS_DRIVE_SCOPE_REJECTED');
  return value;
}

function auroraContinuousDriveNormalizedScope_(privateScope, mode) {
  return auroraDriveIntakeScope_({mode:mode||'PREVIEW',orgId:privateScope.orgId,sources:privateScope.sources,
    fileIds:privateScope.fileIds,excludedFolderIds:privateScope.excludedFolderIds,maxScan:300,limit:20,
    expectedScopeSha256:null});
}

function auroraContinuousDriveSystemGuard_(scope, expectedHash, verifyAccess) {
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('WMGJ_FIRESTORE_ORG_ID')!==scope.orgId) throw new Error('AURORA_DRIVE_TENANT_MISMATCH');
  if(typeof wmgjFirestoreConfig_!=='function') throw new Error('AURORA_DRIVE_DEPENDENCY_MISSING');
  var existing=wmgjFirestoreConfig_();
  if(!existing||existing.orgId!==scope.orgId||typeof existing.url!=='string'
    ||!/^https:\/\/[^\s]+\/ingestWmgjEvent$/.test(existing.url)
    ||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(existing.keyId||'')
    ||!/^[a-fA-F0-9]{64}$/.test(existing.secret||'')) throw new Error('AURORA_DRIVE_CONFIGURATION_INVALID');
  var config={url:existing.url,keyId:existing.keyId,secret:existing.secret,orgId:existing.orgId,dryRun:false,maxRows:existing.maxRows};
  var fingerprint=auroraConnectorReuseSha_(JSON.stringify({scope:scope,endpoint:config.url,keyId:config.keyId,
    secretSha256:auroraConnectorReuseSha_(config.secret)}));
  if(expectedHash!==null&&expectedHash!==fingerprint) throw new Error('AURORA_DRIVE_SCOPE_CHANGED');
  if(verifyAccess) {
    scope.sources.forEach(function(source){
      if(DriveApp.getFolderById(source.folderId).getId()!==source.folderId) throw new Error('AURORA_DRIVE_SOURCE_UNAVAILABLE');
    });
    scope.fileIds.forEach(function(fileId){
      var file=DriveApp.getFileById(fileId);
      if(file.getId()!==fileId||(typeof file.isTrashed==='function'&&file.isTrashed())) throw new Error('AURORA_DRIVE_SOURCE_UNAVAILABLE');
    });
  }
  return {scopeSha256:fingerprint,config:config};
}

function auroraContinuousDriveCollectorState_() {
  var triggers=ScriptApp.getProjectTriggers(),target=0,duplicates=0,unrelated=0;
  triggers.forEach(function(trigger){
    var handler=String(trigger.getHandlerFunction()||'');
    if(handler===AURORA_CONTINUOUS_DRIVE_HANDLER) target++;
    else if(handler==='jobPrepararPipelineWMGJ'||handler==='jobProcessarFilaWMGJ') duplicates++;
    else unrelated++;
  });
  return {target:target,duplicateCollectors:duplicates,unrelated:unrelated,total:triggers.length};
}

function auroraContinuousDriveScopeFromProperties_() {
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('AURORA_CONTINUOUS_DRIVE_DECISION')!==AURORA_CONTINUOUS_DRIVE_DECISION
    ||props.getProperty('AURORA_CONTINUOUS_DRIVE_VALID_UNTIL')!==AURORA_CONTINUOUS_DRIVE_DEADLINE
    ||props.getProperty('AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256')!==AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256)
    throw new Error('AURORA_CONTINUOUS_DRIVE_CONFIGURATION_INVALID');
  var scopeJson=props.getProperty('AURORA_CONTINUOUS_DRIVE_SCOPE_JSON');
  var privateScope=auroraContinuousDrivePrivateScope_(scopeJson,AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256);
  var scope=auroraContinuousDriveNormalizedScope_(privateScope,'PREVIEW');
  var runtimeHash=props.getProperty('AURORA_CONTINUOUS_DRIVE_RUNTIME_SCOPE_SHA256');
  if(typeof runtimeHash!=='string'||!/^[a-f0-9]{64}$/.test(runtimeHash)) throw new Error('AURORA_CONTINUOUS_DRIVE_CONFIGURATION_INVALID');
  return {privateScope:privateScope,scope:scope,runtimeHash:runtimeHash};
}

function auroraAtivarAlimentacaoContinuaDriveAutorizada(request) {
  var result={ok:false,code:'AURORA_CONTINUOUS_DRIVE_PENDING',decisionId:AURORA_CONTINUOUS_DRIVE_DECISION,
    continuousExtraction:false,sourceCount:0,triggerCount:0,duplicateCollectorsRemoved:0,
    privateScopeSha256:AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256,runtimeScopeSha256:null,
    firstCycle:null,sourceMutation:false,productionMutation:false};
  try {
    auroraConnectorReuseOwner_();auroraContinuousDriveWindow_();
    if(!request||typeof request!=='object'||Array.isArray(request)
      ||Object.keys(request).sort().join(',')!==['confirmation','scopeJson','expectedScopeSha256'].sort().join(',')
      ||request.confirmation!==AURORA_CONTINUOUS_DRIVE_CONFIRMATION
      ||request.expectedScopeSha256!==AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256)
      throw new Error('AURORA_CONTINUOUS_DRIVE_REQUEST_REJECTED');
    var privateScope=auroraContinuousDrivePrivateScope_(request.scopeJson,request.expectedScopeSha256);
    var scope=auroraContinuousDriveNormalizedScope_(privateScope,'PREVIEW');
    var guarded=auroraContinuousDriveSystemGuard_(scope,null,true),props=PropertiesService.getScriptProperties();
    var resolved=auroraResolverFontesDocumentais_(props),candidate=resolved.candidates[0];
    if(resolved.candidates.length!==1||!candidate||candidate.folderId!==AURORA_CONNECTOR_REUSE_FOLDER
      ||candidate.sourceId!=='drive-primary'||candidate.system!=='DRIVE') throw new Error('AURORA_CONTINUOUS_DRIVE_SOURCE_CONFLICT');
    if(props.getProperty('WMGJ_PASTA_ENTRADA_ID')&&props.getProperty('WMGJ_PASTA_ENTRADA_ID')!==AURORA_CONNECTOR_REUSE_FOLDER)
      throw new Error('AURORA_CONTINUOUS_DRIVE_SOURCE_CONFLICT');
    var registry=JSON.stringify([{sourceId:'drive-primary',system:'DRIVE',mode:'DRIVE_FOLDER',
      folderId:AURORA_CONNECTOR_REUSE_FOLDER,slaMinutes:privateScope.sources[0].slaMinutes,active:true}]);
    props.setProperties({
      WMGJ_PASTA_ENTRADA_ID:AURORA_CONNECTOR_REUSE_FOLDER,
      WMGJ_FIRESTORE_DRY_RUN:'false',AURORA_FIRESTORE_MIRROR_REQUIRED:'true',
      AURORA_DOCUMENT_SOURCE_REGISTRY:registry,AURORA_CONNECTOR_SETUP_VERSION:AURORA_CONNECTOR_SETUP_VERSION,
      AURORA_CONTINUOUS_DRIVE_DECISION:AURORA_CONTINUOUS_DRIVE_DECISION,
      AURORA_CONTINUOUS_DRIVE_VALID_UNTIL:AURORA_CONTINUOUS_DRIVE_DEADLINE,
      AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256:AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256,
      AURORA_CONTINUOUS_DRIVE_RUNTIME_SCOPE_SHA256:guarded.scopeSha256,
      AURORA_CONTINUOUS_DRIVE_SCOPE_JSON:request.scopeJson
    },false);
    var removed=0;
    ScriptApp.getProjectTriggers().forEach(function(trigger){
      var handler=String(trigger.getHandlerFunction()||'');
      if(handler===AURORA_CONTINUOUS_DRIVE_HANDLER
        ||handler==='jobPrepararPipelineWMGJ'||handler==='jobProcessarFilaWMGJ') {
        ScriptApp.deleteTrigger(trigger);removed++;
      }
    });
    ScriptApp.newTrigger(AURORA_CONTINUOUS_DRIVE_HANDLER).timeBased().everyMinutes(15).create();
    var state=auroraContinuousDriveCollectorState_();
    if(state.target!==1||state.duplicateCollectors!==0) throw new Error('AURORA_CONTINUOUS_DRIVE_TRIGGER_CONFLICT');
    result.ok=true;result.code='AURORA_CONTINUOUS_DRIVE_ACTIVATED';result.continuousExtraction=true;
    result.sourceCount=1;result.triggerCount=1;result.duplicateCollectorsRemoved=removed;
    result.runtimeScopeSha256=guarded.scopeSha256;
    result.firstCycle=auroraExecutarAlimentacaoContinuaDriveAutorizadaWmgj();
    return result;
  } catch(error) {
    var code=String(error&&error.message||'');
    var allowed=['AURORA_CONNECTOR_REUSE_OWNER_REQUIRED','AURORA_CONTINUOUS_DRIVE_WINDOW_EXPIRED',
      'AURORA_CONTINUOUS_DRIVE_REQUEST_REJECTED','AURORA_CONTINUOUS_DRIVE_SCOPE_REJECTED',
      'AURORA_CONTINUOUS_DRIVE_SOURCE_CONFLICT','AURORA_CONTINUOUS_DRIVE_TRIGGER_CONFLICT',
      'AURORA_DRIVE_TENANT_MISMATCH','AURORA_DRIVE_DEPENDENCY_MISSING','AURORA_DRIVE_CONFIGURATION_INVALID',
      'AURORA_DRIVE_SOURCE_UNAVAILABLE'];
    result.code=allowed.indexOf(code)>=0?code:'AURORA_CONTINUOUS_DRIVE_ACTIVATION_FAILED';return result;
  }
}

function auroraExecutarAlimentacaoContinuaDriveAutorizadaWmgj() {
  var summary={ok:false,code:'AURORA_CONTINUOUS_DRIVE_CYCLE_PENDING',decisionId:AURORA_CONTINUOUS_DRIVE_DECISION,
    scanExamined:0,queued:0,aliases:0,attempted:0,accepted:0,duplicates:0,pending:0,failed:0,review:0,
    extractionErrors:0,sourceMutation:false,productionMutation:false,checkedAt:new Date().toISOString()};
  try {
    var authorizationDeadline=auroraContinuousDriveWindow_(),stored=auroraContinuousDriveScopeFromProperties_();
    var scope=stored.scope,guarded=auroraContinuousDriveSystemGuard_(scope,stored.runtimeHash,true);
    var props=PropertiesService.getScriptProperties(),resolved=auroraResolverFontesDocumentais_(props),state=auroraContinuousDriveCollectorState_();
    if(resolved.sources.length!==1||resolved.sources[0].sourceId!=='drive-primary'
      ||resolved.sources[0].folderId!==AURORA_CONNECTOR_REUSE_FOLDER||resolved.sources[0].active===false
      ||props.getProperty('WMGJ_FIRESTORE_DRY_RUN')!=='false'||props.getProperty('AURORA_FIRESTORE_MIRROR_REQUIRED')!=='true'
      ||state.target!==1||state.duplicateCollectors!==0) throw new Error('AURORA_CONTINUOUS_DRIVE_CONFIGURATION_INVALID');
    if(typeof comTravaIngestaoGmailWMGJ_!=='function'||typeof auroraExecutarCicloDriveAutorizado_!=='function')
      throw new Error('AURORA_DRIVE_DEPENDENCY_MISSING');
    var deadline=Math.min(Date.now()+150000,authorizationDeadline-5000);
    if(deadline<=Date.now()+15000) throw new Error('AURORA_CONTINUOUS_DRIVE_WINDOW_EXPIRED');
    var value=comTravaIngestaoGmailWMGJ_(function(){
      var current=auroraContinuousDriveSystemGuard_(scope,guarded.scopeSha256,false);
      return auroraExecutarCicloDriveAutorizado_({orgId:scope.orgId,sources:scope.sources,
        sourceIds:scope.sources.map(function(s){return s.sourceId;}),fileIds:scope.fileIds,
        excludedFolderIds:scope.excludedFolderIds,maxScan:scope.maxScan,limit:scope.limit,processLimit:scope.limit,
        scopeSha256:current.scopeSha256,configurationHash:current.scopeSha256,config:current.config,deadlineMs:deadline,
        beforeRequest:function(){
          if(Date.now()>=deadline) throw new Error('AURORA_DRIVE_DEADLINE_EXCEEDED');
          auroraContinuousDriveSystemGuard_(scope,current.scopeSha256,false);
        }});
    });
    var p=value&&value.process||{},scan=value&&value.scan||{};
    summary.ok=!!value&&value.ok===true;summary.code=summary.ok?'AURORA_CONTINUOUS_DRIVE_CYCLE_VERIFIED':'AURORA_CONTINUOUS_DRIVE_CYCLE_PENDING';
    summary.scanExamined=Number(scan.visited||0);summary.queued=Number(scan.enqueued||0);summary.aliases=Number(p.aliases||0);
    summary.attempted=Number(p.attempted||0);summary.accepted=Number(p.accepted||0);summary.duplicates=Number(p.duplicates||0);
    summary.pending=Number(p.pending||0);summary.failed=Number(p.blockingErrors||0);summary.review=Number(p.review||0);summary.extractionErrors=Number(p.errors||0);
  } catch(error) {
    var code=String(error&&error.message||'');
    var allowed=['AURORA_CONTINUOUS_DRIVE_WINDOW_EXPIRED','AURORA_CONTINUOUS_DRIVE_CONFIGURATION_INVALID',
      'AURORA_DRIVE_TENANT_MISMATCH','AURORA_DRIVE_DEPENDENCY_MISSING','AURORA_DRIVE_CONFIGURATION_INVALID',
      'AURORA_DRIVE_SCOPE_CHANGED','AURORA_DRIVE_SOURCE_UNAVAILABLE','AURORA_DRIVE_DEADLINE_EXCEEDED'];
    summary.code=allowed.indexOf(code)>=0?code:'AURORA_CONTINUOUS_DRIVE_CYCLE_FAILED';
  }
  try {PropertiesService.getScriptProperties().setProperty('AURORA_CONTINUOUS_DRIVE_LAST_CYCLE',JSON.stringify(summary));} catch(ignore){}
  if(typeof registrarLogAutomacaoWMGJ_==='function') try {registrarLogAutomacaoWMGJ_(summary.ok?'OK':'ALERTA',AURORA_CONTINUOUS_DRIVE_HANDLER,summary);} catch(ignoreLog){}
  return summary;
}

function auroraDriveRemediationDecision_(queueStatus,lastCode,attempts) {
  var count=Number(attempts);
  if(queueStatus==='ERRO_REPROCESSAR'&&lastCode==='AURORA_DRIVE_CONVERSION_FAILED'
    &&Number.isSafeInteger(count)&&count>=10)
    return {code:'AURORA_DRIVE_RETRY_BUDGET_EXHAUSTED',reason:'REPEATED_CONVERSION_FAILURE'};
  if(queueStatus==='REVISAR_HUMANO'&&(!lastCode||lastCode==='NOT_RECORDED'))
    return {code:'AURORA_DRIVE_LEGACY_REVIEW_REASON_UNRECORDED',reason:'LEGACY_REVIEW_WITHOUT_RECORDED_CODE'};
  return null;
}

function auroraSanearPendenciasDriveAutorizadas(request) {
  var result={ok:false,code:'AURORA_DRIVE_REMEDIATION_PENDING',decisionId:AURORA_CONTINUOUS_DRIVE_DECISION,
    changed:0,conversionRetryExhausted:0,legacyReasonRecorded:0,pending:0,justifiedHumanReview:0,
    unjustifiedPending:0,sourceMutation:false,productionMutation:false};
  try {
    auroraConnectorReuseOwner_();auroraContinuousDriveWindow_();
    if(!request||typeof request!=='object'||Array.isArray(request)
      ||Object.keys(request).sort().join(',')!==['confirmation','expectedScopeSha256'].sort().join(',')
      ||request.confirmation!==AURORA_CONTINUOUS_DRIVE_REMEDIATE_CONFIRMATION
      ||request.expectedScopeSha256!==AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256)
      throw new Error('AURORA_DRIVE_REMEDIATION_REQUEST_REJECTED');
    var stored=auroraContinuousDriveScopeFromProperties_(),scope=stored.scope;
    auroraContinuousDriveSystemGuard_(scope,stored.runtimeHash,true);
    if(typeof comTravaIngestaoGmailWMGJ_!=='function'||typeof getPlanilhaWMGJ_Compat_!=='function'||typeof getConfigWMGJ_Compat_!=='function')
      throw new Error('AURORA_DRIVE_DEPENDENCY_MISSING');
    return comTravaIngestaoGmailWMGJ_(function(){
      var ss=getPlanilhaWMGJ_Compat_(),fila=ss.getSheetByName(getConfigWMGJ_Compat_().SHEETS.FILA);
      if(!fila) throw new Error('AURORA_DRIVE_QUEUE_CONTRACT');
      var rows=fila.getDataRange().getValues(),idx=mapearCabecalhoWMGJ_Compat_(rows[0]);
      for(var i=1;i<rows.length;i++) {
        var row=rows[i],itemScope=auroraDriveScopeRead_(row[idx.OBSERVACAO]);
        if(!itemScope||itemScope.orgId!==scope.orgId||itemScope.scopeSha256!==stored.runtimeHash) continue;
        var proven=itemScope.receipt&&itemScope.receipt.replayVerified===true
          &&itemScope.contentSha256===itemScope.receipt.contentHash&&itemScope.receipt.contentHash===itemScope.receipt.contentSha256;
        if(proven||itemScope.coverage==='DUPLICATE_CONTENT') continue;
        var decision=auroraDriveRemediationDecision_(String(row[idx.STATUS]),itemScope.lastCode,Number(row[idx.TENTATIVAS]||0));
        if(decision) {
          itemScope.previousLastCode=itemScope.lastCode||'NOT_RECORDED';itemScope.lastCode=decision.code;
          itemScope.humanReviewJustified=true;itemScope.humanReviewReason=decision.reason;
          itemScope.humanReviewJustifiedAt=new Date().toISOString();
          atualizarLinhaFilaWMGJ_Compat_(fila,i+1,idx,{STATUS:'REVISAR_HUMANO',TENTATIVAS:Number(row[idx.TENTATIVAS]||0),
            ULTIMO_ERRO:decision.code,OBSERVACAO:auroraDriveScopeWrite_(itemScope)});
          result.changed++;
          if(decision.code==='AURORA_DRIVE_RETRY_BUDGET_EXHAUSTED') result.conversionRetryExhausted++;
          else result.legacyReasonRecorded++;
        }
      }
      var after=fila.getDataRange().getValues();
      for(var r=1;r<after.length;r++) {
        var finalScope=auroraDriveScopeRead_(after[r][idx.OBSERVACAO]);
        if(!finalScope||finalScope.orgId!==scope.orgId||finalScope.scopeSha256!==stored.runtimeHash) continue;
        var receipt=finalScope.receipt,provenFinal=receipt&&receipt.replayVerified===true
          &&finalScope.contentSha256===receipt.contentHash&&receipt.contentHash===receipt.contentSha256;
        if(provenFinal||finalScope.coverage==='DUPLICATE_CONTENT') continue;
        result.pending++;
        if(String(after[r][idx.STATUS])==='REVISAR_HUMANO'
          &&['AURORA_DRIVE_RETRY_BUDGET_EXHAUSTED','AURORA_DRIVE_LEGACY_REVIEW_REASON_UNRECORDED'].indexOf(finalScope.lastCode)>=0)
          result.justifiedHumanReview++;
        else result.unjustifiedPending++;
      }
      result.ok=result.unjustifiedPending===0;
      result.code=result.ok?'AURORA_DRIVE_REMEDIATION_JUSTIFIED':'AURORA_DRIVE_REMEDIATION_INCOMPLETE';
      return result;
    });
  } catch(error) {
    var code=String(error&&error.message||'');
    var allowed=['AURORA_CONNECTOR_REUSE_OWNER_REQUIRED','AURORA_CONTINUOUS_DRIVE_WINDOW_EXPIRED',
      'AURORA_DRIVE_REMEDIATION_REQUEST_REJECTED','AURORA_CONTINUOUS_DRIVE_CONFIGURATION_INVALID',
      'AURORA_DRIVE_TENANT_MISMATCH','AURORA_DRIVE_DEPENDENCY_MISSING','AURORA_DRIVE_CONFIGURATION_INVALID',
      'AURORA_DRIVE_SCOPE_CHANGED','AURORA_DRIVE_SOURCE_UNAVAILABLE','AURORA_DRIVE_QUEUE_CONTRACT'];
    result.code=allowed.indexOf(code)>=0?code:'AURORA_DRIVE_REMEDIATION_FAILED';return result;
  }
}

function auroraLerStatusAlimentacaoContinuaDriveAutorizada(expectedScopeSha256) {
  var result={ok:false,code:'AURORA_CONTINUOUS_DRIVE_STATUS_PENDING',decisionId:AURORA_CONTINUOUS_DRIVE_DECISION,
    authorizationValid:false,sourceActive:false,sourceCount:0,triggerCount:0,duplicateCollectors:0,
    privateScopeSha256:AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256,runtimeScopeSha256:null,lastCycle:null,
    sourceMutation:false,productionMutation:false};
  try {
    auroraConnectorReuseOwner_();
    if(expectedScopeSha256!==AURORA_CONTINUOUS_DRIVE_PRIVATE_SCOPE_SHA256) throw new Error('AURORA_CONTINUOUS_DRIVE_SCOPE_REJECTED');
    var deadline=auroraContinuousDriveWindow_(),stored=auroraContinuousDriveScopeFromProperties_(),props=PropertiesService.getScriptProperties();
    var resolved=auroraResolverFontesDocumentais_(props),state=auroraContinuousDriveCollectorState_();
    result.authorizationValid=Date.now()<deadline;result.sourceCount=resolved.sources.length;
    result.sourceActive=resolved.sources.length===1&&resolved.sources[0].sourceId==='drive-primary'
      &&resolved.sources[0].folderId===AURORA_CONNECTOR_REUSE_FOLDER&&resolved.sources[0].active!==false;
    result.triggerCount=state.target;result.duplicateCollectors=state.duplicateCollectors;result.runtimeScopeSha256=stored.runtimeHash;
    var rawLast=props.getProperty('AURORA_CONTINUOUS_DRIVE_LAST_CYCLE');
    if(rawLast) try {
      var last=JSON.parse(rawLast);
      result.lastCycle={ok:last.ok===true,code:String(last.code||'').slice(0,80),checkedAt:String(last.checkedAt||'').slice(0,40),
        scanExamined:Number(last.scanExamined||0),queued:Number(last.queued||0),attempted:Number(last.attempted||0),
        accepted:Number(last.accepted||0),duplicates:Number(last.duplicates||0),pending:Number(last.pending||0),
        failed:Number(last.failed||0),review:Number(last.review||0),extractionErrors:Number(last.extractionErrors||0)};
    } catch(ignoreLast) {}
    result.ok=result.authorizationValid&&result.sourceActive&&result.triggerCount===1&&result.duplicateCollectors===0;
    result.code=result.ok?'AURORA_CONTINUOUS_DRIVE_STATUS_VERIFIED':'AURORA_CONTINUOUS_DRIVE_STATUS_INCOMPLETE';
  } catch(error) {
    var code=String(error&&error.message||'');
    var allowed=['AURORA_CONNECTOR_REUSE_OWNER_REQUIRED','AURORA_CONTINUOUS_DRIVE_WINDOW_EXPIRED',
      'AURORA_CONTINUOUS_DRIVE_SCOPE_REJECTED','AURORA_CONTINUOUS_DRIVE_CONFIGURATION_INVALID'];
    result.code=allowed.indexOf(code)>=0?code:'AURORA_CONTINUOUS_DRIVE_STATUS_FAILED';
  }
  return result;
}

