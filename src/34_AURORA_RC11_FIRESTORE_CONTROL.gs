/**
 * AURORA NEXUS RC1.1 — primeiro lote real WMGJ controlado.
 * Usa somente duas linhas administrativas/financeiras previamente auditadas:
 * NF 8 (competência 2026-05) e respectivo crédito bancário conciliado.
 * Nunca altera a planilha-fonte.
 */

var AURORA_RC11_SAMPLE_COMPETENCE = '2026-05';
var AURORA_RC11_CONFIRMATION = 'ATIVAR_RC11_WMGJ_HML';

function auroraRc11ConfigurarIngestao(url, keyId, secret) {
  url = String(url || '').trim();
  keyId = String(keyId || '').trim();
  secret = String(secret || '');
  if (!/^https:\/\/[^\s]+\/ingestWmgjEvent$/.test(url)) throw new Error('RC11_INGEST_URL_INVALIDA');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(keyId)) throw new Error('RC11_KEY_ID_INVALIDO');
  if (secret.length < 32) throw new Error('RC11_HMAC_SECRET_INVALIDO');
  PropertiesService.getScriptProperties().setProperties({
    WMGJ_FIRESTORE_INGEST_URL: url,
    WMGJ_FIRESTORE_HMAC_KEY_ID: keyId,
    WMGJ_FIRESTORE_HMAC_SECRET: secret,
    WMGJ_FIRESTORE_ORG_ID: 'wmgj',
    WMGJ_FIRESTORE_DRY_RUN: 'true',
    WMGJ_FIRESTORE_MAX_ROWS: '2'
  }, false);
  return { ok: true, keyId: keyId, dryRun: true, secretConfigured: true, sourceMutation: false };
}

function auroraRc11InspecionarConfiguracao() {
  var cfg = wmgjFirestoreConfig_();
  return {
    ok: true,
    endpointConfigured: /^https:\/\/[^\s]+\/ingestWmgjEvent$/.test(cfg.url || ''),
    keyIdConfigured: !!cfg.keyId,
    secretConfigured: cfg.secret.length >= 32,
    orgConfigured: cfg.orgId === 'wmgj',
    dryRun: cfg.dryRun === true,
    hmacConfigured: !!cfg.keyId && cfg.secret.length >= 32 && cfg.orgId === 'wmgj',
    sourceMutation: false
  };
}

function auroraRc11ConfigurarEndpointExistente(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/[^\s]+\/ingestWmgjEvent$/.test(url)) throw new Error('RC11_INGEST_URL_INVALIDA');
  var cfg = wmgjFirestoreConfig_();
  if (!cfg.keyId || cfg.secret.length < 32 || cfg.orgId !== 'wmgj') throw new Error('RC11_HMAC_EXISTENTE_AUSENTE');
  PropertiesService.getScriptProperties().setProperties({
    WMGJ_FIRESTORE_INGEST_URL: url,
    WMGJ_FIRESTORE_ORG_ID: 'wmgj',
    WMGJ_FIRESTORE_DRY_RUN: 'true',
    WMGJ_FIRESTORE_MAX_ROWS: '2'
  }, false);
  return {
    ok: true,
    endpointConfigured: true,
    keyIdConfigured: true,
    secretConfigured: true,
    dryRun: true,
    sourceMutation: false
  };
}

function auroraRc11ValidarHmacExistente() {
  var cfg = wmgjFirestoreConfig_();
  if (!cfg.dryRun) throw new Error('RC11_DRY_RUN_OBRIGATORIO');
  if (!/^https:\/\/[^\s]+\/ingestWmgjEvent$/.test(cfg.url || '')) throw new Error('RC11_INGEST_URL_INVALIDA');
  if (!cfg.keyId || cfg.secret.length < 32 || cfg.orgId !== 'wmgj') throw new Error('RC11_HMAC_EXISTENTE_AUSENTE');

  var probeId = 'rc11-hmac-probe-' + Utilities.getUuid().replace(/-/g, '');
  var probe = { orgId: 'wmgj', idempotencyKey: probeId, probe: true };
  var body = JSON.stringify(probe);
  var timestamp = String(Math.floor(Date.now() / 1000));
  var nonce = Utilities.getUuid();
  var canonical = wmgjFirestoreCanonicalHmacV2_(body, {
    timestamp: timestamp,
    nonce: nonce,
    keyId: cfg.keyId,
    orgId: 'wmgj',
    idempotencyKey: probeId
  });
  var signature = wmgjFirestoreHmacHex_(canonical, cfg.secret);
  var response = UrlFetchApp.fetch(cfg.url, {
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
      'X-WMGJ-Org-Id': 'wmgj',
      'X-WMGJ-Idempotency-Key': probeId
    }
  });
  var code = response.getResponseCode();
  var parsed = wmgjFirestoreParseJson_(response.getContentText());

  if (code === 400 && parsed && parsed.code === 'VALIDATION_ERROR') {
    return {
      ok: true,
      authenticated: true,
      noWrite: true,
      httpCode: code,
      expectedCode: 'VALIDATION_ERROR',
      dryRun: true,
      sourceMutation: false
    };
  }
  if (code === 401) throw new Error('RC11_HMAC_INVALIDO');
  if (code === 503) throw new Error('RC11_KEYRING_INVALIDO');
  throw new Error('RC11_HMAC_PROBE_INESPERADO:HTTP_' + code + ':' + String(response.getContentText() || '').slice(0, 200));
}

function auroraRc11AtivarEscritaAmostra(confirmacao) {
  if (String(confirmacao || '') !== AURORA_RC11_CONFIRMATION) throw new Error('RC11_CONFIRMACAO_INVALIDA');
  var props = PropertiesService.getScriptProperties();
  var cfg = wmgjFirestoreConfig_();
  if (!cfg.url || !cfg.keyId || cfg.secret.length < 32 || cfg.orgId !== 'wmgj') throw new Error('RC11_CONFIG_INCOMPLETA');
  props.setProperty('WMGJ_FIRESTORE_DRY_RUN', 'false');
  return { ok: true, dryRun: false, sampleOnly: true, sourceMutation: false };
}

function auroraRc11KillSwitch() {
  PropertiesService.getScriptProperties().setProperty('WMGJ_FIRESTORE_DRY_RUN', 'true');
  return { ok: true, dryRun: true, sourceMutation: false };
}

function auroraRc11Normalizar_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

function auroraRc11HeaderMap_(headers) {
  var map = {};
  headers.forEach(function(header, index) { map[wmgjFirestoreNormalizeHeader_(header, index)] = index; });
  return map;
}

function auroraRc11BuscarLinha_(sheetName, predicate) {
  var ss = getPlanilha();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('RC11_ABA_AUSENTE:' + sheetName);
  var width = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var blocked = wmgjFirestoreClinicalHeaders_(headers);
  if (blocked.length) throw new Error('RC11_CABECALHO_BLOQUEADO:' + sheetName + ':' + blocked.join(','));
  var rows = sheet.getLastRow() - 1;
  var display = sheet.getRange(2, 1, rows, width).getDisplayValues();
  var raw = sheet.getRange(2, 1, rows, width).getValues();
  for (var i = 0; i < display.length; i++) {
    var record = wmgjFirestoreRowObject_(headers, display[i]);
    if (predicate(record)) {
      return { ss: ss, sheet: sheet, headers: headers, map: auroraRc11HeaderMap_(headers), display: display[i], raw: raw[i], rowNumber: i + 2, record: record };
    }
  }
  throw new Error('RC11_LINHA_NAO_ENCONTRADA:' + sheetName);
}

function auroraRc11InvoiceEvent_() {
  var row = auroraRc11BuscarLinha_('06_NFS_E', function(record) {
    return String(record.competencia_assistencial || '') === AURORA_RC11_SAMPLE_COMPETENCE &&
      String(record.numero_nf || '') === '8' &&
      auroraRc11Normalizar_(record.status_extracao).indexOf('VALIDA') === 0;
  });
  var valueIndex = row.map.valor_servico;
  if (valueIndex === undefined) throw new Error('RC11_VALOR_SERVICO_AUSENTE');
  var cents = wmgjFirestoreBrlToCents_(row.raw[valueIndex], row.display[valueIndex]);
  if (cents !== 4950000) throw new Error('RC11_NF8_VALOR_INESPERADO');
  var rowHash = wmgjFirestoreHashString_(JSON.stringify(wmgjFirestoreRowObject_(row.headers, row.display)));
  var chave = String(row.record.chave_acesso || '').trim();
  if (!chave) throw new Error('RC11_NF8_CHAVE_AUSENTE');
  return {
    schemaVersion: 1,
    eventId: Utilities.getUuid(),
    eventType: 'ENTITY_UPSERT',
    orgId: 'wmgj',
    occurredAt: new Date().toISOString(),
    sourceVersion: 1,
    idempotencyKey: ['wmgj','SHEETS',row.ss.getId(),'06_NFS_E',row.rowNumber,rowHash].join(':'),
    entityType: 'invoice',
    entityKey: '06_NFS_E:' + chave,
    actor: { type: 'SYSTEM', id: wmgjFirestoreActorId_(), source: 'AURORA_RC11_WMGJ' },
    source: {
      system: 'SHEETS',
      sourceId: [row.ss.getId(),'06_NFS_E',row.rowNumber].join(':'),
      parentId: row.ss.getId(),
      contentHash: rowHash,
      hashMethod: 'row_sha256'
    },
    workflowState: 'VALIDATED',
    reviewState: 'NOT_REQUIRED',
    riskLevel: 'LOW',
    sensitivity: 'RESTRICTED',
    competence: AURORA_RC11_SAMPLE_COMPETENCE,
    documentType: '06_NFS_E',
    record: {
      totalCents: cents,
      reconciliationStatus: 'RECONCILED_SOURCE_EVIDENCE'
    },
    metadata: { sourceSheet: '06_NFS_E', sourceRow: row.rowNumber, nonDestructive: true }
  };
}

function auroraRc11BankEvent_() {
  var row = auroraRc11BuscarLinha_('08_EXTRATOS_BRADESCO', function(record) {
    return String(record.competencia_assistencial_relacionada || '') === AURORA_RC11_SAMPLE_COMPETENCE &&
      auroraRc11Normalizar_(record.subcategoria) === 'RECEBIMENTO_NFS_E' &&
      auroraRc11Normalizar_(record.status_conciliacao).indexOf('CONCILIADO') === 0 &&
      String(record.credito || '').trim() !== '';
  });
  var creditIndex = row.map.credito;
  if (creditIndex === undefined) throw new Error('RC11_CREDITO_AUSENTE');
  var cents = wmgjFirestoreBrlToCents_(row.raw[creditIndex], row.display[creditIndex]);
  if (cents !== 4950000) throw new Error('RC11_CREDITO_VALOR_INESPERADO');
  var rowHash = wmgjFirestoreHashString_(JSON.stringify(wmgjFirestoreRowObject_(row.headers, row.display)));
  var dcto = String(row.record.dcto || row.rowNumber).trim();
  return {
    schemaVersion: 1,
    eventId: Utilities.getUuid(),
    eventType: 'ENTITY_UPSERT',
    orgId: 'wmgj',
    occurredAt: new Date().toISOString(),
    sourceVersion: 1,
    idempotencyKey: ['wmgj','SHEETS',row.ss.getId(),'08_EXTRATOS_BRADESCO',row.rowNumber,rowHash].join(':'),
    entityType: 'bankTransaction',
    entityKey: '08_EXTRATOS_BRADESCO:' + dcto,
    actor: { type: 'SYSTEM', id: wmgjFirestoreActorId_(), source: 'AURORA_RC11_WMGJ' },
    source: {
      system: 'SHEETS',
      sourceId: [row.ss.getId(),'08_EXTRATOS_BRADESCO',row.rowNumber].join(':'),
      parentId: row.ss.getId(),
      contentHash: rowHash,
      hashMethod: 'row_sha256'
    },
    workflowState: 'VALIDATED',
    reviewState: 'NOT_REQUIRED',
    riskLevel: 'LOW',
    sensitivity: 'RESTRICTED',
    competence: AURORA_RC11_SAMPLE_COMPETENCE,
    documentType: '08_EXTRATOS_BRADESCO',
    record: {
      status: 'RECONCILED',
      amountCents: cents,
      liquidatedAmountCents: cents,
    },
    metadata: { sourceSheet: '08_EXTRATOS_BRADESCO', sourceRow: row.rowNumber, nonDestructive: true }
  };
}

function auroraRc11ResumoFonte_() {
  var invoice = auroraRc11InvoiceEvent_();
  var bank = auroraRc11BankEvent_();
  return {
    ok: true,
    competence: AURORA_RC11_SAMPLE_COMPETENCE,
    invoiceCents: invoice.record.totalCents,
    receivedCents: bank.record.liquidatedAmountCents,
    differenceCents: invoice.record.totalCents - bank.record.liquidatedAmountCents,
    invoiceSourceHash: invoice.source.contentHash,
    bankSourceHash: bank.source.contentHash,
    sourceMutation: false
  };
}

function auroraRc11DryRunAmostra() {
  var cfg = wmgjFirestoreConfig_();
  if (!cfg.dryRun) throw new Error('RC11_DRY_RUN_OBRIGATORIO');
  var invoice = auroraRc11InvoiceEvent_();
  var bank = auroraRc11BankEvent_();
  var invoiceResult = wmgjFirestoreEnviarEvento_(invoice);
  var bankResult = wmgjFirestoreEnviarEvento_(bank);
  return {
    ok: invoiceResult.ok === true && bankResult.ok === true,
    dryRun: true,
    expected: auroraRc11ResumoFonte_(),
    planned: 2,
    sourceMutation: false
  };
}

function auroraRc11EnviarAmostraReal(confirmacao) {
  if (String(confirmacao || '') !== AURORA_RC11_CONFIRMATION) throw new Error('RC11_CONFIRMACAO_INVALIDA');
  var cfg = wmgjFirestoreConfig_();
  if (cfg.dryRun) throw new Error('RC11_ESCRITA_NAO_ATIVADA');
  var props = PropertiesService.getScriptProperties();
  try {
    var invoice = auroraRc11InvoiceEvent_();
    var bank = auroraRc11BankEvent_();
    var invoiceResult = wmgjFirestoreEnviarEvento_(invoice);
    var bankResult = wmgjFirestoreEnviarEvento_(bank);
    return {
      ok: invoiceResult.ok === true && bankResult.ok === true,
      competence: AURORA_RC11_SAMPLE_COMPETENCE,
      sent: Number(invoiceResult.accepted === true) + Number(bankResult.accepted === true),
      duplicates: Number(invoiceResult.duplicate === true) + Number(bankResult.duplicate === true),
      invoiceEntityId: invoiceResult.entityId || '',
      bankEntityId: bankResult.entityId || '',
      expected: auroraRc11ResumoFonte_(),
      sourceMutation: false,
      oneShot: true
    };
  } finally {
    props.setProperty('WMGJ_FIRESTORE_DRY_RUN', 'true');
  }
}
