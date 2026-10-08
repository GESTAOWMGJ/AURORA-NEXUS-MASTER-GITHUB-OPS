import { createHash, createPublicKey, verify } from "node:crypto";

export const ACTIVE_RELEASE_SOURCE = "platformRuntime/activeRelease" as const;
export const ACTIVE_RELEASE_ORIGIN = "https://auroranexus.com.br";
export type ReleaseComponent = "server" | "web" | "satellite";
export type ReleaseComponentPin = { version: string; sourceSha: string; manifestSha256: string };
export type ActiveReleaseCertificate = {
  schemaVersion: 1; sourceSha: string; productVersion: string; canonicalOrigin: string;
  releaseRunId: string; ciRunId: string; publishedAtUtc: string; status: "ACTIVE";
  checks: { ciPassed: boolean; humanReviewApproved: boolean; protectedDeploySucceeded: boolean; smokePassed: boolean };
  components: { server: ReleaseComponentPin; web: ReleaseComponentPin; satellite?: ReleaseComponentPin };
};
export type ActiveReleaseEnvelope = { certificate: ActiveReleaseCertificate; signature: string };
const pinBrand: unique symbol = Symbol("verified-canonical-active-release");
export type VerifiedActiveRelease = { readonly certificate: ActiveReleaseCertificate; readonly certificateSha256: string; readonly [pinBrand]: true };
const pins = new WeakSet<object>();
type Check = { now?: number; expectedSourceSha?: string };
type Failure = { status: "NO_ACTIVE_PIN" | "INVALID_ACTIVE_PIN"; reason: string };
export type ActiveReleaseAssessment = Failure | { status: "VERIFIED_ACTIVE_PIN"; pin: VerifiedActiveRelease };
export type CandidateAssessment = Failure | { status: "CANDIDATE_UNVERIFIED"; reason: "SIGNATURE_VALID_WITHOUT_CANONICAL_POINTER"; certificate: ActiveReleaseCertificate; certificateSha256: string };

const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sha = (value: unknown, size = 40): value is string => typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const version = (value: unknown): value is string => typeof value === "string" && value.length <= 80
  && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(value);
const row = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const utc = (value: unknown): value is string => typeof value === "string" && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (row(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Signing serialization; it does not sign, promote or attest a release. */
export function activeReleaseSigningBytes(certificate: ActiveReleaseCertificate): Buffer {
  return Buffer.from("AURORA_ACTIVE_RELEASE_V1\0" + canonical(certificate), "utf8");
}
function parseCertificate(value: unknown): ActiveReleaseCertificate | undefined {
  if (!row(value) || !exactKeys(value, ["schemaVersion", "sourceSha", "productVersion", "canonicalOrigin", "releaseRunId", "ciRunId", "publishedAtUtc", "status", "checks", "components"])
      || value.schemaVersion !== 1 || !sha(value.sourceSha) || !version(value.productVersion)
      || value.canonicalOrigin !== ACTIVE_RELEASE_ORIGIN || value.status !== "ACTIVE" || !utc(value.publishedAtUtc)
      || ![value.releaseRunId, value.ciRunId].every(id => typeof id === "string" && /^[1-9][0-9]{0,19}$/.test(id))) return;
  const checks = ["ciPassed", "humanReviewApproved", "protectedDeploySucceeded", "smokePassed"];
  if (!row(value.checks) || !exactKeys(value.checks, checks) || checks.some(key => typeof value.checks[key] !== "boolean")) return;
  if (!row(value.components) || !Object.hasOwn(value.components, "server") || !Object.hasOwn(value.components, "web")
      || Object.keys(value.components).some(key => !["server", "web", "satellite"].includes(key))) return;
  for (const component of Object.values(value.components)) {
    if (!row(component) || !exactKeys(component, ["version", "sourceSha", "manifestSha256"])
        || !version(component.version) || component.sourceSha !== value.sourceSha || !sha(component.manifestSha256, 64)) return;
  }
  return structuredClone(value) as ActiveReleaseCertificate;
}
/** A caller-supplied signed envelope is still not evidence of the currently active pointer. */
export function verifyActiveReleaseEnvelope(raw: unknown, publicKeySpkiPem?: string, options: Check = {}): CandidateAssessment {
  if (!publicKeySpkiPem?.trim()) return { status: "NO_ACTIVE_PIN", reason: "VERIFICATION_KEY_UNCONFIGURED" };
  if (raw === undefined || raw === null) return { status: "NO_ACTIVE_PIN", reason: "CANONICAL_POINTER_ABSENT" };
  if (!row(raw) || !exactKeys(raw, ["certificate", "signature"]) || typeof raw.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(raw.signature)) {
    return { status: "INVALID_ACTIVE_PIN", reason: "INVALID_ENVELOPE" };
  }
  const certificate = parseCertificate(raw.certificate);
  if (!certificate || activeReleaseSigningBytes(certificate).length > 16_384) return { status: "INVALID_ACTIVE_PIN", reason: "INVALID_CERTIFICATE" };
  try {
    if (publicKeySpkiPem.length > 8192 || !/^-----BEGIN PUBLIC KEY-----\r?\n/.test(publicKeySpkiPem.trim())) throw new Error();
    const key = createPublicKey({ key: publicKeySpkiPem, format: "pem", type: "spki" });
    const signature = Buffer.from(raw.signature, "base64url");
    if (key.asymmetricKeyType !== "ed25519" || signature.toString("base64url") !== raw.signature
        || !verify(null, activeReleaseSigningBytes(certificate), key, signature)) return { status: "INVALID_ACTIVE_PIN", reason: "SIGNATURE_REJECTED" };
  } catch { return { status: "INVALID_ACTIVE_PIN", reason: "VERIFICATION_KEY_OR_SIGNATURE_INVALID" }; }
  if (Object.values(certificate.checks).some(passed => passed !== true)) return { status: "INVALID_ACTIVE_PIN", reason: "RELEASE_GATES_PENDING" };
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0 || Date.parse(certificate.publishedAtUtc) > now) return { status: "INVALID_ACTIVE_PIN", reason: "INVALID_PUBLICATION_TIME" };
  if (options.expectedSourceSha !== undefined && (!sha(options.expectedSourceSha) || certificate.sourceSha !== options.expectedSourceSha)) {
    return { status: "INVALID_ACTIVE_PIN", reason: "EXPECTED_SOURCE_CONFLICT" };
  }
  return { status: "CANDIDATE_UNVERIFIED", reason: "SIGNATURE_VALID_WITHOUT_CANONICAL_POINTER", certificate,
    certificateSha256: hash(activeReleaseSigningBytes(certificate)) };
}
export type CanonicalActiveReleaseSource = {
  sourceId: typeof ACTIVE_RELEASE_SOURCE;
  publicKeySpkiPem?: string;
  /** Server-owned Admin SDK callback for this exact protected document; never a request body or client callback. */
  readProtectedEnvelope: () => Promise<unknown>;
  now?: number;
  expectedSourceSha?: string;
};
/** Call only from the trusted server adapter. Signature and current protected document are both required. */
export async function readCanonicalActiveRelease(source: CanonicalActiveReleaseSource): Promise<ActiveReleaseAssessment> {
  if (source.sourceId !== ACTIVE_RELEASE_SOURCE) return { status: "NO_ACTIVE_PIN", reason: "CANONICAL_PROVENANCE_UNAVAILABLE" };
  if (!source.publicKeySpkiPem?.trim()) return { status: "NO_ACTIVE_PIN", reason: "VERIFICATION_KEY_UNCONFIGURED" };
  let envelope: unknown;
  try { envelope = await source.readProtectedEnvelope(); }
  catch { return { status: "NO_ACTIVE_PIN", reason: "CANONICAL_POINTER_UNAVAILABLE" }; }
  const verified = verifyActiveReleaseEnvelope(envelope, source.publicKeySpkiPem, source);
  if (verified.status !== "CANDIDATE_UNVERIFIED") return verified;
  for (const component of Object.values(verified.certificate.components)) Object.freeze(component);
  Object.freeze(verified.certificate.components); Object.freeze(verified.certificate.checks); Object.freeze(verified.certificate);
  const pin: VerifiedActiveRelease = Object.freeze({ certificate: verified.certificate, certificateSha256: verified.certificateSha256, [pinBrand]: true as const });
  pins.add(pin);
  return { status: "VERIFIED_ACTIVE_PIN", pin };
}
const validPin = (pin: VerifiedActiveRelease | undefined): pin is VerifiedActiveRelease => Boolean(pin && pins.has(pin));
export function assessReleaseManifest(pin: VerifiedActiveRelease | undefined, component: ReleaseComponent, manifestBytes: Uint8Array,
  fileBytes?: Record<string, Uint8Array>) {
  const expected = validPin(pin) ? pin.certificate.components[component] : undefined;
  if (!expected) return { status: "NO_ACTIVE_PIN", fileIntegrityVerified: false };
  if (!(manifestBytes instanceof Uint8Array) || manifestBytes.length > 65_536 || hash(manifestBytes) !== expected.manifestSha256) {
    return { status: "MANIFEST_CONFLICT", fileIntegrityVerified: false };
  }
  let manifest: Record<string, any>;
  try { manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8")); }
  catch { return { status: "INVALID_MANIFEST", fileIntegrityVerified: false }; }
  if (!row(manifest)) return { status: "INVALID_MANIFEST", fileIntegrityVerified: false };
  const sources = [manifest.sourceSha, manifest.sourceCommit, manifest.sourceRevision].filter(value => value !== undefined);
  const versions = [manifest.version, manifest.clientVersion].filter(value => value !== undefined);
  if (!sources.length || !versions.length || sources.some(value => value !== expected.sourceSha) || versions.some(value => value !== expected.version)
      || manifest.dirty === true) return { status: "MANIFEST_IDENTITY_CONFLICT", fileIntegrityVerified: false };
  if (fileBytes === undefined) return { status: "MANIFEST_MATCH_ONLY", fileIntegrityVerified: false };
  const claims: { name: string; digest: unknown; size?: number }[] = [];
  if (Array.isArray(manifest.files)) {
    for (const entry of manifest.files) {
      if (!row(entry) || !exactKeys(entry, ["name", "label", "platform", "size", "sha256", "signed"])
          || typeof entry.name !== "string" || typeof entry.label !== "string" || !entry.label.length || entry.label.length > 100
          || !["mac", "windows"].includes(entry.platform) || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 16_777_216
          || typeof entry.signed !== "boolean") return { status: "PACKAGE_FILES_CONFLICT", fileIntegrityVerified: false };
      claims.push({ name: entry.name, digest: entry.sha256, size: entry.size });
    }
  } else if (row(manifest.files)) {
    claims.push(...Object.entries(manifest.files).map(([name, digest]) => ({ name, digest })));
  }
  if (!claims.length || claims.length > 1000 || new Set(claims.map(claim => claim.name)).size !== claims.length
      || Object.keys(fileBytes).length !== claims.length) return { status: "PACKAGE_FILES_CONFLICT", fileIntegrityVerified: false };
  for (const { name, digest, size } of claims) {
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith("/") || name.split("/").some(part => !part || part === "." || part === "..")
        || !sha(digest, 64) || !Object.hasOwn(fileBytes, name) || !(fileBytes[name] instanceof Uint8Array)
        || (size !== undefined && fileBytes[name].length !== size) || hash(fileBytes[name]) !== digest) {
      return { status: "PACKAGE_FILES_CONFLICT", fileIntegrityVerified: false };
    }
  }
  return { status: "PACKAGE_FILES_VERIFIED", fileIntegrityVerified: true };
}
export function assessActiveReleaseReceipt(pin: VerifiedActiveRelease | undefined, component: ReleaseComponent, receipt: unknown,
  options: { now?: number; maxAgeMs?: number } = {}) {
  const result = (status: string, reportedCurrent = false) => ({ status, reportedCurrent, deviceInstallationVerified: false });
  const expected = validPin(pin) ? pin.certificate.components[component] : undefined;
  if (!expected) return result("NO_ACTIVE_PIN");
  if (receipt === undefined || receipt === null) return result("NOT_REPORTED");
  if (!row(receipt) || !exactKeys(receipt, ["sourceSha", "version", "manifestSha256", "checkedAt", "connected", "applied"])
      || !sha(receipt.sourceSha) || !version(receipt.version) || !sha(receipt.manifestSha256, 64) || !utc(receipt.checkedAt)
      || typeof receipt.connected !== "boolean" || typeof receipt.applied !== "boolean") return result("INVALID_RECEIPT");
  if (!receipt.connected) return result("OFFLINE_PENDING");
  if (!receipt.applied) return result("UPDATE_NOT_APPLIED");
  const now = options.now ?? Date.now(), maxAge = options.maxAgeMs ?? 86_400_000, checkedAt = Date.parse(receipt.checkedAt);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > 86_400_000
      || checkedAt > now || checkedAt < Date.parse(pin!.certificate.publishedAtUtc) || now - checkedAt > maxAge) return result("STALE_RECEIPT");
  if (receipt.sourceSha !== expected.sourceSha || receipt.version !== expected.version || receipt.manifestSha256 !== expected.manifestSha256) return result("VERSION_CONFLICT");
  return result("MATCH_REPORTED", true);
}
