import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { AURORA_MODULES, buildProjection, parseActionCommand, type ProjectionSource } from "../src/auroraEngine.ts";

function source(overrides: Partial<ProjectionSource> = {}): ProjectionSource {
  return { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [], ...overrides };
}

const context = { orgId: "wmgj", competence: "2026-09" };

function migrationAdapterContext(): Record<string, unknown> {
  const adapter: Record<string, unknown> = {};
  vm.createContext(adapter);
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationRoot = path.resolve(testDir, "../..");
  for (const relative of ["apps-script/FirestoreBridge.gs", "apps-script/MigrationDryRun.gs"]) {
    vm.runInContext(fs.readFileSync(path.join(migrationRoot, relative), "utf8"), adapter, { filename: relative });
  }
  return adapter;
}

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
  assert.equal(projection.schemaVersion, 2);
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

test("motor exclui TESTE em campos camelCase e snake_case sem excluir operação homologada", () => {
  const projection = buildProjection(source({
    invoices: [
      { totalCents: 100, workflowState: "VALIDATED", competence: "2026-09", environment: "TESTE" },
      { totalCents: 200, workflowState: "VALIDATED", competence: "2026-09", recordType: "TEST" },
      { totalCents: 300, workflowState: "VALIDATED", competence: "2026-09", record_type: "teste" },
      { totalCents: 400, workflowState: "VALIDATED", competence: "2026-09", is_test: true },
      { totalCents: 500, workflow_state: "VALIDATED", competence: "2026-09", environment: "HOMOLOGATION", record_type: "OPERACIONAL" }
    ]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.equal(projection.financialCents.invoicedCents, 500);
  assert.equal(projection.dataQuality.validFinancialRecords, 1);
  assert.equal(projection.sampleSizes.invoices, 1);
});

test("motor trata fonte composta somente por TESTE como sem fonte operacional", () => {
  const projection = buildProjection(source({
    invoices: [{ totalCents: 100, workflowState: "VALIDATED", competence: "2026-09", record_type: "TESTE" }],
    sourceDocuments: [{ workflowState: "VALIDATED", environment: "TESTE" }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.equal(projection.state, "NO_SOURCE");
  assert.equal(projection.financialCents.invoicedCents, null);
  assert.equal(projection.coverage.evidencePercent, null);
  assert.equal(projection.sampleSizes.invoices, 0);
  assert.equal(projection.sampleSizes.sourceDocuments, 0);
});

test("E2E sanitizado adapta Sheet pt-BR e projeta recebimento em centavos", () => {
  const adapter = migrationAdapterContext() as any;
  const headers = ["Competência", "Status Conciliação", "Environment", "Record Type", "Valor"];
  const display = ["09/2026", "LIQUIDADO", "HOMOLOGATION", "OPERACIONAL", "R$ 1.234,56"];
  const raw = ["09/2026", "LIQUIDADO", "HOMOLOGATION", "OPERACIONAL", 1234.56];
  const mapping = adapter.wmgjFirestoreMigrationMap_()["08_EXTRATOS_BRADESCO"];
  const sourceRecord = adapter.wmgjFirestoreRowObject_(headers, display);
  const adapted = adapter.wmgjFirestoreAddCanonicalMoney_(
    headers,
    raw,
    display,
    sourceRecord,
    mapping.moneyFields
  );
  const workflow = adapter.wmgjFirestoreWorkflowFromLegacy_(adapted.status_conciliacao, mapping.entityType);
  const competence = adapter.wmgjFirestoreFindCompetence_(adapted);

  assert.equal(adapted.valor, "R$ 1.234,56");
  assert.equal(adapted.amountCents, 123456);
  assert.equal(adapted.environment, "HOMOLOGATION");
  assert.equal(adapted.record_type, "OPERACIONAL");
  assert.equal(workflow.state, "VALIDATED");
  assert.equal(competence, "2026-09");

  const projection = buildProjection(source({
    bankTransactions: [{ ...adapted, workflowState: workflow.state, competence }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;

  assert.equal(projection.financialCents.receivedCents, 123456);
  assert.equal(projection.financial.receivedAmount, 1234.56);
  assert.equal(projection.dataQuality.invalidFinancialRecords, 0);
  assert.equal(projection.sanitized, true);
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
  assert.equal(parseActionCommand({ type: "RESOLVE", actionId: "A-1", expectedRevision: 1, resolutionCode: "EVIDENCE_CONFIRMED", evidenceRefs: ["doc:1", "doc:1"] }), null);
  assert.equal(parseActionCommand({ type: "RESOLVE", actionId: "A-1", expectedRevision: 1, resolutionCode: "EVIDENCE_CONFIRMED", evidenceRefs: ["organizations/other/sourceDocuments/doc:1"] }), null);
  assert.equal(parseActionCommand({ type: "RESOLVE", actionId: "../other/action", expectedRevision: 1, resolutionCode: "EVIDENCE_CONFIRMED", evidenceRefs: ["doc:1"] }), null);
  assert.equal(parseActionCommand({ type: "PAY_INVOICE", actionId: "A-1", expectedRevision: 1 }), null);
});

test("mapa operacional preserva os módulos Aurora Nexus 2.3.0", () => {
  assert.deepEqual(AURORA_MODULES[0], ["M01", "Ingestão e Proveniência Documental"]);
  assert.deepEqual(AURORA_MODULES[9], ["M10", "Trilha de Auditoria e Integridade"]);
});
