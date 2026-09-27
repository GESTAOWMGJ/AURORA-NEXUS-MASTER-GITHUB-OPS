import { randomBytes, timingSafeEqual } from "node:crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import { auroraAuth, auroraDb } from "./firebase.js";

export const SESSION_COOKIE_NAME = "__session";
export const CSRF_COOKIE_NAME = "__Host-aurora_csrf";
export const DEFAULT_ORG_ID = "wmgj";

export type AuroraMember = {
  uid: string;
  email: string;
  orgId: string;
  role: string;
  permissions: string[];
  facilityIds: string[];
  allFacilities: boolean;
};

export function parseAllowedEmails(raw: string): Set<string> {
  return new Set(raw.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export function isEmailAllowed(email: unknown, raw: string): boolean {
  return typeof email === "string" && parseAllowedEmails(raw).has(email.trim().toLowerCase());
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== name) continue;
    try { return decodeURIComponent(rawValue.join("=")); } catch { return rawValue.join("="); }
  }
  return null;
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
  const snapshot = await auroraDb.doc(`organizations/${orgId}/members/${decoded.uid}`).get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.active !== true || typeof data.role !== "string") return null;
  return {
    uid: decoded.uid,
    email: String(decoded.email ?? ""),
    orgId,
    role: data.role,
    permissions: Array.isArray(data.permissions) ? data.permissions.filter((item): item is string => typeof item === "string") : [],
    facilityIds: Array.isArray(data.facilityIds) ? data.facilityIds.filter((item): item is string => typeof item === "string") : [],
    allFacilities: data.allFacilities === true
  };
}

export async function verifyAuroraAccess(cookieHeader: string | undefined, allowedRaw: string): Promise<AuroraMember | null> {
  const decoded = await verifySession(cookieHeader, allowedRaw);
  return decoded ? resolveMember(decoded) : null;
}

export function can(member: AuroraMember, permission: string, roles: string[] = []): boolean {
  return roles.includes(member.role) || member.permissions.includes(permission);
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function validCsrf(cookieHeader: string | undefined, headerToken: unknown): boolean {
  const cookieToken = parseCookie(cookieHeader, CSRF_COOKIE_NAME);
  if (!cookieToken || typeof headerToken !== "string") return false;
  const left = Buffer.from(cookieToken);
  const right = Buffer.from(headerToken);
  return left.length === right.length && timingSafeEqual(left, right);
}
