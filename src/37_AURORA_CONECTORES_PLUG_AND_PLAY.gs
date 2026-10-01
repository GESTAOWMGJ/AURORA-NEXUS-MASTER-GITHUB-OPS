/**
 * AURORA NEXUS — conectores plug-and-play Drive/Firebase
 * Fonte canônica de configuração do tenant-piloto WMGJ.
 *
 * Segredos entram somente por parâmetro de uma chamada autenticada/administrativa
 * e são persistidos em ScriptProperties. Nunca são retornados ou logados.
 */
var AURORA_CONNECTOR_SETUP_VERSION = 'v1.0.0-plug-and-play';

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

  var props = PropertiesService.getScriptProperties();
  var values = {
    WMGJ_PASTA_ENTRADA_ID: driveFolderId,
    WMGJ_FIRESTORE_INGEST_URL: ingestUrl,
    WMGJ_FIRESTORE_HMAC_KEY_ID: keyId,
    WMGJ_FIRESTORE_HMAC_SECRET: hmacSecret.toLowerCase(),
    WMGJ_FIRESTORE_ORG_ID: orgId,
    WMGJ_FIRESTORE_DRY_RUN: activate ? 'false' : 'true',
    AURORA_FIRESTORE_MIRROR_REQUIRED: activate ? 'true' : 'false',
    AURORA_CONNECTOR_SETUP_VERSION: AURORA_CONNECTOR_SETUP_VERSION
  };
  if (spreadsheetId) values.WMGJ_SPREADSHEET_ID = spreadsheetId;
  if (externalName) {
    values.AURORA_EXTERNAL_SYSTEM_NAME = externalName;
    values.AURORA_EXTERNAL_BASE_URL = externalBaseUrl;
    values.AURORA_EXTERNAL_API_KEY = externalApiKey;
  }
  props.setProperties(values, false);

  var trigger = null;
  if (activate) {
    if (typeof instalarGatilhoAutomacaoWMGJ !== 'function') throw new Error('AURORA_AUTOMATION_INSTALLER_MISSING');
    trigger = instalarGatilhoAutomacaoWMGJ();
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
    continuousExtraction: activate,
    triggerInstalled: !!trigger,
    checkedAt: new Date().toISOString()
  };
  auroraConnectorLogSafe_('CONFIGURE', result);
  return result;
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

  var result = {
    ok: folderOk && firestore.ok === true,
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
