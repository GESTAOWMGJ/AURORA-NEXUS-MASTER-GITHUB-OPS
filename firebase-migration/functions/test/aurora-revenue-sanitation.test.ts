import assert from "node:assert/strict";
import test from "node:test";
import { buildRevenueSanitation } from "../src/auroraRevenueSanitation.js";
import type { ProjectionSource } from "../src/auroraEngine.js";

function source(overrides: Partial<ProjectionSource> = {}): ProjectionSource {
  return {
    invoices: [],
    bankTransactions: [],
    glosses: [],
    actionItems: [],
    sourceDocuments: [],
    reconciliations: [],
    auditFindings: [],
    ...overrides
  };
}

const now = new Date("2026-09-30T18:00:00Z");
const context = { orgId: "wmgj", competence: "2026-07" };

test("invoice emitida sem conciliação vira ponta solta recebível", () => {
  const result = buildRevenueSanitation(source({
    invoices: [{
      id: "NF11",
      competence: "2026-07",
      workflowState: "VALIDATED",
      status: "EMITIDA",
      totalCents: 3644000,
      owner: "financeiro"
    }]
  }), now, context) as any;

  assert.equal(result.openCount, 1);
  assert.equal(result.looseEnds[0].code, "BILLED_NOT_RECEIVED");
  assert.equal(result.looseEnds[0].stage, "RECEBIVEL");
  assert.equal(result.looseEnds[0].amountCents, 3644000);
});

test("glosa contestada sem evidência permanece recuperável e aberta", () => {
  const result = buildRevenueSanitation(source({
    glosses: [{
      id: "GLOSA-39",
      competence: "2026-07",
      status: "CONTESTADA",
      glossAmountCents: 351000
    }]
  }), now, context) as any;

  assert.equal(result.openCount, 1);
  assert.equal(result.looseEnds[0].code, "GLOSS_UNSUPPORTED_OR_UNRESOLVED");
  assert.equal(result.looseEnds[0].stage, "RECUPERAVEL");
  assert.equal(result.evidenceGapCount, 1);
});

test("glosa aceita só sai da fila com prova verificável, revisão humana e critérios de fechamento", () => {
  const baseGloss = {
    id: "G-1",
    competence: "2026-07",
    status: "ACCEPTED",
    glossAmountCents: 10000
  };

  const semEvidencia = buildRevenueSanitation(source({ glosses: [baseGloss] }), now, context) as any;
  assert.equal(semEvidencia.openCount, 1);

  const referenciaSemDocumento = buildRevenueSanitation(source({
    glosses: [{
      ...baseGloss,
      evidenceRefs: ["doc-glosa-g1"],
      reviewState: "APPROVED",
      reviewerUid: "reviewer-1",
      reviewedAt: "2026-09-30T17:00:00Z",
      glossReason: "não elegível",
      contractualBasis: "clausula-7",
      financialImpactReconciled: true
    }]
  }), now, context) as any;
  assert.equal(referenciaSemDocumento.openCount, 1);

  const semRevisaoHumana = buildRevenueSanitation(source({
    glosses: [{
      ...baseGloss,
      evidenceRefs: ["doc-glosa-g1"],
      glossReason: "não elegível",
      contractualBasis: "clausula-7",
      financialImpactReconciled: true
    }],
    sourceDocuments: [{ id: "doc-glosa-g1", workflowState: "VALIDATED" }]
  }), now, context) as any;
  assert.equal(semRevisaoHumana.openCount, 1);

  const criteriosIncompletos = buildRevenueSanitation(source({
    glosses: [{
      ...baseGloss,
      evidenceRefs: ["doc-glosa-g1"],
      reviewState: "APPROVED",
      reviewerUid: "reviewer-1",
      reviewedAt: "2026-09-30T17:00:00Z",
      financialImpactReconciled: true
    }],
    sourceDocuments: [{ id: "doc-glosa-g1", workflowState: "VALIDATED" }]
  }), now, context) as any;
  assert.equal(criteriosIncompletos.openCount, 1);

  const fechamentoCompleto = buildRevenueSanitation(source({
    glosses: [{
      ...baseGloss,
      evidenceRefs: ["doc-glosa-g1"],
      reviewState: "APPROVED",
      reviewerUid: "reviewer-1",
      reviewedAt: "2026-09-30T17:00:00Z",
      glossReason: "não elegível",
      contractualBasis: "clausula-7",
      financialImpactReconciled: true
    }],
    sourceDocuments: [{ id: "doc-glosa-g1", workflowState: "VALIDATED" }]
  }), now, context) as any;
  assert.equal(fechamentoCompleto.openCount, 0);
});

test("estado CLOSED ou RESOLVED isolado não encerra famílias sem prova", () => {
  const result = buildRevenueSanitation(source({
    invoices: [{ id: "NF-CLOSED", competence: "2026-07", status: "CLOSED", totalCents: 10000 }],
    reconciliations: [{ id: "R-CLOSED", competence: "2026-07", status: "CLOSED", differenceCents: 10000 }],
    actionItems: [{ id: "A-CLOSED", competence: "2026-07", status: "RESOLVED", impactCents: 10000 }],
    auditFindings: [{ id: "F-CLOSED", competence: "2026-07", status: "CLOSED", financialImpactCents: 10000 }]
  }), now, context) as any;

  assert.equal(result.openCount, 4);
  assert.equal(result.byCode.BILLING_EVIDENCE_GAP, 1);
  assert.equal(result.byCode.RECONCILIATION_OPEN, 1);
  assert.equal(result.byCode.FOLLOWUP_OPEN, 1);
  assert.equal(result.byCode.AUDIT_FINDING_OPEN, 1);
});

test("famílias encerradas saem da fila somente com evidência validada e decisão humana registrada", () => {
  const reviewed = {
    evidenceRefs: ["doc-close-1"],
    reviewState: "APPROVED",
    reviewerUid: "reviewer-1",
    reviewedAt: "2026-09-30T17:00:00Z"
  };
  const result = buildRevenueSanitation(source({
    invoices: [{
      id: "NF-CLOSED",
      competence: "2026-07",
      status: "CLOSED",
      totalCents: 10000,
      ...reviewed
    }],
    reconciliations: [{
      id: "R-CLOSED",
      competence: "2026-07",
      status: "CLOSED",
      differenceCents: 10000,
      ...reviewed
    }],
    actionItems: [{
      id: "A-CLOSED",
      competence: "2026-07",
      status: "RESOLVED",
      impactCents: 10000,
      evidenceRefs: ["doc-close-1"],
      resolutionCode: "EVIDENCE_CONFIRMED",
      updatedBy: "reviewer-1",
      updatedAt: "2026-09-30T17:00:00Z"
    }],
    auditFindings: [{
      id: "F-CLOSED",
      competence: "2026-07",
      status: "CLOSED",
      financialImpactCents: 10000,
      ...reviewed
    }],
    sourceDocuments: [{ id: "doc-close-1", workflowState: "VALIDATED" }]
  }), now, context) as any;

  assert.equal(result.openCount, 0);
});

test("follow-up vencido continua aberto e sem dono é sinalizado", () => {
  const result = buildRevenueSanitation(source({
    actionItems: [{
      id: "A-1",
      competence: "2026-07",
      status: "OPEN",
      dueAt: "2026-09-29T12:00:00Z",
      impactCents: 595000
    }]
  }), now, context) as any;

  assert.equal(result.overdueCount, 1);
  assert.equal(result.unownedCount, 1);
  assert.equal(result.looseEnds[0].code, "FOLLOWUP_SLA_BREACH");
});

test("motor não soma exceções sobrepostas como perda ou receita recuperável", () => {
  const result = buildRevenueSanitation(source({
    invoices: [{
      id: "NF11",
      competence: "2026-07",
      status: "EMITIDA",
      workflowState: "VALIDATED",
      totalCents: 3644000,
      chainId: "JUL26"
    }],
    glosses: [{
      id: "G-1",
      competence: "2026-07",
      status: "CONTESTADA",
      glossAmountCents: 595000,
      chainId: "JUL26"
    }]
  }), now, context) as any;

  assert.equal(result.openCount, 2);
  assert.equal(result.aggregateAmountCents, null);
  assert.equal(result.aggregationRule, "NO_SUM_ACROSS_POTENTIALLY_OVERLAPPING_EXCEPTIONS");
});

test("registros TESTE não contaminam a fila de saneamento", () => {
  const result = buildRevenueSanitation(source({
    invoices: [{
      id: "TEST-NF",
      competence: "2026-07",
      status: "EMITIDA",
      totalCents: 999999,
      environment: "TESTE"
    }]
  }), now, context) as any;

  assert.equal(result.openCount, 0);
});
