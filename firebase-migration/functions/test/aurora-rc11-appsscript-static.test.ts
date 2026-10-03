import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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


test("RC1.1 migrates legacy HML HMAC only behind explicit Secret Manager approval", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /Build and validate existing HMAC contract/);
  assert.match(workflow, /gcloud secrets describe "\$secret_name"/);
  assert.match(workflow, /gcloud secrets versions access latest/);
  assert.match(workflow, /auroraRc11InspecionarConfiguracao/);
  assert.match(workflow, /auroraRc11ConfigurarEndpointExistente/);
  assert.match(workflow, /auroraRc11ConfigurarIngestao/);
  assert.match(workflow, /secretManagerKeyringMigrationApproved/);
  assert.match(workflow, /\^\[A-Fa-f0-9\]\{64\}\$/);
  assert.match(workflow, /gcloud secrets versions add "WMGJ_INGEST_HMAC_KEYRING"/);
  assert.match(workflow, /functions:ingestWmgjEvent/);
  assert.match(workflow, /::add-mask::\$hmac_secret/);
  assert.doesNotMatch(workflow, /functions:secrets:set WMGJ_INGEST_HMAC_KEYRING/);
  assert.doesNotMatch(workflow, /gcloud secrets update/);
  assert.doesNotMatch(workflow, /gcloud secrets create/);
  assert.doesNotMatch(workflow, /add-iam-policy-binding/);
  assert.match(workflow, /auroraRc11ValidarHmacExistente/);
});

test("RC1.1 HMAC probe is authenticated, dry-run and non-mutating", () => {
  assert.match(source, /function auroraRc11InspecionarConfiguracao\(\)/);
  assert.match(source, /hmacConfigured:/);
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
  assert.equal(request.requestVersion, 6);
  assert.equal(request.hmacMode, "MIGRATE_LEGACY_OR_REUSE_CURRENT_KEYRING");
  assert.equal(request.secretManagerKeyringMigrationApproved, true);
  assert.equal(request.deploymentApproved, true);
  assert.equal(request.firebaseWriteApproved, true);
  assert.equal(request.hmacBootstrapIfMissing, true);
  assert.match(workflow, /\.requestVersion==6/);
  assert.match(workflow, /\.hmacMode=="MIGRATE_LEGACY_OR_REUSE_CURRENT_KEYRING"/);
  assert.match(workflow, /\.secretManagerKeyringMigrationApproved==true/);
  assert.match(workflow, /\.deploymentApproved==true/);
  assert.match(workflow, /\.firebaseWriteApproved==true/);
  assert.match(workflow, /\.hmacBootstrapIfMissing==true/);
});


test("RC1.1 workflow cannot auto-run from implementation changes", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /paths:\s*\n\s*- "\.github\/requests\/aurora-rc11-run\.json"/);
  assert.doesNotMatch(workflow, /paths:[\s\S]*aurora-rc11-recovery-real-ingest\.yml/);
  assert.doesNotMatch(workflow, /paths:[\s\S]*firebase-migration\/functions\/\*\*/);
});


test("RC1.1 keeps baseline runtime non-secret and gates ingest redeploy behind approved keyring migration", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /Verify existing HML runtime and deploy non-secret surfaces/);
  assert.match(workflow, /firebase-tools@14\.17\.0 functions:list/);
  assert.match(workflow, /gcloud functions describe runtimeHealth/);
  assert.match(workflow, /signatureVersion=="v2"/);
  assert.match(workflow, /--only hosting,firestore:rules,firestore:indexes/);
  assert.match(workflow, /secretManagerKeyringMigrationApproved/);
  assert.match(workflow, /--only functions:ingestWmgjEvent/);
  const approvalIndex = workflow.indexOf('secretManagerKeyringMigrationApproved');
  const redeployIndex = workflow.indexOf('--only functions:ingestWmgjEvent');
  assert.ok(approvalIndex >= 0 && redeployIndex > approvalIndex);
  assert.doesNotMatch(workflow, /--only functions(?!:ingestWmgjEvent)/);
  assert.doesNotMatch(workflow, /secretmanager\.secrets\.setIamPolicy/);
  assert.match(workflow, /functionsRedeployed:false/);
});


test("RC1.1 treats clasp execution as a fail-closed nondev gate", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../../../tools/run-clasp-checked.sh", import.meta.url), "utf8");
  const deployWorkflow = readFileSync(new URL("../../../.github/workflows/deploy-appscript.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /ensure-appscript-execution-deployment\.sh/);
  assert.doesNotMatch(workflow, /clasp push --force/);
  assert.match(workflow, /run-clasp-checked\.sh/);
  assert.match(workflow, /auroraRc11InspecionarConfiguracao/);
  assert.doesNotMatch(workflow, /clasp run auroraRc11/);
  assert.match(runner, /--nondev/);
  assert.match(runner, /--json/);
  assert.match(runner, /Unable to run script function/);
  assert.match(runner, /NOT_AUTHORIZED/);
  assert.match(runner, /exit 71/);
  assert.match(deployWorkflow, /ensure-appscript-execution-deployment\.sh/);
  assert.match(deployWorkflow, /Publish canonical Apps Script Execution API deployment/);
});

test("RC1.1 workflow parses as YAML", () => {
  const workflowPath = fileURLToPath(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url));
  const ruby = "require 'yaml'; begin; YAML.load_file(ARGV[0]); puts 'YAML_OK'; rescue => e; STDERR.puts('LINE=' + (e.respond_to?(:line) ? e.line.to_s : '0')); STDERR.puts('COLUMN=' + (e.respond_to?(:column) ? e.column.to_s : '0')); STDERR.puts(e.message); end";
  const parsed = spawnSync("ruby", ["-e", ruby, workflowPath], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  assert.match(parsed.stdout, /YAML_OK/);
});

test("RC1.1 canonical bridge shell block has valid bash syntax", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const match = workflow.match(/      - name: Use canonical Apps Script deployment and configure bridge[\s\S]*?        run: \|\n([\s\S]*?)\n\n      - name: Send one real sample/);
  assert.ok(match?.[1]);
  const script = match[1].split("\n").map((line) => line.replace(/^          /, "")).join("\n");
  const checked = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
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
  assert.doesNotMatch(workflow, /metadata\.mapValue\.fields\.rc11Sample/);
  assert.doesNotMatch(workflow, /\.fields\.record\.mapValue/);
});

test("Apps Script deploy validates execution but never runs operational cycles automatically", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/deploy-appscript.yml", import.meta.url), "utf8");
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
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
  assert.match(helper, /clasp run obterStatusWMGJ --nondev --json/);
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
