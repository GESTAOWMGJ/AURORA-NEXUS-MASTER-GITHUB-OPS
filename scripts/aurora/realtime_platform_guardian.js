#!/usr/bin/env node
"use strict";
// Compatibility entry point: one implementation for cloud and local tooling.
const guardian = require("../../firebase-migration/functions/src/realtimePlatformGuardian.js");
module.exports = guardian;
if (require.main === module) {
  const decision = guardian.guardianDecision({writerInstanceId:"local-policy-smoke",health:{cloud:{healthy:true}},
    operation:{orgId:"synthetic",operationType:"HEALTH_CHECK",resourceKey:"aurora",mutation:false,payload:{probe:true}}});
  console.log(JSON.stringify({passed:true,evidenceState:"LOCAL_POLICY_SMOKE",operationalIntegrationVerified:false,...decision},null,2));
}
