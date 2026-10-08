import { immutableEntityVersionId, persistedDocumentHash } from './auroraCanonicalVersions.js';
import { isOperationalRecord } from './auroraEngine.js';

type RecordData = Record<string, any>;
export type InstallationReadiness = {
  state: 'PENDING_SOURCE' | 'PENDING_CANONICAL_DATA' | 'PENDING_PROJECTION' | 'FIRST_INGESTION_VERIFIED';
  firstIngestionVerified: boolean;
  operationalComplete: boolean;
  documentId: string | null;
  sourceVersion: number | null;
  revision: number | null;
  versionId: string | null;
  canonicalSnapshotHash: string | null;
  sourceSystem: string | null;
  verifiedAt: string | null;
};
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{48}$/.test(value);

export function installationReadiness(orgId: string, checkpoint: RecordData | null,
  document: RecordData | null, projection: RecordData | null, version: RecordData | null = null,
  completion: RecordData | null = null): InstallationReadiness {
  const pending = (state: InstallationReadiness['state']): InstallationReadiness => ({
    state, firstIngestionVerified:false, operationalComplete:false, documentId:null,
    sourceVersion:null, revision:null, versionId:null, canonicalSnapshotHash:null, sourceSystem:null, verifiedAt:null
  });
  const id = checkpoint?.lastDocumentId;
  if (checkpoint?.orgId !== orgId || checkpoint?.state !== 'HEALTHY' || !validId(id)) return pending('PENDING_SOURCE');
  if (document?.orgId !== orgId || !isOperationalRecord(document) || document.entityType !== 'sourceDocument'
    || document.nativeReady !== true || document.sourceIndependent !== true
    || document.revoked === true || document.deleted === true
    || document.externalFetchRequired !== false || document.sanitized !== true
    || document.workflowState !== 'VALIDATED' || document.documentFragility !== 'NONE'
    || document.missingFieldsCount !== 0 || !Number.isSafeInteger(document.sourceVersion)
    || document.sourceVersion < 1 || !/^[a-f0-9]{64}$/.test(document.canonicalSnapshotHash ?? '')
    || !Number.isSafeInteger(document.revision) || document.revision < 1
    || typeof document.entityKey !== 'string' || !document.entityKey
    || typeof document.source?.system !== 'string') return pending('PENDING_CANONICAL_DATA');
  const versionId = immutableEntityVersionId('sourceDocument', document.entityKey, document.revision);
  if (version?.orgId !== orgId || version.entityType !== 'sourceDocument' || version.entityId !== id
    || version.entityKey !== document.entityKey || version.revision !== document.revision
    || version.sourceVersion !== document.sourceVersion
    || version.snapshot?.canonicalSnapshotHash !== document.canonicalSnapshotHash
    || version.afterHash !== persistedDocumentHash(null, version.snapshot)
    || version.afterHash !== persistedDocumentHash(null, document)) return pending('PENDING_CANONICAL_DATA');
  const proof = Array.isArray(projection?.integrationReadback)
    && projection.integrationReadback.some((item: RecordData) => item.documentId === id
      && item.sourceVersion === document.sourceVersion && item.revision === document.revision
      && item.versionId === versionId && item.canonicalSnapshotHash === document.canonicalSnapshotHash);
  const generatedAt = projection?.generatedAt;
  const date = typeof generatedAt?.toDate === 'function' ? generatedAt.toDate()
    : typeof generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(generatedAt)
      ? new Date(generatedAt) : null;
  if (projection?.orgId !== orgId || projection.competence !== document.competence
    || projection.state !== 'SHADOW' || projection.dataQuality?.complete !== true
    || projection.dataQuality?.sourcePresent !== true || !proof
    || !(date instanceof Date) || !Number.isFinite(date.getTime())) return pending('PENDING_PROJECTION');
  const operationalComplete = completion?.orgId === orgId && completion.state === 'COMPLETE'
    && completion.documentId === id && completion.versionId === versionId
    && completion.sourceVersion === document.sourceVersion
    && completion.canonicalSnapshotHash === document.canonicalSnapshotHash;
  return {state:'FIRST_INGESTION_VERIFIED', firstIngestionVerified:true, operationalComplete,
    documentId:id, sourceVersion:document.sourceVersion, revision:document.revision, versionId,
    canonicalSnapshotHash:document.canonicalSnapshotHash, sourceSystem:document.source.system,
    verifiedAt:date.toISOString()};
}

export async function readInstallationReadiness(orgId: string,
  read: (path: string) => Promise<RecordData | null>, documentId?: string): Promise<InstallationReadiness> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(orgId)) throw new Error('INVALID_ORGANIZATION');
  if (documentId !== undefined && !validId(documentId)) throw new Error('INVALID_DOCUMENT_ID');
  const base = `organizations/${orgId}`;
  const [api, ingestion, projection, completion] = await Promise.all([
    read(`${base}/runtimeCheckpoints/integration-documents`),
    read(`${base}/runtimeCheckpoints/ingestion`),
    read(`${base}/dashboardSnapshots/current`),
    read(`${base}/runtimeCheckpoints/installation`)
  ]);
  // All candidate IDs are server-side readback or an opaque ID within this authenticated tenant.
  // Historical Drive receipts can be resolved through the existing projection without a new query.
  const projected = Array.isArray(projection?.integrationReadback)
    ? projection.integrationReadback.filter((item: RecordData) => validId(item.documentId))
      .map((item: RecordData) => item.documentId as string).sort() : [];
  const candidates = documentId ? [documentId] : [...new Set([
    ...(api?.orgId === orgId && api.state === 'HEALTHY' && validId(api.lastDocumentId) ? [api.lastDocumentId] : []),
    ...(ingestion?.orgId === orgId && ingestion.state === 'HEALTHY' && validId(ingestion.lastEntityId) ? [ingestion.lastEntityId] : []),
    ...(projection?.orgId === orgId ? projected : [])
  ])].slice(0,8);
  let result = installationReadiness(orgId, null, null, projection);
  for (const id of candidates) {
    const document = await read(`${base}/sourceDocuments/${id}`);
    const revision = document?.revision;
    const versionId = typeof document?.entityKey === 'string' && Number.isSafeInteger(revision) && revision >= 1
      ? immutableEntityVersionId('sourceDocument', document.entityKey, revision) : null;
    const version = versionId ? await read(`${base}/entityVersions/${versionId}`) : null;
    result = installationReadiness(orgId, {orgId,state:'HEALTHY',lastDocumentId:id},
      document, projection, version, completion);
    if (result.firstIngestionVerified) return result;
  }
  return result;
}
