'use strict';
// Narrow, explicit update of the verified Windows 1.0.1 installation in place.
// Does not stop/start processes, fetch a release, change ACLs, or touch corpus,
// configuration, credentials, models, the main client, or its shortcuts.
// CI/release approval and authenticated functional acceptance remain separate.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readRegularFile } = require('./safe-read.cjs');

const BASELINE = '041920fe44e09e5d8c0b05f558a5ad5442af782d';
const BASELINE_VERSION = '1.0.1', CANDIDATE_VERSION = '1.1.0';
const REGISTRY_SHA = 'dc6c99e407faa11adb46e68d798bd49374e54ada820c0f755520fcfec32abbb8';
const SCHEMA = 'aurora.master.update.v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
function demand(condition, code) { if (!condition) throw Error(code); }
function parseLocalJSON(bytes) {
  const jsonBytes = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes;
  return JSON.parse(jsonBytes.toString('utf8'));
}
function durableFile(filename, bytes, flag = 'wx', mode = 0o600) {
  const descriptor = fs.openSync(filename, flag, mode);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function digest(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function revision(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }
function safeName(value) {
  return typeof value === 'string' && value.length < 200 &&
    /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(value) &&
    !value.split('/').some(segment => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}
function noLinks(filename, allowMissing = false) {
  const absolute = path.resolve(filename), parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    try { demand(!fs.lstatSync(cursor).isSymbolicLink(), 'LINKED_PATH_REQUIRES_REVIEW'); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw error; }
  }
}
function read(filename, maximum = 5 * 1024 * 1024) {
  noLinks(filename);
  return readRegularFile(filename, maximum);
}
function optionalHash(filename) {
  try { return hash(read(filename)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function tree(directory) {
  noLinks(directory);
  const result = {}, names = new Set(); let total = 0;
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      const filename = path.join(directory, ...name.split('/'));
      demand(!entry.isSymbolicLink(), 'LINKED_PATH_REQUIRES_REVIEW');
      if (entry.isDirectory()) { demand(/^[a-zA-Z0-9_/-]+$/.test(name), 'INVALID_RELEASE_PATH'); walk(name); }
      else {
        demand(entry.isFile() && safeName(name) && !names.has(name.toLowerCase()), 'INVALID_RELEASE_PATH');
        names.add(name.toLowerCase()); const bytes = read(filename); total += bytes.length;
        demand(names.size <= 200 && total <= 32 * 1024 * 1024, 'RELEASE_SIZE_LIMIT');
        result[name] = hash(bytes);
      }
    }
  }
  walk(''); return result;
}
function treeHash(files) { return hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))); }
function inspectRelease(directory, expectedVersion, expectedRevision, expectedManifestSha256) {
  demand(revision(expectedRevision) && digest(expectedManifestSha256), 'REVIEWED_RELEASE_FINGERPRINT_REQUIRED');
  const bytes = read(path.join(directory, 'manifest.json'), 65536), manifest = JSON.parse(bytes.toString('utf8'));
  demand(hash(bytes) === expectedManifestSha256 && manifest.component === 'AURORA_IA_MASTER' &&
    manifest.version === expectedVersion && manifest.sourceRevision === expectedRevision &&
    manifest.dirty === false && manifest.externalAiEnabled === false && manifest.nodeMinimumMajor === 22,
  'REVIEWED_RELEASE_REQUIRED');
  demand(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'INVALID_RELEASE_MANIFEST');
  const files = tree(directory), declared = Object.keys(manifest.files);
  demand(Object.keys(files).length === declared.length + 1, 'UNDECLARED_RELEASE_FILE');
  for (const name of declared) demand(safeName(name) && name !== 'manifest.json' && digest(manifest.files[name]) && files[name] === manifest.files[name], 'RELEASE_INTEGRITY_FAILED');
  for (const name of ['server.cjs', 'manage.cjs', 'kernel/auroraMasterEngine.js']) demand(manifest.files[name], 'INCOMPLETE_RELEASE');
  if (expectedVersion === CANDIDATE_VERSION) demand(manifest.files['studio.cjs'], 'INCOMPLETE_RELEASE');
  return { directory: path.resolve(directory), manifest, manifestSha256: hash(bytes), files, treeSha256: treeHash(files) };
}
function knowledgeCompatibility(baseline, candidate) {
  demand(baseline.manifest.files['knowledge-registry.cjs'] === REGISTRY_SHA &&
    candidate.manifest.files['knowledge-registry.cjs'] === REGISTRY_SHA, 'KNOWLEDGE_CAPABILITY_COMPATIBILITY_REQUIRED');
  // Conservative presence gate. It is deliberately not a claim of runtime parity;
  // the server regression suite and installed acceptance must prove that separately.
  const source = read(path.join(candidate.directory, 'server.cjs')).toString('utf8');
  demand(/require\(['"]\.\/knowledge-registry\.cjs['"]\)/.test(source) &&
    /loadRegistry\(registryPath\)/.test(source) && /selectKnowledge\(registry\s*,/.test(source) &&
    /path\.join\(stateDir\s*,\s*['"]knowledge['"]\s*,\s*['"]knowledge_registry\.v1\.json['"]\)/.test(source) &&
    ['corpusVersion', 'corpusHash', 'recordIds', 'rejectedCount', 'completeHistoricalAbsorption'].every(name => source.includes(name)),
  'KNOWLEDGE_CAPABILITY_COMPATIBILITY_REQUIRED');
  for (const name of Object.keys(baseline.manifest.files)) demand(candidate.manifest.files[name], 'PREVIOUS_COMPONENT_FILE_MISSING');
}
function layout(options) {
  demand(path.isAbsolute(options.root || '') && path.isAbsolute(options.startup || '') && path.isAbsolute(options.candidate || ''), 'EXPLICIT_ABSOLUTE_PATHS_REQUIRED');
  const root = path.resolve(options.root), state = path.join(root, 'integration', 'state', 'ia-master');
  noLinks(root); noLinks(state); noLinks(options.startup, true);
  const target = path.join(root, 'components', 'ia-master', BASELINE_VERSION), candidate = path.resolve(options.candidate);
  demand(candidate !== target && !candidate.startsWith(target + path.sep) && !target.startsWith(candidate + path.sep), 'SEPARATE_CANDIDATE_REQUIRED');
  return { root, state, target, candidate, installation: path.join(state, 'installation.json'),
    lock: path.join(state, 'update.lock'), backups: path.join(root, 'installation-rollbacks'),
    shortcuts: [path.join(root, 'IA Master - Iniciar.cmd'), path.join(root, 'IA Master - Acesso local.cmd'), path.resolve(options.startup)] };
}
function commandFile(node, manager, mode) {
  demand(!/[\r\n"%]/.test(node + manager), 'UNSUPPORTED_LAUNCH_PATH');
  return '@echo off\r\n"' + node + '" "' + manager + '" ' + mode + '\r\n';
}
function inspect(options) {
  const places = layout(options);
  const baseline = inspectRelease(places.target, BASELINE_VERSION, BASELINE, options.baselineManifestSha256);
  const candidate = inspectRelease(places.candidate, CANDIDATE_VERSION, options.sourceRevision, options.manifestSha256);
  knowledgeCompatibility(baseline, candidate);
  const installationBytes = read(places.installation, 65536), installation = parseLocalJSON(installationBytes);
  demand(installation.version === BASELINE_VERSION && installation.sourceRevision === BASELINE &&
    installation.binding === '127.0.0.1' && installation.externalAiEnabled === false && installation.existingClientPreserved === true &&
    /^[a-z0-9][a-z0-9-]{1,63}$/.test(installation.organization || ''), 'INSTALLED_IDENTITY_REQUIRES_REVIEW');
  demand(read(path.join(places.state, 'organization.txt'), 256).toString('utf8').trim() === installation.organization, 'INSTALLED_ORGANIZATION_CONFLICT');
  const manager = path.join(places.target, 'manage.cjs'), node = options.nodeExecutable || process.execPath;
  const shortcuts = places.shortcuts.map((filename, index) => {
    const observed = optionalHash(filename);
    demand((index === 2 && observed === null) || observed === hash(commandFile(node, manager, index === 1 ? 'pair' : 'start')), 'EXISTING_SHORTCUT_REQUIRES_REVIEW');
    return { filename, sha256: observed };
  });
  return { places, baseline, candidate, installation, installationBytes, installationSha256: hash(installationBytes), shortcuts };
}
function stopped(target) {
  demand(process.platform === 'win32' && Number(process.versions.node.split('.')[0]) >= 22, 'WINDOWS_NODE_22_REQUIRED');
  const script = "$ErrorActionPreference='Stop';$taskTarget=$env:AURORA_UPDATE_TARGET;$taskPid=[int]$env:AURORA_UPDATE_PID;$procs=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $taskPid -and $_.CommandLine -and $_.CommandLine.IndexOf($taskTarget,[StringComparison]::OrdinalIgnoreCase) -ge 0} | Select-Object -ExpandProperty ProcessId);$listeners=@(Get-NetTCPConnection -LocalPort 38765 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess);ConvertTo-Json -InputObject @{targetProcesses=$procs;masterListeners=$listeners} -Compress";
  const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 32768,
    env: { ...process.env, AURORA_UPDATE_TARGET: target, AURORA_UPDATE_PID: String(process.pid) } }).trim());
  demand(Array.isArray(result.targetProcesses) && Array.isArray(result.masterListeners) &&
    result.targetProcesses.length === 0 && result.masterListeners.length === 0, 'STOPPED_MASTER_REQUIRED');
}
function unchanged(snapshot) {
  demand(treeHash(tree(snapshot.places.target)) === snapshot.baseline.treeSha256 &&
    optionalHash(snapshot.places.installation) === snapshot.installationSha256 &&
    snapshot.shortcuts.every(item => optionalHash(item.filename) === item.sha256), 'INSTALLATION_CHANGED_REQUIRES_REVIEW');
}
function preflight(options) {
  const value = inspect(options);
  return { schemaVersion: SCHEMA, status: 'PACKAGE_AND_BASELINE_VERIFIED_NO_UPDATE', target: value.places.target,
    fromVersion: BASELINE_VERSION, toVersion: CANDIDATE_VERSION, baselineRevision: BASELINE,
    sourceRevision: value.candidate.manifest.sourceRevision, baselineManifestSha256: value.baseline.manifestSha256,
    manifestSha256: value.candidate.manifestSha256, baselineTreeSha256: value.baseline.treeSha256,
    candidateTreeSha256: value.candidate.treeSha256, installationSha256: value.installationSha256,
    shortcutHashes: value.shortcuts.map(({ sha256 }) => sha256), processStopVerified: false, runtimeCompatibilityVerified: false };
}
function writeJSON(filename, value) {
  const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
  durableFile(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, filename);
}
function withLock(places, callback) {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: SCHEMA, id: crypto.randomUUID(), pid: process.pid }) + '\n');
  try { durableFile(places.lock, bytes); }
  catch (error) { if (error.code === 'EEXIST') throw Error('EXISTING_UPDATE_LOCK_REQUIRES_REVIEW'); throw error; }
  try { return callback(); }
  finally { if (optionalHash(places.lock) === hash(bytes)) fs.unlinkSync(places.lock); }
}
function copyRelease(source, destination, expected) {
  fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
  for (const name of Object.keys(expected)) {
    const output = path.join(destination, ...name.split('/'));
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    const bytes = read(path.join(source, ...name.split('/')));
    demand(hash(bytes) === expected[name], 'CANDIDATE_CHANGED_REQUIRES_REVIEW');
    durableFile(output, bytes);
  }
  demand(treeHash(tree(destination)) === treeHash(expected), 'STAGING_READBACK_FAILED');
}
// Rename old metadata out, then create the new entry with O_EXCL. A concurrent
// writer wins instead of being silently overwritten; its bytes are never removed.
function replaceMetadata(filename, expectedHash, bytes, displaced) {
  demand(optionalHash(filename) === expectedHash && !fs.existsSync(displaced), 'INSTALLATION_CHANGED_REQUIRES_REVIEW');
  fs.renameSync(filename, displaced);
  demand(hash(read(displaced)) === expectedHash, 'INSTALLATION_CHANGED_REQUIRES_REVIEW');
  try { durableFile(filename, bytes); }
  catch (error) {
    if (!fs.existsSync(filename)) fs.copyFileSync(displaced, filename, fs.constants.COPYFILE_EXCL);
    throw error;
  }
}
function verifyReceipt(backup, places, receiptSha256) {
  noLinks(backup);
  const receiptBytes = read(path.join(backup, 'update-receipt.json'), 65536);
  demand(digest(receiptSha256) && hash(receiptBytes) === receiptSha256, 'REVIEWED_ROLLBACK_RECEIPT_REQUIRED');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  demand(receipt.schemaVersion === SCHEMA && receipt.target === places.target && receipt.installation === places.installation &&
    receipt.fromVersion === BASELINE_VERSION && receipt.toVersion === CANDIDATE_VERSION &&
    receipt.baselineRevision === BASELINE && revision(receipt.sourceRevision) &&
    [receipt.baselineTreeSha256, receipt.candidateTreeSha256, receipt.oldInstallationSha256, receipt.newInstallationSha256].every(digest) &&
    path.dirname(path.resolve(backup)) === places.backups && /^[a-f0-9-]{36}$/.test(receipt.id) &&
    path.basename(backup) === 'ia-master-' + receipt.id && Array.isArray(receipt.shortcuts) && receipt.shortcuts.length === 3 &&
    receipt.shortcuts.every((item, index) => item.filename === places.shortcuts[index] && (item.sha256 === null || digest(item.sha256))), 'ROLLBACK_RECEIPT_REQUIRES_REVIEW');
  demand(optionalHash(path.join(backup, 'installation.original.json')) === receipt.oldInstallationSha256, 'BACKUP_INTEGRITY_FAILED');
  return receipt;
}
function restore(backup, places, receipt, observe) {
  observe(places.target);
  demand(receipt.shortcuts.every(item => optionalHash(item.filename) === item.sha256), 'SHORTCUT_CHANGED_REQUIRES_REVIEW');
  const oldBytes = read(path.join(backup, 'installation.original.json'), 65536), installedHash = optionalHash(places.installation);
  demand(hash(oldBytes) === receipt.oldInstallationSha256, 'BACKUP_INTEGRITY_FAILED');
  demand(installedHash === receipt.oldInstallationSha256 || installedHash === receipt.newInstallationSha256 ||
    (installedHash === null && optionalHash(path.join(backup, 'installation.displaced.json')) === receipt.oldInstallationSha256), 'INSTALLATION_CHANGED_REQUIRES_REVIEW');
  const original = path.join(backup, 'component.original'), quarantine = path.join(backup, 'component.candidate');
  const currentTree = fs.existsSync(places.target) ? treeHash(tree(places.target)) : null;
  if (currentTree === receipt.baselineTreeSha256 && !fs.existsSync(original)) {
    demand(installedHash === receipt.oldInstallationSha256, 'INSTALLATION_CHANGED_REQUIRES_REVIEW');
    return;
  }
  demand(treeHash(tree(original)) === receipt.baselineTreeSha256, 'BACKUP_INTEGRITY_FAILED');
  demand(currentTree === receipt.candidateTreeSha256 || (currentTree === null && receipt.phase === 'BASELINE_MOVED'), 'UPDATED_COMPONENT_CHANGED_REQUIRES_REVIEW');
  demand(!fs.existsSync(quarantine), 'ROLLBACK_ATTEMPT_REQUIRES_REVIEW');
  if (currentTree !== null) fs.renameSync(places.target, quarantine);
  demand(!fs.existsSync(places.target), 'INSTALLATION_CHANGED_REQUIRES_REVIEW');
  fs.renameSync(original, places.target);
  if (installedHash === receipt.newInstallationSha256) replaceMetadata(places.installation, installedHash, oldBytes, path.join(backup, 'installation.candidate.json'));
  else if (installedHash === null) durableFile(places.installation, oldBytes);
  demand(treeHash(tree(places.target)) === receipt.baselineTreeSha256 && optionalHash(places.installation) === receipt.oldInstallationSha256 &&
    receipt.shortcuts.every(item => optionalHash(item.filename) === item.sha256), 'ROLLBACK_READBACK_FAILED');
}
function update(options, testing = {}) {
  const snapshot = inspect(options), places = snapshot.places;
  const observe = testing.observeStopped || stopped, checkpoint = testing.checkpoint || (() => {});
  return withLock(places, () => {
    observe(places.target); unchanged(snapshot);
    const id = crypto.randomUUID(), backup = path.join(places.backups, 'ia-master-' + id), stage = path.join(path.dirname(places.target), '.update-' + id);
    noLinks(places.backups, true); fs.mkdirSync(places.backups, { recursive: true, mode: 0o700 }); fs.mkdirSync(backup, { mode: 0o700 });
    const updated = { ...snapshot.installation, version: CANDIDATE_VERSION, sourceRevision: snapshot.candidate.manifest.sourceRevision,
      previousVersion: BASELINE_VERSION, updatedAtUtc: new Date().toISOString(), rollbackPath: backup,
      updateAttemptId: id, runtimeAcceptance: 'NOT_VERIFIED' };
    const newBytes = Buffer.from(JSON.stringify(updated, null, 2) + '\n');
    const receipt = { schemaVersion: SCHEMA, id, phase: 'PREPARED', target: places.target, installation: places.installation,
      fromVersion: BASELINE_VERSION, toVersion: CANDIDATE_VERSION, baselineRevision: BASELINE,
      sourceRevision: snapshot.candidate.manifest.sourceRevision, baselineManifestSha256: snapshot.baseline.manifestSha256,
      manifestSha256: snapshot.candidate.manifestSha256, baselineTreeSha256: snapshot.baseline.treeSha256,
      candidateTreeSha256: snapshot.candidate.treeSha256, oldInstallationSha256: snapshot.installationSha256,
      newInstallationSha256: hash(newBytes), shortcuts: snapshot.shortcuts, runtimeAcceptance: 'NOT_VERIFIED' };
    durableFile(path.join(backup, 'installation.original.json'), snapshot.installationBytes);
    snapshot.shortcuts.forEach((item, index) => { if (item.sha256) durableFile(path.join(backup, 'shortcut-' + index + '.cmd'), read(item.filename)); });
    const save = phase => { receipt.phase = phase; writeJSON(path.join(backup, 'update-receipt.json'), receipt); };
    save('PREPARED');
    let moved = false;
    try {
      copyRelease(places.candidate, stage, snapshot.candidate.files);
      checkpoint('STAGED'); observe(places.target); unchanged(snapshot);
      fs.renameSync(places.target, path.join(backup, 'component.original')); moved = true; save('BASELINE_MOVED');
      demand(treeHash(tree(path.join(backup, 'component.original'))) === snapshot.baseline.treeSha256, 'INSTALLATION_CHANGED_REQUIRES_REVIEW');
      checkpoint('BASELINE_MOVED'); demand(!fs.existsSync(places.target), 'INSTALLATION_CHANGED_REQUIRES_REVIEW');
      fs.renameSync(stage, places.target); save('CANDIDATE_INSTALLED');
      checkpoint('CANDIDATE_INSTALLED'); observe(places.target);
      demand(treeHash(tree(places.target)) === snapshot.candidate.treeSha256 && snapshot.shortcuts.every(item => optionalHash(item.filename) === item.sha256), 'UPDATE_READBACK_FAILED');
      replaceMetadata(places.installation, snapshot.installationSha256, newBytes, path.join(backup, 'installation.displaced.json')); save('METADATA_COMMITTED');
      checkpoint('METADATA_COMMITTED'); observe(places.target);
      demand(treeHash(tree(places.target)) === snapshot.candidate.treeSha256 && optionalHash(places.installation) === hash(newBytes) &&
        snapshot.shortcuts.every(item => optionalHash(item.filename) === item.sha256), 'UPDATE_READBACK_FAILED');
      save('COMPLETED');
      return { status: 'UPDATED_FILES_VERIFIED_RUNTIME_NOT_VERIFIED', backup, target: places.target, sourceRevision: receipt.sourceRevision, manifestSha256: receipt.manifestSha256,
        receiptSha256: hash(read(path.join(backup, 'update-receipt.json'), 65536)) };
    } catch (error) {
      receipt.failureCode = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'UPDATE_IO_FAILED';
      if (moved) {
        try { restore(backup, places, receipt, observe); save('ROLLBACK_COMPLETED'); }
        catch (rollbackError) { receipt.rollbackCode = /^[A-Z0-9_]+$/.test(rollbackError.message) ? rollbackError.message : 'ROLLBACK_IO_FAILED'; save('ROLLBACK_BLOCKED'); }
      } else save('FAILED_BEFORE_SWAP');
      const failure = Error(receipt.phase === 'ROLLBACK_BLOCKED' ? 'UPDATE_FAILED_ROLLBACK_REQUIRES_REVIEW' : receipt.failureCode);
      failure.backup = backup; failure.rollback = receipt.phase; throw failure;
    }
  });
}
function rollback(options, testing = {}) {
  const places = layout(options); demand(path.isAbsolute(options.backup || ''), 'EXPLICIT_BACKUP_REQUIRED');
  const backup = path.resolve(options.backup), observe = testing.observeStopped || stopped;
  return withLock(places, () => {
    const receipt = verifyReceipt(backup, places, options.receiptSha256);
    demand(['BASELINE_MOVED', 'CANDIDATE_INSTALLED', 'METADATA_COMMITTED', 'COMPLETED', 'ROLLBACK_COMPLETED'].includes(receipt.phase), 'ROLLBACK_PHASE_REQUIRES_REVIEW');
    restore(backup, places, receipt, observe); receipt.phase = 'ROLLBACK_COMPLETED'; writeJSON(path.join(backup, 'update-receipt.json'), receipt);
    return { status: 'BASELINE_RESTORED_FILES_VERIFIED_RUNTIME_NOT_VERIFIED', target: places.target, backup,
      receiptSha256: hash(read(path.join(backup, 'update-receipt.json'), 65536)) };
  });
}

module.exports = { preflight, update, rollback, inspectRelease, knowledgeCompatibility, BASELINE, REGISTRY_SHA };
if (require.main === module) {
  try {
    const [operation, optionsFile] = process.argv.slice(2);
    demand(['preflight', 'update', 'rollback'].includes(operation) && path.isAbsolute(optionsFile || ''), 'EXPLICIT_OPERATION_AND_OPTIONS_REQUIRED');
    demand(process.platform === 'win32' && Number(process.versions.node.split('.')[0]) >= 22, 'WINDOWS_NODE_22_REQUIRED');
    const options = parseLocalJSON(read(optionsFile, 65536));
    const expectedRoot = path.join(process.env.LOCALAPPDATA || '', 'AuroraNexus');
    const expectedStartup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AURORA IA Master.cmd');
    demand(options.root === expectedRoot && options.startup === expectedStartup && !options.nodeExecutable, 'EXISTING_CURRENT_USER_INSTALLATION_REQUIRED');
    console.log(JSON.stringify({ preflight, update, rollback }[operation](options)));
  } catch (error) { console.error(JSON.stringify({ code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'UPDATE_OPERATION_FAILED', ...(error.backup ? { backup: error.backup, rollback: error.rollback } : {}) })); process.exitCode = 1; }
}
