'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { runLearningCycle, readBoundedInput, assertAuthenticatedServiceTenant } = require('./motor-learning.cjs');
const input = { key: 'same-document-v1', prompt: 'Resolve a synthetic engineering interruption.', classification: 'PUBLIC', flow: ['observe', 'propose', 'verify'] };
const receiptKey = 'x'.repeat(48);
const result = { state: 'PROPOSAL_ONLY', applied: false, proposalId: 'synthetic', proposal: { text: 'Synthetic proposal, not an executed change.', model: 'test' }, knowledge: { corpusHash: 'abc' } };
function fixture(t, org = 'company-a') {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-motor-'));
  fs.writeFileSync(path.join(stateDir, 'organization.txt'), org);
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  return { stateDir, orgId: org, input, receiptKey, request: async () => result };
}
test('one persistent learning and one inference for a repeated tenant key', async t => {
  const f = fixture(t); let calls = 0; f.request = async () => { calls++; return result; };
  const a = await runLearningCycle(f), b = await runLearningCycle(f);
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(calls, 1);
  assert.equal(fs.readdirSync(path.dirname(a.file)).length, 1);
  assert.equal(a.record.learning.state, 'PROPOSED'); assert.equal(a.record.learning.applied, false);
  assert.equal(a.record.learning.cloudSyncVerified, false);
  assert.match(a.record.receipt.authentication, /^[0-9a-f]{64}$/);
});
test('same source key in two companies produces separate identities and states', async t => {
  const a = await runLearningCycle(fixture(t, 'company-a'));
  const b = await runLearningCycle(fixture(t, 'company-b'));
  assert.notEqual(a.record.recordId, b.record.recordId);
  assert.notEqual(a.file, b.file);
  assert.equal(a.record.learning.orgId, 'company-a'); assert.equal(b.record.learning.orgId, 'company-b');
});
test('configured tenant mismatch blocks inference and persistence', async t => {
  const f = fixture(t); f.orgId = 'company-b'; f.request = () => assert.fail('unexpected inference');
  await assert.rejects(runLearningCycle(f), /MOTOR_TENANT_MISMATCH/);
});
test('same idempotency key with different input is rejected', async t => {
  const f = fixture(t); await runLearningCycle(f);
  await assert.rejects(runLearningCycle({ ...f, input: { ...input, prompt: 'A different synthetic request.' } }), /MOTOR_SCOPE_OR_KEY_CONFLICT/);
});
test('tampered private record is rejected without reusing it', async t => {
  const f = fixture(t), a = await runLearningCycle(f), record = a.record;
  record.learning.response = 'tampered'; fs.writeFileSync(a.file, JSON.stringify(record));
  await assert.rejects(runLearningCycle(f), /MOTOR_RECEIPT_INVALID/);
});
test('concurrent owner is denied and cannot create a second effect', async t => {
  const f = fixture(t); let finish; f.request = () => new Promise(resolve => { finish = resolve; });
  const running = runLearningCycle(f);
  await assert.rejects(runLearningCycle(f), /MOTOR_CYCLE_IN_PROGRESS/);
  finish(result); await running;
});
test('failed inference leaves no learned success and can be retried', async t => {
  const f = fixture(t); f.request = async () => { throw Error('interrupted'); };
  await assert.rejects(runLearningCycle(f), /interrupted/);
  const recovered = await runLearningCycle({ ...f, request: async () => result });
  assert.equal(recovered.duplicate, false); assert.equal(recovered.record.learning.state, 'PROPOSED');
});
test('invalid operational response cannot become a learned resolution', async t => {
  const f = fixture(t); f.request = async () => ({ ...result, applied: true });
  await assert.rejects(runLearningCycle(f), /MOTOR_PROPOSAL_CONTRACT_INVALID/);
});
test('secrets in prompt or flow and forbidden classification are rejected', async t => {
  const f = fixture(t);
  for (const input of [
    { ...f.input, prompt: 'Bearer private-credential-123' },
    { ...f.input, flow: ['Bearer private-credential-123'] },
    { ...f.input, classification: 'SENSITIVE' }
  ]) await assert.rejects(runLearningCycle({ ...f, input }), /MOTOR_SENSITIVE_INPUT_REJECTED|MOTOR_CLASSIFICATION_REJECTED/);
});

test('foreign learned payload cannot be relabeled even with outer ids rewritten', async t => {
  const a = await runLearningCycle(fixture(t, 'company-a'));
  const fb = fixture(t, 'company-b'), b = await runLearningCycle(fb);
  const forged = { ...b.record, learning: a.record.learning, receipt: a.record.receipt };
  fs.writeFileSync(b.file, JSON.stringify(forged));
  await assert.rejects(runLearningCycle(fb), /MOTOR_SCOPE_OR_KEY_CONFLICT/);
});
test('sensitive model output is not persisted', async t => {
  const f = fixture(t);
  f.request = async () => ({ ...result, proposal: { text: 'Bearer private-output-123' } });
  await assert.rejects(runLearningCycle(f), /MOTOR_SENSITIVE_OUTPUT_REJECTED/);
});

test('oversized and symlinked input files are rejected before JSON parse', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-bounded-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'large.json');
  fs.writeFileSync(file, 'x'.repeat(32769));
  assert.throws(() => readBoundedInput(file), /MOTOR_INPUT_FILE_REJECTED/);
  const link = path.join(dir, 'symlink.json');
  try {
    fs.symlinkSync(file, link);
    assert.throws(() => readBoundedInput(link), /MOTOR_INPUT_FILE_REJECTED/);
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
  }
});
test('authenticated local service must belong to configured organization', () => {
  assert.doesNotThrow(() => assertAuthenticatedServiceTenant({ orgId: 'company-a' }, 'company-a'));
  assert.throws(() => assertAuthenticatedServiceTenant({ orgId: 'company-b' }, 'company-a'), /MOTOR_SERVICE_TENANT_MISMATCH/);
  assert.throws(() => assertAuthenticatedServiceTenant({}, 'company-a'), /MOTOR_SERVICE_TENANT_MISMATCH/);
});
