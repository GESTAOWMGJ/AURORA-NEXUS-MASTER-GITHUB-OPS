/** AURORA-REV-SAN-001: existing private findings -> existing queue -> Gmail.
 * No trigger, new datastore, inferred contact, public command or default grant.
 * Config/history are installed by the existing protected operator workflow.
 */
var AURORA_SANITATION_TYPE_ = 'DOCUMENT_SANITATION';
var AURORA_SANITATION_GAPS_ = {
  DOCUMENT_MISSING: 'o documento comprobatório pendente',
  SCHEDULE_VALIDATION_MISSING: 'a escala vigente com validação do responsável, versão e período',
  SCHEDULE_EXECUTION_UNVERIFIED: 'a comprovação da escala executada, vinculada ao período e ao responsável'
};

function sanitationRequire_(condition, code) {
  if (!condition) throw new Error('SANITATION_' + code);
}
function sanitationId_(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }
function sanitationDate_(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
}
function sanitationHash_(value) { return hashReplayGmailWMGJ_(JSON.stringify(value)); }
function sanitationKey_(issue) {
  sanitationRequire_(sanitationId_(issue.orgId) && sanitationId_(issue.ownerId)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(issue.competence || '')
    && Object.prototype.hasOwnProperty.call(AURORA_SANITATION_GAPS_, issue.gapType), 'ISSUE_INVALID');
  return sanitationHash_([issue.orgId, issue.competence, issue.gapType, issue.ownerId]);
}
function sanitationEmail_(value) {
  return typeof value === 'string' && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}
function sanitationAddresses_(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
}
function sanitationConfig_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('AURORA_DOCUMENT_SANITATION_CONFIG');
  if (!raw) return null;
  var cfg;
  try { cfg = JSON.parse(raw); } catch (_) { throw new Error('SANITATION_CONFIG_INVALID'); }
  if (cfg.enabled !== true) return null;
  var actor = Session.getEffectiveUser().getEmail().toLowerCase();
  sanitationRequire_(cfg.schemaVersion === 1 && sanitationId_(cfg.orgId) && cfg.organizationVerified === true
    && sanitationId_(cfg.organizationEvidenceRef) && cfg.orgId === props.getProperty('WMGJ_FIRESTORE_ORG_ID')
    && cfg.scriptId === ScriptApp.getScriptId() && sanitationEmail_(cfg.executorEmail)
    && cfg.executorEmail.toLowerCase() === actor && cfg.spreadsheetId === getConfigWMGJ_().SPREADSHEET_ID,
    'IDENTITY_BINDING_REQUIRED');
  sanitationRequire_(cfg.historyBaseline && sanitationId_(cfg.historyBaseline.reviewRef)
    && sanitationId_(cfg.historyBaseline.reviewedBy) && cfg.historyBaseline.complete === true
    && sanitationDate_(cfg.historyBaseline.reviewedAt) <= Date.now(), 'HISTORY_BASELINE_REQUIRED');
  // The hash pins all grant/contact/history changes during one attempt.
  cfg.bindingHash = sanitationHash_(raw);
  return cfg;
}
function sanitationAuthorize_(cfg, issue) {
  sanitationRequire_(cfg && issue.orgId === cfg.orgId, 'ORG_MISMATCH');
  var owner = cfg.owners && Object.prototype.hasOwnProperty.call(cfg.owners, issue.ownerId) && cfg.owners[issue.ownerId];
  var a = cfg.authorization, now = Date.now();
  sanitationRequire_(owner && owner.active === true && owner.verified === true && owner.orgId === cfg.orgId
    && owner.id === issue.ownerId && sanitationEmail_(owner.email) && sanitationId_(owner.verificationRef), 'OWNER_UNVERIFIED');
  sanitationRequire_(a && a.orgId === cfg.orgId && a.active === true && a.revoked === false
    && a.actor === cfg.executorEmail && a.scope === 'DOCUMENT_SANITATION'
    && sanitationId_(a.id) && sanitationId_(a.approvalRef) && sanitationId_(a.approvedBy)
    && sanitationId_(a.independentReviewRef) && a.mfaVerified === true
    && sanitationDate_(a.validFrom) <= now && sanitationDate_(a.expiresAt) > now
    && Array.isArray(a.ownerIds) && a.ownerIds.indexOf(issue.ownerId) >= 0
    && Array.isArray(a.gapTypes) && a.gapTypes.indexOf(issue.gapType) >= 0
    && Array.isArray(a.competences) && a.competences.indexOf(issue.competence) >= 0, 'AUTHORIZATION_REQUIRED');
  return owner;
}
function sanitationCurrent_(cfg, issue) {
  var live = sanitationConfig_();
  sanitationRequire_(live && live.bindingHash === cfg.bindingHash, 'CONFIG_CHANGED_OR_REVOKED');
  sanitationAuthorize_(live, issue);
  sanitationRequire_(live.sendEnabled === true, 'SEND_DISABLED');
  return live;
}
function sanitationHeaders_(sheet, required) {
  sanitationRequire_(sheet && sheet.getLastRow() >= 1, 'EXISTING_SHEET_REQUIRED');
  var rows = sheet.getDataRange().getValues(), headers = rows[0], indexes = {};
  required.forEach(function(name) {
    sanitationRequire_(headers.indexOf(name) >= 0 && headers.indexOf(name) === headers.lastIndexOf(name), 'SCHEMA_MISMATCH');
    indexes[name] = headers.indexOf(name);
  });
  return { rows: rows, indexes: indexes };
}
function sanitationIssues_(sheet, cfg) {
  var data = sanitationHeaders_(sheet, ['STATUS', 'SANITATION_JSON']), byKey = {};
  sanitationRequire_(data.rows.length <= 1001, 'FINDINGS_LIMIT');
  data.rows.slice(1).forEach(function(row) {
    if (!row[data.indexes.SANITATION_JSON]) return;
    var issue;
    try { issue = JSON.parse(row[data.indexes.SANITATION_JSON]); } catch (_) { throw new Error('SANITATION_ISSUE_INVALID'); }
    var key = sanitationKey_(issue);
    sanitationRequire_(issue.orgId === cfg.orgId, 'ORG_MISMATCH');
    if (['OPEN', 'ACKNOWLEDGED'].indexOf(row[data.indexes.STATUS]) < 0) return;
    sanitationRequire_(issue.coverage === 'COMPLETE' && sanitationId_(issue.evidenceRef), 'COVERAGE_UNKNOWN');
    var history = issue.history;
    sanitationRequire_(history && sanitationId_(history.reviewRef) && sanitationId_(history.reviewedBy)
      && sanitationDate_(history.reviewedAt) >= sanitationDate_(cfg.historyBaseline.reviewedAt)
      && sanitationDate_(history.reviewedAt) <= Date.now() && Array.isArray(history.legacyMessageIds)
      && history.legacyMessageIds.length <= 20 && history.legacyMessageIds.every(function(id) {
        return typeof id === 'string' && /^[a-f0-9]{8,32}$/.test(id);
      }), 'ISSUE_HISTORY_REQUIRED');
    sanitationAuthorize_(cfg, issue);
    if (!byKey[key]) byKey[key] = { orgId: issue.orgId, competence: issue.competence, gapType: issue.gapType,
      ownerId: issue.ownerId, key: key, historyReviewedAt: history.reviewedAt, legacyMessageIds: [], evidenceRefs: [], historyRefs: [] };
    var item = byKey[key];
    if (sanitationDate_(history.reviewedAt) < sanitationDate_(item.historyReviewedAt)) item.historyReviewedAt = history.reviewedAt;
    history.legacyMessageIds.forEach(function(id) { if (item.legacyMessageIds.indexOf(id) < 0) item.legacyMessageIds.push(id); });
    if (item.evidenceRefs.indexOf(issue.evidenceRef) < 0) item.evidenceRefs.push(issue.evidenceRef);
    if (item.historyRefs.indexOf(history.reviewRef) < 0) item.historyRefs.push(history.reviewRef);
  });
  return Object.keys(byKey).sort().map(function(key) { return byKey[key]; });
}
function sanitationMessage_(issue) {
  var marker = 'AURORA-SAN-' + issue.key;
  return { marker: marker, subject: 'Solicitação documental — ' + issue.competence + ' [' + marker + ']',
    body: 'Prezado(a),\n\nNa conferência documental da competência ' + issue.competence +
      ', permanece pendente ' + AURORA_SANITATION_GAPS_[issue.gapType] + '.\n\n' +
      'Solicitamos o encaminhamento da evidência e a confirmação do período e da versão aplicáveis. ' +
      'Se o material já foi enviado, favor indicar a comunicação correspondente.\n\n' +
      'O recebimento será registrado para conferência; a pendência depende da validação da evidência.\n\n' +
      'Atenciosamente,\nGestão documental\nReferência: ' + marker };
}
function sanitationDestination_(cfg, owner) { return sanitationHash_([cfg.orgId, cfg.executorEmail.toLowerCase(), owner.id, owner.email.toLowerCase()]); }
function sanitationState_(queue, item, cfg, owner) {
  var data = sanitationHeaders_(queue, cabecalhoFilaWMGJ_V3_()), matches = [];
  sanitationRequire_(data.rows.length <= 10001, 'QUEUE_LIMIT');
  data.rows.slice(1).forEach(function(row, i) {
    if (row[data.indexes.ID_ORIGEM] === 'sanitation:' + item.key) matches.push({ row: row, number: i + 2 });
  });
  sanitationRequire_(matches.length <= 1, 'QUEUE_CONFLICT');
  if (matches.length) {
    var match = matches[0], state;
    sanitationRequire_(match.row[data.indexes.TIPO] === AURORA_SANITATION_TYPE_, 'QUEUE_CONFLICT');
    try { state = JSON.parse(match.row[data.indexes.OBSERVACAO]); } catch (_) { throw new Error('SANITATION_STATE_INVALID'); }
    sanitationRequire_(state.schemaVersion === 1 && state.key === item.key && state.orgId === cfg.orgId
      && state.destinationHash === sanitationDestination_(cfg, owner) && Array.isArray(state.events)
      && Number.isSafeInteger(state.attempts) && state.attempts >= 0
      && ['QUEUED','DRAFT_CREATING','DRAFT_READY','SEND_STARTED','UNKNOWN','SENT','RESPONSE_REVIEW'].indexOf(state.stage) >= 0,
      'STATE_OR_DESTINATION_CONFLICT');
    return { sheet: queue, row: match.number, indexes: data.indexes, state: state };
  }
  var initial = { schemaVersion: 1, orgId: cfg.orgId, key: item.key, stage: 'QUEUED', attempts: 0,
    destinationHash: sanitationDestination_(cfg, owner), authorizationId: cfg.authorization.id,
    evidenceRefs: item.evidenceRefs, historyRefs: item.historyRefs, events: [] };
  var row = data.rows[0].map(function() { return ''; });
  row[data.indexes.DATA_ENTRADA] = new Date(); row[data.indexes.ORIGEM] = 'AURORA-REV-SAN-001';
  row[data.indexes.ID_ORIGEM] = 'sanitation:' + item.key; row[data.indexes.NOME] = 'Solicitação documental';
  row[data.indexes.TIPO] = AURORA_SANITATION_TYPE_; row[data.indexes.STATUS] = 'SAN_QUEUED';
  row[data.indexes.OBSERVACAO] = JSON.stringify(initial);
  queue.appendRow(row); SpreadsheetApp.flush();
  return sanitationState_(queue, item, cfg, owner); // Read back before an external effect.
}
function sanitationSave_(entry, stage, details) {
  var state = entry.state;
  state.stage = stage;
  if (details) Object.keys(details).forEach(function(key) { state[key] = details[key]; });
  // Bounded attempts and terminal no-resend keep the audit trail below the cell limit.
  state.events.push({ stage: stage, at: new Date().toISOString(), attempt: state.attempts });
  sanitationRequire_(state.events.length <= 100, 'AUDIT_LIMIT');
  var serialized = JSON.stringify(state);
  sanitationRequire_(serialized.length < 40000, 'STATE_LIMIT');
  var range = entry.sheet.getRange(entry.row, entry.indexes.OBSERVACAO + 1);
  range.setValue(serialized); SpreadsheetApp.flush();
  sanitationRequire_(range.getValue() === serialized, 'STATE_READBACK_FAILED');
  entry.sheet.getRange(entry.row, entry.indexes.STATUS + 1).setValue('SAN_' + stage);
  entry.sheet.getRange(entry.row, entry.indexes.TENTATIVAS + 1).setValue(state.attempts);
  SpreadsheetApp.flush();
}
function sanitationSentMessage_(message, cfg, owner) {
  return !message.isDraft() && sanitationAddresses_(message.getFrom()).length === 1
    && sanitationAddresses_(message.getFrom())[0] === cfg.executorEmail.toLowerCase()
    && sanitationAddresses_(message.getTo()).indexOf(owner.email.toLowerCase()) >= 0;
}
function sanitationHistory_(item, cfg, owner, state) {
  var marker = sanitationMessage_(item).marker, messages = {}, threads = {}, receipts = [], responses = [];
  var ids = item.legacyMessageIds.concat(state.messageId ? [state.messageId] : []);
  ids.forEach(function(id) {
    var message = GmailApp.getMessageById(id);
    sanitationRequire_(message && message.getId() === id && sanitationSentMessage_(message, cfg, owner), 'HISTORY_MISMATCH');
    messages[id] = message;
  });
  var found = GmailApp.search('in:anywhere "' + marker + '"', 0, 51);
  sanitationRequire_(found.length <= 50, 'HISTORY_LIMIT');
  found.forEach(function(thread) { threads[thread.getId()] = thread; });
  Object.keys(messages).forEach(function(id) {
    var thread = messages[id].getThread(); threads[thread.getId()] = thread;
  });
  Object.keys(threads).forEach(function(id) {
    var all = threads[id].getMessages();
    sanitationRequire_(all.length <= 100, 'THREAD_LIMIT');
    all.forEach(function(message) {
      if (message.isDraft()) return;
      if (sanitationSentMessage_(message, cfg, owner) && (messages[message.getId()] || message.getSubject().indexOf(marker) >= 0)) {
        receipts.push({ messageId: message.getId(), threadId: id });
      } else if (sanitationAddresses_(message.getFrom()).indexOf(cfg.executorEmail.toLowerCase()) < 0) {
        responses.push({ messageId: message.getId(), threadId: id,
          attachmentCount: message.getAttachments({ includeInlineImages: false }).length });
      }
    });
  });
  // Manual communications do not carry our marker. Any new unlinked conversation
  // with this verified contact after the reviewed baseline blocks, instead of
  // assuming that a negative marker search proves that nobody already asked.
  var since = sanitationDate_(item.historyReviewedAt);
  var day = new Date(since - 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '/');
  var recent = GmailApp.search('in:anywhere after:' + day + ' {from:' + owner.email + ' to:' + owner.email + '}', 0, 51);
  sanitationRequire_(recent.length <= 50, 'HISTORY_LIMIT');
  recent.forEach(function(thread) {
    if (threads[thread.getId()]) return;
    var all = thread.getMessages();
    sanitationRequire_(all.length <= 100, 'THREAD_LIMIT');
    all.forEach(function(message) {
      if (message.isDraft() || message.getDate().getTime() <= since) return;
      var related = sanitationAddresses_(message.getFrom()).concat(sanitationAddresses_(message.getTo()));
      sanitationRequire_(related.indexOf(owner.email.toLowerCase()) < 0, 'UNLINKED_CORRESPONDENCE_REVIEW');
    });
  });
  return { receipts: receipts, responses: responses };
}
function sanitationReconcile_(entry, item, cfg, owner) {
  var history = sanitationHistory_(item, cfg, owner, entry.state);
  if (history.receipts.length || history.responses.length) {
    var stage = history.responses.length ? 'RESPONSE_REVIEW' : 'SENT';
    var details = { receipts: history.receipts, responses: history.responses };
    if (history.receipts.length) { details.messageId = history.receipts[0].messageId; details.threadId = history.receipts[0].threadId; }
    if (entry.state.stage !== stage || JSON.stringify(entry.state.responses) !== JSON.stringify(history.responses)
      || JSON.stringify(entry.state.receipts) !== JSON.stringify(history.receipts)) sanitationSave_(entry, stage, details);
    return true;
  }
  return ['SENT','RESPONSE_REVIEW'].indexOf(entry.state.stage) >= 0;
}
function sanitationDraft_(entry, item, cfg, owner) {
  var content = sanitationMessage_(item), draft;
  if (entry.state.draftId) draft = GmailApp.getDraft(entry.state.draftId);
  else if (entry.state.stage === 'DRAFT_CREATING') {
    var all = GmailApp.getDrafts();
    sanitationRequire_(all.length <= 200, 'DRAFT_LIMIT');
    var found = all.filter(function(d) { return d.getMessage().getSubject() === content.subject; });
    sanitationRequire_(found.length === 1, 'DRAFT_OUTCOME_UNKNOWN');
    draft = found[0];
  } else {
    sanitationRequire_(entry.state.attempts < 3, 'ATTEMPT_LIMIT');
    sanitationCurrent_(cfg, item);
    entry.state.attempts++;
    sanitationSave_(entry, 'DRAFT_CREATING');
    draft = GmailApp.createDraft(owner.email, content.subject, content.body);
  }
  sanitationValidateDraft_(draft, item, owner);
  if (entry.state.stage !== 'DRAFT_READY') sanitationSave_(entry, 'DRAFT_READY', { draftId: draft.getId() });
  return draft;
}
function sanitationValidateDraft_(draft, item, owner) {
  var content = sanitationMessage_(item);
  var message = draft.getMessage();
  sanitationRequire_(message.isDraft() && sanitationAddresses_(message.getTo()).length === 1
    && sanitationAddresses_(message.getTo())[0] === owner.email.toLowerCase()
    && !message.getCc() && !message.getBcc() && message.getSubject() === content.subject
    && message.getPlainBody().replace(/\r\n/g, '\n') === content.body
    && message.getAttachments().length === 0, 'DRAFT_CHANGED');
}
function sanitationProcess_(entry, item, cfg, owner, findings) {
  if (sanitationReconcile_(entry, item, cfg, owner)) return entry.state.stage;
  if (['SEND_STARTED','UNKNOWN'].indexOf(entry.state.stage) >= 0) {
    if (entry.state.stage !== 'UNKNOWN') sanitationSave_(entry, 'UNKNOWN');
    return 'UNKNOWN'; // Negative search, timeout and expired lock are NOT proof of non-delivery.
  }
  if (cfg.sendEnabled !== true) return 'SEND_DISABLED';
  var draft = sanitationDraft_(entry, item, cfg, owner);
  // Repeat live history and finding/grant checks immediately before linearizing dispatch.
  if (sanitationReconcile_(entry, item, cfg, owner)) return entry.state.stage;
  var latest = sanitationIssues_(findings, cfg).filter(function(i) { return i.key === item.key; })[0];
  sanitationRequire_(latest && JSON.stringify(latest) === JSON.stringify(item), 'FINDING_CHANGED');
  sanitationCurrent_(cfg, item);
  sanitationSave_(entry, 'SEND_STARTED');
  draft = GmailApp.getDraft(entry.state.draftId);
  sanitationValidateDraft_(draft, item, owner);
  sanitationCurrent_(cfg, item); // Revoke/change during durable reservation prevents dispatch.
  try {
    var sent = draft.send();
    sanitationRequire_(sent && sanitationSentMessage_(sent, cfg, owner)
      && sent.getSubject() === sanitationMessage_(item).subject, 'SEND_RECEIPT_INVALID');
    sanitationSave_(entry, 'SENT', { messageId: sent.getId(), threadId: sent.getThread().getId(),
      receipts: [{ messageId: sent.getId(), threadId: sent.getThread().getId() }], responses: [] });
  } catch (_) {
    // Durable SEND_STARTED survives receipt-save failures and process death. No blind retry.
    return 'UNKNOWN';
  }
  return entry.state.stage;
}
function executarSaneamentoDocumentalAurora_(origin) {
  try {
    var cfg = sanitationConfig_();
    if (!cfg) return { ok: true, code: 'SANITATION_DISABLED', installed: false };
    sanitationRequire_(['DOCUMENT_AUDIT','FINANCIAL_CLOSING','PERIODIC'].indexOf(origin) >= 0, 'ORIGIN_INVALID');
    return comTravaIngestaoGmailWMGJ_(function() {
      cfg = sanitationConfig_(); sanitationRequire_(cfg, 'CONFIG_CHANGED_OR_REVOKED');
      var ss = getPlanilha(), names = getConfigWMGJ_().SHEETS;
      sanitationRequire_(ss.getId() === cfg.spreadsheetId, 'SHEET_BINDING_REQUIRED');
      var findings = ss.getSheetByName(names.PENDENCIAS), queue = ss.getSheetByName(names.FILA);
      var issues = sanitationIssues_(findings, cfg), results = [];
      // Round-robin in the existing private checkpoint store avoids terminal rows starving work.
      var props = PropertiesService.getScriptProperties(), cursorKey = 'AURORA_SANITATION_CURSOR_' + sanitationHash_(cfg.orgId);
      var cursor = props.getProperty(cursorKey) || '';
      var ordered = issues.filter(function(i) { return i.key > cursor; }).concat(issues.filter(function(i) { return i.key <= cursor; }));
      ordered.slice(0, 5).forEach(function(item) {
        var code;
        try {
          var owner = sanitationAuthorize_(cfg, item), entry = sanitationState_(queue, item, cfg, owner);
          code = sanitationProcess_(entry, item, cfg, owner, findings);
        } catch (error) { code = sanitationSafeError_(error); }
        results.push({ key: item.key, code: code });
        props.setProperty(cursorKey, item.key);
      });
      return { ok: results.every(function(r) { return ['SENT','RESPONSE_REVIEW','SEND_DISABLED'].indexOf(r.code) >= 0; }),
        routineId: 'AURORA-REV-SAN-001', origin: origin, results: results, partial: issues.length > 5,
        schedulerCreated: false, financialMutation: false };
    });
  } catch (error) { return { ok: false, code: sanitationSafeError_(error) }; }
}
function sanitationSafeError_(error) {
  var code = error && error.message;
  return typeof code === 'string' && /^SANITATION_[A-Z_]+$/.test(code) ? code : 'SANITATION_COVERAGE_OR_RUNTIME_UNKNOWN';
}
