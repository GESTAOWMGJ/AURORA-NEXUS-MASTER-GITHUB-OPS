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
  "category",
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
  "document_id_hash",
  "due_date",
  "em_aberto",
  "enabled",
  "end_at",
  "expense_amount_cents",
  "extraction_method",
  "facility_id",
  "gloss_cents",
  "gross_revenue_cents",
  "hospital_account_id",
  "invoice_number_hash",
  "invoiced_cents",
  "is_test",
  "issue_date",
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
  "source_context",
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
  "non_destructive",
  "pipeline_version",
  "source_context",
  "source_row",
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
  return containsFieldOutsideContract(
    event.record,
    NON_CLINICAL_RECORD_FIELDS,
    NON_CLINICAL_RECORD_CONTAINERS
  ) || containsFieldOutsideContract(event.metadata, NON_CLINICAL_METADATA_FIELDS)
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
