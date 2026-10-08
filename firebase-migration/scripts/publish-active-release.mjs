import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACTIVE_RELEASE_SOURCE, ACTIVE_RELEASE_ORIGIN, activeReleaseSigningBytes, verifyActiveReleaseEnvelope } from '../functions/lib/auroraActiveRelease.js';

const REPOSITORY='GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS';
const DEPLOY_WORKFLOW='.github/workflows/deploy-aurora-firebase.yml';
const CI_WORKFLOW='.github/workflows/validate-firestore-migration.yml';
const PUBLISH_JOB='Publish verified canonical active release';
const REQUIRED_DEPLOY_STEPS=['Deploy Functions, Hosting, Rules and indexes','Smoke test private shell and deployed functions',
  'Authenticated smoke test without stored password','Verify canonical source-bound runtime'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new Error(code);};
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const runMatches=(run,sourceSha,path)=>run?.head_sha===sourceSha&&run?.head_branch==='main'&&run?.path===path
  &&run?.repository?.full_name===REPOSITORY&&run?.status==='completed'&&run?.conclusion==='success';

/** Every boolean below is derived from GitHub responses, never caller-supplied success flags. */
export async function verifyProtectedReleaseEvidence(input,githubJSON) {
  const {sourceSha,ciRunId,releaseRunId,reviewPrNumber}=input;
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
  if(!Array.isArray(checks?.check_runs)||!checks.check_runs.length||checks.total_count>checks.check_runs.length
    ||checks.check_runs.some(check=>{
      const currentPublisher=publishJob&&check.name===PUBLISH_JOB&&check.app?.slug==='github-actions'
        &&check.details_url===`https://github.com/${REPOSITORY}/actions/runs/${releaseRunId}/job/${publishJob.id}`;
      return check.head_sha!==sourceSha||(!currentPublisher&&(check.status!=='completed'||check.conclusion!=='success'));
    })) fail('EXACT_CHECKS_NOT_VERIFIED');
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
  const approved=[...latest.values()].some(review=>review.state==='APPROVED'&&review.commit_id===pr.head.sha
    &&review.user.type==='User'&&review.user.id!==pr.user?.id&&['OWNER','MEMBER','COLLABORATOR'].includes(review.author_association));
  if(!approved||[...latest.values()].some(review=>review.state==='CHANGES_REQUESTED')) fail('EXACT_HUMAN_REVIEW_NOT_VERIFIED');
  return {ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true};
}

function manifestComponent(bytes,sourceSha) {
  let manifest;try{manifest=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{fail('INVALID_RELEASE_MANIFEST');}
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.dirty===true) fail('INVALID_RELEASE_MANIFEST');
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
  const checks=await verifyProtectedReleaseEvidence({sourceSha:env.GITHUB_SHA,ciRunId:env.AURORA_ACTIVE_RELEASE_CI_RUN_ID,
    releaseRunId:env.AURORA_ACTIVE_RELEASE_DEPLOY_RUN_ID,reviewPrNumber:env.AURORA_ACTIVE_RELEASE_REVIEW_PR,publisherRunId:env.GITHUB_RUN_ID},deps.githubJSON);
  const components={};
  for(const component of ['server','web','satellite']) {
    const bytes=await deps.readManifest(component);
    if(bytes===undefined&&component==='satellite') continue;
    if(!(bytes instanceof Uint8Array)||bytes.length>65_536) fail('RELEASE_MANIFEST_REQUIRED');
    components[component]=manifestComponent(bytes,env.GITHUB_SHA);
  }
  const publishedAtUtc=new Date(deps.now?.()??Date.now()).toISOString();
  const certificate={schemaVersion:1,sourceSha:env.GITHUB_SHA,productVersion:env.AURORA_ACTIVE_RELEASE_PRODUCT_VERSION,
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
  await deps.commit(envelope,previous,verified.certificateSha256,env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY,
    async()=>(await deps.githubJSON('/git/ref/heads/main'))?.object?.sha);
  return {status:'ACTIVE_PIN_PUBLISHED',sourceSha:certificate.sourceSha,certificateSha256:verified.certificateSha256,
    releaseRunId:certificate.releaseRunId,deviceInstallationVerified:false};
}

/** Compare-and-swap and immutable predecessor history use the existing Firestore only. */
export function firestoreReleaseCommit(database) {
  return async(envelope,expectedPrevious,certificateSha256,publicKey,readCurrentMainSha)=>{
    const incoming=verifyActiveReleaseEnvelope(envelope,publicKey);
    if(incoming.status!=='CANDIDATE_UNVERIFIED'||incoming.certificateSha256!==certificateSha256) fail('SIGNED_CANDIDATE_REJECTED');
    if(typeof readCurrentMainSha!=='function') fail('CURRENT_MAIN_PROOF_REQUIRED');
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
      certificateSha256,createdAtUtc:envelope.certificate.publishedAtUtc});
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
    const path=env[`AURORA_ACTIVE_RELEASE_${component.toUpperCase()}_MANIFEST`];
    if(!path&&component==='satellite') return undefined;
    if(!path) fail('RELEASE_MANIFEST_REQUIRED');
    return readFile(path);
  };
  const result=await publishActiveRelease(env,{githubJSON,readManifest,commit:firestoreReleaseCommit(getFirestore(app))});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{const code=/^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message??'')?error.message:'ACTIVE_RELEASE_PUBLICATION_BLOCKED';
    process.stderr.write(JSON.stringify({status:'BLOCKED',code})+'\n');process.exitCode=2;});
}
