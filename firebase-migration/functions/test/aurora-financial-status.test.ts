import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildLayFinancialStatus } from "../src/auroraFinancialStatus.ts";

const closing = {
  orgId: "wmgj",
  competence: "2026-09",
  status: "CLOSED",
  distributionGateState: "ELIGIBLE",
  financialCents: {
    forecastCents: 5000000,
    cashBalanceCents: 3600000,
    receivableCents: 1200000,
    distributableCents: 750000
  }
};

test("resumo leigo calcula vencidas, a vencer e janelas de recebimento sem inventar ausência", () => {
  const result = buildLayFinancialStatus({
    orgId: "wmgj",
    competence: "2026-09",
    closing,
    financialEntries: [
      { workflowState: "VALIDATED", kind: "EXPENSE", status: "OPEN", amountCents: 120000, dueDate: "2026-10-02" },
      { workflowState: "VALIDATED", kind: "PAYABLE", status: "OPEN", amountCents: 180000, dueDate: "2026-10-10" },
      { workflowState: "VALIDATED", kind: "REVENUE", status: "OPEN", amountCents: 999999, dueDate: "2026-10-04" }
    ],
    taxObligations: [
      { workflowState: "VALIDATED", status: "OPEN", amountCents: 50000, due_date: "2026-10-05" }
    ],
    invoices: [
      { workflowState: "VALIDATED", status: "OPEN", totalCents: 500000, dueDate: "2026-10-02" },
      { workflowState: "VALIDATED", status: "OPEN", totalCents: 700000, dueDate: "2026-10-10" }
    ],
    now: new Date("2026-10-03T12:00:00Z")
  }) as any;
  assert.equal(result.amounts.overduePayablesCents, 120000);
  assert.equal(result.amounts.upcomingPayablesCents, 230000);
  assert.equal(result.dueDates.currentDueDate, "2026-10-02");
  assert.equal(result.dueDates.nextDueDate, "2026-10-05");
  assert.equal(result.amounts.receivableUntilCurrentDueCents, 500000);
  assert.equal(result.amounts.receivableUntilNextDueCents, 500000);
  assert.equal(result.amounts.revenueToCashGapCents, 1400000);
  assert.equal(result.canApproveDistribution, true);
});

test("sem saldo ou previsão comprovados, diferença permanece null e não zero", () => {
  const result = buildLayFinancialStatus({
    orgId: "wmgj",
    competence: "2026-09",
    closing: { ...closing, financialCents: { distributableCents: 0 }, distributionGateState: "ELIGIBLE" },
    financialEntries: [],
    taxObligations: [],
    invoices: [],
    now: new Date("2026-10-03T12:00:00Z")
  }) as any;
  assert.equal(result.amounts.expectedRevenueCents, null);
  assert.equal(result.amounts.cashBalanceCents, null);
  assert.equal(result.amounts.revenueToCashGapCents, null);
  assert.equal(result.amounts.distributableCents, 0);
  assert.equal(result.amounts.overduePayablesCents, null);
});

test("fonte incompleta ou gate não elegível bloqueia aprovação, mas rejeição permanece decisão humana possível no endpoint", () => {
  const incomplete = buildLayFinancialStatus({
    orgId: "wmgj", competence: "2026-09", closing,
    financialEntries: [], taxObligations: [], invoices: [], sourceComplete: false
  }) as any;
  assert.equal(incomplete.canApproveDistribution, false);
  const blocked = buildLayFinancialStatus({
    orgId: "wmgj", competence: "2026-09",
    closing: { ...closing, distributionGateState: "BLOCKED" },
    financialEntries: [], taxObligations: [], invoices: []
  }) as any;
  assert.equal(blocked.canApproveDistribution, false);
});

test("runtime de decisão registra aprovação, nunca pagamento ou transferência", () => {
  const runtime = fs.readFileSync("src/auroraFinancialDecisionRuntime.ts", "utf8");
  assert.match(runtime, /APPROVED_FOR_DISTRIBUTION/);
  assert.match(runtime, /MFA_REQUIRED/);
  assert.match(runtime, /moneyMoved:\s*false/);
  assert.match(runtime, /automaticPayment:\s*false/);
  assert.match(runtime, /automaticDistribution:\s*false/);
  assert.doesNotMatch(runtime, /executePayment|pix\(|bankTransfer|transferFunds/);
});
