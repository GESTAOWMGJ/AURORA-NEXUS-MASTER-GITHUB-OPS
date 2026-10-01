import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow=fs.readFileSync("../../.github/workflows/aurora-firebase-production.yml","utf8");
const request=JSON.parse(fs.readFileSync("../../.github/requests/aurora-firebase-production.json","utf8"));
const windowsBootstrap=fs.readFileSync("../../tools/windows/BOOTSTRAP_AURORA_PROD_WIF.ps1","utf8");
const workspaceWorkflow=fs.readFileSync("../../.github/workflows/provision-google-workspace.yml","utf8");
const workspaceProvisioner=fs.readFileSync("../../tools/google-workspace/provision.mjs","utf8");
const apiLock=fs.readFileSync("../api/uv.lock","utf8");
const ruleTestLock=fs.readFileSync("../tests/package-lock.json","utf8");

test("production provisioning is isolated and cold by default",()=>{
  assert.equal(request.projectId,"aurora-nexus-prod-wmgj");
  assert.equal(request.deploymentStage,"COLD_PRODUCTION");
  assert.equal(request.productionMutation,false);
  assert.equal(request.sourceMutation,false);
  assert.equal(request.clinicalSensitiveEnabled,false);
  assert.match(workflow,/environment: firebase-production/);
  assert.match(workflow,/FIREBASE_PROD_PROJECT_ID/);
  assert.match(workflow,/GCP_PROD_WIF_PROVIDER/);
  assert.match(workflow,/GCP_PROD_DEPLOY_SERVICE_ACCOUNT/);
  assert.match(workflow,/--delete-protection/);
  assert.match(workflow,/--enable-pitr/);
  assert.match(workflow,/environment.*PRODUCTION/);
  assert.match(workflow,/projectionEnabled.*false/);
  assert.match(workflow,/projectionMode.*SHADOW/);
});

test("project creation is a local one-time bootstrap, not a deploy permission",()=>{
  assert.doesNotMatch(workflow,/gcloud projects create/);
  assert.doesNotMatch(workflow,/HML_PROJECT_ID/);
  assert.doesNotMatch(workflow,/\bGCP_WIF_PROVIDER\b/);
  assert.doesNotMatch(workflow,/GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT/);
  assert.match(windowsBootstrap,/gcloud projects create/);
  assert.match(windowsBootstrap,/workload-identity-pools/);
  assert.match(windowsBootstrap,/attribute\.repository/);
  assert.match(windowsBootstrap,/firebase-production/);
});

test("production secrets stay local to bootstrap and are only verified in CI",()=>{
  assert.match(workflow,/AURORA_NEXUS_ALLOWED_EMAILS/);
  assert.match(workflow,/AURORA_NEXUS_CSRF_HMAC_KEY/);
  assert.match(workflow,/WMGJ_INGEST_HMAC_KEYRING/);
  assert.doesNotMatch(workflow,/secrets versions access latest[\s\S]*HML/);
  assert.match(windowsBootstrap,/RandomNumberGenerator/);
  assert.doesNotMatch(windowsBootstrap,/Write-Host.*hmac/i);
});


test("production WIF is bound to the protected environment and exact workflow",()=>{
  assert.match(windowsBootstrap,/attribute\.environment=assertion\.environment/);
  assert.match(windowsBootstrap,/attribute\.job_workflow_ref=assertion\.job_workflow_ref/);
  assert.match(windowsBootstrap,/assertion\.environment=='\$Environment'/);
  assert.match(windowsBootstrap,/aurora-firebase-production\.yml@refs\/heads\/main/);
  assert.match(windowsBootstrap,/attribute\.environment\/\$Environment/);
  assert.match(windowsBootstrap,/providers update-oidc/);
});

test("production deployment identity follows least-privilege hardening",()=>{
  assert.match(windowsBootstrap,/roles\/secretmanager\.viewer/);
  assert.match(windowsBootstrap,/remove-iam-policy-binding/);
  assert.match(windowsBootstrap,/roles\/secretmanager\.admin/);
  assert.match(windowsBootstrap,/roles\/iam\.serviceAccountUser/);
  assert.match(windowsBootstrap,/prevent_self_review = \$true/);
  const required=windowsBootstrap.match(/\$requiredProjectRoles = @\(([\s\S]*?)\n\)/)?.[1] ?? "";
  assert.doesNotMatch(required,/secretmanager\.admin|iam\.serviceAccountUser|cloudfunctions\.admin|run\.admin|artifactregistry\.admin/);
});

test("critical production actions are immutable-SHA pinned",()=>{
  assert.match(workflow,/actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow,/google-github-actions\/auth@c200f3691d83b41bf9bbd8638997a462592937ed/);
  assert.match(workflow,/google-github-actions\/setup-gcloud@e427ad8a34f8676edf47cf7d7925499adf3eb74f/);
  assert.doesNotMatch(workflow,/uses:\s+[^\n]+@v\d/);
});

test("Google Workspace legacy JSON is isolated from GitHub Actions",()=>{
  assert.match(workspaceWorkflow,/--offline-plan/);
  assert.doesNotMatch(workspaceWorkflow,/GOOGLE_SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(workspaceWorkflow,/--apply/);
  assert.match(workspaceProvisioner,/GITHUB_ACTIONS === 'true'/);
  assert.match(workspaceProvisioner,/GOOGLE_WORKSPACE_LEGACY_JSON_BREAKGLASS/);
  assert.match(workspaceProvisioner,/admin\.directory\.user\.alias\.readonly/);
});

test("security dependency locks are reconciled",()=>{
  assert.match(apiLock,/name = "pyjwt"\nversion = "2\.15\.0"/);
  assert.match(apiLock,/name = "urllib3"\nversion = "2\.8\.0"/);
  assert.match(ruleTestLock,/"node_modules\/hono": \{\n      "version": "4\.13\.12"/);
});
