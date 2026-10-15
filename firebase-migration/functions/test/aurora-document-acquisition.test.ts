import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  acquisitionEvidenceHash, canonicalIntegrationDocument, canonicalRecordText,
  integrationDocumentVersionDecision, parseIntegrationDocumentPayload
} from '../src/auroraIntegrationDocument.ts';

const fixture=JSON.parse(fs.readFileSync('../../aurora-coletor/tests/fixtures/document-acquisition-v1.json','utf8'));
const original=fixture.payload;
const parsed=()=>parseIntegrationDocumentPayload(structuredClone(original))!;
const bodyHash=(payload:any)=>createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const current=(payload=parsed())=>({sourceVersion:payload.sourceVersion,
  canonicalSnapshotHash:canonicalIntegrationDocument('synthetic-org',payload).canonicalSnapshotHash,
  workflowState:payload.workflowState,source:{acquisition:payload.sourceEvidence},
  integration:{payloadHash:bodyHash(payload)}});
const decision=(previous:any,payload:any)=>integrationDocumentVersionDecision(previous,payload,
  canonicalIntegrationDocument('synthetic-org',payload).canonicalSnapshotHash,bodyHash(payload),parsed().occurredAt);
const proofFor=(payload:any)=>{
  const hash=createHash('sha256').update(canonicalRecordText(payload)).digest('hex');
  payload.sourceEvidence.extraction.textSha256=hash;
  payload.sourceEvidence.extraction.rowFactsSha256=hash;
  return payload;
};

test('Python acquired bytes, canonical material, facts hash and evidence hash match TypeScript',()=>{
  const row=parsed();assert.ok(row);
  assert.equal(row.sourceEvidence!.byteSha256,createHash('sha256').update(fixture.rawUtf8,'utf8').digest('hex'));
  assert.equal(row.sourceEvidence!.byteLength,Buffer.byteLength(fixture.rawUtf8));
  assert.equal(acquisitionEvidenceHash(row.sourceEvidence!),fixture.sourceEvidenceHash);
  assert.equal(canonicalIntegrationDocument('synthetic-org',row).canonicalSnapshotHash,fixture.canonicalSnapshotHash);
  assert.notEqual(row.sourceEvidence!.byteSha256,fixture.canonicalSnapshotHash);
  assert.equal(row.amountCents,12345);assert.equal(row.nativeReady,true);
});

test('legacy requests retain the exact existing canonical facts hash',()=>{
  const row=structuredClone(original);delete row.sourceEvidence;
  const old=parseIntegrationDocumentPayload(row)!;assert.ok(old);
  assert.equal(Object.hasOwn(old,'sourceEvidence'),false);
  assert.equal(canonicalIntegrationDocument('synthetic-org',old).canonicalSnapshotHash,fixture.canonicalSnapshotHash);
  assert.equal(decision(current(old),old),'DUPLICATE');
});

test('closed acquisition proof rejects raw narrative, unknown MIME, malformed versions and impossible dimensions',()=>{
  for(const [key,value] of [['narrative','not permitted'],['provider','OTHER'],['byteLength',0],
    ['observedVersion','01'],['observedVersion','9'.repeat(33)],['sourceMimeType','application/pdf'],['acquiredMimeType','text/csv']]){
    const row=structuredClone(original);row.sourceEvidence[key as string]=value;
    assert.equal(parseIntegrationDocumentPayload(row),null,String(key));
  }
  for(const [key,value] of [['status','PENDING'],['coverage','ENTIRE_SOURCE'],['rowIndex',1],['rowCount',21],['textSha256','f'.repeat(64)]]){
    const row=structuredClone(original);row.sourceEvidence.extraction[key as string]=value;
    assert.equal(parseIntegrationDocumentPayload(row),null,String(key));
  }
});

test('a proof cannot be transferred to another row or changed financial facts',()=>{
  for(const change of [{amountCents:999},{sourceVersion:2},{externalDocumentId:'synthetic-other'}]){
    assert.equal(parseIntegrationDocumentPayload({...structuredClone(original),...change}),null);
  }
});

test('same provider version and exact body replay is duplicate; new observed version preserves facts but creates a revision',()=>{
  const before=parsed();assert.equal(decision(current(before),parsed()),'DUPLICATE');
  const after=parsed();after.sourceEvidence!.observedVersion='12';
  assert.equal(after.sourceVersion,before.sourceVersion);
  assert.equal(canonicalIntegrationDocument('synthetic-org',after).canonicalSnapshotHash,fixture.canonicalSnapshotHash);
  assert.equal(decision(current(before),after),'UPDATE');
  assert.notEqual(bodyHash(after),bodyHash(before));
  assert.equal(decision(current(after),structuredClone(after)),'DUPLICATE');
});

test('provider version regression and same-version byte changes cannot overwrite acquired evidence',()=>{
  const before=parsed();
  for(const [patch,expected] of [[{observedVersion:'10'},'SOURCE_ACQUISITION_REGRESSION'],
    [{byteSha256:'a'.repeat(64)},'SOURCE_ACQUISITION_CONFLICT'],
    [{sourceObjectIdHash:'a'.repeat(64)},'SOURCE_ACQUISITION_CONFLICT']] as const){
    const after=parsed();Object.assign(after.sourceEvidence!,patch);
    assert.equal(decision(current(before),after),expected);
  }
});

test('new observed version does not authorize new facts under unchanged financial sourceVersion',()=>{
  const before=parsed();const after=parsed();after.sourceEvidence!.observedVersion='12';after.amountCents=999;
  proofFor(after);assert.ok(parseIntegrationDocumentPayload(after));
  assert.equal(decision(current(before),after),'SOURCE_VERSION_CONFLICT');
  after.sourceVersion++;proofFor(after);
  assert.equal(decision(current(before),after),'UPDATE');
});

test('adding first acquisition evidence to same legacy facts creates an immutable revision, while removal is rejected',()=>{
  const after=parsed();const legacy=structuredClone(after);delete legacy.sourceEvidence;
  assert.equal(decision(current(legacy),after),'UPDATE');
  assert.equal(decision(current(after),legacy),'SOURCE_ACQUISITION_CONFLICT');
  assert.equal(decision({...current(legacy),integration:{}},after),'UPDATE');
});

test('evidence hashing and normalized payload are independent of incoming object-key order',()=>{
  const row=parsed();const reversed=Object.fromEntries(Object.entries(original.sourceEvidence).reverse());
  reversed.extraction=Object.fromEntries(Object.entries(original.sourceEvidence.extraction).reverse());
  const next=parseIntegrationDocumentPayload({...original,sourceEvidence:reversed})!;assert.ok(next);
  assert.equal(acquisitionEvidenceHash(next.sourceEvidence!),acquisitionEvidenceHash(row.sourceEvidence!));
  assert.equal(bodyHash(next),bodyHash(row));assert.equal(decision(current(row),next),'DUPLICATE');
});

test('Sheets proof is limited to CSV exported representation and cannot call the bytes a native workbook',()=>{
  const row=parsed();Object.assign(row.sourceEvidence!,{sourceMimeType:'application/vnd.google-apps.spreadsheet',
    acquiredMimeType:'text/csv',representation:'GOOGLE_SHEETS_CSV_EXPORT'});
  row.sourceEvidence!.extraction.method='AURORA_CANONICAL_CSV';
  assert.ok(parseIntegrationDocumentPayload(row));
  row.sourceEvidence!.representation='ORIGINAL_BYTES';assert.equal(parseIntegrationDocumentPayload(row),null);
});
