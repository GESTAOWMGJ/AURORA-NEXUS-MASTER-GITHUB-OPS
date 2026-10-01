import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AURORA_CRYPTO_ALGORITHM,
  AURORA_CRYPTO_ENVELOPE_VERSION,
  GoogleKmsEnvelopeKey,
  decryptEnvelope,
  encryptEnvelope,
  type AccessTokenProvider,
  type CryptoAad,
  type EnvelopeKey,
  type WrappedDek
} from "../src/auroraCryptoEnvelope.ts";

const KEY_RESOURCE = "projects/wmgj-hml-jfn-20260927/locations/southamerica-east1/keyRings/aurora-hml/cryptoKeys/aurora-field-encryption";
const aad: CryptoAad = {
  orgId: "wmgj",
  entityType: "sourceDocument",
  schemaVersion: "1",
  logicalId: "doc-123"
};

class TestEnvelopeKey implements EnvelopeKey {
  readonly keyResource = KEY_RESOURCE;
  wrapCalls = 0;
  unwrapCalls = 0;

  async wrapKey(dek: Buffer, context: Buffer): Promise<WrappedDek> {
    this.wrapCalls += 1;
    const marker = createHash("sha256").update(context).digest().subarray(0, 8);
    return {
      ciphertext: Buffer.concat([marker, Buffer.from(dek).reverse()]),
      keyVersion: `${this.keyResource}/cryptoKeyVersions/7`
    };
  }

  async unwrapKey(wrapped: Buffer, context: Buffer): Promise<Buffer> {
    this.unwrapCalls += 1;
    const expected = createHash("sha256").update(context).digest().subarray(0, 8);
    assert.deepEqual(wrapped.subarray(0, 8), expected);
    return Buffer.from(wrapped.subarray(8)).reverse();
  }
}

test("envelope round-trip uses AES-256-GCM and KMS-wrapped DEK", async () => {
  const key = new TestEnvelopeKey();
  const envelope = await encryptEnvelope("clinical-sensitive-example", aad, key);
  assert.equal(envelope.envelopeVersion, AURORA_CRYPTO_ENVELOPE_VERSION);
  assert.equal(envelope.algorithm, AURORA_CRYPTO_ALGORITHM);
  assert.equal(envelope.keyResource, KEY_RESOURCE);
  assert.match(String(envelope.keyVersion), /cryptoKeyVersions\/7$/);
  assert.equal(key.wrapCalls, 1);

  const clear = await decryptEnvelope(envelope, aad, key);
  assert.equal(clear.toString("utf8"), "clinical-sensitive-example");
  clear.fill(0);
  assert.equal(key.unwrapCalls, 1);
});

test("same plaintext and AAD produce different envelopes", async () => {
  const key = new TestEnvelopeKey();
  const first = await encryptEnvelope("same-secret", aad, key);
  const second = await encryptEnvelope("same-secret", aad, key);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.wrappedDek, second.wrappedDek);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test("AAD mismatch fails before KMS unwrap", async () => {
  const key = new TestEnvelopeKey();
  const envelope = await encryptEnvelope("sensitive", aad, key);
  await assert.rejects(
    decryptEnvelope(envelope, { ...aad, logicalId: "doc-other" }, key),
    /CRYPTO_AAD_MISMATCH/
  );
  assert.equal(key.unwrapCalls, 0);
});

test("ciphertext tampering is authenticated and rejected", async () => {
  const key = new TestEnvelopeKey();
  const envelope = await encryptEnvelope("sensitive", aad, key);
  const tampered = Buffer.from(envelope.ciphertext, "base64");
  tampered[0] = (tampered[0] ?? 0) ^ 1;
  envelope.ciphertext = tampered.toString("base64");
  await assert.rejects(decryptEnvelope(envelope, aad, key), /CRYPTO_AUTHENTICATION_FAILED/);
});

test("key resource is bound to the envelope", async () => {
  const key = new TestEnvelopeKey();
  const envelope = await encryptEnvelope("sensitive", aad, key);
  const other = new TestEnvelopeKey();
  Object.defineProperty(other, "keyResource", {
    value: "projects/wmgj-hml-jfn-20260927/locations/southamerica-east1/keyRings/aurora-hml/cryptoKeys/other-key"
  });
  await assert.rejects(decryptEnvelope(envelope, aad, other), /CRYPTO_KEY_RESOURCE_MISMATCH/);
});

test("oversized plaintext is rejected before key wrapping", async () => {
  const key = new TestEnvelopeKey();
  await assert.rejects(
    encryptEnvelope(Buffer.alloc(1024 * 1024 + 1, 7), aad, key),
    /CRYPTO_PLAINTEXT_SIZE_INVALID/
  );
  assert.equal(key.wrapCalls, 0);
});

test("Google KMS adapter binds the wrapped DEK to AAD and never needs a static credential", async () => {
  const calls: Array<{ url: string; authorization: string; body: Record<string, string> }> = [];
  const tokenProvider: AccessTokenProvider = {
    async getAccessToken() { return "synthetic-workload-token"; }
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    calls.push({
      url,
      authorization: headers.get("authorization") ?? "",
      body
    });
    if (url.endsWith(":encrypt")) {
      const dek = Buffer.from(body.plaintext ?? "", "base64");
      return new Response(JSON.stringify({
        name: `${KEY_RESOURCE}/cryptoKeyVersions/3`,
        ciphertext: Buffer.from(dek).reverse().toString("base64")
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith(":decrypt")) {
      const wrapped = Buffer.from(body.ciphertext ?? "", "base64");
      return new Response(JSON.stringify({
        plaintext: Buffer.from(wrapped).reverse().toString("base64")
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };

  const key = new GoogleKmsEnvelopeKey(KEY_RESOURCE, tokenProvider, fetcher);
  const envelope = await encryptEnvelope("kms-round-trip", aad, key);
  const clear = await decryptEnvelope(envelope, aad, key);
  assert.equal(clear.toString("utf8"), "kms-round-trip");
  clear.fill(0);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.authorization, "Bearer synthetic-workload-token");
    assert.equal(
      call.body.additionalAuthenticatedData,
      Buffer.from(JSON.stringify(aad), "utf8").toString("base64")
    );
    assert.ok(!JSON.stringify(call.body).includes("synthetic-workload-token"));
  }
});
