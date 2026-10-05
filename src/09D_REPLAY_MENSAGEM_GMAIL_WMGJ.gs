/** M01/M08/M10. Manual, exact-message replay; no trigger, OCR or financial pipeline. */
var WMGJ_INGESTION_SCRIPT_LOCK_ = null;

function obterTravaIngestaoGmailWMGJ_() {
  if (!WMGJ_INGESTION_SCRIPT_LOCK_) WMGJ_INGESTION_SCRIPT_LOCK_ = LockService.getScriptLock();
  return WMGJ_INGESTION_SCRIPT_LOCK_;
}

function comTravaIngestaoGmailWMGJ_(fn) {
  var lock = obterTravaIngestaoGmailWMGJ_();
  var owned = !lock.hasLock(); // Borrow the watchdog's lock in the same execution.
  if (owned && !lock.tryLock(1000)) throw new Error('GMAIL_REPLAY_LOCK_BUSY');
  try { return fn(); }
  finally { if (owned) { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } } }
}

function hashReplayGmailWMGJ_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value).map(function(b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function chaveReservaMensagemGmailWMGJ_(messageId) {
  return 'AURORA_GMAIL_MESSAGE_' + hashReplayGmailWMGJ_(JSON.stringify([
    Session.getEffectiveUser().getEmail(), messageId
  ]));
}

function mensagemReservadaReplayGmailWMGJ_(messageId) {
  return !!PropertiesService.getScriptProperties().getProperty(chaveReservaMensagemGmailWMGJ_(messageId));
}

function exigirFilaReplayGmailWMGJ_(fila) {
  if (!fila) throw new Error('GMAIL_REPLAY_QUEUE_MISSING');
  var rows = fila.getDataRange().getValues(), h = rows[0] || [];
  var canonical = ['DATA_ENTRADA', 'ORIGEM', 'ID_ORIGEM', 'NOME', 'TIPO', 'STATUS',
    'TENTATIVAS', 'PROXIMA_ACAO', 'ULTIMO_ERRO', 'OBSERVACAO'];
  if (h.length !== 10 || canonical.some(function(v, i) {
    return h[i] !== v && !(i === 3 && h[i] === 'NOME_ARQUIVO') && !(i === 4 && h[i] === 'MIME_TYPE');
  })) throw new Error('GMAIL_REPLAY_QUEUE_SCHEMA_MISMATCH');
  return rows;
}

function contextoReplayGmailWMGJ_() {
  var props = PropertiesService.getScriptProperties();
  // Never discover/create folders or silently fall back to another tenant/sheet.
  var sheetId = props.getProperty('WMGJ_SPREADSHEET_ID');
  var folderId = props.getProperty('WMGJ_PASTA_ENTRADA_ID') || props.getProperty('PASTA_ENTRADA_ID');
  var orgId = props.getProperty('WMGJ_FIRESTORE_ORG_ID');
  var actor = Session.getEffectiveUser().getEmail();
  if (!sheetId || !folderId || !orgId || !actor) throw new Error('GMAIL_REPLAY_SCOPE_MISSING');
  var ss = SpreadsheetApp.openById(sheetId);
  var index = ss.getSheetByName('21_GMAIL_INDEXACAO_FATURAMENTO');
  if (!index) throw new Error('GMAIL_INDEX_AUSENTE');
  exigirContratoIndiceGmailWMGJ_(index);
  var queue = ss.getSheetByName('15_FILA_PROCESSAMENTO');
  exigirFilaReplayGmailWMGJ_(queue);
  return { props: props, index: index, queue: queue, folder: DriveApp.getFolderById(folderId),
    scope: { orgId: orgId, spreadsheetId: ss.getId(), folderId: folderId, actor: actor,
      scriptId: ScriptApp.getScriptId() } };
}

function manifestoReplayGmailWMGJ_(ctx, messageId) {
  var msg = GmailApp.getMessageById(messageId);
  if (!msg || msg.getId() !== messageId) throw new Error('GMAIL_MESSAGE_ID_DIVERGENTE');
  if ([msg.getSubject(), msg.getFrom(), msg.getTo()].some(function(v) { return /^\s*=/.test(v); })) throw new Error('GMAIL_REPLAY_UNSAFE_CELL');
  var seen = {}, total = 0;
  var items = msg.getAttachments({ includeInlineImages: false, includeAttachments: true }).map(function(a) {
    var blob = a.copyBlob(), bytes = blob.getBytes(), name = a.getName() || 'anexo_sem_nome';
    if (/^\s*=/.test(name)) throw new Error('GMAIL_REPLAY_UNSAFE_CELL');
    var sha = hashReplayGmailWMGJ_(bytes);
    var legacyHash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)).slice(0, 32);
    var key = hashReplayGmailWMGJ_(JSON.stringify([ctx.scope, messageId, name, sha]));
    if (seen[key]) throw new Error('GMAIL_REPLAY_DUPLICATE_ATTACHMENT_IDENTITY');
    seen[key] = true;
    total += bytes.length;
    if (bytes.length > 5 * 1024 * 1024) throw new Error('GMAIL_REPLAY_ATTACHMENT_LIMIT');
    return { key: key, name: name, mime: a.getContentType() || 'application/octet-stream',
      size: bytes.length, sha256: sha, legacyHash: legacyHash,
      legacyKey: [messageId, name, legacyHash].join('|'), blob: blob };
  }).sort(function(a, b) { return a.key.localeCompare(b.key); });
  if (!items.length || items.length > 20 || total > 25 * 1024 * 1024) throw new Error('GMAIL_REPLAY_MESSAGE_LIMIT');
  var manifest = { version: 1, scope: ctx.scope, messageId: messageId, attachments: items.map(function(a) {
    return { key: a.key, name: a.name, mime: a.mime, bytes: a.size, sha256: a.sha256, legacyKey: a.legacyKey };
  }) };
  return { message: msg, items: items, manifest: manifest, hash: hashReplayGmailWMGJ_(JSON.stringify(manifest)) };
}

function lerEstadoReplayGmailWMGJ_(ctx, item) {
  var raw = ctx.props.getProperty('AURORA_GMAIL_ITEM_' + item.key);
  if (!raw) return { version: 1, key: item.key, sha256: item.sha256, attempts: 0, receipts: {} };
  var state = JSON.parse(raw);
  if (state.version !== 1 || state.key !== item.key || state.sha256 !== item.sha256 ||
      !state.receipts || !Number.isInteger(state.attempts) || state.attempts < 0) throw new Error('GMAIL_REPLAY_CHECKPOINT_CONFLICT');
  return state;
}

function gravarEstadoReplayGmailWMGJ_(ctx, state, stage) {
  state.stage = stage;
  state.updatedAt = new Date().toISOString();
  ctx.props.setProperty('AURORA_GMAIL_ITEM_' + state.key, JSON.stringify(state));
}

function httpDriveReplayGmailWMGJ_(path, options) {
  options = options || {};
  options.headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  options.muteHttpExceptions = true;
  var response = UrlFetchApp.fetch('https://www.googleapis.com/' + path, options);
  var code = response.getResponseCode();
  if (code === 404 && (!options.method || options.method === 'get')) return null;
  if (code < 200 || code >= 300) throw new Error('GMAIL_REPLAY_DRIVE_HTTP_' + code);
  return JSON.parse(response.getContentText());
}

function arquivoPorIdReplayGmailWMGJ_(id) {
  var metadata = httpDriveReplayGmailWMGJ_('drive/v3/files/' + encodeURIComponent(id) + '?fields=id,trashed&supportsAllDrives=true');
  if (!metadata) return null;
  if (metadata.trashed) throw new Error('GMAIL_REPLAY_FILE_TRASHED');
  return DriveApp.getFileById(id);
}

function verificarArquivoReplayGmailWMGJ_(file, item) {
  if (file.isTrashed() || Number(file.getSize()) !== item.size ||
      hashReplayGmailWMGJ_(file.getBlob().getBytes()) !== item.sha256) throw new Error('GMAIL_REPLAY_FILE_HASH_MISMATCH');
  return file;
}

function reconciliarArquivoReplayGmailWMGJ_(ctx, item, state, records) {
  var candidates = {}, referenced = {};
  records.forEach(function(r) { if (r.arquivoId) referenced[r.arquivoId] = true; });
  if (state.fileId) referenced[state.fileId] = true;
  Object.keys(referenced).forEach(function(id) {
    var file = arquivoPorIdReplayGmailWMGJ_(id);
    // A preallocated ID may not exist yet. An acknowledged file may not disappear silently.
    if (!file && (id !== state.fileId || state.receipts.file)) throw new Error('GMAIL_REPLAY_REFERENCED_FILE_MISSING');
    if (file) candidates[id] = verificarArquivoReplayGmailWMGJ_(file, item);
  });
  // Inventory the configured destination, including legacy orphans without metadata.
  var files = ctx.folder.getFiles(), count = 0;
  while (files.hasNext()) {
    if (++count > 1000) throw new Error('GMAIL_REPLAY_INVENTORY_LIMIT');
    var file = files.next();
    if (!file.isTrashed() && Number(file.getSize()) === item.size &&
        hashReplayGmailWMGJ_(file.getBlob().getBytes()) === item.sha256) candidates[file.getId()] = file;
  }
  var ids = Object.keys(candidates);
  if (ids.length > 1) throw new Error('GMAIL_REPLAY_AMBIGUOUS_FILES');
  if (ids.length && state.fileId && ids[0] !== state.fileId) throw new Error('GMAIL_REPLAY_RESERVED_ID_CONFLICT');
  return ids.length ? candidates[ids[0]] : null;
}

function recibosReplayGmailWMGJ_(ctx, item, file) {
  var records = exigirContratoIndiceGmailWMGJ_(ctx.index).registros.filter(function(r) { return r.chave === item.legacyKey; });
  if (records.some(function(r) { return /^IGNORADO/.test(r.status); })) throw new Error('GMAIL_REPLAY_IGNORED_REQUIRES_REVIEW');
  var terminal = records.filter(function(r) { return r.terminal; });
  if (terminal.length > 1 || terminal.some(function(r) { return !file || r.arquivoId !== file.getId(); })) throw new Error('GMAIL_REPLAY_INDEX_CONFLICT');
  var queue = exigirFilaReplayGmailWMGJ_(ctx.queue), matches = [];
  if (file) queue.forEach(function(r, i) { if (i && r[2] === file.getId()) matches.push({ row: i + 1, values: r }); });
  if (matches.length > 1) throw new Error('GMAIL_REPLAY_QUEUE_CONFLICT');
  var version = matches.length ? String(matches[0].values[9]).match(/SHA256=([a-f0-9]{64})/) : null;
  if (matches.length && (!matches[0].values[5] || (version && version[1] !== item.sha256))) throw new Error('GMAIL_REPLAY_QUEUE_VERSION_CONFLICT');
  return { file: file ? { fileId: file.getId(), sha256: item.sha256, bytes: item.size } : null,
    index: terminal.length ? { sheet: ctx.index.getName(), row: terminal[0].linha, fileId: file.getId() } : null,
    queue: matches.length ? { sheet: ctx.queue.getName(), row: matches[0].row, fileId: file.getId(), sha256: item.sha256 } : null };
}

function criarArquivoReplayGmailWMGJ_(ctx, item, state) {
  if (!state.fileId) {
    var generated = httpDriveReplayGmailWMGJ_('drive/v3/files/generateIds?count=1&space=drive&type=files');
    if (!generated || !generated.ids || !generated.ids[0]) throw new Error('GMAIL_REPLAY_ID_ALLOCATION_FAILED');
    state.fileId = generated.ids[0];
    gravarEstadoReplayGmailWMGJ_(ctx, state, 'FILE_RESERVED');
  }
  // ID is persisted BEFORE upload. Retrying an ambiguous upload never allocates another ID.
  var metadata = { id: state.fileId, name: 'GMAIL_REPLAY__' + item.key + '__' + normalizarNomeArquivoGmailWMGJ_(item.name),
    parents: [ctx.scope.folderId], mimeType: item.mime,
    appProperties: { auroraReplayKey: item.key, sha256: item.sha256 } };
  var boundary = 'aurora_' + Utilities.getUuid().replace(/-/g, '');
  var before = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
    '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n';
  var payload = Utilities.newBlob(before).getBytes().concat(item.blob.getBytes(), Utilities.newBlob('\r\n--' + boundary + '--\r\n').getBytes());
  try {
    httpDriveReplayGmailWMGJ_('upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
      method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload
    });
  } catch (error) {
    if (error.message !== 'GMAIL_REPLAY_DRIVE_HTTP_409') throw error;
    // A previous ambiguous request may already have committed this exact reserved ID.
  }
  var file = arquivoPorIdReplayGmailWMGJ_(state.fileId);
  if (!file) throw new Error('GMAIL_REPLAY_UPLOAD_UNCONFIRMED');
  return verificarArquivoReplayGmailWMGJ_(file, item);
}

function replayMensagemGmailWMGJ(messageId, options) {
  if (typeof messageId !== 'string' || !/^[a-f0-9]{8,32}$/.test(messageId)) throw new Error('GMAIL_MESSAGE_ID_INVALIDO');
  options = options || {};
  if (Object.keys(options).some(function(k) { return ['dryRun', 'expectedManifestHash'].indexOf(k) < 0; }) ||
      (options.dryRun !== undefined && typeof options.dryRun !== 'boolean')) throw new Error('GMAIL_REPLAY_OPTIONS_INVALID');
  var dryRun = options.dryRun !== false;
  return comTravaIngestaoGmailWMGJ_(function() {
    var ctx = contextoReplayGmailWMGJ_(), source = manifestoReplayGmailWMGJ_(ctx, messageId);
    var reservationKey = chaveReservaMensagemGmailWMGJ_(messageId);
    var reserved = ctx.props.getProperty(reservationKey);
    if (reserved && reserved !== source.hash) throw new Error('GMAIL_REPLAY_MESSAGE_SCOPE_CONFLICT');
    if (!dryRun) {
      var authorization = JSON.parse(ctx.props.getProperty('AURORA_GMAIL_REPLAY_AUTHORIZATION') || '{}');
      if (options.expectedManifestHash !== source.hash || authorization.manifestHash !== source.hash ||
          authorization.actor !== ctx.scope.actor || authorization.messageId !== messageId ||
          ['INTERNAL', 'RESTRICTED'].indexOf(authorization.dataClassification) < 0 ||
          !Number.isFinite(Date.parse(authorization.expiresAt)) || Date.parse(authorization.expiresAt) <= Date.now()) throw new Error('GMAIL_REPLAY_NOT_AUTHORIZED');
    }
    // Validate every attachment/destination before the first mutation.
    var plan = source.items.map(function(item) {
      var state = lerEstadoReplayGmailWMGJ_(ctx, item);
      var records = exigirContratoIndiceGmailWMGJ_(ctx.index).registros.filter(function(r) { return r.chave === item.legacyKey; });
      var file = reconciliarArquivoReplayGmailWMGJ_(ctx, item, state, records);
      return { item: item, state: state, file: file, receipts: recibosReplayGmailWMGJ_(ctx, item, file) };
    });
    if (dryRun) return { ok: true, mode: 'DRY_RUN', replayExecuted: false, manifest: source.manifest,
      manifestHash: source.hash, plan: plan.map(function(p) { return { key: p.item.key, receipts: p.receipts,
        missing: ['file', 'index', 'queue'].filter(function(k) { return !p.receipts[k]; }) }; }) };
    ctx.props.setProperty(reservationKey, source.hash); // All legacy Gmail writers yield this message.
    var results = [];
    plan.forEach(function(p) {
      var item = p.item, state = p.state;
      if (state.stage === 'COMPLETE' && p.receipts.file && p.receipts.index && p.receipts.queue) {
        results.push({ key: item.key, receipts: p.receipts, changed: false }); return;
      }
      if (state.attempts >= 10) throw new Error('GMAIL_REPLAY_ATTEMPT_LIMIT');
      state.attempts++;
      state.actor = ctx.scope.actor;
      state.manifestHash = source.hash;
      gravarEstadoReplayGmailWMGJ_(ctx, state, 'STARTED');
      try {
        // A previous attachment may have identical bytes with a different name. Reconcile again.
        var records = exigirContratoIndiceGmailWMGJ_(ctx.index).registros.filter(function(r) { return r.chave === item.legacyKey; });
        var file = reconciliarArquivoReplayGmailWMGJ_(ctx, item, state, records) || criarArquivoReplayGmailWMGJ_(ctx, item, state);
        state.fileId = file.getId();
        state.receipts = recibosReplayGmailWMGJ_(ctx, item, file);
        gravarEstadoReplayGmailWMGJ_(ctx, state, 'FILE_VERIFIED');
        if (!state.receipts.index) {
          var m = source.message;
          registrarLinhaGmailIndexacaoWMGJ_(ctx.index, { messageId: messageId, threadId: m.getThread().getId(),
            dataEmail: m.getDate(), remetente: m.getFrom(), destinatario: m.getTo(), assunto: m.getSubject(),
            attachmentName: item.name, attachmentMime: item.mime, attachmentSize: item.size, attachmentHash: item.legacyHash },
          { origem: 'REPLAY_MANUAL', pertinente: true, categoria: 'A_CLASSIFICAR', tipoDocumento: '', competencia: '',
            fornecedor: '', valor: '', confianca: 0, justificativa: 'Recuperacao documental; sem reconhecimento financeiro.' },
          file.getId(), 'COPIADO_BRUTO_A_CLASSIFICAR', file.getUrl());
          SpreadsheetApp.flush();
        }
        state.receipts = recibosReplayGmailWMGJ_(ctx, item, file);
        if (!state.receipts.index) throw new Error('GMAIL_REPLAY_INDEX_UNCONFIRMED');
        gravarEstadoReplayGmailWMGJ_(ctx, state, 'INDEX_VERIFIED');
        if (!state.receipts.queue) {
          ctx.queue.appendRow([new Date(), 'GMAIL_ANEXO', file.getId(), file.getName(), item.mime, 'PENDENTE', 0,
            'EXTRAIR_CONTEUDO', '', 'AURORA_REPLAY=' + item.key + '; SHA256=' + item.sha256]);
          SpreadsheetApp.flush();
        }
        state.receipts = recibosReplayGmailWMGJ_(ctx, item, file);
        verificarArquivoReplayGmailWMGJ_(file, item);
        if (!state.receipts.queue) throw new Error('GMAIL_REPLAY_QUEUE_UNCONFIRMED');
        gravarEstadoReplayGmailWMGJ_(ctx, state, 'COMPLETE');
        results.push({ key: item.key, receipts: state.receipts, changed: true });
      } catch (error) {
        // No provider response, subject, body or token is copied to the checkpoint/log.
        state.failure = /^GMAIL_[A-Z0-9_]+$/.test(String(error.message)) ? error.message : 'GMAIL_REPLAY_PARTIAL_FAILURE';
        gravarEstadoReplayGmailWMGJ_(ctx, state, 'PARTIAL');
        throw new Error(state.failure);
      }
    });
    return { ok: true, mode: 'EXECUTE', replayExecuted: true, manifestHash: source.hash, receipts: results,
      financialRecognition: false, pipelineExecuted: false };
  });
}
