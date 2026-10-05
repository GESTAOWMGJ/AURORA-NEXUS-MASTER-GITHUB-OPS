import { randomUUID } from "node:crypto";
import { ProfileError, PROFILE_VERSION, normalizeProfileRequest, profileAdmin, profileIdentity, type ProfileActor } from "./auroraUserProfilePolicy.js";

type Row = Record<string, any>;
export type ProfileTx = { read(path: string): Promise<Row | undefined>; create(path: string, data: Row): void; update(path: string, data: Row): void };
export type ProfileStore = { transaction<T>(body: (tx: ProfileTx) => Promise<T>): Promise<T> };
export type ProfileAuth = {
  getUser(uid: string): Promise<{ uid: string; email?: string; disabled: boolean; customClaims?: Row }>;
  createUser(data: { uid: string; email: string; displayName: string; disabled: boolean; emailVerified: boolean }): Promise<unknown>;
  setCustomUserClaims(uid: string, claims: Row): Promise<unknown>;
  updateUser(uid: string, data: { disabled: boolean }): Promise<unknown>;
  revokeRefreshTokens(uid: string): Promise<unknown>;
};
export function createProfileEngine(store: ProfileStore, auth: ProfileAuth, clock = Date.now) {
  async function authorized(tx: ProfileTx, actor: ProfileActor, creating = true) {
    if (!profileAdmin(actor)) throw new ProfileError("PROFILE_ADMIN_MFA_REQUIRED", 403);
    const org = await tx.read(`organizations/${actor.orgId}`);
    const member = await tx.read(`organizations/${actor.orgId}/members/${actor.uid}`);
    if (org?.active !== true || (creating && org.userProfilesEnabled !== true)) throw new ProfileError("PROFILE_ENGINE_NOT_ENABLED", 403);
    if (member?.active !== true || member.allFacilities !== true || !["org_admin", "platform_admin"].includes(member.role)) {
      throw new ProfileError("PROFILE_ADMIN_REVOKED", 403);
    }
  }
  async function create(actor: ProfileActor, raw: unknown) {
    const request = normalizeProfileRequest(raw);
    const id = profileIdentity(actor, request);
    const base = `organizations/${actor.orgId}`;
    const opPath = `${base}/apiIdempotency/${id.operationId}`;
    const memberPath = `${base}/members/${id.uid}`;
    const matchesRequest = (member: Row) => member.profileVersion === PROFILE_VERSION
      && member.profileOperationId === id.operationId && member.profileFingerprint === id.fingerprint
      && member.authEmail === request.email && member.displayName === request.displayName
      && member.role === request.role && member.allFacilities === request.allFacilities
      && JSON.stringify(member.facilityIds) === JSON.stringify(request.facilityIds)
      && Array.isArray(member.permissions) && member.permissions.length === 0 && member.mfaRequired === true;
    const lease = randomUUID();
    const ready = await store.transaction(async tx => {
      await authorized(tx, actor);
      const op = await tx.read(opPath);
      const member = await tx.read(memberPath);
      for (const facility of request.facilityIds) {
        if ((await tx.read(`${base}/facilities/${facility}`))?.active !== true) throw new ProfileError("PROFILE_FACILITY_NOT_ACTIVE", 400);
      }
      if (op && (op.fingerprint !== id.fingerprint || op.uid !== id.uid)) throw new ProfileError("PROFILE_REQUEST_CONFLICT");
      if (op?.status === "REVOKED" || member?.profileState === "REVOKED") throw new ProfileError("PROFILE_REVOKED");
      if (op?.status === "READY") {
        if (!member || !matchesRequest(member) || member.active !== true || member.profileState !== "READY") throw new ProfileError("PROFILE_REQUIRES_REVIEW");
        return true;
      }
      if (op && op.status !== "PENDING") throw new ProfileError("PROFILE_REQUIRES_REVIEW");
      if (op?.leaseUntil > clock()) throw new ProfileError("PROFILE_BUSY");
      if (member && (!matchesRequest(member) || member.profileState !== "PENDING" || member.active !== false)) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
      if (op) tx.update(opPath, { lease, leaseUntil: clock() + 180_000 });
      else tx.create(opPath, { schemaVersion: 1, fingerprint: id.fingerprint, uid: id.uid, actorUid: actor.uid,
        status: "PENDING", lease, leaseUntil: clock() + 180_000, createdAtUtc: new Date(clock()).toISOString() });
      return false;
    });
    const result = () => ({ ok: true, uid: id.uid, orgId: actor.orgId, role: request.role,
      profileState: "READY", activationState: "USER_EMAIL_AND_MFA_REQUIRED", loginPath: `/${actor.orgId}`,
      requestId: request.requestId, idempotent: ready, deliveryPerformed: false });
    const checkLease = async (tx: ProfileTx) => {
      await authorized(tx, actor);
      const op = await tx.read(opPath);
      if (op?.status !== "PENDING" || op.lease !== lease || op.leaseUntil <= clock() || op.fingerprint !== id.fingerprint) throw new ProfileError("PROFILE_LEASE_LOST");
    };
    try {
      let user;
      try { user = await auth.getUser(id.uid); }
      catch (error) {
        if ((error as {code?: string}).code !== "auth/user-not-found" || ready) throw error;
        await store.transaction(checkLease);
        // Never adopt an existing account by email or reset anybody's password.
        await auth.createUser({ uid: id.uid, email: request.email, displayName: request.displayName, disabled: true, emailVerified: false });
        user = await auth.getUser(id.uid);
      }
      if (user.email?.toLowerCase() !== request.email || user.uid !== id.uid) throw new ProfileError("PROFILE_IDENTITY_CONFLICT");
      const claims = user.customClaims ?? {};
      if (ready) {
        if (user.disabled || claims.auroraOrgId !== actor.orgId || claims.auroraProfileOperation !== id.operationId || claims.auroraProfileVersion !== PROFILE_VERSION) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
        return result();
      }
      if (Object.keys(claims).length && (claims.auroraOrgId !== actor.orgId || claims.auroraProfileOperation !== id.operationId || claims.auroraProfileVersion !== PROFILE_VERSION)) throw new ProfileError("PROFILE_IDENTITY_CONFLICT");
      if (!Object.keys(claims).length && !user.disabled) throw new ProfileError("PROFILE_IDENTITY_CONFLICT");
      await store.transaction(checkLease);
      await auth.setCustomUserClaims(id.uid, { ...claims, auroraOrgId: actor.orgId,
        auroraProfileVersion: PROFILE_VERSION, auroraProfileOperation: id.operationId });
      await store.transaction(async tx => {
        await checkLease(tx);
        const member = await tx.read(memberPath);
        if (member && (!matchesRequest(member) || member.profileState !== "PENDING" || member.active !== false)) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
        if (!member) tx.create(memberPath, { profileVersion: PROFILE_VERSION, profileOperationId: id.operationId,
          profileFingerprint: id.fingerprint,
          authEmail: request.email, displayName: request.displayName, role: request.role, allFacilities: request.allFacilities,
          facilityIds: request.facilityIds, permissions: [], active: false, profileState: "PENDING", mfaRequired: true,
          createdBy: actor.uid, createdAtUtc: new Date(clock()).toISOString() });
      });
      await store.transaction(checkLease);
      await auth.updateUser(id.uid, { disabled: false });
      const verified = await auth.getUser(id.uid);
      if (verified.disabled || verified.email?.toLowerCase() !== request.email || verified.customClaims?.auroraOrgId !== actor.orgId
          || verified.customClaims?.auroraProfileOperation !== id.operationId || verified.customClaims?.auroraProfileVersion !== PROFILE_VERSION) throw new ProfileError("PROFILE_IDENTITY_NOT_VERIFIED");
      await store.transaction(async tx => {
        await checkLease(tx);
        const member = await tx.read(memberPath);
        if (!member || !matchesRequest(member) || member.profileState !== "PENDING" || member.active !== false) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
        for (const facility of request.facilityIds) {
          if ((await tx.read(`${base}/facilities/${facility}`))?.active !== true) throw new ProfileError("PROFILE_FACILITY_NOT_ACTIVE", 400);
        }
        tx.update(memberPath, { active: true, profileState: "READY", provisionedAtUtc: new Date(clock()).toISOString() });
        tx.update(opPath, { status: "READY", leaseUntil: 0 });
        tx.create(`${base}/auditEvents/${id.operationId}`, { type: "USER_PROFILE_PROVISIONED", actorUid: actor.uid,
          targetUid: id.uid, orgId: actor.orgId, role: request.role, atUtc: new Date(clock()).toISOString() });
      });
      return result();
    } catch (error) {
      // Leave incomplete membership closed; a repeat of this request resumes it.
      if (!ready) await store.transaction(async tx => {
        const op = await tx.read(opPath);
        if (op?.status === "PENDING" && op.lease === lease) tx.update(opPath, { leaseUntil: 0 });
      }).catch(() => {});
      if (error instanceof ProfileError) throw error;
      if (["auth/email-already-exists", "auth/uid-already-exists"].includes((error as {code?: string}).code ?? "")) throw new ProfileError("PROFILE_IDENTITY_ALREADY_EXISTS");
      throw new ProfileError("PROFILE_PROVISIONING_INTERRUPTED", 503);
    }
  }
  async function revoke(actor: ProfileActor, uid: string) {
    if (!profileAdmin(actor)) throw new ProfileError("PROFILE_ADMIN_MFA_REQUIRED", 403);
    if (!/^anx_[a-f0-9]{40}$/.test(uid) || uid === actor.uid) throw new ProfileError("PROFILE_REVOCATION_NOT_ALLOWED", 400);
    const base = `organizations/${actor.orgId}`;
    const user = await auth.getUser(uid);
    if (user.customClaims?.auroraOrgId !== actor.orgId || user.customClaims?.auroraProfileVersion !== PROFILE_VERSION) throw new ProfileError("PROFILE_REVOCATION_NOT_ALLOWED", 403);
    await store.transaction(async tx => {
      await authorized(tx, actor, false);
      const path = `${base}/members/${uid}`;
      const member = await tx.read(path);
      if (member?.profileVersion !== PROFILE_VERSION || !/^profile-[a-f0-9]{64}$/.test(member.profileOperationId)
          || member.profileOperationId !== user.customClaims?.auroraProfileOperation) throw new ProfileError("PROFILE_REVOCATION_NOT_ALLOWED", 403);
      const opPath = `${base}/apiIdempotency/${member.profileOperationId}`;
      const op = await tx.read(opPath);
      if (!op || op.uid !== uid) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
      if (member.profileState !== "REVOKED") {
        tx.update(path, { active: false, profileState: "REVOKED", revokedBy: actor.uid, revokedAtUtc: new Date(clock()).toISOString() });
        tx.update(opPath, { status: "REVOKED", leaseUntil: 0 });
        tx.create(`${base}/auditEvents/${member.profileOperationId}-revoke`, { type: "USER_PROFILE_REVOKED", actorUid: actor.uid, targetUid: uid, orgId: actor.orgId, atUtc: new Date(clock()).toISOString() });
      }
    });
    await auth.updateUser(uid, { disabled: true });
    await auth.revokeRefreshTokens(uid);
    return { ok: true, uid, profileState: "REVOKED" };
  }
  return { create, revoke };
}
