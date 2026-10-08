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
  assert.ok(legacy.every((item) => item.id.startsWith("WMGJ-LEGACY-") || item.id === "AURORA-DAILY-UPDATES-001"));
  const maintenance = legacy.find(item => item.id === "AURORA-DAILY-UPDATES-001");
  assert.equal(maintenance?.trigger, "EXISTING_HOSTED_MAINTENANCE");
  assert.equal(maintenance?.cadence, "HOURLY");
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
  assert.equal(summary.ingestionRecoveryPolicy.executorState, "IMPLEMENTED_SYNTHETIC_TESTED_PENDING_RUNTIME_VALIDATION");
  assert.equal(summary.ingestionRecoveryPolicy.runtimeEnabledByDefault, false);
  assert.equal(summary.ingestionRecoveryPolicy.financialRecognitionAllowed, false);
  assert.equal(summary.ingestionRecoveryPolicy.executor, "replayMensagemGmailWMGJ");
  assert.equal(summary.ingestionRecoveryPolicy.automaticBroadReplayAllowed, false);
  assert.equal(summary.ingestionRecoveryPolicy.observedFindingIsValidatedOutcome, false);
});

test("instalação canônica é governada e está presente na projeção, sem novo scheduler", () => {
  const routine = AURORA_NATIVE_ROUTINES.find((item) => item.id === "AURORA-INSTALL-INTEGRATION-001");
  assert.equal(routine?.state, "NATIVE_GOVERNED");
  assert.equal(routine?.tenantScope, "PER_ORG");
  assert.equal(routine?.humanGate, true);
  assert.equal(routine?.sourceMutation, false);
  assert.equal(routine?.cadence, "ON_DEMAND");
  const empty: ProjectionSource = { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [] };
  const projection = buildProjection(empty, new Date("2026-10-04T12:00:00Z"), { orgId: "synthetic-org", competence: "2026-10" }) as any;
  assert.ok(projection.nativeRoutines.routines.some((item: any) => item.id === routine?.id));
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


test("AURORA self-sufficient engine docs and policy artifacts are present", () => {
  const engine = fs.readFileSync(new URL("../../../docs/aurora-self-sufficient-engine.md", import.meta.url), "utf8");
  const runbook = fs.readFileSync(new URL("../../../docs/aurora-autonomous-improvement-runbook.md", import.meta.url), "utf8");
  const policy = fs.readFileSync(new URL("../../../policy/aurora-external-ai-reduction-policy.md", import.meta.url), "utf8");
  const kpi = JSON.parse(fs.readFileSync(new URL("../../../config/aurora-kpi-baseline.json", import.meta.url), "utf8"));
  assert.match(engine, /Firebase and Google Cloud/);
  assert.match(engine, /AURORA_DRY_RUN/);
  assert.match(runbook, /No auto-merge on gate failure/);
  assert.match(policy, /fallback de exceção/);
  assert.equal(kpi.kpis.external_ai_dependency_rate.target, 0.2);
  assert.equal(kpi.kpis.mttr.target_minutes, 60);
});


test("integrated updater reuses one legacy coordinator and keeps native deployment unverified", () => {
  const summary = nativeRoutineSummary() as any;
  const updater = summary.updaterPolicy;
  assert.equal(summary.registryVersion, 3);
  assert.equal(AURORA_NATIVE_ROUTINES.filter(item => item.id === updater.routineId).length, 1);
  assert.equal(updater.coordinatorState, "LEGACY_MIRRORED");
  assert.equal(updater.checkIntervalMs, 3_600_000);
  assert.ok(AURORA_NATIVE_ROUTINES.some(item => item.id === updater.releaseAuthorityRoutineId));
  assert.deepEqual(updater.intendedCoverage, ["CLOUD_ENGINE", "PHYSICAL_IA_MASTER", "WINDOWS_CLIENT", "MACOS_CLIENT", "WEB", "IOS_PWA", "ANDROID_PWA"]);
  assert.equal(updater.nativeBinaryUpdaterVerified, false);
  assert.equal(updater.nativeMobileSupport, "ONLY_WHEN_IMPLEMENTED_AND_VALIDATED");
  assert.equal(updater.oneExecutorPerEffect, true);
  assert.equal(updater.onlyChangedArtifacts, true);
  assert.equal(updater.deviceAndCloudGatesIndependent, true);
  assert.equal(updater.completionRequiresPerDestinationReceipt, true);
  assert.equal(updater.baselineIdentityAndRollbackRequired, true);
  assert.equal(updater.forceReloadAllowed, false);
  assert.equal(updater.tenantRawDataTransferAllowed, false);
});

test("updater policy reaches the existing canonical projection without tenant data", () => {
  const empty: ProjectionSource = { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [] };
  const a = buildProjection(empty, new Date("2026-10-08T06:00:00Z"), { orgId: "synthetic-a", competence: "2026-10" }) as any;
  const b = buildProjection(empty, new Date("2026-10-08T06:00:00Z"), { orgId: "synthetic-b", competence: "2026-10" }) as any;
  assert.deepEqual(a.nativeRoutines.updaterPolicy, b.nativeRoutines.updaterPolicy);
  assert.equal(a.nativeRoutines.updaterPolicy.tenantRawDataTransferAllowed, false);
  a.nativeRoutines.updaterPolicy.intendedCoverage.push("UNTRUSTED");
  assert.ok(!(nativeRoutineSummary().updaterPolicy as any).intendedCoverage.includes("UNTRUSTED"));
});
