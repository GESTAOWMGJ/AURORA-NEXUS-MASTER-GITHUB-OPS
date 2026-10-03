import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(new URL("../../../src/34_AURORA_RC11_FIRESTORE_CONTROL.gs", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../../../src/35_AURORA_FIRESTORE_BRIDGE_WMGJ.gs", import.meta.url), "utf8");
const connectorSource = readFileSync(new URL("../../../src/37_AURORA_CONECTORES_PLUG_AND_PLAY.gs", import.meta.url), "utf8");
const appsscriptManifest = JSON.parse(readFileSync(new URL("../../../appsscript.json", import.meta.url), "utf8"));

test("RC1.1 uses one private bounded pair without changing global dry-run", () => {
  assert.match(source, /AURORA_RC11_SAMPLE_COMPETENCE = '2026-05'/);
  assert.match(source, /AURORA_RC11_CONFIRMATION = 'ATIVAR_RC11_WMGJ_HML'/);
  assert.doesNotMatch(source, /auroraRc11AtivarEscritaAmostra/);
  assert.doesNotMatch(source, /auroraRc11KillSwitch/);
  assert.doesNotMatch(source, /WMGJ_FIRESTORE_DRY_RUN['"],\s*['"]false/);
  assert.match(source, /LockService\.getScriptLock\(\)/);
  assert.match(source, /wmgjFirestoreEnviarParRc11_\(\s*pair\.invoice,\s*pair\.bank,\s*oneShotCfg,\s*WMGJ_FIRESTORE_RC11_EPHEMERAL_CAPABILITY_\s*\)/);
  assert.match(source, /RC11_GLOBAL_DRY_RUN_ALTERADO/);
  assert.match(source, /RC11_MULTIPLAS_LINHAS_ENCONTRADAS/);
  assert.match(bridgeSource, /RC11_CAPACIDADE_EFEMERA_INVALIDA/);
  assert.match(bridgeSource, /CAPACIDADE_TRANSPORTE_INVALIDA/);
  assert.match(bridgeSource, /cfg = wmgjFirestoreConfig_\(\);/);
  assert.match(bridgeSource, /wmgjFirestoreValidarEventoTransportavel_\(invoice\);\s*wmgjFirestoreValidarEventoTransportavel_\(bank\);/);
  assert.match(source, /sourceMutation: false/);
  assert.doesNotMatch(bridgeSource, /wmgjFirestoreEnviarEventoComConfig_/);
  assert.match(source, /receiptState/);
  assert.match(source, /IN_PROGRESS/);
  assert.match(source, /CONSUMED/);
  assert.match(source, /FAILED_REQUIRES_NEW_REQUEST/);
  assert.match(source, /atomic: false/);
});

test("configuração compartilhada serializa qualquer alteração do dry-run", () => {
  assert.match(connectorSource, /var configLock = LockService\.getScriptLock\(\);/);
  assert.match(connectorSource, /configLock\.tryLock\(30000\)/);
  assert.match(connectorSource, /safeValues\.WMGJ_FIRESTORE_DRY_RUN = 'true'/);
  assert.match(connectorSource, /safeValues\.AURORA_FIRESTORE_MIRROR_REQUIRED = 'false'/);
  const safeWrite = connectorSource.indexOf("props.setProperties(safeValues, false)");
  const triggerInstall = connectorSource.indexOf("trigger = instalarGatilhoAutomacaoWMGJ({ preservarPrincipalExistente: true })");
  const liveWrite = connectorSource.indexOf("props.setProperties(values, false)");
  assert.ok(safeWrite >= 0 && triggerInstall > safeWrite && liveWrite > triggerInstall);
  assert.match(connectorSource, /finally \{\s*configLock\.releaseLock\(\);/);
  assert.doesNotMatch(connectorSource, /setProperty\(['"]WMGJ_FIRESTORE_DRY_RUN/);
});

test("RC1.1 uses reconciled invoice and bank entities", () => {
  assert.match(source, /=== '8'/);
  assert.match(source, /AURORA_RC11_AMOUNT_CENTS = 4950000/);
  assert.match(source, /cents !== AURORA_RC11_AMOUNT_CENTS/);
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


test("RC1.1 only consumes an existing canonical HML keyring", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /Build and validate existing HMAC contract/);
  assert.match(workflow, /gcloud secrets describe "\$secret_name"/);
  assert.match(workflow, /gcloud secrets versions access latest/);
  assert.match(workflow, /auroraRc11InspecionarConfiguracao/);
  assert.doesNotMatch(workflow, /auroraRc11ConfigurarEndpointExistente/);
  assert.doesNotMatch(workflow, /auroraRc11ConfigurarIngestao/);
  assert.match(workflow, /secretManagerMutationApproved==false/);
  assert.match(workflow, /\^\[A-Fa-f0-9\]\{64\}\$/);
  assert.doesNotMatch(workflow, /openssl rand/);
  assert.doesNotMatch(workflow, /gcloud secrets versions (?:add|destroy|disable|enable)/);
  assert.doesNotMatch(workflow, /--only functions:ingestWmgjEvent/);
  assert.doesNotMatch(workflow, /functions:secrets:set WMGJ_INGEST_HMAC_KEYRING/);
  assert.doesNotMatch(workflow, /gcloud secrets update/);
  assert.doesNotMatch(workflow, /gcloud secrets create/);
  assert.doesNotMatch(workflow, /add-iam-policy-binding/);
  assert.match(workflow, /auroraRc11ValidarHmacExistente/);
});

test("RC1.1 HMAC probe is authenticated, dry-run and non-mutating", () => {
  assert.match(source, /function auroraRc11IngestUrlValida_/);
  assert.match(source, /ingestwmgjevent-.*\\\.run\\\.app/);
  assert.doesNotMatch(source, /cloudfunctions\\\.net/);
  assert.match(source, /function auroraRc11InspecionarConfiguracao\(expectedUrl\)/);
  assert.match(source, /hmacConfigured:/);
  assert.match(source, /function auroraRc11ValidarHmacExistente\(sampleContract, expectedKeyId\)/);
  assert.match(source, /RC11_DRY_RUN_OBRIGATORIO/);
  assert.match(source, /code === 403 && parsed && parsed\.code === 'SIGNED_HEADER_BODY_MISMATCH'/);
  assert.match(source, /RC11_EVENTO_REJEITADO_PELA_POLITICA/);
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

test("RC1.1 preserves exact v6/v7 records and only accepts a fully guarded v8 request", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const requestText = readFileSync(new URL("../../../.github/requests/aurora-rc11-run.json", import.meta.url), "utf8");
  const request = JSON.parse(requestText);
  assert.ok([6, 7, 8].includes(request.requestVersion));
  if (request.requestVersion === 6) {
    assert.equal(
      createHash("sha256").update(requestText).digest("hex"),
      "96bc140e4c09114614c7a87ceaf28f6159899dac09d9552d0ee756f9e8d53f40",
    );
    assert.equal(request.approvedBaseSha, undefined);
    assert.equal(request.candidateOnly, undefined);
    assert.equal(request.genericBackfillApproved, undefined);
    assert.equal(request.hmacMode, "MIGRATE_LEGACY_OR_REUSE_CURRENT_KEYRING");
    assert.equal(request.secretManagerKeyringMigrationApproved, true);
    assert.equal(request.hmacBootstrapIfMissing, true);
  } else if (request.requestVersion === 7) {
    assert.equal(
      createHash("sha256").update(requestText).digest("hex"),
      "42b2a0628b8b8debd3a1becc462724b69fa5762208d64c8852fb2e1e26369c10",
    );
    assert.equal(request.approvedBaseSha, undefined);
    assert.equal(request.candidateOnly, undefined);
    assert.equal(request.genericBackfillApproved, undefined);
    assert.equal(request.hmacMode, "ROTATE_TO_CANONICAL_HML_KEYRING");
    assert.equal(request.secretManagerKeyringRotationApproved, true);
    assert.equal(request.hmacBootstrapIfMissing, true);
  } else {
    assert.equal(request.requestVersion, 8);
    assert.match(request.approvedBaseSha, /^[a-f0-9]{40}$/);
    assert.equal(request.candidateOnly, false);
    assert.equal(request.genericBackfillApproved, false);
    assert.equal(request.hmacMode, "REUSE_CURRENT_KEYRING_ONLY");
    assert.equal(request.secretManagerMutationApproved, false);
    assert.notEqual(request.secretManagerKeyringMigrationApproved, true);
    assert.notEqual(request.secretManagerKeyringRotationApproved, true);
    assert.equal(request.hmacBootstrapIfMissing, false);
    assert.equal(request.sample.pairContractVersion, 1);
    assert.equal(request.sample.pairEvidenceAttested, true);
    assert.match(request.sample.sourceParentSha256, /^[a-f0-9]{64}$/);
    assert.match(request.sample.invoice.contentHash, /^[a-f0-9]{64}$/);
    assert.match(request.sample.bank.contentHash, /^[a-f0-9]{64}$/);
    assert.match(request.sample.invoiceIdempotencySha256, /^[a-f0-9]{64}$/);
    assert.match(request.sample.bankIdempotencySha256, /^[a-f0-9]{64}$/);
    assert.match(request.sample.pairBindingSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(request.confirmation, "RUN_RC11_HML");
  assert.equal(request.projectId, "wmgj-hml-jfn-20260927");
  assert.equal(request.sourceDatabase, "(default)");
  assert.equal(request.competence, "2026-05");
  assert.equal(request.sample.invoiceNumber, "8");
  assert.equal(request.sample.expectedPairCount, 2);
  assert.equal(request.restoreDatabasePrefix, "rc11-restore");
  assert.equal(request.productionMutation, false);
  assert.equal(request.clinicalSensitiveEnabled, false);
  assert.equal(request.deploymentApproved, true);
  assert.equal(request.firebaseWriteApproved, true);
  assert.equal(request.sourceMutation, false);
  assert.match(workflow, /\.requestVersion==8/);
  assert.match(workflow, /\.candidateOnly==false/);
  assert.match(workflow, /\.hmacMode=="REUSE_CURRENT_KEYRING_ONLY"/);
  assert.match(workflow, /\.secretManagerMutationApproved==false/);
  assert.match(workflow, /\.deploymentApproved==true/);
  assert.match(workflow, /\.firebaseWriteApproved==true/);
  assert.match(workflow, /\.hmacBootstrapIfMissing==false/);
  assert.match(workflow, /\.sourceMutation==false/);
  assert.match(workflow, /\.genericBackfillApproved==false/);
  assert.match(workflow, /\.approvedBaseSha/);
  assert.match(workflow, /42b2a0628b8b8debd3a1becc462724b69fa5762208d64c8852fb2e1e26369c10/);
  assert.match(workflow, /\.sample\.pairEvidenceAttested==true/);
  assert.match(workflow, /\.sample\.pairBindingSha256/);
  assert.match(workflow, /\.sample\.invoiceIdempotencySha256/);
  assert.match(workflow, /\.sample\.bankIdempotencySha256/);
});


test("RC1.1 request is a push-only one-time approval bound to the exact head commit", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /paths:\s*\n\s*- "\.github\/requests\/aurora-rc11-run\.json"/);
  assert.match(workflow, /fetch-depth: 2/);
  assert.match(workflow, /test "\$GITHUB_EVENT_NAME" = "push"/);
  assert.match(workflow, /test "\$GITHUB_RUN_ATTEMPT" = "1"/);
  assert.match(workflow, /git rev-parse "\$GITHUB_SHA\^1"/);
  assert.match(workflow, /git diff --name-only "\$first_parent" "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow, /git diff --name-only "\$first_parent" "\$GITHUB_SHA" --/);
  assert.match(workflow, /git show "\$first_parent:\$REQUEST_FILE"/);
  assert.match(workflow, /\.requestVersion'\)" = "7"/);
  assert.match(workflow, /git ls-tree "\$GITHUB_SHA" -- "\$REQUEST_FILE"/);
  assert.match(workflow, /test "\$request_mode" = "100644"/);
  assert.match(workflow, /git cat-file blob "\$request_object" > "\$request_snapshot"/);
  assert.match(workflow, /test "\$\(git hash-object "\$request_snapshot"\)" = "\$request_object"/);
  assert.match(workflow, /chmod 0400 "\$request_snapshot"/);
  assert.match(workflow, /AURORA_RC11_REQUEST_SNAPSHOT=%s/);
  assert.match(workflow, /AURORA_RC11_REQUEST_BLOB=%s/);
  assert.match(workflow, /AURORA_RC11_REQUEST_SHA256=%s/);
  assert.match(workflow, /jq -r '\.approvedBaseSha'/);
  assert.match(workflow, /= "\$first_parent"/);
  const setupIndex = workflow.indexOf("actions/setup-node", workflow.indexOf("Validate immutable RC1.1 request"));
  assert.ok(setupIndex > 0);
  assert.doesNotMatch(workflow.slice(setupIndex), /\$REQUEST_FILE/);
  const liveStepIndex = workflow.indexOf("Send one isolated sample pair with global dry-run preserved");
  const liveCallIndex = workflow.indexOf("auroraRc11EnviarAmostraReal", liveStepIndex);
  const liveGuard = workflow.slice(liveStepIndex, liveCallIndex);
  assert.ok(liveStepIndex > 0 && liveCallIndex > liveStepIndex);
  assert.match(liveGuard, /stat -c '%a' "\$AURORA_RC11_REQUEST_SNAPSHOT"/);
  assert.match(liveGuard, /git hash-object "\$AURORA_RC11_REQUEST_SNAPSHOT"/);
  assert.match(liveGuard, /sha256sum "\$AURORA_RC11_REQUEST_SNAPSHOT"/);
  assert.doesNotMatch(workflow, /paths:[\s\S]*aurora-rc11-recovery-real-ingest\.yml/);
  assert.doesNotMatch(workflow, /paths:[\s\S]*firebase-migration\/functions\/\*\*/);
});

test("RC1.1 workflow and request changes always run pre-merge validation", () => {
  const validation = readFileSync(new URL("../../../.github/workflows/validate-firestore-migration.yml", import.meta.url), "utf8");
  const lines = validation.split("\n");
  for (const event of ["pull_request", "push"]) {
    const start = lines.findIndex((line) => line === `  ${event}:`);
    assert.ok(start >= 0);
    const relativeEnd = lines.slice(start + 1).findIndex((line) => /^  [a-z_]+:\s*$/.test(line));
    const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
    const block = lines.slice(start, end).join("\n");
    assert.match(block, /\.github\/requests\/aurora-rc11-run\.json/);
    assert.match(block, /\.github\/workflows\/aurora-rc11-recovery-real-ingest\.yml/);
  }
});

test("RC1.1 never auto-cancels an active restore or one-shot write", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /group: aurora-hml-runtime-mutation\s+#[\s\S]*cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /auroraRc11AtivarEscritaAmostra/);
  assert.doesNotMatch(workflow, /auroraRc11KillSwitch/);
  assert.equal((workflow.match(/auroraRc11EnviarAmostraReal/g) || []).length, 1);
});

test("RC1.1 execution API and live authorization are fail-closed", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.equal(appsscriptManifest.executionApi.access, "MYSELF");
  assert.match(workflow, /AURORA_RC11_AUTH_V1/);
  assert.match(workflow, /createHmac\('sha256'/);
  assert.match(workflow, /AURORA_RC11_AUTH_EXPIRES_AT/);
  assert.match(workflow, /AURORA_RC11_AUTH_HMAC/);
  assert.match(workflow, /receiptState=="CONSUMED"/);
  assert.match(workflow, /requestReceiptConsumed:true/);
  assert.match(workflow, /atomic:false/);
});

test("RC1.1 cannot authorize the generic backfill producer", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /\.genericBackfillApproved==false/);
  assert.match(workflow, /genericBackfill:false/);
  assert.doesNotMatch(workflow, /wmgjFirestoreMigrar(?:Aba|Fontes)/);
});

test("Firebase HML smoke requires core, ingest and crypto functions but permits valid extras", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/deploy-aurora-firebase.yml", import.meta.url), "utf8");
  assert.match(workflow, /--argjson required/);
  assert.match(workflow, /"ingestWmgjEvent"/);
  assert.match(workflow, /"auroraNexusCryptoSelfTest"/);
  assert.match(workflow, /all\(\$required\[\]; \$deployed \| index\(\.\) != null\)/);
  assert.doesNotMatch(workflow, /sort == \(\$expected \| sort\)/);
});


test("RC1.1 keeps runtime deployment separate and the keyring consumer-only", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const firebaseConfig = readFileSync(new URL("../../firebase.json", import.meta.url), "utf8");
  assert.match(workflow, /Verify existing HML runtime and deploy non-secret surfaces/);
  assert.match(workflow, /firebase-tools@14\.17\.0 functions:list/);
  assert.match(workflow, /\.hosting\.rewrites\[\]\?/);
  assert.match(workflow, /gcloud functions describe "\$function_id"/);
  assert.match(workflow, /INVALID_HOSTING_FUNCTION_URI/);
  assert.match(firebaseConfig, /"functionId": "auroraNexusIntegrationDocuments"/);
  assert.match(workflow, /gcloud functions describe runtimeHealth/);
  assert.match(workflow, /gcloud functions describe ingestWmgjEvent/);
  assert.match(workflow, /serviceConfig\.uri/);
  assert.match(workflow, /serviceConfig\.revision/);
  assert.match(workflow, /AURORA_RC11_INGEST_REVISION/);
  assert.match(workflow, /ingest_probe_status/);
  assert.match(workflow, /METHOD_NOT_ALLOWED/);
  assert.equal(workflow.includes("cloudfunctions.net/ingestWmgjEvent"), false);
  assert.match(workflow, /signatureVersion=="v2"/);
  assert.match(workflow, /--only hosting,firestore:rules,firestore:indexes/);
  assert.match(workflow, /secretManagerMutationApproved==false/);
  assert.doesNotMatch(workflow, /--only functions/);
  assert.doesNotMatch(workflow, /secretmanager\.secrets\.setIamPolicy/);
  assert.match(workflow, /functionsRedeployedInThisStep:false/);
  assert.match(workflow, /HML_KEYRING_BRIDGE_VERIFIED/);
  assert.match(workflow, /secretManagerMutation:false/);
  assert.match(workflow, /appsScriptConfigurationMutation:false/);
  assert.match(workflow, /ingestFunctionRedeployed:false/);
});


test("RC1.1 consumes canonical clasp deployment through a fail-closed nondev gate", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const deployWorkflow = readFileSync(new URL("../../../.github/workflows/deploy-appscript.yml", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../../../tools/run-clasp-checked.sh", import.meta.url), "utf8");
  const deployment = readFileSync(new URL("../../../tools/ensure-appscript-execution-deployment.sh", import.meta.url), "utf8");
  assert.match(workflow, /run-clasp-checked\.sh/);
  assert.doesNotMatch(workflow, /ensure-appscript-execution-deployment\.sh/);
  assert.doesNotMatch(workflow, /clasp push/);
  assert.match(workflow, /auroraRc11InspecionarConfiguracao/);
  assert.match(workflow, /consumes the already-reviewed canonical nondev deployment/);
  assert.match(workflow, /AURORA_EXECUTION_API_CANONICAL \$\{approved_base_sha\}/);
  assert.match(workflow, /AURORA_RC11_APPS_SCRIPT_DEPLOYMENT_ID/);
  assert.match(workflow, /AURORA_RC11_APPS_SCRIPT_VERSION/);
  assert.match(deployWorkflow, /ensure-appscript-execution-deployment\.sh/);
  assert.doesNotMatch(workflow, /clasp run auroraRc11/);
  assert.match(runner, /--nondev/);
  assert.match(runner, /clasp --json run-function/);
  assert.match(runner, /APPS_SCRIPT_EXECUTION_DEPLOYMENT_ID/);
  assert.match(runner, /\.scriptId=\$deployment/);
  assert.match(runner, /mktemp -d/);
  assert.match(deployWorkflow, /APPS_SCRIPT_EXECUTION_DEPLOYMENT_ID=%s/);
  assert.match(workflow, /APPS_SCRIPT_EXECUTION_DEPLOYMENT_ID=%s/);
  assert.match(runner, /type=="object" and has\("response"\)/);
  assert.match(runner, /response details were withheld/);
  assert.match(runner, /Unable to run script function/);
  assert.match(runner, /NOT_AUTHORIZED/);
  assert.match(runner, /exit 71/);
  assert.match(deployWorkflow, /Publish canonical Apps Script Execution API deployment/);
  assert.match(deployment, /AURORA_EXECUTION_API_CANONICAL/);
  assert.match(deployment, /clasp --json list-deployments/);
  assert.doesNotMatch(deployment, /clasp --json update-deployment/);
  assert.match(deployment, /clasp --json create-deployment/);
  assert.match(deployment, /\.description == \$description/);
  assert.match(deployment, /matching_count/);
  assert.match(deployment, /response details were withheld/);
});

test("HML runtime mutators are serialized and publish reviewable runtime identities", () => {
  const rcWorkflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const appsWorkflow = readFileSync(new URL("../../../.github/workflows/deploy-appscript.yml", import.meta.url), "utf8");
  const firebaseWorkflow = readFileSync(new URL("../../../.github/workflows/deploy-aurora-firebase.yml", import.meta.url), "utf8");
  const cryptoWorkflow = readFileSync(new URL("../../../.github/workflows/aurora-crypto-hml.yml", import.meta.url), "utf8");
  const cmekWorkflow = readFileSync(new URL("../../../.github/workflows/aurora-cmek-hml.yml", import.meta.url), "utf8");

  for (const mutator of [rcWorkflow, appsWorkflow, firebaseWorkflow, cryptoWorkflow, cmekWorkflow]) {
    assert.match(mutator, /group: aurora-hml-runtime-mutation/);
    assert.match(mutator, /cancel-in-progress: false/);
  }

  assert.doesNotMatch(appsWorkflow, /workflow_dispatch:/);
  assert.match(appsWorkflow, /environment: firebase-homologation/);
  assert.match(appsWorkflow, /test "\$GITHUB_EVENT_NAME" = "push"/);
  assert.match(appsWorkflow, /refs\/remotes\/origin\/main/);
  assert.match(appsWorkflow, /apps-script-deployment-\$\{\{ github\.sha \}\}/);

  assert.match(firebaseWorkflow, /functions:ingestWmgjEvent/);
  assert.match(firebaseWorkflow, /Capture immutable ingest runtime evidence/);
  assert.match(firebaseWorkflow, /ingestRevision:\$ingestRevision/);
  assert.doesNotMatch(firebaseWorkflow, /gcloud secrets versions access/);
  assert.match(firebaseWorkflow, /for secret in AURORA_NEXUS_ALLOWED_EMAILS AURORA_NEXUS_CSRF_HMAC_KEY/);

  assert.match(rcWorkflow, /expectedAppsScriptDeploymentId/);
  assert.match(rcWorkflow, /expectedAppsScriptDeploymentVersion/);
  assert.match(rcWorkflow, /expectedIngestRevision/);
  assert.match(rcWorkflow, /serviceConfig\.revision/);
});

test("RC1.1 proves deployed policy accepts both exact events before any transaction", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(source, /SIGNED_HEADER_BODY_MISMATCH/);
  assert.match(source, /policyAccepted: true/);
  assert.match(source, /eventsValidated: 2/);
  assert.match(source, /auroraRc11InvoiceEvent_/);
  assert.match(source, /auroraRc11BankEvent_/);
  assert.match(workflow, /\.response\.policyAccepted==true/);
  assert.match(workflow, /\.response\.eventsValidated==2/);
  const backend = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const validationIndex = backend.indexOf("const validation = validateEvent");
  const scopeIndex = backend.indexOf("keyAllowsEntityType(verification.principal.entityTypes");
  const mismatchIndex = backend.indexOf("SIGNED_HEADER_BODY_MISMATCH");
  const txIndex = backend.indexOf("db.runTransaction");
  assert.ok(validationIndex >= 0 && scopeIndex > validationIndex && mismatchIndex > scopeIndex && txIndex > mismatchIndex);
  const keyringScopeIndex = workflow.indexOf("hmac-keyring-scope-check.json");
  const policyProbeIndex = workflow.indexOf("auroraRc11ValidarHmacExistente");
  const sampleIndex = workflow.indexOf("auroraRc11EnviarAmostraReal");
  assert.ok(keyringScopeIndex >= 0 && policyProbeIndex > keyringScopeIndex && sampleIndex > policyProbeIndex);
});

test("RC1.1 workflow parses as YAML", () => {
  const workflowPath = fileURLToPath(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url));
  const ruby = "require 'yaml'; begin; YAML.load_file(ARGV[0]); puts 'YAML_OK'; rescue => e; STDERR.puts('LINE=' + (e.respond_to?(:line) ? e.line.to_s : '0')); STDERR.puts('COLUMN=' + (e.respond_to?(:column) ? e.column.to_s : '0')); STDERR.puts(e.message); end";
  let parsed = spawnSync("ruby", ["-e", ruby, workflowPath], { encoding: "utf8" });
  if ((parsed.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    const python = "import pathlib,sys,yaml; yaml.safe_load(pathlib.Path(sys.argv[1]).read_text()); print('YAML_OK')";
    parsed = spawnSync("python3", ["-c", python, workflowPath], { encoding: "utf8" });
  }
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  assert.equal(parsed.stdout.includes("YAML_OK"), true, parsed.stderr || parsed.stdout);
});

test("RC1.1 validates every shell block and keeps critical steps unique", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const lines = workflow.split("\n");
  const shellBlocks: Array<{ line: number; script: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const runMatch = /^(\s*)run:\s*\|\s*$/.exec(lines[index]);
    if (!runMatch) continue;

    const runIndent = runMatch[1].length;
    const body: string[] = [];
    let contentIndent: number | undefined;

    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const line = lines[bodyIndex];
      if (line.trim() === "") {
        body.push("");
        continue;
      }

      const lineIndent = /^(\s*)/.exec(line)?.[1].length ?? 0;
      if (lineIndent <= runIndent) break;
      contentIndent = contentIndent === undefined ? lineIndent : Math.min(contentIndent, lineIndent);
      body.push(line);
    }

    assert.ok(contentIndent !== undefined, `run block at line ${index + 1} is empty`);
    shellBlocks.push({
      line: index + 1,
      script: body.map((line) => line === "" ? "" : line.slice(contentIndent)).join("\n"),
    });
  }

  assert.equal(shellBlocks.length, 12, "unexpected RC1.1 shell block count");
  for (const block of shellBlocks) {
    const checked = spawnSync("bash", ["-n"], { input: block.script, encoding: "utf8" });
    assert.equal(checked.status, 0, `invalid bash in run block at line ${block.line}: ${checked.stderr}`);
  }

  const criticalSteps = [
    "Validate immutable RC1.1 request",
    "Verify recovery prerequisites",
    "Execute and prove real restore",
    "Cleanup temporary restore database",
    "Build and validate existing HMAC contract",
    "Verify existing HML runtime and deploy non-secret surfaces",
    "Verify canonical Apps Script deployment and existing bridge",
    "Send one isolated sample pair with global dry-run preserved",
    "Reconcile HML and enable SHADOW projection",
    "Wait for governed projection",
    "Test native intelligence against real HML data",
    "Final global dry-run verification and evidence",
  ];

  for (const name of criticalSteps) {
    const count = lines.filter((line) => line.trim() === `- name: ${name}`).length;
    assert.equal(count, 1, `critical step must occur once: ${name}`);
  }

  assert.equal(
    lines.filter((line) => /^- uses: actions\/upload-artifact@/.test(line.trim())).length,
    1,
    "evidence upload must occur once",
  );
  assert.match(workflow, /uses: actions\/upload-artifact@[\s\S]*if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow, /^\s*"\$keyring_file"; then\s*$/m);
});

test("RC1.1 reconciles the exact entity ids returned by real ingestion", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /AURORA_RC11_INVOICE_ENTITY_ID/);
  assert.match(workflow, /AURORA_RC11_BANK_ENTITY_ID/);
  assert.match(workflow, /\.response\.invoiceEntityId/);
  assert.match(workflow, /\.response\.bankEntityId/);
  assert.match(workflow, /invoices\/\$AURORA_RC11_INVOICE_ENTITY_ID/);
  assert.match(workflow, /bankTransactions\/\$AURORA_RC11_BANK_ENTITY_ID/);
  assert.match(workflow, /\.fields\.totalCents\.integerValue/);
  assert.match(workflow, /\.fields\.liquidatedAmountCents\.integerValue/);
  assert.match(workflow, /\.fields\.transactionKind\.stringValue=="RECEIPT"/);
  assert.match(workflow, /\.fields\.invoiceEntityId\.stringValue==\$invoiceEntityId/);
  assert.doesNotMatch(workflow, /metadata\.mapValue\.fields\.rc11Sample/);
  assert.doesNotMatch(workflow, /\.fields\.record\.mapValue/);
});

test("Apps Script deploy validates execution but never runs operational cycles automatically", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/deploy-appscript.yml", import.meta.url), "utf8");
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(workflow, /node-version: '22'/);
  assert.match(workflow, /@google\/clasp@3\.4\.1/);
  assert.match(workflow, /ensure-appscript-execution-deployment\.sh/);
  assert.match(workflow, /run-clasp-checked\.sh/);
  assert.match(workflow, /obterStatusWMGJ/);
  assert.doesNotMatch(workflow, /rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20/);
  assert.doesNotMatch(workflow, /rodarRoboGmailDashboardWMGJ_Teste20/);
  assert.doesNotMatch(workflow, /clasp run atualizarDashboardFinanceiro/);
  assert.doesNotMatch(workflow, /clasp run instalarGatilhoAutomacaoWMGJ/);
});


test("Apps Script CI pins clasp to the HML standard Cloud project", () => {
  const deployWorkflow = readFileSync(new URL("../../../.github/workflows/deploy-appscript.yml", import.meta.url), "utf8");
  const rc11Workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(deployWorkflow, /APPS_SCRIPT_GCP_PROJECT_ID: wmgj-hml-jfn-20260927/);
  assert.match(deployWorkflow, /"projectId": "\$APPS_SCRIPT_GCP_PROJECT_ID"/);
  assert.match(rc11Workflow, /"projectId":"%s"/);
  assert.match(rc11Workflow, /"\$APPS_SCRIPT_ID" "\$PROJECT_ID"/);
});

test("Windows clasp renewal keeps OAuth material local and updates GitHub Secret only after run validation", () => {
  const helper = readFileSync(new URL("../../../tools/windows/RENEW_CLASPRC_HML.ps1", import.meta.url), "utf8");
  assert.match(helper, /wmgj-hml-jfn-20260927/);
  assert.match(helper, /299889357292/);
  assert.match(helper, /clasp login --use-project-scopes --include-clasp-scopes --creds/);
  assert.match(helper, /clasp --json list-deployments/);
  assert.match(helper, /AURORA_EXECUTION_API_CANONICAL/);
  assert.match(helper, /scriptId = \$executionDeploymentId/);
  assert.match(helper, /Push-Location \$executionRoot/);
  assert.match(helper, /clasp --json run-function obterStatusWMGJ --nondev/);
  assert.doesNotMatch(helper, /clasp run obterStatusWMGJ --nondev --json/);
  assert.match(helper, /\$Gh secret set CLASPRC_JSON/);
  assert.match(helper, /Programs\\GitHubCLI\\gh\.exe/);
  assert.match(helper, /auth status --hostname github\.com/);
  assert.match(helper, /auth login --hostname github\.com --git-protocol https --web --skip-ssh-key/);
  assert.match(helper, /CLASPRC_JSON_ROTATED_AND_EXECUTION_API_VERIFIED/);
  assert.doesNotMatch(helper, /Write-Host .*client_secret/i);
  assert.doesNotMatch(helper, /Write-Host .*refresh_token/i);
});

test("Windows CMD clasp renewal preserves control flow and portable Node discovery", () => {
  const helper = readFileSync(new URL("../../../tools/windows/RENEW_CLASPRC_HML.cmd", import.meta.url), "utf8");
  assert.match(helper, /LOCALAPPDATA%\\Programs\\node-v\*/);
  assert.match(helper, /call "!NPM!" --version/);
  assert.match(helper, /call gcloud services enable/);
  assert.match(helper, /"!NODE!" -e/);
  assert.doesNotMatch(helper, /if\(!\(/);
  assert.match(helper, /CLASPRC_JSON_ROTATED_AND_EXECUTION_API_VERIFIED/);
});
