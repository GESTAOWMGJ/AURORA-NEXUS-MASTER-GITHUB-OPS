import { guardedCanonicalTransaction, WriterLeaseError } from "./auroraWriterGuardian.js";
import { workspaceConnectorReadback } from './auroraWorkspaceConnectors.js';
import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
  CSRF_PURPOSES,
  can,
  validCsrf,
  verifyAuroraAccess,
  type AuroraMember
} from "./auroraAccess.js";
import {
  credentialAllowsScope,
  issueIntegrationCredential,
  normalizeScopes,
  parseIntegrationApiKey,
  tokenHashMatches,
  type IntegrationScope
} from "./auroraIntegrationCredential.js";
import { auroraDb } from "./firebase.js";
import { acquisitionEvidenceHash, canonicalIntegrationDocument, integrationDocumentVersionDecision, parseIntegrationDocumentPayload } from "./auroraIntegrationDocument.js";
import { loadInstallationReadiness, refreshProjection } from "./auroraRuntime.js";
import { immutableEntityVersionId, nextCanonicalEntityRevision, persistedDocumentHash,
  mergedDocumentForAudit, stableValue } from "./auroraCanonicalVersions.js";
import { authorizeDocumentIngestion, canImportNativeDocuments, NATIVE_INGESTION_MAX_BYTES } from './auroraNativeIngestion.js';
import { ACTIVE_RELEASE_READ_PATH, createActiveReleaseReadHandler } from './auroraActiveReleaseRead.js';
import { ACTIVE_RELEASE_SOURCE } from './auroraActiveRelease.js';
import { readRuntimeActiveRelease } from './auroraActiveReleaseRuntime.js';
import { configureCanonicalAutomation, integrationReplayPatch,publicAutomationConfiguration } from './auroraInstallationAcceptance.js';
import { buildIntegrationRevalidationReceipt, isLegacyMinimalIntegrationReceipt,
  revalidationAuthorityActive } from './auroraIntegrationRevalidation.js';
import { DOCUMENT_OBSERVATION_OPERATION, DOCUMENT_OBSERVATION_SCHEMA,
  documentObservationBlocksFacts, parseDocumentObservationPayload, recordDocumentObservation } from './auroraDocumentObservation.js';

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const CSRF_HMAC_KEY = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_. -]{1,79}$/;
const KEY_ID_RE = /^ik_[a-f0-9]{16}$/;

function apiHeaders(res: any): void {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
}

function sameOrigin(req: {get(name:string):string|undefined}): boolean {
  const site = req.get("sec-fetch-site");
  return !site || site === "same-origin";
}

function jsonRequest(req: {get(name:string):string|undefined}): boolean {
  return String(req.get("content-type") || "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function timestampIso(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("toDate" in value)) return null;
  const toDate=(value as {toDate?:unknown}).toDate;
  if (typeof toDate !== "function") return null;
  const date=(toDate as () => Date).call(value);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function canManage(member: AuroraMember): boolean {
  return member.allFacilities
    && member.mfaVerified
    && can(member, "integrations.manage", ["platform_admin", "org_admin", "director"]);
}

async function memberOrReject(req: any, res: any): Promise<AuroraMember | null> {
  const member = await verifyAuroraAccess(req.get("cookie"), ALLOWED_EMAILS.value());
  if (!member) {
    res.status(401).json({ok:false, code:"AUTH_REQUIRED"});
    return null;
  }
  if (!canManage(member)) {
    res.status(403).json({ok:false, code:"MFA_AND_INTEGRATION_ADMIN_REQUIRED"});
    return null;
  }
  return member;
}

class IntegrationKeyMutationError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

async function guardedCredentialMutation<T>(member: AuroraMember, body: (tx: Transaction) => Promise<T>): Promise<T> {
  return guardedCanonicalTransaction(auroraDb, member.orgId, async tx => {
    const base = `organizations/${member.orgId}`;
    const [org, actor] = await Promise.all([tx.get(auroraDb.doc(base)), tx.get(auroraDb.doc(`${base}/members/${member.uid}`))]);
    const current = actor.data();
    if (org.data()?.active !== true || current?.active !== true
      || (current.onboardingRequired === true && current.onboardingState !== 'COMPLETE')
      || !canManage({...member, role: current.role, allFacilities: current.allFacilities === true,
        permissions: Array.isArray(current.permissions) ? current.permissions.filter((v: unknown): v is string => typeof v === 'string') : []})) {
      throw new IntegrationKeyMutationError('MEMBERSHIP_REVOKED', 403);
    }
    return body(tx);
  });
}

export async function verifyIntegrationBearer(
  authorization: unknown,
  requiredScope: IntegrationScope
): Promise<{orgId:string; keyId:string; name:string}|null> {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const parsed = parseIntegrationApiKey(authorization.slice(7).trim());
  if (!parsed) return null;

  const snapshots = await auroraDb.collectionGroup("integrationCredentials")
    .where("keyId", "==", parsed.keyId)
    .limit(2)
    .get();
  if (snapshots.size !== 1) return null;
  const snap = snapshots.docs[0];
  if (!snap) return null;
  const data = snap.data();
  if (!credentialAllowsScope(data, requiredScope) || !tokenHashMatches(parsed.apiKey, data.tokenHash)) return null;
  const orgId = typeof data.orgId === "string" ? data.orgId : "";
  const name = typeof data.name === "string" ? data.name : "";
  if (!orgId || !name) return null;
  return {orgId, keyId:parsed.keyId, name};
}

export const auroraNexusIntegrationKeys = onRequest(
  {cors:false, secrets:[ALLOWED_EMAILS, CSRF_HMAC_KEY]},
  async (req, res) => {
    apiHeaders(res);
    const member = await memberOrReject(req, res);
    if (!member) return;

    const collection = auroraDb.collection(`organizations/${member.orgId}/integrationCredentials`);

    if (req.method === "GET") {
      const snapshot = await collection.orderBy("createdAt", "desc").limit(100).get();
      const agents=await Promise.all(snapshot.docs.map(async credential=>{
        const report=await auroraDb.doc(`organizations/${member.orgId}/runtimeCheckpoints/client-agent-${credential.id}`).get();
        const data=report.data();
        if(!report.exists||data?.orgId!==member.orgId||data.keyId!==credential.id||data.component!=='client-agent')return null;
        const reportedAt=timestampIso(data.reportedAt);
        const active=credentialAllowsScope(credential.data()||{},'documents.ingest');
        return {keyId:credential.id,state:active&&reportedAt&&Date.now()-Date.parse(reportedAt)<180000
          ?'CONNECTED_REPORTED':'OFFLINE_OR_STALE',reportedAt,
          providers:Array.isArray(data.providers)?data.providers:[],pendingExtraction:data.pendingExtraction,
          connectionReported:true,physicalInstallationVerified:false};
      }));
      const manual = await auroraDb.doc(`organizations/${member.orgId}/runtimeCheckpoints/installation`).get();
      const manualBinding = manual.data()?.automation;
      res.status(200).json({
        ok:true,
        orgId:member.orgId,
        installation:await loadInstallationReadiness(member.orgId),
        agents:agents.filter(Boolean),
        workspaceConnectors:workspaceConnectorReadback(agents.filter((agent):agent is NonNullable<typeof agent>=>agent!==null)),
        manualAutomationRevision:manualBinding === undefined ? 0 : publicAutomationConfiguration(manualBinding)?.revision ?? null,
        credentials:snapshot.docs.map((doc) => {
          const data=doc.data();
          return {
            keyId:doc.id,
            name:data.name,
            scopes:Array.isArray(data.scopes)?data.scopes:[],
            active:data.active===true,
            expiresAt:timestampIso(data.expiresAt),
            createdAt:timestampIso(data.createdAt),
            automation:publicAutomationConfiguration(data.automation)
          };
        })
      });
      return;
    }

    if (req.method !== "POST") {
      res.set("Allow","GET, POST");
      res.status(405).json({ok:false, code:"METHOD_NOT_ALLOWED"});
      return;
    }
    if (!sameOrigin(req) || !jsonRequest(req)) {
      res.status(!sameOrigin(req)?403:415).json({ok:false, code:!sameOrigin(req)?"CROSS_SITE_REJECTED":"UNSUPPORTED_MEDIA_TYPE"});
      return;
    }
    if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"), CSRF_HMAC_KEY.value(), CSRF_PURPOSES.integrationKey)) {
      res.status(403).json({ok:false, code:"CSRF_REJECTED"});
      return;
    }

    const action=typeof req.body?.action==="string"?req.body.action:"";
    if (action === 'CONFIGURE_AUTOMATION') {
      if (req.get('origin') !== 'https://auroranexus.com.br' || req.get('sec-fetch-site') !== 'same-origin') {
        res.status(403).json({ok:false,code:'CROSS_SITE_REJECTED'});return;
      }
      try {
        const configured=await guardedCanonicalTransaction(auroraDb, member.orgId, async tx => configureCanonicalAutomation(member,req.body,{
          read:async path => {const value=await tx.get(auroraDb.doc(path));return value.exists ? value.data() ?? null : null;},
          create:(path,data)=>{tx.create(auroraDb.doc(path),data);},
          merge:(path,data)=>{tx.set(auroraDb.doc(path),data,{merge:true});}, timestamp:FieldValue.serverTimestamp()
        }));
        res.status(200).json({ok:true,...configured});
      } catch (error) {
        if (error instanceof WriterLeaseError) {res.status(503).json({ok:false,code:error.code});return;}
        const code=error instanceof Error ? error.message : '';
        const known=['INVALID_AUTOMATION_CONFIGURATION','ADAPTER_EVIDENCE_REQUIRED','AUTOMATION_PIPELINE_DISABLED',
          'AUTOMATION_CREDENTIAL_INACTIVE','AUTOMATION_CONFIGURATION_CONFLICT','MEMBERSHIP_REVOKED','MFA_AND_INTEGRATION_ADMIN_REQUIRED'];
        res.status(code==='INVALID_AUTOMATION_CONFIGURATION'?400:code==='AUTOMATION_CONFIGURATION_CONFLICT'?409:412)
          .json({ok:false,code:known.includes(code)?code:'AUTOMATION_CONFIGURATION_PENDING'});
      }
      return;
    }
    try {
    if (action === "CREATE") {
      const name=typeof req.body?.name==="string"?req.body.name.trim():"";
      const scopes=normalizeScopes(req.body?.scopes);
      const days=Number(req.body?.expiresInDays ?? 90);
      if (!NAME_RE.test(name) || !scopes || !Number.isSafeInteger(days) || days < 1 || days > 365) {
        res.status(400).json({ok:false, code:"INVALID_INTEGRATION_KEY_REQUEST"});
        return;
      }
      const issued=issueIntegrationCredential(scopes, days);
      await guardedCredentialMutation(member, async tx => { tx.create(collection.doc(issued.keyId), {
        schemaVersion:1,
        orgId:member.orgId,
        keyId:issued.keyId,
        name,
        scopes:issued.scopes,
        tokenHash:issued.tokenHash,
        tokenPrefix:`anx_${issued.keyId}`,
        active:true,
        createdBy:member.uid,
        createdAt:FieldValue.serverTimestamp(),
        expiresAt:Timestamp.fromDate(issued.expiresAt)
      }); });
      logger.info("Aurora integration credential issued", {orgId:member.orgId,keyId:issued.keyId,scopes:issued.scopes});
      res.status(201).json({
        ok:true,
        keyId:issued.keyId,
        apiKey:issued.apiKey,
        scopes:issued.scopes,
        expiresAt:issued.expiresAt.toISOString(),
        displayOnce:true
      });
      return;
    }

    if (action === "REGISTER_HASH") {
      const name=typeof req.body?.name==="string"?req.body.name.trim():"";
      const scopes=normalizeScopes(req.body?.scopes);
      const keyId=typeof req.body?.keyId==="string"?req.body.keyId:"";
      const tokenHash=typeof req.body?.tokenHash==="string"?req.body.tokenHash.toLowerCase():"";
      const expiresAtRaw=typeof req.body?.expiresAt==="string"?req.body.expiresAt:"";
      const expiresAt=new Date(expiresAtRaw);
      const now=Date.now();
      if (
        !NAME_RE.test(name)
        || !scopes
        || !KEY_ID_RE.test(keyId)
        || !/^[a-f0-9]{64}$/.test(tokenHash)
        || !Number.isFinite(expiresAt.getTime())
        || expiresAt.getTime() <= now
        || expiresAt.getTime() > now + 365 * 24 * 60 * 60 * 1000
      ) {
        res.status(400).json({ok:false, code:"INVALID_INTEGRATION_HASH_REGISTRATION"});
        return;
      }
      const ref=collection.doc(keyId);
      await guardedCredentialMutation(member, async tx => {
        if ((await tx.get(ref)).exists) throw new IntegrationKeyMutationError('KEY_ID_EXISTS', 409);
        tx.create(ref, {
        schemaVersion:1,
        orgId:member.orgId,
        keyId,
        name,
        scopes,
        tokenHash,
        tokenPrefix:`anx_${keyId}`,
        active:true,
        origin:"INSTALLER_HASH_REGISTRATION",
        createdBy:member.uid,
        createdAt:FieldValue.serverTimestamp(),
        expiresAt:Timestamp.fromDate(expiresAt)
      }); });
      logger.info("Aurora installer integration credential registered", {orgId:member.orgId,keyId,scopes});
      res.status(201).json({ok:true,keyId,scopes,expiresAt:expiresAt.toISOString(),registeredFromHash:true});
      return;
    }

    if (action === "REVOKE") {
      const keyId=typeof req.body?.keyId==="string"?req.body.keyId:"";
      if (!KEY_ID_RE.test(keyId)) {
        res.status(400).json({ok:false, code:"INVALID_KEY_ID"});
        return;
      }
      const ref=collection.doc(keyId);
      await guardedCredentialMutation(member, async tx => {
        const snap=await tx.get(ref);
        if (!snap.exists) throw new IntegrationKeyMutationError('KEY_NOT_FOUND', 404);
        if (snap.data()?.active === false) return; // Preserve the original revocation receipt on replay.
        tx.update(ref, {
        active:false,
        revokedAt:FieldValue.serverTimestamp(),
        revokedBy:member.uid
      }); });
      logger.info("Aurora integration credential revoked", {orgId:member.orgId,keyId});
      res.status(200).json({ok:true,keyId,revoked:true});
      return;
    }

    res.status(400).json({ok:false, code:"INVALID_ACTION"});
    } catch (error) {
      const known = error instanceof WriterLeaseError || error instanceof IntegrationKeyMutationError;
      res.status(known ? error.status : 503).json({ok:false, code:known ? error.code : 'INTEGRATION_KEY_MUTATION_PENDING'});
    }
  }
);

const readIntegrationActiveRelease = createActiveReleaseReadHandler({
  authorize: authorization => verifyIntegrationBearer(authorization, 'integration.read'),
  authorityActive: async principal => {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(principal.orgId) || !KEY_ID_RE.test(principal.keyId)) return false;
    const base = `organizations/${principal.orgId}`;
    const [org, credential] = await Promise.all([auroraDb.doc(base).get(),
      auroraDb.doc(`${base}/integrationCredentials/${principal.keyId}`).get()]);
    const data = credential.data();
    if (!org.exists || org.data()?.active !== true || !credential.exists || data?.orgId !== principal.orgId
        || !credentialAllowsScope(data, 'integration.read') || typeof data.createdBy !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/.test(data.createdBy)) return false;
    const member = await auroraDb.doc(`${base}/members/${data.createdBy}`).get(), issuer = member.data();
    return member.exists && issuer?.active === true && issuer.allFacilities === true
      && (['platform_admin', 'org_admin', 'director'].includes(issuer.role)
        || (Array.isArray(issuer.permissions) && issuer.permissions.includes('integrations.manage')));
  },
  publicKey: () => process.env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY,
  readFixedProtectedEnvelope: async () => {
    const snapshot = await auroraDb.doc(ACTIVE_RELEASE_SOURCE).get();
    return snapshot.exists ? snapshot.data() : undefined;
  },
  readRuntime: readRuntimeActiveRelease
});

export const auroraNexusIntegrationPing = onRequest({cors:false}, async (req,res) => {
  if (req.path === ACTIVE_RELEASE_READ_PATH) { await readIntegrationActiveRelease(req, res); return; }
  apiHeaders(res);
  if (!['GET','POST'].includes(req.method)) {
    res.set("Allow","GET, POST");
    res.status(405).json({ok:false, code:"METHOD_NOT_ALLOWED"});
    return;
  }
  const principal=await verifyIntegrationBearer(req.get("authorization"), req.method==='POST'?'documents.ingest':"integration.read");
  if (!principal) {
    res.status(401).json({ok:false, code:"INVALID_INTEGRATION_KEY"});
    return;
  }
  if(req.method==='POST'){
    const body=req.body;
    const providers=new Set(['GOOGLE_DRIVE','GMAIL','MICROSOFT_MAIL','IMAP','NOTION','SLACK']);
    if(!jsonRequest(req)||!body||typeof body!=='object'||Array.isArray(body)
      ||Buffer.byteLength(JSON.stringify(body))>4096
      ||Object.keys(body).some(key=>!['component','instanceId','pendingExtraction','providers'].includes(key))
      ||body.component!=='AURORA_CLIENT_AGENT'||!/^([a-f0-9]{32}|[a-f0-9-]{36})$/.test(body.instanceId||'')
      ||!Number.isSafeInteger(body.pendingExtraction)||body.pendingExtraction<0||body.pendingExtraction>10000
      ||!Array.isArray(body.providers)||body.providers.length>12
      ||body.providers.some((row:any)=>!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['provider','state','coverageLimited'].includes(k))
        ||!providers.has(row.provider)||!['READ_CONFIRMED','CONNECTION_PENDING'].includes(row.state)
        ||(row.coverageLimited!==undefined&&typeof row.coverageLimited!=='boolean'))){
      res.status(400).json({ok:false,code:'INVALID_AGENT_REPORT'});return;
    }
    const base=`organizations/${principal.orgId}`;
    const accepted=await guardedCanonicalTransaction(auroraDb, principal.orgId, async tx=>{
      const org=await tx.get(auroraDb.doc(base));
      const credential=await tx.get(auroraDb.doc(`${base}/integrationCredentials/${principal.keyId}`));
      if(!org.exists||org.data()?.active!==true||!credential.exists||!credentialAllowsScope(credential.data()||{},'documents.ingest'))return false;
      tx.set(auroraDb.doc(`${base}/runtimeCheckpoints/client-agent-${principal.keyId}`),{
        orgId:principal.orgId,keyId:principal.keyId,component:'client-agent',
        instanceHash:createHash('sha256').update(principal.orgId+':'+body.instanceId).digest('hex'),
        pendingExtraction:body.pendingExtraction,providers:body.providers,
        reportedAt:FieldValue.serverTimestamp(),physicalInstallationVerified:false
      },{merge:true});return true;
    }).catch((error: unknown) => {
      if (error instanceof WriterLeaseError) return {leaseError:error.code};
      throw error;
    });
    if (typeof accepted === 'object') {res.status(503).json({ok:false,code:accepted.leaseError});return;}
    res.status(accepted?200:412).json(accepted?{ok:true,orgId:principal.orgId,reportAccepted:true,physicalInstallationVerified:false}
      :{ok:false,code:'ORGANIZATION_DISABLED'});return;
  }
  const documentId=req.query?.documentId;
  if (documentId !== undefined && (typeof documentId !== 'string' || !/^[a-f0-9]{48}$/.test(documentId))) {
    res.status(400).json({ok:false,code:'INVALID_DOCUMENT_ID'}); return;
  }
  const receiptId=req.query?.receiptId;
  if (receiptId!==undefined && (typeof receiptId!=='string' || !/^[a-f0-9]{64}$/.test(receiptId) || documentId===undefined)) {
    res.status(400).json({ok:false,code:'INVALID_RECEIPT_SELECTION'}); return;
  }
  res.status(200).json({
    ok:true,
    service:"aurora-nexus-integration",
    orgId:principal.orgId,
    keyId:principal.keyId,
    connector:principal.name,
    installation:await loadInstallationReadiness(principal.orgId, documentId,
      receiptId!==undefined ? {receiptId,keyId:principal.keyId} : undefined),
    time:new Date().toISOString()
  });
});


export const auroraNexusIntegrationDocuments = onRequest({cors:false, secrets:[ALLOWED_EMAILS, CSRF_HMAC_KEY], timeoutSeconds:120}, async (req,res) => {
  apiHeaders(res);
  if (req.method !== "POST") {
    res.set("Allow","POST");
    res.status(405).json({ok:false, code:"METHOD_NOT_ALLOWED"});
    return;
  }
  if (!jsonRequest(req)) {
    res.status(415).json({ok:false, code:"UNSUPPORTED_MEDIA_TYPE"});
    return;
  }
  const access=await authorizeDocumentIngestion(req, {
    bearer:authorization=>verifyIntegrationBearer(authorization, 'documents.ingest'),
    session:cookie=>verifyAuroraAccess(cookie, ALLOWED_EMAILS.value()),
    csrf:(cookie,token)=>validCsrf(cookie,token,CSRF_HMAC_KEY.value(),CSRF_PURPOSES.documentIngest)
  });
  if ('code' in access) {res.status(access.status).json({ok:false,code:access.code});return;}
  const principal=access.principal;
  if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > NATIVE_INGESTION_MAX_BYTES) {
    res.status(413).json({ok:false,code:'DOCUMENT_PAYLOAD_TOO_LARGE'});return;
  }
  const idempotencyKey=String(req.get("idempotency-key") || "");
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) {
    res.status(400).json({ok:false, code:"INVALID_IDEMPOTENCY_KEY"});
    return;
  }
  if (req.body?.operation===DOCUMENT_OBSERVATION_OPERATION || req.body?.schemaVersion===DOCUMENT_OBSERVATION_SCHEMA) {
    const observation=parseDocumentObservationPayload(req.body);
    if (!observation) {res.status(400).json({ok:false,code:'INVALID_DOCUMENT_OBSERVATION'});return;}
    try {
      const recorded=await guardedCanonicalTransaction(auroraDb, principal.orgId, tx=>recordDocumentObservation(principal,observation,idempotencyKey,{
        read:async path=>{const snap=await tx.get(auroraDb.doc(path));return snap.exists ? snap.data() ?? null : null;},
        create:(path,data)=>{tx.create(auroraDb.doc(path),data);},
        replace:(path,data)=>{tx.set(auroraDb.doc(path),data);},timestamp:FieldValue.serverTimestamp()
      }));
      // Refresh the same projection after replacing a prior snapshot with pending
      // evidence. Observation receipts never enter installation acceptance.
      try {await refreshProjection(principal.orgId,{uid:`integration:${principal.keyId}`,role:'integration',source:'INTEGRATION'});}
      catch {logger.warn('Document observation projection pending',{orgId:principal.orgId,code:'PROJECTION_PENDING',sanitized:true});}
      res.status(recorded.kind==='DUPLICATE'?200:202).json({ok:true,...recorded,
        recorded:recorded.kind==='RECORDED',duplicate:recorded.kind==='DUPLICATE',accepted:false});
    } catch (error) {
      if (error instanceof WriterLeaseError) {res.status(503).json({ok:false,code:error.code});return;}
      const code=error instanceof Error ? error.message : '';
      const conflicts=['IDEMPOTENCY_CONFLICT','OBSERVATION_SUPERSEDED','OBSERVATION_CAS_CONFLICT','OBSERVATION_BINDING_CONFLICT',
        'SOURCE_ACQUISITION_CONFLICT','SOURCE_ACQUISITION_REGRESSION','ENTITY_REVISION_CONFLICT','ENTITY_VERSION_CONFLICT'];
      const invalid=['INVALID_DOCUMENT_OBSERVATION','INVALID_OBSERVATION_CONTEXT'];
      const authority=['ORGANIZATION_DISABLED','MEMBERSHIP_REVOKED','INVALID_INTEGRATION_KEY','CREDENTIAL_AUTHORITY_INACTIVE'];
      const known=[...conflicts,...invalid,...authority].includes(code);
      res.status(conflicts.includes(code)?409:invalid.includes(code)?400:known?412:503)
        .json({ok:false,code:known?code:'DOCUMENT_OBSERVATION_PENDING'});
    }
    return;
  }
  const payload=parseIntegrationDocumentPayload(req.body);
  if (!payload) {
    res.status(400).json({ok:false, code:"INVALID_DOCUMENT_PAYLOAD"});
    return;
  }
  const canonical=canonicalIntegrationDocument(principal.orgId,payload);
  const bodyHash=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const idemId=createHash("sha256")
    .update(`integration-document:${principal.keyId}:${idempotencyKey}`)
    .digest("hex");
  const base=`organizations/${principal.orgId}`;
  const orgRef=auroraDb.doc(base);
  const docRef=auroraDb.doc(`${base}/sourceDocuments/${canonical.id}`);
  const idemRef=auroraDb.doc(`${base}/apiIdempotency/${idemId}`);
  const auditRef=auroraDb.doc(`${base}/auditEvents/integration-document-${idemId.slice(0,40)}`);
  const checkpointRef=auroraDb.doc(`${base}/runtimeCheckpoints/integration-documents`);

  const result=await guardedCanonicalTransaction(auroraDb, principal.orgId, async(tx)=>{
    const [orgSnap,idemSnap,currentSnap]=await Promise.all([
      tx.get(orgRef),tx.get(idemRef),tx.get(docRef)
    ]);
    if (!orgSnap.exists || orgSnap.data()?.active !== true) {
      return {kind:"ERROR" as const,code:"ORGANIZATION_DISABLED"};
    }
    if (principal.member) {
      const membership=await tx.get(auroraDb.doc(`${base}/members/${principal.member.uid}`));
      const current=membership.data();
      if (!membership.exists || current?.active !== true || !canImportNativeDocuments({
        ...principal.member,role:String(current.role),allFacilities:current.allFacilities===true,
        permissions:Array.isArray(current.permissions)?current.permissions:[]
      })) return {kind:'ERROR' as const,code:'MEMBERSHIP_REVOKED'};
    }
    // The initial bearer check precedes this transaction. Recheck revocation,
    // expiry and tenant binding in the same snapshot that may write a receipt.
    const credential=principal.member ? null
      : (await tx.get(auroraDb.doc(`${base}/integrationCredentials/${principal.keyId}`))).data() ?? null;
    if (!principal.member && (credential?.orgId!==principal.orgId || credential.keyId!==principal.keyId
      || !credentialAllowsScope(credential,'documents.ingest'))) return {kind:'ERROR' as const,code:'INVALID_INTEGRATION_KEY'};
    const issuer=credential && typeof credential.createdBy==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(credential.createdBy)
      ? (await tx.get(auroraDb.doc(`${base}/members/${credential.createdBy}`))).data() ?? null : null;
    const configuredBy=credential?.automation?.configuredBy;
    const configurer=typeof configuredBy==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(configuredBy)
      ? configuredBy===credential?.createdBy ? issuer
        : (await tx.get(auroraDb.doc(`${base}/members/${configuredBy}`))).data() ?? null : null;
    const authority={org:orgSnap.data() ?? null,credential,issuer,configurer};
    // Neither a historical v1 receipt nor a higher factual sourceVersion may
    // erase a pending content observation. Promotion requires a separate review.
    if (documentObservationBlocksFacts(currentSnap.data() ?? null)) {
      return {kind:'ERROR' as const,code:'DOCUMENT_OBSERVATION_PENDING_REVIEW'};
    }
    if (idemSnap.exists) {
      if (idemSnap.data()?.bodyHash !== bodyHash) return {kind:"ERROR" as const,code:"IDEMPOTENCY_CONFLICT"};
      const current=currentSnap.data() ?? null;
      const receipt=idemSnap.data() ?? null;
      const minimal=isLegacyMinimalIntegrationReceipt(receipt,principal,bodyHash,canonical.id);
      const storedVersionId=receipt?.versionId ?? (minimal && typeof current?.entityKey==='string'
        && Number.isSafeInteger(current.revision) && current.revision>=1
        ? immutableEntityVersionId('sourceDocument',current.entityKey,current.revision) : null);
      const storedVersion=typeof storedVersionId==='string' && /^[a-f0-9]{48}$/.test(storedVersionId)
        ? await tx.get(auroraDb.doc(`${base}/entityVersions/${storedVersionId}`)) : null;
      const version=storedVersion?.exists ? {...storedVersion.data(),_readVersionId:storedVersionId} : null;
      const originalReceiptId=storedVersion?.data()?.idempotencyId;
      const originalData=(minimal || receipt?.revalidation!==undefined) && typeof originalReceiptId==='string'
        && /^[a-f0-9]{64}$/.test(originalReceiptId)
        ? (await tx.get(auroraDb.doc(`${base}/apiIdempotency/${originalReceiptId}`))).data() ?? null : null;
      const original=originalData ? {...originalData,_readReceiptId:originalReceiptId} : null;
      if (minimal && !principal.member) {
        const upgraded=buildIntegrationRevalidationReceipt({orgId:principal.orgId,principal,receiptId:idemId,
          documentId:canonical.id,document:current,version,originalReceipt:original,bodyHash,
          timestamp:FieldValue.serverTimestamp(),authority});
        if (!upgraded) return {kind:'ERROR' as const,code:'REVALIDATION_BINDING_CONFLICT'};
        tx.set(idemRef,upgraded); // First validated POST upgrades metadata, never counts as replay.
        return {kind:'DUPLICATE' as const,documentId:canonical.id,revalidation:true};
      }
      if (receipt?.revalidation!==undefined && !revalidationAuthorityActive(principal.orgId,principal.keyId,authority,undefined,current?.source?.system)) {
        return {kind:'ERROR' as const,code:'REVALIDATION_AUTHORITY_INACTIVE'};
      }
      const replay=integrationReplayPatch(principal.orgId,principal,receipt,current,version,
        bodyHash,canonical.id,FieldValue.serverTimestamp(),{receiptId:idemId,originalReceipt:original});
      if (receipt?.revalidation!==undefined && !replay) return {kind:'ERROR' as const,code:'REVALIDATION_BINDING_CONFLICT'};
      if(replay) tx.set(idemRef,replay,{merge:true});
      return {kind:"DUPLICATE" as const,documentId:String(receipt?.documentId || canonical.id),
        revalidation:receipt?.revalidation!==undefined};
    }
    const current=currentSnap.exists ? currentSnap.data() ?? {} : null;
    const versionDecision=integrationDocumentVersionDecision(current,payload,canonical.canonicalSnapshotHash,bodyHash,timestampIso(current?.occurredAt));
    if (versionDecision !== 'UPDATE') {
      if (versionDecision === 'DUPLICATE') {
        if (!principal.member) {
          const versionId=typeof current?.entityKey==='string' && Number.isSafeInteger(current.revision) && current.revision>=1
            ? immutableEntityVersionId('sourceDocument',current.entityKey,current.revision) : null;
          const versionSnap=versionId ? await tx.get(auroraDb.doc(`${base}/entityVersions/${versionId}`)) : null;
          const originalReceiptId=versionSnap?.data()?.idempotencyId;
          const originalData=typeof originalReceiptId==='string' && /^[a-f0-9]{64}$/.test(originalReceiptId)
            ? (await tx.get(auroraDb.doc(`${base}/apiIdempotency/${originalReceiptId}`))).data() ?? null : null;
          const original=originalData ? {...originalData,_readReceiptId:originalReceiptId} : null;
          const receipt=buildIntegrationRevalidationReceipt({orgId:principal.orgId,principal,receiptId:idemId,
            documentId:canonical.id,document:current,
            version:versionSnap?.exists ? {...versionSnap.data(),_readVersionId:versionId} : null,
            originalReceipt:original,bodyHash,timestamp:FieldValue.serverTimestamp(),authority});
          if (!receipt) return {kind:'ERROR' as const,code:'REVALIDATION_BINDING_CONFLICT'};
          tx.create(idemRef,receipt);
          return {kind:'DUPLICATE' as const,documentId:docRef.id,revalidation:true};
        }
        tx.create(idemRef,{
          bodyHash,documentId:docRef.id,keyId:principal.keyId,
          createdAt:FieldValue.serverTimestamp()
        });
        return {kind:"DUPLICATE" as const,documentId:docRef.id};
      }
      return {kind:'ERROR' as const,code:versionDecision};
    }

    const facts=canonical.facts as Record<string,unknown>;
    const riskLevel=payload.documentFragility === "DEGRADED_EXTRACTION"
      || ["BLOCKED","FAILED"].includes(payload.workflowState) ? "HIGH"
      : payload.documentFragility !== "NONE" || !payload.nativeReady ? "MEDIUM" : "LOW";
    const revision=nextCanonicalEntityRevision(current?.revision);
    if (revision === null) return {kind:"ERROR" as const,code:"ENTITY_REVISION_CONFLICT"};
    const entityKey=`${payload.sourceSystem}:${canonical.sourceIdHash.slice(0,32)}`;
    const versionId=immutableEntityVersionId("sourceDocument",entityKey,revision);
    const versionRef=auroraDb.doc(`${base}/entityVersions/${versionId}`);
    if ((await tx.get(versionRef)).exists) return {kind:"ERROR" as const,code:"ENTITY_VERSION_CONFLICT"};
    const patch={
      ...facts,
      orgId:principal.orgId,
      schemaVersion:1,
      entityType:"sourceDocument",
      entityKey,
      revision,
      sourceVersion:payload.sourceVersion,
      occurredAt:Timestamp.fromDate(new Date(payload.occurredAt)),
      competence:payload.competence,
      documentType:payload.documentType,
      workflowState:payload.workflowState,
      reviewState:"NOT_REQUIRED",
      riskLevel,
      sensitivity:"RESTRICTED",
      canonicalSnapshotHash:canonical.canonicalSnapshotHash,
      source:{
        system:payload.sourceSystem,
        sourceId:`external:${canonical.sourceIdHash.slice(0,32)}`,
        contentHash:canonical.canonicalSnapshotHash,
        hashMethod:"canonical_structured_sha256",
        // The byte hash attests the client-observed acquired representation;
        // contentHash above remains the canonical facts hash for compatibility.
        acquisition:payload.sourceEvidence ?? null,
        acquisitionHash:payload.sourceEvidence ? acquisitionEvidenceHash(payload.sourceEvidence) : null,
        acquisitionAuthority:payload.sourceEvidence ? 'AUTHENTICATED_CLIENT_OBSERVATION_NOT_PROVIDER_SIGNATURE' : null
      },
      integration:{
        keyId:principal.keyId,
        connector:principal.name,
        transport:principal.member ? 'AURORA_NATIVE_SESSION_IMPORT' : "AURORA_INTEGRATION_API",
        payloadHash:bodyHash
      },
      createdAt:current?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp()
    };
    const beforeHash=current ? persistedDocumentHash(null,current) : null;
    const afterHash=persistedDocumentHash(current,patch);
    tx.set(docRef,patch,{merge:true});
    tx.create(versionRef,{
      orgId:principal.orgId, schemaVersion:1, entityType:"sourceDocument", entityId:docRef.id,
      entityKey, revision, sourceVersion:payload.sourceVersion, idempotencyId:idemId,
      source:patch.source, actor:principal.member ? {uid:principal.member.uid,role:principal.member.role}
        : {keyId:principal.keyId, connector:principal.name}, beforeHash,afterHash,
      snapshot:stableValue(mergedDocumentForAudit(current,patch)),
      occurredAt:patch.occurredAt, createdAt:FieldValue.serverTimestamp()
    });
    tx.create(idemRef,{
      schemaVersion:'aurora.ingestion.receipt.v1',orgId:principal.orgId,
      bodyHash,documentId:docRef.id,keyId:principal.keyId,
      sourceVersion:payload.sourceVersion,
      versionId, revision,canonicalSnapshotHash:canonical.canonicalSnapshotHash,
      acceptedAt:FieldValue.serverTimestamp(),replayCount:0,
      createdAt:FieldValue.serverTimestamp()
    });
    tx.create(auditRef,{
      orgId:principal.orgId,
      action:currentSnap.exists?"INTEGRATION_DOCUMENT_UPDATED":"INTEGRATION_DOCUMENT_CREATED",
      type:currentSnap.exists?"INTEGRATION_DOCUMENT_UPDATED":"INTEGRATION_DOCUMENT_CREATED",
      documentId:docRef.id,
      versionId, revision, beforeHash, afterHash,
      keyId:principal.keyId,
      ...(principal.member ? {actorUid:principal.member.uid,transport:'AURORA_NATIVE_SESSION_IMPORT'} : {}),
      sourceSystem:payload.sourceSystem,
      sourceVersion:payload.sourceVersion,
      canonicalSnapshotHash:canonical.canonicalSnapshotHash,
      occurredAt:FieldValue.serverTimestamp(),
      sanitized:true,
      sensitivity:"INTERNAL"
    });
    tx.set(checkpointRef,{
      orgId:principal.orgId,
      component:"integration-documents",
      state:"HEALTHY",
      lastDocumentId:docRef.id,
      lastVersionId:versionId, lastRevision:revision, lastSourceVersion:payload.sourceVersion,
      lastSourceSystem:payload.sourceSystem,
      lastAcceptedAt:FieldValue.serverTimestamp(),
      acceptedCount:FieldValue.increment(1),
      updatedAt:FieldValue.serverTimestamp()
    },{merge:true});
    return {kind:"ACCEPTED" as const,documentId:docRef.id};
  }).catch((error: unknown) => {
    if (error instanceof WriterLeaseError) return {kind:"ERROR" as const,code:error.code,leaseDenied:true};
    throw error;
  });

  if (result.kind === "ERROR") {
    const status="leaseDenied" in result ? 503 : ["IDEMPOTENCY_CONFLICT","SOURCE_VERSION_REGRESSION","SOURCE_VERSION_CONFLICT","SOURCE_ACQUISITION_REGRESSION","SOURCE_ACQUISITION_CONFLICT","DOCUMENT_OBSERVATION_PENDING_REVIEW"].includes(result.code)?409:412;
    res.status(status).json({ok:false,code:result.code});
    return;
  }
  // Resume the same native pipeline after a duplicate or an uncertain previous response.
  // A projection failure cannot turn an already committed document into a failed ingestion.
  if (!('revalidation' in result && result.revalidation)) {
    try {
      await refreshProjection(principal.orgId, {uid:`integration:${principal.keyId}`, role:'integration', source:'INTEGRATION'});
    } catch {
      logger.warn('First ingestion projection pending', {orgId:principal.orgId, code:'PROJECTION_PENDING', sanitized:true});
    }
  }
  res.status(result.kind === "DUPLICATE" ? 200 : 202).json({
    ok:true,
    orgId:principal.orgId,
    accepted:result.kind === "ACCEPTED",
    duplicate:result.kind === "DUPLICATE",
    documentId:result.documentId,
    receiptId:idemId,
    sourceSystem:payload.sourceSystem,
    sourceIndependent:payload.sourceIndependent,
    nativeReady:payload.nativeReady,
    sourceVersion:payload.sourceVersion,
    canonicalSnapshotHash:canonical.canonicalSnapshotHash,
    ...(payload.sourceEvidence ? {sourceEvidenceHash:acquisitionEvidenceHash(payload.sourceEvidence)} : {}),
    installation:await loadInstallationReadiness(principal.orgId, canonical.id,
      principal.member ? undefined : {receiptId:idemId,keyId:principal.keyId})
  });
});
