import type { WmgjIngestionEvent } from "./types.js";

export const ENTITY_COLLECTIONS: Readonly<Record<string, string>> = Object.freeze({
  sourceDocument: "sourceDocuments",
  runtimeCheckpoint: "runtimeCheckpoints",
  professional: "professionals",
  shift: "shifts",
  productivityRecord: "productivityRecords",
  contract: "contracts",
  contractRule: "contractRules",
  invoice: "invoices",
  bankTransaction: "bankTransactions",
  financialEntry: "financialEntries",
  taxObligation: "taxObligations",
  reconciliation: "reconciliations",
  monthlyClosing: "monthlyClosings",
  actionItem: "actionItems",
  hospitalAccount: "hospitalAccounts",
  authorization: "authorizations",
  billingItem: "billingItems",
  gloss: "glosses",
  appeal: "appeals",
  opmeItem: "opmeItems",
  qualityIndicator: "qualityIndicators",
  auditFinding: "auditFindings",
  aiRun: "aiRuns"
});

const CRITICAL_CLOSURE_ENTITY_TYPES = new Set([
  "monthlyClosing",
  "reconciliation",
  "hospitalAccount"
]);

/**
 * A ingestão genérica é deliberadamente não clínica. A classificação enviada
 * pelo produtor é apenas um sinal; ela nunca substitui a inspeção defensiva do
 * conteúdo. As listas abaixo são estreitas de propósito para não confundir
 * campos operacionais (por exemplo, professionalId ou hospitalAccountId) com
 * identificadores de paciente.
 */
const DIRECT_CLINICAL_IDENTIFIER_TOKENS = new Set([
  "cpf",
  "cns",
  "cid",
  "cid10",
  "icd",
  "icd10",
  "prontuario"
]);

const PATIENT_CONTEXT_TOKENS = new Set([
  "beneficiario",
  "beneficiarios",
  "beneficiary",
  "beneficiaries",
  "paciente",
  "pacientes",
  "patient",
  "patients"
]);

const CLINICAL_CONTENT_TOKENS = new Set([
  "alergia",
  "alergias",
  "allergies",
  "allergy",
  "anamnese",
  "diagnoses",
  "diagnosis",
  "diagnostico",
  "diagnosticos",
  "sintoma",
  "sintomas",
  "symptom",
  "symptoms"
]);

const AGGREGATE_TOKENS = new Set([
  "average",
  "avg",
  "count",
  "counts",
  "indice",
  "index",
  "media",
  "percent",
  "percentage",
  "percentual",
  "quantity",
  "qtd",
  "ratio",
  "rate",
  "taxa",
  "total"
]);

const DIRECT_CLINICAL_KEYS = new Set([
  "birth_date",
  "cartao_nacional_de_saude",
  "cartao_nacional_saude",
  "cartao_sus",
  "carteirinha_convenio",
  "chief_complaint",
  "clinical_note",
  "data_de_nascimento",
  "data_nascimento",
  "date_of_birth",
  "evolucao_clinica",
  "health_plan_member_id",
  "medical_record",
  "medical_record_number",
  "medical_notes",
  "mother_name",
  "nome_da_mae",
  "nome_mae",
  "nota_clinica",
  "numero_carteirinha",
  "numero_do_prontuario",
  "numero_prontuario",
  "queixa_principal"
]);

const DIRECT_PERSON_IDENTIFIER_KEYS = new Set([
  "address",
  "celular",
  "email",
  "endereco",
  "first_name",
  "full_name",
  "last_name",
  "mobile",
  "name",
  "nome",
  "nome_completo",
  "passport",
  "phone",
  "rg",
  "telefone"
]);

const UNSTRUCTURED_PAYLOAD_KEYS = new Set([
  "body",
  "content",
  "conteudo",
  "description",
  "descricao",
  "message",
  "mensagem",
  "notes",
  "notas",
  "observation",
  "observacao",
  "ocr_text",
  "payload",
  "raw",
  "raw_text",
  "summary",
  "resumo",
  "text",
  "texto",
  "transcript",
  "transcricao"
]);

const TECHNICAL_IDENTIFIER_FIELDS = [
  "entityKey",
  "idempotencyKey",
  "source.sourceId",
  "source.parentId"
] as const;

// Contrato positivo do endpoint genérico. Campos fora deste vocabulário não
// entram apenas porque receberam um rótulo INTERNAL/RESTRICTED. A ampliação
// deve ocorrer por versão de schema e revisão explícita, nunca por fallback.
const NON_CLINICAL_RECORD_FIELDS = new Set([
  "active",
  "amount",
  "amount_cents",
  "authorization_ref",
  "average",
  "avg",
  "canonical_snapshot_hash",
  "canonical_snapshot_version",
  "category",
  "classification_source",
  "code",
  "competence",
  "competencia",
  "confidence",
  "count",
  "currency",
  "date",
  "data",
  "data_emissao",
  "data_vencimento",
  "despesa",
  "despesas",
  "diagnosis_rate",
  "document_fragility",
  "document_id_hash",
  "due_date",
  "em_aberto",
  "enabled",
  "end_at",
  "expense_amount_cents",
  "external_ai_used",
  "external_fetch_required",
  "extraction_complete",
  "extraction_method",
  "facility_id",
  "flow_stage",
  "gloss_cents",
  "gross_revenue_cents",
  "hospital_account_id",
  "invoice_number_hash",
  "invoiced_cents",
  "is_test",
  "issue_date",
  "missing_fields_count",
  "native_ready",
  "origin_connector",
  "origin_system",
  "kind",
  "legacy_status",
  "liquidated_amount_cents",
  "non_destructive",
  "numero_contrato_hash",
  "numero_nf_hash",
  "numero_nota_hash",
  "occurred_at",
  "outstanding_amount_cents",
  "outstanding_cents",
  "patient_count",
  "percent",
  "percentage",
  "period",
  "professional_id",
  "provider_id",
  "quantity",
  "rate",
  "ratio",
  "receita_bruta",
  "received_amount_cents",
  "received_cents",
  "recebido",
  "reconciliation_status",
  "result_amount_cents",
  "resultado",
  "risk_level",
  "role",
  "sanitized",
  "sla_due_at",
  "source_context",
  "source_independent",
  "source_row_hash",
  "source_version",
  "start_at",
  "state",
  "status",
  "status_auditoria",
  "status_processamento",
  "test",
  "total",
  "total_cents",
  "transaction_id_hash",
  "type",
  "unit_id",
  "valor",
  "valor_conciliado",
  "valor_em_aberto",
  "valor_imposto",
  "valor_lancamento",
  "valor_liquidado",
  "valor_nf",
  "valor_nfse",
  "valor_nfs_e",
  "valor_nota",
  "valor_recebido",
  "valor_total",
  "valor_transacao",
  "version",
  "workflow_state",
  "workflow_status"
]);

const NON_CLINICAL_RECORD_CONTAINERS = new Set([
  "billing",
  "coverage",
  "financial",
  "metrics",
  "operations",
  "totals"
]);

const NON_CLINICAL_METADATA_FIELDS = new Set([
  "bridge_version",
  "clinical_sensitive_enabled",
  "file_name_withheld",
  "migration_version",
  "money_normalization_version",
  "narrative_withheld",
  "non_blocking_mirror",
  "external_ai_used",
  "native_data_plane",
  "non_destructive",
  "origin_connector",
  "pipeline_version",
  "source_access_required_after_ingest",
  "source_context",
  "source_registry_version",
  "source_row",
  "source_row_hash",
  "source_sheet"
]);

const NON_CLINICAL_SOURCE_FIELDS = new Set([
  "content_hash",
  "file_name",
  "hash_method",
  "mime_type",
  "parent_id",
  "source_id",
  "system",
  "url"
]);

// New financial fields are accepted only as this complete typed root record.
// They do not broaden the generic recursive vocabulary or permit raw row text.
const FINANCIAL_COLUMNS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  MONTHLY_SUMMARY: {
    grossRevenueCents: ["receita_bruta_nfs", "receita_bruta"],
    receivedAmountCents: ["recebido_conciliado", "recebido", "valor_recebido"],
    outstandingAmountCents: ["em_aberto", "valor_em_aberto"],
    expenseAmountCents: ["despesa", "despesas"], resultAmountCents: ["resultado"]
  },
  INVOICE: {
    totalCents: ["valor_servico", "valor_total", "valor_nf", "valor_nota", "valor_nfs_e", "valor_nfse", "valor"],
    netAmountCents: ["valor_liquido"], taxAmountCents: ["iss_apurado"], receivableCents: ["saldo_receber_comprovado"]
  },
  EXTRACTED_MOVEMENT: {
    creditCents: ["credito", "tipo", "valor"], debitCents: ["debito", "tipo", "valor"], extractedAmountCents: ["valor"]
  },
  CASH_SUMMARY: {
    creditCents: ["total_creditos"], debitCents: ["total_debitos"],
    resultAmountCents: ["resultado_liquido"], reviewAmountCents: ["valor_indefinido"]
  }
};
const FINANCIAL_COMMON_FIELDS = [
  "sanitized", "financialMappingVersion", "financialRecordRole", "fieldOrigins", "originDocumentRef",
  "invoiceNumber", "sourceReconciliationStatus", "settlementEvidenceState", "dueDate", "dueDateEvidenceRef",
  "dueDateState", "kind", "status", "aggregationRole", "sourceRowHash"
];
const FINANCIAL_SOURCE_STATES = new Set([
  "CONCILIADO", "NAO_CONCILIADO", "PENDENTE", "PENDENTE_CONCILIACAO", "PENDENTE_VALIDACAO",
  "VALIDA", "VALIDA_COMPLETA", "VALIDA_INCOMPLETA", "INVALIDA", "SUBSTITUIDA", "CANCELADA", "ANULADA",
  "PROCESSADO", "ERRO", "REVISAR_HUMANO", "PENDING_RECONCILIATION", "NOT_RECONCILED", "UNMAPPED_SOURCE_STATUS"
]);
function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactFields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return plainRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function hexHash(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function nullableCents(value: unknown): boolean { return value === null || Number.isSafeInteger(value); }
function driveDocumentRef(value: unknown): boolean {
  return value === null || (typeof value === "string" && (
    /^[A-Za-z0-9_-]{10,200}$/.test(value)
    || /^GMAIL_ATTACHMENT:\d{50}\.pdf$/.test(value)
    || /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}\/view$/.test(value)
    || /^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]{10,200}\/edit$/.test(value)
    || /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/[a-f0-9]{10,64}$/.test(value)
  ));
}
function structuredFinancialRecordValid(record: Record<string, unknown>, entityType: string): boolean {
  if (typeof record.financialRecordRole !== "string" || !Object.hasOwn(FINANCIAL_COLUMNS, record.financialRecordRole)) return false;
  const role = String(record.financialRecordRole || "");
  const columns = FINANCIAL_COLUMNS[role];
  if (!columns || record.financialMappingVersion !== "v1.3.0-typed-financial") return false;
  const extra = role === "INVOICE" ? ["receivableState", "reportedReceivableCents"]
    : role === "MONTHLY_SUMMARY" ? [] : ["category", "nativeReady", "sourceIndependent", "documentFragility"];
  if (!exactFields(record, [...FINANCIAL_COMMON_FIELDS, ...Object.keys(columns), ...extra])
    || record.sanitized !== true || !hexHash(record.sourceRowHash) || !driveDocumentRef(record.originDocumentRef)
    || !(record.invoiceNumber === null || (typeof record.invoiceNumber === "string" && /^\d{1,30}$/.test(record.invoiceNumber)))
    || !(record.sourceReconciliationStatus === null || (typeof record.sourceReconciliationStatus === "string" && FINANCIAL_SOURCE_STATES.has(record.sourceReconciliationStatus)))
    || record.settlementEvidenceState !== "PENDING_BANK_EVIDENCE" || record.dueDate !== null
    || record.dueDateEvidenceRef !== null || record.dueDateState !== "MISSING_CONTRACT_EVIDENCE"
    || !exactFields(record.fieldOrigins, [...Object.keys(columns), "dueDate"])) return false;
  const origins = record.fieldOrigins;
  for (const [field, allowedColumns] of Object.entries(columns)) {
    if (!nullableCents(record[field])) return false;
    const origin = origins[field];
    const reported = role === "INVOICE" && field === "receivableCents" ? record.reportedReceivableCents : record[field];
    if (!exactFields(origin, ["columns", "state"]) || !Array.isArray(origin.columns)
      || origin.columns.length !== new Set(origin.columns).size
      || !origin.columns.every(column => typeof column === "string" && allowedColumns.includes(column))
      || origin.state !== (reported === null ? "MISSING_VALUE" : "SOURCE_REPORTED")) return false;
  }
  if (!exactFields(origins.dueDate, ["columns", "state"]) || !Array.isArray(origins.dueDate.columns)
    || origins.dueDate.columns.length !== 0 || origins.dueDate.state !== "MISSING_CONTRACT_EVIDENCE") return false;
  if (role === "INVOICE") return entityType === "invoice" && record.kind === "INVOICE"
    && typeof record.status === "string" && ["SUPERSEDED", "ISSUED_UNRECONCILED"].includes(record.status)
    && record.aggregationRole === (record.status === "SUPERSEDED" ? "HISTORY_ONLY" : "BILLING_ONLY")
    && record.receivableState === "PENDING_RECONCILIATION" && record.receivableCents === null
    && nullableCents(record.reportedReceivableCents);
  if (role === "MONTHLY_SUMMARY") return entityType === "financialEntry" && record.kind === "FINANCIAL_SUMMARY"
    && record.status === "REPORTED_SUMMARY" && record.aggregationRole === "CONTROL_ONLY";
  return entityType === "sourceDocument" && record.kind === role && record.category === "financial"
    && record.status === "PENDING_EVIDENCE" && record.aggregationRole === "CONTROL_ONLY"
    && record.nativeReady === false && record.sourceIndependent === false && record.documentFragility === "MISSING_CANONICAL_FIELDS";
}

function extractionEvidenceValid(event: WmgjIngestionEvent): boolean {
  const evidence = event.record.extractionEvidence;
  if (!exactFields(evidence, ["schemaVersion", "contentSha256", "textSha256", "textLength", "method", "coverage", "sourceVersion", "financialFactsApproved"])) return false;
  return event.entityType === "sourceDocument" && event.source.system === "DRIVE"
    && evidence.schemaVersion === 1 && hexHash(evidence.contentSha256) && hexHash(evidence.textSha256)
    && evidence.contentSha256 === event.source.contentHash && event.source.hashMethod === "content_sha256"
    && Number.isSafeInteger(evidence.textLength) && Number(evidence.textLength) > 0 && Number(evidence.textLength) <= 1048576
    && typeof evidence.method === "string" && ["google_docs_text", "google_sheets_values", "blob_text", "drive_api_ocr_convert"].includes(evidence.method)
    && evidence.method === event.record.extractionMethod && evidence.coverage === "TEXT_EXTRACTED_REVIEW_PENDING"
    && evidence.sourceVersion === event.sourceVersion && evidence.financialFactsApproved === false;
}

function normalizedTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .split("_")
    .filter(Boolean);
}

function normalizedKey(value: string): string {
  return normalizedTokens(value).join("_");
}

function containsFieldOutsideContract(
  value: unknown,
  allowedFields: ReadonlySet<string>,
  allowedContainers: ReadonlySet<string> = new Set<string>(),
  depth = 0
): boolean {
  if (depth > 10) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsFieldOutsideContract(
      item,
      allowedFields,
      allowedContainers,
      depth + 1
    ));
  }
  if (!value || typeof value !== "object") return false;

  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
    const normalized = normalizedKey(key);
    if (!allowedFields.has(normalized) && !allowedContainers.has(normalized)) return true;
    return containsFieldOutsideContract(nested, allowedFields, allowedContainers, depth + 1);
  });
}

function isNumericAggregate(tokens: readonly string[], value: unknown): boolean {
  return typeof value === "number"
    && Number.isFinite(value)
    && tokens.some((token) => AGGREGATE_TOKENS.has(token));
}

function isProhibitedClinicalKey(key: string, value: unknown): boolean {
  const tokens = normalizedTokens(key);
  const normalized = normalizedKey(key);

  if (
    DIRECT_CLINICAL_KEYS.has(normalized)
    || DIRECT_PERSON_IDENTIFIER_KEYS.has(normalized)
    || UNSTRUCTURED_PAYLOAD_KEYS.has(normalized)
  ) return true;
  if (tokens.includes("medical") && tokens.includes("record")) return true;
  if (tokens.some((token) => DIRECT_CLINICAL_IDENTIFIER_TOKENS.has(token))) return true;

  const hasPatientContext = tokens.some((token) => PATIENT_CONTEXT_TOKENS.has(token));
  const hasClinicalContent = tokens.some((token) => CLINICAL_CONTENT_TOKENS.has(token));
  if (!hasPatientContext && !hasClinicalContent) return false;

  // Métricas agregadas numéricas não identificam uma pessoa e são necessárias
  // para indicadores operacionais. Texto, objetos e identificadores continuam
  // fechados mesmo quando usam um nome de campo aparentemente agregado.
  return !isNumericAggregate(tokens, value);
}

function containsProhibitedClinicalValue(value: string): boolean {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // Formato inequívoco de CPF e rótulos explícitos são bloqueados mesmo sob
  // uma chave genérica. Não rejeitamos qualquer sequência de 11 dígitos para
  // evitar confundir números legítimos de nota, transação ou autorização.
  if (/(?:^|\D)\d{3}\.\d{3}\.\d{3}-\d{2}(?:\D|$)/.test(normalized)) return true;
  const entireValueTokens = normalizedTokens(normalized);
  if (entireValueTokens.some((token) =>
    DIRECT_CLINICAL_IDENTIFIER_TOKENS.has(token)
    || PATIENT_CONTEXT_TOKENS.has(token)
    || CLINICAL_CONTENT_TOKENS.has(token)
  )) return true;
  return /(?:^|[\s;,|])(?:cpf|cns|paciente|patient|beneficiario|beneficiary|prontuario|medical[ _-]?record|diagnostico|diagnosis|cid(?:-?10)?|icd(?:-?10)?)\s*[:=#]\s*\S+/.test(normalized);
}

function containsProhibitedClinicalKey(
  value: unknown,
  depth = 0,
  visited = new WeakSet<object>()
): boolean {
  if (depth > 10) return true;
  if (typeof value === "string") return containsProhibitedClinicalValue(value);
  if (!value || typeof value !== "object") return false;
  if (visited.has(value)) return true;
  visited.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => containsProhibitedClinicalKey(item, depth + 1, visited));
  }

  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    isProhibitedClinicalKey(key, nested)
    || containsProhibitedClinicalKey(nested, depth + 1, visited)
  );
}

function isProhibitedClinicalLabel(value: string | undefined): boolean {
  if (!value) return false;
  return isProhibitedClinicalKey(value, value);
}

function containsClinicalIdentifierMarker(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const segments = normalized.split(/[:/|#]/).map((part) => part.trim());
  return segments.some((segment) =>
    /^(?:cpf|cns|paciente|patient|beneficiario|beneficiary|prontuario|medical[ _-]?record)(?:$|[=-])/.test(segment)
  );
}

export function containsProhibitedClinicalContent(event: WmgjIngestionEvent): boolean {
  const technicalIdentifiers: Readonly<Record<typeof TECHNICAL_IDENTIFIER_FIELDS[number], string | undefined>> = {
    entityKey: event.entityKey,
    idempotencyKey: event.idempotencyKey,
    "source.sourceId": event.source.sourceId,
    "source.parentId": event.source.parentId
  };

  return containsProhibitedClinicalKey(event.record)
    || containsProhibitedClinicalKey(event.metadata)
    || containsProhibitedClinicalKey(event.source)
    || isProhibitedClinicalLabel(event.documentType)
    || TECHNICAL_IDENTIFIER_FIELDS.some((field) =>
      containsClinicalIdentifierMarker(technicalIdentifiers[field])
    );
}

export function containsFieldOutsideNonClinicalContract(event: WmgjIngestionEvent): boolean {
  const typedFinancial = Object.hasOwn(event.record, "financialMappingVersion");
  const hasExtractionEvidence = Object.hasOwn(event.record, "extractionEvidence");
  const ordinaryRecord = hasExtractionEvidence
    ? Object.fromEntries(Object.entries(event.record).filter(([key]) => key !== "extractionEvidence")) : event.record;
  const recordInvalid = typedFinancial ? !structuredFinancialRecordValid(event.record, event.entityType) : containsFieldOutsideContract(
    ordinaryRecord,
    NON_CLINICAL_RECORD_FIELDS,
    NON_CLINICAL_RECORD_CONTAINERS
  );
  // Only this exact metadata key is accepted; normalized aliases and nested
  // containers cannot smuggle arbitrary text through the newly permitted field.
  const rowHashEntries = Object.entries(event.metadata || {}).filter(([key]) => normalizedKey(key) === "source_row_hash");
  const metadataHashInvalid = rowHashEntries.some(([key, value]) => key !== "sourceRowHash" || !hexHash(value));
  return recordInvalid || (hasExtractionEvidence && !extractionEvidenceValid(event)) || metadataHashInvalid
    || containsFieldOutsideContract(event.metadata, NON_CLINICAL_METADATA_FIELDS)
    || containsFieldOutsideContract(event.source, NON_CLINICAL_SOURCE_FIELDS);
}

export function isAllowedEntityType(entityType: string): boolean {
  return Object.hasOwn(ENTITY_COLLECTIONS, entityType);
}

export function collectionFor(entityType: string): string | undefined {
  return ENTITY_COLLECTIONS[entityType];
}

export function keyAllowsEntityType(entityTypes: readonly string[], entityType: string): boolean {
  return entityTypes.includes(entityType);
}

export function validateGenericIngestionPolicy(event: WmgjIngestionEvent): string[] {
  const errors: string[] = [];

  if (event.sensitivity === "CLINICAL_SENSITIVE") {
    errors.push("CLINICAL_SENSITIVE não é permitido na ingestão genérica");
  }
  if (containsProhibitedClinicalContent(event)) {
    errors.push("conteúdo clínico identificável não é permitido na ingestão genérica");
  }
  if (containsFieldOutsideNonClinicalContract(event)) {
    errors.push("campo fora do contrato não clínico permitido");
  }
  if (event.reviewState === "APPROVED" || event.reviewState === "REJECTED") {
    errors.push("decisão de revisão exige endpoint humano dedicado");
  }
  if (event.workflowState === "CLOSED" && CRITICAL_CLOSURE_ENTITY_TYPES.has(event.entityType)) {
    errors.push("fechamento crítico exige aprovação humana dedicada");
  }

  if (event.eventType === "DOCUMENT_UPSERT" && event.entityType !== "sourceDocument") {
    errors.push("DOCUMENT_UPSERT exige entityType sourceDocument");
  }
  if (event.eventType === "RUNTIME_CHECKPOINT" && event.entityType !== "runtimeCheckpoint") {
    errors.push("RUNTIME_CHECKPOINT exige entityType runtimeCheckpoint");
  }
  if (event.eventType === "AI_RUN_RECORDED" && event.entityType !== "aiRun") {
    errors.push("AI_RUN_RECORDED exige entityType aiRun");
  }
  if (event.entityType === "aiRun" && event.eventType !== "AI_RUN_RECORDED") {
    errors.push("entityType aiRun exige eventType AI_RUN_RECORDED");
  }

  return errors;
}
