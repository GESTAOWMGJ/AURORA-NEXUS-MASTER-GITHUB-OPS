import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseStatus, AURORA_PRODUCT_VERSION } from "../src/auroraReleaseStatus.js";

test("release cockpit uses the commercial release train", () => {
  const status = buildReleaseStatus({ active: true, organicEnabled: true, organicSectors: ["AUDIT", "FINANCE"] }) as any;
  assert.equal(status.productVersion, AURORA_PRODUCT_VERSION);
  assert.equal(status.target, "SELLABLE_GA");
  assert.ok(status.engineeringReadinessPercent > 0 && status.engineeringReadinessPercent < 100);
});

test("WMGJ organic gate fails closed without explicit sectors", () => {
  const status = buildReleaseStatus({ active: true, organicEnabled: true, organicSectors: ["AUDIT"] }) as any;
  const organic = status.gates.find((gate: any) => gate.id === "organic-wmgj");
  assert.equal(organic.status, "BLOCKED");
});

test("real operational ingestion stays blocked in this release candidate", () => {
  const status = buildReleaseStatus({ active: true, organicEnabled: true, organicSectors: ["AUDIT", "FINANCE"] }) as any;
  const ingestion = status.gates.find((gate: any) => gate.id === "real-data-ingestion");
  assert.equal(ingestion.status, "BLOCKED");
  assert.equal(status.installerIntegration.status, "IMPLEMENTED_PENDING_LIVE_VALIDATION");
  assert.equal(status.installerIntegration.fullSynchronizationVerified, false);
});
