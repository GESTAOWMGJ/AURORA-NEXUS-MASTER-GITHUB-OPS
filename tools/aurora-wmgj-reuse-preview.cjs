'use strict';
// Metadata-only preview of the existing pilot source. No configure/activate mode.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {selectDeployment, sha} = require('./aurora-cloud-synthetic-probe.cjs');
const PROJECT = 'wmgj-hml-jfn-20260927';
const MODULES = ['00_CORE_WMGJ', '37_AURORA_CONECTORES_PLUG_AND_PLAY'];
const FLAGS = ['ok','sourceIdentified','metadataAccessVerified','existingHmacReused','triggerReviewRequired',
  'configurationWriteEligible','configurationChanged','configurationUncertain','rollbackVerified','configOnly',
  'sourceActive','triggersChanged','contentRead','providerConsentVerified','firstIngestionVerified',
  'operationalReady','installationComplete','complete'];
const KEYS = ['code','state','scope','sourceCount','configurationSha256','triggerCount','handlerHashes',...FLAGS];
const STATES = new Set(['PENDING_CONFIGURATION','SOURCE_IDENTIFIED','PENDING_TRIGGER_REVIEW']);
const SUFFIXES = ['PENDING','OWNER_REQUIRED','EXPIRED','REQUEST_REJECTED','LOCK_BUSY','TENANT_MISMATCH',
  'CONFIGURATION_INVALID','SOURCE_CONFLICT','ACTIVE_STATE_REQUIRES_REVIEW','CAS_CONFLICT','TRIGGER_REVIEW_REQUIRED',
  'REGISTRY_INVALID','DEPENDENCY_FAILED','CONFIG_ONLY_VERIFIED'];
const reject = () => {throw new Error('CONNECTOR_REUSE_PREVIEW_REJECTED');};
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function sanitizePreview(envelope) {
  const v = envelope?.response;
  if (envelope?.error != null || !v || Array.isArray(v) || typeof v !== 'object'
    || Object.keys(v).sort().join(',') !== [...KEYS].sort().join(',')
    || !FLAGS.every(key => typeof v[key] === 'boolean')
    || !SUFFIXES.some(s => v.code === 'AURORA_CONNECTOR_REUSE_' + s) || !STATES.has(v.state)
    || v.scope !== 'WMGJ_EXISTING_SOURCE_CONFIG_ONLY' || !v.configOnly
    || ['configurationChanged','configurationUncertain','rollbackVerified','triggersChanged','contentRead',
      'providerConsentVerified','firstIngestionVerified','operationalReady','installationComplete','complete'].some(key => v[key])
    || !Number.isSafeInteger(v.sourceCount) || v.sourceCount < 0 || v.sourceCount > 1
    || (v.configurationSha256 !== null && !hex(v.configurationSha256))
    || (v.triggerCount !== null && (!Number.isSafeInteger(v.triggerCount) || v.triggerCount < 0 || v.triggerCount > 12))
    || !Array.isArray(v.handlerHashes) || v.handlerHashes.length > 12 || !v.handlerHashes.every(hex)
    || (v.triggerCount === null ? v.handlerHashes.length !== 0 : v.handlerHashes.length !== v.triggerCount)
    || v.triggerReviewRequired !== (v.handlerHashes.length > 0)
    || v.ok !== (v.code === 'AURORA_CONNECTOR_REUSE_CONFIG_ONLY_VERIFIED')) reject();
  if (v.ok && (!v.sourceIdentified || v.sourceCount !== 1 || !v.metadataAccessVerified
    || !v.existingHmacReused || !hex(v.configurationSha256))) reject();
  return Object.fromEntries(KEYS.map(key => [key,v[key]]));
}

function command(executable,args,cwd) {
  const result = cp.spawnSync(executable,args,{cwd,encoding:'utf8',timeout:400000,maxBuffer:12000000,
    env:{...process.env,DEBUG:'',NODE_DEBUG:''}});
  if (result.error || result.status !== 0) reject();
  return result.stdout;
}

function run({repo = path.resolve(__dirname,'..'), temporary = process.env.RUNNER_TEMP,
  sourceSha = process.env.GITHUB_SHA, exec = command, now = Date.now} = {}) {
  const gate = () => {
    const policy = JSON.parse(fs.readFileSync(path.join(repo,'firebase-migration/policy/hml-owner-release-approval-v1.json')));
    if (process.env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(sourceSha) || process.env.GITHUB_SHA !== sourceSha
      || policy.scope?.projectId !== PROJECT || policy.scope?.environment !== 'firebase-homologation'
      || policy.scope?.branch !== 'main'
      || policy.integrationAndHmlPublicationAuthorized !== true
      || !Number.isFinite(Date.parse(policy.scope.validUntilUtc)) || now() >= Date.parse(policy.scope.validUntilUtc)) reject();
  };
  gate();
  if (!temporary || !path.isAbsolute(temporary) || exec('git',['rev-parse','HEAD'],repo).trim() !== sourceSha
    || exec('git',['diff','--name-only','HEAD','--'],repo).trim()
    || exec('git',['status','--porcelain','--untracked-files=all','--','src','tools','.github/workflows','appsscript.json',
      'firebase-migration/policy/hml-owner-release-approval-v1.json'],repo).trim()) reject();
  const workflow = fs.readFileSync(path.join(repo,'.github/workflows/deploy-appscript.yml'),'utf8');
  const scriptId = workflow.match(/^\s+APPS_SCRIPT_ID:\s*([A-Za-z0-9_-]+)\s*$/m)?.[1];
  if (!scriptId) reject();
  const workspace = fs.mkdtempSync(path.join(temporary,'aurora-reuse-preview-'));
  fs.chmodSync(workspace,0o700);
  const project = dir => fs.writeFileSync(path.join(dir,'.clasp.json'),JSON.stringify({scriptId,rootDir:'.'}),{mode:0o600,flag:'wx'});
  project(workspace);
  const read = () => {
    gate();
    const deployment = selectDeployment(JSON.parse(exec('clasp',['deployments','--json'],workspace)),sourceSha);
    const directory = fs.mkdtempSync(path.join(workspace,'published-')); project(directory);
    gate(); exec('clasp',['pull','--versionNumber',String(deployment.versionNumber),'--json'],directory); gate();
    const hashes = {};
    for (const module of MODULES) {
      const candidates = ['.gs','.js'].map(ext => path.join(directory,module+ext)).filter(file=>fs.existsSync(file));
      if (candidates.length !== 1 || fs.lstatSync(candidates[0]).isSymbolicLink()) reject();
      const local = fs.readFileSync(path.join(repo,'src',module+'.gs'),'utf8').replace(/\r\n/g,'\n');
      const remote = fs.readFileSync(candidates[0],'utf8').replace(/\r\n/g,'\n');
      if (local !== remote) reject(); hashes[module] = sha(remote);
    }
    if (stable(JSON.parse(fs.readFileSync(path.join(repo,'appsscript.json'))))
      !== stable(JSON.parse(fs.readFileSync(path.join(directory,'appsscript.json'))))) reject();
    return {versionNumber:deployment.versionNumber,deploymentIdentitySha256:sha(deployment.deploymentId),hashes};
  };
  const before = read();
  const request = {confirmation:'REUSE_EXISTING_WMGJ_SOURCE_CONFIG_ONLY',configOnly:true,mode:'PREVIEW',orgId:'wmgj',
    expectedFolderId:'1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-',expectedSourceId:'drive-primary',expectedSlaMinutes:1440,
    expectedConfigurationSha256:null};
  const output = path.join(workspace,'preview.raw.json');
  gate(); exec('bash',[path.join(repo,'tools/run-clasp-checked.sh'),'auroraReaproveitarFonteWmgjConfigOnly',output,JSON.stringify([request])],workspace); gate();
  const info = fs.statSync(output);
  if (!info.isFile() || info.size > 65536 || info.nlink !== 1) reject();
  const summary = sanitizePreview(JSON.parse(fs.readFileSync(output,'utf8')));
  const after = read(); gate();
  if (stable(before) !== stable(after)) reject();
  return {schemaVersion:'aurora.wmgj.existing-source-preview-evidence.v1',sourceSha,publishedVersionStable:true,
    checkedSourceShaScope:'PUBLISHED_APPS_SCRIPT_VERSION_AND_PREVIEW_COORDINATOR',runtimeFunctionHashesVerified:false,
    published:before,summary,existingHmacClaimScope:'PRESERVED_CONFIGURATION_FORMAT_ONLY',
    providerIngestionOrInstallationVerified:false,complete:false};
}

module.exports = {sanitizePreview,run};
if (require.main === module) {
  try {
    const proof = run();
    fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'connector-reuse-preview.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(JSON.stringify(proof));
  } catch {
    console.error('CONNECTOR_REUSE_PREVIEW_REJECTED'); process.exitCode = 1;
  }
}
