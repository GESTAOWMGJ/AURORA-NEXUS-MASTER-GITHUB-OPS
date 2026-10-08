import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { activeReleaseSigningBytes, ACTIVE_RELEASE_ORIGIN, type ActiveReleaseCertificate } from '../src/auroraActiveRelease.js';
import { createActiveReleaseRuntime } from '../src/auroraActiveReleaseRuntime.js';

const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const sourceSha='a'.repeat(40),now=Date.parse('2026-10-07T12:00:00.000Z');
const fileBytes={'lib/runtime.js':Buffer.from('// synthetic compiled runtime')};
const bytes=Buffer.from(JSON.stringify({schemaVersion:1,sourceSha,version:'1.0.0-test',files:{'lib/runtime.js':createHash('sha256').update(fileBytes['lib/runtime.js']).digest('hex')}}));
const hash=createHash('sha256').update(bytes).digest('hex');
const component={sourceSha,version:'1.0.0-test',manifestSha256:hash};
const certificate:ActiveReleaseCertificate={schemaVersion:1,sourceSha,productVersion:'1.0.0-test',canonicalOrigin:ACTIVE_RELEASE_ORIGIN,
  releaseRunId:'123',ciRunId:'122',publishedAtUtc:'2026-10-07T11:00:00.000Z',status:'ACTIVE',
  checks:{ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true},components:{server:component,web:component}};
const envelope={certificate,signature:sign(null,activeReleaseSigningBytes(certificate),keys.privateKey).toString('base64url')};
const dependencies=()=>({publicKey:()=>publicKey,readProtectedEnvelope:async()=>envelope,readServerManifest:async()=>bytes,readServerFiles:async()=>fileBytes,now:()=>now});

test('runtime without configured key skips Firestore and reports only independently observed build files',async()=>{
  const read=async()=>{throw new Error('unexpected read');};
  const value=await createActiveReleaseRuntime({...dependencies(),publicKey:()=>undefined,readProtectedEnvelope:read})();
  assert.equal(value.verification.status,'NO_ACTIVE_PIN');assert.equal(value.certificate,null);assert.equal(value.localServer.sourceSha,null);
  assert.equal(value.allClientsSynchronized,false);
  assert.equal(value.runtimeBuild.sourceSha,sourceSha);assert.equal(value.runtimeBuild.fileIntegrityVerified,true);
});

test('runtime requires actual protected document and sanitizes unavailable server evidence',async()=>{
  for(const load of [async()=>undefined,async()=>{throw new Error('synthetic private locator');}]) {
    const value=await createActiveReleaseRuntime({...dependencies(),readProtectedEnvelope:load})();
    assert.equal(value.verification.status,'NO_ACTIVE_PIN');assert.equal(value.certificate,null);
    assert.equal(JSON.stringify(value).includes('private locator'),false);
  }
});

test('unsigned or altered declaration never returns a public verified certificate',async()=>{
  const value=await createActiveReleaseRuntime({...dependencies(),readProtectedEnvelope:async()=>({certificate,signature:'a'.repeat(86)})})();
  assert.equal(value.verification.status,'INVALID_ACTIVE_PIN');assert.equal(value.certificate,null);assert.equal(value.localServer.sourceSha,null);
});

test('a verified pin still leaves server unknown when build manifest is absent',async()=>{
  const value=await createActiveReleaseRuntime({...dependencies(),readServerManifest:async()=>{throw new Error('synthetic private build path');}})();
  assert.equal(value.verification.status,'VERIFIED_ACTIVE_PIN');assert.equal(value.certificate?.sourceSha,sourceSha);
  assert.equal(value.localServer.status,'SERVER_MANIFEST_UNAVAILABLE');assert.equal(value.localServer.sourceSha,null);
  assert.equal(JSON.stringify(value).includes('private build path'),false);
});

test('server source and component version are reported only after exact real manifest bytes/hash match',async()=>{
  const value=await createActiveReleaseRuntime(dependencies())();assert.equal(value.localServer.status,'PACKAGE_FILES_VERIFIED');
  assert.equal(value.localServer.sourceSha,sourceSha);assert.equal(value.localServer.manifestMatches,true);
  assert.equal(value.localServer.fileIntegrityVerified,true);assert.equal(value.allClientsSynchronized,false);
  const changed=await createActiveReleaseRuntime({...dependencies(),readServerManifest:async()=>Buffer.concat([bytes,Buffer.from(' ')])})();
  assert.equal(changed.localServer.status,'VERSION_CONFLICT');assert.equal(changed.localServer.sourceSha,null);
});

test('process startup bytes stay immutable after disk replacement while canonical pin remains fresh',async()=>{
  let currentTime=now,currentEnvelope=envelope,reads=0;
  let diskManifest=Buffer.from(bytes),diskFiles={'lib/runtime.js':Buffer.from(fileBytes['lib/runtime.js'])};
  const runtime=createActiveReleaseRuntime({...dependencies(),now:()=>currentTime,readProtectedEnvelope:async()=>currentEnvelope,
    readServerManifest:async()=>{reads++;return diskManifest;},readServerFiles:async()=>diskFiles});
  const first=await runtime();assert.equal(first.localServer.status,'PACKAGE_FILES_VERIFIED');
  currentTime+=60_000;diskFiles={'lib/runtime.js':Buffer.from('// replacement build')};
  const newSource='b'.repeat(40);diskManifest=Buffer.from(JSON.stringify({schemaVersion:1,sourceSha:newSource,version:'1.0.1-test',
    files:{'lib/runtime.js':createHash('sha256').update(diskFiles['lib/runtime.js']).digest('hex')}}));
  const newComponent={sourceSha:newSource,version:'1.0.1-test',manifestSha256:createHash('sha256').update(diskManifest).digest('hex')};
  const newCertificate={...certificate,sourceSha:newSource,productVersion:'1.0.1-test',publishedAtUtc:new Date(currentTime).toISOString(),components:{server:newComponent,web:newComponent}};
  currentEnvelope={certificate:newCertificate,signature:sign(null,activeReleaseSigningBytes(newCertificate),keys.privateKey).toString('base64url')};
  const second=await runtime();assert.equal(second.verification.status,'VERIFIED_ACTIVE_PIN');assert.equal(second.localServer.status,'VERSION_CONFLICT');
  assert.equal(second.runtimeBuild.sourceSha,sourceSha);assert.equal(second.runtimeBuild.startedAtUtc,first.runtimeBuild.startedAtUtc);
  assert.equal(second.runtimeBuild.observedAtUtc,first.runtimeBuild.observedAtUtc);assert.equal(reads,1);assert.equal(second.allClientsSynchronized,false);
});

test('web evidence comes from its own startup manifest and local lib files, independently of server hash',async()=>{
  const webFiles={'lib/auroraFrontend.js':Buffer.from('// synthetic dynamic interface')};
  const webBytes=Buffer.from(JSON.stringify({schemaVersion:1,sourceSha,version:'1.0.0-test',files:{'lib/auroraFrontend.js':createHash('sha256').update(webFiles['lib/auroraFrontend.js']).digest('hex')}}));
  const webHash=createHash('sha256').update(webBytes).digest('hex');
  const cert={...certificate,components:{server:component,web:{...component,manifestSha256:webHash}}};
  const signed={certificate:cert,signature:sign(null,activeReleaseSigningBytes(cert),keys.privateKey).toString('base64url')};
  const value=await createActiveReleaseRuntime({...dependencies(),readProtectedEnvelope:async()=>signed,readWebManifest:async()=>webBytes,readWebFiles:async()=>webFiles})();
  assert.notEqual(value.runtimeBuildWeb.manifestSha256,value.runtimeBuild.manifestSha256);
  assert.equal(value.runtimeBuildWeb.manifestSha256,webHash);assert.equal(value.runtimeBuildWeb.fileIntegrityVerified,true);
  assert.equal('localWeb' in value?value.localWeb.status:undefined,'PACKAGE_FILES_VERIFIED');
  assert.equal(value.allClientsSynchronized,false);
});

test('tampered JS files, unsafe manifest names and missing real metadata never infer server SHA',async()=>{
  const changed=await createActiveReleaseRuntime({...dependencies(),readServerFiles:async()=>({'lib/runtime.js':Buffer.from('changed')})})();
  assert.equal(changed.runtimeBuild.status,'BUILD_FILES_CONFLICT');assert.equal(changed.runtimeBuild.sourceSha,null);
  assert.equal(changed.localServer.sourceSha,null);
  const unsafe=Buffer.from(JSON.stringify({schemaVersion:1,sourceSha,version:'1.0.0-test',files:{'lib/../private.js':'a'.repeat(64)}}));
  const rejected=await createActiveReleaseRuntime({...dependencies(),readServerManifest:async()=>unsafe})();
  assert.equal(rejected.runtimeBuild.status,'BUILD_METADATA_INVALID');assert.equal(rejected.runtimeBuild.sourceSha,null);
});
