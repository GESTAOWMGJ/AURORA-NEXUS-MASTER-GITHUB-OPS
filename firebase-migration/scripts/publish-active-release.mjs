import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACTIVE_RELEASE_SOURCE, ACTIVE_RELEASE_ORIGIN, REQUIRED_RELEASE_COMPONENTS, componentManifestIdentityMatches,
  activeReleaseSigningBytes, verifyActiveReleaseEnvelope } from '../functions/lib/auroraActiveRelease.js';
import {readComponentPackage} from './release-component-packages.mjs';
import ownerDecision from '../policy/hml-owner-release-approval-v1.json' with { type: 'json' };

const REPOSITORY='GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS';
const DEPLOY_WORKFLOW='.github/workflows/deploy-aurora-firebase.yml';
const CI_WORKFLOW='.github/workflows/validate-firestore-migration.yml';
const PUBLISH_JOB='Publish verified canonical active release';
const OWNER_MODE='OWNER_DEPLOYMENT_APPROVAL',PR_MODE='GITHUB_PULL_REQUEST_REVIEW';
const HML_ENVIRONMENT='firebase-homologation',HML_PROJECT='wmgj-hml-jfn-20260927';
const REQUIRED_DEPLOY_STEPS=['Deploy Functions, Hosting, Rules and indexes','Smoke test private shell and deployed functions',
  'Authenticated smoke test without stored password','Verify canonical source-bound runtime'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error(code);};
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const ownerDecisionSha256=hash(JSON.stringify(ownerDecision));
const runMatches=(run,sourceSha,path)=>run?.head_sha===sourceSha&&run?.head_branch==='main'&&run?.path===path
  &&run?.repository?.full_name===REPOSITORY&&run?.status==='completed'&&run?.conclusion==='success';

function requireCurrentOwnerDecision(now,reviewPrNumber) {
  if(ownerDecision.schemaVersion!==1||ownerDecision.approvalSource!=='DIRECT_OWNER_CHAT'
    ||ownerDecision.scope.repository!==REPOSITORY||ownerDecision.scope.projectId!==HML_PROJECT
    ||ownerDecision.scope.environment!==HML_ENVIRONMENT||ownerDecision.scope.branch!=='main'
    ||ownerDecision.integrationAndHmlPublicationAuthorized!==true||ownerDecision.productionAuthorized!==false
    ||ownerDecision.clinicalSensitiveAuthorized!==false||ownerDecision.laterMainCodeReviewClaimed!==false
    ||ownerDecision.independentGithubPullRequestReviewClaimed!==false
    ||ownerDecision.riskAcceptance.status!=='ACCEPTED_BY_OWNER_HML_TEST_TOOLS_ONLY') fail('OWNER_APPROVAL_SCOPE_INVALID');
  const recordedAt=Date.parse(`${ownerDecision.recordedOn}T00:00:00.000Z`),expiresAt=Date.parse(ownerDecision.scope.validUntilUtc);
  const historicalWindow=Number.isSafeInteger(recordedAt)&&Number.isSafeInteger(expiresAt)
    &&expiresAt>recordedAt&&Number.isSafeInteger(now)&&now>=recordedAt&&now<expiresAt;
  // The historical operational/Drive authorization and R029 deadline are immutable.
  // A later, independently scoped public-media HML decision cannot renew them.
  const media=ownerDecision.publicMediaHmlAuthorization;
  const mediaStart=Date.parse(`${media?.recordedOn}T00:00:00.000Z`);
  const mediaExpiry=Date.parse(media?.validUntilUtc);
  const mediaWindow=media?.decisionId==='AURORA-HML-CREDMED-20261029'
    &&media.approvalSource==='DIRECT_OWNER_CHAT'&&media.ownerHmlDeploymentApproved===true
    &&media.repo===REPOSITORY&&media.projectId===HML_PROJECT&&media.environment===HML_ENVIRONMENT
    &&media.branch==='main'&&String(media.authorizedPullRequest)===String(reviewPrNumber)
    &&media.protectedRunOwnerApprovalStillRequired===true&&media.exactFinalSourceCiStillRequired===true
    &&media.canonicalSmokeAndReadbackStillRequired===true&&media.riskReviewDeadlineExtended===false
    &&media.newResidualRiskAcceptanceClaimed===false&&media.productionAuthorized===false
    &&media.clinicalSensitiveAuthorized===false&&media.realApplicantDataAuthorizedBeforePrivacyReadiness===false
    &&media.newSourceEnrollmentAuthorized===false&&media.existingCredentialValidityExtended===false
    &&media.iamChangeAuthorized===false&&media.secretRotationAuthorized===false
    &&media.laterMainCodeReviewClaimed===false&&media.independentGithubPullRequestReviewClaimed===false
    &&Number.isSafeInteger(mediaStart)&&Number.isSafeInteger(mediaExpiry)
    &&mediaExpiry>mediaStart&&now>=mediaStart&&now<mediaExpiry;
  if(!historicalWindow&&!mediaWindow) fail('OWNER_APPROVAL_EXPIRED');
}

async function verifyOwnerDeploymentApproval(input,release,pr,githubJSON) {
  requireCurrentOwnerDecision(input.now,input.reviewPrNumber);
  const owner=ownerDecision.repositoryOwner;
  const ownerUser=user=>user?.type==='User'&&user.id===owner.id&&user.login===owner.login;
  if(input.projectId!==HML_PROJECT||input.deploymentEnvironment!==HML_ENVIRONMENT
    ||input.publisherRunId!==input.releaseRunId||input.actorLogin!==owner.login||input.actorId!==String(owner.id)
    ||!ownerUser(release.actor)||!ownerUser(release.triggering_actor)) fail('OWNER_HML_CONTEXT_NOT_VERIFIED');
  const environment=await githubJSON(`/environments/${HML_ENVIRONMENT}`);
  const reviewerRule=environment?.protection_rules?.find(rule=>rule.type==='required_reviewers');
  if(!Number.isSafeInteger(environment?.id)||environment.id<1||environment.name!==HML_ENVIRONMENT
    ||environment.deployment_branch_policy?.custom_branch_policies!==true
    ||environment.deployment_branch_policy.protected_branches!==false
    ||reviewerRule?.prevent_self_review!==false
    ||!reviewerRule.reviewers?.some(row=>row.type==='User'&&ownerUser(row.reviewer))) fail('OWNER_ENVIRONMENT_REVIEWER_NOT_VERIFIED');
  const branches=await githubJSON(`/environments/${HML_ENVIRONMENT}/deployment-branch-policies?per_page=100`);
  if(branches?.total_count!==1||branches.branch_policies?.length!==1
    ||branches.branch_policies[0].name!=='main'||branches.branch_policies[0].type!=='branch') fail('OWNER_ENVIRONMENT_BRANCH_NOT_VERIFIED');
  const approvals=await githubJSON(`/actions/runs/${input.releaseRunId}/approvals`);
  if(!Array.isArray(approvals)||approvals.length>=100) fail('OWNER_DEPLOYMENT_APPROVAL_INCOMPLETE');
  const relevant=approvals.filter(row=>row.environments?.some(env=>env.id===environment.id&&env.name===HML_ENVIRONMENT));
  // A caller flag, run actor or administrator bypass is never an approval. Any recorded rejection blocks this mode.
  if(relevant.some(row=>row.state!=='approved')||!relevant.some(row=>row.state==='approved'&&ownerUser(row.user))) fail('OWNER_DEPLOYMENT_APPROVAL_NOT_VERIFIED');
  for(const reviewed of ownerDecision.reviewedPullRequests) {
    const original=await githubJSON(`/pulls/${reviewed.number}`);
    if(original?.merged!==true||original.head?.sha!==reviewed.headSha||original.base?.ref!=='main'
      ||original.base?.repo?.full_name!==REPOSITORY) fail('OWNER_CHAT_REVIEW_HEAD_CONFLICT');
  }
  return {mode:OWNER_MODE,sourceSha:input.sourceSha,releaseRunId:input.releaseRunId,reviewPrNumber:input.reviewPrNumber,
    integrationPrHeadSha:pr.head.sha,environmentId:environment.id,environment:HML_ENVIRONMENT,
    approverLogin:owner.login,approverId:owner.id,ownerDecisionId:ownerDecision.decisionId,ownerDecisionSha256,
    approvalSource:ownerDecision.approvalSource,approvalReaffirmations:structuredClone(ownerDecision.reaffirmations),
    reviewedPullRequests:structuredClone(ownerDecision.reviewedPullRequests),
    gateway:structuredClone(ownerDecision.gateway),riskAcceptance:structuredClone(ownerDecision.riskAcceptance),
    subsequentTechnicalGatewayEvidence:structuredClone(ownerDecision.subsequentTechnicalGatewayEvidence),
    laterMainCodeReviewClaimed:false,independentGithubPullRequestReviewClaimed:false};
}

/** Technical gates come from GitHub; owner-chat scope is a separate versioned decision, never a supplied success flag. */
export async function verifyProtectedReleaseEvidence(input,githubJSON) {
  const {sourceSha,ciRunId,releaseRunId,reviewPrNumber}=input;
  const reviewMode=input.reviewMode??PR_MODE;
  if(![PR_MODE,OWNER_MODE].includes(reviewMode)) fail('INVALID_REVIEW_MODE');
  if(!sha(sourceSha)||![ciRunId,releaseRunId,reviewPrNumber].every(id)) fail('INVALID_RELEASE_EVIDENCE_IDS');
  const main=await githubJSON('/git/ref/heads/main');
  if(main?.object?.sha!==sourceSha) fail('CURRENT_MAIN_CONFLICT');
  const ci=await githubJSON(`/actions/runs/${ciRunId}`);
  if(!runMatches(ci,sourceSha,CI_WORKFLOW)) fail('EXACT_CI_NOT_VERIFIED');
  const release=await githubJSON(`/actions/runs/${releaseRunId}`);
  const runningHere=release?.status==='in_progress'&&input.publisherRunId===releaseRunId;
  const releaseIdentity=release?.head_sha===sourceSha&&release?.head_branch==='main'&&release?.path===DEPLOY_WORKFLOW&&release?.repository?.full_name===REPOSITORY;
  if(!releaseIdentity||release.event!=='workflow_dispatch'||(!runMatches(release,sourceSha,DEPLOY_WORKFLOW)&&!runningHere)) fail('PROTECTED_DEPLOY_NOT_VERIFIED');
  const jobs=await githubJSON(`/actions/runs/${releaseRunId}/jobs?filter=latest&per_page=100`);
  if(!Array.isArray(jobs?.jobs)||jobs.total_count>jobs.jobs.length) fail('DEPLOY_JOB_EVIDENCE_INCOMPLETE');
  const validation=jobs.jobs.find(job=>job.name==='Validate exact main candidate');
  const deployment=jobs.jobs.find(job=>job.name==='Deploy with protected environment');
  if(validation?.conclusion!=='success'||deployment?.conclusion!=='success') fail('PROTECTED_DEPLOY_JOBS_NOT_VERIFIED');
  for(const required of REQUIRED_DEPLOY_STEPS) {
    const step=deployment.steps?.find(item=>item.name===required);
    if(step?.status!=='completed'||step.conclusion!=='success') fail('CANONICAL_SMOKE_OR_DEPLOY_STEP_NOT_VERIFIED');
  }
  const publishJob=runningHere?jobs.jobs.find(job=>job.name===PUBLISH_JOB&&job.status==='in_progress'):undefined;
  if(runningHere&&(!publishJob||!Number.isSafeInteger(publishJob.id))) fail('PROTECTED_PUBLISH_JOB_NOT_VERIFIED');
  const checks=await githubJSON(`/commits/${sourceSha}/check-runs?filter=latest&per_page=100`);
  if(!Array.isArray(checks?.check_runs)||!checks.check_runs.length||checks.total_count>checks.check_runs.length)
    fail('EXACT_CHECKS_NOT_VERIFIED');
  // filter=latest retains independent dispatch suites. A terminal older deploy is
  // historical evidence, not the outcome of the exact replacement verified above.
  // Never exempt by name alone or apply this exception to CI/security workflows.
  const historicalRuns=new Map();
  for(const check of checks.check_runs) {
    if(check.head_sha!==sourceSha) fail('EXACT_CHECKS_NOT_VERIFIED');
    const currentPublisher=publishJob&&check.name===PUBLISH_JOB&&check.app?.slug==='github-actions'
      &&check.details_url===`https://github.com/${REPOSITORY}/actions/runs/${releaseRunId}/job/${publishJob.id}`;
    if(currentPublisher||(check.status==='completed'&&check.conclusion==='success')) continue;
    const prefix=`https://github.com/${REPOSITORY}/actions/runs/`;
    const match=typeof check.details_url==='string'&&check.details_url.startsWith(prefix)
      ? /^([1-9][0-9]{0,19})\/job\/([1-9][0-9]{0,19})$/.exec(check.details_url.slice(prefix.length)):null;
    if(check.app?.slug!=='github-actions'||check.status!=='completed'||!match||match[1]===releaseRunId
      ||!['Validate exact main candidate','Deploy with protected environment',PUBLISH_JOB].includes(check.name))
      fail('EXACT_CHECKS_NOT_VERIFIED');
    const oldId=match[1];
    if(!historicalRuns.has(oldId)) {
      const old=await githubJSON(`/actions/runs/${oldId}`);
      if(String(old?.id)!==oldId||old.head_sha!==sourceSha||old.head_branch!=='main'||old.path!==DEPLOY_WORKFLOW
        ||old.repository?.full_name!==REPOSITORY||old.event!=='workflow_dispatch'||old.status!=='completed'
        ||!Number.isSafeInteger(old.workflow_id)||old.workflow_id!==release.workflow_id
        ||!Number.isSafeInteger(old.run_number)||!Number.isSafeInteger(release.run_number)||old.run_number>=release.run_number
        ||!(Date.parse(old.created_at)<Date.parse(release.created_at))) fail('EXACT_CHECKS_NOT_VERIFIED');
      const oldJobs=await githubJSON(`/actions/runs/${oldId}/jobs?filter=latest&per_page=100`);
      if(!Array.isArray(oldJobs?.jobs)||oldJobs.total_count>oldJobs.jobs.length) fail('EXACT_CHECKS_NOT_VERIFIED');
      historicalRuns.set(oldId,oldJobs.jobs);
    }
    const oldJob=historicalRuns.get(oldId).find(job=>String(job.id)===match[2]);
    if(oldJob?.name!==check.name||oldJob.status!=='completed'||oldJob.conclusion!==check.conclusion)
      fail('EXACT_CHECKS_NOT_VERIFIED');
  }
  const pr=await githubJSON(`/pulls/${reviewPrNumber}`);
  if(pr?.merged!==true||pr.merge_commit_sha!==sourceSha||pr.base?.ref!=='main'||pr.base?.repo?.full_name!==REPOSITORY||!sha(pr.head?.sha)) fail('MERGED_REVIEW_SOURCE_NOT_VERIFIED');
  const reviews=await githubJSON(`/pulls/${reviewPrNumber}/reviews?per_page=100`);
  if(!Array.isArray(reviews)||reviews.length>=100) fail('REVIEW_EVIDENCE_INCOMPLETE');
  const latest=new Map();
  for(const review of reviews) {
    if(!review.user?.id||!['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state)) continue;
    const previous=latest.get(review.user.id);
    if(!previous||Date.parse(review.submitted_at)>Date.parse(previous.submitted_at)) latest.set(review.user.id,review);
  }
  const approved=[...latest.values()].find(review=>review.state==='APPROVED'&&review.commit_id===pr.head.sha
    &&review.user.type==='User'&&review.user.id!==pr.user?.id&&['OWNER','MEMBER','COLLABORATOR'].includes(review.author_association));
  if([...latest.values()].some(review=>review.state==='CHANGES_REQUESTED')) fail('EXACT_HUMAN_REVIEW_NOT_VERIFIED');
  let approvalProvenance;
  if(reviewMode===OWNER_MODE) approvalProvenance=await verifyOwnerDeploymentApproval(input,release,pr,githubJSON);
  else {
    if(!approved) fail('EXACT_HUMAN_REVIEW_NOT_VERIFIED');
    approvalProvenance={mode:PR_MODE,sourceSha,releaseRunId,reviewPrNumber,reviewedHeadSha:pr.head.sha,
      reviewerId:approved.user.id,reviewerLogin:approved.user.login??null};
  }
  return {ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true,approvalProvenance};
}

function manifestComponent(bytes,sourceSha,component) {
  let manifest;try{manifest=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{fail('INVALID_RELEASE_MANIFEST');}
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.dirty===true
    ||!componentManifestIdentityMatches(component,manifest)) fail('INVALID_RELEASE_MANIFEST');
  const sources=[manifest.sourceSha,manifest.sourceCommit,manifest.sourceRevision].filter(value=>value!==undefined);
  const versions=[manifest.version,manifest.clientVersion].filter(value=>value!==undefined);
  if(!sources.length||sources.some(value=>value!==sourceSha)||!versions.length||versions.some(value=>value!==versions[0])
    ||typeof versions[0]!=='string'||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(versions[0])) fail('RELEASE_MANIFEST_IDENTITY_CONFLICT');
  if(!manifest.files||typeof manifest.files!=='object'||!Object.keys(manifest.files).length) fail('RELEASE_MANIFEST_FILES_REQUIRED');
  return {version:versions[0],sourceSha,manifestSha256:hash(bytes)};
}

/** Trusted adapters provide GitHub, actual artifact bytes and atomic storage; no network/mutation in tests. */
export async function publishActiveRelease(env,deps) {
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_REF!=='refs/heads/main'
    ||!sha(env.GITHUB_SHA)||env.AURORA_ACTIVE_RELEASE_SHA!==env.GITHUB_SHA) fail('PROTECTED_MAIN_CONTEXT_REQUIRED');
  if(!env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY?.trim()||!env.AURORA_ACTIVE_RELEASE_PRIVATE_KEY?.trim()) fail('RELEASE_SIGNING_CONFIGURATION_REQUIRED');
  if(env.GCLOUD_PROJECT!=='wmgj-hml-jfn-20260927') fail('APPROVED_DEPLOY_PROJECT_REQUIRED');
  const previous=env.AURORA_ACTIVE_RELEASE_PREVIOUS_SHA256;
  if(previous!=='NONE'&&!/^[a-f0-9]{64}$/.test(previous??'')) fail('EXPLICIT_PREDECESSOR_REQUIRED');
  const {approvalProvenance,...checks}=await verifyProtectedReleaseEvidence({sourceSha:env.GITHUB_SHA,ciRunId:env.AURORA_ACTIVE_RELEASE_CI_RUN_ID,
    releaseRunId:env.AURORA_ACTIVE_RELEASE_DEPLOY_RUN_ID,reviewPrNumber:env.AURORA_ACTIVE_RELEASE_REVIEW_PR,publisherRunId:env.GITHUB_RUN_ID,
    reviewMode:env.AURORA_ACTIVE_RELEASE_REVIEW_MODE,projectId:env.GCLOUD_PROJECT,
    deploymentEnvironment:env.AURORA_ACTIVE_RELEASE_DEPLOYMENT_ENVIRONMENT,actorLogin:env.GITHUB_ACTOR,actorId:env.GITHUB_ACTOR_ID,
    now:deps.now?.()??Date.now()},deps.githubJSON);
  const components={};
  for(const component of REQUIRED_RELEASE_COMPONENTS) {
    const bytes=await deps.readManifest(component);
    if(!(bytes instanceof Uint8Array)||bytes.length>65_536) fail('RELEASE_MANIFEST_REQUIRED');
    components[component]=manifestComponent(bytes,env.GITHUB_SHA,component);
    if(['iaMaster','windowsIntegration'].includes(component)){
      if(typeof deps.readPackage!=='function')fail('RELEASE_COMPONENT_FILES_REQUIRED');
      const pkg=await deps.readPackage(component);
      if(!(pkg?.manifestBytes instanceof Uint8Array)||!Buffer.from(bytes).equals(Buffer.from(pkg.manifestBytes)))fail('RELEASE_COMPONENT_FILES_CONFLICT');
      const manifest=JSON.parse(Buffer.from(bytes).toString('utf8'));
      if(!pkg.fileBytes||Object.keys(pkg.fileBytes).length!==Object.keys(manifest.files).length
        ||Object.entries(manifest.files).some(([name,digest])=>!(pkg.fileBytes[name] instanceof Uint8Array)||hash(pkg.fileBytes[name])!==digest))
        fail('RELEASE_COMPONENT_FILES_CONFLICT');
    }
  }
  const publishedAtUtc=new Date(deps.now?.()??Date.now()).toISOString();
  const certificate={schemaVersion:2,sourceSha:env.GITHUB_SHA,productVersion:env.AURORA_ACTIVE_RELEASE_PRODUCT_VERSION,
    canonicalOrigin:ACTIVE_RELEASE_ORIGIN,releaseRunId:env.AURORA_ACTIVE_RELEASE_DEPLOY_RUN_ID,
    ciRunId:env.AURORA_ACTIVE_RELEASE_CI_RUN_ID,publishedAtUtc,status:'ACTIVE',checks,components};
  let signature;
  try{
    if(!/^-----BEGIN PRIVATE KEY-----\r?\n/.test(env.AURORA_ACTIVE_RELEASE_PRIVATE_KEY.trim())) fail('INVALID_SIGNING_KEY');
    const key=createPrivateKey({key:env.AURORA_ACTIVE_RELEASE_PRIVATE_KEY,format:'pem',type:'pkcs8'});
    if(key.asymmetricKeyType!=='ed25519') fail('INVALID_SIGNING_KEY');
    signature=sign(null,activeReleaseSigningBytes(certificate),key).toString('base64url');
  }catch{fail('INVALID_SIGNING_KEY');}
  const envelope={certificate,signature};
  const verified=verifyActiveReleaseEnvelope(envelope,env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY,{now:Date.parse(publishedAtUtc),expectedSourceSha:env.GITHUB_SHA});
  if(verified.status!=='CANDIDATE_UNVERIFIED') fail('SIGNED_CANDIDATE_REJECTED');
  // Recheck main after evidence/artifact collection, immediately before atomic promotion.
  if((await deps.githubJSON('/git/ref/heads/main'))?.object?.sha!==env.GITHUB_SHA) fail('CURRENT_MAIN_CONFLICT');
  if(approvalProvenance.mode===OWNER_MODE) requireCurrentOwnerDecision(deps.now?.()??Date.now(),env.AURORA_ACTIVE_RELEASE_REVIEW_PR);
  await deps.commit(envelope,previous,verified.certificateSha256,env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY,
    async()=>{
      if(approvalProvenance.mode===OWNER_MODE) requireCurrentOwnerDecision(deps.now?.()??Date.now(),env.AURORA_ACTIVE_RELEASE_REVIEW_PR);
      const currentMainSha=(await deps.githubJSON('/git/ref/heads/main'))?.object?.sha;
      if(approvalProvenance.mode===OWNER_MODE) requireCurrentOwnerDecision(deps.now?.()??Date.now(),env.AURORA_ACTIVE_RELEASE_REVIEW_PR);
      return currentMainSha;
    },approvalProvenance);
  return {status:'ACTIVE_PIN_PUBLISHED',sourceSha:certificate.sourceSha,certificateSha256:verified.certificateSha256,
    releaseRunId:certificate.releaseRunId,deviceInstallationVerified:false};
}

/** Compare-and-swap and immutable predecessor history use the existing Firestore only. */
export function firestoreReleaseCommit(database) {
  return async(envelope,expectedPrevious,certificateSha256,publicKey,readCurrentMainSha,approvalProvenance)=>{
    const incoming=verifyActiveReleaseEnvelope(envelope,publicKey);
    if(incoming.status!=='CANDIDATE_UNVERIFIED'||incoming.certificateSha256!==certificateSha256) fail('SIGNED_CANDIDATE_REJECTED');
    if(incoming.certificate.schemaVersion!==2)fail('FULL_COMPONENT_RELEASE_REQUIRED');
    if(typeof readCurrentMainSha!=='function') fail('CURRENT_MAIN_PROOF_REQUIRED');
    if(!approvalProvenance||![PR_MODE,OWNER_MODE].includes(approvalProvenance.mode)
      ||approvalProvenance.sourceSha!==envelope.certificate.sourceSha||approvalProvenance.releaseRunId!==envelope.certificate.releaseRunId
      ||!id(approvalProvenance.reviewPrNumber)) fail('APPROVAL_PROVENANCE_REQUIRED');
    if(approvalProvenance.mode===OWNER_MODE
      &&(approvalProvenance.ownerDecisionSha256!==ownerDecisionSha256||approvalProvenance.environment!==HML_ENVIRONMENT
        ||approvalProvenance.approverId!==ownerDecision.repositoryOwner.id||approvalProvenance.approverLogin!==ownerDecision.repositoryOwner.login
        ||approvalProvenance.laterMainCodeReviewClaimed!==false||approvalProvenance.independentGithubPullRequestReviewClaimed!==false)) fail('APPROVAL_PROVENANCE_REQUIRED');
    if(approvalProvenance.mode===PR_MODE&&(!sha(approvalProvenance.reviewedHeadSha)
      ||!Number.isSafeInteger(approvalProvenance.reviewerId)||approvalProvenance.reviewerId<1)) fail('APPROVAL_PROVENANCE_REQUIRED');
    const approvalRecord=structuredClone(approvalProvenance);
    return database.runTransaction(async tx=>{
    const active=database.doc(ACTIVE_RELEASE_SOURCE);
    const history=database.doc(`${ACTIVE_RELEASE_SOURCE}/history/release-${envelope.certificate.releaseRunId}`);
    const current=await tx.get(active),oldHistory=await tx.get(history);
    if(oldHistory.exists) fail('RELEASE_HISTORY_ALREADY_EXISTS');
    if(current.exists) {
      const previous=verifyActiveReleaseEnvelope(current.data(),publicKey);
      if(previous.status!=='CANDIDATE_UNVERIFIED'||previous.certificateSha256!==expectedPrevious) fail('ACTIVE_RELEASE_CAS_CONFLICT');
      if(Date.parse(previous.certificate.publishedAtUtc)>=Date.parse(envelope.certificate.publishedAtUtc)) fail('RELEASE_PUBLICATION_REGRESSION');
    }else if(expectedPrevious!=='NONE') fail('ACTIVE_RELEASE_CAS_CONFLICT');
    // Firestore may retry this callback. Recheck GitHub main in every attempt, after reads and just before writes.
    // This minimizes stale promotion; GitHub and Firestore are not a distributed atomic transaction.
    if(await readCurrentMainSha()!==envelope.certificate.sourceSha) fail('CURRENT_MAIN_CONFLICT');
    tx.create(history,{envelope,previousCertificateSha256:expectedPrevious==='NONE'?null:expectedPrevious,
      certificateSha256,createdAtUtc:envelope.certificate.publishedAtUtc,approvalProvenance:approvalRecord});
    tx.set(active,envelope);
    });
  };
}

async function main() {
  const env=process.env,token=env.GH_TOKEN??env.GITHUB_TOKEN;
  if(!token) fail('GITHUB_EVIDENCE_TOKEN_REQUIRED');
  const githubJSON=async path=>{
    const response=await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`,{redirect:'error',signal:AbortSignal.timeout(30_000),
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
    if(!response.ok) fail('GITHUB_EVIDENCE_UNAVAILABLE');return response.json();
  };
  const require=createRequire(new URL('../functions/package.json',import.meta.url));
  const {getApps,initializeApp}=require('firebase-admin/app');
  const {getFirestore}=require('firebase-admin/firestore');
  const app=getApps()[0]??initializeApp({projectId:env.GCLOUD_PROJECT});
  const readManifest=async component=>{
    const names={server:'SERVER',web:'WEB',satellite:'SATELLITE',iaMaster:'IA_MASTER',windowsIntegration:'WINDOWS_INTEGRATION'};
    const path=env[`AURORA_ACTIVE_RELEASE_${names[component]}_MANIFEST`];
    if(!path) fail('RELEASE_MANIFEST_REQUIRED');
    return readFile(path);
  };
  const readPackage=async component=>{
    const names={iaMaster:'IA_MASTER',windowsIntegration:'WINDOWS_INTEGRATION'};
    const manifestPath=env[`AURORA_ACTIVE_RELEASE_${names[component]}_MANIFEST`];
    if(!manifestPath)fail('RELEASE_MANIFEST_REQUIRED');
    const folder=component==='iaMaster'?'ia-master-package':'windows-integration-package';
    return readComponentPackage(resolve(manifestPath,'..',folder),component,env.GITHUB_SHA);
  };
  const result=await publishActiveRelease(env,{githubJSON,readManifest,readPackage,commit:firestoreReleaseCommit(getFirestore(app))});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{const code=/^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message??'')?error.message:'ACTIVE_RELEASE_PUBLICATION_BLOCKED';
    process.stderr.write(JSON.stringify({status:'BLOCKED',code})+'\n');process.exitCode=2;});
}
