/** Structural server-readback contracts only; keep the local IA kernel cloud-free. */
export type AdoptionMember = { orgId: string; uid: string; role: string;
  permissions: readonly string[]; allFacilities: boolean; mfaVerified: boolean };
type AdoptionDocumentIdentity = { documentId: string | null; versionId: string | null;
  sourceVersion: number | null; canonicalSnapshotHash: string | null };
type AdoptionAcceptance = AdoptionDocumentIdentity & { schemaVersion: string; orgId: string;
  canonicalOrigin: string; method: string; state: string; processingVerified: boolean;
  receiptPersisted: boolean; receiptId: string | null; replayVerified: boolean;
  automationConfigured: boolean; automationVerified: boolean; automationScope: string;
  configurationHash: string | null; eligible: boolean; verifiedAt: string | null };
type AdoptionReadback = AdoptionDocumentIdentity & { state: string; sourceSystem: string | null;
  revision: number | null; verifiedAt: string | null; firstIngestionVerified: boolean;
  operationalComplete: boolean; acceptance?: AdoptionAcceptance };

export const NATIVE_INGESTION_ORIGIN = 'https://auroranexus.com.br';
/** Same existing role/permission/all-facilities/MFA gate; no cloud module import. */
export function canImportNativeDocuments(member: Pick<AdoptionMember, 'role' | 'permissions' | 'allFacilities' | 'mfaVerified'>): boolean {
  return member.allFacilities && member.mfaVerified
    && (['platform_admin', 'org_admin', 'director'].includes(member.role)
      || member.permissions.includes('integrations.manage'));
}

export const CLIENT_ADOPTION_PROTOCOL = 'aurora.client.adoption.v1';
const METHODS = ['CLOUD_OAUTH', 'API_TOKEN', 'LOCAL_AGENT', 'MANUAL'] as const;
const TARGETS = ['CANONICAL_PIPELINE', 'WINDOWS', 'MACOS', 'IOS_NATIVE'] as const;
const IDENTITY_FIELDS = ['documentId', 'versionId', 'sourceVersion', 'canonicalSnapshotHash'] as const;
type Method = typeof METHODS[number];
type Target = typeof TARGETS[number];
export type AdoptionSelection = { method: Method; sourceSystem: string; targets: readonly Target[] };
export type AdoptionContext = {
  /** Supplied only by the authenticated server, never deserialized from request JSON. */
  member?: AdoptionMember;
  installation?: AdoptionReadback;
  selection?: AdoptionSelection;
  generatedWindowsPaths?: readonly string[];
  availability?: 'UNAVAILABLE';
  previousOperation?: 'UNKNOWN';
};
const hex = (value: unknown, size: number) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const source = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Windows paths are measured in UTF-16 units; this function performs no I/O. */
export function generatedWindowsPathsFit(paths: readonly string[]): boolean {
  return Array.isArray(paths) && paths.length > 0 && paths.length <= 256 && paths.every(path => typeof path === 'string'
    && /^[A-Za-z]:[\\/]/.test(path) && !path.includes('\0') && path.length <= 240);
}

export function clientAdoptionPolicy() {
  return {
    schemaVersion: CLIENT_ADOPTION_PROTOCOL, routineId: 'AURORA-INSTALL-INTEGRATION-001',
    tenantScope: 'PER_ORG_SELECTED_SOURCES_AND_TARGETS', mode: 'SERVER_READBACK_PLANNER',
    authority: 'EXISTING_LIVE_MEMBERSHIP_ROLE_MFA_AND_TRANSACTION_GATES',
    methods: METHODS, targets: TARGETS,
    credentialDelivery: 'EXISTING_PROTECTED_CHANNEL_MINIMUM_SCOPES',
    credentialScopes: ['integration.read', 'documents.ingest'],
    ownProviderConsentRequired: true, inheritedCustomerGrantsAllowed: false,
    manualMode: 'EXPLICIT_EVENT_THROUGH_CANONICAL_PIPELINE_NOT_CLOUD_POLLING',
    sourceAcquisition: { actualBytesOrCellsRequired: true, stableSourceVersionRequired: true,
      spreadsheetRead: 'BOUNDED_PAGES_THROUGH_SELECTED_RANGE_NOT_FIRST_PAGE_ONLY' },
    sourceProgress: { ingestionCompletionAdvancesOnlyAfter: 'CONFIRMED_CANONICAL_RECEIPT',
      discoveryCursorIsCompletionProof: false,
      lostResponseRecovery: 'DURABLE_READBACK_BY_SELECTED_ADAPTER_CONTRACT',
      driveQueueReadback: 'ALL_PAGES_FROM_OFFSET_ZERO_WITH_ALIASES_PENDING_AND_CLOSED_TOTALS',
      apiOrManualReadback: 'EXACT_RECEIPT_AND_IMMUTABLE_REVISION_BY_KNOWN_IDENTITY' },
    sourceAliases: { identity: 'BYTE_SHA256_WITHIN_TENANT_AND_AUTHORIZED_SCOPE',
      preserveOriginIdentity: true, nameOnlyDeduplicationAllowed: false },
    sourceExecution: { boundedExecutionRequired: true,
      driveQueueModes: { readOnly: ['PREVIEW', 'READBACK'], effects: ['EXECUTE', 'PROCESS_EXISTING'] },
      finiteAttemptTimeBatchBudgetsRequired: true, stopAfterNoProgress: true,
      processExistingMayEnumerateOrAdoptLegacyInflight: false,
      busyRetryRequiresAuthenticatedSharedLockResponseAndProvenNoEffect: true,
      unknownOutcomeRetryAllowed: false },
    financialInterpretation: { typedFieldProvenanceAndImmutableIdentityRequired: true,
      absenceIsZero: false, issuedReceivedReconciledAreInterchangeable: false,
      extractionAuthorizesApprovalClosingOrPayment: false },
    postCommitProjection: { preserveCanonicalReceiptOnFailure: true,
      failureState: 'PENDING', receiptAttestsFactAcceptance: false,
      queryTimeIsDataTime: false },
    scopedQueueDrainedOrReadbackEndProvesFullSynchronization: false,
    releaseAuthority: 'SINGLE_CANONICAL_SIGNED_PIN_FRESH_NONCE_AND_SOURCE_BOUND_BYTES',
    closureAuthority: 'AUTHENTICATED_COMPONENT_MANIFEST_AND_REVIEWED_PROFILE',
    ancestryProfiles: 'EACH_HISTORICAL_PACKAGE_USED_REQUIRES_ITS_OWN_EXACT_REGISTERED_PROFILE',
    historicalByteAudit: 'CURRENT_AND_IMMEDIATE_BACKUP_BYTES_WITH_AUTHENTICATED_ANCESTRY_LINKS_NOT_ALL_DEEP_BACKUP_COPIES',
    currentProfileAppliedToHistory: false, countOnlyProfileAcceptance: false,
    credentialChange: 'NEW_CURRENT_RECEIPT_AND_REPLAY_WITH_IMMUTABLE_ANCESTRY_AND_CHECKPOINT_CAS',
    unknownOutcome: 'PRESERVE_LOCKS_AND_PROOFS_RECONCILE_BEFORE_EXPLICIT_RESUME',
    automaticRetryAfterUnknownOutcome: false, generatedWindowsPathLimitUtf16: 240,
    evidenceStages: ['ACQUISITION', 'EXTRACTION', 'OBSERVATION', 'CANONICAL_PROCESSING', 'ACCEPTED_CANONICAL_FACTS', 'RECEIPT', 'REPLAY', 'AUTOMATION', 'DEVICE_ACCEPTANCE'],
    legacyConsumerBootstrap: 'REVIEWED_COMPATIBLE_SIGNED_BOOTSTRAP_BEFORE_UNRECOGNIZED_PROFILE',
    automaticLegacyBootstrapImplemented: false, offlineState: 'PENDING',
    tenantPendingBlocksPlatformPublication: false,
    permissionsGranted: false, schedulerCreated: false, executorCreated: false,
    documentation: 'docs/AURORA_CLIENT_ADOPTION_PROTOCOL.md'
  };
}

/** Explain server-validated evidence only. This result is never an execution capability,
 * a replacement for readInstallationAcceptance, a provider grant, or a device receipt. */
export function buildClientAdoptionPlan(orgId: unknown, context: AdoptionContext = {}) {
  const proof = context.installation;
  const acceptance = proof?.acceptance;
  const member = context.member;
  const validOrg = typeof orgId === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(orgId);
  const authorized = validOrg && member?.orgId === orgId && typeof member.uid === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(member.uid) && canImportNativeDocuments(member);
  // A configured method is selected only from the current authenticated readback.
  // A separate selection can narrow requested targets; it cannot supply proof flags.
  const selection = context.selection ?? (acceptance && ['API_TOKEN', 'MANUAL'].includes(acceptance.method)
    && source(proof?.sourceSystem) ? { method: acceptance.method as Method, sourceSystem: proof.sourceSystem,
      targets: ['CANONICAL_PIPELINE'] as readonly Target[] } : undefined);
  const selectionValid = selection && METHODS.includes(selection.method) && source(selection.sourceSystem)
    && Array.isArray(selection.targets) && selection.targets.length > 0 && selection.targets.length <= TARGETS.length
    && new Set(selection.targets).size === selection.targets.length && selection.targets.every(target => TARGETS.includes(target));
  const bound = authorized && !!acceptance && acceptance.orgId === orgId && acceptance.schemaVersion === 'aurora.installation.acceptance.v1'
    && acceptance.canonicalOrigin === NATIVE_INGESTION_ORIGIN && selectionValid
    && acceptance.method === selection?.method && proof?.sourceSystem === selection?.sourceSystem
    && hex(proof.documentId, 48) && hex(proof.versionId, 48) && hex(proof.canonicalSnapshotHash, 64)
    && Number.isSafeInteger(proof.sourceVersion) && proof.sourceVersion! > 0
    && Number.isSafeInteger(proof.revision) && proof.revision! > 0 && time(proof.verifiedAt)
    && IDENTITY_FIELDS.every(key => acceptance[key] === proof[key]);
  const processing = bound && proof.firstIngestionVerified === true && proof.state === 'FIRST_INGESTION_VERIFIED'
    && acceptance.processingVerified === true;
  const receipt = processing && acceptance.receiptPersisted === true && hex(acceptance.receiptId, 64);
  const replay = receipt && acceptance.replayVerified === true;
  const automation = replay && acceptance?.automationConfigured === true && acceptance.automationVerified === true
    && acceptance.automationScope === 'AURORA_CANONICAL_PIPELINE' && hex(acceptance.configurationHash, 64)
    && acceptance.eligible === true && acceptance.state === 'INSTALLATION_INTEGRATION_VERIFIED' && time(acceptance.verifiedAt);
  const pipelineCommitted = automation && proof.operationalComplete === true;
  const pathState = context.generatedWindowsPaths === undefined ? 'NOT_EVALUATED'
    : generatedWindowsPathsFit(context.generatedWindowsPaths) ? 'WITHIN_LIMIT' : 'BLOCKED';
  let state = !authorized ? 'PENDING_AUTHORIZATION'
    : !selection ? 'PENDING_SOURCE_SELECTION' : !selectionValid ? 'UNSUPPORTED_SELECTION'
    : context.availability === 'UNAVAILABLE' ? 'PENDING_AVAILABILITY'
    : context.previousOperation === 'UNKNOWN' ? 'PENDING_RECOVERY'
    : pathState === 'BLOCKED' ? 'BLOCKED_PATH_CAPACITY'
    : acceptance && (acceptance.orgId !== orgId || (proof?.sourceSystem && proof.sourceSystem !== selection.sourceSystem)
      || (acceptance.method !== 'UNCONFIGURED' && acceptance.method !== selection.method)) ? 'BLOCKED_SCOPE_CONFLICT'
    : ['CLOUD_OAUTH', 'LOCAL_AGENT'].includes(selection.method) ? 'PENDING_ADAPTER_EVIDENCE'
    : !processing ? 'PENDING_CANONICAL_PROCESSING' : !receipt ? 'PENDING_RECEIPT'
    : !replay ? 'PENDING_REPLAY' : !automation ? 'PENDING_AUTOMATION'
    : !pipelineCommitted ? 'PENDING_COMPLETION_COMMIT' : 'SCOPED_PIPELINE_VERIFIED';
  if (state === 'SCOPED_PIPELINE_VERIFIED' && selection?.targets.some(target => target !== 'CANONICAL_PIPELINE')) {
    state = 'PENDING_DEVICE_ACCEPTANCE';
  }
  const pending: Record<string, string> = {
    PENDING_AUTHORIZATION: 'Confirmar sessão individual, vínculo, permissão e MFA no fluxo existente.',
    PENDING_SOURCE_SELECTION: 'Escolher a fonte e os alvos deste cliente no fluxo de configuração autorizado.',
    UNSUPPORTED_SELECTION: 'Revisar o método, a fonte e os alvos; não ampliar acesso por inferência.',
    PENDING_AVAILABILITY: 'Manter pendente até obter leitura atual do serviço autorizado.',
    PENDING_RECOVERY: 'Preservar locks e provas; reconciliar a tentativa antes de qualquer retomada explícita.',
    BLOCKED_PATH_CAPACITY: 'Preparar raiz curta e conferir todos os caminhos gerados, incluindo o recibo futuro.',
    BLOCKED_SCOPE_CONFLICT: 'Reconciliar o vínculo da fonte, identidade e organização sem alterar evidências.',
    PENDING_ADAPTER_EVIDENCE: 'Obter driver, consentimento próprio e prova atual da fonte selecionada.',
    PENDING_CANONICAL_PROCESSING: 'Processar uma amostra autorizada no pipeline canônico existente.',
    PENDING_RECEIPT: 'Conferir o recibo persistido do mesmo documento, versão e conteúdo.',
    PENDING_REPLAY: 'Comprovar replay idempotente real do mesmo envio.',
    PENDING_AUTOMATION: 'Revalidar a automação, credencial, emissor e escopos no servidor.',
    PENDING_COMPLETION_COMMIT: 'Concluir o registro pelo endpoint existente e reler sua confirmação.',
    PENDING_DEVICE_ACCEPTANCE: 'Conferir assinatura, baseline, backup, CAS e aceite nativo de cada alvo selecionado.',
    SCOPED_PIPELINE_VERIFIED: 'Manter revalidação atual apenas do escopo comprovado; outras fontes exigem provas próprias.'
  };
  const exposeProof = authorized && bound && !['PENDING_AVAILABILITY', 'PENDING_RECOVERY', 'BLOCKED_SCOPE_CONFLICT'].includes(state);
  return {
    schemaVersion: CLIENT_ADOPTION_PROTOCOL, routineId: 'AURORA-INSTALL-INTEGRATION-001', state,
    mode: 'SERVER_READBACK_PLANNER', orgId: validOrg ? orgId : null,
    selectedMethod: selectionValid && authorized ? selection.method : null,
    selectedTargets: selectionValid && authorized ? selection.targets : [],
    nextAction: pending[state], humanGate: true, executionAllowed: false,
    proofStages: {
      acquisition: 'DISTINCT_PROVIDER_OR_LOCAL_PROOF_REQUIRED', extraction: 'DISTINCT_EXTRACTION_PROOF_REQUIRED',
      observation: 'DISTINCT_OBSERVATION_RECEIPT_REQUIRED',
      canonicalProcessing: exposeProof && processing ? 'VERIFIED_FOR_SELECTED_DOCUMENT' : 'PENDING',
      // Pipeline processing authenticates persistence/projection, not factual or human approval.
      acceptedCanonicalFacts: 'NOT_ATTESTED_BY_PIPELINE_READBACK',
      persistedReceipt: exposeProof && receipt ? 'VERIFIED' : 'PENDING',
      replay: exposeProof && replay ? 'VERIFIED' : 'PENDING',
      canonicalAutomation: exposeProof && automation ? 'VERIFIED' : 'PENDING',
      completionCommit: exposeProof && pipelineCommitted ? 'VERIFIED' : 'PENDING',
      deviceAcceptance: 'NOT_ATTESTED_BY_PIPELINE_READBACK'
    },
    pathCapacity: pathState, automaticRetryPermitted: false,
    preserveLocksAndProofs: context.previousOperation === 'UNKNOWN',
    sourcePollingEnabled: false, sourceMutationAllowed: false, permissionsGranted: false,
    globalDocumentIngestionVerified: false, allClientsSynchronized: false,
    platformPublicationBlockedByThisTenant: false, installationAuthorized: false,
    proofAuthority: 'EXISTING_SERVER_TRANSACTION_READBACK_NOT_BROWSER_FLAGS'
  };
}

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
  { id: "AURORA-PROJECTION-ENGINE", module: "M07", name: "Projeção financeira/operacional", cadence: "ON_ACCEPTED_INGEST_AND_EVERY_15_MINUTES", trigger: "AUTHENTICATED_INGEST_OR_SCHEDULE", state: "NATIVE_ACTIVE", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "AURORA-DOCUMENT-WATCHDOG", module: "M01", name: "Vigilância documental", cadence: "EVERY_15_MINUTES", trigger: "SCHEDULE", state: "NATIVE_ACTIVE", tenantScope: "PER_ORG", humanGate: false, sourceMutation: false },
  { id: "AURORA-FIN-SOC-001", module: "M07", name: "Fechamento mensal e relatório aos sócios", cadence: "LAST_BUSINESS_DAY_POLICY", trigger: "MONTHLY_CLOSING_CLOSED", state: "NATIVE_EVENT", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-REV-SAN-001", module: "M03.1", name: "Saneamento global de pontas soltas da receita", cadence: "EVENT_DRIVEN", trigger: "REVENUE_EVIDENCE_CHANGED", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-MASTER-OPS-001", module: "M06", name: "Motor mestre operacional nativo", cadence: "EVENT_DRIVEN", trigger: "APP_INTERFACE_OR_CANONICAL_SNAPSHOT", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-IA-MASTER-001", module: "M08", name: "Processamento físico e desenvolvimento local", cadence: "ON_DEMAND", trigger: "LOCAL_AUTHENTICATED_REQUEST", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-DATA-GOV-AUTONOMY-001", module: "M09", name: "Governança de dados e autonomia limitada", cadence: "EVENT_DRIVEN", trigger: "MASTER_DATA_GATE", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-USER-PROFILES-001", module: "M09", name: "Criação e revogação governada de perfis", cadence: "ON_DEMAND", trigger: "AUTHENTICATED_ADMIN_MFA", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-PROFESSIONAL-ONBOARDING-001", module: "M09", name: "Cadastro profissional e acolhimento com SLA", cadence: "EVENT_DRIVEN", trigger: "MASTER_ISSUED_ONE_USE_INVITATION_AND_VERIFIED_MFA", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-CANONICAL-RELEASE-001", module: "M10", name: "Referência única de versão e confirmação de atualização", cadence: "EVENT_DRIVEN", trigger: "REVIEWED_PROTECTED_RELEASE_PROMOTION_AND_CONNECTED_CLIENT_CHECK", state: "NATIVE_GOVERNED", tenantScope: "PLATFORM", humanGate: true, sourceMutation: false },
  { id: "AURORA-DAILY-UPDATES-001", module: "M10", name: "Manutenção de cliente, web e mobile", cadence: "DAILY", trigger: "EXISTING_HOSTED_MAINTENANCE", state: "LEGACY_MIRRORED", tenantScope: "PLATFORM", humanGate: true, sourceMutation: false },
  { id: "AURORA-INSTALL-INTEGRATION-001", module: "M08", name: "Instalação e conexão canônica retomável", cadence: "ON_DEMAND", trigger: "AUTHENTICATED_LOGIN_READBACK_OR_INSTALLER_AUTHORIZED_SOURCE", state: "NATIVE_GOVERNED", tenantScope: "PER_ORG", humanGate: true, sourceMutation: false },
  { id: "AURORA-TECH-AUDIT-WEEKLY", module: "M10", name: "Auditoria técnica semanal", cadence: "WEEKLY_ORG_CONFIG", trigger: "SCHEDULE_OR_MANUAL", state: "NATIVE_GOVERNED", tenantScope: "PLATFORM", humanGate: true, sourceMutation: false },
  { id: "AURORA-DEV-AUTONOMY-FAILSAFE-001", module: "M10", name: "Autonomia resolutiva de desenvolvimento com auditoria e recuperação", cadence: "ON_DEMAND", trigger: "OWNER_STANDING_AUTHORIZATION_AND_VERIFIED_ENGINEERING_GATES", state: "NATIVE_GOVERNED", tenantScope: "PLATFORM", humanGate: true, sourceMutation: false },
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
    documentProjectionContinuityPolicy: {
      routineId: "AURORA-PROJECTION-ENGINE",
      executor: "EXISTING_REFRESH_PROJECTION",
      trigger: "CANONICAL_AUTHENTICATED_INGEST_COMMITTED_OR_IDEMPOTENT_REPLAY",
      tenantScope: "VERIFIED_INGEST_ORGANIZATION",
      projectionFailurePreservesCanonicalReceipt: true,
      deferredProjectionState: "PENDING",
      recovery: "EXISTING_IDEMPOTENT_REPLAY_OR_15_MINUTE_SCHEDULE",
      visibleOnlineClientPollSeconds: 15,
      failedClientPollBackoffSeconds: 60,
      snapshotTimestampIsBrowserQueryTimestamp: false,
      documentReceiptIsNativeReadiness: false,
      documentReceiptIsFinancialValidation: false,
      exhaustedAuthorizedQueueIsFullDriveCoverage: false,
      offlineClientSynchronizationClaimed: false,
      schedulerCreated: false,
      sourceMutationAllowed: false,
      documentation: "docs/AURORA_BETA_DOCUMENT_PROJECTION_20261023.md"
    },
    structuredFinancialIngestionPolicy: {
      routineId: "AURORA-REV-SAN-001",
      executor: "EXISTING_SHEETS_BRIDGE",
      state: "IMPLEMENTED_PENDING_RUNTIME_VALIDATION",
      source: "docs/AURORA_STRUCTURED_FINANCIAL_FEEDING.md",
      billingIsReceipt: false,
      extractedMovementIsBankEvidence: false,
      summaryIsAdditionalTransaction: false,
      unknownBalanceFallsBackToInvoiceGross: false,
      issueDateIsDueDate: false,
      immutableRevisionsRequired: true,
      privateContractRulesCrossTenants: false,
      schedulerCreated: false,
      monthlyClosingMutation: false
    },
    // Shared operating method only. Existing ingestion/reconciliation/closing
    // executors retain their own evidence gates; this policy runs none of them.
    documentaryMonthlyClosingPolicy: {
      version: "2026-10-21",
      source: "AURORA-MO-001",
      documentation: "docs/AURORA_DOCUMENTARY_MONTHLY_CLOSING_20261021.md",
      routineIds: ["AURORA-DOCUMENT-WATCHDOG", "AURORA-REV-SAN-001", "AURORA-FIN-SOC-001"],
      tenantScope: "PER_ORG",
      registrationOnly: true,
      state: "SPECIFIED",
      runtimeAdoptionVerified: false,
      extractionOrReconciliationAlgorithmAdded: false,
      sourceAuthority: "EXPLICIT_AUTHORIZED_SOURCE_PER_ORG",
      evidenceStages: ["RECEIPT_REPORTED", "LOCATED", "EXTRACTED", "VALIDATED", "RECONCILED"],
      stageSpecificEvidenceRequired: true,
      receiptReportedIsLocated: false,
      emptySearchProvesDocumentAbsence: false,
      unavailableSourceState: "PENDING_LOCATION_OR_ACCESS",
      lookupRecovery: "EXISTING_SOURCE_THREAD_AND_BOUNDED_RETRY_WITH_RECORDED_CUTOFF",
      provenanceRequired: ["SOURCE_ID", "SOURCE_VERSION", "BYTE_HASH", "EXTRACTION_METHOD_VERSION", "FIELD_LOCATOR", "COVERAGE_INTERVAL", "AS_OF_TIME"],
      fieldEvidenceStates: ["DOCUMENTED_FACT", "INFERENCE_PENDING_VALIDATION", "NOT_ESTABLISHED"],
      moneyRepresentation: "INTEGER_CENTS",
      unknownAmountsAreZero: false,
      periodDimensions: ["SERVICE_COMPETENCE", "ISSUE_DATE", "CASH_DATE", "STATEMENT_AS_OF"],
      reportSections: [
        "EXECUTIVE_SUMMARY", "COVERAGE_AND_CUTOFF", "PRODUCTION", "BILLING", "RECEIPTS",
        "BANK_RECONCILIATION", "TRANSFERS", "TAXES", "COSTS", "GLOSSES_AND_RECOVERY_FROM_D0",
        "UNRESOLVED_FINANCIAL_ITEMS", "EVIDENCE_REFERENCES"
      ],
      bankReconciliation: {
        balanceEquation: "OPENING_PLUS_CREDITS_MINUS_DEBITS_EQUALS_CLOSING",
        sameAccountCurrencyAndCoverageRequired: true,
        overlappingStatementMovementsCountedOnce: true,
        balanceContexts: ["TRANSACTIONAL", "AVAILABLE", "INVESTMENT_GROSS", "INVESTMENT_NET"],
        automaticSweepBalanceIsAdditionalCash: false,
        investmentMovementProvesCounterpartyReceipt: false,
        sameAmountAloneProvesInvoiceSettlement: false
      },
      revenueRecovery: {
        historicalScope: "DOCUMENTED_D0_TO_CUTOFF",
        missingD0State: "PENDING",
        documentedD0ProvesOperationalStart: false,
        buckets: ["INVOICED_PRINCIPAL", "POTENTIAL_DIFFERENCE_UNDER_REVIEW", "RECOGNIZED_RECOVERABLE", "RECOVERED_BANK_RECONCILED"],
        overlapResolutionRequiredBeforeAggregation: true,
        invoiceReceiptIsAdditionalGlossRecovery: false,
        partialResponseClosesCase: false,
        missingResponseProvesRecognizedDebt: false,
        agingFrom: "DOCUMENTED_EVENT_PER_CASE",
        reminderResetsCaseAging: false
      },
      canonicalClosingSource: "organizations/{orgId}/monthlyClosings/{YYYY-MM}",
      interimCutoffState: "PRE_CLOSE_WITH_COVERAGE",
      finalReportTrigger: "EXISTING_MONTHLY_CLOSING_CLOSED",
      closedSnapshotMutationAllowed: false,
      newEvidenceTreatment: "LINKED_FINDING_AND_GOVERNED_REVISION_PRESERVING_HISTORY",
      repeatedSourceHandling: "REUSE_SOURCE_IDENTITY_AND_IDEMPOTENCY_RECEIPT",
      changedSourceHandling: "IMMUTABLE_REVISION_WITH_PROVENANCE",
      pendingCaseHandling: "REUSE_CASE_THREAD_QUEUE_AND_EFFECT_OWNER",
      sourceMutationAllowed: false,
      automaticExternalCommunicationAllowed: false,
      financialExecutionAllowed: false,
      rawTenantDataTransferAllowed: false,
      permissionsGranted: false,
      schedulerCreated: false,
      executorCreated: false,
      modelWeightsTrained: false
    },
    releaseConvergencePolicy: {
      routineId: "AURORA-CANONICAL-RELEASE-001",
      version: 3,
      source: "AURORA-MO-001",
      executorState: "IMPLEMENTED_PENDING_RUNTIME_VALIDATION",
      canonicalPointer: "platformRuntime/activeRelease",
      signatureAlgorithm: "Ed25519",
      historicalSchema1Coverage: "PARTIAL",
      requiredSchema2Components: ["server", "web", "satellite", "iaMaster", "windowsIntegration"],
      commonIdentity: ["releaseId", "productVersion", "sourceSha", "certificateSha256"],
      unifiedDelivery: "SOURCE_BOUND_PAYLOADS_WITH_PUBLIC_SIGNED_CERTIFICATE",
      unifiedDownloadEndpoint: "/downloads/Aurora-Nexus-Beta-One.zip",
      unifiedDownloadState: "IMPLEMENTED_PENDING_RUNTIME_VALIDATION",
      unifiedDownloadAuthority: "EXISTING_LIVE_SESSION_MEMBERSHIP_AND_DOWNLOAD_PERMISSION",
      unifiedDownloadFinalizer: "SHARED_PURE_NODE_ZIP_STORED",
      artifactDownloadProvesDeviceAcceptance: false,
      offlineDeviceState: "PENDING",
      mixedReleaseState: "CONFLICT",
      iosRequestedDistribution: "NATIVE_TESTFLIGHT_APP_STORE",
      iosNativeDeliveryState: "PENDING_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE",
      privateReadEndpoint: "/api/integration/active-release",
      delegatedReadScope: "integration.read",
      freshNonceAndActualRuntimeRequired: true,
      fullSynchronizationInferredFromSignedCoverage: false,
      nativeMacAcceptanceInferredFromSatellite: false,
      allClientsSynchronized: false,
      deviceReceiptsRequired: true,
      schedulerCreated: false,
      automaticInstallationEnabled: false,
      permissionsGranted: false,
      documentation: "docs/AURORA_ACTIVE_RELEASE_COMPONENTS_V2.md"
    },
    engineeringAutonomyPolicy: {
      id: "AURORA-DEV-AUTONOMY-FAILSAFE-001",
      version: "2026-10-08",
      source: "AURORA-MO-001_PERMANENT_OWNER_ADDENDUM",
      authorizationOrigin: "HUMAN_OWNER_SESSION_20261008",
      authorizationDuration: "STANDING_UNTIL_REVOKED",
      scope: ["REVERSIBLE_ENGINEERING_DELIVERY", "VALIDATED_CODE_INTEGRATION", "AUTHORIZED_HOMOLOGATION"],
      productionScope: "EXISTING_EXPLICIT_AUTHORIZATION_AND_EXECUTABLE_GATES",
      registrationOnly: true,
      executorState: "SPECIFIED",
      recoveryCoverage: "PARTIAL",
      windowsClientPartialFailureRecovery: "IMPLEMENTED",
      cloudAutomaticRollback: "SPECIFIED_NOT_IMPLEMENTED",
      permissionsGranted: false,
      permissionAuthority: "AUTHENTICATED_LIVE_MEMBERSHIP",
      repeatedOwnerPromptRequired: false,
      executableSecurityGatesRequired: true,
      authenticationAndMfaBypassAllowed: false,
      fabricatedHumanReviewReceiptAllowed: false,
      arbitraryCodeExecutionAllowed: false,
      sourceMutationAllowed: false,
      tenantRawDataTransferAllowed: false,
      validatedOutcomeRequiredForLearning: true,
      modelWeightsTrained: false,
      evidenceRequired: ["EXACT_SHA_AND_ARTIFACT_HASH", "RELEVANT_TESTS_AND_CI", "VERIFIED_PREDECESSOR_AND_BACKUP", "SMOKE_AND_READBACK", "FAILURE_AND_RECOVERY_RESULT"],
      policyReferences: ["autonomous-bugfix-realtime-audit-v1.json", "intrinsic-cloud-ai-operational-learning-v1.json"],
      documentation: "docs/AURORA_AUTONOMY_FAILSAFE_20261008.md"
    },
    cloudIntakePolicy: {
      id: "AURORA-INSTALL-INTEGRATION-001",
      adoptionProtocol: clientAdoptionPolicy(),
      version: "1.0.6",
      source: "AURORA-MO-001",
      trigger: "FIRST_AUTHENTICATED_INSTALLATION_AND_EXISTING_CLIENT_WATCH",
      executor: "AURORA_CLIENT_AGENT",
      executorState: "IMPLEMENTED_PENDING_RUNTIME_VALIDATION",
      providers: ["GOOGLE_DRIVE", "GMAIL", "MICROSOFT_MAIL", "IMAP", "NOTION", "SLACK"],
      sourceScope: "EXPLICIT_AUTHORIZED_SOURCE_PER_ORG",
      workspaceReadPolicy: {providers:["NOTION","SLACK"],notionScope:"EXPLICIT_PAGE",slackScope:"EXPLICIT_WORKSPACE_AND_MEMBER_CHANNEL",sourceMutationAllowed:false,rawNarrativeIsProcessed:false,chatgptGrantInherited:false},
      providerConsentRequired: true,
      reuseExistingAuthorizedConfiguration: true,
      metadataPreviewIsSourceIngestion: false,
      inactiveRegistrationActivatesSource: false,
      completedSourcesRequireFreshInstallationRevalidation: true,
      differentProviderPageCountsMustRemainResumable: true,
      appCredentialScope: "LIVE_AUTHENTICATED_TENANT_DOCUMENTS_INGEST",
      credentialStorage: "CURRENT_USER_DPAPI_OR_KEYCHAIN",
      credentialInBrowserOrLogsAllowed: false,
      googleDesktopOAuth: {
        sourceSchema: "aurora.google.oauth.source.v1",
        platforms: ["windows", "macos"],
        enrollment: "EXPLICIT_OPT_IN_EXTERNAL_BROWSER_LOOPBACK_PKCE_S256",
        publicDesktopClientIdRequired: true,
        missingClientIdState: "PENDING_CONFIGURATION",
        scopeProfile: "DRIVE_READONLY_EXISTING_FOLDER",
        googleScope: "https://www.googleapis.com/auth/drive.readonly",
        googleScopeRestrictsFolder: false,
        auroraFolderBoundaryRequired: true,
        credentialReference: "AURORA_GOOGLE_OAUTH_<32_UPPERCASE_HEX>",
        refreshTokenStorage: "CURRENT_USER_DPAPI_OR_KEYCHAIN",
        accessTokenStorage: "CURRENT_USER_DPAPI_OR_KEYCHAIN_AND_PROCESS_MEMORY",
        authorizationCodeVerifierAndStateStorage: "PROCESS_MEMORY_ONLY",
        mutuallyExclusiveWithLegacyTokenEnv: true,
        sourceReadyRequiresFreshProviderAccessAndExistingReceiptGates: true,
        configurationOrConsentProvesIngestion: false,
        driveFileProfileImplemented: false,
        otherProviderRenewalImplementedByThisIncrement: false,
        iosEnrollmentImplemented: false,
        runtimeEnrollmentVerified: false,
        permissionsGranted: false,
        executorCreated: false
      },
      continuation: "PERSISTED_CURSOR_AFTER_PROCESSED_PAGE_RECEIPTS",
      changedInflightPage: "BLOCK_FOR_RECONCILIATION",
      pendingExtractionBlocksCompletion: true,
      documentAcquisitionEvidence: {
        schema: "aurora.document.acquisition.v1",
        provider: "GOOGLE_DRIVE",
        supportedRepresentations: ["CANONICAL_JSON", "CANONICAL_CSV", "CANONICAL_SINGLE_SHEET_XLSX", "GOOGLE_SHEETS_FIRST_SHEET_CSV_EXPORT"],
        acquisitionAuthority: "AUTHENTICATED_CLIENT_OBSERVATION_NOT_PROVIDER_SIGNATURE",
        byteHashIsCanonicalFactsHash: false,
        textHashScope: "NORMALIZED_CANONICAL_RECORD_JSON_ONLY",
        sourceObjectVersionObservedBeforeAndAfterAcquisition: true,
        sheetsExportIsNativeWorkbookBytes: false,
        sheetsExportProvesWholeWorkbook: false,
        arbitraryFinancialInferenceAllowed: false,
        rawDocumentTextPersistedByThisIncrement: false,
        pendingObjectVersionsStoredInExistingIntakeQueue: true,
        pendingExtractionBlocksCursorAdvance: true,
        disappearanceResolvesPendingEvidence: false,
        globalDocumentIngestionVerified: false,
        runtimeProviderAcquisitionVerified: false,
        executorCreated: false
      },
      sharedDocumentExtraction: {
        schema: "aurora.document.observation.v1",
        operation: "OBSERVE_DOCUMENT_EXTRACTION",
        implementationState: "IMPLEMENTED_CANDIDATE_PENDING_CI_AND_HML",
        engine: "SHARED_BROWSER_AND_NODE_SELF_CONTAINED_FACTORY",
        nativeEndpoint: "EXISTING_INTEGRATION_DOCUMENTS",
        ephemeralContentOnly: true,
        rawDocumentTextPersisted: false,
        byteHashEqualsTextHashAssumed: false,
        sourceVersionInferredFromProviderOrMtime: false,
        observationUsesExistingEntityRevisionAndCas: true,
        observationReceiptsConcludeInstallation: false,
        observationSetsNativeReady: false,
        supportedMethods: ["TEXT_UTF8", "CSV_UTF8", "JSON_UTF8", "XML_TEXT", "DOCX_XML", "XLSX_XML", "ODT_XML", "ODS_XML"],
        unsupportedOrMissingBackend: "EXPLICIT_PENDING_WITHOUT_TEXT_OR_FACT_PROMOTION",
        pendingBackendFormats: ["PDF", "IMAGE_OCR", "LEGACY_DOC", "LEGACY_XLS", "RTF"],
        factPreview: "STRICT_NFE_TOTAL_AND_EXPLICIT_PTBR_STATEMENT_REQUIRES_HUMAN_REVIEW",
        factPromotion: "PENDING_AUTHENTICATED_REVIEW_AND_CURRENT_OBSERVATION_BINDING",
        manualIdentity: "CONTENT_ADDRESSED_DISTINCT_CONTENT_CREATES_DISTINCT_OBSERVATION",
        existingCloudWatchUsesStructuredV1UntilObservationCursorIntegration: true,
        globalDocumentIngestionVerified: false,
        permissionsGranted: false,
        executorCreated: false,
        documentation: "docs/AURORA_GLOBAL_DOCUMENT_INTAKE_20261020.md"
      },
      installationAcceptanceContract: "aurora.installation.acceptance.v1",
      installationMethods: ["CLOUD_OAUTH", "API_TOKEN", "LOCAL_AGENT", "MANUAL"],
      installationRequiresProcessingPersistenceReplayAndAutomation: true,
      manualInstallationVerification: "EXISTING_CANONICAL_RECEIPT_TWO_AUTHENTICATED_READS",
      manualInputProofScope: "DOCUMENT_IDENTITY_VERSION_AND_CANONICAL_FACTS",
      manualInstallerReplaysDocument: false,
      manualInstallerWritesSharedCheckpoint: false,
      installationCompletedByLoginOrPing: false,
      methodHintAttestsProviderOrAgent: false,
      documentFormatCoverage: "EXPLICIT_REVIEWED_ADAPTERS_WITH_EXTRACTION_PENDING_FOR_UNSUPPORTED_INPUT",
      existingLegacyContentExtractor: "src/04_EXTRACAO_DOCUMENTAL_WMGJ.gs",
      legacyContentExtractorState: "LEGACY_MIRRORED_PENDING_RUNTIME_VALIDATION",
      firstDocumentEqualsFullIngestion: false,
      completionRequiresAllAuthorizedPages: true,
      fullSynchronizationInferredFromEnumeration: false,
      sourceMutationAllowed: false,
      schedulerCreated: false,
      permissionsGranted: false,
      modelWeightsTrained: false,
      documentation: "docs/AURORA_CLOUD_FIRST_INSTALL_CONTINUATION_20261013.md"
    },
    learningCapturePolicy: {
      source: "AURORA-MO-001",
      version: "2026-10-13",
      instruction: "INCORPORATE_EACH_AVAILABLE_OPERATIONAL_PROMPT_AND_VERIFIED_RESOLUTION",
      captureScope: "AVAILABLE_AUTHORIZED_TASK_CONTEXT_ONLY",
      completeExternalChatHistoryAccess: false,
      orgScope: "AUTHENTICATED_TENANT_ONLY",
      storage: "EXISTING_NATIVE_REGISTRY_AND_GOVERNED_MOTOR_ADAPTER",
      recordRequiredForUnresolvedChallenges: true,
      lifecycle: ["OBSERVED", "PROPOSED", "VALIDATED", "PENDING", "REJECTED"],
      proofRequired: ["SOURCE_VERSION_HASH", "TEST_OR_EXECUTOR_RECEIPT", "RECOVERY_AND_USE_READBACK"],
      rawClientDataInSharedMethodsAllowed: false,
      credentialCaptureAllowed: false,
      externalAiRequired: false,
      inferencePriority: ["NATIVE_DETERMINISTIC_RULES", "EXISTING_KNOWLEDGE_REGISTRY", "AUTHORIZED_PRIVATE_LOCAL_MODEL"],
      automaticPrivilegeEscalationAllowed: false,
      modelWeightTrainingPerformed: false,
      runtimeAdoptionInferredFromDocumentation: false,
      documentation: "docs/AURORA_MASTER_KNOWHOW_TRANSFER_20261013.md"
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
