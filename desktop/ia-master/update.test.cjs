'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { preflight, update, rollback, BASELINE, REGISTRY_SHA } = require('./update.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const candidateRevision = '1234567890abcdef1234567890abcdef12345678';
const stopped = { observeStopped() {} };
const registry = fs.readFileSync(path.join(__dirname, 'knowledge-registry.cjs'));
assert.equal(hash(registry), REGISTRY_SHA, 'The compatibility fixture must retain the exact installed registry implementation.');
const server = "const { loadRegistry, selectKnowledge } = require('./knowledge-registry.cjs');\nfunction receipt(stateDir, registryPath) { const registry = loadRegistry(registryPath); selectKnowledge(registry, 'synthetic'); path.join(stateDir, 'knowledge', 'knowledge_registry.v1.json'); return {corpusVersion:null,corpusHash:null,recordIds:[],rejectedCount:0,completeHistoricalAbsorption:false}; }\n";
function write(filename, bytes) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes); }
function pack(directory, version, revision, alterations = {}) {
  const files = { 'server.cjs': server, 'manage.cjs': '// verified synthetic lifecycle\n',
    'kernel/auroraMasterEngine.js': '// synthetic kernel\n', 'knowledge-registry.cjs': registry,
    'app.js': '// synthetic client\n', 'modus-operandi.md': 'Synthetic method; no client data.\n',
    ...(version === '1.1.0' ? { 'studio.cjs': '// synthetic Studio\n' } : {}), ...alterations };
  const manifest = { component: 'AURORA_IA_MASTER', version, sourceRevision: revision, dirty: false,
    nodeMinimumMajor: 22, externalAiEnabled: false, files: {} };
  for (const [name, bytes] of Object.entries(files)) { if (bytes !== null) { write(path.join(directory, ...name.split('/')), bytes); manifest.files[name] = hash(bytes); } }
  write(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return hash(fs.readFileSync(path.join(directory, 'manifest.json')));
}
function fixture(t, changes = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-master-update-'));
  t.after(() => { const actual = path.resolve(temporaryRoot); assert.ok(actual.startsWith(path.resolve(os.tmpdir()) + path.sep + 'aurora-master-update-')); fs.rmSync(actual, { recursive: true, force: true }); });
  const root = path.join(temporaryRoot, 'AuroraNexus'), target = path.join(root, 'components', 'ia-master', '1.0.1'), candidate = path.join(temporaryRoot, 'candidate');
  const state = path.join(root, 'integration', 'state', 'ia-master'), startup = path.join(temporaryRoot, 'appdata', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AURORA IA Master.cmd');
  const options = { root, candidate, startup, sourceRevision: candidateRevision,
    baselineManifestSha256: pack(target, '1.0.1', BASELINE), manifestSha256: pack(candidate, '1.1.0', candidateRevision, changes) };
  const installation = { version: '1.0.1', sourceRevision: BASELINE, organization: 'synthetic-org', installedAtUtc: '2026-01-01T00:00:00.000Z',
    binding: '127.0.0.1', externalAiEnabled: false, existingClientPreserved: true, corpusLoadedRecords: 20, cloudSyncVerified: false };
  write(path.join(state, 'installation.json'), JSON.stringify(installation, null, 2) + '\n');
  write(path.join(state, 'organization.txt'), 'synthetic-org');
  const sentinels = ['integration/state/ia-master/control.key', 'integration/state/ia-master/studio-configuration.json',
    'integration/state/ia-master/knowledge/knowledge_registry.v1.json', 'components/ollama-models/example-model', 'client/example-client'];
  for (const name of sentinels) write(path.join(root, ...name.split('/')), 'private synthetic sentinel: ' + name);
  for (const [name, mode] of [['IA Master - Iniciar.cmd', 'start'], ['IA Master - Acesso local.cmd', 'pair']]) write(path.join(root, name), '@echo off\r\n"' + process.execPath + '" "' + path.join(target, 'manage.cjs') + '" ' + mode + '\r\n');
  const beforeInstallation = fs.readFileSync(path.join(state, 'installation.json'));
  const sentinelHashes = sentinels.map(name => [name, hash(fs.readFileSync(path.join(root, ...name.split('/'))))]);
  function preserved() {
    for (const [name, digest] of sentinelHashes) assert.equal(hash(fs.readFileSync(path.join(root, ...name.split('/')))), digest);
    assert.equal(fs.existsSync(startup), false, 'A disabled startup entry stays disabled.');
    assert.equal(fs.existsSync(path.join(root, 'IA Master - Conectar portal.cmd')), false);
  }
  return { options, root, target, candidate, state, startup, beforeInstallation, preserved };
}
function repinCandidate(value) {
  const filename = path.join(value.candidate, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(filename));
  for (const name of Object.keys(manifest.files)) manifest.files[name] = hash(fs.readFileSync(path.join(value.candidate, ...name.split('/'))));
  fs.writeFileSync(filename, JSON.stringify(manifest, null, 2) + '\n'); value.options.manifestSha256 = hash(fs.readFileSync(filename));
}
test('preflight verifies exact clean artifacts and performs no installation or process operation', t => {
  const value = fixture(t), result = preflight(value.options);
  assert.equal(result.status, 'PACKAGE_AND_BASELINE_VERIFIED_NO_UPDATE'); assert.equal(result.processStopVerified, false);
  assert.equal(result.runtimeCompatibilityVerified, false); assert.equal(result.target, value.target);
  assert.equal(fs.existsSync(path.join(value.root, 'installation-rollbacks')), false);
  assert.deepEqual(fs.readFileSync(path.join(value.state, 'installation.json')), value.beforeInstallation); value.preserved();
});
test('Studio-only candidate cannot replace the prior knowledge capability', t => {
  const value = fixture(t, { 'knowledge-registry.cjs': null });
  assert.throws(() => preflight(value.options), /KNOWLEDGE_CAPABILITY_COMPATIBILITY_REQUIRED/);
  const second = fixture(t, { 'server.cjs': '// Studio server without knowledge receipts\n' });
  assert.throws(() => preflight(second.options), /KNOWLEDGE_CAPABILITY_COMPATIBILITY_REQUIRED/);
});
test('candidate cannot silently drop another old component file', t => {
  const value = fixture(t, { 'app.js': null });
  assert.throws(() => preflight(value.options), /PREVIOUS_COMPONENT_FILE_MISSING/);
});
test('dirty, altered, unpinned and unlisted packages are refused', t => {
  const dirty = fixture(t), filename = path.join(dirty.candidate, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(filename));
  manifest.dirty = true; fs.writeFileSync(filename, JSON.stringify(manifest)); dirty.options.manifestSha256 = hash(fs.readFileSync(filename));
  assert.throws(() => preflight(dirty.options), /REVIEWED_RELEASE_REQUIRED/);
  const altered = fixture(t); fs.appendFileSync(path.join(altered.candidate, 'studio.cjs'), 'tampered');
  assert.throws(() => preflight(altered.options), /RELEASE_INTEGRITY_FAILED/);
  const unpinned = fixture(t); unpinned.options.manifestSha256 = 'f'.repeat(64);
  assert.throws(() => preflight(unpinned.options), /REVIEWED_RELEASE_REQUIRED/);
  const unlisted = fixture(t); write(path.join(unlisted.candidate, 'unlisted.cjs'), 'unlisted');
  assert.throws(() => preflight(unlisted.options), /UNDECLARED_RELEASE_FILE/);
});
test('manifest traversal, wrong baseline and a changed shortcut are refused', t => {
  const traversal = fixture(t), filename = path.join(traversal.candidate, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(filename));
  delete manifest.files['studio.cjs']; manifest.files['../escape.cjs'] = '0'.repeat(64); fs.writeFileSync(filename, JSON.stringify(manifest)); traversal.options.manifestSha256 = hash(fs.readFileSync(filename));
  assert.throws(() => preflight(traversal.options), /RELEASE_INTEGRITY_FAILED/);
  const baseline = fixture(t); const baselineFile = path.join(baseline.target, 'manifest.json'), prior = JSON.parse(fs.readFileSync(baselineFile));
  prior.sourceRevision = candidateRevision; fs.writeFileSync(baselineFile, JSON.stringify(prior)); baseline.options.baselineManifestSha256 = hash(fs.readFileSync(baselineFile));
  assert.throws(() => preflight(baseline.options), /REVIEWED_RELEASE_REQUIRED/);
  const shortcut = fixture(t); fs.appendFileSync(path.join(shortcut.root, 'IA Master - Iniciar.cmd'), 'changed');
  assert.throws(() => preflight(shortcut.options), /EXISTING_SHORTCUT_REQUIRES_REVIEW/);
});
test('running Master is refused before a backup or file swap and is never stopped', t => {
  const value = fixture(t); let observations = 0;
  assert.throws(() => update(value.options, { observeStopped() { observations++; throw Error('STOPPED_MASTER_REQUIRED'); } }), /STOPPED_MASTER_REQUIRED/);
  assert.equal(observations, 1); assert.equal(fs.existsSync(path.join(value.root, 'installation-rollbacks')), false);
  assert.equal(fs.existsSync(path.join(value.state, 'update.lock')), false); value.preserved();
});
test('existing update lock is not stolen or removed', t => {
  const value = fixture(t); write(path.join(value.state, 'update.lock'), 'other attempt');
  assert.throws(() => update(value.options, stopped), /EXISTING_UPDATE_LOCK_REQUIRES_REVIEW/);
  assert.equal(fs.readFileSync(path.join(value.state, 'update.lock'), 'utf8'), 'other attempt');
});
test('verified upgrade uses the same directory, retains state and supports byte-exact rollback', t => {
  const value = fixture(t), result = update(value.options, stopped);
  assert.equal(result.target, value.target); assert.equal(result.status, 'UPDATED_FILES_VERIFIED_RUNTIME_NOT_VERIFIED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(value.target, 'manifest.json'))).version, '1.1.0');
  const after = JSON.parse(fs.readFileSync(path.join(value.state, 'installation.json')));
  assert.equal(after.version, '1.1.0'); assert.equal(after.corpusLoadedRecords, 20); assert.equal(after.runtimeAcceptance, 'NOT_VERIFIED');
  assert.equal(fs.existsSync(path.join(value.root, 'components', 'ia-master', '1.1.0')), false); value.preserved();
  const restored = rollback({ ...value.options, backup: result.backup, receiptSha256: result.receiptSha256 }, stopped);
  assert.equal(restored.status, 'BASELINE_RESTORED_FILES_VERIFIED_RUNTIME_NOT_VERIFIED');
  assert.deepEqual(fs.readFileSync(path.join(value.state, 'installation.json')), value.beforeInstallation);
  assert.equal(JSON.parse(fs.readFileSync(path.join(value.target, 'manifest.json'))).version, '1.0.1'); value.preserved();
  assert.ok(fs.existsSync(path.join(result.backup, 'component.candidate')), 'The failed/reverted candidate remains evidence.');
  const repeat = rollback({ ...value.options, backup: result.backup, receiptSha256: restored.receiptSha256 }, stopped);
  assert.equal(repeat.status, restored.status);
});
for (const phase of ['STAGED', 'BASELINE_MOVED', 'CANDIDATE_INSTALLED', 'METADATA_COMMITTED']) {
  test('failure at ' + phase + ' restores only this attempt and preserves private state', t => {
    const value = fixture(t); let failure;
    try { update(value.options, { ...stopped, checkpoint(current) { if (current === phase) throw Error('SYNTHETIC_FAILURE'); } }); } catch (error) { failure = error; }
    assert.equal(failure?.message, 'SYNTHETIC_FAILURE');
    assert.equal(failure.rollback, phase === 'STAGED' ? 'FAILED_BEFORE_SWAP' : 'ROLLBACK_COMPLETED');
    assert.equal(JSON.parse(fs.readFileSync(path.join(value.target, 'manifest.json'))).version, '1.0.1');
    assert.deepEqual(fs.readFileSync(path.join(value.state, 'installation.json')), value.beforeInstallation); value.preserved();
  });
}
test('baseline CAS change during staging is preserved and prevents the swap', t => {
  const value = fixture(t);
  assert.throws(() => update(value.options, { ...stopped, checkpoint(phase) { if (phase === 'STAGED') fs.appendFileSync(path.join(value.target, 'app.js'), '// other writer'); } }), /INSTALLATION_CHANGED_REQUIRES_REVIEW/);
  assert.match(fs.readFileSync(path.join(value.target, 'app.js'), 'utf8'), /other writer/); value.preserved();
});
test('rollback refuses a changed candidate and retains its baseline backup', t => {
  const value = fixture(t); let failure;
  try { update(value.options, { ...stopped, checkpoint(phase) { if (phase === 'CANDIDATE_INSTALLED') { fs.appendFileSync(path.join(value.target, 'app.js'), '// other writer'); throw Error('SYNTHETIC_FAILURE'); } } }); } catch (error) { failure = error; }
  assert.equal(failure?.message, 'UPDATE_FAILED_ROLLBACK_REQUIRES_REVIEW'); assert.equal(failure.rollback, 'ROLLBACK_BLOCKED');
  assert.match(fs.readFileSync(path.join(value.target, 'app.js'), 'utf8'), /other writer/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(failure.backup, 'component.original', 'manifest.json'))).version, '1.0.1'); value.preserved();
});
test('rollback refuses metadata from another writer without overwriting it', t => {
  const value = fixture(t); let failure;
  try { update(value.options, { ...stopped, checkpoint(phase) { if (phase === 'CANDIDATE_INSTALLED') write(path.join(value.state, 'installation.json'), '{"concurrent":true}'); } }); } catch (error) { failure = error; }
  assert.equal(failure?.rollback, 'ROLLBACK_BLOCKED'); assert.equal(fs.readFileSync(path.join(value.state, 'installation.json'), 'utf8'), '{"concurrent":true}'); value.preserved();
});
test('explicit rollback rejects changed backup, receipt, shortcut and running process', t => {
  const backup = fixture(t), first = update(backup.options, stopped);
  fs.appendFileSync(path.join(first.backup, 'installation.original.json'), 'changed');
  assert.throws(() => rollback({ ...backup.options, backup: first.backup, receiptSha256: first.receiptSha256 }, stopped), /BACKUP_INTEGRITY_FAILED/);
  const receipt = fixture(t), second = update(receipt.options, stopped);
  assert.throws(() => rollback({ ...receipt.options, backup: second.backup, receiptSha256: 'f'.repeat(64) }, stopped), /REVIEWED_ROLLBACK_RECEIPT_REQUIRED/);
  const shortcut = fixture(t), third = update(shortcut.options, stopped); fs.appendFileSync(path.join(shortcut.root, 'IA Master - Acesso local.cmd'), 'changed');
  assert.throws(() => rollback({ ...shortcut.options, backup: third.backup, receiptSha256: third.receiptSha256 }, stopped), /SHORTCUT_CHANGED_REQUIRES_REVIEW/);
  const active = fixture(t), fourth = update(active.options, stopped);
  assert.throws(() => rollback({ ...active.options, backup: fourth.backup, receiptSha256: fourth.receiptSha256 }, { observeStopped() { throw Error('STOPPED_MASTER_REQUIRED'); } }), /STOPPED_MASTER_REQUIRED/);
});
test('changed knowledge module cannot be smuggled through a refreshed manifest', t => {
  const value = fixture(t); fs.appendFileSync(path.join(value.candidate, 'knowledge-registry.cjs'), '\n// divergent implementation'); repinCandidate(value);
  assert.throws(() => preflight(value.options), /KNOWLEDGE_CAPABILITY_COMPATIBILITY_REQUIRED/);
});
test('process reappearing after candidate swap blocks rollback without killing or replacing it', t => {
  const value = fixture(t); let checks = 0, failure;
  try { update(value.options, { observeStopped() { if (++checks >= 3) throw Error('STOPPED_MASTER_REQUIRED'); } }); } catch (error) { failure = error; }
  assert.equal(failure?.rollback, 'ROLLBACK_BLOCKED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(value.target, 'manifest.json'))).version, '1.1.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(failure.backup, 'component.original', 'manifest.json'))).version, '1.0.1'); value.preserved();
});
test('CLI accepts only explicit operations and confines preflight to the current user installation', t => {
  const value = fixture(t), entry = path.join(__dirname, 'update.cjs'), config = path.join(path.dirname(value.root), 'options.json');
  write(config, JSON.stringify(value.options));
  const invalid = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /EXPLICIT_OPERATION_AND_OPTIONS_REQUIRED/);
  const expectedEnv = { ...process.env, LOCALAPPDATA: path.dirname(value.root), APPDATA: path.join(path.dirname(value.root), 'appdata') };
  const result = spawnSync(process.execPath, [entry, 'preflight', config], { env: expectedEnv, encoding: 'utf8' });
  if (process.platform === 'win32') {
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, 'PACKAGE_AND_BASELINE_VERIFIED_NO_UPDATE');
    const wrongUser = spawnSync(process.execPath, [entry, 'preflight', config], { env: { ...expectedEnv, LOCALAPPDATA: path.join(path.dirname(value.root), 'other-user') }, encoding: 'utf8' });
    assert.equal(wrongUser.status, 1); assert.match(wrongUser.stderr, /EXISTING_CURRENT_USER_INSTALLATION_REQUIRED/);
  } else { assert.equal(result.status, 1); assert.match(result.stderr, /WINDOWS_NODE_22_REQUIRED/); }
  assert.equal(fs.existsSync(path.join(value.root, 'installation-rollbacks')), false); value.preserved();
});
