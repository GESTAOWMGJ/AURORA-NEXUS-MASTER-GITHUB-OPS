import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  AURORA_MODULES,
  DASHBOARD_PROJECTION_ENGINE_VERSION,
  DASHBOARD_SNAPSHOT_SCHEMA_VERSION,
  buildProjection,
  parseActionCommand,
  type ProjectionSource
} from "../src/auroraEngine.ts";

function source(overrides: Partial<ProjectionSource> = {}): ProjectionSource {
  return { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [], ...overrides };
}

const context = { orgId: "wmgj", competence: "2026-09" };

function invoiceEntityId(entityKey: string): string {
  return createHash("sha256").update(`invoice:${entityKey}`).digest("hex").slice(0, 48);
}

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
      { entityKey: "invoice:nf-1", totalCents: 10001, workflowState: "VALIDATED", competence: "2026-09" },
      { entityKey: "invoice:nf-2", totalCents: 2500, workflowState: "CLOSED", competence: "2026-09" },
      { entityKey: "invoice:nf-review", totalCents: 9900, workflowState: "PENDING_HUMAN_REVIEW", competence: "2026-09" },
      { entityKey: "invoice:nf-old", totalCents: 8800, workflowState: "VALIDATED", competence: "2026-08" }
    ],
    bankTransactions: [
      {
        status: "LIQUIDATED", amountCents: 4000, transactionKind: "RECEIPT",
        invoiceEntityId: invoiceEntityId("invoice:nf-1"), workflowState: "VALIDATED", competence: "2026-09"
      },
      { status: "PENDING", amountCents: 9000, transactionKind: "RECEIPT", workflowState: "VALIDATED", competence: "2026-09" }
    ],
    glosses: [{ glossAmountCents: 501, workflowState: "VALIDATED", competence: "2026-09" }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.deepEqual(projection.financialCents, { invoicedCents: 12501, receivedCents: 4000, glossCents: 501, outstandingCents: 8501 });
  assert.equal(projection.schemaVersion, DASHBOARD_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(DASHBOARD_SNAPSHOT_SCHEMA_VERSION, 3);
  assert.equal(DASHBOARD_PROJECTION_ENGINE_VERSION, 3);
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
    invoices: [{ entityKey: "invoice:zero", totalCents: 0, workflowState: "VALIDATED", competence: "2026-09" }],
    bankTransactions: [{
      status: "CONCILIADO", amountCents: 100, transactionKind: "RECEIPT",
      invoiceEntityId: invoiceEntityId("invoice:zero"), workflowState: "VALIDATED", competence: "2026-09"
    }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.equal(zero.financialCents.invoicedCents, 0);
  assert.equal(zero.financialCents.receivedCents, 100);
  assert.equal(zero.financialCents.outstandingCents, -100);
  assert.equal(zero.financial.pendingAmount, 0);
  assert.equal(zero.financial.reconciliationDifference, -1);
});

test("saída bancária conciliada nunca é contabilizada como recebimento", () => {
  const projection = buildProjection(source({
    invoices: [{ entityKey: "invoice:nf-disbursement", totalCents: 1000, workflowState: "VALIDATED", competence: "2026-09" }],
    bankTransactions: [{
      status: "RECONCILED",
      amountCents: 1000,
      transactionKind: "DISBURSEMENT",
      workflowState: "VALIDATED",
      competence: "2026-09"
    }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;

  assert.equal(projection.financialCents.receivedCents, null);
  assert.equal(projection.financialCents.outstandingCents, null);
  assert.equal(projection.dataQuality.invalidFinancialRecords, 0);
  assert.equal(projection.dataQuality.complete, true);
});

test("recebimento conciliado sem vínculo verificável bloqueia a projeção", () => {
  const projection = buildProjection(source({
    invoices: [{ entityKey: "invoice:nf-link", totalCents: 1000, workflowState: "VALIDATED", competence: "2026-09" }],
    bankTransactions: [{
      status: "RECONCILED",
      amountCents: 1000,
      transactionKind: "RECEIPT",
      workflowState: "VALIDATED",
      competence: "2026-09"
    }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;

  assert.equal(projection.financialCents.receivedCents, null);
  assert.equal(projection.financialCents.outstandingCents, null);
  assert.equal(projection.dataQuality.invalidFinancialRecords, 1);
  assert.equal(projection.dataQuality.complete, false);
  assert.equal(projection.state, "BLOCKED_DATA_QUALITY");
});

test("vínculo com NF ausente, não validada ou de outra competência falha fechado", () => {
  for (const invoices of [
    [],
    [{ entityKey: "invoice:nf-link", totalCents: 1000, workflowState: "PENDING_HUMAN_REVIEW", competence: "2026-09" }],
    [{ entityKey: "invoice:nf-link", totalCents: 1000, workflowState: "VALIDATED", competence: "2026-08" }]
  ]) {
    const projection = buildProjection(source({
      invoices,
      bankTransactions: [{
        status: "MATCHED",
        liquidatedAmountCents: 1000,
        transactionKind: "RECEIPT",
        invoiceEntityId: invoiceEntityId("invoice:nf-link"),
        workflowState: "VALIDATED",
        competence: "2026-09"
      }]
    }), new Date("2026-09-27T12:00:00Z"), context) as any;
    assert.equal(projection.financialCents.receivedCents, null);
    assert.equal(projection.dataQuality.invalidFinancialRecords, 1);
    assert.equal(projection.state, "BLOCKED_DATA_QUALITY");
  }
});

test("transação liquidada legada sem discriminador canônico bloqueia em vez de somar", () => {
  const projection = buildProjection(source({
    bankTransactions: [{ status: "LIQUIDATED", amountCents: 500, workflowState: "VALIDATED", competence: "2026-09" }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.equal(projection.financialCents.receivedCents, null);
  assert.equal(projection.dataQuality.invalidFinancialRecords, 1);
  assert.equal(projection.state, "BLOCKED_DATA_QUALITY");
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

  const entityKey = "invoice:nf-e2e";
  const projection = buildProjection(source({
    invoices: [{ entityKey, totalCents: 123456, workflowState: "VALIDATED", competence }],
    bankTransactions: [{
      ...adapted,
      transactionKind: "RECEIPT",
      invoiceEntityId: invoiceEntityId(entityKey),
      workflowState: workflow.state,
      competence
    }]
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
    sourceDocuments: [
      { workflowState: "VALIDATED", competence: "2026-09" },
      { workflowState: "QUARANTINED", competence: "2026-09" }
    ],
    reconciliations: [
      { status: "MATCHED", competence: "2026-09" },
      { status: "PENDING", competence: "2026-09" }
    ]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;
  assert.equal(projection.operations.overdueActions, 1);
  assert.equal(projection.coverage.evidencePercent, 50);
  assert.equal(projection.coverage.reconciliationPercent, 50);
});

test("motor mede fragilidade documental SLA fluxo e independência da origem", () => {
  const projection = buildProjection(source({
    sourceDocuments: [
      {
        competence: "2026-09",
        workflowState: "VALIDATED",
        nativeReady: true,
        sourceIndependent: true,
        externalFetchRequired: false,
        externalAiUsed: false,
        documentFragility: "NONE",
        originSystem: "TASY"
      },
      {
        competence: "2026-09",
        workflowState: "PENDING_HUMAN_REVIEW",
        nativeReady: false,
        sourceIndependent: false,
        externalFetchRequired: true,
        externalAiUsed: true,
        documentFragility: "DEGRADED_EXTRACTION",
        missingFieldsCount: 1,
        slaDueAt: "2026-09-26T10:00:00Z",
        originSystem: "MV"
      }
    ]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;

  assert.equal(projection.documentIntelligence.totalDocuments, 2);
  assert.equal(projection.documentIntelligence.sourceIndependentDocuments, 1);
  assert.equal(projection.documentIntelligence.sourceDependentDocuments, 1);
  assert.equal(projection.documentIntelligence.fragileDocuments, 1);
  assert.equal(projection.documentIntelligence.overdueDocumentSla, 1);
  assert.equal(projection.documentIntelligence.pendingDocumentFlow, 1);
  assert.equal(projection.documentIntelligence.externalAiDocuments, 1);
  assert.deepEqual(projection.documentIntelligence.origins, { TASY: 1, MV: 1 });
  assert.equal(projection.nativeDataPlane.storage, "FIRESTORE");
  assert.equal(projection.nativeDataPlane.sourceAccessDuringInference, false);
  assert.equal(projection.organicLoop.humanValidationRequired, true);
});

test("projeção mensal ignora registros sem competência e de outros meses em todas as métricas", () => {
  const currentInvoiceKey = "invoice:nf-current";
  const projection = buildProjection(source({
    invoices: [
      { entityKey: currentInvoiceKey, totalCents: 2000, workflowState: "VALIDATED", competence: "2026-09" },
      { entityKey: "invoice:nf-old", totalCents: 9000, workflowState: "VALIDATED", competence: "2026-08" },
      { entityKey: "invoice:nf-unscoped", totalCents: 7000, workflowState: "VALIDATED" }
    ],
    bankTransactions: [
      {
        status: "RECONCILED", liquidatedAmountCents: 1500, transactionKind: "RECEIPT",
        invoiceEntityId: invoiceEntityId(currentInvoiceKey), workflowState: "VALIDATED", competence: "2026-09"
      },
      { status: "RECONCILED", liquidatedAmountCents: 8000, workflowState: "VALIDATED", competence: "2026-08" }
    ],
    glosses: [
      { glossAmountCents: 100, workflowState: "VALIDATED", competence: "2026-09" },
      { glossAmountCents: 900, workflowState: "VALIDATED", competence: "2026-08" }
    ],
    actionItems: [
      { status: "OPEN", dueAt: "2026-09-01T00:00:00Z", competence: "2026-09" },
      { status: "OPEN", dueAt: "2026-08-01T00:00:00Z", competence: "2026-08" }
    ],
    sourceDocuments: [
      { workflowState: "VALIDATED", nativeReady: true, sourceIndependent: true, competence: "2026-09" },
      { workflowState: "PENDING_HUMAN_REVIEW", competence: "2026-08" }
    ],
    reconciliations: [
      { status: "MATCHED", competence: "2026-09" },
      { status: "PENDING", competence: "2026-08" }
    ],
    auditFindings: [
      { status: "OPEN", riskLevel: "MEDIUM", competence: "2026-09" },
      { status: "OPEN", riskLevel: "CRITICAL", competence: "2026-08" }
    ]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;

  assert.deepEqual(projection.financialCents, {
    invoicedCents: 2000,
    receivedCents: 1500,
    glossCents: 100,
    outstandingCents: 500
  });
  assert.deepEqual(projection.sampleSizes, {
    invoices: 1,
    bankTransactions: 1,
    glosses: 1,
    actionItems: 1,
    sourceDocuments: 1,
    reconciliations: 1,
    auditFindings: 1
  });
  assert.equal(projection.pipeline.total, 5);
  assert.equal(projection.documentIntelligence.totalDocuments, 1);
  assert.equal(projection.operations.openActions, 1);
  assert.equal(projection.operations.overdueActions, 1);
  assert.equal(projection.operations.openFindings, 1);
  assert.equal(projection.audit.criticalFindings, 0);
  assert.equal(projection.coverage.evidencePercent, 100);
  assert.equal(projection.coverage.reconciliationPercent, 100);
  assert.equal(projection.dataQuality.sourcePresent, true);
});

test("somente dados fora da competência equivalem a ausência, nunca a zero", () => {
  const foreign = { competence: "2026-08" };
  const projection = buildProjection(source({
    invoices: [{ ...foreign, entityKey: "invoice:foreign", totalCents: 100, workflowState: "VALIDATED" }],
    bankTransactions: [{ ...foreign, status: "RECONCILED", amountCents: 100, workflowState: "VALIDATED" }],
    glosses: [{ ...foreign, glossAmountCents: 10, workflowState: "VALIDATED" }],
    actionItems: [{ ...foreign, status: "OPEN" }],
    sourceDocuments: [{ ...foreign, workflowState: "VALIDATED" }],
    reconciliations: [{ ...foreign, status: "MATCHED" }],
    auditFindings: [{ ...foreign, status: "OPEN" }]
  }), new Date("2026-09-27T12:00:00Z"), context) as any;

  assert.equal(projection.state, "NO_SOURCE");
  assert.equal(projection.dataQuality.sourcePresent, false);
  assert.deepEqual(projection.financialCents, {
    invoicedCents: null,
    receivedCents: null,
    glossCents: null,
    outstandingCents: null
  });
  assert.ok(Object.values(projection.sampleSizes).every((count) => count === 0));
  assert.equal(projection.coverage.evidencePercent, null);
  assert.equal(projection.coverage.reconciliationPercent, null);
});

test("competência padrão também limita a fonte ao mês de geração", () => {
  const projection = buildProjection(source({
    invoices: [
      { entityKey: "invoice:current-default", totalCents: 100, workflowState: "VALIDATED", competence: "2026-09" },
      { entityKey: "invoice:old-default", totalCents: 900, workflowState: "VALIDATED", competence: "2026-08" }
    ]
  }), new Date("2026-09-27T12:00:00Z")) as any;
  assert.equal(projection.competence, "2026-09");
  assert.equal(projection.financialCents.invoicedCents, 100);
  assert.equal(projection.sampleSizes.invoices, 1);
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
  assert.deepEqual(parseActionCommand({
    type: "CREATE_REVIEW",
    targetType: "managementInput",
    targetId: "mgmt-123",
    title: "Atualizar faturamento",
    details: "Conferir divergências abertas no app.",
    reasonCode: "MANUAL_REVIEW",
    riskLevel: "MEDIUM",
    dueAt: "2026-10-02T23:59:59-03:00",
    competence: "2026-10"
  }), {
    type: "CREATE_REVIEW",
    targetType: "managementInput",
    targetId: "mgmt-123",
    title: "Atualizar faturamento",
    details: "Conferir divergências abertas no app.",
    reasonCode: "MANUAL_REVIEW",
    riskLevel: "MEDIUM",
    dueAt: "2026-10-02T23:59:59-03:00",
    competence: "2026-10"
  });
  assert.equal(parseActionCommand({
    type: "CREATE_REVIEW",
    targetType: "managementInput",
    targetId: "mgmt-124",
    reasonCode: "MANUAL_REVIEW",
    riskLevel: "MEDIUM",
    dueAt: "2026-10-02T23:59:59-03:00",
    competence: "2026-10"
  }), null);
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

test("CREATE_REVIEW bloqueia PHI, marcadores clínicos e narrativa não estruturada", () => {
  const base = {
    type: "CREATE_REVIEW",
    targetType: "managementInput",
    targetId: "mgmt-security-test",
    title: "Revisar divergência operacional",
    details: "Conferir o status na fonte autorizada.",
    reasonCode: "MANUAL_REVIEW",
    riskLevel: "MEDIUM",
    dueAt: "2026-10-31T23:59:59-03:00",
    competence: "2026-10"
  };
  const prohibited = [
    { title: "João da Silva - insuficiência cardíaca" },
    { details: "CPF: 12345678900" },
    { details: "529.982.247-25" },
    { details: "CNS: 123456789012345" },
    { details: "898 0011 6044 0001" },
    { details: "Contato pessoa@example.test" },
    { details: "Paciente João da Silva" },
    { details: "patient synthetic-123" },
    { details: "diagnóstico de hipertensão" },
    { details: { unexpected: "object" } },
    { details: Array.from({ length: 49 }, (_, index) => `item${index}`).join(" ") },
    { details: "Primeira linha\nsegunda linha" }
  ];

  for (const override of prohibited) {
    assert.equal(parseActionCommand({ ...base, ...override }), null, JSON.stringify(override));
  }
});

test("CREATE_REVIEW preserva texto operacional curto e objetivo", () => {
  const command = parseActionCommand({
    type: "CREATE_REVIEW",
    targetType: "managementInput",
    targetId: "mgmt-operational-1",
    title: "Revisar NF-e 123/2026",
    details: "Conferir divergência PENDING_EVIDENCE na fonte autorizada.",
    reasonCode: "DATA_DIVERGENCE",
    riskLevel: "HIGH",
    dueAt: "2026-10-31T23:59:59-03:00",
    competence: "2026-10"
  });

  assert.ok(command?.type === "CREATE_REVIEW");
  assert.equal(command.title, "Revisar NF-e 123/2026");
  assert.equal(command.details, "Conferir divergência PENDING_EVIDENCE na fonte autorizada.");
});

test("mapa operacional preserva os módulos Aurora Nexus 2.3.0", () => {
  assert.deepEqual(AURORA_MODULES[0], ["M01", "Ingestão e Proveniência Documental"]);
  assert.deepEqual(AURORA_MODULES[9], ["M10", "Trilha de Auditoria e Integridade"]);
});
