import assert from "node:assert/strict";
import test from "node:test";
import {
  decideIdempotency,
  decideSourceVersion,
  semanticEventForIdempotency
} from "../src/idempotency.ts";

test("idempotência aceita evento ainda não registrado", () => {
  assert.deepEqual(decideIdempotency(null, "a".repeat(64)), { kind: "NEW" });
});

test("idempotência devolve duplicate apenas para o mesmo payloadHash", () => {
  assert.deepEqual(
    decideIdempotency(
      { payloadHash: "a".repeat(64), entityId: "entity-1", eventId: "event-1" },
      "a".repeat(64)
    ),
    { kind: "DUPLICATE", entityId: "entity-1", eventId: "event-1" }
  );
});

test("mesma chave com payload diferente é conflito", () => {
  assert.deepEqual(
    decideIdempotency({ payloadHash: "a".repeat(64) }, "b".repeat(64)),
    { kind: "CONFLICT" }
  );
  assert.deepEqual(decideIdempotency({}, "b".repeat(64)), { kind: "CONFLICT" });
});

test("sourceVersion impede regressão e colisão de versão", () => {
  assert.equal(decideSourceVersion(undefined, 10), "ACCEPT");
  assert.equal(decideSourceVersion(9, 10), "ACCEPT");
  assert.equal(decideSourceVersion(11, 10), "REGRESSION");
  assert.equal(decideSourceVersion(10, 10), "CONFLICT");
  assert.equal(decideSourceVersion("invalid", 10), "CONFLICT");
});

test("identidade semântica ignora tentativa mas preserva conteúdo", () => {
  const first = semanticEventForIdempotency({
    eventId: "attempt-1",
    occurredAt: "2026-08-26T10:00:00Z",
    sourceVersion: 1,
    record: { amount: 100, occurredAt: "2026-08-01T00:00:00Z" }
  });
  const replay = semanticEventForIdempotency({
    eventId: "attempt-2",
    occurredAt: "2026-08-26T11:00:00Z",
    sourceVersion: 1,
    record: { amount: 100, occurredAt: "2026-08-01T00:00:00Z" }
  });
  const changed = semanticEventForIdempotency({
    eventId: "attempt-3",
    occurredAt: "2026-08-26T12:00:00Z",
    sourceVersion: 1,
    record: { amount: 101, occurredAt: "2026-08-01T00:00:00Z" }
  });

  assert.deepEqual(first, replay);
  assert.notDeepEqual(first, changed);
  assert.equal((first.record as { occurredAt: string }).occurredAt, "2026-08-01T00:00:00Z");
});
