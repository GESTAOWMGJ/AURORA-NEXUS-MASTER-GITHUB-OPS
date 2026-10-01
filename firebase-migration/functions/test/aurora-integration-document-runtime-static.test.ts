import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const runtime = fs.readFileSync("src/auroraIntegrationRuntime.ts", "utf8");
const firebase = JSON.parse(fs.readFileSync("../firebase.json", "utf8"));

test("canonical ERP document endpoint requires documents.ingest scope", () => {
  assert.match(runtime, /auroraNexusIntegrationDocuments/);
  assert.match(runtime, /verifyIntegrationBearer\(req\.get\("authorization"\), "documents\.ingest"\)/);
  assert.match(runtime, /parseIntegrationDocumentPayload/);
  assert.match(runtime, /canonicalIntegrationDocument/);
  assert.match(runtime, /sourceDocuments/);
});

test("Firebase Hosting routes canonical ERP documents before catch-all auth gate", () => {
  const routes = firebase.hosting.rewrites.map((item: any) => item.source);
  const documentIndex = routes.indexOf("/api/integration/documents");
  const catchAll = routes.indexOf("**");
  assert.ok(documentIndex >= 0);
  assert.ok(catchAll > documentIndex);
});

test("integration document runtime never persists raw narrative or external document ID", () => {
  const block = runtime.slice(runtime.indexOf("export const auroraNexusIntegrationDocuments"));
  assert.doesNotMatch(block, /narrative:/);
  assert.doesNotMatch(block, /externalDocumentId:/);
  assert.match(block, /sourceIdHash/);
});
