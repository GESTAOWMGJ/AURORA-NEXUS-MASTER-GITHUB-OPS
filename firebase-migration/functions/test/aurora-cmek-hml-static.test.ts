import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(new URL("../../../.github/workflows/aurora-cmek-hml.yml", import.meta.url), "utf8");
const script = readFileSync(new URL("../../scripts/aurora-cmek-hml.sh", import.meta.url), "utf8");
const policy = JSON.parse(readFileSync(new URL("../../policy/cmek-hml-baseline-v1.json", import.meta.url), "utf8"));

test("key creation supplies a future RFC3339 first rotation with the period", () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-cmek-rotation-"));
  try {
    writeFileSync(join(dir, "gcloud"), `#!/bin/bash
case "$*" in
  "auth list"*) echo test-account ;;
  "projects describe"*) echo 299889357292 ;;
  "kms keys describe"*) exit 1 ;;
  "kms keys create"*) printf '%s\\n' "$@" > "$AURORA_TEST_ARGS"; exit 77 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
    const argsPath = join(dir, "args");
    const before = Date.now();
    const result = spawnSync("bash", [new URL("../../scripts/aurora-cmek-hml.sh", import.meta.url).pathname, "apply"], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, AURORA_TEST_ARGS: argsPath,
        AURORA_CMEK_CONFIRMATION: "APPLY_AURORA_CMEK_HML", AURORA_FIRESTORE_CMEK_ACCESS_CONFIRMED: "YES" },
      encoding: "utf8"
    });
    assert.equal(result.status, 77, result.stderr);
    const args = readFileSync(argsPath, "utf8").split("\n");
    assert.ok(args.includes("--rotation-period=90d"));
    const time = args.find(arg => arg.startsWith("--next-rotation-time="))?.split("=")[1];
    assert.match(time || "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const expected = before + 90 * 86400000;
    assert.ok(Math.abs(Date.parse(time!) - expected) < 5000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CMEK HML workflow is manual or one-shot request only and protected", () => {
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
  assert.equal(policy.firestoreCmekFeatureAccessState, "EXTERNALLY_CONFIRMED");
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


test("external access does not promote runtime evidence or authorize apply", () => {
  assert.equal(policy.firestoreCmekOperationalState, "PENDING_HML_VERIFICATION");
  assert.equal(policy.firestoreCmekFeatureAccessEvidence.messageId, "1a0fd2f51798e6ef");
  assert.equal(policy.firestoreCmekFeatureAccessEvidence.projectId, policy.projectId);
  assert.match(workflow, /cmek_access_confirmed:[\s\S]*default: false/);
  assert.match(workflow, /apply\)[\s\S]*test "\$access_confirmed" = "true"/);
  const apply = script.slice(script.indexOf("apply() {"), script.indexOf("restore_test() {"));
  assert.ok(apply.indexOf("BLOCKED_CMEK_ACCESS_CONFIRMATION") < apply.indexOf("gcloud services enable"));
});


test("apply without access confirmation makes no cloud call", () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-cmek-gate-"));
  try {
    writeFileSync(join(dir, "gcloud"), "#!/bin/sh\necho UNEXPECTED_CLOUD_CALL >&2\nexit 99\n", { mode: 0o755 });
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, AURORA_CMEK_CONFIRMATION: "APPLY_AURORA_CMEK_HML" };
    delete env.AURORA_FIRESTORE_CMEK_ACCESS_CONFIRMED;
    const result = spawnSync("bash", [new URL("../../scripts/aurora-cmek-hml.sh", import.meta.url).pathname, "apply"], { env, encoding: "utf8" });
    assert.equal(result.status, 12);
    assert.match(result.stderr, /BLOCKED_CMEK_ACCESS_CONFIRMATION/);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_CLOUD_CALL/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
