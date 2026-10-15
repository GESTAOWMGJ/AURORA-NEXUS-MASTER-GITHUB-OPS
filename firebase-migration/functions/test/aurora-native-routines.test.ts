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
  assert.equal(maintenance?.cadence, "DAILY");
});

test('release convergence reuses the governed registry entry without asserting installation or another executor',()=>{
  assert.equal(AURORA_NATIVE_ROUTINES.filter(item=>item.id==='AURORA-CANONICAL-RELEASE-001').length,1);
  const policy=(nativeRoutineSummary() as any).releaseConvergencePolicy;
  assert.equal(policy.routineId,'AURORA-CANONICAL-RELEASE-001');assert.equal(policy.historicalSchema1Coverage,'PARTIAL');
  assert.equal(policy.requiredSchema2Components.length,5);assert.equal(policy.fullSynchronizationInferredFromSignedCoverage,false);
  assert.equal(policy.nativeMacAcceptanceInferredFromSatellite,false);assert.equal(policy.allClientsSynchronized,false);
  assert.equal(policy.schedulerCreated,false);assert.equal(policy.automaticInstallationEnabled,false);assert.equal(policy.permissionsGranted,false);
  assert.equal(policy.unifiedDownloadEndpoint,'/downloads/Aurora-Nexus-Beta-One.zip');
  assert.equal(policy.unifiedDownloadState,'IMPLEMENTED_PENDING_RUNTIME_VALIDATION');
  assert.equal(policy.artifactDownloadProvesDeviceAcceptance,false);
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
  assert.equal(summary.learningCapturePolicy.captureScope, "AVAILABLE_AUTHORIZED_TASK_CONTEXT_ONLY");
  assert.equal(summary.learningCapturePolicy.completeExternalChatHistoryAccess, false);
  assert.equal(summary.learningCapturePolicy.externalAiRequired, false);
  assert.equal(summary.learningCapturePolicy.credentialCaptureAllowed, false);
  assert.equal(summary.learningCapturePolicy.modelWeightTrainingPerformed, false);
  assert.equal(summary.learningCapturePolicy.runtimeAdoptionInferredFromDocumentation, false);
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
  const cloud = projection.nativeRoutines.cloudIntakePolicy;
  assert.equal(cloud.id, routine?.id);
  assert.equal(cloud.executor, "AURORA_CLIENT_AGENT");
  assert.equal(cloud.executorState, "IMPLEMENTED_PENDING_RUNTIME_VALIDATION");
  assert.equal(cloud.continuation, "PERSISTED_CURSOR_AFTER_PROCESSED_PAGE_RECEIPTS");
  assert.equal(cloud.providerConsentRequired, true);
  assert.equal(cloud.reuseExistingAuthorizedConfiguration, true);
  assert.equal(cloud.metadataPreviewIsSourceIngestion, false);
  assert.equal(cloud.inactiveRegistrationActivatesSource, false);
  assert.equal(cloud.completedSourcesRequireFreshInstallationRevalidation, true);
  assert.equal(cloud.differentProviderPageCountsMustRemainResumable, true);
  assert.equal(cloud.pendingExtractionBlocksCompletion, true);
  assert.equal(cloud.manualInstallationVerification, "EXISTING_CANONICAL_RECEIPT_TWO_AUTHENTICATED_READS");
  assert.equal(cloud.manualInputProofScope, "DOCUMENT_IDENTITY_VERSION_AND_CANONICAL_FACTS");
  assert.equal(cloud.manualInstallerReplaysDocument, false);
  assert.equal(cloud.manualInstallerWritesSharedCheckpoint, false);
  assert.equal(cloud.version, "1.0.5");
  assert.equal(cloud.documentAcquisitionEvidence.schema,"aurora.document.acquisition.v1");
  assert.equal(cloud.documentAcquisitionEvidence.byteHashIsCanonicalFactsHash,false);
  assert.equal(cloud.documentAcquisitionEvidence.pendingExtractionBlocksCursorAdvance,true);
  assert.equal(cloud.documentAcquisitionEvidence.disappearanceResolvesPendingEvidence,false);
  assert.equal(cloud.documentAcquisitionEvidence.sheetsExportProvesWholeWorkbook,false);
  assert.equal(cloud.documentAcquisitionEvidence.globalDocumentIngestionVerified,false);
  assert.equal(cloud.googleDesktopOAuth.sourceSchema, "aurora.google.oauth.source.v1");
  assert.deepEqual(cloud.googleDesktopOAuth.platforms, ["windows", "macos"]);
  assert.equal(cloud.googleDesktopOAuth.enrollment, "EXPLICIT_OPT_IN_EXTERNAL_BROWSER_LOOPBACK_PKCE_S256");
  assert.equal(cloud.googleDesktopOAuth.publicDesktopClientIdRequired, true);
  assert.equal(cloud.googleDesktopOAuth.missingClientIdState, "PENDING_CONFIGURATION");
  assert.equal(cloud.googleDesktopOAuth.scopeProfile, "DRIVE_READONLY_EXISTING_FOLDER");
  assert.equal(cloud.googleDesktopOAuth.googleScope, "https://www.googleapis.com/auth/drive.readonly");
  assert.equal(cloud.googleDesktopOAuth.googleScopeRestrictsFolder, false);
  assert.equal(cloud.googleDesktopOAuth.auroraFolderBoundaryRequired, true);
  assert.equal(cloud.googleDesktopOAuth.refreshTokenStorage, "CURRENT_USER_DPAPI_OR_KEYCHAIN");
  assert.equal(cloud.googleDesktopOAuth.accessTokenStorage, "CURRENT_USER_DPAPI_OR_KEYCHAIN_AND_PROCESS_MEMORY");
  assert.equal(cloud.googleDesktopOAuth.authorizationCodeVerifierAndStateStorage, "PROCESS_MEMORY_ONLY");
  assert.equal(cloud.googleDesktopOAuth.mutuallyExclusiveWithLegacyTokenEnv, true);
  assert.equal(cloud.googleDesktopOAuth.sourceReadyRequiresFreshProviderAccessAndExistingReceiptGates, true);
  for (const field of ["configurationOrConsentProvesIngestion", "driveFileProfileImplemented",
    "otherProviderRenewalImplementedByThisIncrement", "iosEnrollmentImplemented", "runtimeEnrollmentVerified",
    "permissionsGranted", "executorCreated"]) assert.equal(cloud.googleDesktopOAuth[field], false, field);
  assert.equal(cloud.firstDocumentEqualsFullIngestion, false);
  assert.equal(cloud.permissionsGranted, false);
  assert.equal(cloud.schedulerCreated, false);
});

test("autonomia permanente chega ao motor como política abstrata sem conceder acesso ou fingir executor ativo", () => {
  const routine = AURORA_NATIVE_ROUTINES.find((item) => item.id === "AURORA-DEV-AUTONOMY-FAILSAFE-001");
  assert.equal(routine?.state, "NATIVE_GOVERNED");
  assert.equal(routine?.cadence, "ON_DEMAND");
  assert.equal(routine?.humanGate, true);
  assert.equal(routine?.sourceMutation, false);
  const empty: ProjectionSource = { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [] };
  const projection = buildProjection(empty, new Date("2026-10-08T12:00:00Z"), { orgId: "synthetic-org", competence: "2026-10" }) as any;
  const policy = projection.nativeRoutines.engineeringAutonomyPolicy;
  assert.equal(policy.id, routine?.id);
  assert.equal(policy.registrationOnly, true);
  assert.equal(policy.executorState, "SPECIFIED");
  assert.equal(policy.cloudAutomaticRollback, "SPECIFIED_NOT_IMPLEMENTED");
  assert.equal(policy.permissionsGranted, false);
  assert.equal(policy.repeatedOwnerPromptRequired, false);
  assert.equal(policy.executableSecurityGatesRequired, true);
  assert.equal(policy.authenticationAndMfaBypassAllowed, false);
  assert.equal(policy.fabricatedHumanReviewReceiptAllowed, false);
  assert.equal(policy.arbitraryCodeExecutionAllowed, false);
  assert.equal(policy.sourceMutationAllowed, false);
  assert.equal(policy.tenantRawDataTransferAllowed, false);
  assert.equal(policy.validatedOutcomeRequiredForLearning, true);
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
