'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createPublisher, environment, defaultRunner, REPOSITORY } = require('./publisher.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fp = value => hash(JSON.stringify(value));
const OTHER = 'f'.repeat(40);
function gitExecutable() {
  if (process.env.AURORA_STUDIO_TEST_GIT) return process.env.AURORA_STUDIO_TEST_GIT;
  if (process.platform === 'win32') return 'C:\\Program Files\\Git\\cmd\\git.exe';
  try { return execFileSync('which', ['git'], { encoding: 'utf8' }).trim(); } catch { return null; }
}
async function fixture(t) {
  const gitPath = gitExecutable();
  if (!gitPath || !fs.existsSync(gitPath)) { t.skip('Git real indisponível: testes do adaptador não foram verificados neste ambiente.'); return null; }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-publisher-'));
  t.after(() => {
    const target = fs.realpathSync(directory), temporaryRoot = fs.realpathSync(os.tmpdir());
    assert.ok(target.startsWith(temporaryRoot + path.sep));
    assert.match(path.basename(target), /^aurora-publisher-[A-Za-z0-9]{6}$/);
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    fs.rmSync(target, { recursive: true, force: true });
  });
  const root = path.join(directory, 'repo'), stateDir = path.join(directory, 'private-state');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.mkdirSync(stateDir);
  const ghPath = path.join(directory, process.platform === 'win32' ? 'gh.exe' : 'gh');
  fs.writeFileSync(ghPath, 'INERT FIXTURE: this file is never executed\n');
  const g = (args, input) => execFileSync(gitPath,
    ['-c', 'user.name=Aurora Publisher Test', '-c', 'user.email=test@aurora.invalid', ...args],
    { cwd: root, env: environment(), input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  g(['init']);
  const before = "'use strict';\nmodule.exports = 1;\n", after = "'use strict';\nmodule.exports = 2;\n";
  fs.writeFileSync(path.join(root, 'src', 'example.cjs'), before);
  g(['add', '--', 'src/example.cjs']); g(['commit', '-m', 'Synthetic baseline']);
  const base = g(['rev-parse', 'HEAD']);
  const blob = g(['hash-object', '--no-filters', '-w', '--stdin'], after);
  g(['update-index', '--cacheinfo', '100644', blob, 'src/example.cjs']);
  const tree = g(['write-tree']), commit = g(['commit-tree', tree, '-p', base, '-m', 'Synthetic prepared proposal']);
  const id = 'a'.repeat(32), branch = 'aurora-studio/' + id;
  g(['update-ref', 'refs/heads/' + branch, commit]);
  const proposal = { summary: 'SYNTHETIC_SUMMARY_MUST_NOT_BE_UPLOADED', files: [{ path: 'src/example.cjs',
    beforeSha256: hash(before), afterSha256: hash(after), content: after }] };
  const task = { id, orgId: 'aurora-owner-test', state: 'VERSION_PREPARED', version: 9,
    classification: 'INTERNAL', baseRevision: base, proposal, proposalFingerprint: fp(proposal),
    prompt: 'SYNTHETIC_PROMPT_MUST_NOT_BE_UPLOADED',
    verification: { state: 'STATIC_CHECKS_PASSED', proposalFingerprint: fp(proposal) },
    preparedVersion: { state: 'PREPARED_LOCAL_ONLY', commit, tree, branch: 'refs/heads/' + branch,
      baseRevision: base, proposalFingerprint: fp(proposal), pushed: false, deployed: false } };
  const calls = [], audits = [], bodies = [];
  const remote = { base, head: null, pr: null, user: 'GESTAOWMGJ', pushes: 0, creates: 0,
    checks: null, runs: null, pushMode: 'success', createMode: 'success', onCall: null };
  let currentTime = Date.parse('2026-10-12T17:00:00Z');
  const makePull = () => ({ number: 123, html_url: 'https://github.com/' + REPOSITORY + '/pull/123',
    state: 'open', draft: true, maintainer_can_modify: false,
    head: { ref: branch, sha: remote.head, repo: { full_name: REPOSITORY } },
    base: { ref: 'main', sha: remote.base, repo: { full_name: REPOSITORY } } });
  const response = (value, status = 200) => ({ status: status === 200 ? 0 : 1,
    stdout: 'HTTP/2.0 ' + status + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(value),
    stderr: status === 200 ? '' : 'SYNTHETIC_SECRET_STDERR_MUST_NOT_BE_EXPOSED' });
  const runner = async request => {
    calls.push({ tool: request.tool, args: [...request.args], env: request.env });
    if (remote.onCall) await remote.onCall(request);
    if (request.tool === 'git') {
      if (request.args.includes('push')) {
        remote.pushes++;
        if (remote.pushMode !== 'absent') remote.head = remote.pushMode === 'conflict' ? OTHER : commit;
        return { status: remote.pushMode === 'success' ? 0 : 1, uncertain: remote.pushMode !== 'success',
          stdout: '', stderr: 'SYNTHETIC_SECRET_STDERR_MUST_NOT_BE_EXPOSED' };
      }
      return defaultRunner(request);
    }
    const args = request.args;
    if (args[0] === 'pr' && args[1] === 'create') {
      remote.creates++;
      assert.equal(args[args.indexOf('--body-file') + 1], '-'); assert.equal(typeof request.input, 'string');
      bodies.push(request.input);
      if (remote.createMode !== 'absent') remote.pr = makePull();
      return { status: remote.createMode === 'success' ? 0 : 1, uncertain: remote.createMode !== 'success',
        stdout: remote.createMode === 'success' ? remote.pr.html_url + '\n' : '',
        stderr: 'SYNTHETIC_SECRET_STDERR_MUST_NOT_BE_EXPOSED' };
    }
    assert.equal(args[0], 'api'); assert.equal(args[args.indexOf('--method') + 1], 'GET');
    assert.equal(args[args.indexOf('--hostname') + 1], 'github.com');
    const endpoint = args[1], prefix = 'repos/' + REPOSITORY;
    if (endpoint === 'user') return response({ login: remote.user });
    if (endpoint === prefix) return response({ full_name: REPOSITORY, default_branch: 'main',
      archived: false, permissions: { push: true } });
    if (endpoint === prefix + '/branches/main') return response({ name: 'main', commit: { sha: remote.base } });
    if (endpoint === prefix + '/git/ref/heads/' + branch) return remote.head ? response({ ref: 'refs/heads/' + branch,
      object: { type: 'commit', sha: remote.head } }) : response({}, 404);
    if (endpoint.startsWith(prefix + '/pulls?')) {
      assert.equal(endpoint, prefix + '/pulls?state=all&head=GESTAOWMGJ%3Aaurora-studio%2F' + id + '&base=main&per_page=100');
      return response(remote.pr ? (Array.isArray(remote.pr) ? remote.pr : [remote.pr]) : []);
    }
    if (endpoint === prefix + '/pulls/123') return response(remote.pr);
    if (endpoint === prefix + '/commits/' + commit + '/check-runs?per_page=100') return response(remote.checks || { total_count: 0, check_runs: [] });
    if (endpoint === prefix + '/actions/runs?head_sha=' + commit + '&event=pull_request&per_page=100') return response(remote.runs || { total_count: 0, workflow_runs: [] });
    assert.fail('Unexpected API endpoint: ' + endpoint);
  };
  const config = { enabled: true, authorizedOrgId: task.orgId, ghExecutable: ghPath,
    ghSha256: hash(fs.readFileSync(ghPath)), gitSha256: hash(fs.readFileSync(gitPath)) };
  const options = { stateDir, orgId: task.orgId, config,
    repository: { root, gitExecutable: gitPath, allowedPaths: ['src/example.cjs'], projectId: 'aurora-canonical' },
    readPreparedTask: async requested => { assert.equal(requested, id); return structuredClone(task); },
    audit: (action, data) => audits.push({ action, data }), runner, now: () => currentTime,
    env: { ...process.env, GH_TOKEN: 'SYNTHETIC_DO_NOT_INHERIT', GITHUB_TOKEN: 'SYNTHETIC_DO_NOT_INHERIT',
      GIT_SSH_COMMAND: 'SYNTHETIC_DO_NOT_INHERIT', GH_DEBUG: 'api', GIT_TRACE: '1' } };
  const input = { taskId: id, expectedVersion: task.version, proposalFingerprint: task.proposalFingerprint };
  return { root, stateDir, id, branch, base, commit, tree, task, proposal, remote, calls, audits, bodies,
    options, config, input, g, makePull, publisher: createPublisher(options),
    advance: milliseconds => { currentTime += milliseconds; },
    receiptFile: path.join(stateDir, 'studio', 'publications', id + '.json') };
}
const code = expected => error => error?.code === expected && error.message === expected;

test('fixed PR metadata is transferred through stdin without a mutable body file', async () => {
  const result = await defaultRunner({ executable: process.execPath,
    args: ['-e', 'process.stdin.setEncoding("utf8"); let value=""; process.stdin.on("data",chunk=>value+=chunk); process.stdin.on("end",()=>process.stdout.write(value));'],
    cwd: process.cwd(), env: environment(), timeoutMs: 5000, maxBufferBytes: 65536,
    input: 'SYNTHETIC_FIXED_ENGINEERING_METADATA\n' });
  assert.equal(result.status, 0); assert.equal(result.stdout, 'SYNTHETIC_FIXED_ENGINEERING_METADATA\n');
});

test('publication is unavailable without a reviewed explicit opt-in', async t => {
  const f = await fixture(t); if (!f) return;
  for (const config of [null, { ...f.config, enabled: false }, { ...f.config, authorizedOrgId: 'another-org' },
    { ...f.config, repository: 'OTHER/REPO' }, { ...f.config, ghSha256: '0'.repeat(64) }]) {
    const publisher = createPublisher({ ...f.options, config });
    assert.equal(publisher.capabilities().publish, 'NOT_CONFIGURED');
    await assert.rejects(publisher.publishDraft(f.input));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.remote.pushes, 0);
});

test('exact prepared commit becomes one confirmed draft with fixed commands and sanitized metadata', async t => {
  const f = await fixture(t); if (!f) return;
  const result = await f.publisher.publishDraft(f.input);
  assert.equal(result.state, 'DRAFT_CONFIRMED'); assert.equal(result.pullRequest.number, 123);
  assert.equal(result.headSha, f.commit); assert.equal(result.baseSha, f.base);
  assert.equal(result.deployed, false); assert.equal(result.merged, false);
  assert.equal(f.remote.pushes, 1); assert.equal(f.remote.creates, 1);
  const push = f.calls.find(call => call.args.includes('push'));
  assert.ok(push.args.includes('--force-with-lease=refs/heads/' + f.branch + ':'));
  assert.ok(push.args.includes(f.commit + ':refs/heads/' + f.branch));
  assert.ok(push.args.includes('https://github.com/' + REPOSITORY + '.git'));
  assert.ok(push.args.some(value => value === 'credential.helper=!"' + f.config.ghExecutable.replace(/\\/g, '/') + '" auth git-credential'));
  const create = f.calls.find(call => call.args[0] === 'pr');
  assert.ok(create.args.includes('--draft')); assert.ok(create.args.includes('--no-maintainer-edit'));
  assert.equal(create.args[create.args.indexOf('--head') + 1], f.branch);
  assert.equal(create.args[create.args.indexOf('--repo') + 1], REPOSITORY);
  assert.equal(f.bodies.length, 1);
  assert.ok(!f.bodies[0].includes(f.task.prompt)); assert.ok(!f.bodies[0].includes(f.proposal.summary));
  const persisted = fs.readFileSync(f.receiptFile, 'utf8');
  for (const sensitive of [f.task.prompt, f.proposal.summary, f.proposal.files[0].content,
    'SYNTHETIC_SECRET_STDERR_MUST_NOT_BE_EXPOSED']) {
    assert.ok(!persisted.includes(sensitive)); assert.ok(!JSON.stringify(f.audits).includes(sensitive));
    assert.ok(!JSON.stringify(result).includes(sensitive));
  }
  for (const call of f.calls) {
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GIT_SSH_COMMAND', 'GH_DEBUG', 'GIT_TRACE']) assert.equal(call.env[key], undefined);
  }
});

test('CAS, fingerprint, task state and classification reject forged inputs before any command', async t => {
  const f = await fixture(t); if (!f) return;
  await assert.rejects(f.publisher.publishDraft({ ...f.input, expectedVersion: 8 }), code('PUBLISH_TASK_CHANGED'));
  await assert.rejects(f.publisher.publishDraft({ ...f.input, proposalFingerprint: '0'.repeat(64) }), code('PUBLISH_TASK_CHANGED'));
  await assert.rejects(f.publisher.publishDraft({ ...f.input, command: 'push main' }), code('PUBLISH_INPUT_INVALID'));
  f.task.state = 'PROPOSED'; await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_TASK_CHANGED'));
  f.task.state = 'VERSION_PREPARED'; f.task.classification = 'RESTRICTED';
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_TASK_CHANGED'));
  assert.equal(f.calls.length, 0);
});

test('prepared branch change blocks local proof', async t => {
  const f = await fixture(t); if (!f) return;
  f.g(['update-ref', 'refs/heads/' + f.branch, f.base]);
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_SOURCE_CHANGED'));
  assert.equal(f.remote.pushes, 0); assert.equal(f.calls.filter(call => call.tool === 'gh').length, 0);
});

test('extra commit paths outside the reviewed proposal block publication', async t => {
  const f = await fixture(t); if (!f) return;
  const blob = f.g(['hash-object', '--no-filters', '-w', '--stdin'], 'synthetic extra file\n');
  f.g(['update-index', '--add', '--cacheinfo', '100644', blob, 'src/unreviewed.txt']);
  const tree = f.g(['write-tree']);
  const commit = f.g(['commit-tree', tree, '-p', f.base, '-m', 'Synthetic extra file']);
  f.g(['update-ref', 'refs/heads/' + f.branch, commit]);
  f.task.preparedVersion.commit = commit; f.task.preparedVersion.tree = tree;
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_SOURCE_CHANGED'));
  assert.equal(f.remote.pushes, 0); assert.equal(f.calls.filter(call => call.tool === 'gh').length, 0);
});

test('local URL rewriting, credential injection and config includes block publication', async t => {
  const f = await fixture(t); if (!f) return;
  for (const key of ['url.https://example.invalid/.insteadof', 'credential.helper',
    'http.extraheader', 'include.path', 'core.askpass']) {
    f.g(['config', '--local', key, 'SYNTHETIC_CONFIGURATION_VALUE']);
    await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_LOCAL_CONFIGURATION_UNSAFE'));
    f.g(['config', '--local', '--unset-all', key]);
  }
  assert.equal(f.remote.pushes, 0); assert.equal(f.calls.filter(call => call.tool === 'gh').length, 0);
});

test('proposal bytes and supplied hashes cannot disagree', async t => {
  const f = await fixture(t); if (!f) return;
  f.task.proposal.files[0].afterSha256 = '1'.repeat(64);
  f.task.proposalFingerprint = fp(f.task.proposal);
  f.task.verification.proposalFingerprint = f.task.proposalFingerprint;
  f.task.preparedVersion.proposalFingerprint = f.task.proposalFingerprint;
  await assert.rejects(f.publisher.publishDraft({ ...f.input, proposalFingerprint: f.task.proposalFingerprint }), code('PUBLISH_TASK_CHANGED'));
  assert.equal(f.calls.length, 0);
});

test('task changed while observing authorization is revalidated before push', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.onCall = request => { if (request.args[0] === 'api' && request.args[1] === 'user') f.task.version++; };
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_TASK_CHANGED'));
  assert.equal(f.remote.pushes, 0); assert.equal(f.remote.creates, 0);
});

test('moving main and an existing different remote branch never overwrite remote work', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.base = OTHER;
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_BASE_CHANGED'));
  f.remote.base = f.base; f.remote.head = OTHER;
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_REMOTE_CONFLICT'));
  assert.equal(f.remote.pushes, 0); assert.equal(f.remote.creates, 0);
});

test('a timed-out push confirmed by readback can continue without another push', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.pushMode = 'timeout';
  assert.equal((await f.publisher.publishDraft(f.input)).state, 'DRAFT_CONFIRMED');
  assert.equal(f.remote.pushes, 1); assert.equal(f.remote.creates, 1);
});

test('unknown absent push preserves intent; retry first reads remote and creates only its own branch', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.pushMode = 'absent';
  assert.equal((await f.publisher.publishDraft(f.input)).state, 'BRANCH_UNCONFIRMED');
  assert.equal(f.remote.creates, 0); f.remote.pushMode = 'success';
  const start = f.calls.length;
  assert.equal((await f.publisher.publishDraft(f.input)).state, 'DRAFT_CONFIRMED');
  const retry = f.calls.slice(start), firstPush = retry.findIndex(call => call.args.includes('push'));
  assert.ok(retry.slice(0, firstPush).some(call => call.args[1]?.includes('/git/ref/heads/')));
  assert.equal(f.remote.pushes, 2); assert.equal(f.remote.creates, 1);
});

test('unknown PR creation with positive readback and restored receipt does not duplicate writes', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.createMode = 'timeout';
  assert.equal((await f.publisher.publishDraft(f.input)).state, 'DRAFT_CONFIRMED');
  const restored = createPublisher(f.options);
  assert.equal((await restored.publishDraft(f.input)).state, 'DRAFT_CONFIRMED');
  assert.equal(f.remote.pushes, 1); assert.equal(f.remote.creates, 1);
});

test('unknown absent PR requires read-only observations before one bounded retry', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.createMode = 'absent';
  assert.equal((await f.publisher.publishDraft(f.input)).state, 'PR_UNCONFIRMED');
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_RECOVERY_REQUIRED'));
  assert.equal(f.remote.creates, 1);
  assert.equal((await f.publisher.reconcile(f.input)).state, 'RETRY_OBSERVATION');
  f.advance(61000);
  assert.equal((await f.publisher.reconcile(f.input)).state, 'RETRY_READY');
  f.remote.createMode = 'success';
  assert.equal((await f.publisher.publishDraft(f.input)).state, 'DRAFT_CONFIRMED');
  assert.equal(f.remote.creates, 2); assert.equal(f.remote.pushes, 1);
});

test('PR readback rejects ready, editable, closed, redirected and wrong-head results', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.head = f.commit;
  for (const mutation of [{ draft: false }, { maintainer_can_modify: true }, { state: 'closed' },
    { html_url: 'https://example.invalid/pull/123' }, { head: { ...f.makePull().head, sha: OTHER } }]) {
    f.remote.pr = { ...f.makePull(), ...mutation };
    await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_REMOTE_CONFLICT'));
  }
  f.remote.pr = [f.makePull(), { ...f.makePull(), number: 124 }];
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_REMOTE_CONFLICT'));
  assert.equal(f.remote.pushes, 0); assert.equal(f.remote.creates, 0);
});

function green(f) {
  f.remote.checks = { total_count: 1, check_runs: [{ id: 10, name: 'Synthetic build', head_sha: f.commit,
    status: 'completed', conclusion: 'success', details_url: 'https://github.com/' + REPOSITORY + '/actions/runs/88' }] };
  f.remote.runs = { total_count: 1, workflow_runs: [{ id: 88, workflow_id: 42, head_sha: f.commit,
    event: 'pull_request', status: 'completed', conclusion: 'success',
    html_url: 'https://github.com/' + REPOSITORY + '/actions/runs/88', pull_requests: [{ number: 123 }] }] };
}
test('green API metadata leaves actual checkout and required coverage unobserved', async t => {
  const f = await fixture(t); if (!f) return;
  await f.publisher.publishDraft(f.input); green(f);
  const result = await f.publisher.readCi(f.input);
  assert.equal(result.ci.state, 'REMOTE_CHECKS_PASSED'); assert.equal(result.ci.ciVerified, false);
  assert.equal(result.ci.actualCheckout, 'NOT_OBSERVED'); assert.equal(result.ci.requiredCoverage, 'NOT_OBSERVED');
  assert.equal(result.ci.apiHeadSha, f.commit); assert.equal(result.ci.currentBaseSha, f.base);
  assert.equal(result.deployed, false); assert.equal(f.remote.pushes, 1); assert.equal(f.remote.creates, 1);
  f.advance(31000);
  const unchanged = await f.publisher.readCi(f.input);
  assert.equal(unchanged.publicationVersion, result.publicationVersion);
  assert.notEqual(unchanged.remoteObservedAt, result.remoteObservedAt);
});

test('CI observes absent, pending, failed, skipped and incomplete listings accurately', async t => {
  const f = await fixture(t); if (!f) return;
  await f.publisher.publishDraft(f.input);
  assert.equal((await f.publisher.readCi(f.input)).ci.state, 'NO_CHECKS_OBSERVED');
  green(f); f.remote.checks.check_runs[0].status = 'in_progress'; f.remote.checks.check_runs[0].conclusion = null;
  assert.equal((await f.publisher.readCi(f.input)).ci.state, 'REMOTE_CHECKS_PENDING');
  green(f); f.remote.checks.check_runs[0].conclusion = 'failure';
  assert.equal((await f.publisher.readCi(f.input)).ci.state, 'REMOTE_CHECKS_FAILED');
  green(f); f.remote.checks.check_runs[0].conclusion = 'skipped';
  assert.equal((await f.publisher.readCi(f.input)).ci.state, 'REMOTE_CHECKS_NON_SUCCESS');
  green(f); f.remote.checks.total_count = 101;
  assert.equal((await f.publisher.readCi(f.input)).ci.state, 'INCOMPLETE_REMOTE_LIST');
});

test('CI metadata from a different head or unrelated PR fails closed', async t => {
  const f = await fixture(t); if (!f) return;
  await f.publisher.publishDraft(f.input); green(f);
  f.remote.checks.check_runs[0].head_sha = OTHER;
  await assert.rejects(f.publisher.readCi(f.input), code('PUBLISH_REMOTE_INVALID'));
  green(f); f.remote.runs.workflow_runs[0].pull_requests = [{ number: 456 }];
  await assert.rejects(f.publisher.readCi(f.input), code('PUBLISH_REMOTE_INVALID'));
});

test('main advancement marks previously green CI stale without promoting anything', async t => {
  const f = await fixture(t); if (!f) return;
  await f.publisher.publishDraft(f.input); green(f);
  f.g(['update-ref', 'HEAD', f.commit]); // A later local checkout does not prevent reading immutable old CI metadata.
  f.remote.base = OTHER; f.remote.pr.base.sha = OTHER;
  const result = await f.publisher.readCi(f.input);
  assert.equal(result.ci.state, 'BASE_CHANGED'); assert.equal(result.ci.baseCurrent, false);
  assert.equal(result.ci.preparedBaseSha, f.base); assert.equal(result.ci.currentBaseSha, OTHER);
  assert.equal(result.ci.ciVerified, false);
});

test('base advancement during draft creation can be reconciled and observed without inventing a reviewed base', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.onCall = request => { if (request.args[0] === 'pr' && request.args[1] === 'create') f.remote.base = OTHER; };
  const pending = await f.publisher.publishDraft(f.input);
  assert.equal(pending.state, 'BASE_CHANGED'); assert.equal(pending.pullRequest, null);
  assert.equal(pending.baseSha, f.base); assert.equal(pending.observedPullRequest.baseSha, OTHER);
  assert.equal(pending.observedPullRequest.headSha, f.commit); assert.equal(pending.observedPullRequest.draft, true);
  const restored = createPublisher(f.options);
  const reconciled = await restored.reconcile(f.input);
  assert.equal(reconciled.state, 'BASE_CHANGED'); assert.equal(reconciled.observedPullRequest.number, 123);
  green(f);
  const observed = await restored.readCi(f.input);
  assert.equal(observed.ci.state, 'BASE_CHANGED'); assert.equal(observed.ci.ciVerified, false);
  assert.equal(observed.pullRequest, null); assert.equal(observed.observedPullRequest.baseSha, OTHER);
  assert.equal(f.remote.pushes, 1); assert.equal(f.remote.creates, 1);
  await assert.rejects(restored.publishDraft(f.input), code('PUBLISH_BASE_CHANGED'));
  assert.equal(f.remote.creates, 1);
});

test('corrupt and recomputed forged receipt bindings cannot bypass reconciliation', async t => {
  const f = await fixture(t); if (!f) return;
  await f.publisher.publishDraft(f.input);
  const original = fs.readFileSync(f.receiptFile, 'utf8');
  fs.writeFileSync(f.receiptFile, original.replace('DRAFT_CONFIRMED', 'REMOTE_CONFLICT'));
  await assert.rejects(createPublisher(f.options).publishDraft(f.input), code('PUBLISH_RECORD_INVALID'));
  const endpointForged = JSON.parse(original); endpointForged.payload.pullRequest.number = '../unexpected';
  endpointForged.sha256 = fp(endpointForged.payload); fs.writeFileSync(f.receiptFile, JSON.stringify(endpointForged));
  const before = f.calls.length;
  await assert.rejects(createPublisher(f.options).readCi(f.input), code('PUBLISH_RECORD_INVALID'));
  assert.equal(f.calls.length, before);
  const altered = JSON.parse(original); altered.payload.binding.commit = OTHER; altered.sha256 = fp(altered.payload);
  fs.writeFileSync(f.receiptFile, JSON.stringify(altered));
  await assert.rejects(createPublisher(f.options).publishDraft(f.input), code('PUBLISH_RECORD_INVALID'));
  assert.equal(f.remote.pushes, 1); assert.equal(f.remote.creates, 1);
});

test('per-task lock excludes a concurrent publisher instance', async t => {
  const f = await fixture(t); if (!f) return;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  f.remote.onCall = async request => { if (request.args[0] === 'api' && request.args[1] === 'user') { entered(); await gate; } };
  const first = f.publisher.publishDraft(f.input); await began;
  await assert.rejects(createPublisher(f.options).publishDraft(f.input), code('PUBLISH_LOCKED'));
  release(); await first;
  assert.equal(f.remote.pushes, 1); assert.equal(f.remote.creates, 1);
});

test('audit failure preserves intent and blocks all remote mutation', async t => {
  const f = await fixture(t); if (!f) return;
  const publisher = createPublisher({ ...f.options, audit: () => { throw Error('SYNTHETIC_PRIVATE_ERROR'); } });
  await assert.rejects(publisher.publishDraft(f.input), code('PUBLISH_AUDIT_UNAVAILABLE'));
  assert.equal(JSON.parse(fs.readFileSync(f.receiptFile)).payload.state, 'INTENT_RECORDED');
  assert.equal(f.remote.pushes, 0); assert.equal(f.remote.creates, 0);
});

test('executable change and wrong authenticated account disable operations', async t => {
  const f = await fixture(t); if (!f) return;
  f.remote.user = 'another-account';
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_AUTHORIZATION_UNCONFIRMED'));
  const before = f.calls.length; fs.appendFileSync(f.config.ghExecutable, 'changed');
  await assert.rejects(f.publisher.publishDraft(f.input), code('PUBLISH_EXECUTABLE_CHANGED'));
  assert.equal(f.calls.length, before); assert.equal(f.remote.pushes, 0); assert.equal(f.remote.creates, 0);
});

test('runner exception text is never surfaced as an error or audited metadata', async t => {
  const f = await fixture(t); if (!f) return;
  const publisher = createPublisher({ ...f.options, runner: async () => { throw Error('SYNTHETIC_PRIVATE_COMMAND_OUTPUT'); } });
  await assert.rejects(publisher.publishDraft(f.input), code('PUBLISH_LOCAL_CHECK_FAILED'));
  assert.ok(!JSON.stringify(f.audits).includes('SYNTHETIC_PRIVATE_COMMAND_OUTPUT'));
});
