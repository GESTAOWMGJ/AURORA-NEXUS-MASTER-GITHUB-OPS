import { guardedCanonicalTransaction, WriterLeaseError } from "./auroraWriterGuardian.js";
import { randomBytes, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { auroraDb } from "./firebase.js";
import { csrfTokenForSession, validCsrf, verifyAuroraAccess, CSRF_PURPOSES, type AuroraMember } from "./auroraAccess.js";
import { medicalPartnerAdminPage, medicalPartnerPublicPage } from "./auroraMedicalPartnerView.js";
import {
  CREDMED_SCHEMA, CREDMED_INVITATION_TTL_MS, CREDMED_MAX_DOCUMENTS,
  CredentialError, medicalCredentialReadiness, sha256, validInvitationToken,
  validateMedicalApplication, validateMedicalAttachment
} from "./auroraMedicalPartnerPolicy.js";

const allowedEmails = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const csrfSecret = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
const ORG = "wmgj";  // Only the issuing operator's organization; no cross-tenant fallback.
const ORIGINS = new Set([
  "https://auroranexus.com.br",
  "https://wmgj-hml-jfn-20260927.web.app",
  "https://wmgj-prod-jfn-20261005.web.app"
]);
const COLLECTION = "medicalPartnerApplications";
const INVITES = "medicalPartnerInvitations";
const iso = (time: number) => new Date(time).toISOString();
const nowMs = () => Date.now();
function apiHeaders(res: { set(name: string, value: string): unknown }): void {
  res.set("Cache-Control", "no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; form-action 'self'");
}
const storageBucket = () => {
  const name = process.env.AURORA_MEDICAL_PARTNERS_BUCKET || "";
  // Never fall back to a default/public bucket, GCF source bucket, or another tenant.
  if (!/^wmgj-(hml|prod)-jfn-[0-9]{8}-medical-partners$/.test(name)) throw new CredentialError("PRIVATE_STORAGE_NOT_CONFIGURED", 503);
  return name;
};
const basePath = "organizations/" + ORG + "/";
const errors = (e: unknown) => e instanceof CredentialError
  ? { status: e.httpStatus, code: e.code }
  : { status: 503, code: e instanceof WriterLeaseError ? e.code : "CREDENTIALING_UNAVAILABLE" };
const isAdmin = (m: AuroraMember | null): m is AuroraMember => !!m && m.orgId === ORG && m.allFacilities
  && m.mfaVerified && ["org_admin","platform_admin","director"].includes(m.role);
function browserOriginValid(req: { get(name: string): string | undefined }): boolean {
  const origin = String(req.get("origin") || "");
  const fetchSite = String(req.get("sec-fetch-site") || "same-origin");
  return ORIGINS.has(origin) && (fetchSite === "same-origin" || fetchSite === "none");
}
function isJson(req: { get(name: string): string | undefined }) {
  return String(req.get("content-type") || "").split(";",1)[0]?.trim().toLowerCase() === "application/json";
}
async function organizationReady() {
  const org = await auroraDb.doc("organizations/" + ORG).get();
  if (!org.exists || org.data()?.active !== true || (org.data()?.medicalPartnersEnabled !== true || org.data()?.medicalPartnersPrivacyApproved !== true))
    throw new CredentialError("PRE_CREDENTIALING_NOT_ENABLED", 503);
  storageBucket();
}
async function locateInvitation(token: unknown) {
  if (!validInvitationToken(token)) throw new CredentialError("INVALID_OR_EXPIRED_INVITATION", 403);
  const snaps = await auroraDb.collection(basePath + INVITES).where("tokenHash","==",sha256(token)).limit(2).get();
  if (snaps.docs.length !== 1) throw new CredentialError("INVALID_OR_EXPIRED_INVITATION", 403);
  const ref = snaps.docs[0]!.ref;
  const current = snaps.docs[0]!.data();
  if (typeof current.expiresAtIso !== "string" || !Number.isFinite(Date.parse(current.expiresAtIso)) || Date.parse(current.expiresAtIso) < nowMs()
    || !["INVITED","SUBMITTED"].includes(current.state))
    throw new CredentialError("INVALID_OR_EXPIRED_INVITATION", 403);
  return ref;
}
function requestIsCurrentInvitation(data: Record<string,unknown> | undefined, state: string) {
  if (!data || data.state !== state || typeof data.expiresAtIso !== "string" || !Number.isFinite(Date.parse(data.expiresAtIso)) || Date.parse(data.expiresAtIso) < nowMs()) {
    throw new CredentialError("INVALID_OR_EXPIRED_INVITATION", 403);
  }
}
async function issueInvitation(actor: AuroraMember) {
  await organizationReady();
  const token = randomBytes(32).toString("base64url");
  const invitationId = randomUUID();
  const createdAt = nowMs();
  await guardedCanonicalTransaction(auroraDb, ORG, async tx => {
    const org = await tx.get(auroraDb.doc("organizations/" + ORG));
    if (org.data()?.active !== true || org.data()?.medicalPartnersEnabled !== true || org.data()?.medicalPartnersPrivacyApproved !== true) throw new CredentialError("PRE_CREDENTIALING_NOT_ENABLED",503);
    tx.create(auroraDb.doc(basePath + INVITES + "/" + invitationId), {
    schemaVersion: CREDMED_SCHEMA, orgId: ORG, tokenHash: sha256(token),
    state: "INVITED", createdAtIso: iso(createdAt), expiresAtIso: iso(createdAt + CREDMED_INVITATION_TTL_MS),
    issuedByUid: actor.uid, applicationId: null
    });
  });
  return { ok: true, invitationUrl: "https://auroranexus.com.br/wmgj/medicos#convite=" + token,
    expiresAtIso: iso(createdAt + CREDMED_INVITATION_TTL_MS) };
}
async function submitApplication(body: Record<string, unknown>) {
  await organizationReady();
  if (Object.keys(body).some(k => !["action","token","application"].includes(k))) throw new CredentialError("UNEXPECTED_SUBMISSION_FIELD");
  const profile = validateMedicalApplication(body.application);
  const fingerprint = sha256(JSON.stringify(profile));
  const inviteRef = await locateInvitation(body.token);
  const applicationId = sha256("aurora-credmed-application-v1:" + ORG + ":" + inviteRef.id);
  const applicationRef = auroraDb.doc(basePath + COLLECTION + "/" + applicationId);
  const state = await guardedCanonicalTransaction(auroraDb, ORG, async tx => {
    const [invite, application, org] = await Promise.all([
      tx.get(inviteRef), tx.get(applicationRef), tx.get(auroraDb.doc("organizations/" + ORG))
    ]);
    if (org.data()?.active !== true || (org.data()?.medicalPartnersEnabled !== true || org.data()?.medicalPartnersPrivacyApproved !== true)) throw new CredentialError("PRE_CREDENTIALING_NOT_ENABLED", 503);
    const invitation = invite.data();
    if (!invitation || invitation.tokenHash !== sha256(String(body.token))) throw new CredentialError("INVALID_OR_EXPIRED_INVITATION", 403);
    if (invitation.state === "SUBMITTED" && invitation.applicationId === applicationId
        && application.data()?.profileFingerprint === fingerprint) return "ALREADY_SUBMITTED";
    requestIsCurrentInvitation(invitation, "INVITED");
    if (application.exists) throw new CredentialError("APPLICATION_CONFLICT", 409);
    const createdAtIso = iso(nowMs());
    tx.create(applicationRef, {
      schemaVersion: CREDMED_SCHEMA, orgId: ORG, profile, profileFingerprint: fingerprint,
      status: "PENDING_DOCUMENTS_AND_CRM_REVIEW", documentCount: 0, receivedDocumentCount: 0,
      review: { crmVerified: false, specialtyVerified: false, documentsReviewed: false,
        mandatoryTrainingVerified: false, restricted: false },
      createdAtIso, createdAt: FieldValue.serverTimestamp(), modifiedAt: FieldValue.serverTimestamp(),
      invitationId: inviteRef.id
    });
    tx.update(inviteRef, { state: "SUBMITTED", applicationId, submittedAtIso: createdAtIso });
    tx.create(auroraDb.doc(basePath + "auditEvents/" + sha256("credmed:submit:" + applicationId)), {
      action: "CREDMED_PROFILE_RECEIVED", subject: applicationId, orgId: ORG, timestamp: FieldValue.serverTimestamp(),
      schemaVersion: CREDMED_SCHEMA, actor: "INVITED_APPLICANT", factualVerification: false
    });
    return "CREATED";
  });
  return { ok: true, applicationId, status: state === "CREATED" ? "PENDING_DOCUMENTS_AND_CRM_REVIEW" : "ALREADY_SUBMITTED" };
}
async function uploadDocument(body: Record<string, unknown>) {
  await organizationReady();
  if (Object.keys(body).some(k => !["action","token","document"].includes(k))) throw new CredentialError("UNEXPECTED_UPLOAD_FIELD");
  const attachment = validateMedicalAttachment(body.document);
  const inviteRef = await locateInvitation(body.token);
  const applicationId = sha256("aurora-credmed-application-v1:" + ORG + ":" + inviteRef.id);
  const applicationRef = auroraDb.doc(basePath + COLLECTION + "/" + applicationId);
  const documentId = sha256(attachment.kind + ":" + attachment.sha256);
  const documentRef = applicationRef.collection("documents").doc(documentId);
  const extension = attachment.mimeType === "application/pdf" ? ".pdf" : attachment.mimeType === "image/png" ? ".png" : ".jpg";
  const objectKey = "medical-partners/" + ORG + "/" + applicationId + "/" + documentId + extension;
  const reserved = await guardedCanonicalTransaction(auroraDb, ORG, async tx => {
    const [invite, application, existing, org] = await Promise.all([
      tx.get(inviteRef), tx.get(applicationRef), tx.get(documentRef), tx.get(auroraDb.doc("organizations/" + ORG))
    ]);
    if (org.data()?.active !== true || (org.data()?.medicalPartnersEnabled !== true || org.data()?.medicalPartnersPrivacyApproved !== true)) throw new CredentialError("PRE_CREDENTIALING_NOT_ENABLED", 503);
    if (invite.data()?.tokenHash !== sha256(String(body.token)) || invite.data()?.applicationId !== applicationId)
      throw new CredentialError("INVALID_OR_EXPIRED_INVITATION", 403);
    requestIsCurrentInvitation(invite.data(), "SUBMITTED");
    if (!application.exists || application.data()?.invitationId !== inviteRef.id) throw new CredentialError("APPLICATION_NOT_FOUND", 404);
    if (existing.exists) {
      if (existing.data()?.sha256 !== attachment.sha256 || existing.data()?.kind !== attachment.kind)
        throw new CredentialError("DOCUMENT_IDENTITY_CONFLICT", 409);
      return { duplicate: true, uploaded: existing.data()?.state === "RECEIVED_PENDING_SECURITY_REVIEW" };
    }
    if ((application.data()?.documentCount ?? 0) >= CREDMED_MAX_DOCUMENTS) throw new CredentialError("MAX_DOCUMENTS_REACHED", 409);
    tx.create(documentRef, {
      orgId: ORG, applicationId, documentId, kind: attachment.kind, sha256: attachment.sha256,
      mimeType: attachment.mimeType, sizeBytes: attachment.bytes.length,
      objectKey, state: "UPLOAD_PENDING", createdAt: FieldValue.serverTimestamp()
    });
    tx.update(applicationRef, { documentCount: FieldValue.increment(1), modifiedAt: FieldValue.serverTimestamp() });
    return { duplicate: false, uploaded: false };
  });
  if (reserved.uploaded) return {ok: true, documentId, status: "RECEIVED_PENDING_SECURITY_REVIEW", replay: true};
  const file = getStorage().bucket(storageBucket()).file(objectKey);
  try {
    await file.save(attachment.bytes, {
      resumable: false, validation: "crc32c", preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {contentType: attachment.mimeType, cacheControl: "private,no-store",
        metadata: { sha256: attachment.sha256, scope: "WMGJ_CREDMED_PRIVATE" }}
    });
  } catch (error) {
    // Retry only if bytes are provably already stored at this exact immutable key.
    const [exists] = await file.exists().catch(() => [false]);
    if (!exists) throw new CredentialError("PRIVATE_STORAGE_UPLOAD_FAILED", 503);
    const [meta] = await file.getMetadata().catch(() => [null]);
    if (!meta || meta.metadata?.sha256 !== attachment.sha256 || Number(meta.size) !== attachment.bytes.length)
      throw new CredentialError("PRIVATE_STORAGE_CONFLICT", 409);
  }
  await guardedCanonicalTransaction(auroraDb, ORG, async tx => {
    const [existing, app] = await Promise.all([tx.get(documentRef),tx.get(applicationRef)]);
    if (!existing.exists || existing.data()?.sha256 !== attachment.sha256 || !app.exists)
      throw new CredentialError("DOCUMENT_RECEIPT_CONFLICT", 409);
    if (existing.data()?.state !== "RECEIVED_PENDING_SECURITY_REVIEW") {
      tx.update(documentRef, { state: "RECEIVED_PENDING_SECURITY_REVIEW", receivedAt: FieldValue.serverTimestamp() });
      tx.update(applicationRef, { receivedDocumentCount: FieldValue.increment(1), modifiedAt: FieldValue.serverTimestamp() });
      tx.create(auroraDb.doc(basePath + "auditEvents/" + sha256("credmed:document:" + documentId + ":" + applicationId)), {
        action: "CREDMED_PRIVATE_DOCUMENT_RECEIPT", subject: applicationId, documentId, orgId: ORG,
        evidenceHash: attachment.sha256, timestamp: FieldValue.serverTimestamp(), factualVerification: false
      });
    }
  });
  return { ok: true, documentId, status: "RECEIVED_PENDING_SECURITY_REVIEW", replay: reserved.duplicate };
}
async function listApplications(actor: AuroraMember) {
  await organizationReady();
  const snap = await auroraDb.collection(basePath + COLLECTION).orderBy("createdAtIso","desc").limit(60).get();
  return { ok: true, applications: snap.docs.map(doc => {
    const data=doc.data(), profile=data.profile || {};
    const review=data.review || {};
    return { applicationId:doc.id, name:profile.fullName||"", crm:String(profile.crmNumber||"")+"/"+String(profile.crmState||""),
      specialty:profile.specialty||"", status: medicalCredentialReadiness({
        crmVerified:review.crmVerified===true,specialtyVerified:review.specialtyVerified===true,
        documentsReviewed:review.documentsReviewed===true, mandatoryTrainingVerified:review.mandatoryTrainingVerified===true,
        restricted:review.restricted===true
      }), documents: data.receivedDocumentCount || 0 };
  }), orgId:actor.orgId, truncationPossible:snap.size===60 };
}
export const auroraNexusMedicalPartners = onRequest(
  { cors: false, timeoutSeconds: 120, memory: "512MiB", secrets: [allowedEmails, csrfSecret] },
  async (req, res) => {
    apiHeaders(res);
    const path = String(req.path || "").split("?")[0];
    if (req.method === "GET" && path === "/wmgj/medicos") {
      res.type("html").status(200).send(medicalPartnerPublicPage()); return;
    }
    if (req.method === "GET" && (path === "/wmgj/medicos/gestao" || path === "/api/wmgj/medicos")) {
      const actor=await verifyAuroraAccess(req.get("cookie"),allowedEmails.value());
      if (!isAdmin(actor)) {res.status(403).json({ok:false,code:"WMGJ_ADMIN_MFA_REQUIRED"});return;}
      try {
        if (path === "/wmgj/medicos/gestao") {
          const token=csrfTokenForSession(req.get("cookie"),csrfSecret.value(),CSRF_PURPOSES.medicalPartner);
          if (!token) throw new CredentialError("CSRF_UNAVAILABLE",503);
          res.type("html").send(medicalPartnerAdminPage(token));
          return;
        }
        if (req.query.view !== "management") throw new CredentialError("INVALID_MANAGEMENT_VIEW");
        res.json(await listApplications(actor));return;
      } catch(e) {const error=errors(e);res.status(error.status).json({ok:false,code:error.code});return;}
    }
    if (req.method !== "POST" || path !== "/api/wmgj/medicos") {
      res.set("Allow", "GET, POST");res.status(404).json({ok:false,code:"ROUTE_NOT_FOUND"});return;
    }
    if (!isJson(req) || !browserOriginValid(req)) {res.status(403).json({ok:false,code:"ORIGIN_OR_CONTENT_TYPE_REJECTED"});return;}
    const body: Record<string,unknown> = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (JSON.stringify(body).length > 6_200_000) {res.status(413).json({ok:false,code:"PAYLOAD_TOO_LARGE"});return;}
    try {
      if (body.action === "ISSUE_INVITATION") {
        const actor=await verifyAuroraAccess(req.get("cookie"),allowedEmails.value());
        if (!isAdmin(actor)) throw new CredentialError("WMGJ_ADMIN_MFA_REQUIRED",403);
        if (!validCsrf(req.get("cookie"),req.get("x-aurora-csrf"),csrfSecret.value(),CSRF_PURPOSES.medicalPartner))
          throw new CredentialError("CSRF_REJECTED",403);
        if (Object.keys(body).length !== 1) throw new CredentialError("INVALID_INVITATION_REQUEST");
        res.json(await issueInvitation(actor));return;
      }
      if (body.action === "SUBMIT") {res.json(await submitApplication(body));return;}
      if (body.action === "UPLOAD") {res.json(await uploadDocument(body));return;}
      throw new CredentialError("UNKNOWN_CREDMED_ACTION");
    } catch(e) {
      const error=errors(e);res.status(error.status).json({ok:false,code:error.code});
    }
  }
);
