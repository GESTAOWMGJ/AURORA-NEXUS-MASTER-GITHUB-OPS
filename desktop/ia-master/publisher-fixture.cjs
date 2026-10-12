'use strict';
// Synthetic remote transport used ONLY by tests. No GitHub command is executed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { defaultRunner, REPOSITORY } = require('./publisher.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function syntheticPublisher({ directory, orgId, gitExecutable, baseRevision, preparedCommit }) {
  const ghExecutable = path.join(directory, process.platform === 'win32' ? 'gh.exe' : 'gh');
  fs.writeFileSync(ghExecutable, 'INERT SYNTHETIC CLI; NEVER EXECUTED\n');
  const remote = { account: 'GESTAOWMGJ', branch: null, head: null, pull: null, pushes: 0, creates: 0, calls: [], bodies: [] };
  const json = (value, status = 200) => ({ status: status === 200 ? 0 : 1,
    stdout: 'HTTP/2.0 ' + status + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(value), stderr: '' });
  const prefix = 'repos/' + REPOSITORY;
  const runner = async request => {
    const args = request.args; remote.calls.push({ tool: request.tool, args });
    if (request.tool === 'git') {
      if (!args.includes('push')) return defaultRunner(request);
      assert.ok(args.includes('https://github.com/' + REPOSITORY + '.git'));
      assert.ok(args.includes('--force-with-lease=refs/heads/' + remote.branch + ':'));
      assert.equal(args.at(-1), preparedCommit() + ':refs/heads/' + remote.branch);
      remote.pushes++; remote.head = preparedCommit(); return { status: 0, stdout: '', stderr: '' };
    }
    assert.equal(request.tool, 'gh');
    if (args[0] === 'pr') {
      assert.equal(args[1], 'create'); assert.ok(args.includes('--draft')); assert.ok(args.includes('--no-maintainer-edit'));
      assert.equal(args[args.indexOf('--repo') + 1], REPOSITORY);
      assert.equal(args[args.indexOf('--head') + 1], remote.branch);
      assert.equal(args[args.indexOf('--body-file') + 1], '-'); assert.equal(typeof request.input, 'string');
      remote.bodies.push(request.input); remote.creates++;
      remote.pull = { number: 456, html_url: 'https://github.com/' + REPOSITORY + '/pull/456', state: 'open',
        draft: true, maintainer_can_modify: false, head: { ref: remote.branch, sha: remote.head, repo: { full_name: REPOSITORY } },
        base: { ref: 'main', sha: baseRevision, repo: { full_name: REPOSITORY } } };
      return { status: 0, stdout: remote.pull.html_url, stderr: '' };
    }
    assert.equal(args[0], 'api'); assert.equal(args[args.indexOf('--method') + 1], 'GET');
    const endpoint = args[1];
    if (endpoint === 'user') return json({ login: remote.account });
    if (endpoint === prefix) return json({ full_name: REPOSITORY, default_branch: 'main', archived: false, permissions: { push: true } });
    if (endpoint === prefix + '/branches/main') return json({ name: 'main', commit: { sha: baseRevision } });
    if (endpoint.startsWith(prefix + '/git/ref/heads/')) {
      const branch = endpoint.slice((prefix + '/git/ref/heads/').length); assert.match(branch, /^aurora-studio\/[a-f0-9]{32}$/);
      if (remote.branch !== null) assert.equal(branch, remote.branch); remote.branch = branch;
      return remote.head ? json({ ref: 'refs/heads/' + branch, object: { type: 'commit', sha: remote.head } }) : json({}, 404);
    }
    if (endpoint.startsWith(prefix + '/pulls?')) return json(remote.pull ? [remote.pull] : []);
    if (endpoint === prefix + '/pulls/456') return json(remote.pull);
    if (endpoint === prefix + '/commits/' + preparedCommit() + '/check-runs?per_page=100') return json({
      total_count: 1, check_runs: [{ id: 77, name: 'Synthetic fixed check', head_sha: preparedCommit(),
        status: 'completed', conclusion: 'success', details_url: null }] });
    if (endpoint === prefix + '/actions/runs?head_sha=' + preparedCommit() + '&event=pull_request&per_page=100') return json({
      total_count: 1, workflow_runs: [{ id: 88, workflow_id: 33, head_sha: preparedCommit(), event: 'pull_request',
        status: 'completed', conclusion: 'success', html_url: 'https://github.com/' + REPOSITORY + '/actions/runs/88',
        pull_requests: [{ number: 456 }] }] });
    assert.fail('Unexpected synthetic remote operation');
  };
  return { config: { enabled: true, authorizedOrgId: orgId, ghExecutable,
    ghSha256: digest(fs.readFileSync(ghExecutable)), gitSha256: digest(fs.readFileSync(gitExecutable)) }, runner, remote };
}
module.exports = { syntheticPublisher };
