import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { DEFAULT_ORG_ID } from "./auroraAccess.js";
import { auroraDb } from "./firebase.js";

export type DocumentWatchCode =
  | "DOCUMENT_FRAGILITY"
  | "DOCUMENT_SLA_OVERDUE"
  | "FLOW_BOTTLENECK";

export type DocumentWatchAssessment = {
  codes: DocumentWatchCode[];
  reasonCode: "MISSING_EVIDENCE" | "SLA_BREACH" | "AUDIT_FINDING";
  riskLevel: "MEDIUM" | "HIGH";
  dueAtMs: number;
  organicSignalKind: "REWORK" | "SECTOR_NEED";
  organicCategory: "AUDIT";
  organicSector: "AUDIT";
  fingerprint: string;
};

const DOCUMENT_READ_LIMIT = 1000;
const DOCUMENT_WRITE_LIMIT = 200;
const CLOSED_STATES = new Set(["VALIDATED", "CLOSED"]);
const HIGH_FLOW_STATES = new Set(["BLOCKED", "FAILED", "DEAD_LETTER"]);
const PENDING_FLOW_STATES = new Set(["RECEIVED", "QUEUED", "CLASSIFIED", "EXTRACTED", "NORMALIZED", "PENDING_EVIDENCE", "PENDING_HUMAN_REVIEW"]);

function normalized(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function bool(value: unknown): boolean {
  return value === true;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateMs(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate(): Date }).toDate().getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isTestDocument(data: Record<string, unknown>): boolean {
  return data.isTest === true
    || data.is_test === true
    || ["TEST", "TESTE"].includes(normalized(data.environment))
    || ["TEST", "TESTE"].includes(normalized(data.recordType ?? data.record_type));
}

export function assessDocumentWatch(
  documentId: string,
  data: Record<string, unknown>,
  now = new Date()
): DocumentWatchAssessment | null {
  if (!documentId || isTestDocument(data)) return null;

  const workflowState = normalized(data.workflowState ?? data.workflow_state);
  const nativeReady = bool(data.nativeReady ?? data.native_ready);
  const sourceIndependent = bool(data.sourceIndependent ?? data.source_independent);
  const externalFetchRequired = bool(data.externalFetchRequired ?? data.external_fetch_required);
  const missingFields = finiteNumber(data.missingFieldsCount ?? data.missing_fields_count) ?? 0;
  const fragility = normalized(data.documentFragility ?? data.document_fragility ?? "NONE");
  const dueAt = dateMs(data.slaDueAt ?? data.sla_due_at);
  const pending = !CLOSED_STATES.has(workflowState);

  const codes: DocumentWatchCode[] = [];
  if (
    fragility !== "NONE"
    || !nativeReady
    || !sourceIndependent
    || externalFetchRequired
    || missingFields > 0
  ) {
    codes.push("DOCUMENT_FRAGILITY");
  }
  if (pending && dueAt !== null && dueAt < now.getTime()) {
    codes.push("DOCUMENT_SLA_OVERDUE");
  }
  if (pending && (HIGH_FLOW_STATES.has(workflowState) || PENDING_FLOW_STATES.has(workflowState))) {
    codes.push("FLOW_BOTTLENECK");
  }
  if (codes.length === 0) return null;

  const riskLevel: "MEDIUM" | "HIGH" =
    codes.includes("DOCUMENT_SLA_OVERDUE")
    || HIGH_FLOW_STATES.has(workflowState)
    || externalFetchRequired
    || fragility === "DEGRADED_EXTRACTION"
      ? "HIGH"
      : "MEDIUM";
  const reasonCode = codes.includes("DOCUMENT_SLA_OVERDUE")
    ? "SLA_BREACH"
    : codes.includes("DOCUMENT_FRAGILITY")
      ? "MISSING_EVIDENCE"
      : "AUDIT_FINDING";
  const organicSignalKind = codes.includes("DOCUMENT_FRAGILITY") || codes.includes("DOCUMENT_SLA_OVERDUE")
    ? "REWORK"
    : "SECTOR_NEED";
  const defaultDue = now.getTime() + (riskLevel === "HIGH" ? 4 : 24) * 60 * 60 * 1000;
  const dueAtMs = dueAt !== null && dueAt > now.getTime() ? dueAt : defaultDue;
  const fingerprint = stableHash({
    documentId,
    sourceVersion: data.sourceVersion ?? null,
    canonicalSnapshotHash: data.canonicalSnapshotHash ?? null,
    workflowState,
    nativeReady,
    sourceIndependent,
    externalFetchRequired,
    missingFields,
    fragility,
    slaDueAt: dueAt,
    codes
  });

  return {
    codes,
    reasonCode,
    riskLevel,
    dueAtMs,
    organicSignalKind,
    organicCategory: "AUDIT",
    organicSector: "AUDIT",
    fingerprint
  };
}

function deterministicId(orgId: string, documentId: string): string {
  return "docwatch-" + createHash("sha256").update(`${orgId}:sourceDocument:${documentId}`).digest("hex").slice(0, 48);
}

function competenceOf(data: Record<string, unknown>, now: Date): string {
  const value = typeof data.competence === "string" ? data.competence : "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : now.toISOString().slice(0, 7);
}

export async function syncDocumentGovernance(orgId = DEFAULT_ORG_ID, now = new Date()): Promise<Record<string, unknown>> {
  const orgRef = auroraDb.doc(`organizations/${orgId}`);
  const org = await orgRef.get();
  if (!org.exists || org.data()?.active !== true) {
    return { ok: false, code: "ORGANIZATION_DISABLED", orgId };
  }

  const snapshot = await auroraDb.collection(`organizations/${orgId}/sourceDocuments`)
    .limit(DOCUMENT_READ_LIMIT + 1)
    .get();
  if (snapshot.size > DOCUMENT_READ_LIMIT) {
    throw new Error("DOCUMENT_WATCH_SOURCE_LIMIT_EXCEEDED");
  }

  const candidates = snapshot.docs
    .map((doc) => ({ doc, assessment: assessDocumentWatch(doc.id, doc.data(), now) }))
    .filter((item): item is { doc: typeof snapshot.docs[number]; assessment: DocumentWatchAssessment } => item.assessment !== null)
    .slice(0, DOCUMENT_WRITE_LIMIT);

  if (candidates.length === 0) {
    return { ok: true, orgId, scanned: snapshot.size, issues: 0, changed: 0, partial: false };
  }

  const actionRefs = candidates.map(({ doc }) =>
    auroraDb.doc(`organizations/${orgId}/actionItems/${deterministicId(orgId, doc.id)}`)
  );
  const currentActions = await Promise.all(actionRefs.map((ref) => ref.get()));
  const batch = auroraDb.batch();
  let changed = 0;

  candidates.forEach(({ doc, assessment }, index) => {
    const actionRef = actionRefs[index]!;
    const current = currentActions[index];
    const currentData = current?.exists ? current.data() ?? {} : null;
    if (currentData?.watchFingerprint === assessment.fingerprint) return;

    const actionId = actionRef.id;
    const findingRef = auroraDb.doc(`organizations/${orgId}/auditFindings/${actionId}`);
    const revision = currentData && Number.isSafeInteger(currentData.revision)
      ? Number(currentData.revision) + 1
      : 1;
    const docData = doc.data();
    const createdAt = currentData?.createdAt ?? FieldValue.serverTimestamp();

    batch.set(actionRef, {
      orgId,
      targetType: "sourceDocument",
      targetId: doc.id,
      reasonCode: assessment.reasonCode,
      riskLevel: assessment.riskLevel,
      competence: competenceOf(docData, now),
      dueAt: Timestamp.fromMillis(assessment.dueAtMs),
      status: "OPEN",
      revision,
      createdBy: currentData?.createdBy ?? "aurora-document-watchdog",
      createdAt,
      updatedBy: "aurora-document-watchdog",
      updatedAt: FieldValue.serverTimestamp(),
      resolutionCode: null,
      evidenceRefs: [],
      sanitized: true,
      sensitivity: "INTERNAL",
      systemGenerated: true,
      source: "AURORA_DOCUMENT_WATCHDOG",
      watchCodes: assessment.codes,
      watchFingerprint: assessment.fingerprint,
      sourceVersion: docData.sourceVersion ?? null,
      originSystem: docData.originSystem ?? "UNKNOWN",
      organicCandidate: true,
      organicSignalKind: assessment.organicSignalKind,
      organicCategory: assessment.organicCategory,
      organicSector: assessment.organicSector
    }, { merge: true });

    batch.set(findingRef, {
      orgId,
      targetType: "sourceDocument",
      targetId: doc.id,
      linkedActionId: actionId,
      status: "OPEN",
      riskLevel: assessment.riskLevel,
      reasonCode: assessment.reasonCode,
      watchCodes: assessment.codes,
      watchFingerprint: assessment.fingerprint,
      evidenceRefs: [doc.id],
      sourceVersion: docData.sourceVersion ?? null,
      originSystem: docData.originSystem ?? "UNKNOWN",
      sanitized: true,
      sensitivity: "INTERNAL",
      systemGenerated: true,
      createdAt: currentData?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    changed++;
  });

  if (changed > 0) await batch.commit();

  return {
    ok: true,
    orgId,
    scanned: snapshot.size,
    issues: candidates.length,
    changed,
    partial: candidates.length === DOCUMENT_WRITE_LIMIT
  };
}

export const auroraNexusDocumentWatchdog = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", retryCount: 1, maxInstances: 1 },
  async () => {
    try {
      const result = await syncDocumentGovernance(DEFAULT_ORG_ID);
      logger.info("Aurora document governance synchronized", result);
    } catch (error) {
      logger.error("Aurora document governance failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
);
