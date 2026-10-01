import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalIntegrationDocument,
  parseIntegrationDocumentPayload
} from "../src/auroraIntegrationDocument.ts";

const base = {
  sourceSystem: "TASY",
  externalDocumentId: "doc-fin-2026-0001",
  sourceVersion: 42,
  occurredAt: "2026-10-01T15:00:00Z",
  documentType: "FINANCIAL",
  competence: "2026-10",
  amountCents: 123456,
  count: 10,
  workflowState: "VALIDATED",
  slaDueAt: "2026-10-02T15:00:00Z",
  documentFragility: "NONE",
  missingFieldsCount: 0,
  nativeReady: true,
  sourceIndependent: true
};

test("closed integration document payload accepts canonical TASY facts", () => {
  const parsed = parseIntegrationDocumentPayload(base);
  assert.ok(parsed);
  assert.equal(parsed.sourceSystem, "TASY");
  assert.equal(parsed.amountCents, 123456);
  assert.equal(parsed.sourceIndependent, true);
});

test("MV and generic ERP are supported but arbitrary systems are rejected", () => {
  assert.equal(parseIntegrationDocumentPayload({ ...base, sourceSystem: "MV" })?.sourceSystem, "MV");
  assert.equal(parseIntegrationDocumentPayload({ ...base, sourceSystem: "ERP" })?.sourceSystem, "ERP");
  assert.equal(parseIntegrationDocumentPayload({ ...base, sourceSystem: "OTHER" }), null);
});

test("free text and unknown fields are rejected", () => {
  assert.equal(parseIntegrationDocumentPayload({ ...base, narrative: "texto livre" }), null);
  assert.equal(parseIntegrationDocumentPayload({ ...base, patientName: "Pessoa" }), null);
  assert.equal(parseIntegrationDocumentPayload({ ...base, diagnosis: "X" }), null);
});

test("clinical identifiers are not accepted as external document IDs", () => {
  assert.equal(parseIntegrationDocumentPayload({ ...base, externalDocumentId: "patient:123" }), null);
  assert.equal(parseIntegrationDocumentPayload({ ...base, externalDocumentId: "cpf:00000000000" }), null);
  assert.equal(parseIntegrationDocumentPayload({ ...base, externalDocumentId: "000.000.000-00" }), null);
});

test("source independence requires native-ready structured state", () => {
  assert.equal(parseIntegrationDocumentPayload({ ...base, nativeReady: false, sourceIndependent: true }), null);
  assert.equal(parseIntegrationDocumentPayload({ ...base, documentFragility: "DEGRADED_EXTRACTION", nativeReady: true }), null);
});

test("canonical document hashes external ID and excludes raw vendor identifier from facts", () => {
  const parsed = parseIntegrationDocumentPayload(base)!;
  const canonical = canonicalIntegrationDocument("wmgj", parsed);
  assert.match(String(canonical.id), /^[a-f0-9]{48}$/);
  assert.match(String(canonical.sourceIdHash), /^[a-f0-9]{64}$/);
  assert.match(String(canonical.canonicalSnapshotHash), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(canonical.facts).includes(base.externalDocumentId), false);
  assert.equal((canonical.facts as any).originConnector, "AURORA_INTEGRATION_API");
  assert.equal((canonical.facts as any).sanitized, true);
});
