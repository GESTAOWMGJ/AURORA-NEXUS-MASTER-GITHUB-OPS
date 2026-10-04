import assert from "node:assert/strict";
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
