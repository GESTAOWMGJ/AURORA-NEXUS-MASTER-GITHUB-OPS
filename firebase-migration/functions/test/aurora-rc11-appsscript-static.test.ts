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
});


test("RC1.1 rotates HMAC keyring without mutating secret metadata", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /gcloud secrets describe "\$secret_name"/);
  assert.match(workflow, /gcloud secrets versions add "\$secret_name"/);
  assert.doesNotMatch(workflow, /functions:secrets:set WMGJ_INGEST_HMAC_KEYRING/);
  assert.doesNotMatch(workflow, /gcloud secrets update/);
  assert.doesNotMatch(workflow, /gcloud secrets create/);
});
