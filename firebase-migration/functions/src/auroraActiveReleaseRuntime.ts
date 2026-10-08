import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { auroraDb } from "./firebase.js";
import { ACTIVE_RELEASE_SOURCE, assessReleaseManifest, readCanonicalActiveRelease } from "./auroraActiveRelease.js";

type Dependencies = {
  publicKey: () => string | undefined;
  readProtectedEnvelope: () => Promise<unknown>;
  readServerManifest: () => Promise<Uint8Array>;
  readServerFiles: (manifest: ServerBuildManifest) => Promise<Record<string, Uint8Array>>;
  readWebManifest?: () => Promise<Uint8Array>;
  readWebFiles?: (manifest: ServerBuildManifest) => Promise<Record<string, Uint8Array>>;
  now?: () => number;
};
type ServerBuildManifest = { schemaVersion: 1; sourceSha: string; version: string; files: Record<string, string> };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const safeLibraryPath = (name: string) => /^lib\/[A-Za-z0-9._/-]+\.js$/.test(name)
  && name.split("/").every(part => part && part !== "." && part !== "..");
function parseBuildManifest(bytes: Uint8Array): ServerBuildManifest | undefined {
  if (bytes.length > 65_536) return;
  let value: any;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return; }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1
      || Object.keys(value).length !== 4 || typeof value.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceSha)
      || typeof value.version !== "string" || value.version.length > 80 || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(value.version)
      || !value.files || typeof value.files !== "object" || Array.isArray(value.files)
      || !Object.keys(value.files).length || Object.keys(value.files).length > 1000
      || Object.entries(value.files).some(([name, hash]) => !safeLibraryPath(name) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) return;
  return value;
}
/** Dependencies are supplied by trusted server code, never from HTTP input. */
export function createActiveReleaseRuntime(deps: Dependencies) {
  const startedAtUtc = new Date(deps.now?.() ?? Date.now()).toISOString();
  // Capture packaged files once, when this process initializes. Never re-label loaded code after a disk swap.
  const capture = async (readManifest: Dependencies["readServerManifest"], readFiles: Dependencies["readServerFiles"]) => {
    let manifestBytes: Uint8Array | undefined, fileBytes: Record<string, Uint8Array> | undefined;
    let runtimeBuild = { status: "BUILD_METADATA_UNAVAILABLE", sourceSha: null as string | null, version: null as string | null,
      manifestSha256: null as string | null, fileIntegrityVerified: false };
    try {
      manifestBytes = Buffer.from(await readManifest());
      const manifest = parseBuildManifest(manifestBytes);
      if (!manifest) runtimeBuild.status = "BUILD_METADATA_INVALID";
      else {
        const observedFiles = await readFiles(manifest);
        fileBytes = Object.fromEntries(Object.entries(observedFiles).map(([name, bytes]) => [name, Buffer.from(bytes)]));
        if (Object.keys(fileBytes).length !== Object.keys(manifest.files).length
            || Object.entries(manifest.files).some(([name, hash]) => !Object.hasOwn(fileBytes!, name) || !(fileBytes![name] instanceof Uint8Array) || digest(fileBytes![name]!) !== hash)) {
          runtimeBuild.status = "BUILD_FILES_CONFLICT";
        } else runtimeBuild = { status: "RUNTIME_BUILD_OBSERVED", sourceSha: manifest.sourceSha, version: manifest.version,
          manifestSha256: digest(manifestBytes), fileIntegrityVerified: true };
      }
    } catch { /* No client path, source constant or expected pin may substitute for missing build bytes. */ }
    return { manifestBytes, fileBytes, runtimeBuild: Object.freeze({ ...runtimeBuild, startedAtUtc,
      observedAtUtc: new Date(deps.now?.() ?? Date.now()).toISOString() }) };
  };
  const startup = capture(deps.readServerManifest, deps.readServerFiles);
  const startupWeb = capture(deps.readWebManifest ?? (async () => { throw new Error(); }),
    deps.readWebFiles ?? (async () => { throw new Error(); }));
  return async () => {
    const [server, web] = await Promise.all([startup, startupWeb]);
    const { manifestBytes, fileBytes, runtimeBuild } = server;
    const runtimeBuildWeb = web.runtimeBuild;
    const active = await readCanonicalActiveRelease({ sourceId: ACTIVE_RELEASE_SOURCE,
      publicKeySpkiPem: deps.publicKey(), readProtectedEnvelope: deps.readProtectedEnvelope, now: deps.now?.() });
    if (active.status !== "VERIFIED_ACTIVE_PIN") return {
      verification: { status: active.status, reason: active.reason, source: ACTIVE_RELEASE_SOURCE },
      certificate: null,
      runtimeBuild,
      runtimeBuildWeb,
      localServer: { status: "UNVERIFIED", sourceSha: null, version: null, manifestMatches: false, fileIntegrityVerified: false },
      allClientsSynchronized: false
    };
    let localServer = { status: "SERVER_MANIFEST_UNAVAILABLE", sourceSha: null as string | null, version: null as string | null,
      manifestMatches: false, fileIntegrityVerified: false };
    try {
      if (!manifestBytes || !fileBytes || !runtimeBuild.fileIntegrityVerified) throw new Error();
      const checked = assessReleaseManifest(active.pin, "server", manifestBytes, fileBytes);
      const matches = checked.status === "PACKAGE_FILES_VERIFIED";
      localServer = { status: !matches && ["MANIFEST_CONFLICT", "MANIFEST_IDENTITY_CONFLICT"].includes(checked.status) ? "VERSION_CONFLICT" : checked.status,
        sourceSha: matches ? active.pin.certificate.components.server.sourceSha : null,
        version: matches ? active.pin.certificate.components.server.version : null, manifestMatches: matches,
        fileIntegrityVerified: checked.fileIntegrityVerified };
    } catch { /* Missing build metadata is an explicit unverified state, without private paths/errors. */ }
    let localWeb = { status: "WEB_MANIFEST_UNAVAILABLE", sourceSha: null as string | null, version: null as string | null, fileIntegrityVerified: false };
    if (web.manifestBytes && web.fileBytes && runtimeBuildWeb.fileIntegrityVerified) {
      const checked = assessReleaseManifest(active.pin, "web", web.manifestBytes, web.fileBytes);
      const matches = checked.status === "PACKAGE_FILES_VERIFIED";
      localWeb = { status: matches ? checked.status : "VERSION_CONFLICT", sourceSha: matches ? runtimeBuildWeb.sourceSha : null,
        version: matches ? runtimeBuildWeb.version : null, fileIntegrityVerified: checked.fileIntegrityVerified };
    }
    return { verification: { status: active.status, reason: null, source: ACTIVE_RELEASE_SOURCE,
      algorithm: "Ed25519", certificateSha256: active.pin.certificateSha256 },
      certificate: active.pin.certificate, runtimeBuild, runtimeBuildWeb, localServer, localWeb, allClientsSynchronized: false };
  };
}
export const readRuntimeActiveRelease = createActiveReleaseRuntime({
  publicKey: () => process.env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY,
  readProtectedEnvelope: async () => {
    const snapshot = await auroraDb.doc(ACTIVE_RELEASE_SOURCE).get();
    return snapshot.exists ? snapshot.data() : undefined;
  },
  // A fixed generated build artifact, never an arbitrary client path or fabricated SHA.
  readServerManifest: () => safeReadBuildFile("runtime-release/server-manifest.json", 65_536),
  readServerFiles: readBuildFiles,
  readWebManifest: () => safeReadBuildFile("runtime-release/web-manifest.json", 65_536),
  readWebFiles: readBuildFiles
});
async function readBuildFiles(manifest: ServerBuildManifest) {
    const bytes: Record<string, Uint8Array> = {};
    let size = 0;
    for (const name of Object.keys(manifest.files)) {
      if (!safeLibraryPath(name)) throw new Error("BUILD_PATH_REJECTED");
      const file = await safeReadBuildFile(name, 16_777_216);
      size += file.length;
      if (size > 67_108_864) throw new Error("BUILD_SIZE_REJECTED");
      bytes[name] = file;
    }
    return bytes;
}
async function safeReadBuildFile(name: string, maxBytes: number): Promise<Buffer> {
  const parts = name.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw new Error("BUILD_PATH_REJECTED");
  const base = resolve(__dirname, "..");
  for (let index = 1; index <= parts.length; index++) {
    const path = resolve(base, ...parts.slice(0, index));
    const info = await lstat(path);
    if (info.isSymbolicLink() || (index < parts.length ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size > maxBytes)) {
      throw new Error("BUILD_PATH_REJECTED");
    }
  }
  const bytes = await readFile(resolve(base, ...parts));
  if (bytes.length > maxBytes) throw new Error("BUILD_SIZE_REJECTED");
  return bytes;
}
