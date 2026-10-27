'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRegistry, selectKnowledge } = require('./knowledge-registry.cjs');
const editorial = require('./knowledge-records/editorial-master.v1.json');

function corpus(t, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-editorial-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: '1.0.0', version: 'synthetic-editorial',
    classification: 'INTERNAL_SANITIZED_METHODS', records }));
  return loadRegistry(file);
}
const unrelated = { id: 'SYN-FINANCE-001', version: '1.0.0', title: 'Conciliação bancária',
  knowledgeState: 'REGISTERED', technicalState: 'SPECIFIED', prompt: { text: 'Confrontar somente lançamentos sintéticos.' } };

test('real editorial record is recoverable by natural language in the existing loader', t => {
  const registry = corpus(t, [unrelated, editorial]);
  assert.equal(registry.status, 'LOADED');
  const selected = selectKnowledge(registry, 'Editorial marketing institucional Personalité timbrado convite manual');
  assert.equal(selected.recordIds[0], editorial.id);
  assert.equal(selected.recordIds.includes(unrelated.id), false);
  const payload = selected.context.split('\n').slice(1).map(JSON.parse).find(r => r.id === editorial.id);
  assert.deepEqual(payload.procedure, editorial.procedure);
  assert.deepEqual(payload.limits, editorial.limits);
  assert.equal(payload.operationalPrompt, editorial.prompt.text);
  assert.ok(Buffer.byteLength(selected.context) <= 11000);
});

test('revocation removes editorial method without dropping other knowledge', t => {
  const registry = corpus(t, [unrelated, { ...editorial, revoked: true }]);
  assert.equal(registry.rejectedCount, 1);
  const selected = selectKnowledge(registry, 'Editorial marketing institucional Personalité conciliação');
  assert.deepEqual(selected.recordIds, [unrelated.id]);
  assert.equal(selected.context.includes('AURORA-EDITORIAL-MASTER-001'), false);
});

test('small Studio budget omits the whole method instead of stripping its limits', t => {
  const registry = corpus(t, [editorial]);
  const selected = selectKnowledge(registry, 'Personalité', 600);
  assert.deepEqual(selected.recordIds, []);
  assert.ok(Buffer.byteLength(selected.context) <= 600);
  assert.equal(selected.context.includes(editorial.prompt.text), false);
});
