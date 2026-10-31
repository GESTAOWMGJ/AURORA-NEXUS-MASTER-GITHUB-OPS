'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createStudio, StudioError } = require('./studio.cjs');
const { syntheticPublisher } = require('./publisher-fixture.cjs');
const gitExecutable = process.env.AURORA_STUDIO_TEST_GIT;
assert.ok(gitExecutable && path.isAbsolute(gitExecutable), 'Set AURORA_STUDIO_TEST_GIT to the existing Git executable.');
const fixture = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-studio-contract-'));
  const root = path.join(directory, 'repo'), stateDir = path.join(directory, 'state');
  fs.mkdirSync(root); fs.mkdirSync(stateDir);
  const gitEnv = { PATH: process.env.PATH || process.env.Path, SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP, TMP: process.env.TMP, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const git = (args, input) => execFileSync(gitExecutable, ['-c', 'core.fsmonitor=false', ...args],
    { cwd: root, env: gitEnv, input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Synthetic test']); git(['config', 'user.email', 'test@example.invalid']);
  fs.writeFileSync(path.join(root, 'app.cjs'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'notes.md'), 'Synthetic engineering context.\n');
  fs.writeFileSync(path.join(root, 'binary.png'), Buffer.from([0, 255, 128, 65, 0, 20]));
  fs.writeFileSync(path.join(root, '.env.example'), 'API_KEY=\nLOCAL_ONLY=true\n');
  git(['add', '--', '.']); git(['commit', '-m', 'Synthetic baseline']);
  const repository = { root, gitExecutable, allowedPaths: ['app.cjs', 'notes.md', 'new.json'], projectId: 'synthetic-project' };
  const audits = [], options = { stateDir, orgId: 'tenant-test', repository, audit: (action, metadata) => audits.push({ action, metadata }) };
  const studio = createStudio(options), base = git(['rev-parse', 'HEAD']);
  t.after(() => { assert.ok(directory.startsWith(path.join(os.tmpdir(), 'aurora-studio-contract-'))); fs.rmSync(directory, { recursive: true, force: true }); });
  return { studio, root, stateDir, repository, options, git, base, audits };
};
function startStudioAfterFixtureSetup(a) {
  // Fixture source setup precedes the product's pinned source lifecycle.
  const file = path.join(a.stateDir, 'studio', 'source-cursor.json');
  const owned = JSON.parse(fs.readFileSync(file, 'utf8')).payload;
  assert.equal(owned.version, 0); assert.equal(owned.active, null);
  assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'tasks')).length, 0);
  fs.unlinkSync(file); a.studio = createStudio(a.options);
}
async function task(a, paths = ['app.cjs']) {
  const context = (await a.studio.route('POST', '/api/studio/context', { paths, classification: 'INTERNAL' })).value.context;
  const created = (await a.studio.route('POST', '/api/studio/tasks', { contextId: context.id, prompt: 'Improve the synthetic module with a clear deterministic result.', classification: 'INTERNAL' })).value.task;
  return { context, task: created };
}
async function proposal(a, value, ctx, content = 'module.exports = 2;\n') {
  return (await a.studio.route('POST', '/api/studio/tasks/' + value.id + '/proposal', { expectedVersion: value.version,
    proposal: { summary: 'Synthetic deterministic improvement.', files: [{ path: ctx.files[0].path, beforeSha256: ctx.files[0].beforeSha256, content }] } })).value.task;
}
async function action(a, value, mode, extra = {}) { return (await a.studio.route('POST', '/api/studio/tasks/' + value.id + '/' + mode, { expectedVersion: value.version, ...extra })).value; }

test('complete local slice survives restart, prepares a local branch and preserves active checkout/binary bytes', async t => {
  const a = fixture(t), initial = await task(a); let value = await proposal(a, initial.task, initial.context);
  const diff = (await a.studio.route('GET', '/api/studio/tasks/' + value.id + '/diff')).value;
  assert.match(diff.diff, /-module.exports = 1;\n\+module.exports = 2;/);
  assert.equal(diff.validation.testsExecuted, false);
  value = (await action(a, value, 'validate')).task; value = (await action(a, value, 'stage')).task;
  assert.equal(value.state, 'PATCH_STAGED');
  const isolated = path.join(a.stateDir, 'studio', 'workspaces', value.id);
  assert.deepEqual(fs.readFileSync(path.join(isolated, 'binary.png')), fs.readFileSync(path.join(a.root, 'binary.png')));
  const verified = await action(a, value, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' }); value = verified.task;
  assert.equal(verified.verification.state, 'STATIC_CHECKS_PASSED'); assert.equal(verified.verification.arbitraryCodeExecuted, false);
  assert.equal(verified.verification.projectTests, 'NOT_EXECUTED_RUNNER_NOT_IMPLEMENTED');
  const prepared = await action(a, value, 'prepare'); value = prepared.task;
  assert.equal(value.state, 'VERSION_PREPARED'); assert.equal(prepared.preparedVersion.pushed, false); assert.equal(prepared.preparedVersion.deployed, false);
  assert.equal(a.git(['show', prepared.preparedVersion.commit + ':app.cjs']), 'module.exports = 2;');
  assert.equal(a.git(['rev-parse', 'HEAD']), a.base); assert.equal(fs.readFileSync(path.join(a.root, 'app.cjs'), 'utf8'), 'module.exports = 1;\n');
  const restarted = createStudio(a.options), readback = (await restarted.route('GET', '/api/studio/tasks/' + value.id)).value.task;
  assert.deepEqual(readback, value); assert.equal((await restarted.route('GET', '/api/studio/tasks')).value.tasks[0].state, 'VERSION_PREPARED');
  assert.ok(readback.history.every(e => /^[a-f0-9]{64}$/.test(e.eventHash)));
  assert.ok(!JSON.stringify(a.audits).includes(initial.task.prompt)); assert.ok(!JSON.stringify(a.audits).includes('module.exports = 2'));
});

test('trusted Studio routes publish an immutable prepared draft and keep task and publication versions separate', async t => {
  const a = fixture(t); let commit = null;
  const transport = syntheticPublisher({ directory: path.dirname(a.root), orgId: 'tenant-test',
    gitExecutable, baseRevision: a.base, preparedCommit: () => commit });
  a.options.publisherConfig = transport.config; a.options.publisherRunner = transport.runner;
  a.studio = createStudio(a.options);
  const capabilities = (await a.studio.route('GET', '/api/studio/capabilities')).value;
  assert.equal(capabilities.operations.publish, 'DRAFT_PR_ONLY'); assert.equal(capabilities.operations.ci, 'REMOTE_METADATA_ONLY');
  assert.equal(capabilities.publisher.state, 'CONFIGURED_AUTH_NOT_OBSERVED');
  assert.equal(transport.remote.calls.length, 0, 'capability discovery makes no implicit credential/network call');
  const initial = await task(a); let value = await proposal(a, initial.task, initial.context);
  for (const operation of ['validate', 'stage']) value = (await action(a, value, operation)).task;
  value = (await action(a, value, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' })).task;
  value = (await action(a, value, 'prepare')).task; commit = value.preparedVersion.commit;
  const input = { expectedVersion: value.version, proposalFingerprint: value.proposalFingerprint };
  const route = '/api/studio/tasks/' + value.id;
  await assert.rejects(a.studio.route('POST', route + '/publish-draft', { ...input, command: 'arbitrary' }), { code: 'STUDIO_INVALID_FIELDS' });
  await assert.rejects(a.studio.route('POST', route + '/publish-draft', { ...input, expectedVersion: value.version - 1 }), { code: 'STUDIO_VERSION_CONFLICT' });
  assert.equal(transport.remote.pushes, 0);
  const published = (await a.studio.route('POST', route + '/publish-draft', input)).value;
  assert.equal(published.task.version, value.version); assert.equal(published.task.state, 'VERSION_PREPARED');
  assert.equal(published.publication.state, 'DRAFT_CONFIRMED'); assert.equal(published.publication.orgId, 'tenant-test');
  assert.equal(published.publication.pullRequest.draft, true); assert.equal(published.publication.headSha, commit);
  assert.equal(published.publication.receiptSha256, published.task.publication.receiptSha256);
  assert.equal(published.publication.history.at(-1).state, 'DRAFT_CONFIRMED');
  assert.equal(value.preparedVersion.pushed, false);
  assert.equal(transport.remote.pushes, 1); assert.equal(transport.remote.creates, 1);
  const observed = (await a.studio.route('POST', route + '/read-ci', input)).value;
  assert.equal(observed.publication.ci.state, 'REMOTE_CHECKS_PASSED');
  assert.equal(observed.publication.ci.actualCheckout, 'NOT_OBSERVED'); assert.equal(observed.publication.ci.ciVerified, false);
  assert.equal(observed.task.version, value.version);
  const restarted = createStudio(a.options), restored = (await restarted.route('GET', route)).value.task;
  assert.equal(restored.publication.receiptSha256, observed.task.publication.receiptSha256);
  assert.equal((await restarted.route('GET', '/api/studio/tasks')).value.tasks[0].publication.pullRequest.number, 456);
  await restarted.route('POST', route + '/publish-draft', input);
  assert.equal(transport.remote.pushes, 1); assert.equal(transport.remote.creates, 1);
  assert.ok(!JSON.stringify(a.audits).includes(initial.task.prompt));
  assert.ok(!transport.remote.bodies[0].includes(initial.task.prompt));
  const recordFile = path.join(a.stateDir, 'studio', 'publications', value.id + '.json');
  fs.writeFileSync(recordFile, '{corrupt');
  await assert.rejects(restarted.route('GET', route), { code: 'PUBLISH_RECORD_INVALID' });
});

test('disabled publication remains explicit and a persisted preparation cannot grant its own publisher opt-in', async t => {
  const a = fixture(t), initial = await task(a); let value = await proposal(a, initial.task, initial.context);
  for (const operation of ['validate', 'stage']) value = (await action(a, value, operation)).task;
  value = (await action(a, value, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' })).task;
  value = (await action(a, value, 'prepare')).task;
  const caps = (await a.studio.route('GET', '/api/studio/capabilities')).value;
  assert.equal(caps.operations.publish, 'NOT_CONFIGURED'); assert.equal(caps.publisher.canMerge, false);
  await assert.rejects(a.studio.route('POST', '/api/studio/tasks/' + value.id + '/publish-draft',
    { expectedVersion: value.version, proposalFingerprint: value.proposalFingerprint }), { code: 'PUBLISH_NOT_CONFIGURED' });
  const readback = (await a.studio.route('GET', '/api/studio/tasks/' + value.id)).value.task;
  assert.equal(readback.publication, undefined); assert.equal(readback.version, value.version);
});
test('repository is explicitly configured, unsupported fields/paths/classifications/secrets are rejected', async t => {
  const a = fixture(t), disabled = createStudio({ stateDir: a.stateDir, orgId: 'tenant-test' });
  assert.equal((await disabled.route('GET', '/api/studio/capabilities')).value.repository.state, 'NOT_CONFIGURED');
  await assert.rejects(disabled.route('POST', '/api/studio/context', { paths: ['app.cjs'], classification: 'INTERNAL' }), { code: 'STUDIO_NOT_CONFIGURED' });
  for (const filename of ['../app.cjs', '/app.cjs', 'C:/app.cjs', '.env', 'unknown.cjs', 'app.cjs/../../notes.md', 'NUL.cjs']) {
    await assert.rejects(a.studio.route('POST', '/api/studio/context', { paths: [filename], classification: 'INTERNAL' }), e => e instanceof StudioError);
  }
  await assert.rejects(a.studio.route('POST', '/api/studio/context', { paths: ['app.cjs'], classification: 'CLINICAL_SENSITIVE' }), { code: 'STUDIO_INVALID_FIELDS' });
  const initial = await task(a);
  await assert.rejects(a.studio.route('POST', '/api/studio/tasks', { contextId: initial.context.id, prompt: 'Bearer syntheticCredentialMustNotPersist', classification: 'INTERNAL' }), { code: 'STUDIO_SENSITIVE_CONTENT' });
  await assert.rejects(a.studio.route('POST', '/api/studio/tasks/' + initial.task.id + '/proposal', { expectedVersion: 1, proposal: { summary: 'Synthetic command must stay inert.', files: [], command: 'whoami' } }), { code: 'STUDIO_INVALID_FIELDS' });
  assert.equal(fs.readFileSync(path.join(a.root, 'app.cjs'), 'utf8'), 'module.exports = 1;\n');
});
test('stale task version and drifted base refuse mutation and preparation', async t => {
  const a = fixture(t), initial = await task(a), value = await proposal(a, initial.task, initial.context);
  await assert.rejects(action(a, initial.task, 'validate'), { code: 'STUDIO_VERSION_CONFLICT' });
  fs.writeFileSync(path.join(a.root, 'notes.md'), 'Concurrent synthetic change.\n'); a.git(['add', '--', 'notes.md']); a.git(['commit', '-m', 'Concurrent change']);
  await assert.rejects(action(a, value, 'validate'), { code: 'STUDIO_BASE_CHANGED' });
  assert.equal((await a.studio.route('GET', '/api/studio/tasks/' + value.id)).value.task.state, 'PROPOSED');
  assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'workspaces')).length, 0);
});
test('staging bypasses checkout hooks and smudge filters; no generated project code is executed', async t => {
  const a = fixture(t), sentinel = path.join(a.root, 'should-not-run.txt');
  fs.writeFileSync(path.join(a.root, '.gitattributes'), 'app.cjs filter=trap\n'); a.git(['add', '--', '.gitattributes']); a.git(['commit', '-m', 'Synthetic attribute']); startStudioAfterFixtureSetup(a);
  const trap = '"' + process.execPath + '" -e "require(\'fs\').writeFileSync(\'' + sentinel.replace(/\\/g, '/') + '\',\'unexpected\')"';
  a.git(['config', 'filter.trap.smudge', trap]); a.git(['config', 'filter.trap.clean', trap]);
  const initial = await task(a); let value = await proposal(a, initial.task, initial.context, 'require("node:fs").writeFileSync("should-not-run.txt", "executed");\n');
  value = (await action(a, value, 'validate')).task; value = (await action(a, value, 'stage')).task;
  value = (await action(a, value, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' })).task;
  assert.equal(value.state, 'STATIC_CHECKS_PASSED'); assert.equal(fs.existsSync(sentinel), false);
  assert.equal(fs.existsSync(path.join(a.stateDir, 'studio', 'workspaces', value.id, 'should-not-run.txt')), false);
});
test('failed syntax is persisted, repeated staging is blocked, and workspace drift cannot prepare a version', async t => {
  const a = fixture(t), initial = await task(a); let value = await proposal(a, initial.task, initial.context, 'const = syntaxFailure;\n');
  value = (await action(a, value, 'validate')).task; value = (await action(a, value, 'stage')).task;
  await assert.rejects(action(a, value, 'stage'), { code: 'STUDIO_STATE_CONFLICT' });
  await assert.rejects(action(a, value, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' }), { code: 'STUDIO_CHECK_FAILED' });
  value = (await a.studio.route('GET', '/api/studio/tasks/' + value.id)).value.task;
  assert.equal(value.state, 'CHECK_FAILED'); await assert.rejects(action(a, value, 'prepare'), { code: 'STUDIO_STATE_CONFLICT' });
  fs.writeFileSync(path.join(a.stateDir, 'studio', 'workspaces', value.id, 'app.cjs'), 'module.exports = 99;\n');
  await assert.rejects(action(a, value, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' }), { code: 'STUDIO_WORKSPACE_CHANGED' });
  assert.equal(a.git(['show-ref', '--heads']).includes('aurora-studio/'), false);
});
test('unknown recipe is rejected without executing anything, corrupt records cannot impersonate another tenant', async t => {
  const a = fixture(t), initial = await task(a); let value = await proposal(a, initial.task, initial.context);
  value = (await action(a, value, 'validate')).task; value = (await action(a, value, 'stage')).task;
  await assert.rejects(action(a, value, 'verify', { recipeId: 'SHELL_COMMAND', command: 'whoami' }), { code: 'STUDIO_INVALID_FIELDS' });
  await assert.rejects(action(a, value, 'verify', { recipeId: 'SHELL_COMMAND' }), { code: 'STUDIO_CHECK_UNSUPPORTED' });
  const other = createStudio({ ...a.options, orgId: 'other-tenant' });
  await assert.rejects(other.route('GET', '/api/studio/tasks/' + value.id), { code: 'STUDIO_SOURCE_RECORD_INVALID' });
  const filename = path.join(a.stateDir, 'studio', 'tasks', value.id + '.json'); const record = JSON.parse(fs.readFileSync(filename)); record.payload.state = 'VERSION_PREPARED'; fs.writeFileSync(filename, JSON.stringify(record));
  await assert.rejects(a.studio.route('GET', '/api/studio/tasks/' + value.id), { code: 'STUDIO_RECORD_INVALID' });
});
test('new explicitly allowed file can be added but model output must be strict structured JSON', async t => {
  const a = fixture(t), initial = await task(a, ['new.json']);
  assert.equal(initial.context.files[0].beforeSha256, null);
  const generated = createStudio({ ...a.options, infer: async () => ({ text: JSON.stringify({ summary: 'Add a synthetic configuration file.', files: [{ path: 'new.json', beforeSha256: null, edits: [{ before: '', after: '{"feature":true}\n' }] }] }) }) });
  a.studio = generated; let value = (await action(a, initial.task, 'propose')).task;
  value = (await action(a, value, 'validate')).task; value = (await action(a, value, 'stage')).task;
  value = (await action(a, value, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' })).task;
  const prepared = await action(a, value, 'prepare'); assert.equal(a.git(['show', prepared.preparedVersion.commit + ':new.json']), '{"feature":true}');
  const second = await task(a); a.studio = createStudio({ ...a.options, infer: async () => ({ text: '```json\n{"command":"whoami"}\n```' }) });
  await assert.rejects(action(a, second.task, 'propose'), { code: 'STUDIO_PROPOSAL_INVALID' });
});

test('literal edits preserve complete original files and reject ambiguous or overlapping composition', async t => {
  const a = fixture(t), original = 'alpha unique\nbeta unique\nomega unchanged\n';
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic literals']); startStudioAfterFixtureSetup(a);
  const initial = await task(a, ['notes.md']);
  const submit = edits => a.studio.route('POST', '/api/studio/tasks/' + initial.task.id + '/proposal', { expectedVersion: initial.task.version,
    proposal: { summary: 'Synthetic literal edit proposal.', files: [{ path: 'notes.md', beforeSha256: initial.context.files[0].beforeSha256, edits }] } });
  for (const edits of [
    [{ before: 'missing', after: 'replacement' }], [{ before: 'unique', after: 'replacement' }],
    [{ before: 'alpha unique', after: 'first' }, { before: 'alpha', after: 'second' }],
    [{ before: 'alpha unique', after: 'beta unique' }, { before: 'beta unique', after: 'second' }],
    [{ before: '', after: 'prefix' }]
  ]) await assert.rejects(submit(edits), { code: 'STUDIO_EDIT_AMBIGUOUS' });
  const result = await submit([{ before: 'alpha unique', after: 'alpha improved' }, { before: 'beta unique', after: 'beta improved' }]);
  assert.equal(result.value.task.proposal.files[0].content, 'alpha improved\nbeta improved\nomega unchanged\n');
  assert.equal(fs.readFileSync(path.join(a.root, 'notes.md'), 'utf8'), original);
});

test('reviewable diff records a missing final newline without altering patch content', async t => {
  const a = fixture(t), initial = await task(a), value = await proposal(a, initial.task, initial.context, 'module.exports = 2;');
  const reviewed = (await a.studio.route('GET', '/api/studio/tasks/' + value.id + '/diff')).value;
  assert.match(reviewed.diff, /\+module.exports = 2;\n\\ No newline at end of file\n$/);
  assert.equal(value.proposal.files[0].content, 'module.exports = 2;');
});

test('bounded model views disclose partial line ranges and compact edits preserve unseen content', async t => {
  const a = fixture(t), original = 'first-target\n' + 'unseen remainder preserved\n'.repeat(700);
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic modular context']); startStudioAfterFixtureSetup(a);
  const initial = await task(a, ['notes.md']); let observed;
  a.studio = createStudio({ ...a.options, infer: async request => { observed = request; return { text: JSON.stringify({ summary: 'Improve the first synthetic literal.',
    files: [{ path: 'notes.md', beforeSha256: initial.context.files[0].beforeSha256, edits: [{ before: 'first-target', after: 'first-improved' }] }] }) }; } });
  const result = await action(a, initial.task, 'propose'), value = result.task;
  assert.ok(Buffer.byteLength(observed) <= 4096); assert.equal(value.modelContext.complete, false);
  assert.equal(value.modelContext.files[0].startLine, 1); assert.ok(value.modelContext.files[0].endLine < 701);
  assert.equal(value.proposal.files[0].content, original.replace('first-target', 'first-improved'));
  assert.equal(value.proposal.files[0].content.split('unseen remainder preserved').length, 701);
});

test('explicit focused context reaches later complete lines and model cannot edit unseen literals', async t => {
  const a = fixture(t), original = 'early target\n' + 'filler line\n'.repeat(500) + 'late target\n';
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic focus']); startStudioAfterFixtureSetup(a);
  const ctx = (await a.studio.route('POST', '/api/studio/context', { paths: ['notes.md'], classification: 'INTERNAL', focus: [{ path: 'notes.md', startLine: 502, endLine: 502 }] })).value.context;
  const created = (await a.studio.route('POST', '/api/studio/tasks', { contextId: ctx.id, prompt: 'Improve the focused literal only.', classification: 'INTERNAL' })).value.task;
  const generated = before => createStudio({ ...a.options, infer: async () => ({ text: JSON.stringify({ summary: 'Synthetic focused replacement.', files: [{ path: 'notes.md', beforeSha256: ctx.files[0].beforeSha256, edits: [{ before, after: 'improved target' }] }] }) }) });
  a.studio = generated('early target'); await assert.rejects(action(a, created, 'propose'), { code: 'STUDIO_EDIT_AMBIGUOUS' });
  a.studio = generated('late target'); const result = await action(a, created, 'propose');
  assert.equal(result.task.modelContext.files[0].startLine, 502); assert.equal(result.task.modelContext.files[0].endLine, 502);
  assert.equal(result.task.proposal.files[0].content, original.replace('late target', 'improved target'));
});

test('valid-looking truncated model output and oversized input never become proposals', async t => {
  const a = fixture(t), initial = await task(a);
  a.studio = createStudio({ ...a.options, infer: async () => ({ done_reason: 'length', text: JSON.stringify({ summary: 'Truncated synthetic proposal.', files: [{ path: 'app.cjs', beforeSha256: initial.context.files[0].beforeSha256, edits: [{ before: '1', after: '2' }] }] }) }) });
  await assert.rejects(action(a, initial.task, 'propose'), { code: 'STUDIO_MODEL_OUTPUT_TRUNCATED' });
  assert.equal((await a.studio.route('GET', '/api/studio/tasks/' + initial.task.id)).value.task.state, 'CONTEXT_BOUND');
  const created = (await a.studio.route('POST', '/api/studio/tasks', { contextId: initial.context.id, prompt: 'a'.repeat(6000), classification: 'INTERNAL' })).value.task;
  let calls = 0; a.studio = createStudio({ ...a.options, infer: async () => { calls++; return {}; } });
  await assert.rejects(action(a, created, 'propose'), { code: 'STUDIO_MODEL_CONTEXT_LIMIT' }); assert.equal(calls, 0);
});

test('sanitized method receipt persists with history hash, rejects extra data and clears on manual replacement', async t => {
  const a = fixture(t), initial = await task(a);
  const knowledge = { status: 'LOADED', corpusVersion: 'synthetic-v1', corpusHash: 'a'.repeat(64),
    recordIds: ['SYN-001'], loadedCount: 1, rejectedCount: 0, completeHistoricalAbsorption: false,
    selectedContextBytes: 400, maxContextBytes: 600, selectionState: 'SELECTED' };
  const output = JSON.stringify({ summary: 'Synthetic receipt-bound improvement.', files: [{ path: 'app.cjs', beforeSha256: initial.context.files[0].beforeSha256,
    edits: [{ before: '1', after: '2' }] }] });
  const infer = receipt => async () => ({ text: output, knowledge: receipt });
  for (const malformed of [{ ...knowledge, rawRecords: 'DO_NOT_STORE' }, { ...knowledge, selectedContextBytes: 601 },
    { ...knowledge, recordIds: ['../private'] }, { ...knowledge, corpusHash: 'invalid' }]) {
    a.studio = createStudio({ ...a.options, infer: infer(malformed) });
    await assert.rejects(action(a, initial.task, 'propose'), e => ['STUDIO_INVALID_FIELDS', 'STUDIO_PROPOSAL_INVALID'].includes(e.code));
    const unchanged = (await a.studio.route('GET', '/api/studio/tasks/' + initial.task.id)).value.task;
    assert.equal(unchanged.state, 'CONTEXT_BOUND'); assert.equal(unchanged.knowledge, undefined);
  }
  a.studio = createStudio({ ...a.options, infer: infer(knowledge) });
  const value = (await action(a, initial.task, 'propose')).task; assert.deepEqual(value.knowledge, knowledge);
  assert.equal(value.history.at(-1).knowledgeHash, crypto.createHash('sha256').update(JSON.stringify(knowledge)).digest('hex'));
  const restarted = createStudio(a.options), readback = (await restarted.route('GET', '/api/studio/tasks/' + value.id)).value.task;
  assert.deepEqual(readback.knowledge, knowledge);
  const manual = await proposal(a, value, initial.context); assert.equal(manual.knowledge, undefined);
  assert.equal(manual.history.at(-1).knowledgeHash, undefined); assert.equal(manual.history.at(-2).knowledgeHash, value.history.at(-1).knowledgeHash);
  assert.ok(!JSON.stringify(a.audits).includes('DO_NOT_STORE'));
});

test('edit limits, extra command fields and secrets assembled in the final file are rejected', async t => {
  const a = fixture(t), original = 'api_key = PREFIXSUFFIX\n';
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic secret-free input']); startStudioAfterFixtureSetup(a);
  const initial = await task(a, ['notes.md']);
  const submit = edits => a.studio.route('POST', '/api/studio/tasks/' + initial.task.id + '/proposal', { expectedVersion: initial.task.version,
    proposal: { summary: 'Synthetic validation of final content.', files: [{ path: 'notes.md', beforeSha256: initial.context.files[0].beforeSha256, edits }] } });
  await assert.rejects(submit([{ before: 'PREFIX', after: '"abcdefgh' }, { before: 'SUFFIX', after: 'ijklmnop"' }]), { code: 'STUDIO_SENSITIVE_CONTENT' });
  await assert.rejects(submit([{ before: 'PREFIX', after: 'x'.repeat(4001) }]), { code: 'STUDIO_CONTENT_LIMIT' });
  await assert.rejects(submit([{ before: 'PREFIX', after: 'changed', command: 'whoami' }]), { code: 'STUDIO_INVALID_FIELDS' });
});

test('catalog exposes complete-file limits and actual credential files block staging before Git mutation', async t => {
  const a = fixture(t);
  fs.writeFileSync(path.join(a.root, 'notes.md'), 'x'.repeat(30001)); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic large source']); startStudioAfterFixtureSetup(a);
  const capabilities = (await a.studio.route('GET', '/api/studio/capabilities')).value;
  assert.equal(capabilities.limits.maxFileBytes, 30000); assert.equal(capabilities.limits.modelRequestBytes, 4096);
  assert.deepEqual(capabilities.repository.fileCatalog.find(file => file.path === 'notes.md'), { path: 'notes.md', byteLength: 30001, exists: true, state: 'CONTENT_LIMIT' });
  await assert.rejects(task(a, ['notes.md']), { code: 'STUDIO_CONTENT_LIMIT' });
  fs.writeFileSync(path.join(a.root, '.env'), 'PRIVATE_VALUE=not-for-context\n'); a.git(['add', '.env']); a.git(['commit', '-m', 'Synthetic forbidden environment']); startStudioAfterFixtureSetup(a);
  const initial = await task(a); let value = await proposal(a, initial.task, initial.context); value = (await action(a, value, 'validate')).task;
  await assert.rejects(action(a, value, 'stage'), { code: 'STUDIO_GIT_TREE_UNSUPPORTED' });
  assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'workspaces')).length, 0);
});

test('environment example with a populated credential field is blocked before creating a worktree', async t => {
  const a = fixture(t);
  fs.writeFileSync(path.join(a.root, '.env.example'), 'API_KEY=synthetic-credential-must-not-copy\n');
  a.git(['add', '.env.example']); a.git(['commit', '-m', 'Synthetic unsafe environment template']); startStudioAfterFixtureSetup(a);
  const initial = await task(a); let value = await proposal(a, initial.task, initial.context);
  value = (await action(a, value, 'validate')).task;
  await assert.rejects(action(a, value, 'stage'), { code: 'STUDIO_SENSITIVE_CONTENT' });
  assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'workspaces')).length, 0);
});

test('bounded history includes the most recently changed task beyond the first hundred filenames', async t => {
  const a = fixture(t), initial = await task(a), latest = 'f'.repeat(32), older = Date.now() / 1000 - 3600;
  const folder = path.join(a.stateDir, 'studio', 'tasks');
  for (let index = 0; index < 101; index++) {
    const id = index === 100 ? latest : index.toString(16).padStart(32, '0');
    const payload = { ...initial.task, id, updatedAt: new Date(index === 100 ? (older + 3600) * 1000 : older * 1000).toISOString() };
    const file = path.join(folder, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ payload, sha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') }));
    fs.utimesSync(file, index === 100 ? older + 3600 : older, index === 100 ? older + 3600 : older);
  }
  const history = (await a.studio.route('GET', '/api/studio/tasks')).value;
  assert.equal(history.tasks.length, 100); assert.equal(history.limit, 100);
  assert.ok(history.tasks.some(value => value.id === latest));
});

// Real Git objects/worktrees with an inert, fixed-destination network broker.
// The test-only transport replaces GitHub fetch by a local fixture object copy.
function sourceFixture(t) {
  const a = fixture(t), { defaultRunner, REPOSITORY } = require('./publisher.cjs');
  let prepared = null;
  const transport = syntheticPublisher({ directory: path.dirname(a.root), orgId: a.options.orgId,
    gitExecutable, baseRevision: a.base, preparedCommit: () => prepared });
  const remote = { revision: a.base, fetches: 0, observed: 0, beforeHead: null, failFetch: false, calls: [] };
  const response = value => ({ status: 0, stdout: 'HTTP/2.0 200\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(value), stderr: '' });
  const advance = (content, parent = a.base, extra = null) => {
    const blob = a.git(['hash-object', '--no-filters', '-w', '--stdin'], content);
    let rows = a.git(['ls-tree', parent]).split('\n').map(row => row.endsWith('\tapp.cjs') ? '100644 blob ' + blob + '\tapp.cjs' : row);
    if (extra) { const extraBlob = a.git(['hash-object', '--no-filters', '-w', '--stdin'], extra.content); rows.push('100644 blob ' + extraBlob + '\t' + extra.path); }
    const tree = a.git(['mktree'], rows.join('\n') + '\n');
    return a.git(['commit-tree', tree, '-p', parent, '-m', 'Synthetic source advance']);
  };
  const target = advance('module.exports = 3;\n');
  const runner = async request => {
    remote.calls.push({ tool: request.tool, args: request.args, cwd: request.cwd });
    if (request.tool === 'gh' && request.args[1] === 'repos/' + REPOSITORY + '/branches/main') {
      remote.observed++; if (remote.beforeHead) await remote.beforeHead(remote.observed);
      return response({ name: 'main', commit: { sha: remote.revision } });
    }
    if (request.tool === 'gh' && request.args[1] === 'repos/' + REPOSITORY + '/pulls/456' && transport.remote.pull)
      return response({ ...transport.remote.pull, base: { ...transport.remote.pull.base, sha: remote.revision } });
    if (request.tool === 'git' && request.args.includes('fetch')) {
      remote.fetches++; const args = [...request.args], index = args.indexOf('fetch');
      assert.equal(args.at(-2), 'https://github.com/' + REPOSITORY + '.git');
      assert.match(args.at(-1), /^[a-f0-9]{40}$/); assert.equal(args.at(-1), remote.revision);
      for (const flag of ['--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--no-auto-maintenance']) assert(args.includes(flag));
      assert.equal(request.env.GH_HOST, 'github.com'); assert.equal(Object.hasOwn(request.env, 'GH_TOKEN'), false);
      assert.equal(request.cwd, path.join(a.stateDir, 'studio', 'source-cache'));
      if (remote.failFetch) return { status: 1, stdout: '', stderr: 'SYNTHETIC_PRIVATE_STDERR_NEVER_RETURNED' };
      args.splice(index, 0, '-c', 'protocol.file.allow=always'); args[args.length - 2] = a.root;
      return defaultRunner({ ...request, args });
    }
    return transport.runner(request);
  };
  a.options.publisherConfig = transport.config; a.options.publisherRunner = runner;
  a.studio = createStudio(a.options);
  return { ...a, remote, transport, target, advance, setPrepared: commit => { prepared = commit; } };
}
const refresh = (a, expected = a.base) => a.studio.route('POST', '/api/studio/source-refresh', { expectedLocalSourceRevision: expected });
const cursor = a => path.join(a.stateDir, 'studio', 'source-cursor.json');
const activeDirectory = a => path.join(a.stateDir, 'studio', 'sources', JSON.parse(fs.readFileSync(cursor(a), 'utf8')).payload.active.id);

test('source refresh advances only a detached verified snapshot; old audit remains immutable and new code can be prepared and published', async t => {
  const a = sourceFixture(t), initial = await task(a); let old = await proposal(a, initial.task, initial.context);
  for (const operation of ['validate', 'stage']) old = (await action(a, old, operation)).task;
  old = (await action(a, old, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' })).task;
  old = (await action(a, old, 'prepare')).task; a.setPrepared(old.preparedVersion.commit);
  const input = { expectedVersion: old.version, proposalFingerprint: old.proposalFingerprint };
  await a.studio.route('POST', '/api/studio/tasks/' + old.id + '/publish-draft', input);
  const oldBytes = fs.readFileSync(path.join(a.stateDir, 'studio', 'tasks', old.id + '.json'));
  const originalMetadata = fs.readFileSync(path.join(a.root, '.git', 'HEAD'));
  a.remote.revision = a.target;
  const result = (await refresh(a)).value.source;
  assert.equal(result.state, 'SOURCE_ACTIVATED'); assert.equal(result.headRevision, a.target);
  assert.equal(result.originalCheckoutChanged, false); assert.equal(result.snapshotVerified, true); assert.equal(result.remoteCurrent, 'NOT_OBSERVED');
  assert.equal(a.git(['rev-parse', 'HEAD']), a.base); assert.equal(a.git(['status', '--porcelain']), '');
  assert.equal(fs.readFileSync(path.join(a.root, 'app.cjs'), 'utf8'), 'module.exports = 1;\n');
  assert.deepEqual(fs.readFileSync(path.join(a.root, '.git', 'HEAD')), originalMetadata);
  assert.equal(fs.readFileSync(path.join(activeDirectory(a), 'app.cjs'), 'utf8'), 'module.exports = 3;\n');
  assert.equal(a.transport.remote.pull.state, 'open'); assert.equal(a.transport.remote.pull.draft, true);
  assert.throws(() => execFileSync(gitExecutable, ['cat-file', '-e', old.preparedVersion.commit],
    { cwd: path.join(a.stateDir, 'studio', 'source-cache'), windowsHide: true, stdio: 'pipe' }),
  'The unmerged old draft commit is absent from the cache fetched only from main.');
  assert.deepEqual(fs.readFileSync(path.join(a.stateDir, 'studio', 'tasks', old.id + '.json')), oldBytes);
  assert.match((await a.studio.route('GET', '/api/studio/tasks/' + old.id + '/diff')).value.diff, /module.exports = 2/);
  for (const operation of ['propose', 'proposal', 'validate', 'stage', 'verify', 'prepare'])
    await assert.rejects(action(a, old, operation, operation === 'verify' ? { recipeId: 'SYNTAX_AND_DIFF_V1' } : {}), { code: 'STUDIO_BASE_CHANGED' });
  await assert.rejects(a.studio.route('POST', '/api/studio/tasks/' + old.id + '/publish-draft', input), { code: 'STUDIO_BASE_CHANGED' });
  const reads = await a.studio.route('POST', '/api/studio/tasks/' + old.id + '/read-ci', input);
  assert.equal(reads.value.publication.ci.state, 'BASE_CHANGED'); assert.equal(reads.value.task.version, old.version);
  await a.studio.route('POST', '/api/studio/tasks/' + old.id + '/reconcile-publication', input);
  assert.equal(a.transport.remote.pushes, 1); assert.equal(a.transport.remote.creates, 1);
  a.studio = createStudio(a.options);
  const caps = (await a.studio.route('GET', '/api/studio/capabilities')).value;
  assert.equal(caps.repository.headRevision, a.target); assert.equal(caps.operations.sourceRefresh, 'FIXED_MAIN_SNAPSHOT_ONLY');
  await assert.rejects(a.studio.route('POST', '/api/studio/tasks', { contextId: initial.context.id, prompt: 'Old context cannot create another mutable task.', classification: 'INTERNAL' }), { code: 'STUDIO_BASE_CHANGED' });
  const next = await task(a); assert.equal(next.context.baseRevision, a.target); assert.equal(next.context.files[0].content, 'module.exports = 3;\n');
  let value = await proposal(a, next.task, next.context, 'module.exports = 4;\n');
  for (const operation of ['validate', 'stage']) value = (await action(a, value, operation)).task;
  value = (await action(a, value, 'verify', { recipeId: 'SYNTAX_AND_DIFF_V1' })).task;
  value = (await action(a, value, 'prepare')).task; assert.equal(value.preparedVersion.baseRevision, a.target);
  a.setPrepared(value.preparedVersion.commit);
  a.transport.remote.branch = null; a.transport.remote.head = null; a.transport.remote.pull = null;
  const originalRunner = a.options.publisherRunner;
  // The original synthetic publisher fixture has a fixed baseline; only its
  // test response for this new draft is advanced to the already observed main.
  a.options.publisherRunner = async request => {
    const output = await originalRunner(request);
    if (request.tool === 'gh' && request.args[0] === 'pr' && a.transport.remote.pull) a.transport.remote.pull.base.sha = a.target;
    return output;
  };
  a.studio = createStudio(a.options);
  const published = await a.studio.route('POST', '/api/studio/tasks/' + value.id + '/publish-draft', { expectedVersion: value.version, proposalFingerprint: value.proposalFingerprint });
  assert.equal(published.value.publication.state, 'DRAFT_CONFIRMED'); assert.equal(published.value.publication.baseSha, a.target);
  assert.equal(a.git(['rev-parse', 'HEAD']), a.base); assert.equal(a.git(['status', '--porcelain']), '');
  assert(!JSON.stringify(a.audits).includes(initial.task.prompt));
});

test('dirty original checkout and stale source CAS are preserved and refused before broker calls', async t => {
  const a = sourceFixture(t); a.remote.revision = a.target;
  const before = fs.readFileSync(cursor(a));
  await assert.rejects(refresh(a, 'f'.repeat(40)), { code: 'STUDIO_SOURCE_REVISION_CONFLICT' });
  fs.writeFileSync(path.join(a.root, 'app.cjs'), 'OWNER_UNCOMMITTED_BYTES\n');
  fs.writeFileSync(path.join(a.root, 'owner-notes.txt'), 'OWNER_NEW_FILE\n');
  await assert.rejects(refresh(a), { code: 'STUDIO_SOURCE_DIRTY' });
  assert.equal(fs.readFileSync(path.join(a.root, 'app.cjs'), 'utf8'), 'OWNER_UNCOMMITTED_BYTES\n');
  assert.equal(fs.readFileSync(path.join(a.root, 'owner-notes.txt'), 'utf8'), 'OWNER_NEW_FILE\n');
  assert.deepEqual(fs.readFileSync(cursor(a)), before); assert.equal(a.remote.calls.length, 0);
  assert.equal(fs.existsSync(path.join(a.stateDir, 'studio', 'source-cache')), false);
});

test('source activation shares a persistent writer lock with another refresh and context mutation', async t => {
  const a = sourceFixture(t); a.remote.revision = a.target;
  let entered, resume; const ready = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { resume = resolve; });
  a.remote.beforeHead = async count => { if (count === 1) { entered(); await wait; } };
  const pending = refresh(a); await Promise.race([ready, pending]);
  await assert.rejects(refresh(a), { code: 'STUDIO_LOCKED' });
  await assert.rejects(task(a), { code: 'STUDIO_LOCKED' });
  resume(); assert.equal((await pending).value.source.state, 'SOURCE_ACTIVATED'); assert.equal(a.remote.fetches, 1);
});

test('changed snapshot hashes block new writes on restart while immutable task history remains readable', async t => {
  const a = sourceFixture(t), initial = await task(a); a.remote.revision = a.target; await refresh(a);
  fs.writeFileSync(path.join(activeDirectory(a), 'app.cjs'), 'module.exports = 999;\n');
  a.studio = createStudio(a.options);
  assert.equal((await a.studio.route('GET', '/api/studio/tasks/' + initial.task.id)).value.task.id, initial.task.id);
  await assert.rejects(task(a), { code: 'STUDIO_SOURCE_RECORD_INVALID' });
  await assert.rejects(a.studio.route('GET', '/api/studio/capabilities'), { code: 'STUDIO_SOURCE_RECORD_INVALID' });
  assert.equal(a.git(['rev-parse', 'HEAD']), a.base);
});

test('an incomplete fetch preserves intent and blocks blind retries including after restart', async t => {
  const a = sourceFixture(t); a.remote.revision = a.target; a.remote.failFetch = true;
  await assert.rejects(refresh(a), { code: 'PUBLISH_REMOTE_UNAVAILABLE' });
  const bytes = fs.readFileSync(cursor(a)), state = JSON.parse(bytes).payload;
  assert.equal(state.operation.state, 'BLOCKED'); assert.equal(state.active, null);
  assert.equal(state.history.at(-1).state, 'REFRESH_BLOCKED'); assert(!bytes.toString().includes('PRIVATE_STDERR'));
  a.studio = createStudio(a.options);
  await assert.rejects(refresh(a), { code: 'STUDIO_SOURCE_REFRESH_BLOCKED' });
  assert.equal(a.remote.fetches, 1); assert.deepEqual(fs.readFileSync(cursor(a)), bytes);
  assert.equal((await a.studio.route('GET', '/api/studio/capabilities')).value.source.state, 'REFRESH_BLOCKED');
});

test('moving main retains a complete stale snapshot without claiming it current and permits a fresh attempt', async t => {
  const a = sourceFixture(t), next = a.advance('module.exports = 5;\n', a.target); a.remote.revision = a.target;
  a.remote.beforeHead = count => { if (count === 2) a.remote.revision = next; };
  const stale = (await refresh(a)).value.source;
  assert.equal(stale.state, 'REMOTE_MOVED'); assert.equal(stale.headRevision, a.base); assert.equal(stale.observedRevision, next);
  assert.equal(JSON.parse(fs.readFileSync(cursor(a))).payload.active, null);
  assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'sources')).length, 1);
  a.remote.beforeHead = null; assert.equal((await refresh(a)).value.source.headRevision, next);
  assert.equal(a.remote.fetches, 2); assert.equal(a.git(['rev-parse', 'HEAD']), a.base);
});

test('source records use raw-byte CAS and preserve an externally changed cursor during a broker await', async t => {
  const a = sourceFixture(t); a.remote.revision = a.target;
  a.remote.beforeHead = () => { fs.writeFileSync(cursor(a), 'EXTERNAL_CURSOR_BYTES\n'); };
  await assert.rejects(refresh(a), { code: 'STUDIO_SOURCE_REVISION_CONFLICT' });
  assert.equal(fs.readFileSync(cursor(a), 'utf8'), 'EXTERNAL_CURSOR_BYTES\n'); assert.equal(a.remote.fetches, 0);
});

test('unsafe source Git configuration and forged ref input never invoke credential/network commands', async t => {
  const a = sourceFixture(t); a.remote.revision = a.target;
  await assert.rejects(a.studio.route('POST', '/api/studio/source-refresh', { expectedLocalSourceRevision: a.base, branch: 'other' }), { code: 'STUDIO_INVALID_FIELDS' });
  await assert.rejects(refresh(a, '--upload-pack=arbitrary'), { code: 'STUDIO_INVALID_FIELDS' });
  assert.equal(a.remote.calls.length, 0);
  a.git(['config', 'url.https://evil.invalid/.insteadOf', 'https://github.com/']);
  await assert.rejects(refresh(a), { code: 'PUBLISH_LOCAL_CONFIGURATION_UNSAFE' });
  assert.equal(a.remote.calls.filter(c => c.tool === 'gh').length, 0); assert.equal(a.remote.fetches, 0);
  assert.equal(JSON.parse(fs.readFileSync(cursor(a))).payload.operation, null);
});

test('unsafe remote tree and oversized blobs are rejected before a source worktree is created', async t => {
  for (const mode of ['secret-path', 'large-blob']) {
    await t.test(mode, async child => {
      const a = sourceFixture(child);
      a.remote.revision = mode === 'secret-path' ? a.advance('module.exports = 3;\n', a.base, { path: '.env', content: 'PRIVATE_NOT_ALLOWED\n' })
        : a.advance('x'.repeat(2 * 1024 * 1024 + 1));
      await assert.rejects(refresh(a), { code: mode === 'secret-path' ? 'STUDIO_GIT_TREE_UNSUPPORTED' : 'STUDIO_CONTENT_LIMIT' });
      assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'sources')).length, 0);
      assert.equal(JSON.parse(fs.readFileSync(cursor(a))).payload.operation.state, 'BLOCKED');
      assert.equal(a.git(['rev-parse', 'HEAD']), a.base);
    });
  }
});

test('diff trims common lines to three of context and preserves complete files and newline-only edits', async t => {
  const a = fixture(t), original = Array.from({ length: 100 }, (_, i) => 'line ' + (i + 1)).join('\n') + '\n';
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic long review source']); startStudioAfterFixtureSetup(a);
  const initial = await task(a, ['notes.md']), modified = original.replace('line 50\n', 'changed 50\n');
  const value = await proposal(a, initial.task, initial.context, modified);
  const result = (await a.studio.route('GET', '/api/studio/tasks/' + value.id + '/diff')).value.diff;
  assert.match(result, /@@ -47,7 \+47,7 @@/); assert.match(result, /-line 50\n\+changed 50\n/);
  assert.equal(result.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).length, 1);
  assert.equal(result.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).length, 1);
  assert(!result.includes('line 46\n')); assert(!result.includes('line 54\n')); assert.equal(value.proposal.files[0].content, modified);
  const newlineTask = await task(a, ['notes.md']), newline = await proposal(a, newlineTask.task, newlineTask.context, original.slice(0, -1));
  const newlineDiff = (await a.studio.route('GET', '/api/studio/tasks/' + newline.id + '/diff')).value.diff;
  assert.match(newlineDiff, /-line 100\n\+line 100\n\\ No newline at end of file/);
});

test('initial source cursor pins HEAD at revision zero and Git replacement refs cannot forge source content', async t => {
  const a = sourceFixture(t);
  a.git(['replace', a.base, a.target]);
  const initial = await task(a); assert.equal(initial.context.baseRevision, a.base); assert.equal(initial.context.files[0].content, 'module.exports = 1;\n');
  a.remote.revision = a.target; await refresh(a);
  const cache = path.join(a.stateDir, 'studio', 'source-cache');
  execFileSync(gitExecutable, ['replace', a.target, a.base], { cwd: cache, windowsHide: true, encoding: 'utf8', stdio: 'pipe' });
  a.studio = createStudio(a.options);
  assert.equal((await task(a)).context.files[0].content, 'module.exports = 3;\n');
  const b = fixture(t); b.git(['update-ref', 'HEAD', b.git(['commit-tree', b.git(['rev-parse', 'HEAD^{tree}']), '-p', b.base, '-m', 'Unexpected fixture HEAD advance'])]);
  await assert.rejects(task(b), { code: 'STUDIO_BASE_CHANGED' });
  await assert.rejects(b.studio.route('GET', '/api/studio/capabilities'), { code: 'STUDIO_BASE_CHANGED' });
  assert.equal(JSON.parse(fs.readFileSync(cursor(b))).payload.version, 0);
});

test('explicit blocked recovery uses receipt CAS, preserves failed files/history and never performs an automatic fetch', async t => {
  const a = sourceFixture(t); a.remote.revision = a.target; a.remote.failFetch = true;
  await assert.rejects(refresh(a), { code: 'PUBLISH_REMOTE_UNAVAILABLE' });
  const caps = (await a.studio.route('GET', '/api/studio/capabilities')).value;
  const recover = body => a.studio.route('POST', '/api/studio/source-recover', body);
  const input = { expectedLocalSourceRevision: caps.repository.headRevision, expectedSourceReceiptSha256: caps.source.receiptSha256 };
  const before = fs.readFileSync(cursor(a));
  await assert.rejects(recover({ ...input, expectedSourceReceiptSha256: 'f'.repeat(64) }), { code: 'STUDIO_SOURCE_REVISION_CONFLICT' });
  await assert.rejects(recover({ ...input, deletePartial: true }), { code: 'STUDIO_INVALID_FIELDS' });
  fs.writeFileSync(path.join(a.root, 'owner-note.txt'), 'PRESERVED_OWNER_BYTES\n');
  await assert.rejects(recover(input), { code: 'STUDIO_SOURCE_DIRTY' }); assert.deepEqual(fs.readFileSync(cursor(a)), before);
  fs.unlinkSync(path.join(a.root, 'owner-note.txt'));
  const result = (await recover(input)).value.source;
  assert.equal(result.state, 'SOURCE_RECOVERED'); assert.equal(result.headRevision, a.base); assert.equal(result.snapshotVerified, false);
  assert.equal(a.remote.fetches, 1); assert.equal(fs.existsSync(path.join(a.stateDir, 'studio', 'source-cache')), true);
  const state = JSON.parse(fs.readFileSync(cursor(a))).payload;
  assert.equal(state.operation, null); assert.equal(state.active, null); assert.equal(state.history.at(-1).state, 'SOURCE_RECOVERED');
  assert.equal(state.history.filter(e => e.state === 'REFRESH_BLOCKED').length, 1);
  a.remote.failFetch = false; assert.equal((await refresh(a)).value.source.headRevision, a.target); assert.equal(a.remote.fetches, 2);
});

test('interrupted own source refresh archives only its dead process lock and recovers without activating partial files', async t => {
  const a = sourceFixture(t), { spawn } = require('node:child_process'); a.remote.revision = a.target;
  const script = String.raw`
    const {createStudio}=require(process.argv[1]); const {defaultRunner,REPOSITORY}=require(process.argv[2]);
    const options=JSON.parse(process.argv[3]), target=process.argv[4], base=process.argv[5];
    const json=value=>({status:0,stdout:'HTTP/2.0 200\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(value),stderr:''});
    options.publisherRunner=async request=>{
      if(request.tool==='git') { if(request.args.includes('fetch')) {process.stdout.write('OWN_REFRESH_INTENT\n');return new Promise(()=>{});} return defaultRunner(request); }
      const endpoint=request.args[1]; if(endpoint==='user')return json({login:'GESTAOWMGJ'});
      if(endpoint==='repos/'+REPOSITORY)return json({full_name:REPOSITORY,default_branch:'main',archived:false,permissions:{push:true}});
      if(endpoint==='repos/'+REPOSITORY+'/branches/main')return json({name:'main',commit:{sha:target}}); throw Error('unexpected fixture operation');
    };
    const studio=createStudio(options); setInterval(()=>{},1000);
    studio.route('POST','/api/studio/source-refresh',{expectedLocalSourceRevision:base}).catch(()=>{process.stdout.write('FIXTURE_FAILED\n');process.exit(1);});`;
  const child = spawn(process.execPath, ['-e', script, require.resolve('./studio.cjs'), require.resolve('./publisher.cjs'),
    JSON.stringify({ stateDir: a.stateDir, orgId: a.options.orgId, repository: a.repository, publisherConfig: a.options.publisherConfig }), a.target, a.base],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: require('./publisher.cjs').environment() });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } });
  await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(Error('Own fixture source process did not reach its intent.')), 60000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('OWN_REFRESH_INTENT\n')) { clearTimeout(timeout); resolve(); }
      else if (output.includes('FIXTURE_FAILED')) { clearTimeout(timeout); reject(Error('Own fixture source process failed.')); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  const lock = path.join(a.stateDir, 'studio', 'source.lock'), original = fs.readFileSync(lock);
  const owned = JSON.parse(original).payload; assert.equal(owned.pid, child.pid); assert.match(owned.nonce, /^[a-f0-9]{32}$/);
  child.kill('SIGKILL'); await closed;
  const source = (await a.studio.route('GET', '/api/studio/capabilities')).value.source;
  assert.equal(source.state, 'REFRESH_BLOCKED'); assert.equal(source.sourceLockSha256, crypto.createHash('sha256').update(original).digest('hex'));
  const input = { expectedLocalSourceRevision: source.headRevision, expectedSourceReceiptSha256: source.receiptSha256,
    expectedSourceLockSha256: source.sourceLockSha256 };
  await assert.rejects(a.studio.route('POST', '/api/studio/source-recover', { ...input, expectedSourceLockSha256: 'f'.repeat(64) }), { code: 'STUDIO_LOCKED' });
  assert.deepEqual(fs.readFileSync(lock), original);
  const recovered = (await a.studio.route('POST', '/api/studio/source-recover', input)).value.source;
  assert.equal(recovered.state, 'SOURCE_RECOVERED'); assert.equal(recovered.headRevision, a.base); assert.equal(recovered.snapshotVerified, false);
  const archives = fs.readdirSync(path.join(a.stateDir, 'studio', 'lock-archives')); assert.equal(archives.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(a.stateDir, 'studio', 'lock-archives', archives[0])), original);
  assert.equal(fs.existsSync(lock), false); assert.equal(a.remote.fetches, 0); assert.equal(a.git(['rev-parse', 'HEAD']), a.base);
  const state = JSON.parse(fs.readFileSync(cursor(a))).payload; assert.equal(state.active, null); assert.equal(state.operation, null);
  assert.equal(state.history.at(-1).archivedLockSha256, source.sourceLockSha256);
  assert.equal((await refresh(a)).value.source.headRevision, a.target);
});

test('empty, unknown and live-process locks cannot be archived or replaced during recovery', async t => {
  const a = sourceFixture(t); a.remote.revision = a.target; a.remote.failFetch = true;
  await assert.rejects(refresh(a), { code: 'PUBLISH_REMOTE_UNAVAILABLE' });
  const caps = (await a.studio.route('GET', '/api/studio/capabilities')).value, file = path.join(a.stateDir, 'studio', 'source.lock');
  const state = JSON.parse(fs.readFileSync(cursor(a))).payload;
  const payload = { schemaVersion: 'aurora.master.source-lock.v1', orgId: a.options.orgId, bindingSha256: state.bindingSha256,
    nonce: state.operation.lockNonce, pid: process.pid, processStartedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  for (const bytes of [Buffer.alloc(0), Buffer.from('UNKNOWN_LOCK_BYTES\n'), Buffer.from(JSON.stringify({ payload, sha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') }))]) {
    fs.writeFileSync(file, bytes);
    await assert.rejects(a.studio.route('POST', '/api/studio/source-recover', { expectedLocalSourceRevision: a.base,
      expectedSourceReceiptSha256: caps.source.receiptSha256, expectedSourceLockSha256: crypto.createHash('sha256').update(bytes).digest('hex') }), { code: 'STUDIO_LOCKED' });
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(fs.existsSync(path.join(a.stateDir, 'studio', 'lock-archives')), false);
  }
});

test('crash during a model proposal recovers the dead global lock without changing the old task or its per-task lock', async t => {
  const a = sourceFixture(t), initial = await task(a), { spawn } = require('node:child_process');
  const script = String.raw`
    const {createStudio}=require(process.argv[1]), options=JSON.parse(process.argv[2]), task=JSON.parse(process.argv[3]);
    options.infer=()=>{process.stdout.write('OWN_MODEL_WAIT\n');return new Promise(()=>{});};
    const studio=createStudio(options);setInterval(()=>{},1000);
    studio.route('POST','/api/studio/tasks/'+task.id+'/propose',{expectedVersion:task.version}).catch(()=>{process.stdout.write('FIXTURE_FAILED\n');process.exit(1);});`;
  const child = spawn(process.execPath, ['-e', script, require.resolve('./studio.cjs'),
    JSON.stringify({ stateDir: a.stateDir, orgId: a.options.orgId, repository: a.repository, publisherConfig: a.options.publisherConfig }), JSON.stringify(initial.task)],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: require('./publisher.cjs').environment() });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } });
  await new Promise((resolve, reject) => { let output = ''; const timeout = setTimeout(() => reject(Error('Own model fixture did not reach its await.')), 60000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('OWN_MODEL_WAIT\n')) { clearTimeout(timeout); resolve(); }
      else if (output.includes('FIXTURE_FAILED')) { clearTimeout(timeout); reject(Error('Own model fixture failed.')); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); }); });
  const taskFile = path.join(a.stateDir, 'studio', 'tasks', initial.task.id + '.json'), taskBytes = fs.readFileSync(taskFile);
  assert.equal(JSON.parse(fs.readFileSync(cursor(a))).payload.operation, null);
  child.kill('SIGKILL'); await closed;
  const source = (await a.studio.route('GET', '/api/studio/capabilities')).value.source;
  assert.equal(source.state, 'REFRESH_BLOCKED'); assert.match(source.sourceLockSha256, /^[a-f0-9]{64}$/);
  const recovered = await a.studio.route('POST', '/api/studio/source-recover', { expectedLocalSourceRevision: source.headRevision,
    expectedSourceReceiptSha256: source.receiptSha256, expectedSourceLockSha256: source.sourceLockSha256 });
  assert.equal(recovered.value.source.state, 'SOURCE_RECOVERED'); assert.equal(recovered.value.source.headRevision, a.base);
  assert.deepEqual(fs.readFileSync(taskFile), taskBytes); assert.equal(fs.existsSync(taskFile + '.lock'), true);
  assert.equal((await a.studio.route('GET', '/api/studio/tasks/' + initial.task.id)).value.task.version, initial.task.version);
  assert.notEqual((await task(a)).task.id, initial.task.id); assert.equal(a.remote.fetches, 0);
  assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'lock-archives')).length, 1);
});

test('ordinary lock cleanup preserves an unknown replacement and refuses to delete a different owner file', async t => {
  const a = fixture(t), initial = await task(a); let entered, resume;
  const ready = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { resume = resolve; });
  a.studio = createStudio({ ...a.options, infer: async () => { entered(); await wait; return { text: '{}' }; } });
  const pending = action(a, initial.task, 'propose'); await Promise.race([ready, pending]);
  const file = path.join(a.stateDir, 'studio', 'source.lock'), saved = path.join(a.stateDir, 'studio', 'fixture-old-lock.json');
  fs.renameSync(file, saved); fs.writeFileSync(file, 'UNKNOWN_REPLACEMENT_BYTES\n'); resume();
  await assert.rejects(pending, { code: 'STUDIO_PROPOSAL_INVALID' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'UNKNOWN_REPLACEMENT_BYTES\n'); assert.equal(fs.existsSync(saved), true);
  await assert.rejects(task(a), { code: 'STUDIO_LOCKED' });
});

test('partial source materialization is preserved across explicit recovery and a new verified attempt', async t => {
  const a = sourceFixture(t); a.remote.revision = a.target;
  const originalWrite = fs.writeFileSync, sources = path.join(a.stateDir, 'studio', 'sources') + path.sep;
  fs.writeFileSync = function (filename, ...args) {
    if (typeof filename === 'string' && filename.startsWith(sources) && path.basename(filename) === 'app.cjs') throw new StudioError('STUDIO_OPERATION_BLOCKED');
    return originalWrite.call(this, filename, ...args);
  };
  try { await assert.rejects(refresh(a), { code: 'STUDIO_OPERATION_BLOCKED' }); } finally { fs.writeFileSync = originalWrite; }
  const dirs = fs.readdirSync(path.join(a.stateDir, 'studio', 'sources')); assert.equal(dirs.length, 1);
  const partial = path.join(a.stateDir, 'studio', 'sources', dirs[0]);
  const retained = fs.readFileSync(path.join(partial, '.env.example'));
  assert.equal(fs.existsSync(path.join(partial, 'app.cjs')), false);
  const caps = (await a.studio.route('GET', '/api/studio/capabilities')).value;
  assert.equal(caps.source.state, 'REFRESH_BLOCKED'); assert.equal(caps.source.snapshotVerified, false);
  await assert.rejects(refresh(a), { code: 'STUDIO_SOURCE_REFRESH_BLOCKED' }); assert.equal(a.remote.fetches, 1);
  await a.studio.route('POST', '/api/studio/source-recover', { expectedLocalSourceRevision: caps.source.headRevision, expectedSourceReceiptSha256: caps.source.receiptSha256 });
  assert.deepEqual(fs.readFileSync(path.join(partial, '.env.example')), retained); assert.equal(a.remote.fetches, 1);
  assert.equal((await refresh(a)).value.source.headRevision, a.target); assert.equal(a.remote.fetches, 2);
  assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'sources')).length, 2);
  assert.deepEqual(fs.readFileSync(path.join(partial, '.env.example')), retained); assert.equal(a.git(['rev-parse', 'HEAD']), a.base);
});

test('initialization and restart preserve an existing valid cursor byte for byte', async t => {
  const a = fixture(t), file = cursor(a), record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const retained = Buffer.from(JSON.stringify(record, null, 2) + '\n'); fs.writeFileSync(file, retained);
  a.studio = createStudio(a.options);
  assert.equal((await a.studio.route('GET', '/api/studio/capabilities')).value.source.headRevision, a.base);
  assert.deepEqual(fs.readFileSync(file), retained);
  const next = await task(a); assert.equal(next.context.baseRevision, a.base); assert.deepEqual(fs.readFileSync(file), retained);
});

test('concurrent initializers never overwrite an exclusively opened cursor and can read it after the writer finishes', async t => {
  const a = fixture(t), file = cursor(a), retained = fs.readFileSync(file); fs.unlinkSync(file);
  const { spawn } = require('node:child_process');
  const script = String.raw`
    const fs=require('node:fs'),path=require('node:path'),options=JSON.parse(process.argv[2]);
    const file=path.join(options.stateDir,'studio','source-cursor.json'),open=fs.openSync;
    if(process.argv[3]==='pause')fs.openSync=function(filename,flags,...rest){const fd=open.call(this,filename,flags,...rest);
      if(filename===file&&flags==='wx'){process.stdout.write('OWN_INITIALIZER_OPENED\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,4000);}return fd;};
    const studio=require(process.argv[1]).createStudio(options);
    async function read(){try{const value=await studio.route('GET','/api/studio/capabilities');process.stdout.write(value.value.repository.state==='AVAILABLE'?'AVAILABLE\n':'CLOSED\n');}
      catch{process.stdout.write('CLOSED\n');}}
    read().then(()=>setTimeout(async()=>{await read();},4500));`;
  const children = [], launch = mode => {
    const child = spawn(process.execPath, ['-e', script, require.resolve('./studio.cjs'), JSON.stringify(a.options), mode],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: require('./publisher.cjs').environment() });
    const value = { child, output: '', closed: new Promise(resolve => child.once('close', resolve)) };
    child.stdout.on('data', chunk => { value.output += chunk; }); children.push(value); return value;
  };
  t.after(async () => { for (const value of children) if (value.child.exitCode === null && value.child.signalCode === null) { value.child.kill('SIGKILL'); await value.closed; } });
  const first = launch('pause');
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Own initializer did not reach the exclusive open.')), 60000);
    first.child.stdout.on('data', () => { if (first.output.includes('OWN_INITIALIZER_OPENED\n')) { clearTimeout(timer); resolve(); } });
    first.child.once('error', error => { clearTimeout(timer); reject(error); }); });
  const second = launch('normal');
  assert.equal(await first.closed, 0); assert.equal(await second.closed, 0);
  assert(first.output.includes('AVAILABLE\n')); assert(second.output.includes('CLOSED\n'), 'Incomplete concurrent cursor stays closed.');
  assert(second.output.endsWith('AVAILABLE\n'), 'A later read accepts only the completed valid cursor.');
  assert.deepEqual(fs.readFileSync(file), retained); a.studio = createStudio(a.options);
  assert.equal((await task(a)).context.baseRevision, a.base);
});

test('initialization refuses an opening error other than EEXIST instead of accepting an absent cursor', async t => {
  const a = fixture(t), file = cursor(a); fs.unlinkSync(file); const original = fs.openSync;
  fs.openSync = function (filename, flags, ...rest) {
    if (filename === file && flags === 'wx') throw Object.assign(Error('SYNTHETIC_OPEN_DENIED'), { code: 'EACCES' });
    return original.call(this, filename, flags, ...rest);
  };
  try { a.studio = createStudio(a.options); } finally { fs.openSync = original; }
  assert.equal(fs.existsSync(file), false);
  await assert.rejects(a.studio.route('GET', '/api/studio/capabilities'), { code: 'STUDIO_SOURCE_RECORD_INVALID' });
});

test('initialization preserves an incomplete cursor and does not mistake a write failure for opening EEXIST', async t => {
  const a = fixture(t), file = cursor(a); fs.unlinkSync(file);
  const open = fs.openSync, write = fs.writeFileSync; let descriptor;
  fs.openSync = function (filename, flags, ...rest) { const fd = open.call(this, filename, flags, ...rest); if (filename === file && flags === 'wx') descriptor = fd; return fd; };
  fs.writeFileSync = function (filename, ...rest) {
    if (filename === descriptor) throw Object.assign(Error('SYNTHETIC_WRITE_INTERRUPTED'), { code: 'EEXIST' });
    return write.call(this, filename, ...rest);
  };
  try { a.studio = createStudio(a.options); } finally { fs.openSync = open; fs.writeFileSync = write; }
  assert.equal(fs.readFileSync(file).length, 0);
  await assert.rejects(a.studio.route('GET', '/api/studio/capabilities'), { code: 'STUDIO_SOURCE_RECORD_INVALID' });
  a.studio = createStudio(a.options); assert.equal(fs.readFileSync(file).length, 0);
  await assert.rejects(task(a), { code: 'STUDIO_SOURCE_RECORD_INVALID' });
});

function fencedFixture(t) {
  const a = fixture(t), keys = crypto.generateKeyPairSync('ed25519');
  const options = { ...a.options, writerFenceAuthority: { keyId: 'synthetic-control-plane',
    publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }) } };
  const receiver = createStudio(options);
  const sign = (destinationId, overrides = {}) => {
    const payload = { schemaVersion: 'aurora.local-writer-fence.v1',
      guardianId: 'AURORA-REALTIME-PLATFORM-GUARDIAN-001', keyId: 'synthetic-control-plane',
      orgId: a.options.orgId, resourceKey: 'canonical-data', destinationId,
      epoch: 10, previousFenceSha256: null, handoffId: 'c'.repeat(32), phase: 'FENCED', ...overrides };
    return { payload, signature: crypto.sign(null, Buffer.from(JSON.stringify(payload)), keys.privateKey).toString('base64') };
  };
  return { ...a, receiver, sign, options, keys };
}
const fenceCapabilities = async studio => (await studio.route('GET', '/api/studio/capabilities')).value.writerFence;
const sourceBytes = a => fs.readFileSync(path.join(a.stateDir, 'studio', 'source-cursor.json'));

test('signed destination fence survives restart and blocks already-created and keyless writers', async t => {
  const a = fencedFixture(t), initial = await task(a);
  const { destinationId } = await fenceCapabilities(a.receiver), proof = a.sign(destinationId);
  const receipt = await a.receiver.installWriterFence(proof);
  assert.equal(receipt.state, 'FENCED_READ_ONLY'); assert.equal(receipt.cloudHandoffVerified, false);
  assert.equal(receipt.epoch, 10); assert.equal(receipt.allLocalWritersEnforced, false);
  const before = sourceBytes(a);
  assert.deepEqual(await a.receiver.installWriterFence(proof), receipt, 'lost acknowledgement reuses the original receipt');
  assert.deepEqual(sourceBytes(a), before);
  for (const writer of [a.studio, a.receiver, createStudio(a.options), createStudio(a.options)]) {
    await assert.rejects(writer.route('POST', '/api/studio/context', { paths: ['app.cjs'], classification: 'INTERNAL' }), { code: 'STUDIO_WRITER_FENCED' });
    await assert.rejects(proposal({ ...a, studio: writer }, initial.task, initial.context), { code: 'STUDIO_WRITER_FENCED' });
    const history = (await writer.route('GET', '/api/studio/tasks')).value.tasks;
    assert.equal(history.length, 1); assert.equal(history[0].version, initial.task.version);
  }
  assert.deepEqual(sourceBytes(a), before); assert.equal(a.git(['rev-parse', 'HEAD']), a.base);
});

test('destination refuses forged authority, wrong scope, unknown fields and rollback epochs without effects', async t => {
  const a = fencedFixture(t), { destinationId } = await fenceCapabilities(a.receiver), before = sourceBytes(a);
  const variants = [a.sign(destinationId, { orgId: 'another-tenant' }), a.sign('f'.repeat(64)),
    a.sign(destinationId, { resourceKey: 'other-resource' }), a.sign(destinationId, { epoch: Number.MAX_SAFE_INTEGER + 1 }),
    a.sign(destinationId, { phase: 'ACTIVE' }), a.sign(destinationId, { extra: true }),
    a.sign(destinationId, { keyId: 'unknown-key' }), a.sign(destinationId, { epoch: 0 })];
  const forged = a.sign(destinationId); forged.payload.epoch++;
  variants.push(forged);
  for (const proof of variants) {
    await assert.rejects(a.receiver.installWriterFence(proof)); assert.deepEqual(sourceBytes(a), before);
  }
  await assert.rejects(a.studio.installWriterFence(a.sign(destinationId)), { code: 'STUDIO_WRITER_FENCE_UNAVAILABLE' });
  const first = await a.receiver.installWriterFence(a.sign(destinationId));
  const stable = sourceBytes(a);
  for (const overrides of [{ epoch: 9 }, { epoch: 10, handoffId: 'd'.repeat(32) }, { epoch: 11 }]) {
    await assert.rejects(a.receiver.installWriterFence(a.sign(destinationId, overrides)), { code: 'STUDIO_WRITER_FENCE_CONFLICT' });
    assert.deepEqual(sourceBytes(a), stable);
  }
  const next = await a.receiver.installWriterFence(a.sign(destinationId, { epoch: 11, previousFenceSha256: first.fenceSha256 }));
  assert.equal(next.epoch, 11); assert.notEqual(next.fenceSha256, first.fenceSha256);
  await assert.rejects(a.receiver.installWriterFence(a.sign(destinationId)), { code: 'STUDIO_WRITER_FENCE_CONFLICT' });
});

test('handoff cannot acknowledge while a writer is awaiting a model under the same destination lock', async t => {
  const a = fencedFixture(t); let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  a.studio = createStudio({ ...a.options, infer: async () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  const initial = await task(a), { destinationId } = await fenceCapabilities(a.receiver);
  const pending = a.studio.route('POST', '/api/studio/tasks/' + initial.task.id + '/propose', { expectedVersion: initial.task.version });
  // Attach a handler before releasing the synthetic inference failure.
  const completion = pending.catch(error => error);
  await waiting;
  await assert.rejects(a.receiver.installWriterFence(a.sign(destinationId)), { code: 'STUDIO_LOCKED' });
  assert.equal((await fenceCapabilities(a.receiver)).state, 'LEGACY_UNFENCED');
  release({ invalid: true }); await completion;
  assert.equal((await a.receiver.installWriterFence(a.sign(destinationId))).state, 'FENCED_READ_ONLY');
  await assert.rejects(a.studio.route('POST', '/api/studio/context', { paths: ['app.cjs'], classification: 'INTERNAL' }), { code: 'STUDIO_WRITER_FENCED' });
});

test('fencing is not an HTTP/model capability and cannot be removed through recovery', async t => {
  const a = fencedFixture(t), { destinationId } = await fenceCapabilities(a.receiver), proof = a.sign(destinationId);
  await assert.rejects(a.receiver.route('POST', '/api/studio/writer-fence', proof), { code: 'STUDIO_NOT_FOUND' });
  await a.receiver.installWriterFence(proof);
  await assert.rejects(a.receiver.route('POST', '/api/studio/source-recover', {}), { code: 'STUDIO_WRITER_FENCED' });
  assert.equal((await fenceCapabilities(a.receiver)).state, 'FENCED_READ_ONLY');
});

for (const phase of ['before-commit', 'after-ack']) test('destination barrier SIGKILL ' + phase + ' retains an honest recoverable state', async t => {
  const a = fencedFixture(t), { destinationId } = await fenceCapabilities(a.receiver);
  const proof = a.sign(destinationId), { spawn } = require('node:child_process');
  const script = String.raw`
    const fs=require('node:fs'), {createStudio}=require(process.argv[1]);
    const options=JSON.parse(process.argv[2]), proof=JSON.parse(process.argv[3]), phase=process.argv[4];
    const studio=createStudio(options);
    if(phase==='before-commit') {
      const rename=fs.renameSync;
      fs.renameSync=(from,to)=>{if(to.endsWith('source-cursor.json'))process.kill(process.pid,'SIGKILL');return rename(from,to);};
    }
    studio.installWriterFence(proof).then(()=>process.kill(process.pid,'SIGKILL')).catch(()=>process.exit(7));`;
  const child = spawn(process.execPath, ['-e', script, require.resolve('./studio.cjs'), JSON.stringify(a.options), JSON.stringify(proof), phase],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: require('./publisher.cjs').environment() });
  const outcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('fence crash fixture timed out')); }, 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.notEqual(outcome.code, 7, 'child reached the deliberate process termination');
  const restarted = createStudio(a.options), status = await fenceCapabilities(restarted);
  if (phase === 'before-commit') {
    assert.equal(status.state, 'LEGACY_UNFENCED');
    assert.ok(fs.existsSync(path.join(a.stateDir, 'studio', 'source.lock')));
    await assert.rejects(restarted.installWriterFence(proof), { code: 'STUDIO_LOCKED' });
    await assert.rejects(restarted.route('POST', '/api/studio/context', { paths: ['app.cjs'], classification: 'INTERNAL' }), { code: 'STUDIO_LOCKED' });
  } else {
    assert.equal(status.state, 'FENCED_READ_ONLY');
    assert.deepEqual(await restarted.installWriterFence(proof), status);
    await assert.rejects(restarted.route('POST', '/api/studio/context', { paths: ['app.cjs'], classification: 'INTERNAL' }), { code: 'STUDIO_WRITER_FENCED' });
  }
});
