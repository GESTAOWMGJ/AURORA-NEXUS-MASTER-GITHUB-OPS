import { createHash } from "node:crypto";

export type DistributionDecision = "APPROVE" | "REJECT";

const CLOSED_WORKFLOW = new Set(["VALIDATED", "CLOSED"]);
const PAYABLE_CLOSED = new Set(["PAID", "SETTLED", "LIQUIDATED", "CLOSED", "PAGO", "QUITADO", "CANCELLED", "CANCELADO"]);
const RECEIVABLE_CLOSED = new Set(["RECEIVED", "PAID", "SETTLED", "LIQUIDATED", "CLOSED", "RECEBIDO", "PAGO", "QUITADO", "CANCELLED", "CANCELADO"]);
const EXPENSE_KINDS = new Set(["EXPENSE", "PAYABLE", "DESPESA", "CONTA_A_PAGAR", "COST", "CUSTO", "TAX", "TRIBUTO", "IMPOSTO"]);

function normalized(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
      return (value as { toDate(): Date }).toDate().toISOString();
    }
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((out, key) => {
      const v = (value as Record<string, unknown>)[key];
      if (!["updatedAt", "createdAt", "serverAt"].includes(key)) out[key] = stable(v);
      return out;
    }, {});
  }
  return value;
}

export function financialClosingHash(closing: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(stable(closing))).digest("hex");
}

function safeCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function firstCents(record: Record<string, unknown>, fields: string[]): number | null {
  for (const key of fields) {
    if (!(key in record) || record[key] === null || record[key] === undefined || record[key] === "") continue;
    return safeCents(record[key]);
  }
  return null;
}

function isoDateOnly(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString().slice(0, 10);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Number.isFinite(Date.parse(text + "T12:00:00Z")) ? text : null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function dueDate(record: Record<string, unknown>): string | null {
  for (const key of ["dueDate", "due_date", "data_vencimento", "dueAt"]) {
    const parsed = isoDateOnly(record[key]);
    if (parsed) return parsed;
  }
  return null;
}

function statusOf(record: Record<string, unknown>): string {
  for (const key of ["status", "workflowState", "workflow_state", "state", "situacao"]) {
    const value = normalized(record[key]);
    if (value) return value;
  }
  return "";
}

function isValidated(record: Record<string, unknown>): boolean {
  const workflow = normalized(record.workflowState ?? record.workflow_state);
  return CLOSED_WORKFLOW.has(workflow);
}

function explicitExpense(record: Record<string, unknown>): boolean {
  return [record.kind, record.type, record.category, record.nature, record.natureza]
    .some((value) => EXPENSE_KINDS.has(normalized(value)));
}

type DatedAmount = { date: string; cents: number };

function payableRows(
  financialEntries: Array<Record<string, unknown>>,
  taxObligations: Array<Record<string, unknown>>
): DatedAmount[] {
  const rows: DatedAmount[] = [];
  const add = (record: Record<string, unknown>, forcedExpense: boolean) => {
    if (!isValidated(record) || PAYABLE_CLOSED.has(statusOf(record))) return;
    if (!forcedExpense && !explicitExpense(record)) return;
    const date = dueDate(record);
    const cents = firstCents(record, ["amountCents", "amount_cents", "expenseAmountCents", "expense_amount_cents", "valorCentavos", "taxAmountCents", "valor_imposto"]);
    if (!date || cents === null) return;
    rows.push({ date, cents });
  };
  financialEntries.forEach((record) => add(record, false));
  taxObligations.forEach((record) => add(record, true));
  return rows;
}

function receivableRows(invoices: Array<Record<string, unknown>>): DatedAmount[] {
  const rows: DatedAmount[] = [];
  for (const record of invoices) {
    if (!isValidated(record) || RECEIVABLE_CLOSED.has(statusOf(record))) continue;
    const date = dueDate(record);
    const cents = firstCents(record, ["receivableCents", "receivable_cents", "totalCents", "total_cents", "amountCents", "amount_cents", "grossAmountCents", "valorCentavos", "valor_total", "valor_nf", "valor_nota", "valor_nfs_e", "valor_nfse"]);
    if (!date || cents === null) continue;
    rows.push({ date, cents });
  }
  return rows;
}

function safeSum(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    const next = total + value;
    if (!Number.isSafeInteger(next)) return null;
    total = next;
  }
  return total;
}

function sumThrough(rows: DatedAmount[], date: string | null): number | null {
  if (!date) return null;
  return safeSum(rows.filter((row) => row.date <= date).map((row) => row.cents));
}

function closingFinancial(closing: Record<string, unknown>): Record<string, unknown> {
  return isRecord(closing.financialCents) ? closing.financialCents : {};
}

function currentDecisionView(decision: Record<string, unknown> | null, currentHash: string): Record<string, unknown> | null {
  if (!decision || decision.snapshotHash !== currentHash) return null;
  const decidedAt = decision.decidedAt && typeof decision.decidedAt === "object" && "toDate" in decision.decidedAt
    ? (decision.decidedAt as { toDate(): Date }).toDate().toISOString()
    : typeof decision.decidedAt === "string" ? decision.decidedAt : null;
  return {
    decision: decision.decision ?? null,
    managerEmail: decision.managerEmail ?? null,
    managerRole: decision.managerRole ?? null,
    reason: decision.reason ?? null,
    decidedAt,
    amountCents: safeCents(decision.amountCents),
    revision: Number.isSafeInteger(decision.revision) ? decision.revision : null
  };
}

export function buildLayFinancialStatus(input: {
  orgId: string;
  competence: string;
  closing: Record<string, unknown> | null;
  financialEntries: Array<Record<string, unknown>>;
  taxObligations: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  currentDecision?: Record<string, unknown> | null;
  sourceComplete?: boolean;
  now?: Date;
}): Record<string, unknown> {
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  if (!input.closing) {
    return {
      schemaVersion: 1,
      orgId: input.orgId,
      competence: input.competence,
      state: "NO_CLOSING",
      generatedAt: now.toISOString(),
      amounts: {},
      dueDates: {},
      canApproveDistribution: false,
      decision: null,
      sourceComplete: input.sourceComplete !== false,
      sanitized: true
    };
  }

  const closing = input.closing;
  const hash = financialClosingHash(closing);
  const financial = closingFinancial(closing);
  const sourceComplete = input.sourceComplete !== false;
  const payables = sourceComplete ? payableRows(input.financialEntries, input.taxObligations) : [];
  const receivables = sourceComplete ? receivableRows(input.invoices) : [];
  const dates = [...new Set(payables.map((row) => row.date))].sort();
  const currentDueDate = sourceComplete ? dates[0] ?? null : null;
  const nextDueDate = sourceComplete ? dates[1] ?? null : null;
  const overdue = sourceComplete ? safeSum(payables.filter((row) => row.date < today).map((row) => row.cents)) : null;
  const upcoming = sourceComplete ? safeSum(payables.filter((row) => row.date >= today).map((row) => row.cents)) : null;
  const currentDueCents = sourceComplete && currentDueDate ? safeSum(payables.filter((row) => row.date === currentDueDate).map((row) => row.cents)) : null;
  const nextDueCents = sourceComplete && nextDueDate ? safeSum(payables.filter((row) => row.date === nextDueDate).map((row) => row.cents)) : null;

  const expectedRevenueCents = safeCents(financial.forecastCents);
  const cashBalanceCents = safeCents(financial.cashBalanceCents);
  const distributableCents = safeCents(financial.distributableCents);
  const revenueToCashGapCents = expectedRevenueCents === null || cashBalanceCents === null
    ? null
    : Math.max(0, expectedRevenueCents - cashBalanceCents);
  const gate = normalized(closing.distributionGateState ?? closing.distributionGate ?? closing.gateStatus);
  const closingStatus = normalized(closing.status);
  const canApproveDistribution = sourceComplete
    && closingStatus === "CLOSED"
    && gate === "ELIGIBLE"
    && distributableCents !== null;

  return {
    schemaVersion: 1,
    orgId: input.orgId,
    competence: input.competence,
    state: canApproveDistribution ? "READY_FOR_MANAGER_DECISION" : closingStatus === "CLOSED" ? "VALIDATION_REQUIRED" : "CLOSING_OPEN",
    generatedAt: now.toISOString(),
    snapshotHash: hash,
    closingStatus,
    distributionGateState: gate || null,
    amounts: {
      overduePayablesCents: sourceComplete && payables.length ? overdue : null,
      upcomingPayablesCents: sourceComplete && payables.length ? upcoming : null,
      currentDueCents,
      nextDueCents,
      expectedRevenueCents,
      cashBalanceCents,
      revenueToCashGapCents,
      receivableUntilCurrentDueCents: sumThrough(receivables, currentDueDate),
      receivableUntilNextDueCents: sumThrough(receivables, nextDueDate),
      totalReceivableCents: safeCents(financial.receivableCents),
      distributableCents
    },
    dueDates: { currentDueDate, nextDueDate },
    counts: {
      openPayables: payables.length,
      openReceivablesWithDueDate: receivables.length
    },
    canApproveDistribution,
    decision: currentDecisionView(input.currentDecision ?? null, hash),
    sourceComplete,
    governance: {
      absenceIsZero: false,
      approvalMovesMoney: false,
      automaticDistribution: false,
      managerDecisionRequired: true,
      mfaRequiredForApproval: true
    },
    sanitized: true
  };
}
