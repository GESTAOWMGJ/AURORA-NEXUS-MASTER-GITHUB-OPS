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
    if (member?.active !== true || member.allFacilities !== true || !["org_admin", "platform_admin"].includes(member.role)
        || (member.onboardingRequired === true && member.onboardingState !== "COMPLETE")) {
      throw new ProfileError("PROFILE_ADMIN_REVOKED", 403);
    }
  }
  async function create(actor: ProfileActor, raw: unknown) {
    const request = normalizeProfileRequest(raw);
    const id = profileIdentity(actor, request);
    const base = `organizations/${actor.orgId}`;
    const opPath = `${base}/apiIdempotency/${id.operationId}`;
    const memberPath = `${base}/members/${id.uid}`;
    const welcomeId = `welcome-${id.operationId.slice(8)}`;
    let onboardingState = "INVITED";
    const matchesOnboarding = (member: Row) => request.onboarding
      ? member.onboardingRequired === true && ["INVITED", "COMPLETE"].includes(member.onboardingState)
        && member.onboarding?.jobTitle === request.onboarding.jobTitle
        && member.onboarding?.managerUid === request.onboarding.managerUid
        && member.onboarding?.welcomeDueHours === request.onboarding.welcomeDueHours
        && JSON.stringify(member.onboarding?.duties) === JSON.stringify(request.onboarding.duties)
        && Object.keys(member.onboarding ?? {}).length === 4
      : member.onboardingRequired !== true && member.onboarding === undefined;
    const matchesRequest = (member: Row) => member.profileVersion === PROFILE_VERSION
      && member.profileOperationId === id.operationId && member.profileFingerprint === id.fingerprint
      && member.authEmail === request.email && member.displayName === request.displayName
      && member.role === request.role && member.allFacilities === request.allFacilities
      && JSON.stringify(member.facilityIds) === JSON.stringify(request.facilityIds)
      && Array.isArray(member.permissions) && member.permissions.length === 0 && member.mfaRequired === true && matchesOnboarding(member);
    const pendingMember = () => ({ profileVersion: PROFILE_VERSION, profileOperationId: id.operationId,
      profileFingerprint: id.fingerprint, authEmail: request.email, displayName: request.displayName, role: request.role,
      allFacilities: request.allFacilities, facilityIds: request.facilityIds, permissions: [], active: false,
      profileState: "PENDING", mfaRequired: true, createdBy: actor.uid, createdAtUtc: new Date(clock()).toISOString(),
      ...(request.onboarding ? { onboarding: request.onboarding, onboardingRequired: true, onboardingState: "INVITED" } : {}) });
    const liveManager = async (tx: ProfileTx) => {
      if (!request.onboarding) return;
      const manager = await tx.read(`${base}/members/${request.onboarding.managerUid}`);
      if (manager?.active !== true || (manager.onboardingRequired === true && manager.onboardingState !== "COMPLETE")) {
        throw new ProfileError("PROFILE_MANAGER_NOT_ACTIVE", 400);
      }
    };
    // Read the complete plan before any Firestore writes; existing progress is never reset.
    const welcomePlan = async (tx: ProfileTx, createdAtUtc: string, mustExist = false) => {
      if (!request.onboarding) return () => {};
      const createdAt = Date.parse(createdAtUtc);
      if (!Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== createdAtUtc) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
      const dueAt = new Date(createdAt + request.onboarding.welcomeDueHours * 3_600_000).toISOString();
      const actionPath = `${base}/actionItems/${welcomeId}`;
      const inputPath = `${base}/managerInputs/${welcomeId}`;
      const action = await tx.read(actionPath);
      const input = await tx.read(inputPath);
      const common = { orgId: actor.orgId, profileOperationId: id.operationId, subjectUid: id.uid,
        assignedToUid: request.onboarding.managerUid, competence: createdAtUtc.slice(0, 7), dueAt,
        title: "Acolhimento profissional", details: "Acompanhar acolhimento, atribuições e orientação inicial.",
        createdBy: actor.uid, createdAt: createdAtUtc, updatedAt: createdAtUtc, sanitized: true, sensitivity: "INTERNAL" };
      const matches = (row: Row) => ["orgId", "profileOperationId", "subjectUid", "assignedToUid", "competence", "dueAt", "createdBy", "createdAt", "sanitized", "sensitivity"]
        .every(key => row[key] === (common as Row)[key]);
      if (Boolean(action) !== Boolean(input) || (mustExist && !action)
          || (action && (!matches(action) || action.targetType !== "managementInput" || action.targetId !== welcomeId
            || action.reasonCode !== "MANUAL_REVIEW" || action.riskLevel !== "MEDIUM"
            || !["OPEN", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"].includes(action.status)
            || !Number.isSafeInteger(action.revision) || action.revision < 1))
          || (input && (!matches(input) || input.state !== "OPEN" || !Array.isArray(input.evidenceRefs)))) {
        throw new ProfileError("PROFILE_WELCOME_TASK_CONFLICT");
      }
      return () => {
        if (!action) {
          tx.create(inputPath, { ...common, state: "OPEN", evidenceRefs: [] });
          tx.create(actionPath, { ...common, targetType: "managementInput", targetId: welcomeId,
            reasonCode: "MANUAL_REVIEW", riskLevel: "MEDIUM", status: "OPEN", revision: 1 });
        }
      };
    };
    const lease = randomUUID();
    const ready = await store.transaction(async tx => {
      await authorized(tx, actor);
      const op = await tx.read(opPath);
      const member = await tx.read(memberPath);
      await liveManager(tx);
      for (const facility of request.facilityIds) {
        if ((await tx.read(`${base}/facilities/${facility}`))?.active !== true) throw new ProfileError("PROFILE_FACILITY_NOT_ACTIVE", 400);
      }
      if (op && (op.fingerprint !== id.fingerprint || op.uid !== id.uid)) throw new ProfileError("PROFILE_REQUEST_CONFLICT");
      if (op?.status === "REVOKED" || member?.profileState === "REVOKED") throw new ProfileError("PROFILE_REVOKED");
      if (op?.status === "READY") {
        if (!member || !matchesRequest(member) || member.active !== true || member.profileState !== "READY") throw new ProfileError("PROFILE_REQUIRES_REVIEW");
        await welcomePlan(tx, op.createdAtUtc, true);
        onboardingState = member.onboardingState;
        return true;
      }
      if (op && op.status !== "PENDING") throw new ProfileError("PROFILE_REQUIRES_REVIEW");
      if (op?.leaseUntil > clock()) throw new ProfileError("PROFILE_BUSY");
      if (member && (!matchesRequest(member) || member.profileState !== "PENDING" || member.active !== false
          || (request.onboarding && member.onboardingState !== "INVITED"))) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
      await welcomePlan(tx, op?.createdAtUtc ?? new Date(clock()).toISOString());
      if (op) tx.update(opPath, { lease, leaseUntil: clock() + 180_000 });
      else tx.create(opPath, { schemaVersion: 1, fingerprint: id.fingerprint, uid: id.uid, actorUid: actor.uid,
        status: "PENDING", lease, leaseUntil: clock() + 180_000, createdAtUtc: new Date(clock()).toISOString() });
      if (request.onboarding && !member) tx.create(memberPath, pendingMember());
      return false;
    });
    const result = () => ({ ok: true, uid: id.uid, orgId: actor.orgId, role: request.role,
      profileState: "READY", activationState: "USER_EMAIL_AND_MFA_REQUIRED", loginPath: `/${actor.orgId}`,
      requestId: request.requestId, idempotent: ready, deliveryPerformed: false,
      ...(request.onboarding ? { onboardingRequired: true, onboardingState, welcomeActionId: welcomeId,
        activationState: onboardingState === "COMPLETE" ? "COMPLETE" : "INVITATION_EMAIL_AND_MFA_REQUIRED" } : {}) });
    const checkLease = async (tx: ProfileTx) => {
      await authorized(tx, actor);
      await liveManager(tx);
      const op = await tx.read(opPath);
      if (op?.status !== "PENDING" || op.lease !== lease || op.leaseUntil <= clock() || op.fingerprint !== id.fingerprint) throw new ProfileError("PROFILE_LEASE_LOST");
      return op;
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
        if (user.disabled || claims.auroraOrgId !== actor.orgId || claims.auroraProfileOperation !== id.operationId || claims.auroraProfileVersion !== PROFILE_VERSION
            || (request.onboarding ? claims.auroraOnboardingRequired !== true : claims.auroraOnboardingRequired === true)) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
        return result();
      }
      if (Object.keys(claims).length && (claims.auroraOrgId !== actor.orgId || claims.auroraProfileOperation !== id.operationId || claims.auroraProfileVersion !== PROFILE_VERSION
          || (request.onboarding ? claims.auroraOnboardingRequired !== true : claims.auroraOnboardingRequired === true))) throw new ProfileError("PROFILE_IDENTITY_CONFLICT");
      if (!Object.keys(claims).length && !user.disabled) throw new ProfileError("PROFILE_IDENTITY_CONFLICT");
      await store.transaction(checkLease);
      await auth.setCustomUserClaims(id.uid, { ...claims, auroraOrgId: actor.orgId,
        auroraProfileVersion: PROFILE_VERSION, auroraProfileOperation: id.operationId,
        ...(request.onboarding ? { auroraOnboardingRequired: true } : {}) });
      await store.transaction(async tx => {
        await checkLease(tx);
        const member = await tx.read(memberPath);
        if (member && (!matchesRequest(member) || member.profileState !== "PENDING" || member.active !== false
            || (request.onboarding && member.onboardingState !== "INVITED"))) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
        if (!member) tx.create(memberPath, pendingMember());
      });
      await store.transaction(checkLease);
      await auth.updateUser(id.uid, { disabled: false });
      const verified = await auth.getUser(id.uid);
      if (verified.disabled || verified.email?.toLowerCase() !== request.email || verified.customClaims?.auroraOrgId !== actor.orgId
          || verified.customClaims?.auroraProfileOperation !== id.operationId || verified.customClaims?.auroraProfileVersion !== PROFILE_VERSION
          || (request.onboarding ? verified.customClaims?.auroraOnboardingRequired !== true : verified.customClaims?.auroraOnboardingRequired === true)) throw new ProfileError("PROFILE_IDENTITY_NOT_VERIFIED");
      await store.transaction(async tx => {
        const op = await checkLease(tx);
        const member = await tx.read(memberPath);
        if (!member || !matchesRequest(member) || member.profileState !== "PENDING" || member.active !== false
            || (request.onboarding && member.onboardingState !== "INVITED")) throw new ProfileError("PROFILE_REQUIRES_REVIEW");
        for (const facility of request.facilityIds) {
          if ((await tx.read(`${base}/facilities/${facility}`))?.active !== true) throw new ProfileError("PROFILE_FACILITY_NOT_ACTIVE", 400);
        }
        const writeWelcome = await welcomePlan(tx, op.createdAtUtc);
        writeWelcome();
        tx.update(memberPath, { active: true, profileState: "READY", provisionedAtUtc: new Date(clock()).toISOString() });
        tx.update(opPath, { status: "READY", leaseUntil: 0 });
        tx.create(`${base}/auditEvents/${id.operationId}`, { type: "USER_PROFILE_PROVISIONED", actorUid: actor.uid,
          targetUid: id.uid, orgId: actor.orgId, role: request.role, atUtc: new Date(clock()).toISOString(),
          ...(request.onboarding ? { onboardingRequired: true, welcomeActionId: welcomeId } : {}) });
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
        tx.update(path, { active: false, profileState: "REVOKED", revokedBy: actor.uid, revokedAtUtc: new Date(clock()).toISOString(),
          ...(member.onboardingRequired === true ? { onboardingState: "REVOKED" } : {}) });
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
