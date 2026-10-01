import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.resolve(here, "../src/auroraRuntime.ts"), "utf8");

test("native insight is hard-gated on Firebase snapshot and never falls back to source", () => {
  assert.match(runtime, /FIREBASE_NATIVE_SNAPSHOT_REQUIRED/);
  assert.match(runtime, /FIREBASE_NATIVE_CONTRACT_REQUIRED/);
  assert.match(runtime, /sourceAccessDuringInference:\s*false/);
  const nativeBlock = runtime.slice(runtime.indexOf("export const auroraNexusNativeInsight"), runtime.indexOf("export const auroraNexusRefresh"));
  assert.doesNotMatch(nativeBlock, /buildProjection\(empty/);
  assert.doesNotMatch(nativeBlock, /readProjectionSource/);
});

test("projection engine remains the Firebase materialization boundary", () => {
  assert.match(runtime, /const source = await readProjectionSource\(orgId\)/);
  assert.match(runtime, /dashboardSnapshots\/current/);
  assert.match(runtime, /sourceHash/);
});
