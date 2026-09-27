import assert from "node:assert/strict";
import test from "node:test";
import { AURORA_MODULES, buildProjection, parseActionCommand, type ProjectionSource } from "../src/auroraEngine.ts";

function source(overrides: Partial<ProjectionSource> = {}): ProjectionSource {
  return { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [], ...overrides };
}

test("motor financeiro usa centavos inteiros e somente recebimentos liquidados", () => {
  const projection = buildProjection(source({
    invoices: [{ amountCents: 10001 }, { totalCents: 2500 }, { amountCents: 1.5 }],
    bankTransactions: [{ status: "LIQUIDATED", amountCents: 4000 }, { status: "PENDING", amountCents: 9000 }],
    glosses: [{ glossAmountCents: 501 }]
  }), new Date("2026-09-27T12:00:00Z")) as any;
  assert.deepEqual(projection.financial, { invoicedCents: 12501, receivedCents: 4000, glossCents: 501, outstandingCents: 8501 });
  assert.equal(projection.sanitized, true);
});

test("motor preserva sem fonte como null, não como zero", () => {
  const projection = buildProjection(source()) as any;
  assert.equal(projection.coverage.evidencePercent, null);
  assert.equal(projection.coverage.reconciliationPercent, null);
  assert.equal(projection.modules.length, AURORA_MODULES.length);
});

test("motor calcula SLA vencido e cobertura", () => {
  const projection = buildProjection(source({
    actionItems: [{ status: "OPEN", dueAt: "2026-09-26T12:00:00Z" }, { status: "RESOLVED", dueAt: "2026-09-20T12:00:00Z" }],
    sourceDocuments: [{ workflowState: "VALIDATED" }, { workflowState: "QUARANTINED" }],
    reconciliations: [{ status: "MATCHED" }, { status: "PENDING" }]
  }), new Date("2026-09-27T12:00:00Z")) as any;
  assert.equal(projection.operations.overdueActions, 1);
  assert.equal(projection.coverage.evidencePercent, 50);
  assert.equal(projection.coverage.reconciliationPercent, 50);
});

test("comandos aceitam apenas códigos enumerados e revisão esperada", () => {
  assert.deepEqual(parseActionCommand({ type: "CREATE_REVIEW", targetType: "invoice", targetId: "NF-1", reasonCode: "MISSING_EVIDENCE", riskLevel: "HIGH" }), {
    type: "CREATE_REVIEW", targetType: "invoice", targetId: "NF-1", reasonCode: "MISSING_EVIDENCE", riskLevel: "HIGH"
  });
  assert.equal(parseActionCommand({ type: "CREATE_REVIEW", targetType: "invoice", targetId: "NF-1", reasonCode: "texto livre", riskLevel: "HIGH" }), null);
  assert.equal(parseActionCommand({ type: "RESOLVE", actionId: "A-1", expectedRevision: 0, resolutionCode: "SOURCE_CORRECTED" }), null);
  assert.equal(parseActionCommand({ type: "PAY_INVOICE", actionId: "A-1", expectedRevision: 1 }), null);
});
