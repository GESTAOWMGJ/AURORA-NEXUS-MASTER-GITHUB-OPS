import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtime = readFileSync(new URL("../src/auroraCryptoRuntime.ts", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../../.github/workflows/aurora-crypto-hml.yml", import.meta.url), "utf8");

test("crypto self-test is authenticated, MFA-gated, CSRF-scoped and audited", () => {
  for (const required of [
    "verifyAuroraAccess",
    "CSRF_PURPOSES.crypto",
    "MFA_REQUIRED",
    "crypto.verify",
    "CRYPTO_SELF_TEST_VERIFIED",
    "MIN_SELF_TEST_INTERVAL_MS",
    "clinicalSensitiveEnabled !== false",
    'maxInstances: 1'
  ]) assert.ok(runtime.includes(required), required);

  for (const forbidden of [
    "console.log(envelope",
    "logger.info(envelope",
    "logger.warn(envelope",
    "logger.error(envelope",
    "plaintext:",
    "dek:"
  ]) assert.ok(!runtime.includes(forbidden), forbidden);
});

test("HML crypto workflow requires explicit request and preserves non-production gates", () => {
  assert.match(workflow, /push:[\s\S]*branches: \[main\][\s\S]*aurora-crypto-hml\.json/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /environment: firebase-homologation/);
  assert.match(workflow, /google-github-actions\/auth@v2/);
  assert.match(workflow, /cloudkms\.googleapis\.com/);
  assert.match(workflow, /roles\/cloudkms\.cryptoKeyEncrypterDecrypter/);
  assert.match(workflow, /functions:auroraNexusCryptoSelfTest,hosting/);
  assert.match(workflow, /clinicalSensitiveEnabled==false/);
  assert.match(workflow, /productionMutation==false/);
  assert.doesNotMatch(workflow, /--only functions,hosting/);
});
