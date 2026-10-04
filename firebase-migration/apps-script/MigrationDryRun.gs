/**
 * Backfill incremental WMGJ → Firestore.
 * Não apaga, não reordena e não altera linhas da planilha.
 * Checkpoint só avança quando DRY_RUN=false e o endpoint aceita/identifica duplicata.
 */

var WMGJ_FIRESTORE_MIGRATION_VERSION = 'v1.1.0-continuous-versioning';
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
      entityType: 'financialEntry', sensitivity: 'RESTRICTED',
      moneyFields: {
        grossRevenueCents: ['receita_bruta'], receivedAmountCents: ['recebido', 'valor_recebido'],
        outstandingAmountCents: ['em_aberto', 'valor_em_aberto'], expenseAmountCents: ['despesa', 'despesas'],
        resultAmountCents: ['resultado']
      }
    },
    '06_NFS_E': {
      entityType: 'invoice', sensitivity: 'RESTRICTED',
      moneyFields: { totalCents: ['valor_total', 'valor_nf', 'valor_nota', 'valor_nfs_e', 'valor_nfse', 'valor'] }
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
    // Após concluir o backfill, reinicia uma varredura cíclica. Linhas já
    // aceitas e sem alteração são puladas pelo estado de versão; uma mudança
    // de conteúdo recebe sourceVersion monotonicamente maior.
    startRow = 2;
    revisionSweep = true;
  }
  var rowsToRead = Math.min(limit, lastRow - startRow + 1);
  if (rowsToRead <= 0) return {
    ok: true, complete: true, sent: 0, unchanged: 0, errors: 0,
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
  var unchanged = 0;
  var errors = 0;
  var planned = 0;
  var lastAcceptedRow = startRow - 1;

  displayValues.forEach(function(row, offset) {
    var rowNumber = startRow + offset;
    if (row.join('').trim() === '') return;

    try {
      // O hash representa exatamente os valores exibidos na fonte. Campos
      // canônicos em centavos são derivados separadamente, sem alterar a Sheet.
      var sourceRecord = wmgjFirestoreRowObject_(headers, row);
      var rowHash = wmgjFirestoreHashString_(JSON.stringify(sourceRecord));
      if (config.bankStatementAdapter && wmgjFirestoreSkipBankStatementRow_(sourceRecord)) return;
      var record = config.bankStatementAdapter
        ? wmgjFirestoreBankStatementRecord_(headers, rawValues[offset], row, sourceRecord, rowHash)
        : wmgjFirestoreAddCanonicalMoney_(headers, rawValues[offset], row, sourceRecord, config.moneyFields || {});
      var entityKey = wmgjFirestoreEntityKey_(sheetName, record, rowNumber);
      var versionState = wmgjFirestoreSourceVersionState_(
        props, ss.getId(), sheetName, entityKey, rowHash
      );
      if (!versionState.changed) {
        unchanged++;
        lastAcceptedRow = rowNumber;
        return;
      }
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
      var occurredAt = new Date();
      var event = {
        schemaVersion: 1,
        eventId: Utilities.getUuid(),
        eventType: 'ENTITY_UPSERT',
        orgId: bridgeConfig.orgId,
        occurredAt: occurredAt.toISOString(),
        // A versão é monotônica por entidade de origem. O estado só avança
        // depois de aceite/duplicata confirmados pelo backend.
        sourceVersion: versionState.version,
        idempotencyKey: [bridgeConfig.orgId, 'SHEETS', ss.getId(), sheetName, rowNumber, rowHash].join(':'),
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
          contentHash: rowHash,
          hashMethod: 'row_sha256'
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
          nonDestructive: true
        }
      };
      var response = wmgjFirestoreEnviarEvento_(event);
      planned++;
      if (bridgeConfig.dryRun) return;
      if (response.accepted) sent++;
      if (response.duplicate) duplicates++;
      if (response.ok && (response.accepted || response.duplicate)) {
        wmgjFirestorePersistSourceVersionState_(props, versionState);
        lastAcceptedRow = rowNumber;
      }
    } catch (error) {
      errors++;
      wmgjFirestoreLog_('MIGRATION_ROW', 'ERRO', {
        sheet: sheetName,
        row: rowNumber,
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
    unchanged: unchanged,
    errors: errors,
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

function wmgjFirestoreSourceVersionDecision_(previousHash, previousVersion, rowHash) {
  previousHash = String(previousHash || '').trim();
  rowHash = String(rowHash || '').trim();
  var versionText = String(previousVersion || '').trim();
  if (!rowHash) throw new Error('SOURCE_VERSION_ROW_HASH_MISSING');

  if (!previousHash && !versionText) return { changed: true, version: 1 };
  var version = Number(versionText);
  if (!previousHash || !versionText || !isFinite(version) || version < 1 || Math.floor(version) !== version) {
    throw new Error('SOURCE_VERSION_STATE_INVALID');
  }
  if (previousHash === rowHash) return { changed: false, version: version };
  if (version >= Number.MAX_SAFE_INTEGER) throw new Error('SOURCE_VERSION_EXHAUSTED');
  return { changed: true, version: version + 1 };
}

function wmgjFirestoreSourceVersionState_(props, spreadsheetId, sheetName, entityKey, rowHash) {
  var identityHash = wmgjFirestoreHashString_([
    spreadsheetId || '', sheetName || '', entityKey || ''
  ].join('|')).slice(0, 40);
  var baseKey = 'WMGJ_FS_SRCV_' + identityHash;
  var previousHash = props.getProperty(baseKey + '_HASH') || '';
  var previousVersion = props.getProperty(baseKey + '_VERSION') || '';
  var decision = wmgjFirestoreSourceVersionDecision_(previousHash, previousVersion, rowHash);
  return {
    changed: decision.changed,
    version: decision.version,
    rowHash: rowHash,
    hashKey: baseKey + '_HASH',
    versionKey: baseKey + '_VERSION'
  };
}

function wmgjFirestorePersistSourceVersionState_(props, state) {
  if (!state || !state.hashKey || !state.versionKey || !state.rowHash) {
    throw new Error('SOURCE_VERSION_PERSIST_STATE_INVALID');
  }
  props.setProperties((function() {
    var values = {};
    values[state.hashKey] = String(state.rowHash);
    values[state.versionKey] = String(state.version);
    return values;
  })(), false);
}

function wmgjFirestoreNormalizeHeader_(header, index) {
  var key = String(header || 'col_' + (index + 1))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'col_' + (index + 1);
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
