import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
import { canonicalIntegrationDocument, parseIntegrationDocumentPayload } from "./auroraIntegrationDocument.js";
import { loadInstallationReadiness, refreshProjection } from "./auroraRuntime.js";

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
      res.status(200).json({
        ok:true,
        credentials:snapshot.docs.map((doc) => {
          const data=doc.data();
          return {
            keyId:doc.id,
            name:data.name,
            scopes:Array.isArray(data.scopes)?data.scopes:[],
            active:data.active===true,
            expiresAt:timestampIso(data.expiresAt),
            createdAt:timestampIso(data.createdAt)
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
    if (action === "CREATE") {
      const name=typeof req.body?.name==="string"?req.body.name.trim():"";
      const scopes=normalizeScopes(req.body?.scopes);
      const days=Number(req.body?.expiresInDays ?? 90);
      if (!NAME_RE.test(name) || !scopes || !Number.isSafeInteger(days) || days < 1 || days > 365) {
        res.status(400).json({ok:false, code:"INVALID_INTEGRATION_KEY_REQUEST"});
        return;
      }
      const issued=issueIntegrationCredential(scopes, days);
      await collection.doc(issued.keyId).create({
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
      });
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
      if ((await ref.get()).exists) {
        res.status(409).json({ok:false, code:"KEY_ID_EXISTS"});
        return;
      }
      await ref.create({
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
      });
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
      const snap=await ref.get();
      if (!snap.exists) {
        res.status(404).json({ok:false, code:"KEY_NOT_FOUND"});
        return;
      }
      await ref.update({
        active:false,
        revokedAt:FieldValue.serverTimestamp(),
        revokedBy:member.uid
      });
      logger.info("Aurora integration credential revoked", {orgId:member.orgId,keyId});
      res.status(200).json({ok:true,keyId,revoked:true});
      return;
    }

    res.status(400).json({ok:false, code:"INVALID_ACTION"});
  }
);

export const auroraNexusIntegrationPing = onRequest({cors:false}, async (req,res) => {
  apiHeaders(res);
  if (req.method !== "GET") {
    res.set("Allow","GET");
    res.status(405).json({ok:false, code:"METHOD_NOT_ALLOWED"});
    return;
  }
  const principal=await verifyIntegrationBearer(req.get("authorization"), "integration.read");
  if (!principal) {
    res.status(401).json({ok:false, code:"INVALID_INTEGRATION_KEY"});
    return;
  }
  res.status(200).json({
    ok:true,
    service:"aurora-nexus-integration",
    orgId:principal.orgId,
    keyId:principal.keyId,
    connector:principal.name,
    installation:await loadInstallationReadiness(principal.orgId),
    time:new Date().toISOString()
  });
});


export const auroraNexusIntegrationDocuments = onRequest({cors:false}, async (req,res) => {
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
  const principal=await verifyIntegrationBearer(req.get("authorization"), "documents.ingest");
  if (!principal) {
    res.status(401).json({ok:false, code:"INVALID_INTEGRATION_KEY"});
    return;
  }
  const idempotencyKey=String(req.get("idempotency-key") || "");
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) {
    res.status(400).json({ok:false, code:"INVALID_IDEMPOTENCY_KEY"});
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

  const result=await auroraDb.runTransaction(async(tx)=>{
    const [orgSnap,idemSnap,currentSnap]=await Promise.all([
      tx.get(orgRef),tx.get(idemRef),tx.get(docRef)
    ]);
    if (!orgSnap.exists || orgSnap.data()?.active !== true) {
      return {kind:"ERROR" as const,code:"ORGANIZATION_DISABLED"};
    }
    if (idemSnap.exists) {
      if (idemSnap.data()?.bodyHash !== bodyHash) return {kind:"ERROR" as const,code:"IDEMPOTENCY_CONFLICT"};
      return {kind:"DUPLICATE" as const,documentId:String(idemSnap.data()?.documentId || canonical.id)};
    }
    const current=currentSnap.exists ? currentSnap.data() ?? {} : null;
    const currentVersion=current?.sourceVersion;
    if (typeof currentVersion === "number") {
      if (payload.sourceVersion < currentVersion) return {kind:"ERROR" as const,code:"SOURCE_VERSION_REGRESSION"};
      if (payload.sourceVersion === currentVersion) {
        if (current?.canonicalSnapshotHash !== canonical.canonicalSnapshotHash) {
          return {kind:"ERROR" as const,code:"SOURCE_VERSION_CONFLICT"};
        }
        tx.create(idemRef,{
          bodyHash,documentId:docRef.id,keyId:principal.keyId,
          createdAt:FieldValue.serverTimestamp()
        });
        return {kind:"DUPLICATE" as const,documentId:docRef.id};
      }
    }

    const facts=canonical.facts as Record<string,unknown>;
    const riskLevel=payload.documentFragility === "DEGRADED_EXTRACTION"
      || ["BLOCKED","FAILED"].includes(payload.workflowState) ? "HIGH"
      : payload.documentFragility !== "NONE" || !payload.nativeReady ? "MEDIUM" : "LOW";
    tx.set(docRef,{
      ...facts,
      orgId:principal.orgId,
      schemaVersion:1,
      entityType:"sourceDocument",
      entityKey:`${payload.sourceSystem}:${canonical.sourceIdHash.slice(0,32)}`,
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
        hashMethod:"canonical_structured_sha256"
      },
      integration:{
        keyId:principal.keyId,
        connector:principal.name,
        transport:"AURORA_INTEGRATION_API"
      },
      createdAt:current?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp()
    },{merge:true});
    tx.create(idemRef,{
      bodyHash,documentId:docRef.id,keyId:principal.keyId,
      sourceVersion:payload.sourceVersion,
      createdAt:FieldValue.serverTimestamp()
    });
    tx.create(auditRef,{
      orgId:principal.orgId,
      action:currentSnap.exists?"INTEGRATION_DOCUMENT_UPDATED":"INTEGRATION_DOCUMENT_CREATED",
      type:currentSnap.exists?"INTEGRATION_DOCUMENT_UPDATED":"INTEGRATION_DOCUMENT_CREATED",
      documentId:docRef.id,
      keyId:principal.keyId,
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
      lastSourceSystem:payload.sourceSystem,
      lastAcceptedAt:FieldValue.serverTimestamp(),
      acceptedCount:FieldValue.increment(1),
      updatedAt:FieldValue.serverTimestamp()
    },{merge:true});
    return {kind:"ACCEPTED" as const,documentId:docRef.id};
  });

  if (result.kind === "ERROR") {
    const status=["IDEMPOTENCY_CONFLICT","SOURCE_VERSION_REGRESSION","SOURCE_VERSION_CONFLICT"].includes(result.code)?409:412;
    res.status(status).json({ok:false,code:result.code});
    return;
  }
  // Resume the same native pipeline after a duplicate or an uncertain previous response.
  // A projection failure cannot turn an already committed document into a failed ingestion.
  try {
    await refreshProjection(principal.orgId, {uid:`integration:${principal.keyId}`, role:'integration', source:'INTEGRATION'});
  } catch {
    logger.warn('First ingestion projection pending', {orgId:principal.orgId, code:'PROJECTION_PENDING', sanitized:true});
  }
  res.status(result.kind === "DUPLICATE" ? 200 : 202).json({
    ok:true,
    accepted:result.kind === "ACCEPTED",
    duplicate:result.kind === "DUPLICATE",
    documentId:result.documentId,
    sourceSystem:payload.sourceSystem,
    sourceIndependent:payload.sourceIndependent,
    nativeReady:payload.nativeReady,
    installation:await loadInstallationReadiness(principal.orgId)
  });
});
