import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import { auroraAuth, auroraDb } from "./firebase.js";

export const SESSION_COOKIE_NAME = "__session";
export const DEFAULT_ORG_ID = "wmgj";
const CSRF_CONTEXT = "aurora-csrf\0v1\0";
export const CSRF_PURPOSES = {
  action: "POST:/api/actions",
  refresh: "POST:/api/refresh",
  organic: "POST:/organic",
  crypto: "POST:/api/crypto/self-test",
  integrationKey: "POST:/api/integration-keys",
  logout: "POST:/__sessionLogout"
} as const;
export type CsrfPurpose = typeof CSRF_PURPOSES[keyof typeof CSRF_PURPOSES];

export type AuroraMember = {
  uid: string;
  email: string;
  orgId: string;
  role: string;
  permissions: string[];
  facilityIds: string[];
  allFacilities: boolean;
  mfaVerified: boolean;
};

export function parseAllowedEmails(raw: string): Set<string> {
  return new Set(raw.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export function isEmailAllowed(email: unknown, raw: string): boolean {
  return typeof email === "string" && parseAllowedEmails(raw).has(email.trim().toLowerCase());
}

export function isActiveOrganization(data: Record<string, unknown> | undefined): boolean {
  return data?.active === true;
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  let found: string | null = null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== name) continue;
    if (found !== null) return null;
    try { found = decodeURIComponent(rawValue.join("=")); } catch { found = rawValue.join("="); }
  }
  return found;
}

export async function verifySession(cookieHeader: string | undefined, allowedRaw: string): Promise<DecodedIdToken | null> {
  const cookie = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!cookie) return null;
  try {
    const decoded = await auroraAuth.verifySessionCookie(cookie, true);
    return isEmailAllowed(decoded.email, allowedRaw) ? decoded : null;
  } catch (error) {
    logger.warn("Aurora Nexus session rejected", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function resolveMember(decoded: DecodedIdToken, orgId = DEFAULT_ORG_ID): Promise<AuroraMember | null> {
  const [snapshot, organization] = await Promise.all([
    auroraDb.doc(`organizations/${orgId}/members/${decoded.uid}`).get(),
    auroraDb.doc(`organizations/${orgId}`).get()
  ]);
  const data = snapshot.data();
  if (!organization.exists || !isActiveOrganization(organization.data())) return null;
  if (!snapshot.exists || data?.active !== true || typeof data.role !== "string") return null;
  return {
    uid: decoded.uid,
    email: String(decoded.email ?? ""),
    orgId,
    role: data.role,
    permissions: Array.isArray(data.permissions) ? data.permissions.filter((item): item is string => typeof item === "string") : [],
    facilityIds: Array.isArray(data.facilityIds) ? data.facilityIds.filter((item): item is string => typeof item === "string") : [],
    allFacilities: data.allFacilities === true,
    mfaVerified: Boolean(decoded.firebase?.sign_in_second_factor)
  };
}

export async function verifyAuroraAccess(cookieHeader: string | undefined, allowedRaw: string): Promise<AuroraMember | null> {
  const decoded = await verifySession(cookieHeader, allowedRaw);
  return decoded ? resolveMember(decoded) : null;
}

export function can(member: AuroraMember, permission: string, roles: string[] = []): boolean {
  return roles.includes(member.role) || member.permissions.includes(permission);
}

function csrfKey(raw: string): Buffer | null {
  return /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null;
}

function csrfSignature(sessionCookie: string, nonce: string, secretHex: string, purpose: CsrfPurpose): string | null {
  const key = csrfKey(secretHex);
  if (!key) return null;
  const sessionHash = createHash("sha256").update(sessionCookie, "utf8").digest("hex");
  return createHmac("sha256", key)
    .update(`${CSRF_CONTEXT}${purpose}\0${sessionHash}\0${nonce}`, "utf8")
    .digest("base64url");
}

/**
 * Firebase Hosting forwards only the specially named __session cookie through
 * rewrites. Bind a fresh page token cryptographically to that session instead
 * of relying on a second cookie that Hosting would strip.
 */
export function csrfTokenForSession(cookieHeader: string | undefined, secretHex: string, purpose: CsrfPurpose): string | null {
  const sessionCookie = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!sessionCookie) return null;
  const nonce = randomBytes(32).toString("base64url");
  const signature = csrfSignature(sessionCookie, nonce, secretHex, purpose);
  return signature ? `v1.${nonce}.${signature}` : null;
}

export function validCsrf(cookieHeader: string | undefined, headerToken: unknown, secretHex: string, purpose: CsrfPurpose): boolean {
  const sessionCookie = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!sessionCookie || typeof headerToken !== "string" || headerToken.length > 1000) return false;
  const match = headerToken.match(/^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  const nonce = match[1];
  const supplied = match[2];
  if (!nonce || !supplied) return false;
  const expected = csrfSignature(sessionCookie, nonce, secretHex, purpose);
  if (!expected) return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
