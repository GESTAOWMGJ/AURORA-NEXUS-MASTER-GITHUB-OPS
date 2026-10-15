import {execFileSync} from 'node:child_process';
import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {checkCanonicalPreflight} from './check-canonical-preflight.mjs';

const PROJECT = 'wmgj-hml-jfn-20260927';
const REGION = 'southamerica-east1';
const REPOSITORY = 'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS';
export const SERVICE = `projects/${PROJECT}/locations/${REGION}/services/auroranexusintegrationping`;
export const FUNCTION = `projects/${PROJECT}/locations/${REGION}/functions/auroraNexusIntegrationPing`;
const REVISION_TYPE = 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
const V1_HOST = `${REGION}-run.googleapis.com`;
const V1_SERVICE_PATH = `apis/serving.knative.dev/v1/namespaces/${PROJECT}/services/auroranexusintegrationping`;
const fail = code => {throw new Error(code);};
const requireCondition = (condition, code) => {if (!condition) fail(code);};

function context(env) {
  requireCondition(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPOSITORY
    && env.GITHUB_REF === 'refs/heads/main' && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
    && /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID || '')
    && /^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT || '')
    && env.PUBLISH_ACTIVE_RELEASE === 'true' && env.PROJECT_ID === PROJECT,
  'INTEGRATION_PING_PROTECTED_RELEASE_TRAFFIC_CONTEXT_REQUIRED');
  return {sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT};
}

function revisionName(value) {
  const name = value?.startsWith(`${SERVICE}/revisions/`) ? value.slice(`${SERVICE}/revisions/`.length) : value;
  requireCondition(/^auroranexusintegrationping-[a-z0-9-]+$/.test(name || ''), 'INTEGRATION_PING_REVISION_REQUIRED');
  return name;
}

function traffic(entries) {
  requireCondition(Array.isArray(entries) && entries.length > 0 && entries.length <= 100,
    'INTEGRATION_PING_PINNED_TRAFFIC_REQUIRED');
  const targets = entries.map(entry => {
    requireCondition(entry.type === REVISION_TYPE && Number.isInteger(entry.percent ?? 0)
      && (entry.percent ?? 0) >= 0 && (entry.percent ?? 0) <= 100,
    'INTEGRATION_PING_PINNED_TRAFFIC_REQUIRED');
    const target = {type: REVISION_TYPE, revision: revisionName(entry.revision), percent: entry.percent ?? 0};
    if (entry.tag) {
      requireCondition(/^[a-z][a-z0-9-]{0,62}$/.test(entry.tag), 'INTEGRATION_PING_TRAFFIC_TAG_INVALID');
      target.tag = entry.tag;
    }
    return target;
  });
  requireCondition(targets.reduce((sum, entry) => sum + entry.percent, 0) === 100,
    'INTEGRATION_PING_TRAFFIC_PERCENT_INVALID');
  return targets;
}

const sameTraffic = (a, b) => JSON.stringify(traffic(a).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))))
  === JSON.stringify(traffic(b).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));

function readyService(service) {
  requireCondition(service?.name === SERVICE && typeof service.resourceVersion === 'string' && service.resourceVersion.length > 0,
    'INTEGRATION_PING_SERVICE_IDENTITY_REQUIRED');
  requireCondition(!service.reconciling && service.terminalCondition?.type === 'Ready'
    && service.terminalCondition.state === 'CONDITION_SUCCEEDED'
    && /^[1-9][0-9]*$/.test(service.generation || '')
    && service.generation === service.observedGeneration,
  'INTEGRATION_PING_SERVICE_NOT_READY');
}

function frozenCandidate(fn, service) {
  requireCondition(fn?.name === FUNCTION && fn.state === 'ACTIVE' && fn.serviceConfig?.service === SERVICE,
    'INTEGRATION_PING_FUNCTION_IDENTITY_REQUIRED');
  const revision = revisionName(fn.serviceConfig.revision);
  requireCondition(revisionName(service.latestCreatedRevision) === revision, 'INTEGRATION_PING_CREATED_REVISION_CONFLICT');
  return revision;
}

function readyRevision(revision, name) {
  requireCondition(revision?.name === `${SERVICE}/revisions/${name}`
    && revision.conditions?.some(condition => condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED'),
  'INTEGRATION_PING_REVISION_NOT_READY');
}

function validateSnapshot(snapshot, expectedContext) {
  requireCondition(snapshot?.schemaVersion === 1 && snapshot.service === SERVICE
    && JSON.stringify(snapshot.context) === JSON.stringify(expectedContext), 'INTEGRATION_PING_SNAPSHOT_CONTEXT_CONFLICT');
  revisionName(snapshot.functionRevision);
  revisionName(snapshot.latestCreatedRevision);
  revisionName(snapshot.latestReadyRevision);
  traffic(snapshot.previousTraffic);
  requireCondition(typeof snapshot.previousResourceVersion === 'string' && snapshot.previousResourceVersion.length > 0,
    'INTEGRATION_PING_SNAPSHOT_RESOURCE_VERSION_REQUIRED');
}

/** Only the resourceVersion returned after our generation reconciles establishes rollback ownership. */
export async function rollbackIntegrationPingTraffic(env, deps, snapshot) {
  validateSnapshot(snapshot, context(env));
  if (!snapshot.promotion) return {code: 'INTEGRATION_PING_NO_OWNED_PROMOTION'};
  const promotion = snapshot.promotion;
  requireCondition(typeof promotion.resourceVersion === 'string' && promotion.resourceVersion.length > 0
    && /^[1-9][0-9]*$/.test(promotion.generation || '')
    && sameTraffic(promotion.traffic, [{type: REVISION_TYPE, revision: snapshot.functionRevision, percent: 100}]),
  'INTEGRATION_PING_PROMOTION_SNAPSHOT_INVALID');
  const current = await deps.readService();
  if (current?.name !== SERVICE || current.resourceVersion !== promotion.resourceVersion
    || current.generation !== promotion.generation
    || revisionName(current.latestCreatedRevision) !== snapshot.functionRevision
    || !sameTraffic(current.traffic, promotion.traffic)) return {code: 'INTEGRATION_PING_ROLLBACK_CONCURRENT_CHANGE'};
  // Check all previous revision targets before the rollback CAS. Preserve template, IAM and env.
  for (const target of snapshot.previousTraffic) readyRevision(await deps.readRevision(target.revision), target.revision);
  await deps.updateTraffic({name: SERVICE, resourceVersion: promotion.resourceVersion, traffic: snapshot.previousTraffic});
  const restored = await deps.readService();
  readyService(restored);
  requireCondition(sameTraffic(restored.traffic, snapshot.previousTraffic)
    && sameTraffic(restored.trafficStatuses, snapshot.previousTraffic), 'INTEGRATION_PING_ROLLBACK_NOT_VERIFIED');
  return {code: 'INTEGRATION_PING_TRAFFIC_ROLLBACK_VERIFIED'};
}

/** Synthetic adapters exercise the real decision path without contacting or mutating cloud resources. */
export async function promoteIntegrationPingTraffic(env, deps) {
  const expectedContext = context(env);
  const route = await deps.preflight(PROJECT, {scope: 'full'});
  requireCondition(route?.origin === 'https://auroranexus.com.br' && route.expectedProject === PROJECT
    && route.dnsResolved === true && route.httpsVerified === true && route.portalShellVerified === true
    && route.anonymousDenied === true && route.firebaseProjectMatched === true, 'INTEGRATION_PING_FULL_CANONICAL_PREFLIGHT_REQUIRED');
  const fn = await deps.readFunction(), service = await deps.readService();
  readyService(service);
  const target = frozenCandidate(fn, service);
  readyRevision(await deps.readRevision(target), target);
  const desired = [{type: REVISION_TYPE, revision: target, percent: 100}];
  const snapshot = {schemaVersion: 1, context: expectedContext, service: SERVICE,
    functionRevision: target, latestCreatedRevision: revisionName(service.latestCreatedRevision),
    latestReadyRevision: revisionName(service.latestReadyRevision), previousResourceVersion: service.resourceVersion,
    previousTraffic: traffic(service.traffic)};
  // Require a stable, observed rollback baseline. Never resolve a floating LATEST target during rollback.
  requireCondition(sameTraffic(service.trafficStatuses, snapshot.previousTraffic), 'INTEGRATION_PING_PREVIOUS_TRAFFIC_NOT_OBSERVED');
  await deps.saveSnapshot(snapshot);
  const currentFunction = await deps.readFunction(), current = await deps.readService();
  readyService(current);
  requireCondition(frozenCandidate(currentFunction, current) === target && current.resourceVersion === service.resourceVersion,
    'INTEGRATION_PING_PROMOTION_CONCURRENT_CHANGE');
  if (sameTraffic(current.traffic, desired)) {
    requireCondition(revisionName(current.latestReadyRevision) === target, 'INTEGRATION_PING_READY_REVISION_CONFLICT');
    return {code: 'INTEGRATION_PING_EXACT_TRAFFIC_ALREADY_VERIFIED', revision: target};
  }
  try {
    const applied = await deps.updateTraffic({name: SERVICE, resourceVersion: current.resourceVersion, traffic: desired});
    requireCondition(applied?.name === SERVICE && typeof applied.resourceVersion === 'string' && applied.resourceVersion.length > 0
      && applied.resourceVersion !== current.resourceVersion && /^[1-9][0-9]*$/.test(applied.generation || '')
      && applied.generation !== current.generation
      && revisionName(applied.latestCreatedRevision) === target && sameTraffic(applied.traffic, desired),
    'INTEGRATION_PING_UPDATE_OWNERSHIP_NOT_VERIFIED');
    snapshot.promotion = {resourceVersion: applied.resourceVersion, generation: applied.generation, traffic: desired};
    await deps.saveSnapshot(snapshot);
    const observed = await deps.readService();
    readyService(observed);
    requireCondition(observed.resourceVersion === applied.resourceVersion && observed.generation === applied.generation
      && revisionName(observed.latestCreatedRevision) === target && revisionName(observed.latestReadyRevision) === target
      && sameTraffic(observed.traffic, desired) && sameTraffic(observed.trafficStatuses, desired),
    'INTEGRATION_PING_PROMOTION_READBACK_CONFLICT');
    readyRevision(await deps.readRevision(target), target);
    return {code: 'INTEGRATION_PING_EXACT_TRAFFIC_PROMOTED', revision: target};
  } catch (error) {
    if (snapshot.promotion) await rollbackIntegrationPingTraffic(env, deps, snapshot);
    throw error;
  }
}

function normalizeV1Service(service) {
  requireCondition(service?.apiVersion === 'serving.knative.dev/v1' && service.kind === 'Service'
    && service.metadata?.name === 'auroranexusintegrationping'
    && [PROJECT, '299889357292'].includes(service.metadata.namespace), 'INTEGRATION_PING_SERVICE_IDENTITY_REQUIRED');
  const observed = service.status?.traffic || [];
  const targets = entries => (entries || []).map(entry => {
    requireCondition(!entry.configurationName, 'INTEGRATION_PING_PINNED_TRAFFIC_REQUIRED');
    // A default LATEST route is accepted only when the reconciled 100% route
    // actually observes the exact ready created revision. Snapshots freeze that
    // observed revision; rollback never follows a future floating LATEST.
    if (entry.latestRevision) {
      const latest = revisionName(service.status?.latestCreatedRevisionName);
      requireCondition(entries.length === 1 && entry.percent === 100 && !entry.tag
        && (!entry.revisionName || revisionName(entry.revisionName) === latest)
        && revisionName(service.status?.latestReadyRevisionName) === latest
        && String(service.metadata.generation) === String(service.status?.observedGeneration)
        && service.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')
        && observed.length === 1 && observed[0].percent === 100 && !observed[0].tag
        && revisionName(observed[0].revisionName) === latest, 'INTEGRATION_PING_PINNED_TRAFFIC_REQUIRED');
      return {type: REVISION_TYPE, revision: latest, percent: 100};
    }
    return {type: REVISION_TYPE, revision: revisionName(entry.revisionName), percent: entry.percent ?? 0,
      ...(entry.tag ? {tag: entry.tag} : {})};
  });
  const ready = service.status?.conditions?.find(condition => condition.type === 'Ready');
  return {name: SERVICE, resourceVersion: service.metadata.resourceVersion,
    generation: String(service.metadata.generation ?? ''), observedGeneration: String(service.status?.observedGeneration ?? ''),
    terminalCondition: {type: 'Ready', state: ready?.status === 'True' ? 'CONDITION_SUCCEEDED' : 'CONDITION_RECONCILING'},
    latestCreatedRevision: service.status?.latestCreatedRevisionName, latestReadyRevision: service.status?.latestReadyRevisionName,
    traffic: targets(service.spec?.traffic), trafficStatuses: targets(service.status?.traffic)};
}

export function createCloudAdapters(env, {accessToken, fetchImpl = fetch,
  sleep = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))} = {}) {
  // gcloud stdout remains in memory. Raw API bodies, token, env, template and logs are never persisted.
  let token = accessToken;
  if (!token) {
    try {token = execFileSync('gcloud', ['auth', 'print-access-token'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();}
    catch {fail('INTEGRATION_PING_CLOUD_AUTH_FAILED');}
  }
  const request = async (host, path, method = 'GET', body) => {
    let response;
    try {
      response = await fetchImpl(`https://${host}/${path}`, {method, redirect: 'error',
        signal: AbortSignal.timeout(30_000), headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        ...(body ? {body: JSON.stringify(body)} : {})});
    } catch {fail('INTEGRATION_PING_CLOUD_REQUEST_FAILED');}
    if (!response.ok) fail(`INTEGRATION_PING_CLOUD_HTTP_${response.status}`);
    try {return await response.json();} catch {fail('INTEGRATION_PING_CLOUD_RESPONSE_INVALID');}
  };
  const readV1 = () => request(V1_HOST, V1_SERVICE_PATH);
  const path = resolve(env.RUNNER_TEMP, 'aurora-integration-ping-traffic.json');
  return {
    preflight: checkCanonicalPreflight,
    readFunction: () => request('cloudfunctions.googleapis.com', `v2/${FUNCTION}`),
    readService: async () => normalizeV1Service(await readV1()),
    readRevision: name => request('run.googleapis.com', `v2/${SERVICE}/revisions/${revisionName(name)}`),
    saveSnapshot: async snapshot => {
      await writeFile(`${path}.tmp`, JSON.stringify(snapshot), {mode: 0o600});
      await rename(`${path}.tmp`, path);
    },
    updateTraffic: async body => {
      // The official update-traffic CLI uses v1 ReplaceService. v2 PATCH can try to recreate
      // Functions' fixed template.revision and fail ALREADY_EXISTS, even with updateMask=traffic.
      // Keep the entire existing spec/template and metadata in memory; change only spec.traffic.
      const before = await readV1(), baseline = normalizeV1Service(before);
      requireCondition(body.name === SERVICE && baseline.resourceVersion === body.resourceVersion,
        'INTEGRATION_PING_UPDATE_CONCURRENT_CHANGE');
      const replacement = {apiVersion: before.apiVersion, kind: before.kind,
        metadata: structuredClone(before.metadata), spec: structuredClone(before.spec)};
      replacement.spec.traffic = traffic(body.traffic).map(target => ({revisionName: target.revision,
        percent: target.percent, ...(target.tag ? {tag: target.tag} : {})}));
      // metadata.resourceVersion is the API-enforced CAS; do not retry conflicts with a fresh version.
      let raw = await request(V1_HOST, V1_SERVICE_PATH, 'PUT', replacement);
      let applied = normalizeV1Service(raw);
      const ownGeneration = applied.generation;
      requireCondition(/^[1-9][0-9]*$/.test(ownGeneration) && ownGeneration !== baseline.generation,
        'INTEGRATION_PING_UPDATE_OWNERSHIP_NOT_VERIFIED');
      for (let attempt = 0; attempt < 90; attempt++) {
        requireCondition(applied.generation === ownGeneration && sameTraffic(applied.traffic, body.traffic)
          && isDeepStrictEqual(raw.spec.template, before.spec.template), 'INTEGRATION_PING_UPDATE_CONCURRENT_CHANGE');
        if (applied.generation === applied.observedGeneration
          && raw.status?.conditions?.some(condition => condition.type === 'Ready' && ['True', 'False'].includes(condition.status))) {
          return applied;
        }
        await sleep(2_000);
        raw = await readV1();
        applied = normalizeV1Service(raw);
      }
      fail('INTEGRATION_PING_TRAFFIC_OPERATION_FAILED');
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = process.env;
    context(env);
    requireCondition(env.RUNNER_TEMP && env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'INTEGRATION_PING_RUNNER_CONFIGURATION_REQUIRED');
    const mode = process.argv[2];
    requireCondition(['promote', 'rollback'].includes(mode), 'INTEGRATION_PING_TRAFFIC_MODE_REQUIRED');
    let snapshot;
    if (mode === 'rollback') {
      try {snapshot = JSON.parse(await readFile(resolve(env.RUNNER_TEMP, 'aurora-integration-ping-traffic.json'), 'utf8'));}
      catch (error) {if (error.code !== 'ENOENT') fail('INTEGRATION_PING_SNAPSHOT_READ_FAILED');}
    }
    const result = mode === 'promote' ? await promoteIntegrationPingTraffic(env, createCloudAdapters(env))
      : snapshot ? await rollbackIntegrationPingTraffic(env, createCloudAdapters(env), snapshot) : {code: 'INTEGRATION_PING_NO_PROMOTION_SNAPSHOT'};
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message || '') ? error.message : 'INTEGRATION_PING_TRAFFIC_FAILED');
    process.exitCode = 1;
  }
}
