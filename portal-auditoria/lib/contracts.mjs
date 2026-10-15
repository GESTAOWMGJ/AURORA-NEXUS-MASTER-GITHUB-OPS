// DTO compatível com firebase-migration/api/wmgj_api/models.py (schemaVersion=1).
export const ORG = /^[a-z0-9][a-z0-9_-]{1,63}$/;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, max = 256) => typeof x === 'string' && x.length <= max;
const nullableNumber = x => x === null || (typeof x === 'number' && Number.isFinite(x));
const count = x => x === null || (Number.isSafeInteger(x) && x >= 0);
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x));
const COMPLETE = ['COMPLETE', 'PARTIAL', 'EMPTY', 'INVALID'];
const FRESH = ['FRESH', 'DELAYED', 'STALE', 'UNKNOWN'];
function requireValue(ok) { if (!ok) throw new Error('UPSTREAM_CONTRACT_INVALID'); }
export function parseDashboard(raw, orgId, competence) {
  requireValue(object(raw) && object(raw.snapshot) && object(raw.freshness));
  const s = raw.snapshot, f = raw.freshness;
  requireValue(s.schemaVersion === 1 && s.orgId === orgId && s.competence === competence);
  // O endpoint existente só libera visão organizacional para all_facilities=true.
  requireValue(s.facilityId === null || s.facilityId === undefined);
  requireValue(date(s.generatedAt) && text(s.policyVersion) && COMPLETE.includes(s.completeness));
  requireValue(['NOMINAL', 'ATTENTION', 'BLOCKED', 'UNKNOWN'].includes(s.severity));
  requireValue(FRESH.includes(f.state) && Number.isSafeInteger(f.ageSeconds) && f.ageSeconds >= 0 && date(f.generatedAt));
  requireValue(object(s.financial) && s.financial.currency === 'BRL' && object(s.audit) && object(s.pipeline));
  const financial = { currency: 'BRL' };
  for (const key of ['billedAmount', 'receivedAmount', 'pendingAmount', 'reconciliationDifference']) {
    const value = s.financial[key];
    requireValue(nullableNumber(value) && (key === 'reconciliationDifference' || value === null || value >= 0));
    financial[key] = value;
  }
  const audit = {}, pipeline = {};
  for (const key of ['openFindings', 'criticalFindings', 'overdueActions', 'evidenceGaps']) {
    requireValue(count(s.audit[key])); audit[key] = s.audit[key];
  }
  for (const key of ['total', 'queued', 'processing', 'validated', 'pendingHumanReview', 'failed', 'deadLetter', 'duplicateEvents']) {
    requireValue(count(s.pipeline[key])); pipeline[key] = s.pipeline[key];
  }
  requireValue(Array.isArray(s.sources) && s.sources.length <= 100);
  const sources = s.sources.map(source => {
    requireValue(object(source) && text(source.source) && COMPLETE.includes(source.completeness));
    requireValue(FRESH.includes(source.freshness) && typeof source.missing === 'boolean');
    requireValue(source.lastSuccessAt === null || date(source.lastSuccessAt));
    // Não retransmitir detail, links ou campos adicionais que possam conter identificadores.
    return { source: source.source, completeness: source.completeness, freshness: source.freshness,
      missing: source.missing, lastSuccessAt: source.lastSuccessAt };
  });
  // O DTO é uma allowlist; não retorna payloads ou campos desconhecidos.
  return { snapshot: { schemaVersion: 1, orgId, competence, generatedAt: s.generatedAt,
    policyVersion: s.policyVersion, completeness: s.completeness, severity: s.severity,
    financial, audit, pipeline, sources },
    freshness: { state: f.state, ageSeconds: f.ageSeconds, generatedAt: f.generatedAt } };
}
export function monthInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}
export function brl(value) {
  return value === null || value === undefined ? 'Não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
