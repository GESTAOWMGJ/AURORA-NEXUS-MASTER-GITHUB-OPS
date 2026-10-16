import { reconcileResourceUsage, type UsageEvent } from "./auroraResourceOptimization.js";

/** Source adapter only. The existing caller must authorize and verify bindings before use.
 * No endpoint, scheduler, database client, checkpoint, provider request or financial write.
 * HML snapshots are supplied as JSON; this module does not attest their provenance.
 */
export type AiRunUsageScope = {
  orgId: string; environment: "HML"; projectId: string; databaseId: string;
};
export type AiRunUsageSnapshot = {
  path: string; projectId: string; databaseId: string; data: unknown;
  binding: {
    runId: string; requestId: string; responseId: string;
    billingAccountRef: string; evidenceRef: string;
  };
};
class SourceError extends Error {}
function reject(reason: string): never { throw new SourceError(reason); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject("INVALID_SOURCE_RECORD");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(item => item.get || item.set)) reject("INVALID_SOURCE_RECORD");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    reject("UNSUPPORTED_SOURCE_FIELDS");
  }
}
function ref(value: unknown, segment = false): string {
  if (typeof value !== "string" || !(segment ? /^[A-Za-z0-9._-]{1,128}$/ : /^[A-Za-z0-9._:/-]{1,160}$/).test(value)) {
    reject("INVALID_SOURCE_REFERENCE");
  }
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) reject("INVALID_SOURCE_COUNT");
  return value;
}
function instant(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    reject("TIMESTAMP_NORMALIZATION_REQUIRED");
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result)) reject("TIMESTAMP_NORMALIZATION_REQUIRED");
  return result;
}
function normalize(raw: unknown, scope: AiRunUsageScope): { event: UsageEvent; responseId: string; path: string } {
  const source = record(raw);
  keys(source, ["path", "projectId", "databaseId", "data", "binding"]);
  if (source.projectId !== scope.projectId || source.databaseId !== scope.databaseId) reject("SOURCE_SCOPE_MISMATCH");
  const run = record(source.data);
  if (run.orgId !== scope.orgId) reject("SOURCE_SCOPE_MISMATCH");
  const runId = ref(run.runId, true);
  const path = `organizations/${scope.orgId}/aiRuns/${runId}`;
  if (source.path !== path) reject("SOURCE_SCOPE_MISMATCH");
  if (run.schemaVersion !== 1 || run.provider !== "openai") reject("UNSUPPORTED_SOURCE_PROVIDER_OR_SCHEMA");
  if (!["COMPLETED_PENDING_REVIEW", "REFUSED", "INCOMPLETE", "FAILED"].includes(String(run.status))) {
    reject("NONTERMINAL_SOURCE");
  }
  if (count(run.revision) < 1) reject("INVALID_SOURCE_REVISION");
  if (instant(run.completedAt) < instant(run.createdAt)) reject("INVALID_SOURCE_TIME_ORDER");
  const requestId = ref(run.requestId), responseId = ref(run.responseId);
  const binding = record(source.binding);
  keys(binding, ["runId", "requestId", "responseId", "billingAccountRef", "evidenceRef"]);
  if (binding.runId !== runId || binding.requestId !== requestId || binding.responseId !== responseId) {
    reject("REQUEST_ACCOUNT_BINDING_MISMATCH");
  }
  const billingAccountRef = ref(binding.billingAccountRef);
  ref(binding.evidenceRef); // Presence is not verification; no authorization is conferred here.
  const usage = record(run.usage);
  keys(usage, ["input_tokens", "input_tokens_details", "output_tokens", "total_tokens"], ["output_tokens_details"]);
  const inputTokens = count(usage.input_tokens), outputTokens = count(usage.output_tokens);
  const total = count(inputTokens + outputTokens);
  if (count(usage.total_tokens) !== total) reject("SOURCE_TOTAL_MISMATCH");
  const inputDetails = record(usage.input_tokens_details);
  keys(inputDetails, ["cached_tokens"], ["cache_write_tokens"]);
  const cachedInputTokens = count(inputDetails.cached_tokens);
  if (cachedInputTokens > inputTokens) reject("SOURCE_CACHE_EXCEEDS_INPUT");
  if (Object.hasOwn(inputDetails, "cache_write_tokens") && count(inputDetails.cache_write_tokens) !== 0) {
    reject("CACHE_WRITE_BREAKDOWN_REQUIRES_CONTRACT");
  }
  if (Object.hasOwn(usage, "output_tokens_details")) {
    const outputDetails = record(usage.output_tokens_details);
    keys(outputDetails, ["reasoning_tokens"]);
    if (count(outputDetails.reasoning_tokens) > outputTokens) reject("SOURCE_REASONING_EXCEEDS_OUTPUT");
  }
  return { path, responseId, event: {
    counterKind: "FINAL_REQUEST", provider: "openai", billingAccountRef,
    orgId: scope.orgId, environment: scope.environment, runId, requestId,
    // The original transport request ID identifies this observed attempt; not a retry ordinal.
    attemptId: requestId, model: ref(run.model), tier: "UNKNOWN", billingMode: "UNKNOWN",
    inputTokens, cachedInputTokens, outputTokens
  } };
}

/** Evaluates one complete supplied batch, never an additive increment/checkpoint.
 * A bad row blocks the entire batch. Re-exports and reviewer revisions do not add consumption.
 * Model is the configured request label, not an attestation of the provider's served model.
 */
export function reconcileStoredAiRunUsage(snapshots: readonly AiRunUsageSnapshot[], scope: AiRunUsageScope) {
  const context = record(scope);
  keys(context, ["orgId", "environment", "projectId", "databaseId"]);
  ref(scope.orgId, true); ref(scope.projectId, true);
  if (scope.databaseId !== "(default)") ref(scope.databaseId, true);
  if (scope.environment !== "HML") reject("HML_SCOPE_REQUIRED");
  if (!Array.isArray(snapshots) || snapshots.length > 1000) reject("SOURCE_BATCH_LIMIT");
  const events: UsageEvent[] = [];
  const requests = new Map<string, string>(), responses = new Map<string, string>(), paths = new Map<string, string>();
  const pending: Array<{ index: number; reason: string }> = [];
  for (let index = 0; index < snapshots.length; index++) {
    try {
      const { event, responseId, path } = normalize(snapshots[index], scope);
      const requestKey = JSON.stringify([event.billingAccountRef, event.requestId]);
      const responseKey = JSON.stringify([event.billingAccountRef, responseId]);
      const identity = JSON.stringify([event.billingAccountRef, event.requestId, responseId]);
      if ((requests.has(requestKey) && requests.get(requestKey) !== responseId) ||
          (responses.has(responseKey) && responses.get(responseKey) !== event.requestId) ||
          (paths.has(path) && paths.get(path) !== identity)) reject("SOURCE_IDENTITY_CONFLICT");
      requests.set(requestKey, responseId); responses.set(responseKey, event.requestId); paths.set(path, identity);
      events.push(event);
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      pending.push({ index, reason: error.message });
    }
  }
  let evaluation: ReturnType<typeof reconcileResourceUsage> | null = null;
  let reconciliationError: string | null = null;
  if (pending.length === 0 && snapshots.length > 0) {
    try { evaluation = reconcileResourceUsage(events); }
    catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (!["REQUEST_MEASUREMENT_CONFLICT", "INVALID_TOKEN_COUNT"].includes(code)) throw error;
      reconciliationError = code;
    }
  }
  return {
    adapterVersion: 1, source: "SERIALIZED_EXISTING_AI_RUNS", suppliedRecords: snapshots.length,
    state: pending.length || reconciliationError ? "BLOCKED_SOURCE_NORMALIZATION" :
      snapshots.length ? "SNAPSHOT_EVALUATED_RUNTIME_NOT_WIRED" : "NO_SOURCE",
    evaluation, pending, reconciliationError,
    modelSemantics: "CONFIGURED_REQUEST_LABEL_NOT_SERVED_MODEL",
    tierAndBillingMode: "UNKNOWN", cacheWriteBreakdownSupported: false,
    bindingEvidenceVerifiedByAdapter: false, runtimeVerified: false,
    providerCoverageVerified: false, historicalRetriesCovered: false,
    persistentAggregationImplemented: false, sourceMutation: false,
    actualCost: null, estimatedCost: null
  };
}
