import { containsRestrictedOperationalText } from "./policy.js";

const ACTION_TARGET_COLLECTIONS: Readonly<Record<string, string>> = Object.freeze({
  invoice: "invoices",
  bankTransaction: "bankTransactions",
  sourceDocument: "sourceDocuments",
  reconciliation: "reconciliations",
  auditFinding: "auditFindings",
  managementInput: "managerInputs"
});

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const NON_CLINICAL_EVIDENCE_TYPES = new Set([
  "FINANCIAL",
  "GLOSS",
  "CONTRACT",
  "PRODUCTION",
  "REPORT",
  "AUTHORIZATION",
  "AUDIT"
]);

export type ResolutionEvidenceErrorCode =
  | "ACTION_SCOPE_VIOLATION"
  | "TARGET_NOT_FOUND"
  | "TARGET_SCOPE_VIOLATION"
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_SCOPE_VIOLATION"
  | "EVIDENCE_NOT_ELIGIBLE"
  | "EVIDENCE_NOT_LINKED"
  | "EVIDENCE_SET_MISMATCH";

export type ResolutionEvidenceResult =
  | { ok: true; evidenceRefs: string[] }
  | { ok: false; code: ResolutionEvidenceErrorCode };

export type FirestoreDocumentReader = (path: string) => Promise<Record<string, unknown> | null>;

export type EvidenceSelectionResult =
  | { ok: true; evidenceRefs: string[] }
  | { ok: false; code: Extract<ResolutionEvidenceErrorCode,
      "EVIDENCE_NOT_FOUND" | "EVIDENCE_SCOPE_VIOLATION" | "EVIDENCE_NOT_ELIGIBLE"> };

type ResolutionEvidenceRequest = {
  orgId: string;
  actionId: string;
  action: Record<string, unknown>;
  evidenceRefs: readonly string[];
};

export function validEvidenceRef(value: unknown): value is string {
  return typeof value === "string"
    && value !== "."
    && value !== ".."
    && DOCUMENT_ID_PATTERN.test(value);
}

function normalized(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase()
    : "";
}

function expiryMillis(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (value && typeof value === "object" && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis(): number }).toMillis();
  }
  return NaN;
}

/**
 * Eligibility shared by the picker and the write path. Only reviewed legacy
 * evidence or canonical Firebase-native evidence can support a resolution.
 * Narrative/clinical material is never made eligible by this metadata view.
 */
export function isEligibleNonClinicalEvidence(
  record: Record<string, unknown>,
  orgId: string,
  nowMillis = Date.now()
): boolean {
  if (safeRecordString(record, "orgId") !== orgId || record.sanitized !== true) return false;
  if (!["VALIDATED", "CLOSED"].includes(normalized(record.workflowState))) return false;
  if (record.revoked === true || record.deleted === true || record.active === false) return false;
  if (record.clinicalSensitive === true || record.containsPhi === true || record.containsPHI === true) return false;

  const sensitivity = normalized(record.sensitivity);
  if (!["PUBLIC", "INTERNAL", "RESTRICTED"].includes(sensitivity)) return false;
  // Positive classification is intentional: `sanitized` alone cannot turn an
  // unknown or clinically named document into operational evidence.
  const rawDocumentType = typeof (record.documentType ?? record.category) === "string"
    ? String(record.documentType ?? record.category)
    : "";
  const documentType = normalized(rawDocumentType);
  if (!NON_CLINICAL_EVIDENCE_TYPES.has(documentType) || containsRestrictedOperationalText(rawDocumentType)) return false;

  const expiry = expiryMillis(record.expiresAt);
  if (expiry !== null && (!Number.isFinite(expiry) || expiry <= nowMillis)) return false;

  const legacyReviewed = record.reviewState === "APPROVED"
    && ["PUBLIC", "INTERNAL"].includes(sensitivity);
  const nativeSanitized = sensitivity === "RESTRICTED"
    && record.nativeReady === true
    && record.sourceIndependent === true
    && record.externalFetchRequired !== true
    && record.canonicalSnapshotVersion === 1
    && typeof record.canonicalSnapshotHash === "string"
    && /^[a-f0-9]{64}$/.test(record.canonicalSnapshotHash);
  return legacyReviewed || nativeSanitized;
}

export async function validateEvidenceSelection(
  orgId: string,
  rawEvidenceRefs: readonly string[],
  readDocument: FirestoreDocumentReader
): Promise<EvidenceSelectionResult> {
  const evidenceRefs = rawEvidenceRefs.map((item) => item.trim());
  if (evidenceRefs.length === 0
    || evidenceRefs.length > 20
    || evidenceRefs.some((item) => !validEvidenceRef(item))
    || new Set(evidenceRefs).size !== evidenceRefs.length) {
    return { ok: false, code: "EVIDENCE_NOT_FOUND" };
  }

  const evidenceDocuments = await Promise.all(evidenceRefs.map((evidenceRef) =>
    readDocument(`organizations/${orgId}/sourceDocuments/${evidenceRef}`)
  ));
  for (let index = 0; index < evidenceRefs.length; index++) {
    const evidence = evidenceDocuments[index];
    if (!evidence) return { ok: false, code: "EVIDENCE_NOT_FOUND" };
    if (safeRecordString(evidence, "orgId") !== orgId) {
      return { ok: false, code: "EVIDENCE_SCOPE_VIOLATION" };
    }
    if (!isEligibleNonClinicalEvidence(evidence, orgId)) {
      return { ok: false, code: "EVIDENCE_NOT_ELIGIBLE" };
    }
  }
  return { ok: true, evidenceRefs };
}

function safeRecordString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function includesString(record: Record<string, unknown>, field: string, expected: string): boolean {
  const value = record[field];
  return Array.isArray(value) && value.some((item) => item === expected);
}

function listsEvidence(record: Record<string, unknown>, evidenceRef: string): boolean {
  return includesString(record, "evidenceRefs", evidenceRef);
}

function evidenceList(record: Record<string, unknown>): string[] | null {
  const raw = record.evidenceRefs;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const refs = raw.map((item) => typeof item === "string" ? item.trim() : "");
  return refs.every(validEvidenceRef) && new Set(refs).size === refs.length ? refs : null;
}

function sameEvidenceSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function evidenceLinksActionOrTarget(
  evidenceRef: string,
  action: Record<string, unknown>,
  target: Record<string, unknown>
): boolean {
  const targetType = safeRecordString(action, "targetType");
  const targetId = safeRecordString(action, "targetId");
  if (!targetType || !targetId) return false;

  if (targetType === "sourceDocument" && evidenceRef === targetId) return true;
  return listsEvidence(action, evidenceRef) || listsEvidence(target, evidenceRef);
}

export async function validateResolutionEvidence(
  request: ResolutionEvidenceRequest,
  readDocument: FirestoreDocumentReader
): Promise<ResolutionEvidenceResult> {
  if (!validEvidenceRef(request.actionId) || safeRecordString(request.action, "orgId") !== request.orgId) {
    return { ok: false, code: "ACTION_SCOPE_VIOLATION" };
  }

  const targetType = safeRecordString(request.action, "targetType");
  const targetId = safeRecordString(request.action, "targetId");
  const targetCollection = targetType && Object.hasOwn(ACTION_TARGET_COLLECTIONS, targetType)
    ? ACTION_TARGET_COLLECTIONS[targetType]
    : undefined;
  if (!targetCollection || !targetId || !validEvidenceRef(targetId)) {
    return { ok: false, code: "TARGET_NOT_FOUND" };
  }

  const target = await readDocument(`organizations/${request.orgId}/${targetCollection}/${targetId}`);
  if (!target) return { ok: false, code: "TARGET_NOT_FOUND" };
  if (safeRecordString(target, "orgId") !== request.orgId) {
    return { ok: false, code: "TARGET_SCOPE_VIOLATION" };
  }

  const selection = await validateEvidenceSelection(request.orgId, request.evidenceRefs, readDocument);
  if (!selection.ok) return selection;
  const evidenceRefs = selection.evidenceRefs;

  if (targetType === "managementInput") {
    const actionRefs = evidenceList(request.action);
    const targetRefs = evidenceList(target);
    if (!actionRefs || !targetRefs
      || !sameEvidenceSet(actionRefs, targetRefs)
      || !sameEvidenceSet(actionRefs, evidenceRefs)) {
      return { ok: false, code: "EVIDENCE_SET_MISMATCH" };
    }
  }

  for (const evidenceRef of evidenceRefs) {
    if (!evidenceLinksActionOrTarget(evidenceRef, request.action, target)) {
      return { ok: false, code: "EVIDENCE_NOT_LINKED" };
    }
  }

  return { ok: true, evidenceRefs };
}
