import { createHash } from "node:crypto";

export type IntegrationDocumentPayload = {
  sourceSystem: "MV" | "TASY" | "ERP";
  externalDocumentId: string;
  sourceVersion: number;
  occurredAt: string;
  documentType: "FINANCIAL" | "GLOSS" | "CONTRACT" | "PRODUCTION" | "REPORT" | "AUTHORIZATION" | "OTHER";
  competence: string | null;
  amountCents: number | null;
  count: number | null;
  workflowState: "RECEIVED" | "QUEUED" | "CLASSIFIED" | "EXTRACTED" | "NORMALIZED" | "VALIDATED" | "PENDING_HUMAN_REVIEW" | "PENDING_EVIDENCE" | "BLOCKED" | "FAILED";
  slaDueAt: string | null;
  documentFragility: "NONE" | "DEGRADED_EXTRACTION" | "LOW_CONFIDENCE" | "MISSING_CANONICAL_FIELDS";
  missingFieldsCount: number;
  nativeReady: boolean;
  sourceIndependent: boolean;
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const SYSTEMS = new Set(["MV", "TASY", "ERP"]);
const TYPES = new Set(["FINANCIAL", "GLOSS", "CONTRACT", "PRODUCTION", "REPORT", "AUTHORIZATION", "OTHER"]);
const WORKFLOW = new Set(["RECEIVED", "QUEUED", "CLASSIFIED", "EXTRACTED", "NORMALIZED", "VALIDATED", "PENDING_HUMAN_REVIEW", "PENDING_EVIDENCE", "BLOCKED", "FAILED"]);
const FRAGILITY = new Set(["NONE", "DEGRADED_EXTRACTION", "LOW_CONFIDENCE", "MISSING_CANONICAL_FIELDS"]);
const ALLOWED_KEYS = new Set([
  "sourceSystem", "externalDocumentId", "sourceVersion", "occurredAt", "documentType",
  "competence", "amountCents", "count", "workflowState", "slaDueAt",
  "documentFragility", "missingFieldsCount", "nativeReady", "sourceIndependent"
]);

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function optionalNonNegativeInteger(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

export function parseIntegrationDocumentPayload(value: unknown): IntegrationDocumentPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !ALLOWED_KEYS.has(key))) return null;

  const sourceSystem = typeof raw.sourceSystem === "string" ? raw.sourceSystem.trim().toUpperCase() : "";
  const externalDocumentId = typeof raw.externalDocumentId === "string" ? raw.externalDocumentId.trim() : "";
  const occurredAt = isoDate(raw.occurredAt);
  const documentType = typeof raw.documentType === "string" ? raw.documentType.trim().toUpperCase() : "";
  const workflowState = typeof raw.workflowState === "string" ? raw.workflowState.trim().toUpperCase() : "";
  const documentFragility = typeof raw.documentFragility === "string" ? raw.documentFragility.trim().toUpperCase() : "NONE";
  const competence = raw.competence === undefined || raw.competence === null || raw.competence === ""
    ? null
    : typeof raw.competence === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.competence) ? raw.competence : undefined;
  const slaDueAt = raw.slaDueAt === undefined || raw.slaDueAt === null || raw.slaDueAt === ""
    ? null
    : isoDate(raw.slaDueAt);
  const amountCents = optionalNonNegativeInteger(raw.amountCents);
  const count = optionalNonNegativeInteger(raw.count);
  const missingFieldsCount = optionalNonNegativeInteger(raw.missingFieldsCount);
  const sourceVersion = raw.sourceVersion;

  if (!SYSTEMS.has(sourceSystem) || !ID_RE.test(externalDocumentId)) return null;
  if (!Number.isSafeInteger(sourceVersion) || Number(sourceVersion) < 1) return null;
  if (!occurredAt || !TYPES.has(documentType) || !WORKFLOW.has(workflowState) || !FRAGILITY.has(documentFragility)) return null;
  if (competence === undefined || slaDueAt === undefined || amountCents === undefined || count === undefined || missingFieldsCount === undefined) return null;
  if (typeof raw.nativeReady !== "boolean" || typeof raw.sourceIndependent !== "boolean") return null;
  if (raw.sourceIndependent && !raw.nativeReady) return null;
  if (raw.nativeReady && documentFragility === "DEGRADED_EXTRACTION") return null;

  return {
    sourceSystem: sourceSystem as IntegrationDocumentPayload["sourceSystem"],
    externalDocumentId,
    sourceVersion: Number(sourceVersion),
    occurredAt,
    documentType: documentType as IntegrationDocumentPayload["documentType"],
    competence,
    amountCents,
    count,
    workflowState: workflowState as IntegrationDocumentPayload["workflowState"],
    slaDueAt,
    documentFragility: documentFragility as IntegrationDocumentPayload["documentFragility"],
    missingFieldsCount: missingFieldsCount ?? 0,
    nativeReady: raw.nativeReady,
    sourceIndependent: raw.sourceIndependent
  };
}

export function canonicalIntegrationDocument(
  orgId: string,
  payload: IntegrationDocumentPayload
): Record<string, unknown> {
  const sourceIdHash = createHash("sha256")
    .update(`${orgId}:${payload.sourceSystem}:${payload.externalDocumentId}`)
    .digest("hex");
  const facts: Record<string, unknown> = {
    category: payload.documentType.toLowerCase(),
    competence: payload.competence,
    nativeReady: payload.nativeReady,
    sourceIndependent: payload.sourceIndependent,
    externalFetchRequired: !payload.sourceIndependent,
    externalAiUsed: false,
    documentFragility: payload.documentFragility,
    missingFieldsCount: payload.missingFieldsCount,
    flowStage: "FIREBASE_CANONICALIZED",
    canonicalSnapshotVersion: 1,
    originSystem: payload.sourceSystem,
    originConnector: "AURORA_INTEGRATION_API",
    sanitized: true
  };
  if (payload.amountCents !== null) facts.amountCents = payload.amountCents;
  if (payload.count !== null) facts.count = payload.count;
  if (payload.slaDueAt !== null) facts.slaDueAt = payload.slaDueAt;

  const canonicalSnapshotHash = createHash("sha256")
    .update(JSON.stringify(facts))
    .digest("hex");
  return {
    id: sourceIdHash.slice(0, 48),
    sourceIdHash,
    canonicalSnapshotHash,
    facts
  };
}
