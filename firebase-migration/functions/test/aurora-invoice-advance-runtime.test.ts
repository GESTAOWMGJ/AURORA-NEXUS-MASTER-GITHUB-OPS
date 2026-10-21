import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { visibleProjection } from '../src/auroraRuntime.js';
const childFile = fileURLToPath(new URL('./fixtures/invoice-advance-runtime-child.cjs', import.meta.url));
async function run(filename: string, mode: string) {
  const child = fork(childFile, [filename, mode], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let error = ''; child.stderr!.on('data', chunk => error += chunk);
  const ended = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const message: any = await new Promise((resolve, reject) => {
      child.once('message', resolve); child.once('exit', code => reject(Error(`child exited ${code}: ${error}`)));
    });
    if (mode !== 'done') {
      assert.equal(message.stage, mode); child.kill('SIGKILL');
      const [code, signal] = await ended; assert.equal(code, null); assert.equal(signal, 'SIGKILL');
    } else { assert.equal(message.stage, 'done'); await ended; }
    return message;
  } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}
for (const stage of ['before-commit', 'after-commit']) test(`real process death ${stage} recovers through the same projection transaction and idempotency key`, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-advance-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'synthetic-transaction.json'); fs.writeFileSync(file, '{}');
  await run(file, stage);
  const interrupted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Object.keys(interrupted).length, stage === 'before-commit' ? 0 : 4);
  const first = await run(file, 'done'), committed = fs.readFileSync(file, 'utf8');
  const replay = await run(file, 'done');
  assert.equal(fs.readFileSync(file, 'utf8'), committed);
  assert.deepEqual(replay.receipt, first.receipt); assert.equal(first.receipt.recognizedCostCents, 10000);
  assert.equal(Object.keys(JSON.parse(committed)).filter(k => k.includes('/dashboardSnapshotHistory/')).length, 1);
  assert.equal(Object.keys(JSON.parse(committed)).filter(k => k.includes('/auditEvents/')).length, 1);
});
test('finance permission protects method amounts and private document links on the existing projection', () => {
  const member: any = { orgId: 'tenant-synthetic', role: 'viewer', permissions: [] };
  const projection = { invoiceAdvanceReconciliation: { recognizedCostCents: 10000, obligations: [{ invoiceId: 'private-ref' }] } };
  assert.equal(visibleProjection(projection, member).invoiceAdvanceReconciliation, null);
  assert.deepEqual(visibleProjection(projection, { ...member, role: 'finance' }), projection);
});
