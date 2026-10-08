'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { loadRegistry, selectKnowledge, validateRegistry, MAX_FILE_BYTES } = require(process.env.AURORA_TEST_REGISTRY || './knowledge-registry.cjs');
function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-registry-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'registry.json');
  const value = { schemaVersion: '1.0.0', version: '1.0.0', classification: 'INTERNAL_SANITIZED_METHODS', recordCount: 1,
    records: [{ id: 'KH-TEST', version: '1.0.0', title: 'Synthetic validation', knowledgeState: 'REGISTERED', technicalState: 'SPECIFIED',
      runtimeVerified: false, prompt: { text: 'Test synthetic safety before promotion.' }, procedure: ['Check evidence.'], limits: ['No execution.'],
      regression: { state: 'NOT_RUN' }, sourceRefs: ['S01'], ...overrides }] };
  const write = () => fs.writeFileSync(file, JSON.stringify(value)); write();
  return { file, value, write };
}
test('suspended/rejected/revoked/superseded/unknown technical states are excluded', t => {
  const f = fixture(t);
  for (const state of ['SUSPENDED', 'REJECTED', 'REVOKED', 'SUPERSEDED', 'UNREVIEWED_UNKNOWN']) {
    f.value.records[0].technicalState = state; f.write();
    const r = loadRegistry(f.file); assert.equal(r.status, 'LOADED'); assert.equal(r.records.length, 0);
    assert.equal(r.rejectedCount, 1); assert.deepEqual(selectKnowledge(r, 'KH-TEST').recordIds, []);
  }
});
test('candidate context preserves unverified runtime and unexecuted tests', t => {
  const f = fixture(t), r = selectKnowledge(loadRegistry(f.file), 'KH-TEST');
  const record = JSON.parse(r.context.split('\n')[1]);
  assert.equal(record.technicalState, 'SPECIFIED'); assert.equal(record.runtimeVerified, false);
  assert.equal(record.regressionState, 'NOT_RUN'); assert.equal(record.usage, 'REFERENCE_ONLY_NO_EXECUTION_AUTHORITY');
});
test('budget includes UTF-8 header and never overflows', t => {
  const f = fixture(t, { title: 'Valida\u00e7\u00e3o e mem\u00f3ria' }), registry = loadRegistry(f.file);
  for (const budget of [0, 1, 100, 250, 500, 11000]) {
    const r = selectKnowledge(registry, 'KH-TEST', budget);
    assert.ok(Buffer.byteLength(r.context, 'utf8') <= budget); assert.equal(r.contextBytes, Buffer.byteLength(r.context, 'utf8'));
  }
});
test('invalid budgets fail explicitly', t => {
  const f = fixture(t), r = loadRegistry(f.file);
  for (const budget of [NaN, Infinity, -1, 1.5, '500', 11001]) assert.throws(() => selectKnowledge(r, 'KH-TEST', budget), /BUDGET_INVALID/);
});
test('same digest reuses parsed immutable corpus', t => {
  const f = fixture(t), a = loadRegistry(f.file), b = loadRegistry(f.file);
  assert.strictEqual(a, b); assert.ok(Object.isFrozen(a.records)); assert.ok(Object.isFrozen(a.records[0]));
});
test('same-size change with restored mtime still invalidates cached content', t => {
  const f = fixture(t, { title: 'Alpha' }), a = loadRegistry(f.file), before = fs.statSync(f.file);
  f.value.records[0].title = 'Bravo'; f.write(); fs.utimesSync(f.file, before.atime, before.mtime);
  const b = loadRegistry(f.file); assert.notEqual(a.corpusHash, b.corpusHash); assert.equal(b.records[0].title, 'Bravo');
});
test('corruption never serves previous cached records', t => {
  const f = fixture(t); assert.equal(loadRegistry(f.file).records.length, 1);
  fs.writeFileSync(f.file, '{invalid'); const r = loadRegistry(f.file);
  assert.equal(r.status, 'INVALID_OR_UNAVAILABLE'); assert.deepEqual(r.records, []);
});
test('missing source never serves previous cached records', t => {
  const f = fixture(t); loadRegistry(f.file); fs.unlinkSync(f.file);
  assert.equal(loadRegistry(f.file).errorCode, 'REGISTRY_NOT_FOUND');
});
test('different paths do not share mutable corpus instances', t => {
  const a = fixture(t), b = fixture(t); assert.notStrictEqual(loadRegistry(a.file), loadRegistry(b.file));
});
test('schema rejects duplicate IDs and invalid arrays; count-only mismatch is advisory', t => {
  const f = fixture(t); f.value.recordCount = 2; f.write();
  assert.deepEqual(loadRegistry(f.file).warnings, ['DECLARED_COUNT_MISMATCH']); assert.equal(loadRegistry(f.file).records.length, 1);
  f.value.records.push(f.value.records[0]); assert.throws(() => validateRegistry(f.value), /DUPLICATE_ID/);
  f.value.records.pop(); f.value.recordCount = 1; f.value.records[0].procedure = ['safe', {}];
  assert.throws(() => validateRegistry(f.value), /ARRAY_INVALID/);
});
test('oversized files are rejected before unbounded read/parse', t => {
  const f = fixture(t), fd = fs.openSync(f.file, 'w'); fs.ftruncateSync(fd, MAX_FILE_BYTES + 1); fs.closeSync(fd);
  assert.equal(loadRegistry(f.file).status, 'INVALID_OR_UNAVAILABLE');
});
test('revocation flag excludes references immediately', t => {
  const f = fixture(t); loadRegistry(f.file); f.value.records[0].revoked = true; f.write();
  assert.deepEqual(selectKnowledge(loadRegistry(f.file), 'KH-TEST').recordIds, []);
});
test('explicit record ID remains first and retrieval is deterministic', t => {
  const f = fixture(t), r = loadRegistry(f.file);
  assert.deepEqual(selectKnowledge(r, 'KH-TEST').recordIds, ['KH-TEST']);
  assert.deepEqual(selectKnowledge(r, 'KH-TEST'), selectKnowledge(r, 'KH-TEST'));
});
