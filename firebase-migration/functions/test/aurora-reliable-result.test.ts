import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildProjection, type ProjectionSource } from "../src/auroraEngine.js";
import { readReliableFinancialResult, RELIABLE_RESULT_POLICY } from "../src/auroraReliableResult.js";
import { assessNativeData } from "../src/auroraDataGovernance.js";
import { buildMasterOperationalState } from "../src/auroraMasterEngine.js";
import { buildReliableMetricPresentation, financialPresentationClient } from "../src/auroraFinancialPresentation.js";
import { auroraProtectedShell } from "../src/auroraFrontend.js";

const now = new Date("2026-10-26T12:00:00Z"), context = { orgId: "tenant-synthetic", competence: "2026-10" };
const invoice = (totalCents: unknown, extra = {}) => ({ totalCents, workflowState: "VALIDATED", competence: "2026-10", ...extra });
function source(invoices: any[] = [invoice(10000), invoice("invalid"), invoice(30000)]): ProjectionSource {
  return { invoices, bankTransactions: [{ amountCents: 12000, status: "RECONCILED", workflowState: "VALIDATED", competence: "2026-10" }],
    glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [] };
}
function snapshot(s = source()): any {
  return { ...buildProjection(s, now, context), snapshotId: "synthetic-snapshot", sourceHash: "a".repeat(64) };
}
function bootstrap(p = snapshot()): any { return { projection: p, masterEngine: buildMasterOperationalState(p, {}, now) }; }

test("one invalid item preserves the verified subtotal without manufacturing a complete total or net result", () => {
  const s = source(), before = structuredClone(s), p = snapshot(s), master: any = buildMasterOperationalState(p, {}, now);
  assert.equal(p.state, "PARTIAL_VERIFIED");
  assert.equal(p.financialCents.invoicedCents, null);
  assert.equal(p.financialCents.receivedCents, 12000);
  assert.equal(p.financialCents.outstandingCents, null);
  assert.equal(p.reliableResult.metrics.invoicedCents.valueCents, 40000);
  assert.deepEqual([p.reliableResult.includedRecords, p.reliableResult.excludedRecords], [3, 1]);
  assert.equal(p.reliableResult.metrics.invoicedCents.coveragePercent, 66.67);
  assert.equal(assessNativeData(p, now).decision, "REVIEW");
  assert.equal(master.operationalState, "ATTENTION");
  assert.equal(master.reliableResult.status, "PARTIAL");
  assert.equal(master.financialGate.canApproveDistribution, false);
  assert.ok(master.commandSurface.every((x: any) => x.executionAllowed === false));
  assert.deepEqual(snapshot(s), p); assert.deepEqual(s, before);
});

test("test data, other periods, superseded history and unvalidated values never enter the subtotal", () => {
  const p = snapshot(source([invoice(100), invoice("bad"), invoice(900, { isTest: true }),
    invoice(800, { competence: "2026-09" }), invoice(700, { aggregationRole: "HISTORY_ONLY" }),
    invoice(600, { workflowState: "PENDING" }), invoice(500, { status: "CANCELLED" })]));
  assert.equal(p.reliableResult.metrics.invoicedCents.valueCents, 100);
  assert.equal(p.reliableResult.metrics.invoicedCents.includedRecords, 1);
  assert.equal(p.reliableResult.metrics.invoicedCents.excludedRecords, 1);
});

test("known zero stays available; missing and entirely invalid values never become zero", () => {
  const zero = snapshot(source([invoice(0), invoice(null)]));
  assert.equal(zero.reliableResult.metrics.invoicedCents.valueCents, 0);
  const none = source([invoice("bad")]); none.bankTransactions = [];
  const p = snapshot(none);
  assert.equal(p.reliableResult.status, "NO_VERIFIED_VALUE");
  assert.equal(p.reliableResult.metrics.invoicedCents.valueCents, null);
  assert.equal(readReliableFinancialResult(p)?.status, "NO_VERIFIED_VALUE");
  assert.equal(assessNativeData(p, now).decision, "DENY");
});

test("overflow withholds only the affected metric and never exposes an order-dependent clipped sum", () => {
  for (const values of [[Number.MAX_SAFE_INTEGER, 1], [1, Number.MAX_SAFE_INTEGER]]) {
    const p = snapshot(source(values.map(x => invoice(x))));
    assert.equal(p.reliableResult.metrics.invoicedCents.valueCents, null);
    assert.equal(p.reliableResult.metrics.invoicedCents.overflow, true);
    assert.equal(p.reliableResult.metrics.receivedCents.valueCents, 12000);
    assert.equal(p.financialCents.outstandingCents, null);
  }
});

test("strings, negatives, fractions and non-finite values are excluded individually", () => {
  const p = snapshot(source([invoice(250), ...["100", -1, 0.5, Infinity, NaN].map(x => invoice(x))]));
  assert.equal(p.reliableResult.metrics.invoicedCents.valueCents, 250);
  assert.equal(p.reliableResult.metrics.invoicedCents.excludedRecords, 5);
});

test("partial results cannot override identity, provenance, revocation, freshness or sensitive-data gates", () => {
  for (const mutate of [
    (p: any) => { p.orgId = "other-tenant"; },
    (p: any) => { p.snapshotId = undefined; },
    (p: any) => { p.sourceHash = "invalid"; },
    (p: any) => { p.revoked = true; },
    (p: any) => { p.asOf = "2026-10-25T12:00:00Z"; },
    (p: any) => { p.sensitivity = "CLINICAL_SENSITIVE"; },
    (p: any) => { p.nativeDataPlane.sourceAccessDuringInference = true; }
  ]) {
    const p = snapshot(); mutate(p);
    const m: any = buildMasterOperationalState(p, {}, now);
    assert.equal(m.governance.dataAssessment.decision, "DENY");
    assert.equal(m.reliableResult, null);
    assert.equal(buildReliableMetricPresentation({ projection: p, masterEngine: m }, "invoicedCents", readReliableFinancialResult).valueCents, null);
    assert.equal(buildReliableMetricPresentation({ projection: p, masterEngine: m }, "receivedCents", readReliableFinancialResult).valueCents, null);
  }
});

test("tampered subset, counts, complete totals and period cannot be used as a downgrade bypass", () => {
  for (const mutate of [
    (p: any) => { p.reliableResult.orgId = "other-tenant"; },
    (p: any) => { p.reliableResult.competence = "2026-09"; },
    (p: any) => { p.reliableResult.metrics.invoicedCents.includedRecords = "2"; },
    (p: any) => { p.reliableResult.metrics.invoicedCents.excludedRecords = 0; },
    (p: any) => { p.dataQuality.validFinancialRecords = 999; },
    (p: any) => { p.reliableResult.metrics.invoicedCents.valueCents = -1; },
    (p: any) => { p.reliableResult.financialDecisionAuthorized = true; },
    (p: any) => { p.financialCents.invoicedCents = 40000; },
    (p: any) => { delete p.reliableResult; }
  ]) {
    const p = snapshot(); mutate(p);
    assert.equal(readReliableFinancialResult(p), null);
    assert.equal(assessNativeData(p, now).decision, "DENY");
  }
});

test("the browser shares the validator and labels the subtotal with exclusions", () => {
  const b = bootstrap();
  const expected = buildReliableMetricPresentation(b, "invoicedCents", readReliableFinancialResult);
  assert.equal(expected.valueCents, 40000); assert.equal(expected.partial, true);
  assert.match(expected.detail, /2 registro.*1 com valor inválido.*Subtotal/);
  const sandbox: any = { input: b }; vm.createContext(sandbox);
  vm.runInContext(financialPresentationClient() + "\nresult=buildReliableMetricPresentation(input,'invoicedCents',readReliableFinancialResult);", sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.result)), expected);
  assert.equal(buildReliableMetricPresentation(b, "outstandingCents", readReliableFinancialResult).valueCents, null);
});

test("the protected UI renders the shared result and all generated scripts remain valid", () => {
  const html = auroraProtectedShell({ uid: "synthetic", orgId: context.orgId, email: "synthetic@example.test",
    role: "auditor", permissions: [], facilityIds: [], allFacilities: true, mfaVerified: true },
    { action: "a", refresh: "r", integrationKey: "i", distributionApproval: "d", logout: "l" });
  for (const id of ["invoiced-label", "invoiced-detail", "received-detail", "gloss-detail"]) assert.ok(html.includes('id="'+id+'"'));
  assert.match(html, /renderReliableFinancialResult\(data\)/);
  // This fixed renderer emits literal script delimiters; this is not an HTML sanitizer.
  const scripts = html.split("<script>").slice(1);
  assert.ok(scripts.length > 0);
  assert.equal(html.split("<script").length - 1, scripts.length);
  for (const fragment of scripts) {
    const end = fragment.indexOf("</script>");
    assert.ok(end >= 0);
    new vm.Script(fragment.slice(0, end));
  }
  assert.equal(RELIABLE_RESULT_POLICY.securityAndIntegrityGatesPreserved, true);
});

test("healthy records stay available while document warnings remain visible", () => {
  const s = source([invoice(500)]);
  s.sourceDocuments = [{ workflowState: "PENDING", nativeReady: false, sourceIndependent: false, documentFragility: "DEGRADED_EXTRACTION" }];
  const p = snapshot(s), m: any = buildMasterOperationalState(p, {}, now);
  assert.equal(m.operationalState, "ATTENTION");
  assert.equal(p.financialCents.invoicedCents, 500);
  assert.equal(m.reliableResult.metrics.invoicedCents.valueCents, 500);
  assert.ok(m.priorities.some((x: any) => x.code === "DOCUMENT_FRAGILITY"));
});
