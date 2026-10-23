/** Bounded, owner-only HML format probe. No registry, queue, trigger or model calls. */
var AURORA_HML_SYNTHETIC_PROJECT = 'wmgj-hml-jfn-20260927';
var AURORA_HML_SYNTHETIC_ENDPOINT = 'https://southamerica-east1-wmgj-hml-jfn-20260927.cloudfunctions.net/ingestWmgjEvent';
var AURORA_HML_SYNTHETIC_MASTER_HASH = 'bb3a1e4a24554f0cd324e0fb8a14559df4fe22a1f3b40e8d7d1f454f9d2ffc09';
// Explicit owner renewal AURORA-HML-OWNER-RENEWAL-20261022; never caller-controlled.
var AURORA_HML_SYNTHETIC_DEADLINE = '2026-10-23T23:00:00.000Z';

function auroraExecutarProbeNuvemSinteticaHml(request) {
  var result = {
    schemaVersion: 'aurora.hml.synthetic-cloud-probe.v1', status: 'FAIL', code: 'PROBE_GUARD_REJECTED',
    scope: 'ISOLATED_SYNTHETIC_FORMATS_ONLY', callerAuthorized: false,
    runtimeFunctionHashes: {}, formats: [], canonicalReadbackPlan: [], createdFileCount: 0,
    cleanupVerified: false, cleanupRemainingCount: 0, unresolvedCreationCount: 0, folderSha256: null,
    registryChanged: false, triggersChanged: false, globalQueuesTouched: false,
    canonicalReadbackPerformed: false, runtimeProcessingVerified: false,
    customerOAuthEnrollmentVerified: false, globalIngestionVerified: false,
    installationComplete: false, complete: false,
    ocrTemporaryCleanup: 'EXISTING_EXTRACTOR_CREATED_ID_ONLY'
  };
  var scope = null;
  try {
    auroraHmlSyntheticAuthorize_();
    result.callerAuthorized = true;
    auroraHmlSyntheticValidateRequest_(request);
    var hashes = auroraHmlSyntheticRuntimeHashes_();
    // Execution API objects may arrive in a different property order; every exact hash still must match.
    if (!Object.keys(hashes).every(function(name) { return hashes[name] === request.runtimeFunctionHashes[name]; })) throw new Error('PROBE_RUNTIME_SOURCE_MISMATCH');
    result.runtimeFunctionHashes = hashes;
    auroraHmlSyntheticAssertLive_(request.expiresAt);
    var cfg = wmgjFirestoreConfig_();
    if (cfg.orgId !== 'wmgj' || cfg.url !== AURORA_HML_SYNTHETIC_ENDPOINT
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(cfg.keyId)
      || !/^[a-fA-F0-9]{64}$/.test(cfg.secret)) throw new Error('PROBE_HML_CONFIG_REJECTED');
    var localConfig = {url: cfg.url, orgId: cfg.orgId, keyId: cfg.keyId, secret: cfg.secret, dryRun: false, maxRows: 4};
    scope = auroraHmlSyntheticCreateScope_(request.runNonce, request.expiresAt);
    auroraHmlSyntheticCreateFolder_(scope);
    result.folderSha256 = auroraHmlSyntheticSha_(scope.folder.getId());
    auroraHmlSyntheticAssertLive_(scope.expiresAt);
    scope.folder.setDescription(scope.marker);
    var files = auroraHmlSyntheticCreateFiles_(scope);
    result.createdFileCount = scope.files.length;
    files.forEach(function(item) {
      var row = {format: item.format, status: 'FAIL', code: 'PROBE_FORMAT_PENDING',
        method: null, extractionVerified: false, extractedContentSha256: null,
        eventSha256: null, canonicalCommitAcknowledged: false, replayVerified: false, receiptSha256: null};
      result.formats.push(row);
      try {
        auroraHmlSyntheticCheckFile_(scope, item.file);
        auroraHmlSyntheticAssertLive_(scope.expiresAt);
        var extracted = extrairConteudoArquivoWMGJ_V1_(item.file);
        auroraHmlSyntheticAssertLive_(scope.expiresAt);
        if (!extracaoDocumentalCompletaWMGJ_(extracted)
          || extracted.metodo !== item.method
          || extracted.texto.toLowerCase().indexOf(scope.nonce) < 0) throw new Error('PROBE_EXTRACTION_PENDING');
        row.method = extracted.metodo;
        row.extractionVerified = true;
        row.extractedContentSha256 = auroraHmlSyntheticSha_(extracted.texto);
        var classification = {categoria: 'outro', tipo_documento: 'OTHER', competencia: '2026-05', confianca: 1,
          status: 'PROCESSADO', metodo_extracao: extracted.metodo, origem_classificacao: 'aurora_native_rules', nivel_risco: 'LOW'};
        auroraHmlSyntheticAssertLive_(scope.expiresAt);
        var event = wmgjFirestoreEventoArquivo_(item.file, classification, {
          sourceSystem: 'DRIVE', sourceContext: ['ISOLATED_SYNTHETIC_HML_V1', scope.nonce, item.format, row.extractedContentSha256].join(':'),
          originConnector: 'DRIVE_FOLDER', sourceRegistryVersion: 'synthetic-probe-v1', mirrorRequired: true,
          pipelineVersion: WMGJ_EXTRACAO_VERSAO
        });
        auroraHmlSyntheticAssertLive_(scope.expiresAt);
        if (event.orgId !== 'wmgj' || event.entityType !== 'sourceDocument' || event.sensitivity !== 'RESTRICTED'
          || event.source.sourceId !== item.file.getId() || event.record.extractionComplete !== true
          || event.record.externalAiUsed !== false) throw new Error('PROBE_EVENT_REJECTED');
        row.eventSha256 = auroraHmlSyntheticSha_(JSON.stringify(event));
        var gate = function() { auroraHmlSyntheticAssertLive_(scope.expiresAt); };
        gate();
        var first = wmgjFirestoreEnviarEventoComConfig_(event, localConfig, auroraHmlSyntheticNoLog_, gate);
        gate();
        auroraHmlSyntheticCheckReceipt_(event, first);
        row.canonicalCommitAcknowledged = true;
        var replay = wmgjFirestoreEnviarEventoComConfig_(event, localConfig, auroraHmlSyntheticNoLog_, gate);
        gate();
        auroraHmlSyntheticCheckReceipt_(event, replay);
        if (replay.duplicate !== true || replay.accepted !== false || replay.entityId !== first.entityId
          || replay.eventId !== first.eventId || replay.versionId !== first.versionId || replay.revision !== first.revision) {
          throw new Error('PROBE_REPLAY_UNCONFIRMED');
        }
        row.replayVerified = true;
        row.receiptSha256 = auroraHmlSyntheticSha_(JSON.stringify({first: first, replay: replay}));
        // Private runner input only; the coordinator never exports these identifiers.
        result.canonicalReadbackPlan.push({format:item.format, entityId:first.entityId, versionId:first.versionId,
          idempotencyId:auroraHmlSyntheticSha_(event.idempotencyKey), eventId:event.eventId, revision:first.revision,
          sourceVersion:event.sourceVersion, sourceId:item.file.getId(), contentHash:event.source.contentHash,
          canonicalSnapshotHash:event.record.canonicalSnapshotHash, extractedContentHash:row.extractedContentSha256, method:extracted.metodo,
          markerSha256:auroraHmlSyntheticSha_(scope.marker)});
        gate(); row.status = 'PASS'; row.code = 'PROBE_FORMAT_VERIFIED';
      } catch (error) {
        row.code = auroraHmlSyntheticSafeCode_(error);
      }
    });
    auroraHmlSyntheticAssertLive_(scope.expiresAt);
    result.code = result.formats.length === 4 && result.formats.every(function(row) { return row.status === 'PASS'; })
      ? 'PROBE_FORMATS_VERIFIED' : 'PROBE_FORMATS_PENDING';
  } catch (error) {
    result.code = auroraHmlSyntheticSafeCode_(error);
  } finally {
    if (scope) {
      result.createdFileCount = scope.files.length;
      var cleanup = auroraHmlSyntheticCleanup_(scope);
      result.cleanupVerified = cleanup.ok;
      result.cleanupRemainingCount = cleanup.remaining;
      result.unresolvedCreationCount = cleanup.unresolved;
    }
  }
  if (result.code === 'PROBE_FORMATS_VERIFIED' && result.cleanupVerified) {
    try { auroraHmlSyntheticAssertLive_(request.expiresAt); result.status = 'PASS'; }
    catch (error) { result.code = auroraHmlSyntheticSafeCode_(error); }
  }
  if (result.code === 'PROBE_FORMATS_VERIFIED' && !result.cleanupVerified) result.code = 'PROBE_CLEANUP_PENDING';
  return result;
}

function auroraHmlSyntheticAuthorize_() {
  var active = '', effective = '';
  try {
    active = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (ignore) { throw new Error('PROBE_CALLER_NOT_AUTHORIZED'); }
  if (!active || !effective || active !== effective || auroraHmlSyntheticSha_(active) !== AURORA_HML_SYNTHETIC_MASTER_HASH) {
    throw new Error('PROBE_CALLER_NOT_AUTHORIZED');
  }
}

function auroraHmlSyntheticValidateRequest_(value) {
  var keys = ['confirmation', 'projectId', 'orgId', 'sourceSha', 'runNonce', 'expiresAt', 'runtimeFunctionHashes'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== keys.sort().join(',')
    || value.confirmation !== 'RUN_ISOLATED_SYNTHETIC_HML_PROBE'
    || value.projectId !== AURORA_HML_SYNTHETIC_PROJECT || value.orgId !== 'wmgj'
    || !/^[a-f0-9]{40}$/.test(value.sourceSha) || !/^[a-f0-9]{32}$/.test(value.runNonce)
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.now() || Date.parse(value.expiresAt) > Date.now() + 900000
    || Date.parse(value.expiresAt) > Date.parse(AURORA_HML_SYNTHETIC_DEADLINE)
    || Date.now() >= Date.parse(AURORA_HML_SYNTHETIC_DEADLINE)) throw new Error('PROBE_REQUEST_REJECTED');
  var expected = Object.keys(auroraHmlSyntheticRuntimeHashes_());
  if (!value.runtimeFunctionHashes || typeof value.runtimeFunctionHashes !== 'object' || Array.isArray(value.runtimeFunctionHashes)
    || Object.keys(value.runtimeFunctionHashes).sort().join(',') !== expected.sort().join(',')
    || !expected.every(function(name) { return typeof value.runtimeFunctionHashes[name] === 'string' && /^[a-f0-9]{64}$/.test(value.runtimeFunctionHashes[name]); })) {
    throw new Error('PROBE_RUNTIME_SOURCE_MISMATCH');
  }
}

function auroraHmlSyntheticRuntimeHashes_() {
  var functions = {
    probe: auroraExecutarProbeNuvemSinteticaHml, authorize: auroraHmlSyntheticAuthorize_,
    request: auroraHmlSyntheticValidateRequest_, gate: auroraHmlSyntheticAssertLive_, call: auroraHmlSyntheticCall_,
    hashes: auroraHmlSyntheticRuntimeHashes_, createScope: auroraHmlSyntheticCreateScope_, createFolder: auroraHmlSyntheticCreateFolder_,
    beginCreation: auroraHmlSyntheticBeginCreation_,
    createFiles: auroraHmlSyntheticCreateFiles_, track: auroraHmlSyntheticTrack_,
    checkFile: auroraHmlSyntheticCheckFile_, cleanup: auroraHmlSyntheticCleanup_,
    checkReceipt: auroraHmlSyntheticCheckReceipt_, extraction: extrairConteudoArquivoWMGJ_V1_,
    extractionComplete: extracaoDocumentalCompletaWMGJ_, ocr: converterArquivoParaGoogleDocWMGJ_V1_,
    sheets: extrairTextoGoogleSheetsWMGJ_V1_, event: wmgjFirestoreEventoArquivo_,
    sender: wmgjFirestoreEnviarEventoComConfig_, publicFailure: wmgjFirestorePublicFailure_, safeCode: auroraHmlSyntheticSafeCode_,
    canonicalHmac: wmgjFirestoreCanonicalHmacV2_,
    hmac: wmgjFirestoreHmacHex_, config: wmgjFirestoreConfig_, parents: auroraHmlSyntheticParents_
  };
  var result = {};
  Object.keys(functions).forEach(function(key) { result[key] = auroraHmlSyntheticSha_(functions[key].toString().replace(/\r\n/g, '\n')); });
  result.policy = auroraHmlSyntheticSha_(JSON.stringify({project: AURORA_HML_SYNTHETIC_PROJECT,
    endpoint: AURORA_HML_SYNTHETIC_ENDPOINT, masterHash: AURORA_HML_SYNTHETIC_MASTER_HASH,
    deadline: AURORA_HML_SYNTHETIC_DEADLINE}));
  return result;
}

function auroraHmlSyntheticAssertLive_(expiresAt) {
  if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))
    || Date.now() >= Date.parse(expiresAt) || Date.now() >= Date.parse(AURORA_HML_SYNTHETIC_DEADLINE)) throw new Error('PROBE_WINDOW_EXPIRED');
}

function auroraHmlSyntheticCall_(expiresAt, operation) {
  if (expiresAt !== undefined) auroraHmlSyntheticAssertLive_(expiresAt);
  return operation();
}

function auroraHmlSyntheticCreateScope_(nonce, expiresAt) {
  var marker = 'AURORA_HML_SYNTHETIC_V1_' + nonce;
  return {nonce: nonce, marker: marker, expiresAt: expiresAt, folder: null, folderParents: null,
    folderCreationUncertain: false, creations: [], files: []};
}

function auroraHmlSyntheticCreateFolder_(scope) {
  auroraHmlSyntheticAssertLive_(scope.expiresAt);
  scope.folderCreationUncertain = true;
  scope.folder = DriveApp.createFolder(scope.marker);
  scope.folderCreationUncertain = false;
  scope.folderParents = auroraHmlSyntheticParents_(scope.folder, scope.expiresAt);
}

function auroraHmlSyntheticBeginCreation_(scope, kind) {
  auroraHmlSyntheticAssertLive_(scope.expiresAt);
  var entry = {kind: kind, id: null, resolved: false};
  scope.creations.push(entry);
  return entry;
}

function auroraHmlSyntheticTrack_(scope, file, creation) {
  scope.files.push(file);
  creation.resolved = true;
  auroraHmlSyntheticAssertLive_(scope.expiresAt);
  file.setDescription(scope.marker);
  auroraHmlSyntheticAssertLive_(scope.expiresAt);
  file.moveTo(scope.folder);
  auroraHmlSyntheticCheckFile_(scope, file);
  return file;
}

function auroraHmlSyntheticCreateFiles_(scope) {
  var content = 'AURORA HML SYNTHETIC PROBE\nNONCE ' + scope.nonce + '\nSYNTHETIC ONLY. NO CUSTOMER DATA.';
  var docCreation = auroraHmlSyntheticBeginCreation_(scope, 'DOC');
  var document = DocumentApp.create(scope.marker + '_DOC');
  docCreation.id = document.getId();
  var docFile = auroraHmlSyntheticTrack_(scope, auroraHmlSyntheticCall_(scope.expiresAt, function() { return DriveApp.getFileById(docCreation.id); }), docCreation);
  var body = auroraHmlSyntheticCall_(scope.expiresAt, function() { return document.getBody(); });
  auroraHmlSyntheticAssertLive_(scope.expiresAt); body.setText(content);
  auroraHmlSyntheticAssertLive_(scope.expiresAt); document.saveAndClose();
  var sheetCreation = auroraHmlSyntheticBeginCreation_(scope, 'SHEETS');
  var spreadsheet = SpreadsheetApp.create(scope.marker + '_SHEETS');
  sheetCreation.id = spreadsheet.getId();
  var sheetFile = auroraHmlSyntheticTrack_(scope, auroraHmlSyntheticCall_(scope.expiresAt, function() { return DriveApp.getFileById(sheetCreation.id); }), sheetCreation);
  var sheets = auroraHmlSyntheticCall_(scope.expiresAt, function() { return spreadsheet.getSheets(); });
  var range = auroraHmlSyntheticCall_(scope.expiresAt, function() { return sheets[0].getRange(1, 1, 2, 2); });
  auroraHmlSyntheticAssertLive_(scope.expiresAt); range.setValues([['SYNTHETIC_HML_NONCE', scope.nonce], ['SYNTHETIC_ONLY', 'NO_CUSTOMER_DATA']]);
  auroraHmlSyntheticAssertLive_(scope.expiresAt); SpreadsheetApp.flush();
  var textCreation = auroraHmlSyntheticBeginCreation_(scope, 'TEXT');
  var textFile = auroraHmlSyntheticTrack_(scope, scope.folder.createFile(scope.marker + '_TEXT.txt', content, MimeType.PLAIN_TEXT), textCreation);
  var pdfBlob = auroraHmlSyntheticCall_(scope.expiresAt, function() { return docFile.getAs(MimeType.PDF); }).setName(scope.marker + '_PDF.pdf');
  var pdfCreation = auroraHmlSyntheticBeginCreation_(scope, 'PDF');
  var pdfFile = auroraHmlSyntheticTrack_(scope, scope.folder.createFile(pdfBlob), pdfCreation);
  return [
    {format: 'DOC', file: docFile, method: 'google_docs_text'},
    {format: 'SHEETS', file: sheetFile, method: 'google_sheets_values'},
    {format: 'TEXT', file: textFile, method: 'blob_text'},
    {format: 'PDF', file: pdfFile, method: 'drive_api_ocr_convert'}
  ];
}

function auroraHmlSyntheticCheckFile_(scope, file, cleanup) {
  var expiry = cleanup ? undefined : scope.expiresAt;
  var call = function(operation) { return auroraHmlSyntheticCall_(expiry, operation); };
  var parents = call(function() { return file.getParents(); });
  if (scope.files.indexOf(file) < 0 || call(function() { return file.getDescription(); }) !== scope.marker
    || call(function() { return file.getName(); }).indexOf(scope.marker + '_') !== 0 || !call(function() { return parents.hasNext(); })
    || call(function() { return parents.next().getId(); }) !== scope.folder.getId() || call(function() { return parents.hasNext(); })) throw new Error('PROBE_FILE_SCOPE_REJECTED');
}

function auroraHmlSyntheticCleanup_(scope) {
  // Cleanup is intentionally permitted after expiry. Unknown created identities
  // cannot be adopted by a search or counted as cleaned.
  var unresolved = scope.creations.filter(function(entry) { return !entry.resolved; }).length
    + (scope.folderCreationUncertain ? 1 : 0);
  var remaining = unresolved;
  scope.files.forEach(function(file) {
    try { auroraHmlSyntheticCheckFile_(scope, file, true); file.setTrashed(true); }
    catch (ignore) { remaining++; }
  });
  try {
    if (remaining || !scope.folder || scope.folder.getName() !== scope.marker || scope.folder.getDescription() !== scope.marker
      || JSON.stringify(auroraHmlSyntheticParents_(scope.folder)) !== JSON.stringify(scope.folderParents)
      || scope.folder.getFiles().hasNext() || scope.folder.getFolders().hasNext()) throw new Error('PROBE_CLEANUP_PENDING');
    scope.folder.setTrashed(true);
  } catch (ignoreFolder) { remaining++; }
  return {ok: remaining === 0, remaining: remaining, unresolved: unresolved};
}

function auroraHmlSyntheticParents_(item, expiresAt) {
  var call = function(operation) { return auroraHmlSyntheticCall_(expiresAt, operation); };
  var result = [], iterator = call(function() { return item.getParents(); });
  while (call(function() { return iterator.hasNext(); })) {
    if (result.length >= 2) throw new Error('PROBE_FILE_SCOPE_REJECTED');
    result.push(call(function() { return iterator.next().getId(); }));
  }
  return result.sort();
}

function auroraHmlSyntheticCheckReceipt_(event, receipt) {
  var entityId = auroraHmlSyntheticSha_('sourceDocument:' + event.entityKey).slice(0, 48);
  if (!receipt || receipt.ok !== true || typeof receipt.accepted !== 'boolean' || typeof receipt.duplicate !== 'boolean'
    || receipt.accepted === receipt.duplicate || receipt.entityId !== entityId || receipt.eventId !== event.eventId
    || typeof receipt.versionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.versionId)
    || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 || receipt.dryRun === true) throw new Error('PROBE_CANONICAL_WRITE_UNCONFIRMED');
}

function auroraHmlSyntheticSha_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8).map(function(value) {
    return ('0' + ((value + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function auroraHmlSyntheticNoLog_() {}

function auroraHmlSyntheticSafeCode_(error) {
  var allowed = ['PROBE_CALLER_NOT_AUTHORIZED', 'PROBE_REQUEST_REJECTED', 'PROBE_RUNTIME_SOURCE_MISMATCH',
    'PROBE_WINDOW_EXPIRED',
    'PROBE_HML_CONFIG_REJECTED', 'PROBE_FILE_SCOPE_REJECTED', 'PROBE_EXTRACTION_PENDING',
    'PROBE_EVENT_REJECTED', 'PROBE_CANONICAL_WRITE_UNCONFIRMED', 'PROBE_REPLAY_UNCONFIRMED'];
  if (error && allowed.indexOf(error.message) >= 0) return error.message;
  var match = error && typeof error.message === 'string'
    ? /^FIRESTORE_INGEST_FAILED:(HTTP_([1-5][0-9]{2}|OTHER)):([A-Z_0-9]+)$/.exec(error.message) : null;
  if (match) {
    var status = match[2] === 'OTHER' ? null : Number(match[2]);
    var response = match[3] === 'NO_STRUCTURED_RESPONSE' ? null : {code: match[3]};
    if (wmgjFirestorePublicFailure_(status, response) === match[1] + ':' + match[3]) return 'PROBE_' + match[1] + '_' + match[3];
  }
  return 'PROBE_DEPENDENCY_FAILED';
}
