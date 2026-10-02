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


test("RC1.1 reuses or one-shot bootstraps the existing HML HMAC without mutating Secret Manager", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /Build and validate existing HMAC contract/);
  assert.match(workflow, /gcloud secrets describe "\$secret_name"/);
  assert.match(workflow, /gcloud secrets versions access latest/);
  assert.match(workflow, /auroraRc11InspecionarConfiguracao/);
  assert.match(workflow, /auroraRc11ConfigurarEndpointExistente/);
  assert.match(workflow, /auroraRc11ConfigurarIngestao/);
  assert.match(workflow, /::add-mask::\$hmac_secret/);
  assert.doesNotMatch(workflow, /gcloud secrets versions add/);
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
  assert.match(source, /function auroraRc11InspecionarConfiguracao\(\)/);
  assert.match(source, /hmacConfigured:/);
  assert.match(source, /function auroraRc11ValidarHmacExistente\(\)/);
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

test("RC1.1 request explicitly selects existing-HMAC probe mode", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  const request = JSON.parse(readFileSync(new URL("../../../.github/requests/aurora-rc11-run.json", import.meta.url), "utf8"));
  // The implementation PR must stay inert. A separately reviewed one-shot
  // request must introduce v6 + approvedBaseSha + genericBackfillApproved=false.
  assert.equal(request.requestVersion, 5);
  assert.equal(request.approvedBaseSha, undefined);
  assert.equal(request.genericBackfillApproved, undefined);
  assert.equal(request.hmacMode, "REUSE_OR_BOOTSTRAP_EXISTING_KEYRING");
  assert.equal(request.deploymentApproved, true);
  assert.equal(request.firebaseWriteApproved, true);
  assert.equal(request.hmacBootstrapIfMissing, true);
  assert.equal(request.sourceMutation, false);
  assert.match(workflow, /\.requestVersion==6/);
  assert.match(workflow, /\.hmacMode=="REUSE_OR_BOOTSTRAP_EXISTING_KEYRING"/);
  assert.match(workflow, /\.deploymentApproved==true/);
  assert.match(workflow, /\.firebaseWriteApproved==true/);
  assert.match(workflow, /\.hmacBootstrapIfMissing==true/);
  assert.match(workflow, /\.sourceMutation==false/);
  assert.match(workflow, /\.genericBackfillApproved==false/);
  assert.match(workflow, /\.approvedBaseSha/);
});


test("RC1.1 request is a push-only one-time approval bound to the exact head commit", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /paths:\s*\n\s*- "\.github\/requests\/aurora-rc11-run\.json"/);
  assert.match(workflow, /fetch-depth: 2/);
  assert.match(workflow, /test "\$GITHUB_EVENT_NAME" = "push"/);
  assert.match(workflow, /test "\$GITHUB_RUN_ATTEMPT" = "1"/);
  assert.match(workflow, /git rev-parse "\$GITHUB_SHA\^1"/);
  assert.match(workflow, /git diff --name-only "\$first_parent" "\$GITHUB_SHA" -- "\$REQUEST_FILE"/);
  assert.match(workflow, /jq -r '\.approvedBaseSha'/);
  assert.match(workflow, /= "\$first_parent"/);
  assert.doesNotMatch(workflow, /paths:[\s\S]*aurora-rc11-recovery-real-ingest\.yml/);
  assert.doesNotMatch(workflow, /paths:[\s\S]*firebase-migration\/functions\/\*\*/);
});

test("RC1.1 never auto-cancels an active restore or one-shot write", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url), "utf8");
  assert.match(workflow, /group: aurora-rc11-hml\s+#[\s\S]*cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /cancel-in-progress: true/);
  const trapIndex = workflow.indexOf("trap reapply_kill_switch EXIT INT TERM");
  const activationIndex = workflow.indexOf("auroraRc11AtivarEscritaAmostra");
  assert.ok(trapIndex >= 0 && activationIndex > trapIndex);
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


test("RC1.1 verifies existing Functions runtime without secret IAM mutation", () => {
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
  assert.match(workflow, /ingest_probe_status/);
  assert.match(workflow, /METHOD_NOT_ALLOWED/);
  assert.doesNotMatch(workflow, /cloudfunctions\.net\/ingestWmgjEvent/);
  assert.match(workflow, /signatureVersion=="v2"/);
  assert.match(workflow, /--only hosting,firestore:rules,firestore:indexes/);
  assert.doesNotMatch(workflow, /--only functions:ingestWmgjEvent/);
  assert.doesNotMatch(workflow, /secretmanager\.secrets\.setIamPolicy/);
  assert.match(workflow, /functionsRedeployed:false/);
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
  assert.match(deployWorkflow, /ensure-appscript-execution-deployment\.sh/);
  assert.doesNotMatch(workflow, /clasp run auroraRc11/);
  assert.match(runner, /--nondev/);
  assert.match(runner, /clasp --json run-function/);
  assert.match(runner, /type=="object" and has\("response"\)/);
  assert.match(runner, /response details were withheld/);
  assert.match(runner, /Unable to run script function/);
  assert.match(runner, /NOT_AUTHORIZED/);
  assert.match(runner, /exit 71/);
  assert.match(deployWorkflow, /Publish canonical Apps Script Execution API deployment/);
  assert.match(deployment, /AURORA_EXECUTION_API_CANONICAL/);
  assert.match(deployment, /clasp --json list-deployments/);
  assert.match(deployment, /clasp --json update-deployment/);
  assert.match(deployment, /clasp --json create-deployment/);
  assert.match(deployment, /response details were withheld/);
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
  const activationIndex = workflow.indexOf("auroraRc11AtivarEscritaAmostra");
  assert.ok(keyringScopeIndex >= 0 && policyProbeIndex > keyringScopeIndex && activationIndex > policyProbeIndex);
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
