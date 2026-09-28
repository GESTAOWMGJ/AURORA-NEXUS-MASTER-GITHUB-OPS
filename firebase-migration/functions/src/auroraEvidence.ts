const ACTION_TARGET_COLLECTIONS: Readonly<Record<string, string>> = Object.freeze({
  invoice: "invoices",
  bankTransaction: "bankTransactions",
  sourceDocument: "sourceDocuments",
  reconciliation: "reconciliations",
  auditFinding: "auditFindings"
});

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

export type ResolutionEvidenceErrorCode =
  | "ACTION_SCOPE_VIOLATION"
  | "TARGET_NOT_FOUND"
  | "TARGET_SCOPE_VIOLATION"
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_SCOPE_VIOLATION"
  | "EVIDENCE_NOT_LINKED";

export type ResolutionEvidenceResult =
  | { ok: true; evidenceRefs: string[] }
  | { ok: false; code: ResolutionEvidenceErrorCode };

export type FirestoreDocumentReader = (path: string) => Promise<Record<string, unknown> | null>;

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

  const evidenceRefs = request.evidenceRefs.map((item) => item.trim());
  if (evidenceRefs.length === 0
    || evidenceRefs.some((item) => !validEvidenceRef(item))
    || new Set(evidenceRefs).size !== evidenceRefs.length) {
    return { ok: false, code: "EVIDENCE_NOT_FOUND" };
  }

  const evidenceDocuments = await Promise.all(evidenceRefs.map((evidenceRef) =>
    readDocument(`organizations/${request.orgId}/sourceDocuments/${evidenceRef}`)
  ));

  for (let index = 0; index < evidenceRefs.length; index++) {
    const evidenceRef = evidenceRefs[index];
    const evidence = evidenceDocuments[index];
    if (!evidenceRef || !evidence) return { ok: false, code: "EVIDENCE_NOT_FOUND" };
    if (safeRecordString(evidence, "orgId") !== request.orgId) {
      return { ok: false, code: "EVIDENCE_SCOPE_VIOLATION" };
    }
    if (!evidenceLinksActionOrTarget(evidenceRef, request.action, target)) {
      return { ok: false, code: "EVIDENCE_NOT_LINKED" };
    }
  }

  return { ok: true, evidenceRefs };
}
