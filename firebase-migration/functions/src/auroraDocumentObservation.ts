import { createHash } from 'node:crypto';
import { immutableEntityVersionId, nextCanonicalEntityRevision, persistedDocumentHash, stableValue } from './auroraCanonicalVersions.js';
import { credentialAllowsScope } from './auroraIntegrationCredential.js';
import { canImportNativeDocuments, type DocumentPrincipal } from './auroraNativeIngestion.js';

export const DOCUMENT_OBSERVATION_SCHEMA = 'aurora.document.observation.v1';
export const DOCUMENT_OBSERVATION_OPERATION = 'OBSERVE_DOCUMENT_EXTRACTION';
export const DOCUMENT_OBSERVATION_RECEIPT_SCHEMA = 'aurora.document.observation.receipt.v1';
export const DOCUMENT_EXTRACTION_METHODS = ['TEXT_UTF8','CSV_UTF8','JSON_UTF8','XML_TEXT','DOCX_XML','XLSX_XML','ODT_XML','ODS_XML'] as const;
export type DocumentExtractionMethod = typeof DOCUMENT_EXTRACTION_METHODS[number];
export const DOCUMENT_OBSERVATION_PROVIDERS = ['GOOGLE_DRIVE','GMAIL','MICROSOFT_MAIL','IMAP','LOCAL_AGENT','API_TOKEN','MANUAL'] as const;
export const DOCUMENT_EXTRACTION_CODES = ['CONTENT_EXTRACTED','BOUNDED_EXTRACTION_PARTIAL','EXTRACTION_REQUIRED','UNSUPPORTED_FORMAT','BACKEND_REQUIRED','MALFORMED_DOCUMENT','LIMIT_EXCEEDED','ENCRYPTED_DOCUMENT','EMPTY_CONTENT','SOURCE_CHANGED'] as const;
export type ObservationAcquisition = {
  provider: typeof DOCUMENT_OBSERVATION_PROVIDERS[number]; sourceObjectIdHash: string;
  versionKind: 'PROVIDER_REVISION'|'LOCAL_CONTENT_HASH'|'CLIENT_REVISION'; observedVersion: string;
  representation: 'ORIGINAL_BYTES'|'PROVIDER_EXPORT'; sourceMimeType: string; acquiredMimeType: string;
  byteSha256: string; byteLength: number;
};
export type ObservationExtraction = {
  status: 'COMPLETE'|'PARTIAL'|'PENDING'|'FAILED'; method: DocumentExtractionMethod|null;
  methodVersion: '1.0.0'; textSha256: string|null; textByteLength: number;
  coverage: {basis:'EXPECTED_PARTS'|'BOUNDED_REPRESENTATION';totalUnits:number;processedUnits:number};
  code: typeof DOCUMENT_EXTRACTION_CODES[number];
};
export type DocumentObservationPayload = {
  schemaVersion: typeof DOCUMENT_OBSERVATION_SCHEMA; operation: typeof DOCUMENT_OBSERVATION_OPERATION;
  sourceSystem:'MV'|'TASY'|'ERP'; externalDocumentId:string; observedAt:string;
  expectedRevision:number; expectedPreviousObservationHash:string|null;
  acquisition:ObservationAcquisition; extraction:ObservationExtraction;
};
type Data = Record<string, any>;
const hash = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v:unknown,max:number):v is number => Number.isSafeInteger(v) && Number(v)>=0 && Number(v)<=max;
const exact = (v:unknown,keys:string[]):v is Data => !!v && typeof v==='object' && !Array.isArray(v)
  && [Object.prototype,null].includes(Object.getPrototypeOf(v))
  && Object.keys(v).length===keys.length && Object.keys(v).every(k=>keys.includes(k));
const sorted = (v:any):any => Array.isArray(v) ? v.map(sorted) : v && typeof v==='object'
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])) : v;
const digest = (v:unknown) => createHash('sha256').update(JSON.stringify(sorted(v)),'utf8').digest('hex');
const MIME = /^[a-z0-9][a-z0-9.+-]{0,79}\/[a-z0-9][a-z0-9.+-]{0,159}$/;
const METHOD_MIMES:Record<DocumentExtractionMethod,readonly string[]> = {
  TEXT_UTF8:['text/plain','text/markdown'],CSV_UTF8:['text/csv'],JSON_UTF8:['application/json'],XML_TEXT:['application/xml','text/xml'],
  DOCX_XML:['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  XLSX_XML:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ODT_XML:['application/vnd.oasis.opendocument.text'],ODS_XML:['application/vnd.oasis.opendocument.spreadsheet']
};
function validExternalId(value:unknown):value is string {
  return typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/.test(value) && /[A-Za-z]/.test(value)
    && !/(cpf|cns|paciente|patient|beneficiario|prontuario|medical[-_.:]?record)/i.test(value)
    && !/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(value);
}
function parseAcquisition(value:unknown):ObservationAcquisition|null {
  if (!exact(value,['provider','sourceObjectIdHash','versionKind','observedVersion','representation','sourceMimeType','acquiredMimeType','byteSha256','byteLength'])
    || !DOCUMENT_OBSERVATION_PROVIDERS.includes(value.provider) || !hash(value.sourceObjectIdHash) || !hash(value.byteSha256)
    || !integer(value.byteLength,1048576) || value.byteLength<1
    || !['PROVIDER_REVISION','LOCAL_CONTENT_HASH','CLIENT_REVISION'].includes(value.versionKind)
    || typeof value.observedVersion!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.observedVersion)
    || !['ORIGINAL_BYTES','PROVIDER_EXPORT'].includes(value.representation)
    || typeof value.sourceMimeType!=='string' || !MIME.test(value.sourceMimeType)
    || typeof value.acquiredMimeType!=='string' || !MIME.test(value.acquiredMimeType)) return null;
  if (value.versionKind==='LOCAL_CONTENT_HASH' && value.observedVersion!==value.byteSha256) return null;
  if (value.versionKind==='PROVIDER_REVISION' && value.provider==='GOOGLE_DRIVE' && !/^[1-9][0-9]{0,31}$/.test(value.observedVersion)) return null;
  if (value.representation==='ORIGINAL_BYTES' && value.sourceMimeType!==value.acquiredMimeType) return null;
  return sorted(value) as ObservationAcquisition;
}
function parseExtraction(value:unknown,acquisition:ObservationAcquisition):ObservationExtraction|null {
  if (!exact(value,['status','method','methodVersion','textSha256','textByteLength','coverage','code'])
    || !exact(value.coverage,['basis','totalUnits','processedUnits'])
    || !['COMPLETE','PARTIAL','PENDING','FAILED'].includes(value.status) || value.methodVersion!=='1.0.0'
    || !(value.method===null || DOCUMENT_EXTRACTION_METHODS.includes(value.method))
    || !DOCUMENT_EXTRACTION_CODES.includes(value.code) || !integer(value.textByteLength,262144)
    || !['EXPECTED_PARTS','BOUNDED_REPRESENTATION'].includes(value.coverage.basis)
    || !integer(value.coverage.totalUnits,10000) || !integer(value.coverage.processedUnits,value.coverage.totalUnits)) return null;
  if (value.method!==null && !METHOD_MIMES[value.method as DocumentExtractionMethod].includes(acquisition.acquiredMimeType)) return null;
  if (['COMPLETE','PARTIAL'].includes(value.status)) {
    if (value.method===null || !hash(value.textSha256) || value.textByteLength<1
      || value.coverage.totalUnits<1 || value.coverage.processedUnits<1) return null;
    if (value.status==='COMPLETE' && (value.code!=='CONTENT_EXTRACTED' || value.coverage.processedUnits!==value.coverage.totalUnits)) return null;
    if (value.status==='PARTIAL' && (value.code!=='BOUNDED_EXTRACTION_PARTIAL'
      || value.coverage.processedUnits===value.coverage.totalUnits && value.coverage.basis!=='BOUNDED_REPRESENTATION')) return null;
  } else {
    if (value.textSha256!==null || value.textByteLength!==0 || value.coverage.processedUnits!==0) return null;
    const codes=value.status==='PENDING' ? ['EXTRACTION_REQUIRED','UNSUPPORTED_FORMAT','BACKEND_REQUIRED']
      : ['MALFORMED_DOCUMENT','LIMIT_EXCEEDED','ENCRYPTED_DOCUMENT','EMPTY_CONTENT','SOURCE_CHANGED'];
    if (!codes.includes(value.code)) return null;
  }
  return sorted(value) as ObservationExtraction;
}
/** This contract accepts hashes and bounded structural evidence, never document text or canonical facts. */
export function parseDocumentObservationPayload(value:unknown):DocumentObservationPayload|null {
  if (!exact(value,['schemaVersion','operation','sourceSystem','externalDocumentId','observedAt','expectedRevision','expectedPreviousObservationHash','acquisition','extraction'])
    || value.schemaVersion!==DOCUMENT_OBSERVATION_SCHEMA || value.operation!==DOCUMENT_OBSERVATION_OPERATION
    || !['MV','TASY','ERP'].includes(value.sourceSystem) || !validExternalId(value.externalDocumentId)
    || typeof value.observedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt)
    || !Number.isFinite(Date.parse(value.observedAt)) || new Date(value.observedAt).toISOString()!==value.observedAt
    || !integer(value.expectedRevision,Number.MAX_SAFE_INTEGER-1)
    || !(value.expectedPreviousObservationHash===null || hash(value.expectedPreviousObservationHash))) return null;
  const acquisition=parseAcquisition(value.acquisition);
  const extraction=acquisition && parseExtraction(value.extraction,acquisition);
  return acquisition && extraction ? sorted({...value,acquisition,extraction}) as DocumentObservationPayload : null;
}
export function documentObservationIdentity(orgId:string,payload:Pick<DocumentObservationPayload,'sourceSystem'|'externalDocumentId'>) {
  const sourceIdHash=createHash('sha256').update(`${orgId}:${payload.sourceSystem}:${payload.externalDocumentId}`).digest('hex');
  return {id:sourceIdHash.slice(0,48),sourceIdHash,entityKey:`${payload.sourceSystem}:${sourceIdHash.slice(0,32)}`};
}
export const observationAcquisitionHash = (value:ObservationAcquisition) => digest(value);
export const observationPayloadHash = (value:DocumentObservationPayload) => digest(value);
/** Capture time and CAS are attempt metadata; a rescan of identical evidence is the same observation. */
export function documentObservationHash(orgId:string,payload:DocumentObservationPayload):string {
  return digest({schemaVersion:payload.schemaVersion,sourceSystem:payload.sourceSystem,
    sourceIdHash:documentObservationIdentity(orgId,payload).sourceIdHash,acquisition:payload.acquisition,extraction:payload.extraction});
}
export const documentObservationBlocksFacts = (current:Data|null):boolean => !!current && Object.hasOwn(current,'documentObservation');
export type ObservationTransaction = {
  read(path:string):Promise<Data|null>; create(path:string,data:Data):void; replace(path:string,data:Data):void;
  timestamp:unknown;
};
export type DocumentObservationResult = {
  kind:'RECORDED'|'DUPLICATE'; schemaVersion:typeof DOCUMENT_OBSERVATION_RECEIPT_SCHEMA;
  code:'DOCUMENT_OBSERVATION_RECORDED'; orgId:string; documentId:string; receiptId:string;
  versionId:string; revision:number; observationHash:string; acquisitionHash:string;
  extractionStatus:ObservationExtraction['status']; nativeReady:false; sourceIndependent:false;
  sourceVersion:null; firstIngestionVerified:false; operationalComplete:false;
};
function currentObservation(current:Data|null,orgId:string,payload:DocumentObservationPayload):Data|null|false {
  if (!documentObservationBlocksFacts(current)) return null;
  const value=current!.documentObservation;
  if (!exact(value,['schemaVersion','observationHash','acquisitionHash','observedAt','acquisition','extraction','previousObservationHash'])
    || value.schemaVersion!==DOCUMENT_OBSERVATION_SCHEMA || !hash(value.observationHash) || !hash(value.acquisitionHash)
    || !(value.previousObservationHash===null || hash(value.previousObservationHash))) return false;
  const parsed=parseDocumentObservationPayload({...payload,observedAt:value.observedAt,
    acquisition:value.acquisition,extraction:value.extraction});
  return parsed && documentObservationHash(orgId,parsed)===value.observationHash
    && observationAcquisitionHash(parsed.acquisition)===value.acquisitionHash ? value : false;
}
/** One existing tenant transaction owns authorization, CAS, immutable versions, audit and idempotency.
 * replace(sourceDocuments) deliberately cannot inherit financial facts from an earlier revision. */
export async function recordDocumentObservation(principal:DocumentPrincipal,input:unknown,idempotencyKey:string,
  tx:ObservationTransaction,clock:Date|(()=>Date)=()=>new Date()):Promise<DocumentObservationResult> {
  const payload=parseDocumentObservationPayload(input);
  if (!payload) throw Error('INVALID_DOCUMENT_OBSERVATION');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(principal.orgId)
    || !/^(?:ik_[a-f0-9]{16}|web_[a-f0-9]{32})$/.test(principal.keyId)
    || !/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) throw Error('INVALID_OBSERVATION_CONTEXT');
  const identity=documentObservationIdentity(principal.orgId,payload),observationHash=documentObservationHash(principal.orgId,payload);
  const acquisitionHash=observationAcquisitionHash(payload.acquisition),bodyHash=observationPayloadHash(payload);
  const receiptId=createHash('sha256').update(`document-observation:${principal.keyId}:${idempotencyKey}`).digest('hex');
  const base=`organizations/${principal.orgId}`,docPath=`${base}/sourceDocuments/${identity.id}`;
  const receiptPath=`${base}/apiIdempotency/${receiptId}`;
  const [org,current,existingReceipt]=await Promise.all([tx.read(base),tx.read(docPath),tx.read(receiptPath)]);
  if (org?.active!==true) throw Error('ORGANIZATION_DISABLED');
  if (principal.member) {
    if (principal.member.orgId!==principal.orgId || !/^[A-Za-z0-9_-]{1,128}$/.test(principal.member.uid)) throw Error('MEMBERSHIP_REVOKED');
    const member=await tx.read(`${base}/members/${principal.member.uid}`);
    if (member?.active!==true || !canImportNativeDocuments({...principal.member,role:String(member.role),
      allFacilities:member.allFacilities===true,permissions:Array.isArray(member.permissions)?member.permissions:[]})) throw Error('MEMBERSHIP_REVOKED');
    const expected='web_'+createHash('sha256').update(`${principal.orgId}:${principal.member.uid}`).digest('hex').slice(0,32);
    if (principal.keyId!==expected) throw Error('MEMBERSHIP_REVOKED');
  } else {
    const credential=await tx.read(`${base}/integrationCredentials/${principal.keyId}`);
    if (credential?.orgId!==principal.orgId || credential.keyId!==principal.keyId) throw Error('INVALID_INTEGRATION_KEY');
    const adminActive=(member:Data|null)=>member?.active===true && member.allFacilities===true
      && (['platform_admin','org_admin','director'].includes(member.role)
        || Array.isArray(member.permissions) && member.permissions.includes('integrations.manage'));
    const issuerUid=credential.createdBy;
    if (typeof issuerUid!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(issuerUid)) throw Error('CREDENTIAL_AUTHORITY_INACTIVE');
    const issuer=await tx.read(`${base}/members/${issuerUid}`);
    const configurerUid=credential.automation?.configuredBy;
    const configurer=credential.automation===undefined ? null : configurerUid===issuerUid ? issuer
      : typeof configurerUid==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(configurerUid)
        ? await tx.read(`${base}/members/${configurerUid}`) : null;
    if (!adminActive(issuer) || credential.automation!==undefined && !adminActive(configurer)) throw Error('CREDENTIAL_AUTHORITY_INACTIVE');
    // Observing pending content does not require automation to be configured or
    // enabled; it still cannot inherit a revoked issuer/configurer's authority.
    if (!credentialAllowsScope(credential,'documents.ingest',typeof clock==='function'?clock():clock)) throw Error('INVALID_INTEGRATION_KEY');
  }
  if (current && (current.orgId!==principal.orgId || current.entityType!=='sourceDocument'
    || current.entityKey!==identity.entityKey || !integer(current.revision,Number.MAX_SAFE_INTEGER-1) || current.revision<1
    || current.revoked===true || current.deleted===true)) throw Error('OBSERVATION_BINDING_CONFLICT');
  const previous=currentObservation(current,principal.orgId,payload);
  if (previous===false) throw Error('OBSERVATION_BINDING_CONFLICT');
  if (existingReceipt && (existingReceipt.schemaVersion!==DOCUMENT_OBSERVATION_RECEIPT_SCHEMA
    || existingReceipt.orgId!==principal.orgId || existingReceipt.keyId!==principal.keyId
    || existingReceipt.documentId!==identity.id || existingReceipt.bodyHash!==bodyHash
    || existingReceipt.observationHash!==observationHash || existingReceipt.acquisitionHash!==acquisitionHash
    || !['RECORDED','DUPLICATE'].includes(existingReceipt.kind) || existingReceipt.code!=='DOCUMENT_OBSERVATION_RECORDED'
    || existingReceipt.extractionStatus!==payload.extraction.status || existingReceipt.sourceVersion!==null
    || existingReceipt.nativeReady!==false || existingReceipt.sourceIndependent!==false
    || existingReceipt.firstIngestionVerified!==false || existingReceipt.operationalComplete!==false)) throw Error('IDEMPOTENCY_CONFLICT');
  const same=previous?.observationHash===observationHash;
  if (existingReceipt && !same) throw Error('OBSERVATION_SUPERSEDED');
  const revision=same ? current!.revision : nextCanonicalEntityRevision(current?.revision);
  if (revision===null) throw Error('ENTITY_REVISION_CONFLICT');
  const versionId=immutableEntityVersionId('sourceDocument',identity.entityKey,revision);
  const versionPath=`${base}/entityVersions/${versionId}`,version=await tx.read(versionPath);
  const result:DocumentObservationResult={kind:same?'DUPLICATE':'RECORDED',schemaVersion:DOCUMENT_OBSERVATION_RECEIPT_SCHEMA,
    code:'DOCUMENT_OBSERVATION_RECORDED',orgId:principal.orgId,documentId:identity.id,receiptId,versionId,revision,
    observationHash,acquisitionHash,extractionStatus:payload.extraction.status,nativeReady:false,sourceIndependent:false,
    sourceVersion:null,firstIngestionVerified:false,operationalComplete:false};
  if (same) {
    if (!version || version.orgId!==principal.orgId || version.entityType!=='sourceDocument' || version.entityId!==identity.id
      || version.entityKey!==identity.entityKey || version.revision!==revision || version.sourceVersion!==null
      || version.observationHash!==observationHash || version.afterHash!==persistedDocumentHash(null,current!)
      || version.afterHash!==persistedDocumentHash(null,version.snapshot ?? {})
      || existingReceipt && (existingReceipt.revision!==revision || existingReceipt.versionId!==versionId)) throw Error('OBSERVATION_BINDING_CONFLICT');
    if (existingReceipt) {
      if (!integer(existingReceipt.replayCount,Number.MAX_SAFE_INTEGER-1)) throw Error('OBSERVATION_BINDING_CONFLICT');
      tx.replace(receiptPath,{...existingReceipt,replayCount:existingReceipt.replayCount+1,lastReplayAt:tx.timestamp});
    } else tx.create(receiptPath,{...result,bodyHash,keyId:principal.keyId,replayCount:0,createdAt:tx.timestamp});
    return result;
  }
  if (payload.expectedRevision!==(current?.revision ?? 0)
    || payload.expectedPreviousObservationHash!==(previous?.observationHash ?? null)) throw Error('OBSERVATION_CAS_CONFLICT');
  if (current) {
    const priorVersionId=immutableEntityVersionId('sourceDocument',identity.entityKey,current.revision);
    const priorVersion=await tx.read(`${base}/entityVersions/${priorVersionId}`);
    if (!priorVersion || priorVersion.orgId!==principal.orgId || priorVersion.entityType!=='sourceDocument'
      || priorVersion.entityId!==identity.id || priorVersion.entityKey!==identity.entityKey
      || priorVersion.revision!==current.revision || priorVersion.sourceVersion!==current.sourceVersion
      || priorVersion.afterHash!==persistedDocumentHash(null,current)
      || priorVersion.afterHash!==persistedDocumentHash(null,priorVersion.snapshot ?? {})) throw Error('OBSERVATION_BINDING_CONFLICT');
  }
  if (previous) {
    const prior=previous.acquisition as ObservationAcquisition,next=payload.acquisition;
    if (prior.provider!==next.provider || prior.sourceObjectIdHash!==next.sourceObjectIdHash
      || prior.versionKind!==next.versionKind || prior.sourceMimeType!==next.sourceMimeType
      || prior.representation!==next.representation) throw Error('SOURCE_ACQUISITION_CONFLICT');
    if (prior.observedVersion===next.observedVersion) throw Error('SOURCE_ACQUISITION_CONFLICT');
    if (next.provider==='GOOGLE_DRIVE' && next.versionKind==='PROVIDER_REVISION'
      && BigInt(next.observedVersion)<BigInt(prior.observedVersion)) throw Error('SOURCE_ACQUISITION_REGRESSION');
  }
  if (version) throw Error('ENTITY_VERSION_CONFLICT');
  const record:Data={orgId:principal.orgId,schemaVersion:1,entityType:'sourceDocument',entityKey:identity.entityKey,revision,
    sourceVersion:null,observedAt:payload.observedAt,documentType:'OTHER',category:'other',competence:null,amountCents:null,count:null,
    workflowState:payload.extraction.status==='COMPLETE'?'PENDING_HUMAN_REVIEW':'PENDING_EVIDENCE',reviewState:'PENDING',
    riskLevel:payload.extraction.status==='COMPLETE'?'MEDIUM':'HIGH',sensitivity:'RESTRICTED',
    canonicalSnapshotVersion:1,canonicalSnapshotHash:null,nativeReady:false,sourceIndependent:false,
    externalFetchRequired:true,externalAiUsed:false,sanitized:true,
    documentFragility:payload.extraction.status==='COMPLETE'?'MISSING_CANONICAL_FIELDS':'DEGRADED_EXTRACTION',missingFieldsCount:1,
    originSystem:payload.sourceSystem,originConnector:'AURORA_DOCUMENT_OBSERVATION',
    source:{system:payload.sourceSystem,sourceId:`external:${identity.sourceIdHash.slice(0,32)}`,
      contentHash:payload.acquisition.byteSha256,hashMethod:'client_observed_representation_sha256',
      observationHash,acquisitionAuthority:'AUTHENTICATED_CLIENT_OBSERVATION_NOT_CONTENT_VERIFICATION'},
    documentObservation:{schemaVersion:DOCUMENT_OBSERVATION_SCHEMA,observationHash,acquisitionHash,
      observedAt:payload.observedAt,acquisition:payload.acquisition,extraction:payload.extraction,
      previousObservationHash:previous?.observationHash ?? null},
    integration:{keyId:principal.keyId,connector:principal.name,
      transport:principal.member?'AURORA_NATIVE_SESSION_IMPORT':'AURORA_INTEGRATION_API',
      operation:DOCUMENT_OBSERVATION_OPERATION,payloadHash:bodyHash},
    createdAt:current?.createdAt ?? tx.timestamp,updatedAt:tx.timestamp};
  const beforeHash=current ? persistedDocumentHash(null,current) : null,afterHash=persistedDocumentHash(null,record);
  tx.replace(docPath,record);
  tx.create(versionPath,{orgId:principal.orgId,schemaVersion:1,entityType:'sourceDocument',entityId:identity.id,
    entityKey:identity.entityKey,revision,sourceVersion:null,observationHash,idempotencyId:receiptId,
    actor:principal.member?{uid:principal.member.uid,role:principal.member.role}:{keyId:principal.keyId,connector:principal.name},
    beforeHash,afterHash,snapshot:stableValue(record),createdAt:tx.timestamp});
  tx.create(receiptPath,{...result,bodyHash,keyId:principal.keyId,replayCount:0,createdAt:tx.timestamp});
  tx.create(`${base}/auditEvents/document-observation-${receiptId.slice(0,40)}`,{
    orgId:principal.orgId,action:'DOCUMENT_EXTRACTION_OBSERVED',type:'DOCUMENT_EXTRACTION_OBSERVED',documentId:identity.id,
    revision,versionId,observationHash,acquisitionHash,beforeHash,afterHash,keyId:principal.keyId,
    ...(principal.member?{actorUid:principal.member.uid}:{}),sourceSystem:payload.sourceSystem,
    extractionStatus:payload.extraction.status,occurredAt:tx.timestamp,sanitized:true,sensitivity:'INTERNAL'});
  return result;
}
