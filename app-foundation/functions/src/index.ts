import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { appendAuditEvent, appendAuditEvents } from "./audit.js";
import {
  actionPermission,
  mfaRequiredActions,
  operationalActionSchema,
} from "./contracts.js";
import { canonicalJson, hmacSha256, sha256 } from "./crypto.js";
import { db } from "./firebase.js";
import { authorizeInTransaction, hasSecondFactor } from "./security.js";

setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
  concurrency: 40,
  memory: "256MiB",
});

const idempotencySecret = defineSecret("IDEMPOTENCY_HMAC_SECRET");

export const health = onRequest(
  { cors: false, maxInstances: 2 },
  (_request, response) => {
    response.status(200).json({
      ok: true,
      service: "wmgj-master-data",
      schemaVersion: 1,
    });
  },
);

export const requestOperationalAction = onCall(
  {
    enforceAppCheck: true,
    secrets: [idempotencySecret],
    maxInstances: 5,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
    }

    const input = operationalActionSchema.safeParse(request.data);
    if (!input.success) {
      throw new HttpsError("invalid-argument", "INVALID_ACTION_REQUEST", {
        issues: input.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.join("."),
        })),
      });
    }

    const command = input.data;
    if (
      mfaRequiredActions.has(command.action) &&
      !hasSecondFactor(request.auth.token)
    ) {
      throw new HttpsError("permission-denied", "MFA_REQUIRED");
    }

    const permission = actionPermission[command.action];
    const secret = idempotencySecret.value();
    if (secret.length < 32) {
      throw new HttpsError("failed-precondition", "IDEMPOTENCY_SECRET_INVALID");
    }

    const keyHash = hmacSha256(
      secret,
      `${command.tenantId}|${command.commandId}`,
    );
    const requestHash = sha256(canonicalJson(command));
    const idempotencyRef = db.doc(
      `tenants/${command.tenantId}/idempotency/${keyHash}`,
    );
    const actionRef = db.doc(
      `tenants/${command.tenantId}/action_requests/${keyHash}`,
    );

    return db.runTransaction(async (transaction) => {
      await authorizeInTransaction(
        transaction,
        request.auth!.uid,
        command.tenantId,
        permission,
        command.siteId,
      );

      if (command.targetId !== null) {
        const targetRef = db.doc(
          `tenants/${command.tenantId}/validation_tasks/${command.targetId}`,
        );
        const targetSnapshot = await transaction.get(targetRef);
        if (!targetSnapshot.exists) {
          throw new HttpsError("not-found", "VALIDATION_TARGET_NOT_FOUND");
        }
        const target = targetSnapshot.data() as {
          siteId?: string | null;
          revision?: number;
        };
        if ((target.siteId ?? null) !== command.siteId) {
          throw new HttpsError("failed-precondition", "TARGET_SITE_MISMATCH");
        }
        if (target.revision !== command.expectedRevision) {
          throw new HttpsError("aborted", "REVISION_CONFLICT");
        }
      }

      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (idempotencySnapshot.exists) {
        const previous = idempotencySnapshot.data() as {
          requestHash: string;
          resultRef: string;
          status: string;
        };
        if (previous.requestHash !== requestHash) {
          throw new HttpsError("already-exists", "IDEMPOTENCY_KEY_REUSED");
        }
        return {
          ok: true,
          reused: true,
          status: previous.status,
          actionRequestId: previous.resultRef,
        };
      }

      const now = Timestamp.now();
      const actionRecord = {
        tenantId: command.tenantId,
        siteId: command.siteId,
        schemaVersion: 1,
        dataClass: "INTERNAL",
        action: command.action,
        reasonCode: command.reasonCode,
        targetId: command.targetId,
        expectedRevision: command.expectedRevision,
        status: "QUEUED",
        revision: 1,
        commandKeyHash: keyHash,
        correlationId: command.commandId,
        createdAt: now,
        createdBy: { kind: "USER", id: request.auth!.uid },
      };
      const afterHash = sha256({
        ...actionRecord,
        createdAt: now.toDate().toISOString(),
      });

      const auditEventId = await appendAuditEvent(transaction, {
        tenantId: command.tenantId,
        siteId: command.siteId,
        aggregateType: "ACTION_REQUEST",
        aggregateId: actionRef.id,
        action: "ACTION_QUEUED",
        actorKind: "USER",
        actorUid: request.auth!.uid,
        correlationId: command.commandId,
        causationId: command.commandId,
        reasonCode: command.reasonCode,
        beforeHash: null,
        afterHash,
      });

      transaction.create(actionRef, {
        ...actionRecord,
        integrity: { payloadSha256: afterHash, schemaVersion: 1 },
        auditEventId,
      });
      transaction.create(idempotencyRef, {
        requestHash,
        status: "QUEUED",
        resultRef: actionRef.id,
        createdAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000),
      });

      return {
        ok: true,
        reused: false,
        status: "QUEUED",
        actionRequestId: actionRef.id,
      };
    });
  },
);

export const onSourceCreated = onDocumentCreated(
  {
    document: "tenants/{tenantId}/sources/{sourceId}",
    retry: true,
    maxInstances: 10,
  },
  async (event) => {
    if (!event.data) {
      return;
    }

    const tenantId = event.params.tenantId;
    const sourceId = event.params.sourceId;
    const source = event.data.data() as {
      siteId?: string | null;
      schemaVersion?: number;
      revision?: number;
      status?: string;
    };
    const processorVersion = "metadata-classifier-0.1.0";
    const schemaVersion = source.schemaVersion ?? 1;
    const runId = sha256(
      `${tenantId}|${sourceId}|${processorVersion}|${schemaVersion}`,
    );
    const runRef = db.doc(
      `tenants/${tenantId}/processing_runs/${runId}`,
    );

    await db.runTransaction(async (transaction) => {
      const runSnapshot = await transaction.get(runRef);
      if (runSnapshot.exists) {
        return;
      }

      const now = Timestamp.now();
      const runRecord = {
        tenantId,
        siteId: source.siteId ?? null,
        schemaVersion,
        dataClass: "INTERNAL",
        sourceId,
        processorKind: "OPENAI_METADATA_CLASSIFIER",
        processorVersion,
        status: "QUEUED",
        attempt: 0,
        nextAttemptAt: now,
        correlationId: event.id,
        createdAt: now,
        createdBy: { kind: "SERVICE", id: "onSourceCreated" },
      };
      const afterHash = sha256({
        ...runRecord,
        createdAt: now.toDate().toISOString(),
        nextAttemptAt: now.toDate().toISOString(),
      });
      const sourceBeforeHash = sha256({
        sourceId,
        siteId: source.siteId ?? null,
        status: source.status ?? null,
        revision: source.revision ?? 0,
      });
      const sourceAfterHash = sha256({
        sourceId,
        siteId: source.siteId ?? null,
        status: "QUEUED",
        revision: (source.revision ?? 0) + 1,
      });
      const [runAuditEventId, sourceAuditEventId] = await appendAuditEvents(
        transaction,
        [
          {
            tenantId,
            siteId: source.siteId ?? null,
            aggregateType: "PROCESSING_RUN",
            aggregateId: runId,
            action: "PROCESSING_QUEUED",
            actorKind: "SERVICE",
            actorUid: "onSourceCreated",
            correlationId: event.id,
            causationId: sourceId,
            reasonCode: "SOURCE_CREATED",
            beforeHash: null,
            afterHash,
          },
          {
            tenantId,
            siteId: source.siteId ?? null,
            aggregateType: "SOURCE",
            aggregateId: sourceId,
            action: "SOURCE_QUEUED",
            actorKind: "SERVICE",
            actorUid: "onSourceCreated",
            correlationId: event.id,
            causationId: runId,
            reasonCode: "PROCESSING_RUN_CREATED",
            beforeHash: sourceBeforeHash,
            afterHash: sourceAfterHash,
          },
        ],
      );

      transaction.create(runRef, {
        ...runRecord,
        integrity: { payloadSha256: afterHash, schemaVersion },
        auditEventId: runAuditEventId,
      });
      transaction.set(
        event.data!.ref,
        {
          status: "QUEUED",
          revision: FieldValue.increment(1),
          updatedAt: now,
          updatedBy: { kind: "SERVICE", id: "onSourceCreated" },
          lastAuditEventId: sourceAuditEventId,
        },
        { merge: true },
      );
    });
  },
);

export { classifySanitizedMetadata } from "./openai-classifier.js";
export { ingestShadowSnapshot } from "./shadow-ingest.js";
