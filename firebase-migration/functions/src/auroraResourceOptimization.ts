/** Bounded, deterministic read-only pilot. No network, database, billing or job effects. */
export type UsageEvent = {
  counterKind: "FINAL_REQUEST";
  provider: string; billingAccountRef: string; orgId: string; environment: string;
  runId: string; requestId: string; attemptId: string; model: string; tier: string;
  billingMode: "API" | "SUBSCRIPTION" | "CREDITS" | "UNKNOWN";
  inputTokens: number; cachedInputTokens: number; outputTokens: number;
};
export type WorkflowObservation = {
  workflowId: string; orgId: string; environment: string; resourceKey: string;
  effect: "READ" | "WRITE"; purpose: "PRIMARY" | "INDEPENDENT_REVIEW" | "IDEMPOTENCY_TEST" | "NEGATIVE_TEST" | "CROSS_PLATFORM_TEST";
  sourceSha: string; inputHash: string; policyHash: string;
  state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
};
const USAGE_KEYS = ["counterKind", "provider", "billingAccountRef", "orgId", "environment", "runId", "requestId", "attemptId", "model", "tier", "billingMode", "inputTokens", "cachedInputTokens", "outputTokens"];
const WORKFLOW_KEYS = ["workflowId", "orgId", "environment", "resourceKey", "effect", "purpose", "sourceSha", "inputHash", "policyHash", "state"];
function closedRecord(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error("INVALID_CLOSED_RECORD");
  }
}
function text(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:/-]{1,160}$/.test(value)) throw new Error("INVALID_OPAQUE_REFERENCE");
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("INVALID_TOKEN_COUNT");
  return value;
}
function add(a: number, b: number): number { return count(a + b); }
function usage(value: unknown): UsageEvent {
  closedRecord(value, USAGE_KEYS);
  if (value.counterKind !== "FINAL_REQUEST") throw new Error("CUMULATIVE_OR_PARTIAL_COUNTER_REQUIRES_VERIFIED_NORMALIZATION");
  for (const key of USAGE_KEYS.filter(key => !key.endsWith("Tokens"))) text(value[key]);
  if (!["API", "SUBSCRIPTION", "CREDITS", "UNKNOWN"].includes(String(value.billingMode))) throw new Error("INVALID_BILLING_MODE");
  const input = count(value.inputTokens), cached = count(value.cachedInputTokens);
  count(value.outputTokens);
  if (cached > input) throw new Error("CACHE_EXCEEDS_NORMALIZED_INPUT");
  return value as unknown as UsageEvent;
}
/** Input must include cached tokens within inputTokens and only finalized request counters.
 * Repeated exports of one provider request are counted once; distinct actual attempts remain.
 * Missing financial evidence remains null, never a zero-cost claim.
 */
export function reconcileResourceUsage(events: readonly UsageEvent[]) {
  if (!Array.isArray(events) || events.length > 10000) throw new Error("USAGE_BATCH_LIMIT");
  const seen = new Map<string, string>();
  const groups = new Map<string, {provider: string; billingAccountRef: string; orgId: string; environment: string; model: string; tier: string; billingMode: string; requests: number; inputTokens: number; cachedInputTokens: number; outputTokens: number}>();
  let duplicateMeasurements = 0;
  for (const raw of events) {
    const item = usage(raw);
    const requestKey = JSON.stringify([item.provider, item.billingAccountRef, item.orgId, item.environment, item.requestId, item.attemptId]);
    const content = JSON.stringify(USAGE_KEYS.map(key => item[key as keyof UsageEvent]));
    if (seen.has(requestKey)) {
      if (seen.get(requestKey) !== content) throw new Error("REQUEST_MEASUREMENT_CONFLICT");
      duplicateMeasurements++;
      continue;
    }
    seen.set(requestKey, content);
    const key = JSON.stringify([item.provider,item.billingAccountRef,item.orgId,item.environment,item.model,item.tier,item.billingMode]);
    const group = groups.get(key) ?? {provider:item.provider,billingAccountRef:item.billingAccountRef,orgId:item.orgId,environment:item.environment,model:item.model,tier:item.tier,billingMode:item.billingMode,requests:0,inputTokens:0,cachedInputTokens:0,outputTokens:0};
    group.requests++;
    group.inputTokens = add(group.inputTokens,item.inputTokens);
    group.cachedInputTokens = add(group.cachedInputTokens,item.cachedInputTokens);
    group.outputTokens = add(group.outputTokens,item.outputTokens);
    groups.set(key,group);
  }
  const reconciled = [...groups.entries()].sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0).map(([,group])=>({
    ...group, uncachedInputTokens:group.inputTokens-group.cachedInputTokens,
    totalTokens:add(group.inputTokens,group.outputTokens), actualCost:null, estimatedCost:null,
    financialState:"PENDING_RATE_AND_CHARGE_EVIDENCE" as const
  }));
  return {schemaVersion:1,scope:"SUPPLIED_FINAL_REQUEST_RECORDS_ONLY",receivedMeasurements:events.length,
    uniqueRequests:seen.size,duplicateMeasurements,groups:reconciled,
    completeProviderCoverageVerified:false,financialReconciliationComplete:false,sourceMutation:false};
}
function workflow(value: unknown): WorkflowObservation {
  closedRecord(value,WORKFLOW_KEYS);
  for (const key of WORKFLOW_KEYS) text(value[key]);
  if (!["READ","WRITE"].includes(String(value.effect)) ||
      !["PRIMARY","INDEPENDENT_REVIEW","IDEMPOTENCY_TEST","NEGATIVE_TEST","CROSS_PLATFORM_TEST"].includes(String(value.purpose)) ||
      !["QUEUED","RUNNING","SUCCEEDED","FAILED","UNKNOWN"].includes(String(value.state))) throw new Error("INVALID_WORKFLOW_ENUM");
  if (!/^[a-f0-9]{40}$/.test(String(value.sourceSha)) ||
      !/^[a-f0-9]{64}$/.test(String(value.inputHash)) || !/^[a-f0-9]{64}$/.test(String(value.policyHash))) throw new Error("INVALID_WORKFLOW_HASH");
  return value as unknown as WorkflowObservation;
}
/** Classifies observations, never authorizes cancellation, omission of a test or lock bypass.
 * Equality of labels/hashes is a candidate signal, not proof of equivalent runtime effects.
 */
export function classifyWorkflowOverlap(left: WorkflowObservation, right: WorkflowObservation) {
  const a=workflow(left), b=workflow(right);
  let classification:string;
  if (a.orgId!==b.orgId || a.environment!==b.environment || a.resourceKey!==b.resourceKey) {
    classification="DISTINCT_SCOPE";
  } else if (a.workflowId===b.workflowId) {
    classification=WORKFLOW_KEYS.every(key=>a[key as keyof WorkflowObservation]===b[key as keyof WorkflowObservation]) ? "SAME_OBSERVATION" : "OBSERVATION_CONFLICT";
  } else if (a.state==="UNKNOWN" || b.state==="UNKNOWN") {
    classification="RUNTIME_STATE_UNKNOWN";
  } else if ([a,b].some(item=>item.state==="FAILED")) {
    classification="FAILED_ATTEMPT_REQUIRES_EFFECT_READBACK";
  } else if (a.effect==="WRITE" || b.effect==="WRITE") {
    const bothPending=[a,b].every(item=>["QUEUED","RUNNING"].includes(item.state));
    if (!bothPending) classification="HISTORICAL_EFFECT_REQUIRES_READBACK";
    else if (a.effect!==b.effect) classification="READ_WRITE_CONSISTENCY_REVIEW";
    else classification=(a.inputHash===b.inputHash && a.sourceSha===b.sourceSha && a.policyHash===b.policyHash) ? "POTENTIAL_DUPLICATE_EFFECT" : "POTENTIAL_CONFLICTING_WRITERS";
  } else if (a.purpose!=="PRIMARY" || b.purpose!=="PRIMARY") {
    classification="DECLARED_NECESSARY_OVERLAP_REQUIRES_EVIDENCE";
  } else if (a.inputHash===b.inputHash && a.sourceSha===b.sourceSha && a.policyHash===b.policyHash) {
    classification="POTENTIALLY_AVOIDABLE_REREAD";
  } else classification="CHANGED_INPUT_OR_POLICY_REQUIRES_REVIEW";
  return {classification,sourceMutation:false,cancelAuthorized:false,skipReviewAuthorized:false,
    runtimeEquivalenceVerified:false,requiresEvidence:true};
}
