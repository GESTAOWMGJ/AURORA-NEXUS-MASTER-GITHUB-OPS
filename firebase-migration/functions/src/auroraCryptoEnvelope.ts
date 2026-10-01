import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export const AURORA_CRYPTO_ENVELOPE_VERSION = 1;
export const AURORA_CRYPTO_ALGORITHM = "AES-256-GCM";
export const AURORA_DEK_BYTES = 32;
export const AURORA_GCM_NONCE_BYTES = 12;
export const AURORA_GCM_TAG_BYTES = 16;
export const AURORA_CRYPTO_MAX_PLAINTEXT_BYTES = 1024 * 1024;

const RESOURCE_PATTERN =
  /^projects\/[a-z0-9][a-z0-9-]{4,62}\/(?:locations)\/[a-z0-9-]+\/keyRings\/[a-z][a-z0-9_-]{0,62}\/cryptoKeys\/[a-z][a-z0-9_-]{0,62}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type CryptoAad = {
  orgId: string;
  entityType: string;
  schemaVersion: string;
  logicalId: string;
};

export type AuroraEncryptedEnvelope = {
  envelopeVersion: 1;
  algorithm: "AES-256-GCM";
  keyResource: string;
  keyVersion: string | null;
  wrappedDek: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
  aadSha256: string;
};

export type WrappedDek = {
  ciphertext: Buffer;
  keyVersion?: string;
};

export interface EnvelopeKey {
  readonly keyResource: string;
  wrapKey(dek: Buffer, aad: Buffer): Promise<WrappedDek>;
  unwrapKey(wrappedDek: Buffer, aad: Buffer): Promise<Buffer>;
}

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

type FetchLike = typeof fetch;

export function canonicalCryptoAad(aad: CryptoAad): Buffer {
  for (const [name, value] of Object.entries(aad)) {
    if (typeof value !== "string" || !SAFE_ID.test(value)) {
      throw new Error(`CRYPTO_AAD_INVALID:${name}`);
    }
  }
  return Buffer.from(JSON.stringify({
    orgId: aad.orgId,
    entityType: aad.entityType,
    schemaVersion: aad.schemaVersion,
    logicalId: aad.logicalId
  }), "utf8");
}

export function sha256Base64Url(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("base64url");
}

export async function encryptEnvelope(
  plaintext: string | Buffer,
  aad: CryptoAad,
  key: EnvelopeKey
): Promise<AuroraEncryptedEnvelope> {
  validateKeyResource(key.keyResource);
  const clear = Buffer.isBuffer(plaintext) ? Buffer.from(plaintext) : Buffer.from(plaintext, "utf8");
  if (clear.length === 0 || clear.length > AURORA_CRYPTO_MAX_PLAINTEXT_BYTES) {
    clear.fill(0);
    throw new Error("CRYPTO_PLAINTEXT_SIZE_INVALID");
  }

  const aadBytes = canonicalCryptoAad(aad);
  const aadSha256 = sha256Base64Url(aadBytes);
  const dek = randomBytes(AURORA_DEK_BYTES);
  const nonce = randomBytes(AURORA_GCM_NONCE_BYTES);

  try {
    const wrapped = await key.wrapKey(dek, aadBytes);
    if (!Buffer.isBuffer(wrapped.ciphertext) || wrapped.ciphertext.length < 16) {
      throw new Error("CRYPTO_WRAPPED_DEK_INVALID");
    }

    const cipher = createCipheriv("aes-256-gcm", dek, nonce, {
      authTagLength: AURORA_GCM_TAG_BYTES
    });
    cipher.setAAD(aadBytes, { plaintextLength: clear.length });
    const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      envelopeVersion: AURORA_CRYPTO_ENVELOPE_VERSION,
      algorithm: AURORA_CRYPTO_ALGORITHM,
      keyResource: key.keyResource,
      keyVersion: wrapped.keyVersion ?? null,
      wrappedDek: wrapped.ciphertext.toString("base64"),
      nonce: nonce.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      aadSha256
    };
  } finally {
    dek.fill(0);
    clear.fill(0);
  }
}

export async function decryptEnvelope(
  envelope: AuroraEncryptedEnvelope,
  aad: CryptoAad,
  key: EnvelopeKey
): Promise<Buffer> {
  validateEnvelope(envelope);
  validateKeyResource(key.keyResource);
  if (envelope.keyResource !== key.keyResource) {
    throw new Error("CRYPTO_KEY_RESOURCE_MISMATCH");
  }

  const aadBytes = canonicalCryptoAad(aad);
  const expectedAadHash = Buffer.from(sha256Base64Url(aadBytes), "utf8");
  const receivedAadHash = Buffer.from(envelope.aadSha256, "utf8");
  if (
    expectedAadHash.length !== receivedAadHash.length ||
    !timingSafeEqual(expectedAadHash, receivedAadHash)
  ) {
    throw new Error("CRYPTO_AAD_MISMATCH");
  }

  const wrappedDek = decodeBase64(envelope.wrappedDek, 16, 16 * 1024, "WRAPPED_DEK");
  const nonce = decodeBase64(envelope.nonce, AURORA_GCM_NONCE_BYTES, AURORA_GCM_NONCE_BYTES, "NONCE");
  const authTag = decodeBase64(envelope.authTag, AURORA_GCM_TAG_BYTES, AURORA_GCM_TAG_BYTES, "AUTH_TAG");
  const ciphertext = decodeBase64(envelope.ciphertext, 1, AURORA_CRYPTO_MAX_PLAINTEXT_BYTES + AURORA_GCM_TAG_BYTES, "CIPHERTEXT");
  const dek = await key.unwrapKey(wrappedDek, aadBytes);
  if (dek.length !== AURORA_DEK_BYTES) {
    dek.fill(0);
    throw new Error("CRYPTO_DEK_LENGTH_INVALID");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, nonce, {
      authTagLength: AURORA_GCM_TAG_BYTES
    });
    decipher.setAAD(aadBytes, { plaintextLength: ciphertext.length });
    decipher.setAuthTag(authTag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new Error("CRYPTO_AUTHENTICATION_FAILED");
    }
  } finally {
    dek.fill(0);
  }
}

export function validateEnvelope(value: AuroraEncryptedEnvelope): void {
  if (
    !value ||
    value.envelopeVersion !== AURORA_CRYPTO_ENVELOPE_VERSION ||
    value.algorithm !== AURORA_CRYPTO_ALGORITHM
  ) {
    throw new Error("CRYPTO_ENVELOPE_VERSION_OR_ALGORITHM_INVALID");
  }
  validateKeyResource(value.keyResource);
  if (value.keyVersion !== null && (typeof value.keyVersion !== "string" || value.keyVersion.length > 300)) {
    throw new Error("CRYPTO_KEY_VERSION_INVALID");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(value.aadSha256)) {
    throw new Error("CRYPTO_AAD_HASH_INVALID");
  }
  decodeBase64(value.wrappedDek, 16, 16 * 1024, "WRAPPED_DEK");
  decodeBase64(value.nonce, AURORA_GCM_NONCE_BYTES, AURORA_GCM_NONCE_BYTES, "NONCE");
  decodeBase64(value.authTag, AURORA_GCM_TAG_BYTES, AURORA_GCM_TAG_BYTES, "AUTH_TAG");
  decodeBase64(value.ciphertext, 1, AURORA_CRYPTO_MAX_PLAINTEXT_BYTES + AURORA_GCM_TAG_BYTES, "CIPHERTEXT");
}

export class GoogleMetadataAccessTokenProvider implements AccessTokenProvider {
  private cached: { token: string; expiresAtMs: number } | null = null;
  private readonly fetcher: FetchLike;

  constructor(fetcher: FetchLike = globalThis.fetch) {
    this.fetcher = fetcher;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs - 30_000 > now) return this.cached.token;

    const response = await this.fetcher(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(3000)
      }
    );
    if (!response.ok) throw new Error(`KMS_METADATA_TOKEN_FAILED:${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const token = typeof body.access_token === "string" ? body.access_token : "";
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 0;
    if (!token || expiresIn < 60) throw new Error("KMS_METADATA_TOKEN_INVALID");
    this.cached = { token, expiresAtMs: now + expiresIn * 1000 };
    return token;
  }
}

export class GoogleKmsEnvelopeKey implements EnvelopeKey {
  readonly keyResource: string;
  private readonly tokenProvider: AccessTokenProvider;
  private readonly fetcher: FetchLike;

  constructor(
    keyResource: string,
    tokenProvider: AccessTokenProvider = new GoogleMetadataAccessTokenProvider(),
    fetcher: FetchLike = globalThis.fetch
  ) {
    validateKeyResource(keyResource);
    this.keyResource = keyResource;
    this.tokenProvider = tokenProvider;
    this.fetcher = fetcher;
  }

  async wrapKey(dek: Buffer, aad: Buffer): Promise<WrappedDek> {
    if (dek.length !== AURORA_DEK_BYTES) throw new Error("KMS_DEK_LENGTH_INVALID");
    const body = await this.call("encrypt", {
      plaintext: dek.toString("base64"),
      additionalAuthenticatedData: aad.toString("base64")
    });
    const ciphertext = requiredBase64(body.ciphertext, "KMS_ENCRYPT_RESPONSE_INVALID");
    const keyVersion = typeof body.name === "string" && body.name.length <= 300 ? body.name : undefined;
    return { ciphertext, ...(keyVersion ? { keyVersion } : {}) };
  }

  async unwrapKey(wrappedDek: Buffer, aad: Buffer): Promise<Buffer> {
    const body = await this.call("decrypt", {
      ciphertext: wrappedDek.toString("base64"),
      additionalAuthenticatedData: aad.toString("base64")
    });
    return requiredBase64(body.plaintext, "KMS_DECRYPT_RESPONSE_INVALID");
  }

  private async call(method: "encrypt" | "decrypt", payload: Record<string, string>): Promise<Record<string, unknown>> {
    const token = await this.tokenProvider.getAccessToken();
    const response = await this.fetcher(
      `https://cloudkms.googleapis.com/v1/${this.keyResource}:${method}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000)
      }
    );
    if (!response.ok) throw new Error(`KMS_${method.toUpperCase()}_FAILED:${response.status}`);
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error(`KMS_${method.toUpperCase()}_RESPONSE_INVALID`);
    }
    return body as Record<string, unknown>;
  }
}

function validateKeyResource(resource: string): void {
  if (!RESOURCE_PATTERN.test(resource)) throw new Error("CRYPTO_KEY_RESOURCE_INVALID");
}

function requiredBase64(value: unknown, code: string): Buffer {
  if (typeof value !== "string") throw new Error(code);
  try {
    return decodeBase64(value, 1, 64 * 1024, code);
  } catch {
    throw new Error(code);
  }
}

function decodeBase64(value: string, minBytes: number, maxBytes: number, label: string): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
    !BASE64.test(value)
  ) {
    throw new Error(`CRYPTO_${label}_BASE64_INVALID`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length < minBytes || decoded.length > maxBytes) {
    throw new Error(`CRYPTO_${label}_LENGTH_INVALID`);
  }
  const normalizedInput = value.replace(/=+$/, "");
  const normalizedRoundTrip = decoded.toString("base64").replace(/=+$/, "");
  if (normalizedInput !== normalizedRoundTrip) throw new Error(`CRYPTO_${label}_BASE64_INVALID`);
  return decoded;
}
