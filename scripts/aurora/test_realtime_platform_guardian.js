#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const {
  arbitrateWriter,circuitDecision,deduplicate,guardianDecision,operationIdentity,routePlatform
}=require("./realtime_platform_guardian.js");
const now=1000000;

assert.equal(routePlatform({cloud:{healthy:true},windowsXeon:{healthy:true}}),"CLOUD_CONTROL_PLANE");
assert.equal(routePlatform({cloud:{healthy:false},windowsXeon:{healthy:true}}),"WINDOWS_XEON_PHYSICAL_SERVER");
assert.equal(routePlatform({cloud:{healthy:false},windowsXeon:{healthy:false}}),"CLIENT_SAFE_DEGRADED_MODE");

const first=arbitrateWriter({currentLease:null,candidatePlatform:"CLOUD_CONTROL_PLANE",candidateId:"cloud-one",now});
assert.equal(first.allowed,true);
const split=arbitrateWriter({currentLease:first.lease,candidatePlatform:"WINDOWS_XEON_PHYSICAL_SERVER",candidateId:"xeon-one",now:now+1000});
assert.equal(split.allowed,false);
assert.equal(split.code,"SPLIT_BRAIN_PREVENTED");

const op={orgId:"wmgj",operationType:"SYNC",resourceKey:"invoice:1",payload:{a:1}};
const id=operationIdentity(op);
const dup=deduplicate({input:op,now:now+1000,receipt:{...id,completedAt:now,result:{ok:true}}});
assert.equal(dup.kind,"DUPLICATE");

const conflict=deduplicate({input:{...op,payload:{a:2}},now:now+1000,receipt:{...id,completedAt:now}});
assert.equal(conflict.kind,"CONFLICT");

let cb=circuitDecision({},"FAIL",now);
cb=circuitDecision(cb.state,"FAIL",now+1);
cb=circuitDecision(cb.state,"FAIL",now+2);
assert.equal(cb.allow,false);
assert.equal(cb.code,"CIRCUIT_OPENED");

const degraded=guardianDecision({
  now,writerInstanceId:"degraded-one",
  health:{cloud:{healthy:false},windowsXeon:{healthy:false}},
  operation:{orgId:"wmgj",operationType:"WRITE",resourceKey:"x",mutation:true,payload:{x:1}}
});
assert.equal(degraded.action,"QUEUE");
assert.equal(degraded.reason,"DEGRADED_MODE_READ_ONLY");

console.log(JSON.stringify({suite:"AURORA_REALTIME_PLATFORM_GUARDIAN",passed:true,tests:9}));
