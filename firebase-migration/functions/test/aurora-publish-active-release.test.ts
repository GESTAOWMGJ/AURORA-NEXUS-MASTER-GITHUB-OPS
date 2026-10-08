import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { ACTIVE_RELEASE_SOURCE, verifyActiveReleaseEnvelope } from '../src/auroraActiveRelease.js';
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
  let writes=0,mainReads=0,envelope:any;
  const githubJSON=async(path:string)=>{if(path==='/git/ref/heads/main')mainReads++;assert.ok(responses.has(path));return structuredClone(responses.get(path));};
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,sourceSha,version:'1.0.0-test',files:{'lib/synthetic.js':'a'.repeat(64)}}));
  const deps={githubJSON,readManifest:async(component:string)=>component==='satellite'?undefined:manifest,now:()=>now,
    commit:async(value:any)=>{writes++;envelope=value;}};
  return {env,responses,deps,writes:()=>writes,envelope:()=>envelope,mainReads:()=>mainReads};
}

test('publisher derives gates from exact trusted GitHub records and signs only after preflight',async()=>{
  const f=fixture();const result=await publishActiveRelease(f.env,f.deps);
  assert.equal(result.status,'ACTIVE_PIN_PUBLISHED');assert.equal(f.writes(),1);assert.equal(f.mainReads(),2);
  assert.equal(verifyActiveReleaseEnvelope(f.envelope(),publicKey,{now,expectedSourceSha:sourceSha}).status,'CANDIDATE_UNVERIFIED');
  assert.equal('privateKey' in f.envelope(),false);assert.equal(JSON.stringify(f.envelope()).includes('PRIVATE KEY'),false);
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
  await assert.rejects(commit(signed,'a'.repeat(64),candidate.certificateSha256,publicKey,readMain));assert.equal(rows.size,0);
  await commit(signed,'NONE',candidate.certificateSha256,publicKey,readMain);assert.equal(rows.size,2);const before=JSON.stringify([...rows]);
  await assert.rejects(commit(signed,'NONE',candidate.certificateSha256,publicKey,readMain));assert.equal(JSON.stringify([...rows]),before);
  assert.equal(rows.get(ACTIVE_RELEASE_SOURCE).certificate.sourceSha,sourceSha);
  assert.equal(rows.has(`${ACTIVE_RELEASE_SOURCE}/history/release-${releaseRunId}`),true);
  await assert.rejects(commit({...signed,signature:'a'.repeat(86)},'NONE',candidate.certificateSha256,publicKey,readMain));assert.equal(JSON.stringify([...rows]),before);
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
  await assert.rejects(commit(signed,'NONE',candidate.certificateSha256,publicKey,async()=>{proofReads++;return main;}),/CURRENT_MAIN_CONFLICT/);
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
});
