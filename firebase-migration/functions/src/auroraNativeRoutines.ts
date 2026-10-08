// One cadence for the hosted maintenance registry and existing web updater.
export const AURORA_UPDATER_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export type NativeRoutineState =
  | "NATIVE_ACTIVE"
  | "NATIVE_EVENT"
  | "NATIVE_GOVERNED"
  | "LEGACY_MIRRORED";

export type NativeRoutine = {
  id: string;
  module: string;
  name: string;
  cadence: string;
  trigger: string;
  state: NativeRoutineState;
  tenantScope: "PER_ORG" | "PLATFORM";
  humanGate: boolean;
  sourceMutation: boolean;
};

export const AURORA_NATIVE_ROUTINES: readonly NativeRoutine[] = Object.freeze([
  { id: "WMGJ-LEGACY-GMAIL-SINGLE-REPLAY", module: "M01", name: "Recuperação documental de mensagem única", cadence: "ON_DEMAND", trigger: "MANUAL_EXACT_MESSAGE_WITH_REVIEWED_MANIFEST", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-RUNTIME-WATCHDOG", module: "M08", name: "Watchdog de runtime", cadence: "EVERY_15_MINUTES", trigger: "SCHEDULE", state: "NATIVE_ACTIVE", tenantScope: "PLATFORM", humanGate: false, sourceMutation: false },
  { id: "AURORA-PROJECTION-ENGINE", module: "M07", name: "Projeção financeira/operacional", cadence: "EVERY_15_MINUTES", trigger: "SCHEDULE", state: "NATIVE_ACTIVE", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "AURORA-DOCUMENT-WATCHDOG", module: "M01", name: "Vigilância documental", cadence: "EVERY_15_MINUTES", trigger: "SCHEDULE", state: "NATIVE_ACTIVE", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "AURORA-FIN-SOC-001", module: "M07", name: "Fechamento mensal e relatório aos sócios", cadence: "LAST_BUSINESS_DAY_POLICY", trigger: "MONTHLY_CLOSING_CLOSED", state: "NATIVE_EVENT", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-REV-SAN-001", module: "M03.1", name: "Saneamento global de pontas soltas da receita", cadence: "EVENT_DRIVEN", trigger: "REVENUE_EVIDENCE_CHANGED", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-MASTER-OPS-001", module: "M06", name: "Motor mestre operacional nativo", cadence: "EVENT_DRIVEN", trigger: "APP_INTERFACE_OR_CANONICAL_SNAPSHOT", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-IA-MASTER-001", module: "M08", name: "Processamento físico e desenvolvimento local", cadence: "ON_DEMAND", trigger: "LOCAL_AUTHENTICATED_REQUEST", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-DATA-GOV-AUTONOMY-001", module: "M09", name: "Governança de dados e autonomia limitada", cadence: "EVENT_DRIVEN", trigger: "MASTER_DATA_GATE", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-USER-PROFILES-001", module: "M09", name: "Criação e revogação governada de perfis", cadence: "ON_DEMAND", trigger: "AUTHENTICATED_ADMIN_MFA", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-PROFESSIONAL-ONBOARDING-001", module: "M09", name: "Cadastro profissional e acolhimento com SLA", cadence: "EVENT_DRIVEN", trigger: "MASTER_ISSUED_ONE_USE_INVITATION_AND_VERIFIED_MFA", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-CANONICAL-RELEASE-001", module: "M10", name: "Referência única de versão e confirmação de atualização", cadence: "EVENT_DRIVEN", trigger: "REVIEWED_PROTECTED_RELEASE_PROMOTION_AND_CONNECTED_CLIENT_CHECK", state: "NATIVE_GOVERNED", tenantScope: "PLATFORM", humanGate: true, sourceMutation: false },
  { id: "AURORA-DAILY-UPDATES-001", module: "M10", name: "AURORA Updater integrado", cadence: "HOURLY", trigger: "EXISTING_HOSTED_MAINTENANCE", state: "LEGACY_MIRRORED", tenantScope: "PLATFORM", humanGate: true, sourceMutation: false },
  { id: "AURORA-INSTALL-INTEGRATION-001", module: "M08", name: "Instalação e conexão canônica retomável", cadence: "ON_DEMAND", trigger: "INSTALLER_EXPLICIT_CONNECTION_OR_SAMPLE", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-TECH-AUDIT-WEEKLY", module: "M10", name: "Auditoria técnica semanal", cadence: "WEEKLY_ORG_CONFIG", trigger: "SCHEDULE_OR_MANUAL", state: "NATIVE_GOVERNED", tenantScope: "PLATFORM", humanGate: true, sourceMutation: false },
  { id: "WMGJ-LEGACY-CYCLE-AUTONOMOUS", module: "M08", name: "Perfil legado autônomo Gmail/fiscal/financeiro (alternativo)", cadence: "DAILY_07_15_12_15_18_30_LOCAL", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-CYCLE-SAFE", module: "M08", name: "Perfil legado seguro Gmail/fiscal/financeiro (alternativo)", cadence: "DAILY_08_00_LOCAL", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-CYCLE-PRODUCTION", module: "M08", name: "Perfil legado produção Gmail/fiscal/financeiro (alternativo)", cadence: "DAILY_07_30_18_30_LOCAL", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-WATCHDOG-SAFE", module: "M08", name: "Perfil watchdog seguro (alternativo)", cadence: "DAILY_08_10_PLUS_HOURLY", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-WATCHDOG-PRODUCTION", module: "M08", name: "Perfil watchdog produção (alternativo)", cadence: "DAILY_07_35_18_35_PLUS_HOURLY", trigger: "APPS_SCRIPT_PROFILE", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-AUTOMATION-15M", module: "M08", name: "Ciclo principal Apps Script WMGJ", cadence: "EVERY_15_MINUTES", trigger: "APPS_SCRIPT", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-GMAIL-DRIVE-HOURLY", module: "M01", name: "Importação Gmail e processamento Drive", cadence: "HOURLY", trigger: "APPS_SCRIPT", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "WMGJ-LEGACY-NF-DAILY", module: "M03", name: "Ingestão e auditoria diária de NFS-e", cadence: "DAILY_07_LOCAL", trigger: "APPS_SCRIPT", state: "LEGACY_MIRRORED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false }
]);

export function nativeRoutineSummary(): Record<string, unknown> {
  const counts = AURORA_NATIVE_ROUTINES.reduce<Record<NativeRoutineState, number>>((acc, routine) => {
    acc[routine.state] += 1;
    return acc;
  }, { NATIVE_ACTIVE: 0, NATIVE_EVENT: 0, NATIVE_GOVERNED: 0, LEGACY_MIRRORED: 0 });
  return {
    registryVersion: 3,
    source: "AURORA-MO-001",
    referenceTenant: "WMGJ",
    organism: {
      founderAndMentor: "Dr. João de Freitas Neto",
      ownershipDeclaredByMaster: "JF Neto SM Ltda",
      administrativeReferenceCompany: "WMGJ SM Ltda",
      routinesBelongToEngine: true,
      futureAutomationRegistrationRequired: true,
      permissionAuthority: "AUTHENTICATED_LIVE_MEMBERSHIP",
      clientMaintenanceAuthority: "PER_CLIENT_CONTRACTUAL_GRANT_AND_AUDIT",
      learningCycle: "OBSERVE_VALIDATE_GENERALIZE_REVIEW_VERSION_REGRESS_PROMOTE",
      independentNativeInference: true,
      automaticPrivilegeFromJobTitle: false
    },
    routines: AURORA_NATIVE_ROUTINES,
    counts,
    updaterPolicy: {
      version: 1,
      routineId: "AURORA-DAILY-UPDATES-001",
      coordinatorState: "LEGACY_MIRRORED",
      checkIntervalMs: AURORA_UPDATER_CHECK_INTERVAL_MS,
      releaseAuthorityRoutineId: "AURORA-CANONICAL-RELEASE-001",
      intendedCoverage: ["CLOUD_ENGINE", "PHYSICAL_IA_MASTER", "WINDOWS_CLIENT", "MACOS_CLIENT", "WEB", "IOS_PWA", "ANDROID_PWA"],
      nativeMobileSupport: "ONLY_WHEN_IMPLEMENTED_AND_VALIDATED",
      webMechanism: "EXISTING_WEB_UPDATE_CLIENT",
      binaryMechanism: "EXISTING_PLATFORM_UPDATER_WITH_VERIFIED_RELEASE",
      nativeBinaryUpdaterVerified: false,
      onlyChangedArtifacts: true,
      oneExecutorPerEffect: true,
      deviceAndCloudGatesIndependent: true,
      completionRequiresPerDestinationReceipt: true,
      baselineIdentityAndRollbackRequired: true,
      forceReloadAllowed: false,
      tenantRawDataTransferAllowed: false,
      heavyComputeTarget: "AUTHORIZED_PHYSICAL_SERVER"
    },
    ingestionRecoveryPolicy: {
      version: 2,
      source: "AURORA-MO-001",
      rule: "GMAIL_SINGLE_MESSAGE_RECONCILIATION",
      executorState: "IMPLEMENTED_SYNTHETIC_TESTED_PENDING_RUNTIME_VALIDATION",
      executor: "replayMensagemGmailWMGJ",
      executorRuntime: "APPS_SCRIPT",
      runtimeEnabledByDefault: false,
      checkpointStorage: "EXISTING_SCRIPT_PROPERTIES",
      fileCreationIdentity: "PERSISTED_PREGENERATED_DRIVE_ID",
      financialRecognitionAllowed: false,
      observedFindingIsValidatedOutcome: false,
      requiredChecks: ["SOURCE_MESSAGE", "FILTER_WINDOW", "TRIGGER_OWNER", "FRESHNESS", "INDEX_SCHEMA", "DRIVE_HASH", "QUEUE", "IDEMPOTENCY"],
      replayScope: "EXACT_MESSAGE_ID",
      dryRunFirst: true,
      exclusiveWriterRequired: true,
      partialWriteReconciliationRequired: true,
      automaticBroadReplayAllowed: false,
      rawTenantEvidenceInKnowledgeRegistryAllowed: false,
      completionRequiresDestinationReceipts: true
    },
    organicPromotion: {
      everyOperationalChallengeRecorded: true,
      unresolvedChallengesRemainOpen: true,
      validatedSolutionsFeedBaseEngine: true,
      versionedEvidenceAndRegressionRequired: true,
      tenantRawDataTransfer: false,
      validatedOutcomeRequired: true,
      humanReviewRequired: true,
      tenantAgnosticAbstractionRequired: true
    }
  };
}
