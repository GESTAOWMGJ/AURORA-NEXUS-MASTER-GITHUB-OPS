/**
 * Backfill incremental WMGJ → Firestore.
 * Não apaga, não reordena e não altera linhas da planilha.
 * Checkpoint só avança quando DRY_RUN=false e o endpoint aceita/identifica duplicata.
 */

var WMGJ_FIRESTORE_MIGRATION_VERSION = 'v1.2.0-structured-financial';
var WMGJ_FIRESTORE_MONEY_NORMALIZATION_VERSION = 'brl-cents-v1';

function wmgjFirestoreMigrationMap_() {
  return {
    '01_CADASTRO_ARQUIVOS': { entityType: 'sourceDocument', sensitivity: 'RESTRICTED' },
    '02_PRODUTIVIDADE_MENSAL': { entityType: 'productivityRecord', sensitivity: 'RESTRICTED' },
    '03_PRODUTIVIDADE_MEDICO': { entityType: 'productivityRecord', sensitivity: 'RESTRICTED' },
    '04_CENTRO_CUSTOS': {
      entityType: 'financialEntry', sensitivity: 'RESTRICTED',
      moneyFields: { amountCents: ['valor', 'valor_total', 'custo', 'despesa'] }
    },
    '05_FINANCEIRO_MENSAL': {
      entityType: 'financialEntry', sensitivity: 'RESTRICTED', financialAdapter: 'MONTHLY_SUMMARY',
      moneyFields: {
        grossRevenueCents: ['receita_bruta_nfs', 'receita_bruta'], receivedAmountCents: ['recebido_conciliado', 'recebido', 'valor_recebido'],
        outstandingAmountCents: ['em_aberto', 'valor_em_aberto'], expenseAmountCents: ['despesa', 'despesas'],
        resultAmountCents: ['resultado']
      }
    },
    '06_NFS_E': {
      entityType: 'invoice', sensitivity: 'RESTRICTED', financialAdapter: 'INVOICE',
      moneyFields: { totalCents: ['valor_servico', 'valor_total', 'valor_nf', 'valor_nota', 'valor_nfs_e', 'valor_nfse', 'valor'],
        netAmountCents: ['valor_liquido'], taxAmountCents: ['iss_apurado'], receivableCents: ['saldo_receber_comprovado'] }
    },
    // Extraction and monthly aggregation are evidence, never a second bank ledger.
    '18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS': {
      entityType: 'sourceDocument', sensitivity: 'RESTRICTED', financialAdapter: 'EXTRACTED_MOVEMENT',
      moneyFields: { creditCents: ['credito'], debitCents: ['debito'], extractedAmountCents: ['valor'] }
    },
    '19_RESUMO_FINANCEIRO_MENSAL': {
      entityType: 'sourceDocument', sensitivity: 'RESTRICTED', financialAdapter: 'CASH_SUMMARY',
      moneyFields: { creditCents: ['total_creditos'], debitCents: ['total_debitos'], resultAmountCents: ['resultado_liquido'], reviewAmountCents: ['valor_indefinido'] }
    },
    '07_ESCALA': { entityType: 'shift', sensitivity: 'RESTRICTED' },
    '07_IMPOSTOS': {
      entityType: 'taxObligation', sensitivity: 'RESTRICTED',
      moneyFields: { amountCents: ['valor', 'valor_total', 'valor_imposto'] }
    },
    '08_EXTRATOS_BRADESCO': {
      entityType: 'bankTransaction', sensitivity: 'RESTRICTED',
      bankStatementAdapter: true,
      moneyFields: {
        amountCents: ['valor', 'valor_lancamento', 'valor_transacao'],
        liquidatedAmountCents: ['valor_liquidado', 'valor_conciliado']
      }
    },
    '08_CONTRATOS_E_ATAS': { entityType: 'contract', sensitivity: 'RESTRICTED' },
    '13_CONTROLE_PIPELINE': { entityType: 'runtimeCheckpoint', sensitivity: 'INTERNAL' },
    '14_MEMORIA_BASE_DOCUMENTOS': { entityType: 'sourceDocument', sensitivity: 'RESTRICTED' },
    '15_FILA_PROCESSAMENTO': { entityType: 'runtimeCheckpoint', sensitivity: 'INTERNAL' },
    '21_GMAIL_INDEXACAO_FATURAMENTO': { entityType: 'sourceDocument', sensitivity: 'RESTRICTED' },
    '42_CHECKPOINT_OPERACIONAL': { entityType: 'runtimeCheckpoint', sensitivity: 'INTERNAL' }
  };
}

function wmgjFirestoreMigracaoDryRun(limitPerSheet) {
  var cfg = wmgjFirestoreConfig_();
  var ss = getPlanilha();
  var mapping = wmgjFirestoreMigrationMap_();
  var limit = Math.max(1, Math.min(Number(limitPerSheet || cfg.maxRows), cfg.maxRows));
  var result = {
    ok: true,
    version: WMGJ_FIRESTORE_MIGRATION_VERSION,
    dryRun: cfg.dryRun,
    sheets: {},
    startedAt: new Date().toISOString()
  };

  Object.keys(mapping).forEach(function(sheetName) {
    result.sheets[sheetName] = wmgjFirestoreMigrarAba_(ss, sheetName, mapping[sheetName], limit, cfg);
    if (result.sheets[sheetName].errors > 0) result.ok = false;
  });

  result.finishedAt = new Date().toISOString();
  wmgjFirestoreLog_('MIGRATION_RUN', result.ok ? 'OK' : 'ALERTA', result);
  return result;
}

function wmgjFirestoreMigrarAba_(ss, sheetName, config, limit, bridgeConfig) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, skipped: true, reason: 'ABA_AUSENTE_OU_VAZIA', sent: 0, errors: 0 };
  }

  var props = PropertiesService.getScriptProperties();
  var checkpointKey = 'WMGJ_FS_MIG_' + sheetName + '_ROW';
  var startRow = Math.max(2, Number(props.getProperty(checkpointKey) || 2));
  var lastRow = sheet.getLastRow();
  var revisionSweep = false;
  if (startRow > lastRow) {
    // Após concluir o backfill, reinicia uma varredura cíclica. Linhas sem
    // alteração retornam como duplicatas idempotentes; conteúdo alterado é
    // promovido pelo backend para nova revisão canônica imutável.
    startRow = 2;
    revisionSweep = true;
  }
  var rowsToRead = Math.min(limit, lastRow - startRow + 1);
  if (rowsToRead <= 0) return {
    ok: true, complete: true, sent: 0, skipped: 0, errors: 0,
    lastRow: lastRow, revisionSweep: revisionSweep
  };

  var width = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var blockedClinicalHeaders = wmgjFirestoreClinicalHeaders_(headers);
  if (blockedClinicalHeaders.length > 0) {
    var quarantineId = wmgjFirestoreHashString_([
      ss.getId(),
      sheetName,
      blockedClinicalHeaders.join(','),
      WMGJ_FIRESTORE_MIGRATION_VERSION
    ].join('|')).slice(0, 32);
    var quarantine = {
      ok: false,
      quarantined: true,
      quarantineId: quarantineId,
      reason: 'CAMPOS_CLINICOS_IDENTIFICAVEIS_BLOQUEADOS_PRIMEIRO_BACKFILL',
      sheet: sheetName,
      blockedHeaders: blockedClinicalHeaders,
      sent: 0,
      duplicates: 0,
      errors: 1,
      checkpointAdvanced: false
    };
    wmgjFirestoreLog_('MIGRATION_QUARANTINE', 'ERRO', quarantine);
    return quarantine;
  }
  var dataRange = sheet.getRange(startRow, 1, rowsToRead, width);
  var displayValues = dataRange.getDisplayValues();
  var rawValues = dataRange.getValues();
  var sent = 0;
  var duplicates = 0;
  var skipped = 0;
  var errors = 0;
  var planned = 0;
  var lastAcceptedRow = startRow - 1;
  var pendingEvents = [];
  var seenEntityKeys = Object.create(null);
  var identityConflicts = 0;

  displayValues.forEach(function(row, offset) {
    var rowNumber = startRow + offset;
    if (row.join('').trim() === '') return;

    try {
      // O hash representa exatamente os valores exibidos na fonte. Campos
      // canônicos em centavos são derivados separadamente, sem alterar a Sheet.
      var sourceRecord = wmgjFirestoreRowObject_(headers, row);
      var rowHash = wmgjFirestoreHashString_(JSON.stringify(sourceRecord));
      if (config.bankStatementAdapter && wmgjFirestoreSkipBankStatementRow_(sourceRecord)) {
        skipped++;
        lastAcceptedRow = rowNumber;
        return;
      }
      var record = config.bankStatementAdapter
        ? wmgjFirestoreBankStatementRecord_(headers, rawValues[offset], row, sourceRecord, rowHash)
        : wmgjFirestoreAddCanonicalMoney_(headers, rawValues[offset], row, sourceRecord, config.moneyFields || {});
      if (config.financialAdapter) {
        record = wmgjFirestoreFinancialRecord_(record, config, headers);
        // record is persisted in both current entities and immutable versions;
        // event metadata alone is not retained by the ingestion backend.
        record.sourceRowHash = rowHash;
      }
      // Raw row hash remains separately auditable. The materialized content hash
      // includes the adapter result so a mapping fix becomes a revision, not a
      // false duplicate. Entity identity and immutable backend history stay intact.
      var contentHash = config.financialAdapter
        ? wmgjFirestoreHashString_(JSON.stringify(record)) : rowHash;
      var entityKey = wmgjFirestoreEntityKey_(sheetName, record, rowNumber);
      var identity = config.entityType + ':' + entityKey;
      if (Object.prototype.hasOwnProperty.call(seenEntityKeys, identity)) {
        identityConflicts++;
        throw new Error('MIGRATION_ENTITY_IDENTITY_CONFLICT');
      }
      seenEntityKeys[identity] = true;
      var legacyStatus = String(
        record.status ||
        record.status_conciliacao ||
        record.reconciliation_status ||
        record.status_processamento ||
        record.status_auditoria ||
        record.workflow_state ||
        ''
      );
      var workflow = wmgjFirestoreWorkflowFromLegacy_(legacyStatus, config.entityType);
      if (config.financialAdapter) workflow = wmgjFirestoreFinancialWorkflow_(record, config);
      var occurredAt = new Date();
      var event = {
        schemaVersion: 1,
        eventId: Utilities.getUuid(),
        eventType: 'ENTITY_UPSERT',
        orgId: bridgeConfig.orgId,
        occurredAt: occurredAt.toISOString(),
        // Sheets legadas não oferecem revisão monotônica por linha. O produtor
        // envia a versão-fonte 1 e o hash do conteúdo; o backend AURORA mantém
        // a revisão canônica monotônica e imutável da entidade.
        sourceVersion: 1,
        idempotencyKey: [bridgeConfig.orgId, 'SHEETS', ss.getId(), sheetName, rowNumber, contentHash, WMGJ_FIRESTORE_MIGRATION_VERSION].join(':'),
        entityType: config.entityType,
        entityKey: entityKey,
        actor: {
          type: 'SYSTEM',
          id: wmgjFirestoreActorId_(),
          source: 'WMGJ_SHEETS_BACKFILL'
        },
        source: {
          system: 'SHEETS',
          sourceId: [ss.getId(), sheetName, rowNumber].join(':'),
          parentId: ss.getId(),
          fileName: sheetName + '!A' + rowNumber,
          contentHash: contentHash,
          hashMethod: config.financialAdapter ? 'content_sha256' : 'row_sha256'
        },
        workflowState: workflow.state,
        reviewState: workflow.review,
        riskLevel: workflow.risk,
        sensitivity: config.sensitivity,
        competence: wmgjFirestoreFindCompetence_(record),
        documentType: sheetName,
        record: record,
        metadata: {
          migrationVersion: WMGJ_FIRESTORE_MIGRATION_VERSION,
          moneyNormalizationVersion: WMGJ_FIRESTORE_MONEY_NORMALIZATION_VERSION,
          sourceSheet: sheetName,
          sourceRow: rowNumber,
          sourceRowHash: rowHash,
          nonDestructive: true
        }
      };
      pendingEvents.push({ event: event, rowNumber: rowNumber });
      planned++;
    } catch (error) {
      errors++;
      wmgjFirestoreLog_('MIGRATION_ROW', 'ERRO', {
        sheet: sheetName,
        row: rowNumber,
        error: error && error.message ? error.message : String(error)
      });
    }
  });

  // Validate the whole bounded page before its first request. Two source rows
  // must not silently overwrite one canonical entity, even at equal amounts.
  // Resolving their provenance/status is a separate reconciliation decision.
  var batchBlocked = errors > 0;
  if (!batchBlocked) pendingEvents.forEach(function(item) {
    try {
      // The supplied config governs this call, including its dry-run boundary.
      // Never reread a different global dry-run value inside the transport.
      var response = wmgjFirestoreEnviarEventoComConfig_(item.event, bridgeConfig, wmgjFirestoreLog_);
      if (bridgeConfig.dryRun) return;
      if (!response.ok || !(response.accepted || response.duplicate)) throw new Error('MIGRATION_RECEIPT_REQUIRED');
      if (response.accepted) sent++;
      if (response.duplicate) duplicates++;
      lastAcceptedRow = Math.max(lastAcceptedRow, item.rowNumber);
    } catch (error) {
      errors++;
      wmgjFirestoreLog_('MIGRATION_ROW', 'ERRO', {
        sheet: sheetName, row: item.rowNumber,
        error: error && error.message ? error.message : String(error)
      });
    }
  });

  if (!bridgeConfig.dryRun && lastAcceptedRow >= startRow && errors === 0) {
    props.setProperty(checkpointKey, String(lastAcceptedRow + 1));
  }

  return {
    ok: errors === 0,
    dryRun: bridgeConfig.dryRun,
    startRow: startRow,
    rowsRead: displayValues.length,
    planned: planned,
    sent: sent,
    duplicates: duplicates,
    skipped: skipped,
    errors: errors,
    batchBlocked: batchBlocked,
    identityConflicts: identityConflicts,
    revisionSweep: revisionSweep,
    nextRow: bridgeConfig.dryRun ? startRow : Number(props.getProperty(checkpointKey) || startRow)
  };
}

function wmgjFirestoreRowObject_(headers, row) {
  var output = {};
  headers.forEach(function(header, index) {
    var key = wmgjFirestoreNormalizeHeader_(header, index);
    var value = row[index];
    if (value !== '') output[key] = String(value).slice(0, 10000);
  });
  return output;
}

function wmgjFirestoreBrlToCents_(rawValue, displayValue) {
  if ((rawValue === '' || rawValue === null || rawValue === undefined) && String(displayValue || '').trim() === '') return null;
  var numeric;
  if (typeof rawValue === 'number') {
    if (!isFinite(rawValue)) throw new Error('MONEY_VALUE_INVALID');
    numeric = rawValue;
  } else {
    var text = String(displayValue !== undefined ? displayValue : rawValue).trim();
    if (!text) return null;
    if (/[eE]/.test(text) || /^[-+]?\d{1,3}(,\d{3})+\.\d{2}$/.test(text)) throw new Error('MONEY_FORMAT_AMBIGUOUS');
    var negativeParentheses = /^\(.*\)$/.test(text);
    text = text.replace(/^\(|\)$/g, '').replace(/R\$/gi, '').replace(/\s/g, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text) || /^-?\d+(,\d{1,2})$/.test(text)) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
      throw new Error('MONEY_FORMAT_INVALID');
    }
    numeric = Number(text);
    if (negativeParentheses) numeric = -Math.abs(numeric);
  }
  if (!isFinite(numeric)) throw new Error('MONEY_VALUE_INVALID');
  var scaled = numeric * 100;
  var cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 0.000001 || !Number.isSafeInteger(cents)) throw new Error('MONEY_PRECISION_OR_RANGE_INVALID');
  return cents;
}

function wmgjFirestoreAddCanonicalMoney_(headers, rawRow, displayRow, sourceRecord, moneyFields) {
  var output = {};
  Object.keys(sourceRecord || {}).forEach(function(key) { output[key] = sourceRecord[key]; });
  var normalizedHeaders = (headers || []).map(function(header, index) { return wmgjFirestoreNormalizeHeader_(header, index); });
  Object.keys(moneyFields || {}).forEach(function(canonicalField) {
    var candidates = moneyFields[canonicalField] || [];
    var parsed = [];
    candidates.forEach(function(candidate) {
      var index = normalizedHeaders.indexOf(candidate);
      if (index < 0) return;
      var cents = wmgjFirestoreBrlToCents_(rawRow[index], displayRow[index]);
      if (cents !== null) parsed.push(cents);
    });
    if (parsed.length === 0) return;
    for (var i = 1; i < parsed.length; i++) {
      if (parsed[i] !== parsed[0]) throw new Error('MONEY_FIELD_CONFLICT:' + canonicalField);
    }
    output[canonicalField] = parsed[0];
  });
  return output;
}

function wmgjFirestoreSkipBankStatementRow_(sourceRecord) {
  var data = String((sourceRecord || {}).data || '').trim().toUpperCase();
  var dcto = String((sourceRecord || {}).dcto || '').trim();
  var categoria = String((sourceRecord || {}).categoria || '').trim().toUpperCase();
  if (!data || data === 'DATA' || data.indexOf('BLOCO_') === 0 || data.indexOf('MÚLTIPLAS') === 0 || data.indexOf('MULTIPLAS') === 0) return true;
  if (!dcto) return true;
  return ['SALDO_INICIAL', 'SALDO_FINAL', 'SALDO_INVESTIMENTO', 'RESUMO_MENSAL', 'RESUMO_DIARIO', 'EVIDENCIA_CONCILIACAO'].indexOf(categoria) >= 0;
}

function wmgjFirestoreBankStatementRecord_(headers, rawRow, displayRow, sourceRecord, rowHash) {
  var normalizedHeaders = (headers || []).map(function(header, index) {
    return wmgjFirestoreNormalizeHeader_(header, index);
  });
  function centsFor_(name) {
    var index = normalizedHeaders.indexOf(name);
    if (index < 0) return null;
    return wmgjFirestoreBrlToCents_(rawRow[index], displayRow[index]);
  }

  var creditCents = centsFor_('credito');
  var debitCents = centsFor_('debito');
  if (creditCents !== null && debitCents !== null && creditCents !== 0 && debitCents !== 0) {
    throw new Error('BANK_CREDIT_DEBIT_CONFLICT');
  }
  var amountCents = creditCents !== null && creditCents !== 0
    ? Math.abs(creditCents)
    : (debitCents !== null ? -Math.abs(debitCents) : null);
  if (amountCents === null) throw new Error('BANK_AMOUNT_MISSING');

  var record = {
    amountCents: amountCents,
    currency: 'BRL',
    kind: amountCents >= 0 ? 'CREDIT' : 'DEBIT',
    source_row_hash: rowHash,
    classification_source: 'WMGJ_SHEETS_08_EXTRATOS_BRADESCO',
    // Identidade estável: data + documento bancário. Valor não participa
    // para que uma correção de montante gere nova versão da mesma entidade.
    transaction_id_hash: wmgjFirestoreHashString_([
      sourceRecord.data || '',
      sourceRecord.dcto || ''
    ].join('|'))
  };

  if (sourceRecord.data) record.date = String(sourceRecord.data).slice(0, 64);
  if (sourceRecord.categoria) record.category = String(sourceRecord.categoria).slice(0, 128);
  if (sourceRecord.status_conciliacao) {
    record.status = String(sourceRecord.status_conciliacao).slice(0, 128);
    record.reconciliation_status = record.status;
  }

  var competenceCandidates = [
    sourceRecord.competencia_vinculada,
    sourceRecord.competencia_assistencial_relacionada,
    sourceRecord.competencia
  ];
  for (var i = 0; i < competenceCandidates.length; i++) {
    var competence = wmgjFirestoreCompetencia_(competenceCandidates[i]);
    if (competence) {
      record.competence = competence;
      break;
    }
  }
  return record;
}

function wmgjFirestoreNormalizeHeader_(header, index) {
  var key = String(header || 'col_' + (index + 1))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'col_' + (index + 1);
}

/** Mapping only: no reconciliation, payment, closing or contract decision. */
function wmgjFirestoreFinancialRecord_(record, config, headers) {
  var output = Object.assign({}, record);
  var normalizedHeaders = headers.map(wmgjFirestoreNormalizeHeader_);
  output.financialMappingVersion = WMGJ_FIRESTORE_MIGRATION_VERSION;
  output.financialRecordRole = config.financialAdapter;
  output.fieldOrigins = {};
  Object.keys(config.moneyFields || {}).forEach(function(field) {
    var columns = config.moneyFields[field].filter(function(name) {
      return normalizedHeaders.indexOf(name) >= 0;
    });
    // Explicit null also revokes a former value under Firestore merge semantics.
    if (output[field] === undefined) output[field] = null;
    output.fieldOrigins[field] = { columns: columns, state: output[field] === null ? 'MISSING_VALUE' : 'SOURCE_REPORTED' };
  });
  if (config.financialAdapter === 'EXTRACTED_MOVEMENT' && output.extractedAmountCents !== null) {
    var direction = String(record.tipo || '').trim().toUpperCase();
    var directedField = direction === 'CREDITO' ? 'creditCents' : direction === 'DEBITO' ? 'debitCents' : null;
    if (directedField) {
      if (output.extractedAmountCents < 0) throw new Error('EXTRACTED_AMOUNT_NEGATIVE');
      if (output[directedField] !== null && output[directedField] !== output.extractedAmountCents) {
        throw new Error('MONEY_FIELD_CONFLICT:' + directedField);
      }
      output[directedField] = output.extractedAmountCents;
      output.fieldOrigins[directedField] = { columns: ['tipo', 'valor'], state: 'SOURCE_REPORTED' };
    }
  }
  output.originDocumentRef = record.link_drive || record.id_drive || null;
  output.invoiceNumber = record.numero_nf || record.nf_relacionada || null;
  output.sourceReconciliationStatus = record.status_conciliacao || record.status_extracao || record.status || null;
  output.settlementEvidenceState = 'PENDING_BANK_EVIDENCE';
  // Neither issue date, movement date nor SLA is a contractual due date.
  output.dueDate = null;
  output.dueDateEvidenceRef = null;
  output.dueDateState = 'MISSING_CONTRACT_EVIDENCE';
  output.fieldOrigins.dueDate = { columns: [], state: output.dueDateState };
  if (config.financialAdapter === 'MONTHLY_SUMMARY') {
    output.kind = 'FINANCIAL_SUMMARY';
    output.status = 'REPORTED_SUMMARY';
    output.aggregationRole = 'CONTROL_ONLY';
  } else if (config.financialAdapter === 'INVOICE') {
    var state = String(record.status_extracao || '').toUpperCase();
    output.kind = 'INVOICE';
    output.status = /SUBSTITUIDA|CANCELAD|ANULAD/.test(state) ? 'SUPERSEDED' : 'ISSUED_UNRECONCILED';
    output.aggregationRole = output.status === 'SUPERSEDED' ? 'HISTORY_ONLY' : 'BILLING_ONLY';
    output.receivableState = 'PENDING_RECONCILIATION';
    // A source-reported balance remains available for audit, not a receivable
    // until its evidence is verified in the existing reconciliation workflow.
    output.reportedReceivableCents = output.receivableCents;
    output.receivableCents = null;
  } else {
    output.kind = config.financialAdapter;
    output.category = 'financial';
    output.status = 'PENDING_EVIDENCE';
    output.aggregationRole = 'CONTROL_ONLY';
    output.nativeReady = false;
    output.sourceIndependent = false;
    output.documentFragility = 'MISSING_CANONICAL_FIELDS';
  }
  return output;
}

function wmgjFirestoreFinancialWorkflow_(record, config) {
  // Status text containing VALID (e.g. INVALIDA) is not validation.
  if (config.financialAdapter === 'INVOICE' && record.status !== 'SUPERSEDED'
      && /^VALIDA(?:_|$)/.test(String(record.status_extracao || '').toUpperCase())
      && Number.isSafeInteger(record.totalCents) && record.totalCents >= 0
      && record.originDocumentRef && record.chave_acesso) {
    return { state: 'VALIDATED', review: 'NOT_REQUIRED', risk: 'LOW' };
  }
  return { state: 'PENDING_HUMAN_REVIEW', review: 'PENDING', risk: 'MEDIUM' };
}

function wmgjFirestoreClinicalHeaders_(headers) {
  var exactBlocked = {
    'data_nascimento': true,
    'nome_da_mae': true,
    'nome_mae': true,
    'cartao_sus': true,
    'cartao_nacional_saude': true,
    'medical_record': true,
    'date_of_birth': true
  };
  var blockedTokens = {
    'cpf': true,
    'cns': true,
    'paciente': true,
    'patient': true,
    'diagnostico': true,
    'diagnosis': true,
    'prontuario': true,
    'cid': true,
    'cid10': true
  };
  var blocked = [];

  (headers || []).forEach(function(header, index) {
    var key = wmgjFirestoreNormalizeHeader_(header, index);
    var tokens = key.split('_');
    var isBlocked = Boolean(exactBlocked[key]);
    for (var i = 0; i < tokens.length && !isBlocked; i++) {
      isBlocked = Boolean(blockedTokens[tokens[i]]);
    }
    if (isBlocked && blocked.indexOf(key) === -1) blocked.push(key);
  });

  return blocked.sort();
}

function wmgjFirestoreEntityKey_(sheetName, record, rowNumber) {
  // Several extracted movements can share the same originating PDF/Drive ID.
  // Their document reference is evidence, never their transaction identity.
  if (sheetName === '19_RESUMO_FINANCEIRO_MENSAL') {
    var competence = wmgjFirestoreCompetencia_(record.competencia);
    if (!competence) throw new Error('SUMMARY_COMPETENCE_REQUIRED');
    return sheetName + ':competence:' + competence;
  }
  if (sheetName === '18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS') {
    return sheetName + ':legacy-row:' + rowNumber;
  }
  var strongCandidates = [
    record.chave_acesso,
    record.id_operacao,
    record.id_origem,
    record.message_id,
    record.id_drive,
    record.transaction_id_hash
  ].filter(function(value) { return Boolean(value); });
  if (strongCandidates.length > 0) {
    return [sheetName, strongCandidates[0]].join(':');
  }
  // O hash pertence à versão/idempotência, nunca à identidade da entidade.
  // Campos fracos como número de nota/competência não garantem unicidade. Para
  // linhas legadas sem identificador forte, a posição na fonte congelada é o
  // fallback estável e evita colisões entre registros de mesma competência.
  return sheetName + ':legacy-row:' + rowNumber;
}

function wmgjFirestoreFindCompetence_(record) {
  var fields = [
    record.competence,
    record.competencia_assistencial,
    record.competencia_faturamento,
    record.competencia_nfs_e,
    record.competencia,
    record.competencia_contabil
  ];
  for (var i = 0; i < fields.length; i++) {
    var normalized = wmgjFirestoreCompetencia_(fields[i]);
    if (normalized) return normalized;
  }
  return '';
}

function wmgjFirestoreWorkflowFromLegacy_(status, entityType) {
  var s = String(status || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s.indexOf('BLOQUE') >= 0) return { state: 'BLOCKED', review: 'PENDING', risk: 'CRITICAL' };
  if (s.indexOf('ERRO') >= 0 || s.indexOf('REJEIT') >= 0) return { state: 'FAILED', review: 'PENDING', risk: 'HIGH' };
  if (s.indexOf('PENDENTE') >= 0 || s.indexOf('REVIS') >= 0 || s.indexOf('HUMAN') >= 0) return { state: 'PENDING_HUMAN_REVIEW', review: 'PENDING', risk: 'MEDIUM' };
  var isFinancialSettlement = entityType === 'bankTransaction' || entityType === 'reconciliation';
  if (isFinancialSettlement && (
    s === 'LIQUIDADO' || s === 'LIQUIDATED' ||
    s === 'CONCILIADO' || s === 'RECONCILED' ||
    s === 'MATCHED'
  )) {
    return { state: 'VALIDATED', review: 'NOT_REQUIRED', risk: 'LOW' };
  }
  if (s.indexOf('VALID') >= 0 || s.indexOf('PROCESSADO') >= 0 || s.indexOf('CONCLUID') >= 0 || s === 'OK') return { state: 'VALIDATED', review: 'NOT_REQUIRED', risk: 'LOW' };
  return { state: 'RECEIVED', review: 'PENDING', risk: 'MEDIUM' };
}
