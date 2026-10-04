import { createHash } from "node:crypto";

/** Canonical native policy. Describes the master planner, not permission to call an API. */
export const DATA_GOVERNANCE_POLICY = Object.freeze({
  id: "AURORA-DATA-GOV-AUTONOMY-001",
  version: "1.0.0",
  effectiveLevel: "A1_RECOMMEND_ONLY",
  purpose: "OPERATIONAL_GOVERNANCE",
  maxSnapshotAgeMs: 30 * 60 * 1000,
  maxFutureSkewMs: 60 * 1000,
  maxAutonomousWrites: 0,
  maxExternalAiCalls: 0,
  maxSourceMutations: 0,
  failClosed: true,
  unknownIsZero: false,
  trainingMode: "VERSIONED_RULES_AND_SYNTHETIC_EVALUATIONS",
  modelWeightsTrained: false
} as const);
export const DATA_GOVERNANCE_POLICY_HASH = createHash("sha256")
  .update(JSON.stringify(DATA_GOVERNANCE_POLICY)).digest("hex");

export type GovernanceDecision = "ALLOW" | "DENY" | "REVIEW";
export type NativeDataAssessment = {
  policyId: string;
  policyVersion: string;
  policyHash: string;
  decision: GovernanceDecision;
  scope: "NATIVE_RECOMMENDATION_ONLY";
  reasonCodes: string[];
  snapshotId: string | null;
  sourceHash: string | null;
  snapshotAgeMs: number | null;
  executionAuthorized: false;
};
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function knownCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function safeId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

/** Checks data readiness, never identity. Session/RBAC/facility checks remain mandatory upstream. */
export function assessNativeData(projection: unknown, now = new Date()): NativeDataAssessment {
  const p = record(projection), plane = record(p.nativeDataPlane), quality = record(p.dataQuality);
  const reasons: string[] = [];
  const snapshotId = safeId(p.snapshotId);
  const sourceHash = typeof p.sourceHash === "string" && /^[a-f0-9]{64}$/i.test(p.sourceHash) ? p.sourceHash : null;
  const asOf = typeof p.asOf === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p.asOf) ? Date.parse(p.asOf) : NaN;
  const age = now.getTime() - asOf;
  if (!safeId(p.orgId)) reasons.push("GOV_ORG_REQUIRED");
  if (!snapshotId || !sourceHash) reasons.push("GOV_SNAPSHOT_PROVENANCE_REQUIRED");
  if (p.schemaVersion !== 2 || p.policyVersion !== "aurora-nexus-2.4.0-firebase-native-v1") reasons.push("GOV_SNAPSHOT_VERSION_UNSUPPORTED");
  if (typeof p.competence !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.competence)) reasons.push("GOV_COMPETENCE_REQUIRED");
  if (p.sanitized !== true || p.sensitivity !== "INTERNAL") reasons.push("GOV_SENSITIVITY_BLOCKED");
  if (p.revoked === true || p.revokedAt != null) reasons.push("GOV_EVIDENCE_REVOKED");
  if (plane.storage !== "FIRESTORE" || plane.sourceAccessDuringInference !== false || plane.externalAiRequired !== false) reasons.push("GOV_NATIVE_BOUNDARY_REQUIRED");
  if (!Number.isFinite(age)) reasons.push("GOV_FRESHNESS_UNPROVEN");
  else if (age < -DATA_GOVERNANCE_POLICY.maxFutureSkewMs) reasons.push("GOV_FUTURE_SNAPSHOT");
  else if (age > DATA_GOVERNANCE_POLICY.maxSnapshotAgeMs) reasons.push("GOV_STALE_SNAPSHOT");
  if (quality.sourcePresent !== true || quality.complete !== true || quality.invalidFinancialRecords !== 0) reasons.push("GOV_DATA_QUALITY_UNPROVEN");
  const docs = record(p.documentIntelligence);
  let review = false;
  for (const key of ["sourceDependentDocuments", "fragileDocuments", "overdueDocumentSla"]) {
    const count = knownCount(docs[key]);
    if (count === null) { reasons.push("GOV_DOCUMENT_COVERAGE_UNPROVEN"); review = true; }
    else if (count > 0) { reasons.push("GOV_DOCUMENT_REVIEW_REQUIRED"); review = true; }
  }
  const hardReasons = reasons.filter(code => !["GOV_DOCUMENT_COVERAGE_UNPROVEN", "GOV_DOCUMENT_REVIEW_REQUIRED"].includes(code));
  return {
    policyId: DATA_GOVERNANCE_POLICY.id, policyVersion: DATA_GOVERNANCE_POLICY.version,
    policyHash: DATA_GOVERNANCE_POLICY_HASH,
    decision: hardReasons.length > 0 ? "DENY" : review ? "REVIEW" : "ALLOW",
    scope: "NATIVE_RECOMMENDATION_ONLY",
    reasonCodes: [...new Set(reasons.length ? reasons : ["GOV_NATIVE_DATA_READY"])],
    snapshotId, sourceHash, snapshotAgeMs: Number.isFinite(age) ? age : null,
    executionAuthorized: false
  };
}

const COMMANDS = Object.freeze([
  { command: "REFRESH_PROJECTION", endpoint: "/api/refresh" },
  { command: "CREATE_REVIEW", endpoint: "/api/actions" },
  { command: "ACKNOWLEDGE_ACTION", endpoint: "/api/actions" },
  { command: "RESOLVE_WITH_EVIDENCE", endpoint: "/api/actions" },
  { command: "MANAGE_INTEGRATION", endpoint: "/api/integration-keys" },
  { command: "DISTRIBUTION_DECISION", endpoint: "/api/distribution-approval" }
].map(item => Object.freeze(item)));

/** An assessment is not a capability token. No master write executor exists in this release. */
export function assessMasterCommand(command: unknown, dataDecision: GovernanceDecision): Record<string, unknown> {
  const candidate = COMMANDS.find(item => item.command === command);
  const denied = !candidate || (dataDecision !== "ALLOW" && dataDecision !== "REVIEW" && command !== "REFRESH_PROJECTION");
  return {
    command: candidate?.command ?? "UNKNOWN", ...(candidate && !denied ? { endpoint: candidate.endpoint } : {}),
    decision: denied ? "DENY" : "REVIEW",
    reasonCode: !candidate ? "GOV_COMMAND_NOT_ALLOWLISTED" : denied ? "GOV_DATA_GATE_BLOCKED" : "GOV_HUMAN_ENDPOINT_REQUIRED",
    humanGate: true, executionAllowed: false, sourceMutation: false,
    permissionRecheckRequired: true, evidenceRecheckRequired: true,
    policyId: DATA_GOVERNANCE_POLICY.id, policyVersion: DATA_GOVERNANCE_POLICY.version
  };
}
export function masterCommandSurface(dataDecision: GovernanceDecision): Array<Record<string, unknown>> {
  return COMMANDS.map(item => assessMasterCommand(item.command, dataDecision));
}
