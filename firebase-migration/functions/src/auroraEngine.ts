export const AURORA_MODULES = [
  ["M01", "Cadastros e governança"],
  ["M02", "Contratos e regras"],
  ["M03", "Produção e escalas"],
  ["M04", "Faturamento"],
  ["M05", "Conciliação"],
  ["M06", "Glosas e recursos"],
  ["M07", "Contas hospitalares"],
  ["M08", "Qualidade e SLA"],
  ["M09", "Auditoria e IA"],
  ["M10", "Integrações e operação"]
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

function integerCents(record: Record<string, unknown>, fields: string[]): number {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  }
  return 0;
}

function countWhere(records: Array<Record<string, unknown>>, predicate: (item: Record<string, unknown>) => boolean): number {
  return records.reduce((total, item) => total + (predicate(item) ? 1 : 0), 0);
}

function epochMillis(value: unknown): number {
  if (typeof value === "string") return Date.parse(value);
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().getTime();
  }
  return NaN;
}

export function buildProjection(source: ProjectionSource, now = new Date()): Record<string, unknown> {
  const invoicedCents = source.invoices.reduce(
    (sum, item) => sum + integerCents(item, ["totalCents", "amountCents", "grossAmountCents", "valorCentavos"]), 0
  );
  const receivedCents = source.bankTransactions.reduce((sum, item) => {
    const status = String(item.status ?? "").toUpperCase();
    if (!["LIQUIDATED", "RECONCILED", "MATCHED"].includes(status)) return sum;
    return sum + integerCents(item, ["liquidatedAmountCents", "amountCents", "valorCentavos"]);
  }, 0);
  const glossCents = source.glosses.reduce(
    (sum, item) => sum + integerCents(item, ["glossAmountCents", "amountCents", "valorCentavos"]), 0
  );
  const openActions = countWhere(source.actionItems, (item) => !["RESOLVED", "CANCELLED"].includes(String(item.status ?? "OPEN")));
  const overdueActions = countWhere(source.actionItems, (item) => {
    if (["RESOLVED", "CANCELLED"].includes(String(item.status ?? "OPEN"))) return false;
    const dueAt = epochMillis(item.dueAt);
    return Number.isFinite(dueAt) && dueAt < now.getTime();
  });
  const validatedSources = countWhere(source.sourceDocuments, (item) =>
    ["VALIDATED", "CLOSED"].includes(String(item.workflowState ?? ""))
  );
  const reconciled = countWhere(source.reconciliations, (item) =>
    ["MATCHED", "RECONCILED", "CLOSED"].includes(String(item.status ?? item.workflowState ?? ""))
  );
  const openFindings = countWhere(source.auditFindings, (item) =>
    !["RESOLVED", "CLOSED"].includes(String(item.status ?? "OPEN"))
  );

  const ratio = (part: number, total: number): number | null => total === 0 ? null : Math.round((part / total) * 1000) / 10;
  return {
    schemaVersion: 1,
    policyVersion: "aurora-nexus-firebase-shadow-v1",
    sanitized: true,
    sensitivity: "INTERNAL",
    generatedAt: now.toISOString(),
    financial: { invoicedCents, receivedCents, glossCents, outstandingCents: Math.max(0, invoicedCents - receivedCents) },
    operations: { openActions, overdueActions, openFindings },
    coverage: {
      evidencePercent: ratio(validatedSources, source.sourceDocuments.length),
      reconciliationPercent: ratio(reconciled, source.reconciliations.length)
    },
    sampleSizes: Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value.length])),
    modules: AURORA_MODULES.map(([id, name]) => ({ id, name, status: "LEARNING" }))
  };
}

const REASON_CODES = new Set(["DATA_DIVERGENCE", "SLA_BREACH", "MISSING_EVIDENCE", "AUDIT_FINDING", "MANUAL_REVIEW"]);
const RESOLUTION_CODES = new Set(["EVIDENCE_CONFIRMED", "SOURCE_CORRECTED", "FALSE_POSITIVE", "ESCALATED"]);

export type ActionCommand =
  | { type: "CREATE_REVIEW"; targetType: string; targetId: string; reasonCode: string; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }
  | { type: "ACKNOWLEDGE"; actionId: string; expectedRevision: number }
  | { type: "RESOLVE"; actionId: string; expectedRevision: number; resolutionCode: string };

export function parseActionCommand(value: unknown): ActionCommand | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.type === "CREATE_REVIEW") {
    const targetType = typeof body.targetType === "string" ? body.targetType.trim() : "";
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode : "";
    const riskLevel = typeof body.riskLevel === "string" ? body.riskLevel : "";
    if (!targetType || !targetId || targetType.length > 64 || targetId.length > 160 || !REASON_CODES.has(reasonCode)) return null;
    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(riskLevel)) return null;
    return { type: "CREATE_REVIEW", targetType, targetId, reasonCode, riskLevel: riskLevel as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" };
  }
  const actionId = typeof body.actionId === "string" ? body.actionId.trim() : "";
  const expectedRevision = body.expectedRevision;
  if (!actionId || actionId.length > 160 || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) return null;
  if (body.type === "ACKNOWLEDGE") return { type: "ACKNOWLEDGE", actionId, expectedRevision: Number(expectedRevision) };
  if (body.type === "RESOLVE" && typeof body.resolutionCode === "string" && RESOLUTION_CODES.has(body.resolutionCode)) {
    return { type: "RESOLVE", actionId, expectedRevision: Number(expectedRevision), resolutionCode: body.resolutionCode };
  }
  return null;
}
