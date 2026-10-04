import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AURORA_NATIVE_ROUTINES, nativeRoutineSummary } from "../src/auroraNativeRoutines.ts";
import { buildProjection, type ProjectionSource } from "../src/auroraEngine.ts";
import { generateNativeInsight } from "../src/auroraNativeIntelligence.ts";

test("modus operandi WMGJ está representado como registro nativo multi-tenant", () => {
  const ids = new Set(AURORA_NATIVE_ROUTINES.map((item) => item.id));
  for (const id of ["AURORA-RUNTIME-WATCHDOG","AURORA-PROJECTION-ENGINE","AURORA-DOCUMENT-WATCHDOG","AURORA-FIN-SOC-001","AURORA-REV-SAN-001","AURORA-MASTER-OPS-001","AURORA-TECH-AUDIT-WEEKLY"]) {
    assert.ok(ids.has(id), id);
  }
  assert.ok(AURORA_NATIVE_ROUTINES.every((item) => item.sourceMutation === false));
});

test("rotinas legadas ficam espelhadas até migração e nunca são fingidas como nativas ativas", () => {
  const legacy = AURORA_NATIVE_ROUTINES.filter((item) => item.state === "LEGACY_MIRRORED");
  assert.ok(legacy.length >= 2);
  assert.ok(legacy.every((item) => item.id.startsWith("WMGJ-LEGACY-")));
});

test("aprendizado orgânico promove capacidade, não dados entre clientes", () => {
  const summary = nativeRoutineSummary() as any;
  assert.equal(summary.organicPromotion.tenantRawDataTransfer, false);
  assert.equal(summary.organicPromotion.validatedOutcomeRequired, true);
  assert.equal(summary.organicPromotion.humanReviewRequired, true);
  assert.equal(summary.organicPromotion.tenantAgnosticAbstractionRequired, true);
  assert.equal(summary.organicPromotion.everyOperationalChallengeRecorded, true);
  assert.equal(summary.organicPromotion.unresolvedChallengesRemainOpen, true);
  assert.equal(summary.organicPromotion.validatedSolutionsFeedBaseEngine, true);
  assert.equal(summary.organicPromotion.versionedEvidenceAndRegressionRequired, true);
  assert.equal(summary.ingestionRecoveryPolicy.executorState, "SPECIFIED_PENDING_RUNTIME_VALIDATION");
  assert.equal(summary.ingestionRecoveryPolicy.automaticBroadReplayAllowed, false);
  assert.equal(summary.ingestionRecoveryPolicy.observedFindingIsValidatedOutcome, false);
});


test("projeção e inteligência nativa recebem o estado real de migração das rotinas", () => {
  const empty: ProjectionSource = { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [] };
  const projection = buildProjection(empty, new Date("2026-10-03T12:00:00Z"), { orgId: "wmgj", competence: "2026-10" }) as any;
  assert.equal(projection.nativeRoutines.source, "AURORA-MO-001");
  assert.ok(projection.nativeRoutines.counts.LEGACY_MIRRORED > 0);
  const insight = generateNativeInsight({
    ...projection,
    dataQuality: { sourcePresent: true, invalidFinancialRecords: 0 },
    nativeDataPlane: { storage: "FIRESTORE", sourceAccessDuringInference: false },
    documentIntelligence: {},
    operations: {},
    coverage: {},
    financialCents: {}
  }, "EXECUTIVE") as any;
  assert.ok(insight.findings.some((item: any) => item.code === "ROUTINE_NATIVE_MIGRATION"));
});

test("AURORA-MO-001 torna a representação nativa obrigatória e proíbe transferência de dados brutos entre clientes", () => {
  const doc = fs.readFileSync(new URL("../../../docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md", import.meta.url), "utf8");
  assert.match(doc, /registro nativo de rotinas/i);
  assert.match(doc, /nenhum dado bruto de um cliente/i);
  assert.match(doc, /LEGACY_MIRRORED/);
});
