'use strict';
const crypto = require('node:crypto');
const PROJECT = 'wmgj-hml-jfn-20260927';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const fail = () => { throw new Error('PROBE_CANONICAL_READBACK_UNCONFIRMED'); };
// Same explicit owner window; request input cannot extend this upper bound.
const HARD_DEADLINE = Date.parse('2026-10-26T03:00:00.000Z');

function assertWindow(window) {
  const expiry = Date.parse(window?.expiresAt);
  const deadline = typeof window?.deadline === 'number' ? window.deadline : Date.parse(window?.deadline);
  const now = typeof window?.now === 'function' ? window.now() : Date.now();
  if (!Number.isFinite(expiry) || !Number.isFinite(deadline) || !Number.isFinite(now)
    || now >= expiry || now >= deadline || now >= HARD_DEADLINE) throw new Error('PROBE_WINDOW_EXPIRED');
}

function decode(value, depth=0) {
  if (!value || typeof value !== 'object' || depth > 16) fail();
  if (Object.hasOwn(value,'stringValue')) return value.stringValue;
  if (Object.hasOwn(value,'booleanValue')) return value.booleanValue;
  if (Object.hasOwn(value,'integerValue')) {
    const number = Number(value.integerValue); if (!Number.isSafeInteger(number)) fail(); return number;
  }
  if (Object.hasOwn(value,'doubleValue')) {
    if (!Number.isFinite(value.doubleValue)) fail(); return value.doubleValue;
  }
  if (Object.hasOwn(value,'nullValue')) return null;
  if (Object.hasOwn(value,'timestampValue')) return value.timestampValue;
  if (value.mapValue?.fields) return Object.fromEntries(Object.entries(value.mapValue.fields).map(([key,item])=>[key,decode(item,depth+1)]));
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(item=>decode(item,depth+1));
  fail();
}

function validatePlan(plan, nonce) {
  if (!Array.isArray(plan) || plan.length !== 4 || !/^[a-f0-9]{32}$/.test(nonce)) fail();
  const formats = {DOC:'google_docs_text',SHEETS:'google_sheets_values',TEXT:'blob_text',PDF:'drive_api_ocr_convert'};
  const keys = ['format','entityId','versionId','idempotencyId','eventId','revision','sourceVersion','sourceId','contentHash','canonicalSnapshotHash','extractedContentHash','method','markerSha256'];
  const seen = new Set();
  for (const item of plan) {
    if (!item || Object.keys(item).sort().join(',') !== keys.sort().join(',') || !Object.hasOwn(formats,item.format) || seen.has(item.format)
      || item.method !== formats[item.format] || !/^[a-f0-9]{48}$/.test(item.entityId)
      || !/^[A-Za-z0-9_-]{1,128}$/.test(item.versionId) || !/^[a-f0-9]{64}$/.test(item.idempotencyId)
      || !/^[A-Za-z0-9_-]{8,128}$/.test(item.eventId) || !/^[A-Za-z0-9_-]{10,200}$/.test(item.sourceId)
      || item.revision !== 1 || !Number.isSafeInteger(item.sourceVersion) || item.sourceVersion < 1
      || !/^[a-f0-9]{64}$/.test(item.contentHash) || !/^[a-f0-9]{64}$/.test(item.canonicalSnapshotHash)
      || !/^[a-f0-9]{64}$/.test(item.extractedContentHash)
      || item.markerSha256 !== sha('AURORA_HML_SYNTHETIC_V1_' + nonce)
      || item.entityId !== sha('sourceDocument:DRIVE:' + item.sourceId).slice(0,48)
      || item.versionId !== sha('v1:sourceDocument:DRIVE:' + item.sourceId + ':revision:1').slice(0,48)
      || item.idempotencyId !== sha('wmgj:DRIVE:' + item.sourceId + ':' + item.contentHash)) fail();
    seen.add(item.format);
  }
}

function verifyDocuments(item, documents, nonce) {
  const [entity,version,receipt] = documents;
  const entityKey = 'DRIVE:' + item.sourceId;
  for (const record of documents) if (!record || record.orgId !== 'wmgj' || record.entityType !== 'sourceDocument'
    || record.revision !== 1 || record.sourceVersion !== item.sourceVersion) fail();
  if (entity.entityKey !== entityKey || entity.documentType !== 'OTHER' || entity.competence !== '2026-05'
    || entity.source?.sourceId !== item.sourceId || entity.source?.system !== 'DRIVE'
    || entity.source?.contentHash !== item.contentHash || entity.extractionMethod !== item.method
    || entity.extractionComplete !== true || entity.externalAiUsed !== false
    || entity.canonicalSnapshotHash !== item.canonicalSnapshotHash
    || entity.sourceContext !== ['ISOLATED_SYNTHETIC_HML_V1',nonce,item.format,item.extractedContentHash].join(':') || entity.migration?.eventId !== item.eventId
    || entity.migration?.idempotencyId !== item.idempotencyId
    || version.entityId !== item.entityId || version.entityKey !== entityKey || version.eventId !== item.eventId
    || version.idempotencyId !== item.idempotencyId || version.beforeHash !== null
    || !/^[a-f0-9]{64}$/.test(version.afterHash)
    || receipt.status !== 'ACCEPTED' || receipt.entityId !== item.entityId || receipt.eventId !== item.eventId
    || receipt.versionId !== item.versionId || receipt.sourceId !== item.sourceId || receipt.sourceSystem !== 'DRIVE'
    || !/^[a-f0-9]{64}$/.test(receipt.payloadHash)) fail();
  const canonical = JSON.parse(JSON.stringify(entity));
  delete canonical.createdAt; delete canonical.updatedAt; delete canonical.migration.importedAt;
  if (sha(stable(canonical)) !== version.afterHash || sha(stable(version.snapshot)) !== version.afterHash) fail();
  return {format:item.format, canonicalMaterializationVerified:true, immutableVersionVerified:true,
    idempotencyReceiptVerified:true, documentHashes:documents.map(document=>sha(stable(document)))};
}

async function readback(plan, nonce, accessToken, fetcher=fetch, window) {
  assertWindow(window);
  validatePlan(plan,nonce);
  if (typeof accessToken !== 'string' || !accessToken.trim() || /\s/.test(accessToken)) fail();
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/organizations/wmgj/`;
  const rows = [];
  for (const item of plan) {
    const paths = ['sourceDocuments/'+item.entityId,'entityVersions/'+item.versionId,'integrationEvents/'+item.idempotencyId];
    const documents = [];
    for (const relative of paths) {
      assertWindow(window);
      const response = await fetcher(base+relative,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}});
      assertWindow(window);
      if (response.status !== 200) fail();
      const raw = await response.text(); if (Buffer.byteLength(raw)>2000000) fail();
      assertWindow(window);
      const value = JSON.parse(raw);
      if (value.name !== `projects/${PROJECT}/databases/(default)/documents/organizations/wmgj/`+relative || !value.fields) fail();
      documents.push(Object.fromEntries(Object.entries(value.fields).map(([key,field])=>[key,decode(field)])));
    }
    rows.push(verifyDocuments(item,documents,nonce));
  }
  assertWindow(window);
  return {scope:'EXACT_CREATED_SYNTHETIC_DOCUMENTS_ONLY', documentsRead:12, formats:rows,
    canonicalMaterializationVerified:true, processingOrInstallationAcceptanceVerified:false};
}
module.exports = {decode,validatePlan,verifyDocuments,readback,assertWindow,sha,stable};
