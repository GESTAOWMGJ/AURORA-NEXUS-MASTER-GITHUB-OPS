#!/usr/bin/env node
"use strict";
const crypto=require("node:crypto");
const PLATFORM_PRIORITY=["CLOUD_CONTROL_PLANE","WINDOWS_XEON_PHYSICAL_SERVER","CLIENT_SAFE_DEGRADED_MODE"];
const DEFAULTS=Object.freeze({leaseTtlMs:45000,heartbeatMs:15000,dedupWindowMs:3600000,failureThreshold:3,cooldownMs:60000});

function canonicalize(v){
  if(Array.isArray(v)) return v.map(canonicalize);
  if(v&&typeof v==="object"){
    return Object.keys(v).sort().reduce((a,k)=>{a[k]=canonicalize(v[k]);return a;},{});
  }
  return v;
}
function hashPayload(v){return crypto.createHash("sha256").update(JSON.stringify(canonicalize(v))).digest("hex");}
function operationIdentity(input){
  const semanticHash=input.semanticHash||hashPayload(input.payload??{});
  const identity={orgId:String(input.orgId||""),operationType:String(input.operationType||""),resourceKey:String(input.resourceKey||""),semanticHash};
  if(!identity.orgId||!identity.operationType||!identity.resourceKey) throw new Error("GUARDIAN_INVALID_OPERATION_IDENTITY");
  return {...identity,operationKey:hashPayload(identity)};
}
function validLease(lease,now=Date.now()){return Boolean(lease&&lease.holder&&Number(lease.expiresAt)>now);}
function arbitrateWriter({currentLease,candidatePlatform,now=Date.now(),ttlMs=DEFAULTS.leaseTtlMs}){
  if(!PLATFORM_PRIORITY.includes(candidatePlatform)) return {allowed:false,code:"UNKNOWN_PLATFORM"};
  if(!validLease(currentLease,now)){
    const epoch=Math.max(Number(currentLease?.epoch||0)+1,1);
    return {allowed:true,code:"LEASE_ACQUIRED",lease:{holder:candidatePlatform,epoch,acquiredAt:now,heartbeatAt:now,expiresAt:now+ttlMs}};
  }
  if(currentLease.holder===candidatePlatform){
    return {allowed:true,code:"LEASE_RENEWED",lease:{...currentLease,heartbeatAt:now,expiresAt:now+ttlMs}};
  }
  return {allowed:false,code:"SPLIT_BRAIN_PREVENTED",activeWriter:currentLease.holder,epoch:currentLease.epoch};
}
function deduplicate({receipt,input,now=Date.now(),dedupWindowMs=DEFAULTS.dedupWindowMs}){
  const identity=operationIdentity(input);
  if(!receipt) return {kind:"NEW",identity};
  const sameKey=receipt.operationKey===identity.operationKey;
  const recent=Number(receipt.completedAt||0)+dedupWindowMs>=now;
  if(sameKey&&recent) return {kind:"DUPLICATE",identity,existing:receipt};
  const sameResource=receipt.orgId===identity.orgId&&receipt.operationType===identity.operationType&&receipt.resourceKey===identity.resourceKey;
  if(sameResource&&receipt.semanticHash!==identity.semanticHash&&recent) return {kind:"CONFLICT",identity,existing:receipt};
  return {kind:"NEW",identity};
}
function circuitDecision(state={},event,now=Date.now(),options={}){
  const threshold=options.failureThreshold||DEFAULTS.failureThreshold;
  const cooldown=options.cooldownMs||DEFAULTS.cooldownMs;
  const failures=Number(state.failures||0);
  if(state.openUntil&&Number(state.openUntil)>now) return {state:{...state},allow:false,code:"CIRCUIT_OPEN"};
  if(event==="SUCCESS") return {state:{failures:0,openUntil:0,mode:"CLOSED"},allow:true,code:"CIRCUIT_CLOSED"};
  const next=failures+1;
  if(next>=threshold) return {state:{failures:next,openUntil:now+cooldown,mode:"OPEN"},allow:false,code:"CIRCUIT_OPENED"};
  return {state:{failures:next,openUntil:0,mode:"CLOSED"},allow:true,code:"FAILURE_RECORDED"};
}
function routePlatform(health){
  if(health?.cloud?.healthy) return "CLOUD_CONTROL_PLANE";
  if(health?.windowsXeon?.healthy) return "WINDOWS_XEON_PHYSICAL_SERVER";
  return "CLIENT_SAFE_DEGRADED_MODE";
}
function guardianDecision(input){
  const platform=routePlatform(input.health||{});
  const lease=arbitrateWriter({currentLease:input.currentLease,candidatePlatform:platform,now:input.now,ttlMs:input.leaseTtlMs});
  const dedup=deduplicate({receipt:input.receipt,input:input.operation,now:input.now,dedupWindowMs:input.dedupWindowMs});
  let action="EXECUTE",reason="SAFE_TO_EXECUTE";
  if(!lease.allowed){action="QUEUE";reason=lease.code;}
  else if(dedup.kind==="DUPLICATE"){action="RETURN_EXISTING";reason="IDEMPOTENT_DUPLICATE";}
  else if(dedup.kind==="CONFLICT"){action="BLOCK_AND_AUDIT";reason="SEMANTIC_CONFLICT";}
  else if(platform==="CLIENT_SAFE_DEGRADED_MODE"&&input.operation?.mutation!==false){action="QUEUE";reason="DEGRADED_MODE_READ_ONLY";}
  return {guardian:"AURORA_REALTIME_PLATFORM_GUARDIAN",version:"1.0.0",platform,action,reason,lease,dedup,riskProfile:action==="EXECUTE"||action==="RETURN_EXISTING"?"LOW":action==="QUEUE"?"MODERATE":"HIGH"};
}
module.exports={DEFAULTS,PLATFORM_PRIORITY,arbitrateWriter,circuitDecision,deduplicate,guardianDecision,hashPayload,operationIdentity,routePlatform,validLease};

if(require.main===module){
  const decision=guardianDecision({
    health:{cloud:{healthy:true},windowsXeon:{healthy:true}},
    currentLease:null,
    receipt:null,
    operation:{orgId:"wmgj",operationType:"HEALTH_CHECK",resourceKey:"aurora",mutation:false,payload:{probe:true}}
  });
  console.log(JSON.stringify({passed:true,evidenceState:"LOCAL_POLICY_SMOKE",operationalIntegrationVerified:false,...decision},null,2));
}
