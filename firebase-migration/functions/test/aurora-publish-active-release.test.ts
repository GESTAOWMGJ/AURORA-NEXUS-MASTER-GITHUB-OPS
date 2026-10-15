import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ACTIVE_RELEASE_SOURCE, activeReleaseSigningBytes, verifyActiveReleaseEnvelope } from '../src/auroraActiveRelease.js';
import {publishActiveRelease,firestoreReleaseCommit,verifyProtectedReleaseEvidence} from '../../scripts/publish-active-release.mjs';
const repo='GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS',sourceSha='a'.repeat(40),now=Date.parse('2026-10-07T12:00:00.000Z');
const keys=generateKeyPairSync('ed25519'); // Synthetic private key is exported only to the in-memory env fixture.
const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
const ciRunId='122',releaseRunId='123',reviewPrNumber='42';
function fixture() {
  const steps=['Deploy Functions, Hosting, Rules and indexes','Smoke test private shell and deployed functions','Authenticated smoke test without stored password','Verify canonical source-bound runtime'];
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/main',GITHUB_SHA:sourceSha,GITHUB_RUN_ID:'124',
    GCLOUD_PROJECT:'wmgj-hml-jfn-20260927',AURORA_ACTIVE_RELEASE_SHA:sourceSha,AURORA_ACTIVE_RELEASE_CI_RUN_ID:ciRunId,
    AURORA_ACTIVE_RELEASE_DEPLOY_RUN_ID:releaseRunId,AURORA_ACTIVE_RELEASE_REVIEW_PR:reviewPrNumber,
    AURORA_ACTIVE_RELEASE_PRODUCT_VERSION:'1.0.0-test',AURORA_ACTIVE_RELEASE_PUBLIC_KEY:publicKey,
    AURORA_ACTIVE_RELEASE_PRIVATE_KEY:privateKey,AURORA_ACTIVE_RELEASE_PREVIOUS_SHA256:'NONE'};
  const responses=new Map<string,any>([
    ['/git/ref/heads/main',{object:{sha:sourceSha}}],
    [`/actions/runs/${ciRunId}`,{head_sha:sourceSha,head_branch:'main',path:'.github/workflows/validate-firestore-migration.yml',repository:{full_name:repo},status:'completed',conclusion:'success'}],
    [`/actions/runs/${releaseRunId}`,{head_sha:sourceSha,head_branch:'main',path:'.github/workflows/deploy-aurora-firebase.yml',repository:{full_name:repo},status:'completed',conclusion:'success',event:'workflow_dispatch'}],
    [`/actions/runs/${releaseRunId}/jobs?filter=latest&per_page=100`,{total_count:2,jobs:[{name:'Validate exact main candidate',conclusion:'success'},{name:'Deploy with protected environment',conclusion:'success',steps:steps.map(name=>({name,status:'completed',conclusion:'success'}))}]}],
    [`/commits/${sourceSha}/check-runs?filter=latest&per_page=100`,{total_count:1,check_runs:[{head_sha:sourceSha,status:'completed',conclusion:'success',name:'Synthetic exact CI'}]}],
    [`/pulls/${reviewPrNumber}`,{merged:true,merge_commit_sha:sourceSha,base:{ref:'main',repo:{full_name:repo}},head:{sha:'b'.repeat(40)},user:{id:1}}],
    [`/pulls/${reviewPrNumber}/reviews?per_page=100`,[{state:'APPROVED',commit_id:'b'.repeat(40),user:{id:2,type:'User'},author_association:'OWNER',submitted_at:'2026-10-07T11:00:00Z'}]]
  ]);
  let writes=0,mainReads=0,envelope:any,approvalProvenance:any;
  const githubJSON=async(path:string)=>{if(path==='/git/ref/heads/main')mainReads++;assert.ok(responses.has(path));return structuredClone(responses.get(path));};
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,sourceSha,version:'1.0.0-test',files:{'lib/synthetic.js':'a'.repeat(64)}}));
  const makePackage=(component:string)=>{
    const names=component==='iaMaster'?['server.cjs','studio.cjs','manage.cjs','published-update.cjs','kernel/auroraMasterEngine.js']:
      ['client_agent.py','provider_connectors.py','client_secret_store.py','install_client_agent.py','aurora_cloud_sync.py','aurora_deployment.py','published_release.py'];
    const fileBytes=Object.fromEntries(names.map(name=>[name,Buffer.from('// synthetic '+name)]));
    const files=Object.fromEntries(Object.entries(fileBytes).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));
    const metadata=component==='iaMaster'?{component:'AURORA_IA_MASTER',version:'1.1.0',sourceRevision:sourceSha,dirty:false,nodeMinimumMajor:22,externalAiEnabled:false,files}:
      {schemaVersion:1,component:'AURORA_WINDOWS_INTEGRATION',version:'1.0.4',sourceSha,platform:'windows',files};
    return {manifestBytes:Buffer.from(JSON.stringify(metadata)),fileBytes};
  };
  const packages:any={iaMaster:makePackage('iaMaster'),windowsIntegration:makePackage('windowsIntegration')};
  const deps={githubJSON,readManifest:async(component:string)=>packages[component]?.manifestBytes??manifest,
    readPackage:async(component:string)=>packages[component],now:()=>now,
    commit:async(value:any,...args:any[])=>{writes++;envelope=value;approvalProvenance=args[4];}};
  return {env,responses,deps,packages,writes:()=>writes,envelope:()=>envelope,approvalProvenance:()=>approvalProvenance,mainReads:()=>mainReads};
}

test('publisher derives gates from exact trusted GitHub records and signs only after preflight',async()=>{
  const f=fixture();const result=await publishActiveRelease(f.env,f.deps);
  assert.equal(result.status,'ACTIVE_PIN_PUBLISHED');assert.equal(f.writes(),1);assert.equal(f.mainReads(),2);
  assert.equal(verifyActiveReleaseEnvelope(f.envelope(),publicKey,{now,expectedSourceSha:sourceSha}).status,'CANDIDATE_UNVERIFIED');
  assert.equal('privateKey' in f.envelope(),false);assert.equal(JSON.stringify(f.envelope()).includes('PRIVATE KEY'),false);
  assert.equal(f.envelope().certificate.schemaVersion,2);
  assert.deepEqual(Object.keys(f.envelope().certificate.components),['server','web','satellite','iaMaster','windowsIntegration']);
  assert.equal(f.envelope().certificate.components.windowsIntegration.version,'1.0.4');
});

for(const missing of ['AURORA_ACTIVE_RELEASE_PUBLIC_KEY','AURORA_ACTIVE_RELEASE_PRIVATE_KEY','AURORA_ACTIVE_RELEASE_PREVIOUS_SHA256']) test(`publisher missing ${missing} cannot mutate`,async()=>{
  const f=fixture();delete (f.env as any)[missing];await assert.rejects(publishActiveRelease(f.env,f.deps));assert.equal(f.writes(),0);
});

for(const scenario of ['main advanced','CI failed','CI wrong SHA','deploy pending','review missing','review stale head','canonical smoke absent','other check pending']) test(`publisher rejects ${scenario} before mutation`,async()=>{
  const f=fixture();
  if(scenario==='main advanced')f.responses.get('/git/ref/heads/main').object.sha='c'.repeat(40);
  if(scenario==='CI failed')f.responses.get(`/actions/runs/${ciRunId}`).conclusion='failure';
  if(scenario==='CI wrong SHA')f.responses.get(`/actions/runs/${ciRunId}`).head_sha='c'.repeat(40);
  if(scenario==='deploy pending')f.responses.get(`/actions/runs/${releaseRunId}`).status='in_progress';
  if(scenario==='review missing')f.responses.set(`/pulls/${reviewPrNumber}/reviews?per_page=100`,[]);
  if(scenario==='review stale head')f.responses.get(`/pulls/${reviewPrNumber}/reviews?per_page=100`)[0].commit_id='c'.repeat(40);
  if(scenario==='canonical smoke absent')f.responses.get(`/actions/runs/${releaseRunId}/jobs?filter=latest&per_page=100`).jobs[1].steps.pop();
  if(scenario==='other check pending')f.responses.get(`/commits/${sourceSha}/check-runs?filter=latest&per_page=100`).check_runs[0].status='in_progress';
  await assert.rejects(publishActiveRelease(f.env,f.deps));assert.equal(f.writes(),0);
});

test('a publisher job may follow terminal deploy in its same run but cannot ignore other pending CI',async()=>{
  const f=fixture();f.env.GITHUB_RUN_ID=releaseRunId;f.responses.get(`/actions/runs/${releaseRunId}`).status='in_progress';
  const jobs=f.responses.get(`/actions/runs/${releaseRunId}/jobs?filter=latest&per_page=100`);jobs.total_count=3;
  jobs.jobs.push({name:'Publish verified canonical active release',id:999,status:'in_progress'});
  const checks=f.responses.get(`/commits/${sourceSha}/check-runs?filter=latest&per_page=100`);checks.total_count=2;
  checks.check_runs.push({head_sha:sourceSha,name:'Publish verified canonical active release',status:'in_progress',app:{slug:'github-actions'},details_url:`https://github.com/${repo}/actions/runs/${releaseRunId}/job/999`});
  await publishActiveRelease(f.env,f.deps);assert.equal(f.writes(),1);
  checks.check_runs[0].status='in_progress';await assert.rejects(publishActiveRelease(f.env,f.deps));assert.equal(f.writes(),1);
});

test('late main advance and different artifact identity block after initial gate verification',async()=>{
  const f=fixture();const original=f.deps.githubJSON;let calls=0;
  f.deps.githubJSON=async(path:string)=>path==='/git/ref/heads/main'&&++calls>1?{object:{sha:'c'.repeat(40)}}:original(path);
  await assert.rejects(publishActiveRelease(f.env,f.deps));assert.equal(f.writes(),0);
  const altered=fixture();altered.deps.readManifest=async()=>Buffer.from(JSON.stringify({sourceSha:'c'.repeat(40),version:'1.0.0-test',files:{'lib/x.js':'a'.repeat(64)}}));
  await assert.rejects(publishActiveRelease(altered.env,altered.deps));assert.equal(altered.writes(),0);
});

test('latest dismissed or changes-requested review never inherits an old approval',async()=>{
  for(const state of ['DISMISSED','CHANGES_REQUESTED']) {
    const f=fixture();f.responses.get(`/pulls/${reviewPrNumber}/reviews?per_page=100`).push({state,commit_id:'b'.repeat(40),user:{id:2,type:'User'},author_association:'OWNER',submitted_at:'2026-10-07T11:30:00Z'});
    await assert.rejects(verifyProtectedReleaseEvidence({sourceSha,ciRunId,releaseRunId,reviewPrNumber},f.deps.githubJSON));
  }
});

test('CAS preserves current pointer and history on mismatch; history is create-only',async()=>{
  const f=fixture();await publishActiveRelease(f.env,f.deps);const signed=f.envelope();
  const candidate=verifyActiveReleaseEnvelope(signed,publicKey,{now});assert.equal(candidate.status,'CANDIDATE_UNVERIFIED');
  if(candidate.status!=='CANDIDATE_UNVERIFIED')throw new Error('synthetic fixture');
  const rows=new Map<string,any>();
  const database={doc:(path:string)=>({path}),runTransaction:async(body:any)=>{
    const draft=new Map([...rows].map(([key,value])=>[key,structuredClone(value)]));let wrote=false;
    const tx={get:async(ref:any)=>{assert.equal(wrote,false);return {exists:draft.has(ref.path),data:()=>draft.get(ref.path)};},
      create:(ref:any,value:any)=>{wrote=true;assert.equal(draft.has(ref.path),false);draft.set(ref.path,structuredClone(value));},
      set:(ref:any,value:any)=>{wrote=true;draft.set(ref.path,structuredClone(value));}};
    await body(tx);rows.clear();draft.forEach((value,key)=>rows.set(key,value));
  }};
  const commit=firestoreReleaseCommit(database);
  const readMain=async()=>sourceSha;
  await assert.rejects(commit(signed,'a'.repeat(64),candidate.certificateSha256,publicKey,readMain,f.approvalProvenance()));assert.equal(rows.size,0);
  await commit(signed,'NONE',candidate.certificateSha256,publicKey,readMain,f.approvalProvenance());assert.equal(rows.size,2);const before=JSON.stringify([...rows]);
  await assert.rejects(commit(signed,'NONE',candidate.certificateSha256,publicKey,readMain,f.approvalProvenance()));assert.equal(JSON.stringify([...rows]),before);
  assert.equal(rows.get(ACTIVE_RELEASE_SOURCE).certificate.sourceSha,sourceSha);
  assert.equal(rows.has(`${ACTIVE_RELEASE_SOURCE}/history/release-${releaseRunId}`),true);
  await assert.rejects(commit({...signed,signature:'a'.repeat(86)},'NONE',candidate.certificateSha256,publicKey,readMain,f.approvalProvenance()));assert.equal(JSON.stringify([...rows]),before);
});

test('transaction retry after main advances discards candidate writes and preserves prior storage',async()=>{
  const f=fixture();await publishActiveRelease(f.env,f.deps);const signed=f.envelope();
  const candidate=verifyActiveReleaseEnvelope(signed,publicKey,{now});if(candidate.status!=='CANDIDATE_UNVERIFIED')throw new Error('synthetic fixture');
  let main=sourceSha,attempts=0,proofReads=0,committed=0;
  const database={doc:(path:string)=>({path}),runTransaction:async(body:any)=>{
    const transaction=()=>{let wrote=false;return {get:async()=>{assert.equal(wrote,false);return {exists:false};},create:()=>{wrote=true;},set:()=>{wrote=true;}};};
    attempts++;await body(transaction()); // Simulate a discarded attempt, with no persisted write.
    main='c'.repeat(40);attempts++;await body(transaction());committed++;
  }};
  const commit=firestoreReleaseCommit(database);
  await assert.rejects(commit(signed,'NONE',candidate.certificateSha256,publicKey,async()=>{proofReads++;return main;},f.approvalProvenance()),/CURRENT_MAIN_CONFLICT/);
  assert.equal(attempts,2);assert.equal(proofReads,2);assert.equal(committed,0);
});

test('publisher wires its real transaction adapter with a fresh main-proof callback',async()=>{
  const f=fixture();const rows=new Map<string,any>();
  const database={doc:(path:string)=>({path}),runTransaction:async(body:any)=>{
    const draft=new Map(rows);let wrote=false;
    const tx={get:async(ref:any)=>{assert.equal(wrote,false);return {exists:draft.has(ref.path),data:()=>draft.get(ref.path)};},
      create:(ref:any,value:any)=>{wrote=true;assert.equal(draft.has(ref.path),false);draft.set(ref.path,structuredClone(value));},
      set:(ref:any,value:any)=>{wrote=true;draft.set(ref.path,structuredClone(value));}};
    await body(tx);rows.clear();draft.forEach((value,key)=>rows.set(key,value));
  }};
  const result=await publishActiveRelease(f.env,{...f.deps,commit:firestoreReleaseCommit(database)});
  assert.equal(result.status,'ACTIVE_PIN_PUBLISHED');assert.equal(f.mainReads(),3);assert.equal(rows.size,2);
  assert.equal(rows.get(ACTIVE_RELEASE_SOURCE).certificate.sourceSha,sourceSha);
  assert.deepEqual(rows.get(`${ACTIVE_RELEASE_SOURCE}/history/release-${releaseRunId}`).approvalProvenance,
    {mode:'GITHUB_PULL_REQUEST_REVIEW',sourceSha,releaseRunId,reviewPrNumber,reviewedHeadSha:'b'.repeat(40),reviewerId:2,reviewerLogin:null});
});

const owner={login:'GESTAOWMGJ',id:278915189,type:'User'},ownerNow=Date.parse('2026-10-08T00:00:00.000Z');
const ownerDecision=JSON.parse(readFileSync(new URL('../../policy/hml-owner-release-approval-v1.json',import.meta.url),'utf8'));
function ownerFixture() {
  const f=fixture();Object.assign(f.env,{GITHUB_RUN_ID:releaseRunId,GITHUB_ACTOR:owner.login,GITHUB_ACTOR_ID:String(owner.id),
    AURORA_ACTIVE_RELEASE_REVIEW_MODE:'OWNER_DEPLOYMENT_APPROVAL',AURORA_ACTIVE_RELEASE_DEPLOYMENT_ENVIRONMENT:'firebase-homologation'});
  f.deps.now=()=>ownerNow;
  Object.assign(f.responses.get(`/actions/runs/${releaseRunId}`),{actor:structuredClone(owner),triggering_actor:structuredClone(owner)});
  f.responses.set(`/pulls/${reviewPrNumber}/reviews?per_page=100`,[]);
  f.responses.set('/environments/firebase-homologation',{id:100,name:'firebase-homologation',can_admins_bypass:true,
    deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
    protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:structuredClone(owner)}]}]});
  f.responses.set('/environments/firebase-homologation/deployment-branch-policies?per_page=100',
    {total_count:1,branch_policies:[{name:'main',type:'branch'}]});
  f.responses.set(`/actions/runs/${releaseRunId}/approvals`,[{state:'approved',user:structuredClone(owner),environments:[{id:100,name:'firebase-homologation'}]}]);
  for(const pr of ownerDecision.reviewedPullRequests) f.responses.set(`/pulls/${pr.number}`,
    {merged:true,head:{sha:pr.headSha},base:{ref:'main',repo:{full_name:repo}}});
  return f;
}

test('HML owner mode consumes real deployment approval and preserves original chat review scope',async()=>{
  const f=ownerFixture();await publishActiveRelease(f.env,f.deps);
  assert.equal(f.writes(),1);const proof=f.approvalProvenance();
  assert.equal(proof.mode,'OWNER_DEPLOYMENT_APPROVAL');assert.equal(proof.approverLogin,owner.login);
  assert.equal(proof.approvalSource,'DIRECT_OWNER_CHAT');assert.match(proof.ownerDecisionSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(proof.reviewedPullRequests,ownerDecision.reviewedPullRequests);
  assert.deepEqual(proof.approvalReaffirmations,ownerDecision.reaffirmations);
  assert.equal(proof.laterMainCodeReviewClaimed,false);assert.equal(proof.independentGithubPullRequestReviewClaimed,false);
  assert.equal(proof.riskAcceptance.status,'ACCEPTED_BY_OWNER_HML_TEST_TOOLS_ONLY');
  assert.equal('approvalProvenance' in f.envelope().certificate,false);
  assert.equal(verifyActiveReleaseEnvelope(f.envelope(),publicKey,{now:ownerNow}).status,'CANDIDATE_UNVERIFIED');
});

test('explicit owner renewal preserves earlier decisions and still rejects promotion at the new deadline',async()=>{
  assert.equal(ownerDecision.recordedOn,'2026-10-08');
  assert.equal(ownerDecision.scope.validUntilUtc,'2026-10-16T03:00:00.000Z');
  assert.equal(ownerDecision.riskAcceptance.reviewBy,'2026-10-15');
  assert.equal(ownerDecision.reaffirmations[0].recordedOn,'2026-10-12');
  assert.equal(ownerDecision.reaffirmations[0].originalScopeUnchanged,true);
  assert.equal(ownerDecision.reaffirmations[0].riskReviewDeadlineExtended,false);
  const renewal=ownerDecision.reaffirmations[1];
  assert.equal(renewal.decisionId,'AURORA-HML-OWNER-RENEWAL-20261014');
  assert.equal(renewal.approvalSource,'DIRECT_OWNER_CHAT');
  assert.equal(renewal.previousValidUntilUtc,'2026-10-15T03:00:00.000Z');
  assert.equal(renewal.validUntilUtc,ownerDecision.scope.validUntilUtc);
  assert.equal(renewal.reviewBy,ownerDecision.riskAcceptance.reviewBy);
  assert.equal(renewal.originalScopeUnchanged,true);assert.equal(renewal.riskReviewDeadlineExtended,true);
  assert.equal(renewal.protectedRunOwnerApprovalStillRequired,true);
  assert.equal(renewal.laterMainCodeReviewClaimed,false);assert.equal(renewal.independentGithubPullRequestReviewClaimed,false);
  assert.equal(renewal.productionAuthorized,false);assert.equal(renewal.clinicalSensitiveAuthorized,false);
  assert.deepEqual(renewal.residual,{critical:0,high:7,moderate:4,total:11});
  const current=ownerFixture();current.deps.now=()=>Date.parse('2026-10-12T18:00:00Z');
  await publishActiveRelease(current.env,current.deps);assert.equal(current.writes(),1);
  const renewed=ownerFixture();renewed.deps.now=()=>Date.parse(renewal.previousValidUntilUtc);
  await publishActiveRelease(renewed.env,renewed.deps);assert.equal(renewed.writes(),1);
  const expired=ownerFixture();expired.deps.now=()=>Date.parse(ownerDecision.scope.validUntilUtc);
  await assert.rejects(publishActiveRelease(expired.env,expired.deps),/OWNER_APPROVAL_EXPIRED/);assert.equal(expired.writes(),0);
});

test('pre-cloud workflow gate requires signed promotion when a canonical public key is configured',()=>{
  const workflow=readFileSync(new URL('../../../.github/workflows/deploy-aurora-firebase.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const preflight=workflow.split('      - name: Require canonical publisher configuration before cloud changes')[1]
    .split('      - name: Require protected deployment configuration')[0];
  const source=preflight.split("node - <<'NODE'\n")[1].split('\n          NODE')[0];
  const invoke=(env:Record<string,string>)=>spawnSync(process.execPath,['-'],{input:source,encoding:'utf8',env});
  const configured={AURORA_ACTIVE_RELEASE_PUBLIC_KEY:publicKey,AURORA_ACTIVE_RELEASE_PRIVATE_KEY:privateKey,
    RELEASE_CI_RUN_ID:ciRunId,RELEASE_REVIEW_PR:reviewPrNumber,RELEASE_PREVIOUS_SHA256:'NONE'};
  const skipped=invoke({...configured,PUBLISH_ACTIVE_RELEASE:'false'});
  assert.notEqual(skipped.status,0);assert.match(skipped.stderr,/CANONICAL_RELEASE_PROMOTION_REQUIRED/);
  assert.equal(invoke({...configured,PUBLISH_ACTIVE_RELEASE:'true'}).status,0);
  assert.notEqual(invoke({...configured,PUBLISH_ACTIVE_RELEASE:'true',RELEASE_PREVIOUS_SHA256:''}).status,0);
});

for(const scenario of ['no approval','rejected approval','approval different environment','approval different owner','approval bot',
  'actor different owner','actor bot','triggering actor different owner','environment no reviewers','owner no longer reviewer',
  'self review prohibited','branch wildcard','extra branch allowed','branch evidence incomplete','project production','environment production',
  'different publisher run','runner actor forged','owner decision expired','invalid clock','original reviewed head changed',
  'original PR not merged','current integration PR not merged','changes requested','unknown mode']) test(`HML owner mode rejects ${scenario} before mutation`,async()=>{
  const f=ownerFixture(),release=f.responses.get(`/actions/runs/${releaseRunId}`),environment=f.responses.get('/environments/firebase-homologation');
  const approvals=f.responses.get(`/actions/runs/${releaseRunId}/approvals`),branches=f.responses.get('/environments/firebase-homologation/deployment-branch-policies?per_page=100');
  if(scenario==='no approval')f.responses.set(`/actions/runs/${releaseRunId}/approvals`,[]);
  if(scenario==='rejected approval')approvals.push({...approvals[0],state:'rejected'});
  if(scenario==='approval different environment')approvals[0].environments[0].id=101;
  if(scenario==='approval different owner')approvals[0].user={...owner,id:3,login:'other'};
  if(scenario==='approval bot')approvals[0].user.type='Bot';
  if(scenario==='actor different owner')release.actor={...owner,id:3,login:'other'};
  if(scenario==='actor bot')release.actor.type='Bot';
  if(scenario==='triggering actor different owner')release.triggering_actor={...owner,id:3,login:'other'};
  if(scenario==='environment no reviewers')environment.protection_rules=[];
  if(scenario==='owner no longer reviewer')environment.protection_rules[0].reviewers=[];
  if(scenario==='self review prohibited')environment.protection_rules[0].prevent_self_review=true;
  if(scenario==='branch wildcard')branches.branch_policies[0].name='*';
  if(scenario==='extra branch allowed'){branches.total_count=2;branches.branch_policies.push({name:'develop',type:'branch'});}
  if(scenario==='branch evidence incomplete')branches.total_count=2;
  if(scenario==='project production')f.env.GCLOUD_PROJECT='production';
  if(scenario==='environment production')(f.env as any).AURORA_ACTIVE_RELEASE_DEPLOYMENT_ENVIRONMENT='firebase-production';
  if(scenario==='different publisher run')f.env.GITHUB_RUN_ID='124';
  if(scenario==='runner actor forged')(f.env as any).GITHUB_ACTOR='other';
  if(scenario==='owner decision expired')f.deps.now=()=>Date.parse(ownerDecision.scope.validUntilUtc);
  if(scenario==='invalid clock')f.deps.now=()=>NaN;
  if(scenario==='original reviewed head changed')f.responses.get('/pulls/190').head.sha='c'.repeat(40);
  if(scenario==='original PR not merged')f.responses.get('/pulls/190').merged=false;
  if(scenario==='current integration PR not merged')f.responses.get(`/pulls/${reviewPrNumber}`).merged=false;
  if(scenario==='changes requested')f.responses.get(`/pulls/${reviewPrNumber}/reviews?per_page=100`).push(
    {state:'CHANGES_REQUESTED',commit_id:'b'.repeat(40),user:{id:3,type:'User'},submitted_at:'2026-10-08T07:00:00Z'});
  if(scenario==='unknown mode')(f.env as any).AURORA_ACTIVE_RELEASE_REVIEW_MODE='APPROVED';
  await assert.rejects(publishActiveRelease(f.env,f.deps));assert.equal(f.writes(),0);
});

test('owner mode still rejects every existing main, CI, smoke and other-check gate',async()=>{
  for(const scenario of ['main','CI','smoke','check']) {
    const f=ownerFixture();
    if(scenario==='main')f.responses.get('/git/ref/heads/main').object.sha='c'.repeat(40);
    if(scenario==='CI')f.responses.get(`/actions/runs/${ciRunId}`).conclusion='failure';
    if(scenario==='smoke')f.responses.get(`/actions/runs/${releaseRunId}/jobs?filter=latest&per_page=100`).jobs[1].steps.pop();
    if(scenario==='check')f.responses.get(`/commits/${sourceSha}/check-runs?filter=latest&per_page=100`).check_runs[0].status='in_progress';
    await assert.rejects(publishActiveRelease(f.env,f.deps));assert.equal(f.writes(),0);
  }
});

test('unavailable environment, branch, approval or original review evidence never falls back to a caller claim',async()=>{
  for(const unavailable of ['/environments/firebase-homologation',
    '/environments/firebase-homologation/deployment-branch-policies?per_page=100',
    `/actions/runs/${releaseRunId}/approvals`,'/pulls/190']) {
    const f=ownerFixture(),original=f.deps.githubJSON;
    f.deps.githubJSON=async(path:string)=>{if(path===unavailable)throw new Error('GITHUB_EVIDENCE_UNAVAILABLE');return original(path);};
    await assert.rejects(publishActiveRelease(f.env,f.deps),/GITHUB_EVIDENCE_UNAVAILABLE/);assert.equal(f.writes(),0);
  }
});

test('owner scope expiration during a transaction retry prevents its atomic write',async()=>{
  const f=ownerFixture();let clock=ownerNow,committed=0,attempts=0;f.deps.now=()=>clock;
  const database={doc:(path:string)=>({path}),runTransaction:async(body:any)=>{
    const tx=()=>({get:async()=>({exists:false}),create:()=>{},set:()=>{}});
    attempts++;await body(tx());clock=Date.parse(ownerDecision.scope.validUntilUtc);attempts++;await body(tx());committed++;
  }};
  await assert.rejects(publishActiveRelease(f.env,{...f.deps,commit:firestoreReleaseCommit(database)}),/OWNER_APPROVAL_EXPIRED/);
  assert.equal(attempts,2);assert.equal(committed,0);
});

test('owner scope expiration crossed by the final GitHub await prevents writes in the same transaction attempt',async()=>{
  const f=ownerFixture();let clock=ownerNow,writes=0,committed=0;f.deps.now=()=>clock;
  const original=f.deps.githubJSON;
  f.deps.githubJSON=async(path:string)=>{
    const value=await original(path);
    if(path==='/git/ref/heads/main'&&f.mainReads()===3)clock=Date.parse(ownerDecision.scope.validUntilUtc);
    return value;
  };
  const database={doc:(path:string)=>({path}),runTransaction:async(body:any)=>{
    await body({get:async()=>({exists:false}),create:()=>{writes++;},set:()=>{writes++;}});committed++;
  }};
  await assert.rejects(publishActiveRelease(f.env,{...f.deps,commit:firestoreReleaseCommit(database)}),/OWNER_APPROVAL_EXPIRED/);
  assert.equal(f.mainReads(),3);assert.equal(writes,0);assert.equal(committed,0);
});

test('owner provenance is stored atomically alongside history without altering the signed envelope schema',async()=>{
  const f=ownerFixture();const rows=new Map<string,any>();
  const database={doc:(path:string)=>({path}),runTransaction:async(body:any)=>{
    const draft=new Map(rows);let wrote=false;
    const tx={get:async(ref:any)=>{assert.equal(wrote,false);return {exists:draft.has(ref.path),data:()=>draft.get(ref.path)};},
      create:(ref:any,value:any)=>{wrote=true;assert.equal(draft.has(ref.path),false);draft.set(ref.path,structuredClone(value));},
      set:(ref:any,value:any)=>{wrote=true;draft.set(ref.path,structuredClone(value));}};
    await body(tx);rows.clear();draft.forEach((value,key)=>rows.set(key,value));
  }};
  await publishActiveRelease(f.env,{...f.deps,commit:firestoreReleaseCommit(database)});
  const history=rows.get(`${ACTIVE_RELEASE_SOURCE}/history/release-${releaseRunId}`);
  assert.equal(rows.size,2);assert.equal(history.approvalProvenance.mode,'OWNER_DEPLOYMENT_APPROVAL');
  assert.equal(history.approvalProvenance.releaseRunId,releaseRunId);assert.equal(history.approvalProvenance.laterMainCodeReviewClaimed,false);
  assert.equal(verifyActiveReleaseEnvelope(rows.get(ACTIVE_RELEASE_SOURCE),publicKey,{now:ownerNow}).status,'CANDIDATE_UNVERIFIED');
});

test('publisher GitHub token remains read-only for approvals and the owner mode is explicit in workflow inputs',()=>{
  const workflow=readFileSync(new URL('../../../.github/workflows/deploy-aurora-firebase.yml',import.meta.url),'utf8');
  const publisher=workflow.split('  publish-active-release:')[1],permissions=publisher.split('    permissions:')[1].split('    steps:')[0];
  assert.match(permissions,/actions: read/);assert.match(permissions,/pull-requests: read/);
  assert.doesNotMatch(permissions,/(?:actions|pull-requests|deployments): write/);
  assert.ok(publisher.includes('GH_TOKEN: ${{ github.token }}'));assert.ok(publisher.includes('environment: firebase-homologation'));
  assert.ok(workflow.includes('default: GITHUB_PULL_REQUEST_REVIEW'));assert.ok(workflow.includes('AURORA_ACTIVE_RELEASE_REVIEW_MODE: ${{ inputs.active_release_review_mode }}'));
});

// Regression: GitHub filter=latest retains separate workflow_dispatch check suites.
function historicalDeployFixture() {
  const f=fixture(),oldId='120';
  Object.assign(f.responses.get(`/actions/runs/${releaseRunId}`),{id:123,workflow_id:500,run_number:20,created_at:'2026-10-07T11:00:00Z'});
  const oldRun={...structuredClone(f.responses.get(`/actions/runs/${releaseRunId}`)),id:120,run_number:19,created_at:'2026-10-07T10:00:00Z',conclusion:'failure'};
  const check={head_sha:sourceSha,name:'Deploy with protected environment',status:'completed',conclusion:'failure',app:{slug:'github-actions'},details_url:`https://github.com/${repo}/actions/runs/${oldId}/job/900`};
  const job={id:900,name:check.name,status:'completed',conclusion:'failure'};
  f.responses.set(`/actions/runs/${oldId}`,oldRun);
  f.responses.set(`/actions/runs/${oldId}/jobs?filter=latest&per_page=100`,{total_count:1,jobs:[job]});
  const checks=f.responses.get(`/commits/${sourceSha}/check-runs?filter=latest&per_page=100`);
  checks.check_runs.push(check);checks.total_count++;
  return {...f,check,oldRun,job,oldId};
}

for(const conclusion of ['failure','skipped','cancelled']) test(`completed historical deploy ${conclusion} does not poison a verified replacement`,async()=>{
  const f=historicalDeployFixture();f.check.conclusion=conclusion;f.job.conclusion=conclusion;
  await publishActiveRelease(f.env,f.deps);assert.equal(f.writes(),1);
});

for(const scenario of ['other workflow','other workflow ID','other SHA','other branch','other repository','other event','other app','other job name',
  'foreign URL','unknown job','incomplete jobs','job name mismatch','old run pending','job pending','newer run','missing run ordering',
  'failed security check','pending security check','current deploy failure','unavailable provenance']) test(`historical check exception rejects ${scenario}`,async()=>{
  const f=historicalDeployFixture();
  if(scenario==='other workflow')f.oldRun.path='.github/workflows/security.yml';
  if(scenario==='other workflow ID')f.oldRun.workflow_id=501;
  if(scenario==='other SHA')f.oldRun.head_sha='c'.repeat(40);
  if(scenario==='other branch')f.oldRun.head_branch='other';
  if(scenario==='other repository')f.oldRun.repository.full_name='other/repo';
  if(scenario==='other event')f.oldRun.event='pull_request';
  if(scenario==='other app')f.check.app.slug='untrusted';
  if(scenario==='other job name')f.check.name='CodeQL';
  if(scenario==='foreign URL')f.check.details_url=f.check.details_url.replace(repo,'other/repo');
  if(scenario==='unknown job')f.job.id=901;
  if(scenario==='incomplete jobs')f.responses.get(`/actions/runs/${f.oldId}/jobs?filter=latest&per_page=100`).total_count=2;
  if(scenario==='job name mismatch')f.job.name='Other';
  if(scenario==='old run pending')f.oldRun.status='in_progress';
  if(scenario==='job pending')f.job.status='in_progress';
  if(scenario==='newer run')f.oldRun.run_number=21;
  if(scenario==='missing run ordering')delete (f.oldRun as any).created_at;
  if(scenario==='failed security check'||scenario==='pending security check'){
    const check=f.responses.get(`/commits/${sourceSha}/check-runs?filter=latest&per_page=100`).check_runs[0];
    check.conclusion='failure';if(scenario==='pending security check')check.status='in_progress';
  }
  if(scenario==='current deploy failure')f.responses.get(`/actions/runs/${releaseRunId}/jobs?filter=latest&per_page=100`).jobs[1].conclusion='failure';
  if(scenario==='unavailable provenance')f.responses.delete(`/actions/runs/${f.oldId}`);
  await assert.rejects(publishActiveRelease(f.env,f.deps));assert.equal(f.writes(),0);
});

test('current publisher exception and historical dispatch selection coexist without hiding a new security failure',async()=>{
  const f=historicalDeployFixture();f.env.GITHUB_RUN_ID=releaseRunId;
  f.responses.get(`/actions/runs/${releaseRunId}`).status='in_progress';
  const jobs=f.responses.get(`/actions/runs/${releaseRunId}/jobs?filter=latest&per_page=100`);
  jobs.jobs.push({id:999,name:'Publish verified canonical active release',status:'in_progress'});jobs.total_count++;
  const checks=f.responses.get(`/commits/${sourceSha}/check-runs?filter=latest&per_page=100`);
  checks.check_runs.push({head_sha:sourceSha,name:'Publish verified canonical active release',status:'in_progress',app:{slug:'github-actions'},details_url:`https://github.com/${repo}/actions/runs/${releaseRunId}/job/999`});checks.total_count++;
  await publishActiveRelease(f.env,f.deps);assert.equal(f.writes(),1);
  checks.check_runs[0].conclusion='failure';
  await assert.rejects(publishActiveRelease(f.env,f.deps),/EXACT_CHECKS_NOT_VERIFIED/);assert.equal(f.writes(),1);
});

for(const component of ['server','web','satellite','iaMaster','windowsIntegration'])test(`v2 publication missing ${component} cannot write`,async()=>{
  const f=fixture(),read=f.deps.readManifest;f.deps.readManifest=async(name)=>name===component?undefined as any:read(name);
  await assert.rejects(publishActiveRelease(f.env,f.deps),/RELEASE_MANIFEST_REQUIRED/);assert.equal(f.writes(),0);
});
for(const scenario of ['missing reader','changed file','extra file','substituted manifest'])test(`v2 actual component bytes reject ${scenario}`,async()=>{
  const f=fixture();
  if(scenario==='missing reader')delete(f.deps as any).readPackage;
  if(scenario==='changed file')f.packages.iaMaster.fileBytes['server.cjs']=Buffer.from('changed');
  if(scenario==='extra file')f.packages.windowsIntegration.fileBytes['control.key']=Buffer.from('synthetic extra');
  if(scenario==='substituted manifest')f.deps.readPackage=async(component)=>({...f.packages[component],manifestBytes:Buffer.from('{}')});
  await assert.rejects(publishActiveRelease(f.env,f.deps),/RELEASE_COMPONENT_FILES/);assert.equal(f.writes(),0);
});
test('atomic writer refuses a new v1 promotion, while predecessor verification remains compatible',async()=>{
  const f=fixture();await publishActiveRelease(f.env,f.deps);const c=structuredClone(f.envelope().certificate);c.schemaVersion=1;
  delete c.components.iaMaster;delete c.components.windowsIntegration;
  const signed={certificate:c,signature:sign(null,activeReleaseSigningBytes(c),keys.privateKey).toString('base64url')};
  const candidate=verifyActiveReleaseEnvelope(signed,publicKey,{now});assert.equal(candidate.status,'CANDIDATE_UNVERIFIED');
  if(candidate.status!=='CANDIDATE_UNVERIFIED')throw Error('synthetic fixture');
  let transactions=0;const db={doc:(path:string)=>({path}),runTransaction:async()=>{transactions++;}};
  await assert.rejects(firestoreReleaseCommit(db)(signed,'NONE',candidate.certificateSha256,publicKey,async()=>sourceSha,f.approvalProvenance()),/FULL_COMPONENT_RELEASE_REQUIRED/);
  assert.equal(transactions,0);
});

test('v2 promotion preserves a verified historical v1 predecessor and its exact CAS hash',async()=>{
  const f=fixture();await publishActiveRelease(f.env,f.deps);const incoming=f.envelope();
  const certificate=structuredClone(incoming.certificate);certificate.schemaVersion=1;
  delete certificate.components.iaMaster;delete certificate.components.windowsIntegration;
  certificate.releaseRunId='121';certificate.publishedAtUtc='2026-10-07T11:00:00.000Z';
  const predecessor={certificate,signature:sign(null,activeReleaseSigningBytes(certificate),keys.privateKey).toString('base64url')};
  const prior=verifyActiveReleaseEnvelope(predecessor,publicKey,{now}),next=verifyActiveReleaseEnvelope(incoming,publicKey,{now});
  assert.equal(prior.status,'CANDIDATE_UNVERIFIED');assert.equal(next.status,'CANDIDATE_UNVERIFIED');
  if(prior.status!=='CANDIDATE_UNVERIFIED'||next.status!=='CANDIDATE_UNVERIFIED')throw Error('synthetic fixture');
  const oldHistory=`${ACTIVE_RELEASE_SOURCE}/history/release-121`,newHistory=`${ACTIVE_RELEASE_SOURCE}/history/release-${releaseRunId}`;
  const rows=new Map<string,any>([[ACTIVE_RELEASE_SOURCE,predecessor],[oldHistory,{envelope:structuredClone(predecessor)}]]);
  const before=JSON.stringify(rows.get(oldHistory));
  const database={doc:(path:string)=>({path}),runTransaction:async(body:any)=>{
    const draft=new Map([...rows].map(([path,value])=>[path,structuredClone(value)]));let wrote=false;
    const tx={get:async(ref:any)=>{assert.equal(wrote,false);return {exists:draft.has(ref.path),data:()=>draft.get(ref.path)};},
      create:(ref:any,value:any)=>{wrote=true;assert.equal(draft.has(ref.path),false);draft.set(ref.path,structuredClone(value));},
      set:(ref:any,value:any)=>{wrote=true;draft.set(ref.path,structuredClone(value));}};
    await body(tx);rows.clear();draft.forEach((value,key)=>rows.set(key,value));
  }};
  await firestoreReleaseCommit(database)(incoming,prior.certificateSha256,next.certificateSha256,publicKey,async()=>sourceSha,f.approvalProvenance());
  assert.equal(rows.get(ACTIVE_RELEASE_SOURCE).certificate.schemaVersion,2);
  assert.equal(rows.get(newHistory).previousCertificateSha256,prior.certificateSha256);
  assert.equal(JSON.stringify(rows.get(oldHistory)),before);
});
