import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {CHELFEX_POLICY, CHELFEX_POLICY_HASH} from '../functions/lib/auroraChelfex.js';

/** Receipt validator only. Authentication is performed by the protected workflow. */
export function verifyChelfexReadback(bootstrap, sourceSha) {
  const c=bootstrap?.masterEngine?.chelfex;
  if(!/^[a-f0-9]{40}$/.test(sourceSha??'') || bootstrap?.ok!==true
    || bootstrap.environment!=='HOMOLOGATION' || bootstrap.mode!=='SHADOW'
    || bootstrap.organization?.id!=='wmgj'
    || bootstrap.canonicalVersion?.runtimeBuild?.sourceSha!==sourceSha
    || bootstrap.canonicalVersion?.runtimeBuild?.fileIntegrityVerified!==true
    || c?.contract!==CHELFEX_POLICY.id || c.version!==CHELFEX_POLICY.version
    || c.policyHash!==CHELFEX_POLICY_HASH || c.mode!=='RECOMMEND_ONLY'
    || c.tenantScope!=='wmgj' || c.contextVerification!=='AUTHENTICATED_SERVER'
    || c.operation!=='PROPOSE' || c.riskLevel!=='R1'
    || c.executionAllowed!==false || c.sourceMutation!==false || c.authorization!=='NOT_GRANTED'
    || c.verification?.execution!=='NOT_RUN' || !Array.isArray(c.conclusions)
    || !Array.isArray(c.evidence) || !Array.isArray(c.blockers)
    || !['BLOCKED','RECOMMENDATION_ONLY'].includes(c.status)
    || !['ALLOW','REVIEW','DENY','NOT_EVALUATED'].includes(c.verification.dataDecision))
    throw Error('CHELFEX_AUTHENTICATED_READBACK_REJECTED');
  if(c.status==='RECOMMENDATION_ONLY') {
    if(c.verification.evidence!=='PASSED' || !['ALLOW','REVIEW'].includes(c.verification.dataDecision)
      || !c.evidence.length || c.evidence.some(e=>e.orgId!=='wmgj')
      || c.conclusions.some(x=>!Array.isArray(x.evidenceRefs)||!x.evidenceRefs.length
        || x.evidenceRefs.some(id=>!c.evidence.some(e=>e.id===id))))
      throw Error('CHELFEX_AUTHENTICATED_EVIDENCE_REJECTED');
  } else if(c.verification.evidence!=='NOT_VERIFIED' || c.evidence.length
    || c.conclusions.some(x=>x.status!=='PENDING')) throw Error('CHELFEX_AUTHENTICATED_EVIDENCE_REJECTED');
  // No source identifiers, conclusion text, financial values, identity or cookies retained.
  return {schema:'aurora.chelfex.authenticated-readback.v1',sourceSha,contract:c.contract,
    version:c.version,policyHash:c.policyHash,contextVerification:c.contextVerification,
    status:c.status,dataDecision:c.verification.dataDecision,evidenceVerification:c.verification.evidence,
    conclusionCount:c.conclusions.length,executionAllowed:false,authorization:'NOT_GRANTED',
    authenticationEvidence:'PROTECTED_WORKFLOW_SESSION_AND_ACCOUNT_LOOKUP',
    sourceDataReady:c.status==='RECOMMENDATION_ONLY'};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.length!==4) throw Error('ARGS');
    const proof=verifyChelfexReadback(JSON.parse(readFileSync(process.argv[2],'utf8')),process.argv[3]);
    console.log(JSON.stringify(proof));
  } catch { console.error('CHELFEX_AUTHENTICATED_READBACK_REJECTED'); process.exitCode=1; }
}
