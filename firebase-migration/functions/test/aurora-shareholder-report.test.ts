import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildShareholderReport } from "../src/auroraShareholderReport.ts";

function closed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orgId: "wmgj",
    competence: "2026-09",
    status: "CLOSED",
    approvedBy: "reviewer-1",
    evidenceRefs: ["doc-1", "doc-2"],
    financialCents: {
      forecastCents: 5000000,
      billableCents: 4900000,
      billedCents: 4800000,
      receivableCents: 1200000,
      receivedCents: 3600000,
      recoverableCents: 250000,
      glossCents: 100000,
      expensesCents: 1500000,
      taxesCents: 450000,
      transfersCents: 900000,
      closingResultCents: 750000
    },
    exceptionSummary: { openCount: 3, openAmountCents: 350000 },
    ...overrides
  };
}

test("relatório societário preserva centavos canônicos e fica pronto somente após fechamento/aprovação", () => {
  const report = buildShareholderReport(closed(), new Date("2026-10-01T20:00:00-03:00")) as any;
  assert.equal(report.skillId, "AURORA-FIN-SOC-001");
  assert.equal(report.state, "READY_FOR_PDF");
  assert.equal(report.financialCents.receivedCents, 3600000);
  assert.equal(report.closing.evidenceCount, 2);
  assert.equal(report.governance.automaticDistributionAllowed, false);
  assert.equal(report.pdf.autoSend, false);
});

test("ausência permanece null e nunca vira zero", () => {
  const report = buildShareholderReport(closed({
    financialCents: { billedCents: 0, receivedCents: null },
    exceptionSummary: {}
  })) as any;
  assert.equal(report.financialCents.billedCents, 0);
  assert.equal(report.financialCents.receivedCents, null);
  assert.equal(report.exceptionSummary.openCount, null);
  assert.match(report.institutionalMarkdown, /Não comprovado/);
});

test("status não fechado ou fechamento sem evidência humana não libera PDF final", () => {
  assert.equal(buildShareholderReport(closed({ status: "PENDING_APPROVAL" })).state, "BLOCKED_CLOSING");
  assert.equal(buildShareholderReport(closed({ approvedBy: null, approvals: [], approvalRefs: [] })).state, "REQUIRES_HUMAN_APPROVAL_EVIDENCE");
});

test("payload institucional minimiza dados e não replica detalhes sensíveis da fonte", () => {
  const report = buildShareholderReport(closed({
    patientName: "NOME SENSIVEL",
    prontuario: "123456",
    evidenceRefs: ["patient:123456", "bank:secret"],
    rawDocuments: [{ cpf: "00000000000" }]
  }));
  const text = JSON.stringify(report);
  assert.ok(!text.includes("NOME SENSIVEL"));
  assert.ok(!text.includes("00000000000"));
  assert.ok(!text.includes("patient:123456"));
  assert.ok(!text.includes("bank:secret"));
});

test("runtime cria versão imutável no fechamento e nunca autoriza distribuição automática", () => {
  const runtime = fs.readFileSync("src/auroraShareholderReportRuntime.ts", "utf8");
  assert.match(runtime, /monthlyClosings/);
  assert.match(runtime, /afterStatus !== "CLOSED"/);
  assert.match(runtime, /shareholderReportVersions/);
  assert.match(runtime, /distributionAuthorized: false/);
  assert.match(runtime, /sourceMutation: false/);
  assert.doesNotMatch(runtime, /sendMail|nodemailer|executePayment|automaticDistributionAllowed:\s*true/);
});

test("hosting publica relatório antes do catch-all de autenticação", () => {
  const firebase = JSON.parse(fs.readFileSync("../firebase.json", "utf8"));
  const routes = firebase.hosting.rewrites.map((item: any) => item.source);
  const reportIndex = routes.indexOf("/reports/shareholders");
  const catchAll = routes.indexOf("**");
  assert.ok(reportIndex >= 0);
  assert.ok(catchAll > reportIndex);
});
