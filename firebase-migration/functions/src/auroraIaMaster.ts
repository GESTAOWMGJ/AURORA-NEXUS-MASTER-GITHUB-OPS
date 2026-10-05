/** Shared by the private web app and the physical local worker. No provider calls. */
export const IA_MASTER_POLICY = Object.freeze({
  id: "AURORA-IA-MASTER-001", version: "1.0.0",
  executionOrder: ["NATIVE_RULE", "LOCAL_MODEL", "EXTERNAL_DISABLED"],
  externalAiEnabled: false, maxExternalAiCalls: 0,
  localModelPurpose: "ENGINEERING_PROPOSALS", localBusinessAuthority: false,
  arbitraryCodeExecution: false, modelWeightsTraining: false,
  tenantRawDataTransfer: false, sourceMutation: false,
  promotionGates: ["ISOLATED_PATCH", "TESTS", "SECURITY_REVIEW", "CI", "HML", "ROLLBACK"],
  cycle: ["OBSERVAR", "INGESTAR", "COMPROVAR", "CONFRONTAR", "DETECTAR", "PRIORIZAR", "AGIR", "VALIDAR", "MEDIR", "APRENDER", "REUTILIZAR"]
});

export const IA_MASTER_INTEGRATIONS = Object.freeze([
  { id: "FIREBASE", purpose: "Identidade e memória operacional canônica", capability: "EXISTING_APP", localState: "AUTHENTICATED_SYNC_REQUIRED" },
  { id: "GITHUB", purpose: "Código, revisão, CI e releases", capability: "EXISTING_REPOSITORY", localState: "RUNTIME_CREDENTIAL_REQUIRED" },
  { id: "GOOGLE_WORKSPACE", purpose: "Drive, Gmail e documentos de origem", capability: "EXISTING_CONNECTOR", localState: "SCOPED_OAUTH_REQUIRED" },
  { id: "AIRTABLE", purpose: "Bases operacionais autorizadas", capability: "INTEGRATION_RECIPE", localState: "SCOPED_CREDENTIAL_REQUIRED" },
  { id: "NOTION", purpose: "Documentação e procedimentos", capability: "INTEGRATION_RECIPE", localState: "SCOPED_CREDENTIAL_REQUIRED" },
  { id: "SLACK", purpose: "Alertas autorizados", capability: "INTEGRATION_RECIPE", localState: "SCOPED_CREDENTIAL_REQUIRED" },
  { id: "FIGMA_ADOBE", purpose: "Design e material institucional", capability: "INTEGRATION_RECIPE", localState: "SCOPED_CREDENTIAL_REQUIRED" },
  { id: "SITES", purpose: "Publicação de superfícies complementares", capability: "INTEGRATION_RECIPE", localState: "EXISTING_FIREBASE_APP_PRESERVED" },
  { id: "SECURITY", purpose: "Análise estática e segurança de releases", capability: "EXISTING_CI", localState: "SCAN_EVIDENCE_REQUIRED" }
]);

export function iaMasterCapability() {
  return { policy: IA_MASTER_POLICY, integrations: IA_MASTER_INTEGRATIONS,
    localServer: { state: "NOT_ATTESTED_BY_CLOUD", endpoint: "http://127.0.0.1:38765", authentication: "LOCAL_WINDOWS_ACCOUNT_PAIRING" },
    development: { output: "REVIEWABLE_PROPOSAL", autonomousDeployment: false, sharedMemory: "VALIDATED_ABSTRACT_PATTERNS_ONLY" }
  };
}
