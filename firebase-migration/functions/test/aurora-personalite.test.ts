import assert from 'node:assert/strict';
import test from 'node:test';
import { AURORA_NATIVE_ROUTINES, nativeRoutineSummary, calculatePersonaliteNps as nps } from '../src/auroraNativeRoutines.ts';

test('Personalité is represented once, governed and inactive', () => {
  const entries = AURORA_NATIVE_ROUTINES.filter(r => r.id === 'AURORA-PERSONALITE-001');
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.state, 'NATIVE_GOVERNED');
  assert.equal(entries[0]?.tenantScope, 'PER_ORG');
  assert.equal(entries[0]?.humanGate, true);
  const p = nativeRoutineSummary().personalitePolicy as Record<string, unknown>;
  assert.equal(p.version, '0.1.0');
  for (const key of ['permissionsGranted', 'schedulerCreated', 'executorCreated', 'runtimeAdoptionVerified', 'tenantRawDataTransferAllowed']) assert.equal(p[key], false);
});
test('NPS includes passives and reports response rate independently', () => {
  const r = nps({promoters: 6, passives: 2, detractors: 2, invited: 20});
  assert.equal(r.score, 40); assert.equal(r.validResponses, 10);
  assert.equal(r.responseRatePercent, 50); assert.equal(r.publicationAuthorized, false);
});
test('extremes and all-passive responses are measured, never inferred', () => {
  assert.equal(nps({promoters: 1, passives: 0, detractors: 0}).score, 100);
  assert.equal(nps({promoters: 0, passives: 0, detractors: 1}).score, -100);
  assert.equal(nps({promoters: 0, passives: 1, detractors: 0}).score, 0);
});
test('no responses is not zero NPS; unknown invitation count is not zero rate', () => {
  const empty = nps({promoters: 0, passives: 0, detractors: 0, invited: 0});
  assert.equal(empty.score, null); assert.equal(empty.state, 'NO_RESPONSES');
  assert.equal(empty.responseRatePercent, null);
  assert.equal(nps({promoters: 0, passives: 0, detractors: 0, invited: 10}).responseRatePercent, 0);
  assert.equal(nps({promoters: 1, passives: 0, detractors: 0}).responseRatePercent, null);
});
test('malformed, negative, fractional, missing and nonfinite counts fail closed', () => {
  for (const input of [null, [], {}, '1', {promoters: 1, detractors: 0},
    ...[-1, 0.5, NaN, Infinity, '1', undefined].map(promoters => ({promoters, passives: 0, detractors: 0}))]) {
    assert.equal(nps(input).state, 'INVALID_INPUT'); assert.equal(nps(input).score, null);
  }
});
test('invalid denominators and unsafe totals fail closed', () => {
  for (const invited of [0, -1, 1.5, '2', Infinity]) assert.equal(nps({promoters: 2, passives: 0, detractors: 0, invited}).state, 'INVALID_INPUT');
  assert.equal(nps({promoters: Number.MAX_SAFE_INTEGER, passives: 1, detractors: 0}).state, 'INVALID_INPUT');
});
