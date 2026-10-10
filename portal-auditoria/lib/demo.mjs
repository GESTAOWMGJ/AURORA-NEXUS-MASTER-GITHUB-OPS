// Dataset exclusivamente sintético: não contém preços, produção ou nomes de clientes.
export function demoDashboard() {
  const generatedAt = '2026-09-01T12:00:00.000Z';
  return { snapshot: { schemaVersion: 1, orgId: 'hospital-demo', facilityId: null, competence: '2026-08', generatedAt,
    policyVersion: 'JFN-AUD-FAT-001/demo-1', completeness: 'PARTIAL', severity: 'ATTENTION',
    financial: { billedAmount: 1000, receivedAmount: 850, pendingAmount: 150, reconciliationDifference: null, currency: 'BRL' },
    audit: { openFindings: 2, criticalFindings: 0, overdueActions: null, evidenceGaps: 1 },
    pipeline: { total: 10, queued: 0, processing: 0, validated: 8, pendingHumanReview: 2, failed: 0, deadLetter: 0, duplicateEvents: 0 },
    sources: [{ source: 'Fonte sintética', completeness: 'PARTIAL', freshness: 'UNKNOWN', missing: false, lastSuccessAt: generatedAt }], alerts: [] },
    freshness: { state: 'UNKNOWN', ageSeconds: 0, generatedAt } };
}
