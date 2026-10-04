import assert from "node:assert/strict";
import test from "node:test";
import { buildMasterOperationalState } from "../src/auroraMasterEngine.js";

const projection = {
  schemaVersion: 2,
  competence: "2026-10",
  policyVersion: "aurora-nexus-2.4.0-firebase-native-v1",
  asOf: "2026-10-04T12:00:00.000Z",
  dataQuality: { sourcePresent: true, invalidFinancialRecords: 0 },
  financialCents: { outstandingCents: 125000, glossCents: 0 },
  operations: { openActions: 3, overdueActions: 1, openFindings: 0 },
  coverage: { evidencePercent: 100, reconciliationPercent: 100 },
  documentIntelligence: { fragileDocuments: 0, sourceDependentDocuments: 0, overdueDocumentSla: 0, pendingDocumentFlow: 0, externalAiDocuments: 0 },
  nativeDataPlane: { storage: "FIRESTORE", sourceAccessDuringInference: false },
  nativeRoutines: { counts: { NATIVE_ACTIVE: 3, NATIVE_EVENT: 1, NATIVE_GOVERNED: 3, LEGACY_MIRRORED: 4 } }
};

test("motor mestre opera sem provedor externo e sem releitura da origem", () => {
  const result = buildMasterOperationalState(projection) as any;
  assert.equal(result.engine, "AURORA_MASTER_OPERATIONAL_ENGINE");
  assert.equal(result.mode, "FIREBASE_NATIVE_GOVERNED");
  assert.equal(result.externalProviderUsed, false);
  assert.equal(result.externalAiRequired, false);
  assert.equal(result.sourceAccessDuringInference, false);
  assert.equal(result.source.type, "FIREBASE_CANONICAL_SNAPSHOT");
});

test("motor mestre prioriza exceção operacional e preserva gate humano", () => {
  const result = buildMasterOperationalState(projection) as any;
  assert.equal(result.operationalState, "ATTENTION");
  assert.equal(result.nextAction.code, "REVENUE_GAP");
  assert.equal(result.nextAction.humanGate, true);
  assert.equal(result.workload.openActions, 3);
  assert.equal(result.workload.overdueActions, 1);
});

test("autonomia do motor mestre é fail-closed", () => {
  const result = buildMasterOperationalState(projection) as any;
  assert.equal(result.governance.autonomousSourceMutation, false);
  assert.equal(result.governance.autonomousFinancialMovement, false);
  assert.equal(result.governance.autonomousClinicalDecision, false);
  assert.equal(result.governance.arbitraryCodeExecution, false);
  assert.equal(result.governance.auditTrailRequired, true);
  assert.ok(result.commandSurface.every((item: any) => item.sourceMutation === false));
});

test("ciclo mestre mantém o modus operandi canônico", () => {
  const result = buildMasterOperationalState(projection) as any;
  assert.deepEqual(result.cycle, ["OBSERVAR","INGESTAR","COMPROVAR","CONFRONTAR","DETECTAR","PRIORIZAR","AGIR","VALIDAR","MEDIR","APRENDER","REUTILIZAR"]);
  assert.equal(result.knowledge.modusOperandi, "AURORA-MO-001");
  assert.equal(result.knowledge.organicLearning, "AURORA-ORG-001");
  assert.equal(result.knowledge.tenantRawDataTransfer, false);
});
