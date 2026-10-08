/** First ingestion evidence in the existing tenant store; never a production release gate. */
type RecordData = Record<string, any>;
export type InstallationReadiness = {
  state: 'PENDING_SOURCE' | 'PENDING_CANONICAL_DATA' | 'PENDING_PROJECTION' | 'FIRST_INGESTION_VERIFIED';
  firstIngestionVerified: boolean;
  documentId: string | null;
  sourceVersion: number | null;
  verifiedAt: string | null;
};

export function installationReadiness(orgId: string, checkpoint: RecordData | null,
  document: RecordData | null, projection: RecordData | null): InstallationReadiness {
  const pending = (state: InstallationReadiness['state']): InstallationReadiness => ({
    state, firstIngestionVerified:false, documentId:null, sourceVersion:null, verifiedAt:null
  });
  const id = checkpoint?.lastDocumentId;
  if (checkpoint?.orgId !== orgId || checkpoint?.state !== 'HEALTHY'
    || typeof id !== 'string' || !/^[a-f0-9]{48}$/.test(id)) return pending('PENDING_SOURCE');
  if (document?.orgId !== orgId || document.nativeReady !== true || document.sourceIndependent !== true
    || document.revoked === true || document.deleted === true
    || document.externalFetchRequired !== false || document.sanitized !== true
    || document.workflowState !== 'VALIDATED' || document.documentFragility !== 'NONE'
    || document.missingFieldsCount !== 0 || !Number.isSafeInteger(document.sourceVersion)
    || document.sourceVersion < 1 || !/^[a-f0-9]{64}$/.test(document.canonicalSnapshotHash ?? '')
    || document.integration?.transport !== 'AURORA_INTEGRATION_API') return pending('PENDING_CANONICAL_DATA');
  const proof = Array.isArray(projection?.integrationReadback)
    && projection.integrationReadback.some((item: RecordData) => item.documentId === id
      && item.sourceVersion === document.sourceVersion
      && item.canonicalSnapshotHash === document.canonicalSnapshotHash);
  const generatedAt = projection?.generatedAt;
  const date = typeof generatedAt?.toDate === 'function' ? generatedAt.toDate() : new Date(generatedAt);
  if (projection?.orgId !== orgId || projection.competence !== document.competence
    || projection.state !== 'SHADOW' || projection.dataQuality?.complete !== true
    || projection.dataQuality?.sourcePresent !== true || !proof
    || !(date instanceof Date) || !Number.isFinite(date.getTime())) return pending('PENDING_PROJECTION');
  return {state:'FIRST_INGESTION_VERIFIED', firstIngestionVerified:true,
    documentId:id, sourceVersion:document.sourceVersion, verifiedAt:date.toISOString()};
}

export async function readInstallationReadiness(orgId: string,
  read: (path: string) => Promise<RecordData | null>): Promise<InstallationReadiness> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(orgId)) throw new Error('INVALID_ORGANIZATION');
  const base = `organizations/${orgId}`;
  const checkpoint = await read(`${base}/runtimeCheckpoints/integration-documents`);
  const id = checkpoint?.lastDocumentId;
  // Validate the server-side ID before constructing a document path; no tenant supplied by the browser.
  if (typeof id !== 'string' || !/^[a-f0-9]{48}$/.test(id)) return installationReadiness(orgId, checkpoint, null, null);
  const [document, projection] = await Promise.all([
    read(`${base}/sourceDocuments/${id}`), read(`${base}/dashboardSnapshots/current`)
  ]);
  return installationReadiness(orgId, checkpoint, document, projection);
}
