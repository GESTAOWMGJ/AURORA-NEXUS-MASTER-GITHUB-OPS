'use strict';
// Per-user Windows lifecycle using the installed Node runtime. No policy changes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) < 22) throw Error('WINDOWS_NODE_22_REQUIRED');
const root = path.join(process.env.LOCALAPPDATA, 'AuroraNexus');
const state = path.join(root, 'integration', 'state', 'ia-master');
const runtime = path.join(root, 'components', 'ollama', '0.35.1', 'ollama.exe');
const startup = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AURORA IA Master.cmd');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function verified() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  if (manifest.component !== 'AURORA_IA_MASTER' || manifest.version !== '1.0.0' || manifest.dirty !== false || !/^[a-f0-9]{40}$/.test(manifest.sourceRevision)) throw Error('REVIEWED_RELEASE_REQUIRED');
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (name.includes('..') || path.isAbsolute(name) || name.includes(':') || sha(path.join(__dirname, name)) !== digest) throw Error('RELEASE_INTEGRITY_FAILED');
  }
  for (const name of ['server.cjs', 'manage.cjs', 'kernel/auroraMasterEngine.js']) if (!manifest.files[name]) throw Error('INCOMPLETE_RELEASE');
  return manifest;
}
function listener(port) {
  if (![11435, 38765].includes(port)) throw Error('INVALID_PORT');
  const command = `$ErrorActionPreference='Stop';$items=@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue);$result=@();foreach($item in $items){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$item.OwningProcess);$result+=@{address=$item.LocalAddress;pid=$item.OwningProcess;exe=$p.ExecutablePath;command=$p.CommandLine}};ConvertTo-Json -InputObject $result -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim() || '[]');
}
function owned(port) {
  const items = listener(port);
  for (const item of items) {
    const expected = port === 11435 ? runtime : process.execPath;
    if (item.address !== '127.0.0.1' || item.exe?.toLowerCase() !== expected.toLowerCase() || (port === 38765 && !item.command?.includes(path.join(__dirname, 'server.cjs')))) throw Error('PORT_OWNED_BY_DIFFERENT_COMPONENT');
  }
  return items;
}
function commandFile(manager, mode) {
  if (/[\r\n"%]/.test(process.execPath + manager)) throw Error('UNSUPPORTED_LAUNCH_PATH');
  return '@echo off\r\n"' + process.execPath + '" "' + manager + '" ' + mode + '\r\n';
}
function install(org) {
  const manifest = verified();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(org || '')) throw Error('ORGANIZATION_REQUIRED');
  if (!fs.existsSync(path.join(root, 'client'))) throw Error('EXISTING_AURORA_REQUIRED');
  const target = path.join(root, 'components', 'ia-master', manifest.version);
  if (fs.existsSync(target) || fs.existsSync(state) || fs.existsSync(startup)) throw Error('EXISTING_INSTALLATION_REQUIRES_REVIEW');
  const manager = path.join(target, 'manage.cjs');
  const start = commandFile(manager, 'start'), pair = commandFile(manager, 'pair');
  fs.mkdirSync(state, { recursive: true });
  const identity = execFileSync('whoami.exe', [], { encoding: 'utf8', windowsHide: true }).trim();
  execFileSync('icacls.exe', [state, '/inheritance:r', '/grant:r', identity + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'], { windowsHide: true, stdio: 'pipe' });
  fs.writeFileSync(path.join(state, 'control.key'), crypto.randomBytes(32).toString('base64url'), { flag: 'wx' });
  fs.writeFileSync(path.join(state, 'organization.txt'), org, { flag: 'wx' });
  fs.cpSync(__dirname, target, { recursive: true, errorOnExist: true, force: false });
  fs.writeFileSync(path.join(root, 'IA Master - Iniciar.cmd'), start, { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'IA Master - Acesso local.cmd'), pair, { flag: 'wx' });
  fs.writeFileSync(startup, start, { flag: 'wx' });
  fs.writeFileSync(path.join(state, 'installation.json'), JSON.stringify({ version: manifest.version, sourceRevision: manifest.sourceRevision, organization: org, installedAtUtc: new Date().toISOString(), binding: '127.0.0.1', externalAiEnabled: false, cloudSyncVerified: false, existingClientPreserved: true }, null, 2));
  console.log('AURORA_IA_MASTER_INSTALLED');
}
function start() {
  verified();
  if (!fs.existsSync(runtime) || !fs.existsSync(path.join(state, 'control.key'))) throw Error('LOCAL_INSTALLATION_REQUIRED');
  const env = { ...process.env, AURORA_MASTER_STATE: state, AURORA_ORG_ID: fs.readFileSync(path.join(state, 'organization.txt'), 'utf8').trim(), OLLAMA_HOST: '127.0.0.1:11435', OLLAMA_NO_CLOUD: '1', OLLAMA_MODELS: path.join(root, 'components', 'ollama-models'), OLLAMA_CONTEXT_LENGTH: '8192', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_KEEP_ALIVE: '5m', OLLAMA_ORIGINS: 'http://127.0.0.1:38765' };
  for (const entry of [{ port: 11435, exe: runtime, args: ['serve'], name: 'ollama' }, { port: 38765, exe: process.execPath, args: [path.join(__dirname, 'server.cjs')], name: 'ia-master' }]) {
    if (owned(entry.port).length) continue;
    const out = fs.openSync(path.join(state, entry.name + '.out.log'), 'a'), err = fs.openSync(path.join(state, entry.name + '.err.log'), 'a');
    const child = spawn(entry.exe, entry.args, { detached: true, windowsHide: true, env, stdio: ['ignore', out, err] });
    child.on('error', () => console.error('LOCAL_COMPONENT_START_FAILED'));
    child.unref(); fs.closeSync(out); fs.closeSync(err);
    if (child.pid) fs.writeFileSync(path.join(state, entry.name + '.pid'), String(child.pid));
  }
  console.log('AURORA_IA_MASTER_START_REQUESTED');
}
async function pair() {
  verified(); if (!owned(38765).length) throw Error('START_LOCAL_COMPONENT_FIRST');
  const token = fs.readFileSync(path.join(state, 'control.key'), 'utf8').trim();
  const response = await fetch('http://127.0.0.1:38765/api/pair-ticket', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Aurora-Local': '1' }, body: '{}' });
  if (!response.ok) throw Error('LOCAL_PAIRING_FAILED');
  const { ticket } = await response.json();
  if (!/^[\w-]{43}$/.test(ticket)) throw Error('INVALID_PAIRING_TICKET');
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', 'http://127.0.0.1:38765/#ticket=' + ticket], { detached: true, windowsHide: true, stdio: 'ignore' });
  browser.unref();
}
function stop(disableStartup) {
  verified();
  for (const port of [38765, 11435]) for (const item of owned(port)) process.kill(item.pid);
  if (disableStartup && fs.existsSync(startup)) {
    if (fs.readFileSync(startup, 'utf8') !== commandFile(path.join(__dirname, 'manage.cjs'), 'start')) throw Error('DIFFERENT_STARTUP_ENTRY_REQUIRES_REVIEW');
    fs.unlinkSync(startup);
  }
  console.log('AURORA_IA_MASTER_STOPPED_DATA_PRESERVED');
}
(async () => {
  switch (process.argv[2]) {
    case 'install': install(process.argv[3]); break;
    case 'start': start(); break;
    case 'pair': await pair(); break;
    case 'stop': stop(process.argv[3] === '--disable-startup'); break;
    default: throw Error('EXPLICIT_OPERATION_REQUIRED');
  }
})().catch(() => { console.error('AURORA_LOCAL_MANAGEMENT_FAILED'); process.exitCode = 1; });
