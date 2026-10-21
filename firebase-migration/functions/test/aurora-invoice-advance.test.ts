import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { evaluateInvoiceAdvances, INVOICE_ADVANCE_METHOD } from '../src/auroraInvoiceAdvance.js';
import { buildProjection } from '../src/auroraEngine.js';
import { generateNativeInsight } from '../src/auroraNativeIntelligence.js';
const fixture = createRequire(import.meta.url)('./fixtures/invoice-advance.cjs');
const evaluate = (f: any): any => evaluateInvoiceAdvances(f.source, f.orgId, f.competence);
const pending = (f: any, code: string) => {
  const result = evaluate(f);
  assert.equal(result.status, 'PENDING_EVIDENCE'); assert.ok(result.issueCodes.includes(code), JSON.stringify(result.issueCodes));
  assert.equal(result.recognizedCostCents, null); assert.deepEqual(result.obligations, []);
  assert.equal(result.financialEffect, false);
};
test('method bytes are pinned and no package replaces the private corpus', () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../../policy/invoice-advance-reconciliation-v1.json', import.meta.url))).digest('hex'), INVOICE_ADVANCE_METHOD.policySha256);
});
test('one economic event is recognized once, separately from invoice, ledger and bank dates', () => {
  const f = fixture(), before = JSON.stringify(f), r = evaluate(f);
  assert.equal(r.status, 'EVALUATED_READ_ONLY'); assert.equal(r.recognizedCostCents, 10000);
  assert.equal(r.obligations[0].allocatedCashCents, 9000); assert.equal(r.netResultCents, null); assert.equal(r.totalCostsCents, null);
  const row = r.obligations[0];
  assert.equal(row.serviceCompetence, '2026-08'); assert.equal(row.issueDate, '2026-10-10');
  assert.equal(row.ledgerPostingDate, '2026-10-11'); assert.equal(row.payments[0].postingDate, '2026-08-20');
  assert.equal(row.payments[0].historyDate, '2026-08-19'); assert.deepEqual(row.economicEvidence, f.source.reconciliations[0].advance.economic.evidence);
  assert.deepEqual(evaluate(f), r); assert.equal(JSON.stringify(f), before);
});
test('replayed obligations and allocation rows do not duplicate recognition', () => {
  const f = fixture();
  f.source.reconciliations[0].advance.payments.push(structuredClone(f.source.reconciliations[0].advance.payments[0]));
  f.source.reconciliations.push(structuredClone(f.source.reconciliations[0]));
  assert.equal(evaluate(f).recognizedCostCents, 10000); assert.equal(evaluate(f).obligations.length, 1);
});
test('same synthetic identities in two tenants stay independent; mixed evidence is rejected', () => {
  const a = fixture(), b = fixture('tenant-other');
  assert.notEqual(evaluate(a).receiptHash, evaluate(b).receiptHash);
  assert.equal(evaluate(b).recognizedCostCents, 10000);
  for (const name of ['invoices', 'bankTransactions', 'sourceDocuments', 'reconciliations']) {
    const f = fixture(); f.source[name][0].orgId = 'tenant-other'; pending(f, 'TENANT_SCOPE_REJECTED');
  }
  const missing = fixture(); missing.orgId = undefined; pending(missing, 'AUTHENTICATED_SCOPE_REQUIRED');
});
for (const [name, change, code] of [
  ['invoice identity', (f: any) => { f.source.invoices[0].issuerId = 'another'; }, 'FISCAL_IDENTITY_UNPROVEN'],
  ['income invoice', (f: any) => { f.source.invoices[0].kind = 'REVENUE'; }, 'FISCAL_IDENTITY_UNPROVEN'],
  ['document hash', (f: any) => { f.source.sourceDocuments[0].canonicalSnapshotHash = 'b'.repeat(64); }, 'STALE_DOCUMENT_PIN'],
  ['document version', (f: any) => { f.source.sourceDocuments[0].sourceVersion = 'v2'; }, 'STALE_DOCUMENT_PIN'],
  ['revoked review', (f: any) => { f.source.sourceDocuments[0].revoked = true; }, 'SOURCE_REVIEW_REQUIRED'],
  ['unlinked evidence', (f: any) => { f.source.reconciliations[0].evidenceRefs = []; }, 'DOCUMENT_NOT_LINKED'],
  ['amount equality only', (f: any) => { f.source.sourceDocuments[2].bankTransactionId = 'other-bank'; }, 'ALLOCATION_NOT_LINKED'],
  ['unproven competence', (f: any) => { f.source.sourceDocuments[0].serviceCompetence = '2026-09'; }, 'ECONOMIC_RECOGNITION_UNPROVEN'],
  ['invalid calendar date', (f: any) => { f.source.invoices[0].issueDate = '2026-02-30'; }, 'LEDGER_LINK_UNPROVEN'],
  ['unknown bank history date', (f: any) => { delete f.source.bankTransactions[0].historyDate; }, 'BANK_DATES_UNPROVEN'],
  ['fractional cents', (f: any) => { f.source.reconciliations[0].advance.economic.amountCents = 1.5; }, 'ECONOMIC_RECOGNITION_UNPROVEN'],
  ['conflicting duplicate source', (f: any) => { f.source.invoices.push({ ...f.source.invoices[0], grossAmountCents: 9999 }); }, 'SOURCE_IDENTITY_UNPROVEN'],
] as const) test(`blocks ${name}`, () => { const f = fixture(); change(f); pending(f, code); });
test('later payment remains unallocated regardless of amount coincidence or current month', () => {
  const f = fixture(); f.source.bankTransactions.push({ ...f.source.bankTransactions[0], _documentId: 'bank-later', postingDate: '2026-10-20' });
  pending(f, 'UNALLOCATED_PAYMENT');
});
test('partial allocation reports only proven cash and preserves the unpaid remainder', () => {
  const f = fixture(); f.source.bankTransactions[0].amountCents = -3000;
  f.source.reconciliations[0].advance.payments[0].amountCents = f.source.sourceDocuments[2].allocatedCents = 3000;
  const r = evaluate(f); assert.equal(r.recognizedCostCents, 10000); assert.equal(r.obligations[0].unallocatedInvoiceCents, 6000);
});
test('two obligation IDs cannot recognize the same service or fiscal identity twice', () => {
  const f = fixture(), second = structuredClone(f.source.reconciliations[0]);
  second._documentId = 'reconciliation-2'; second.advance.obligationId = 'obligation-2'; f.source.reconciliations.push(second);
  pending(f, 'ECONOMIC_EVENT_DUPLICATED');
});
test('reordered inputs produce the same receipt and a changed amount revokes it', () => {
  const f = fixture(), before = evaluate(f);
  f.source.sourceDocuments.reverse(); assert.deepEqual(evaluate(f), before);
  f.source.sourceDocuments[0].sourceVersion = 'v2'; assert.notEqual(evaluate(f).receiptHash, before.receiptHash);
});
test('existing projection applies the method and native intelligence surfaces unresolved links', () => {
  const f = fixture(), full = { ...f.source, glosses: [], auditFindings: [], actionItems: [] };
  const r: any = buildProjection(full, new Date('2026-10-21T12:00:00Z'), f);
  assert.equal(r.invoiceAdvanceReconciliation.recognizedCostCents, 10000);
  assert.equal(r.financialCents.invoicedCents, null); assert.equal(r.financialCents.receivedCents, null);
  f.source.sourceDocuments[0].revoked = true;
  const p = buildProjection(full, new Date(), f);
  const insight: any = generateNativeInsight(p, 'REVENUE_RISK');
  assert.ok(insight.findings.some((r: any) => r.code === 'INVOICE_ADVANCE_PENDING'));
});
test('empty and out-of-period coverage remains unknown, never zero cost', () => {
  const f = fixture(); f.competence = '2026-09'; assert.equal(evaluate(f).recognizedCostCents, null);
  f.source.reconciliations = []; f.source.bankTransactions = [];
  assert.equal(evaluate(f).status, 'NO_INPUT'); assert.equal(evaluate(f).recognizedCostCents, null);
});
test('conflicting reconciliation identity is blocked, never last-writer-wins', () => {
  const f = fixture(), second = structuredClone(f.source.reconciliations[0]);
  second.advance.economic.amountCents = 20000; f.source.reconciliations.push(second);
  pending(f, 'RECONCILIATION_REVIEW_REQUIRED');
});
test('same full invoice identity cannot be relabelled to a second economic event', () => {
  const f = fixture(), r = structuredClone(f.source.reconciliations[0]);
  r._documentId = 'reconciliation-2'; r.advance.obligationId = 'obligation-2'; r.advance.economic.eventId = 'service-2';
  for (const section of [r.advance.economic, r.advance.ledger, r.advance.payments[0]]) section.evidence.id += '-2';
  r.evidenceRefs = r.evidenceRefs.map((id: string) => id + '-2');
  f.source.sourceDocuments.push(...f.source.sourceDocuments.map((doc: any) => ({ ...doc, _documentId: doc._documentId + '-2', economicEventId: 'service-2' })));
  f.source.reconciliations.push(r); pending(f, 'FISCAL_IDENTITY_DUPLICATED');
});
test('allocation cannot exceed the bank movement even across distinct obligations and periods', () => {
  const f = fixture(), second = fixture();
  const r = second.source.reconciliations[0];
  r._documentId = 'reconciliation-2'; r.advance.obligationId = 'obligation-2'; r.advance.invoiceId = 'invoice-2';
  r.advance.invoiceIdentity.invoiceKey = 'nf-key-2'; r.advance.economic.eventId = 'service-2';
  r.competence = r.advance.economic.competence = '2026-09';
  for (const section of [r.advance.economic, r.advance.ledger, r.advance.payments[0]]) section.evidence.id += '-2';
  r.evidenceRefs = r.evidenceRefs.map((id: string) => id + '-2');
  f.source.sourceDocuments.push(...second.source.sourceDocuments.map((doc: any) => ({ ...doc, _documentId: doc._documentId + '-2', economicEventId: 'service-2', invoiceId: 'invoice-2', serviceCompetence: '2026-09' })));
  f.source.invoices.push({ ...f.source.invoices[0], _documentId: 'invoice-2', invoiceKey: 'nf-key-2' });
  f.source.reconciliations.push(r); pending(f, 'BANK_OVERALLOCATION');
});
