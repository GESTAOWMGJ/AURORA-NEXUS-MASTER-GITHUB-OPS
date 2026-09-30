import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { canonicalJson, sha256 } from "./crypto.js";

export interface AuditEventInput {
  tenantId: string;
  siteId: string | null;
  aggregateType: string;
  aggregateId: string;
  action: string;
  actorKind: "USER" | "SERVICE";
  actorUid: string;
  correlationId: string;
  causationId: string;
  reasonCode: string;
  beforeHash: string | null;
  afterHash: string;
}

export async function appendAuditEvent(
  transaction: Transaction,
  input: AuditEventInput,
): Promise<string> {
  const [eventId] = await appendAuditEvents(transaction, [input]);
  return eventId!;
}

export async function appendAuditEvents(
  transaction: Transaction,
  inputs: AuditEventInput[],
): Promise<string[]> {
  const heads = inputs.map((input) => {
    const headId = `${input.aggregateType}--${input.aggregateId}`;
    return db.doc(`tenants/${input.tenantId}/aggregate_heads/${headId}`);
  });
  const snapshots = await transaction.getAll(...heads);
  const eventIds: string[] = [];

  inputs.forEach((input, index) => {
    const headRef = heads[index]!;
    const headSnapshot = snapshots[index]!;
    const previous = headSnapshot.exists
      ? (headSnapshot.data() as { sequence: number; eventHash: string })
      : { sequence: 0, eventHash: "GENESIS" };

    const occurredAt = Timestamp.now();
    const sequence = previous.sequence + 1;
    const eventRef = db.collection(
      `tenants/${input.tenantId}/audit_events`,
    ).doc();
    const eventWithoutHash = {
      tenantId: input.tenantId,
      siteId: input.siteId,
      schemaVersion: 1,
      dataClass: "INTERNAL",
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      sequence,
      action: input.action,
      actorKind: input.actorKind,
      actorUid: input.actorUid,
      occurredAt: occurredAt.toDate().toISOString(),
      correlationId: input.correlationId,
      causationId: input.causationId,
      reasonCode: input.reasonCode,
      beforeHash: input.beforeHash,
      afterHash: input.afterHash,
      prevEventHash: previous.eventHash,
    };
    const eventHash = sha256(canonicalJson(eventWithoutHash));

    transaction.create(eventRef, {
      ...eventWithoutHash,
      occurredAt,
      eventHash,
    });
    transaction.set(headRef, {
      sequence,
      eventHash,
      eventId: eventRef.id,
      updatedAt: occurredAt,
    });
    eventIds.push(eventRef.id);
  });

  return eventIds;
}
