import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

test('pre-promotion smoke accepts signed predecessor Beta1 with exact candidate Beta2 runtime',()=>{
  const f=fixture();assert.equal(verifyDeploymentBootstrap(f.bootstrap,f.options).status,'PASS');
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
test('CLI errors expose only a fixed status/code, never private payload or filesystem exception',()=>{
  const directory=mkdtempSync(join(tmpdir(),'aurora-bootstrap-fixture-'));
  try {const path=join(directory,'response.json');writeFileSync(path,'{"private":"must-not-leak",');
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../scripts/verify-deployment-bootstrap.mjs',import.meta.url)),
      '--bootstrap',path,'--source-sha',sourceSha,'--engineering-version',engineeringVersion,'--publish-active-release','false','--previous-sha256',''],{encoding:'utf8'});
    assert.equal(result.status,97);assert.doesNotMatch(result.stdout+result.stderr,/must-not-leak|SyntaxError|response\.json/);
    assert.deepEqual(JSON.parse(result.stderr),{status:'FAIL',code:'DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED'});
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('both technical and canonical authenticated smoke responses use the same predecessor/runtime validator',()=>{
  const workflow=readFileSync(new URL('../../../.github/workflows/deploy-aurora-firebase.yml',import.meta.url),'utf8');
  assert.equal((workflow.match(/node firebase-migration\/scripts\/verify-deployment-bootstrap\.mjs/g)??[]).length,2);
  assert.match(workflow,/RELEASE_PREVIOUS_SHA256: \$\{\{ inputs\.active_release_previous_sha256 \}\}/);
  assert.doesNotMatch(workflow,/AUTH_SMOKE_RELEASE_VERSION_MISMATCH/);
});
