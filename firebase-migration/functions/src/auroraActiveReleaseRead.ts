import { ACTIVE_RELEASE_ORIGIN, ACTIVE_RELEASE_SOURCE, assessReleaseComponentCoverage,
  readCanonicalActiveRelease, verifyActiveReleaseEnvelope } from "./auroraActiveRelease.js";

export const ACTIVE_RELEASE_READ_PATH = "/api/integration/active-release";
export const ACTIVE_RELEASE_READ_SCHEMA = "aurora.active-release-read.v1";
type Principal = { orgId: string; keyId: string; name: string };
type RuntimeReadback = {
  verification: { status: string; certificateSha256?: string };
  runtimeBuild: { sourceSha: string | null; manifestSha256: string | null; fileIntegrityVerified: boolean };
  runtimeBuildWeb: { sourceSha: string | null; manifestSha256: string | null; fileIntegrityVerified: boolean };
  localServer: { fileIntegrityVerified: boolean };
  localWeb?: { fileIntegrityVerified: boolean };
};
type Dependencies = {
  authorize: (authorization: unknown) => Promise<Principal | null>;
  authorityActive: (principal: Principal) => Promise<boolean>;
  /** These adapters are fixed in server code; no locator or trust flag is accepted from HTTP. */
  readFixedProtectedEnvelope: () => Promise<unknown>;
  readRuntime: () => Promise<RuntimeReadback>;
  publicKey: () => string | undefined;
  now?: () => number;
};

/** Read-only release control plane, separate from tenant ingestion and device receipts. */
export function createActiveReleaseReadHandler(deps: Dependencies) {
  return async (req: { method: string; path: string; get(name: string): string | undefined; query?: unknown }, res: any) => {
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.set("Vary", "Authorization");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    const reject = (status: number, code: string) => res.status(status).json({ ok: false, code });
    if (req.path !== ACTIVE_RELEASE_READ_PATH) return reject(404, "NOT_FOUND");
    if (req.method !== "GET") { res.set("Allow", "GET"); return reject(405, "METHOD_NOT_ALLOWED"); }
    const requestNonce = req.get("x-aurora-release-nonce");
    if (typeof requestNonce !== "string" || !/^[a-f0-9]{64}$/.test(requestNonce)
        || (req.query && Object.keys(req.query).length)) return reject(400, "INVALID_RELEASE_NONCE");
    try {
      const authorization = req.get("authorization");
      const principal = await deps.authorize(authorization);
      if (!principal || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(principal.orgId)) return reject(401, "INVALID_INTEGRATION_KEY");
      if (!await deps.authorityActive(principal)) return reject(403, "INTEGRATION_AUTHORITY_INACTIVE");
      const rawEnvelope = await deps.readFixedProtectedEnvelope();
      const now = deps.now?.() ?? Date.now();
      const candidate = verifyActiveReleaseEnvelope(rawEnvelope, deps.publicKey(), { now });
      if (candidate.status !== "CANDIDATE_UNVERIFIED") return reject(409, "ACTIVE_RELEASE_UNVERIFIED");
      const active = await readCanonicalActiveRelease({ sourceId: ACTIVE_RELEASE_SOURCE, publicKeySpkiPem: deps.publicKey(), now,
        readProtectedEnvelope: async () => rawEnvelope });
      if (active.status !== "VERIFIED_ACTIVE_PIN") return reject(409, "ACTIVE_RELEASE_UNVERIFIED");
      const runtime = await deps.readRuntime(), certificate = active.pin.certificate;
      if (runtime.verification.status !== "VERIFIED_ACTIVE_PIN" || runtime.verification.certificateSha256 !== active.pin.certificateSha256
          || runtime.runtimeBuild.sourceSha !== certificate.sourceSha || runtime.runtimeBuildWeb.sourceSha !== certificate.sourceSha
          || !runtime.runtimeBuild.fileIntegrityVerified || !runtime.runtimeBuildWeb.fileIntegrityVerified
          || !runtime.localServer.fileIntegrityVerified || !runtime.localWeb?.fileIntegrityVerified
          || runtime.runtimeBuild.manifestSha256 !== certificate.components.server.manifestSha256
          || runtime.runtimeBuildWeb.manifestSha256 !== certificate.components.web.manifestSha256) return reject(409, "ACTIVE_RELEASE_RUNTIME_CONFLICT");
      // A concurrent promotion or revocation while runtime is read must not be
      // described as the same current pointer. This is a bounded read, not a
      // distributed transaction with credential or deployment state.
      const currentEnvelope = verifyActiveReleaseEnvelope(await deps.readFixedProtectedEnvelope(), deps.publicKey(),
        { now: deps.now?.() ?? Date.now() });
      if (currentEnvelope.status !== "CANDIDATE_UNVERIFIED" || currentEnvelope.certificateSha256 !== active.pin.certificateSha256)
        return reject(409, "ACTIVE_RELEASE_CHANGED_DURING_READ");
      // Credential, issuer membership and organization are rechecked after awaited reads.
      const currentPrincipal = await deps.authorize(authorization);
      if (!currentPrincipal || currentPrincipal.orgId !== principal.orgId || currentPrincipal.keyId !== principal.keyId
          || !await deps.authorityActive(currentPrincipal)) return reject(403, "INTEGRATION_AUTHORITY_INACTIVE");
      const observedAt = deps.now?.() ?? Date.now();
      if (!Number.isSafeInteger(observedAt) || observedAt < now) return reject(503, "RELEASE_READ_UNAVAILABLE");
      return res.status(200).json({
        schemaVersion: ACTIVE_RELEASE_READ_SCHEMA, source: ACTIVE_RELEASE_SOURCE, canonicalOrigin: ACTIVE_RELEASE_ORIGIN, orgId: currentPrincipal.orgId,
        requestNonce, observedAtUtc: new Date(observedAt).toISOString(), certificateSha256: active.pin.certificateSha256,
        envelope: { certificate, signature: (rawEnvelope as { signature: string }).signature },
        runtime: { sourceSha: certificate.sourceSha, serverManifestSha256: runtime.runtimeBuild.manifestSha256,
          webManifestSha256: runtime.runtimeBuildWeb.manifestSha256 },
        componentCoverage: assessReleaseComponentCoverage(active.pin),
        nativeMacInstallation: "UNVERIFIED", deviceInstallationVerified: false
      });
    } catch { return reject(503, "RELEASE_READ_UNAVAILABLE"); }
  };
}
