import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
  CSRF_PURPOSES,
  can,
  validCsrf,
  verifyAuroraAccess
} from "./auroraAccess.js";
import {
  AURORA_CRYPTO_ALGORITHM,
  AURORA_CRYPTO_ENVELOPE_VERSION,
  GoogleKmsEnvelopeKey,
  decryptEnvelope,
  encryptEnvelope,
  sha256Base64Url
} from "./auroraCryptoEnvelope.js";
import { auroraDb } from "./firebase.js";

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const CSRF_HMAC_KEY = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
const MIN_SELF_TEST_INTERVAL_MS = 60_000;

class CryptoRuntimeError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "CryptoRuntimeError";
  }
}

function apiHeaders(res: { set(name: string, value: string): unknown }): void {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function sameOriginMutation(req: { get(name: string): string | undefined }): boolean {
  const fetchSite = req.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

function isJson(req: { get(name: string): string | undefined }): boolean {
  return String(req.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]/g, " ").slice(0, 200);
}

function cryptoConfiguration(data: Record<string, unknown> | undefined): { keyResource: string } {
  const crypto = data?.crypto;
  if (!crypto || typeof crypto !== "object" || Array.isArray(crypto)) {
    throw new CryptoRuntimeError(503, "CRYPTO_CONFIGURATION_MISSING");
  }
  const record = crypto as Record<string, unknown>;
  if (
    record.state !== "HML_READY" ||
    record.envelopeVersion !== AURORA_CRYPTO_ENVELOPE_VERSION ||
    record.algorithm !== AURORA_CRYPTO_ALGORITHM ||
    typeof record.keyResource !== "string"
  ) {
    throw new CryptoRuntimeError(503, "CRYPTO_CONFIGURATION_NOT_READY");
  }
  return { keyResource: record.keyResource };
}

export const auroraNexusCryptoSelfTest = onRequest(
  {
    cors: false,
    secrets: [ALLOWED_EMAILS, CSRF_HMAC_KEY],
    timeoutSeconds: 30,
    maxInstances: 1
  },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (!sameOriginMutation(req) || !isJson(req)) {
      res.status(403).json({ ok: false, code: "REQUEST_CONTEXT_REJECTED" });
      return;
    }

    const member = await verifyAuroraAccess(req.get("cookie"), ALLOWED_EMAILS.value());
    if (!member || !member.allFacilities) {
      res.status(401).json({ ok: false, code: "AUTH_REQUIRED" });
      return;
    }
    if (!can(member, "crypto.verify", ["platform_admin", "org_admin", "security_admin"])) {
      res.status(403).json({ ok: false, code: "PERMISSION_DENIED" });
      return;
    }
    if (!member.mfaVerified) {
      res.status(403).json({ ok: false, code: "MFA_REQUIRED" });
      return;
    }
    if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"), CSRF_HMAC_KEY.value(), CSRF_PURPOSES.crypto)) {
      res.status(403).json({ ok: false, code: "CSRF_INVALID" });
      return;
    }

    const runId = randomBytes(18).toString("base64url");
    const checkpointRef = auroraDb.doc(
      `organizations/${member.orgId}/runtimeCheckpoints/crypto-self-test`
    );

    try {
      const keyResource = await auroraDb.runTransaction(async (tx) => {
        const [orgSnap, checkpointSnap] = await Promise.all([
          tx.get(auroraDb.doc(`organizations/${member.orgId}`)),
          tx.get(checkpointRef)
        ]);
        const org = orgSnap.data();
        if (
          !orgSnap.exists ||
          org?.active !== true ||
          org.environment !== "HOMOLOGATION" ||
          org.clinicalSensitiveEnabled !== false ||
          org.productionMutation !== false
        ) {
          throw new CryptoRuntimeError(412, "HML_GUARDRAIL_REJECTED");
        }

        const previous = checkpointSnap.data();
        const lastAttempt = previous?.lastAttemptAt;
        if (lastAttempt instanceof Timestamp) {
          const elapsed = Date.now() - lastAttempt.toMillis();
          if (elapsed >= 0 && elapsed < MIN_SELF_TEST_INTERVAL_MS) {
            throw new CryptoRuntimeError(429, "CRYPTO_SELF_TEST_RATE_LIMITED");
          }
        }

        const config = cryptoConfiguration(org);
        tx.set(checkpointRef, {
          component: "crypto-self-test",
          state: "RUNNING",
          runId,
          actorUid: member.uid,
          lastAttemptAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return config.keyResource;
      });

      const key = new GoogleKmsEnvelopeKey(keyResource);
      const sentinel = randomBytes(32);
      const logicalId = `self-test-${runId}`;
      const aad = {
        orgId: member.orgId,
        entityType: "cryptoSelfTest",
        schemaVersion: "1",
        logicalId
      };
      const envelope = await encryptEnvelope(sentinel, aad, key);
      const recovered = await decryptEnvelope(envelope, aad, key);
      const verified =
        sentinel.length === recovered.length &&
        timingSafeEqual(sentinel, recovered);
      sentinel.fill(0);
      recovered.fill(0);
      if (!verified) throw new CryptoRuntimeError(500, "CRYPTO_ROUND_TRIP_FAILED");

      const keyResourceHash = sha256Base64Url(keyResource);
      const auditRef = auroraDb.doc(
        `organizations/${member.orgId}/auditEvents/crypto-${runId}`
      );
      const batch = auroraDb.batch();
      batch.create(auditRef, {
        orgId: member.orgId,
        action: "CRYPTO_SELF_TEST_VERIFIED",
        actorUid: member.uid,
        keyResourceHash,
        algorithm: envelope.algorithm,
        envelopeVersion: envelope.envelopeVersion,
        aadHash: envelope.aadSha256,
        ciphertextHash: createHash("sha256").update(envelope.ciphertext, "utf8").digest("base64url"),
        wrappedDekHash: createHash("sha256").update(envelope.wrappedDek, "utf8").digest("base64url"),
        roundTripVerified: true,
        hmlOnly: true,
        clinicalDataUsed: false,
        serverAt: FieldValue.serverTimestamp(),
        schemaVersion: 1
      });
      batch.set(checkpointRef, {
        state: "VERIFIED",
        runId,
        keyResourceHash,
        algorithm: envelope.algorithm,
        envelopeVersion: envelope.envelopeVersion,
        roundTripVerified: true,
        lastVerifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      await batch.commit();

      res.status(200).json({
        ok: true,
        state: "HML_VERIFIED",
        algorithm: envelope.algorithm,
        envelopeVersion: envelope.envelopeVersion,
        keyResourceHash,
        roundTripVerified: true,
        aadBound: true,
        clinicalDataUsed: false
      });
    } catch (error) {
      if (!(error instanceof CryptoRuntimeError)) {
        logger.error("Aurora crypto self-test failed", {
          runId,
          orgId: member.orgId,
          error: safeError(error)
        });
      }
      try {
        await checkpointRef.set({
          state: "ERROR",
          runId,
          failureCode: error instanceof CryptoRuntimeError ? error.code : "CRYPTO_SELF_TEST_FAILED",
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (checkpointError) {
        logger.error("Aurora crypto checkpoint update failed", {
          runId,
          error: safeError(checkpointError)
        });
      }

      const status = error instanceof CryptoRuntimeError ? error.status : 503;
      const code = error instanceof CryptoRuntimeError ? error.code : "CRYPTO_SELF_TEST_FAILED";
      res.status(status).json({ ok: false, code });
    }
  }
);
