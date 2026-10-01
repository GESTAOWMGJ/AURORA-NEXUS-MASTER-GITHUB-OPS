import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialAllowsScope,
  issueIntegrationCredential,
  normalizeScopes,
  parseIntegrationApiKey,
  tokenHashMatches
} from "../src/auroraIntegrationCredential.ts";

test("integration key is random, scoped and hash-verifiable", () => {
  const issued = issueIntegrationCredential(["integration.read", "documents.ingest"], 90, new Date("2026-10-01T12:00:00Z"));
  assert.match(issued.apiKey, /^anx_ik_[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(parseIntegrationApiKey(issued.apiKey)?.keyId, issued.keyId);
  assert.equal(tokenHashMatches(issued.apiKey, issued.tokenHash), true);
  assert.equal(tokenHashMatches(issued.apiKey + "x", issued.tokenHash), false);
  assert.equal(issued.expiresAt.toISOString(), "2026-12-30T12:00:00.000Z");
});

test("scopes are closed vocabulary and deduplicated", () => {
  assert.deepEqual(normalizeScopes(["integration.read", "integration.read"]), ["integration.read"]);
  assert.equal(normalizeScopes(["admin.all"]), null);
  assert.equal(normalizeScopes([]), null);
});

test("stored credential must be active, unexpired and include required scope", () => {
  const future = { toDate: () => new Date("2026-10-02T00:00:00Z") };
  const past = { toDate: () => new Date("2026-09-30T00:00:00Z") };
  assert.equal(credentialAllowsScope({ active:true, scopes:["integration.read"], expiresAt:future }, "integration.read", new Date("2026-10-01T00:00:00Z")), true);
  assert.equal(credentialAllowsScope({ active:true, scopes:["integration.write"], expiresAt:future }, "integration.read", new Date("2026-10-01T00:00:00Z")), false);
  assert.equal(credentialAllowsScope({ active:false, scopes:["integration.read"], expiresAt:future }, "integration.read", new Date("2026-10-01T00:00:00Z")), false);
  assert.equal(credentialAllowsScope({ active:true, scopes:["integration.read"], expiresAt:past }, "integration.read", new Date("2026-10-01T00:00:00Z")), false);
});
