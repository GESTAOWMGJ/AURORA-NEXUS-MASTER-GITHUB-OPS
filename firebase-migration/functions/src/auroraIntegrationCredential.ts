import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const INTEGRATION_SCOPES = [
  "integration.read",
  "integration.write",
  "documents.ingest",
  "reconciliation.read"
] as const;
export type IntegrationScope = typeof INTEGRATION_SCOPES[number];

export type IssuedIntegrationCredential = {
  keyId: string;
  apiKey: string;
  tokenHash: string;
  expiresAt: Date;
  scopes: IntegrationScope[];
};

const KEY_RE = /^anx_(ik_[a-f0-9]{16})\.([A-Za-z0-9_-]{43})$/;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeScopes(input: unknown): IntegrationScope[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > INTEGRATION_SCOPES.length) return null;
  const allowed = new Set<string>(INTEGRATION_SCOPES);
  const values = [...new Set(input)];
  if (values.some((value) => typeof value !== "string" || !allowed.has(value))) return null;
  return values as IntegrationScope[];
}

export function issueIntegrationCredential(
  scopes: IntegrationScope[],
  days: number,
  now = new Date()
): IssuedIntegrationCredential {
  const normalized = normalizeScopes(scopes);
  if (!normalized) throw new Error("INVALID_SCOPES");
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error("INVALID_EXPIRATION");
  const keyId = "ik_" + randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const apiKey = `anx_${keyId}.${secret}`;
  return {
    keyId,
    apiKey,
    tokenHash: sha256Hex(apiKey),
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
    scopes: normalized
  };
}

export function parseIntegrationApiKey(value: unknown): { keyId: string; apiKey: string } | null {
  if (typeof value !== "string" || value.length > 160) return null;
  const match = value.match(KEY_RE);
  if (!match?.[1]) return null;
  return { keyId: match[1], apiKey: value };
}

export function tokenHashMatches(apiKey: string, expectedHash: unknown): boolean {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(sha256Hex(apiKey), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function credentialAllowsScope(data: Record<string, unknown>, scope: IntegrationScope, now = new Date()): boolean {
  if (data.active !== true || !Array.isArray(data.scopes) || !data.scopes.includes(scope)) return false;
  const expiresAt = data.expiresAt;
  if (!expiresAt || typeof expiresAt !== "object" || !("toDate" in expiresAt) || typeof (expiresAt as {toDate?:unknown}).toDate !== "function") return false;
  return (expiresAt as {toDate():Date}).toDate().getTime() > now.getTime();
}
