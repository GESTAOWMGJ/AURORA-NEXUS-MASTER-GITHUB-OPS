import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {activeReleaseSigningBytes} from '../src/auroraActiveRelease.js';
import {verifyDeploymentBootstrap} from '../../scripts/verify-deployment-bootstrap.mjs';

const sourceSha='a'.repeat(40), engineeringVersion='1.1.0-beta.2';
const hash=(bytes:any)=>createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const certificate={schemaVersion:2,sourceSha:'b'.repeat(40),productVersion:'1.1.0-beta.1',canonicalOrigin:'https://auroranexus.com.br',
    status:'ACTIVE',releaseRunId:'1',ciRunId:'2',publishedAtUtc:'2026-10-13T00:00:00.000Z',checks:{ci:true},components:{}} as any;
  const predecessor=hash(activeReleaseSigningBytes(certificate));
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,sourceSha,version:engineeringVersion,files:{'lib/runtime.js':'c'.repeat(64)}}));
  const build={status:'RUNTIME_BUILD_OBSERVED',sourceSha,version:engineeringVersion,manifestSha256:hash(manifest),fileIntegrityVerified:true};
  const reference={releaseId:`aurora-${certificate.productVersion}-${certificate.sourceSha}`,productVersion:certificate.productVersion,
    sourceSha:certificate.sourceSha,certificateSha256:predecessor};
  const bootstrap:any={ok:true,release:{productVersion:reference.productVersion,productVersionSource:'VERIFIED_ACTIVE_REFERENCE',engineeringReadinessPercent:70},
    canonicalVersion:{runtimeBuild:{...build},runtimeBuildWeb:{...build},verification:{status:'VERIFIED_ACTIVE_PIN',algorithm:'Ed25519',
      source:'platformRuntime/activeRelease',certificateSha256:predecessor},certificate,unifiedBeta:{referenceStatus:'VERIFIED_REFERENCE',reference}}};
  const options:any={publishActiveRelease:true,sourceSha,engineeringVersion,previousCertificateSha256:predecessor,
    manifestBytes:{server:manifest,web:manifest}};
  return {bootstrap,options};
}
function noReference(f=fixture()) {
  f.bootstrap.release.productVersion=engineeringVersion;f.bootstrap.release.productVersionSource='ENGINEERING_DEFAULT_UNVERIFIED';
  f.bootstrap.canonicalVersion.certificate=null;
  f.bootstrap.canonicalVersion.unifiedBeta={referenceStatus:'PENDING_VERIFIED_REFERENCE',reference:null};
  f.bootstrap.canonicalVersion.verification={status:'NO_ACTIVE_PIN',reason:'CANONICAL_POINTER_ABSENT',source:'platformRuntime/activeRelease'};
  return f;
}

function bindFinalCertificate(f:ReturnType<typeof fixture>) {
  const canonical=f.bootstrap.canonicalVersion,certificate=canonical.certificate;
  const certificateSha256=hash(activeReleaseSigningBytes(certificate));
  canonical.unifiedBeta.reference={releaseId:`aurora-${certificate.productVersion}-${certificate.sourceSha}`,
    productVersion:certificate.productVersion,sourceSha:certificate.sourceSha,certificateSha256};
  canonical.verification.certificateSha256=certificateSha256;
  f.bootstrap.release.productVersion=certificate.productVersion;
  f.options.expectedCertificateSha256=certificateSha256;
}
function promotedFixture() {
  const f=fixture(),canonical=f.bootstrap.canonicalVersion;
  const web=Buffer.from(JSON.stringify({schemaVersion:1,sourceSha,version:engineeringVersion,files:{'lib/web.js':'d'.repeat(64)}}));
  f.options.manifestBytes.web=web;canonical.runtimeBuildWeb.manifestSha256=hash(web);
  canonical.certificate={...canonical.certificate,sourceSha,productVersion:engineeringVersion,
    checks:{ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true},
    components:Object.fromEntries(['server','web','satellite','iaMaster','windowsIntegration'].map(component=>[component,
      {sourceSha,version:engineeringVersion,manifestSha256:component==='web'?hash(web):hash(f.options.manifestBytes.server)}]))};
  canonical.localServer={status:'PACKAGE_FILES_VERIFIED',sourceSha,version:engineeringVersion,manifestMatches:true,fileIntegrityVerified:true};
  canonical.localWeb={status:'PACKAGE_FILES_VERIFIED',sourceSha,version:engineeringVersion,fileIntegrityVerified:true};
  canonical.unifiedBeta.schemaVersion='aurora.unified-beta.v1';canonical.unifiedBeta.runtimeStatus='RUNTIME_BYTES_MATCH';
  f.options.phase='POST_PROMOTION';delete f.options.previousCertificateSha256;
  bindFinalCertificate(f);
  return f;
}
function finalSmokeWorkflow() {
  const workflow=readFileSync(new URL('../../../.github/workflows/deploy-aurora-firebase.yml',import.meta.url),'utf8');
  const start=workflow.indexOf('      - name: Verify promoted release through the authenticated canonical portal\n');
  assert.ok(start>0,'post-promotion smoke step is required');
  const next=workflow.indexOf('\n      - ',start+1),step=workflow.slice(start,next<0?undefined:next);
  const runMarker='        run: |\n',runStart=step.indexOf(runMarker);
  assert.ok(runStart>0,'post-promotion smoke must execute its verifier');
  const script=step.slice(runStart+runMarker.length).split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
  return {workflow,start,step,script};
}

test('pre-promotion smoke accepts signed predecessor Beta1 with exact candidate Beta2 runtime',()=>{
  const f=fixture();assert.deepEqual(verifyDeploymentBootstrap(f.bootstrap,f.options),{status:'PASS',code:'DEPLOYMENT_BOOTSTRAP_VERIFIED'});
  assert.deepEqual(verifyDeploymentBootstrap(f.bootstrap,{...f.options,phase:'PRE_PROMOTION'}),{status:'PASS',code:'DEPLOYMENT_BOOTSTRAP_VERIFIED'});
  assert.notEqual(f.bootstrap.release.productVersion,engineeringVersion);
});
for(const component of ['runtimeBuild','runtimeBuildWeb']) {
  for(const [name,change] of [
    ['source',(v:any)=>v.sourceSha='d'.repeat(40)],['hash',(v:any)=>v.manifestSha256='d'.repeat(64)],
    ['version',(v:any)=>v.version='1.1.0-beta.9'],['integrity',(v:any)=>v.fileIntegrityVerified='true'],
    ['status',(v:any)=>v.status='BUILD_FILES_CONFLICT']
  ] as const) test(`${component} rejects divergent ${name}`,()=>{
    const f=fixture();change(f.bootstrap.canonicalVersion[component]);assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options));
  });
}
test('local manifests must themselves identify exact candidate source and engineering version',()=>{
  for(const delta of [{sourceSha:'d'.repeat(40)},{version:'1.1.0-beta.9'}]) {
    const f=fixture();const bytes=Buffer.from(JSON.stringify({...JSON.parse(f.options.manifestBytes.server),...delta}));
    f.options.manifestBytes.server=bytes;f.bootstrap.canonicalVersion.runtimeBuild.manifestSha256=hash(bytes);
    assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options));
  }
});
test('reference, certificate, verification and requested predecessor must agree',()=>{
  for(const change of [
    (f:any)=>f.options.previousCertificateSha256='d'.repeat(64),
    (f:any)=>f.bootstrap.canonicalVersion.unifiedBeta.reference.productVersion=engineeringVersion,
    (f:any)=>f.bootstrap.canonicalVersion.certificate.productVersion=engineeringVersion,
    (f:any)=>f.bootstrap.canonicalVersion.verification.algorithm='none',
    (f:any)=>f.bootstrap.canonicalVersion.verification.status='INVALID_ACTIVE_PIN',
    (f:any)=>f.bootstrap.canonicalVersion.unifiedBeta.referenceStatus='PENDING_VERIFIED_REFERENCE',
    (f:any)=>f.bootstrap.release.productVersion=engineeringVersion,
    (f:any)=>delete f.bootstrap.canonicalVersion.unifiedBeta.reference
  ]) {const f=fixture();change(f);assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options));}
});
test('readiness must be a finite number in range',()=>{
  for(const readiness of ['70',null,NaN,Infinity,-1,101]) {const f=fixture();f.bootstrap.release.engineeringReadinessPercent=readiness;
    assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options));}
});
test('NONE requires actual pointer absence and engineering fallback, never a failed signature or unavailable read',()=>{
  const f=noReference();f.options.previousCertificateSha256='NONE';assert.equal(verifyDeploymentBootstrap(f.bootstrap,f.options).status,'PASS');
  for(const reason of ['CANONICAL_POINTER_UNAVAILABLE','VERIFICATION_KEY_UNCONFIGURED']) {const x=noReference();x.options.previousCertificateSha256='NONE';
    x.bootstrap.canonicalVersion.verification.reason=reason;assert.throws(()=>verifyDeploymentBootstrap(x.bootstrap,x.options));}
  const present=fixture();present.options.previousCertificateSha256='NONE';assert.throws(()=>verifyDeploymentBootstrap(present.bootstrap,present.options));
  const absent=noReference();assert.throws(()=>verifyDeploymentBootstrap(absent.bootstrap,absent.options));
});
test('non-publication does not require absent build manifests but rejects conflicting observed metadata',()=>{
  const f=noReference();f.options.publishActiveRelease=false;delete f.options.manifestBytes;delete f.options.previousCertificateSha256;
  const unavailable={status:'BUILD_METADATA_UNAVAILABLE',sourceSha:null,version:null,manifestSha256:null,fileIntegrityVerified:false};
  f.bootstrap.canonicalVersion.runtimeBuild={...unavailable};f.bootstrap.canonicalVersion.runtimeBuildWeb={...unavailable};
  f.bootstrap.canonicalVersion.verification.reason='VERIFICATION_KEY_UNCONFIGURED';
  assert.equal(verifyDeploymentBootstrap(f.bootstrap,f.options).status,'PASS');
  f.bootstrap.canonicalVersion.runtimeBuild.sourceSha=sourceSha;assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options));
  const existing=fixture();existing.options.publishActiveRelease=false;delete existing.options.manifestBytes;
  assert.equal(verifyDeploymentBootstrap(existing.bootstrap,existing.options).status,'PASS');
  existing.bootstrap.canonicalVersion.runtimeBuild.sourceSha='d'.repeat(40);assert.throws(()=>verifyDeploymentBootstrap(existing.bootstrap,existing.options));
});
test('non-boolean publication flags cannot bypass candidate checks',()=>{
  for(const publish of ['false','true',null,0,1]) {const f=fixture();f.options.publishActiveRelease=publish;
    assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options));}
});
test('post-promotion binds the independently expected certificate to candidate runtime and local package evidence',()=>{
  const f=promotedFixture();
  assert.deepEqual(verifyDeploymentBootstrap(f.bootstrap,f.options),{status:'PASS',code:'POST_PROMOTION_BOOTSTRAP_VERIFIED'});
  // This remains a read-only check; the publication flag cannot weaken final verification.
  assert.equal(verifyDeploymentBootstrap(f.bootstrap,{...f.options,publishActiveRelease:false}).status,'PASS');
});
test('post-promotion rejects the still-active predecessor even when its certificate hash is supplied',()=>{
  const f=fixture();f.options.phase='POST_PROMOTION';
  f.options.expectedCertificateSha256=f.options.previousCertificateSha256;delete f.options.previousCertificateSha256;
  assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options),/DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT/);
  const absent=noReference(promotedFixture());
  assert.throws(()=>verifyDeploymentBootstrap(absent.bootstrap,absent.options),/DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT/);
});
test('post-promotion requires an external exact certificate hash and rejects a substituted certificate',()=>{
  for(const expected of [undefined,null,'NONE','',true,'e'.repeat(63)]) {
    const f=promotedFixture();f.options.expectedCertificateSha256=expected;
    assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options),/DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED/);
  }
  const mismatch=promotedFixture();mismatch.options.expectedCertificateSha256='e'.repeat(64);
  assert.throws(()=>verifyDeploymentBootstrap(mismatch.bootstrap,mismatch.options),/DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT/);
  const changed=promotedFixture(),expected=changed.options.expectedCertificateSha256;
  changed.bootstrap.canonicalVersion.certificate.releaseRunId='9';bindFinalCertificate(changed);
  changed.options.expectedCertificateSha256=expected;
  assert.throws(()=>verifyDeploymentBootstrap(changed.bootstrap,changed.options),/DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT/);
});
test('phase and phase-specific inputs cannot silently select a weaker verification',()=>{
  for(const phase of [null,'','post_promotion','POST_PROMOTION ',false,{}]) {
    const f=fixture();assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,{...f.options,phase}),/DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED/);
  }
  const pre=fixture();pre.options.expectedCertificateSha256='e'.repeat(64);
  assert.throws(()=>verifyDeploymentBootstrap(pre.bootstrap,pre.options),/DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED/);
  const post=promotedFixture();post.options.previousCertificateSha256='e'.repeat(64);
  assert.throws(()=>verifyDeploymentBootstrap(post.bootstrap,post.options),/DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED/);
});
for(const [component,buildKey,localKey] of [['server','runtimeBuild','localServer'],['web','runtimeBuildWeb','localWeb']]) {
  test(`post-promotion rejects ${component} manifest substituted in the observed certificate`,()=>{
    const f=promotedFixture();f.bootstrap.canonicalVersion.certificate.components[component].manifestSha256='e'.repeat(64);
    bindFinalCertificate(f); // The external certificate itself is expected; its runtime is not deployed.
    assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options),/DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT/);
  });
  test(`post-promotion requires ${component} manifest bytes and observed build integrity even without the publication flag`,()=>{
    for(const change of [
      (f:any)=>delete f.options.manifestBytes[component],
      (f:any)=>f.options.manifestBytes[component]=Buffer.from('changed manifest'),
      (f:any)=>delete f.bootstrap.canonicalVersion[buildKey].version,
      (f:any)=>f.bootstrap.canonicalVersion[buildKey].fileIntegrityVerified=false,
      (f:any)=>f.bootstrap.canonicalVersion[buildKey]={status:'BUILD_METADATA_UNAVAILABLE',sourceSha:null,version:null,manifestSha256:null,fileIntegrityVerified:false}
    ]) {
      const f=promotedFixture();f.options.publishActiveRelease=false;change(f);
      assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options),/DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT/);
    }
  });
  test(`post-promotion rejects missing or conflicting ${localKey} proof`,()=>{
    for(const change of [
      (v:any)=>v.sourceSha='e'.repeat(40),
      (v:any)=>v.version='1.1.0-beta.9',
      (v:any)=>v.status='VERSION_CONFLICT',
      (v:any)=>v.fileIntegrityVerified=false,
      (v:any)=>v.fileIntegrityVerified='true'
    ]) {
      const f=promotedFixture();change(f.bootstrap.canonicalVersion[localKey]);
      assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options),/DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT/);
    }
    const absent=promotedFixture();delete absent.bootstrap.canonicalVersion[localKey];
    assert.throws(()=>verifyDeploymentBootstrap(absent.bootstrap,absent.options),/DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT/);
  });
}
test('post-promotion requires local server manifest match and unified beta runtime agreement',()=>{
  const server=promotedFixture();server.bootstrap.canonicalVersion.localServer.manifestMatches=false;
  assert.throws(()=>verifyDeploymentBootstrap(server.bootstrap,server.options),/DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT/);
  for(const change of [
    (v:any)=>delete v.schemaVersion,
    (v:any)=>v.runtimeStatus='CONFLICT_RUNTIME_BYTES',
    (v:any)=>v.runtimeStatus='PENDING_RUNTIME_BYTES',
    (v:any)=>v.referenceStatus='PENDING_VERIFIED_REFERENCE',
    (v:any)=>v.reference.sourceSha='e'.repeat(40)
  ]) {
    const f=promotedFixture();change(f.bootstrap.canonicalVersion.unifiedBeta);
    assert.throws(()=>verifyDeploymentBootstrap(f.bootstrap,f.options),/DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT/);
  }
});
test('CLI errors expose only a fixed status/code, never private payload or filesystem exception',()=>{
  const directory=mkdtempSync(join(tmpdir(),'aurora-bootstrap-fixture-'));
  try {const path=join(directory,'response.json');writeFileSync(path,'{"private":"must-not-leak",');
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../scripts/verify-deployment-bootstrap.mjs',import.meta.url)),
      '--bootstrap',path,'--source-sha',sourceSha,'--engineering-version',engineeringVersion,'--publish-active-release','false','--previous-sha256',''],{encoding:'utf8'});
    assert.equal(result.status,97);assert.doesNotMatch(result.stdout+result.stderr,/must-not-leak|SyntaxError|response\.json/);
    assert.deepEqual(JSON.parse(result.stderr),{status:'FAIL',code:'DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED'});
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('CLI verifies final promotion and rejects unexpected, duplicate or phase-incompatible arguments',()=>{
  const directory=mkdtempSync(join(tmpdir(),'aurora-promoted-bootstrap-fixture-'));
  try {
    const migration=join(directory,'firebase-migration');
    for(const child of ['scripts','functions/lib','functions/runtime-release']) mkdirSync(join(migration,child),{recursive:true});
    const script=join(migration,'scripts/verify-deployment-bootstrap.mjs'),responsePath=join(directory,'response.json');
    copyFileSync(new URL('../../scripts/verify-deployment-bootstrap.mjs',import.meta.url),script);
    copyFileSync(new URL('../lib/auroraActiveRelease.js',import.meta.url),join(migration,'functions/lib/auroraActiveRelease.js'));
    const f=promotedFixture();writeFileSync(responsePath,JSON.stringify(f.bootstrap));
    for(const component of ['server','web']) writeFileSync(join(migration,`functions/runtime-release/${component}-manifest.json`),f.options.manifestBytes[component]);
    const common=['--bootstrap',responsePath,'--source-sha',sourceSha,'--engineering-version',engineeringVersion,'--publish-active-release','false'];
    const final=[...common,'--phase','POST_PROMOTION','--expected-certificate-sha256',f.options.expectedCertificateSha256];
    const run=(args:string[])=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
    const passed=run(final);
    assert.equal(passed.status,0,passed.stderr);
    assert.deepEqual(JSON.parse(passed.stdout),{status:'PASS',code:'POST_PROMOTION_BOOTSTRAP_VERIFIED'});
    // Execute the actual final workflow invocation, with synthetic private input
    // and an independently supplied expected certificate. No authentication runs.
    const lines=finalSmokeWorkflow().script.split('\n'),invocationStart=lines.findIndex(line=>line.trim().startsWith('node firebase-migration/scripts/verify-deployment-bootstrap.mjs'));
    assert.ok(invocationStart>=0);
    let invocationEnd=invocationStart;
    while(lines[invocationEnd].trim().endsWith('\\')) invocationEnd++;
    const invocation=lines.slice(invocationStart,invocationEnd+1).join('\n');
    const runWorkflow=(expected:string)=>spawnSync('bash',['-ec','set -euo pipefail\n'+invocation],{cwd:directory,encoding:'utf8',env:{...process.env,
      GITHUB_SHA:sourceSha,bootstrap_response:responsePath,expected_product_version:engineeringVersion,EXPECTED_FINAL_CERTIFICATE_SHA256:expected}});
    const workflowPass=runWorkflow(f.options.expectedCertificateSha256);
    assert.equal(workflowPass.status,0,workflowPass.stderr);
    assert.deepEqual(JSON.parse(workflowPass.stdout),{status:'PASS',code:'POST_PROMOTION_BOOTSTRAP_VERIFIED'});
    const workflowConflict=runWorkflow('e'.repeat(64));
    assert.equal(workflowConflict.status,97);
    assert.deepEqual(JSON.parse(workflowConflict.stderr),{status:'FAIL',code:'DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT'});
    for(const args of [
      [...common,'--phase','POST_PROMOTION'],
      [...common,'--phase','UNKNOWN','--previous-sha256','NONE'],
      [...final,'--previous-sha256','NONE'],
      [...final,'--expected-certificate-sha256',f.options.expectedCertificateSha256],
      [...final,'--phase','PRE_PROMOTION'],
      [...final,'--unexpected','must-not-leak'],
      [...common,'--previous-sha256','NONE','--expected-certificate-sha256',f.options.expectedCertificateSha256],
      [...common,'--phase']
    ]) {
      const rejected=run(args);
      assert.equal(rejected.status,97);
      assert.deepEqual(JSON.parse(rejected.stderr),{status:'FAIL',code:'DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED'});
      assert.doesNotMatch(rejected.stdout+rejected.stderr,/must-not-leak|response\.json/);
    }
    const pre=noReference();writeFileSync(responsePath,JSON.stringify(pre.bootstrap));
    const original=run([...common,'--previous-sha256','NONE']);
    assert.equal(original.status,0,original.stderr);
    assert.deepEqual(JSON.parse(original.stdout),{status:'PASS',code:'DEPLOYMENT_BOOTSTRAP_VERIFIED'});
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('final canonical smoke uses exported release evidence after beta retention, preserving pre-promotion checks',()=>{
  const {workflow,start,step}=finalSmokeWorkflow(),publisher=workflow.indexOf('\n  publish-active-release:');
  const finalize=workflow.indexOf('      - name: Attach public certificate to the same verified beta candidate',publisher);
  const retain=workflow.indexOf('      - name: Retain beta with signed certificate and verified payloads',finalize);
  assert.ok(publisher>0&&finalize>publisher&&retain>finalize&&start>retain);
  assert.equal((workflow.slice(0,publisher).match(/node firebase-migration\/scripts\/verify-deployment-bootstrap\.mjs/g)??[]).length,2);
  assert.equal((step.match(/node firebase-migration\/scripts\/verify-deployment-bootstrap\.mjs/g)??[]).length,1);
  const exported=workflow.slice(finalize,retain);
  assert.match(exported,/id: finalized-beta/);
  assert.match(exported,/public_release="\$\(node firebase-migration\/scripts\/export-public-unified-release\.mjs/);
  assert.match(exported,/certificate_sha256="\$\(jq -er --arg source "\$GITHUB_SHA"/);
  assert.match(exported,/printf 'certificate_sha256=%s\\n' "\$certificate_sha256" >> "\$GITHUB_OUTPUT"/);
  assert.match(step,/EXPECTED_FINAL_CERTIFICATE_SHA256: \$\{\{ steps\.finalized-beta\.outputs\.certificate_sha256 \}\}/);
  assert.doesNotMatch(step,/--previous-sha256|publish-active-release\.mjs|\brollback\b/);
  assert.match(workflow,/RELEASE_PREVIOUS_SHA256: \$\{\{ inputs\.active_release_previous_sha256 \}\}/);
  assert.doesNotMatch(workflow,/AUTH_SMOKE_RELEASE_VERSION_MISMATCH/);
});
test('final smoke failure removes private service responses, retains the beta and emits no private error',()=>{
  const directory=mkdtempSync(join(tmpdir(),'aurora-smoke-failure-fixture-'));
  try {
    const runner=join(directory,'runner'),bin=join(directory,'bin');mkdirSync(runner);mkdirSync(bin);
    const retained=join(runner,'aurora-unified-beta-'+sourceSha+'.zip');writeFileSync(retained,'synthetic retained beta');
    const failure='#!/bin/sh\nfor private_dir in "$RUNNER_TEMP"/aurora-post-promotion-smoke.*; do\n  printf "%s" "synthetic-private-response" > "$private_dir/fixture-response.json"\ndone\nprintf "%s\\n" "synthetic-private-service-error" >&2\nexit 1\n';
    // Both network-capable commands are replaced: this failure test cannot authenticate or fetch remotely.
    for(const name of ['gcloud','curl']) writeFileSync(join(bin,name),failure,{mode:0o700});
    const result=spawnSync('bash',['-ec',finalSmokeWorkflow().script],{cwd:directory,encoding:'utf8',env:{...process.env,
      PATH:bin+delimiter+process.env.PATH,RUNNER_TEMP:runner,PROJECT_ID:'wmgj-hml-jfn-fixture',APPROVED_PROJECT:'wmgj-hml-jfn-fixture',
      DEPLOY_SERVICE_ACCOUNT:'synthetic@fixture.test',SMOKE_UID:'synthetic-uid',SMOKE_EMAIL:'synthetic@fixture.test',
      EXPECTED_FINAL_CERTIFICATE_SHA256:'a'.repeat(64),GITHUB_SHA:sourceSha}});
    assert.notEqual(result.status,0);
    assert.match(result.stdout,/POST_PROMOTION_CANONICAL_SMOKE_FAILED/);
    assert.doesNotMatch(result.stdout+result.stderr,/synthetic-private-response|synthetic-private-service-error|fixture-response\.json/);
    assert.equal(readFileSync(retained,'utf8'),'synthetic retained beta');
    assert.deepEqual(readdirSync(runner),['aurora-unified-beta-'+sourceSha+'.zip']);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
