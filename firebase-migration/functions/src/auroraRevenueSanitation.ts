import { validEvidenceRef } from "./auroraEvidence.js";
import type { ProjectionContext, ProjectionSource } from "./auroraEngine.js";

export const AURORA_REVENUE_SANITATION_VERSION = "0.1.1";

export type RevenueLooseEndCode =
  | "BILLED_NOT_RECEIVED"
  | "BILLING_EVIDENCE_GAP"
  | "GLOSS_UNSUPPORTED_OR_UNRESOLVED"
  | "RECONCILIATION_OPEN"
  | "FOLLOWUP_SLA_BREACH"
  | "FOLLOWUP_OPEN"
  | "AUDIT_FINDING_OPEN"
  | "EVIDENCE_GAP"
  | "DUPLICATE_OR_VERSION_CONFLICT";

export type RevenueStage =
  | "PREVISTO"
  | "FATURAVEL"
  | "FATURADO"
  | "RECEBIVEL"
  | "RECEBIDO"
  | "RECUPERAVEL"
  | "DIVERGENTE"
  | "ENCERRADO_COM_EVIDENCIA";

export type LooseEndSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type RevenueLooseEnd = {
  id: string;
  code: RevenueLooseEndCode;
  stage: RevenueStage;
  severity: LooseEndSeverity;
  competence: string | null;
  targetType: string;
  targetId: string;
  amountCents: number | null;
  status: string;
  dueAt: string | null;
  owner: string | null;
  evidenceRefs: string[];
  nextAction: string;
  closureCriteria: string[];
  overlapKey: string;
};

const CLOSED = new Set(["CLOSED", "RESOLVED", "CANCELLED", "ENCERRADO", "ENCERRADA"]);
const SETTLED = new Set(["PAID", "LIQUIDATED", "RECONCILED", "MATCHED", "PAGO", "LIQUIDADO", "CONCILIADO"]);
const ACCEPTED_GLOSS = new Set(["ACCEPTED", "APPROVED", "CLOSED", "RESOLVED", "ACEITA", "APROVADA", "ENCERRADA"]);
const HUMAN_RESOLUTION_CODES = new Set(["EVIDENCE_CONFIRMED", "SOURCE_CORRECTED", "FALSE_POSITIVE", "ESCALATED"]);
const TEST_MARKERS = new Set(["TEST", "TESTE"]);
const SEVERITY_PRIORITY: Record<LooseEndSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function textField(record: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function recordId(record: Record<string, unknown>, fallback: string): string {
  return textField(record, ["id", "invoiceId", "glossId", "actionId", "findingId", "sourceId", "reconciliationId", "documentId"]) ?? fallback;
}

function financialStatus(record: Record<string, unknown>): string {
  return normalized(
    record.status ??
    record.status_conciliacao ??
    record.reconciliationStatus ??
    record.reconciliation_status ??
    record.workflowState ??
    record.workflow_state
  );
}

function workflowStatus(record: Record<string, unknown>): string {
  return normalized(record.workflowState ?? record.workflow_state ?? record.status);
}

function isTestRecord(record: Record<string, unknown>): boolean {
  if (record.isTest === true || record.is_test === true) return true;
  return [record.environment, record.ambiente, record.recordType, record.record_type, record.tipo_registro]
    .some((value) => TEST_MARKERS.has(normalized(value)));
}

function amountCents(record: Record<string, unknown>, fields: string[]): number | null {
  for (const field of fields) {
    const value = record[field];
    if (value === null || value === undefined || value === "") continue;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  return null;
}

function competenceOf(record: Record<string, unknown>, context: ProjectionContext): string | null {
  const value = textField(record, ["competence", "competencia", "billingCompetence", "assistentialCompetence"]);
  return value ?? context.competence ?? null;
}

function inContext(record: Record<string, unknown>, context: ProjectionContext): boolean {
  if (!context.competence) return true;
  const competence = competenceOf(record, context);
  return competence === null || competence === context.competence;
}

function evidenceRefs(record: Record<string, unknown>): string[] {
  const pools = [record.evidenceRefs, record.sourceRefs, record.documentRefs, record.evidence_refs, record.source_refs];
  const refs: string[] = [];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const item of pool) {
      if (typeof item === "string" && item.trim()) refs.push(item.trim());
    }
  }
  const direct = textField(record, ["sourceRef", "documentRef", "evidenceRef", "source_ref", "document_ref"]);
  if (direct) refs.push(direct);
  return [...new Set(refs)];
}

function hasTimestamp(record: Record<string, unknown>, fields: string[]): boolean {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return true;
    if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
      const date = (value as { toDate(): Date }).toDate();
      if (date instanceof Date && Number.isFinite(date.getTime())) return true;
    }
  }
  return false;
}

function verifiedEvidenceIds(source: ProjectionSource): Set<string> {
  const ids = new Set<string>();
  source.sourceDocuments.forEach((record, index) => {
    if (isTestRecord(record)) return;
    if (!["VALIDATED", "CLOSED"].includes(workflowStatus(record))) return;
    const id = recordId(record, `document-${index + 1}`);
    if (validEvidenceRef(id)) ids.add(id);
  });
  return ids;
}

function closureEvidenceVerified(record: Record<string, unknown>, verifiedEvidence: ReadonlySet<string>): boolean {
  const refs = evidenceRefs(record);
  return refs.length > 0 && refs.every((ref) => validEvidenceRef(ref) && verifiedEvidence.has(ref));
}

function humanClosureApproved(record: Record<string, unknown>): boolean {
  const reviewState = normalized(record.reviewState ?? record.review_state);
  const reviewer = textField(record, ["reviewerUid", "reviewer_uid", "reviewer", "reviewedBy", "approvedBy"]);
  if (reviewState === "APPROVED" && reviewer && hasTimestamp(record, ["reviewedAt", "reviewed_at", "approvedAt", "approved_at"])) {
    return true;
  }

  const resolutionCode = normalized(record.resolutionCode ?? record.resolution_code);
  const updatedBy = textField(record, ["updatedBy", "updated_by"]);
  return HUMAN_RESOLUTION_CODES.has(resolutionCode) &&
    Boolean(updatedBy) &&
    hasTimestamp(record, ["updatedAt", "updated_at"]);
}

function closureReady(record: Record<string, unknown>, verifiedEvidence: ReadonlySet<string>): boolean {
  return closureEvidenceVerified(record, verifiedEvidence) && humanClosureApproved(record);
}

function trueField(record: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => record[field] === true);
}

function glossClosureCriteriaMet(
  record: Record<string, unknown>,
  source: ProjectionSource,
  verifiedEvidence: ReadonlySet<string>
): boolean {
  const reason = textField(record, ["glossReason", "gloss_reason", "reason", "reasonCode", "motivo", "motivoGlosa", "motivo_glosa"]);
  const basis = textField(record, ["contractualBasis", "contractual_basis", "clinicalBasis", "clinical_basis", "basis", "basisRef", "fundamento", "fundamentoContratual"]);
  if (!reason || !basis) return false;

  const amount = amountCents(record, ["glossAmountCents", "amountCents", "valorCentavos"]);
  if (amount === 0) return true;
  if (trueField(record, ["financialImpactReconciled", "financial_impact_reconciled", "financialReconciled", "impactoFinanceiroConciliado"])) {
    return true;
  }

  const reconciliationId = textField(record, ["reconciliationId", "reconciliation_id"]);
  if (!reconciliationId) return false;
  const reconciliation = source.reconciliations.find((item, index) =>
    !isTestRecord(item) && recordId(item, `reconciliation-${index + 1}`) === reconciliationId
  );
  if (!reconciliation) return false;
  const state = financialStatus(reconciliation);
  return (SETTLED.has(state) || CLOSED.has(state)) && closureReady(reconciliation, verifiedEvidence);
}

function ownerOf(record: Record<string, unknown>): string | null {
  return textField(record, ["owner", "responsible", "responsavel", "assignee", "assignedTo"]);
}

function dueAtOf(record: Record<string, unknown>): string | null {
  return textField(record, ["dueAt", "due_at", "deadline", "prazo"]);
}

function isOverdue(record: Record<string, unknown>, now: Date): boolean {
  const dueAt = dueAtOf(record);
  if (!dueAt) return false;
  const parsed = Date.parse(dueAt);
  return Number.isFinite(parsed) && parsed < now.getTime();
}

function duplicateFlag(record: Record<string, unknown>): boolean {
  return record.isDuplicate === true ||
    record.is_duplicate === true ||
    Boolean(textField(record, ["duplicateOf", "duplicate_of", "supersededBy", "superseded_by"]));
}

function severityFor(record: Record<string, unknown>, now: Date, amount: number | null, fallback: LooseEndSeverity): LooseEndSeverity {
  const explicit = normalized(record.riskLevel ?? record.risk_level ?? record.priority ?? record.prioridade);
  if (["CRITICAL", "CRITICA", "CRITICO"].includes(explicit)) return "CRITICAL";
  if (["HIGH", "ALTA", "ALTO"].includes(explicit)) return "HIGH";
  if (["MEDIUM", "MEDIA", "MEDIO"].includes(explicit)) return "MEDIUM";
  if (["LOW", "BAIXA", "BAIXO"].includes(explicit)) return "LOW";
  if (isOverdue(record, now)) return "HIGH";
  if (amount !== null && amount >= 1000000) return "HIGH";
  return fallback;
}

function looseEnd(
  code: RevenueLooseEndCode,
  stage: RevenueStage,
  record: Record<string, unknown>,
  targetType: string,
  fallbackId: string,
  context: ProjectionContext,
  now: Date,
  fields: string[],
  nextAction: string,
  closureCriteria: string[],
  fallbackSeverity: LooseEndSeverity
): RevenueLooseEnd {
  const targetId = recordId(record, fallbackId);
  const competence = competenceOf(record, context);
  const amount = amountCents(record, fields);
  return {
    id: `${code}:${targetType}:${targetId}:${competence ?? "unknown"}`,
    code,
    stage,
    severity: severityFor(record, now, amount, fallbackSeverity),
    competence,
    targetType,
    targetId,
    amountCents: amount,
    status: financialStatus(record) || "OPEN",
    dueAt: dueAtOf(record),
    owner: ownerOf(record),
    evidenceRefs: evidenceRefs(record),
    nextAction,
    closureCriteria,
    overlapKey: textField(record, ["chainId", "chain_id", "revenueChainId", "revenue_chain_id", "invoiceId", "invoice_id"]) ?? targetId
  };
}

function pushDuplicates(
  records: Array<Record<string, unknown>>,
  targetType: string,
  result: RevenueLooseEnd[],
  context: ProjectionContext,
  now: Date
): void {
  records.forEach((record, index) => {
    if (isTestRecord(record) || !inContext(record, context) || !duplicateFlag(record)) return;
    result.push(looseEnd(
      "DUPLICATE_OR_VERSION_CONFLICT",
      "DIVERGENTE",
      record,
      targetType,
      `${targetType}-${index + 1}`,
      context,
      now,
      ["amountCents", "totalCents", "glossAmountCents", "valorCentavos"],
      "Definir exemplar canônico, preservar histórico e impedir dupla contagem antes de qualquer cálculo ou baixa.",
      ["exemplar canônico identificado", "versões anteriores preservadas", "dupla contagem tecnicamente bloqueada"],
      "HIGH"
    ));
  });
}

export function buildRevenueSanitation(
  source: ProjectionSource,
  now = new Date(),
  context: ProjectionContext = {}
): Record<string, unknown> {
  const looseEnds: RevenueLooseEnd[] = [];
  const verifiedEvidence = verifiedEvidenceIds(source);

  source.invoices.forEach((record, index) => {
    if (isTestRecord(record) || !inContext(record, context)) return;
    const state = financialStatus(record);
    const closureClaimed = SETTLED.has(state) || CLOSED.has(state);
    if (closureClaimed && closureReady(record, verifiedEvidence)) return;
    const workflow = workflowStatus(record);
    const issued = !closureClaimed && (["VALIDATED", "ISSUED", "EMITTED", "EMITIDA", "FATURADO"].includes(workflow) ||
      ["ISSUED", "EMITTED", "EMITIDA", "FATURADO"].includes(state));
    looseEnds.push(looseEnd(
      issued ? "BILLED_NOT_RECEIVED" : "BILLING_EVIDENCE_GAP",
      issued ? "RECEBIVEL" : "DIVERGENTE",
      record,
      "invoice",
      `invoice-${index + 1}`,
      context,
      now,
      ["totalCents", "amountCents", "grossAmountCents", "valorCentavos"],
      issued
        ? "Confrontar nota, prazo contratual, crédito bancário, retenção, glosa e memória de cálculo; manter como recebível até conciliação."
        : "Completar elegibilidade, memória de cálculo e evidência fiscal antes de tratar o item como faturado.",
      issued
        ? ["crédito bancário identificável ou justificativa formal de não pagamento", "conciliação por competência", "evidência vinculada ao documento fiscal"]
        : ["produção elegível validada", "regra contratual aplicável", "documento fiscal ou decisão formal de não faturamento"],
      issued ? "HIGH" : "MEDIUM"
    ));
  });

  source.glosses.forEach((record, index) => {
    if (isTestRecord(record) || !inContext(record, context)) return;
    const state = financialStatus(record);
    const refs = evidenceRefs(record);
    if (ACCEPTED_GLOSS.has(state) && closureReady(record, verifiedEvidence) && glossClosureCriteriaMet(record, source, verifiedEvidence)) return;
    looseEnds.push(looseEnd(
      "GLOSS_UNSUPPORTED_OR_UNRESOLVED",
      "RECUPERAVEL",
      record,
      "gloss",
      `gloss-${index + 1}`,
      context,
      now,
      ["glossAmountCents", "amountCents", "valorCentavos"],
      "Exigir justificativa individualizada, fundamento contratual/assistencial, evidência, responsável, prazo recursal e decisão humana antes de aceitar ou baixar a glosa.",
      ["motivo individual identificado", "fundamento aplicável", "evidência idônea vinculada", "decisão humana registrada", "efeito financeiro conciliado"],
      "HIGH"
    ));
  });

  source.reconciliations.forEach((record, index) => {
    if (isTestRecord(record) || !inContext(record, context)) return;
    const state = financialStatus(record);
    if ((SETTLED.has(state) || CLOSED.has(state)) && closureReady(record, verifiedEvidence)) return;
    looseEnds.push(looseEnd(
      "RECONCILIATION_OPEN",
      "DIVERGENTE",
      record,
      "reconciliation",
      `reconciliation-${index + 1}`,
      context,
      now,
      ["differenceCents", "amountCents", "valorCentavos"],
      "Confrontar origem, competência, documento, valor, versão e destino financeiro até eliminar diferença ou registrar justificativa aceita.",
      ["diferença explicada", "documentos vinculados", "competência e versão canônicas", "revisão humana concluída"],
      "MEDIUM"
    ));
  });

  source.actionItems.forEach((record, index) => {
    if (isTestRecord(record) || !inContext(record, context)) return;
    const state = financialStatus(record);
    if (CLOSED.has(state) && closureReady(record, verifiedEvidence)) return;
    const overdue = isOverdue(record, now);
    looseEnds.push(looseEnd(
      overdue ? "FOLLOWUP_SLA_BREACH" : "FOLLOWUP_OPEN",
      "DIVERGENTE",
      record,
      "actionItem",
      `action-${index + 1}`,
      context,
      now,
      ["amountCents", "impactCents", "valorCentavos"],
      overdue
        ? "Escalonar a pendência vencida, registrar nova cobrança/ação permitida e manter o item aberto até evidência de resolução."
        : "Acompanhar responsável e prazo; não encerrar por silêncio, ausência de resposta ou simples envio de cobrança.",
      ["resposta ou documento recebido", "efeito na cadeia de receita atualizado", "evidência de resolução vinculada"],
      overdue ? "HIGH" : "LOW"
    ));
  });

  source.auditFindings.forEach((record, index) => {
    if (isTestRecord(record) || !inContext(record, context)) return;
    const state = financialStatus(record);
    if (CLOSED.has(state) && closureReady(record, verifiedEvidence)) return;
    looseEnds.push(looseEnd(
      "AUDIT_FINDING_OPEN",
      "DIVERGENTE",
      record,
      "auditFinding",
      `finding-${index + 1}`,
      context,
      now,
      ["amountCents", "financialImpactCents", "valorCentavos"],
      "Vincular causa-raiz, materialidade, responsável, plano de ação e evidência de conclusão; reabrir automaticamente se nova evidência contrariar o encerramento.",
      ["causa-raiz registrada", "plano executado", "evidência pós-ação", "impacto financeiro reconciliado"],
      "MEDIUM"
    ));
  });

  source.sourceDocuments.forEach((record, index) => {
    if (isTestRecord(record) || !inContext(record, context)) return;
    const workflow = workflowStatus(record);
    if (!["PENDING_EVIDENCE", "BLOCKED", "FAILED", "QUARANTINED"].includes(workflow)) return;
    looseEnds.push(looseEnd(
      "EVIDENCE_GAP",
      "DIVERGENTE",
      record,
      "sourceDocument",
      `document-${index + 1}`,
      context,
      now,
      ["amountCents", "valorCentavos"],
      "Obter ou validar a fonte faltante sem alterar o documento original; registrar proveniência, versão e vínculo com a exceção.",
      ["fonte válida recebida", "proveniência preservada", "versão canônica definida", "vínculo com a cadeia de receita registrado"],
      "MEDIUM"
    ));
  });

  pushDuplicates(source.invoices, "invoice", looseEnds, context, now);
  pushDuplicates(source.glosses, "gloss", looseEnds, context, now);
  pushDuplicates(source.sourceDocuments, "sourceDocument", looseEnds, context, now);
  pushDuplicates(source.reconciliations, "reconciliation", looseEnds, context, now);

  const unique = [...new Map(looseEnds.map((item) => [item.id, item])).values()]
    .sort((a, b) => {
      const severity = SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity];
      if (severity !== 0) return severity;
      const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return (b.amountCents ?? -1) - (a.amountCents ?? -1);
    });

  const byCode: Record<string, number> = {};
  const bySeverity: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const item of unique) {
    byCode[item.code] = (byCode[item.code] ?? 0) + 1;
    bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
  }

  const overdueCount = unique.filter((item) => item.dueAt !== null && Number.isFinite(Date.parse(item.dueAt)) && Date.parse(item.dueAt) < now.getTime()).length;
  const unownedCount = unique.filter((item) => item.owner === null).length;
  const evidenceGapCount = unique.filter((item) =>
    item.evidenceRefs.length === 0 ||
    item.evidenceRefs.some((ref) => !validEvidenceRef(ref) || !verifiedEvidence.has(ref)) ||
    ["EVIDENCE_GAP", "GLOSS_UNSUPPORTED_OR_UNRESOLVED", "BILLING_EVIDENCE_GAP"].includes(item.code)
  ).length;

  return {
    engine: "AURORA_REVENUE_SANITATION",
    version: AURORA_REVENUE_SANITATION_VERSION,
    state: unique.length === 0 ? "CLEAR_WITH_AVAILABLE_EVIDENCE" : "OPEN",
    openCount: unique.length,
    overdueCount,
    unownedCount,
    evidenceGapCount,
    byCode,
    bySeverity,
    aggregateAmountCents: null,
    aggregationRule: "NO_SUM_ACROSS_POTENTIALLY_OVERLAPPING_EXCEPTIONS",
    closureRule: "ENCERRADO_SOMENTE_COM_EVIDENCIA_E_VALIDACAO_HUMANA",
    stages: ["PREVISTO", "FATURAVEL", "FATURADO", "RECEBIVEL", "RECEBIDO", "RECUPERAVEL", "DIVERGENTE", "ENCERRADO_COM_EVIDENCIA"],
    looseEnds: unique
  };
}
