'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createStudio, StudioError } = require('./studio.cjs');
const gitExecutable = process.env.AURORA_STUDIO_TEST_GIT;
assert.ok(gitExecutable && path.isAbsolute(gitExecutable), 'Set AURORA_STUDIO_TEST_GIT to the existing Git executable.');
const fixture = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-studio-contract-'));
  const root = path.join(directory, 'repo'), stateDir = path.join(directory, 'state');
  fs.mkdirSync(root); fs.mkdirSync(stateDir);
  const gitEnv = { PATH: process.env.PATH || process.env.Path, SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP, TMP: process.env.TMP, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const git = args => execFileSync(gitExecutable, ['-c', 'core.fsmonitor=false', ...args],
    { cwd: root, env: gitEnv, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
  fs.writeFileSync(path.join(a.root, '.gitattributes'), 'app.cjs filter=trap\n'); a.git(['add', '--', '.gitattributes']); a.git(['commit', '-m', 'Synthetic attribute']);
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
  await assert.rejects(other.route('GET', '/api/studio/tasks/' + value.id), { code: 'STUDIO_RECORD_INVALID' });
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
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic literals']);
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
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic modular context']);
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
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic focus']);
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
  fs.writeFileSync(path.join(a.root, 'notes.md'), original); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic secret-free input']);
  const initial = await task(a, ['notes.md']);
  const submit = edits => a.studio.route('POST', '/api/studio/tasks/' + initial.task.id + '/proposal', { expectedVersion: initial.task.version,
    proposal: { summary: 'Synthetic validation of final content.', files: [{ path: 'notes.md', beforeSha256: initial.context.files[0].beforeSha256, edits }] } });
  await assert.rejects(submit([{ before: 'PREFIX', after: '"abcdefgh' }, { before: 'SUFFIX', after: 'ijklmnop"' }]), { code: 'STUDIO_SENSITIVE_CONTENT' });
  await assert.rejects(submit([{ before: 'PREFIX', after: 'x'.repeat(4001) }]), { code: 'STUDIO_CONTENT_LIMIT' });
  await assert.rejects(submit([{ before: 'PREFIX', after: 'changed', command: 'whoami' }]), { code: 'STUDIO_INVALID_FIELDS' });
});

test('catalog exposes complete-file limits and actual credential files block staging before Git mutation', async t => {
  const a = fixture(t);
  fs.writeFileSync(path.join(a.root, 'notes.md'), 'x'.repeat(30001)); a.git(['add', 'notes.md']); a.git(['commit', '-m', 'Synthetic large source']);
  const capabilities = (await a.studio.route('GET', '/api/studio/capabilities')).value;
  assert.equal(capabilities.limits.maxFileBytes, 30000); assert.equal(capabilities.limits.modelRequestBytes, 4096);
  assert.deepEqual(capabilities.repository.fileCatalog.find(file => file.path === 'notes.md'), { path: 'notes.md', byteLength: 30001, exists: true, state: 'CONTENT_LIMIT' });
  await assert.rejects(task(a, ['notes.md']), { code: 'STUDIO_CONTENT_LIMIT' });
  fs.writeFileSync(path.join(a.root, '.env'), 'PRIVATE_VALUE=not-for-context\n'); a.git(['add', '.env']); a.git(['commit', '-m', 'Synthetic forbidden environment']);
  const initial = await task(a); let value = await proposal(a, initial.task, initial.context); value = (await action(a, value, 'validate')).task;
  await assert.rejects(action(a, value, 'stage'), { code: 'STUDIO_GIT_TREE_UNSUPPORTED' });
  assert.equal(fs.readdirSync(path.join(a.stateDir, 'studio', 'workspaces')).length, 0);
});

test('environment example with a populated credential field is blocked before creating a worktree', async t => {
  const a = fixture(t);
  fs.writeFileSync(path.join(a.root, '.env.example'), 'API_KEY=synthetic-credential-must-not-copy\n');
  a.git(['add', '.env.example']); a.git(['commit', '-m', 'Synthetic unsafe environment template']);
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
