export const RELIABLE_RESULT_POLICY = Object.freeze({
  id: "AURORA-RELIABLE-RESULT-001", version: "1.0.0",
  scope: "PER_ORG_AND_COMPETENCE", deliverVerifiedSubset: true,
  exclusionsVisible: true, unknownIsZero: false, aliasesAreAdditionalDocuments: false,
  financialDecisionAuthorized: false, securityAndIntegrityGatesPreserved: true,
  retryMode: "EXISTING_BOUNDED_IDEMPOTENT_EXECUTOR", newScheduler: false
} as const);

const FINANCIAL_KEYS = ["invoicedCents", "receivedCents", "glossCents"] as const;
export const RELIABLE_FINANCIAL_KEYS = FINANCIAL_KEYS;
export type ReliableFinancialKey = typeof FINANCIAL_KEYS[number];
export type CentsAggregation = {
  value: number | null; valid: number; invalid: number; subtotal: number | null; overflow: boolean;
};
export type ReliableMetric = {
  valueCents: number | null; includedRecords: number; excludedRecords: number;
  totalRecords: number; coveragePercent: number | null; complete: boolean; overflow: boolean;
};
export type ReliableFinancialResult = {
  schemaVersion: "aurora.reliable-financial-result.v1"; orgId: string; competence: string;
  status: "AVAILABLE" | "PARTIAL" | "NO_VERIFIED_VALUE";
  metrics: Record<ReliableFinancialKey, ReliableMetric>;
  includedRecords: number; excludedRecords: number; financialDecisionAuthorized: false;
};

export function buildReliableFinancialResult(
  orgId: string, competence: string, inputs: Record<ReliableFinancialKey, CentsAggregation>
): ReliableFinancialResult {
  const metrics = Object.fromEntries(FINANCIAL_KEYS.map(key => {
    const m = inputs[key], totalRecords = m.valid + m.invalid;
    return [key, {
      valueCents: m.subtotal, includedRecords: m.valid, excludedRecords: m.invalid,
      totalRecords, coveragePercent: totalRecords ? Math.round(m.valid / totalRecords * 10000) / 100 : null,
      complete: m.valid > 0 && m.invalid === 0 && !m.overflow, overflow: m.overflow
    }];
  })) as Record<ReliableFinancialKey, ReliableMetric>;
  const includedRecords = FINANCIAL_KEYS.reduce((n, key) => n + metrics[key].includedRecords, 0);
  const excludedRecords = FINANCIAL_KEYS.reduce((n, key) => n + metrics[key].excludedRecords, 0);
  const available = FINANCIAL_KEYS.some(key => metrics[key].valueCents !== null);
  return {
    schemaVersion: "aurora.reliable-financial-result.v1", orgId, competence,
    status: !available ? "NO_VERIFIED_VALUE" : excludedRecords > 0 ? "PARTIAL" : "AVAILABLE",
    metrics, includedRecords, excludedRecords, financialDecisionAuthorized: false
  };
}

function resultRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function resultCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validate the additive subset proof. Caller must still enforce identity, provenance and freshness. */
export function readReliableFinancialResult(projection: Record<string, unknown>): ReliableFinancialResult | null {
  const r = resultRecord(projection.reliableResult), metrics = resultRecord(r.metrics);

  if (r.schemaVersion !== "aurora.reliable-financial-result.v1"
    || typeof r.orgId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(r.orgId) || r.orgId !== projection.orgId
    || typeof r.competence !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.competence) || r.competence !== projection.competence
    || r.financialDecisionAuthorized !== false) return null;
  const quality = resultRecord(projection.dataQuality), canonical = resultRecord(projection.financialCents);
  const inputs = {} as Record<ReliableFinancialKey, CentsAggregation>;
  for (const key of FINANCIAL_KEYS) {
    const m = resultRecord(metrics[key]);
    if (!resultCount(m.includedRecords) || !resultCount(m.excludedRecords)
      || !resultCount(m.totalRecords) || m.totalRecords !== m.includedRecords + m.excludedRecords
      || typeof m.overflow !== "boolean") return null;
    if (m.overflow && (m.valueCents !== null || m.excludedRecords < 1)) return null;
    if (!m.overflow && (m.includedRecords === 0 ? m.valueCents !== null : !resultCount(m.valueCents))) return null;
    const complete = m.includedRecords > 0 && m.excludedRecords === 0 && !m.overflow;
    const expectedCanonical = complete ? m.valueCents : null;
    if (m.complete !== complete || canonical[key] !== expectedCanonical) return null;
    inputs[key] = { value: expectedCanonical as number | null, valid: m.includedRecords,
      invalid: m.excludedRecords, subtotal: m.valueCents as number | null, overflow: m.overflow };
  }
  const checked = buildReliableFinancialResult(r.orgId, r.competence, inputs);
  if (!resultCount(quality.validFinancialRecords) || !resultCount(quality.invalidFinancialRecords)
    || checked.includedRecords !== quality.validFinancialRecords || checked.excludedRecords !== quality.invalidFinancialRecords
    || checked.includedRecords !== r.includedRecords || checked.excludedRecords !== r.excludedRecords
    || checked.status !== r.status) return null;
  return checked;
}


/** The same subset validation is used by the authenticated browser presentation. */
export function reliableResultClient(): string {
  return "const FINANCIAL_KEYS=" + JSON.stringify(FINANCIAL_KEYS) + ";\n"
    + [buildReliableFinancialResult, resultRecord, resultCount, readReliableFinancialResult]
      .map(helper => helper.toString()).join("\n\n");
}
