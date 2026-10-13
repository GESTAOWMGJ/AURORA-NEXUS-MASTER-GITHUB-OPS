'use strict';
// Public release control plane. No document transport, credential provisioning or
// implicit service operation. An isolated signature never proves currentness.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const { readRegularFile } = require('./safe-read.cjs');
const ORIGIN = 'https://auroranexus.com.br';
const READ_PATH = '/api/integration/active-release';
const SOURCE = 'platformRuntime/activeRelease';
const COMPONENTS = ['server', 'web', 'satellite', 'iaMaster', 'windowsIntegration'];
const CHECKS = ['ciPassed', 'humanReviewApproved', 'protectedDeploySucceeded', 'smokePassed'];
const WINDOWS_FILES = ['client_agent.py', 'provider_connectors.py', 'client_secret_store.py', 'install_client_agent.py',
  'aurora_cloud_sync.py', 'aurora_deployment.py', 'published_release.py'];
const activePins = new WeakMap();
const candidates = new WeakSet();
const BOOTSTRAP_SOURCE = '56a813aac38390d928122cb774a16b3503977d72';
const BOOTSTRAP_MANIFEST = 'd48d98e6ab94d5e08bcb82732eca6b78e84bd93fc2db9e6022b550ea1e9c63c8';
// Narrow migration contract reviewed for the existing D runtime/C identity.
// A caller-supplied checksum cannot substitute a different manager or layout.
const BOOTSTRAP_HELPER = '5c9a54d9d2c5fb980f88f4d73998ead5ae7d06dc877a1446c4f35249cb9d3eed';
const REVIEWED_RUNTIME_ROOT = 'D:\\AuroraNexus';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const row = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => row(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const hex = (value, length) => typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(value);
const version = value => typeof value === 'string' && value.length <= 80 && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(value);
const utc = value => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function demand(ok, code) { if (!ok) throw Error(code); }
function freeze(value) { if (row(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (row(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function signingBytes(certificate) {
  return Buffer.from('AURORA_ACTIVE_RELEASE_V' + certificate.schemaVersion + '\0' + canonical(certificate), 'utf8');
}
function certificateShape(value) {
  demand(exact(value, ['schemaVersion', 'sourceSha', 'productVersion', 'canonicalOrigin', 'releaseRunId', 'ciRunId', 'publishedAtUtc', 'status', 'checks', 'components'])
    && [1, 2].includes(value.schemaVersion) && hex(value.sourceSha, 40) && version(value.productVersion)
    && value.canonicalOrigin === ORIGIN && value.status === 'ACTIVE' && utc(value.publishedAtUtc)
    && [value.releaseRunId, value.ciRunId].every(id => typeof id === 'string' && /^[1-9][0-9]{0,19}$/.test(id))
    && exact(value.checks, CHECKS) && CHECKS.every(name => value.checks[name] === true), 'INVALID_RELEASE_CERTIFICATE');
  const names = value.schemaVersion === 2 ? COMPONENTS : ['server', 'web', ...(Object.hasOwn(value.components || {}, 'satellite') ? ['satellite'] : [])];
  demand(exact(value.components, names), 'INVALID_COMPONENT_COVERAGE');
  for (const pin of Object.values(value.components)) demand(exact(pin, ['version', 'sourceSha', 'manifestSha256'])
    && version(pin.version) && pin.sourceSha === value.sourceSha && hex(pin.manifestSha256, 64), 'INVALID_COMPONENT_PIN');
}
function verifyCandidate(envelope, trust, expectedSourceSha, now = Date.now()) {
  demand(exact(trust, ['publicKeySpkiPem', 'publicKeySha256']) && typeof trust.publicKeySpkiPem === 'string'
    && trust.publicKeySpkiPem.length <= 8192 && hex(trust.publicKeySha256, 64), 'TRUSTED_PUBLIC_KEY_REQUIRED');
  demand(hex(expectedSourceSha, 40), 'EXPECTED_SOURCE_REQUIRED');
  demand(exact(envelope, ['certificate', 'signature']) && typeof envelope.signature === 'string'
    && /^[A-Za-z0-9_-]{86}$/.test(envelope.signature), 'INVALID_RELEASE_ENVELOPE');
  certificateShape(envelope.certificate);
  const certificate = structuredClone(envelope.certificate);
  const bytes = signingBytes(certificate);
  demand(bytes.length <= 16384 && certificate.sourceSha === expectedSourceSha, 'EXPECTED_SOURCE_CONFLICT');
  demand(Number.isSafeInteger(now) && now >= 0 && Date.parse(certificate.publishedAtUtc) <= now, 'INVALID_PUBLICATION_TIME');
  let key, signature;
  try {
    key = crypto.createPublicKey({ key: trust.publicKeySpkiPem, format: 'pem', type: 'spki' });
    signature = Buffer.from(envelope.signature, 'base64url');
  } catch { throw Error('PUBLIC_KEY_OR_SIGNATURE_INVALID'); }
  demand(key.asymmetricKeyType === 'ed25519'
    && digest(key.export({ format: 'der', type: 'spki' })) === trust.publicKeySha256, 'UNTRUSTED_RELEASE_KEY');
  demand(signature.toString('base64url') === envelope.signature && crypto.verify(null, bytes, key, signature), 'RELEASE_SIGNATURE_REJECTED');
  const candidate = freeze({ status: 'CANDIDATE_UNVERIFIED', reason: 'SIGNATURE_VALID_WITHOUT_CANONICAL_POINTER',
    certificate, certificateSha256: digest(bytes), completeSignedSet: certificate.schemaVersion === 2,
    allClientsSynchronized: false });
  candidates.add(candidate);
  return candidate;
}
function readResponse(bearer, nonce) {
  demand(typeof bearer === 'string' && bearer.length > 0 && bearer.length <= 8192 && !/[\r\n]/.test(bearer), 'PROCESS_BEARER_REQUIRED');
  return new Promise((resolve, reject) => {
    let timer;
    const fail = code => { clearTimeout(timer); reject(Error(code)); };
    const request = https.request({ hostname: 'auroranexus.com.br', port: 443, path: READ_PATH, method: 'GET',
      minVersion: 'TLSv1.2', rejectUnauthorized: true, agent: false,
      headers: { Authorization: 'Bearer ' + bearer, 'X-Aurora-Release-Nonce': nonce, Accept: 'application/json' } }, response => {
      const chunks = []; let size = 0;
      if (response.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(response.headers['content-type'] || '')
        || !/(?:^|,)\s*no-store(?:\s*,|$)/i.test(response.headers['cache-control'] || '')) {
        response.resume(); fail('CANONICAL_RELEASE_READ_REJECTED'); return;
      }
      response.on('data', chunk => { size += chunk.length; if (size > 65536) request.destroy(Error('RELEASE_RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
      response.on('error', () => fail('CANONICAL_RELEASE_READ_FAILED'));
      response.on('end', () => { clearTimeout(timer); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail('INVALID_RELEASE_RESPONSE'); } });
    });
    request.setTimeout(10000, () => request.destroy(Error('CANONICAL_RELEASE_READ_TIMEOUT')));
    timer = setTimeout(() => request.destroy(Error('CANONICAL_RELEASE_READ_TIMEOUT')), 10000);
    request.on('error', () => fail('CANONICAL_RELEASE_READ_FAILED'));
    request.end();
  });
}
function responseShape(response, candidate, nonce, requestedAt, now, expectedOrg) {
  demand(exact(response, ['schemaVersion', 'source', 'canonicalOrigin', 'orgId', 'requestNonce', 'observedAtUtc',
    'certificateSha256', 'envelope', 'runtime', 'componentCoverage', 'nativeMacInstallation', 'deviceInstallationVerified'])
    && response.schemaVersion === 'aurora.active-release-read.v1' && response.source === SOURCE
    && response.canonicalOrigin === ORIGIN && response.orgId === expectedOrg && response.requestNonce === nonce && utc(response.observedAtUtc)
    && response.certificateSha256 === candidate.certificateSha256
    && response.nativeMacInstallation === 'UNVERIFIED' && response.deviceInstallationVerified === false, 'CANONICAL_RESPONSE_BINDING_REJECTED');
  const observed = Date.parse(response.observedAtUtc);
  demand(observed >= requestedAt - 30000 && observed <= now + 30000 && now - observed <= 60000, 'STALE_CANONICAL_RESPONSE');
  demand(exact(response.runtime, ['sourceSha', 'serverManifestSha256', 'webManifestSha256'])
    && response.runtime.sourceSha === candidate.certificate.sourceSha
    && response.runtime.serverManifestSha256 === candidate.certificate.components.server.manifestSha256
    && response.runtime.webManifestSha256 === candidate.certificate.components.web.manifestSha256, 'CANONICAL_RUNTIME_CONFLICT');
  const coverage = response.componentCoverage, covered = COMPONENTS.filter(name => Object.hasOwn(candidate.certificate.components, name));
  demand(exact(coverage, ['status', 'complete', 'requiredComponents', 'coveredComponents', 'missingComponents'])
    && canonical(coverage.requiredComponents) === canonical(COMPONENTS) && canonical(coverage.coveredComponents) === canonical(covered)
    && canonical(coverage.missingComponents) === canonical(COMPONENTS.filter(name => !covered.includes(name)))
    && coverage.complete === (candidate.certificate.schemaVersion === 2)
    && coverage.status === (coverage.complete ? 'COMPLETE_SIGNED_COMPONENT_SET' : 'PARTIAL'), 'CANONICAL_COVERAGE_CONFLICT');
}
async function readActivePin(bearer, trust, expectedSourceSha, expectedOrg) {
  demand(typeof expectedOrg === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(expectedOrg), 'EXPECTED_ORGANIZATION_REQUIRED');
  const nonce = crypto.randomBytes(32).toString('hex'), requestedAt = Date.now();
  const response = await readResponse(bearer, nonce), now = Date.now();
  const candidate = verifyCandidate(response.envelope, trust, expectedSourceSha, now);
  responseShape(response, candidate, nonce, requestedAt, now, expectedOrg);
  const pin = Object.freeze({ status: 'VERIFIED_ACTIVE_PIN', sourceSha: candidate.certificate.sourceSha,
    certificateSha256: candidate.certificateSha256, orgId: expectedOrg, completeSignedSet: candidate.completeSignedSet, allClientsSynchronized: false });
  activePins.set(pin, { candidate, readAt: now, envelope: structuredClone(response.envelope) });
  return pin;
}
function requireActive(pin, now = Date.now()) {
  const current = activePins.get(pin);
  demand(current && current.candidate.certificate.schemaVersion === 2 && now >= current.readAt && now - current.readAt <= 30000,
    'FRESH_CANONICAL_V2_PIN_REQUIRED');
  return current;
}
function safeName(name) {
  return typeof name === 'string' && name.length <= 200 && /^[A-Za-z0-9_./-]+$/.test(name)
    && !name.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function noLinks(target, missing = false) {
  const absolute = path.resolve(target), parsed = path.parse(absolute); let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (missing && !fs.existsSync(cursor)) continue;
    demand(!fs.lstatSync(cursor).isSymbolicLink(), 'RELEASE_PATH_LINK_REJECTED');
  }
  return absolute;
}
function packageFiles(directory) {
  const root = noLinks(directory), files = {}; let total = 0;
  function walk(relative = '') {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      demand(safeName(name) && !entry.isSymbolicLink(), 'RELEASE_FILE_PATH_REJECTED');
      if (entry.isDirectory()) walk(name);
      else {
        demand(entry.isFile() && !Object.keys(files).some(prior => prior.toLowerCase() === name.toLowerCase()), 'RELEASE_FILE_TYPE_REJECTED');
        const bytes = readRegularFile(path.join(root, name), 32 * 1024 * 1024);
        total += bytes.length; demand(total <= 32 * 1024 * 1024 && Object.keys(files).length < 200, 'RELEASE_PACKAGE_LIMIT');
        files[name] = bytes;
      }
    }
  }
  walk(); return files;
}
function inspectPackage(candidate, component, directory, manifestBytes) {
  demand(['iaMaster', 'windowsIntegration'].includes(component), 'LOCAL_COMPONENT_REQUIRED');
  demand(candidates.has(candidate) && candidate.completeSignedSet === true, 'V2_COMPONENT_COVERAGE_REQUIRED');
  const expected = candidate.certificate.components[component];
  demand(Buffer.isBuffer(manifestBytes) && manifestBytes.length <= 65536 && digest(manifestBytes) === expected.manifestSha256, 'SIGNED_MANIFEST_BYTES_CONFLICT');
  let manifest; try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw Error('INVALID_PACKAGE_MANIFEST'); }
  const source = component === 'iaMaster' ? manifest.sourceRevision : manifest.sourceSha;
  demand(manifest.component === (component === 'iaMaster' ? 'AURORA_IA_MASTER' : 'AURORA_WINDOWS_INTEGRATION')
    && source === expected.sourceSha && manifest.version === expected.version && row(manifest.files)
    && (component !== 'iaMaster' || (manifest.dirty === false && manifest.externalAiEnabled === false && manifest.nodeMinimumMajor === 22)),
    'PACKAGE_IDENTITY_CONFLICT');
  const files = packageFiles(directory), names = Object.keys(manifest.files);
  const physicalNames = Object.keys(files).filter(name => name !== 'manifest.json');
  demand(names.length === (component === 'iaMaster' ? 34 : 7)
    && (component !== 'windowsIntegration' || canonical([...names].sort()) === canonical([...WINDOWS_FILES].sort()))
    && names.every(name => safeName(name) && name !== 'manifest.json' && hex(manifest.files[name], 64))
    && canonical([...physicalNames].sort()) === canonical([...names].sort()), 'PACKAGE_CLOSURE_CONFLICT');
  if (Object.hasOwn(files, 'manifest.json')) demand(digest(files['manifest.json']) === expected.manifestSha256, 'PACKAGE_MANIFEST_CONFLICT');
  for (const name of names) demand(digest(files[name]) === manifest.files[name], 'PACKAGE_FILE_BYTES_CONFLICT');
  files['manifest.json'] = manifestBytes;
  return { component, sourceSha: source, version: manifest.version, manifestSha256: expected.manifestSha256,
    files, manifestBytes, treeSha256: digest(canonical(Object.fromEntries(Object.keys(files).sort().map(name => [name, digest(files[name])])))) };
}
function durable(filename, bytes) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
// Staging is preparation, even for a correctly signed envelope. It never replaces
// an installed package or touches identity, a checkpoint, Startup or a process.
function stageCandidate({ candidate, component = 'iaMaster', packageDirectory, manifestBytes, destination }) {
  const checked = inspectPackage(candidate, component, packageDirectory, manifestBytes);
  const target = noLinks(destination, true), input = path.resolve(packageDirectory);
  demand(target !== input && !target.startsWith(input + path.sep) && !input.startsWith(target + path.sep), 'SEPARATE_STAGE_REQUIRED');
  const receiptPath = path.join(target, 'stage-receipt.json'), packagePath = path.join(target, 'package');
  const expected = { schemaVersion: 'aurora.published.stage.v1', status: 'CANDIDATE_STAGED_NOT_CURRENT', component,
    sourceSha: checked.sourceSha, certificateSha256: candidate.certificateSha256, manifestSha256: checked.manifestSha256,
    treeSha256: checked.treeSha256, installed: false, activated: false };
  if (fs.existsSync(target)) {
    const receipt = JSON.parse(readRegularFile(receiptPath, 4096));
    demand(canonical(receipt) === canonical(expected), 'STAGE_IDENTITY_CONFLICT');
    const readback = inspectPackage(candidate, component, packagePath, manifestBytes);
    demand(readback.treeSha256 === checked.treeSha256, 'STAGE_BYTES_CHANGED');
    return expected;
  }
  const temporary = target + '.preparing';
  if (fs.existsSync(temporary)) {
    // A complete fsynced staging attempt can be resumed. Incomplete or changed
    // bytes remain untouched for explicit reconciliation.
    const prior = JSON.parse(readRegularFile(path.join(temporary, 'stage-receipt.json'), 4096));
    demand(canonical(prior) === canonical(expected), 'INTERRUPTED_STAGE_RECONCILIATION_REQUIRED');
    demand(inspectPackage(candidate, component, path.join(temporary, 'package'), manifestBytes).treeSha256 === checked.treeSha256,
      'INTERRUPTED_STAGE_RECONCILIATION_REQUIRED');
    demand(!fs.existsSync(target), 'STAGE_CHANGED'); fs.renameSync(temporary, target); return expected;
  }
  noLinks(path.dirname(target)); fs.mkdirSync(temporary, { mode: 0o700 });
  fs.mkdirSync(path.join(temporary, 'package'), { mode: 0o700 });
  for (const [name, bytes] of Object.entries(checked.files)) {
    const filename = path.join(temporary, 'package', ...name.split('/'));
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 }); durable(filename, bytes);
  }
  durable(path.join(temporary, 'stage-receipt.json'), JSON.stringify(expected) + '\n');
  inspectPackage(candidate, component, path.join(temporary, 'package'), manifestBytes);
  demand(!fs.existsSync(target), 'STAGE_CHANGED'); fs.renameSync(temporary, target);
  return expected;
}
function cleanEnvironment() {
  const result = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[key]) result[key] = process.env[key];
  }
  return result;
}
function nativePowerShell(script, values = {}) {
  try {
    return JSON.parse(childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...cleanEnvironment(), ...values }, windowsHide: true, timeout: 20000, encoding: 'utf8',
        maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch { throw Error('LOCAL_OWNER_OR_PROCESS_PROOF_UNAVAILABLE'); }
}
function ownership(layout) {
  demand(process.platform === 'win32' && Number(process.versions.node.split('.')[0]) >= 22, 'WINDOWS_NODE_22_REQUIRED');
  const observed = nativePowerShell("$ErrorActionPreference='Stop';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$paths=@($env:AURORA_RELEASE_ROOT,$env:AURORA_RELEASE_STATE);$ok=$true;foreach($p in $paths){$acl=Get-Acl -LiteralPath $p;if(-not $acl.AreAccessRulesProtected){$ok=$false};$rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);$own=@($rules|Where-Object {$_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl});if(-not $own.Count){$ok=$false};if(@($rules|Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($sid,'S-1-5-18','S-1-5-32-544')}).Count){$ok=$false}};ConvertTo-Json -InputObject @{currentOwnerAuthorized=$ok}",
    { AURORA_RELEASE_ROOT: layout.runtimeRoot, AURORA_RELEASE_STATE: layout.stateDir });
  demand(observed.currentOwnerAuthorized === true, 'LOCAL_CONTROL_OWNER_REQUIRED');
}
function stageOwnership(directory) {
  const observed = nativePowerShell("$ErrorActionPreference='Stop';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$p=$env:AURORA_RELEASE_STAGE;$items=@(Get-Item -LiteralPath $p)+@(Get-ChildItem -LiteralPath $p -Recurse -Force);$ok=$items.Count -le 250;foreach($item in $items){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){$ok=$false};$acl=Get-Acl -LiteralPath $item.FullName;$rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);if(-not @($rules|Where-Object {$_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl}).Count){$ok=$false};if(@($rules|Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($sid,'S-1-5-18','S-1-5-32-544')}).Count){$ok=$false}};ConvertTo-Json -InputObject @{currentOwnerAuthorized=$ok}",
    { AURORA_RELEASE_STAGE: directory });
  demand(observed.currentOwnerAuthorized === true, 'PRIVATE_STAGE_ACL_REQUIRED');
}
function layoutShape(layout) {
  demand(exact(layout, ['runtimeRoot', 'stateDir', 'helperPath', 'nodeExecutable', 'expectedHelperSha256',
    'expectedNodeSha256', 'expectedInstallationSha256', 'expectedCheckpointSha256']), 'REVIEWED_LAYOUT_REQUIRED');
  for (const key of ['runtimeRoot', 'stateDir', 'helperPath', 'nodeExecutable']) demand(path.isAbsolute(layout[key]), 'ABSOLUTE_LOCAL_PATHS_REQUIRED');
  for (const key of ['expectedHelperSha256', 'expectedNodeSha256', 'expectedInstallationSha256', 'expectedCheckpointSha256']) demand(hex(layout[key], 64), 'REVIEWED_LAYOUT_HASH_REQUIRED');
  const result = { ...layout, runtimeRoot: noLinks(layout.runtimeRoot), stateDir: noLinks(layout.stateDir),
    helperPath: noLinks(layout.helperPath), nodeExecutable: noLinks(layout.nodeExecutable) };
  result.packageDir = path.join(result.runtimeRoot, 'components', 'ia-master', '1.0.1');
  demand(result.helperPath === path.join(result.runtimeRoot, 'server-location-manager.cjs')
    && result.nodeExecutable.toLowerCase() === process.execPath.toLowerCase()
    && result.stateDir !== result.runtimeRoot
    && result.runtimeRoot === REVIEWED_RUNTIME_ROOT
    && result.stateDir === path.join(process.env.LOCALAPPDATA || '', 'AuroraNexus', 'integration', 'state', 'ia-master')
    && result.expectedHelperSha256 === BOOTSTRAP_HELPER
    && !result.stateDir.startsWith(result.runtimeRoot + path.sep) && !result.runtimeRoot.startsWith(result.stateDir + path.sep),
    'PRESERVED_STATE_LAYOUT_REQUIRED');
  result.installation = path.join(result.stateDir, 'installation.json');
  result.checkpoint = path.join(path.dirname(result.stateDir), 'integration-setup.json');
  return result;
}
function hashFile(filename, limit = 32 * 1024 * 1024) { return digest(readRegularFile(filename, limit)); }
function treeDigest(directory) {
  const files = packageFiles(directory);
  return digest(canonical(Object.fromEntries(Object.keys(files).sort().map(name => [name, digest(files[name])]))));
}
function identitySnapshot(layout) {
  return { control: hashFile(path.join(layout.stateDir, 'control.key'), 4096),
    organization: hashFile(path.join(layout.stateDir, 'organization.txt'), 256),
    checkpoint: hashFile(layout.checkpoint, 65536) };
}
function unchangedIdentity(layout, snapshot) {
  demand(canonical(identitySnapshot(layout)) === canonical(snapshot), 'PRESERVED_IDENTITY_OR_CHECKPOINT_CHANGED');
}
function helperAndNode(layout) {
  demand(hashFile(layout.helperPath, 65536) === layout.expectedHelperSha256
    && hashFile(layout.nodeExecutable, 128 * 1024 * 1024) === layout.expectedNodeSha256, 'TRUSTED_MANAGER_CHANGED');
}
function initialBaseline(layout, expectedOrg) {
  const bytes = readRegularFile(path.join(layout.packageDir, 'manifest.json'), 65536);
  demand(digest(bytes) === BOOTSTRAP_MANIFEST, 'REVIEWED_BOOTSTRAP_BASELINE_REQUIRED');
  const manifest = JSON.parse(bytes.toString('utf8')), files = packageFiles(layout.packageDir);
  demand(manifest.sourceRevision === BOOTSTRAP_SOURCE && manifest.version === '1.1.0'
    && manifest.component === 'AURORA_IA_MASTER' && manifest.dirty === false && manifest.externalAiEnabled === false
    && Object.keys(manifest.files || {}).length === 26 && Object.keys(files).length === 27, 'INSTALLED_BASELINE_IDENTITY_CONFLICT');
  for (const [name, expected] of Object.entries(manifest.files)) demand(safeName(name) && hex(expected, 64)
    && files[name] && digest(files[name]) === expected, 'INSTALLED_BASELINE_BYTES_CONFLICT');
  const metadataBytes = readRegularFile(layout.installation, 65536), metadata = JSON.parse(metadataBytes.toString('utf8'));
  demand(digest(metadataBytes) === layout.expectedInstallationSha256 && metadata.version === '1.1.0'
    && metadata.sourceRevision === BOOTSTRAP_SOURCE && metadata.organization === expectedOrg
    && metadata.binding === '127.0.0.1' && metadata.externalAiEnabled === false && metadata.existingClientPreserved === true,
    'INSTALLED_METADATA_CONFLICT');
  const identity = identitySnapshot(layout);
  demand(identity.checkpoint === layout.expectedCheckpointSha256
    && readRegularFile(path.join(layout.stateDir, 'organization.txt'), 256).toString('utf8').trim() === expectedOrg, 'INSTALLED_ORGANIZATION_CONFLICT');
  return { treeSha256: treeDigest(layout.packageDir), metadataSha256: digest(metadataBytes), metadataBytes, identity };
}
function runManager(layout, operation) {
  helperAndNode(layout);
  try { childProcess.execFileSync(layout.nodeExecutable, [layout.helperPath, operation], {
    env: cleanEnvironment(), windowsHide: true, timeout: 30000, maxBuffer: 32768, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw Error('OWNED_MANAGER_OPERATION_FAILED'); }
}
function listeners(layout) {
  const result = nativePowerShell("$ErrorActionPreference='Stop';$rows=@();foreach($port in @(38765,11435)){foreach($conn in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$conn.OwningProcess);$rows+=@{port=$port;address=$conn.LocalAddress;pid=$conn.OwningProcess;exe=$p.ExecutablePath;command=$p.CommandLine}}};ConvertTo-Json -InputObject @{listeners=$rows}");
  demand(Array.isArray(result.listeners), 'LISTENER_PROOF_INVALID');
  const escaped = value => value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
  const node = escaped(layout.nodeExecutable), script = escaped(path.join(layout.packageDir, 'server.cjs'));
  const pattern = new RegExp('^\\s*(?:"' + node + '"|' + node + ')\\s+(?:"' + script + '"|' + script + ')\\s*$', 'i');
  for (const listener of result.listeners) demand(listener.address === '127.0.0.1'
    && (listener.port === 11435 ? String(listener.exe).toLowerCase() === path.join(layout.runtimeRoot, 'components', 'ollama', '0.35.1', 'ollama.exe').toLowerCase()
      : String(listener.exe).toLowerCase() === layout.nodeExecutable.toLowerCase() && pattern.test(listener.command)),
    'PORT_OWNED_BY_OTHER_COMPONENT');
  return result.listeners;
}
function localJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: pathname, agent: false }, response => {
      const chunks = []; let count = 0;
      if (response.statusCode !== 200) { response.resume(); reject(Error('LOCAL_RUNTIME_UNAVAILABLE')); return; }
      response.on('data', bytes => { count += bytes.length; if (count > 65536) request.destroy(); else chunks.push(bytes); });
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { reject(Error('LOCAL_RUNTIME_INVALID')); } });
      response.on('error', () => reject(Error('LOCAL_RUNTIME_UNAVAILABLE')));
    });
    request.setTimeout(3000, () => request.destroy()); request.on('error', () => reject(Error('LOCAL_RUNTIME_UNAVAILABLE')));
  });
}
async function runtimeProof(layout, sourceSha, manifestSha256) {
  const deadline = Date.now() + 20000;
  do {
    try {
      const health = await localJson(38765, '/health');
      demand(health.service === 'AURORA_IA_MASTER' && health.version === '1.1.0'
        && health.processManifest?.status === 'PROCESS_MANIFEST_OBSERVED' && health.processManifest.dirty === false
        && health.processManifest.sourceRevision === sourceSha && health.processManifest.manifestSha256 === manifestSha256, 'RUNTIME_RELEASE_CONFLICT');
      const processes = listeners(layout); demand(processes.length === 2, 'RUNTIME_LISTENERS_INCOMPLETE');
      const models = await localJson(11435, '/api/tags');
      demand(Array.isArray(models.models) && models.models.some(model => model.name === 'qwen3:8b'), 'PRESERVED_MODEL_UNAVAILABLE');
      return { version: '1.1.0', sourceSha, manifestSha256, localProcessesVerified: true, modelAvailable: true,
        installedFromSignedComponent: sourceSha !== BOOTSTRAP_SOURCE, cloudReceiptVerified: false, allClientsSynchronized: false };
    } catch (error) {
      if (error.message === 'RUNTIME_RELEASE_CONFLICT' || error.message === 'PORT_OWNED_BY_OTHER_COMPONENT' || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } while (true);
}
function saveJournal(filename, journal) {
  const temporary = filename + '.' + crypto.randomUUID() + '.writing';
  durable(temporary, JSON.stringify(journal) + '\n'); fs.renameSync(temporary, filename);
}
function compareMetadata(layout, oldHash, nextBytes, id) {
  const displaced = layout.installation + '.displaced-' + id, prepared = layout.installation + '.prepared-' + id;
  demand(hashFile(layout.installation, 65536) === oldHash && !fs.existsSync(displaced) && !fs.existsSync(prepared), 'METADATA_CAS_CONFLICT');
  durable(prepared, nextBytes); demand(hashFile(layout.installation, 65536) === oldHash, 'METADATA_CAS_CONFLICT');
  fs.renameSync(layout.installation, displaced); fs.renameSync(prepared, layout.installation);
}
function restoreMetadata(layout, journal, previousBytes) {
  demand(digest(previousBytes) === journal.previousMetadataSha256, 'ROLLBACK_METADATA_INTEGRITY_FAILED');
  const current = fs.existsSync(layout.installation) ? hashFile(layout.installation, 65536) : null;
  demand(current === journal.previousMetadataSha256 || current === journal.nextMetadataSha256 || current === null, 'ROLLBACK_METADATA_CHANGED');
  if (current === journal.previousMetadataSha256) return;
  const recovery = layout.installation + '.recovery-' + journal.id;
  if (fs.existsSync(recovery)) demand(hashFile(recovery, 65536) === journal.previousMetadataSha256, 'ROLLBACK_RECOVERY_MARKER_CHANGED');
  else durable(recovery, previousBytes);
  if (current !== null) {
    demand(hashFile(layout.installation, 65536) === journal.nextMetadataSha256, 'ROLLBACK_METADATA_CHANGED');
    fs.renameSync(layout.installation, layout.installation + '.candidate-' + journal.id);
  }
  fs.renameSync(recovery, layout.installation);
}
async function rollbackOwned(layout, attempt, journal) {
  helperAndNode(layout); ownership(layout); unchangedIdentity(layout, journal.identity);
  const backup = path.join(attempt, 'component.previous'), metadata = readRegularFile(path.join(attempt, 'metadata.previous'), 65536);
  const current = fs.existsSync(layout.packageDir) ? treeDigest(layout.packageDir) : null;
  demand(current === journal.previousTreeSha256 || current === journal.nextTreeSha256 || current === null, 'ROLLBACK_COMPONENT_CHANGED');
  const restored = current === journal.previousTreeSha256 && !fs.existsSync(backup);
  const previous = restored ? layout.packageDir : backup;
  demand(treeDigest(previous) === journal.previousTreeSha256
    && hashFile(path.join(previous, 'manifest.json'), 65536) === BOOTSTRAP_MANIFEST, 'ROLLBACK_PACKAGE_INTEGRITY_FAILED');
  if (listeners(layout).length) runManager(layout, 'stop');
  demand(listeners(layout).length === 0, 'ROLLBACK_LISTENERS_NOT_STOPPED');
  if (current !== journal.previousTreeSha256) {
    if (current !== null) fs.renameSync(layout.packageDir, path.join(attempt, 'component.candidate'));
    fs.renameSync(backup, layout.packageDir);
  }
  let metadataRestored = false;
  try { restoreMetadata(layout, journal, metadata); metadataRestored = true; } catch { /* Runtime recovery remains independent. */ }
  runManager(layout, 'start');
  const proof = await runtimeProof(layout, BOOTSTRAP_SOURCE, BOOTSTRAP_MANIFEST);
  unchangedIdentity(layout, journal.identity);
  demand(metadataRestored, 'ROLLBACK_METADATA_INCOMPLETE');
  return proof;
}
async function activateCore({ mode, pin, bearer, trust, expectedSourceSha, expectedOrg, layout: rawLayout,
  packageDirectory, manifestBytes, stageDirectory }, operation) {
  demand(mode === 'activate', 'EXPLICIT_ACTIVATION_REQUIRED');
  const current = requireActive(pin), layout = layoutShape(rawLayout);
  demand(pin.orgId === expectedOrg && current.candidate.certificate.sourceSha === expectedSourceSha, 'ACTIVE_PIN_IDENTITY_CONFLICT');
  ownership(layout); helperAndNode(layout);
  const checked = inspectPackage(current.candidate, 'iaMaster', packageDirectory, manifestBytes);
  if (hashFile(path.join(layout.packageDir, 'manifest.json'), 65536) === checked.manifestSha256) {
    const metadataBytes = readRegularFile(layout.installation, 65536), metadata = JSON.parse(metadataBytes);
    const attempt = noLinks(metadata.rollbackPath);
    demand(path.dirname(attempt) === path.join(layout.runtimeRoot, 'installation-rollbacks')
      && /^published-[a-f0-9-]{36}$/.test(path.basename(attempt)), 'PRIOR_SIGNED_APPLICATION_REQUIRED');
    const journal = JSON.parse(readRegularFile(path.join(attempt, 'journal.json'), 32768));
    demand(journal.schemaVersion === 'aurora.published.activation.v1' && journal.phase === 'COMPLETED'
      && path.basename(attempt) === 'published-' + journal.id && journal.packageDir === layout.packageDir
      && journal.stateDir === layout.stateDir && journal.helperPath === layout.helperPath && journal.sourceSha === expectedSourceSha
      && journal.certificateSha256 === current.candidate.certificateSha256 && journal.manifestSha256 === checked.manifestSha256
      && journal.previousMetadataSha256 === layout.expectedInstallationSha256 && journal.nextMetadataSha256 === digest(metadataBytes)
      && journal.nextTreeSha256 === treeDigest(layout.packageDir) && journal.nextTreeSha256 === checked.treeSha256
      && journal.identity?.checkpoint === layout.expectedCheckpointSha256 && metadata.organization === expectedOrg
      && metadata.sourceRevision === expectedSourceSha && metadata.signedComponentManifestSha256 === checked.manifestSha256,
      'PRIOR_SIGNED_APPLICATION_CONFLICT');
    unchangedIdentity(layout, journal.identity);
    const proof = await runtimeProof(layout, expectedSourceSha, checked.manifestSha256);
    const fresh = await readActivePin(bearer, trust, expectedSourceSha, expectedOrg);
    demand(requireActive(fresh).candidate.certificateSha256 === journal.certificateSha256
      && treeDigest(layout.packageDir) === journal.nextTreeSha256 && hashFile(layout.installation, 65536) === journal.nextMetadataSha256,
      'PRIOR_SIGNED_APPLICATION_CHANGED');
    ownership(layout); helperAndNode(layout); unchangedIdentity(layout, journal.identity); requireActive(fresh);
    operation.finished = true;
    return { status: 'SIGNED_LOCAL_COMPONENT_ALREADY_APPLIED', sourceSha: expectedSourceSha,
      manifestSha256: checked.manifestSha256, localProcessesVerified: proof.localProcessesVerified,
      identityAndCheckpointPreserved: true, allClientsSynchronized: false, cloudReceiptVerified: false };
  }
  const baseline = initialBaseline(layout, expectedOrg);
  demand(checked.version === '1.1.0'
    && digest(checked.files['manage.cjs']) === hashFile(path.join(layout.packageDir, 'manage.cjs'), 65536)
    && digest(checked.files['knowledge-registry.cjs']) === hashFile(path.join(layout.packageDir, 'knowledge-registry.cjs'), 65536),
    'LOCAL_MANAGER_OR_KNOWLEDGE_COMPATIBILITY_REQUIRED');
  const reviewedStage = path.resolve(stageDirectory);
  demand(reviewedStage.startsWith(layout.runtimeRoot + path.sep)
    && reviewedStage !== layout.packageDir && reviewedStage !== layout.stateDir
    && !reviewedStage.startsWith(layout.packageDir + path.sep) && !layout.packageDir.startsWith(reviewedStage + path.sep)
    && !reviewedStage.startsWith(layout.stateDir + path.sep) && !layout.stateDir.startsWith(reviewedStage + path.sep)
    && !reviewedStage.startsWith(path.join(layout.runtimeRoot, 'installation-rollbacks') + path.sep), 'SEPARATE_PRIVATE_STAGE_REQUIRED');
  stageCandidate({ candidate: current.candidate, packageDirectory, manifestBytes, destination: stageDirectory });
  stageOwnership(reviewedStage);
  const stagePackage = path.join(path.resolve(stageDirectory), 'package');
  demand(path.parse(stagePackage).root.toLowerCase() === path.parse(layout.packageDir).root.toLowerCase()
    && !path.resolve(stageDirectory).startsWith(layout.stateDir + path.sep)
    && !layout.stateDir.startsWith(path.resolve(stageDirectory) + path.sep), 'PRIVATE_SAME_VOLUME_STAGE_REQUIRED');
  const fresh = await readActivePin(bearer, trust, expectedSourceSha, expectedOrg);
  demand(requireActive(fresh).candidate.certificateSha256 === current.candidate.certificateSha256, 'CANONICAL_POINTER_CHANGED');
  ownership(layout); helperAndNode(layout); initialBaseline(layout, expectedOrg);
  const id = operation.id, attempts = path.join(layout.runtimeRoot, 'installation-rollbacks');
  noLinks(attempts, true); fs.mkdirSync(attempts, { recursive: true, mode: 0o700 });
  const attempt = path.join(attempts, 'published-' + id); fs.mkdirSync(attempt, { mode: 0o700 });
  const journalPath = path.join(attempt, 'journal.json');
  const previousMetadata = JSON.parse(baseline.metadataBytes.toString('utf8'));
  const nextMetadata = Buffer.from(JSON.stringify({ ...previousMetadata, sourceRevision: expectedSourceSha,
    version: checked.version, previousSourceRevision: BOOTSTRAP_SOURCE, rollbackPath: attempt,
    publishedCertificateSha256: fresh.certificateSha256, signedComponentManifestSha256: checked.manifestSha256,
    runtimeAcceptance: 'NOT_VERIFIED' }, null, 2) + '\n');
  const journal = { schemaVersion: 'aurora.published.activation.v1', id, phase: 'PREPARED', packageDir: layout.packageDir,
    stateDir: layout.stateDir, helperPath: layout.helperPath, previousTreeSha256: baseline.treeSha256,
    nextTreeSha256: checked.treeSha256, previousMetadataSha256: baseline.metadataSha256,
    nextMetadataSha256: digest(nextMetadata), identity: baseline.identity, sourceSha: expectedSourceSha,
    certificateSha256: fresh.certificateSha256, manifestSha256: checked.manifestSha256, allClientsSynchronized: false };
  durable(path.join(attempt, 'metadata.previous'), baseline.metadataBytes);
  saveJournal(journalPath, journal);
  let stopAttempted = false, packageMoved = false;
  try {
    await runtimeProof(layout, BOOTSTRAP_SOURCE, BOOTSTRAP_MANIFEST);
    requireActive(fresh); helperAndNode(layout); unchangedIdentity(layout, baseline.identity); ownership(layout); stageOwnership(reviewedStage);
    demand(treeDigest(layout.packageDir) === baseline.treeSha256
      && hashFile(layout.installation, 65536) === baseline.metadataSha256, 'INSTALLED_BASELINE_CHANGED');
    stopAttempted = true; operation.started = true; runManager(layout, 'stop');
    demand(listeners(layout).length === 0, 'OWNED_RUNTIME_NOT_STOPPED');
    demand(treeDigest(layout.packageDir) === baseline.treeSha256 && treeDigest(stagePackage) === checked.treeSha256, 'PACKAGE_CAS_CONFLICT');
    requireActive(fresh);
    packageMoved = true; fs.renameSync(layout.packageDir, path.join(attempt, 'component.previous'));
    journal.phase = 'BASELINE_MOVED'; saveJournal(journalPath, journal);
    fs.renameSync(stagePackage, layout.packageDir);
    journal.phase = 'CANDIDATE_INSTALLED'; saveJournal(journalPath, journal);
    requireActive(fresh);
    compareMetadata(layout, baseline.metadataSha256, nextMetadata, id);
    journal.phase = 'METADATA_COMMITTED'; saveJournal(journalPath, journal);
    runManager(layout, 'start');
    const proof = await runtimeProof(layout, expectedSourceSha, checked.manifestSha256);
    demand(treeDigest(layout.packageDir) === checked.treeSha256
      && hashFile(layout.installation, 65536) === journal.nextMetadataSha256, 'APPLICATION_READBACK_FAILED');
    unchangedIdentity(layout, baseline.identity); helperAndNode(layout);
    const finalPin = await readActivePin(bearer, trust, expectedSourceSha, expectedOrg);
    demand(requireActive(finalPin).candidate.certificateSha256 === fresh.certificateSha256, 'CANONICAL_POINTER_CHANGED');
    demand(treeDigest(layout.packageDir) === checked.treeSha256 && hashFile(layout.installation, 65536) === journal.nextMetadataSha256,
      'APPLICATION_READBACK_FAILED');
    unchangedIdentity(layout, baseline.identity); ownership(layout); helperAndNode(layout); requireActive(finalPin);
    journal.phase = 'COMPLETED'; journal.runtimeProof = proof; saveJournal(journalPath, journal); operation.finished = true;
    return { status: 'SIGNED_LOCAL_COMPONENT_APPLIED', sourceSha: expectedSourceSha, manifestSha256: checked.manifestSha256,
      attempt, localProcessesVerified: true, identityAndCheckpointPreserved: true, allClientsSynchronized: false, cloudReceiptVerified: false };
  } catch (error) {
    journal.phase = 'FAILED_ROLLBACK_UNVERIFIED';
    journal.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_APPLICATION_FAILED';
    try {
      if (packageMoved) journal.rollbackProof = await rollbackOwned(layout, attempt, journal);
      else if (stopAttempted) { runManager(layout, 'start'); journal.rollbackProof = await runtimeProof(layout, BOOTSTRAP_SOURCE, BOOTSTRAP_MANIFEST); }
      journal.phase = stopAttempted ? 'ROLLED_BACK_LOCAL_PREVIOUS' : 'PREPARED_NOT_APPLIED';
      operation.finished = true;
    } catch { journal.rollbackIncomplete = true; }
    try { saveJournal(journalPath, journal); } catch {}
    throw Error(journal.rollbackIncomplete ? 'LOCAL_APPLICATION_ROLLBACK_INCOMPLETE' : journal.failureCode);
  }
}
async function activatePublished(options) {
  demand(options?.mode === 'activate', 'EXPLICIT_ACTIVATION_REQUIRED');
  requireActive(options.pin);
  const layout = layoutShape(options.layout); ownership(layout); helperAndNode(layout);
  const lock = path.join(layout.runtimeRoot, 'published-update.lock');
  noLinks(lock, true);
  const operation = { id: crypto.randomUUID(), started: false, finished: false };
  const lockBytes = Buffer.from(JSON.stringify({ schemaVersion: 'aurora.published.lock.v1', id: operation.id, pid: process.pid }) + '\n');
  try { durable(lock, lockBytes); } catch { throw Error('LOCAL_UPDATE_BUSY_OR_INTERRUPTED'); }
  try { return await activateCore(options, operation); }
  finally {
    if ((!operation.started || operation.finished) && fs.existsSync(lock) && hashFile(lock, 4096) === digest(lockBytes)) fs.unlinkSync(lock);
  }
}
async function recoverPublished({ mode, layout: rawLayout, attemptDirectory }) {
  demand(mode === 'recover', 'EXPLICIT_RECOVERY_REQUIRED');
  const layout = layoutShape(rawLayout), attempt = noLinks(attemptDirectory);
  demand(path.dirname(attempt) === path.join(layout.runtimeRoot, 'installation-rollbacks')
    && /^published-[a-f0-9-]{36}$/.test(path.basename(attempt)), 'OWNED_RECOVERY_PATH_REQUIRED');
  const journal = JSON.parse(readRegularFile(path.join(attempt, 'journal.json'), 32768));
  const lock = path.join(layout.runtimeRoot, 'published-update.lock');
  if (!fs.existsSync(lock)) {
    demand(journal.schemaVersion === 'aurora.published.activation.v1' && path.basename(attempt) === 'published-' + journal.id
      && journal.phase === 'ROLLED_BACK_LOCAL_PREVIOUS' && journal.packageDir === layout.packageDir
      && journal.stateDir === layout.stateDir && journal.helperPath === layout.helperPath, 'RECOVERY_LOCK_REQUIRED');
    ownership(layout); helperAndNode(layout); unchangedIdentity(layout, journal.identity);
    demand(treeDigest(layout.packageDir) === journal.previousTreeSha256
      && hashFile(path.join(layout.packageDir, 'manifest.json'), 65536) === BOOTSTRAP_MANIFEST
      && hashFile(layout.installation, 65536) === journal.previousMetadataSha256, 'RECOVERED_BYTES_CHANGED');
    await runtimeProof(layout, BOOTSTRAP_SOURCE, BOOTSTRAP_MANIFEST);
    return { status: 'ROLLED_BACK_LOCAL_PREVIOUS', alreadyRecovered: true, allClientsSynchronized: false, cloudReceiptVerified: false };
  }
  const lockBytes = readRegularFile(lock, 4096);
  const lockValue = JSON.parse(lockBytes);
  demand(exact(lockValue, ['schemaVersion', 'id', 'pid']) && lockValue.schemaVersion === 'aurora.published.lock.v1'
    && lockValue.id === journal.id && Number.isSafeInteger(lockValue.pid) && lockValue.pid > 0, 'RECOVERY_LOCK_CONFLICT');
  let live = true;
  try { process.kill(lockValue.pid, 0); } catch (error) { live = error.code !== 'ESRCH'; }
  demand(!live, 'RECOVERY_OWNER_PROCESS_STILL_RUNNING');
  demand(journal.schemaVersion === 'aurora.published.activation.v1' && path.basename(attempt) === 'published-' + journal.id
    && journal.packageDir === layout.packageDir && journal.stateDir === layout.stateDir && journal.helperPath === layout.helperPath
    && ['PREPARED', 'BASELINE_MOVED', 'CANDIDATE_INSTALLED', 'METADATA_COMMITTED', 'COMPLETED', 'FAILED_ROLLBACK_UNVERIFIED', 'ROLLED_BACK_LOCAL_PREVIOUS'].includes(journal.phase)
    && [journal.previousTreeSha256, journal.nextTreeSha256, journal.previousMetadataSha256, journal.nextMetadataSha256].every(value => hex(value, 64)), 'RECOVERY_JOURNAL_CONFLICT');
  const proof = await rollbackOwned(layout, attempt, journal);
  journal.phase = 'ROLLED_BACK_LOCAL_PREVIOUS'; journal.rollbackProof = proof;
  saveJournal(path.join(attempt, 'journal.json'), journal);
  demand(hashFile(lock, 4096) === digest(lockBytes), 'RECOVERY_LOCK_CHANGED'); fs.unlinkSync(lock);
  return { status: journal.phase, allClientsSynchronized: false, cloudReceiptVerified: false };
}
async function runCli(argv = [], environment = process.env) {
  const [operation = '--plan', filename] = argv;
  demand(['--plan', '--read-active', '--stage', '--activate', '--recover'].includes(operation) && argv.length <= 2, 'EXPLICIT_PUBLISHED_OPERATION_REQUIRED');
  if (operation === '--plan') return { status: 'READ_ONLY_PLAN', canonicalReadPath: READ_PATH,
    requiresAuthenticatedCanonicalV2Pin: true, installed: false, activated: false, allClientsSynchronized: false };
  demand(typeof filename === 'string' && path.isAbsolute(filename), 'PUBLIC_REVIEWED_OPTIONS_REQUIRED');
  const options = JSON.parse(readRegularFile(noLinks(filename), 65536));
  const common = ['trust', 'expectedSourceSha', 'expectedOrg'];
  const packageKeys = ['packageDirectory', 'manifestPath', 'stageDirectory'];
  const keys = operation === '--recover' ? ['layout', 'attemptDirectory']
    : [...common, ...(operation === '--read-active' ? [] : packageKeys), ...(operation === '--activate' ? ['layout'] : [])];
  demand(exact(options, keys), 'PUBLIC_REVIEWED_OPTIONS_REQUIRED');
  if (operation === '--recover') return recoverPublished({ mode: 'recover', ...options });
  if (operation === '--stage') {
    // Staging requires an authenticated current pointer too in the CLI. The
    // lower-level signed-envelope API remains explicitly candidate-only.
    demand(environment.AURORA_INTEGRATION_TOKEN, 'PROCESS_BEARER_REQUIRED');
  }
  const bearer = environment.AURORA_INTEGRATION_TOKEN;
  const pin = await readActivePin(bearer, options.trust, options.expectedSourceSha, options.expectedOrg);
  if (!pin.completeSignedSet) return { status: 'PENDING_V2_COMPONENT_COVERAGE', activated: false, allClientsSynchronized: false };
  if (operation === '--read-active') return pin;
  demand(path.isAbsolute(options.manifestPath), 'ABSOLUTE_MANIFEST_REQUIRED');
  const manifestBytes = readRegularFile(noLinks(options.manifestPath), 65536);
  if (operation === '--stage') {
    const result = stageCandidate({ candidate: requireActive(pin).candidate, packageDirectory: options.packageDirectory,
      manifestBytes, destination: options.stageDirectory });
    return result;
  }
  return activatePublished({ mode: 'activate', pin, bearer, ...options, manifestBytes });
}
module.exports = { ORIGIN, READ_PATH, SOURCE, COMPONENTS, verifyCandidate, readActivePin, requireActive,
  inspectPackage, stageCandidate, activatePublished, recoverPublished, signingBytes, canonical, digest, noLinks, runCli };
if (require.main === module) {
  runCli(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ status: 'PENDING_PUBLISHED_RELEASE', code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PUBLIC_RELEASE_OPERATION_FAILED', activated: false }));
    process.exitCode = 2;
  });
}
