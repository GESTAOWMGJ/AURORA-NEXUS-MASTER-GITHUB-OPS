import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isCompanySlug } from "./auroraTenantEntry.js";
import { PROFILE_VERSION, ProfileError, normalizeProfileOnboarding, profileAdmin, type ProfileActor } from "./auroraUserProfilePolicy.js";
import type { ProfileStore, ProfileTx } from "./auroraUserProfiles.js";

type Row = Record<string, any>;
export type VerifiedOnboardingPrincipal = {
  uid: string;
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_second_factor?: string };
  auroraOrgId?: unknown;
  auroraProfileVersion?: unknown;
  auroraProfileOperation?: unknown;
  auroraOnboardingRequired?: unknown;
};

const PROFILE_OPERATION = /^profile-[a-f0-9]{64}$/;
const INVITATION_OPERATION = /^onboarding-invitation-[a-f0-9]{64}$/;
const MANAGED_UID = /^anx_[a-f0-9]{40}$/;
const CREDENTIAL = /^ANX1-[A-Za-z0-9_-]{43}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const VALID_FOR_MS = 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const boundDigest = (orgId: string, uid: string, profileOperationId: string, invitationOperationId: string, code: string) =>
  hash(["aurora-onboarding-invitation", "v1", orgId, uid, profileOperationId, invitationOperationId, code].join("\0"));
const issueFingerprint = (orgId: string, actorUid: string, uid: string, profileOperationId: string) =>
  hash(JSON.stringify({ orgId, actorUid, uid, profileOperationId }));
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value)
  && value >= 0 && value <= 8_640_000_000_000_000 - VALID_FOR_MS;

/** The caller supplies a Firebase-verified principal; this module never changes Auth. */
export function createOnboardingInvitationEngine(store: ProfileStore, clock = Date.now) {
  async function readyMember(tx: ProfileTx, base: string, uid: string, member: Row | undefined) {
    if (!member || member.active !== true || member.profileVersion !== PROFILE_VERSION || member.profileState !== "READY"
        || member.onboardingRequired !== true || member.onboardingState !== "INVITED"
        || typeof member.authEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.authEmail)
        || member.authEmail !== member.authEmail.trim().toLowerCase()
        || typeof member.profileOperationId !== "string" || !PROFILE_OPERATION.test(member.profileOperationId)
        || uid !== `anx_${hash(member.profileOperationId).slice(0, 40)}`) {
      throw new ProfileError("ONBOARDING_INVITATION_NOT_AVAILABLE", 403);
    }
    const operation = await tx.read(`${base}/apiIdempotency/${member.profileOperationId}`);
    if (operation?.status !== "READY" || operation.uid !== uid || typeof member.profileFingerprint !== "string"
        || !DIGEST.test(member.profileFingerprint) || operation.fingerprint !== member.profileFingerprint) {
      throw new ProfileError("PROFILE_REQUIRES_REVIEW", 403);
    }
    try {
      const onboarding = normalizeProfileOnboarding(member.onboarding);
      if (onboarding.jobTitle !== member.onboarding.jobTitle || onboarding.managerUid !== member.onboarding.managerUid
          || onboarding.welcomeDueHours !== member.onboarding.welcomeDueHours
          || JSON.stringify(onboarding.duties) !== JSON.stringify(member.onboarding.duties)) throw new Error("noncanonical metadata");
    } catch {
      throw new ProfileError("PROFILE_REQUIRES_REVIEW", 403);
    }
    return member;
  }

  async function issue(actor: ProfileActor, uid: string, requestId: string) {
    if (!profileAdmin(actor)) throw new ProfileError("PROFILE_ADMIN_MFA_REQUIRED", 403);
    if (typeof uid !== "string" || !MANAGED_UID.test(uid) || typeof requestId !== "string"
        || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) throw new ProfileError("INVALID_ONBOARDING_INVITATION", 400);
    const base = `organizations/${actor.orgId}`;
    const memberPath = `${base}/members/${uid}`;
    const invitationOperationId = `onboarding-invitation-${hash(["aurora-onboarding-request", "v1", actor.orgId, requestId].join("\0"))}`;
    const operationPath = `${base}/apiIdempotency/${invitationOperationId}`;
    // Keep the credential only in this call's memory, including transaction retries.
    const registrationPassword = `ANX1-${randomBytes(32).toString("base64url")}`;
    return store.transaction(async tx => {
      const org = await tx.read(base);
      const administrator = await tx.read(`${base}/members/${actor.uid}`);
      const member = await tx.read(memberPath);
      if (org?.active !== true || org.userProfilesEnabled !== true) throw new ProfileError("PROFILE_ENGINE_NOT_ENABLED", 403);
      if (administrator?.active !== true || administrator.allFacilities !== true
          || !["org_admin", "platform_admin"].includes(administrator.role)
          || (administrator.onboardingRequired === true && administrator.onboardingState !== "COMPLETE")) {
        throw new ProfileError("PROFILE_ADMIN_REVOKED", 403);
      }
      const ready = await readyMember(tx, base, uid, member);
      const operation = await tx.read(operationPath);
      const fingerprint = issueFingerprint(actor.orgId, actor.uid, uid, ready.profileOperationId);
      if (operation) {
        if (operation.type !== "ONBOARDING_INVITATION" || operation.status !== "ISSUED" || operation.fingerprint !== fingerprint
            || operation.uid !== uid || operation.orgId !== actor.orgId || operation.profileOperationId !== ready.profileOperationId
            || !validTime(operation.expiresAtMs)) throw new ProfileError("PROFILE_REQUEST_CONFLICT");
        return { ok: true as const, uid, registrationPassword: null, alreadyIssued: true,
          expiresAtUtc: new Date(operation.expiresAtMs).toISOString(), invitationState: "INVITED" as const };
      }
      const now = clock();
      if (!validTime(now)) throw new ProfileError("ONBOARDING_CLOCK_INVALID", 503);
      const expiresAtMs = now + VALID_FOR_MS;
      const expiresAtUtc = new Date(expiresAtMs).toISOString();
      const atUtc = new Date(now).toISOString();
      tx.create(operationPath, { schemaVersion: 1, type: "ONBOARDING_INVITATION", status: "ISSUED", fingerprint,
        actorUid: actor.uid, uid, orgId: actor.orgId, profileOperationId: ready.profileOperationId, expiresAtMs, atUtc });
      tx.update(memberPath, { onboardingInvitation: {
        codeDigest: boundDigest(actor.orgId, uid, ready.profileOperationId, invitationOperationId, registrationPassword),
        expiresAtMs, invitationOperationId
      } });
      tx.create(`${base}/auditEvents/${invitationOperationId}-issued`, { type: "ONBOARDING_INVITATION_ISSUED",
        actorUid: actor.uid, targetUid: uid, orgId: actor.orgId, profileOperationId: ready.profileOperationId,
        invitationOperationId, expiresAtUtc, atUtc });
      return { ok: true as const, uid, registrationPassword, alreadyIssued: false, expiresAtUtc, invitationState: "INVITED" as const };
    });
  }

  async function consume(principal: VerifiedOnboardingPrincipal, registrationPassword: string) {
    if (!principal || typeof principal.uid !== "string" || !MANAGED_UID.test(principal.uid)
        || !isCompanySlug(principal.auroraOrgId) || principal.auroraProfileVersion !== PROFILE_VERSION
        || typeof principal.auroraProfileOperation !== "string" || !PROFILE_OPERATION.test(principal.auroraProfileOperation)
        || principal.auroraOnboardingRequired !== true || principal.email_verified !== true
        || typeof principal.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(principal.email)
        || typeof principal.firebase?.sign_in_second_factor !== "string" || !principal.firebase.sign_in_second_factor.length) {
      throw new ProfileError("ONBOARDING_IDENTITY_REQUIRED", 403);
    }
    if (typeof registrationPassword !== "string" || !CREDENTIAL.test(registrationPassword)) {
      throw new ProfileError("ONBOARDING_INVITATION_INVALID", 403);
    }
    const orgId = principal.auroraOrgId;
    const authEmail = principal.email.trim().toLowerCase();
    const base = `organizations/${orgId}`;
    const memberPath = `${base}/members/${principal.uid}`;
    return store.transaction(async tx => {
      const org = await tx.read(base);
      const member = await tx.read(memberPath);
      if (org?.active !== true || org.userProfilesEnabled !== true) throw new ProfileError("PROFILE_ENGINE_NOT_ENABLED", 403);
      const ready = await readyMember(tx, base, principal.uid, member);
      if (ready.profileOperationId !== principal.auroraProfileOperation || ready.authEmail !== authEmail) {
        throw new ProfileError("ONBOARDING_IDENTITY_REQUIRED", 403);
      }
      const invitation = ready.onboardingInvitation;
      if (!invitation || typeof invitation.codeDigest !== "string" || !DIGEST.test(invitation.codeDigest)
          || !validTime(invitation.expiresAtMs) || typeof invitation.invitationOperationId !== "string"
          || !INVITATION_OPERATION.test(invitation.invitationOperationId)) {
        throw new ProfileError("ONBOARDING_INVITATION_NOT_AVAILABLE", 403);
      }
      const operationPath = `${base}/apiIdempotency/${invitation.invitationOperationId}`;
      const operation = await tx.read(operationPath);
      if (operation?.type !== "ONBOARDING_INVITATION" || operation.status !== "ISSUED" || operation.uid !== principal.uid
          || operation.orgId !== orgId || operation.profileOperationId !== ready.profileOperationId
          || operation.expiresAtMs !== invitation.expiresAtMs || typeof operation.actorUid !== "string"
          || operation.fingerprint !== issueFingerprint(orgId, operation.actorUid, principal.uid, ready.profileOperationId)) {
        throw new ProfileError("ONBOARDING_INVITATION_NOT_AVAILABLE", 403);
      }
      const expected = Buffer.from(invitation.codeDigest, "hex");
      const supplied = Buffer.from(boundDigest(orgId, principal.uid, ready.profileOperationId, invitation.invitationOperationId, registrationPassword), "hex");
      if (!timingSafeEqual(expected, supplied)) throw new ProfileError("ONBOARDING_INVITATION_INVALID", 403);
      // Re-evaluate on every callback attempt: queueing/retries cannot extend the TTL.
      const now = clock();
      if (!validTime(now)) throw new ProfileError("ONBOARDING_CLOCK_INVALID", 503);
      if (now >= invitation.expiresAtMs) throw new ProfileError("ONBOARDING_INVITATION_EXPIRED", 410);
      const consumedAtUtc = new Date(now).toISOString();
      tx.update(memberPath, { onboardingState: "COMPLETE", onboardingCompletedAtUtc: consumedAtUtc,
        onboardingInvitation: { ...invitation, codeDigest: "", consumedAtUtc } });
      tx.update(operationPath, { status: "CONSUMED", consumedAtUtc });
      tx.create(`${base}/auditEvents/${invitation.invitationOperationId}-consumed`, { type: "ONBOARDING_INVITATION_CONSUMED",
        actorUid: principal.uid, targetUid: principal.uid, orgId, profileOperationId: ready.profileOperationId,
        invitationOperationId: invitation.invitationOperationId, atUtc: consumedAtUtc });
      return { ok: true as const, uid: principal.uid, orgId, onboardingState: "COMPLETE" as const };
    });
  }
  return { issue, consume };
}
