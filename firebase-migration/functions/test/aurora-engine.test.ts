import assert from "node:assert/strict";
import test from "node:test";
import { AURORA_MODULES, buildProjection, parseActionCommand, type ProjectionSource } from "../src/auroraEngine.ts";

function source(overrides: Partial<ProjectionSource> = {}): ProjectionSource {
  return { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [], ...overrides };
}

const context = { orgId: "wmgj", competence: "2026-09" };

test("motor financeiro usa centavos inteiros e somente estados validados", () => {
  const projection = buildProjection(source({
    invoices: [
      { totalCents: 10001, workflowState: "VALIDATED", competence: "2026-09" },
      { totalCents: 2500, workflowState: "CLOSED", competence: "2026-09" },
      { totalCents: 9900, workflowState: "PENDING_HUMAN_REVIEW", competence: "2026-09" },
      { totalCents: 8800, workflowState: "VALIDATED", competence: "2026-08" }
    ],
    bankTransactions: [
      { status: "LIQUIDATED", amountCents: 4000, workflowState: "VALIDATED", competence: "2026-09" },
      { status: "PENDING", amountCents: 9000, workflowState: "VALIDATED", competence: "2026-09" }
    ],
    glosses: [{ glossAmountCents: 501, workflowState: "VALIDATED", competence: "2026-09" }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.deepEqual(projection.financialCents, { invoicedCents: 12501, receivedCents: 4000, glossCents: 501, outstandingCents: 8501 });
  assert.equal(projection.financial.billedAmount, 125.01);
  assert.equal(projection.sanitized, true);
  assert.equal(projection.dataQuality.complete, true);
});

test("motor preserva ausência como null, nunca zero", () => {
  const projection = buildProjection(source(), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.deepEqual(projection.financialCents, { invoicedCents: null, receivedCents: null, glossCents: null, outstandingCents: null });
  assert.equal(projection.state, "NO_SOURCE");
  assert.equal(projection.coverage.evidencePercent, null);
  assert.equal(projection.coverage.reconciliationPercent, null);
  assert.equal(projection.modules.length, AURORA_MODULES.length);
});

test("zero conhecido permanece zero e sobrepagamento não é ocultado", () => {
  const zero = buildProjection(source({
    invoices: [{ totalCents: 0, workflowState: "VALIDATED", competence: "2026-09" }],
    bankTransactions: [{ status: "CONCILIADO", amountCents: 100, workflowState: "VALIDATED", competence: "2026-09" }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.equal(zero.financialCents.invoicedCents, 0);
  assert.equal(zero.financialCents.receivedCents, 100);
  assert.equal(zero.financialCents.outstandingCents, -100);
  assert.equal(zero.financial.pendingAmount, 0);
  assert.equal(zero.financial.reconciliationDifference, -1);
});

test("campo financeiro string ou fracionário bloqueia a projeção", () => {
  const projection = buildProjection(source({
    invoices: [
      { totalCents: "1234", workflowState: "VALIDATED", competence: "2026-09" },
      { totalCents: 1.5, workflowState: "VALIDATED", competence: "2026-09" }
    ]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.equal(projection.financialCents.invoicedCents, null);
  assert.equal(projection.dataQuality.complete, false);
  assert.equal(projection.dataQuality.invalidFinancialRecords, 2);
  assert.equal(projection.state, "BLOCKED_DATA_QUALITY");
});

test("motor calcula SLA, cobertura e filtra competência", () => {
  const projection = buildProjection(source({
    actionItems: [
      { status: "OPEN", dueAt: "2026-09-26T12:00:00Z", competence: "2026-09" },
      { status: "OPEN", dueAt: "2026-09-20T12:00:00Z", competence: "2026-08" },
      { status: "RESOLVED", dueAt: "2026-09-20T12:00:00Z", competence: "2026-09" }
    ],
    sourceDocuments: [{ workflowState: "VALIDATED" }, { workflowState: "QUARANTINED" }],
    reconciliations: [{ status: "MATCHED" }, { status: "PENDING" }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.equal(projection.operations.overdueActions, 1);
  assert.equal(projection.coverage.evidencePercent, 50);
  assert.equal(projection.coverage.reconciliationPercent, 50);
});

test("comandos exigem SLA, competência, códigos e evidência", () => {
  assert.deepEqual(parseActionCommand({
    type: "CREATE_REVIEW",
    targetType: "invoice",
    targetId: "NF-1",
    reasonCode: "MISSING_EVIDENCE",
    riskLevel: "HIGH",
    dueAt: "2026-09-30T23:59:59-03:00",
    competence: "2026-09"
  }), {
    type: "CREATE_REVIEW",
    targetType: "invoice",
    targetId: "NF-1",
    reasonCode: "MISSING_EVIDENCE",
    riskLevel: "HIGH",
    dueAt: "2026-09-30T23:59:59-03:00",
    competence: "2026-09"
  });
  assert.equal(parseActionCommand({ type: "CREATE_REVIEW", targetType: "invoice", targetId: "NF-1", reasonCode: "texto livre", riskLevel: "HIGH" }), null);
  assert.equal(parseActionCommand({ type: "RESOLVE", actionId: "A-1", expectedRevision: 1, resolutionCode: "SOURCE_CORRECTED" }), null);
  assert.deepEqual(parseActionCommand({ type: "RESOLVE", actionId: "A-1", expectedRevision: 1, resolutionCode: "SOURCE_CORRECTED", evidenceRefs: ["doc:1"] }), {
    type: "RESOLVE", actionId: "A-1", expectedRevision: 1, resolutionCode: "SOURCE_CORRECTED", evidenceRefs: ["doc:1"]
  });
  assert.equal(parseActionCommand({ type: "PAY_INVOICE", actionId: "A-1", expectedRevision: 1 }), null);
});

test("mapa operacional preserva os módulos Aurora Nexus 2.3.0", () => {
  assert.deepEqual(AURORA_MODULES[0], ["M01", "Ingestão e Proveniência Documental"]);
  assert.deepEqual(AURORA_MODULES[9], ["M10", "Trilha de Auditoria e Integridade"]);
});
