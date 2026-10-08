'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_BUDGET = 11000;
const MAX_RECORDS = 1000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const STOP = new Set(['para', 'como', 'com', 'sem', 'uma', 'das', 'dos', 'que', 'the', 'and', 'this']);
const REFERENCE_STATES = new Set(['SPECIFIED', 'IMPLEMENTED', 'TESTED', 'CI_VERIFIED', 'HML_VERIFIED', 'INSTALLED', 'RUNTIME_VERIFIED']);
const compiled = new WeakMap();
let cached = null; // One corpus only; bytes are rehashed on EVERY load, not trusted by mtime.
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function tokens(value) {
  return new Set((normalize(value).match(/[a-z0-9][a-z0-9_-]{2,}/g) || []).filter(t => !STOP.has(t)));
}
function recordText(record) {
  return [record.id, record.title, record.problem, ...(record.procedure || []), record.prompt.text,
    ...(record.limits || []), ...(record.sourceRefs || [])].filter(Boolean).join('\n');
}
function validateRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('REGISTRY_OBJECT_REQUIRED');
  if (value.schemaVersion !== '1.0.0' || typeof value.version !== 'string' || !value.version || value.version.length > 64) throw Error('REGISTRY_VERSION_INVALID');
  if (value.classification !== 'INTERNAL_SANITIZED_METHODS') throw Error('REGISTRY_CLASSIFICATION_INVALID');
  if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw Error('REGISTRY_RECORDS_INVALID');
  if (value.recordCount !== undefined && (!Number.isSafeInteger(value.recordCount) || value.recordCount < 0)) throw Error('REGISTRY_COUNT_INVALID');
  const ids = new Set();
  for (const record of value.records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || !/^[A-Z0-9-]{3,64}$/.test(record.id || '')) throw Error('REGISTRY_RECORD_INVALID');
    if (ids.has(record.id)) throw Error('REGISTRY_DUPLICATE_ID');
    ids.add(record.id);
    for (const key of ['version', 'title', 'knowledgeState', 'technicalState']) if (typeof record[key] !== 'string' || !record[key]) throw Error('REGISTRY_RECORD_FIELDS_INVALID');
    if (typeof record.prompt?.text !== 'string' || record.prompt.text.length > 32000) throw Error('REGISTRY_PROMPT_INVALID');
    for (const key of ['procedure', 'limits', 'sourceRefs']) {
      if (record[key] !== undefined && (!Array.isArray(record[key]) || record[key].some(v => typeof v !== 'string'))) throw Error('REGISTRY_ARRAY_INVALID');
    }
    for (const key of ['problem', 'rollback', 'evidenceBasis']) if (record[key] !== undefined && typeof record[key] !== 'string') throw Error('REGISTRY_TEXT_INVALID');
    if (record.runtimeVerified !== undefined && typeof record.runtimeVerified !== 'boolean') throw Error('REGISTRY_RUNTIME_STATE_INVALID');
  }
  return value;
}
function isReferenceEligible(record) {
  return record.knowledgeState === 'REGISTERED' && REFERENCE_STATES.has(record.technicalState)
    && record.revoked !== true && record.suspended !== true && record.rejected !== true;
}
function serializeRecord(record) {
  return JSON.stringify({
    id: record.id, version: record.version, title: record.title, usage: 'REFERENCE_ONLY_NO_EXECUTION_AUTHORITY',
    knowledgeState: record.knowledgeState, technicalState: record.technicalState,
    runtimeVerified: record.runtimeVerified === true, regressionState: record.regression?.state || 'NOT_RECORDED',
    evidenceBasis: record.evidenceBasis || null, sourceRefs: record.sourceRefs || [], problem: record.problem || null,
    procedure: record.procedure || [], operationalPrompt: record.prompt.text, limits: record.limits || [], rollback: record.rollback || null
  });
}
function readBounded(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > MAX_FILE_BYTES) throw Error('REGISTRY_SIZE_LIMIT');
    const buffer = Buffer.alloc(before.size + 1);
    let used = 0, count;
    do { count = fs.readSync(fd, buffer, used, buffer.length - used, null); used += count; } while (count > 0 && used < buffer.length);
    const after = fs.fstatSync(fd);
    if (used !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('REGISTRY_CHANGED_DURING_READ');
    return buffer.subarray(0, used);
  } finally { fs.closeSync(fd); }
}
function loadRegistry(filePath) {
  if (!filePath) return { status: 'DISABLED', corpusHash: null, corpusVersion: null, records: [], totalCount: 0, rejectedCount: 0 };
  try {
    const resolved = path.resolve(filePath);
    const raw = readBounded(resolved), corpusHash = hash(raw);
    if (cached?.path === resolved && cached.hash === corpusHash) return cached.registry;
    const parsed = validateRegistry(JSON.parse(raw.toString('utf8')));
    const records = parsed.records.filter(isReferenceEligible);
    for (const record of records) {
      compiled.set(record, { haystack: normalize(recordText(record)), title: normalize(record.title), chunk: serializeRecord(record) });
      for (const key of ['procedure', 'limits', 'sourceRefs', 'prompt', 'regression']) if (record[key] && typeof record[key] === 'object') Object.freeze(record[key]);
      Object.freeze(record);
    }
    const warnings = Object.freeze(parsed.recordCount !== undefined && parsed.recordCount !== parsed.records.length ? ['DECLARED_COUNT_MISMATCH'] : []);
    const registry = Object.freeze({ status: 'LOADED', corpusHash, corpusVersion: parsed.version, warnings, declaredCount: parsed.recordCount ?? null,
      coverage: parsed.coverage || null, completeHistoricalAbsorption: parsed.completeHistoricalAbsorption === true,
      records: Object.freeze(records), totalCount: parsed.records.length, rejectedCount: parsed.records.length - records.length });
    cached = { path: resolved, hash: corpusHash, registry };
    return registry;
  } catch (error) {
    cached = null; // Missing/corrupt/changed source must never return cached knowledge.
    return { status: 'INVALID_OR_UNAVAILABLE', corpusHash: null, corpusVersion: null, records: [], totalCount: 0, rejectedCount: 0,
      errorCode: error.code === 'ENOENT' ? 'REGISTRY_NOT_FOUND' : 'REGISTRY_INVALID' };
  }
}
function scoreRecord(record, queryTokens, normalizedPrompt) {
  const data = compiled.get(record) || { haystack: normalize(recordText(record)), title: normalize(record.title) };
  let score = 0;
  for (const token of queryTokens) {
    if (data.haystack.includes(token)) score += 3;
    if (data.title.includes(token)) score += 4;
  }
  if (normalizedPrompt.includes(record.id.toLowerCase())) score += 20;
  return score;
}
function selectKnowledge(registry, prompt, budget = DEFAULT_BUDGET) {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > DEFAULT_BUDGET) throw Error('CONTEXT_BUDGET_INVALID');
  const base = { context: '', recordIds: [], corpusHash: registry?.corpusHash || null, corpusVersion: registry?.corpusVersion || null,
    status: registry?.status || 'DISABLED', loadedCount: registry?.records?.length || 0, rejectedCount: registry?.rejectedCount || 0,
    completeHistoricalAbsorption: registry?.completeHistoricalAbsorption === true, warnings: registry?.warnings || [], contextBytes: 0 };
  if (!registry || registry.status !== 'LOADED') return base;
  const header = JSON.stringify({ corpusVersion: registry.corpusVersion, corpusHash: registry.corpusHash,
    coverage: registry.coverage, warnings: registry.warnings || [], completeHistoricalAbsorption: registry.completeHistoricalAbsorption });
  let size = Buffer.byteLength(header, 'utf8');
  if (size > budget) return { ...base, status: 'CONTEXT_BUDGET_TOO_SMALL' };
  const queryTokens = tokens(prompt), normalizedPrompt = normalize(prompt);
  const ranked = registry.records.filter(isReferenceEligible).map(record => ({ record, score: scoreRecord(record, queryTokens, normalizedPrompt) }))
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  const candidates = ranked.some(item => item.score > 0) ? ranked.filter(item => item.score > 0) : ranked.slice(0, 3);
  const chunks = [header], recordIds = [];
  for (const { record } of candidates) {
    const chunk = compiled.get(record)?.chunk || serializeRecord(record);
    const bytes = Buffer.byteLength(chunk, 'utf8') + 1;
    if (size + bytes > budget) continue;
    chunks.push(chunk); recordIds.push(record.id); size += bytes;
  }
  return { ...base, context: chunks.join('\n'), recordIds, contextBytes: size };
}
module.exports = { loadRegistry, selectKnowledge, validateRegistry, DEFAULT_BUDGET, MAX_FILE_BYTES };
