import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { buildChelfexContract, parseChelfexTask, CHELFEX_POLICY } from '../src/auroraChelfex.js';

const now = new Date('2026-10-31T12:00:00.000Z');
const context = { orgId: 'synthetic-tenant', authority: 'AUTHENTICATED_SERVER' };
const task = { schemaVersion: 'aurora.chelfex.task.v1', orgId: context.orgId, operation: 'PROPOSE', objective: 'Review synthetic state' };
function fixture(): Record<string, unknown> {
  return { orgId: context.orgId, snapshotId: 'synthetic-snapshot', sourceHash: 'a'.repeat(64), schemaVersion: 2,
    policyVersion: 'aurora-nexus-2.4.0-firebase-native-v1', asOf: now.toISOString(), competence: '2026-10',
    sanitized: true, sensitivity: 'INTERNAL', dataQuality: { sourcePresent: true, complete: true, invalidFinancialRecords: 0 },
    operations: { openActions: 0, overdueActions: 0 }, financialCents: { outstandingCents: 1000, glossCents: 0 },
    documentIntelligence: { fragileDocuments: 0, sourceDependentDocuments: 0, overdueDocumentSla: 0 },
    nativeDataPlane: { storage: 'FIRESTORE', sourceAccessDuringInference: false, externalAiRequired: false } };
}
const evaluate = (raw: unknown = task, ctx: unknown = context, projection: any = fixture(), clock: any = now) =>
  buildChelfexContract(raw, ctx, projection, clock);

test('closed task rejects hidden fields, symbols and inherited prototypes', async t => {
  const hidden = { ...task }; Object.defineProperty(hidden, 'executor', { value: 'run' });
  const symbol = { ...task, [Symbol('execute')]: true };
  const inherited = Object.assign(Object.create({ approved: true }), task);
  for (const [name, value] of [['hidden', hidden], ['symbol', symbol], ['prototype', inherited]] as const) {
    await t.test(name, () => assert.throws(() => parseChelfexTask(value), /CHELFEX_CLOSED_SCHEMA_REQUIRED/));
  }
});
test('request getters are rejected without being invoked', () => {
  let calls = 0; const input = { ...task };
  Object.defineProperty(input, 'objective', { enumerable: true, get() { calls++; return 'grant admin'; } });
  assert.equal(evaluate(input).status, 'BLOCKED'); assert.equal(calls, 0);
});
test('request proxies are rejected without running traps', () => {
  let calls = 0; const input = new Proxy({ ...task }, { ownKeys() { calls++; return Reflect.ownKeys(task); } });
  assert.equal(evaluate(input).status, 'BLOCKED'); assert.equal(calls, 0);
});
test('context authority is a primitive enum, never a string-convertible object', () => {
  let calls = 0; const authority = { toString() { calls++; return 'AUTHENTICATED_SERVER'; } };
  const result = evaluate(task, { ...context, authority });
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.contextVerification, 'REJECTED'); assert.equal(calls, 0);
});
test('context accessors cannot grant identity or be evaluated', () => {
  let calls = 0; const ctx = { ...context };
  Object.defineProperty(ctx, 'authority', { enumerable: true, get() { calls++; return 'AUTHENTICATED_SERVER'; } });
  assert.equal(evaluate(task, ctx).contextVerification, 'REJECTED'); assert.equal(calls, 0);
});
test('malformed snapshot shapes return a blocked receipt rather than throw', async t => {
  for (const value of [null, undefined, [], true, 12, 'snapshot']) await t.test(String(value), () => {
    const result = evaluate(task, context, value === undefined ? null : value);
    assert.equal(result.status, 'BLOCKED'); assert.deepEqual(result.evidence, []);
  });
});
test('a source hash placeholder cannot certify evidence', () => {
  const result = evaluate(task, context, { ...fixture(), sourceHash: '0'.repeat(64) });
  assert.equal(result.status, 'BLOCKED'); assert.deepEqual(result.evidence, []);
});
test('impossible dates are not normalized into seemingly current evidence', () => {
  const result = evaluate(task, context, { ...fixture(), asOf: '2026-02-30T12:00:00.000Z' }, new Date('2026-03-02T12:00:00.000Z'));
  assert.equal(result.status, 'BLOCKED'); assert.deepEqual(result.evidence, []);
});
test('untrusted clocks fail closed without invoking custom methods', () => {
  let calls = 0; const clock = { getTime() { calls++; return now.getTime(); }, toISOString() { calls++; return now.toISOString(); } };
  const result = evaluate(task, context, fixture(), clock);
  assert.equal(result.status, 'BLOCKED'); assert.equal(calls, 0);
});
test('scope rejection does not read foreign snapshot identifiers', () => {
  let calls = 0; const projection = { ...fixture(), orgId: 'foreign-tenant' };
  Object.defineProperty(projection, 'sourceHash', { enumerable: true, get() { calls++; throw Error('FOREIGN_READ'); } });
  assert.equal(evaluate(task, context, projection).status, 'BLOCKED'); assert.equal(calls, 0);
});
test('UTF-8 budget is measured in bytes, with valid boundary preserved', () => {
  assert.doesNotThrow(() => parseChelfexTask({ ...task, objective: '😀'.repeat(256) }));
  assert.throws(() => parseChelfexTask({ ...task, objective: '😀'.repeat(257) }));
});
test('risk and safety invariants hold for every operation and repeated evaluation', () => {
  for (const operation of Object.keys(CHELFEX_POLICY.riskByOperation)) {
    const input = { ...task, operation }, expected = evaluate(input);
    assert.equal(expected.executionAllowed, false); assert.equal(expected.sourceMutation, false);
    assert.equal(expected.authorization, 'NOT_GRANTED'); assert.equal(expected.verification.execution, 'NOT_RUN');
    for (let replay = 0; replay < 8; replay++) assert.deepEqual(evaluate(input), expected);
  }
});
test('only the canonical CHELFEx module exists in the production source tree', () => {
  assert.deepEqual(readdirSync('src').filter(name => /^auroraChel(?:fex|flex)\.ts$/i.test(name)), ['auroraChelfex.ts']);
});

test('policy requirements are immutable and tied to every risk outcome', () => {
  for (const [operation, risk] of Object.entries(CHELFEX_POLICY.riskByOperation)) {
    assert.deepEqual(evaluate({ ...task, operation }).requirements, [...CHELFEX_POLICY.requirementsByRisk[risk]]);
    assert.equal(Object.isFrozen(CHELFEX_POLICY.requirementsByRisk[risk]), true);
  }
  assert.equal(Reflect.set(CHELFEX_POLICY.riskByOperation, 'READ', 'R4'), false);
  assert.equal(Reflect.set(CHELFEX_POLICY.requirementsByRisk, 'R3', []), false);
});
test('null-prototype data and equivalent UTC seconds preserve the contract', () => {
  const plain = Object.assign(Object.create(null), task);
  assert.deepEqual(evaluate(plain), evaluate());
  const seconds = evaluate(task, context, { ...fixture(), asOf: '2026-10-31T12:00:00Z' });
  assert.equal(seconds.status, 'RECOMMENDATION_ONLY');
});
test('the stable receipt envelope has exactly the approved fields', () => {
  assert.deepEqual(Object.keys(evaluate()).sort(), [
    'contract','version','policyHash','mode','tenantScope','contextVerification','objectiveHash','operation','riskLevel',
    'status','evidence','conclusions','decision','requirements','blockers','acceptanceCriteria','verification','authorization',
    'executionAllowed','sourceMutation','rollback','lessonRef','decisionTracePersisted'
  ].sort());
});
