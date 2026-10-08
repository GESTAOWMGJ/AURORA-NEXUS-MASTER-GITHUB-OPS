import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { CSRF_PURPOSES, validCsrf, verifyAuroraAccess } from "./auroraAccess.js";
import { auroraAuth, auroraDb } from "./firebase.js";
import { createProfileEngine, type ProfileStore } from "./auroraUserProfiles.js";
import { ProfileError, profileAdmin } from "./auroraUserProfilePolicy.js";
import { createOnboardingInvitationEngine } from "./auroraOnboardingInvitations.js";

const allowedEmails = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const csrfSecret = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
export const profileStore: ProfileStore = {
  transaction: body => auroraDb.runTransaction(tx => body({
    read: async path => (await tx.get(auroraDb.doc(path))).data(),
    create: (path, data) => { tx.create(auroraDb.doc(path), data); },
    update: (path, data) => { tx.update(auroraDb.doc(path), data); }
  }))
};
const engine = createProfileEngine(profileStore, auroraAuth);
const invitations = createOnboardingInvitationEngine(profileStore);
const onboardingOrigins = new Set(["https://auroranexus.com.br", "https://wmgj-hml-jfn-20260927.web.app"]);
export const auroraNexusUserProfiles = onRequest(
  { cors: false, timeoutSeconds: 120, secrets: [allowedEmails, csrfSecret] },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    // A new professional has no Aurora session until the UID-bound invitation is consumed.
    if (req.method === "POST" && req.body?.action === "REDEEM_ONBOARDING") {
      try {
        if (!onboardingOrigins.has(String(req.get("origin") ?? "")) || (req.get("sec-fetch-site") && req.get("sec-fetch-site") !== "same-origin")) throw new ProfileError("CROSS_SITE_REJECTED", 403);
        if (String(req.get("content-type") ?? "").split(";", 1)[0]?.toLowerCase() !== "application/json") throw new ProfileError("UNSUPPORTED_MEDIA_TYPE", 415);
        if (Object.keys(req.body).some(k => !["action", "idToken", "registrationPassword"].includes(k))
          || typeof req.body.idToken !== "string" || !req.body.idToken || req.body.idToken.length > 10000
          || typeof req.body.registrationPassword !== "string" || req.body.registrationPassword.length > 100) throw new ProfileError("INVALID_ONBOARDING_REQUEST", 400);
        const principal = await auroraAuth.verifyIdToken(req.body.idToken, true);
        res.json(await invitations.consume(principal, req.body.registrationPassword));
      } catch (error) {
        const known = error instanceof ProfileError;
        res.status(known ? error.status : 401).json({ok: false, code: known ? error.code : "INVALID_ONBOARDING_IDENTITY"});
      }
      return;
    }
    const actor = await verifyAuroraAccess(req.get("cookie"), allowedEmails.value());
    if (!actor) { res.status(401).json({ ok: false, code: "AUTH_REQUIRED" }); return; }
    if (!profileAdmin(actor)) { res.status(403).json({ ok: false, code: "PROFILE_ADMIN_MFA_REQUIRED" }); return; }
    try {
      if (req.method === "GET") {
        const org = await auroraDb.doc(`organizations/${actor.orgId}`).get();
        const rows = await auroraDb.collection(`organizations/${actor.orgId}/members`).limit(101).get();
        res.json({ ok: true, orgId: actor.orgId, currentAdminUid: actor.uid, engineEnabled: org.data()?.userProfilesEnabled === true, truncated: rows.size > 100, profiles: rows.docs.slice(0,100).map(doc => {
          const data = doc.data();
          return { uid: doc.id, name: data.displayName ?? "Usuário", role: data.role, active: data.active === true,
            jobTitle: data.onboarding?.jobTitle ?? null, managerUid: data.onboarding?.managerUid ?? null,
            onboardingState: data.onboardingState ?? null,
            profileState: data.profileState ?? "LEGACY", managed: data.profileVersion === 1 };
        }) });
        return;
      }
      if (req.method !== "POST") { res.set("Allow", "GET, POST"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
      if (req.get("sec-fetch-site") && req.get("sec-fetch-site") !== "same-origin") throw new ProfileError("CROSS_SITE_REJECTED", 403);
      if (String(req.get("content-type") ?? "").split(";",1)[0]?.toLowerCase() !== "application/json") throw new ProfileError("UNSUPPORTED_MEDIA_TYPE", 415);
      if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"), csrfSecret.value(), CSRF_PURPOSES.userProfile)) throw new ProfileError("CSRF_REJECTED", 403);
      if (req.body?.action === "CREATE") {
        const result = await engine.create(actor, req.body);
        const invitation = req.body.onboarding && result.onboardingState === "INVITED" ? await invitations.issue(actor, result.uid, req.body.requestId) : null;
        res.status(200).json({...result, invitation}); return;
      }
      if (req.body?.action === "ISSUE_INVITATION" && Object.keys(req.body).every(k => ["action", "uid", "requestId"].includes(k))
        && typeof req.body.uid === "string" && typeof req.body.requestId === "string") {
        res.json(await invitations.issue(actor, req.body.uid, req.body.requestId)); return;
      }
      if (req.body?.action === "REVOKE" && Object.keys(req.body).every(k => ["action","uid"].includes(k)) && typeof req.body.uid === "string") {
        res.json(await engine.revoke(actor, req.body.uid)); return;
      }
      throw new ProfileError("INVALID_PROFILE_ACTION", 400);
    } catch (error) {
      const known = error instanceof ProfileError;
      res.status(known ? error.status : 503).json({ ok: false, code: known ? error.code : "PROFILE_OPERATION_UNAVAILABLE" });
    }
  }
);
