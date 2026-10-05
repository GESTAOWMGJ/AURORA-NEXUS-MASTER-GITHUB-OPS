import { createHash } from "node:crypto";
import { isCompanySlug } from "./auroraTenantEntry.js";

export const PROFILE_VERSION = 1;
export const PROFILE_ROLES = ["viewer", "operator", "auditor", "finance", "director", "org_admin"] as const;
export type ProfileRequest = { requestId: string; email: string; displayName: string; role: string; allFacilities: boolean; facilityIds: string[] };
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
  const allowed = ["action", "requestId", "email", "displayName", "role", "allFacilities", "facilityIds"];
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
  return { requestId: r.requestId, email, displayName, role: String(r.role), allFacilities: r.allFacilities, facilityIds: [...facilityIds].sort() as string[] };
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
