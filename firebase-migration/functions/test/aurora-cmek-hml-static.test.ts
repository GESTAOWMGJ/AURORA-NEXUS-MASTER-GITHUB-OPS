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

for (const exitCode of [0, 23]) {
  test(`workflow runs a non-executable script and retains exit ${exitCode}`, { skip: process.platform === "win32" }, () => {
    const dir = mkdtempSync(join(tmpdir(), "aurora-cmek-entrypoint-"));
    try {
      const block = workflow.match(/- name: Execute selected HML mode\r?\n\s+run: \|\r?\n([\s\S]*?)(?=\r?\n      - name:)/)?.[1];
      assert.ok(block, "workflow execution block must exist");
      const scriptPath = join(dir, "guarded script.sh");
      writeFileSync(scriptPath, `#!/bin/bash\nprintf 'mode=%s\\n' "$1"\nexit ${exitCode}\n`, { mode: 0o644 });
      const result = spawnSync("bash", ["-c", block.replace(/^          /gm, "")], {
        env: { ...process.env, SCRIPT: scriptPath, MODE: "restore-test", RUNNER_TEMP: dir,
          GITHUB_SHA: "synthetic-source", GITHUB_RUN_ID: "synthetic-run" }, encoding: "utf8"
      });
      assert.equal(result.status, exitCode, result.stderr);
      const evidence = join(dir, "aurora-cmek-hml-evidence");
      assert.equal(readFileSync(join(evidence, "result.txt"), "utf8"), "mode=restore-test\n");
      const metadata = JSON.parse(readFileSync(join(evidence, "metadata.json"), "utf8"));
      assert.equal(metadata.exitCode, exitCode);
      assert.equal(metadata.sha, "synthetic-source");
      assert.equal(metadata.productionMutation, false);
      assert.equal(metadata.realDataAllowed, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("initial synthetic write can precede active-version proof but missing proof blocks completion", () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-cmek-first-write-"));
  try {
    const database = { locationId: policy.location, type: "FIRESTORE_NATIVE",
      deleteProtectionState: "DELETE_PROTECTION_ENABLED", pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_ENABLED",
      cmekConfig: { kmsKeyName: `projects/${policy.projectId}/locations/${policy.location}/keyRings/${policy.keyRing}/cryptoKeys/${policy.cryptoKey}` } };
    writeFileSync(join(dir, "db.json"), JSON.stringify(database));
    writeFileSync(join(dir, "gcloud"), `#!/bin/bash
case "$*" in
  "auth list"*) echo test-account ;;
  "projects describe"*) echo 299889357292 ;;
  "firestore databases describe"*) cat "$AURORA_TEST_DB" ;;
  "firestore backups schedules list"*) echo '[]' ;;
  "firestore backups schedules create"*) echo schedule >> "$AURORA_TEST_CALLS" ;;
  "auth print-access-token"*) echo synthetic-token ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(dir, "curl"), '#!/bin/bash\necho sentinel >> "$AURORA_TEST_CALLS"\n', { mode: 0o755 });
    const result = spawnSync("bash", [new URL("../../scripts/aurora-cmek-hml.sh", import.meta.url).pathname, "apply"], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, AURORA_TEST_DB: join(dir, "db.json"),
        AURORA_TEST_CALLS: join(dir, "calls"), AURORA_CMEK_CONFIRMATION: "APPLY_AURORA_CMEK_HML",
        AURORA_FIRESTORE_CMEK_ACCESS_CONFIRMED: "YES" }, encoding: "utf8"
    });
    assert.equal(result.status, 13, result.stderr);
    assert.equal(readFileSync(join(dir, "calls"), "utf8"), "schedule\nsentinel\n");
    assert.match(result.stderr, /ACTIVE_KEY_VERSION_PENDING_AFTER_SYNTHETIC_WRITE/);
    assert.doesNotMatch(result.stdout, /AURORA_CMEK_HML_APPLIED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
  assert.equal(policy.status, "IMPLEMENTED_PENDING_RECOVERY_VERIFICATION");
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
    "kms keys versions disable",
    "kms keys versions enable",
    "trap cleanup_key_test",
    "AURORA_FIRESTORE_CMEK_RUNTIME_VERIFIED_CREATE",
    "AURORA_CMEK_KEY_FAILURE_PENDING_PROPAGATION",
    "AURORA_CMEK_HML_RESTORE_VERIFIED"
  ]) assert.ok(script.includes(required), required);

  for (const forbidden of [
    "firestore databases delete",
    "kms keys versions destroy",
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

test("key test blocks before cloud calls without a restore database", () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-key-gate-"));
  try {
    writeFileSync(join(dir, "gcloud"), '#!/bin/sh\necho UNEXPECTED_CLOUD_CALL >&2\nexit 99\n', {mode:0o755});
    const env = {...process.env, PATH:`${dir}:${process.env.PATH}`, AURORA_CMEK_CONFIRMATION:"TEST_AURORA_CMEK_KEY_FAILURE_HML"};
    delete env.AURORA_CMEK_RESTORE_DATABASE;
    const r=spawnSync("bash",[new URL("../../scripts/aurora-cmek-hml.sh",import.meta.url).pathname,"key-failure-test"],{env,encoding:"utf8"});
    assert.equal(r.status,22); assert.match(r.stderr,/RESTORE_DATABASE_REQUIRED/); assert.doesNotMatch(r.stderr,/UNEXPECTED_CLOUD_CALL/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

for(const errorKind of ["cmek","auth","network","malformed","no-propagation","reenable-failure","wrong-backup","wrong-uid"]) {
  test(`cloud simulation: ${errorKind} cannot produce false recovery evidence`,()=>{
    const dir=mkdtempSync(join(tmpdir(),"aurora-key-proof-"));
    try {
      const key=`projects/${policy.projectId}/locations/${policy.location}/keyRings/${policy.keyRing}/cryptoKeys/${policy.cryptoKey}`;
      const source=`projects/${policy.projectId}/databases/${policy.databaseId}`;
      const backup=`projects/${policy.projectId}/locations/${policy.location}/backups/test`;
      const db={name:source,uid:"synthetic-database-uid",locationId:policy.location,type:"FIRESTORE_NATIVE",deleteProtectionState:"DELETE_PROTECTION_ENABLED",pointInTimeRecoveryEnablement:"POINT_IN_TIME_RECOVERY_ENABLED",cmekConfig:{kmsKeyName:key,activeKeyVersion:[`${key}/cryptoKeyVersions/1`]},sourceInfo:{progress:"COMPLETED",backup:{backup}}};
      writeFileSync(join(dir,"db.json"),JSON.stringify(db));
      writeFileSync(join(dir,"backups.json"),JSON.stringify([{name:backup,database:errorKind==="wrong-backup"?`projects/${policy.projectId}/databases/(default)`:source,databaseUid:errorKind==="wrong-uid"?"different-database-uid":"synthetic-database-uid",state:"READY",snapshotTime:"2026-10-14T16:00:00Z"}]));
      writeFileSync(join(dir,"doc.json"),JSON.stringify({fields:{kind:{stringValue:"AURORA_CMEK_HML_SENTINEL"},synthetic:{booleanValue:true},clinicalSensitive:{booleanValue:false},productionMutation:{booleanValue:false}}}));
      writeFileSync(join(dir,"gcloud"),`#!/bin/bash
case "$*" in
 "firestore databases describe"*) cat "$AURORA_TEST_DIR/db.json" ;;
 "firestore backups list"*) cat "$AURORA_TEST_DIR/backups.json" ;;
 "firestore databases list"*) echo "[$(cat "$AURORA_TEST_DIR/db.json")]" ;;
 "auth print-access-token"*) echo test-token ;;
 "kms keys versions describe"*) echo ENABLED ;;
 "kms keys versions disable"*) echo disable >> "$AURORA_TEST_DIR/calls"; touch "$AURORA_TEST_DIR/disabled" ;;
 "kms keys versions enable"*) echo enable >> "$AURORA_TEST_DIR/calls"; if [ "$AURORA_TEST_ERROR" = reenable-failure ]; then exit 77; fi; rm -f "$AURORA_TEST_DIR/disabled" ;;
 *) exit 99 ;;
esac
`,{mode:0o755});
      writeFileSync(join(dir,"curl"),`#!/bin/bash
out=""
while [ "$#" -gt 0 ]; do
 if [ "$1" = -o ]; then out="$2"; shift; fi
 shift
done
if [ -z "$out" ]; then cat "$AURORA_TEST_DIR/doc.json"; exit; fi
if [ -f "$AURORA_TEST_DIR/disabled" ]; then
 if [ "$AURORA_TEST_ERROR" = network ]; then printf 000; exit 7
 elif [ "$AURORA_TEST_ERROR" = malformed ]; then echo not-json > "$out"; printf 400
 elif [ "$AURORA_TEST_ERROR" = no-propagation ]; then cat "$AURORA_TEST_DIR/doc.json" > "$out"; printf 200
 elif [ "$AURORA_TEST_ERROR" = auth ]; then echo '{"error":{"status":"UNAUTHENTICATED"}}' > "$out"; printf 401
 else echo '{"error":{"status":"FAILED_PRECONDITION","message":"The customer-managed encryption key required by the requested resource is not accessible"}}' > "$out"; printf 400; fi
else cat "$AURORA_TEST_DIR/doc.json" > "$out"; printf 200; fi
`,{mode:0o755});
      const r=spawnSync("bash",[new URL("../../scripts/aurora-cmek-hml.sh",import.meta.url).pathname,"key-failure-test"],{env:{...process.env,PATH:`${dir}:${process.env.PATH}`,AURORA_TEST_DIR:dir,AURORA_TEST_ERROR:errorKind,AURORA_CMEK_RESTORE_DATABASE:`${policy.restoreDatabasePrefix}123`,AURORA_CMEK_CONFIRMATION:"TEST_AURORA_CMEK_KEY_FAILURE_HML",AURORA_CMEK_FAILURE_POLLS:"1",AURORA_CMEK_FAILURE_POLL_SECONDS:"0",AURORA_CMEK_RECOVERY_POLLS:"1",AURORA_CMEK_RECOVERY_POLL_SECONDS:"0"},encoding:"utf8"});
      if(errorKind==="wrong-backup" || errorKind==="wrong-uid") { assert.equal(r.status,24,r.stderr); assert.throws(()=>readFileSync(join(dir,"calls"))); }
      else { assert.match(readFileSync(join(dir,"calls"),"utf8"),/disable\nenable\n/); assert.equal(r.status,errorKind==="cmek"?0:errorKind==="no-propagation"?33:errorKind==="reenable-failure"?77:35,r.stderr); }
      if(errorKind==="cmek") assert.match(r.stdout,/KEY_FAILURE_AND_RECOVERY_VERIFIED/);
      else assert.doesNotMatch(r.stdout,/KEY_FAILURE_AND_RECOVERY_VERIFIED/);
      if(errorKind==="reenable-failure") assert.match(r.stderr,/CMEK_REENABLE_FAILED/);
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
}

// The business authorization is separate from operational/clinical gates.
test("production owner authorization preserves HML and clinical isolation", () => {
  const approval = JSON.parse(readFileSync(new URL("../../policy/cmek-production-owner-authorization-20261015.json", import.meta.url), "utf8"));
  assert.equal(approval.authorizationState, "OWNER_AUTHORIZED");
  assert.equal(approval.projectId, "wmgj-prod-jfn-20261005");
  assert.equal(approval.defaultDatabaseMutationAllowed, false);
  assert.equal(approval.clinicalSensitiveEnabled, false);
  assert.equal(approval.productionKeyDisableAllowed, false);
  assert.equal(approval.independentReviewClaimed, false);
  assert.equal(policy.productionMutation, false);
});

test("recovery binds backup UID, waits completion and preserves evidence", () => {
  assert.match(script, /\.databaseUid==\$uid/);
  assert.match(script, /CMEK_RESTORE_PENDING_COMPLETION/);
  assert.match(script, /keyTestEvidencePreserved/);
  assert.doesNotMatch(script, /rm -rf "\$key_test_dir"/);
});

test("KMS version commands use the installed supported CLI group", () => {
  assert.match(script, /gcloud kms keys versions disable/);
  assert.match(script, /gcloud kms keys versions enable/);
  assert.doesNotMatch(script, /gcloud kms versions/);
  assert.match(script, /CMEK_UNEXPECTED_READ_RESPONSE_NOT_KEY_EVIDENCE/);
});

for (const scenario of ["transient", "persistent", "iam", "other-precondition"]) {
  test(`restore protection readiness handles ${scenario} without masking failures`, { skip: process.platform === "win32" }, () => {
    const dir = mkdtempSync(join(tmpdir(), "aurora-cmek-readiness-"));
    try {
      const functionBody = script.slice(script.indexOf("protect_restored_database() {"), script.indexOf("restore_test() {"));
      assert.ok(functionBody.startsWith("protect_restored_database() {"));
      writeFileSync(join(dir, "probe.sh"), `#!/bin/bash\nset -euo pipefail\n${functionBody}\nprotect_restored_database\n`);
      writeFileSync(join(dir, "gcloud"), [
        '#!/bin/bash',
        'case "$*" in',
        ' "firestore databases update"*)',
        '  echo update >> "$AURORA_TEST_DIR/calls"',
        '  if [ "$AURORA_TEST_CASE" = iam ]; then echo "PERMISSION_DENIED" >&2; exit 7; fi',
        '  if [ "$AURORA_TEST_CASE" = other-precondition ]; then echo "FAILED_PRECONDITION: unrelated database policy" >&2; exit 7; fi',
        '  if [ "$AURORA_TEST_CASE" = persistent ] || [ ! -f "$AURORA_TEST_DIR/attempted" ]; then',
        '   touch "$AURORA_TEST_DIR/attempted"',
        '   echo "FAILED_PRECONDITION: Cannot serve because the database is in the middle of restore." >&2; exit 9',
        '  fi',
        '  echo accepted ;;',
        ' "firestore databases describe"*)',
        '  echo describe >> "$AURORA_TEST_DIR/calls"',
        '  if [ ! -f "$AURORA_TEST_DIR/described" ]; then',
        '   touch "$AURORA_TEST_DIR/described"',
        '   echo \'{"deleteProtectionState":"DELETE_PROTECTION_ENABLED","pointInTimeRecoveryEnablement":"POINT_IN_TIME_RECOVERY_DISABLED"}\'',
        '  else',
        '   echo \'{"deleteProtectionState":"DELETE_PROTECTION_ENABLED","pointInTimeRecoveryEnablement":"POINT_IN_TIME_RECOVERY_ENABLED"}\'',
        '  fi ;;',
        ' *) echo UNEXPECTED_CLOUD_CALL >&2; exit 99 ;;',
        'esac', ''
      ].join("\n"), { mode: 0o755 });
      writeFileSync(join(dir, "sleep"), '#!/bin/bash\necho wait >> "$AURORA_TEST_DIR/calls"\n', { mode: 0o755 });
      const result = spawnSync("bash", [join(dir, "probe.sh")], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PROJECT_ID: "synthetic-project", RESTORE_DB: "aurora-hml-restore-synthetic",
          AURORA_TEST_CASE: scenario, AURORA_TEST_DIR: dir }, encoding: "utf8", timeout: 10000
      });
      const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
      if (scenario === "transient") {
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(calls, ["update", "wait", "update", "describe", "wait", "describe"]);
      } else if (scenario === "persistent") {
        assert.equal(result.status, 27, result.stderr);
        assert.equal(calls.filter(x => x === "update").length, 12);
        assert.equal(calls.filter(x => x === "wait").length, 11);
        assert.ok(!calls.includes("describe"));
        assert.match(result.stderr, /CMEK_RESTORE_PROTECTIONS_PENDING/);
      } else {
        assert.equal(result.status, 7, result.stderr);
        assert.deepEqual(calls, ["update"]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
