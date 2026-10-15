'use strict';
// Coordinator for an already-published executable. Never pushes, deploys or activates.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const canonicalReadback = require('./aurora-cloud-synthetic-readback.cjs');
const ROOT = path.resolve(__dirname, '..');
const MODULES = ['04_EXTRACAO_DOCUMENTAL_WMGJ', '35_AURORA_FIRESTORE_BRIDGE_WMGJ', '38_AURORA_HML_SYNTHETIC_PROBE'];
const PROJECT = 'wmgj-hml-jfn-20260927';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/\r\n/g, '\n');
const fail = code => { throw new Error(code); };
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);

function command(executable, args, cwd, runner = cp.spawnSync) {
  const result = runner(executable, args, {cwd, encoding: 'utf8', timeout: 400000, maxBuffer: 12000000,
    env: {...process.env, DEBUG: '', NODE_DEBUG: ''}});
  if (result.error || result.status !== 0) fail('PROBE_COORDINATOR_COMMAND_FAILED');
  return result.stdout;
}

function selectDeployment(rows, sourceSha) {
  if (!Array.isArray(rows)) fail('PROBE_PUBLISHED_VERSION_UNAVAILABLE');
  const canonical = rows.filter(row => typeof row.description === 'string'
    && row.description.startsWith('AURORA_EXECUTION_API_CANONICAL'));
  if (canonical.length !== 1 || canonical[0].description !== 'AURORA_EXECUTION_API_CANONICAL ' + sourceSha
    || !Number.isSafeInteger(canonical[0].versionNumber) || canonical[0].versionNumber < 1
    || typeof canonical[0].deploymentId !== 'string' || !/^[A-Za-z0-9_-]{10,256}$/.test(canonical[0].deploymentId)) {
    fail('PROBE_PUBLISHED_VERSION_MISMATCH');
  }
  return canonical[0];
}

function publishedHashes(repo, remote) {
  const result = {};
  for (const module of MODULES) {
    const candidates = ['.js', '.gs'].map(extension => path.join(remote, module + extension)).filter(file => fs.existsSync(file));
    if (candidates.length !== 1 || !fs.lstatSync(candidates[0]).isFile() || fs.lstatSync(candidates[0]).isSymbolicLink()) fail('PROBE_PUBLISHED_SOURCE_MISSING');
    const local = fs.readFileSync(path.join(repo, 'src', module + '.gs'), 'utf8');
    const deployed = fs.readFileSync(candidates[0], 'utf8');
    if (normalize(local) !== normalize(deployed)) fail('PROBE_PUBLISHED_SOURCE_MISMATCH');
    result[module] = sha(normalize(deployed));
  }
  const localManifest = JSON.parse(fs.readFileSync(path.join(repo, 'appsscript.json'), 'utf8'));
  const remoteManifest = JSON.parse(fs.readFileSync(path.join(remote, 'appsscript.json'), 'utf8'));
  if (stable(localManifest) !== stable(remoteManifest)) fail('PROBE_PUBLISHED_MANIFEST_MISMATCH');
  result.manifest = sha(stable(remoteManifest));
  return result;
}

function expectedRuntimeHashes(repo) {
  const context = vm.createContext({Utilities: {
    DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
    computeDigest: (_, value) => [...crypto.createHash('sha256').update(String(value)).digest()]
  }});
  for (const name of MODULES) vm.runInContext(fs.readFileSync(path.join(repo, 'src', name + '.gs'), 'utf8'), context, {timeout: 2000});
  return JSON.parse(JSON.stringify(context.auroraHmlSyntheticRuntimeHashes_()));
}

function sanitizeSummary(envelope, expected) {
  const raw = envelope?.response;
  // Drop the explicitly private plan before validating or exporting the public DTO.
  const value = raw && Object.fromEntries(Object.entries(raw).filter(([key])=>key !== 'canonicalReadbackPlan'));
  const keys = ['schemaVersion','status','code','scope','callerAuthorized','runtimeFunctionHashes','formats','createdFileCount',
    'cleanupVerified','cleanupRemainingCount','unresolvedCreationCount','folderSha256','registryChanged','triggersChanged','globalQueuesTouched',
    'canonicalReadbackPerformed','runtimeProcessingVerified','customerOAuthEnrollmentVerified','globalIngestionVerified',
    'installationComplete','complete','ocrTemporaryCleanup'];
  if (envelope?.error || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== keys.sort().join(',')
    || value.schemaVersion !== 'aurora.hml.synthetic-cloud-probe.v1' || !['PASS','FAIL'].includes(value.status)
    || value.scope !== 'ISOLATED_SYNTHETIC_FORMATS_ONLY'
    || value.ocrTemporaryCleanup !== 'EXISTING_EXTRACTOR_CREATED_ID_ONLY') fail('PROBE_SUMMARY_REJECTED');
  const codes = ['PROBE_GUARD_REJECTED','PROBE_CALLER_NOT_AUTHORIZED','PROBE_REQUEST_REJECTED','PROBE_RUNTIME_SOURCE_MISMATCH',
    'PROBE_HML_CONFIG_REJECTED','PROBE_FILE_SCOPE_REJECTED','PROBE_EXTRACTION_PENDING','PROBE_EVENT_REJECTED',
    'PROBE_CANONICAL_WRITE_UNCONFIRMED','PROBE_REPLAY_UNCONFIRMED','PROBE_DEPENDENCY_FAILED','PROBE_FORMATS_VERIFIED',
    'PROBE_FORMATS_PENDING','PROBE_CLEANUP_PENDING','PROBE_WINDOW_EXPIRED'];
  const forbiddenProofs = ['registryChanged','triggersChanged','globalQueuesTouched','canonicalReadbackPerformed',
    'runtimeProcessingVerified','customerOAuthEnrollmentVerified','globalIngestionVerified','installationComplete','complete'];
  if (!codes.includes(value.code) || forbiddenProofs.some(key => value[key] !== false)
    || typeof value.callerAuthorized !== 'boolean' || typeof value.cleanupVerified !== 'boolean'
    || !Number.isSafeInteger(value.createdFileCount) || value.createdFileCount < 0 || value.createdFileCount > 4
    || !Number.isSafeInteger(value.cleanupRemainingCount) || value.cleanupRemainingCount < 0 || value.cleanupRemainingCount > 5
    || !Number.isSafeInteger(value.unresolvedCreationCount) || value.unresolvedCreationCount < 0 || value.unresolvedCreationCount > 4
    || (value.cleanupVerified && (value.unresolvedCreationCount !== 0 || value.cleanupRemainingCount !== 0))
    || (value.folderSha256 !== null && !/^[a-f0-9]{64}$/.test(value.folderSha256))) fail('PROBE_SUMMARY_REJECTED');
  const runtime = value.runtimeFunctionHashes;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)
    || (Object.keys(runtime).length && stable(runtime) !== stable(expected))) fail('PROBE_RUNTIME_SOURCE_MISMATCH');
  if (!Array.isArray(value.formats) || value.formats.length > 4) fail('PROBE_SUMMARY_REJECTED');
  const formatKeys = ['format','status','code','method','extractionVerified','extractedContentSha256','eventSha256',
    'canonicalCommitAcknowledged','replayVerified','receiptSha256'];
  const methods = {DOC:'google_docs_text',SHEETS:'google_sheets_values',TEXT:'blob_text',PDF:'drive_api_ocr_convert'};
  const seen = new Set();
  for (const row of value.formats) {
    if (!row || Object.keys(row).sort().join(',') !== formatKeys.sort().join(',') || !Object.hasOwn(methods, row.format)
      || seen.has(row.format) || !['PASS','FAIL'].includes(row.status)
      || (!codes.includes(row.code) && !['PROBE_FORMAT_PENDING','PROBE_FORMAT_VERIFIED'].includes(row.code))
      || (row.method !== null && row.method !== methods[row.format])
      || ['extractionVerified','canonicalCommitAcknowledged','replayVerified'].some(key => typeof row[key] !== 'boolean')
      || ['extractedContentSha256','eventSha256','receiptSha256'].some(key => row[key] !== null && !/^[a-f0-9]{64}$/.test(row[key]))) fail('PROBE_SUMMARY_REJECTED');
    seen.add(row.format);
    if (row.status === 'PASS' && (row.code !== 'PROBE_FORMAT_VERIFIED' || row.method !== methods[row.format]
      || !row.extractionVerified || !row.canonicalCommitAcknowledged || !row.replayVerified
      || !row.extractedContentSha256 || !row.eventSha256 || !row.receiptSha256)) fail('PROBE_SUMMARY_REJECTED');
  }
  if (value.status === 'PASS' && (value.code !== 'PROBE_FORMATS_VERIFIED' || !value.callerAuthorized
    || stable(runtime) !== stable(expected) || !value.cleanupVerified || value.cleanupRemainingCount !== 0
    || value.createdFileCount !== 4 || !value.folderSha256 || seen.size !== 4
    || value.formats.some(row => row.status !== 'PASS'))) fail('PROBE_SUMMARY_REJECTED');
  return JSON.parse(JSON.stringify(value));
}

async function run({repo = ROOT, temporary, sourceSha, run = command, now = Date.now, readback=canonicalReadback.readback,
  nonceFactory=()=>crypto.randomBytes(16).toString('hex')}) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !temporary || !path.isAbsolute(temporary)) fail('PROBE_COORDINATOR_INPUT_REJECTED');
  const head = run('git', ['rev-parse','HEAD'], repo).trim();
  // auth@v2 creates its ephemeral ADC file at the checkout root. Do not read it or
  // mistake it for source; all tracked changes and all relevant untracked source fail.
  if (head !== sourceSha || run('git',['diff','--name-only','HEAD','--'],repo).trim()
    || run('git', ['status','--porcelain','--untracked-files=all','--','src','tools','.github/workflows',
      'appsscript.json','firebase-migration/policy/hml-owner-release-approval-v1.json'], repo).trim()) fail('PROBE_CHECKOUT_NOT_CLEAN_EXACT_SOURCE');
  const policy = JSON.parse(fs.readFileSync(path.join(repo, 'firebase-migration/policy/hml-owner-release-approval-v1.json'), 'utf8'));
  const deadline = Date.parse(policy.scope?.validUntilUtc);
  if (policy.scope?.projectId !== PROJECT || policy.scope?.environment !== 'firebase-homologation'
    || policy.scope?.branch !== 'main' || policy.integrationAndHmlPublicationAuthorized !== true || !Number.isFinite(deadline)
    || now() >= deadline || process.env.GITHUB_REF !== 'refs/heads/main'
    || process.env.GITHUB_SHA !== sourceSha) fail('PROBE_HML_AUTHORIZATION_REJECTED');
  // Freeze the lease before the first provider request, not after version reads.
  const window = {expiresAt:new Date(Math.min(now()+600000,deadline)).toISOString(),deadline,now};
  const gate = () => canonicalReadback.assertWindow(window);
  gate();
  const workflow = fs.readFileSync(path.join(repo, '.github/workflows/deploy-appscript.yml'), 'utf8');
  const scriptId = workflow.match(/^\s+APPS_SCRIPT_ID:\s*([A-Za-z0-9_-]+)\s*$/m)?.[1];
  if (!scriptId) fail('PROBE_EXISTING_SCRIPT_BINDING_UNAVAILABLE');
  const workspace = fs.mkdtempSync(path.join(temporary, 'aurora-hml-probe-'));
  fs.chmodSync(workspace, 0o700);
  const projectFile = directory => fs.writeFileSync(path.join(directory, '.clasp.json'), JSON.stringify({scriptId, rootDir:'.'}), {mode:0o600,flag:'wx'});
  projectFile(workspace);
  const readVersion = () => {
    gate();
    const deployment = selectDeployment(JSON.parse(run('clasp', ['deployments','--json'], workspace)), sourceSha);
    gate();
    const directory = fs.mkdtempSync(path.join(workspace, 'published-')); projectFile(directory);
    gate();
    run('clasp', ['pull','--versionNumber',String(deployment.versionNumber),'--json'], directory);
    gate();
    return {deployment, hashes: publishedHashes(repo, directory)};
  };
  const before = readVersion();
  const runtimeHashes = expectedRuntimeHashes(repo);
  const request = {confirmation:'RUN_ISOLATED_SYNTHETIC_HML_PROBE', projectId:PROJECT, orgId:'wmgj', sourceSha,
    runNonce:nonceFactory(), expiresAt:window.expiresAt, runtimeFunctionHashes:runtimeHashes};
  const output = path.join(workspace, 'execution.json');
  // Existing checked runner captures OAuth/API errors without printing raw responses.
  gate();
  run('bash', [path.join(repo,'tools/run-clasp-checked.sh'),'auroraExecutarProbeNuvemSinteticaHml',output,JSON.stringify([request])], workspace);
  gate();
  const envelope = JSON.parse(fs.readFileSync(output,'utf8'));
  const summary = sanitizeSummary(envelope, runtimeHashes);
  let materialization = {scope:'EXACT_CREATED_SYNTHETIC_DOCUMENTS_ONLY',documentsRead:0,formats:[],
    canonicalMaterializationVerified:false,processingOrInstallationAcceptanceVerified:false};
  if (summary.status === 'PASS') {
    gate();
    const accessToken = run('gcloud',['auth','print-access-token'],repo).trim();
    gate();
    materialization = await readback(envelope.response.canonicalReadbackPlan,request.runNonce,accessToken,undefined,window);
    gate();
  }
  const after = readVersion();
  const stableDeployment = stable(before) === stable(after);
  const evidence = {schemaVersion:'aurora.hml.synthetic-cloud-probe-evidence.v1',
    status:summary.status === 'PASS' && materialization.canonicalMaterializationVerified ? 'PASS' : 'FAIL',checkedSourceSha:sourceSha,
    projectId:PROJECT, publishedVersionNumber:before.deployment.versionNumber,
    checkedSourceShaScope:'APPS_SCRIPT_VERSION_AND_RUNNER_SOURCE',backendRuntimeSourceShaVerified:false,
    deploymentIdentitySha256:sha(before.deployment.deploymentId), publishedNormalizedSourceHashes:before.hashes,
    publishedVersionReadBeforeAndAfter:true, publishedVersionStable:stableDeployment,
    runtimeFunctionHashesVerified:stable(summary.runtimeFunctionHashes) === stable(runtimeHashes),
    summary, canonicalMaterialization:materialization, complete:false};
  if (!stableDeployment) fail('PROBE_PUBLISHED_VERSION_CHANGED');
  gate();
  return evidence;
}

module.exports = {selectDeployment,publishedHashes,expectedRuntimeHashes,sanitizeSummary,run,sha};
if (require.main === module) {
  (async () => { try {
    const evidence = await run({temporary:process.env.RUNNER_TEMP,sourceSha:process.env.GITHUB_SHA});
    const output = path.join(process.env.RUNNER_TEMP,'aurora-hml-synthetic-summary.json');
    fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(JSON.stringify(evidence));
    if (evidence.summary.status !== 'PASS' || evidence.canonicalMaterialization.canonicalMaterializationVerified !== true) process.exitCode = 1;
  } catch (error) {
    const known = new Set(['PROBE_COORDINATOR_COMMAND_FAILED','PROBE_PUBLISHED_VERSION_UNAVAILABLE','PROBE_PUBLISHED_VERSION_MISMATCH',
      'PROBE_PUBLISHED_SOURCE_MISSING','PROBE_PUBLISHED_SOURCE_MISMATCH','PROBE_PUBLISHED_MANIFEST_MISMATCH','PROBE_SUMMARY_REJECTED',
      'PROBE_RUNTIME_SOURCE_MISMATCH','PROBE_COORDINATOR_INPUT_REJECTED','PROBE_CHECKOUT_NOT_CLEAN_EXACT_SOURCE',
      'PROBE_HML_AUTHORIZATION_REJECTED','PROBE_EXISTING_SCRIPT_BINDING_UNAVAILABLE','PROBE_PUBLISHED_VERSION_CHANGED','PROBE_CANONICAL_READBACK_UNCONFIRMED','PROBE_WINDOW_EXPIRED']);
    const code = known.has(error?.message) ? error.message : 'PROBE_COORDINATOR_FAILED_NO_OPERATIONAL_SUCCESS_CLAIM';
    const failure = {schemaVersion:'aurora.hml.synthetic-cloud-probe-evidence.v1',status:'FAIL',code,
      operationalResultUnconfirmed:true,complete:false};
    try { fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'aurora-hml-synthetic-summary.json'),JSON.stringify(failure)+'\n',{mode:0o600,flag:'wx'}); } catch {}
    console.error(code);
    process.exitCode = 1;
  } })();
}
