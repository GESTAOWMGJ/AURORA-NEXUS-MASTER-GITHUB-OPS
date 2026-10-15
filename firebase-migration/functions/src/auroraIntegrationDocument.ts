import { createHash } from "node:crypto";

export type CanonicalIntegrationDocument = {
  id: string;
  sourceIdHash: string;
  canonicalSnapshotHash: string;
  facts: Record<string, unknown>;
};

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
  sourceEvidence?: DocumentAcquisitionEvidence;
};

export type DocumentAcquisitionEvidence = {
  schemaVersion: "aurora.document.acquisition.v1";
  provider: "GOOGLE_DRIVE";
  sourceObjectIdHash: string;
  observedVersion: string;
  sourceMimeType: string;
  acquiredMimeType: string;
  representation: "ORIGINAL_BYTES" | "GOOGLE_SHEETS_CSV_EXPORT";
  byteSha256: string;
  byteLength: number;
  extraction: {
    method: "AURORA_CANONICAL_JSON" | "AURORA_CANONICAL_CSV" | "AURORA_CANONICAL_XLSX";
    version: "1.0.0";
    status: "COMPLETE";
    coverage: "EXPORTED_REPRESENTATION_ONLY";
    textFormat: "CANONICAL_RECORD_JSON";
    textSha256: string;
    rowFactsSha256: string;
    rowIndex: number;
    rowCount: number;
  };
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const SYSTEMS = new Set(["MV", "TASY", "ERP"]);
const TYPES = new Set(["FINANCIAL", "GLOSS", "CONTRACT", "PRODUCTION", "REPORT", "AUTHORIZATION", "OTHER"]);
const WORKFLOW = new Set(["RECEIVED", "QUEUED", "CLASSIFIED", "EXTRACTED", "NORMALIZED", "VALIDATED", "PENDING_HUMAN_REVIEW", "PENDING_EVIDENCE", "BLOCKED", "FAILED"]);
const FRAGILITY = new Set(["NONE", "DEGRADED_EXTRACTION", "LOW_CONFIDENCE", "MISSING_CANONICAL_FIELDS"]);
const ALLOWED_KEYS = new Set([
  "sourceSystem", "externalDocumentId", "sourceVersion", "occurredAt", "documentType",
  "competence", "amountCents", "count", "workflowState", "slaDueAt",
  "documentFragility", "missingFieldsCount", "nativeReady", "sourceIndependent", "sourceEvidence"
]);

const ACQUISITION_MIMES: Record<string, string> = {
  "application/json": "AURORA_CANONICAL_JSON",
  "text/csv": "AURORA_CANONICAL_CSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "AURORA_CANONICAL_XLSX",
  "application/vnd.google-apps.spreadsheet": "AURORA_CANONICAL_CSV"
};
const HASH_RE = /^[a-f0-9]{64}$/;

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sortedValue(item)]));
  return value;
}

export function acquisitionEvidenceHash(evidence: DocumentAcquisitionEvidence): string {
  return createHash("sha256").update(JSON.stringify(sortedValue(evidence))).digest("hex");
}

export function canonicalRecordText(payload: IntegrationDocumentPayload): string {
  return JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'sourceEvidence').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}

export function parseDocumentAcquisitionEvidence(value: unknown, payload: IntegrationDocumentPayload): DocumentAcquisitionEvidence | null {
  if (!exactKeys(value, ['schemaVersion','provider','sourceObjectIdHash','observedVersion','sourceMimeType','acquiredMimeType','representation','byteSha256','byteLength','extraction'])
      || !exactKeys(value.extraction, ['method','version','status','coverage','textFormat','textSha256','rowFactsSha256','rowIndex','rowCount'])) return null;
  const raw = value, extraction = raw.extraction as Record<string, unknown>;
  if (raw.schemaVersion !== 'aurora.document.acquisition.v1' || raw.provider !== 'GOOGLE_DRIVE'
      || typeof raw.sourceObjectIdHash !== 'string' || !HASH_RE.test(raw.sourceObjectIdHash)
      || typeof raw.observedVersion !== 'string' || !/^[1-9][0-9]{0,31}$/.test(raw.observedVersion)
      || typeof raw.sourceMimeType !== 'string' || !Object.hasOwn(ACQUISITION_MIMES,raw.sourceMimeType)
      || typeof raw.byteSha256 !== 'string' || !HASH_RE.test(raw.byteSha256)
      || !Number.isSafeInteger(raw.byteLength) || Number(raw.byteLength) < 1 || Number(raw.byteLength) > 1048576
      || extraction.version !== '1.0.0' || extraction.status !== 'COMPLETE'
      || extraction.coverage !== 'EXPORTED_REPRESENTATION_ONLY' || extraction.textFormat !== 'CANONICAL_RECORD_JSON'
      || !Number.isSafeInteger(extraction.rowCount) || Number(extraction.rowCount) < 1 || Number(extraction.rowCount) > 20
      || !Number.isSafeInteger(extraction.rowIndex) || Number(extraction.rowIndex) < 0 || Number(extraction.rowIndex) >= Number(extraction.rowCount)) return null;
  const sheets = raw.sourceMimeType === 'application/vnd.google-apps.spreadsheet';
  const recordHash = createHash('sha256').update(canonicalRecordText(payload)).digest('hex');
  if (raw.acquiredMimeType !== (sheets ? 'text/csv' : raw.sourceMimeType)
      || raw.representation !== (sheets ? 'GOOGLE_SHEETS_CSV_EXPORT' : 'ORIGINAL_BYTES')
      || extraction.method !== ACQUISITION_MIMES[raw.sourceMimeType]
      || extraction.textSha256 !== recordHash || extraction.rowFactsSha256 !== recordHash) return null;
  return sortedValue(raw) as DocumentAcquisitionEvidence;
}

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

  const idLower = externalDocumentId.toLowerCase();
  if (
    !SYSTEMS.has(sourceSystem)
    || !ID_RE.test(externalDocumentId)
    || !/[A-Za-z]/.test(externalDocumentId)
    || /(cpf|cns|paciente|patient|beneficiario|prontuario|medical[-_.:]?record)/.test(idLower)
    || /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(externalDocumentId)
  ) return null;
  if (!Number.isSafeInteger(sourceVersion) || Number(sourceVersion) < 1) return null;
  if (!occurredAt || !TYPES.has(documentType) || !WORKFLOW.has(workflowState) || !FRAGILITY.has(documentFragility)) return null;
  if (competence === undefined || slaDueAt === undefined || amountCents === undefined || count === undefined || missingFieldsCount === undefined) return null;
  if (typeof raw.nativeReady !== "boolean" || typeof raw.sourceIndependent !== "boolean") return null;
  if (raw.sourceIndependent && !raw.nativeReady) return null;
  if (raw.nativeReady && (documentFragility !== "NONE" || (missingFieldsCount ?? 0) > 0)) return null;
  const requiredFactsPresent = (
    !["FINANCIAL", "GLOSS"].includes(documentType) || (competence !== null && amountCents !== null)
  ) && (
    documentType !== "PRODUCTION" || (competence !== null && count !== null)
  );
  if (raw.nativeReady && !requiredFactsPresent) return null;

  const payload: IntegrationDocumentPayload = {
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
  if (Object.hasOwn(raw, 'sourceEvidence')) {
    const evidence = parseDocumentAcquisitionEvidence(raw.sourceEvidence, payload);
    if (!evidence) return null;
    payload.sourceEvidence = evidence;
  }
  return payload;
}

/** Acquisition revisions use the existing entity revision, never pretend a
 * changed Drive version is a financial sourceVersion supplied inside a file. */
export function acquisitionVersionDecision(current: Record<string, any> | null, payload: IntegrationDocumentPayload): string | null {
  const previous = current?.source?.acquisition as DocumentAcquisitionEvidence | undefined;
  const next = payload.sourceEvidence;
  if (!previous) return null;
  if (!next || previous.provider !== next.provider || previous.sourceObjectIdHash !== next.sourceObjectIdHash
      || previous.sourceMimeType !== next.sourceMimeType || previous.representation !== next.representation) return 'SOURCE_ACQUISITION_CONFLICT';
  if (typeof previous.observedVersion !== 'string' || !/^[1-9][0-9]{0,31}$/.test(previous.observedVersion)) return 'SOURCE_ACQUISITION_CONFLICT';
  if (BigInt(next.observedVersion) < BigInt(previous.observedVersion)) return 'SOURCE_ACQUISITION_REGRESSION';
  if (next.observedVersion === previous.observedVersion && acquisitionEvidenceHash(next) !== acquisitionEvidenceHash(previous)) return 'SOURCE_ACQUISITION_CONFLICT';
  return null;
}

export function integrationDocumentVersionDecision(
  current: Record<string, any> | null, payload: IntegrationDocumentPayload,
  canonicalSnapshotHash: string, bodyHash: string, currentOccurredAt: string | null
): string {
  const currentVersion = current?.sourceVersion;
  if (typeof currentVersion === 'number' && payload.sourceVersion < currentVersion) return 'SOURCE_VERSION_REGRESSION';
  const acquisitionConflict = acquisitionVersionDecision(current, payload);
  if (acquisitionConflict) return acquisitionConflict;
  if (typeof currentVersion !== 'number' || payload.sourceVersion > currentVersion) return 'UPDATE';
  if (current?.canonicalSnapshotHash !== canonicalSnapshotHash || current.workflowState !== payload.workflowState
      || currentOccurredAt !== payload.occurredAt) return 'SOURCE_VERSION_CONFLICT';
  if (current.integration?.payloadHash === bodyHash) return 'DUPLICATE';
  // New acquisition evidence advances only its own existing entity revision.
  // Canonical facts/workflow/time must still match this financial sourceVersion.
  if (payload.sourceEvidence && (!current.source?.acquisition
      || BigInt(payload.sourceEvidence.observedVersion) > BigInt(current.source.acquisition.observedVersion))) return 'UPDATE';
  if (current.integration?.payloadHash === undefined) return 'DUPLICATE';
  return 'SOURCE_VERSION_CONFLICT';
}

export function canonicalIntegrationDocument(
  orgId: string,
  payload: IntegrationDocumentPayload
): CanonicalIntegrationDocument {
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
