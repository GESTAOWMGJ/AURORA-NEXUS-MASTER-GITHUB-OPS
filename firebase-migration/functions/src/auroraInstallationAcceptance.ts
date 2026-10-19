import { createHash } from 'node:crypto';
import { credentialAllowsScope } from './auroraIntegrationCredential.js';
import { canImportNativeDocuments, NATIVE_INGESTION_ORIGIN, type DocumentPrincipal } from './auroraNativeIngestion.js';
import type { AuroraMember } from './auroraAccess.js';
import { integrationRevalidationMatches, validInstallationReceiptSelection,
  type InstallationReceiptSelection } from './auroraIntegrationRevalidation.js';

type Data = Record<string, any>;
export const ACQUISITION_METHODS = ['CLOUD_OAUTH', 'API_TOKEN', 'LOCAL_AGENT', 'MANUAL'] as const;
export type AcquisitionMethod = typeof ACQUISITION_METHODS[number];
export const INSTALLATION_ACCEPTANCE_SCHEMA = 'aurora.installation.acceptance.v1';
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const key = (value: unknown): value is string => typeof value === 'string' && /^ik_[a-f0-9]{16}$/.test(value);
const source = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
const uid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const iso = (value: any): string | null => {
  const date = typeof value?.toDate === 'function' ? value.toDate()
    : typeof value === 'string' ? new Date(value) : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
export const manualIntegrationKeyId = (orgId: string, actorUid: string) =>
  'web_' + createHash('sha256').update(`${orgId}:${actorUid}`).digest('hex').slice(0, 32);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const semanticBinding = (binding: Data) => ({schemaVersion:'aurora.automation.binding.v1',
  orgId:binding.orgId, method:binding.method, keyId:binding.keyId, sourceSystem:binding.sourceSystem,
  pipeline:'AURORA_CANONICAL_PIPELINE', enabled:binding.enabled, revision:binding.revision,
  configuredBy:binding.configuredBy});
const adminActive = (member: Data | null) => member?.active === true && member.allFacilities === true
  && (['platform_admin','org_admin','director'].includes(member.role)
    || (Array.isArray(member.permissions) && member.permissions.includes('integrations.manage')));
export function publicAutomationConfiguration(value:unknown) {
  const binding=value as Data|null;
  if(binding?.schemaVersion!=='aurora.automation.binding.v1' || !['API_TOKEN','MANUAL'].includes(binding.method)
    || !source(binding.sourceSystem) || typeof binding.enabled!=='boolean' || !Number.isSafeInteger(binding.revision)
    || binding.revision<1 || !hash(binding.configurationHash)) return null;
  return {method:binding.method as 'API_TOKEN'|'MANUAL',sourceSystem:binding.sourceSystem as string,
    enabled:binding.enabled as boolean,revision:binding.revision as number,
    configurationHash:binding.configurationHash as string,scope:'AURORA_CANONICAL_PIPELINE'};
}

/** Uses the existing organization, credential and installation checkpoint, in one transaction.
 * Configuration authorizes this server pipeline; it never attests a watcher or provider login. */
export async function configureCanonicalAutomation(actor: AuroraMember, body: unknown, tx: {
  read(path: string): Promise<Data | null>; merge(path: string, data: Data): void;
  create(path:string,data:Data):void; timestamp: unknown;
}) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(actor.orgId) || !canImportNativeDocuments(actor) || !uid(actor.uid)) throw Error('MFA_AND_INTEGRATION_ADMIN_REQUIRED');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('INVALID_AUTOMATION_CONFIGURATION');
  const input = body as Data;
  if (Object.keys(input).some(k => !['action','method','keyId','sourceSystem','expectedRevision','enabled'].includes(k))
    || input.action !== 'CONFIGURE_AUTOMATION' || !ACQUISITION_METHODS.includes(input.method)
    || !source(input.sourceSystem) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || typeof input.enabled !== 'boolean') throw Error('INVALID_AUTOMATION_CONFIGURATION');
  if (input.method !== 'API_TOKEN' && input.method !== 'MANUAL') throw Error('ADAPTER_EVIDENCE_REQUIRED');
  const keyId = input.method === 'MANUAL' ? manualIntegrationKeyId(actor.orgId, actor.uid) : input.keyId;
  if (input.method === 'API_TOKEN' ? !key(keyId) : input.keyId !== undefined) throw Error('INVALID_AUTOMATION_CONFIGURATION');
  const base = `organizations/${actor.orgId}`;
  const path = input.method === 'API_TOKEN' ? `${base}/integrationCredentials/${keyId}` : `${base}/runtimeCheckpoints/installation`;
  const [org, member, target] = await Promise.all([tx.read(base), tx.read(`${base}/members/${actor.uid}`), tx.read(path)]);
  if (org?.active !== true || org.projectionEnabled !== true || org.projectionMode !== 'SHADOW') throw Error('AUTOMATION_PIPELINE_DISABLED');
  if (!adminActive(member)) throw Error('MEMBERSHIP_REVOKED');
  if (input.method === 'API_TOKEN' && (target?.orgId !== actor.orgId || target.keyId !== keyId
    || !credentialAllowsScope(target, 'documents.ingest') || !credentialAllowsScope(target, 'integration.read'))) throw Error('AUTOMATION_CREDENTIAL_INACTIVE');
  const previous = target?.automation;
  if (target && target.orgId !== actor.orgId) throw Error('AUTOMATION_CONFIGURATION_CONFLICT');
  if (previous !== undefined && (previous?.schemaVersion !== 'aurora.automation.binding.v1'
    || previous.orgId !== actor.orgId || !hash(previous.configurationHash)
    || previous.configurationHash !== digest(semanticBinding(previous)))) throw Error('AUTOMATION_CONFIGURATION_CONFLICT');
  const currentRevision = previous === undefined ? 0 : previous?.revision;
  if (!Number.isSafeInteger(currentRevision) || currentRevision !== input.expectedRevision
    || currentRevision >= Number.MAX_SAFE_INTEGER) throw Error('AUTOMATION_CONFIGURATION_CONFLICT');
  const binding = semanticBinding({orgId:actor.orgId, method:input.method, keyId,
    sourceSystem:input.sourceSystem, enabled:input.enabled, revision:currentRevision + 1, configuredBy:actor.uid});
  const configurationHash = digest(binding);
  const auditPath = `${base}/auditEvents/automation-binding-${configurationHash}`;
  if(await tx.read(auditPath)) throw Error('AUTOMATION_CONFIGURATION_CONFLICT');
  // The audit is create-only and commits in the same transaction as the CAS
  // binding; retries cannot overwrite or erase the preceding configuration.
  tx.create(auditPath,{orgId:actor.orgId,action:'AUTOMATION_BINDING_CONFIGURED',type:'AUTOMATION_BINDING_CONFIGURED',
    actorUid:actor.uid,actorRole:member!.role,method:input.method,keyId,sourceSystem:input.sourceSystem,
    previousConfigurationHash:previous?.configurationHash ?? null,configurationHash,
    previousRevision:currentRevision,revision:binding.revision,enabled:input.enabled,
    automationScope:'AURORA_CANONICAL_PIPELINE',occurredAt:tx.timestamp,sanitized:true,sensitivity:'INTERNAL'});
  tx.merge(path, {orgId:actor.orgId, automation:{...binding, configurationHash, configuredAt:tx.timestamp}});
  return {orgId:actor.orgId, method:input.method, configurationHash, revision:binding.revision,
    configured:true, automationScope:'AURORA_CANONICAL_PIPELINE', providerAccessVerified:false,
    localCollectionVerified:false, agentExecutionVerified:false};
}

export type InstallationAcceptance = {
  schemaVersion: typeof INSTALLATION_ACCEPTANCE_SCHEMA; orgId:string; canonicalOrigin:string;
  state:'PENDING_PROCESSING'|'PENDING_RECEIPT'|'PENDING_REPLAY'|'PENDING_AUTOMATION'|'PENDING_AUTHORITY'
    |'PENDING_ADAPTER_EVIDENCE'|'INSTALLATION_INTEGRATION_VERIFIED'; eligible:boolean;
  processingVerified:boolean; receiptPersisted:boolean; replayVerified:boolean;
  automationConfigured:boolean; automationVerified:boolean; automationScope:'AURORA_CANONICAL_PIPELINE';
  method:AcquisitionMethod|'UNCONFIGURED'; configurationHash:string|null; receiptId:string|null;
  documentId:string|null; versionId:string|null; sourceVersion:number|null;
  canonicalSnapshotHash:string|null; verifiedAt:string|null;
  providerAccessVerified:false; localCollectionVerified:false; agentExecutionVerified:false;
  globalDocumentAcquisitionVerified:false; processedFormat:'CANONICAL_STRUCTURED_JSON';
  acquisitionModes:Record<AcquisitionMethod, string>; limitations:string[];
};

/** Metadata allowlist only. Client method/flags, ping and cached receipts cannot satisfy it. */
export async function readInstallationAcceptance(orgId:string, processing:Data, document:Data|null,
  version:Data|null, completion:Data|null, read:(path:string)=>Promise<Data|null>, clock:Date|(()=>Date)=()=>new Date(),
  selection?:InstallationReceiptSelection): Promise<InstallationAcceptance> {
  const currentTime=typeof clock==='function'?clock:()=>clock, now=currentTime();
  const result:InstallationAcceptance = {schemaVersion:INSTALLATION_ACCEPTANCE_SCHEMA, orgId,
    canonicalOrigin:NATIVE_INGESTION_ORIGIN, state:'PENDING_PROCESSING', eligible:false,
    processingVerified:processing.firstIngestionVerified === true, receiptPersisted:false, replayVerified:false,
    automationConfigured:false, automationVerified:false, automationScope:'AURORA_CANONICAL_PIPELINE',
    method:'UNCONFIGURED', configurationHash:null, receiptId:null, documentId:processing.documentId ?? null,
    versionId:processing.versionId ?? null, sourceVersion:processing.sourceVersion ?? null,
    canonicalSnapshotHash:processing.canonicalSnapshotHash ?? null, verifiedAt:null,
    providerAccessVerified:false,localCollectionVerified:false,agentExecutionVerified:false,
    globalDocumentAcquisitionVerified:false,processedFormat:'CANONICAL_STRUCTURED_JSON',
    acquisitionModes:{CLOUD_OAUTH:'PENDING_ADAPTER_EVIDENCE',API_TOKEN:'PENDING_CONFIGURATION',
      LOCAL_AGENT:'PENDING_ADAPTER_EVIDENCE',MANUAL:'PENDING_CONFIGURATION'},
    limitations:['PROVIDER_ACCESS_NOT_VERIFIED','LOCAL_COLLECTION_NOT_VERIFIED','AGENT_EXECUTION_NOT_VERIFIED','GLOBAL_EXTRACTION_NOT_VERIFIED']};
  if (!result.processingVerified || document?.orgId !== orgId || version?.orgId !== orgId) return result;
  result.state = 'PENDING_RECEIPT';
  if (selection!==undefined && !validInstallationReceiptSelection(selection)) return result;
  const receiptId = selection?.receiptId ?? version.idempotencyId;
  const integration = document.integration;
  if (!hash(receiptId) || !integration || !hash(integration.payloadHash)) return result;
  const keyId = selection?.keyId ?? integration.keyId;
  const method = selection ? 'API_TOKEN' : integration.transport === 'AURORA_NATIVE_SESSION_IMPORT' ? 'MANUAL'
    : integration.transport === 'AURORA_INTEGRATION_API' && key(keyId) ? 'API_TOKEN' : null;
  if (!method) return result;
  if (method === 'MANUAL' && (!uid(version.actor?.uid) || keyId !== manualIntegrationKeyId(orgId, version.actor.uid))) return result;
  result.method = method;
  const base = `organizations/${orgId}`;
  const [receipt, org, credential] = await Promise.all([read(`${base}/apiIdempotency/${receiptId}`), read(base),
    method === 'API_TOKEN' ? read(`${base}/integrationCredentials/${keyId}`) : Promise.resolve(null)]);
  if (receipt?.orgId !== orgId || receipt.schemaVersion !== 'aurora.ingestion.receipt.v1'
    || receipt.bodyHash !== integration.payloadHash || receipt.keyId !== keyId
    || receipt.documentId !== result.documentId || receipt.versionId !== result.versionId
    || receipt.sourceVersion !== result.sourceVersion || receipt.revision !== processing.revision
    || receipt.canonicalSnapshotHash !== result.canonicalSnapshotHash || !iso(receipt.acceptedAt)) return result;
  if (selection) {
    if (receipt.revalidation!==undefined) {
      // Only the immutable version supplies the original receipt path. Never
      // trust an arbitrary path or key supplied by the selected receipt/query.
      const originalData=hash(version.idempotencyId)
        ? await read(`${base}/apiIdempotency/${version.idempotencyId}`) : null;
      const originalReceipt=originalData ? {...originalData,_readReceiptId:version.idempotencyId} : null;
      if (!integrationRevalidationMatches(orgId,keyId,receiptId,receipt,result.documentId!,document,
        {...version,_readVersionId:result.versionId},originalReceipt,integration.payloadHash)) return result;
    } else if (receiptId!==version.idempotencyId || keyId!==integration.keyId) return result;
  } else if (receipt.revalidation!==undefined) return result;
  result.receiptPersisted = true; result.receiptId = receiptId; result.state = 'PENDING_REPLAY';
  const replayAt = iso(receipt.lastReplayAt), acceptedAt = iso(receipt.acceptedAt)!;
  if (!Number.isSafeInteger(receipt.replayCount) || receipt.replayCount < 1 || !replayAt
    || Date.parse(replayAt) < Date.parse(acceptedAt) || Date.parse(replayAt) > now.getTime()) return result;
  result.replayVerified = true; result.state = 'PENDING_AUTOMATION';
  const binding = method === 'API_TOKEN' ? credential?.automation : completion?.automation;
  if (binding?.schemaVersion !== 'aurora.automation.binding.v1' || binding.orgId !== orgId
    || binding.method !== method || binding.keyId !== keyId || binding.sourceSystem !== document.source?.system
    || binding.pipeline !== 'AURORA_CANONICAL_PIPELINE' || binding.enabled !== true
    || !Number.isSafeInteger(binding.revision) || binding.revision < 1 || !uid(binding.configuredBy)
    || !hash(binding.configurationHash) || binding.configurationHash !== digest(semanticBinding(binding))
    || !iso(binding.configuredAt) || Date.parse(iso(binding.configuredAt)!) > now.getTime()) return result;
  result.automationConfigured = true; result.configurationHash = binding.configurationHash; result.state = 'PENDING_AUTHORITY';
  const configurer = await read(`${base}/members/${binding.configuredBy}`);
  if (!adminActive(configurer) || org?.active !== true || org.projectionEnabled !== true || org.projectionMode !== 'SHADOW') return result;
  if (method === 'API_TOKEN') {
    if (credential?.orgId !== orgId || credential.keyId !== keyId || !uid(credential.createdBy)
      || !credentialAllowsScope(credential, 'integration.read', now) || !credentialAllowsScope(credential, 'documents.ingest', now)) return result;
    const issuer = await read(`${base}/members/${credential.createdBy}`);
    if (!adminActive(issuer)) return result;
  } else if (binding.configuredBy !== version.actor?.uid) return result;
  // Recheck time-sensitive authority after the last asynchronous authority read.
  const verifiedNow=currentTime();
  if(!Number.isFinite(verifiedNow.getTime()) || (method==='API_TOKEN'
    && (!credentialAllowsScope(credential!, 'integration.read', verifiedNow)
      || !credentialAllowsScope(credential!, 'documents.ingest', verifiedNow)))) return result;
  result.automationVerified = true; result.eligible = true; result.state = 'INSTALLATION_INTEGRATION_VERIFIED';
  result.verifiedAt = verifiedNow.toISOString();
  result.acquisitionModes[method] = 'CANONICAL_PIPELINE_VERIFIED';
  return result;
}

/** Same-origin UI guard supplements, and cannot replace, the server transaction guard. */
export function installationAcceptanceClientGuard(): string {
  return `function acceptanceReady(p,org){const a=p?.acceptance;return a?.schemaVersion==='aurora.installation.acceptance.v1'&&a.orgId===org&&a.canonicalOrigin==='https://auroranexus.com.br'&&a.state==='INSTALLATION_INTEGRATION_VERIFIED'&&['eligible','processingVerified','receiptPersisted','replayVerified','automationConfigured','automationVerified'].every(k=>a[k]===true)&&a.automationScope==='AURORA_CANONICAL_PIPELINE'&&['API_TOKEN','MANUAL'].includes(a.method)&&/^[a-f0-9]{64}$/.test(a.configurationHash||'')&&/^[a-f0-9]{64}$/.test(a.receiptId||'')&&['documentId','versionId','sourceVersion','canonicalSnapshotHash'].every(k=>a[k]===p[k])&&typeof a.verifiedAt==='string'&&Number.isFinite(Date.parse(a.verifiedAt))}`;
}

/** Only called after authentication and transaction readback of the exact accepted operation. */
export function integrationReplayPatch(orgId:string, principal:DocumentPrincipal, receipt:Data|null,
  document:Data|null, version:Data|null, bodyHash:string, documentId:string, timestamp:unknown,
  revalidation?:{receiptId:string;originalReceipt:Data|null}): Data|null {
  const bindingVerified=receipt?.revalidation!==undefined
    ? !!revalidation && integrationRevalidationMatches(orgId,principal.keyId,revalidation.receiptId,
      receipt,documentId,document,version,revalidation.originalReceipt,bodyHash)
    : document?.integration?.keyId===principal.keyId;
  if (receipt?.orgId !== orgId || receipt.schemaVersion !== 'aurora.ingestion.receipt.v1'
    || principal.orgId !== orgId || receipt.keyId !== principal.keyId || receipt.bodyHash !== bodyHash
    || receipt.documentId !== documentId || document?.orgId !== orgId || version?.orgId !== orgId
    || document.integration?.payloadHash !== bodyHash || !bindingVerified
    || receipt.sourceVersion !== document.sourceVersion || receipt.revision !== document.revision
    || receipt.versionId !== version._readVersionId || receipt.canonicalSnapshotHash !== document.canonicalSnapshotHash
    || version.sourceVersion !== document.sourceVersion || version.revision !== document.revision
    || !Number.isSafeInteger(receipt.replayCount) || receipt.replayCount < 0
    || receipt.replayCount >= Number.MAX_SAFE_INTEGER) return null;
  return {lastReplayAt:timestamp,replayCount:receipt.replayCount + 1};
}
