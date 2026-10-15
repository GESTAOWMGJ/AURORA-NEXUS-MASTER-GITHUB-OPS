import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {reconcileResourceUsage, classifyWorkflowOverlap, type UsageEvent, type WorkflowObservation} from "../src/auroraResourceOptimization.ts";
import {nativeRoutineSummary, AURORA_NATIVE_ROUTINES} from "../src/auroraNativeRoutines.ts";
const u:UsageEvent={counterKind:"FINAL_REQUEST",provider:"synthetic",billingAccountRef:"account-a",orgId:"tenant-a",environment:"HML",runId:"scan-a",requestId:"request-a",attemptId:"1",model:"synthetic-model",tier:"STANDARD",billingMode:"UNKNOWN",inputTokens:100,cachedInputTokens:80,outputTokens:5};
const w:WorkflowObservation={workflowId:"run-a",orgId:"tenant-a",environment:"HML",resourceKey:"release/current",effect:"WRITE",purpose:"PRIMARY",sourceSha:"a".repeat(40),inputHash:"b".repeat(64),policyHash:"c".repeat(64),state:"RUNNING"};
const other=(patch:Partial<WorkflowObservation>={})=>({...w,workflowId:"run-b",...patch});
test("cache is a subset and missing price is not zero",()=>{
 const result=reconcileResourceUsage([u]); assert.equal(result.groups[0].totalTokens,105);
 assert.equal(result.groups[0].uncachedInputTokens,20); assert.equal(result.groups[0].actualCost,null);
 assert.equal(result.groups[0].estimatedCost,null); assert.equal(result.financialReconciliationComplete,false);
});
test("same request exported twice is counted once",()=>{const r=reconcileResourceUsage([u,{...u}]);assert.equal(r.uniqueRequests,1);assert.equal(r.duplicateMeasurements,1);});
test("different actual requests remain counted",()=>{const r=reconcileResourceUsage([u,{...u,requestId:"request-b"}]);assert.equal(r.uniqueRequests,2);assert.equal(r.groups[0].inputTokens,200);});
test("different attempts remain counted",()=>assert.equal(reconcileResourceUsage([u,{...u,attemptId:"2"}]).uniqueRequests,2));
test("conflicting same-request counters fail closed",()=>assert.throws(()=>reconcileResourceUsage([u,{...u,outputTokens:6}]),/CONFLICT/));
test("models, tiers, billing accounts and tenants are not silently combined",()=>{
 for(const patch of [{model:"other"},{tier:"FAST"},{billingAccountRef:"account-b"},{orgId:"tenant-b"},{environment:"PROD"},{billingMode:"API" as const}]) {
  assert.equal(reconcileResourceUsage([u,{...u,requestId:"request-b",...patch}]).groups.length,2);
 }
});
test("cumulative and partial telemetry is not summed as final requests",()=>assert.throws(()=>reconcileResourceUsage([{...u,counterKind:"CUMULATIVE"} as unknown as UsageEvent]),/NORMALIZATION/));
test("invalid, overflowing and missing counters are rejected",()=>{
 for(const inputTokens of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>reconcileResourceUsage([{...u,inputTokens}]));
 assert.throws(()=>reconcileResourceUsage([{...u,cachedInputTokens:101}]),/CACHE/);
 assert.throws(()=>reconcileResourceUsage([{...u,inputTokens:Number.MAX_SAFE_INTEGER}]),/TOKEN/);
 assert.throws(()=>reconcileResourceUsage([{...u,outputTokens:undefined} as unknown as UsageEvent]));
});
test("unknown fields cannot grant authority",()=>assert.throws(()=>reconcileResourceUsage([{...u,approved:true} as unknown as UsageEvent]),/CLOSED/));
test("batch bounded and empty coverage remains unverified",()=>{
 assert.throws(()=>reconcileResourceUsage(Array(10001).fill(u)),/LIMIT/);
 const result=reconcileResourceUsage([]);assert.equal(result.completeProviderCoverageVerified,false);assert.equal(result.financialReconciliationComplete,false);
});
test("input events are not mutated",()=>{const input=Object.freeze({...u});reconcileResourceUsage([input]);assert.deepEqual(input,u);});
test("pending same-target writers are a candidate, not cancellation permission",()=>{
 const r=classifyWorkflowOverlap(w,other());assert.equal(r.classification,"POTENTIAL_DUPLICATE_EFFECT");assert.equal(r.cancelAuthorized,false);assert.equal(r.runtimeEquivalenceVerified,false);
});
test("changed writer inputs remain a conflict even when sources differ",()=>assert.equal(classifyWorkflowOverlap(w,other({sourceSha:"d".repeat(40)})).classification,"POTENTIAL_CONFLICTING_WRITERS"));
test("tenant/environment/target separation is preserved",()=>{
 for(const patch of [{orgId:"tenant-b"},{environment:"PROD"},{resourceKey:"release/other"}]) assert.equal(classifyWorkflowOverlap(w,other(patch)).classification,"DISTINCT_SCOPE");
});
test("review and negative tests are not auto-deduplicated",()=>{
 const a={...w,effect:"READ" as const}; for(const purpose of ["INDEPENDENT_REVIEW","NEGATIVE_TEST","IDEMPOTENCY_TEST","CROSS_PLATFORM_TEST"] as const){const r=classifyWorkflowOverlap(a,other({effect:"READ",purpose}));assert.match(r.classification,/NECESSARY/);assert.equal(r.skipReviewAuthorized,false);}
});
test("purpose label cannot excuse concurrent writes",()=>assert.equal(classifyWorkflowOverlap(w,other({purpose:"INDEPENDENT_REVIEW"})).classification,"POTENTIAL_DUPLICATE_EFFECT"));
test("read-write concurrency needs consistency review",()=>assert.equal(classifyWorkflowOverlap(w,other({effect:"READ"})).classification,"READ_WRITE_CONSISTENCY_REVIEW"));
test("same labels with different revisions are not accepted as same observation",()=>assert.equal(classifyWorkflowOverlap(w,{...w,inputHash:"e".repeat(64)}).classification,"OBSERVATION_CONFLICT"));
test("failed, unknown and historical effects require readback",()=>{
 assert.match(classifyWorkflowOverlap(w,other({state:"FAILED"})).classification,/READBACK/);
 assert.equal(classifyWorkflowOverlap(w,other({state:"UNKNOWN"})).classification,"RUNTIME_STATE_UNKNOWN");
 assert.match(classifyWorkflowOverlap(w,other({state:"SUCCEEDED"})).classification,/READBACK/);
});
test("same read inputs are only potentially avoidable",()=>assert.equal(classifyWorkflowOverlap({...w,effect:"READ"},other({effect:"READ"})).classification,"POTENTIALLY_AVOIDABLE_REREAD"));
test("invalid workflow hashes, statuses and injected properties fail closed",()=>{
 for(const patch of [{sourceSha:"main"},{inputHash:"missing"},{state:"DONE"},{approved:true}]) assert.throws(()=>classifyWorkflowOverlap(w,{...other(),...patch} as WorkflowObservation));
});
test("registered subpolicy reuses maintenance; no extra scheduler or runtime claim",()=>{
 const p=(nativeRoutineSummary() as any).resourceOptimizationPolicy;
 assert.equal(p.id,"AURORA-RESOURCE-OPT-001");assert.equal(p.routineId,"AURORA-DAILY-UPDATES-001");
 assert.equal(p.executorState,"PURE_EVALUATOR_IMPLEMENTED_NOT_WIRED");assert.equal(p.nativeRealtimeVerified,false);
 assert.equal(p.schedulerCreated,false);assert.equal(p.permissionsGranted,false);assert.equal(p.independentReviewRequired,true);
 assert.equal(AURORA_NATIVE_ROUTINES.filter(r=>r.id==="AURORA-DAILY-UPDATES-001").length,1);
 const policy=JSON.parse(fs.readFileSync(new URL("../../policy/autonomous-bugfix-realtime-audit-v1.json",import.meta.url),"utf8"));
 assert.equal(policy.resourceOptimization.id,p.id);assert.equal(policy.resourceOptimization.nativeRealtimeVerified,false);
 const mo=fs.readFileSync(new URL("../../../docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md",import.meta.url),"utf8");assert.match(mo,/AURORA-RESOURCE-OPT-001/);
});
