'use strict';
// Metadata-only preview of the existing pilot source. No configure/activate mode.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {selectDeployment, sha} = require('./aurora-cloud-synthetic-probe.cjs');
const PROJECT = 'wmgj-hml-jfn-20260927';
const MODULES = ['00_CORE_WMGJ', '37_AURORA_CONECTORES_PLUG_AND_PLAY'];
const MAX_AFTER_DEPLOYMENT_READS = 5;
const DEPLOYMENT_RETRY_DELAY_MS = 10000;
const FLAGS = ['ok','sourceIdentified','metadataAccessVerified','existingHmacReused','triggerReviewRequired',
  'configurationWriteEligible','configurationChanged','configurationUncertain','rollbackVerified','configOnly',
  'sourceActive','triggersChanged','contentRead','providerConsentVerified','firstIngestionVerified',
  'operationalReady','installationComplete','complete'];
const KEYS = ['code','state','scope','sourceCount','configurationSha256','triggerCount','handlerHashes',...FLAGS];
const STATES = new Set(['PENDING_CONFIGURATION','SOURCE_IDENTIFIED','PENDING_TRIGGER_REVIEW']);
const SUFFIXES = ['PENDING','OWNER_REQUIRED','EXPIRED','REQUEST_REJECTED','LOCK_BUSY','TENANT_MISMATCH',
  'CONFIGURATION_INVALID','SOURCE_CONFLICT','ACTIVE_STATE_REQUIRES_REVIEW','CAS_CONFLICT','TRIGGER_REVIEW_REQUIRED',
  'REGISTRY_INVALID','DEPENDENCY_FAILED','CONFIG_ONLY_VERIFIED'];
const PUBLIC_REJECTION = 'CONNECTOR_REUSE_PREVIEW_REJECTED';
const PHASES = new Set(['PREFLIGHT_POLICY','PREFLIGHT_GIT','DEPLOYMENT_BEFORE','SOURCE_BEFORE',
  'PREVIEW_CALL','PREVIEW_READ','DEPLOYMENT_AFTER','SOURCE_AFTER','FINALIZE']);
const REASONS = new Set(['REF_INVALID','SHA_INVALID','POLICY_READ_FAILED','POLICY_SCOPE_INVALID',
  'POLICY_WINDOW_INVALID','TEMP_INVALID','HEAD_MISMATCH','TRACKED_DIRTY','SCOPED_UNTRACKED_OR_DIRTY',
  'PROJECT_BINDING_INVALID','WORKSPACE_INVALID','COMMAND_FAILED','JSON_INVALID',
  'DEPLOYMENT_SELECTION_INVALID','SOURCE_FILE_INVALID','SOURCE_HASH_MISMATCH',
  'MANIFEST_INVALID_OR_MISMATCH','OUTPUT_FILE_INVALID','ENVELOPE_INVALID','DTO_SCHEMA_INVALID',
  'DTO_VALUES_INVALID','PUBLISHED_VERSION_CHANGED','ARTIFACT_WRITE_FAILED','UNEXPECTED']);
// Only diagnostics created here are trusted; never copy error properties or messages.
const errorDiagnostics = new WeakMap();
function rejection(detail) {
  const error = new Error(PUBLIC_REJECTION);
  errorDiagnostics.set(error,detail);
  return error;
}
const reject = (reason = 'UNEXPECTED') => {throw rejection({reason});};
function atPhase(phase,fallbackReason,operation) {
  try { return operation(); }
  catch (error) {
    const known = errorDiagnostics.get(error);
    throw rejection({...known,phase:known?.phase ?? phase,
      reason:known?.reason ?? (error instanceof SyntaxError ? 'JSON_INVALID' : fallbackReason)});
  }
}
function failureEvidence(error) {
  const detail = errorDiagnostics.get(error) || {};
  return {schemaVersion:'aurora.wmgj.existing-source-preview-failure.v1',status:'REJECTED',code:PUBLIC_REJECTION,
    phase:PHASES.has(detail.phase) ? detail.phase : 'UNKNOWN',
    reason:REASONS.has(detail.reason) ? detail.reason : 'UNEXPECTED',
    exitCode:Number.isSafeInteger(detail.exitCode) && detail.exitCode >= 0 && detail.exitCode <= 255 ? detail.exitCode : null,
    spawnFailure:detail.spawnFailure == null ? null : ['ENOENT','ETIMEDOUT','ENOBUFS'].includes(detail.spawnFailure) ? detail.spawnFailure : 'OTHER',
    signal:detail.signal == null ? null : ['SIGTERM','SIGKILL'].includes(detail.signal) ? detail.signal : 'OTHER',
    ...(detail.deploymentSelection ? {deploymentSelection:detail.deploymentSelection} : {}),
    ...(detail.deploymentObservations ? {deploymentObservations:detail.deploymentObservations} : {}),
    complete:false,providerIngestionOrInstallationVerified:false};
}

// Diagnose the selector's predicates without exporting IDs, descriptions or API
// payloads. This does not choose another deployment or relax a failed selection.
function deploymentSelectionEvidence(rows, sourceSha) {
  const array = Array.isArray(rows);
  const canonical = array ? rows.filter(row => row && typeof row.description === 'string'
    && row.description.startsWith('AURORA_EXECUTION_API_CANONICAL')) : [];
  const selected = canonical.length === 1 ? canonical[0] : null;
  const versionNumberValid = !!selected && Number.isSafeInteger(selected.versionNumber) && selected.versionNumber >= 1;
  const deploymentIdValid = !!selected && typeof selected.deploymentId === 'string'
    && /^[A-Za-z0-9_-]{10,256}$/.test(selected.deploymentId);
  return {shape:array ? 'ARRAY' : 'NON_ARRAY',rowCount:array ? rows.length : null,
    canonicalCount:array ? canonical.length : null,
    expectedDescriptionCount:array ? canonical.filter(row => row.description === 'AURORA_EXECUTION_API_CANONICAL ' + sourceSha).length : null,
    versionNumberValid,deploymentIdValid,versionNumber:versionNumberValid ? selected.versionNumber : null,
    deploymentIdentitySha256:deploymentIdValid ? sha(selected.deploymentId) : null,
    descriptionSha256:selected && selected.description.length <= 1024 ? sha(selected.description) : null};
}
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function previewAuthorizationDeadline(policy, now=Date.now()) {
  const legacy=Date.parse(policy?.scope?.validUntilUtc);
  if(Number.isFinite(legacy) && now < legacy) return legacy;
  const decision=(policy?.reaffirmations||[]).find(item=>item?.decisionId==='AURORA-HML-CONTINUOUS-DRIVE-20261026');
  const scopeHash=policy?.scope?.continuousDriveScopeSha256;
  if(decision && policy?.scope?.continuousDriveDecisionId===decision.decisionId
    && typeof scopeHash==='string' && /^[a-f0-9]{64}$/.test(scopeHash)
    && decision.exactPrivateScopeSha256===scopeHash
    && decision.continuousDriveTriggerAuthorized===true && decision.processExistingAuthorized===true
    && decision.queueMetadataRemediationAuthorized===true && decision.realSourceActivationAuthorized===true
    && decision.sourceMutationAuthorized===false && decision.newSourceEnrollmentAuthorized===false
    && decision.productionAuthorized===false && decision.clinicalSensitiveAuthorized===false) {
    const scoped=Date.parse(decision.validUntilUtc);
    if(Number.isFinite(scoped) && now < scoped) return scoped;
  }
  reject('POLICY_WINDOW_INVALID');
}

function readPreview(output) {
  const limit = 65536;
  // Inspect and read one opened object. Linux runners also refuse links/FIFOs
  // at open; never re-open a pathname after checking its metadata.
  const fd = fs.openSync(output, fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const before = fs.fstatSync(fd, {bigint:true});
    if (!before.isFile() || before.size > BigInt(limit) || before.nlink !== 1n) reject('OUTPUT_FILE_INVALID');
    const bytes = Buffer.alloc(limit + 1);
    let length = 0, count;
    while (length < bytes.length && (count = fs.readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += count;
    const after = fs.fstatSync(fd, {bigint:true});
    if (length > limit || BigInt(length) !== before.size || !after.isFile() || after.nlink !== 1n
      || ['dev','ino','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key])) reject('OUTPUT_FILE_INVALID');
    return sanitizePreview(JSON.parse(bytes.subarray(0, length).toString('utf8')));
  } finally {
    fs.closeSync(fd);
  }
}

function sanitizePreview(envelope) {
  const v = envelope?.response;
  if (envelope?.error != null || !v || Array.isArray(v) || typeof v !== 'object') reject('ENVELOPE_INVALID');
  if (Object.keys(v).sort().join(',') !== [...KEYS].sort().join(',')
    || !FLAGS.every(key => typeof v[key] === 'boolean')) reject('DTO_SCHEMA_INVALID');
  if (!SUFFIXES.some(s => v.code === 'AURORA_CONNECTOR_REUSE_' + s) || !STATES.has(v.state)
    || v.scope !== 'WMGJ_EXISTING_SOURCE_CONFIG_ONLY' || !v.configOnly
    || ['configurationChanged','configurationUncertain','rollbackVerified','triggersChanged','contentRead',
      'providerConsentVerified','firstIngestionVerified','operationalReady','installationComplete','complete'].some(key => v[key])
    || !Number.isSafeInteger(v.sourceCount) || v.sourceCount < 0 || v.sourceCount > 1
    || (v.configurationSha256 !== null && !hex(v.configurationSha256))
    || (v.triggerCount !== null && (!Number.isSafeInteger(v.triggerCount) || v.triggerCount < 0 || v.triggerCount > 12))
    || !Array.isArray(v.handlerHashes) || v.handlerHashes.length > 12 || !v.handlerHashes.every(hex)
    || (v.triggerCount === null ? v.handlerHashes.length !== 0 : v.handlerHashes.length !== v.triggerCount)
    || v.triggerReviewRequired !== (v.handlerHashes.length > 0)
    || v.ok !== (v.code === 'AURORA_CONNECTOR_REUSE_CONFIG_ONLY_VERIFIED')) reject('DTO_VALUES_INVALID');
  if (v.ok && (!v.sourceIdentified || v.sourceCount !== 1 || !v.metadataAccessVerified
    || !v.existingHmacReused || !hex(v.configurationSha256))) reject('DTO_VALUES_INVALID');
  return Object.fromEntries(KEYS.map(key => [key,v[key]]));
}

function command(executable,args,cwd) {
  const result = cp.spawnSync(executable,args,{cwd,encoding:'utf8',timeout:400000,maxBuffer:12000000,
    env:{...process.env,DEBUG:'',NODE_DEBUG:''}});
  if (result.error || result.status !== 0) throw rejection({reason:'COMMAND_FAILED',exitCode:result.status,
    spawnFailure:result.error ? result.error.code ?? 'OTHER' : null,signal:result.signal});
  return result.stdout;
}

function waitForDeployment(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds);
}

function run({repo = path.resolve(__dirname,'..'), temporary = process.env.RUNNER_TEMP,
  sourceSha = process.env.GITHUB_SHA, exec = command, now = Date.now, wait = waitForDeployment} = {}) {
  const gate = () => atPhase('PREFLIGHT_POLICY','POLICY_READ_FAILED',() => {
    const policy = JSON.parse(fs.readFileSync(path.join(repo,'firebase-migration/policy/hml-owner-release-approval-v1.json')));
    if (process.env.GITHUB_REF !== 'refs/heads/main') reject('REF_INVALID');
    if (!/^[a-f0-9]{40}$/.test(sourceSha) || process.env.GITHUB_SHA !== sourceSha) reject('SHA_INVALID');
    if (policy.scope?.projectId !== PROJECT || policy.scope?.environment !== 'firebase-homologation'
      || policy.scope?.branch !== 'main'
      || policy.integrationAndHmlPublicationAuthorized !== true) reject('POLICY_SCOPE_INVALID');
    previewAuthorizationDeadline(policy,now());
  });
  gate();
  const call = (phase,executable,args,cwd) => atPhase(phase,'COMMAND_FAILED',() => exec(executable,args,cwd));
  atPhase('PREFLIGHT_GIT','UNEXPECTED',() => {
    if (!temporary || !path.isAbsolute(temporary)) reject('TEMP_INVALID');
    if (call('PREFLIGHT_GIT','git',['rev-parse','HEAD'],repo).trim() !== sourceSha) reject('HEAD_MISMATCH');
    if (call('PREFLIGHT_GIT','git',['diff','--name-only','HEAD','--'],repo).trim()) reject('TRACKED_DIRTY');
    if (call('PREFLIGHT_GIT','git',['status','--porcelain','--untracked-files=all','--','src','tools','.github/workflows','appsscript.json',
      'firebase-migration/policy/hml-owner-release-approval-v1.json'],repo).trim()) reject('SCOPED_UNTRACKED_OR_DIRTY');
  });
  const scriptId = atPhase('PREFLIGHT_GIT','PROJECT_BINDING_INVALID',() => {
    const workflow = fs.readFileSync(path.join(repo,'.github/workflows/deploy-appscript.yml'),'utf8');
    const value = workflow.match(/^\s+APPS_SCRIPT_ID:\s*([A-Za-z0-9_-]+)\s*$/m)?.[1];
    if (!value) reject('PROJECT_BINDING_INVALID');
    return value;
  });
  const workspace = atPhase('PREFLIGHT_GIT','WORKSPACE_INVALID',() => {
    const directory = fs.mkdtempSync(path.join(temporary,'aurora-reuse-preview-'));
    fs.chmodSync(directory,0o700); return directory;
  });
  const project = dir => fs.writeFileSync(path.join(dir,'.clasp.json'),JSON.stringify({scriptId,rootDir:'.'}),{mode:0o600,flag:'wx'});
  atPhase('PREFLIGHT_GIT','WORKSPACE_INVALID',() => project(workspace));
  const deploymentObservations = {maxAfterReads:MAX_AFTER_DEPLOYMENT_READS,
    retryDelayMs:DEPLOYMENT_RETRY_DELAY_MS,afterReads:0,after:[]};
  const read = (suffix,expected = null) => {
    const deploymentPhase = 'DEPLOYMENT_' + suffix, sourcePhase = 'SOURCE_' + suffix;
    try {
      const deployment = atPhase(deploymentPhase,'DEPLOYMENT_SELECTION_INVALID',() => {
        for (let attempt = 1; ; attempt++) {
          gate();
          const rows = JSON.parse(call(deploymentPhase,'clasp',['deployments','--json'],workspace));
          const observed = deploymentSelectionEvidence(rows,sourceSha);
          if (expected) {
            deploymentObservations.after.push(observed);
            deploymentObservations.afterReads++;
          }
          let selected;
          try { selected = selectDeployment(rows,sourceSha); } catch { /* Diagnose below; never accept a failed selector. */ }
          if (selected && (!expected || (selected.versionNumber === expected.versionNumber
            && sha(selected.deploymentId) === expected.deploymentIdentitySha256))) return selected;

          // A freshly redeployed canonical identity can be briefly observed with
          // its prior SHA/version. Wait only for the same unique canonical shape;
          // never pull stale bytes or repeat PREVIEW while convergence is pending.
          const rowsSafe = Array.isArray(rows) && rows.every(row => row && typeof row === 'object' && !Array.isArray(row));
          const canonicalShaObserved = Array.isArray(rows) && rows.some(row => typeof row.description === 'string'
            && /^AURORA_EXECUTION_API_CANONICAL [a-f0-9]{40}$/.test(row.description));
          const initialConvergence = !expected && observed.canonicalCount === 1 && observed.versionNumberValid
            && observed.deploymentIdValid && observed.expectedDescriptionCount === 0
            && rowsSafe && canonicalShaObserved;
          const historical = expected && observed.canonicalCount === 1 && observed.versionNumberValid
            && observed.deploymentIdValid && observed.deploymentIdentitySha256 === expected.deploymentIdentitySha256
            && observed.versionNumber < expected.versionNumber && rowsSafe && canonicalShaObserved;
          if (!(initialConvergence || historical) || attempt >= MAX_AFTER_DEPLOYMENT_READS) {
            throw rejection({reason:'DEPLOYMENT_SELECTION_INVALID',deploymentSelection:observed});
          }
          gate(); wait(DEPLOYMENT_RETRY_DELAY_MS); gate();
        }
      });
      const directory = atPhase(sourcePhase,'WORKSPACE_INVALID',() => {
        const value = fs.mkdtempSync(path.join(workspace,'published-')); project(value); return value;
      });
      gate(); call(sourcePhase,'clasp',['pull','--versionNumber',String(deployment.versionNumber),'--json'],directory); gate();
      const hashes = {};
      atPhase(sourcePhase,'SOURCE_FILE_INVALID',() => {
        for (const module of MODULES) {
          const candidates = ['.gs','.js'].map(ext => path.join(directory,module+ext)).filter(file=>fs.existsSync(file));
          if (candidates.length !== 1 || fs.lstatSync(candidates[0]).isSymbolicLink()) reject('SOURCE_FILE_INVALID');
          const local = fs.readFileSync(path.join(repo,'src',module+'.gs'),'utf8').replace(/\r\n/g,'\n');
          const remote = fs.readFileSync(candidates[0],'utf8').replace(/\r\n/g,'\n');
          if (local !== remote) reject('SOURCE_HASH_MISMATCH'); hashes[module] = sha(remote);
        }
      });
      atPhase(sourcePhase,'MANIFEST_INVALID_OR_MISMATCH',() => {
        if (stable(JSON.parse(fs.readFileSync(path.join(repo,'appsscript.json'))))
          !== stable(JSON.parse(fs.readFileSync(path.join(directory,'appsscript.json'))))) reject('MANIFEST_INVALID_OR_MISMATCH');
      });
      return {versionNumber:deployment.versionNumber,deploymentIdentitySha256:sha(deployment.deploymentId),hashes};
    } catch (error) {
      if (expected && deploymentObservations.afterReads > 0) {
        throw rejection({...errorDiagnostics.get(error),deploymentObservations});
      }
      throw error;
    }
  };
  const before = read('BEFORE');
  const request = {confirmation:'REUSE_EXISTING_WMGJ_SOURCE_CONFIG_ONLY',configOnly:true,mode:'PREVIEW',orgId:'wmgj',
    expectedFolderId:'1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-',expectedSourceId:'drive-primary',expectedSlaMinutes:1440,
    expectedConfigurationSha256:null};
  const output = path.join(workspace,'preview.raw.json');
  gate(); call('PREVIEW_CALL','bash',[path.join(repo,'tools/run-clasp-checked.sh'),'auroraReaproveitarFonteWmgjConfigOnly',output,JSON.stringify([request])],workspace); gate();
  const summary = atPhase('PREVIEW_READ','OUTPUT_FILE_INVALID',() => readPreview(output));
  const after = read('AFTER',before); gate();
  atPhase('FINALIZE','UNEXPECTED',() => { if (stable(before) !== stable(after)) reject('PUBLISHED_VERSION_CHANGED'); });
  return {schemaVersion:'aurora.wmgj.existing-source-preview-evidence.v1',sourceSha,publishedVersionStable:true,
    checkedSourceShaScope:'PUBLISHED_APPS_SCRIPT_VERSION_AND_PREVIEW_COORDINATOR',runtimeFunctionHashesVerified:false,
    published:before,deploymentObservations,summary,existingHmacClaimScope:'PRESERVED_CONFIGURATION_FORMAT_ONLY',
    providerIngestionOrInstallationVerified:false,complete:false};
}

function main({preview = run, temporary = process.env.RUNNER_TEMP,
  stdout = console.log, stderr = console.error} = {}) {
  try {
    const proof = preview();
    atPhase('FINALIZE','ARTIFACT_WRITE_FAILED',() =>
      fs.writeFileSync(path.join(temporary,'connector-reuse-preview.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600,flag:'wx'}));
    stdout(JSON.stringify(proof));
    return 0;
  } catch (error) {
    if (typeof temporary === 'string' && path.isAbsolute(temporary)) {
      try {
        fs.writeFileSync(path.join(temporary,'connector-reuse-preview.json'),JSON.stringify(failureEvidence(error),null,2)+'\n',{mode:0o600,flag:'wx'});
      } catch { /* Never replace an existing artifact or print a raw filesystem error. */ }
    }
    stderr(PUBLIC_REJECTION);
    return 1;
  }
}

module.exports = {sanitizePreview,readPreview,run,failureEvidence,command,main,previewAuthorizationDeadline};
if (require.main === module) process.exitCode = main();
