// Offline, synthetic contract readback. No cloud credentials or operational writes.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {buildMasterOperationalState} = require('../functions/lib/auroraMasterEngine.js');
const now = new Date('2026-10-31T12:00:00.000Z');
const snapshot = {
  orgId: 'synthetic-chelfex', snapshotId: 'synthetic-readback', sourceHash: 'a'.repeat(64), schemaVersion: 2,
  policyVersion: 'aurora-nexus-2.4.0-firebase-native-v1', asOf: now.toISOString(), competence: '2026-10',
  sanitized: true, sensitivity: 'INTERNAL', dataQuality: {sourcePresent:true,complete:true,invalidFinancialRecords:0},
  operations: {openActions:1,overdueActions:1}, financialCents: {outstandingCents:1000,glossCents:0},
  coverage: {evidencePercent:100,reconciliationPercent:100},
  documentIntelligence: {fragileDocuments:0,sourceDependentDocuments:0,overdueDocumentSla:0},
  nativeDataPlane: {storage:'FIRESTORE',sourceAccessDuringInference:false,externalAiRequired:false}
};
const result = buildMasterOperationalState(snapshot, {chelfexContext:{orgId:snapshot.orgId,authority:'AUTHENTICATED_SERVER'}}, now).chelfex;
assert.equal(result.status,'RECOMMENDATION_ONLY');
assert.equal(result.executionAllowed,false);
assert.equal(result.verification.execution,'NOT_RUN');
assert.ok(result.conclusions.every(c=>c.evidenceRefs.every(r=>result.evidence.some(e=>e.id===r))));
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).trim();
console.log(JSON.stringify({schemaVersion:'aurora.chelfex.synthetic-readback.v1',sourceSha:sha,dirty,
  evidenceMode:'OFFLINE_SYNTHETIC',identity:'SIMULATED_NOT_REAL_SESSION',
  liveDataUsed:false,operationalWrites:0,deployExecuted:false,cloudHmlVerified:false,
  independentReviewVerified:false,contractResultSha256:createHash('sha256').update(JSON.stringify(result)).digest('hex'),result},null,2));
