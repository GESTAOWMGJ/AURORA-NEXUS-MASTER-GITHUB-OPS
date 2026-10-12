'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

const DEFAULT_BUDGET = 11000;
const MAX_RECORDS = 1000;
const STOP = new Set(['para', 'como', 'com', 'sem', 'uma', 'das', 'dos', 'que', 'the', 'and', 'this']);

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function tokens(value) {
  return new Set(String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{2,}/g)
    ?.filter(token => !STOP.has(token)) || []);
}

function recordText(record) {
  return [
    record.id,
    record.title,
    record.problem,
    ...(Array.isArray(record.procedure) ? record.procedure : []),
    record.prompt?.text,
    ...(Array.isArray(record.limits) ? record.limits : []),
    ...(Array.isArray(record.sourceRefs) ? record.sourceRefs : [])
  ].filter(Boolean).join('\n');
}

function validateRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('REGISTRY_OBJECT_REQUIRED');
  if (value.schemaVersion !== '1.0.0' || typeof value.version !== 'string') throw Error('REGISTRY_VERSION_INVALID');
  if (value.classification !== 'INTERNAL_SANITIZED_METHODS') throw Error('REGISTRY_CLASSIFICATION_INVALID');
  if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw Error('REGISTRY_RECORDS_INVALID');
  const ids = new Set();
  for (const record of value.records) {
    if (!record || typeof record !== 'object' || !/^[A-Z0-9-]{3,64}$/.test(record.id || '')) throw Error('REGISTRY_RECORD_INVALID');
    if (ids.has(record.id)) throw Error('REGISTRY_DUPLICATE_ID');
    ids.add(record.id);
    if (typeof record.version !== 'string' || typeof record.title !== 'string' || typeof record.prompt?.text !== 'string') throw Error('REGISTRY_RECORD_FIELDS_INVALID');
  }
  return value;
}

function isActive(record) {
  return record.knowledgeState === 'REGISTERED'
    && !['REVOKED', 'SUPERSEDED'].includes(record.technicalState)
    && record.revoked !== true;
}

function loadRegistry(filePath) {
  if (!filePath) return { status: 'DISABLED', corpusHash: null, corpusVersion: null, records: [], totalCount: 0, rejectedCount: 0 };
  try {
    const raw = fs.readFileSync(filePath);
    const parsed = validateRegistry(JSON.parse(raw.toString('utf8')));
    const records = parsed.records.filter(isActive);
    return {
      status: 'LOADED',
      corpusHash: hash(raw),
      corpusVersion: parsed.version,
      coverage: parsed.coverage || null,
      completeHistoricalAbsorption: parsed.completeHistoricalAbsorption === true,
      records,
      totalCount: parsed.records.length,
      rejectedCount: parsed.records.length - records.length
    };
  } catch (error) {
    return {
      status: 'INVALID_OR_UNAVAILABLE',
      corpusHash: null,
      corpusVersion: null,
      records: [],
      totalCount: 0,
      rejectedCount: 0,
      errorCode: error.code === 'ENOENT' ? 'REGISTRY_NOT_FOUND' : 'REGISTRY_INVALID'
    };
  }
}

function scoreRecord(record, queryTokens, normalizedPrompt) {
  const haystack = recordText(record).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 3;
    if (String(record.title || '').toLowerCase().includes(token)) score += 4;
  }
  if (normalizedPrompt.includes(String(record.id || '').toLowerCase())) score += 20;
  return score;
}

function serializeRecord(record) {
  return JSON.stringify({
    id: record.id,
    version: record.version,
    title: record.title,
    evidenceBasis: record.evidenceBasis || null,
    sourceRefs: record.sourceRefs || [],
    problem: record.problem || null,
    procedure: record.procedure || [],
    operationalPrompt: record.prompt?.text || null,
    limits: record.limits || [],
    rollback: record.rollback || null
  });
}

function selectKnowledge(registry, prompt, budget = DEFAULT_BUDGET) {
  if (!registry || registry.status !== 'LOADED') {
    return { context: '', recordIds: [], corpusHash: registry?.corpusHash || null, corpusVersion: registry?.corpusVersion || null, status: registry?.status || 'DISABLED' };
  }
  const queryTokens = tokens(prompt);
  const normalizedPrompt = String(prompt || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const ranked = registry.records
    .map(record => ({ record, score: scoreRecord(record, queryTokens, normalizedPrompt) }))
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  const candidates = ranked.some(item => item.score > 0) ? ranked.filter(item => item.score > 0) : ranked.slice(0, 3);
  const header = JSON.stringify({
    corpusVersion: registry.corpusVersion,
    corpusHash: registry.corpusHash,
    coverage: registry.coverage,
    completeHistoricalAbsorption: registry.completeHistoricalAbsorption
  });
  const chunks = [header];
  const recordIds = [];
  let size = Buffer.byteLength(header, 'utf8');
  for (const item of candidates) {
    const chunk = serializeRecord(item.record);
    const bytes = Buffer.byteLength(chunk, 'utf8') + 1;
    if (size + bytes > budget) continue;
    chunks.push(chunk);
    recordIds.push(item.record.id);
    size += bytes;
  }
  return {
    context: chunks.join('\n'),
    recordIds,
    corpusHash: registry.corpusHash,
    corpusVersion: registry.corpusVersion,
    status: registry.status,
    loadedCount: registry.records.length,
    rejectedCount: registry.rejectedCount,
    completeHistoricalAbsorption: registry.completeHistoricalAbsorption
  };
}

module.exports = { loadRegistry, selectKnowledge, validateRegistry, DEFAULT_BUDGET };
