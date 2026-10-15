import { assessReleaseComponentCoverage, type ReleaseComponent, type VerifiedActiveRelease } from "./auroraActiveRelease.js";

export const BETA_PLATFORMS = ["web", "windows", "mac", "ios", "android"] as const;
export type BetaPlatform = typeof BETA_PLATFORMS[number];
export type BetaReleaseIdentity = Readonly<{ releaseId: string; productVersion: string; sourceSha: string; certificateSha256: string }>;
const kinds = { web: "CANONICAL_PRIVATE_PORTAL", windows: "EDGE_APP_ACCESS_CLIENT", mac: "EXISTING_MAC_APP",
  ios: "EXISTING_PWA", android: "EXISTING_PWA" } as const;
const components: Record<BetaPlatform, readonly ReleaseComponent[]> = {
  web: ["web"], windows: ["satellite", "iaMaster", "windowsIntegration"], mac: ["satellite"], ios: ["web"], android: ["web"]
};
type Build = { sourceSha: string | null; version: string | null; manifestSha256: string | null; fileIntegrityVerified: boolean };
type Options = { now?: number; online?: boolean; runtimeBuilds?: { server: Build; web: Build };
  /** Optional observations are reports, never authority to attest device installation. */
  observations?: Partial<Record<BetaPlatform, unknown>> };
type Client = { kind: typeof kinds[BetaPlatform]; expectedRelease: BetaReleaseIdentity | null; technicalVersions: Readonly<Record<string, string>>;
  state: string; installationVerified: false; nativeApplicationClaimed: false; identity: Readonly<Record<string, string>>;
  requestedDistribution?:'NATIVE_TESTFLIGHT_APP_STORE';currentDistribution?:'EXISTING_PWA';
  nativeDeliveryStatus?:'PENDING_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE';nativeReleaseIdentityVerified?:false };
export type UnifiedBetaProjection = Readonly<{ schemaVersion: "aurora.unified-beta.v1"; referenceStatus: string;
  reference: BetaReleaseIdentity | null; runtimeStatus: string; convergenceStatus: "PENDING" | "CONFLICT";
  platforms: Readonly<Record<BetaPlatform, Readonly<Client>>>; deviceInstallationVerified: false; allClientsSynchronized: false }>;
const projections = new WeakSet<object>();
const row = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

function observationState(value: unknown, identity: BetaReleaseIdentity, versions: Readonly<Record<string, string>>, kind: string,
  now: number, published: number): string {
  if (value === undefined || value === null) return "PENDING_NOT_OBSERVED";
  if (!row(value) || !exact(value, ["kind", "releaseId", "productVersion", "sourceSha", "certificateSha256", "technicalVersions", "connected", "checkedAt"])
      || typeof value.connected !== "boolean" || typeof value.checkedAt !== "string" || value.checkedAt.length !== 24
      || !Number.isFinite(Date.parse(value.checkedAt)) || new Date(value.checkedAt).toISOString() !== value.checkedAt
      || !row(value.technicalVersions)) return "PENDING_INVALID_OBSERVATION";
  if (value.kind !== kind) return "CONFLICT_CLIENT_KIND";
  // An offline report cannot establish current adoption, including from a cached matching receipt.
  if (!value.connected) return "PENDING_OFFLINE";
  if (value.sourceSha !== identity.sourceSha || value.certificateSha256 !== identity.certificateSha256
      || value.releaseId !== identity.releaseId || value.productVersion !== identity.productVersion) return "CONFLICT_RELEASE_IDENTITY";
  const observedVersions = value.technicalVersions;
  if (!exact(observedVersions, Object.keys(versions)) || Object.entries(versions).some(([k, v]) => observedVersions[k] !== v)) {
    return "CONFLICT_TECHNICAL_VERSION";
  }
  const checked = Date.parse(value.checkedAt);
  if (!Number.isSafeInteger(now) || now < 0 || checked > now || checked < published || now - checked > 86_400_000) return "PENDING_STALE_OBSERVATION";
  return "REFERENCE_MATCH_REPORTED";
}

/** Pure projection of the existing protected pin. It creates no release, receipt, permission or installation. */
export function buildUnifiedBetaRelease(pin?: VerifiedActiveRelease, options: Options = {}): UnifiedBetaProjection {
  const coverage = assessReleaseComponentCoverage(pin);
  const verified = coverage.complete && options.online !== false;
  const reference: BetaReleaseIdentity | null = verified ? Object.freeze({ releaseId: "aurora-" + pin!.certificate.productVersion + "-" + pin!.certificate.sourceSha,
    productVersion: pin!.certificate.productVersion, sourceSha: pin!.certificate.sourceSha, certificateSha256: pin!.certificateSha256 }) : null;
  const referenceStatus = options.online === false ? "PENDING_OFFLINE" : coverage.status === "PARTIAL" ? "PENDING_PARTIAL_REFERENCE"
    : reference ? "VERIFIED_REFERENCE" : "PENDING_VERIFIED_REFERENCE";
  let runtimeStatus = "PENDING_RUNTIME_BYTES";
  if (reference && options.runtimeBuilds) {
    const builds = options.runtimeBuilds;
    const conflict = (["server", "web"] as const).some(name => {
      const build = builds[name], expected = pin!.certificate.components[name];
      return build.fileIntegrityVerified && (build.sourceSha !== reference.sourceSha || build.version !== expected.version
        || build.manifestSha256 !== expected.manifestSha256);
    });
    runtimeStatus = conflict ? "CONFLICT_RUNTIME_BYTES" : builds.server.fileIntegrityVerified && builds.web.fileIntegrityVerified
      ? "RUNTIME_BYTES_MATCH" : "PENDING_RUNTIME_BYTES";
  }
  const platforms = {} as Record<BetaPlatform, Readonly<Client>>;
  for (const platform of BETA_PLATFORMS) {
    const versions = Object.freeze(reference ? Object.fromEntries(components[platform].map(name => [name, pin!.certificate.components[name]!.version])) : {});
    let state = reference ? observationState(options.observations?.[platform], reference, versions, kinds[platform], options.now ?? Date.now(),
      Date.parse(pin!.certificate.publishedAtUtc)) : referenceStatus;
    if (platform === "web" && reference) {
      if (runtimeStatus === "CONFLICT_RUNTIME_BYTES") state = runtimeStatus;
      else if (state === "PENDING_NOT_OBSERVED" && runtimeStatus === "RUNTIME_BYTES_MATCH") state = "RUNTIME_BYTES_MATCH";
    }
    if (platform === 'ios' && !state.startsWith('CONFLICT_')) state='PENDING_NATIVE_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE';
    // Public identities describe the existing clients. They contain no device or tenant paths and confer no native acceptance.
    const identity: Record<string, string> = platform === "mac"
      ? { applicationName: "Aurora Nexus HML-0.2.0-hml.20261001.app", bundleIdentifier: "br.com.auroranexus.desktop.hml",
          executable: "aurora-portal", shortVersion: "0.2.0", bundleVersion: "1", runtime: "PORTAL_LAUNCHER" }
      : platform === "windows" ? { clientVersion: "0.2.0-beta.4", entryPackage: "AURORA-NEXUS-Instalar.exe" }
      : { manifestId: "/portal", entryPath: "/portal" };
    platforms[platform] = Object.freeze({ kind: kinds[platform], expectedRelease: reference, technicalVersions: versions, state,
      installationVerified: false, nativeApplicationClaimed: false, identity: Object.freeze(identity),
      ...(platform==='ios'?{requestedDistribution:'NATIVE_TESTFLIGHT_APP_STORE' as const,currentDistribution:'EXISTING_PWA' as const,
        nativeDeliveryStatus:'PENDING_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE' as const,nativeReleaseIdentityVerified:false as const}:{}) });
  }
  const unknownPlatform = options.observations && Object.keys(options.observations).some(k => !BETA_PLATFORMS.includes(k as BetaPlatform));
  const conflict = unknownPlatform || runtimeStatus.startsWith("CONFLICT_") || Object.values(platforms).some(client => client.state.startsWith("CONFLICT_"));
  const projection: UnifiedBetaProjection = Object.freeze({ schemaVersion: "aurora.unified-beta.v1", referenceStatus, reference, runtimeStatus,
    convergenceStatus: conflict ? "CONFLICT" : "PENDING", platforms: Object.freeze(platforms), deviceInstallationVerified: false, allClientsSynchronized: false });
  projections.add(projection);
  return projection;
}

/** Only an in-process projection from the branded reader may influence the Release Cockpit. */
export function isUnifiedBetaProjection(value: unknown): value is UnifiedBetaProjection {
  return Boolean(value && typeof value === "object" && projections.has(value));
}
