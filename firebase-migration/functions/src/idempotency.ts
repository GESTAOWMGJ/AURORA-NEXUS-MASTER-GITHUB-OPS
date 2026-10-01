export interface StoredIdempotencyRecord {
  payloadHash?: unknown;
  entityId?: unknown;
  eventId?: unknown;
}

export type IdempotencyDecision =
  | { kind: "NEW" }
  | { kind: "DUPLICATE"; entityId?: string; eventId?: string }
  | { kind: "CONFLICT" };

export type SourceVersionDecision = "ACCEPT" | "REGRESSION" | "CONFLICT";

export function semanticEventForIdempotency(
  event: Record<string, unknown>
): Record<string, unknown> {
  const { eventId: _eventId, occurredAt: _occurredAt, ...semanticEvent } = event;
  return semanticEvent;
}

export function decideIdempotency(
  existing: StoredIdempotencyRecord | null | undefined,
  incomingPayloadHash: string
): IdempotencyDecision {
  if (!existing) return { kind: "NEW" };
  if (typeof existing.payloadHash !== "string" || existing.payloadHash !== incomingPayloadHash) {
    return { kind: "CONFLICT" };
  }
  return {
    kind: "DUPLICATE",
    ...(typeof existing.entityId === "string" ? { entityId: existing.entityId } : {}),
    ...(typeof existing.eventId === "string" ? { eventId: existing.eventId } : {})
  };
}

export function decideSourceVersion(
  existingSourceVersion: unknown,
  incomingSourceVersion: number
): SourceVersionDecision {
  if (existingSourceVersion === undefined || existingSourceVersion === null) return "ACCEPT";
  if (
    typeof existingSourceVersion !== "number" ||
    !Number.isSafeInteger(existingSourceVersion)
  ) {
    return "CONFLICT";
  }
  const existing = Number(existingSourceVersion);
  if (incomingSourceVersion > existing) return "ACCEPT";
  if (incomingSourceVersion < existing) return "REGRESSION";
  return "CONFLICT";
}
