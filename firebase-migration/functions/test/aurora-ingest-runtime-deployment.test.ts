import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {normalizeIngestMetadata, verifyIngestDeployment, runIngestMetadataCheck} from '../../scripts/verify-hml-ingest-runtime.mjs';

const project='wmgj-hml-jfn-20260927', region='southamerica-east1';
const sourceSha='a'.repeat(40), start='2026-10-15T04:30:00.000Z';
function fixture(next=false) {
  const revision=`ingestwmgjevent-0000${next?2:1}-abc`;
  return {
    fn:{name:`projects/${project}/locations/${region}/functions/ingestWmgjEvent`,state:'ACTIVE',
      updateTime:next?'2026-10-15T04:31:00.000Z':'2026-10-03T15:09:42.124Z',
      buildConfig:{entryPoint:'ingestWmgjEvent',runtime:'nodejs22',build:`projects/${project}/locations/${region}/builds/${next?'2':'1'}e031b1a-6b1a-4502-ade2-fb6a43fc5df9`,
        source:{storageSource:{bucket:'gcf-v2-sources-299889357292-southamerica-east1',object:'ingestWmgjEvent/function-source.zip',generation:next?'1791040123753410':'1791040123753409'}}},
      serviceConfig:{service:`projects/${project}/locations/${region}/services/ingestwmgjevent`,revision,
        serviceAccountEmail:'299889357292-compute@developer.gserviceaccount.com',ingressSettings:'ALLOW_ALL',
        secretEnvironmentVariables:[{key:'WMGJ_INGEST_HMAC_KEYRING',secret:'WMGJ_INGEST_HMAC_KEYRING',projectId:project,version:next?'4':'3'}]}},
    service:{metadata:{name:'ingestwmgjevent',generation:'2',annotations:{'run.googleapis.com/ingress':'all','run.googleapis.com/ingress-status':'all'}},spec:{traffic:[{latestRevision:true,percent:100}]},
      status:{observedGeneration:2,conditions:[{type:'Ready',status:'True'}],latestCreatedRevisionName:revision,
        latestReadyRevisionName:revision,traffic:[{revisionName:revision,latestRevision:true,percent:100}]}},
    policy:{bindings:[{role:'roles/run.invoker',members:['allUsers']}]} as any
  };
}
const normalized=(f=fixture(), mode='before')=>normalizeIngestMetadata(f.fn,f.service,f.policy,mode);

test('provider build/revision convergence is verified separately from runtime byte or processing proof',()=>{
  const result=verifyIngestDeployment(normalized(),normalized(fixture(true)),{sourceSha,startedAt:start});
  assert.equal(result.code,'HML_INGEST_RUNTIME_METADATA_VERIFIED');
  assert.equal(result.backendRuntimeSourceShaVerified,false);
  assert.equal(result.requestProcessingVerified,false);
  assert.equal(result.metadata.function.secretVersion,'4');
  assert.deepEqual(result.secretBindingTransition,{from:'3',to:'4'});
});

test('only the approved immutable 3-to-4 or 4-to-4 binding can complete deployment',()=>{
  const current=fixture();current.fn.serviceConfig.secretEnvironmentVariables[0].version='4';
  const next=normalized(fixture(true),'after');
  assert.deepEqual(verifyIngestDeployment(normalized(current),next,{sourceSha,startedAt:start})
    .secretBindingTransition,{from:'4',to:'4'});
  assert.throws(()=>normalizeIngestMetadata(fixture().fn,fixture().service,fixture().policy),/SECRET_BINDING_REQUIRED/);
  for(const version of ['2','5','latest','*']) {
    const f=fixture();f.fn.serviceConfig.secretEnvironmentVariables[0].version=version;
    for(const mode of ['before','after']) assert.throws(()=>normalized(f,mode),/SECRET_BINDING_REQUIRED/);
  }
  assert.throws(()=>normalized(fixture(true),'arbitrary'),/SECRET_TRANSITION_REJECTED/);
  const oldAfter=normalized(fixture(true));oldAfter.function.secretVersion='3';
  assert.throws(()=>verifyIngestDeployment(normalized(),oldAfter,{sourceSha,startedAt:start}),/SECRET_TRANSITION_REJECTED/);
  const invalidBefore=normalized();invalidBefore.function.secretVersion='5';
  assert.throws(()=>verifyIngestDeployment(invalidBefore,next,{sourceSha,startedAt:start}),/SECRET_TRANSITION_REJECTED/);
});

test('after-mode cannot persist old runtime binding as successful deployment evidence',()=>{
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS',GITHUB_REF:'refs/heads/main',
    GITHUB_SHA:sourceSha,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',PROJECT_ID:project,RUNNER_TEMP:'.'};
  const context={sourceSha,runId:'123',runAttempt:'1'};
  const f=fixture(true);f.fn.serviceConfig.secretEnvironmentVariables[0].version='3';
  let writes=0;
  const deps={readJson:(args:string[])=>args[0]==='functions'?f.fn:args.includes('get-iam-policy')?f.policy:f.service,
    readFile:()=>JSON.stringify({context,capturedAt:start,metadata:normalized()}),save:()=>{writes++;}};
  assert.throws(()=>runIngestMetadataCheck('after',env,deps),/SECRET_BINDING_REQUIRED/);
  assert.equal(writes,0);
  f.fn.serviceConfig.secretEnvironmentVariables[0].version='4';
  assert.equal(runIngestMetadataCheck('after',env,deps).code,'HML_INGEST_RUNTIME_METADATA_VERIFIED');
  assert.equal(writes,1);
});
for(const [name,mutate] of [
  ['wrong function',(f:any)=>f.fn.name+='other'],
  ['runtime change',(f:any)=>f.fn.buildConfig.runtime='nodejs24'],
  ['service account change',(f:any)=>f.fn.serviceConfig.serviceAccountEmail='other@example.test'],
  ['secret rotation',(f:any)=>f.fn.serviceConfig.secretEnvironmentVariables[0].version='latest'],
  ['new secret',(f:any)=>f.fn.serviceConfig.secretEnvironmentVariables.push({...f.fn.serviceConfig.secretEnvironmentVariables[0],key:'OTHER'})],
  ['ingress change',(f:any)=>f.fn.serviceConfig.ingressSettings='ALLOW_INTERNAL_ONLY'],
  ['unready revision',(f:any)=>f.service.status.latestReadyRevisionName='ingestwmgjevent-00001-old'],
  ['unreconciled generation',(f:any)=>f.service.status.observedGeneration=1],
  ['missing generation',(f:any)=>{delete f.service.metadata.generation;delete f.service.status.observedGeneration;}],
  ['actual ingress change',(f:any)=>f.service.metadata.annotations['run.googleapis.com/ingress']='internal'],
  ['IAM check disabled',(f:any)=>f.service.metadata.annotations['run.googleapis.com/invoker-iam-disabled']='true'],
  ['actual old traffic',(f:any)=>f.service.status.traffic[0].revisionName='ingestwmgjevent-00001-old'],
  ['split traffic',(f:any)=>f.service.status.traffic[0].percent=99],
  ['conditional public IAM',(f:any)=>f.policy.bindings[0].condition={expression:'true'}],
] as const) test(`metadata guard rejects ${name}`,()=>{const f=fixture(true);mutate(f);assert.throws(()=>normalized(f));});

test('unchanged old function and changed IAM cannot be described as the new deployed runtime',()=>{
  const unchanged=normalized(fixture(true),'after');
  assert.throws(()=>verifyIngestDeployment(unchanged,unchanged,{sourceSha,startedAt:start}),/DEPLOY_NOT_OBSERVED/);
  const f=fixture(true);f.policy.bindings.push({role:'roles/run.invoker',members:['user:other@example.test']});
  assert.throws(()=>verifyIngestDeployment(normalized(),normalized(f),{sourceSha,startedAt:start}),/IAM_CHANGED/);
  const before=normalized(), after=normalized(fixture(true));after.function.updateTime='2026-10-15T04:29:59Z';
  assert.throws(()=>verifyIngestDeployment(before,after,{sourceSha,startedAt:start}),/DEPLOY_NOT_OBSERVED/);
});

test('metadata projection/persistence exports no environment, key material or IAM principals',()=>{
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS',GITHUB_REF:'refs/heads/main',
    GITHUB_SHA:sourceSha,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',PROJECT_ID:project,RUNNER_TEMP:'.'};
  const f=fixture();f.fn.serviceConfig.environmentVariables={PRIVATE:'PRIVATE_MARKER'};
  f.policy.bindings.push({role:'roles/run.invoker',members:['user:PRIVATE_MARKER@example.test']});
  const queries:string[][]=[], saved:any[]=[];
  const deps={readJson:(args:string[])=>{queries.push(args);return args[0]==='functions'?f.fn:args.includes('get-iam-policy')?f.policy:f.service;},
    save:(_path:string,value:any)=>saved.push(value),now:()=>start};
  assert.equal(runIngestMetadataCheck('before',env,deps).code,'HML_INGEST_BASELINE_RETAINED');
  assert.equal(queries.length,3);
  assert.ok(queries.every(args=>!args.join(' ').includes('environmentVariables')));
  assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_MARKER|environmentVariables|bindings|members/);
  queries.length=0;
  assert.throws(()=>runIngestMetadataCheck('after',env,{...deps,readFile:()=>JSON.stringify({context:{sourceSha:'b'.repeat(40)}})}),/BASELINE_CONTEXT_CONFLICT/);
  assert.equal(queries.length,0);
  assert.throws(()=>runIngestMetadataCheck('before',{...env,PROJECT_ID:'other'},deps),/PROTECTED_CONTEXT/);
  assert.equal(queries.length,0);
});

test('protected HML workflow deploys ingest and verifies its actual metadata before traffic promotion',()=>{
  const workflow=readFileSync(new URL('../../../.github/workflows/deploy-aurora-firebase.yml',import.meta.url),'utf8');
  const command=workflow.match(/npx --yes firebase-tools@14\.17\.0 deploy[^\r\n]+/)?.[0];
  assert.ok(command);
  assert.equal(command.split('functions:ingestWmgjEvent').length,2);
  assert.match(command,/--non-interactive/);
  const before=workflow.indexOf('verify-hml-ingest-runtime.mjs before'), deploy=workflow.indexOf(command),
    after=workflow.indexOf('verify-hml-ingest-runtime.mjs after'), promotion=workflow.indexOf('Promote exact ready AuthGate');
  assert.ok(before>0 && before<deploy && deploy<after && after<promotion);
  assert.match(workflow,/expected '\[\s*"ingestWmgjEvent"/);
  assert.match(workflow,/aurora-hml-ingest-runtime-metadata-\$\{\{ github.sha \}\}/);
  const source=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
  assert.match(source,/export const ingestWmgjEvent = onRequest/);
  assert.match(source,/defineSecret\("WMGJ_INGEST_HMAC_KEYRING"\)/);
  assert.doesNotMatch(readFileSync(new URL('../../scripts/verify-hml-ingest-runtime.mjs',import.meta.url),'utf8'),/add-iam-policy-binding|set-iam-policy|secrets.*access/);
});
