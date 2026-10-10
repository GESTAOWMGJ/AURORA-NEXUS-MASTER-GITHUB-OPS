/** JFN-AUD-FAT-001: pure evidence checks. No network, persistence or authorization. */
const NATURES = new Set(['CASH', 'FINANCIAL_CREDIT', 'IN_KIND']);
const STAGES = new Set(['ANNOUNCED', 'CONTRACTED', 'COMMITTED', 'LIQUIDATED', 'PAYMENT_RECORDED', 'BANK_CREDIT', 'ACCOUNTING_BALANCE', 'ACCRUAL_REVENUE']);
function cents(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('INVALID_CENTS');
  return value;
}
function text(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new TypeError('INVALID_ID');
  return value;
}
function date(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('INVALID_DATE');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new TypeError('INVALID_DATE');
  return parsed;
}
/** Caller must obtain review and identity from a trusted backend, never browser assertions. */
export function assessPublicFunding(record, expectedOrgId) {
  if (text(record.orgId) !== text(expectedOrgId)) throw new Error('ORG_MISMATCH');
  if (!NATURES.has(record.nature) || !STAGES.has(record.stage)) throw new TypeError('INVALID_CLASSIFICATION');
  const value = cents(record.amountCents);
  const credited = date(record.creditDate);
  const due = date(record.dueDate);
  text(record.sourceRef);
  const proven = record.nature === 'CASH' && record.stage === 'BANK_CREDIT' && value !== null
    && credited !== null && record.evidenceReviewed === true && record.beneficiaryMatched === true;
  const dayDifference = proven && due ? Math.round((credited.getTime() - due.getTime()) / 86400000) : null;
  return {
    classification: record.nature !== 'CASH' ? 'NON_CASH_BENEFIT' : proven ? 'DOCUMENTED_CREDIT' : 'RECEIPT_NOT_PROVEN',
    confirmedCashCents: proven ? value : null,
    timeliness: dayDifference === null ? 'NOT_ASSESSABLE' : dayDifference > 0 ? 'AFTER_DUE_DATE' : 'ON_OR_BEFORE_DUE_DATE',
    daysAfterDue: dayDifference === null ? null : Math.max(0, dayDifference),
    automaticFindingClosure: false, paymentAuthorized: false,
  };
}
/** Collapse author repeats inside the SAME snapshot; never merge successive snapshots. */
export function collapseInstrumentSnapshot(rows) {
  if (!Array.isArray(rows)) throw new TypeError('INVALID_ROWS');
  const groups = new Map();
  for (const row of rows) {
    const parts = ['orgId','snapshotId','grantorId','beneficiaryCnpj','instrumentId','year'].map(k => text(row[k]));
    if (!/^\d{14}$/.test(row.beneficiaryCnpj)) throw new TypeError('INVALID_CNPJ_FORMAT');
    const key = JSON.stringify(parts);
    cents(row.globalCents); cents(row.reportedReleasedCents); text(row.sourceRef);
    const group = groups.get(key) || [];
    group.push(row); groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const globals = [...new Set(group.map(r => r.globalCents))];
    const released = [...new Set(group.map(r => r.reportedReleasedCents))];
    const flags = [];
    const conflicting = globals.length > 1 || released.length > 1;
    if (conflicting) flags.push('CONFLICTING_SOURCE_VALUES');
    const globalCents = globals.length === 1 ? globals[0] : null;
    const releasedCents = released.length === 1 ? released[0] : null;
    if (globalCents !== null && releasedCents !== null && releasedCents > globalCents) flags.push('RELEASED_EXCEEDS_STATED_GLOBAL');
    if (globalCents === null || releasedCents === null) flags.push('INCOMPLETE_VALUE');
    return { key, instrumentId: group[0].instrumentId, inputRows: group.length,
      globalCents, reportedReleasedCents: releasedCents,
      sourceRefs: [...new Set(group.map(r => r.sourceRef))],
      authors: [...new Set(group.map(r => r.author).filter(v => typeof v === 'string'))],
      flags, confirmedCashCents: null, requiresReview: true };
  });
}
