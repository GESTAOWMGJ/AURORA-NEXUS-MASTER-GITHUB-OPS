import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {
  decideIdempotency,
  decideSourceVersion,
  semanticEventForIdempotency
} from "./idempotency.js";
import { collectionFor, keyAllowsEntityType } from "./policy.js";
import {
  sha256Hex,
  verifyHmacV2,
  type HmacV2Headers
} from "./security.js";
import { validateEvent } from "./validation.js";
import { auroraDb as db } from "./firebase.js";

setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  timeoutSeconds: 60,
  memory: "512MiB"
});

const HMAC_KEYRING = defineSecret("WMGJ_INGEST_HMAC_KEYRING");
const NONCE_TTL_MILLISECONDS = 15 * 60 * 1000;

class IngestDomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
    this.name = "IngestDomainError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    if (value instanceof Timestamp) return value.toDate().toISOString();
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
      if (!["createdAt", "updatedAt", "serverAt", "importedAt"].includes(key)) {
        acc[key] = stableValue(record[key]);
      }
      return acc;
    }, {});
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

type IngestOrganizationRejection =
  | "ORGANIZATION_NOT_BOOTSTRAPPED"
  | "ORGANIZATION_GUARDRAILS_INVALID";

/**
 * A ingestão é permitida somente no tenant explicitamente preparado para
 * homologação não clínica. Comparações estritas mantêm o gate fechado para
 * campos ausentes, nulos ou serializados com o tipo incorreto.
 */
export function ingestOrganizationRejection(
  exists: boolean,
  organization: Record<string, unknown> | undefined
): IngestOrganizationRejection | null {
  if (!exists || !organization) return "ORGANIZATION_NOT_BOOTSTRAPPED";

  if (
    organization.active !== true
    || organization.environment !== "HOMOLOGATION"
    || organization.projectionMode !== "SHADOW"
    || organization.sourceMutation !== false
    || organization.productionMutation !== false
    || organization.clinicalSensitiveEnabled !== false
  ) {
    return "ORGANIZATION_GUARDRAILS_INVALID";
  }

  return null;
}

function isPlainDocumentMap(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reproduz a semântica relevante de set(..., { merge: true }) para o material
 * coberto pelo hash. Mapas são mesclados recursivamente; arrays e escalares
 * substituem o valor anterior. Sentinelas temporais não entram neste patch e
 * são removidas por stableValue antes do hash.
 */
export function mergedDocumentForAudit(
  previous: Record<string, unknown> | null,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = previous ? { ...previous } : {};

  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    if (isPlainDocumentMap(value) && Object.keys(value).length === 0) {
      // Firestore trata um mapa vazio explícito como substituição do mapa,
      // mesmo com merge=true.
      merged[key] = {};
    } else {
      merged[key] = isPlainDocumentMap(current) && isPlainDocumentMap(value)
        ? mergedDocumentForAudit(current, value)
        : value;
    }
  }

  return merged;
}

export function persistedDocumentHash(
  previous: Record<string, unknown> | null,
  patch: Record<string, unknown>
): string {
  return sha256Hex(stableJson(mergedDocumentForAudit(previous, patch)));
}

function deterministicId(entityType: string, entityKey: string): string {
  return sha256Hex(`${entityType}:${entityKey}`).slice(0, 48);
}

function safeLogError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]/g, " ").slice(0, 300);
}

export const ingestWmgjEvent = onRequest(
  { secrets: [HMAC_KEYRING], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const contentType = String(req.get("content-type") || "");
    if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      res.status(415).json({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }

    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
    const authHeaders: HmacV2Headers = {
      signatureVersion: String(req.get("x-wmgj-signature-version") || ""),
      timestamp: String(req.get("x-wmgj-timestamp") || ""),
      nonce: String(req.get("x-wmgj-nonce") || ""),
      keyId: String(req.get("x-wmgj-key-id") || ""),
      orgId: String(req.get("x-wmgj-org-id") || ""),
      idempotencyKey: String(req.get("x-wmgj-idempotency-key") || ""),
      signature: String(req.get("x-wmgj-signature") || ""),
      method: req.method,
      contentType
    };

    const verification = verifyHmacV2(rawBody, authHeaders, HMAC_KEYRING.value());
    if (!verification.ok) {
      const configurationFailure = verification.code === "KEYRING_INVALID";
      logger.warn("WMGJ ingest authentication rejected", {
        code: verification.code,
        keyId: authHeaders.keyId,
        orgId: authHeaders.orgId
      });
      res.status(configurationFailure ? 503 : 401).json({
        ok: false,
        code: configurationFailure ? "SECURITY_CONFIGURATION_ERROR" : "INVALID_SIGNATURE"
      });
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ ok: false, code: "INVALID_JSON" });
      return;
    }

    const validation = validateEvent(input, rawBody.byteLength);
    if (!validation.ok || !validation.event) {
      logger.warn("WMGJ ingest validation rejected", {
        code: "VALIDATION_ERROR",
        keyId: authHeaders.keyId,
        orgId: authHeaders.orgId,
        errors: validation.errors
      });
      res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: validation.errors });
      return;
    }

    const event = validation.event;
    if (event.orgId !== authHeaders.orgId || event.idempotencyKey !== authHeaders.idempotencyKey) {
      res.status(403).json({ ok: false, code: "SIGNED_HEADER_BODY_MISMATCH" });
      return;
    }
    if (!keyAllowsEntityType(verification.principal.entityTypes, event.entityType)) {
      res.status(403).json({ ok: false, code: "KEY_SCOPE_VIOLATION" });
      return;
    }

    try {
      const collection = collectionFor(event.entityType);
      if (!collection) throw new IngestDomainError(400, "ENTITY_TYPE_NOT_ALLOWED");

      const entityId = deterministicId(event.entityType, event.entityKey);
      // eventId e occurredAt identificam a tentativa, não a operação lógica.
      // Excluí-los permite replay seguro em um novo ciclo sem aceitar mudança
      // nos campos semânticos cobertos pela mesma Idempotency-Key.
      const payloadHash = sha256Hex(stableJson(
        semanticEventForIdempotency(event as unknown as Record<string, unknown>)
      ));
      const idempotencyId = sha256Hex(event.idempotencyKey);
      const nonceId = sha256Hex(`${authHeaders.keyId}:${authHeaders.nonce}`);
      const orgRef = db.doc(`organizations/${event.orgId}`);
      const idemRef = orgRef.collection("integrationEvents").doc(idempotencyId);
      const nonceRef = orgRef.collection("requestNonces").doc(nonceId);
      const entityRef = orgRef.collection(collection).doc(entityId);
      const auditRef = orgRef.collection("auditEvents").doc(idempotencyId);
      const checkpointRef = orgRef.collection("runtimeCheckpoints").doc("ingestion");

      const result = await db.runTransaction(async (tx) => {
        const orgSnap = await tx.get(orgRef);
        const nonceSnap = await tx.get(nonceRef);
        const idemSnap = await tx.get(idemRef);
        const entitySnap = await tx.get(entityRef);

        const organizationRejection = ingestOrganizationRejection(
          orgSnap.exists,
          orgSnap.exists ? orgSnap.data() : undefined
        );
        if (organizationRejection) {
          throw new IngestDomainError(412, organizationRejection);
        }
        if (nonceSnap.exists) throw new IngestDomainError(409, "REPLAY_DETECTED");

        const idempotency = decideIdempotency(
          idemSnap.exists ? idemSnap.data() : null,
          payloadHash
        );
        if (idempotency.kind === "CONFLICT") {
          throw new IngestDomainError(409, "IDEMPOTENCY_CONFLICT");
        }

        tx.create(nonceRef, {
          orgId: event.orgId,
          keyId: authHeaders.keyId,
          nonceHash: nonceId,
          acceptedAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + NONCE_TTL_MILLISECONDS)
        });

        if (idempotency.kind === "DUPLICATE") {
          return {
            duplicate: true,
            entityId: idempotency.entityId || entityId,
            eventId: idempotency.eventId || event.eventId
          };
        }

        const previous: Record<string, unknown> | null = entitySnap.exists
          ? entitySnap.data() ?? null
          : null;
        const sourceVersionDecision = decideSourceVersion(
          previous?.sourceVersion,
          event.sourceVersion
        );
        if (sourceVersionDecision === "REGRESSION") {
          throw new IngestDomainError(409, "SOURCE_VERSION_REGRESSION");
        }
        if (sourceVersionDecision === "CONFLICT") {
          throw new IngestDomainError(409, "SOURCE_VERSION_CONFLICT");
        }
        const occurredAt = Timestamp.fromDate(new Date(event.occurredAt));
        const hashableAfter = {
          ...event.record,
          orgId: event.orgId,
          schemaVersion: 1,
          entityType: event.entityType,
          entityKey: event.entityKey,
          sourceVersion: event.sourceVersion,
          competence: event.competence ?? null,
          documentType: event.documentType ?? null,
          workflowState: event.workflowState,
          reviewState: event.reviewState,
          riskLevel: event.riskLevel,
          sensitivity: event.sensitivity,
          source: event.source,
          migration: {
            eventId: event.eventId,
            idempotencyId,
            sourceSystem: event.source.system
          }
        };
        const normalized = {
          ...hashableAfter,
          migration: {
            ...hashableAfter.migration,
            importedAt: FieldValue.serverTimestamp()
          },
          createdAt: entitySnap.exists
            ? previous?.createdAt ?? FieldValue.serverTimestamp()
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };

        const beforeHash = previous ? sha256Hex(stableJson(previous)) : null;
        // Firestore preserva campos ausentes no patch quando merge=true. O hash
        // deve representar o documento lógico final, inclusive campos legados
        // e mapas aninhados preservados, não apenas o payload parcial recebido.
        const afterHash = persistedDocumentHash(previous, hashableAfter);

        tx.set(entityRef, normalized, { merge: true });
        tx.create(idemRef, {
          orgId: event.orgId,
          eventId: event.eventId,
          eventType: event.eventType,
          entityType: event.entityType,
          entityId,
          authenticatedKeyId: authHeaders.keyId,
          sourceVersion: event.sourceVersion,
          sourceSystem: event.source.system,
          sourceId: event.source.sourceId,
          payloadHash,
          occurredAt,
          acceptedAt: FieldValue.serverTimestamp(),
          status: "ACCEPTED"
        });
        tx.create(auditRef, {
          orgId: event.orgId,
          action: entitySnap.exists ? "ENTITY_UPDATED" : "ENTITY_CREATED",
          entityType: event.entityType,
          entityId,
          eventId: event.eventId,
          idempotencyId,
          authenticatedKeyId: authHeaders.keyId,
          sourceVersion: event.sourceVersion,
          actor: event.actor,
          source: event.source,
          beforeHash,
          afterHash,
          occurredAt,
          serverAt: FieldValue.serverTimestamp(),
          schemaVersion: 1
        });
        tx.set(checkpointRef, {
          orgId: event.orgId,
          component: "ingestion",
          state: "HEALTHY",
          lastEventId: event.eventId,
          lastEntityType: event.entityType,
          lastAcceptedAt: FieldValue.serverTimestamp(),
          acceptedCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        return { duplicate: false, entityId, eventId: event.eventId };
      });

      res.status(result.duplicate ? 200 : 202).json({
        ok: true,
        accepted: !result.duplicate,
        duplicate: result.duplicate,
        entityId: result.entityId,
        eventId: result.eventId
      });
    } catch (error) {
      if (error instanceof IngestDomainError) {
        logger.warn("WMGJ ingest domain rejected", {
          code: error.code,
          eventId: event.eventId,
          entityType: event.entityType,
          orgId: event.orgId,
          keyId: authHeaders.keyId,
          idempotencyId: sha256Hex(event.idempotencyKey)
        });
        res.status(error.status).json({ ok: false, code: error.code });
        return;
      }
      logger.error("WMGJ ingest failed", {
        eventId: event.eventId,
        entityType: event.entityType,
        error: safeLogError(error)
      });
      res.status(500).json({ ok: false, code: "INGEST_FAILED" });
    }
  }
);

export const runtimeWatchdog = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", retryCount: 1 },
  async () => {
    const now = Timestamp.now();
    const stale = await db.collectionGroup("runtimeLocks")
      .where("state", "==", "LOCKED")
      .where("leaseUntil", "<", now)
      .limit(100)
      .get();

    if (stale.empty) return;

    const batch = db.batch();
    for (const lock of stale.docs) {
      batch.update(lock.ref, {
        state: "EXPIRED",
        expiredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    logger.warn("WMGJ watchdog expired stale locks", { count: stale.size });
  }
);

export const runtimeHealth = onRequest({ cors: false }, async (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "wmgj-firestore-ingestion",
    schemaVersion: 1,
    signatureVersion: "v2",
    time: new Date().toISOString()
  });
});
