import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../../.github/workflows/aurora-cmek-hml.yml", import.meta.url), "utf8");
const script = readFileSync(new URL("../../scripts/aurora-cmek-hml.sh", import.meta.url), "utf8");
const policy = JSON.parse(readFileSync(new URL("../../policy/cmek-hml-baseline-v1.json", import.meta.url), "utf8"));

test("CMEK HML workflow is main-only, protected and request-scoped", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /feat\/aurora-sec-002-cmek-lgpd-pack-20261001/);
  assert.match(workflow, /\.github\/requests\/aurora-cmek-hml\.json/);
  assert.doesNotMatch(workflow, /\npull_request:/);
  assert.match(workflow, /environment: firebase-homologation/);
  assert.match(workflow, /google-github-actions\/auth@c200f3691d83b41bf9bbd8638997a462592937ed/);
  assert.match(workflow, /GCP_WIF_PROVIDER/);
  assert.match(workflow, /GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT/);
  assert.match(workflow, /APPLY_AURORA_CMEK_HML/);
  assert.match(workflow, /RESTORE_AURORA_CMEK_HML/);
  assert.match(workflow, /TEST_AURORA_CMEK_KEY_FAILURE_HML/);
  assert.match(workflow, /productionMutation==false/);
  assert.match(workflow, /clinicalSensitiveEnabled==false/);
  assert.match(workflow, /realDataAllowed==false/);
});

test("CMEK HML policy forbids production, clinical data and destruction", () => {
  assert.equal(policy.status, "PREPARED_NOT_APPLIED");
  assert.equal(policy.productionMutation, false);
  assert.equal(policy.clinicalSensitiveEnabled, false);
  assert.equal(policy.realDataAllowed, false);
  assert.equal(policy.destructiveOperationsAllowed, false);
  assert.equal(policy.keyDestructionAllowed, false);
  assert.equal(policy.firestoreCmekFeatureAccessRequired, true);
  assert.equal(policy.firestoreCmekFeatureAccessState, "REQUIRES_PROVIDER_ACCESS_REQUEST_AND_RUNTIME_VERIFICATION");
  assert.equal(policy.projectId, "wmgj-hml-jfn-20260927");
  assert.equal(policy.databaseId, "aurora-hml-cmek");
  assert.equal(policy.location, "southamerica-east1");
  assert.equal(policy.deleteProtection, true);
  assert.equal(policy.pitr, true);
});

test("CMEK HML script prepares guarded database, backup, restore and reversible key failure", () => {
  for (const required of [
    "--kms-key-name",
    "--delete-protection",
    "--enable-pitr",
    "backups schedules create",
    "--recurrence=daily",
    "--retention=14d",
    "databases restore",
    "--destination-database",
    "kms versions disable",
    "kms versions enable",
    "trap reenable",
    "AURORA_FIRESTORE_CMEK_RUNTIME_VERIFIED_CREATE",
    "AURORA_CMEK_KEY_FAILURE_PENDING_PROPAGATION",
    "AURORA_CMEK_HML_RESTORE_VERIFIED"
  ]) assert.ok(script.includes(required), required);

  for (const forbidden of [
    "firestore databases delete",
    "kms versions destroy",
    "kms keys delete",
    "projects delete",
    "billing projects unlink"
  ]) assert.ok(!script.includes(forbidden), forbidden);
});
