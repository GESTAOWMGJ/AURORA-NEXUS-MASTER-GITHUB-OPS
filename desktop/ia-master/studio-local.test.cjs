'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mount, safePath, validateCapabilities, taskActions, validPublication, validSource } = require('./studio-local.js');
const ID = 'a'.repeat(32), BASE = 'b'.repeat(40), HASH = 'c'.repeat(64), ORG = 'synthetic-org';
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(event, listener) { (this.listeners[event] ||= []).push(listener); }
  async emit(event) { if (event === 'click' && this.disabled) return; for (const listener of this.listeners[event] || []) await listener({ target: this }); }
}
function capabilities() {
  return { schemaVersion: 'aurora.master.studio.v1', authenticatedOrgId: ORG, externalAiEnabled: false, modelCanExecuteCommands: false, arbitraryCodeExecution: false,
    repository: { state: 'AVAILABLE', projectId: 'synthetic-project', headRevision: BASE, allowedPaths: ['src/menu.js'], fileCatalog: [{ path: 'src/menu.js', exists: true, byteLength: 20, state: 'EDITABLE' }] },
    source: sourceReceipt(), limits: { maxFiles: 10, maxContextBytes: 50000 }, operations: { publish: 'NOT_IMPLEMENTED', sourceRefresh: 'FIXED_MAIN_SNAPSHOT_ONLY' } };
}
function sourceReceipt(state = 'ORIGINAL_SOURCE', headRevision = BASE, sourceVersion = 0) {
  return { schemaVersion: 'aurora.master.source.v1', state, sourceVersion, headRevision, originalRevision: BASE,
    receiptSha256: HASH, eventHash: null, snapshotVerified: false, originalCheckoutChanged: false,
    remoteCurrent: 'NOT_OBSERVED', canMerge: false, canDeploy: false, canInstall: false };
}
function makeTask(state = 'CONTEXT_BOUND', version = 1) {
  return { schemaVersion: 'aurora.master.studio.v1', id: ID, orgId: ORG, projectId: 'synthetic-project', baseRevision: BASE, version, state, summary: 'Melhorar o menu', prompt: 'Melhorar o menu no celular', classification: 'INTERNAL', history: [] };
}
function fixture() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const elements = new Map(Array.from(html.matchAll(/id="([^"]+)"/g), m => [m[1], new Element()]));
  elements.set('workspace', new Element()); elements.get('workspace').hidden = true;
  const document = { getElementById: id => elements.get(id) || null, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) };
  const events = new Map(), window = { setTimeout, clearTimeout, addEventListener: (name, fn) => { events.set(name, fn); } };
  const calls = [], handlers = new Map(); let stored = makeTask();
  const set = (route, value, status = 200) => handlers.set(route, () => ({ status, value }));
  set('/api/status', { orgId: ORG, version: '1.1.0' }); set('/api/studio/capabilities', capabilities());
  set('/api/studio/tasks', { tasks: [], persistent: true, limit: 100 });
  handlers.set('/api/studio/context', () => ({ status: 201, value: { context: { schemaVersion: 'aurora.master.studio.v1', orgId: ORG, id: 'd'.repeat(32), baseRevision: BASE, files: [{ path: 'src/menu.js', beforeSha256: HASH, content: 'console.log("old");\n' }] } } }));
  const fetch = async (route, options) => {
    calls.push({ route, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === 'POST' && route === '/api/studio/tasks') return response(201, { task: stored });
    let result;
    if (handlers.has(route)) result = await handlers.get(route)(calls.at(-1));
    else if (route === '/api/studio/tasks/' + ID) result = { status: 200, value: { task: stored } };
    else if (route === '/api/studio/tasks/' + ID + '/diff') result = { status: 200, value: { taskId: ID, version: stored.version, diff: '-old\n+new\n', validation: { proposalFingerprint: HASH } } };
    else {
      const action = route.slice(route.lastIndexOf('/') + 1), transitions = { propose: 'PROPOSED', proposal: 'PROPOSED', validate: 'VALIDATED', stage: 'PATCH_STAGED', verify: 'STATIC_CHECKS_PASSED', prepare: 'VERSION_PREPARED' };
      assert.equal(calls.at(-1).body.expectedVersion, stored.version, 'mutation uses the last confirmed task revision');
      stored = { ...stored, version: stored.version + 1, state: transitions[action], proposalFingerprint: HASH, proposal: { summary: 'Melhorar o menu', files: [{ path: 'src/menu.js', beforeSha256: HASH, content: 'console.log("new");\n' }] } };
      if (action === 'stage') stored.staged = true;
      if (action === 'prepare') stored.preparedVersion = { state: 'PREPARED_LOCAL_ONLY', commit: 'e'.repeat(40), tree: 'f'.repeat(40), branch: 'refs/heads/aurora-studio/' + ID, pushed: false, deployed: false };
      result = { status: 200, value: { task: stored } };
    }
    return response(result.status, result.value);
  };
  function response(status, value) { return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json; charset=utf-8' }, text: async () => JSON.stringify(value) }; }
  const controller = mount({ document, window, fetch, location: { hostname: '127.0.0.1', protocol: 'http:' } });
  const e = id => elements.get(id);
  async function create() { await controller.connect(); e('studio-request').value = 'Melhorar o menu no celular'; e('studio-catalog').children[0].children[0].children[0].checked = true; await e('studio-create').emit('click'); }
  async function review() { await e('studio-diff').emit('click'); e('studio-reviewed').checked = true; await e('studio-reviewed').emit('change'); }
  return { controller, e, calls, handlers, set, events, create, review, setTask: value => { stored = value; } };
}
test('catalog rejects escaped, secret, duplicated and forged paths before context binding', () => {
  for (const bad of ['../secrets.json', '/tmp/file.js', 'src/.env', 'src\\file.js', 'src/con.js', 'src/credentials/config.json']) assert.equal(safePath(bad), false, bad);
  const caps = capabilities(); caps.repository.fileCatalog[0].path = 'src/other.js'; assert.throws(() => validateCapabilities(caps, ORG), /INVALID_RESPONSE/);
  assert.throws(() => validateCapabilities(capabilities(), 'other-org'), /INVALID_RESPONSE/);
});
test('no claim of cloud MFA is needed or fabricated by the local UI', async () => {
  const f = fixture(); await f.controller.connect();
  assert.match(f.e('studio-access-kind').textContent, /Sessão do proprietário local/);
  assert.match(f.e('studio-access-kind').textContent, /sem comprovação de login ou MFA no portal/);
  assert.equal(f.controller.getState().closed, false);
  assert(f.calls.every(call => call.credentials === 'same-origin' && !Object.hasOwn(call.headers, 'Authorization')));
});
test('context selection and focus use exact catalogue paths and structured line ranges', async () => {
  const f = fixture(); await f.controller.connect(); f.e('studio-request').value = 'Melhorar o menu no celular';
  const row = f.e('studio-catalog').children[0], details = row.children[2];
  row.children[0].children[0].checked = true; details.children[1].children[0].checked = true;
  details.children[2].children[0].children[0].value = '2'; details.children[2].children[1].children[0].value = '5';
  await f.e('studio-create').emit('click');
  assert.deepEqual(f.calls.find(c => c.route === '/api/studio/context').body, { paths: ['src/menu.js'], classification: 'INTERNAL', focus: [{ path: 'src/menu.js', startLine: 2, endLine: 5 }] });
  assert.match(f.e('studio-source-files').textContent, /beforeSha256: c{64}/);
  assert.equal(f.e('studio-validate').disabled, true);
});
test('invalid focus refuses context without any POST', async () => {
  const f = fixture(); await f.controller.connect(); f.e('studio-request').value = 'Melhorar o menu no celular';
  const row = f.e('studio-catalog').children[0], details = row.children[2]; row.children[0].children[0].checked = true; details.children[1].children[0].checked = true;
  details.children[2].children[0].children[0].value = '5'; details.children[2].children[1].children[0].value = '2';
  await f.e('studio-create').emit('click'); assert.equal(f.calls.some(c => c.method === 'POST'), false);
});
test('complete local proposal flow uses CAS and fixed syntax recipe, ending local-only', async () => {
  const f = fixture(); await f.create(); await f.e('studio-propose').emit('click');
  assert.equal(f.e('studio-validate').disabled, true); await f.review(); await f.e('studio-validate').emit('click');
  assert.equal(f.e('studio-stage').disabled, false, 'one review carries through confirmed transitions of the same proposal');
  await f.e('studio-stage').emit('click'); await f.e('studio-verify').emit('click'); await f.e('studio-prepare').emit('click');
  assert.equal(f.controller.getState().task.state, 'VERSION_PREPARED');
  assert.equal(f.calls.find(c => c.route.endsWith('/verify')).body.recipeId, 'SYNTAX_AND_DIFF_V1');
  assert.match(f.e('studio-version-receipt').textContent, /Versão preparada somente neste PC/);
  assert.match(f.e('studio-version-receipt').textContent, /Não executadas/);
  assert.equal(f.calls.some(c => /publish|deploy|apply|install/.test(c.route)), false);
});
test('manual JSON is data submitted to fixed proposal endpoint and cleared on success', async () => {
  const f = fixture(); await f.create(); const patch = { summary: 'Uma alteração segura', files: [{ path: 'src/menu.js', beforeSha256: HASH, edits: [{ before: 'old', after: 'new' }] }] };
  f.e('studio-json').value = JSON.stringify(patch); await f.e('studio-import').emit('click');
  assert.deepEqual(f.calls.find(c => c.route.endsWith('/proposal')).body.proposal, patch); assert.equal(f.e('studio-json').value, '');
});
test('CAS failure locks mutations until explicit task refresh, without automatic retry', async () => {
  const f = fixture(); await f.create(); f.set('/api/studio/tasks/' + ID + '/propose', { code: 'STUDIO_VERSION_CONFLICT' }, 409);
  await f.e('studio-propose').emit('click'); assert.equal(f.controller.getState().syncRequired, true); assert.equal(f.e('studio-propose').disabled, true);
  assert.equal(f.calls.filter(c => c.route.endsWith('/propose')).length, 1);
  assert.match(f.e('studio-notice').textContent, /mudou em outra janela/);
  await f.e('studio-refresh-task').emit('click'); assert.equal(f.controller.getState().syncRequired, false);
});
test('interrupted staging and preparation never expose another mutation retry', async () => {
  const f = fixture(); await f.controller.connect();
  for (const state of ['STAGING_BLOCKED', 'PREPARATION_BLOCKED', 'STAGING', 'PREPARING_VERSION']) {
    const task = { ...makeTask(state, 8), proposal: { files: [] }, proposalFingerprint: HASH };
    f.controller.renderTask(task); const a = taskActions(task, true, task.version);
    for (const action of ['propose', 'validate', 'stage', 'verify', 'prepare']) assert.equal(a[action], false, state + ':' + action);
    assert.equal(f.e('studio-stage').disabled, true); assert.equal(f.e('studio-prepare').disabled, true);
  }
});
test('session expiry clears prompt, source, proposal, receipts and task without exposing cookie', async () => {
  const f = fixture(); await f.create(); f.e('studio-json').value = 'private draft';
  f.set('/api/studio/tasks/' + ID + '/propose', { code: 'LOCAL_AUTH_REQUIRED' }, 401); await f.e('studio-propose').emit('click');
  assert.equal(f.controller.getState().closed, true); assert.equal(f.controller.getState().task, null);
  for (const id of ['studio-request', 'studio-json']) assert.equal(f.e(id).value, '');
  for (const id of ['studio-source-files', 'studio-context-receipt', 'studio-task-receipt', 'studio-task-history']) assert.equal(f.e(id).textContent, '');
  assert.equal(f.e('studio-task-panel').hidden, true);
});
test('late response after session closure cannot revive task or capability state', async () => {
  const f = fixture(); await f.create(); let resolve;
  f.handlers.set('/api/studio/tasks/' + ID + '/propose', () => new Promise(r => { resolve = r; }));
  const pending = f.e('studio-propose').emit('click'); f.controller.endSession(); resolve({ status: 200, value: { task: { ...makeTask('PROPOSED', 2), proposalFingerprint: HASH, proposal: { files: [] } } } }); await pending;
  assert.equal(f.controller.getState().task, null); assert.equal(f.controller.getState().closed, true); assert.equal(f.e('studio-content').hidden, true);
});
test('offline response clears session-derived source and locks all mutation controls', async () => {
  const f = fixture(); await f.create(); f.handlers.set('/api/studio/tasks/' + ID + '/propose', () => { throw Error('socket unavailable'); });
  await f.e('studio-propose').emit('click'); assert.equal(f.controller.getState().closed, true); assert.equal(f.controller.getState().task, null);
  assert.equal(f.e('studio-source-files').textContent, ''); assert.equal(f.e('studio-stage').disabled, true); assert.match(f.e('studio-notice').textContent, /não respondeu/);
});
test('model partial context is visibly disclosed and untrusted output is text only', async () => {
  const f = fixture(); await f.controller.connect(); const task = makeTask('PROPOSED', 2);
  task.summary = '<img src=x onerror=evil()>'; task.modelContext = { complete: false, files: [{ path: 'src/menu.js', startLine: 10, endLine: 20, complete: false }] };
  f.controller.renderTask(task); assert.equal(f.e('studio-task-title').textContent, task.summary); assert.equal(f.e('studio-task-title').children.length, 0);
  assert.match(f.e('studio-model-context').textContent, /trechos limitados/);
});
test('isolated integration assets preserve identity, cookie handoff and self-only scripts', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), js = fs.readFileSync(path.join(__dirname, 'studio-local.js'), 'utf8');
  assert.match(html, /AURORA NEXUS · IA Master/); assert.match(html, /src="\/studio-local.js" defer/); assert.doesNotMatch(html, /<script>|\bonclick=|\bstyle=/gi);
  // Controlled fixture assertion, not an HTML sanitizer or a runtime security boundary.
  for (const markup of ['<SCRIPT>alert(1)</SCRIPT>', '<button ONCLICK="alert(1)">', '<div STYLE="color:red">']) {
    assert.match(markup, /<script>|\bonclick=|\bstyle=/gi);
  }
  assert.match(app, /aurora:local-session-ready/); assert.match(app, /aurora:local-session-ended/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|document\.cookie|mfaVerified\s*:\s*true|org_admin|eval\(|new Function\(/);
});

function publicationCapabilities() {
  return { ...capabilities(), operations: { ...capabilities().operations, publish: 'DRAFT_PR_ONLY', ci: 'REMOTE_METADATA_ONLY' },
    publisher: { schemaVersion: 'aurora.master.publisher.v1', state: 'CONFIGURED_AUTH_NOT_OBSERVED',
      repository: 'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS', baseBranch: 'main',
      publish: 'OPT_IN_DRAFT_ONLY_AUTH_NOT_OBSERVED', ci: 'REMOTE_METADATA_ONLY',
      modelCanExecuteCommands: false, canMerge: false, canDeploy: false, canDispatch: false, credentialReadByApplication: false } };
}
async function preparedFixture() {
  const f = fixture(); f.set('/api/studio/capabilities', publicationCapabilities());
  await f.create(); await f.e('studio-propose').emit('click'); await f.review();
  for (const operation of ['validate', 'stage', 'verify', 'prepare']) await f.e('studio-' + operation).emit('click');
  return f;
}
function publicationFor(task, state = 'DRAFT_CONFIRMED', version = 1) {
  const event = { at: '2026-10-12T17:00:00.000Z', version, state, eventHash: '7'.repeat(64),
    previousEventHash: version === 1 ? null : '6'.repeat(64) };
  return { schemaVersion: 'aurora.master.publisher.v1', state, publicationVersion: version, orgId: ORG,
    taskId: task.id, taskVersion: task.version, repository: 'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS',
    headSha: task.preparedVersion.commit, baseSha: task.baseRevision, proposalFingerprint: task.proposalFingerprint,
    pullRequest: state === 'DRAFT_CONFIRMED' ? { number: 123,
      url: 'https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/pull/123', draft: true,
      headSha: task.preparedVersion.commit, baseSha: task.baseRevision } : null,
    ci: null, receiptSha256: '8'.repeat(64), history: [event], historyEventCount: version,
    deployed: false, merged: false, projectTestsRunLocally: false };
}
test('publisher capabilities cannot claim another repository or allow merge/deploy', () => {
  for (const change of [{ repository: 'OTHER/REPO' }, { canMerge: true }, { canDeploy: true },
    { state: 'AUTHENTICATED' }, { credentialReadByApplication: true }]) {
    const caps = publicationCapabilities(); Object.assign(caps.publisher, change);
    assert.throws(() => validateCapabilities(caps, ORG), /INVALID_RESPONSE/);
  }
});
test('reviewed prepared version publishes through the fixed route with unchanged task revision', async () => {
  const f = await preparedFixture(), before = f.controller.getState().task;
  f.e('studio-reviewed').checked = false; await f.e('studio-reviewed').emit('change');
  assert.equal(f.e('studio-publish').disabled, true); await f.e('studio-publish').emit('click');
  assert.equal(f.calls.some(call => call.route.endsWith('/publish-draft')), false);
  f.e('studio-reviewed').checked = true; await f.e('studio-reviewed').emit('change');
  const publication = publicationFor(before), current = { ...before, publication };
  f.set('/api/studio/tasks/' + ID + '/publish-draft', { task: current, publication });
  f.setTask(current); await f.e('studio-publish').emit('click');
  const call = f.calls.find(item => item.route.endsWith('/publish-draft'));
  assert.deepEqual(call.body, { expectedVersion: before.version, proposalFingerprint: HASH });
  assert.equal(f.controller.getState().task.version, before.version);
  assert.equal(f.e('studio-publish').disabled, true); assert.equal(f.e('studio-read-ci').disabled, false);
  assert.match(f.e('studio-publication-receipt').textContent, /draft/);
  assert.match(f.e('studio-publication-history').textContent, /Publicação 1/);
  assert.match(f.e('studio-publish-config').textContent, /repositório público/);
});
test('forged publication cannot replace the task or enable CI controls', async () => {
  const f = await preparedFixture(), before = f.controller.getState().task;
  const publication = { ...publicationFor(before), headSha: '0'.repeat(40) };
  assert.equal(validPublication(publication, before, ORG), false);
  f.set('/api/studio/tasks/' + ID + '/publish-draft', { task: { ...before, publication }, publication });
  await f.e('studio-publish').emit('click');
  assert.equal(f.controller.getState().task.publication, undefined);
  assert.equal(f.e('studio-read-ci').disabled, true); assert.equal(f.controller.getState().syncRequired, true);
});
test('unconfirmed publication requires task readback and reconciliation without automatic write retry', async () => {
  const f = await preparedFixture(), before = f.controller.getState().task;
  f.set('/api/studio/tasks/' + ID + '/publish-draft', { code: 'PUBLISH_RECOVERY_REQUIRED' }, 409);
  await f.e('studio-publish').emit('click'); assert.equal(f.controller.getState().syncRequired, true);
  const publication = publicationFor(before, 'PR_UNCONFIRMED'), current = { ...before, publication };
  f.setTask(current); await f.e('studio-refresh-task').emit('click');
  assert.equal(f.e('studio-publish').disabled, true); assert.equal(f.e('studio-reconcile-publication').disabled, false);
  f.set('/api/studio/tasks/' + ID + '/reconcile-publication', { task: current, publication });
  await f.e('studio-reconcile-publication').emit('click');
  assert.equal(f.calls.filter(call => call.route.endsWith('/publish-draft')).length, 1);
  assert.equal(f.calls.filter(call => call.route.endsWith('/reconcile-publication')).length, 1);
});
test('green CI metadata remains unverified and session closure clears publication receipts', async () => {
  const f = await preparedFixture(), before = f.controller.getState().task, publication = publicationFor(before);
  const current = { ...before, publication }; f.setTask(current); await f.e('studio-refresh-task').emit('click');
  const ci = { state: 'REMOTE_CHECKS_PASSED', observedAt: '2026-10-12T17:00:00.000Z',
    proposedHeadSha: publication.headSha, apiHeadSha: publication.headSha, currentHeadSha: publication.headSha,
    preparedBaseSha: BASE, currentBaseSha: BASE, baseCurrent: true, actualCheckout: 'NOT_OBSERVED',
    ciVerified: false, requiredCoverage: 'NOT_OBSERVED', completeRemoteListing: true, checks: [], runs: [] };
  const observed = { ...publication, state: 'CI_OBSERVED', publicationVersion: 2, historyEventCount: 2, ci,
    history: [...publication.history, { at: ci.observedAt, version: 2, state: 'CI_OBSERVED',
      previousEventHash: publication.history[0].eventHash, eventHash: '9'.repeat(64) }] };
  f.set('/api/studio/tasks/' + ID + '/read-ci', { task: { ...before, publication: observed }, publication: observed });
  await f.e('studio-read-ci').emit('click');
  assert.match(f.e('studio-publication-receipt').textContent, /promoção continua pendente/);
  assert.match(f.e('studio-publication-receipt').textContent, /Não observado; promoção não liberada/);
  assert.equal(f.controller.getState().task.publication.ci.ciVerified, false);
  const forged = structuredClone(observed); forged.ci.ciVerified = true;
  assert.equal(validPublication(forged, before, ORG), false);
  f.controller.endSession();
  for (const id of ['studio-publication-receipt', 'studio-publication-history']) assert.equal(f.e(id).textContent, '');
  for (const id of ['studio-publish', 'studio-reconcile-publication', 'studio-read-ci']) assert.equal(f.e(id).disabled, true);
});

test('observed draft with a changed base permits read-only CI while publication stays blocked', async () => {
  const f = await preparedFixture(), before = f.controller.getState().task;
  const publication = publicationFor(before, 'BASE_CHANGED');
  publication.observedPullRequest = { number: 123,
    url: 'https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/pull/123',
    draft: true, headSha: before.preparedVersion.commit, baseSha: '0'.repeat(40) };
  assert.equal(validPublication(publication, before, ORG), true);
  const current = { ...before, publication }; f.setTask(current); await f.e('studio-refresh-task').emit('click');
  assert.equal(f.e('studio-publish').disabled, true); assert.equal(f.e('studio-read-ci').disabled, false);
  assert.match(f.e('studio-publication-receipt').textContent, /draft encontrado; origem alterada/);
  const bad = structuredClone(publication); bad.observedPullRequest.headSha = '1'.repeat(40);
  assert.equal(validPublication(bad, before, ORG), false);
});

test('source capabilities and receipts reject forged revisions, extra fields and expanded authority', async () => {
  for (const change of [{ schemaVersion: 'other' }, { state: 'INSTALLED' }, { sourceVersion: -1 },
    { headRevision: [BASE] }, { originalRevision: 'bad' }, { receiptSha256: [HASH] }, { eventHash: [HASH] },
    { observedRevision: [BASE] }, { snapshotVerified: 'true' }, { originalCheckoutChanged: true },
    { remoteCurrent: 'CURRENT' }, { canMerge: true }, { canDeploy: true }, { canInstall: true }, { arbitraryCommand: 'git pull' }]) {
    const source = { ...sourceReceipt(), ...change };
    assert.equal(Boolean(validSource(source)), false, JSON.stringify(change));
    const caps = capabilities(); caps.source = source;
    assert.throws(() => validateCapabilities(caps, ORG), /INVALID_RESPONSE/);
  }
  for (const operation of ['git pull', true, ['FIXED_MAIN_SNAPSHOT_ONLY']]) {
    const caps = capabilities(); caps.operations.sourceRefresh = operation;
    assert.throws(() => validateCapabilities(caps, ORG), /INVALID_RESPONSE/);
  }
  const inconsistent = capabilities(); inconsistent.repository.headRevision = '1'.repeat(40);
  assert.throws(() => validateCapabilities(inconsistent, ORG), /INVALID_RESPONSE/);
  assert.equal(Boolean(validSource(sourceReceipt(), true)), false, 'original state is not a refresh result');
  const legacy = capabilities(); delete legacy.source; delete legacy.repository.headRevision; delete legacy.operations.sourceRefresh;
  assert.equal(validateCapabilities(legacy, ORG), legacy);
  const f = fixture(); f.set('/api/studio/capabilities', legacy); await f.controller.connect();
  assert.equal(f.e('studio-source-refresh').disabled, true);
});

test('source refresh posts only the local revision and rereads capabilities and catalogue without changing old task', async () => {
  const f = fixture(); await f.create(); await f.e('studio-propose').emit('click');
  const before = structuredClone(f.controller.getState().task), next = '1'.repeat(40);
  const source = { ...sourceReceipt('SOURCE_ACTIVATED', next, 1), snapshotVerified: true, eventHash: '2'.repeat(64) };
  const caps = capabilities(); caps.repository.headRevision = next; caps.source = { ...source, state: 'SNAPSHOT_ACTIVE' };
  caps.repository.allowedPaths = ['src/current.js']; caps.repository.fileCatalog = [{ path: 'src/current.js', exists: true, byteLength: 30, state: 'EDITABLE' }];
  f.set('/api/studio/source-refresh', { source }); f.set('/api/studio/capabilities', caps);
  const start = f.calls.length; await f.e('studio-source-refresh').emit('click');
  const calls = f.calls.slice(start), refresh = calls.find(call => call.route === '/api/studio/source-refresh');
  assert.deepEqual(refresh.body, { expectedLocalSourceRevision: BASE });
  assert.equal(refresh.method, 'POST'); assert.equal(refresh.headers['X-Aurora-Local'], '1');
  assert(calls.findIndex(call => call.route === '/api/studio/capabilities') > calls.indexOf(refresh));
  assert.deepEqual(f.controller.getState().task, before); assert.equal(f.controller.getState().context, null);
  assert.match(f.e('studio-source-version').textContent, /versão 1 · 111111111111/);
  assert.match(f.e('studio-source-receipt').textContent, /Checkout originalPreservado/);
  assert.match(f.e('studio-catalog').textContent, /src\/current\.js/);
  assert.doesNotMatch(f.e('studio-catalog').textContent, /src\/menu\.js/);
  assert.match(f.e('studio-task-source-notice').textContent, /somente leitura/);
  for (const action of ['propose', 'import', 'validate', 'stage', 'verify', 'prepare', 'publish']) assert.equal(f.e('studio-' + action).disabled, true, action);
  assert.equal(f.e('studio-diff').disabled, false); assert.equal(f.e('studio-refresh-history').disabled, false);
  const after = f.calls.length; await f.e('studio-propose').emit('click'); await f.e('studio-diff').emit('click');
  assert.equal(f.calls.slice(after).filter(call => call.method === 'POST').length, 0);
  assert.match(f.e('studio-diff-output').textContent, /-old/); assert.equal(f.e('studio-reviewed').disabled, true);
});

test('every old source task blocks code mutations while proposal differences remain readable', () => {
  for (const state of ['CONTEXT_BOUND', 'PROPOSED', 'VALIDATED', 'PATCH_STAGED', 'CHECK_FAILED', 'STATIC_CHECKS_PASSED', 'VERSION_PREPARED']) {
    const task = { ...makeTask(state), proposal: { files: [] } };
    const actions = taskActions(task, true, task.version, '1'.repeat(40));
    for (const action of ['propose', 'validate', 'stage', 'verify', 'prepare']) assert.equal(actions[action], false, state + ':' + action);
    assert.equal(actions.diff, state !== 'CONTEXT_BOUND');
  }
});

test('old published source permits draft reconciliation and CI observation while publish stays disabled', async () => {
  const f = await preparedFixture(), before = f.controller.getState().task, publication = publicationFor(before);
  const oldTask = { ...before, publication }; f.setTask(oldTask); await f.e('studio-refresh-task').emit('click');
  const next = '1'.repeat(40), source = { ...sourceReceipt('SOURCE_ACTIVATED', next, 1), snapshotVerified: true };
  const caps = publicationCapabilities(); caps.repository.headRevision = next; caps.source = { ...source, state: 'SNAPSHOT_ACTIVE' };
  f.set('/api/studio/source-refresh', { source }); f.set('/api/studio/capabilities', caps);
  await f.e('studio-source-refresh').emit('click');
  assert.equal(f.e('studio-publish').disabled, true);
  for (const [button, action] of [['studio-reconcile-publication', 'reconcile-publication'], ['studio-read-ci', 'read-ci']]) {
    assert.equal(f.e(button).disabled, false);
    f.set('/api/studio/tasks/' + ID + '/' + action, { task: oldTask, publication });
    await f.e(button).emit('click');
    assert.equal(f.controller.getState().task.version, before.version);
  }
  assert.equal(f.calls.some(call => call.route.endsWith('/publish-draft')), false);
  assert.equal(f.calls.filter(call => call.route.endsWith('/read-ci')).length, 1);
});

test('unchanged source and moved remote produce bounded receipts without changing local revision', async () => {
  for (const state of ['ALREADY_CURRENT', 'REMOTE_MOVED']) {
    const f = fixture(); await f.controller.connect();
    const source = { ...sourceReceipt(state), ...(state === 'REMOTE_MOVED' ? { observedRevision: '1'.repeat(40) } : {}) };
    f.set('/api/studio/source-refresh', { source }); await f.e('studio-source-refresh').emit('click');
    assert.equal(f.e('studio-source-refresh').disabled, false);
    assert.match(f.e('studio-source-version').textContent, /bbbbbbbbbbbb/);
    assert.match(f.e('studio-notice').textContent, state === 'REMOTE_MOVED' ? /origem mudou.*preservado/ : /já está nesta versão/);
    assert.equal(f.calls.filter(call => call.route === '/api/studio/source-refresh').length, 1);
  }
});

test('uncertain source refresh requires capabilities readback before another attempt and blocked source never retries', async () => {
  const f = fixture(); await f.controller.connect();
  f.handlers.set('/api/studio/source-refresh', () => { const error = Error('aborted'); error.name = 'AbortError'; throw error; });
  await f.e('studio-source-refresh').emit('click');
  assert.equal(f.controller.getState().sourceSyncRequired, true); assert.equal(f.e('studio-source-refresh').disabled, true);
  assert.equal(f.e('studio-create').disabled, true); await f.e('studio-source-refresh').emit('click');
  assert.equal(f.calls.filter(call => call.route === '/api/studio/source-refresh').length, 1);
  const before = f.calls.length; await f.e('studio-reconnect').emit('click');
  assert(f.calls.slice(before).some(call => call.route === '/api/studio/capabilities'));
  assert.equal(f.controller.getState().sourceSyncRequired, false); assert.equal(f.e('studio-source-refresh').disabled, false);
  const blocked = capabilities(); blocked.source.state = 'REFRESH_BLOCKED'; f.set('/api/studio/capabilities', blocked);
  await f.e('studio-reconnect').emit('click'); assert.equal(f.e('studio-source-refresh').disabled, true);
  await f.e('studio-source-refresh').emit('click');
  assert.equal(f.calls.filter(call => call.route === '/api/studio/source-refresh').length, 1);
});

test('forged refresh result and late response cannot activate capabilities or revive a closed session', async () => {
  const invalid = fixture(); await invalid.controller.connect();
  invalid.set('/api/studio/source-refresh', { source: { ...sourceReceipt('SOURCE_ACTIVATED'), canInstall: true } });
  const before = invalid.calls.length; await invalid.e('studio-source-refresh').emit('click');
  assert.equal(invalid.controller.getState().sourceSyncRequired, true);
  assert.equal(invalid.calls.slice(before).some(call => call.route === '/api/studio/capabilities'), false);
  const f = fixture(); await f.controller.connect(); let resolve;
  f.handlers.set('/api/studio/source-refresh', () => new Promise(done => { resolve = done; }));
  const pending = f.e('studio-source-refresh').emit('click'); f.controller.endSession();
  resolve({ status: 200, value: { source: sourceReceipt('ALREADY_CURRENT') } }); await pending;
  assert.equal(f.controller.getState().closed, true); assert.equal(f.e('studio-content').hidden, true);
  assert.equal(f.e('studio-source-version').textContent, ''); assert.equal(f.e('studio-source-receipt').textContent, '');
  assert.equal(f.e('studio-source-refresh').disabled, true);
});

test('task audit exposes the existing bounded memory receipt with full method IDs and partial historical coverage', async () => {
  const f = fixture(); await f.controller.connect();
  const task = makeTask('PROPOSED', 2);
  task.knowledge = { status: 'LOADED', corpusVersion: '1.0.2', corpusHash: '4'.repeat(64), recordIds: ['AUTO-MO-001'],
    loadedCount: 1, rejectedCount: 0, selectedContextBytes: 588, maxContextBytes: 600,
    selectionState: 'SELECTED', completeHistoricalAbsorption: false };
  f.controller.renderTask(task);
  const receipt = f.e('studio-knowledge-receipt').textContent;
  for (const expected of ['Memória consultada1.0.2', 'Hash da memória' + '4'.repeat(64),
    'Métodos consultadosAUTO-MO-001', 'Contexto selecionado588/600 bytes', 'Estado da seleçãoSELECTED', 'Cobertura histórica completaNão']) {
    assert(receipt.includes(expected), expected);
  }
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<details class="studio-advanced"><summary>Evidências e histórico desta tarefa<\/summary>[^]*?id="studio-knowledge-receipt"[^]*?<\/details>/);
  const untrusted = { ...task, knowledge: { ...task.knowledge, corpusVersion: '<img src=x onerror=evil()>' } };
  f.controller.renderTask(untrusted);
  assert.match(f.e('studio-knowledge-receipt').textContent, /<img src=x onerror=evil\(\)>/);
  assert.equal(f.e('studio-knowledge-receipt').children[0].children[1].children.length, 0);
  f.controller.renderTask({ ...task, knowledge: { ...task.knowledge, selectedContextBytes: 601 } });
  assert.equal(f.e('studio-knowledge-receipt').textContent, '');
  f.controller.renderTask(task); f.controller.endSession();
  assert.equal(f.e('studio-knowledge-receipt').textContent, '');
});

test('recovery capability is closed and button appears only for a verified blocked source', async () => {
  for (const operation of [true, 'RESET_ANY_SOURCE', ['PRESERVE_AND_RESET_BLOCKED_ATTEMPT']]) {
    const caps = capabilities(); caps.operations.sourceRecovery = operation;
    assert.throws(() => validateCapabilities(caps, ORG), /INVALID_RESPONSE/);
  }
  for (const [operation, state] of [[undefined, 'REFRESH_BLOCKED'], ['NOT_CONFIGURED', 'REFRESH_BLOCKED'],
    ['PRESERVE_AND_RESET_BLOCKED_ATTEMPT', 'ORIGINAL_SOURCE']]) {
    const f = fixture(), caps = capabilities(); caps.source.state = state;
    if (operation !== undefined) caps.operations.sourceRecovery = operation;
    f.set('/api/studio/capabilities', caps); await f.controller.connect();
    assert.equal(f.e('studio-source-recover').hidden, true); assert.equal(f.e('studio-source-recover').disabled, true);
    await f.e('studio-source-recover').emit('click');
    assert.equal(f.calls.some(call => call.route === '/api/studio/source-recover'), false);
  }
});

test('blocked source recovery uses receipt and revision CAS, preserves task and never starts another refresh', async () => {
  const f = fixture(), blocked = capabilities(); blocked.source.state = 'REFRESH_BLOCKED';
  blocked.operations.sourceRecovery = 'PRESERVE_AND_RESET_BLOCKED_ATTEMPT';
  f.set('/api/studio/capabilities', blocked); await f.controller.connect();
  const task = makeTask('PROPOSED', 2); task.history = [{ state: 'PROPOSED', version: 2, eventHash: HASH }]; f.controller.renderTask(task);
  assert.equal(f.e('studio-source-refresh').disabled, true);
  assert.equal(f.e('studio-source-recover').hidden, false); assert.equal(f.e('studio-source-recover').disabled, false);
  const source = { ...sourceReceipt('SOURCE_RECOVERED', BASE, 1), receiptSha256: '2'.repeat(64), eventHash: '3'.repeat(64) };
  const recovered = capabilities(); recovered.source = { ...source, state: 'ORIGINAL_SOURCE' };
  recovered.operations.sourceRecovery = 'PRESERVE_AND_RESET_BLOCKED_ATTEMPT';
  f.set('/api/studio/source-recover', { source, externalAiCalls: 0 }); f.set('/api/studio/capabilities', recovered);
  const before = f.calls.length; await f.e('studio-source-recover').emit('click');
  const calls = f.calls.slice(before), recovery = calls.find(call => call.route === '/api/studio/source-recover');
  assert.deepEqual(recovery.body, { expectedLocalSourceRevision: BASE, expectedSourceReceiptSha256: HASH });
  assert.equal(recovery.method, 'POST'); assert.equal(recovery.headers['X-Aurora-Local'], '1');
  assert.deepEqual(f.controller.getState().task, task); assert.equal(f.controller.getState().sourceSyncRequired, false);
  assert(calls.findIndex(call => call.route === '/api/studio/capabilities') > calls.indexOf(recovery));
  assert(calls.some(call => call.route === '/api/studio/tasks'));
  assert.equal(f.calls.some(call => call.route === '/api/studio/source-refresh'), false);
  assert.equal(f.e('studio-source-refresh').disabled, false); assert.equal(f.e('studio-source-recover').hidden, true);
  assert.match(f.e('studio-notice').textContent, /Tentativa recuperada.*histórico preservados/);
  assert.match(f.e('studio-source-receipt').textContent, /Versão da fonte1/);
  assert.match(f.e('studio-source-receipt').textContent, new RegExp('Hash do evento' + '3'.repeat(64)));
  f.controller.endSession(); assert.equal(f.e('studio-source-recover').hidden, true); assert.equal(f.e('studio-source-recover').disabled, true);
});

test('source response accepts only zero external AI calls and the correct refresh or recovery result state', async () => {
  const success = fixture(); await success.controller.connect();
  success.set('/api/studio/source-refresh', { source: sourceReceipt('ALREADY_CURRENT'), externalAiCalls: 0 });
  await success.e('studio-source-refresh').emit('click'); assert.equal(success.controller.getState().sourceSyncRequired, false);
  for (const extra of [{ externalAiCalls: 1 }, { externalAiCalls: '0' }, { arbitraryCommand: 'git pull' }]) {
    const f = fixture(); await f.controller.connect();
    f.set('/api/studio/source-refresh', { source: sourceReceipt('ALREADY_CURRENT'), ...extra });
    await f.e('studio-source-refresh').emit('click'); assert.equal(f.controller.getState().sourceSyncRequired, true);
  }
  const f = fixture(), blocked = capabilities(); blocked.source.state = 'REFRESH_BLOCKED';
  blocked.operations.sourceRecovery = 'PRESERVE_AND_RESET_BLOCKED_ATTEMPT';
  f.set('/api/studio/capabilities', blocked); await f.controller.connect();
  f.set('/api/studio/source-recover', { source: sourceReceipt('SOURCE_ACTIVATED'), externalAiCalls: 0 });
  await f.e('studio-source-recover').emit('click');
  assert.equal(f.controller.getState().sourceSyncRequired, true); assert.equal(f.e('studio-source-recover').disabled, true);
  assert.equal(Boolean(validSource(sourceReceipt('SOURCE_RECOVERED'), true)), false);
  assert.equal(Boolean(validSource(sourceReceipt('SOURCE_RECOVERED'), true, true)), true);
});

test('source lock receipt accepts only the final optional digest on a blocked source', () => {
  const source = { ...sourceReceipt('REFRESH_BLOCKED'), sourceLockSha256: '5'.repeat(64) };
  assert.equal(Boolean(validSource(source)), true);
  const caps = capabilities(); caps.source = source;
  assert.equal(validateCapabilities(caps, ORG), caps);
  for (const change of [{ sourceLockSha256: null }, { sourceLockSha256: '' }, { sourceLockSha256: ['5'.repeat(64)] },
    { state: 'ORIGINAL_SOURCE' }, { sourceLockPid: 123 }, { sourceLockState: 'DEAD' }]) {
    const forged = { ...source, ...change }; assert.equal(Boolean(validSource(forged)), false, JSON.stringify(change));
    const bad = capabilities(); bad.source = forged; assert.throws(() => validateCapabilities(bad, ORG), /INVALID_RESPONSE/);
  }
});

test('verified dead global lock recovers with all three CAS fields even without a source operation', async () => {
  const f = fixture(), blocked = capabilities(), lockHash = '5'.repeat(64);
  blocked.source = { ...sourceReceipt('REFRESH_BLOCKED'), sourceLockSha256: lockHash };
  blocked.operations.sourceRecovery = 'PRESERVE_AND_RESET_BLOCKED_ATTEMPT';
  assert.equal(Object.hasOwn(blocked.source, 'operation'), false);
  f.set('/api/studio/capabilities', blocked); await f.controller.connect();
  const task = { ...makeTask('PROPOSED', 2), baseRevision: '0'.repeat(40), proposal: { files: [] }, proposalFingerprint: HASH,
    history: [{ version: 2, state: 'PROPOSED', eventHash: HASH }] };
  f.controller.renderTask(task);
  assert.equal(f.e('studio-source-recover').hidden, false); assert.equal(f.e('studio-source-recover').disabled, false);
  assert.match(f.e('studio-source-receipt').textContent, new RegExp('Hash da trava recuperável: ' + lockHash));
  const source = { ...sourceReceipt('SOURCE_RECOVERED', BASE, 1), receiptSha256: '2'.repeat(64), eventHash: '3'.repeat(64) };
  const recovered = capabilities(); recovered.source = { ...source, state: 'ORIGINAL_SOURCE' };
  recovered.operations.sourceRecovery = 'PRESERVE_AND_RESET_BLOCKED_ATTEMPT';
  f.set('/api/studio/source-recover', { source, externalAiCalls: 0 }); f.set('/api/studio/capabilities', recovered);
  await f.e('studio-source-recover').emit('click');
  const call = f.calls.find(item => item.route === '/api/studio/source-recover');
  assert.deepEqual(call.body, { expectedLocalSourceRevision: BASE, expectedSourceReceiptSha256: HASH, expectedSourceLockSha256: lockHash });
  assert.deepEqual(f.controller.getState().task, task);
  assert.equal(f.calls.some(item => item.route === '/api/studio/source-refresh'), false);
  assert.equal(f.e('studio-source-recover').hidden, true); assert.equal(f.e('studio-source-refresh').disabled, false);
  assert.equal(f.e('studio-propose').disabled, true); assert.equal(f.e('studio-diff').disabled, false);
});

test('live or unverified lock has no recovery proof and a locked operation stays preserved without automatic retry', async () => {
  const f = fixture(); await f.controller.connect();
  assert.equal(f.e('studio-source-recover').hidden, true); assert.equal(f.e('studio-source-recover').disabled, true);
  f.e('studio-request').value = 'Melhorar o menu no celular'; f.e('studio-catalog').children[0].children[0].children[0].checked = true;
  f.set('/api/studio/context', { code: 'STUDIO_LOCKED' }, 409); await f.e('studio-create').emit('click');
  assert.equal(f.controller.getState().sourceSyncRequired, true); assert.equal(f.e('studio-create').disabled, true);
  assert.equal(f.e('studio-source-recover').hidden, true);
  assert.match(f.e('studio-notice').textContent, /trava sem prova.*preservada/);
  await f.e('studio-create').emit('click'); await f.e('studio-source-recover').emit('click');
  assert.equal(f.calls.filter(item => item.route === '/api/studio/context').length, 1);
  assert.equal(f.calls.some(item => item.route === '/api/studio/source-recover'), false);
  assert.equal(f.calls.some(item => item.route === '/api/studio/source-refresh'), false);
});

test('recovery lock conflict requires rereading capabilities and never manufactures another lock hash', async () => {
  const f = fixture(), blocked = capabilities();
  blocked.source = { ...sourceReceipt('REFRESH_BLOCKED'), sourceLockSha256: '5'.repeat(64) };
  blocked.operations.sourceRecovery = 'PRESERVE_AND_RESET_BLOCKED_ATTEMPT';
  f.set('/api/studio/capabilities', blocked); await f.controller.connect();
  f.set('/api/studio/source-recover', { code: 'STUDIO_LOCKED' }, 409);
  await f.e('studio-source-recover').emit('click'); assert.equal(f.controller.getState().sourceSyncRequired, true);
  assert.equal(f.e('studio-source-recover').disabled, true); await f.e('studio-source-recover').emit('click');
  assert.equal(f.calls.filter(item => item.route === '/api/studio/source-recover').length, 1);
  assert.equal(f.calls.some(item => item.route === '/api/studio/source-refresh'), false);
  f.set('/api/studio/capabilities', capabilities()); const before = f.calls.length; await f.e('studio-reconnect').emit('click');
  assert(f.calls.slice(before).some(item => item.route === '/api/studio/capabilities'));
  assert.equal(f.e('studio-source-recover').hidden, true);
  assert.equal(f.calls.filter(item => item.route === '/api/studio/source-recover').length, 1);
});
