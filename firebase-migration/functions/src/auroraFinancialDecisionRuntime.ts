import { createHash, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { can, CSRF_PURPOSES, verifyAuroraAccess, validCsrf } from "./auroraAccess.js";
import { auroraDb } from "./firebase.js";
import { buildLayFinancialStatus, financialClosingHash, type DistributionDecision } from "./auroraFinancialStatus.js";

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const CSRF_HMAC_KEY = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
const SOURCE_LIMIT = 1000;

type ResponseLike = { set(name: string, value: string): unknown };

function apiHeaders(res: ResponseLike): void {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function sameOrigin(req: { get(name: string): string | undefined }): boolean {
  const site = req.get("sec-fetch-site");
  return !site || site === "same-origin";
}

function isJson(req: { get(name: string): string | undefined }): boolean {
  return String(req.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function safeCompetence(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.trim()) ? value.trim() : null;
}

function safeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.replace(/\s+/g, " ").trim();
  return reason.length >= 5 && reason.length <= 500 ? reason : null;
}

function parseDecision(value: unknown): DistributionDecision | null {
  return value === "APPROVE" || value === "REJECT" ? value : null;
}

function publicDecision(data: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!data) return null;
  const decidedAt = data.decidedAt && typeof data.decidedAt === "object" && "toDate" in data.decidedAt
    ? (data.decidedAt as { toDate(): Date }).toDate().toISOString()
    : typeof data.decidedAt === "string" ? data.decidedAt : null;
  return {
    decision: data.decision ?? null,
    managerEmail: data.managerEmail ?? null,
    managerRole: data.managerRole ?? null,
    reason: data.reason ?? null,
    amountCents: typeof data.amountCents === "number" ? data.amountCents : null,
    decidedAt,
    revision: Number.isSafeInteger(data.revision) ? data.revision : null,
    executionMode: "MANUAL_EXTERNAL_AFTER_APPROVAL",
    moneyMoved: false
  };
}

async function listRecords(orgId: string, collection: string): Promise<{ records: Array<Record<string, unknown>>; complete: boolean }> {
  const snap = await auroraDb.collection(`organizations/${orgId}/${collection}`).limit(SOURCE_LIMIT + 1).get();
  return {
    records: snap.docs.slice(0, SOURCE_LIMIT).map((doc) => ({ ...doc.data(), _id: doc.id })),
    complete: snap.size <= SOURCE_LIMIT
  };
}

export async function loadFinancialClosingStatus(
  orgId: string,
  competence: string,
  now = new Date()
): Promise<Record<string, unknown>> {
  const [closing, decision, financialEntries, taxObligations, invoices] = await Promise.all([
    auroraDb.doc(`organizations/${orgId}/monthlyClosings/${competence}`).get(),
    auroraDb.doc(`organizations/${orgId}/distributionDecisions/${competence}`).get(),
    listRecords(orgId, "financialEntries"),
    listRecords(orgId, "taxObligations"),
    listRecords(orgId, "invoices")
  ]);
  const sourceComplete = financialEntries.complete && taxObligations.complete && invoices.complete;
  return buildLayFinancialStatus({
    orgId,
    competence,
    closing: closing.exists ? (closing.data() ?? {}) : null,
    currentDecision: decision.exists ? (decision.data() ?? {}) : null,
    financialEntries: financialEntries.records,
    taxObligations: taxObligations.records,
    invoices: invoices.records,
    sourceComplete,
    now
  });
}

export const auroraNexusDistributionDecision = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS, CSRF_HMAC_KEY] },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (!sameOrigin(req)) {
      res.status(403).json({ ok: false, code: "CROSS_SITE_REJECTED" });
      return;
    }
    if (!isJson(req)) {
      res.status(415).json({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }

    const member = await verifyAuroraAccess(req.get("cookie"), ALLOWED_EMAILS.value());
    if (!member) {
      res.status(401).json({ ok: false, code: "AUTH_REQUIRED" });
      return;
    }
    if (!member.allFacilities || !can(member, "distribution.approve", ["platform_admin", "org_admin", "director", "finance"])) {
      res.status(403).json({ ok: false, code: "PERMISSION_DENIED" });
      return;
    }
    if (!member.mfaVerified) {
      res.status(403).json({ ok: false, code: "MFA_REQUIRED" });
      return;
    }
    if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"), CSRF_HMAC_KEY.value(), CSRF_PURPOSES.distributionApproval)) {
      res.status(403).json({ ok: false, code: "CSRF_REJECTED" });
      return;
    }

    const competence = safeCompetence(req.body?.competence);
    const snapshotHash = typeof req.body?.snapshotHash === "string" ? req.body.snapshotHash.trim() : "";
    const decision = parseDecision(req.body?.decision);
    const reason = safeReason(req.body?.reason);
    const expectedRevision = req.body?.expectedRevision === null || req.body?.expectedRevision === undefined
      ? 0
      : Number(req.body.expectedRevision);
    const idempotencyKey = String(req.get("idempotency-key") ?? "");

    if (!competence || !/^[a-f0-9]{64}$/i.test(snapshotHash) || !decision || !reason || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      res.status(400).json({ ok: false, code: "INVALID_DECISION" });
      return;
    }
    if (!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) {
      res.status(400).json({ ok: false, code: "INVALID_IDEMPOTENCY_KEY" });
      return;
    }

    const summary = await loadFinancialClosingStatus(member.orgId, competence);
    if (summary.snapshotHash !== snapshotHash) {
      res.status(409).json({ ok: false, code: "STALE_FINANCIAL_SNAPSHOT" });
      return;
    }
    if (decision === "APPROVE" && summary.canApproveDistribution !== true) {
      res.status(409).json({ ok: false, code: "DISTRIBUTION_GATE_NOT_ELIGIBLE" });
      return;
    }

    const amounts = summary.amounts && typeof summary.amounts === "object"
      ? summary.amounts as Record<string, unknown>
      : {};
    const amountCents = typeof amounts.distributableCents === "number" && Number.isSafeInteger(amounts.distributableCents)
      ? amounts.distributableCents
      : null;
    const command = { competence, snapshotHash, decision, reason, expectedRevision, amountCents };
    const commandHash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const idemId = createHash("sha256").update(`${member.orgId}:distribution:${idempotencyKey}`).digest("hex");
    const decisionId = randomUUID();
    const auditId = randomUUID();

    try {
      const result = await auroraDb.runTransaction(async (tx) => {
        const base = `organizations/${member.orgId}`;
        const idemRef = auroraDb.doc(`${base}/apiIdempotency/${idemId}`);
        const currentRef = auroraDb.doc(`${base}/distributionDecisions/${competence}`);
        const closingRef = auroraDb.doc(`${base}/monthlyClosings/${competence}`);
        const versionRef = auroraDb.doc(`${base}/distributionDecisionVersions/${decisionId}`);
        const auditRef = auroraDb.doc(`${base}/auditEvents/${auditId}`);
        const [idem, current, closing] = await Promise.all([tx.get(idemRef), tx.get(currentRef), tx.get(closingRef)]);

        if (idem.exists) {
          if (idem.data()?.commandHash !== commandHash) throw new Error("IDEMPOTENCY_CONFLICT");
          return { duplicate: true, data: current.exists ? current.data() ?? {} : {} };
        }
        if (!closing.exists) throw new Error("CLOSING_NOT_FOUND");
        const currentHash = financialClosingHash(closing.data() ?? {});
        if (currentHash !== snapshotHash) throw new Error("STALE_FINANCIAL_SNAPSHOT");
        const revision = current.exists && Number.isSafeInteger(current.data()?.revision) ? Number(current.data()?.revision) : 0;
        if (revision !== expectedRevision) throw new Error("REVISION_CONFLICT");

        const nextRevision = revision + 1;
        const storedDecision = {
          orgId: member.orgId,
          competence,
          decision: decision === "APPROVE" ? "APPROVED_FOR_DISTRIBUTION" : "REJECTED",
          reason,
          snapshotHash,
          amountCents,
          managerUid: member.uid,
          managerEmail: member.email,
          managerRole: member.role,
          revision: nextRevision,
          decidedAt: FieldValue.serverTimestamp(),
          executionMode: "MANUAL_EXTERNAL_AFTER_APPROVAL",
          moneyMoved: false,
          automaticPayment: false,
          automaticDistribution: false,
          sourceMutation: false,
          sensitivity: "INTERNAL_RESTRICTED",
          sanitized: true
        };

        tx.create(versionRef, { ...storedDecision, decisionId, immutable: true });
        tx.set(currentRef, storedDecision);
        tx.create(auditRef, {
          type: "DISTRIBUTION_MANAGER_DECISION",
          action: "DISTRIBUTION_MANAGER_DECISION",
          orgId: member.orgId,
          competence,
          decision: storedDecision.decision,
          decisionId,
          snapshotHash,
          amountCents,
          actorUid: member.uid,
          actorRole: member.role,
          moneyMoved: false,
          occurredAt: FieldValue.serverTimestamp(),
          sanitized: true,
          sensitivity: "INTERNAL_RESTRICTED"
        });
        tx.create(idemRef, {
          orgId: member.orgId,
          commandHash,
          actionId: decisionId,
          createdAt: FieldValue.serverTimestamp()
        });
        return { duplicate: false, data: storedDecision };
      });

      res.status(200).json({ ok: true, duplicate: result.duplicate, decision: publicDecision(result.data) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "DISTRIBUTION_DECISION_FAILED";
      const known = ["IDEMPOTENCY_CONFLICT", "CLOSING_NOT_FOUND", "STALE_FINANCIAL_SNAPSHOT", "REVISION_CONFLICT"];
      if (!known.includes(code)) logger.error("Distribution decision failed", { code });
      res.status(known.includes(code) ? 409 : 500).json({ ok: false, code: known.includes(code) ? code : "DISTRIBUTION_DECISION_FAILED" });
    }
  }
);
