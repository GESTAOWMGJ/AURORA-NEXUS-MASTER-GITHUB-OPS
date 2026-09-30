import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalHmacV2Payload,
  parseHmacKeyring,
  signHmacV2,
  verifyHmacV2,
  type HmacV2Headers
} from "../src/security.ts";

const now = Date.parse("2026-08-26T18:00:00.000Z");
const secretA = "a".repeat(64);
const secretB = "b".repeat(64);
const rawKeyring = JSON.stringify({
  "apps-script-2026-08": {
    active: true,
    secret: secretA,
    orgIds: ["wmgj"],
    entityTypes: ["sourceDocument", "invoice"],
    notBefore: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-30T00:00:00.000Z"
  },
  "apps-script-2026-09": {
    active: true,
    secret: secretB,
    orgIds: ["wmgj"],
    entityTypes: ["sourceDocument"]
  }
});

function signedHeaders(body: Buffer): HmacV2Headers {
  const headers: HmacV2Headers = {
    signatureVersion: "v2",
    timestamp: String(now / 1000),
    nonce: "0f719f5a-0806-4b2b-a40c-717371d275ee",
    keyId: "apps-script-2026-08",
    orgId: "wmgj",
    idempotencyKey: "wmgj:SHEETS:sheet:tab:2:hash",
    signature: "",
    method: "POST",
    contentType: "application/json; charset=utf-8"
  };
  headers.signature = signHmacV2(body, headers, secretA);
  return headers;
}

test("keyring exige segredo canônico de 32 bytes em hex", () => {\n  assert.throws(() => parseHmacKeyring(JSON.stringify({\n    weak: { active: true, secret: "a".repeat(32), orgIds: ["wmgj"], entityTypes: ["invoice"] }\n  })), /HMAC_KEYRING_INVALID_ENTRY/);\n  assert.throws(() => parseHmacKeyring(JSON.stringify({\n    malformed: { active: true, secret: "z".repeat(64), orgIds: ["wmgj"], entityTypes: ["invoice"] }\n  })), /HMAC_KEYRING_INVALID_ENTRY/);\n});\n\ntest("HMAC v2 autentica body e todos os headers de escopo", () => {
  const body = Buffer.from('{"orgId":"wmgj"}', "utf8");
  const headers = signedHeaders(body);
  const result = verifyHmacV2(body, headers, rawKeyring, now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.principal.keyId, "apps-script-2026-08");
    assert.deepEqual(result.principal.entityTypes, ["sourceDocument", "invoice"]);
  }
  assert.match(canonicalHmacV2Payload(body, headers), /^WMGJ-HMAC-V2\nPOST\napplication\/json\n/);
});

test("HMAC v2 rejeita alteração de body ou qualquer header assinado", () => {
  const body = Buffer.from('{"orgId":"wmgj"}', "utf8");
  const headers = signedHeaders(body);
  const cases: Array<[Buffer, HmacV2Headers]> = [
    [Buffer.from('{"orgId":"other"}', "utf8"), headers],
    [body, { ...headers, orgId: "other" }],
    [body, { ...headers, idempotencyKey: "different" }],
    [body, { ...headers, nonce: "1f719f5a-0806-4b2b-a40c-717371d275ee" }],
    [body, { ...headers, timestamp: String(now / 1000 + 1) }],
    [body, { ...headers, keyId: "apps-script-2026-09" }],
    [body, { ...headers, method: "PUT" }],
    [body, { ...headers, contentType: "application/problem+json" }]
  ];
  for (const [candidateBody, candidateHeaders] of cases) {
    const result = verifyHmacV2(candidateBody, candidateHeaders, rawKeyring, now);
    assert.equal(result.ok, false);
  }
});

test("keyring permite rotação por keyId sem segredo global", () => {
  const keyring = parseHmacKeyring(rawKeyring);
  assert.deepEqual(Object.keys(keyring).sort(), ["apps-script-2026-08", "apps-script-2026-09"]);

  const body = Buffer.from("{}", "utf8");
  const headers = signedHeaders(body);
  headers.keyId = "apps-script-2026-09";
  headers.signature = signHmacV2(body, headers, secretB);
  assert.equal(verifyHmacV2(body, headers, rawKeyring, now).ok, true);
});

test("HMAC v2 rejeita timestamp fora da janela e chave vencida", () => {
  const body = Buffer.from("{}", "utf8");
  const oldHeaders = signedHeaders(body);
  oldHeaders.timestamp = String(now / 1000 - 301);
  oldHeaders.signature = signHmacV2(body, oldHeaders, secretA);
  assert.deepEqual(verifyHmacV2(body, oldHeaders, rawKeyring, now), {
    ok: false,
    code: "TIMESTAMP_OUTSIDE_WINDOW"
  });

  const expiredNow = Date.parse("2026-10-01T00:00:00.000Z");
  const headers = signedHeaders(body);
  headers.timestamp = String(expiredNow / 1000);
  headers.signature = signHmacV2(body, headers, secretA);
  assert.deepEqual(
    verifyHmacV2(body, headers, rawKeyring, expiredNow),
    { ok: false, code: "KEY_OUTSIDE_VALIDITY" }
  );
});
