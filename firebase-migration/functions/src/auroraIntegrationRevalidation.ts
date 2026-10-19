import { immutableEntityVersionId, persistedDocumentHash } from './auroraCanonicalVersions.js';
import { credentialAllowsScope } from './auroraIntegrationCredential.js';
import type { DocumentPrincipal } from './auroraNativeIngestion.js';
import { createHash } from 'node:crypto';

type Data = Record<string, any>;
const hash = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const id = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{48}$/.test(v);
const key = (v:unknown):v is string => typeof v==='string' && /^ik_[a-f0-9]{16}$/.test(v);
const validDate = (v:any) => {
  const d=typeof v?.toDate==='function'?v.toDate():typeof v==='string'?new Date(v):null;
  return d instanceof Date && Number.isFinite(d.getTime());
};
export type InstallationReceiptSelection = {receiptId:string;keyId:string};
export function validInstallationReceiptSelection(value:InstallationReceiptSelection|undefined):boolean {
  return value!==undefined && hash(value.receiptId) && key(value.keyId);
}

/** Readback of the immutable current revision, never a rewrite of its provenance. */
function immutableDocumentMatches(orgId:string, documentId:string, document:Data|null, version:Data|null,
  bodyHash:string):boolean {
  if (!id(documentId) || !hash(bodyHash) || document?.orgId!==orgId || version?.orgId!==orgId
    || document.entityType!=='sourceDocument' || document.revoked===true || document.deleted===true
    || typeof document.entityKey!=='string' || !document.entityKey
    || !Number.isSafeInteger(document.revision) || document.revision<1
    || !Number.isSafeInteger(document.sourceVersion) || document.sourceVersion<1
    || !hash(document.canonicalSnapshotHash) || document.integration?.payloadHash!==bodyHash
    || version.entityType!=='sourceDocument' || version.entityId!==documentId
    || version.entityKey!==document.entityKey || version.revision!==document.revision
    || version.sourceVersion!==document.sourceVersion || !hash(version.idempotencyId)
    || version._readVersionId!==immutableEntityVersionId('sourceDocument',document.entityKey,document.revision)
    || version.snapshot?.canonicalSnapshotHash!==document.canonicalSnapshotHash
    || version.afterHash!==persistedDocumentHash(null,version.snapshot)
    || version.afterHash!==persistedDocumentHash(null,document)) return false;
  return true;
}

function receiptMatches(orgId:string, receipt:Data|null, documentId:string, document:Data|null,
  version:Data|null, bodyHash:string, keyId:string):boolean {
  return receipt?.schemaVersion==='aurora.ingestion.receipt.v1' && receipt.orgId===orgId
    && receipt.keyId===keyId && receipt.bodyHash===bodyHash && receipt.documentId===documentId
    && receipt.versionId===version?._readVersionId && receipt.sourceVersion===document?.sourceVersion
    && receipt.revision===document?.revision && receipt.canonicalSnapshotHash===document?.canonicalSnapshotHash
    && validDate(receipt.acceptedAt);
}

/** Both POSTs and the selected readback require current authority. A read scope
 * alone cannot manufacture a POST/replay or inherit the old credential's grant. */
export function revalidationAuthorityActive(orgId:string,keyId:string, authority:{
  org:Data|null;credential:Data|null;issuer:Data|null;configurer:Data|null
}, now=new Date(),sourceSystem?:string):boolean {
  const {org,credential,issuer,configurer}=authority, binding=credential?.automation;
  const admin=(member:Data|null)=>member?.active===true && member.allFacilities===true
    && (['platform_admin','org_admin','director'].includes(member.role)
      || (Array.isArray(member.permissions) && member.permissions.includes('integrations.manage')));
  const semantic=binding ? {schemaVersion:'aurora.automation.binding.v1',orgId:binding.orgId,method:binding.method,
    keyId:binding.keyId,sourceSystem:binding.sourceSystem,pipeline:'AURORA_CANONICAL_PIPELINE',enabled:binding.enabled,
    revision:binding.revision,configuredBy:binding.configuredBy} : null;
  return key(keyId) && Number.isFinite(now.getTime()) && org?.active===true
    && org.projectionEnabled===true && org.projectionMode==='SHADOW'
    && credential?.orgId===orgId && credential.keyId===keyId
    && typeof credential.createdBy==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(credential.createdBy)
    && credentialAllowsScope(credential,'documents.ingest',now)
    && credentialAllowsScope(credential,'integration.read',now)
    && admin(issuer) && admin(configurer)
    && binding?.schemaVersion==='aurora.automation.binding.v1' && binding.orgId===orgId
    && binding.method==='API_TOKEN' && binding.keyId===keyId && binding.sourceSystem===sourceSystem
    && typeof sourceSystem==='string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(sourceSystem)
    && binding.pipeline==='AURORA_CANONICAL_PIPELINE' && binding.enabled===true
    && Number.isSafeInteger(binding.revision) && binding.revision>=1
    && typeof binding.configuredBy==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(binding.configuredBy)
    && hash(binding.configurationHash)
    && binding.configurationHash===createHash('sha256').update(JSON.stringify(semantic)).digest('hex')
    && validDate(binding.configuredAt)
    && new Date(typeof binding.configuredAt?.toDate==='function'?binding.configuredAt.toDate():binding.configuredAt).getTime()<=now.getTime();
}

/** New server receipt, pointing at the original receipt and the SAME immutable
 * version. Only a validated POST may create/upgrade it; replay starts at zero. */
export function buildIntegrationRevalidationReceipt(input:{orgId:string;principal:DocumentPrincipal;
  receiptId:string;documentId:string;document:Data|null;version:Data|null;originalReceipt:Data|null;
  bodyHash:string;timestamp:unknown;authority:{org:Data|null;credential:Data|null;issuer:Data|null;configurer:Data|null};now?:Date
}):Data|null {
  const {orgId,principal,receiptId,documentId,document,version,originalReceipt,bodyHash,timestamp}=input;
  if (principal.member || principal.orgId!==orgId || !hash(receiptId)
    || !revalidationAuthorityActive(orgId,principal.keyId,input.authority,input.now,document?.source?.system)
    || !immutableDocumentMatches(orgId,documentId,document,version,bodyHash)
    || receiptId===version!.idempotencyId
    || originalReceipt?._readReceiptId!==version!.idempotencyId
    || !receiptMatches(orgId,originalReceipt,documentId,document,version,bodyHash,document!.integration.keyId)
    || originalReceipt!.revalidation!==undefined) return null;
  return {schemaVersion:'aurora.ingestion.receipt.v1',orgId,keyId:principal.keyId,bodyHash,documentId,
    versionId:version!._readVersionId,sourceVersion:document!.sourceVersion,revision:document!.revision,
    canonicalSnapshotHash:document!.canonicalSnapshotHash,acceptedAt:timestamp,replayCount:0,createdAt:timestamp,
    revalidation:{schemaVersion:'aurora.ingestion.revalidation.v1',originalReceiptId:version!.idempotencyId,
      originalVersionId:version!._readVersionId,originalKeyId:document!.integration.keyId,
      immutableAfterHash:version!.afterHash}};
}

/** Shared by POST replay and GET acceptance. All pointers are re-read inside
 * the authenticated organization; a matching receipt ID is never authority. */
export function integrationRevalidationMatches(orgId:string, keyId:string, receiptId:string,
  receipt:Data|null, documentId:string, document:Data|null, version:Data|null,
  originalReceipt:Data|null, bodyHash:string):boolean {
  const binding=receipt?.revalidation;
  return key(keyId) && hash(receiptId) && immutableDocumentMatches(orgId,documentId,document,version,bodyHash)
    && receiptMatches(orgId,receipt,documentId,document,version,bodyHash,keyId)
    && binding?.schemaVersion==='aurora.ingestion.revalidation.v1'
    && receiptId!==version!.idempotencyId && binding.originalReceiptId===version!.idempotencyId
    && binding.originalVersionId===version!._readVersionId && binding.originalKeyId===document!.integration.keyId
    && binding.immutableAfterHash===version!.afterHash
    && originalReceipt?._readReceiptId===version!.idempotencyId
    && originalReceipt?.revalidation===undefined
    && receiptMatches(orgId,originalReceipt,documentId,document,version,bodyHash,document!.integration.keyId);
}

/** The only pre-v1 shape emitted by the old duplicate branch. Corrupt full
 * receipts cannot be laundered into revalidation by an upgrade. */
export function isLegacyMinimalIntegrationReceipt(receipt:Data|null, principal:DocumentPrincipal,
  bodyHash:string,documentId:string):boolean {
  return receipt!==null && receipt.bodyHash===bodyHash && receipt.documentId===documentId
    && receipt.keyId===principal.keyId && validDate(receipt.createdAt)
    && Object.keys(receipt).every(k=>['bodyHash','documentId','keyId','createdAt'].includes(k));
}
