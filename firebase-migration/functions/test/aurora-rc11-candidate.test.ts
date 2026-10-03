import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const candidate = JSON.parse(readFileSync(new URL(
  "../../../docs/requests/aurora-rc11-v6.candidate.json", import.meta.url
), "utf8"));
const liveRequest = JSON.parse(readFileSync(new URL(
  "../../../.github/requests/aurora-rc11-run.json", import.meta.url
), "utf8"));
const workflow = readFileSync(new URL(
  "../../../.github/workflows/aurora-rc11-recovery-real-ingest.yml", import.meta.url
), "utf8");

test("v6 candidate is inert and cannot masquerade as an approved request", () => {
  assert.equal(candidate.requestVersion, 6);
  assert.equal(candidate.candidateOnly, true);
  assert.equal(candidate.confirmation, "PENDING_HUMAN_REVIEW");
  assert.equal(candidate.approvedBaseSha, null);
  assert.equal(candidate.requestedAt, null);
  for (const field of [
    "deploymentApproved", "firebaseWriteApproved", "hmacBootstrapIfMissing",
    "productionMutation", "sourceMutation", "clinicalSensitiveEnabled", "genericBackfillApproved"
  ]) assert.equal(candidate[field], false, field);
  assert.equal(candidate.projectId, "wmgj-hml-jfn-20260927");
  assert.equal(candidate.sample.expectedPairCount, 2);
  assert.equal(liveRequest.requestVersion, 5);
  assert.match(workflow, /\.candidateOnly==false/);
  assert.equal(workflow.includes("docs/requests/"), false);
});
