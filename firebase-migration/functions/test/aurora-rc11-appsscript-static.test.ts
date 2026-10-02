import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../../src/34_AURORA_RC11_FIRESTORE_CONTROL.gs", import.meta.url), "utf8");

test("RC1.1 is one-shot and restores dry-run", () => {
  assert.match(source, /AURORA_RC11_SAMPLE_COMPETENCE = '2026-05'/);
  assert.match(source, /AURORA_RC11_CONFIRMATION = 'ATIVAR_RC11_WMGJ_HML'/);
  assert.match(source, /finally \{[\s\S]*WMGJ_FIRESTORE_DRY_RUN', 'true'/);
  assert.match(source, /sourceMutation: false/);
});

test("RC1.1 uses reconciled invoice and bank entities", () => {
  assert.match(source, /=== '8'/);
  assert.match(source, /cents !== 4950000/);
  assert.match(source, /entityType: 'invoice'/);
  assert.match(source, /entityType: 'bankTransaction'/);
  assert.match(source, /status: 'RECONCILED'/);
});


test("RC1.1 workflow uses supported synchronous Firestore restore", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /gcloud firestore databases restore/);
  assert.doesNotMatch(workflow, /databases restore[^\n]*--async/);
  assert.match(workflow, /restore-result\.json/);
  assert.match(workflow, /gcloud firestore operations describe "\$op"/);
  assert.match(workflow, /SUCCESSFUL/);
  assert.match(workflow, /sourceInfo\.backup\.backup/);
  assert.match(workflow, /Cleanup temporary restore database/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /gcloud firestore databases describe --database="\$restore_db"/);
});


test("RC1.1 restore database is unique per workflow attempt", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /restoreDatabasePrefix/);
  assert.match(workflow, /GITHUB_RUN_ID/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /UNEXPECTED_TEMP_DATABASE_COLLISION/);
  assert.doesNotMatch(workflow, /restoreDatabase=="rc11-restore-/);
});


test("RC1.1 cleanup tolerates Firestore post-restore finalization", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /in the middle of restore/);
  assert.match(workflow, /cleanup_ready=false/);
  assert.match(workflow, /delete_done=false/);
  assert.match(workflow, /gcloud firestore databases update/);
  assert.match(workflow, /gcloud firestore databases delete/);
  assert.match(workflow, /grep -qi "in the middle of restore" <<<"\$delete_out"/);
  assert.doesNotMatch(workflow, /in the middle of restore\|FAILED_PRECONDITION/);
  assert.match(workflow, /grep -qi "FAILED_PRECONDITION" <<<"\$delete_out"[\s\S]*exit "\$delete_rc"/);
});


test("RC1.1 reuses provisioned HMAC and never mutates Secret Manager", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /Build and validate existing HMAC contract/);
  assert.match(workflow, /gcloud secrets describe "\$secret_name"/);
  assert.doesNotMatch(workflow, /gcloud secrets versions add/);
  assert.doesNotMatch(workflow, /functions:secrets:set WMGJ_INGEST_HMAC_KEYRING/);
  assert.doesNotMatch(workflow, /gcloud secrets update/);
  assert.doesNotMatch(workflow, /gcloud secrets create/);
  assert.match(workflow, /auroraRc11ConfigurarEndpointExistente/);
  assert.match(workflow, /auroraRc11ValidarHmacExistente/);
});

test("RC1.1 HMAC probe is authenticated, dry-run and non-mutating", () => {
  assert.match(source, /function auroraRc11ValidarHmacExistente\(\)/);
  assert.match(source, /RC11_DRY_RUN_OBRIGATORIO/);
  assert.match(source, /code === 400 && parsed && parsed\.code === 'VALIDATION_ERROR'/);
  assert.match(source, /authenticated: true/);
  assert.match(source, /noWrite: true/);
  assert.match(source, /code === 401.*RC11_HMAC_INVALIDO/s);
  assert.match(source, /code === 503.*RC11_KEYRING_INVALIDO/s);

  const backend = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const authIndex = backend.indexOf("const verification = verifyHmacV2");
  const validationIndex = backend.indexOf("const validation = validateEvent");
  const txIndex = backend.indexOf("db.runTransaction");
  assert.ok(authIndex >= 0 && validationIndex > authIndex && txIndex > validationIndex);
});

test("RC1.1 request explicitly selects existing-HMAC probe mode", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const request = JSON.parse(readFileSync(new URL("../../../.github/requests/aurora-rc11-run.json", import.meta.url), "utf8"));
  assert.equal(request.requestVersion, 4);
  assert.equal(request.hmacMode, "REUSE_EXISTING_WITH_AUTH_PROBE");
  assert.match(workflow, /\.requestVersion==4/);
  assert.match(workflow, /\.hmacMode=="REUSE_EXISTING_WITH_AUTH_PROBE"/);
});


test("RC1.1 workflow cannot auto-run from implementation changes", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /paths:\s*\n\s*- "\.github\/requests\/aurora-rc11-run\.json"/);
  assert.doesNotMatch(workflow, /paths:[\s\S]*aurora-rc11-recovery-real-ingest\.yml/);
  assert.doesNotMatch(workflow, /paths:[\s\S]*firebase-migration\/functions\/\*\*/);
});


test("RC1.1 verifies existing Functions runtime without secret IAM mutation", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /Verify existing HML runtime and deploy non-secret surfaces/);
  assert.match(workflow, /firebase-tools@14\.17\.0 functions:list/);
  assert.match(workflow, /gcloud functions describe runtimeHealth/);
  assert.match(workflow, /signatureVersion=="v2"/);
  assert.match(workflow, /--only hosting,firestore:rules,firestore:indexes/);
  assert.doesNotMatch(workflow, /--only functions:ingestWmgjEvent/);
  assert.doesNotMatch(workflow, /secretmanager\.secrets\.setIamPolicy/);
  assert.match(workflow, /functionsRedeployed:false/);
});
