import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const HMAC_V2 = "v2";
export const HMAC_CLOCK_SKEW_SECONDS = 300;

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const NONCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;\nconst HMAC_SECRET_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export interface HmacV2Headers {
  signatureVersion: string;
  timestamp: string;
  nonce: string;
  keyId: string;
  orgId: string;
  idempotencyKey: string;
  signature: string;
  method?: string;
  contentType?: string;
}

export interface HmacKeyEntry {
  active: boolean;
  secret: string;
  orgIds: string[];
  entityTypes: string[];
  notBefore?: string;
  expiresAt?: string;
}

export interface VerifiedHmacPrincipal {
  keyId: string;
  orgIds: string[];
  entityTypes: string[];
}

export type HmacVerificationResult =
  | { ok: true; principal: VerifiedHmacPrincipal }
  | {
      ok: false;
      code:
        | "INVALID_SIGNATURE_VERSION"
        | "INVALID_TIMESTAMP"
        | "TIMESTAMP_OUTSIDE_WINDOW"
        | "INVALID_NONCE"
        | "INVALID_KEY_ID"
        | "UNKNOWN_OR_INACTIVE_KEY"
        | "KEY_OUTSIDE_VALIDITY"
        | "ORG_NOT_ALLOWED_FOR_KEY"
        | "INVALID_SIGNATURE"
        | "KEYRING_INVALID";
    };

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalHmacV2Payload(rawBody: Buffer, headers: HmacV2Headers): string {
  return [
    "WMGJ-HMAC-V2",
    String(headers.method || "POST").toUpperCase(),
    normalizeContentType(headers.contentType),
    headers.timestamp,
    headers.nonce,
    headers.keyId,
    headers.orgId,
    headers.idempotencyKey,
    sha256Hex(rawBody)
  ].join("\n");
}

export function signHmacV2(rawBody: Buffer, headers: HmacV2Headers, secret: string): string {
  const key = decodeHmacSecret(secret);
  if (!key) throw new Error("HMAC_SECRET_INVALID");
  return createHmac("sha256", key)
    .update(canonicalHmacV2Payload(rawBody, headers))
    .digest("hex");
}

export function parseHmacKeyring(raw: string): Record<string, HmacKeyEntry> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("HMAC_KEYRING_INVALID_JSON");
  }

  if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
    throw new Error("HMAC_KEYRING_EMPTY");
  }

  const keyring: Record<string, HmacKeyEntry> = {};
  for (const [keyId, value] of Object.entries(parsed)) {
    if (!KEY_ID_PATTERN.test(keyId) || !isRecord(value)) {
      throw new Error("HMAC_KEYRING_INVALID_ENTRY");
    }

    const secret = value.secret;
    const orgIds = value.orgIds;
    const entityTypes = value.entityTypes;
    if (
      typeof value.active !== "boolean" ||
      typeof secret !== "string" ||
      !decodeHmacSecret(secret) ||
      !isNonEmptyStringArray(orgIds) ||
      !isNonEmptyStringArray(entityTypes)
    ) {
      throw new Error("HMAC_KEYRING_INVALID_ENTRY");
    }

    const notBefore = optionalIsoDate(value.notBefore);
    const expiresAt = optionalIsoDate(value.expiresAt);
    keyring[keyId] = {
      active: value.active,
      secret,
      orgIds: [...new Set(orgIds.map((item) => item.trim()))],
      entityTypes: [...new Set(entityTypes.map((item) => item.trim()))],
      ...(notBefore ? { notBefore } : {}),
      ...(expiresAt ? { expiresAt } : {})
    };
  }
  return keyring;
}

export function verifyHmacV2(
  rawBody: Buffer,
  headers: HmacV2Headers,
  rawKeyring: string,
  nowMs = Date.now()
): HmacVerificationResult {
  if (headers.signatureVersion.toLowerCase() !== HMAC_V2) {
    return { ok: false, code: "INVALID_SIGNATURE_VERSION" };
  }
  if (!KEY_ID_PATTERN.test(headers.keyId)) {
    return { ok: false, code: "INVALID_KEY_ID" };
  }
  if (!NONCE_PATTERN.test(headers.nonce)) {
    return { ok: false, code: "INVALID_NONCE" };
  }

  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp)) return { ok: false, code: "INVALID_TIMESTAMP" };
  if (Math.abs(nowMs / 1000 - timestamp) > HMAC_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: "TIMESTAMP_OUTSIDE_WINDOW" };
  }

  let keyring: Record<string, HmacKeyEntry>;
  try {
    keyring = parseHmacKeyring(rawKeyring);
  } catch {
    return { ok: false, code: "KEYRING_INVALID" };
  }

  const key = keyring[headers.keyId];
  if (!key?.active) return { ok: false, code: "UNKNOWN_OR_INACTIVE_KEY" };
  if (!key.orgIds.includes(headers.orgId)) {
    return { ok: false, code: "ORG_NOT_ALLOWED_FOR_KEY" };
  }

  const notBeforeMs = key.notBefore ? Date.parse(key.notBefore) : undefined;
  const expiresAtMs = key.expiresAt ? Date.parse(key.expiresAt) : undefined;
  if (
    (notBeforeMs !== undefined && nowMs < notBeforeMs) ||
    (expiresAtMs !== undefined && nowMs >= expiresAtMs)
  ) {
    return { ok: false, code: "KEY_OUTSIDE_VALIDITY" };
  }

  const expected = signHmacV2(rawBody, headers, key.secret);
  if (!constantTimeHexEquals(expected, headers.signature)) {
    return { ok: false, code: "INVALID_SIGNATURE" };
  }

  return {
    ok: true,
    principal: {
      keyId: headers.keyId,
      orgIds: [...key.orgIds],
      entityTypes: [...key.entityTypes]
    }
  };
}

function decodeHmacSecret(secret: string): Buffer | null {\n  if (!HMAC_SECRET_HEX_PATTERN.test(secret)) return null;\n  const key = Buffer.from(secret, "hex");\n  return key.length === 32 ? key : null;\n}\n\nfunction normalizeContentType(value: string | undefined): string {
  return String(value || "application/json").split(";", 1)[0]?.trim().toLowerCase() || "";
}

function constantTimeHexEquals(expectedHex: string, receivedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedHex, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function optionalIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("HMAC_KEYRING_INVALID_DATE");
  }
  return value;
}
