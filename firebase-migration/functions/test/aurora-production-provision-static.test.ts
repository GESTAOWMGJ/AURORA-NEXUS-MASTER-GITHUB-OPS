import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow=fs.readFileSync("../../.github/workflows/aurora-firebase-production.yml","utf8");
const request=JSON.parse(fs.readFileSync("../../.github/requests/aurora-firebase-production.json","utf8"));
const windowsBootstrap=fs.readFileSync("../../tools/windows/BOOTSTRAP_AURORA_PROD_WIF.ps1","utf8");

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
  assert.match(workflow,/environment=production/);
  assert.match(workflow,/deployment_stage=cold/);
  assert.match(workflow,/--delete-protection/);
  assert.match(workflow,/--enable-pitr/);
  assert.match(workflow,/environment.*PRODUCTION/);
  assert.match(workflow,/projectionEnabled.*false/);
  assert.match(workflow,/projectionMode.*SHADOW/);
});

test("project creation is a local one-time bootstrap, not a deploy permission",()=>{
  assert.doesNotMatch(workflow,/gcloud projects create/);
  assert.doesNotMatch(workflow,/HML_PROJECT_ID/);
  assert.doesNotMatch(workflow,/GCP_WIF_PROVIDER/);
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
  assert.match(windowsBootstrap,/openssl/);
  assert.doesNotMatch(windowsBootstrap,/Write-Host.*hmac/i);
});
