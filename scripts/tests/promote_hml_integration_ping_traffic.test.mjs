import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {promoteIntegrationPingTraffic, rollbackIntegrationPingTraffic, createCloudAdapters, SERVICE, FUNCTION}
  from '../../firebase-migration/scripts/promote-hml-integration-ping-traffic.mjs';

const OLD = 'auroranexusintegrationping-00032-q', TARGET = 'auroranexusintegrationping-00034-m2';
const allocation = revision => [{type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: 100}];
const env = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
  PUBLISH_ACTIVE_RELEASE: 'true', PROJECT_ID: 'wmgj-hml-jfn-20260927'};
const clone = value => structuredClone(value);

function fixture(options = {}) {
  const calls = [], patches = [], snapshots = [];
  let service = {name: SERVICE, resourceVersion: 'before', generation: '25', observedGeneration: '25',
    terminalCondition: {type: 'Ready', state: 'CONDITION_SUCCEEDED'},
    latestCreatedRevision: `${SERVICE}/revisions/${TARGET}`, latestReadyRevision: `${SERVICE}/revisions/${OLD}`,
    traffic: allocation(OLD), trafficStatuses: allocation(OLD),
    template: {containers: [{env: [{name: 'SECRET', value: 'NEVER_PERSIST'}]}]}};
  let functionReads = 0, serviceReads = 0;
  const deps = {
    preflight: async (project, scope) => {
      calls.push('full-preflight');
      assert.equal(project, env.PROJECT_ID);
      assert.deepEqual(scope, {scope: 'full'});
      if (options.preflightError) throw new Error('CANONICAL_PORTAL_HTTP_INVALID');
      return {origin: 'https://auroranexus.com.br', expectedProject: project, dnsResolved: true,
        httpsVerified: true, portalShellVerified: true, anonymousDenied: !options.routingOnly, firebaseProjectMatched: true};
    },
    readFunction: async () => {
      calls.push('function');
      return {name: FUNCTION, state: 'ACTIVE', serviceConfig: {service: SERVICE,
        revision: options.functionRace && functionReads++ > 0 ? OLD : TARGET}};
    },
    readService: async () => {
      calls.push('service'); serviceReads++;
      const result = clone(service);
      if (options.versionRace && serviceReads === 2) result.resourceVersion = 'someone-else';
      if (options.readbackMismatch && serviceReads === 3) result.trafficStatuses = allocation(OLD);
      return result;
    },
    readRevision: async name => {
      calls.push(`revision:${name}`);
      return {name: `${SERVICE}/revisions/${name}`, conditions: [{type: 'Ready',
        state: options.notReady && name === TARGET ? 'CONDITION_FAILED' : 'CONDITION_SUCCEEDED'}]};
    },
    saveSnapshot: async snapshot => {calls.push('snapshot'); snapshots.push(clone(snapshot));},
    updateTraffic: async body => {
      calls.push('patch'); patches.push(clone(body));
      assert.deepEqual(Object.keys(body).sort(), ['name', 'resourceVersion', 'traffic']);
      assert.equal(body.name, SERVICE);
      assert.equal(body.resourceVersion, service.resourceVersion);
      if (options.patchError) throw new Error('INTEGRATION_PING_CLOUD_HTTP_409');
      const generation = String(Number(service.generation) + 1);
      service = {...service, resourceVersion: `version-${generation}`, generation, observedGeneration: generation,
        traffic: clone(body.traffic), trafficStatuses: clone(body.traffic),
        latestReadyRevision: `${SERVICE}/revisions/${body.traffic[0].revision}`};
      return clone(service);
    },
  };
  return {deps, calls, patches, snapshots, service: () => service,
    change: values => {service = {...service, ...values};}};
}

test('only full canonical preflight permits a traffic write, snapshot excludes env and tokens', async () => {
  const f = fixture();
  assert.deepEqual(await promoteIntegrationPingTraffic(env, f.deps), {code: 'INTEGRATION_PING_EXACT_TRAFFIC_PROMOTED', revision: TARGET});
  assert.equal(f.calls[0], 'full-preflight');
  assert.ok(f.calls.indexOf('snapshot') < f.calls.indexOf('patch'));
  assert.deepEqual(f.patches, [{name: SERVICE, resourceVersion: 'before', traffic: allocation(TARGET)}]);
  assert.equal(f.snapshots.length, 2);
  assert.equal(JSON.stringify(f.snapshots).includes('NEVER_PERSIST'), false);
  assert.equal(JSON.stringify(f.snapshots).includes('template'), false);
  assert.equal(f.snapshots[1].promotion.resourceVersion, f.service().resourceVersion);
});

for (const options of [{preflightError: true}, {routingOnly: true}, {notReady: true}, {functionRace: true}, {versionRace: true}]) {
  test(`blocks before traffic writes: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(promoteIntegrationPingTraffic(env, f.deps));
    assert.equal(f.patches.length, 0);
  });
}

for (const overrides of [{PUBLISH_ACTIVE_RELEASE: 'false'}, {GITHUB_REF: 'refs/heads/topic'},
  {PROJECT_ID: 'wmgj-production'}, {GITHUB_RUN_ATTEMPT: ''}]) {
  test(`requires protected publishing context: ${JSON.stringify(overrides)}`, async () => {
    const f = fixture();
    await assert.rejects(promoteIntegrationPingTraffic({...env, ...overrides}, f.deps), /INTEGRATION_PING_PROTECTED_RELEASE_TRAFFIC_CONTEXT_REQUIRED/);
    assert.equal(f.calls.length, 0);
  });
}

test('failed healthy readback restores only the owned resourceVersion with the previous exact revision', async () => {
  const f = fixture({readbackMismatch: true});
  await assert.rejects(promoteIntegrationPingTraffic(env, f.deps), /INTEGRATION_PING_PROMOTION_READBACK_CONFLICT/);
  assert.deepEqual(f.patches, [{name: SERVICE, resourceVersion: 'before', traffic: allocation(TARGET)},
    {name: SERVICE, resourceVersion: 'version-26', traffic: allocation(OLD)}]);
  assert.deepEqual(f.service().trafficStatuses, allocation(OLD));
});

test('subsequent smoke failure restores owned traffic; repeating rollback cannot undo another update', async () => {
  const f = fixture();
  await promoteIntegrationPingTraffic(env, f.deps);
  const saved = f.snapshots.at(-1);
  assert.equal((await rollbackIntegrationPingTraffic(env, f.deps, saved)).code, 'INTEGRATION_PING_TRAFFIC_ROLLBACK_VERIFIED');
  assert.equal((await rollbackIntegrationPingTraffic(env, f.deps, saved)).code, 'INTEGRATION_PING_ROLLBACK_CONCURRENT_CHANGE');
  assert.equal(f.patches.length, 2);
});

for (const change of [{resourceVersion: 'other-writer'}, {generation: '99'},
  {latestCreatedRevision: `${SERVICE}/revisions/${OLD}`}, {traffic: allocation(OLD)}]) {
  test(`rollback refuses a concurrent service change: ${JSON.stringify(change)}`, async () => {
    const f = fixture();
    await promoteIntegrationPingTraffic(env, f.deps);
    f.change(change);
    assert.equal((await rollbackIntegrationPingTraffic(env, f.deps, f.snapshots.at(-1))).code, 'INTEGRATION_PING_ROLLBACK_CONCURRENT_CHANGE');
    assert.equal(f.patches.length, 1);
  });
}

test('snapshot belongs to exact SHA, run and attempt; uncertain update failure never invents rollback ownership', async () => {
  const f = fixture({patchError: true});
  await assert.rejects(promoteIntegrationPingTraffic(env, f.deps), /INTEGRATION_PING_CLOUD_HTTP_409/);
  assert.equal(f.patches.length, 1);
  assert.equal((await rollbackIntegrationPingTraffic(env, f.deps, f.snapshots.at(-1))).code, 'INTEGRATION_PING_NO_OWNED_PROMOTION');
  await assert.rejects(rollbackIntegrationPingTraffic({...env, GITHUB_RUN_ATTEMPT: '2'}, f.deps, f.snapshots.at(-1)),
    /INTEGRATION_PING_SNAPSHOT_CONTEXT_CONFLICT/);
});

test('exact traffic already serving has no update and no owned rollback', async () => {
  const f = fixture();
  f.change({traffic: allocation(TARGET), trafficStatuses: allocation(TARGET), latestReadyRevision: `${SERVICE}/revisions/${TARGET}`});
  assert.equal((await promoteIntegrationPingTraffic(env, f.deps)).code, 'INTEGRATION_PING_EXACT_TRAFFIC_ALREADY_VERIFIED');
  assert.equal(f.patches.length, 0);
  assert.equal((await rollbackIntegrationPingTraffic(env, f.deps, f.snapshots.at(-1))).code, 'INTEGRATION_PING_NO_OWNED_PROMOTION');
});

test('real workflow gates full preflight, both promotions before smoke and independent owned rollback before publisher', async () => {
  const text = await readFile(new URL('../../.github/workflows/deploy-aurora-firebase.yml', import.meta.url), 'utf8');
  const deploy = text.split('\n  deploy:')[1].split('\n  publish-active-release:')[0];
  const index = name => deploy.indexOf(`- name: ${name}`);
  const preflight = index('Require canonical HTTPS and HML routing before cloud authentication');
  assert.ok(preflight < deploy.indexOf('google-github-actions/auth@'));
  assert.ok(deploy.includes("CANONICAL_PREFLIGHT_SCOPE: ${{ inputs.publish_active_release && 'full' || 'routing-only' }}"));
  const promote = index('Promote exact ready IntegrationPing traffic after full canonical preflight');
  const authGatePromote = index('Promote exact ready AuthGate traffic after full canonical preflight');
  const smoke = index('Smoke test private shell and deployed functions');
  assert.ok(index('Deploy Functions, Hosting, Rules and indexes') < authGatePromote && authGatePromote < promote && promote < smoke);
  assert.match(deploy.slice(promote, smoke), /if: \$\{\{ inputs\.publish_active_release \}\}/);
  assert.ok(deploy.slice(promote, smoke).includes('test "$(git rev-parse refs/remotes/origin/main)" = "$GITHUB_SHA"'));
  const rollback = index('Restore owned IntegrationPing traffic when deploy or smoke fails');
  assert.ok(index('Restore owned AuthGate traffic when deploy or smoke fails') < rollback);
  assert.ok(rollback > index('Verify canonical source-bound runtime'));
  assert.match(deploy.slice(rollback), /always\(\) && inputs\.publish_active_release && \(failure\(\) \|\| cancelled\(\)\)/);
  const script = await readFile(new URL('../../firebase-migration/scripts/promote-hml-integration-ping-traffic.mjs', import.meta.url), 'utf8');
  assert.ok(script.includes('metadata.resourceVersion'));
  assert.equal(text.includes('rollback-authgate:'), false);
  const publisher = text.split('\n  publish-active-release:')[1];
  assert.equal(publisher.includes('promote-hml-integration-ping-traffic.mjs rollback'), false);
  const ci = await readFile(new URL('../../.github/workflows/validate-hml-auth-contract.yml', import.meta.url), 'utf8');
  assert.equal(ci.split("- 'firebase-migration/scripts/promote-hml-integration-ping-traffic.mjs'").length - 1, 2);
  assert.equal(ci.split("- 'scripts/tests/promote_hml_integration_ping_traffic.test.mjs'").length - 1, 2);
  assert.ok(ci.includes('node --test scripts/tests/promote_hml_integration_ping_traffic.test.mjs'));
});

const v1Url = 'https://southamerica-east1-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/wmgj-hml-jfn-20260927/services/auroranexusintegrationping';
function v1Service(generation = 25, resourceVersion = 'before', revision = OLD) {
  return {apiVersion: 'serving.knative.dev/v1', kind: 'Service',
    metadata: {name: 'auroranexusintegrationping', namespace: '299889357292', resourceVersion, generation,
      labels: {owned: 'firebase'}, annotations: {'run.googleapis.com/launch-stage': 'GA'}},
    spec: {template: {metadata: {name: TARGET}, spec: {containers: [{image: 'synthetic@sha256:' + 'b'.repeat(64),
      env: [{name: 'EXISTING', value: 'SYNTHETIC_VALUE_NEVER_LOGGED'}]}]}},
      traffic: [{revisionName: revision, percent: 100}]},
    status: {observedGeneration: generation, latestCreatedRevisionName: TARGET,
      latestReadyRevisionName: revision, conditions: [{type: 'Ready', status: 'True'}],
      traffic: [{revisionName: revision, percent: 100}]}};
}

function transport(responses) {
  const calls = [];
  return {calls, fetchImpl: async (url, options) => {
    calls.push({url, method: options.method, ...(options.body ? {body: JSON.parse(options.body)} : {})});
    assert.equal(options.redirect, 'error');
    const response = responses.shift();
    assert.ok(response, 'unexpected HTTP request');
    if (response.http) return {ok: false, status: response.http};
    return {ok: true, json: async () => clone(response)};
  }};
}
const cloudEnv = {...env, RUNNER_TEMP: process.cwd()};

test('real HTTP adapter uses regional v1 PUT with resourceVersion CAS and changes only spec.traffic', async () => {
  const before = v1Service(), after = v1Service(26, 'version-26', TARGET);
  const t = transport([before, after]);
  const adapters = createCloudAdapters(cloudEnv, {...t, accessToken: 'SYNTHETIC_TOKEN', sleep: async () => {}});
  const result = await adapters.updateTraffic({name: SERVICE, resourceVersion: 'before', traffic: allocation(TARGET)});
  assert.equal(result.resourceVersion, 'version-26');
  assert.deepEqual(t.calls.map(call => [call.method, call.url]), [['GET', v1Url], ['PUT', v1Url]]);
  assert.deepEqual(t.calls[1].body.metadata, before.metadata);
  assert.deepEqual(t.calls[1].body.spec.template, before.spec.template);
  assert.deepEqual(t.calls[1].body.spec.traffic, [{revisionName: TARGET, percent: 100}]);
  assert.equal(t.calls[1].body.status, undefined);
  assert.equal(t.calls.some(call => call.method === 'PATCH'), false);
});

test('real HTTP adapter waits for its exact generation and captures the reconciled resourceVersion', async () => {
  const before = v1Service(), pending = v1Service(26, 'pending', TARGET), ready = v1Service(26, 'ready', TARGET);
  pending.status.observedGeneration = 25;
  pending.status.conditions[0].status = 'Unknown';
  const t = transport([before, pending, ready]);
  const adapters = createCloudAdapters(cloudEnv, {...t, accessToken: 'SYNTHETIC_TOKEN', sleep: async () => {}});
  const result = await adapters.updateTraffic({name: SERVICE, resourceVersion: 'before', traffic: allocation(TARGET)});
  assert.equal(result.resourceVersion, 'ready');
  assert.equal(result.generation, '26');
  assert.equal(t.calls.filter(call => call.method === 'PUT').length, 1);
});

test('real HTTP adapter refuses a changed version before PUT and never retries a server CAS conflict', async () => {
  for (const responses of [[v1Service(25, 'changed')], [v1Service(), {http: 409}]]) {
    const t = transport(responses);
    const adapters = createCloudAdapters(cloudEnv, {...t, accessToken: 'SYNTHETIC_TOKEN'});
    await assert.rejects(adapters.updateTraffic({name: SERVICE, resourceVersion: 'before', traffic: allocation(TARGET)}),
      /INTEGRATION_PING_UPDATE_CONCURRENT_CHANGE|INTEGRATION_PING_CLOUD_HTTP_409/);
    assert.ok(t.calls.filter(call => call.method === 'PUT').length <= 1);
  }
});

test('real HTTP adapter refuses a concurrent generation or template change during reconciliation', async () => {
  for (const concurrent of [v1Service(27, 'other-writer', TARGET), v1Service(26, 'changed-template', TARGET)]) {
    if (concurrent.metadata.generation === 26) concurrent.spec.template.spec.containers[0].env[0].value = 'CHANGED';
    const pending = v1Service(26, 'pending', TARGET);
    pending.status.observedGeneration = 25;
    const t = transport([v1Service(), pending, concurrent]);
    const adapters = createCloudAdapters(cloudEnv, {...t, accessToken: 'SYNTHETIC_TOKEN', sleep: async () => {}});
    await assert.rejects(adapters.updateTraffic({name: SERVICE, resourceVersion: 'before', traffic: allocation(TARGET)}),
      /INTEGRATION_PING_UPDATE_CONCURRENT_CHANGE/);
    assert.equal(t.calls.filter(call => call.method === 'PUT').length, 1);
  }
});

test('real HTTP adapter rejects floating LATEST rollback baselines', async () => {
  const service = v1Service();
  service.spec.traffic = [{latestRevision: true, percent: 100}];
  const t = transport([service]);
  const adapters = createCloudAdapters(cloudEnv, {...t, accessToken: 'SYNTHETIC_TOKEN'});
  await assert.rejects(adapters.readService(), /INTEGRATION_PING_PINNED_TRAFFIC_REQUIRED/);
  assert.equal(t.calls.length, 1);
});

test('complete promotion uses the actual v1 HTTP adapter and saves only sanitized snapshot fields', async () => {
  const before = v1Service(), after = v1Service(26, 'version-26', TARGET);
  const fn = {name: FUNCTION, state: 'ACTIVE', serviceConfig: {service: SERVICE, revision: TARGET}};
  const revision = {name: `${SERVICE}/revisions/${TARGET}`, conditions: [{type: 'Ready', state: 'CONDITION_SUCCEEDED'}]};
  const t = transport([fn, before, revision, fn, before, before, after, after, revision]);
  const saved = [];
  const adapters = createCloudAdapters(cloudEnv, {...t, accessToken: 'SYNTHETIC_TOKEN', sleep: async () => {}});
  const result = await promoteIntegrationPingTraffic(env, {...adapters, preflight: fixture().deps.preflight,
    saveSnapshot: async snapshot => saved.push(clone(snapshot))});
  assert.equal(result.code, 'INTEGRATION_PING_EXACT_TRAFFIC_PROMOTED');
  assert.equal(t.calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(saved.at(-1).promotion.resourceVersion, 'version-26');
  assert.equal(JSON.stringify(saved).includes('SYNTHETIC_VALUE_NEVER_LOGGED'), false);
  assert.equal(JSON.stringify(saved).includes('template'), false);
});

test('wrong service, function identity or function service cannot acquire a traffic snapshot or write', async () => {
  for (const which of ['service', 'function', 'functionService']) {
    const f = fixture(), deps = {...f.deps};
    if (which === 'service') deps.readService = async () => ({...await f.deps.readService(), name: SERVICE.replace('integrationping','authgate')});
    else deps.readFunction = async () => {
      const fn = await f.deps.readFunction();
      return which === 'function' ? {...fn, name: FUNCTION.replace('IntegrationPing','AuthGate')}
        : {...fn, serviceConfig: {...fn.serviceConfig, service: SERVICE.replace('integrationping','authgate')}};
    };
    await assert.rejects(promoteIntegrationPingTraffic(env, deps), /INTEGRATION_PING_(SERVICE|FUNCTION)_IDENTITY_REQUIRED/);
    assert.equal(f.patches.length, 0);assert.equal(f.snapshots.length, 0);
  }
});

test('an unverified returned generation never establishes owned rollback after a possibly accepted update', async () => {
  const f = fixture(), deps = {...f.deps, updateTraffic: async body => ({...await f.deps.updateTraffic(body), generation: '25'})};
  await assert.rejects(promoteIntegrationPingTraffic(env, deps), /INTEGRATION_PING_UPDATE_OWNERSHIP_NOT_VERIFIED/);
  assert.equal(f.patches.length, 1);assert.equal(f.snapshots.at(-1).promotion, undefined);
  assert.equal((await rollbackIntegrationPingTraffic(env, deps, f.snapshots.at(-1))).code, 'INTEGRATION_PING_NO_OWNED_PROMOTION');
});

test('403 from the existing reader or writer remains a failure without retries or grant changes', async () => {
  for (const responses of [[{http: 403}], [v1Service(), {http: 403}]]) {
    const t = transport(responses), adapters = createCloudAdapters(cloudEnv, {...t, accessToken: 'SYNTHETIC_TOKEN'});
    await assert.rejects(adapters.updateTraffic({name: SERVICE, resourceVersion: 'before', traffic: allocation(TARGET)}), /INTEGRATION_PING_CLOUD_HTTP_403/);
    assert.ok(t.calls.filter(call => call.method === 'PUT').length <= 1);
    assert.equal(t.calls.some(call => call.method === 'PATCH'), false);
  }
});

test('a reconciled LATEST100 target is frozen only from observed traffic, without an owned promotion', async () => {
  const before = v1Service(25, 'before', TARGET);
  before.spec.traffic = [{latestRevision: true, percent: 100}];
  before.status.traffic = [{latestRevision: true, revisionName: TARGET, percent: 100}];
  const fn = {name: FUNCTION, state: 'ACTIVE', serviceConfig: {service: SERVICE, revision: TARGET}};
  const revision = {name: `${SERVICE}/revisions/${TARGET}`, conditions: [{type: 'Ready', state: 'CONDITION_SUCCEEDED'}]};
  const t = transport([fn, before, revision, fn, before]), saved = [];
  const adapters = createCloudAdapters(cloudEnv, {...t, accessToken: 'SYNTHETIC_TOKEN'});
  const result = await promoteIntegrationPingTraffic(env, {...adapters, preflight: fixture().deps.preflight,
    saveSnapshot: async snapshot => saved.push(clone(snapshot))});
  assert.equal(result.code, 'INTEGRATION_PING_EXACT_TRAFFIC_ALREADY_VERIFIED');
  assert.deepEqual(saved[0].previousTraffic, allocation(TARGET));assert.equal(saved[0].promotion, undefined);
  assert.equal(t.calls.some(call => call.method !== 'GET'), false);
});
