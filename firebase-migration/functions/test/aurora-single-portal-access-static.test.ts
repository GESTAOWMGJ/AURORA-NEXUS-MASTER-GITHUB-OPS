import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const canonical = "https://auroranexus.com.br/portal";
const fallback = "https://wmgj-hml-jfn-20260927.web.app/";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("beta clients expose only the canonical Aurora portal as user-facing entry", () => {
  const beta = JSON.parse(read("desktop/beta-platforms.json"));
  assert.equal(beta.portal, canonical);
  assert.equal(beta.singleAccessPolicy.userFacingEntry, canonical);
  assert.equal(beta.singleAccessPolicy.hideFirebaseWebAppFromClientLinks, true);

  assert.match(read("desktop/build_installers.py"), /PORTAL = 'https:\/\/auroranexus\.com\.br\/portal'/);
  assert.match(read("desktop/install_windows_beta.py"), /BASE = "https:\/\/auroranexus\.com\.br\/portal"/);
  assert.match(read("desktop/windows_setup/main.go"), /const portal = "https:\/\/auroranexus\.com\.br\/portal"/);
  assert.match(read("firebase-migration/functions/src/auroraDownloads.ts"), /const portal = 'https:\/\/auroranexus\.com\.br\/portal';/);
});

test("Firebase HML URL remains infrastructure fallback, not the distributed portal", () => {
  const desired = JSON.parse(read("infra/domains/auroranexus.com.br/firebase-hosting.desired-state.json"));
  assert.equal(desired.interfacePolicy.canonicalPortalUrl, canonical);
  assert.equal(desired.interfacePolicy.technicalFallbackUrl, fallback);
  assert.equal(desired.interfacePolicy.distributeFallbackUrlToClients, false);
  assert.equal(desired.deploymentGates.firebaseFallbackHiddenFromClientLinks, true);
  assert.equal(desired.deploymentGates.customPortalBackedByHmlAuthGate, false);
});
