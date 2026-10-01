import { validEvidenceRef } from "./auroraEvidence.js";

export const AURORA_MODULES = [
  ["M01", "Ingestão e Proveniência Documental"],
  ["M02", "Contratos, Regras e Evidências"],
  ["M03", "Ciclo de Receita e Conciliação"],
  ["M04", "Glosas, Recursos e Divergências"],
  ["M05", "SLA e Workflow"],
  ["M06", "Governança e Planos de Ação"],
  ["M07", "Indicadores e Relatórios"],
  ["M08", "Integrações e Conectores"],
  ["M09", "Segurança, LGPD e Segregação"],
  ["M10", "Trilha de Auditoria e Integridade"]
] as const;

export type ProjectionSource = {
  invoices: Array<Record<string, unknown>>;
  bankTransactions: Array<Record<string, unknown>>;
  glosses: Array<Record<string, unknown>>;
  actionItems: Array<Record<string, unknown>>;
  sourceDocuments: Array<Record<string, unknown>>;
  reconciliations: Array<Record<string, unknown>>;
  auditFindings: Array<Record<string, unknown>>;
};

export type ProjectionContext = {
  orgId?: string;
  competence?: string;
};

type CentsMetric = { value: number | null; valid: number; invalid: number };
const VALIDATED_STATES = new Set(["VALIDATED", "CLOSED"]);
const TEST_RECORD_MARKERS = new Set(["TEST", "TESTE"]);

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function isTestRecord(record: Record<string, unknown>): boolean {
  if (record.isTest === true || record.is_test === true) return true;
  return [
    record.environment,
    record.ambiente,
    record.recordType,
    record.record_type,
    record.tipo_registro
  ].some((value) => TEST_RECORD_MARKERS.has(normalized(value)));
}

function isValidated(record: Record<string, unknown>): boolean {
  return [record.workflowState, record.workflow_state]
    .some((value) => VALIDATED_STATES.has(normalized(value)));
}

function financialStatus(record: Record<string, unknown>): string {
  for (const value of [record.status, record.status_conciliacao, record.reconciliationStatus, record.reconciliation_status]) {
    const status = normalized(value);
    if (status) return status;
  }
  return "";
}

function withoutTestRecords(source: ProjectionSource): ProjectionSource {
  return Object.fromEntries(
    Object.entries(source).map(([name, records]) => [name, records.filter((record) => !isTestRecord(record))])
  ) as ProjectionSource;
}

function inCompetence(record: Record<string, unknown>, competence?: string): boolean {
  return !competence || record.competence === competence;
}

function firstCanonicalCents(record: Record<string, unknown>, fields: string[]): number | undefined {
  for (const field of fields) {
    if (!(field in record) || record[field] === null || record[field] === undefined || record[field] === "") continue;
    const value = record[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return undefined;
    return value;
  }
  return undefined;
}

function sumCents(
  records: Array<Record<string, unknown>>,
  fields: string[],
  options: { competence?: string; allowNegative?: boolean; status?: Set<string> } = {}
): CentsMetric {
  let total = 0;
  let valid = 0;
  let invalid = 0;
  for (const record of records) {
    if (isTestRecord(record) || !isValidated(record) || !inCompetence(record, options.competence)) continue;
    if (options.status && !options.status.has(financialStatus(record))) continue;
    const cents = firstCanonicalCents(record, fields);
    if (cents === undefined || (!options.allowNegative && cents < 0)) {
      invalid++;
      continue;
    }
    const next = total + cents;
    if (!Number.isSafeInteger(next)) {
      invalid++;
      continue;
    }
    total = next;
    valid++;
  }
  return { value: valid > 0 && invalid === 0 ? total : null, valid, invalid };
}

function countWhere(records: Array<Record<string, unknown>>, predicate: (item: Record<string, unknown>) => boolean): number {
  return records.reduce((total, item) => total + (predicate(item) ? 1 : 0), 0);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function epochMillis(value: unknown): number {
  if (typeof value === "string") return Date.parse(value);
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().getTime();
  }
  return NaN;
}

function booleanField(record: Record<string, unknown>, camel: string, snake: string): boolean {
  return record[camel] === true || record[snake] === true;
}

function documentIntelligenceMetrics(
  records: Array<Record<string, unknown>>,
  now: Date
): Record<string, unknown> {
  const docs = records.filter((item) => !isTestRecord(item));
  let nativeReady = 0;
  let sourceIndependent = 0;
  let externalFetchRequired = 0;
  let fragile = 0;
  let degradedExtraction = 0;
  let lowConfidence = 0;
  let missingCanonicalFields = 0;
  let overdueSla = 0;
  let pendingFlow = 0;
  let externalAiUsed = 0;
  const origins: Record<string, number> = {};

  for (const item of docs) {
    const origin = normalized(item.originSystem ?? item.origin_system ?? "UNKNOWN") || "UNKNOWN";
    origins[origin] = (origins[origin] ?? 0) + 1;

    const ready = booleanField(item, "nativeReady", "native_ready");
    const independent = booleanField(item, "sourceIndependent", "source_independent");
    const fetchRequired = booleanField(item, "externalFetchRequired", "external_fetch_required");
    const usedExternalAi = booleanField(item, "externalAiUsed", "external_ai_used");
    if (ready) nativeReady++;
    if (independent) sourceIndependent++;
    if (fetchRequired) externalFetchRequired++;
    if (usedExternalAi) externalAiUsed++;

    const fragility = normalized(item.documentFragility ?? item.document_fragility ?? "NONE");
    const missing = finiteNumber(item.missingFieldsCount ?? item.missing_fields_count) ?? 0;
    if (fragility !== "NONE" || fetchRequired || missing > 0) fragile++;
    if (fragility === "DEGRADED_EXTRACTION") degradedExtraction++;
    if (fragility === "LOW_CONFIDENCE") lowConfidence++;
    if (fragility === "MISSING_CANONICAL_FIELDS" || missing > 0) missingCanonicalFields++;

    if (!isValidated(item)) {
      pendingFlow++;
      const dueAt = epochMillis(item.slaDueAt ?? item.sla_due_at);
      if (Number.isFinite(dueAt) && dueAt < now.getTime()) overdueSla++;
    }
  }

  const percent = (part: number): number | null =>
    docs.length === 0 ? null : Math.round((part / docs.length) * 1000) / 10;

  return {
    totalDocuments: docs.length,
    nativeReadyDocuments: nativeReady,
    sourceIndependentDocuments: sourceIndependent,
    sourceDependentDocuments: docs.length - sourceIndependent,
    externalFetchRequiredDocuments: externalFetchRequired,
    fragileDocuments: fragile,
    degradedExtractionDocuments: degradedExtraction,
    lowConfidenceDocuments: lowConfidence,
    missingCanonicalFieldsDocuments: missingCanonicalFields,
    overdueDocumentSla: overdueSla,
    pendingDocumentFlow: pendingFlow,
    externalAiDocuments: externalAiUsed,
    nativeReadyPercent: percent(nativeReady),
    sourceIndependentPercent: percent(sourceIndependent),
    origins
  };
}

function pipelineMetrics(source: ProjectionSource): Record<string, number> {
  const records = [
    ...source.invoices,
    ...source.bankTransactions,
    ...source.glosses,
    ...source.sourceDocuments,
    ...source.reconciliations
  ].filter((item) => !isTestRecord(item));
  const state = (name: string): number => countWhere(records, (item) => normalized(item.workflowState) === name);
  return {
    total: records.length,
    queued: state("QUEUED") + state("RECEIVED"),
    processing: state("CLASSIFIED") + state("EXTRACTED") + state("NORMALIZED"),
    validated: state("VALIDATED") + state("CLOSED"),
    pendingHumanReview: state("PENDING_HUMAN_REVIEW") + state("PENDING_EVIDENCE") + state("BLOCKED"),
    failed: state("FAILED"),
    deadLetter: state("DEAD_LETTER"),
    duplicateEvents: 0
  };
}

function sourceStates(source: ProjectionSource): Array<Record<string, unknown>> {
  return Object.entries(source).map(([name, records]) => ({
    source: name,
    completeness: records.length === 0 ? "EMPTY" : "PARTIAL",
    freshness: "UNKNOWN",
    lastSuccessAt: null,
    missing: records.length === 0,
    detail: records.length === 0 ? "Sem fonte disponível para a projeção" : `${records.length} registro(s) avaliados`
  }));
}

export function buildProjection(source: ProjectionSource, now = new Date(), context: ProjectionContext = {}): Record<string, unknown> {
  const operationalSource = withoutTestRecords(source);
  const invoiced = sumCents(operationalSource.invoices, ["totalCents", "amountCents", "grossAmountCents", "valorCentavos"], { competence: context.competence });
  const received = sumCents(operationalSource.bankTransactions, ["liquidatedAmountCents", "amountCents", "valorCentavos"], {
    competence: context.competence,
    status: new Set(["LIQUIDATED", "RECONCILED", "MATCHED", "LIQUIDADO", "CONCILIADO"])
  });
  const gloss = sumCents(operationalSource.glosses, ["glossAmountCents", "amountCents", "valorCentavos"], { competence: context.competence });
  const actionScope = operationalSource.actionItems.filter((item) => inCompetence(item, context.competence));
  const openActions = countWhere(actionScope, (item) => !["RESOLVED", "CANCELLED"].includes(normalized(item.status || "OPEN")));
  const overdueActions = countWhere(actionScope, (item) => {
    if (["RESOLVED", "CANCELLED"].includes(normalized(item.status || "OPEN"))) return false;
    const dueAt = epochMillis(item.dueAt);
    return Number.isFinite(dueAt) && dueAt < now.getTime();
  });
  const validatedSources = countWhere(operationalSource.sourceDocuments, (item) => isValidated(item));
  const documentIntelligence = documentIntelligenceMetrics(operationalSource.sourceDocuments, now);
  const reconciled = countWhere(operationalSource.reconciliations, (item) =>
    ["MATCHED", "RECONCILED", "CLOSED", "CONCILIADO"].includes(normalized(item.status ?? item.workflowState))
  );
  const openFindings = countWhere(operationalSource.auditFindings, (item) => !["RESOLVED", "CLOSED"].includes(normalized(item.status || "OPEN")));
  const criticalFindings = countWhere(operationalSource.auditFindings, (item) =>
    !["RESOLVED", "CLOSED"].includes(normalized(item.status || "OPEN")) && normalized(item.riskLevel) === "CRITICAL"
  );
  const invalidFinancialRecords = invoiced.invalid + received.invalid + gloss.invalid;
  const sampleSizes = Object.fromEntries(Object.entries(operationalSource).map(([key, value]) => [key, value.length]));
  const totalRecords = Object.values(sampleSizes).reduce((sum, count) => sum + count, 0);
  const dataState = totalRecords === 0 ? "NO_SOURCE" : invalidFinancialRecords > 0 ? "BLOCKED_DATA_QUALITY" : "SHADOW";
  const ratio = (part: number, total: number): number | null => total === 0 ? null : Math.round((part / total) * 1000) / 10;
  const outstanding = invoiced.value === null || received.value === null ? null : invoiced.value - received.value;
  const completeness = totalRecords === 0 ? "EMPTY" : invalidFinancialRecords > 0 ? "INVALID" : "PARTIAL";
  const documentOverdue = Number(documentIntelligence.overdueDocumentSla || 0);
  const documentFragile = Number(documentIntelligence.fragileDocuments || 0);
  const severity = invalidFinancialRecords > 0 ? "BLOCKED" : (criticalFindings > 0 || overdueActions > 0 || documentOverdue > 0 || documentFragile > 0 ? "ATTENTION" : totalRecords > 0 ? "NOMINAL" : "UNKNOWN");
  const alerts: Array<Record<string, unknown>> = [];
  if (invalidFinancialRecords > 0) alerts.push({ alertId: "financial-data-quality", severity: "CRITICAL", title: "Dados financeiros bloqueados", detail: `${invalidFinancialRecords} registro(s) sem centavos canônicos válidos`, evidenceRefs: [], createdAt: now.toISOString() });
  if (overdueActions > 0) alerts.push({ alertId: "overdue-actions", severity: "HIGH", title: "SLA vencido", detail: `${overdueActions} ação(ões) aguardam tratamento`, evidenceRefs: [], createdAt: now.toISOString() });
  if (documentOverdue > 0) alerts.push({ alertId: "document-sla-overdue", severity: "HIGH", title: "SLA documental vencido", detail: `${documentOverdue} documento(s) permanecem no fluxo após o SLA configurado`, evidenceRefs: [], createdAt: now.toISOString() });
  if (documentFragile > 0) alerts.push({ alertId: "document-fragility", severity: "MEDIUM", title: "Fragilidade documental", detail: `${documentFragile} documento(s) possuem extração degradada, baixa confiança ou campos canônicos ausentes`, evidenceRefs: [], createdAt: now.toISOString() });

  return {
    schemaVersion: 2,
    orgId: context.orgId ?? "wmgj",
    competence: context.competence ?? now.toISOString().slice(0, 7),
    generatedAt: now.toISOString(),
    asOf: now.toISOString(),
    policyVersion: "aurora-nexus-2.4.0-firebase-native-v1",
    completeness,
    severity,
    pipeline: pipelineMetrics(operationalSource),
    financial: {
      billedAmount: invoiced.value === null ? null : invoiced.value / 100,
      receivedAmount: received.value === null ? null : received.value / 100,
      pendingAmount: outstanding === null ? null : Math.max(0, outstanding) / 100,
      reconciliationDifference: outstanding === null ? null : Math.min(0, outstanding) / 100,
      currency: "BRL"
    },
    audit: { openFindings, criticalFindings, overdueActions, evidenceGaps: operationalSource.sourceDocuments.length - validatedSources },
    sources: sourceStates(operationalSource),
    alerts,
    sanitized: true,
    sensitivity: "INTERNAL",
    state: dataState,
    financialCents: { invoicedCents: invoiced.value, receivedCents: received.value, glossCents: gloss.value, outstandingCents: outstanding },
    operations: { openActions, overdueActions, openFindings },
    documentIntelligence,
    nativeDataPlane: {
      storage: "FIRESTORE",
      inferenceInput: "CANONICAL_FIREBASE_SNAPSHOT",
      sourceAccessDuringInference: false,
      externalAiRequired: false,
      externalAiFallbackDefault: false,
      sourceIndependentDocuments: documentIntelligence.sourceIndependentDocuments,
      sourceDependentDocuments: documentIntelligence.sourceDependentDocuments
    },
    organicLoop: {
      observes: ["DOCUMENT_FRAGILITY", "DOCUMENT_SLA", "FLOW_BOTTLENECK", "VALIDATED_RESOLUTION"],
      humanValidationRequired: true,
      autonomousSourceMutation: false,
      nextState: "EVIDENCE_TO_LIMITED_PROPOSAL"
    },
    coverage: {
      evidencePercent: ratio(validatedSources, operationalSource.sourceDocuments.length),
      reconciliationPercent: ratio(reconciled, operationalSource.reconciliations.length)
    },
    sampleSizes,
    dataQuality: {
      complete: invalidFinancialRecords === 0,
      sourcePresent: totalRecords > 0,
      invalidFinancialRecords,
      validFinancialRecords: invoiced.valid + received.valid + gloss.valid
    },
    modules: AURORA_MODULES.map(([id, name]) => ({ id, name, status: dataState === "SHADOW" ? "LEARNING" : "BLOCKED" }))
  };
}

const REASON_CODES = new Set(["DATA_DIVERGENCE", "SLA_BREACH", "MISSING_EVIDENCE", "AUDIT_FINDING", "MANUAL_REVIEW"]);
const RESOLUTION_CODES = new Set(["EVIDENCE_CONFIRMED", "SOURCE_CORRECTED", "FALSE_POSITIVE", "ESCALATED"]);
const TARGET_TYPES = new Set(["invoice", "bankTransaction", "sourceDocument", "reconciliation", "auditFinding", "managementInput"]);

export type ActionCommand =
  | { type: "CREATE_REVIEW"; targetType: string; targetId: string; reasonCode: string; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; dueAt: string; competence: string; title?: string; details?: string }
  | { type: "ACKNOWLEDGE"; actionId: string; expectedRevision: number }
  | { type: "RESOLVE"; actionId: string; expectedRevision: number; resolutionCode: string; evidenceRefs: string[] };

function safeOperationalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function safeEvidenceRefs(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const refs = value.map((item) => typeof item === "string" ? item.trim() : "");
  return refs.every(validEvidenceRef) && new Set(refs).size === refs.length ? refs : null;
}

export function parseActionCommand(value: unknown): ActionCommand | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.type === "CREATE_REVIEW") {
    const targetType = typeof body.targetType === "string" ? body.targetType.trim() : "";
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode : "";
    const riskLevel = typeof body.riskLevel === "string" ? body.riskLevel : "";
    const dueAt = typeof body.dueAt === "string" ? body.dueAt : "";
    const competence = typeof body.competence === "string" ? body.competence : "";
    const title = safeOperationalText(body.title, 120);
    const details = safeOperationalText(body.details, 1000);
    if (!TARGET_TYPES.has(targetType) || !/^[A-Za-z0-9._:-]{1,160}$/.test(targetId) || !REASON_CODES.has(reasonCode)) return null;
    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(riskLevel) || !Number.isFinite(Date.parse(dueAt)) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) return null;
    if (targetType === "managementInput" && !title) return null;
    return {
      type: "CREATE_REVIEW",
      targetType,
      targetId,
      reasonCode,
      riskLevel: riskLevel as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      dueAt,
      competence,
      ...(title ? { title } : {}),
      ...(details ? { details } : {})
    };
  }
  const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
  const expectedRevision = body.expectedRevision;
  if (!validEvidenceRef(actionId) || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) return null;
  if (body.type === "ACKNOWLEDGE") return { type: "ACKNOWLEDGE", actionId, expectedRevision: Number(expectedRevision) };
  if (body.type === "RESOLVE" && typeof body.resolutionCode === "string" && RESOLUTION_CODES.has(body.resolutionCode)) {
    const evidenceRefs = safeEvidenceRefs(body.evidenceRefs);
    if (!evidenceRefs) return null;
    return { type: "RESOLVE", actionId, expectedRevision: Number(expectedRevision), resolutionCode: body.resolutionCode, evidenceRefs };
  }
  return null;
}
