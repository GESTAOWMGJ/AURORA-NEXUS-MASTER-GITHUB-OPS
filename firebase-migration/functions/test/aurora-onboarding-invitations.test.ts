import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { createHook } from "node:async_hooks";
import test from "node:test";
import { createOnboardingInvitationEngine, type VerifiedOnboardingPrincipal } from "../src/auroraOnboardingInvitations.js";
import { ProfileError, type ProfileActor } from "../src/auroraUserProfilePolicy.js";
import type { ProfileStore, ProfileTx } from "../src/auroraUserProfiles.js";

const actor: ProfileActor = { uid: "synthetic-master", orgId: "synthetic-company", role: "org_admin", allFacilities: true, mfaVerified: true };
const base = `organizations/${actor.orgId}`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const profileOperationId = `profile-${digest("synthetic-profile-request")}`;
const uid = `anx_${digest(profileOperationId).slice(0, 40)}`;
const memberPath = `${base}/members/${uid}`;
const profilePath = `${base}/apiIdempotency/${profileOperationId}`;
const requestId = "synthetic-invitation-0001";
const principal: VerifiedOnboardingPrincipal = { uid, email: "person@example.invalid", email_verified: true,
  firebase: { sign_in_second_factor: "totp" }, auroraOrgId: actor.orgId, auroraProfileVersion: 1,
  auroraProfileOperation: profileOperationId, auroraOnboardingRequired: true };
const rejects = (code: string) => (error: unknown) => { assert.ok(error instanceof ProfileError); assert.equal(error.code, code); return true; };
const DAY_MS = 86_400_000;
const expectedCredentialDigest = (code: string, invitation: Record<string, any>) => {
  const boundSalt = createHash("sha256").update(["aurora-onboarding-invitation", "scrypt-v1", actor.orgId, uid,
    profileOperationId, invitation.invitationOperationId, invitation.codeSalt].join("\0")).digest();
  return scryptSync(code, boundSalt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
};

function fixture() {
  const fingerprint = digest("synthetic-profile-fingerprint");
  const rows = new Map<string, any>([
    [base, { active: true, userProfilesEnabled: true }],
    [`${base}/members/${actor.uid}`, { active: true, role: "org_admin", allFacilities: true }],
    [memberPath, { active: true, profileVersion: 1, profileState: "READY", profileOperationId, profileFingerprint: fingerprint,
      authEmail: principal.email, role: "operator", permissions: [], allFacilities: false, facilityIds: ["unit-a"],
      onboardingRequired: true, onboardingState: "INVITED",
      onboarding: { jobTitle: "Synthetic operator", duties: ["Synthetic duties"], managerUid: actor.uid, welcomeDueHours: 24 } }],
    [profilePath, { status: "READY", uid, fingerprint }]
  ]);
  const writes: { path: string; data: any }[] = [];
  let now = 1_800_000_000_000;
  let lock = Promise.resolve();
  const store: ProfileStore = { transaction: async body => {
    const previous = lock;
    let release!: () => void;
    lock = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const draft = new Map([...rows].map(([path, value]) => [path, structuredClone(value)]));
    const pending: typeof writes = [];
    let wrote = false;
    const tx: ProfileTx = {
      read: async path => { assert.equal(wrote, false, "Firestore reads precede writes"); return structuredClone(draft.get(path)); },
      create: (path, data) => {
        wrote = true;
        assert.equal(draft.has(path), false, "create-only protects existing records");
        draft.set(path, structuredClone(data)); pending.push({ path, data: structuredClone(data) });
      },
      update: (path, data) => {
        wrote = true; assert.ok(draft.has(path));
        draft.set(path, { ...draft.get(path), ...structuredClone(data) }); pending.push({ path, data: structuredClone(data) });
      }
    };
    try {
      const result = await body(tx);
      rows.clear(); draft.forEach((value, path) => rows.set(path, value)); writes.push(...pending);
      return result;
    } finally { release(); }
  } };
  return { rows, writes, store, engine: createOnboardingInvitationEngine(store, () => now),
    advance: (ms: number) => { now += ms; }, setTime: (ms: number) => { now = ms; }, now: () => now };
}

test("issues a 256-bit code once, stores only its scrypt digest and random 128-bit salt, and preserves metadata", async () => {
  const f = fixture();
  const before = structuredClone(f.rows.get(memberPath));
  const result = await f.engine.issue(actor, uid, requestId);
  assert.equal(result.ok, true); assert.equal(result.alreadyIssued, false); assert.equal(result.invitationState, "INVITED");
  assert.equal(result.uid, uid); assert.match(result.registrationPassword!, /^ANX1-[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(result.registrationPassword!.slice(5), "base64url").length, 32);
  const invitation = f.rows.get(memberPath).onboardingInvitation;
  assert.equal(invitation.expiresAtMs, f.now() + DAY_MS);
  assert.equal(result.expiresAtUtc, new Date(invitation.expiresAtMs).toISOString());
  assert.equal(invitation.digestAlgorithm, "SCRYPT_V1");
  assert.match(invitation.codeSalt, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(Buffer.from(invitation.codeSalt, "base64url").length, 16);
  assert.equal(invitation.codeDigest, expectedCredentialDigest(result.registrationPassword!, invitation));
  const operation = f.rows.get(`${base}/apiIdempotency/${invitation.invitationOperationId}`);
  assert.equal(operation.codeSalt, invitation.codeSalt); assert.equal(operation.digestAlgorithm, "SCRYPT_V1");
  assert.deepEqual({ ...f.rows.get(memberPath), onboardingInvitation: undefined }, { ...before, onboardingInvitation: undefined });
  assert.equal(f.writes.length, 3);
  const persisted = JSON.stringify([...f.rows]); const journal = JSON.stringify(f.writes);
  assert.equal(persisted.includes(result.registrationPassword!), false); assert.equal(journal.includes(result.registrationPassword!), false);
  assert.equal(persisted.includes(result.registrationPassword!.slice(5)), false);
  assert.ok(f.writes.every(write => write.path.startsWith(`${base}/`)));
  const audit = f.rows.get(`${base}/auditEvents/${invitation.invitationOperationId}-issued`);
  assert.equal(audit.actorUid, actor.uid); assert.equal(audit.targetUid, uid); assert.equal(audit.type, "ONBOARDING_INVITATION_ISSUED");
  assert.equal("codeDigest" in audit, false); assert.equal("registrationPassword" in audit, false);
});

test("issuer needs MFA, organizational administrator role, global scope, and a valid tenant", async () => {
  for (const change of [{ mfaVerified: false }, { allFacilities: false }, { role: "viewer" }, { orgId: "../other" }, { uid: "../master" }]) {
    const f = fixture();
    await assert.rejects(f.engine.issue({ ...actor, ...change }, uid, requestId), rejects("PROFILE_ADMIN_MFA_REQUIRED"));
    assert.equal(f.writes.length, 0);
  }
  for (const [target, key] of [["legacy-user", requestId], [uid, "short"], [`${uid}/other`, requestId], [uid, `${requestId}/other`]]) {
    const f = fixture(); await assert.rejects(f.engine.issue(actor, target!, key!), rejects("INVALID_ONBOARDING_INVITATION"));
    assert.equal(f.writes.length, 0);
  }
});

test("live company opt-in and administrator membership are revalidated at issuance", async () => {
  for (const [path, patch, code] of [
    [base, { active: false }, "PROFILE_ENGINE_NOT_ENABLED"], [base, { userProfilesEnabled: false }, "PROFILE_ENGINE_NOT_ENABLED"],
    [`${base}/members/${actor.uid}`, { active: false }, "PROFILE_ADMIN_REVOKED"],
    [`${base}/members/${actor.uid}`, { allFacilities: false }, "PROFILE_ADMIN_REVOKED"],
    [`${base}/members/${actor.uid}`, { role: "viewer" }, "PROFILE_ADMIN_REVOKED"],
    [`${base}/members/${actor.uid}`, { onboardingRequired: true, onboardingState: "INVITED" }, "PROFILE_ADMIN_REVOKED"]
  ] as const) {
    const f = fixture(); Object.assign(f.rows.get(path), patch);
    await assert.rejects(f.engine.issue(actor, uid, requestId), rejects(code)); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.rows.delete(`${base}/members/${actor.uid}`);
  await assert.rejects(f.engine.issue(actor, uid, requestId), rejects("PROFILE_ADMIN_REVOKED"));
});

test("only a bound, active READY managed profile awaiting onboarding can receive an invitation", async () => {
  for (const patch of [{ active: false }, { profileVersion: 2 }, { profileState: "PENDING" }, { profileState: "REVOKED" },
    { onboardingRequired: false }, { onboardingState: "COMPLETE" }, { onboardingState: "REVOKED" }, { profileOperationId: "profile-forged" }]) {
    const f = fixture(); Object.assign(f.rows.get(memberPath), patch);
    await assert.rejects(f.engine.issue(actor, uid, requestId), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE")); assert.equal(f.writes.length, 0);
  }
  for (const patch of [{ status: "REVOKED" }, { uid: "other-user" }, { fingerprint: digest("different") }]) {
    const f = fixture(); Object.assign(f.rows.get(profilePath), patch);
    await assert.rejects(f.engine.issue(actor, uid, requestId), rejects("PROFILE_REQUIRES_REVIEW")); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.rows.delete(memberPath);
  await assert.rejects(f.engine.issue(actor, uid, requestId), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE"));
});

test("concurrent identical issuance returns one credential; idempotent retries cannot recover it", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 4 }, () => f.engine.issue(actor, uid, requestId)));
  assert.equal(results.filter(result => result.registrationPassword !== null).length, 1);
  assert.equal(results.filter(result => result.alreadyIssued).length, 3);
  assert.equal(new Set(results.map(result => result.expiresAtUtc)).size, 1);
  assert.equal(f.writes.length, 3);
  const retry = await f.engine.issue(actor, uid, requestId);
  assert.equal(retry.registrationPassword, null); assert.equal(retry.alreadyIssued, true); assert.equal(f.writes.length, 3);
});

test("the same request ID cannot change target, profile operation, or issuing administrator", async () => {
  const f = fixture(); await f.engine.issue(actor, uid, requestId);
  const otherOperation = `profile-${digest("second-profile")}`;
  const otherUid = `anx_${digest(otherOperation).slice(0, 40)}`;
  const secondFingerprint = digest("second-fingerprint");
  f.rows.set(`${base}/members/${otherUid}`, { ...structuredClone(f.rows.get(memberPath)), profileOperationId: otherOperation,
    profileFingerprint: secondFingerprint, onboardingInvitation: undefined });
  f.rows.set(`${base}/apiIdempotency/${otherOperation}`, { status: "READY", uid: otherUid, fingerprint: secondFingerprint });
  await assert.rejects(f.engine.issue(actor, otherUid, requestId), rejects("PROFILE_REQUEST_CONFLICT"));
  const otherAdmin = { ...actor, uid: "synthetic-other-admin" };
  f.rows.set(`${base}/members/${otherAdmin.uid}`, { active: true, allFacilities: true, role: "org_admin" });
  await assert.rejects(f.engine.issue(otherAdmin, uid, requestId), rejects("PROFILE_REQUEST_CONFLICT"));
  assert.equal(f.writes.length, 3);
});

test("a new request replaces the invitation, invalidates the old code, and never resurrects it on retry", async () => {
  const f = fixture(); const first = await f.engine.issue(actor, uid, requestId);
  const firstSalt = f.rows.get(memberPath).onboardingInvitation.codeSalt;
  f.advance(1_000); const second = await f.engine.issue(actor, uid, `${requestId}-reissue`);
  assert.notEqual(first.registrationPassword, second.registrationPassword);
  assert.notEqual(f.rows.get(memberPath).onboardingInvitation.codeSalt, firstSalt);
  const current = structuredClone(f.rows.get(memberPath).onboardingInvitation);
  const oldRetry = await f.engine.issue(actor, uid, requestId);
  assert.equal(oldRetry.registrationPassword, null); assert.equal(oldRetry.expiresAtUtc, first.expiresAtUtc);
  assert.deepEqual(f.rows.get(memberPath).onboardingInvitation, current);
  await assert.rejects(f.engine.consume(principal, first.registrationPassword!), rejects("ONBOARDING_INVITATION_INVALID"));
  assert.equal((await f.engine.consume(principal, second.registrationPassword!)).onboardingState, "COMPLETE");
});

test("consumption completes onboarding and clears the digest atomically without changing claims or metadata", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
  const before = structuredClone(f.rows.get(memberPath)); const verified = structuredClone(principal);
  const result = await f.engine.consume(principal, issued.registrationPassword!);
  assert.deepEqual(result, { ok: true, uid, orgId: actor.orgId, onboardingState: "COMPLETE" });
  const member = f.rows.get(memberPath);
  assert.equal(member.onboardingState, "COMPLETE"); assert.equal(member.onboardingInvitation.codeDigest, "");
  assert.equal(member.onboardingInvitation.consumedAtUtc, new Date(f.now()).toISOString());
  assert.deepEqual(member.onboarding, before.onboarding); assert.equal(member.role, before.role); assert.equal(member.active, true);
  assert.deepEqual(principal, verified); assert.equal(member.onboardingRequired, true);
  const operationId = member.onboardingInvitation.invitationOperationId;
  assert.equal(f.rows.get(`${base}/apiIdempotency/${operationId}`).status, "CONSUMED");
  const audit = f.rows.get(`${base}/auditEvents/${operationId}-consumed`);
  assert.equal(audit.type, "ONBOARDING_INVITATION_CONSUMED"); assert.equal(audit.actorUid, uid); assert.equal(audit.targetUid, uid);
  assert.equal(JSON.stringify([...f.rows]).includes(issued.registrationPassword!), false);
});

test("simultaneous consumption permits exactly one completion and rejects every replay", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
  const results = await Promise.allSettled([f.engine.consume(principal, issued.registrationPassword!), f.engine.consume(principal, issued.registrationPassword!)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  await assert.rejects(f.engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE"));
  await assert.rejects(f.engine.issue(actor, uid, `${requestId}-after-completion`), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE"));
  assert.equal([...f.rows.values()].filter(row => row.type === "ONBOARDING_INVITATION_CONSUMED").length, 1);
  assert.equal(f.writes.length, 6);
});

test("expiration is enforced at the exact 24-hour boundary and cannot be extended by retry", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
  f.advance(DAY_MS);
  const retry = await f.engine.issue(actor, uid, requestId); assert.equal(retry.expiresAtUtc, issued.expiresAtUtc);
  await assert.rejects(f.engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_EXPIRED"));
  assert.equal(f.rows.get(memberPath).onboardingState, "INVITED"); assert.equal(f.writes.length, 3);
  const before = fixture(); const valid = await before.engine.issue(actor, uid, requestId); before.advance(DAY_MS - 1);
  assert.equal((await before.engine.consume(principal, valid.registrationPassword!)).onboardingState, "COMPLETE");
});

test("a queued consume request cannot use the earlier request-start time to bypass expiry", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId); f.advance(DAY_MS - 1);
  const delayed: ProfileStore = { transaction: body => { f.advance(2); return f.store.transaction(body); } };
  const engine = createOnboardingInvitationEngine(delayed, f.now);
  await assert.rejects(engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_EXPIRED"));
  assert.equal(f.rows.get(memberPath).onboardingState, "INVITED"); assert.equal(f.writes.length, 3);
});

test("a consume callback retry rechecks expiry even when its discarded first attempt was valid", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId); f.advance(DAY_MS - 1);
  const retrying: ProfileStore = { transaction: async body => {
    const discarded = new Map([...f.rows].map(([path, row]) => [path, structuredClone(row)]));
    await body({ read: async path => structuredClone(discarded.get(path)), create: (path, data) => discarded.set(path, data),
      update: (path, data) => discarded.set(path, { ...discarded.get(path), ...data }) });
    f.advance(2);
    return f.store.transaction(body);
  } };
  const engine = createOnboardingInvitationEngine(retrying, f.now);
  await assert.rejects(engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_EXPIRED"));
  assert.equal(f.rows.get(memberPath).onboardingState, "INVITED"); assert.equal(f.writes.length, 3);
  assert.equal([...f.rows.values()].some(row => row.type === "ONBOARDING_INVITATION_CONSUMED"), false);
});

test("consumer must have a Firebase-verified email, real MFA claim, tenant, operation and onboarding marker", async () => {
  for (const patch of [{ email_verified: false }, { firebase: {} }, { firebase: { sign_in_second_factor: "" } },
    { auroraProfileVersion: 2 }, { auroraOnboardingRequired: false }, { auroraOrgId: "../company" },
    { auroraProfileOperation: "forged" }, { email: "invalid" }, { uid: "legacy" }]) {
    const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
    await assert.rejects(f.engine.consume({ ...principal, ...patch }, issued.registrationPassword!), rejects("ONBOARDING_IDENTITY_REQUIRED"));
    assert.equal(f.writes.length, 3);
  }
  for (const patch of [{ email: "other@example.invalid" }, { auroraProfileOperation: `profile-${digest("wrong-operation")}` }]) {
    const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
    await assert.rejects(f.engine.consume({ ...principal, ...patch }, issued.registrationPassword!), rejects("ONBOARDING_IDENTITY_REQUIRED"));
    assert.equal(f.rows.get(memberPath).onboardingState, "INVITED");
  }
});

test("wrong codes and malformed credentials leave the invitation untouched", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
  const invitation = structuredClone(f.rows.get(memberPath).onboardingInvitation);
  for (const code of ["ANX1-" + "A".repeat(43), "short", issued.registrationPassword! + "extra", "anx1-" + "A".repeat(43)]) {
    await assert.rejects(f.engine.consume(principal, code), rejects("ONBOARDING_INVITATION_INVALID"));
  }
  assert.deepEqual(f.rows.get(memberPath).onboardingInvitation, invitation); assert.equal(f.writes.length, 3);
});

test("organization and UID domain binding prevents copying a stored invitation to another tenant or user", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
  const otherOrg = "synthetic-other-company"; const otherBase = `organizations/${otherOrg}`;
  const other = { ...actor, orgId: otherOrg };
  for (const [path, row] of [...f.rows]) f.rows.set(path.replace(base, otherBase), structuredClone(row));
  const second = await f.engine.issue(other, uid, `${requestId}-other-org`);
  assert.notEqual(second.registrationPassword, issued.registrationPassword);
  await assert.rejects(f.engine.consume({ ...principal, auroraOrgId: otherOrg }, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_INVALID"));
  // Transplant the original digest while keeping an otherwise valid local operation.
  const local = f.rows.get(`${otherBase}/members/${uid}`).onboardingInvitation;
  local.codeDigest = f.rows.get(memberPath).onboardingInvitation.codeDigest;
  await assert.rejects(f.engine.consume({ ...principal, auroraOrgId: otherOrg }, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_INVALID"));
  await assert.rejects(f.engine.consume({ ...principal, uid: `anx_${"a".repeat(40)}` }, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE"));
});

test("copying a digest between two valid professionals cannot change its UID and profile-operation binding", async () => {
  const f = fixture(); const first = await f.engine.issue(actor, uid, requestId);
  const otherOperation = `profile-${digest("second-bound-profile")}`;
  const otherUid = `anx_${digest(otherOperation).slice(0, 40)}`;
  const otherPath = `${base}/members/${otherUid}`;
  const fingerprint = digest("second-bound-fingerprint");
  f.rows.set(otherPath, { ...structuredClone(f.rows.get(memberPath)), profileOperationId: otherOperation,
    profileFingerprint: fingerprint, authEmail: "second@example.invalid", onboardingInvitation: undefined });
  f.rows.set(`${base}/apiIdempotency/${otherOperation}`, { status: "READY", uid: otherUid, fingerprint });
  await f.engine.issue(actor, otherUid, `${requestId}-second`);
  f.rows.get(otherPath).onboardingInvitation.codeDigest = f.rows.get(memberPath).onboardingInvitation.codeDigest;
  const secondPrincipal = { ...principal, uid: otherUid, email: "second@example.invalid", auroraProfileOperation: otherOperation };
  await assert.rejects(f.engine.consume(secondPrincipal, first.registrationPassword!), rejects("ONBOARDING_INVITATION_INVALID"));
  assert.equal(f.rows.get(otherPath).onboardingState, "INVITED"); assert.equal(f.rows.get(memberPath).onboardingState, "INVITED");
});

test("revocation and company suspension after issuance close consumption and prevent reissuance", async () => {
  for (const [path, patch, code] of [
    [base, { active: false }, "PROFILE_ENGINE_NOT_ENABLED"], [base, { userProfilesEnabled: false }, "PROFILE_ENGINE_NOT_ENABLED"],
    [memberPath, { active: false }, "ONBOARDING_INVITATION_NOT_AVAILABLE"],
    [memberPath, { onboardingState: "REVOKED" }, "ONBOARDING_INVITATION_NOT_AVAILABLE"],
    [memberPath, { profileState: "REVOKED" }, "ONBOARDING_INVITATION_NOT_AVAILABLE"]
  ] as const) {
    const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId); Object.assign(f.rows.get(path), patch);
    await assert.rejects(f.engine.consume(principal, issued.registrationPassword!), rejects(code));
    await assert.rejects(f.engine.issue(actor, uid, `${requestId}-retry`), rejects(code)); assert.equal(f.writes.length, 3);
  }
});

test("tampered invitation metadata or operation cannot be consumed", async () => {
  for (const patch of [{ codeDigest: "not-hex" }, { expiresAtMs: 1.5 }, { invitationOperationId: "../other" }]) {
    const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
    Object.assign(f.rows.get(memberPath).onboardingInvitation, patch);
    await assert.rejects(f.engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE")); assert.equal(f.writes.length, 3);
  }
  for (const patch of [{ status: "CONSUMED" }, { orgId: "other-company" }, { uid: "other-user" },
    { profileOperationId: `profile-${digest("wrong")}` }, { expiresAtMs: 0 }, { fingerprint: digest("tampered") }]) {
    const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
    const invitation = f.rows.get(memberPath).onboardingInvitation;
    Object.assign(f.rows.get(`${base}/apiIdempotency/${invitation.invitationOperationId}`), patch);
    await assert.rejects(f.engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE")); assert.equal(f.writes.length, 3);
  }
});

test("audit creation conflict rolls back consumption instead of leaving an unaudited COMPLETE member", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
  const invitation = structuredClone(f.rows.get(memberPath).onboardingInvitation);
  f.rows.set(`${base}/auditEvents/${invitation.invitationOperationId}-consumed`, { type: "synthetic-conflict" });
  await assert.rejects(f.engine.consume(principal, issued.registrationPassword!));
  assert.equal(f.rows.get(memberPath).onboardingState, "INVITED");
  assert.deepEqual(f.rows.get(memberPath).onboardingInvitation, invitation);
  assert.equal(f.rows.get(`${base}/apiIdempotency/${invitation.invitationOperationId}`).status, "ISSUED"); assert.equal(f.writes.length, 3);
});

test("an ISSUE audit conflict rolls back the digest and idempotency record", async () => {
  const f = fixture();
  const operationId = `onboarding-invitation-${digest(["aurora-onboarding-request", "v1", actor.orgId, requestId].join("\0"))}`;
  f.rows.set(`${base}/auditEvents/${operationId}-issued`, { type: "synthetic-conflict" });
  await assert.rejects(f.engine.issue(actor, uid, requestId));
  assert.equal(f.rows.get(memberPath).onboardingInvitation, undefined);
  assert.equal(f.rows.has(`${base}/apiIdempotency/${operationId}`), false); assert.equal(f.writes.length, 0);
});

test("missing metadata, noncanonical auth email and a mismatched derived UID fail closed", async () => {
  for (const patch of [{ authEmail: undefined }, { authEmail: "Person@Example.Invalid" }, { profileOperationId: undefined },
    { profileOperationId: `profile-${digest("a-different-derived-uid")}` }, { profileFingerprint: undefined }]) {
    const f = fixture(); Object.assign(f.rows.get(memberPath), patch);
    await assert.rejects(f.engine.issue(actor, uid, requestId)); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.rows.delete(profilePath);
  await assert.rejects(f.engine.issue(actor, uid, requestId), rejects("PROFILE_REQUIRES_REVIEW")); assert.equal(f.writes.length, 0);
});

test("professional metadata must be present and canonical at issuance and consumption", async () => {
  for (const onboarding of [undefined, {}, { jobTitle: "Synthetic", duties: ["Duty"], managerUid: actor.uid, welcomeDueHours: 24, extra: true },
    { jobTitle: " Synthetic ", duties: ["Duty"], managerUid: actor.uid, welcomeDueHours: 24 },
    { jobTitle: "Synthetic", duties: ["Zulu", "Alpha"], managerUid: actor.uid, welcomeDueHours: 24 }]) {
    const f = fixture(); f.rows.get(memberPath).onboarding = onboarding;
    await assert.rejects(f.engine.issue(actor, uid, requestId), rejects("PROFILE_REQUIRES_REVIEW")); assert.equal(f.writes.length, 0);
    const issuedFixture = fixture(); const issued = await issuedFixture.engine.issue(actor, uid, requestId);
    issuedFixture.rows.get(memberPath).onboarding = onboarding;
    await assert.rejects(issuedFixture.engine.consume(principal, issued.registrationPassword!), rejects("PROFILE_REQUIRES_REVIEW"));
    assert.equal(issuedFixture.rows.get(memberPath).onboardingState, "INVITED"); assert.equal(issuedFixture.writes.length, 3);
  }
});

test("a replayed transaction callback still delivers only the committed credential and persists no plaintext", async () => {
  const f = fixture();
  const retrying: ProfileStore = { transaction: async body => {
    // Firestore can rerun callbacks on an optimistic conflict: discard the first draft.
    const discarded = new Map([...f.rows].map(([path, row]) => [path, structuredClone(row)]));
    await body({ read: async path => structuredClone(discarded.get(path)), create: (path, data) => discarded.set(path, data),
      update: (path, data) => discarded.set(path, { ...discarded.get(path), ...data }) });
    return f.store.transaction(body);
  } };
  const engine = createOnboardingInvitationEngine(retrying, f.now);
  const issued = await engine.issue(actor, uid, requestId);
  assert.equal(f.writes.length, 3); assert.equal(JSON.stringify([...f.rows]).includes(issued.registrationPassword!), false);
  assert.equal((await f.engine.consume(principal, issued.registrationPassword!)).onboardingState, "COMPLETE");
});

test("invalid clock values never create a credential record", async () => {
  for (const now of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    const f = fixture(); f.setTime(now);
    await assert.rejects(f.engine.issue(actor, uid, requestId), rejects("ONBOARDING_CLOCK_INVALID")); assert.equal(f.writes.length, 0);
  }
});

test("malformed or absent salt, digest, algorithm, or downgraded schema rejects before scheduling scrypt", async () => {
  for (const patch of [{ codeSalt: undefined }, { codeSalt: "" }, { codeSalt: "A".repeat(21) }, { codeSalt: "A".repeat(21) + "B" },
    { codeSalt: "../" + "A".repeat(19) }, { codeSalt: 16 }, { codeDigest: undefined }, { codeDigest: "0".repeat(63) },
    { digestAlgorithm: undefined }, { digestAlgorithm: "SHA256" }, { N: 1 }]) {
    const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
    Object.assign(f.rows.get(memberPath).onboardingInvitation, patch);
    let derivations = 0;
    const hook = createHook({ init: (_id, type) => { if (type === "SCRYPTREQUEST") derivations++; } });
    hook.enable();
    try { await assert.rejects(f.engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE")); }
    finally { hook.disable(); }
    assert.equal(derivations, 0); assert.equal(f.rows.get(memberPath).onboardingState, "INVITED"); assert.equal(f.writes.length, 3);
  }
});

test("operation salt and algorithm must match the current invitation and legacy digests never receive fallback", async () => {
  for (const patch of [{ codeSalt: undefined }, { codeSalt: "A".repeat(22) }, { digestAlgorithm: undefined }, { digestAlgorithm: "SHA256" }]) {
    const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId);
    const invitation = f.rows.get(memberPath).onboardingInvitation;
    Object.assign(f.rows.get(`${base}/apiIdempotency/${invitation.invitationOperationId}`), patch);
    await assert.rejects(f.engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_NOT_AVAILABLE"));
    await assert.rejects(f.engine.issue(actor, uid, requestId), rejects("PROFILE_REQUEST_CONFLICT"));
    assert.equal(f.writes.length, 3);
  }
});

test("expiration crossed during async scrypt still rolls back consumption", async () => {
  const f = fixture(); const issued = await f.engine.issue(actor, uid, requestId); f.advance(DAY_MS - 1);
  let derivations = 0;
  const hook = createHook({ init: (_id, type) => { if (type === "SCRYPTREQUEST") { derivations++; f.advance(2); } } });
  hook.enable();
  try { await assert.rejects(f.engine.consume(principal, issued.registrationPassword!), rejects("ONBOARDING_INVITATION_EXPIRED")); }
  finally { hook.disable(); }
  assert.equal(derivations, 1); assert.equal(f.rows.get(memberPath).onboardingState, "INVITED"); assert.equal(f.writes.length, 3);
  assert.equal([...f.rows.values()].some(row => row.type === "ONBOARDING_INVITATION_CONSUMED"), false);
});

test("transplanting both digest and nonce still fails the cryptographic organization and operation domain", async () => {
  const f = fixture(); const first = await f.engine.issue(actor, uid, requestId);
  const original = structuredClone(f.rows.get(memberPath).onboardingInvitation);
  const second = await f.engine.issue(actor, uid, `${requestId}-nonce-transplant`);
  const current = f.rows.get(memberPath).onboardingInvitation;
  current.codeDigest = original.codeDigest; current.codeSalt = original.codeSalt;
  f.rows.get(`${base}/apiIdempotency/${current.invitationOperationId}`).codeSalt = original.codeSalt;
  await assert.rejects(f.engine.consume(principal, first.registrationPassword!), rejects("ONBOARDING_INVITATION_INVALID"));
  await assert.rejects(f.engine.consume(principal, second.registrationPassword!), rejects("ONBOARDING_INVITATION_INVALID"));
  assert.equal(f.rows.get(memberPath).onboardingState, "INVITED"); assert.equal(f.writes.length, 6);
});
