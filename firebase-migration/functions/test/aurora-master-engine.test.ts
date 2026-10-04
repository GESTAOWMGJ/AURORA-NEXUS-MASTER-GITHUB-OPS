import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildMasterOperationalState } from "../src/auroraMasterEngine.js";
import { AURORA_NATIVE_ROUTINES } from "../src/auroraNativeRoutines.js";
const now = new Date("2026-10-04T12:00:00.000Z");
const projection = {
  schemaVersion: 2, orgId: "tenant-synthetic", snapshotId: "snapshot-synthetic-001", sourceHash: "a".repeat(64),
  sanitized: true, sensitivity: "INTERNAL", competence: "2026-10",
  policyVersion: "aurora-nexus-2.4.0-firebase-native-v1", asOf: now.toISOString(),
  dataQuality: { sourcePresent: true, complete: true, invalidFinancialRecords: 0 },
  financialCents: { outstandingCents: 125000, glossCents: 0 },
  operations: { openActions: 3, overdueActions: 1, openFindings: 0 },
  coverage: { evidencePercent: 100, reconciliationPercent: 100 },
  documentIntelligence: { fragileDocuments: 0, sourceDependentDocuments: 0, overdueDocumentSla: 0, pendingDocumentFlow: 0, externalAiDocuments: 0 },
  nativeDataPlane: { storage: "FIRESTORE", sourceAccessDuringInference: false, externalAiRequired: false },
  nativeRoutines: { counts: { NATIVE_ACTIVE: 3, NATIVE_EVENT: 1, NATIVE_GOVERNED: 3, LEGACY_MIRRORED: 4 } }
};

test("motor mestre opera sem provedor externo e sem releitura da origem", () => {
  const result = buildMasterOperationalState(projection, {}, now) as any;
  assert.equal(result.engine, "AURORA_MASTER_OPERATIONAL_ENGINE");
  assert.equal(result.mode, "FIREBASE_NATIVE_GOVERNED");
  assert.equal(result.externalProviderUsed, false);
  assert.equal(result.externalAiRequired, false);
  assert.equal(result.sourceAccessDuringInference, false);
  assert.equal(result.source.type, "FIREBASE_CANONICAL_SNAPSHOT");
});
test("motor mestre prioriza exceção operacional e preserva gate humano", () => {
  const result = buildMasterOperationalState(projection, {}, now) as any;
  assert.equal(result.operationalState, "ATTENTION");
  assert.equal(result.nextAction.code, "REVENUE_GAP");
  assert.equal(result.nextAction.humanGate, true);
  assert.equal(result.workload.openActions, 3);
  assert.equal(result.workload.overdueActions, 1);
});
test("autonomia do motor mestre é fail-closed", () => {
  const result = buildMasterOperationalState(projection, {}, now) as any;
  assert.equal(result.governance.autonomousSourceMutation, false);
  assert.equal(result.governance.autonomousFinancialMovement, false);
  assert.equal(result.governance.autonomousClinicalDecision, false);
  assert.equal(result.governance.arbitraryCodeExecution, false);
  assert.equal(result.governance.auditTrailRequired, true);
  assert.ok(result.commandSurface.every((item: any) => item.sourceMutation === false && item.executionAllowed === false));
});
test("ciclo mestre mantém o modus operandi canônico", () => {
  const result = buildMasterOperationalState(projection, {}, now) as any;
  assert.deepEqual(result.cycle, ["OBSERVAR","INGESTAR","COMPROVAR","CONFRONTAR","DETECTAR","PRIORIZAR","AGIR","VALIDAR","MEDIR","APRENDER","REUTILIZAR"]);
  assert.equal(result.knowledge.modusOperandi, "AURORA-MO-001");
  assert.equal(result.knowledge.organicLearning, "AURORA-ORG-001");
  assert.equal(result.knowledge.tenantRawDataTransfer, false);
});
test("governance denial prevents inference before reading financial values", () => {
  const input = { ...projection, snapshotId: undefined };
  Object.defineProperty(input, "financialCents", { get() { throw new Error("INFERENCE_MUST_NOT_RUN"); } });
  const result = buildMasterOperationalState(input, {}, now) as any;
  assert.equal(result.operationalState, "BLOCKED");
  assert.equal(result.governance.dataAssessment.decision, "DENY");
  assert.equal(result.workloadMetrics.criticalFindings, null);
  assert.equal(result.workload.openActions, "Sem fonte");
});
test("stale canonical data is not presented as current", () => {
  const result = buildMasterOperationalState({ ...projection, asOf: "2026-10-04T11:00:00.000Z" }, {}, now) as any;
  assert.equal(result.operationalState, "BLOCKED");
  assert.ok(result.governance.dataAssessment.reasonCodes.includes("GOV_STALE_SNAPSHOT"));
  assert.equal(result.source.asOf, null);
});
test("master ignores a live or truncated cross-period action summary", () => {
  const result = buildMasterOperationalState(projection, { actionSummary: { open: 99, inProgress: 99, overdue: 99 } }, now) as any;
  assert.equal(result.workloadMetrics.openActions, 3);
  assert.equal(result.workloadMetrics.overdueActions, 1);
});
test("unknown workload remains nullable and cannot imply controlled operations", () => {
  const result = buildMasterOperationalState({ ...projection, operations: {} }, {}, now) as any;
  assert.equal(result.workloadMetrics.openActions, null);
  assert.equal(result.workloadMetrics.overdueActions, null);
  assert.equal(result.workloadMetrics.complete, false);
  assert.equal(result.workload.openActions, "Sem fonte");
  assert.notEqual(result.operationalState, "CONTROLLED");
});
test("master cannot authorize money, self-training or persistency by declaration", () => {
  const result = buildMasterOperationalState(projection, { financialStatus: { canApproveDistribution: true } }, now) as any;
  assert.equal(result.financialGate.canApproveDistribution, false);
  assert.equal(result.governance.effectiveLevel, "A1_RECOMMEND_ONLY");
  assert.equal(result.governance.decisionTracePersisted, false);
  assert.equal(result.knowledge.modelWeightsTrained, false);
});
test("data governance is a governed native routine, not an independent executor", () => {
  const routine = AURORA_NATIVE_ROUTINES.find(item => item.id === "AURORA-DATA-GOV-AUTONOMY-001");
  assert.ok(routine);
  assert.equal(routine.state, "NATIVE_GOVERNED");
  assert.equal(routine.sourceMutation, false);
  assert.equal(routine.tenantScope, "PER_ORG");
});

function quietProjection() {
  return {
    ...projection,
    financialCents: { outstandingCents: 0, glossCents: 0 },
    operations: { openActions: 0, overdueActions: 0, openFindings: 0 },
    documentIntelligence: { ...projection.documentIntelligence },
    nativeRoutines: { counts: { ...projection.nativeRoutines.counts, LEGACY_MIRRORED: 0 } }
  };
}
function assertActionableReview(result: any, reasonCodes: string[]) {
  assert.equal(result.governance.dataAssessment.decision, "REVIEW");
  assert.equal(result.operationalState, "ATTENTION");
  assert.equal(result.cycleStage, "PRIORIZAR");
  assert.deepEqual([...result.governance.dataAssessment.reasonCodes].sort(), [...reasonCodes].sort());
  assert.equal(result.nextAction.code, "DATA_GOVERNANCE_REVIEW_REQUIRED");
  assert.deepEqual(result.nextAction.detail.split(", ").sort(), [...reasonCodes].sort());
  assert.equal(result.nextAction.humanGate, true);
  assert.equal(result.nextAction.evidencePath, "projection.documentIntelligence");
  assert.equal(result.headline, result.nextAction.title);
  assert.doesNotMatch(result.headline, /Nenhuma exceção/);
  assert.match(result.nextAction.action, /Registrar evidências.*revisão humana/);
  const { humanGate, ...finding } = result.nextAction;
  assert.deepEqual(result.priorities[0], finding);
  assert.equal(result.priorities.filter((item: any) => item.code === finding.code).length, 1);
  assert.equal(result.governance.dataAssessment.executionAuthorized, false);
  assert.ok(result.commandSurface.every((item: any) => item.executionAllowed === false && item.humanGate === true));
  assert.equal(result.financialGate.canApproveDistribution, false);
  assert.equal(result.sourceAccessDuringInference, false);
}

test("REVIEW preserves actionable coverage reasons with absent or malformed document metrics", async t => {
  for (const [index, documentIntelligence] of [undefined, null, {}, [], "invalid", false, 42].entries()) {
    await t.test(`documentIntelligence case ${index}`, () => {
      const result = buildMasterOperationalState({ ...quietProjection(), documentIntelligence }, {}, now) as any;
      assertActionableReview(result, ["GOV_DOCUMENT_COVERAGE_UNPROVEN"]);
      assert.equal(result.headline, "Cobertura documental não comprovada");
      assert.match(result.nextAction.action, /Regenerar a projeção canônica.*contagens documentais ausentes ou inválidas/);
      assert.equal(result.workloadMetrics.highFindings, 1);
      assert.equal(result.workloadMetrics.complete, true);
    });
  }
});

test("REVIEW never silently coerces missing or invalid document counts to zero", async t => {
  const invalidCounts: unknown[] = [undefined, null, "0", "", false, true, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, {}, []];
  for (const field of ["sourceDependentDocuments", "fragileDocuments", "overdueDocumentSla"] as const) {
    for (const [index, value] of invalidCounts.entries()) {
      await t.test(`${field} invalid case ${index}`, () => {
        const input = quietProjection();
        const documents: Record<string, unknown> = { ...input.documentIntelligence };
        if (value === undefined) delete documents[field];
        else documents[field] = value;
        const result = buildMasterOperationalState({ ...input, documentIntelligence: documents }, {}, now) as any;
        assertActionableReview(result, ["GOV_DOCUMENT_COVERAGE_UNPROVEN"]);
        assert.match(result.nextAction.action, /ausência não representa zero/);
      });
    }
  }
});

test("REVIEW explains actual documentary exceptions and retains ordinary findings", async t => {
  for (const field of ["sourceDependentDocuments", "fragileDocuments", "overdueDocumentSla"] as const) {
    await t.test(field, () => {
      const input = quietProjection();
      input.documentIntelligence[field] = 1;
      const result = buildMasterOperationalState(input, {}, now) as any;
      assertActionableReview(result, ["GOV_DOCUMENT_REVIEW_REQUIRED"]);
      assert.equal(result.headline, "Revisão documental exigida pela governança");
      assert.match(result.nextAction.action, /Revisar os documentos com fragilidade, dependência da origem ou SLA vencido/);
      assert.ok(result.priorities.length > 1);
    });
  }
});

test("REVIEW combines missing coverage and documented review without hiding revenue findings", () => {
  const input = {
    ...projection,
    documentIntelligence: { ...projection.documentIntelligence, fragileDocuments: undefined, sourceDependentDocuments: 2 }
  };
  const result = buildMasterOperationalState(input, {}, now) as any;
  assertActionableReview(result, ["GOV_DOCUMENT_COVERAGE_UNPROVEN", "GOV_DOCUMENT_REVIEW_REQUIRED"]);
  assert.match(result.nextAction.action, /Regenerar a projeção canônica/);
  assert.match(result.nextAction.action, /Revisar os documentos/);
  assert.ok(result.priorities.some((item: any) => item.code === "REVENUE_GAP"));
  assert.ok(result.priorities.length <= 12);
});

test("valid zero documentary counts do not manufacture a governance exception", () => {
  const result = buildMasterOperationalState(quietProjection(), {}, now) as any;
  assert.equal(result.governance.dataAssessment.decision, "ALLOW");
  assert.equal(result.operationalState, "CONTROLLED");
  assert.equal(result.nextAction, null);
  assert.deepEqual(result.priorities, []);
});

test("DENY still takes precedence over documentary review and prevents inference", () => {
  const input = { ...quietProjection(), snapshotId: undefined, documentIntelligence: undefined };
  Object.defineProperty(input, "financialCents", { get() { throw new Error("INFERENCE_MUST_NOT_RUN"); } });
  const result = buildMasterOperationalState(input, {}, now) as any;
  assert.equal(result.governance.dataAssessment.decision, "DENY");
  assert.equal(result.operationalState, "BLOCKED");
  assert.equal(result.nextAction.code, "DATA_GOVERNANCE_BLOCKED");
  assert.equal(result.priorities.length, 1);
  assert.equal(result.workloadMetrics.highFindings, null);
});

test("HML provisioning verify loop requires the master engine exactly once", () => {
  const script = readFileSync(new URL("../../scripts/PROVISIONAR_FIREBASE_HOMOLOGACAO.command", import.meta.url), "utf8");
  const verify = script.match(/\nverify\(\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(verify, "verify() must remain present");
  const required = verify.match(/for fn in ([^;]+); do/)?.[1].trim().split(/\s+/);
  assert.ok(required, "function inventory loop must remain inside verify()");
  assert.equal(required.filter(fn => fn === "auroraNexusMasterEngine").length, 1);
  assert.ok(required.includes("auroraNexusNativeInsight"));
  assert.match(verify, /grep -Fq "\$fn" \|\| fail 80 VERIFY_FUNCTIONS/);
});
