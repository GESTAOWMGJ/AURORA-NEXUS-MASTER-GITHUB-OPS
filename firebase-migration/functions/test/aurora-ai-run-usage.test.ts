import assert from "node:assert/strict";
import test from "node:test";
import { reconcileStoredAiRunUsage, type AiRunUsageScope, type AiRunUsageSnapshot } from "../src/auroraAiRunUsage.ts";

const scope: AiRunUsageScope = { orgId: "synthetic-org", environment: "HML", projectId: "synthetic-hml", databaseId: "(default)" };
function sample(n = 1): any {
  return {
    path: `organizations/synthetic-org/aiRuns/run-${n}`,
    projectId: scope.projectId, databaseId: scope.databaseId,
    data: {
      schemaVersion: 1, provider: "openai", orgId: scope.orgId, runId: `run-${n}`,
      requestId: `req_${n}`, responseId: `resp_${n}`, model: "synthetic-configured-model",
      status: "COMPLETED_PENDING_REVIEW", revision: 2,
      createdAt: "2026-10-16T12:00:00Z", completedAt: "2026-10-16T12:00:01Z",
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 60 },
        output_tokens: 20, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 120 }
    },
    binding: { runId: `run-${n}`, requestId: `req_${n}`, responseId: `resp_${n}`,
      billingAccountRef: "synthetic-account", evidenceRef: "evidence:synthetic-binding" }
  };
}
function run(rows: AiRunUsageSnapshot[]) { return reconcileStoredAiRunUsage(rows, scope); }
function blocked(edit: (value: any) => void, reason: string) {
  const row = sample(); edit(row);
  const result = run([row]);
  assert.equal(result.state, "BLOCKED_SOURCE_NORMALIZATION");
  assert.equal(result.evaluation, null);
  assert.equal(result.pending[0]?.reason, reason);
}

test("maps stored final usage to the existing evaluator without adding cache/reasoning twice", () => {
  const result = run([sample()]);
  assert.equal(result.state, "SNAPSHOT_EVALUATED_RUNTIME_NOT_WIRED");
  const group = result.evaluation!.groups[0]!;
  assert.equal(group.inputTokens, 100); assert.equal(group.cachedInputTokens, 60);
  assert.equal(group.uncachedInputTokens, 40); assert.equal(group.outputTokens, 20);
  assert.equal(group.totalTokens, 120); assert.equal(group.model, "synthetic-configured-model");
  assert.equal(group.actualCost, null); assert.equal(group.estimatedCost, null);
  assert.equal(group.billingMode, "UNKNOWN"); assert.equal(group.tier, "UNKNOWN");
  assert.equal(result.providerCoverageVerified, false); assert.equal(result.runtimeVerified, false);
  assert.equal(result.modelSemantics, "CONFIGURED_REQUEST_LABEL_NOT_SERVED_MODEL");
});
for (const status of ["COMPLETED_PENDING_REVIEW", "REFUSED", "INCOMPLETE", "FAILED"]) {
  test(`terminal ${status} with final counters is not discarded`, () => {
    const row = sample(); row.data.status = status;
    assert.equal(run([row]).evaluation!.uniqueRequests, 1);
  });
}
test("deduplicates repeated exports", () => {
  const result = run([sample(), sample()]);
  assert.equal(result.evaluation!.uniqueRequests, 1);
  assert.equal(result.evaluation!.duplicateMeasurements, 1);
});
test("review revisions and unrelated data do not create consumption or leak content", () => {
  const row = sample(); row.data.revision = 3; row.data.reviewState = "APPROVED";
  row.data.result = { text: "SYNTHETIC_PRIVATE_CONTENT_MUST_NOT_APPEAR" };
  const result = run([sample(), row]);
  assert.equal(result.evaluation!.uniqueRequests, 1);
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE_CONTENT_MUST_NOT_APPEAR"), false);
});
test("distinct actual requests with equal counters remain counted", () => {
  assert.equal(run([sample(), sample(2)]).evaluation!.uniqueRequests, 2);
});
test("different accounts remain separated for distinct source runs", () => {
  const row = sample(2); row.binding.billingAccountRef = "another-account";
  assert.equal(run([sample(), row]).evaluation!.groups.length, 2);
});
test("conflicting counters on one identity block all totals", () => {
  const row = sample(); row.data.usage.input_tokens++; row.data.usage.total_tokens++;
  const result = run([sample(), row]);
  assert.equal(result.evaluation, null); assert.equal(result.reconciliationError, "REQUEST_MEASUREMENT_CONFLICT");
});
for (const kind of ["response", "request", "account"]) {
  test(`conflicting ${kind} identity cannot cause double counting`, () => {
    const row = sample(kind === "account" ? 1 : 2);
    if (kind === "response") { row.data.responseId = "resp_1"; row.binding.responseId = "resp_1"; }
    if (kind === "request") { row.data.requestId = "req_1"; row.binding.requestId = "req_1"; }
    if (kind === "account") row.binding.billingAccountRef = "another-account";
    const result = run([sample(), row]);
    assert.equal(result.evaluation, null); assert.equal(result.pending[0]?.reason, "SOURCE_IDENTITY_CONFLICT");
  });
}
const cases: Array<[string, (row: any) => void, string]> = [
  ["organization", row => { row.data.orgId = "another-org"; }, "SOURCE_SCOPE_MISMATCH"],
  ["project", row => { row.projectId = "another-project"; }, "SOURCE_SCOPE_MISMATCH"],
  ["database", row => { row.databaseId = "another-db"; }, "SOURCE_SCOPE_MISMATCH"],
  ["source path", row => { row.path = "organizations/another-org/aiRuns/run-1"; }, "SOURCE_SCOPE_MISMATCH"],
  ["provider", row => { row.data.provider = "another-provider"; }, "UNSUPPORTED_SOURCE_PROVIDER_OR_SCHEMA"],
  ["nonterminal", row => { row.data.status = "PROCESSING"; }, "NONTERMINAL_SOURCE"],
  ["missing final timestamp", row => { delete row.data.completedAt; }, "TIMESTAMP_NORMALIZATION_REQUIRED"],
  ["raw Firestore timestamp", row => { row.data.completedAt = { seconds: 1 }; }, "TIMESTAMP_NORMALIZATION_REQUIRED"],
  ["reversed timestamps", row => { row.data.completedAt = "2026-10-15T12:00:00Z"; }, "INVALID_SOURCE_TIME_ORDER"],
  ["missing request identity", row => { row.data.requestId = null; }, "INVALID_SOURCE_REFERENCE"],
  ["binding mismatch", row => { row.binding.requestId = "another-request"; }, "REQUEST_ACCOUNT_BINDING_MISMATCH"],
  ["missing account", row => { row.binding.billingAccountRef = ""; }, "INVALID_SOURCE_REFERENCE"],
  ["missing evidence", row => { delete row.binding.evidenceRef; }, "UNSUPPORTED_SOURCE_FIELDS"],
  ["absent cache", row => { delete row.data.usage.input_tokens_details.cached_tokens; }, "UNSUPPORTED_SOURCE_FIELDS"],
  ["negative count", row => { row.data.usage.input_tokens = -1; }, "INVALID_SOURCE_COUNT"],
  ["fraction", row => { row.data.usage.input_tokens = 1.5; }, "INVALID_SOURCE_COUNT"],
  ["numeric string", row => { row.data.usage.input_tokens = "100"; }, "INVALID_SOURCE_COUNT"],
  ["boolean", row => { row.data.usage.input_tokens = true; }, "INVALID_SOURCE_COUNT"],
  ["unsafe integer", row => { row.data.usage.input_tokens = Number.MAX_SAFE_INTEGER + 1; }, "INVALID_SOURCE_COUNT"],
  ["total mismatch", row => { row.data.usage.total_tokens++; }, "SOURCE_TOTAL_MISMATCH"],
  ["cache exceeds input", row => { row.data.usage.input_tokens_details.cached_tokens = 101; }, "SOURCE_CACHE_EXCEEDS_INPUT"],
  ["cache writes", row => { row.data.usage.input_tokens_details.cache_write_tokens = 1; }, "CACHE_WRITE_BREAKDOWN_REQUIRES_CONTRACT"],
  ["reasoning exceeds output", row => { row.data.usage.output_tokens_details.reasoning_tokens = 21; }, "SOURCE_REASONING_EXCEEDS_OUTPUT"],
  ["cumulative payload", row => { row.data.usage.counterKind = "CUMULATIVE"; }, "UNSUPPORTED_SOURCE_FIELDS"]
];
for (const [name, edit, reason] of cases) test(`rejects ${name}`, () => blocked(edit, reason));
test("accepts explicitly reported zero cache writes", () => {
  const row = sample(); row.data.usage.input_tokens_details.cache_write_tokens = 0;
  assert.equal(run([row]).evaluation!.uniqueRequests, 1);
});
test("one invalid row blocks the whole batch rather than returning a misleading partial total", () => {
  const row = sample(2); row.data.usage = {};
  const result = run([sample(), row]); assert.equal(result.evaluation, null);
  assert.equal(result.pending[0]?.index, 1);
});
test("bounded batch and HML-only scope", () => {
  assert.throws(() => run(Array.from({ length: 1001 }, () => sample())), /SOURCE_BATCH_LIMIT/);
  assert.throws(() => reconcileStoredAiRunUsage([], { ...scope, environment: "PROD" } as any), /HML_SCOPE_REQUIRED/);
});
test("empty source is not zero consumption", () => {
  const result = run([]); assert.equal(result.state, "NO_SOURCE"); assert.equal(result.evaluation, null);
});
test("replay/reordering are stable and inputs remain unchanged", () => {
  const rows = [sample(), sample(2)]; const before = JSON.stringify(rows);
  assert.deepEqual(run(rows), run(rows)); assert.deepEqual(run(rows), run([...rows].reverse()));
  assert.equal(JSON.stringify(rows), before); assert.equal(run(rows).sourceMutation, false);
});
test("aggregate overflow stays blocked", () => {
  const rows = [sample(), sample(2)];
  for (const row of rows) {
    row.data.usage.input_tokens = Number.MAX_SAFE_INTEGER - 100;
    row.data.usage.total_tokens = row.data.usage.input_tokens + 20;
  }
  const result = run(rows); assert.equal(result.evaluation, null);
  assert.equal(result.reconciliationError, "INVALID_TOKEN_COUNT");
});
test("getters in a supplied record are not executed", () => {
  const row = sample(); let touched = false;
  Object.defineProperty(row.data, "model", { get() { touched = true; return "unsafe"; }, enumerable: true });
  assert.equal(run([row]).pending[0]?.reason, "INVALID_SOURCE_RECORD"); assert.equal(touched, false);
});
