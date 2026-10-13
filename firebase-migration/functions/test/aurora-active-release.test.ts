import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { ACTIVE_RELEASE_ORIGIN, ACTIVE_RELEASE_SOURCE, activeReleaseSigningBytes, assessActiveReleaseReceipt,
  assessReleaseManifest, assessReleaseComponentCoverage, REQUIRED_RELEASE_COMPONENTS, readCanonicalActiveRelease, verifyActiveReleaseEnvelope,
  type ActiveReleaseCertificate, type VerifiedActiveRelease } from '../src/auroraActiveRelease.js';

// Synthetic keys remain in process memory; no signer, secret or release is persisted.
const keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const sourceSha='a'.repeat(40), componentVersion='1.0.0-test', now=Date.parse('2026-10-07T12:00:00.000Z');
const digest=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const files={'kernel.js':Buffer.from('// synthetic kernel\n')};
const manifestBytes=Buffer.from(JSON.stringify({schemaVersion:1,version:componentVersion,sourceCommit:sourceSha,
  files:{'kernel.js':digest(files['kernel.js'])}}));
function certificate():ActiveReleaseCertificate {
  const component={version:componentVersion,sourceSha,manifestSha256:digest(manifestBytes)};
  return {schemaVersion:1,sourceSha,productVersion:'1.0.0-test',canonicalOrigin:ACTIVE_RELEASE_ORIGIN,
    releaseRunId:'123456789',ciRunId:'123456788',publishedAtUtc:'2026-10-07T11:00:00.000Z',status:'ACTIVE',
    checks:{ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true},
    components:{server:{...component},web:{...component},satellite:{...component}}};
}
function envelope(cert=certificate()) {
  return {certificate:cert,signature:sign(null,activeReleaseSigningBytes(cert),keys.privateKey).toString('base64url')};
}
async function pin(cert=certificate()):Promise<VerifiedActiveRelease> {
  const result=await readCanonicalActiveRelease({sourceId:ACTIVE_RELEASE_SOURCE,publicKeySpkiPem:publicKey,
    readProtectedEnvelope:async()=>envelope(cert),now,expectedSourceSha:sourceSha});
  assert.equal(result.status,'VERIFIED_ACTIVE_PIN');if(result.status!=='VERIFIED_ACTIVE_PIN') throw new Error('synthetic fixture');
  return result.pin;
}
const receipt=()=>({sourceSha,version:componentVersion,manifestSha256:digest(manifestBytes),
  checkedAt:'2026-10-07T11:30:00.000Z',connected:true,applied:true});

test('declared ACTIVE checks or source/version alone cannot establish an active pin',async()=>{
  assert.equal(verifyActiveReleaseEnvelope({certificate:certificate()},publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  assert.equal(verifyActiveReleaseEnvelope(envelope(),undefined,{now}).status,'NO_ACTIVE_PIN');
  const candidate=verifyActiveReleaseEnvelope(envelope(),publicKey,{now});assert.equal(candidate.status,'CANDIDATE_UNVERIFIED');
  assert.equal(assessActiveReleaseReceipt(candidate as any,'web',receipt(),{now}).status,'NO_ACTIVE_PIN');
  assert.equal(assessActiveReleaseReceipt({certificate:certificate()} as any,'web',receipt(),{now}).status,'NO_ACTIVE_PIN');
  assert.equal(assessReleaseManifest({certificate:certificate()} as any,'web',manifestBytes).status,'NO_ACTIVE_PIN');
});

test('only signature plus current protected canonical read creates a frozen branded pin',async()=>{
  const active=await pin();assert.equal(active.certificate.sourceSha,sourceSha);assert.equal(Object.isFrozen(active.certificate.components.web),true);
  const clone=structuredClone(active);assert.equal(assessActiveReleaseReceipt(clone,'web',receipt(),{now}).status,'NO_ACTIVE_PIN');
  assert.equal(assessActiveReleaseReceipt(active,'web',receipt(),{now}).status,'MATCH_REPORTED');
});

test('missing configuration, absent pointer or read outage remains unverified and sanitized',async()=>{
  let reads=0;
  const source={sourceId:ACTIVE_RELEASE_SOURCE,readProtectedEnvelope:async()=>{reads++;return envelope();},now};
  assert.equal((await readCanonicalActiveRelease(source)).status,'NO_ACTIVE_PIN');assert.equal(reads,0);
  const absent=await readCanonicalActiveRelease({...source,publicKeySpkiPem:publicKey,readProtectedEnvelope:async()=>undefined});
  assert.deepEqual(absent,{status:'NO_ACTIVE_PIN',reason:'CANONICAL_POINTER_ABSENT'});
  const unavailable=await readCanonicalActiveRelease({...source,publicKeySpkiPem:publicKey,readProtectedEnvelope:async()=>{throw new Error('synthetic private transport detail');}});
  assert.deepEqual(unavailable,{status:'NO_ACTIVE_PIN',reason:'CANONICAL_POINTER_UNAVAILABLE'});
  assert.equal(JSON.stringify(unavailable).includes('private transport'),false);
  const wrong=await readCanonicalActiveRelease({...source,publicKeySpkiPem:publicKey,sourceId:'client/body' as any});
  assert.equal(wrong.status,'NO_ACTIVE_PIN');assert.equal(reads,0);
});

test('tampering, wrong trusted key, in-envelope key or a non-Ed25519 public key is rejected',()=>{
  const signed=envelope();signed.certificate.productVersion='1.0.1';assert.equal(verifyActiveReleaseEnvelope(signed,publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();
  assert.equal(verifyActiveReleaseEnvelope(envelope(),other,{now}).status,'INVALID_ACTIVE_PIN');
  assert.equal(verifyActiveReleaseEnvelope({...envelope(),publicKey},publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  const wrongType=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'pem'}).toString();
  assert.equal(verifyActiveReleaseEnvelope(envelope(),wrongType,{now}).status,'INVALID_ACTIVE_PIN');
  assert.equal(verifyActiveReleaseEnvelope({...envelope(),signature:'a'.repeat(85)},publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  assert.equal(verifyActiveReleaseEnvelope(envelope(),'unconfigured-key-text',{now}).status,'INVALID_ACTIVE_PIN');
});

for(const gate of ['ciPassed','humanReviewApproved','protectedDeploySucceeded','smokePassed'] as const) test(`signed but ${gate} pending never promotes`,async()=>{
  const cert=certificate();cert.checks[gate]=false;
  assert.equal(verifyActiveReleaseEnvelope(envelope(cert),publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  assert.equal((await readCanonicalActiveRelease({sourceId:ACTIVE_RELEASE_SOURCE,publicKeySpkiPem:publicKey,readProtectedEnvelope:async()=>envelope(cert),now})).status,'INVALID_ACTIVE_PIN');
});

test('certificate binds exact source, canonical origin, three known components and publication time',()=>{
  const bad:ActiveReleaseCertificate[]=[];
  let c=certificate();c.components.web.sourceSha='b'.repeat(40);bad.push(c);
  c=certificate();c.canonicalOrigin='https://fallback.example.invalid';bad.push(c);
  c=certificate();(c.components as any).unknown={...c.components.web};bad.push(c);
  c=certificate();delete (c.components as any).server;bad.push(c);
  c=certificate();c.components.web.manifestSha256='x';bad.push(c);
  c=certificate();c.publishedAtUtc='2026-10-07T12:01:00.000Z';bad.push(c);
  c=certificate();c.releaseRunId='201';(c as any).serverProvenance=true;bad.push(c);
  for(const invalid of bad) assert.equal(verifyActiveReleaseEnvelope(envelope(invalid),publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  assert.equal(verifyActiveReleaseEnvelope(envelope(),publicKey,{now,expectedSourceSha:'b'.repeat(40)}).status,'INVALID_ACTIVE_PIN');
});

test('canonical serialization survives field order without accepting payload changes',()=>{
  const cert=certificate(),signed=envelope(cert);const reordered={...signed,certificate:Object.fromEntries(Object.entries(cert).reverse())};
  assert.equal(verifyActiveReleaseEnvelope(reordered,publicKey,{now}).status,'CANDIDATE_UNVERIFIED');
  assert.equal(verifyActiveReleaseEnvelope({...signed,signature:signed.signature.replace(/^./,signed.signature[0]==='a'?'b':'a')},publicKey,{now}).status,'INVALID_ACTIVE_PIN');
});

test('exact manifesto bytes and every listed file are necessary for package integrity',async()=>{
  const active=await pin();assert.deepEqual(assessReleaseManifest(active,'satellite',manifestBytes),{status:'MANIFEST_MATCH_ONLY',fileIntegrityVerified:false});
  assert.deepEqual(assessReleaseManifest(active,'satellite',manifestBytes,files),{status:'PACKAGE_FILES_VERIFIED',fileIntegrityVerified:true});
  assert.equal(assessReleaseManifest(active,'satellite',Buffer.concat([manifestBytes,Buffer.from(' ')])).status,'MANIFEST_CONFLICT');
  assert.equal(assessReleaseManifest(active,'satellite',manifestBytes,{'kernel.js':Buffer.from('changed')}).status,'PACKAGE_FILES_CONFLICT');
  assert.equal(assessReleaseManifest(active,'satellite',manifestBytes,{}).status,'PACKAGE_FILES_CONFLICT');
});

test('sourceRevision/clientVersion variants are understood but dirty or different identities are blocked',async()=>{
  for(const manifest of [{sourceRevision:sourceSha,version:componentVersion,dirty:false},
    {sourceCommit:sourceSha,clientVersion:componentVersion}, {sourceCommit:sourceSha,version:componentVersion,dirty:true},
    {sourceCommit:'b'.repeat(40),version:componentVersion}, {sourceCommit:sourceSha,version:'0.2.0-beta.4'},
    {sourceSha,sourceCommit:'b'.repeat(40),version:componentVersion}]) {
    const bytes=Buffer.from(JSON.stringify(manifest));const cert=certificate();cert.components.satellite!.manifestSha256=digest(bytes);
    const result=assessReleaseManifest(await pin(cert),'satellite',bytes);
    assert.equal(result.status,('dirty' in manifest&&manifest.dirty===true)||manifest.sourceCommit==='b'.repeat(40)||manifest.version==='0.2.0-beta.4'?'MANIFEST_IDENTITY_CONFLICT':'MANIFEST_MATCH_ONLY');
  }
});

test('unsafe manifest paths cannot claim verified package files even when signed in a candidate',async()=>{
  const bytes=Buffer.from(JSON.stringify({sourceCommit:sourceSha,version:componentVersion,files:{'../escape.js':digest(files['kernel.js'])}}));
  const cert=certificate();cert.components.satellite!.manifestSha256=digest(bytes);
  assert.equal(assessReleaseManifest(await pin(cert),'satellite',bytes,{'../escape.js':files['kernel.js']}).status,'PACKAGE_FILES_CONFLICT');
});

test('real downloads files-array schema verifies bounded unique package sizes and hashes',async()=>{
  const name='AURORA-NEXUS-Instalar.exe',file=Buffer.from('synthetic installer');
  const entry={name,label:'Windows',platform:'windows',size:file.length,sha256:digest(file),signed:false};
  const assess=async(entries:any[],actual:Record<string,Uint8Array>)=>{
    const bytes=Buffer.from(JSON.stringify({schemaVersion:1,sourceCommit:sourceSha,version:componentVersion,files:entries}));
    const cert=certificate();cert.components.satellite!.manifestSha256=digest(bytes);
    return assessReleaseManifest(await pin(cert),'satellite',bytes,actual);
  };
  assert.equal((await assess([entry],{[name]:file})).status,'PACKAGE_FILES_VERIFIED');
  for(const entries of [[entry,entry],[{...entry,name:'../escape.exe'}],[{...entry,sha256:'b'.repeat(64)}],
    [{...entry,size:file.length+1}],[{...entry,size:0}],[{...entry,platform:'other'}],[{...entry,signed:'false'}]]) {
    assert.equal((await assess(entries,{[name]:file})).status,'PACKAGE_FILES_CONFLICT');
  }
  assert.equal((await assess([entry],{[name]:file,'extra.exe':file})).status,'PACKAGE_FILES_CONFLICT');
});

test('missing receipt, offline client and unapplied update are never current',async()=>{
  const active=await pin();assert.equal(assessActiveReleaseReceipt(active,'web',undefined,{now}).status,'NOT_REPORTED');
  for(const patch of [{connected:false},{applied:false}]) {
    const result=assessActiveReleaseReceipt(active,'web',{...receipt(),...patch},{now});
    assert.equal(result.reportedCurrent,false);assert.equal(result.deviceInstallationVerified,false);
    assert.equal(result.status,'connected' in patch?'OFFLINE_PENDING':'UPDATE_NOT_APPLIED');
  }
  assert.equal(assessActiveReleaseReceipt(active,'web',{sourceSha,version:componentVersion,connected:true,applied:true},{now}).status,'INVALID_RECEIPT');
});

for(const patch of [{sourceSha:'b'.repeat(40)},{version:'1.0.1'},{manifestSha256:'b'.repeat(64)}]) test(`receipt identity mismatch ${Object.keys(patch)[0]} stays pending`,async()=>{
  assert.equal(assessActiveReleaseReceipt(await pin(),'web',{...receipt(),...patch},{now}).status,'VERSION_CONFLICT');
});

test('old, future or pre-publication receipts cannot confirm the current release',async()=>{
  const active=await pin();
  for(const checkedAt of ['2026-10-07T10:59:59.000Z','2026-10-07T12:00:01.000Z']) assert.equal(assessActiveReleaseReceipt(active,'web',{...receipt(),checkedAt},{now}).status,'STALE_RECEIPT');
  assert.equal(assessActiveReleaseReceipt(active,'web',receipt(),{now,maxAgeMs:60_000}).status,'STALE_RECEIPT');
  assert.equal(assessActiveReleaseReceipt(active,'web',receipt(),{now,maxAgeMs:0}).status,'STALE_RECEIPT');
});

test('a fresh receipt reports a match but never asserts native device verification',async()=>{
  assert.deepEqual(assessActiveReleaseReceipt(await pin(),'web',receipt(),{now}),{status:'MATCH_REPORTED',reportedCurrent:true,deviceInstallationVerified:false});
  const cert=certificate();delete cert.components.satellite;
  assert.equal(assessActiveReleaseReceipt(await pin(cert),'satellite',receipt(),{now}).status,'NO_ACTIVE_PIN');
});

function certificateV2():ActiveReleaseCertificate {
  const c=certificate();c.schemaVersion=2;
  c.components.iaMaster={...c.components.web};c.components.windowsIntegration={...c.components.web};return c;
}
test('historical v1 signing bytes remain compatible and its coverage stays partial',async()=>{
  assert.ok(activeReleaseSigningBytes(certificate()).toString().startsWith('AURORA_ACTIVE_RELEASE_V1\0'));
  assert.equal(verifyActiveReleaseEnvelope(envelope(),publicKey,{now}).status,'CANDIDATE_UNVERIFIED');
  const active=await pin();const coverage=assessReleaseComponentCoverage(active);
  assert.equal(coverage.status,'PARTIAL');assert.equal(coverage.complete,false);
  assert.deepEqual(coverage.missingComponents,['iaMaster','windowsIntegration']);
  assert.equal(assessReleaseManifest(active,'iaMaster',manifestBytes,files).status,'NO_ACTIVE_PIN');
});
test('v2 signs a distinct domain and requires all five components without asserting device acceptance',async()=>{
  const c=certificateV2();assert.ok(activeReleaseSigningBytes(c).toString().startsWith('AURORA_ACTIVE_RELEASE_V2\0'));
  const active=await pin(c),coverage=assessReleaseComponentCoverage(active);
  assert.equal(coverage.status,'COMPLETE_SIGNED_COMPONENT_SET');assert.equal(coverage.complete,true);
  assert.deepEqual(coverage.coveredComponents,[...REQUIRED_RELEASE_COMPONENTS]);
  assert.equal(assessReleaseComponentCoverage(structuredClone(active)).complete,false);
  assert.equal(assessActiveReleaseReceipt(active,'iaMaster',receipt(),{now}).deviceInstallationVerified,false);
});
for(const component of REQUIRED_RELEASE_COMPONENTS)test(`v2 missing ${component} fails even with a valid test signature`,()=>{
  const c=certificateV2();delete(c.components as any)[component];
  assert.equal(verifyActiveReleaseEnvelope(envelope(c),publicKey,{now}).status,'INVALID_ACTIVE_PIN');
});
test('schema relabelling, extra roles and mixed source cannot downgrade a v2 signature',()=>{
  const signed=envelope(certificateV2());const changed=structuredClone(signed);changed.certificate.schemaVersion=1;
  assert.equal(verifyActiveReleaseEnvelope(changed,publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  const relabelled=certificate();relabelled.schemaVersion=2;
  assert.equal(verifyActiveReleaseEnvelope(envelope(relabelled),publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  const extra=certificateV2();(extra.components as any).arbitrary={...extra.components.web};
  assert.equal(verifyActiveReleaseEnvelope(envelope(extra),publicKey,{now}).status,'INVALID_ACTIVE_PIN');
  const mixed=certificateV2();mixed.components.iaMaster!.sourceSha='b'.repeat(40);
  assert.equal(verifyActiveReleaseEnvelope(envelope(mixed),publicKey,{now}).status,'INVALID_ACTIVE_PIN');
});
for(const component of ['iaMaster','windowsIntegration'] as const)test(`a signed server manifest cannot impersonate ${component}`,async()=>{
  const c=certificateV2();c.components[component]!.manifestSha256=digest(manifestBytes);
  assert.equal(assessReleaseManifest(await pin(c),component,manifestBytes,files).status,'INVALID_MANIFEST');
});
