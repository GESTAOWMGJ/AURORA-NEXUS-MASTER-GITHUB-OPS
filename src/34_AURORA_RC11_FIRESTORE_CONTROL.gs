/**
 * AURORA NEXUS RC1.1 — primeiro lote real WMGJ controlado.
 * Usa somente duas linhas administrativas/financeiras previamente auditadas:
 * NF 8 (competência 2026-05) e respectivo crédito bancário conciliado.
 * Nunca altera a planilha-fonte.
 */

var AURORA_RC11_SAMPLE_COMPETENCE = '2026-05';
var AURORA_RC11_CONFIRMATION = 'ATIVAR_RC11_WMGJ_HML';
var AURORA_RC11_PAIR_CONTRACT_VERSION = 1;
var AURORA_RC11_PAIR_BINDING_VERSION = 'AURORA_RC11_PAIR_V1';
var AURORA_RC11_AUTH_VERSION = 'AURORA_RC11_AUTH_V1';
var AURORA_RC11_RECEIPT_PREFIX = 'AURORA_RC11_RECEIPT_';
var AURORA_RC11_INVOICE_SHEET = '06_NFS_E';
var AURORA_RC11_BANK_SHEET = '08_EXTRATOS_BRADESCO';
var AURORA_RC11_AMOUNT_CENTS = 4950000;

function auroraRc11IngestUrlValida_(value) {
  // Gen2 expõe o serviço pelo URI HTTPS retornado por serviceConfig.uri.
  // Não aceite URL arbitrária: o bridge envia payload financeiro assinado.
  return /^https:\/\/ingestwmgjevent-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app\/?$/.test(String(value || '').trim());
}

function auroraRc11IngestUrlCanonica_(value) {
  value = String(value || '').trim();
  if (!auroraRc11IngestUrlValida_(value)) throw new Error('RC11_INGEST_URL_INVALIDA');
  return value.replace(/\/$/, '');
}

function auroraRc11InspecionarConfiguracao(expectedUrl) {
  expectedUrl = String(expectedUrl || '').trim();
  var cfg = wmgjFirestoreConfig_();
  var endpointConfigured = auroraRc11IngestUrlValida_(cfg.url);
  var endpointMatches = endpointConfigured && (!expectedUrl || (
    auroraRc11IngestUrlValida_(expectedUrl) &&
    cfg.url.replace(/\/$/, '') === expectedUrl.replace(/\/$/, '')
  ));
  var hmacConfigured = !!cfg.keyId && wmgjFirestoreHmacSecretValido_(cfg.secret) && cfg.orgId === 'wmgj';
  return {
    ok: endpointMatches && hmacConfigured && cfg.dryRun === true,
    endpointConfigured: endpointConfigured,
    endpointMatches: endpointMatches,
    keyIdConfigured: !!cfg.keyId,
    keyId: cfg.keyId || '',
    secretConfigured: wmgjFirestoreHmacSecretValido_(cfg.secret),
    orgConfigured: cfg.orgId === 'wmgj',
    dryRun: cfg.dryRun === true,
    hmacConfigured: hmacConfigured,
    sourceMutation: false
  };
}

function auroraRc11ValidarEventoSemEscrita_(event, cfg) {
  // O cabeçalho é deliberadamente diferente do corpo. O servidor somente
  // alcança SIGNED_HEADER_BODY_MISMATCH depois de autenticar o HMAC e validar
  // integralmente o evento, mas antes de abrir a transação Firestore.
  var signedIdempotencyKey = event.idempotencyKey + ':policy-preflight:' + Utilities.getUuid().replace(/-/g, '');
  var body = JSON.stringify(event);
  var timestamp = String(Math.floor(Date.now() / 1000));
  var nonce = Utilities.getUuid();
  var canonical = wmgjFirestoreCanonicalHmacV2_(body, {
    timestamp: timestamp,
    nonce: nonce,
    keyId: cfg.keyId,
    orgId: 'wmgj',
    idempotencyKey: signedIdempotencyKey
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
      'X-WMGJ-Idempotency-Key': signedIdempotencyKey
    }
  });
  var code = response.getResponseCode();
  var parsed = wmgjFirestoreParseJson_(response.getContentText());
  if (code === 403 && parsed && parsed.code === 'SIGNED_HEADER_BODY_MISMATCH') return true;
  if (code === 400 && parsed && parsed.code === 'VALIDATION_ERROR') {
    throw new Error('RC11_EVENTO_REJEITADO_PELA_POLITICA:' + event.entityType);
  }
  if (code === 401) throw new Error('RC11_HMAC_INVALIDO');
  if (code === 503) throw new Error('RC11_KEYRING_INVALIDO');
  throw new Error('RC11_HMAC_PROBE_INESPERADO:HTTP_' + code + ':' + String(response.getContentText() || '').slice(0, 200));
}

function auroraRc11ValidarHmacExistente(sampleContract, expectedKeyId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('RC11_PREFLIGHT_EM_EXECUCAO');
  try {
    var cfg = wmgjFirestoreConfig_();
    if (!cfg.dryRun) throw new Error('RC11_DRY_RUN_OBRIGATORIO');
    if (!auroraRc11IngestUrlValida_(cfg.url)) throw new Error('RC11_INGEST_URL_INVALIDA');
    if (!cfg.keyId || !wmgjFirestoreHmacSecretValido_(cfg.secret) || cfg.orgId !== 'wmgj') {
      throw new Error('RC11_HMAC_EXISTENTE_AUSENTE');
    }
    expectedKeyId = String(expectedKeyId || '').trim();
    if (!expectedKeyId || cfg.keyId !== expectedKeyId) throw new Error('RC11_KEY_ID_DIVERGENTE');

    var pair = auroraRc11EventosDoContrato_(sampleContract);
    auroraRc11ValidarEventoSemEscrita_(pair.invoice, cfg);
    auroraRc11ValidarEventoSemEscrita_(pair.bank, cfg);
    return {
      ok: true,
      authenticated: true,
      policyAccepted: true,
      noWrite: true,
      eventsValidated: 2,
      pairBindingSha256: pair.evidence.pairBindingSha256,
      dryRun: true,
      sourceMutation: false
    };
  } finally {
    lock.releaseLock();
  }
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
  var match = null;
  for (var i = 0; i < display.length; i++) {
    var record = wmgjFirestoreRowObject_(headers, display[i]);
    if (predicate(record)) {
      if (match) throw new Error('RC11_MULTIPLAS_LINHAS_ENCONTRADAS:' + sheetName);
      match = { ss: ss, sheet: sheet, headers: headers, map: auroraRc11HeaderMap_(headers), display: display[i], raw: raw[i], rowNumber: i + 2, record: record };
    }
  }
  if (match) return match;
  throw new Error('RC11_LINHA_NAO_ENCONTRADA:' + sheetName);
}

function auroraRc11LerLinhaExplicita_(sheetName, rowNumber) {
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 2) throw new Error('RC11_LINHA_EXPLICITA_INVALIDA:' + sheetName);
  var ss = getPlanilha();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < rowNumber) throw new Error('RC11_LINHA_EXPLICITA_AUSENTE:' + sheetName + ':' + rowNumber);
  var width = sheet.getLastColumn();
  if (!Number.isSafeInteger(width) || width < 1) throw new Error('RC11_ABA_SEM_COLUNAS:' + sheetName);
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var blocked = wmgjFirestoreClinicalHeaders_(headers);
  if (blocked.length) throw new Error('RC11_CABECALHO_BLOQUEADO:' + sheetName + ':' + blocked.join(','));
  var range = sheet.getRange(rowNumber, 1, 1, width);
  var display = range.getDisplayValues()[0];
  var raw = range.getValues()[0];
  return {
    ss: ss,
    sheet: sheet,
    headers: headers,
    map: auroraRc11HeaderMap_(headers),
    display: display,
    raw: raw,
    rowNumber: rowNumber,
    record: wmgjFirestoreRowObject_(headers, display)
  };
}

function auroraRc11InvoiceRecordValido_(record) {
  return String(record.competencia_assistencial || '') === AURORA_RC11_SAMPLE_COMPETENCE &&
    String(record.numero_nf || '') === '8' &&
    auroraRc11Normalizar_(record.status_extracao).indexOf('VALIDA') === 0;
}

function auroraRc11BankRecordValido_(record) {
  return String(record.competencia_assistencial_relacionada || '') === AURORA_RC11_SAMPLE_COMPETENCE &&
    auroraRc11Normalizar_(record.subcategoria) === 'RECEBIMENTO_NFS_E' &&
    auroraRc11Normalizar_(record.status_conciliacao).indexOf('CONCILIADO') === 0 &&
    String(record.credito || '').trim() !== '';
}

function auroraRc11InvoiceEvent_(sourceRow) {
  var row = sourceRow === undefined
    ? auroraRc11BuscarLinha_(AURORA_RC11_INVOICE_SHEET, auroraRc11InvoiceRecordValido_)
    : auroraRc11LerLinhaExplicita_(AURORA_RC11_INVOICE_SHEET, sourceRow);
  if (!auroraRc11InvoiceRecordValido_(row.record)) throw new Error('RC11_NF8_LINHA_EXPLICITA_DIVERGENTE');
  var valueIndex = row.map.valor_servico;
  if (valueIndex === undefined) throw new Error('RC11_VALOR_SERVICO_AUSENTE');
  var cents = wmgjFirestoreBrlToCents_(row.raw[valueIndex], row.display[valueIndex]);
  if (cents !== AURORA_RC11_AMOUNT_CENTS) throw new Error('RC11_NF8_VALOR_INESPERADO');
  var rowHash = wmgjFirestoreHashString_(JSON.stringify(wmgjFirestoreRowObject_(row.headers, row.display)));
  var chave = String(row.record.chave_acesso || '').trim();
  if (!chave) throw new Error('RC11_NF8_CHAVE_AUSENTE');
  return {
    schemaVersion: 1,
    eventId: Utilities.getUuid(),
    eventType: 'ENTITY_UPSERT',
    orgId: 'wmgj',
    occurredAt: new Date().toISOString(),
    // Namespace e versão próprios evitam colisão semântica com o backfill
    // genérico da mesma linha-fonte.
    sourceVersion: 2,
    idempotencyKey: ['wmgj','AURORA_RC11_V2','SHEETS',row.ss.getId(),AURORA_RC11_INVOICE_SHEET,row.rowNumber,rowHash].join(':'),
    entityType: 'invoice',
    entityKey: AURORA_RC11_INVOICE_SHEET + ':' + chave,
    actor: { type: 'SYSTEM', id: wmgjFirestoreActorId_(), source: 'AURORA_RC11_WMGJ' },
    source: {
      system: 'SHEETS',
      sourceId: [row.ss.getId(),AURORA_RC11_INVOICE_SHEET,row.rowNumber].join(':'),
      parentId: row.ss.getId(),
      contentHash: rowHash,
      hashMethod: 'row_sha256'
    },
    workflowState: 'VALIDATED',
    reviewState: 'NOT_REQUIRED',
    riskLevel: 'LOW',
    sensitivity: 'RESTRICTED',
    competence: AURORA_RC11_SAMPLE_COMPETENCE,
    documentType: AURORA_RC11_INVOICE_SHEET,
    record: {
      invoiceNumber: '8',
      totalCents: cents,
      reconciliationStatus: 'RECONCILED_SOURCE_EVIDENCE'
    },
    metadata: { rc11Sample: true, sourceSheet: AURORA_RC11_INVOICE_SHEET, sourceRow: row.rowNumber, nonDestructive: true }
  };
}

function auroraRc11BankEvent_(invoiceEntityKey, sourceRow) {
  var linkedInvoiceKey = String(invoiceEntityKey || '').trim();
  if (!linkedInvoiceKey) throw new Error('RC11_INVOICE_ENTITY_KEY_AUSENTE');
  var invoiceEntityId = wmgjFirestoreHashString_('invoice:' + linkedInvoiceKey).slice(0, 48);
  if (!/^[a-f0-9]{48}$/.test(invoiceEntityId)) throw new Error('RC11_INVOICE_ENTITY_ID_INVALIDO');
  var row = sourceRow === undefined
    ? auroraRc11BuscarLinha_(AURORA_RC11_BANK_SHEET, auroraRc11BankRecordValido_)
    : auroraRc11LerLinhaExplicita_(AURORA_RC11_BANK_SHEET, sourceRow);
  if (!auroraRc11BankRecordValido_(row.record)) throw new Error('RC11_BANCO_LINHA_EXPLICITA_DIVERGENTE');
  var creditIndex = row.map.credito;
  if (creditIndex === undefined) throw new Error('RC11_CREDITO_AUSENTE');
  var cents = wmgjFirestoreBrlToCents_(row.raw[creditIndex], row.display[creditIndex]);
  if (cents !== AURORA_RC11_AMOUNT_CENTS) throw new Error('RC11_CREDITO_VALOR_INESPERADO');
  var rowHash = wmgjFirestoreHashString_(JSON.stringify(wmgjFirestoreRowObject_(row.headers, row.display)));
  return {
    schemaVersion: 1,
    eventId: Utilities.getUuid(),
    eventType: 'ENTITY_UPSERT',
    orgId: 'wmgj',
    occurredAt: new Date().toISOString(),
    sourceVersion: 2,
    idempotencyKey: ['wmgj','AURORA_RC11_V2','SHEETS',row.ss.getId(),AURORA_RC11_BANK_SHEET,row.rowNumber,rowHash].join(':'),
    entityType: 'bankTransaction',
    // Usa a mesma identidade canônica do backfill. O documento da amostra não
    // pode divergir apenas porque percorreu o caminho controlado RC1.1.
    entityKey: wmgjFirestoreEntityKey_(AURORA_RC11_BANK_SHEET, row.record, row.rowNumber),
    actor: { type: 'SYSTEM', id: wmgjFirestoreActorId_(), source: 'AURORA_RC11_WMGJ' },
    source: {
      system: 'SHEETS',
      sourceId: [row.ss.getId(),AURORA_RC11_BANK_SHEET,row.rowNumber].join(':'),
      parentId: row.ss.getId(),
      contentHash: rowHash,
      hashMethod: 'row_sha256'
    },
    workflowState: 'VALIDATED',
    reviewState: 'NOT_REQUIRED',
    riskLevel: 'LOW',
    sensitivity: 'RESTRICTED',
    competence: AURORA_RC11_SAMPLE_COMPETENCE,
    documentType: AURORA_RC11_BANK_SHEET,
    record: {
      status: 'RECONCILED',
      amountCents: cents,
      liquidatedAmountCents: cents,
      transactionKind: 'RECEIPT',
      invoiceEntityId: invoiceEntityId
    },
    metadata: { rc11Sample: true, sourceSheet: AURORA_RC11_BANK_SHEET, sourceRow: row.rowNumber, nonDestructive: true }
  };
}

function auroraRc11ChavesExatas_(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  var actual = Object.keys(value).sort();
  expected = expected.slice().sort();
  if (actual.length !== expected.length) return false;
  for (var i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}

function auroraRc11HexIgual_(left, right) {
  left = String(left || '');
  right = String(right || '');
  if (left.length !== right.length) return false;
  var difference = 0;
  for (var i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function auroraRc11CanonicalVinculoPar_(sampleContract) {
  sampleContract = sampleContract || {};
  var invoice = sampleContract.invoice || {};
  var bank = sampleContract.bank || {};
  return [
    AURORA_RC11_PAIR_BINDING_VERSION,
    String(sampleContract.pairContractVersion),
    'wmgj',
    AURORA_RC11_SAMPLE_COMPETENCE,
    String(sampleContract.invoiceNumber),
    String(sampleContract.expectedPairCount),
    String(sampleContract.sourceParentSha256 || ''),
    AURORA_RC11_INVOICE_SHEET,
    String(invoice.sourceRow),
    String(invoice.contentHash || ''),
    String(sampleContract.invoiceIdempotencySha256 || ''),
    String(AURORA_RC11_AMOUNT_CENTS),
    AURORA_RC11_BANK_SHEET,
    String(bank.sourceRow),
    String(bank.contentHash || ''),
    String(sampleContract.bankIdempotencySha256 || ''),
    String(AURORA_RC11_AMOUNT_CENTS)
  ].join('\n');
}

function auroraRc11ValidarContratoPar_(sampleContract) {
  var topLevelKeys = [
    'pairContractVersion',
    'invoiceNumber',
    'expectedPairCount',
    'sourceParentSha256',
    'invoice',
    'bank',
    'invoiceIdempotencySha256',
    'bankIdempotencySha256',
    'pairBindingSha256',
    'pairEvidenceAttested'
  ];
  if (!auroraRc11ChavesExatas_(sampleContract, topLevelKeys)) throw new Error('RC11_CONTRATO_PAR_FECHADO_INVALIDO');
  if (!auroraRc11ChavesExatas_(sampleContract.invoice, ['sourceRow', 'contentHash'])) throw new Error('RC11_CONTRATO_INVOICE_FECHADO_INVALIDO');
  if (!auroraRc11ChavesExatas_(sampleContract.bank, ['sourceRow', 'contentHash'])) throw new Error('RC11_CONTRATO_BANK_FECHADO_INVALIDO');
  if (
    sampleContract.pairContractVersion !== AURORA_RC11_PAIR_CONTRACT_VERSION ||
    sampleContract.invoiceNumber !== '8' ||
    sampleContract.expectedPairCount !== 2 ||
    sampleContract.pairEvidenceAttested !== true
  ) throw new Error('RC11_CONTRATO_PAR_FIXO_DIVERGENTE');
  if (
    !Number.isSafeInteger(sampleContract.invoice.sourceRow) || sampleContract.invoice.sourceRow < 2 ||
    !Number.isSafeInteger(sampleContract.bank.sourceRow) || sampleContract.bank.sourceRow < 2
  ) throw new Error('RC11_CONTRATO_LINHA_INVALIDA');
  var hashes = [
    sampleContract.sourceParentSha256,
    sampleContract.invoice.contentHash,
    sampleContract.bank.contentHash,
    sampleContract.invoiceIdempotencySha256,
    sampleContract.bankIdempotencySha256,
    sampleContract.pairBindingSha256
  ];
  for (var i = 0; i < hashes.length; i++) {
    if (!/^[a-f0-9]{64}$/.test(String(hashes[i] || ''))) throw new Error('RC11_CONTRATO_HASH_INVALIDO');
  }
  var expectedBinding = wmgjFirestoreHashString_(auroraRc11CanonicalVinculoPar_(sampleContract));
  if (!auroraRc11HexIgual_(expectedBinding, sampleContract.pairBindingSha256)) throw new Error('RC11_PAIR_BINDING_INVALIDO');
  return sampleContract;
}

function auroraRc11ContratoParDosEventos_(invoice, bank) {
  if (
    !invoice || !bank ||
    !invoice.eventId || !bank.eventId ||
    !invoice.idempotencyKey || !bank.idempotencyKey ||
    invoice.idempotencyKey === bank.idempotencyKey ||
    !invoice.entityKey || !bank.entityKey ||
    invoice.orgId !== 'wmgj' || bank.orgId !== 'wmgj' ||
    invoice.entityType !== 'invoice' || bank.entityType !== 'bankTransaction' ||
    invoice.competence !== AURORA_RC11_SAMPLE_COMPETENCE || bank.competence !== AURORA_RC11_SAMPLE_COMPETENCE ||
    !invoice.source || !bank.source || !invoice.metadata || !bank.metadata ||
    !invoice.source.parentId || invoice.source.parentId !== bank.source.parentId ||
    invoice.metadata.sourceSheet !== AURORA_RC11_INVOICE_SHEET ||
    bank.metadata.sourceSheet !== AURORA_RC11_BANK_SHEET ||
    String(invoice.record && invoice.record.invoiceNumber || '') !== '8' ||
    invoice.record.totalCents !== AURORA_RC11_AMOUNT_CENTS ||
    bank.record.liquidatedAmountCents !== AURORA_RC11_AMOUNT_CENTS ||
    bank.record.amountCents !== AURORA_RC11_AMOUNT_CENTS ||
    bank.record.transactionKind !== 'RECEIPT' ||
    bank.record.invoiceEntityId !== wmgjFirestoreHashString_('invoice:' + invoice.entityKey).slice(0, 48)
  ) throw new Error('RC11_PAR_EVIDENCIA_INVALIDO');
  var contract = {
    pairContractVersion: AURORA_RC11_PAIR_CONTRACT_VERSION,
    invoiceNumber: '8',
    expectedPairCount: 2,
    sourceParentSha256: wmgjFirestoreHashString_(invoice.source.parentId),
    invoice: {
      sourceRow: invoice.metadata.sourceRow,
      contentHash: invoice.source.contentHash
    },
    bank: {
      sourceRow: bank.metadata.sourceRow,
      contentHash: bank.source.contentHash
    },
    invoiceIdempotencySha256: wmgjFirestoreHashString_(invoice.idempotencyKey),
    bankIdempotencySha256: wmgjFirestoreHashString_(bank.idempotencyKey),
    pairBindingSha256: '',
    pairEvidenceAttested: true
  };
  if (
    !Number.isSafeInteger(contract.invoice.sourceRow) ||
    !Number.isSafeInteger(contract.bank.sourceRow) ||
    !/^[a-f0-9]{64}$/.test(String(contract.invoice.contentHash || '')) ||
    !/^[a-f0-9]{64}$/.test(String(contract.bank.contentHash || ''))
  ) throw new Error('RC11_PAR_EVIDENCIA_FONTE_INVALIDO');
  contract.pairBindingSha256 = wmgjFirestoreHashString_(auroraRc11CanonicalVinculoPar_(contract));
  return auroraRc11ValidarContratoPar_(contract);
}

function auroraRc11EventosDoContrato_(sampleContract) {
  auroraRc11ValidarContratoPar_(sampleContract);
  var invoice = auroraRc11InvoiceEvent_(sampleContract.invoice.sourceRow);
  var bank = auroraRc11BankEvent_(invoice.entityKey, sampleContract.bank.sourceRow);
  var evidence = auroraRc11ContratoParDosEventos_(invoice, bank);
  if (!auroraRc11HexIgual_(evidence.pairBindingSha256, sampleContract.pairBindingSha256)) {
    throw new Error('RC11_EVIDENCIA_FONTE_DIVERGENTE');
  }
  return { invoice: invoice, bank: bank, evidence: evidence };
}

function auroraRc11InspecionarParCandidato(invoiceRow, bankRow) {
  var invoice = auroraRc11InvoiceEvent_(invoiceRow);
  var bank = auroraRc11BankEvent_(invoice.entityKey, bankRow);
  return {
    ok: true,
    sampleContract: auroraRc11ContratoParDosEventos_(invoice, bank),
    sourceMutation: false
  };
}

function auroraRc11ResumoEventos_(invoice, bank, evidence) {
  var summary = {
    ok: true,
    competence: AURORA_RC11_SAMPLE_COMPETENCE,
    invoiceCents: invoice.record.totalCents,
    receivedCents: bank.record.liquidatedAmountCents,
    differenceCents: invoice.record.totalCents - bank.record.liquidatedAmountCents,
    invoiceSourceHash: invoice.source.contentHash,
    bankSourceHash: bank.source.contentHash,
    invoiceEntityId: bank.record.invoiceEntityId,
    sourceMutation: false
  };
  if (evidence) summary.pairBindingSha256 = evidence.pairBindingSha256;
  return summary;
}

function auroraRc11ResumoFonte_() {
  var invoice = auroraRc11InvoiceEvent_();
  var bank = auroraRc11BankEvent_(invoice.entityKey);
  return auroraRc11ResumoEventos_(invoice, bank);
}

function auroraRc11DryRunAmostra(sampleContract, expectedKeyId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('RC11_DRY_RUN_EM_EXECUCAO');
  try {
    var cfg = wmgjFirestoreConfig_();
    if (!cfg.dryRun) throw new Error('RC11_DRY_RUN_OBRIGATORIO');
    if (!auroraRc11IngestUrlValida_(cfg.url) || cfg.orgId !== 'wmgj' || !wmgjFirestoreHmacSecretValido_(cfg.secret)) {
      throw new Error('RC11_CONFIG_INCOMPLETA');
    }
    expectedKeyId = String(expectedKeyId || '').trim();
    if (!expectedKeyId || cfg.keyId !== expectedKeyId) throw new Error('RC11_KEY_ID_DIVERGENTE');
    var pair = auroraRc11EventosDoContrato_(sampleContract);
    var expected = auroraRc11ResumoEventos_(pair.invoice, pair.bank, pair.evidence);
    var invoiceResult = wmgjFirestoreEnviarEvento_(pair.invoice);
    var bankResult = wmgjFirestoreEnviarEvento_(pair.bank);
    return {
      ok: invoiceResult.ok === true && bankResult.ok === true,
      dryRun: true,
      expected: expected,
      sampleContract: pair.evidence,
      planned: 2,
      sourceMutation: false
    };
  } finally {
    lock.releaseLock();
  }
}

function auroraRc11CanonicalAutorizacao_(expectedUrl, expectedKeyId, requestSha, expiresAt, pairBindingSha256) {
  return [
    AURORA_RC11_AUTH_VERSION,
    'wmgj',
    AURORA_RC11_SAMPLE_COMPETENCE,
    auroraRc11IngestUrlCanonica_(expectedUrl),
    String(expectedKeyId || '').trim(),
    String(requestSha || '').trim(),
    String(expiresAt),
    String(pairBindingSha256 || '')
  ].join('\n');
}

function auroraRc11ValidarAutorizacao_(cfg, expectedUrl, expectedKeyId, requestSha, expiresAt, authorizationHmac, sampleContract) {
  auroraRc11ValidarContratoPar_(sampleContract);
  var normalizedUrl = auroraRc11IngestUrlCanonica_(expectedUrl);
  var configuredUrl = auroraRc11IngestUrlCanonica_(cfg.url);
  expectedKeyId = String(expectedKeyId || '').trim();
  requestSha = String(requestSha || '').trim();
  var rawExpiresAt = String(expiresAt === undefined || expiresAt === null ? '' : expiresAt).trim();
  authorizationHmac = String(authorizationHmac || '').trim();
  if (cfg.dryRun !== true) throw new Error('RC11_GLOBAL_DRY_RUN_OBRIGATORIO');
  if (cfg.orgId !== 'wmgj' || !cfg.keyId || !wmgjFirestoreHmacSecretValido_(cfg.secret)) {
    throw new Error('RC11_CONFIG_INCOMPLETA');
  }
  if (configuredUrl !== normalizedUrl) throw new Error('RC11_INGEST_URL_DIVERGENTE');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(expectedKeyId) || cfg.keyId !== expectedKeyId) {
    throw new Error('RC11_KEY_ID_DIVERGENTE');
  }
  if (!/^[a-f0-9]{40}$/.test(requestSha)) throw new Error('RC11_REQUEST_SHA_INVALIDO');
  if (!/^\d{10,}$/.test(rawExpiresAt)) throw new Error('RC11_AUTORIZACAO_EXPIRACAO_INVALIDA');
  var expiresAtSeconds = Number(rawExpiresAt);
  var nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAtSeconds) || String(expiresAtSeconds) !== rawExpiresAt) {
    throw new Error('RC11_AUTORIZACAO_EXPIRACAO_INVALIDA');
  }
  if (expiresAtSeconds <= nowSeconds) throw new Error('RC11_AUTORIZACAO_EXPIRADA');
  if (expiresAtSeconds > nowSeconds + 900) throw new Error('RC11_AUTORIZACAO_TTL_INVALIDO');
  if (!/^[a-f0-9]{64}$/.test(authorizationHmac)) throw new Error('RC11_AUTORIZACAO_HMAC_INVALIDO');
  var canonical = auroraRc11CanonicalAutorizacao_(
    normalizedUrl,
    expectedKeyId,
    requestSha,
    rawExpiresAt,
    sampleContract.pairBindingSha256
  );
  var expectedHmac = wmgjFirestoreHmacHex_(canonical, cfg.secret);
  if (!auroraRc11HexIgual_(expectedHmac, authorizationHmac)) throw new Error('RC11_AUTORIZACAO_HMAC_INVALIDO');
  return {
    expectedUrl: normalizedUrl,
    expectedKeyId: expectedKeyId,
    requestSha: requestSha,
    expiresAt: expiresAtSeconds,
    pairBindingSha256: sampleContract.pairBindingSha256
  };
}

function auroraRc11ReceiptKey_(requestSha, pairBindingSha256) {
  return AURORA_RC11_RECEIPT_PREFIX + wmgjFirestoreHashString_(String(requestSha) + String(pairBindingSha256));
}

function auroraRc11ReceiptPayload_(state, authorization, extra) {
  var payload = {
    receiptVersion: 1,
    state: state,
    requestSha: authorization.requestSha,
    pairBindingSha256: authorization.pairBindingSha256,
    expectedKeyId: authorization.expectedKeyId,
    expiresAt: authorization.expiresAt,
    atomic: false,
    updatedAt: new Date().toISOString()
  };
  extra = extra || {};
  Object.keys(extra).forEach(function(key) { payload[key] = extra[key]; });
  return JSON.stringify(payload);
}

function auroraRc11ResultadoEnvioValido_(result) {
  return !!(
    result && result.ok === true && result.entityId &&
    ((result.accepted === true && result.duplicate !== true) ||
      (result.duplicate === true && result.accepted !== true))
  );
}

function auroraRc11EnviarAmostraReal(confirmacao, expectedUrl, expectedKeyId, requestSha, expiresAt, authorizationHmac, sampleContract) {
  if (String(confirmacao || '') !== AURORA_RC11_CONFIRMATION) throw new Error('RC11_CONFIRMACAO_INVALIDA');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('RC11_ONE_SHOT_EM_EXECUCAO');
  var receiptClaimed = false;
  var receiptKey = '';
  var props = null;
  var authorization = null;
  try {
    var cfg = wmgjFirestoreConfig_();
    authorization = auroraRc11ValidarAutorizacao_(
      cfg,
      expectedUrl,
      expectedKeyId,
      requestSha,
      expiresAt,
      authorizationHmac,
      sampleContract
    );
    props = PropertiesService.getScriptProperties();
    receiptKey = auroraRc11ReceiptKey_(authorization.requestSha, authorization.pairBindingSha256);
    var existingReceipt = props.getProperty(receiptKey);
    if (existingReceipt !== null && existingReceipt !== undefined) throw new Error('RC11_REPLAY_BLOQUEADO');

    // A fonte é lida uma única vez. O resumo e a evidência retornados ficam
    // congelados antes do primeiro POST e são vinculados ao contrato assinado.
    var pair = auroraRc11EventosDoContrato_(sampleContract);
    var expected = auroraRc11ResumoEventos_(pair.invoice, pair.bank, pair.evidence);
    var oneShotCfg = {
      url: authorization.expectedUrl,
      keyId: authorization.expectedKeyId,
      secret: cfg.secret,
      orgId: 'wmgj',
      dryRun: false,
      maxRows: 2,
      ephemeralWrite: true
    };
    props.setProperty(receiptKey, auroraRc11ReceiptPayload_('IN_PROGRESS', authorization, {
      startedAt: new Date().toISOString()
    }));
    receiptClaimed = true;

    var pairResult = wmgjFirestoreEnviarParRc11_(
      pair.invoice,
      pair.bank,
      oneShotCfg,
      WMGJ_FIRESTORE_RC11_EPHEMERAL_CAPABILITY_
    );
    var invoiceResult = pairResult && pairResult.invoiceResult;
    var bankResult = pairResult && pairResult.bankResult;
    if (!auroraRc11ResultadoEnvioValido_(invoiceResult) || !auroraRc11ResultadoEnvioValido_(bankResult)) {
      throw new Error('RC11_RESULTADO_PAR_INVALIDO');
    }
    var globalDryRun = wmgjFirestoreConfig_().dryRun;
    if (globalDryRun !== true) throw new Error('RC11_GLOBAL_DRY_RUN_ALTERADO');
    props.setProperty(receiptKey, auroraRc11ReceiptPayload_('CONSUMED', authorization, {
      completedAt: new Date().toISOString(),
      invoiceEntityId: invoiceResult.entityId,
      bankEntityId: bankResult.entityId
    }));
    var receiptSha256 = receiptKey.slice(AURORA_RC11_RECEIPT_PREFIX.length);
    return {
      ok: true,
      competence: AURORA_RC11_SAMPLE_COMPETENCE,
      sent: Number(invoiceResult.accepted === true) + Number(bankResult.accepted === true),
      duplicates: Number(invoiceResult.duplicate === true) + Number(bankResult.duplicate === true),
      invoiceEntityId: invoiceResult.entityId || '',
      bankEntityId: bankResult.entityId || '',
      expected: expected,
      sampleContract: pair.evidence,
      pairBindingSha256: pair.evidence.pairBindingSha256,
      pairEvidenceAttested: true,
      receiptSha256: receiptSha256,
      receiptState: 'CONSUMED',
      sourceMutation: false,
      globalDryRun: globalDryRun,
      ephemeralWrite: true,
      oneShot: true,
      atomic: false
    };
  } catch (error) {
    if (receiptClaimed && props && receiptKey && authorization) {
      var errorCode = String(error && error.message || error || 'RC11_LIVE_FAILURE').split(':')[0].slice(0, 128);
      try {
        props.setProperty(receiptKey, auroraRc11ReceiptPayload_('FAILED_REQUIRES_NEW_REQUEST', authorization, {
          failedAt: new Date().toISOString(),
          errorCode: errorCode
        }));
      } catch (receiptError) {
        throw new Error('RC11_RECEIPT_FAILURE_PERSISTENCE:' + errorCode);
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}
