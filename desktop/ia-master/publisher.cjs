'use strict';
// Engineering-only draft publication. A model never selects a command or destination.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { readRegularFile } = require('./safe-read.cjs');
const REPOSITORY = 'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS';
const ACCOUNT = 'GESTAOWMGJ';
const BASE = 'main';
const REMOTE = 'https://github.com/' + REPOSITORY + '.git';
const API = 'repos/' + REPOSITORY;
const SCHEMA = 'aurora.master.publisher.v1';
const ID = /^[a-f0-9]{32}$/;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fingerprint = value => hash(JSON.stringify(value));
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY|\bBearer\s+[\w.-]+|\bsk-[a-zA-Z0-9]{12,}|\b(?:password|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][^'"\r\n]{8,}['"]|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/i;
const STATES = new Set(['INTENT_RECORDED', 'BRANCH_PUSH_INTENT', 'BRANCH_CONFIRMED',
  'PR_CREATE_INTENT', 'PR_UNCONFIRMED', 'BRANCH_UNCONFIRMED', 'DRAFT_CONFIRMED', 'REMOTE_CONFLICT',
  'BASE_CHANGED', 'RETRY_OBSERVATION', 'RETRY_READY', 'CI_OBSERVED']);
const CODES = new Set(['PUBLISH_NOT_CONFIGURED', 'PUBLISH_CONFIG_INVALID', 'PUBLISH_INPUT_INVALID',
  'PUBLISH_LOCKED', 'PUBLISH_RECORD_INVALID', 'PUBLISH_TASK_CHANGED', 'PUBLISH_SOURCE_CHANGED',
  'PUBLISH_EXECUTABLE_CHANGED', 'PUBLISH_LOCAL_CHECK_FAILED', 'PUBLISH_REMOTE_UNAVAILABLE',
  'PUBLISH_LOCAL_CONFIGURATION_UNSAFE',
  'PUBLISH_REMOTE_INVALID', 'PUBLISH_REMOTE_CONFLICT', 'PUBLISH_BASE_CHANGED',
  'PUBLISH_AUTHORIZATION_UNCONFIRMED', 'PUBLISH_AUDIT_UNAVAILABLE', 'PUBLISH_RECOVERY_REQUIRED']);
class PublisherError extends Error {
  constructor(code, status = 422) {
    super(CODES.has(code) ? code : 'PUBLISH_LOCAL_CHECK_FAILED');
    this.code = this.message; this.status = status;
  }
}
function demand(ok, code, status) { if (!ok) throw new PublisherError(code, status); }
function closed(value, keys) {
  demand(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key)), 'PUBLISH_INPUT_INVALID', 400);
}
function safePath(value) {
  demand(typeof value === 'string' && value.length <= 180 && /^[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value) &&
    !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) &&
    !/(?:^|\/)(?:node_modules|secrets?|credentials?|private)(?:\/|$)/i.test(value) &&
    !/(?:^|\/)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|\/|$)/i.test(value) &&
    /\.(?:js|cjs|mjs|ts|tsx|jsx|json|md|html|css|txt)$/.test(value), 'PUBLISH_INPUT_INVALID');
  return value;
}
function noLinks(target) {
  const resolved = path.resolve(target), parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) demand(!fs.lstatSync(current).isSymbolicLink(), 'PUBLISH_CONFIG_INVALID');
  }
  return resolved;
}
function executable(file, expected, name) {
  demand(typeof file === 'string' && path.isAbsolute(file) && !/[\r\n"'`$!%&|<>;]/.test(file) &&
    ['gh', 'gh.exe', 'git', 'git.exe'].includes(path.basename(file).toLowerCase()) &&
    path.basename(file).toLowerCase().replace(/\.exe$/, '') === name && DIGEST.test(expected), 'PUBLISH_CONFIG_INVALID');
  noLinks(file);
  let bytes;
  try { bytes = readRegularFile(file, 128 * 1024 * 1024); }
  catch { throw new PublisherError('PUBLISH_EXECUTABLE_CHANGED', 503); }
  demand(hash(bytes) === expected, 'PUBLISH_EXECUTABLE_CHANGED');
}
function environment(source = process.env) {
  const result = {};
  // gh obtains its existing credential itself. No token or Git/SSH override is inherited.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'DBUS_SESSION_BUS_ADDRESS']) {
    if (source[key]) result[key] = source[key];
  }
  return { ...result, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1', NO_COLOR: '1' };
}
function defaultRunner({ executable: file, args, cwd, env, timeoutMs, maxBufferBytes, input }) {
  return new Promise(resolve => {
    const child = execFile(file, args, { cwd, env, timeout: timeoutMs, maxBuffer: maxBufferBytes,
      encoding: 'utf8', windowsHide: true, shell: false }, (error, stdout, stderr) => {
      resolve({ status: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        uncertain: Boolean(error?.killed || error?.code === 'ETIMEDOUT'), stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input === undefined ? undefined : input);
  });
}

function createPublisher({ stateDir, orgId, config = null, repository, readPreparedTask,
  audit = () => {}, runner = defaultRunner, now = () => Date.now(), env = process.env }) {
  let configState = 'NOT_CONFIGURED', options = null;
  const home = path.resolve(stateDir, 'studio', 'publications');
  const explicitlyDisabled = config && config.enabled === false &&
    Object.keys(config).every(key => ['enabled', 'authorizedOrgId', 'ghExecutable', 'ghSha256', 'gitSha256'].includes(key)) &&
    config.authorizedOrgId === orgId;
  if (config && !explicitlyDisabled) {
    try {
      closed(config, ['enabled', 'authorizedOrgId', 'ghExecutable', 'ghSha256', 'gitSha256']);
      closed(repository, ['root', 'gitExecutable', 'allowedPaths', 'projectId']);
      demand(config.enabled === true && config.authorizedOrgId === orgId &&
        /^[a-z0-9][a-z0-9-]{1,63}$/.test(orgId) && typeof readPreparedTask === 'function' &&
        typeof stateDir === 'string' && path.isAbsolute(stateDir) &&
        path.isAbsolute(repository.root) && Array.isArray(repository.allowedPaths) &&
        repository.allowedPaths.length > 0 && repository.allowedPaths.length <= 100, 'PUBLISH_CONFIG_INVALID');
      const root = noLinks(repository.root);
      demand(fs.realpathSync(root) === root && root !== home && !home.startsWith(root + path.sep) &&
        !root.startsWith(home + path.sep), 'PUBLISH_CONFIG_INVALID');
      const allowedPaths = [...new Set(repository.allowedPaths.map(safePath))];
      executable(config.ghExecutable, config.ghSha256, 'gh');
      executable(repository.gitExecutable, config.gitSha256, 'git');
      noLinks(stateDir);
      fs.mkdirSync(home, { recursive: true, mode: 0o700 }); noLinks(home);
      fs.mkdirSync(path.join(home, 'empty-hooks'), { recursive: true, mode: 0o700 });
      options = { ...config, ...repository, root, allowedPaths };
      configState = 'CONFIGURED_AUTH_NOT_OBSERVED';
    } catch { configState = 'CONFIG_INVALID'; }
  }
  function available() { demand(options, configState === 'CONFIG_INVALID' ? 'PUBLISH_CONFIG_INVALID' : 'PUBLISH_NOT_CONFIGURED', 503); }
  function verifyExecutables() {
    available(); executable(options.ghExecutable, options.ghSha256, 'gh');
    executable(options.gitExecutable, options.gitSha256, 'git');
  }
  async function run(tool, args, timeoutMs = 20000, input) {
    verifyExecutables();
    demand(input === undefined || typeof input === 'string' && Buffer.byteLength(input) <= 16384,
      'PUBLISH_INPUT_INVALID');
    let result;
    try { result = await runner({ tool, executable: tool === 'gh' ? options.ghExecutable : options.gitExecutable,
      args: [...args], cwd: options.root, env: environment(env), timeoutMs, maxBufferBytes: 1024 * 1024, input }); }
    catch { throw new PublisherError(tool === 'gh' ? 'PUBLISH_REMOTE_UNAVAILABLE' : 'PUBLISH_LOCAL_CHECK_FAILED', 503); }
    demand(result && Number.isInteger(result.status) && typeof result.stdout === 'string' &&
      Buffer.byteLength(result.stdout) <= 1024 * 1024, tool === 'gh' ? 'PUBLISH_REMOTE_UNAVAILABLE' : 'PUBLISH_LOCAL_CHECK_FAILED', 503);
    // Raw CLI output, stderr and process errors never become a UI/audit response.
    return result;
  }
  const gitFlags = () => ['-c', 'core.hooksPath=' + path.join(home, 'empty-hooks'),
    '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-c', 'core.sshCommand=false',
    '-c', 'core.askPass=',
    '-c', 'protocol.file.allow=never', '-c', 'http.sslVerify=true', '-c', 'http.followRedirects=false'];
  async function git(args) {
    const result = await run('git', [...gitFlags(), ...args]);
    demand(result.status === 0, 'PUBLISH_LOCAL_CHECK_FAILED', 503); return result.stdout;
  }
  async function api(endpoint, selector, allow404 = false) {
    const result = await run('gh', ['api', endpoint, '--hostname', 'github.com', '--method', 'GET',
      '--include', '--header', 'Accept: application/vnd.github+json', '--jq', selector]);
    const match = /^HTTP\/[\d.]+\s+(\d{3})[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/.exec(result.stdout);
    demand(match, 'PUBLISH_REMOTE_UNAVAILABLE', 503);
    const status = Number(match[1]);
    if (status === 404 && allow404) return null;
    demand(result.status === 0 && status === 200, 'PUBLISH_REMOTE_UNAVAILABLE', 503);
    try { return JSON.parse(match[2]); } catch { throw new PublisherError('PUBLISH_REMOTE_INVALID', 503); }
  }
  async function authorization() {
    const user = await api('user', '{login}');
    const repo = await api(API, '{full_name,default_branch,archived,permissions:{push:.permissions.push}}');
    demand(user?.login === ACCOUNT && repo?.full_name === REPOSITORY && repo?.default_branch === BASE &&
      repo?.archived === false && repo?.permissions?.push === true, 'PUBLISH_AUTHORIZATION_UNCONFIRMED', 403);
    return { state: 'CLI_AUTHORIZATION_CONFIRMED', account: ACCOUNT, repository: REPOSITORY,
      credentialSource: 'EXISTING_GH_CLI_CONFIGURATION', tokenReadByApplication: false, mfaObserved: false };
  }
  async function baseSha() {
    const branch = await api(API + '/branches/' + BASE, '{name,commit:{sha:.commit.sha}}');
    demand(branch?.name === BASE && SHA.test(branch?.commit?.sha), 'PUBLISH_REMOTE_INVALID', 503); return branch.commit.sha;
  }
  const branchName = id => 'aurora-studio/' + id;
  async function remoteHead(id) {
    const branch = await api(API + '/git/ref/heads/' + branchName(id), '{ref,object:{sha:.object.sha,type:.object.type}}', true);
    if (branch === null) return null;
    demand(branch?.ref === 'refs/heads/' + branchName(id) && SHA.test(branch?.object?.sha) &&
      branch?.object?.type === 'commit', 'PUBLISH_REMOTE_INVALID', 503); return branch.object.sha;
  }
  const prSelector = '{number,html_url,state,draft,maintainer_can_modify,head:{ref:.head.ref,sha:.head.sha,repo:{full_name:.head.repo.full_name}},base:{ref:.base.ref,sha:.base.sha,repo:{full_name:.base.repo.full_name}}}';
  async function matchingPulls(id) {
    const items = await api(API + '/pulls?state=all&head=' + ACCOUNT + '%3Aaurora-studio%2F' + id + '&base=main&per_page=100', 'map(' + prSelector + ')');
    demand(Array.isArray(items) && items.length < 100, 'PUBLISH_REMOTE_INVALID', 503); return items;
  }
  function pullNumber(pr) {
    demand(pr && Number.isSafeInteger(pr.number) && pr.number > 0 &&
      pr.html_url === 'https://github.com/' + REPOSITORY + '/pull/' + pr.number,
    'PUBLISH_REMOTE_CONFLICT', 409);
    return pr.number;
  }
  async function pullDetail(candidate) {
    // The list endpoint may omit maintainer_can_modify. It only discovers a
    // fixed-repository locator; confirmation requires the detailed GET response.
    const number = pullNumber(candidate);
    const pr = await api(API + '/pulls/' + number, prSelector);
    demand(pullNumber(pr) === number, 'PUBLISH_REMOTE_CONFLICT', 409);
    return pr;
  }
  function confirmPull(pr, binding) {
    demand(pr && Number.isSafeInteger(pr.number) && pr.number > 0 &&
      pr.html_url === 'https://github.com/' + REPOSITORY + '/pull/' + pr.number &&
      pr.state === 'open' && pr.draft === true && pr.maintainer_can_modify === false &&
      pr.head?.repo?.full_name === REPOSITORY && pr.base?.repo?.full_name === REPOSITORY &&
      pr.head?.ref === branchName(binding.taskId) && pr.head.sha === binding.commit &&
      pr.base?.ref === BASE && pr.base.sha === binding.baseRevision, 'PUBLISH_REMOTE_CONFLICT', 409);
    return { number: pr.number, url: pr.html_url, draft: true, headSha: pr.head.sha, baseSha: pr.base.sha };
  }
  function filename(id) { demand(ID.test(id), 'PUBLISH_INPUT_INVALID', 400); return path.join(home, id + '.json'); }
  function read(id) {
    const file = filename(id); noLinks(home);
    if (!fs.existsSync(file)) return null;
    try {
      const record = JSON.parse(readRegularFile(file, 131072).toString('utf8')), value = record.payload;
      closed(record, ['payload', 'sha256']);
      closed(value, ['schemaVersion', 'binding', 'version', 'history', 'state', 'createdAt', 'updatedAt', 'pullRequest', 'observedPullRequest', 'ci']);
      closed(value.binding, ['taskId', 'taskVersion', 'orgId', 'repository', 'baseRevision', 'commit', 'tree', 'proposalFingerprint', 'files']);
      demand(record.sha256 === fingerprint(value) && value?.schemaVersion === SCHEMA &&
        value?.binding?.taskId === id && value?.binding?.orgId === orgId && Array.isArray(value.history) &&
        value.history.length > 0 && value.history.length <= 500 && Number.isSafeInteger(value.version) &&
        value.version === value.history.length && STATES.has(value.state), 'PUBLISH_RECORD_INVALID');
      if (value.pullRequest !== null) {
        closed(value.pullRequest, ['number', 'url', 'draft', 'headSha', 'baseSha']);
        demand(Number.isSafeInteger(value.pullRequest.number) && value.pullRequest.number > 0 &&
          value.pullRequest.url === 'https://github.com/' + REPOSITORY + '/pull/' + value.pullRequest.number &&
          value.pullRequest.draft === true && value.pullRequest.headSha === value.binding.commit &&
          value.pullRequest.baseSha === value.binding.baseRevision, 'PUBLISH_RECORD_INVALID');
      }
      if (value.observedPullRequest != null) {
        closed(value.observedPullRequest, ['number', 'url', 'draft', 'headSha', 'baseSha']);
        const pr = value.observedPullRequest;
        demand(Number.isSafeInteger(pr.number) && pr.number > 0 && pr.draft === true &&
          pr.url === 'https://github.com/' + REPOSITORY + '/pull/' + pr.number &&
          pr.headSha === value.binding.commit && SHA.test(pr.baseSha) &&
          (!value.pullRequest || pr.number === value.pullRequest.number), 'PUBLISH_RECORD_INVALID');
      }
      if (value.ci) {
        closed(value.ci, ['state', 'observedAt', 'proposedHeadSha', 'apiHeadSha', 'currentHeadSha',
          'preparedBaseSha', 'currentBaseSha', 'baseCurrent', 'actualCheckout', 'ciVerified',
          'requiredCoverage', 'completeRemoteListing', 'checks', 'runs']);
        demand(['BASE_CHANGED', 'INCOMPLETE_REMOTE_LIST', 'NO_CHECKS_OBSERVED', 'REMOTE_CHECKS_FAILED',
          'REMOTE_CHECKS_PENDING', 'REMOTE_CHECKS_NON_SUCCESS', 'REMOTE_CHECKS_PASSED'].includes(value.ci.state) &&
          value.ci.proposedHeadSha === value.binding.commit && value.ci.apiHeadSha === value.binding.commit &&
          value.ci.currentHeadSha === value.binding.commit && value.ci.preparedBaseSha === value.binding.baseRevision &&
          SHA.test(value.ci.currentBaseSha) && typeof value.ci.baseCurrent === 'boolean' &&
          value.ci.actualCheckout === 'NOT_OBSERVED' && value.ci.ciVerified === false &&
          value.ci.requiredCoverage === 'NOT_OBSERVED' && typeof value.ci.completeRemoteListing === 'boolean' &&
          Array.isArray(value.ci.checks) && value.ci.checks.length <= 100 &&
          Array.isArray(value.ci.runs) && value.ci.runs.length <= 100, 'PUBLISH_RECORD_INVALID');
        for (const check of value.ci.checks) {
          closed(check, ['id', 'name', 'apiHeadSha', 'status', 'conclusion', 'actualCheckout']);
          demand(Number.isSafeInteger(check.id) && check.id > 0 && typeof check.name === 'string' &&
            check.name.length <= 200 && !SECRET.test(check.name) && check.apiHeadSha === value.binding.commit &&
            check.actualCheckout === 'NOT_OBSERVED', 'PUBLISH_RECORD_INVALID');
        }
        for (const run of value.ci.runs) {
          closed(run, ['id', 'workflowId', 'apiHeadSha', 'status', 'conclusion', 'url', 'actualCheckout']);
          demand(Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.workflowId) &&
            run.apiHeadSha === value.binding.commit && run.actualCheckout === 'NOT_OBSERVED' &&
            run.url === 'https://github.com/' + REPOSITORY + '/actions/runs/' + run.id, 'PUBLISH_RECORD_INVALID');
        }
      }
      let prior = null;
      for (let i = 0; i < value.history.length; i++) {
        const { eventHash, ...event } = value.history[i];
        closed(event, ['at', 'version', 'state', 'previousEventHash', 'observedBaseSha', 'observedHeadSha',
          'bodySha256', 'absentPullObserved', 'ciReceiptSha256']);
        demand(event.previousEventHash === prior && event.version === i + 1 && STATES.has(event.state) &&
          fingerprint(event) === eventHash, 'PUBLISH_RECORD_INVALID'); prior = eventHash;
      }
      demand(value.history.at(-1).state === value.state, 'PUBLISH_RECORD_INVALID'); return value;
    } catch { throw new PublisherError('PUBLISH_RECORD_INVALID'); }
  }
  function save(value, state, metadata = {}) {
    demand(STATES.has(state), 'PUBLISH_RECORD_INVALID');
    value.version++; value.state = state; value.updatedAt = new Date(now()).toISOString();
    const entry = { at: value.updatedAt, version: value.version, state,
      previousEventHash: value.history.at(-1)?.eventHash || null, ...metadata };
    entry.eventHash = fingerprint(entry); value.history.push(entry);
    const file = filename(value.binding.taskId), temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    noLinks(home); demand(!fs.existsSync(file) || !fs.lstatSync(file).isSymbolicLink(), 'PUBLISH_RECORD_INVALID');
    try {
      fs.writeFileSync(temporary, JSON.stringify({ payload: value, sha256: fingerprint(value) }), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    try { audit('STUDIO_PUBLISH_' + state, { taskId: value.binding.taskId, orgId,
      publicationVersion: value.version, eventHash: entry.eventHash, commit: value.binding.commit,
      baseRevision: value.binding.baseRevision, proposalFingerprint: value.binding.proposalFingerprint,
      ...(value.pullRequest ? { pullRequestNumber: value.pullRequest.number } : {}) }); }
    catch { throw new PublisherError('PUBLISH_AUDIT_UNAVAILABLE', 503); }
    return value;
  }
  async function locked(id, action) {
    available(); filename(id); noLinks(home);
    const file = path.join(home, id + '.lock'); let fd;
    try { fd = fs.openSync(file, 'wx', 0o600); } catch { throw new PublisherError('PUBLISH_LOCKED', 409); }
    try { return await action(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
  }
  async function bindingFor(input) {
    closed(input, ['taskId', 'expectedVersion', 'proposalFingerprint']);
    demand(ID.test(input.taskId) && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0 &&
      DIGEST.test(input.proposalFingerprint), 'PUBLISH_INPUT_INVALID', 400);
    const task = await readPreparedTask(input.taskId);
    demand(task?.id === input.taskId && task.orgId === orgId && task.state === 'VERSION_PREPARED' &&
      task.version === input.expectedVersion && ['PUBLIC', 'INTERNAL'].includes(task.classification) &&
      task.proposalFingerprint === input.proposalFingerprint && fingerprint(task.proposal) === task.proposalFingerprint &&
      task.verification?.state === 'STATIC_CHECKS_PASSED' && task.verification.proposalFingerprint === task.proposalFingerprint,
      'PUBLISH_TASK_CHANGED', 409);
    const p = task.preparedVersion;
    demand(p?.state === 'PREPARED_LOCAL_ONLY' && SHA.test(p.commit) && SHA.test(p.tree) && SHA.test(task.baseRevision) &&
      p.baseRevision === task.baseRevision && p.proposalFingerprint === task.proposalFingerprint &&
      p.branch === 'refs/heads/' + branchName(task.id) && p.pushed === false && p.deployed === false &&
      Array.isArray(task.proposal.files) && task.proposal.files.length > 0 && task.proposal.files.length <= 10,
      'PUBLISH_TASK_CHANGED', 409);
    const files = task.proposal.files.map(file => {
      safePath(file.path);
      demand(options.allowedPaths.includes(file.path) && typeof file.content === 'string' &&
        Buffer.byteLength(file.content) <= 30000 && !file.content.includes('\0') && !file.content.includes('\r') &&
        !SECRET.test(file.content) && DIGEST.test(file.afterSha256) && hash(file.content) === file.afterSha256 &&
        (file.beforeSha256 === null || DIGEST.test(file.beforeSha256)), 'PUBLISH_TASK_CHANGED', 409);
      return { path: file.path, beforeSha256: file.beforeSha256, afterSha256: file.afterSha256 };
    }).sort((a, b) => a.path.localeCompare(b.path));
    demand(new Set(files.map(file => file.path)).size === files.length &&
      task.proposal.files.reduce((total, file) => total + Buffer.byteLength(file.content), 0) <= 50000,
      'PUBLISH_TASK_CHANGED', 409);
    return { taskId: task.id, taskVersion: task.version, orgId, repository: REPOSITORY,
      baseRevision: task.baseRevision, commit: p.commit, tree: p.tree,
      proposalFingerprint: task.proposalFingerprint, files };
  }
  async function localProof(binding, checkActiveHead = true) {
    // Local config must not rewrite the fixed URL, inject credentials, proxy it,
    // or include another configuration after our explicit command-line controls.
    // Query names only: credential/config VALUES are never requested or logged.
    const configuration = await run('git', [...gitFlags(), 'config', '--local', '--no-includes',
      '--name-only', '--get-regexp', '^(include\\.|includeif\\.|url\\.|credential\\.|http\\.|https\\.|core\\.(gitproxy|askpass)$)']);
    demand(configuration.status === 1 && configuration.stdout.trim() === '', 'PUBLISH_LOCAL_CONFIGURATION_UNSAFE', 409);
    const sha = async args => (await git(args)).trim();
    demand(await sha(['rev-parse', '--show-toplevel']) === options.root.replace(/\\/g, '/') ||
      fs.realpathSync(await sha(['rev-parse', '--show-toplevel'])) === options.root, 'PUBLISH_SOURCE_CHANGED', 409);
    if (checkActiveHead) demand(await sha(['rev-parse', '--verify', 'HEAD']) === binding.baseRevision, 'PUBLISH_SOURCE_CHANGED', 409);
    demand(await sha(['rev-parse', '--verify', 'refs/heads/' + branchName(binding.taskId)]) === binding.commit &&
      await sha(['rev-parse', '--verify', binding.commit + '^{tree}']) === binding.tree &&
      await sha(['rev-list', '--parents', '-n', '1', binding.commit]) === binding.commit + ' ' + binding.baseRevision,
      'PUBLISH_SOURCE_CHANGED', 409);
    const changed = (await git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--no-ext-diff',
      '--no-textconv', binding.baseRevision, binding.commit, '--'])).trim().split('\n').filter(Boolean).sort();
    demand(JSON.stringify(changed) === JSON.stringify(binding.files.map(file => file.path).sort()), 'PUBLISH_SOURCE_CHANGED', 409);
    for (const file of binding.files) {
      const row = (await git(['ls-tree', binding.commit, '--', file.path])).trim();
      demand(new RegExp('^100(?:644|755) blob [a-f0-9]{40}\\t' + file.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').test(row), 'PUBLISH_SOURCE_CHANGED', 409);
      demand(hash(await git(['show', binding.commit + ':' + file.path])) === file.afterSha256, 'PUBLISH_SOURCE_CHANGED', 409);
      const beforeRow = (await git(['ls-tree', binding.baseRevision, '--', file.path])).trim();
      if (file.beforeSha256 === null) demand(beforeRow === '', 'PUBLISH_SOURCE_CHANGED', 409);
      else {
        demand(/^100(?:644|755) blob [a-f0-9]{40}\t/.test(beforeRow) &&
          hash(await git(['show', binding.baseRevision + ':' + file.path])) === file.beforeSha256, 'PUBLISH_SOURCE_CHANGED', 409);
      }
    }
  }
  function existing(binding) {
    const value = read(binding.taskId);
    demand(value === null || fingerprint(value.binding) === fingerprint(binding), 'PUBLISH_RECORD_INVALID', 409);
    return value || { schemaVersion: SCHEMA, binding, version: 0, history: [], state: null,
      createdAt: new Date(now()).toISOString(), pullRequest: null, observedPullRequest: null };
  }
  async function recheckTask(input, binding) {
    demand(fingerprint(await bindingFor(input)) === fingerprint(binding), 'PUBLISH_TASK_CHANGED', 409);
    await localProof(binding);
  }
  async function requireBase(value) {
    const observed = await baseSha();
    if (observed !== value.binding.baseRevision) {
      save(value, 'BASE_CHANGED', { observedBaseSha: observed }); throw new PublisherError('PUBLISH_BASE_CHANGED', 409);
    }
    return observed;
  }
  function result(value) {
    return { schemaVersion: SCHEMA, state: value.state, publicationVersion: value.version,
      orgId, taskId: value.binding.taskId, taskVersion: value.binding.taskVersion,
      repository: REPOSITORY, headSha: value.binding.commit, baseSha: value.binding.baseRevision,
      proposalFingerprint: value.binding.proposalFingerprint, pullRequest: value.pullRequest,
      observedPullRequest: value.observedPullRequest || null,
      ci: value.ci || null, receiptSha256: fingerprint(value), history: value.history.slice(-40),
      historyEventCount: value.history.length, deployed: false, merged: false, projectTestsRunLocally: false };
  }
  function readPublication(task) {
    demand(task && ID.test(task.id) && task.orgId === orgId, 'PUBLISH_TASK_CHANGED', 409);
    const value = read(task.id);
    if (value === null) return null;
    demand(task.state === 'VERSION_PREPARED' && task.version === value.binding.taskVersion &&
      task.preparedVersion?.commit === value.binding.commit && task.preparedVersion?.tree === value.binding.tree &&
      task.baseRevision === value.binding.baseRevision && task.proposalFingerprint === value.binding.proposalFingerprint &&
      fingerprint(task.proposal) === task.proposalFingerprint && value.binding.repository === REPOSITORY &&
      Array.isArray(task.proposal.files), 'PUBLISH_RECORD_INVALID', 409);
    const files = task.proposal.files.map(file => ({ path: safePath(file.path), beforeSha256: file.beforeSha256,
      afterSha256: file.afterSha256 })).sort((a, b) => a.path.localeCompare(b.path));
    demand(fingerprint(files) === fingerprint(value.binding.files), 'PUBLISH_RECORD_INVALID', 409);
    return result(value);
  }
  async function inspectRemote(value, observedBaseSha = value.binding.baseRevision) {
    const head = await remoteHead(value.binding.taskId);
    if (head !== null && head !== value.binding.commit) {
      save(value, 'REMOTE_CONFLICT', { observedHeadSha: head }); throw new PublisherError('PUBLISH_REMOTE_CONFLICT', 409);
    }
    const pulls = await matchingPulls(value.binding.taskId); let pull = null;
    if (pulls.length > 1) { save(value, 'REMOTE_CONFLICT'); throw new PublisherError('PUBLISH_REMOTE_CONFLICT', 409); }
    if (pulls.length === 1) {
      demand(head === value.binding.commit, 'PUBLISH_REMOTE_CONFLICT', 409);
      pull = await pullDetail(pulls[0]);
      const pr = confirmPull(pull, { ...value.binding, baseRevision: observedBaseSha });
      value.observedPullRequest = pr;
      if (observedBaseSha === value.binding.baseRevision) {
        value.pullRequest = pr; save(value, 'DRAFT_CONFIRMED');
      } else save(value, 'BASE_CHANGED', { observedBaseSha });
    } else demand(value.pullRequest === null, 'PUBLISH_REMOTE_CONFLICT', 409);
    return { head, pull };
  }
  async function publishDraft(input) {
    available();
    return locked(input?.taskId, async () => {
      const binding = await bindingFor(input), value = existing(binding);
      const retryCreateAllowed = value.state === 'RETRY_READY';
      await localProof(binding); await authorization();
      if (value.version === 0) save(value, 'INTENT_RECORDED');
      await requireBase(value);
      let remote = await inspectRemote(value);
      if (remote.pull) return result(value);
      if (remote.head === null) {
        await recheckTask(input, binding); await requireBase(value);
        save(value, 'BRANCH_PUSH_INTENT');
        // Git invokes this CONSTANT helper internally via its helper shell convention.
        // The executable is a reviewed absolute path, pinned by hash; prompts cannot supply it.
        const helper = '!"' + options.ghExecutable.replace(/\\/g, '/') + '" auth git-credential';
        await run('git', [...gitFlags(), '-c', 'credential.helper=', '-c', 'credential.helper=' + helper,
          '-c', 'credential.useHttpPath=true', 'push', '--porcelain',
          '--force-with-lease=refs/heads/' + branchName(binding.taskId) + ':', REMOTE,
          binding.commit + ':refs/heads/' + branchName(binding.taskId)], 60000);
        // Even a reported successful push must be observed; a failed/timeout push is reconciled too.
        const head = await remoteHead(binding.taskId);
        if (head === null) { save(value, 'BRANCH_UNCONFIRMED'); return result(value); }
        if (head !== binding.commit) { save(value, 'REMOTE_CONFLICT', { observedHeadSha: head }); throw new PublisherError('PUBLISH_REMOTE_CONFLICT', 409); }
      }
      save(value, 'BRANCH_CONFIRMED');
      await requireBase(value); remote = await inspectRemote(value);
      if (remote.pull) return result(value);
      const uncertainCreation = value.history.some(event => event.state === 'PR_CREATE_INTENT');
      if (uncertainCreation && !retryCreateAllowed) {
        // read-only reconcile() establishes two separate missing observations after an unknown create.
        throw new PublisherError('PUBLISH_RECOVERY_REQUIRED', 409);
      }
      await recheckTask(input, binding); await requireBase(value);
      demand(await remoteHead(binding.taskId) === binding.commit, 'PUBLISH_REMOTE_CONFLICT', 409);
      const body = 'Proposta de engenharia preparada no Aurora Studio.\n\n' +
        'Tarefa: ' + binding.taskId + '\nBase: ' + binding.baseRevision + '\nHead: ' + binding.commit +
        '\nFingerprint: ' + binding.proposalFingerprint + '\n\n' +
        'Verificação local: sintaxe e integridade; testes gerais e checkout real da CI ainda não comprovados.\n' +
        'Este PR permanece draft; merge, deploy e instalação não foram executados.\n\n' +
        'Arquivos de engenharia:\n' + binding.files.map(file => '- ' + file.path).join('\n') + '\n';
      save(value, 'PR_CREATE_INTENT', { bodySha256: hash(body) });
      // gh supports '-' for stdin. No mutable body pathname or model-generated text is opened by gh.
      await run('gh', ['pr', 'create', '--repo', REPOSITORY, '--base', BASE,
        '--head', branchName(binding.taskId), '--draft', '--no-maintainer-edit',
        '--title', 'Aurora Studio: proposta ' + binding.taskId.slice(0, 12), '--body-file', '-'], 60000, body);
      const currentBase = await baseSha();
      remote = await inspectRemote(value, currentBase);
      if (currentBase !== binding.baseRevision) {
        if (!remote.pull) save(value, 'BASE_CHANGED', { observedBaseSha: currentBase });
        return result(value);
      }
      if (!remote.pull) save(value, 'PR_UNCONFIRMED');
      return result(value);
    });
  }
  async function reconcile(input) {
    available();
    return locked(input?.taskId, async () => {
      const binding = await bindingFor(input), value = existing(binding);
      demand(value.version > 0, 'PUBLISH_RECOVERY_REQUIRED', 409);
      await localProof(binding, false); await authorization();
      const currentBase = await baseSha(), remote = await inspectRemote(value, currentBase);
      if (remote.pull) return result(value);
      if (currentBase !== binding.baseRevision) {
        save(value, 'BASE_CHANGED', { observedBaseSha: currentBase }); return result(value);
      }
      if (value.history.some(event => event.state === 'PR_CREATE_INTENT')) {
        demand(remote.head === binding.commit, 'PUBLISH_REMOTE_CONFLICT', 409);
        const previous = value.history.filter(event => event.state === 'RETRY_OBSERVATION').at(-1);
        if (previous && now() - Date.parse(previous.at) >= 60000) save(value, 'RETRY_READY');
        else save(value, 'RETRY_OBSERVATION', { absentPullObserved: true });
      } else save(value, remote.head === null ? 'BRANCH_UNCONFIRMED' : 'BRANCH_CONFIRMED');
      return result(value);
    });
  }
  async function readCi(input) {
    available();
    return locked(input?.taskId, async () => {
      const binding = await bindingFor(input), value = existing(binding);
      demand(value.pullRequest || value.observedPullRequest, 'PUBLISH_RECOVERY_REQUIRED', 409);
      await localProof(binding, false); await authorization();
      const currentBaseSha = await baseSha(), currentHeadSha = await remoteHead(binding.taskId);
      const knownPull = value.pullRequest || value.observedPullRequest;
      const pr = await pullDetail({ number: knownPull.number, html_url: knownPull.url });
      // A moving base is recorded as stale, not discarded; other identity mismatches fail closed.
      const expected = { ...binding, baseRevision: currentBaseSha };
      value.observedPullRequest = confirmPull(pr, expected);
      demand(currentHeadSha === binding.commit, 'PUBLISH_REMOTE_CONFLICT', 409);
      const checks = await api(API + '/commits/' + binding.commit + '/check-runs?per_page=100',
        '{total_count,check_runs:[.check_runs[]|{id,name,head_sha,status,conclusion,details_url}]}');
      const runs = await api(API + '/actions/runs?head_sha=' + binding.commit + '&event=pull_request&per_page=100',
        '{total_count,workflow_runs:[.workflow_runs[]|{id,workflow_id,head_sha,event,status,conclusion,html_url,pull_requests:[.pull_requests[]|{number}]}]}');
      demand(Number.isSafeInteger(checks?.total_count) && checks.total_count >= 0 &&
        Array.isArray(checks.check_runs) && Number.isSafeInteger(runs?.total_count) && runs.total_count >= 0 &&
        Array.isArray(runs.workflow_runs), 'PUBLISH_REMOTE_INVALID', 503);
      const truncated = checks.total_count > checks.check_runs.length || runs.total_count > runs.workflow_runs.length;
      const checkItems = checks.check_runs.map(check => {
        demand(Number.isSafeInteger(check.id) && check.id > 0 && typeof check.name === 'string' &&
          check.name.length <= 200 && !SECRET.test(check.name) && check.head_sha === binding.commit &&
          ['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'].includes(check.status) &&
          (check.conclusion === null || ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure'].includes(check.conclusion)), 'PUBLISH_REMOTE_INVALID', 503);
        return { id: check.id, name: check.name, apiHeadSha: check.head_sha, status: check.status, conclusion: check.conclusion,
          actualCheckout: 'NOT_OBSERVED' };
      });
      const runItems = runs.workflow_runs.map(run => {
        demand(Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.workflow_id) &&
          run.head_sha === binding.commit && run.event === 'pull_request' &&
          ['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'].includes(run.status) &&
          (run.conclusion === null || ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure'].includes(run.conclusion)) &&
          run.html_url === 'https://github.com/' + REPOSITORY + '/actions/runs/' + run.id &&
          Array.isArray(run.pull_requests) && run.pull_requests.some(item => item.number === knownPull.number), 'PUBLISH_REMOTE_INVALID', 503);
        return { id: run.id, workflowId: run.workflow_id, apiHeadSha: run.head_sha, status: run.status,
          conclusion: run.conclusion, url: run.html_url, actualCheckout: 'NOT_OBSERVED' };
      });
      const items = [...checkItems, ...runItems], baseCurrent = currentBaseSha === binding.baseRevision;
      let state = !baseCurrent ? 'BASE_CHANGED' : truncated ? 'INCOMPLETE_REMOTE_LIST' : items.length === 0 ? 'NO_CHECKS_OBSERVED' :
        items.some(item => item.status === 'completed' && !['success', 'neutral', 'skipped'].includes(item.conclusion)) ? 'REMOTE_CHECKS_FAILED' :
          items.some(item => item.status !== 'completed') ? 'REMOTE_CHECKS_PENDING' :
            items.some(item => item.conclusion !== 'success') ? 'REMOTE_CHECKS_NON_SUCCESS' : 'REMOTE_CHECKS_PASSED';
      const ci = { state, observedAt: new Date(now()).toISOString(), proposedHeadSha: binding.commit,
        apiHeadSha: binding.commit, currentHeadSha, preparedBaseSha: binding.baseRevision, currentBaseSha,
        baseCurrent, actualCheckout: 'NOT_OBSERVED', ciVerified: false, requiredCoverage: 'NOT_OBSERVED',
        completeRemoteListing: !truncated, checks: checkItems, runs: runItems };
      const semantic = receipt => { if (!receipt) return null; const { observedAt, ...other } = receipt; return fingerprint(other); };
      // Repeated reads of unchanged checks do not grow the persistent journal.
      if (semantic(value.ci) !== semantic(ci)) {
        value.ci = ci; save(value, 'CI_OBSERVED', { ciReceiptSha256: fingerprint(ci) });
      }
      return { ...result(value), remoteObservedAt: ci.observedAt };
    });
  }
  async function probe() {
    available(); try { return await authorization(); }
    catch (error) { return { state: 'UNAVAILABLE', code: error instanceof PublisherError ? error.code : 'PUBLISH_REMOTE_UNAVAILABLE' }; }
  }
  function capabilities() {
    return { schemaVersion: SCHEMA, state: configState, repository: REPOSITORY, baseBranch: BASE,
      publish: options ? 'OPT_IN_DRAFT_ONLY_AUTH_NOT_OBSERVED' : 'NOT_CONFIGURED',
      ci: options ? 'REMOTE_METADATA_ONLY' : 'NOT_CONFIGURED', modelCanExecuteCommands: false,
      canMerge: false, canDeploy: false, canDispatch: false, credentialReadByApplication: false };
  }
  return { capabilities, probe, publishDraft, reconcile, readCi, readPublication };
}
module.exports = { createPublisher, PublisherError, environment, defaultRunner, REPOSITORY, SCHEMA };
