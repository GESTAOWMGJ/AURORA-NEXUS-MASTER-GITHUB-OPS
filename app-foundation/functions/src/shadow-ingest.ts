import { timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineBoolean, defineSecret } from "firebase-functions/params";
import { appendAuditEvent } from "./audit.js";
import { canonicalJson, hmacSha256, sha256 } from "./crypto.js";
import { db } from "./firebase.js";
import {
  evaluateShadowSnapshot,
  shadowSnapshotSchema,
} from "./shadow-contracts.js";

const shadowIngestSecret = defineSecret("SHADOW_INGEST_HMAC_SECRET");
const shadowIngestEnabled = defineBoolean("SHADOW_INGEST_ENABLED", {
  default: false,
  description: "Enables aggregate non-clinical shadow ingestion only.",
});
const maximumClockSkewSeconds = 300;

export function validShadowSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  receivedSignature: string,
): boolean {
  if (!/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(receivedSignature)) {
    return false;
  }
  const expected = `sha256=${hmacSha256(secret, `${timestamp}.${rawBody}`)}`;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(receivedSignature, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export const ingestShadowSnapshot = onRequest(
  {
    cors: false,
    maxInstances: 3,
    secrets: [shadowIngestSecret],
  },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!shadowIngestEnabled.value()) {
      response.status(503).json({ ok: false, code: "SHADOW_INGEST_DISABLED" });
      return;
    }
    if (request.method !== "POST") {
      response.set("Allow", "POST");
      response.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const secret = shadowIngestSecret.value();
    if (secret.length < 32) {
      response.status(503).json({ ok: false, code: "SHADOW_SECRET_INVALID" });
      return;
    }

    const timestamp = String(request.header("x-wmgj-timestamp") ?? "");
    const signature = String(request.header("x-wmgj-signature") ?? "");
    const rawBody = request.rawBody?.toString("utf8") ?? "";
    const timestampSeconds = Number(timestamp);
    if (
      !validShadowSignature(secret, timestamp, rawBody, signature) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > maximumClockSkewSeconds
    ) {
      response.status(401).json({ ok: false, code: "SHADOW_SIGNATURE_INVALID" });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      response.status(400).json({ ok: false, code: "INVALID_JSON" });
      return;
    }
    const parsed = shadowSnapshotSchema.safeParse(parsedJson);
    if (!parsed.success) {
      response.status(400).json({
        ok: false,
        code: "SHADOW_CONTRACT_REJECTED",
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      return;
    }

    const snapshot = parsed.data;
    const payloadHash = sha256(canonicalJson(snapshot));
    const evaluation = evaluateShadowSnapshot(snapshot);
    const snapshotRef = db.doc(
      `tenants/${snapshot.tenantId}/shadow_snapshots/${snapshot.snapshotId}`,
    );
    const learningRef = db.doc(
      `tenants/${snapshot.tenantId}/learning_observations/${sha256(`${snapshot.snapshotId}|${evaluation.policyVersion}`)}`,
    );

    const result = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(snapshotRef);
      if (existing.exists) {
        const previous = existing.data() as { integrity?: { payloadSha256?: string } };
        if (previous.integrity?.payloadSha256 !== payloadHash) {
          throw new Error("SHADOW_SNAPSHOT_ID_REUSED");
        }
        return { reused: true };
      }

      const recordedAt = Timestamp.now();
      const record = {
        ...snapshot,
        evaluation,
        status: evaluation.state,
        recordedAt,
        createdBy: { kind: "SERVICE", id: "apps-script-shadow-bridge" },
        integrity: { payloadSha256: payloadHash, schemaVersion: 1 },
      };
      const auditEventId = await appendAuditEvent(transaction, {
        tenantId: snapshot.tenantId,
        siteId: snapshot.siteId,
        aggregateType: "SHADOW_SNAPSHOT",
        aggregateId: snapshot.snapshotId,
        action: "SHADOW_SNAPSHOT_RECORDED",
        actorKind: "SERVICE",
        actorUid: "apps-script-shadow-bridge",
        correlationId: snapshot.snapshotId,
        causationId: snapshot.snapshotId,
        reasonCode: evaluation.state,
        beforeHash: null,
        afterHash: payloadHash,
      });
      transaction.create(snapshotRef, { ...record, auditEventId });

      if (evaluation.learningDisposition === "PENDING_HUMAN_REVIEW") {
        transaction.create(learningRef, {
          tenantId: snapshot.tenantId,
          siteId: snapshot.siteId,
          schemaVersion: 1,
          dataClass: "INTERNAL",
          sourceSnapshotId: snapshot.snapshotId,
          sourcePayloadHash: payloadHash,
          policyVersion: evaluation.policyVersion,
          reasonCodes: evaluation.breachCodes,
          status: "PENDING_HUMAN_REVIEW",
          autoApplyAllowed: false,
          createdAt: recordedAt,
          createdBy: { kind: "SERVICE", id: "shadow-policy-evaluator" },
        });
      }
      return { reused: false };
    });

    response.status(result.reused ? 200 : 202).json({
      ok: true,
      reused: result.reused,
      snapshotId: snapshot.snapshotId,
      state: evaluation.state,
      breachCodes: evaluation.breachCodes,
      productionChanged: false,
      learningAutoApplied: false,
    });
  },
);
