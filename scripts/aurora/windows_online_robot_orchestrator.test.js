'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { executeSafeRobots, result } = require('./windows_online_robot_orchestrator.js');
const root = process.cwd();
const success = (exe, args) => ({ status: 0, stdout: JSON.stringify(
  args[0].endsWith('generate_improvement_backlog.js') ? { dryRun: true, backlog: [] } : { passed: true }) });
test('planning alone never verifies execution or failover', () => {
  assert.equal(result.mode, 'PLAN_ONLY');
  assert.equal(result.operationalIntegrationVerified, false);
  assert.equal(result.failoverExecuted, false);
});
test('real subprocesses execute four safe robots in order', () => {
  const out = executeSafeRobots(result, { root });
  assert.equal(out.passed, true);
  assert.equal(out.receipts.filter(r => r.state === 'LOCAL_EXECUTION_VERIFIED').length, 4);
  assert.equal(out.receipts.filter(r => r.state === 'DECLARATIVE_POLICY').length, 4);
  assert.equal(out.receipts.at(-1).state, 'EXPLICIT_INPUT_REQUIRED');
  assert.equal(out.operationalIntegrationVerified, false);
  assert.equal(out.failoverExecuted, false);
});
test('executor uses fixed argv and hides credentials and output', () => {
  let count = 0;
  const modified = { ...result, startupOrder: result.startupOrder.map(r => ({ ...r, command: 'node evil.js' })) };
  const out = executeSafeRobots(modified, { run: (exe, args, opts) => {
    count++;
    assert.equal(exe, process.execPath);
    assert.equal(opts.shell, false);
    assert.equal(opts.env.AURORA_INTEGRATION_TOKEN, undefined);
    assert.equal(opts.timeout, 30000);
    assert.equal(args[0].includes('evil.js'), false);
    return success(exe, args);
  } });
  assert.equal(count, 4);
  assert.equal(out.passed, true);
  assert.match(out.receipts[0].outputSha256, /^[a-f0-9]{64}$/);
  assert.equal('stdout' in out.receipts[0], false);
});
for (const [name, response, failure] of [
  ['nonzero exit', { status: 1, stdout: '{"passed":true}' }, 'NONZERO_EXIT'],
  ['negative gate', { status: 0, stdout: '{"passed":false}' }, 'OUTPUT_CONTRACT_REJECTED'],
  ['invalid JSON', { status: 0, stdout: 'not-json' }, 'OUTPUT_CONTRACT_REJECTED'],
  ['timeout', { status: null, error: { code: 'ETIMEDOUT' } }, 'TIMEOUT'],
  ['spawn error', { status: null, error: { code: 'ENOENT' } }, 'SPAWN_OR_BUFFER_ERROR'],
  ['signal', { status: 0, signal: 'SIGTERM', stdout: '{"passed":true}' }, 'SIGNAL']
]) test(name + ' stops subsequent execution', () => {
  let calls = 0;
  const out = executeSafeRobots(result, { run: () => { calls++; return response; } });
  assert.equal(out.passed, false);
  assert.equal(calls, 1);
  assert.equal(out.receipts[0].failure, failure);
  assert.ok(out.receipts.slice(1).every(r => r.state === 'NOT_EXECUTED_PRIOR_FAILURE'));
});
test('failed policy plan executes nothing', () => {
  const out = executeSafeRobots({ ...result, passed: false }, { run: () => assert.fail('unexpected spawn') });
  assert.equal(out.passed, false);
});
test('unbounded timeout rejected', () => {
  assert.throws(() => executeSafeRobots(result, { timeoutMs: 60001 }), /INVALID_TIMEOUT/);
});
test('CLI rejects arbitrary arguments', () => {
  const out = spawnSync(process.execPath, [path.join(root, 'scripts/aurora/windows_online_robot_orchestrator.js'), '--remote-shell'], { encoding: 'utf8' });
  assert.equal(out.status, 1);
  assert.equal(JSON.parse(out.stdout).code, 'UNSUPPORTED_ARGUMENT');
});
test('policy checks cannot grant operational certification', () => {
  for (const script of ['platform_unification_robot.js', 'certification_security_gate.js']) {
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/aurora', script)], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    const out = JSON.parse(run.stdout);
    assert.equal(out.operationalIntegrationVerified, false);
    assert.equal(out.evidenceState, 'POLICY_VALIDATION_ONLY');
    if (out.integrationCertification) assert.equal(out.integrationCertification.certified, false);
  }
});
test('actual hanging child times out and stops later robots', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-robot-test-'));
  try {
    fs.mkdirSync(path.join(temporary, 'scripts/aurora'), { recursive: true });
    fs.writeFileSync(path.join(temporary, 'scripts/aurora/platform_unification_robot.js'), 'setInterval(() => {}, 1000);');
    const out = executeSafeRobots(result, { root: temporary, timeoutMs: 100 });
    assert.equal(out.passed, false);
    assert.equal(out.receipts[0].failure, 'TIMEOUT');
    assert.ok(out.receipts.slice(1).every(r => r.state === 'NOT_EXECUTED_PRIOR_FAILURE'));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
