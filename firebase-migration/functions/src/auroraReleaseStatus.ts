export const AURORA_PRODUCT_VERSION = "1.0.0-rc.1";
export const AURORA_RELEASE_TRAIN = "2026.09";

export type ReleaseGateStatus = "DONE" | "IN_PROGRESS" | "BLOCKED" | "PLANNED";

export type ReleaseGate = {
  id: string;
  label: string;
  status: ReleaseGateStatus;
  weight: number;
  detail: string;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function buildReleaseStatus(organization: Record<string, unknown> = {}): Record<string, unknown> {
  const organicSectors = stringArray(organization.organicSectors);
  const organicReady = organization.active === true
    && organization.organicEnabled === true
    && organicSectors.includes("AUDIT")
    && organicSectors.includes("FINANCE");

  const gates: ReleaseGate[] = [
    {
      id: "private-access",
      label: "Login-first, sessão, RBAC e isolamento",
      status: "DONE",
      weight: 15,
      detail: "Shell privado, membership individual, sessão revogável e segregação organizacional implementados."
    },
    {
      id: "operational-core",
      label: "Core M01–M10 + M03.1",
      status: "DONE",
      weight: 15,
      detail: "Ingestão, evidência, receita, glosas, SLA, governança, analytics, integrações, segurança e trilha de auditoria presentes no núcleo."
    },
    {
      id: "organic-wmgj",
      label: "AURORA-ORG-001 no piloto WMGJ",
      status: organicReady ? "DONE" : "BLOCKED",
      weight: 15,
      detail: organicReady
        ? "Runtime orgânico habilitado para AUDIT e FINANCE no tenant WMGJ."
        : "Tenant ainda não comprova active + organicEnabled + setores AUDIT/FINANCE."
    },
    {
      id: "native-intelligence",
      label: "Aurora Native Intelligence v0",
      status: "DONE",
      weight: 10,
      detail: "Motor próprio com regras explicáveis para riscos financeiros, SLA, qualidade de dados e próximas ações."
    },
    {
      id: "real-data-ingestion",
      label: "Ingestão operacional real governada",
      status: "BLOCKED",
      weight: 15,
      detail: "Gate permanece fechado até restore real comprovado, keyring HMAC promovido e amostra operacional autorizada."
    },
    {
      id: "collective-intelligence",
      label: "M12 Collective Intelligence",
      status: "PLANNED",
      weight: 10,
      detail: "Privacy Gate, Knowledge Capsule, Registry e Pattern Matcher estão especificados; runtime multi-tenant ainda requer implementação/homologação."
    },
    {
      id: "desktop-continuity",
      label: "Atualização in-place do aplicativo Mac",
      status: "BLOCKED",
      weight: 10,
      detail: "Baseline instalada precisa de inspeção técnica e teste nativo antes de qualquer substituição controlada."
    },
    {
      id: "commercial-hardening",
      label: "Hardening e release comercial",
      status: "IN_PROGRESS",
      weight: 10,
      detail: "Faltam fechar ingestão real, recuperação, empacotamento assinado quando aplicável, documentação comercial e aceite final."
    }
  ];

  const totalWeight = gates.reduce((sum, gate) => sum + gate.weight, 0);
  const doneWeight = gates.filter((gate) => gate.status === "DONE").reduce((sum, gate) => sum + gate.weight, 0);

  return {
    productVersion: AURORA_PRODUCT_VERSION,
    releaseTrain: AURORA_RELEASE_TRAIN,
    target: "SELLABLE_GA",
    userProfiles: { routineId: "AURORA-USER-PROFILES-001", version: "1.0.0", status: "IMPLEMENTED_PENDING_LIVE_VALIDATION", verifiedEmailRequired: true, mfaRequired: true, tenantOptInRequired: true, productionVerified: false },
    dailyUpdates: { routineId: "AURORA-DAILY-UPDATES-001", webPwaCheckIntervalHours: 24, status: "IMPLEMENTED_PENDING_LIVE_VALIDATION", desktopBinaryUpdateVerified: false, mobileDeviceVerified: false, productionVerified: false },
    installerIntegration: {
      routineId: "AURORA-INSTALL-INTEGRATION-001",
      componentVersion: "1.0.0",
      status: "IMPLEMENTED_PENDING_LIVE_VALIDATION",
      credentialProvisioning: "EXISTING_ADMIN_MFA_FLOW",
      sampleReceiptRequired: true,
      fullSynchronizationVerified: false,
      detail: "Instalação retomável e recibo por amostra; credencial, IAM, deploy e reconciliação real continuam sujeitos aos gates existentes."
    },
    engineeringReadinessPercent: Math.round((doneWeight / totalWeight) * 100),
    metricNote: "Percentual ponderado dos gates de engenharia versionados; não representa avaliação comercial, regulatória ou financeira.",
    gates,
    nextGate: gates.find((gate) => gate.status === "BLOCKED" || gate.status === "IN_PROGRESS" || gate.status === "PLANNED") ?? null
  };
}
