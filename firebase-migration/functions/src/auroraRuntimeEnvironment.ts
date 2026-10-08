export const HML_RUNTIME_PROJECT_ID = "wmgj-hml-jfn-20260927";
export const HML_RUNTIME_SERVICE_ACCOUNT = "299889357292-compute@developer.gserviceaccount.com";

export type OrganizationEnvironment = "HOMOLOGATION" | "PRODUCTION" | "UNKNOWN";
export type IngestOrganizationRejection =
  | "ORGANIZATION_NOT_BOOTSTRAPPED"
  | "ORGANIZATION_GUARDRAILS_INVALID";

/** Only live metadata of the authenticated organization can label its runtime. */
export function authenticatedOrganizationEnvironment(
  organization: Record<string, unknown> | undefined
): OrganizationEnvironment {
  if (organization?.active !== true) return "UNKNOWN";
  return organization.environment === "HOMOLOGATION" || organization.environment === "PRODUCTION"
    ? organization.environment
    : "UNKNOWN";
}

/** HML preserves its existing contract; production requires an explicit beta gate. */
export function ingestOrganizationRejection(
  exists: boolean,
  organization: Record<string, unknown> | undefined
): IngestOrganizationRejection | null {
  if (!exists || !organization) return "ORGANIZATION_NOT_BOOTSTRAPPED";
  const environmentAllowed = organization.environment === "HOMOLOGATION"
    || (organization.environment === "PRODUCTION"
      && organization.deploymentStage === "PRODUCTION_BETA"
      && organization.projectionEnabled === true);
  if (organization.active !== true || !environmentAllowed
    || organization.projectionMode !== "SHADOW"
    || organization.sourceMutation !== false
    || organization.productionMutation !== false
    || organization.clinicalSensitiveEnabled !== false) {
    return "ORGANIZATION_GUARDRAILS_INVALID";
  }
  return null;
}
