import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PROJECT = 'wmgj-hml-jfn-20260927';
const REGION = 'southamerica-east1';
const NAME = 'ingestWmgjEvent';
const SERVICE = 'ingestwmgjevent';
const ACCOUNT = '299889357292-compute@developer.gserviceaccount.com';
const SECRET = 'WMGJ_INGEST_HMAC_KEYRING';
const requireThat = (condition, code) => {if (!condition) throw new Error(code);};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revision = value => {
  requireThat(/^ingestwmgjevent-[a-z0-9-]{1,80}$/.test(value || ''), 'HML_INGEST_REVISION_INVALID');
  return value;
};

function functionMetadata(fn) {
  requireThat(fn?.name === `projects/${PROJECT}/locations/${REGION}/functions/${NAME}`
    && fn.state === 'ACTIVE' && fn.buildConfig?.entryPoint === NAME && fn.buildConfig.runtime === 'nodejs22',
  'HML_INGEST_FUNCTION_IDENTITY_CONFLICT');
  const config = fn.serviceConfig;
  requireThat(config?.service === `projects/${PROJECT}/locations/${REGION}/services/${SERVICE}`
    && config.serviceAccountEmail === ACCOUNT && config.ingressSettings === 'ALLOW_ALL',
  'HML_INGEST_RUNTIME_BOUNDARY_CONFLICT');
  const secrets = config.secretEnvironmentVariables;
  requireThat(Array.isArray(secrets) && secrets.length === 1 && secrets[0].key === SECRET
    && secrets[0].secret === SECRET && secrets[0].projectId === PROJECT
    && String(secrets[0].version) === '3', 'HML_INGEST_EXISTING_SECRET_BINDING_REQUIRED');
  const source = fn.buildConfig.source?.storageSource;
  requireThat(source?.bucket === 'gcf-v2-sources-299889357292-southamerica-east1'
    && source.object === 'ingestWmgjEvent/function-source.zip' && /^[1-9][0-9]{0,25}$/.test(String(source.generation || ''))
    && /^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/builds\/[a-f0-9-]{36}$/.test(fn.buildConfig.build || '')
    && Number.isFinite(Date.parse(fn.updateTime)), 'HML_INGEST_BUILD_METADATA_REQUIRED');
  return {name: NAME, state: 'ACTIVE', runtime: 'nodejs22', serviceAccount: ACCOUNT,
    ingress: 'ALLOW_ALL', secretName: SECRET, secretVersion: '3', revision: revision(config.revision),
    updateTime: fn.updateTime, build: fn.buildConfig.build,
    source: {bucket: source.bucket, object: source.object, generation: String(source.generation)}};
}

function serviceMetadata(service, expectedRevision) {
  const state = service?.status;
  const annotations = service?.metadata?.annotations || {};
  requireThat(service?.metadata?.name === SERVICE
    && /^[1-9][0-9]*$/.test(String(service.metadata.generation || ''))
    && String(service.metadata.generation) === String(state?.observedGeneration)
    && annotations['run.googleapis.com/ingress'] === 'all'
    && annotations['run.googleapis.com/ingress-status'] === 'all'
    && [undefined, 'false', false].includes(annotations['run.googleapis.com/invoker-iam-disabled'])
    && state?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')
    && state.latestCreatedRevisionName === expectedRevision && state.latestReadyRevisionName === expectedRevision,
  'HML_INGEST_RUN_SERVICE_NOT_READY');
  const route = entries => Array.isArray(entries) && entries.length === 1 && entries[0].percent === 100
    && !entries[0].tag && !entries[0].configurationName
    && (entries[0].revisionName === expectedRevision || (!entries[0].revisionName && entries[0].latestRevision === true));
  requireThat(route(service.spec?.traffic) && route(state.traffic)
    && state.traffic[0].revisionName === expectedRevision, 'HML_INGEST_ACTUAL_TRAFFIC_CONFLICT');
  return {ready: true, revision: expectedRevision, routedPercent: 100};
}

function iamMetadata(policy) {
  requireThat(Array.isArray(policy?.bindings) && policy.bindings.length > 0 && policy.bindings.length <= 100,
    'HML_INGEST_IAM_READ_REQUIRED');
  const normalized = policy.bindings.map(binding => {
    requireThat(typeof binding.role === 'string' && Array.isArray(binding.members)
      && binding.members.every(member => typeof member === 'string')
      && (!binding.condition || typeof binding.condition.expression === 'string'), 'HML_INGEST_IAM_READ_REQUIRED');
    return {role: binding.role, members: [...binding.members].sort(),
      condition: binding.condition ? {title: binding.condition.title || '', description: binding.condition.description || '',
        expression: binding.condition.expression} : null};
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  requireThat(normalized.some(binding => binding.role === 'roles/run.invoker'
    && binding.members.includes('allUsers') && binding.condition === null), 'HML_INGEST_EXISTING_PUBLIC_INVOKER_REQUIRED');
  return {unconditionalPublicInvoker: true, bindingSha256: hash(normalized)};
}

export function normalizeIngestMetadata(fn, service, policy) {
  const metadata = functionMetadata(fn);
  return {function: metadata, route: serviceMetadata(service, metadata.revision), iam: iamMetadata(policy)};
}

export function verifyIngestDeployment(before, after, context) {
  requireThat(/^[a-f0-9]{40}$/.test(context?.sourceSha || '') && Number.isFinite(Date.parse(context.startedAt)),
    'HML_INGEST_DEPLOY_CONTEXT_REQUIRED');
  requireThat(after?.function && before?.function && after.iam?.bindingSha256 === before.iam?.bindingSha256,
    'HML_INGEST_IAM_CHANGED');
  requireThat(Date.parse(after.function.updateTime) >= Date.parse(context.startedAt)
    && Date.parse(after.function.updateTime) > Date.parse(before.function.updateTime)
    && after.function.build !== before.function.build
    && after.function.source.generation !== before.function.source.generation
    && after.function.revision !== before.function.revision,
  'HML_INGEST_DEPLOY_NOT_OBSERVED');
  return {schemaVersion: 1, code: 'HML_INGEST_RUNTIME_METADATA_VERIFIED', requestedSourceSha: context.sourceSha,
    metadata: after, backendRuntimeSourceShaVerified: false, requestProcessingVerified: false,
    limitation: 'PROVIDER_BUILD_SOURCE_AND_ROUTE_METADATA_ONLY_NOT_RUNTIME_BYTE_OR_INGESTION_PROOF'};
}

const publicCodes = new Set(['HML_INGEST_REVISION_INVALID', 'HML_INGEST_FUNCTION_IDENTITY_CONFLICT',
  'HML_INGEST_RUNTIME_BOUNDARY_CONFLICT', 'HML_INGEST_EXISTING_SECRET_BINDING_REQUIRED',
  'HML_INGEST_BUILD_METADATA_REQUIRED', 'HML_INGEST_RUN_SERVICE_NOT_READY', 'HML_INGEST_ACTUAL_TRAFFIC_CONFLICT',
  'HML_INGEST_IAM_READ_REQUIRED', 'HML_INGEST_EXISTING_PUBLIC_INVOKER_REQUIRED', 'HML_INGEST_DEPLOY_CONTEXT_REQUIRED',
  'HML_INGEST_IAM_CHANGED', 'HML_INGEST_DEPLOY_NOT_OBSERVED', 'HML_INGEST_PROTECTED_CONTEXT_REQUIRED',
  'HML_INGEST_METADATA_READ_FAILED', 'HML_INGEST_METADATA_INVALID', 'HML_INGEST_BASELINE_CONTEXT_CONFLICT',
  'HML_INGEST_RUNTIME_METADATA_VERIFIED', 'HML_INGEST_BASELINE_RETAINED']);

export function runIngestMetadataCheck(mode, env, {readJson, readFile = readFileSync,
  save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600}),
  now = () => new Date().toISOString()} = {}) {
  requireThat(['before', 'after'].includes(mode) && env.GITHUB_ACTIONS === 'true'
    && env.GITHUB_REPOSITORY === 'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS'
    && env.GITHUB_REF === 'refs/heads/main' && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
    && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID || '') && /^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT || '')
    && env.PROJECT_ID === PROJECT && env.RUNNER_TEMP && env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  'HML_INGEST_PROTECTED_CONTEXT_REQUIRED');
  const context = {sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT};
  const baselinePath = resolve(env.RUNNER_TEMP, 'aurora-ingest-runtime-before.json');
  let baseline;
  if (mode === 'after') {
    try {baseline = JSON.parse(readFile(baselinePath, 'utf8'));} catch {throw new Error('HML_INGEST_BASELINE_CONTEXT_CONFLICT');}
    requireThat(JSON.stringify(baseline.context) === JSON.stringify(context), 'HML_INGEST_BASELINE_CONTEXT_CONFLICT');
  }
  // Explicit metadata projections exclude environmentVariables and secret values.
  const fn = readJson(['functions', 'describe', NAME, '--gen2', '--project', PROJECT, '--region', REGION,
    '--format=json(name,state,updateTime,buildConfig.entryPoint,buildConfig.runtime,buildConfig.build,buildConfig.source.storageSource,serviceConfig.service,serviceConfig.revision,serviceConfig.serviceAccountEmail,serviceConfig.ingressSettings,serviceConfig.secretEnvironmentVariables)']);
  const service = readJson(['run', 'services', 'describe', SERVICE, '--project', PROJECT, '--region', REGION,
    '--format=json(metadata.name,metadata.generation,metadata.annotations,spec.traffic,status.observedGeneration,status.conditions,status.latestCreatedRevisionName,status.latestReadyRevisionName,status.traffic)']);
  const policy = readJson(['run', 'services', 'get-iam-policy', SERVICE, '--project', PROJECT, '--region', REGION, '--format=json(bindings)']);
  const metadata = normalizeIngestMetadata(fn, service, policy);
  const result = mode === 'before'
    ? {schemaVersion: 1, code: 'HML_INGEST_BASELINE_RETAINED', context, capturedAt: now(), metadata}
    : verifyIngestDeployment(baseline.metadata, metadata, {...context, startedAt: baseline.capturedAt});
  save(mode === 'before' ? baselinePath : resolve(env.RUNNER_TEMP, 'aurora-ingest-runtime-after.json'), result);
  return {code: result.code};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runIngestMetadataCheck(process.argv[2], process.env, {readJson: args => {
      let output;
      try {output = execFileSync('gcloud', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, maxBuffer: 256 * 1024});}
      catch {throw new Error('HML_INGEST_METADATA_READ_FAILED');}
      try {return JSON.parse(output);} catch {throw new Error('HML_INGEST_METADATA_INVALID');}
    }});
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(publicCodes.has(error?.message) ? error.message : 'HML_INGEST_METADATA_CHECK_FAILED');
    process.exitCode = 1;
  }
}
