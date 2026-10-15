import {createHash} from 'node:crypto';
import {readFileSync, statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {activeReleaseSigningBytes} from '../functions/lib/auroraActiveRelease.js';

const row = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const version = value => typeof value === 'string' && value.length <= 80
  && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const codes = new Set(['DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED', 'DEPLOYMENT_BOOTSTRAP_READINESS_REJECTED',
  'DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT', 'DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT',
  'DEPLOYMENT_BOOTSTRAP_VERSION_CONFLICT']);
const fail = code => { throw new Error(code); };

/** Checks a private authenticated response without emitting its payload or granting release authority. */
export function verifyDeploymentBootstrap(bootstrap, options) {
  if (!row(options) || typeof options.publishActiveRelease !== 'boolean' || !sha(options.sourceSha, 40)
    || !version(options.engineeringVersion) || !row(bootstrap) || bootstrap.ok !== true
    || !row(bootstrap.release) || !row(bootstrap.canonicalVersion)) fail('DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED');
  const release = bootstrap.release, canonical = bootstrap.canonicalVersion;
  if (typeof release.engineeringReadinessPercent !== 'number' || !Number.isFinite(release.engineeringReadinessPercent)
    || release.engineeringReadinessPercent < 0 || release.engineeringReadinessPercent > 100) fail('DEPLOYMENT_BOOTSTRAP_READINESS_REJECTED');
  for (const [component, key] of [['server', 'runtimeBuild'], ['web', 'runtimeBuildWeb']]) {
    const build = canonical[key];
    if (!options.publishActiveRelease && row(build) && build.status === 'BUILD_METADATA_UNAVAILABLE'
      && build.sourceSha === null && build.version === null && build.manifestSha256 === null
      && build.fileIntegrityVerified === false) continue;
    if (!row(build) || build.status !== 'RUNTIME_BUILD_OBSERVED' || build.sourceSha !== options.sourceSha
      || build.fileIntegrityVerified !== true || !sha(build.manifestSha256, 64)
      || (build.version !== undefined && build.version !== options.engineeringVersion)) fail('DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT');
    if (options.publishActiveRelease) {
      const bytes = options.manifestBytes?.[component];
      if (!(bytes instanceof Uint8Array) || bytes.length > 65_536 || digest(bytes) !== build.manifestSha256) fail('DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT');
      let manifest;
      try { manifest = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { fail('DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT'); }
      if (!row(manifest) || manifest.schemaVersion !== 1 || manifest.sourceSha !== options.sourceSha
        || manifest.version !== options.engineeringVersion || !row(manifest.files) || !Object.keys(manifest.files).length
        || Object.values(manifest.files).some(hash => !sha(hash, 64))) fail('DEPLOYMENT_BOOTSTRAP_RUNTIME_CONFLICT');
    }
  }
  if (!row(canonical.unifiedBeta) || !row(canonical.verification)) fail('DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT');
  const reference = canonical.unifiedBeta.reference;
  const previous = options.previousCertificateSha256;
  if (options.publishActiveRelease && previous !== 'NONE' && !sha(previous, 64)) fail('DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED');
  if (reference === null) {
    if (canonical.certificate !== null || canonical.verification.status !== 'NO_ACTIVE_PIN'
      || canonical.verification.source !== 'platformRuntime/activeRelease'
      || !['CANONICAL_POINTER_ABSENT', 'VERIFICATION_KEY_UNCONFIGURED'].includes(canonical.verification.reason)
      || canonical.unifiedBeta.referenceStatus !== 'PENDING_VERIFIED_REFERENCE'
      || (options.publishActiveRelease && (previous !== 'NONE' || canonical.verification.reason !== 'CANONICAL_POINTER_ABSENT'))) {
      fail('DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT');
    }
    if (release.productVersion !== options.engineeringVersion
      || release.productVersionSource !== 'ENGINEERING_DEFAULT_UNVERIFIED') fail('DEPLOYMENT_BOOTSTRAP_VERSION_CONFLICT');
  } else {
    const certificate = canonical.certificate;
    if (!row(reference) || Object.keys(reference).sort().join(',') !== 'certificateSha256,productVersion,releaseId,sourceSha'
      || !version(reference.productVersion) || !sha(reference.sourceSha, 40) || !sha(reference.certificateSha256, 64)
      || reference.releaseId !== `aurora-${reference.productVersion}-${reference.sourceSha}`
      || canonical.unifiedBeta.referenceStatus !== 'VERIFIED_REFERENCE'
      || canonical.verification.status !== 'VERIFIED_ACTIVE_PIN' || canonical.verification.algorithm !== 'Ed25519'
      || canonical.verification.source !== 'platformRuntime/activeRelease'
      || canonical.verification.certificateSha256 !== reference.certificateSha256
      || !row(certificate) || certificate.schemaVersion !== 2 || certificate.status !== 'ACTIVE'
      || certificate.canonicalOrigin !== 'https://auroranexus.com.br'
      || certificate.sourceSha !== reference.sourceSha || certificate.productVersion !== reference.productVersion
      || digest(activeReleaseSigningBytes(certificate)) !== reference.certificateSha256
      || (options.publishActiveRelease && previous !== reference.certificateSha256)) fail('DEPLOYMENT_BOOTSTRAP_REFERENCE_CONFLICT');
    if (release.productVersion !== reference.productVersion || release.productVersionSource !== 'VERIFIED_ACTIVE_REFERENCE') {
      fail('DEPLOYMENT_BOOTSTRAP_VERSION_CONFLICT');
    }
  }
  return {status: 'PASS', code: 'DEPLOYMENT_BOOTSTRAP_VERIFIED'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), values = {};
    const allowed = new Set(['--bootstrap', '--source-sha', '--engineering-version', '--publish-active-release', '--previous-sha256']);
    for (let index = 0; index < args.length; index += 2) {
      if (!allowed.has(args[index]) || Object.hasOwn(values, args[index]) || typeof args[index + 1] !== 'string') fail('DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED');
      values[args[index]] = args[index + 1];
    }
    if (Object.keys(values).length !== allowed.size || !['true', 'false'].includes(values['--publish-active-release'])
      || statSync(values['--bootstrap']).size > 2_000_000) fail('DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED');
    const publishActiveRelease = values['--publish-active-release'] === 'true';
    const manifestBytes = publishActiveRelease ? Object.fromEntries(['server', 'web'].map(component =>
      [component, readFileSync(new URL(`../functions/runtime-release/${component}-manifest.json`, import.meta.url))])) : undefined;
    const result = verifyDeploymentBootstrap(JSON.parse(readFileSync(values['--bootstrap'], 'utf8')), {
      sourceSha: values['--source-sha'], engineeringVersion: values['--engineering-version'], publishActiveRelease,
      previousCertificateSha256: values['--previous-sha256'], manifestBytes
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({status: 'FAIL', code: codes.has(error?.message) ? error.message : 'DEPLOYMENT_BOOTSTRAP_INPUT_REJECTED'}));
    process.exitCode = 97;
  }
}
