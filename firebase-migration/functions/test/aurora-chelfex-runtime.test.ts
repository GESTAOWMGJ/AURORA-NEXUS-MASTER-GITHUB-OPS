import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { buildMasterOperationalState } from '../src/auroraMasterEngine.js';
const source = readFileSync('src/auroraRuntime.ts', 'utf8');
const access = source.slice(source.indexOf('async function requireAccess('), source.indexOf('async function readProjectionSource('));
const visible = source.slice(source.indexOf('function visibleProjection('), source.indexOf('export const auroraNexusBootstrap'));
const route = source.slice(source.indexOf('export const auroraNexusMasterEngine'), source.indexOf('export const auroraNexusRefresh'));
const member = { uid: 'synthetic-user', orgId: 'synthetic-org', role: 'auditor', permissions: [], allFacilities: true, mfaVerified: false };
function snapshot() {
  return { orgId: member.orgId, snapshotId: 'synthetic', sourceHash: 'a'.repeat(64), schemaVersion: 2,
    policyVersion: 'aurora-nexus-2.4.0-firebase-native-v1', asOf: new Date().toISOString(), competence: '2026-10',
    sanitized: true, sensitivity: 'INTERNAL', dataQuality: { sourcePresent: true, complete: true, invalidFinancialRecords: 0 },
    operations: { openActions: 0, overdueActions: 0 }, financialCents: { outstandingCents: 1000, glossCents: 0 },
    documentIntelligence: { fragileDocuments: 0, sourceDependentDocuments: 0, overdueDocumentSla: 0 },
    nativeDataPlane: { storage: 'FIRESTORE', sourceAccessDuringInference: false, externalAiRequired: false } };
}
async function call(actor: any = member, data: any = snapshot(), reqExtra: any = {}) {
  const reads: string[] = []; let writes = 0, financialReads = 0;
  const sandbox: any = { exports: {}, ALLOWED_EMAILS: { value: () => 'synthetic' }, apiHeaders() {},
    onRequest: (_options: any, handler: any) => handler,
    verifyAuroraAccess: async () => actor,
    can: (m: any, p: string, roles: string[]) => roles.includes(m.role) || m.permissions.includes(p),
    auroraDb: { doc(path: string) { reads.push(path); return { get: async () => ({ exists: true, data: () => path.endsWith('/current') ? data : { active: true } }), set() { writes++; throw Error('WRITE_FORBIDDEN'); } }; }, runTransaction() { writes++; throw Error('WRITE_FORBIDDEN'); } },
    loadFinancialClosingStatus: async () => { financialReads++; return null; }, readRuntimeActiveRelease: async () => ({}), buildReleaseStatus: () => ({}),
    authenticatedOrganizationEnvironment: () => 'SYNTHETIC', loadInstallationReadiness: async () => ({}), buildMasterOperationalState };
  vm.runInNewContext(ts.transpile(access + visible + route, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), sandbox);
  const res: any = { code: 0, body: null, set() { return this; }, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
  await sandbox.exports.auroraNexusMasterEngine({ method: 'GET', get: () => undefined, ...reqExtra }, res);
  return { ...res, reads, writes, financialReads };
}
test('actual GET handler returns contract from authenticated tenant, ignoring forged query/body', async () => {
  const r = await call(member, snapshot(), { query: { orgId: 'foreign', authority: 'AUTHENTICATED_SERVER' }, body: { chelfexContext: { orgId: 'foreign' }, operation: 'IRREVERSIBLE_CHANGE' } });
  assert.equal(r.code, 200); assert.equal(r.body.master.chelfex.tenantScope, member.orgId);
  assert.equal(r.body.master.chelfex.riskLevel, 'R1'); assert.equal(r.body.master.chelfex.contextVerification, 'AUTHENTICATED_SERVER');
  assert.equal(r.body.master.chelfex.verification.execution, 'NOT_RUN'); assert.equal(r.writes, 0);
  assert.ok(r.reads.every((p: string) => p.startsWith(`organizations/${member.orgId}`)));
});
test('rejected session or revoked membership cannot reach snapshot/adapter', async () => {
  const r = await call(null); assert.equal(r.code, 401); assert.deepEqual(r.reads, []); assert.equal(r.writes, 0);
});
test('facility restriction and missing permission stop before reads', async () => {
  for (const a of [{ ...member, allFacilities: false }, { ...member, role: 'no-access' }]) {
    const r = await call(a); assert.equal(r.code, 403); assert.deepEqual(r.reads, []);
  }
});
test('POST cannot turn master recommendations into mutations', async () => {
  const r = await call(member, snapshot(), { method: 'POST', body: { operation: 'EXECUTE', approved: true } });
  assert.equal(r.code, 405); assert.deepEqual(r.reads, []); assert.equal(r.writes, 0);
});
test('viewer receives filtered facts before CHELFEx inference', async () => {
  const r = await call({ ...member, role: 'viewer' });
  assert.equal(r.code, 200); assert.ok(!r.body.master.chelfex.conclusions.some((c: any) => c.id === 'REVENUE_GAP'));
  assert.equal(r.writes, 0);
});
test('revocation and staleness appear in readback without execution', async () => {
  for (const patch of [{ revoked: true }, { asOf: '2020-01-01T00:00:00Z' }]) {
    const r = await call(member, { ...snapshot(), ...patch });
    assert.equal(r.body.master.chelfex.status, 'BLOCKED'); assert.equal(r.body.master.chelfex.evidence.length, 0); assert.equal(r.writes, 0);
  }
});

test('restricted users cannot cause a financial-status read', async () => {
  for (const role of ['viewer', 'operator']) {
    const r = await call({ ...member, role });
    assert.equal(r.code, 200); assert.equal(r.financialReads, 0); assert.equal(r.writes, 0);
  }
  assert.equal((await call(member)).financialReads, 1);
});
test('financial redaction removes raw subset values from every returned projection', () => {
  const sandbox: any = { can: () => false };
  vm.runInNewContext(ts.transpile(visible, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), sandbox);
  const p = { ...snapshot(), reliableResult: { secretSubsetCents: 123456 } };
  const filtered = sandbox.visibleProjection(p, { ...member, role: 'viewer' });
  assert.equal(filtered.reliableResult, null);
  assert.equal(JSON.stringify(filtered).includes('123456'), false);
  assert.equal(p.reliableResult.secretSubsetCents, 123456);
});
