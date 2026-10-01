import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow=fs.readFileSync("../../.github/workflows/aurora-firebase-production.yml","utf8");
const request=JSON.parse(fs.readFileSync("../../.github/requests/aurora-firebase-production.json","utf8"));

test("production provisioning is isolated and cold by default",()=>{
  assert.equal(request.projectId,"aurora-nexus-prod-wmgj");
  assert.equal(request.deploymentStage,"COLD_PRODUCTION");
  assert.equal(request.productionMutation,false);
  assert.equal(request.sourceMutation,false);
  assert.equal(request.clinicalSensitiveEnabled,false);
  assert.match(workflow,/environment: firebase-homologation/);
  assert.match(workflow,/aurora-prod-deploy/);
  assert.match(workflow,/roles\/iam\.workloadIdentityUser/);
  assert.match(workflow,/attribute\.repository/);
  assert.match(workflow,/environment=production/);
  assert.match(workflow,/deployment_stage=cold/);
  assert.match(workflow,/--delete-protection/);
  assert.match(workflow,/--enable-pitr/);
  assert.match(workflow,/environment.*PRODUCTION/);
  assert.match(workflow,/projectionEnabled.*false/);
  assert.match(workflow,/projectionMode.*SHADOW/);
  assert.match(workflow,/active:false/);
});

test("production provisioning does not reuse HML as the production project",()=>{
  assert.doesNotMatch(workflow,/projectId == "wmgj-hml-jfn-20260927"/);
  assert.match(workflow,/test "\$PROJECT_ID" != "\$HML_PROJECT_ID"/);
  assert.match(workflow,/test "\$PROJECT_ID" != "wmgj-ops"/);
});

test("secrets are copied or generated inside runner and never printed",()=>{
  assert.match(workflow,/AURORA_NEXUS_ALLOWED_EMAILS/);
  assert.match(workflow,/openssl rand -hex 32/);
  assert.match(workflow,/active:false/);
  assert.doesNotMatch(workflow,/echo "\$hmac_secret"/);
  assert.doesNotMatch(workflow,/cat "\$temp\/allowed-emails"/);
});
