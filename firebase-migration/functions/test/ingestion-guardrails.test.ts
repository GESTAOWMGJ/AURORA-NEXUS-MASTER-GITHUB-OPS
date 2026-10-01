import assert from "node:assert/strict";
import test from "node:test";
import {
  ingestOrganizationRejection,
  mergedDocumentForAudit,
  persistedDocumentHash
} from "../src/index.ts";

const validOrganization: Record<string, unknown> = {
  active: true,
  environment: "HOMOLOGATION",
  sourceMutation: false,
  productionMutation: false,
  clinicalSensitiveEnabled: false,
  projectionMode: "SHADOW"
};

test("ingestão aceita apenas organização de homologação com todos os bloqueios explícitos", () => {
  assert.equal(ingestOrganizationRejection(true, validOrganization), null);
});

test("ingestão falha fechado quando a organização não existe ou não tem dados", () => {
  assert.equal(
    ingestOrganizationRejection(false, validOrganization),
    "ORGANIZATION_NOT_BOOTSTRAPPED"
  );
  assert.equal(
    ingestOrganizationRejection(true, undefined),
    "ORGANIZATION_NOT_BOOTSTRAPPED"
  );
});

test("ingestão rejeita campo de guardrail ausente, permissivo ou com tipo incorreto", async (t) => {
  const invalidCases: Array<[string, Record<string, unknown>]> = [];
  const fields = [
    "active",
    "environment",
    "projectionMode",
    "sourceMutation",
    "productionMutation",
    "clinicalSensitiveEnabled"
  ] as const;

  for (const field of fields) {
    const missing = { ...validOrganization };
    delete missing[field];
    invalidCases.push([`${field} ausente`, missing]);
  }

  invalidCases.push(
    ["active=false", { ...validOrganization, active: false }],
    ["active como string", { ...validOrganization, active: "true" }],
    ["ambiente de produção", { ...validOrganization, environment: "PRODUCTION" }],
    ["ambiente em caixa divergente", { ...validOrganization, environment: "homologation" }],
    ["modo de projeção produtivo", { ...validOrganization, projectionMode: "LIVE" }],
    ["sourceMutation=true", { ...validOrganization, sourceMutation: true }],
    ["sourceMutation como string", { ...validOrganization, sourceMutation: "false" }],
    ["productionMutation=true", { ...validOrganization, productionMutation: true }],
    ["productionMutation nulo", { ...validOrganization, productionMutation: null }],
    ["clinicalSensitiveEnabled=true", { ...validOrganization, clinicalSensitiveEnabled: true }],
    ["clinicalSensitiveEnabled numérico", { ...validOrganization, clinicalSensitiveEnabled: 0 }]
  );

  for (const [name, organization] of invalidCases) {
    await t.test(name, () => {
      assert.equal(
        ingestOrganizationRejection(true, organization),
        "ORGANIZATION_GUARDRAILS_INVALID"
      );
    });
  }
});

test("estado de auditoria reflete o documento final de merge, inclusive mapas preservados", () => {
  const previous = {
    orgId: "wmgj",
    legacyMarker: "preservado",
    totals: { grossCents: 10_000, paidCents: 2_000 },
    migration: {
      originalBatch: "batch-1",
      eventId: "old-event",
      sourceSystem: "SHEETS"
    },
    tags: ["anterior"],
    updatedAt: "2026-09-26T00:00:00.000Z"
  };
  const patch = {
    sourceVersion: 2,
    totals: { paidCents: 4_000 },
    migration: { eventId: "new-event", idempotencyId: "idem-2" },
    tags: ["nova"],
    updatedAt: "2026-09-27T00:00:00.000Z"
  };

  const merged = mergedDocumentForAudit(previous, patch);
  assert.deepEqual(merged, {
    orgId: "wmgj",
    legacyMarker: "preservado",
    totals: { grossCents: 10_000, paidCents: 4_000 },
    migration: {
      originalBatch: "batch-1",
      eventId: "new-event",
      sourceSystem: "SHEETS",
      idempotencyId: "idem-2"
    },
    tags: ["nova"],
    updatedAt: "2026-09-27T00:00:00.000Z",
    sourceVersion: 2
  });

  assert.equal(
    persistedDocumentHash(previous, patch),
    persistedDocumentHash(null, merged)
  );
  assert.notEqual(
    persistedDocumentHash(previous, patch),
    persistedDocumentHash(null, patch)
  );

  // A construção do material de auditoria não altera snapshots nem payloads.
  assert.deepEqual(previous.totals, { grossCents: 10_000, paidCents: 2_000 });
  assert.deepEqual(patch.migration, { eventId: "new-event", idempotencyId: "idem-2" });
});

test("hash final é estável para ordem de chaves e ignora apenas metadados temporais", () => {
  const first = persistedDocumentHash(
    { preserved: "yes", nested: { a: 1 }, createdAt: "old" },
    { nested: { b: 2 }, updatedAt: "first", migration: { importedAt: "first" } }
  );
  const reordered = persistedDocumentHash(
    { createdAt: "another", nested: { a: 1 }, preserved: "yes" },
    { migration: { importedAt: "another" }, updatedAt: "second", nested: { b: 2 } }
  );
  const changedBusinessState = persistedDocumentHash(
    { preserved: "changed", nested: { a: 1 }, createdAt: "old" },
    { nested: { b: 2 }, updatedAt: "first", migration: { importedAt: "first" } }
  );

  assert.equal(first, reordered);
  assert.notEqual(first, changedBusinessState);
});

test("mapa vazio substitui mapa anterior como no set merge do Firestore", () => {
  const previous = {
    totals: { grossCents: 10_000, paidCents: 2_000 },
    preserved: "yes"
  };
  const patch = { totals: {} };
  const finalDocument = { totals: {}, preserved: "yes" };

  assert.deepEqual(mergedDocumentForAudit(previous, patch), finalDocument);
  assert.equal(
    persistedDocumentHash(previous, patch),
    persistedDocumentHash(null, finalDocument)
  );
});
