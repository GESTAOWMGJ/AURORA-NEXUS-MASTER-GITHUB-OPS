import assert from "node:assert/strict";
import test from "node:test";
import { generateNativeInsight, parseNativeInsightIntent } from "../src/auroraNativeIntelligence.js";

const projection = {
  schemaVersion: 3,
  competence: "2026-09",
  policyVersion: "aurora-nexus-2.4.0-firebase-native-v1",
  dataQuality: { sourcePresent: true, invalidFinancialRecords: 0 },
  financialCents: { outstandingCents: 125000, glossCents: 25000 },
  operations: { overdueActions: 2, openFindings: 1 },
  coverage: { evidencePercent: 90, reconciliationPercent: 75 },
  documentIntelligence: {
    fragileDocuments: 0,
    sourceDependentDocuments: 0,
    overdueDocumentSla: 0,
    pendingDocumentFlow: 0,
    externalAiDocuments: 0
  },
  nativeDataPlane: {
    storage: "FIRESTORE",
    sourceAccessDuringInference: false
  }
};

test("native intelligence never declares an external provider", () => {
  const result = generateNativeInsight(projection, "EXECUTIVE") as any;
  assert.equal(result.externalProviderUsed, false);
  assert.equal(result.mode, "FIREBASE_NATIVE_DETERMINISTIC");
  assert.equal(result.engine, "AURORA_NATIVE_INTELLIGENCE");
});

test("revenue risk preserves reconciliation caveat", () => {
  const result = generateNativeInsight(projection, "REVENUE_RISK") as any;
  const gap = result.findings.find((item: any) => item.code === "REVENUE_GAP");
  assert.ok(gap);
  assert.match(gap.detail, /não prova perda definitiva/i);
  assert.match(gap.action, /glosa|crédito bancário/i);
});

test("data quality blocker outranks financial interpretation", () => {
  const result = generateNativeInsight({
    ...projection,
    dataQuality: { sourcePresent: true, invalidFinancialRecords: 3 }
  }, "EXECUTIVE") as any;
  assert.equal(result.findings[0].code, "FINANCIAL_DATA_QUALITY");
  assert.equal(result.findings[0].severity, "CRITICAL");
});

test("next action returns only the highest-priority actionable finding", () => {
  const result = generateNativeInsight(projection, "NEXT_ACTION") as any;
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, "HIGH");
});

test("document fragility SLA and flow are native Firebase findings", () => {
  const input = {
    ...projection,
    documentIntelligence: {
      fragileDocuments: 3,
      sourceDependentDocuments: 1,
      overdueDocumentSla: 2,
      pendingDocumentFlow: 4,
      externalAiDocuments: 1
    }
  };
  const quality = generateNativeInsight(input, "DATA_QUALITY") as any;
  const sla = generateNativeInsight(input, "SLA_RISK") as any;
  const qualityCodes = new Set(quality.findings.map((item: any) => item.code));
  const slaCodes = new Set(sla.findings.map((item: any) => item.code));
  assert.equal(qualityCodes.has("FIREBASE_NATIVE_GAP"), true);
  assert.equal(qualityCodes.has("DOCUMENT_FRAGILITY"), true);
  assert.equal(slaCodes.has("DOCUMENT_SLA_OVERDUE"), true);
  assert.equal(slaCodes.has("FLOW_BOTTLENECK"), true);
  assert.equal(quality.source.type, "FIREBASE_CANONICAL_SNAPSHOT");
  assert.equal(quality.source.sourceAccessRequired, false);
});

test("intent parser is closed", () => {
  assert.equal(parseNativeInsightIntent("revenue_risk"), "REVENUE_RISK");
  assert.equal(parseNativeInsightIntent("free_form_prompt"), null);
});
