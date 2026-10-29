import assert from "node:assert/strict";
import test from "node:test";
import { buildFinancialPanelView, mayReadFinancialPanel, renderFinancialPanelHtml,
  validFinancialCompetence } from "../src/auroraFinancialPanelView.ts";

const identity = {
  orgId: "wmgj", role: "finance", permissions: [], allFacilities: true, mfaVerified: true
};
const base = {
  orgId: "wmgj", orgName: "WMGJ",
  competence: "2026-09",
  closing: null,
  report: null,
  status: null,
  now: new Date("2026-10-29T18:00:00Z")
};

test("financial panel denies patient, no MFA, restricted facility and unrelated tenant", () => {
  assert.equal(mayReadFinancialPanel(identity), true);
  assert.equal(mayReadFinancialPanel({ ...identity, allFacilities: false }), false);
  assert.equal(mayReadFinancialPanel({ ...identity, mfaVerified: false }), false);
  assert.equal(mayReadFinancialPanel({ ...identity, role: "patient", permissions: [] }), false);
  assert.equal(mayReadFinancialPanel({ ...identity, role: "viewer", permissions: [] }), false);
  assert.equal(mayReadFinancialPanel({ ...identity, role: "viewer", permissions: ["financial.read"] }), true);
});

test("competence validation excludes traversal and malformed periods", () => {
  assert.equal(validFinancialCompetence("2026-09"), true);
  for (const bad of ["2026-13", "../wmgj", "2026-9", "2026-00", ["2026-09"], {}]) {
    assert.equal(validFinancialCompetence(bad), false);
  }
});

test("absent source is unknown, never zero, paid or invoiced", () => {
  const view = buildFinancialPanelView(base);
  assert.equal(view.financialCents.billedCents, null);
  assert.equal(view.financialCents.receivedCents, null);
  assert.equal(view.invoiceIssued, "NAO_COMPROVADO");
  assert.equal(view.invoiceSent, "NAO_COMPROVADO");
  assert.equal(view.bankReconciled, "NAO_COMPROVADO");
  assert.equal(view.sourceComplete, false);
  assert.match(renderFinancialPanelHtml(view), /Não comprovado/);
});

test("faturamento e recebimento do fechamento não provam envio nem crédito", () => {
  const view = buildFinancialPanelView({
    ...base,
    closing: { status: "CLOSED", financialCents: { billedCents: 3725000, receivedCents: 3725000 } },
    report: { state: "READY_FOR_PDF", financialCents: { billedCents: 3725000, receivedCents: 3725000 },
      completeness: { completeFinancialSnapshot: true }, closing: {} },
    status: { sourceComplete: true }
  });
  assert.equal(view.financialCents.billedCents, 3725000);
  assert.equal(view.financialCents.receivedCents, 3725000);
  assert.equal(view.invoiceIssued, "NAO_COMPROVADO");
  assert.equal(view.invoiceSent, "NAO_COMPROVADO");
  assert.equal(view.bankReconciled, "NAO_COMPROVADO");
  assert.equal(view.sourceComplete, true);
});

test("explicit verifiable evidence distinguishes issue, send and reconciliation", () => {
  const closing = {
    status: "CLOSED", invoiceNumber: "12", invoiceXmlEvidenceRef: "sha256:xml",
    invoiceSentEvidenceRef: "sha256:email", invoiceSentAt: "2026-09-30T14:00:00Z",
    bankReconciliationEvidenceRef: "sha256:bank"
  };
  const view = buildFinancialPanelView({
    ...base, closing,
    report: { state: "READY_FOR_PDF", financialCents: { receivedCents: 3725000 } },
    status: { sourceComplete: true }
  });
  assert.equal(view.invoiceIssued, "COMPROVADO");
  assert.equal(view.invoiceSent, "COMPROVADO");
  assert.equal(view.bankReconciled, "COMPROVADO");
});

test("escapes untrusted organization content and preserves reading timestamp", () => {
  const view = buildFinancialPanelView({ ...base, orgName: "<script>alert(1)</script>" });
  const html = renderFinancialPanelHtml(view);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /2026-10-29T18:00:00.000Z/);
  assert.doesNotMatch(html, /https?:\/\/[^\s]*patient/i);
});
