import type { DecodedIdToken } from "firebase-admin/auth";
import type { DocumentData, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase.js";

export interface Membership extends DocumentData {
  status?: string;
  permissions?: string[];
  allSites?: boolean;
  siteIds?: string[];
  expiresAt?: { toMillis(): number };
}

export function assertSiteScope(
  member: Membership,
  siteId: string | null,
): void {
  if (member.allSites === true) {
    return;
  }
  if (siteId === null) {
    throw new HttpsError("permission-denied", "SITE_SCOPE_REQUIRED");
  }
  if (!member.siteIds?.includes(siteId)) {
    throw new HttpsError("permission-denied", "SITE_SCOPE_DENIED");
  }
}

export function hasSecondFactor(token: DecodedIdToken): boolean {
  const firebaseClaim = token.firebase as
    | { sign_in_second_factor?: string }
    | undefined;
  return Boolean(firebaseClaim?.sign_in_second_factor);
}

export async function authorizeInTransaction(
  transaction: Transaction,
  uid: string,
  tenantId: string,
  permission: string,
  siteId: string | null,
): Promise<Membership> {
  const memberRef = db.doc(`tenants/${tenantId}/members/${uid}`);
  const memberSnapshot = await transaction.get(memberRef);

  if (!memberSnapshot.exists) {
    throw new HttpsError("permission-denied", "MEMBERSHIP_NOT_FOUND");
  }

  const member = memberSnapshot.data() as Membership;
  if (member.status !== "ACTIVE") {
    throw new HttpsError("permission-denied", "MEMBERSHIP_INACTIVE");
  }

  if (member.expiresAt && member.expiresAt.toMillis() <= Date.now()) {
    throw new HttpsError("permission-denied", "MEMBERSHIP_EXPIRED");
  }

  if (!member.permissions?.includes(permission)) {
    throw new HttpsError("permission-denied", "PERMISSION_MISSING");
  }

  assertSiteScope(member, siteId);

  return member;
}
