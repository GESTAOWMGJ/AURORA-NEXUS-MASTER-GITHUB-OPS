import { isEligibleNonClinicalEvidence, validEvidenceRef } from "./auroraEvidence.js";

const ACTION_TARGET_TYPES = new Set([
  "invoice", "bankTransaction", "sourceDocument", "reconciliation", "auditFinding", "managementInput"
]);
const ACTION_STATES = new Set(["OPEN", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"]);
const AUDIT_ROLES = new Set([
  "system", "platform_admin", "org_admin", "director", "auditor", "operator", "finance", "medical_auditor"
]);
const EVIDENCE_CATEGORIES = new Set([
  "FINANCIAL", "GLOSS", "CONTRACT", "PRODUCTION", "REPORT", "AUTHORIZATION", "AUDIT", "OTHER"
]);
const ORIGIN_SYSTEMS = new Set(["DRIVE", "GMAIL", "MV", "TASY", "ERP", "SHEETS", "AURORA_INTEGRATION_API", "OTHER"]);

function safeString(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function upper(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase()
    : "";
}

export function timestampIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value
    && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function publicEligibleEvidence(
  id: string,
  data: Record<string, unknown>,
  orgId: string,
  nowMillis = Date.now()
): Record<string, unknown> | null {
  if (!validEvidenceRef(id) || !isEligibleNonClinicalEvidence(data, orgId, nowMillis)) return null;
  const categoryCandidate = upper(data.documentType ?? data.category);
  const originCandidate = upper(data.originSystem ?? (data.source as Record<string, unknown> | undefined)?.system);
  const competence = safeString(data.competence, 7);
  const updatedAt = timestampIso(data.updatedAt);
  if (!updatedAt) return null;
  return {
    id,
    category: EVIDENCE_CATEGORIES.has(categoryCandidate) ? categoryCandidate : "EVIDENCE",
    originSystem: ORIGIN_SYSTEMS.has(originCandidate) ? originCandidate : "UNKNOWN",
    competence: competence && /^\d{4}-(0[1-9]|1[0-2])$/.test(competence) ? competence : null,
    workflowState: upper(data.workflowState),
    updatedAt
  };
}

export function publicAuditEvent(
  id: string,
  data: Record<string, unknown>,
  orgId: string
): Record<string, unknown> | null {
  if (!validEvidenceRef(id) || safeString(data.orgId, 160) !== orgId || data.sanitized !== true) return null;
  if (!["PUBLIC", "INTERNAL"].includes(upper(data.sensitivity))) return null;
  const type = upper(data.type ?? data.action);
  const occurredAt = timestampIso(data.occurredAt);
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(type) || !occurredAt) return null;
  const actionId = validEvidenceRef(data.actionId) ? data.actionId : null;
  const targetType = safeString(data.targetType, 64);
  const targetId = validEvidenceRef(data.targetId) ? data.targetId : null;
  const fromState = upper(data.fromState);
  const toState = upper(data.toState);
  const revision = Number.isSafeInteger(data.revision) && Number(data.revision) > 0 ? Number(data.revision) : null;
  const evidenceRefCount = Number.isSafeInteger(data.evidenceRefCount) && Number(data.evidenceRefCount) >= 0
    ? Number(data.evidenceRefCount) : null;
  const actorRole = safeString(data.actorRole, 32);
  return {
    id,
    type,
    occurredAt,
    actionId,
    targetType: targetType && ACTION_TARGET_TYPES.has(targetType) ? targetType : null,
    targetId,
    fromState: ACTION_STATES.has(fromState) ? fromState : null,
    toState: ACTION_STATES.has(toState) ? toState : null,
    revision,
    evidenceRefCount,
    actorRole: actorRole && AUDIT_ROLES.has(actorRole) ? actorRole : null
  };
}

function evidenceRefs(record: Record<string, unknown>): string[] | null {
  const raw = record.evidenceRefs;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const refs = raw.map((item) => typeof item === "string" ? item.trim() : "");
  return refs.every(validEvidenceRef) && new Set(refs).size === refs.length ? refs : null;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

export function managerInputTransitionPatch(input: {
  orgId: string;
  actionId: string;
  actorUid: string;
  expectedRevision: number;
  type: "ACKNOWLEDGE" | "RESOLVE";
  resolutionCode?: string;
  resolutionEvidenceRefs?: readonly string[];
  action: Record<string, unknown>;
  managerInput: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  if (input.action.targetType !== "managementInput") return null;
  if (!input.managerInput) throw new Error("TARGET_NOT_FOUND");
  if (input.managerInput.orgId !== input.orgId) throw new Error("TARGET_SCOPE_VIOLATION");
  if (!validEvidenceRef(input.actionId) || input.managerInput.actionId !== input.actionId) {
    throw new Error("TARGET_ACTION_MISMATCH");
  }
  if (input.managerInput.revision !== input.expectedRevision) throw new Error("TARGET_REVISION_CONFLICT");
  const expectedState = input.type === "ACKNOWLEDGE" ? "OPEN" : "ACKNOWLEDGED";
  if (input.managerInput.state !== expectedState) throw new Error("TARGET_STATE_CONFLICT");

  const actionRefs = evidenceRefs(input.action);
  const targetRefs = evidenceRefs(input.managerInput);
  if (!actionRefs || !targetRefs || !sameSet(actionRefs, targetRefs)) throw new Error("EVIDENCE_SET_MISMATCH");
  if (input.type === "RESOLVE") {
    const resolutionRefs = (input.resolutionEvidenceRefs ?? []).map((item) => item.trim());
    if (!sameSet(actionRefs, resolutionRefs)) throw new Error("EVIDENCE_SET_MISMATCH");
  }

  return {
    state: input.type === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED",
    revision: input.expectedRevision + 1,
    evidenceRefs: [...actionRefs],
    resolutionCode: input.type === "RESOLVE" ? input.resolutionCode ?? null : null,
    updatedBy: input.actorUid
  };
}
