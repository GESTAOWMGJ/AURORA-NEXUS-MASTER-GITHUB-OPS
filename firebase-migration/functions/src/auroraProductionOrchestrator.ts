export const AURORA_BETA_PRODUCTION_ORCHESTRATOR_VERSION = "0.1.0-beta-command";

export type BetaProductionActionState = "READY" | "PENDING" | "BLOCKED" | "UNKNOWN";

export type BetaProductionAction = {
  id: string;
  label: string;
  state: BetaProductionActionState;
  evidence: string;
  risk: string;
  nextAction: string;
  acceptance: string;
  blocker: string | null;
};

type OrchestratorContext = {
  actionSummary?: Record<string, unknown>;
  financialStatus?: Record<string, unknown> | null;
  release?: Record<string, unknown>;
  productionCommand?: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanState(value: unknown): BetaProductionActionState {
  if (value === true) return "READY";
  if (value === false) return "PENDING";
  return "UNKNOWN";
}

function buildCommandGate(command: Record<string, unknown>): BetaProductionAction {
  const approvedProject = command.approvedProjectConfigured === true;
  const wifProvider = command.wifProviderConfigured === true;
  const serviceAccount = command.serviceAccountConfigured === true;
  const ready = approvedProject && wifProvider && serviceAccount;
  return {
    id: "production-command-credentials",
    label: "Credencial de comando para fluxo produtivo",
    state: ready ? "READY" : "BLOCKED",
    evidence: ready
      ? "Marcadores booleanos indicam APPROVED_PROJECT, WIF_PROVIDER e PROVISION_SERVICE_ACCOUNT configurados."
      : "Fluxo produtivo exige APPROVED_PROJECT, WIF_PROVIDER e PROVISION_SERVICE_ACCOUNT como variaveis protegidas; valores nunca sao expostos ao motor.",
    risk: ready
      ? "Baixo para o disparo tecnico; ainda depende do resultado do workflow."
      : "Sem esses tres marcadores o workflow falha antes da autenticacao e nao cria recursos.",
    nextAction: ready
      ? "Disparar workflow autorizado e acompanhar conclusao por run id."
      : "Configurar as variaveis protegidas no ambiente de comando e repetir o disparo.",
    acceptance: "Workflow produtivo passa da etapa Validate exact production creation request sem revelar segredos.",
    blocker: ready ? null : "COMMAND_CREDENTIALS_REQUIRED"
  };
}

export function buildBetaProductionOrchestrator(
  projection: Record<string, unknown>,
  context: OrchestratorContext = {},
  now = new Date()
): Record<string, unknown> {
  const dataQuality = record(projection.dataQuality);
  const operations = record(projection.operations);
  const documentIntelligence = record(projection.documentIntelligence);
  const nativeDataPlane = record(projection.nativeDataPlane);
  const release = record(context.release);
  const actionSummary = record(context.actionSummary);
  const productionCommand = record(context.productionCommand);

  const sourcePresent = dataQuality.sourcePresent === true;
  const openActions = finiteNumber(actionSummary.open) ?? finiteNumber(operations.openActions);
  const overdueActions = finiteNumber(actionSummary.overdue) ?? finiteNumber(operations.overdueActions);
  const pendingDocumentFlow = finiteNumber(documentIntelligence.pendingDocumentFlow);
  const sourceIndependent = nativeDataPlane.storage === "FIRESTORE" && nativeDataPlane.sourceAccessDuringInference === false;
  const commandGate = buildCommandGate(productionCommand);

  const actions: BetaProductionAction[] = [
    {
      id: "client-login-refresh",
      label: "Login atualiza base, versao do client, documentos e pendencias",
      state: "READY",
      evidence: "Contrato pos-login versionado no instalavel simplificado e no motor beta.",
      risk: "Se o login ocorrer sem refresh, o cliente percebe versao antiga ou fila incompleta.",
      nextAction: "Executar refresh leve a cada login autenticado e registrar recibo de ciclo.",
      acceptance: "Resposta pos-login retorna versao ativa, ingestao on-time solicitada e fila de pendencias atualizada.",
      blocker: null
    },
    {
      id: "on-time-document-ingestion",
      label: "Ingestao on-time de documentos e pendencias",
      state: sourcePresent ? "READY" : "PENDING",
      evidence: sourcePresent ? "Snapshot informa fonte operacional presente." : "Fonte operacional suficiente ainda nao aparece no snapshot.",
      risk: sourcePresent ? "Risco operacional normal de fila atrasada." : "Login pode abrir interface sem base nova.",
      nextAction: sourcePresent ? "Manter ingestao incremental por login e por fonte autorizada." : "Executar refresh de ingestao apos login e registrar documentos pendentes por origem.",
      acceptance: "Snapshot atual demonstra sourcePresent=true e pendencias segregadas por origem/estado.",
      blocker: sourcePresent ? null : "SOURCE_REFRESH_REQUIRED"
    },
    {
      id: "pending-queue-control",
      label: "Fila de pendencias priorizada pelo motor intrinseco",
      state: (openActions ?? 0) > 0 || (overdueActions ?? 0) > 0 || (pendingDocumentFlow ?? 0) > 0 ? "PENDING" : "READY",
      evidence: `openActions=${openActions ?? "unknown"}; overdueActions=${overdueActions ?? "unknown"}; pendingDocumentFlow=${pendingDocumentFlow ?? "unknown"}`,
      risk: "Fila nao priorizada vira operacao manual e perde fluidez comercial.",
      nextAction: "Ordenar pendencias por risco, aging e impacto; abrir uma proxima acao por vez.",
      acceptance: "Fila retorna uma proxima acao clara com responsavel operacional e criterio de aceite.",
      blocker: null
    },
    {
      id: "native-beta-snapshot",
      label: "Motor IA intrinseco baseado em snapshot nativo",
      state: sourceIndependent ? "READY" : "BLOCKED",
      evidence: sourceIndependent ? "nativeDataPlane.storage=FIRESTORE e sourceAccessDuringInference=false." : "Contrato nativo do snapshot ainda nao esta comprovado.",
      risk: sourceIndependent ? "Baixo para leitura assistida." : "Motor dependeria de releitura da origem no momento errado.",
      nextAction: sourceIndependent ? "Usar snapshot para recomendacao beta e aprendizado organico." : "Regenerar snapshot nativo antes de promover acompanhamento beta.",
      acceptance: "Motor opera sem chamada externa, sem token no front-end e com evidencia do snapshot.",
      blocker: sourceIndependent ? null : "FIREBASE_NATIVE_CONTRACT_REQUIRED"
    },
    commandGate
  ];

  const blocked = actions.find((item) => item.state === "BLOCKED") ?? null;
  const pending = actions.find((item) => item.state === "PENDING") ?? null;
  const next = blocked ?? pending ?? actions[0];

  return {
    engine: "AURORA_BETA_PRODUCTION_ORCHESTRATOR",
    version: AURORA_BETA_PRODUCTION_ORCHESTRATOR_VERSION,
    generatedAt: Number.isFinite(now.getTime()) ? now.toISOString() : null,
    productHierarchy: { systemMother: "AURORA_NEXUS", pilot: "WMGJ_OPERACAO" },
    mode: "BETA_INTRINSIC_ASSISTED_PRODUCTION",
    externalAiUsed: false,
    sourceAccessDuringInference: false,
    productionMutationAuthority: "WORKFLOW_ONLY_AFTER_COMMAND_CREDENTIALS",
    redundancyPolicy: {
      installableClient: "SINGLE_ACT_LIGHT_INSTALL",
      heavyValidation: "POST_LOGIN_OR_FAILURE_ONLY",
      customerAssumesInstallRisk: true,
      postInstallLearning: true
    },
    postLoginContract: {
      implicitOnEveryLogin: true,
      actions: [
        "CLIENT_VERSION_REFRESH",
        "ON_TIME_DOCUMENT_INGESTION",
        "PENDING_QUEUE_REFRESH",
        "INTERFACE_IMPROVEMENT_REFRESH"
      ]
    },
    release: {
      productVersion: release.productVersion ?? null,
      releaseTrain: release.releaseTrain ?? null,
      readinessPercent: release.engineeringReadinessPercent ?? null
    },
    actions,
    nextAction: next,
    commandGate: {
      requiredProtectedVariables: ["APPROVED_PROJECT", "WIF_PROVIDER", "PROVISION_SERVICE_ACCOUNT"],
      valuesExposed: false,
      lastKnownBlocker: commandGate.blocker
    }
  };
}
