import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { ACTIVE_RELEASE_ORIGIN, ACTIVE_RELEASE_SOURCE, activeReleaseSigningBytes, readCanonicalActiveRelease,
  verifyActiveReleaseEnvelope, type ActiveReleaseCertificate, type VerifiedActiveRelease } from '../src/auroraActiveRelease.js';
import { createActiveReleaseRuntime } from '../src/auroraActiveReleaseRuntime.js';
import { createActiveReleaseReadHandler, ACTIVE_RELEASE_READ_PATH } from '../src/auroraActiveReleaseRead.js';
import { BETA_PLATFORMS, buildUnifiedBetaRelease, type BetaPlatform, type UnifiedBetaProjection } from '../src/auroraUnifiedBeta.js';
import { buildReleaseStatus } from '../src/auroraReleaseStatus.js';

// Real Ed25519 signing and existing readers; only synthetic in-memory keys/build files.
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const now = Date.parse('2026-10-14T12:00:00.000Z'), sourceSha = 'a'.repeat(40);
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function fixture(source = sourceSha) {
  const serverFiles = { 'lib/server.js': Buffer.from('// synthetic server') };
  const webFiles = { 'lib/frontend.js': Buffer.from('// synthetic web') };
  const manifest = (files: Record<string, Buffer>, s = source) => Buffer.from(JSON.stringify({ schemaVersion: 1,
    sourceSha: s, version: '1.1.0-beta.1', files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, hash(v)])) }));
  const serverBytes = manifest(serverFiles), webBytes = manifest(webFiles);
  const cert: ActiveReleaseCertificate = { schemaVersion: 2, canonicalOrigin: ACTIVE_RELEASE_ORIGIN, sourceSha: source,
    productVersion: '1.1.0-beta.1', ciRunId: '123', releaseRunId: '124', publishedAtUtc: '2026-10-14T11:00:00.000Z', status: 'ACTIVE',
    checks: { ciPassed: true, humanReviewApproved: true, protectedDeploySucceeded: true, smokePassed: true }, components: {
      server: { sourceSha: source, version: '1.1.0-beta.1', manifestSha256: hash(serverBytes) },
      web: { sourceSha: source, version: '1.1.0-beta.1', manifestSha256: hash(webBytes) },
      satellite: { sourceSha: source, version: '0.2.0-hml.20261001', manifestSha256: 'b'.repeat(64) },
      iaMaster: { sourceSha: source, version: '1.1.0', manifestSha256: 'c'.repeat(64) },
      windowsIntegration: { sourceSha: source, version: '1.0.1', manifestSha256: 'd'.repeat(64) }
    } };
  const signed = (certificate = cert) => ({ certificate, signature: sign(null, activeReleaseSigningBytes(certificate), keys.privateKey).toString('base64url') });
  const envelope = signed();
  const dependencies = { publicKey: () => publicKey, now: () => now, readProtectedEnvelope: async () => envelope,
    readServerManifest: async () => serverBytes, readServerFiles: async () => serverFiles,
    readWebManifest: async () => webBytes, readWebFiles: async () => webFiles };
  return { cert, envelope, signed, dependencies, manifest, webFiles };
}
async function pin(certificate: ActiveReleaseCertificate = fixture().cert): Promise<VerifiedActiveRelease> {
  const f = fixture();
  const active = await readCanonicalActiveRelease({ sourceId: ACTIVE_RELEASE_SOURCE, publicKeySpkiPem: publicKey, now,
    readProtectedEnvelope: async () => f.signed(certificate) });
  assert.equal(active.status, 'VERIFIED_ACTIVE_PIN');
  if (active.status !== 'VERIFIED_ACTIVE_PIN') throw Error('fixture');
  return active.pin;
}
function observation(projection: UnifiedBetaProjection, platform: BetaPlatform) {
  assert.ok(projection.reference);
  return { ...projection.reference, kind: projection.platforms[platform].kind, connected: true,
    technicalVersions: { ...projection.platforms[platform].technicalVersions }, checkedAt: '2026-10-14T11:30:00.000Z' };
}

test('verified active reference yields the exact same beta identity on all five real client types', async () => {
  const p = buildUnifiedBetaRelease(await pin(), { now });
  assert.equal(p.referenceStatus, 'VERIFIED_REFERENCE');
  assert.equal(p.reference?.releaseId, 'aurora-1.1.0-beta.1-' + sourceSha);
  for (const platform of BETA_PLATFORMS) {
    assert.strictEqual(p.platforms[platform].expectedRelease, p.reference);
    assert.equal(p.platforms[platform].installationVerified, false);
  }
  assert.deepEqual(p.platforms.windows.technicalVersions, { satellite: '0.2.0-hml.20261001', iaMaster: '1.1.0', windowsIntegration: '1.0.1' });
  assert.equal(p.platforms.windows.identity.clientVersion, '0.2.0-beta.4');
  assert.equal(p.platforms.mac.kind, 'EXISTING_MAC_APP');
  assert.equal(p.platforms.mac.identity.applicationName, 'Aurora Nexus HML-0.2.0-hml.20261001.app');
  assert.equal(p.platforms.mac.identity.bundleIdentifier, 'br.com.auroranexus.desktop.hml');
  assert.equal(p.platforms.mac.identity.shortVersion, '0.2.0');
  assert.equal(p.platforms.mac.identity.bundleVersion, '1');
  for (const platform of ['ios', 'android'] as const) {
    assert.equal(p.platforms[platform].kind, 'EXISTING_PWA');
    assert.equal(p.platforms[platform].identity.manifestId, '/portal');
    assert.equal(p.platforms[platform].nativeApplicationClaimed, false);
  }
  assert.equal(Object.isFrozen(p.platforms.mac.identity), true);
  assert.equal(p.convergenceStatus, 'PENDING');
  assert.equal(p.allClientsSynchronized, false);
});

test('unknown, forged brand and isolated valid signature cannot establish the unified beta reference', () => {
  const f = fixture(), candidate = verifyActiveReleaseEnvelope(f.envelope, publicKey, { now });
  for (const unknown of [undefined, { certificate: f.cert, certificateSha256: 'a'.repeat(64) }, candidate]) {
    const p = buildUnifiedBetaRelease(unknown as any, { now });
    assert.equal(p.reference, null);
    for (const platform of BETA_PLATFORMS) assert.equal(p.platforms[platform].expectedRelease, null);
    assert.equal(p.allClientsSynchronized, false);
  }
});

test('legitimate v1 remains partial instead of granting five-platform coverage', async () => {
  const c = fixture().cert; c.schemaVersion = 1; delete c.components.iaMaster; delete c.components.windowsIntegration;
  const p = buildUnifiedBetaRelease(await pin(c), { now });
  assert.equal(p.referenceStatus, 'PENDING_PARTIAL_REFERENCE');
  assert.equal(p.reference, null);
});

test('offline or unavailable observation remains pending even with a cached matching identity', async () => {
  const active = await pin(), p = buildUnifiedBetaRelease(active, { now });
  const offline = buildUnifiedBetaRelease(active, { now, online: false });
  assert.equal(offline.referenceStatus, 'PENDING_OFFLINE'); assert.equal(offline.reference, null);
  const q = buildUnifiedBetaRelease(active, { now, observations: { mac: { ...observation(p, 'mac'), connected: false } } });
  assert.equal(q.platforms.mac.state, 'PENDING_OFFLINE');
  assert.equal(q.platforms.windows.state, 'PENDING_NOT_OBSERVED');
  assert.equal(q.deviceInstallationVerified, false);
});

for (const field of ['sourceSha', 'certificateSha256', 'releaseId', 'productVersion'] as const) {
  test(`mixed ${field} observation is rejected without changing the expected reference`, async () => {
    const active = await pin(), p = buildUnifiedBetaRelease(active, { now });
    const value = { ...observation(p, 'windows'), [field]: 'other-release' };
    const mixed = buildUnifiedBetaRelease(active, { now, observations: { windows: value } });
    assert.equal(mixed.platforms.windows.state, 'CONFLICT_RELEASE_IDENTITY');
    assert.equal(mixed.convergenceStatus, 'CONFLICT');
    assert.deepEqual(mixed.reference, p.reference);
    assert.equal(mixed.allClientsSynchronized, false);
  });
}

test('separately signed certificates of the same source retain releaseId but cannot mix certificate identity', async () => {
  const c1 = fixture().cert, c2 = structuredClone(c1); c2.releaseRunId = '125';
  const a = await pin(c1), b = await pin(c2), p = buildUnifiedBetaRelease(a, { now });
  const q = buildUnifiedBetaRelease(b, { now, observations: { ios: observation(p, 'ios') } });
  assert.equal(p.reference?.releaseId, q.reference?.releaseId);
  assert.notEqual(p.reference?.certificateSha256, q.reference?.certificateSha256);
  assert.equal(q.platforms.ios.state, 'CONFLICT_RELEASE_IDENTITY');
});

test('technical versions remain distinct and mismatch never promotes device installation', async () => {
  const active = await pin(), p = buildUnifiedBetaRelease(active, { now });
  const value = observation(p, 'windows'); value.technicalVersions.iaMaster = '1.0.0';
  const q = buildUnifiedBetaRelease(active, { now, observations: { windows: value } });
  assert.equal(q.platforms.windows.state, 'CONFLICT_TECHNICAL_VERSION');
  assert.equal(q.platforms.windows.installationVerified, false);
});

test('mobile native claims and additional arbitrary observation fields are not accepted', async () => {
  const active = await pin(), p = buildUnifiedBetaRelease(active, { now });
  const q = buildUnifiedBetaRelease(active, { now, observations: {
    ios: { ...observation(p, 'ios'), kind: 'NATIVE_IOS_APP' },
    android: { ...observation(p, 'android'), nativePlayStoreBuild: true }
  } });
  assert.equal(q.platforms.ios.state, 'CONFLICT_CLIENT_KIND');
  assert.equal(q.platforms.android.state, 'PENDING_INVALID_OBSERVATION');
  assert.equal(q.platforms.ios.kind, 'EXISTING_PWA');
  assert.equal(q.platforms.android.nativeApplicationClaimed, false);
  const unknown = buildUnifiedBetaRelease(active, { observations: { unknown: {} } as any });
  assert.equal(unknown.convergenceStatus, 'CONFLICT');
});

test('future, stale, pre-publication or malformed reports remain pending and sanitized', async () => {
  const active = await pin(), p = buildUnifiedBetaRelease(active, { now });
  for (const checkedAt of ['2026-10-14T12:01:00.000Z', '2026-10-12T11:30:00.000Z', '2026-10-14T10:59:00.000Z', 'private-detail']) {
    const q = buildUnifiedBetaRelease(active, { now, observations: { mac: { ...observation(p, 'mac'), checkedAt } } });
    assert.match(q.platforms.mac.state, /^PENDING_/);
    assert.equal(JSON.stringify(q).includes('private-detail'), false);
  }
});

test('five matching reports are still reports, not simultaneous installed or accepted clients', async () => {
  const active = await pin(), p = buildUnifiedBetaRelease(active, { now });
  const reports = Object.fromEntries(BETA_PLATFORMS.map(platform => [platform, observation(p, platform)]));
  const q = buildUnifiedBetaRelease(active, { now, observations: reports });
  for (const platform of BETA_PLATFORMS) assert.equal(q.platforms[platform].state,
    platform==='ios'?'PENDING_NATIVE_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE':'REFERENCE_MATCH_REPORTED');
  assert.equal(q.allClientsSynchronized, false); assert.equal(q.deviceInstallationVerified, false);
});
test('existing PWA cannot satisfy the requested native TestFlight or App Store delivery',async()=>{
  const active=await pin(), p=buildUnifiedBetaRelease(active,{now});
  const q=buildUnifiedBetaRelease(active,{now,observations:{ios:observation(p,'ios')}});
  assert.equal(q.platforms.ios.kind,'EXISTING_PWA');
  assert.equal(q.platforms.ios.currentDistribution,'EXISTING_PWA');
  assert.equal(q.platforms.ios.requestedDistribution,'NATIVE_TESTFLIGHT_APP_STORE');
  assert.equal(q.platforms.ios.nativeDeliveryStatus,'PENDING_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE');
  assert.equal(q.platforms.ios.nativeReleaseIdentityVerified,false);
  assert.equal(q.platforms.ios.state,'PENDING_NATIVE_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE');
  assert.equal(q.allClientsSynchronized,false);
});

test('runtime caller performs actual signed-pin and startup-file projection; cockpit consumes that same projection', async () => {
  const f = fixture(), runtime = await createActiveReleaseRuntime(f.dependencies)();
  assert.equal(runtime.unifiedBeta.runtimeStatus, 'RUNTIME_BYTES_MATCH');
  assert.equal(runtime.unifiedBeta.platforms.web.state, 'RUNTIME_BYTES_MATCH');
  const cockpit = buildReleaseStatus({ allClientsSynchronized: true }, runtime.unifiedBeta) as any;
  assert.equal(cockpit.productVersionSource, 'VERIFIED_ACTIVE_REFERENCE');
  assert.strictEqual(cockpit.releaseConvergence.unifiedBeta, runtime.unifiedBeta);
  assert.equal(cockpit.releaseConvergence.allClientsSynchronized, false);
  assert.equal(cockpit.gates.find((g: any) => g.id === 'desktop-continuity').status, 'BLOCKED');
  assert.equal(cockpit.gates.find((g: any) => g.id === 'desktop-continuity').detail.includes('precisa de inspeção'), false);
  const clone = buildReleaseStatus({}, structuredClone(runtime.unifiedBeta)) as any;
  assert.equal(clone.productVersionSource, 'ENGINEERING_DEFAULT_UNVERIFIED');
  assert.equal(clone.releaseConvergence.unifiedBeta.reference, null);
});

test('mixed actual runtime source or manifest bytes cannot appear as the beta applied to the web', async () => {
  const f = fixture();
  const mixed = await createActiveReleaseRuntime({ ...f.dependencies,
    readWebManifest: async () => f.manifest(f.webFiles, 'b'.repeat(40)) })();
  assert.equal(mixed.unifiedBeta.runtimeStatus, 'CONFLICT_RUNTIME_BYTES');
  assert.equal(mixed.unifiedBeta.platforms.web.state, 'CONFLICT_RUNTIME_BYTES');
  assert.equal(mixed.unifiedBeta.convergenceStatus, 'CONFLICT');
  const unknown = await createActiveReleaseRuntime({ ...f.dependencies, readWebManifest: async () => { throw Error('synthetic unavailable'); } })();
  assert.equal(unknown.unifiedBeta.runtimeStatus, 'PENDING_RUNTIME_BYTES');
  assert.equal(unknown.unifiedBeta.platforms.web.installationVerified, false);
});

test('private active-release endpoint retains its strict twelve-field contract with the new real runtime projection', async () => {
  const f = fixture(), runtime = createActiveReleaseRuntime(f.dependencies);
  const req = { method: 'GET', path: ACTIVE_RELEASE_READ_PATH, query: {}, get: (name: string) => name === 'x-aurora-release-nonce' ? 'e'.repeat(64) : 'synthetic bearer' };
  const res: any = { body: null, code: 0, set() { return this; }, status(c: number) { this.code = c; return this; }, json(v: unknown) { this.body = v; return this; } };
  await createActiveReleaseReadHandler({ publicKey: () => publicKey, now: () => now,
    authorize: async () => ({ orgId: 'test-org', keyId: 'synthetic', name: 'synthetic' }), authorityActive: async () => true,
    readFixedProtectedEnvelope: async () => f.envelope, readRuntime: runtime })(req, res);
  assert.equal(res.code, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['schemaVersion', 'source', 'canonicalOrigin', 'orgId', 'requestNonce', 'observedAtUtc',
    'certificateSha256', 'envelope', 'runtime', 'componentCoverage', 'nativeMacInstallation', 'deviceInstallationVerified'].sort());
  assert.equal('unifiedBeta' in res.body, false);
  assert.equal(res.body.nativeMacInstallation, 'UNVERIFIED');
});
