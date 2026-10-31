import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyChelfexReadback} from '../../scripts/verify-chelfex-authenticated-readback.mjs';
import {buildChelfexContract} from '../src/auroraChelfex.js';
const sha='a'.repeat(40),now=new Date('2026-10-31T12:00:00Z');
function fixture(revoked=false):any {
 const snapshot={orgId:'wmgj',snapshotId:'private-snapshot',sourceHash:'b'.repeat(64),asOf:now.toISOString(),schemaVersion:2,
  policyVersion:'aurora-nexus-2.4.0-firebase-native-v1',competence:'2026-10',sanitized:true,sensitivity:'INTERNAL',revoked,
  dataQuality:{sourcePresent:true,complete:true,invalidFinancialRecords:0},
  nativeDataPlane:{storage:'FIRESTORE',sourceAccessDuringInference:false,externalAiRequired:false},
  documentIntelligence:{fragileDocuments:0,sourceDependentDocuments:0,overdueDocumentSla:0}};
 return {ok:true,environment:'HOMOLOGATION',mode:'SHADOW',organization:{id:'wmgj'},
 canonicalVersion:{runtimeBuild:{sourceSha:sha,fileIntegrityVerified:true}},masterEngine:{chelfex:buildChelfexContract(
 {schemaVersion:'aurora.chelfex.task.v1',orgId:'wmgj',operation:'PROPOSE',objective:'review'},
 {orgId:'wmgj',authority:'AUTHENTICATED_SERVER'},snapshot,now)}};
}
test('authenticated receipt preserves distinction between ready and revoked evidence and removes private text',()=>{
 for(const revoked of [false,true]) {const p=verifyChelfexReadback(fixture(revoked),sha);assert.equal(p.sourceDataReady,!revoked);
 assert.equal(p.executionAllowed,false);assert.ok(!JSON.stringify(p).includes('private-snapshot'));}
});
test('wrong source, authority, policy, tenant or execution flags cannot pass readback',()=>{
 for(const mutate of [
  (f:any)=>f.canonicalVersion.runtimeBuild.sourceSha='c'.repeat(40),
  (f:any)=>f.masterEngine.chelfex.contextVerification='LOCAL_UNVERIFIED_PREVIEW',
  (f:any)=>f.masterEngine.chelfex.policyHash='c'.repeat(64),
  (f:any)=>f.masterEngine.chelfex.tenantScope='foreign',
  (f:any)=>f.masterEngine.chelfex.executionAllowed=true,
  (f:any)=>f.masterEngine.chelfex.evidence=[],
  (f:any)=>f.masterEngine.chelfex.conclusions[0].evidenceRefs=['missing']]) {
  const f=fixture();mutate(f);assert.throws(()=>verifyChelfexReadback(f,sha));
 }
 const f=fixture(true);f.masterEngine.chelfex.conclusions[0].status='FACT';assert.throws(()=>verifyChelfexReadback(f,sha));
});
