import { createHash } from "node:crypto";
import { isCompanySlug } from "./auroraTenantEntry.js";

export const PROFILE_VERSION = 1;
export const PROFILE_ROLES = ["viewer", "operator", "auditor", "finance", "director", "org_admin"] as const;
export type ProfileOnboarding = { jobTitle: string; duties: string[]; managerUid: string; welcomeDueHours: number };
export type ProfileRequest = { requestId: string; email: string; displayName: string; role: string; allFacilities: boolean; facilityIds: string[]; onboarding?: ProfileOnboarding };
export type ProfileActor = { uid: string; orgId: string; role: string; allFacilities: boolean; mfaVerified: boolean };
export class ProfileError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export function profileAdmin(actor: ProfileActor): boolean {
  return typeof actor.uid === "string" && actor.uid.length > 0 && actor.uid.length <= 128
    && !/[\/\x00-\x1f]/.test(actor.uid) && isCompanySlug(actor.orgId) && actor.allFacilities && actor.mfaVerified
    && ["org_admin", "platform_admin"].includes(actor.role);
}
export function normalizeProfileRequest(raw: unknown): ProfileRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProfileError("INVALID_PROFILE", 400);
  const r = raw as Record<string, unknown>;
  const allowed = ["action", "requestId", "email", "displayName", "role", "allFacilities", "facilityIds", "onboarding"];
  if (Object.keys(r).some(k => !allowed.includes(k)) || r.action !== "CREATE") throw new ProfileError("INVALID_PROFILE", 400);
  const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
  const displayName = typeof r.displayName === "string" ? r.displayName.trim() : "";
  const facilityIds = Array.isArray(r.facilityIds) ? r.facilityIds : [];
  if (typeof r.requestId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(r.requestId)
      || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || displayName.length < 2 || displayName.length > 80 || /[\x00-\x1f<>]/.test(displayName)
      || !PROFILE_ROLES.includes(r.role as typeof PROFILE_ROLES[number])
      || typeof r.allFacilities !== "boolean" || !Array.isArray(r.facilityIds)
      || facilityIds.length > 50 || facilityIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id))
      || new Set(facilityIds).size !== facilityIds.length
      || (r.allFacilities ? facilityIds.length !== 0 : facilityIds.length === 0)
      || (["org_admin", "director"].includes(String(r.role)) && !r.allFacilities)) {
    throw new ProfileError("INVALID_PROFILE", 400);
  }
  const onboarding = "onboarding" in r ? normalizeProfileOnboarding(r.onboarding) : undefined;
  return { requestId: r.requestId, email, displayName, role: String(r.role), allFacilities: r.allFacilities, facilityIds: [...facilityIds].sort() as string[],
    ...(onboarding ? { onboarding } : {}) };
}
export function normalizeProfileOnboarding(raw: unknown): ProfileOnboarding {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProfileError("INVALID_ONBOARDING", 400);
  const r = raw as Record<string, unknown>;
  const keys = ["jobTitle", "duties", "managerUid", "welcomeDueHours"];
  if (Object.keys(r).length !== keys.length || Object.keys(r).some(key => !keys.includes(key))) throw new ProfileError("INVALID_ONBOARDING", 400);
  const text = (value: unknown, max: number): string => {
    if (typeof value !== "string" || /[\x00-\x1f<>]/.test(value)) throw new ProfileError("INVALID_ONBOARDING", 400);
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length < 2 || normalized.length > max) throw new ProfileError("INVALID_ONBOARDING", 400);
    return normalized;
  };
  const jobTitle = text(r.jobTitle, 80);
  if (!Array.isArray(r.duties) || r.duties.length < 1 || r.duties.length > 20) throw new ProfileError("INVALID_ONBOARDING", 400);
  const duties = r.duties.map(value => text(value, 160)).sort();
  if (new Set(duties).size !== duties.length || typeof r.managerUid !== "string" || r.managerUid.length < 1
      || r.managerUid.length > 128 || /[\/\x00-\x1f]/.test(r.managerUid)
      || !Number.isSafeInteger(r.welcomeDueHours) || Number(r.welcomeDueHours) < 1 || Number(r.welcomeDueHours) > 720) {
    throw new ProfileError("INVALID_ONBOARDING", 400);
  }
  return { jobTitle, duties, managerUid: r.managerUid, welcomeDueHours: Number(r.welcomeDueHours) };
}
export function profileIdentity(actor: ProfileActor, request: ProfileRequest) {
  if (!profileAdmin(actor)) throw new ProfileError("PROFILE_ADMIN_MFA_REQUIRED", 403);
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const operationId = `profile-${hash(`${actor.orgId}\0${request.requestId}`)}`;
  return { operationId, uid: `anx_${hash(operationId).slice(0,40)}`,
    fingerprint: hash(JSON.stringify({ orgId: actor.orgId, actorUid: actor.uid, ...request })) };
}
// Claims select an identity; only a current, server-provisioned membership grants access.
export function managedProfileMatches(decoded: Record<string, any>, data: Record<string, any> | undefined, orgId: string): boolean {
  return decoded.auroraProfileVersion === PROFILE_VERSION && decoded.auroraOrgId === orgId
    && decoded.email_verified === true && Boolean(decoded.firebase?.sign_in_second_factor)
    && typeof decoded.email === "string" && data?.authEmail === decoded.email.trim().toLowerCase()
    && data?.profileVersion === PROFILE_VERSION && data?.profileState === "READY" && data?.active === true
    && typeof decoded.auroraProfileOperation === "string" && /^profile-[a-f0-9]{64}$/.test(decoded.auroraProfileOperation)
    && data?.profileOperationId === decoded.auroraProfileOperation;
}
