'use strict';
module.exports = function fixture(orgId = 'tenant-synthetic') {
  const common = { orgId, sensitivity: 'INTERNAL', workflowState: 'VALIDATED' };
  const pin = id => ({ id, sourceVersion: 'v1', canonicalSnapshotHash: 'a'.repeat(64) });
  const doc = (id, fields) => ({ ...common, _documentId: id, ...pin(id), ...fields });
  const source = {
    invoices: [{ ...common, _documentId: 'invoice-1', kind: 'EXPENSE', invoiceKey: 'nf-key-1', issuerId: 'supplier-1',
      recipientId: 'buyer-1', grossAmountCents: 10000, withheldAmountCents: 1000, netAmountCents: 9000, issueDate: '2026-10-10', competence: '2026-08' }],
    bankTransactions: [{ ...common, _documentId: 'bank-1', methodId: 'AURORA-FIN-ADVANCE-001',
      kind: 'DEBIT', status: 'RECONCILED', amountCents: -9000, postingDate: '2026-08-20', historyDate: '2026-08-19', competence: '2026-08' }],
    sourceDocuments: [doc('economic-1', { economicEventId: 'service-1', serviceCompetence: '2026-08',
      issuerId: 'supplier-1', recipientId: 'buyer-1', economicAmountCents: 10000 }),
      doc('ledger-1', { invoiceId: 'invoice-1', economicEventId: 'service-1', ledgerPostingDate: '2026-10-11' }),
      doc('allocation-1', { invoiceId: 'invoice-1', economicEventId: 'service-1', bankTransactionId: 'bank-1', allocatedCents: 9000 })],
    reconciliations: [{ ...common, _documentId: 'reconciliation-1', methodId: 'AURORA-FIN-ADVANCE-001', competence: '2026-08',
      evidenceRefs: ['economic-1', 'ledger-1', 'allocation-1'], advance: { schemaVersion: 1, obligationId: 'obligation-1', invoiceId: 'invoice-1',
        invoiceIdentity: { issuerId: 'supplier-1', recipientId: 'buyer-1', invoiceKey: 'nf-key-1' },
        economic: { eventId: 'service-1', competence: '2026-08', amountCents: 10000, evidence: pin('economic-1') },
        ledger: { postingDate: '2026-10-11', evidence: pin('ledger-1') },
        payments: [{ bankTransactionId: 'bank-1', amountCents: 9000, evidence: pin('allocation-1') }] } }]
  };
  return { source, orgId, competence: '2026-08' };
};
