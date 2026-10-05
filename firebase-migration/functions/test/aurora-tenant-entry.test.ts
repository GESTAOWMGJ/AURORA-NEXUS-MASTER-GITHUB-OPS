import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { DecodedIdToken } from "firebase-admin/auth";
import { companyEntry, companyEntryAllowsMember, companyEntryPath, companyManifest, sessionOrganization } from "../src/auroraTenantEntry.js";
import { auroraProtectedShell } from "../src/auroraFrontend.js";
import { resolveMember, verifyAuroraAccess } from "../src/auroraAccess.js";
import { auroraAuth, auroraDb } from "../src/firebase.js";

const member = { uid: "synthetic-user", email: "user@example.invalid", orgId: "synthetic-company", role: "viewer", permissions: [], facilityIds: [], allFacilities: false, mfaVerified: false };
const csrf = { action: "test-action", refresh: "test-refresh", integrationKey: "test-integration", distributionApproval: "test-distribution", logout: "test-logout" };

test("company URLs preserve login, PWA start and same-origin return", () => {
  for (const path of ["/synthetic-company", "/synthetic-company/", "/synthetic-company/login"]) {
    assert.deepEqual(companyEntry(path), { orgId: member.orgId, path: "/synthetic-company", manifest: false });
  }
  const manifest = companyManifest(member.orgId);
  assert.equal(manifest.id, "/synthetic-company");
  assert.equal(manifest.start_url, "/synthetic-company");
  assert.equal(companyEntry("/synthetic-company/manifest.webmanifest")?.manifest, true);
  const html = auroraProtectedShell(member, csrf, "/synthetic-company/login");
  assert.match(html, /href="\/synthetic-company\/manifest.webmanifest"/);
  assert.equal((html.match(/location\.replace\("\/synthetic-company"\)/g) || []).length, 2);
  assert.match(html, /Centro de gestão SYNTHETIC-COMPANY/);
  assert.doesNotMatch(html, /Centro de gestão WMGJ|GPT|OpenAI|Gemini|chatgpt\.site/i);
});

test("reserved paths and hostile values never become company selectors or redirects", () => {
  for (const path of ["/", "/login", "/portal", "/downloads/file", "/api/bootstrap", "/organic", "/reports/shareholders",
                       "//evil.invalid", "/%2e%2e", "/wmgj%2fother", "/wmgj/../other", "/wmgj?orgId=other",
                       "/wmgj#evil", "/wmgj\\evil", "/<script>", "/Wmgj", "/wmgj--other"]) {
    assert.equal(companyEntry(path), null, path);
  }
  for (const slug of ["//evil.invalid", "a/b", "login", "a", "A".repeat(100)]) {
    assert.throws(() => companyEntryPath(slug));
  }
});

test("changing URL or login body never confers another organization", () => {
  assert.equal(companyEntryAllowsMember("synthetic-company", member.orgId), true);
  for (const requested of ["other-company", "../synthetic-company", {}, [], 1, ""]) {
    assert.equal(companyEntryAllowsMember(requested, member.orgId), false);
  }
  const html = auroraProtectedShell(member, csrf, "//evil.invalid");
  assert.doesNotMatch(html, /evil\.invalid/);
  assert.match(html, /location\.replace\("\/"\)/);
});

test("signed tenant selector keeps pilot compatibility and invalid claims fail closed", () => {
  assert.equal(sessionOrganization(undefined), "wmgj");
  assert.equal(sessionOrganization("synthetic-company"), "synthetic-company");
  for (const value of [null, "", "../wmgj", "LOGIN", "api", [], {}]) assert.equal(sessionOrganization(value), null);
});

test("APIs use verified session tenant and current membership, ignoring forged role claims", async (context) => {
  const paths: string[] = [];
  let activeMember = true;
  let activeOrg = true;
  let decoded = { uid: member.uid, email: member.email, auroraOrgId: member.orgId,
    orgId: "other-company", role: "platform_admin", permissions: ["*"],
    firebase: { identities: {}, sign_in_provider: "password" } } as unknown as DecodedIdToken;
  context.mock.method(auroraAuth, "verifySessionCookie", async (_cookie: string, revoked: boolean) => {
    assert.equal(revoked, true);
    return decoded;
  });
  context.mock.method(auroraDb, "doc", (path: string) => {
    paths.push(path);
    return { get: async () => ({ exists: true, data: () => path.includes("/members/")
      ? { active: activeMember, role: "viewer", permissions: [], allFacilities: false }
      : { active: activeOrg } }) };
  });
  const resolved = await verifyAuroraAccess("__session=synthetic", member.email);
  assert.equal(resolved?.orgId, member.orgId);
  assert.equal(resolved?.role, "viewer");
  assert.deepEqual(resolved?.permissions, []);
  assert.deepEqual(paths, [`organizations/${member.orgId}/members/${member.uid}`, `organizations/${member.orgId}`]);
  activeMember = false;
  assert.equal(await verifyAuroraAccess("__session=synthetic", member.email), null);
  activeMember = true; activeOrg = false;
  assert.equal(await verifyAuroraAccess("__session=synthetic", member.email), null);
  assert.equal(await resolveMember(decoded, "other-company"), null);
  paths.length = 0;
  decoded = { ...decoded, auroraOrgId: "../wmgj" };
  assert.equal(await verifyAuroraAccess("__session=synthetic", member.email), null);
  assert.deepEqual(paths, []);
});

test("page and login gate tenant before private shell and session issuance", () => {
  const source = fs.readFileSync(new URL("../src/auroraAuthGate.ts", import.meta.url), "utf8");
  const page = source.slice(source.indexOf("export const auroraNexusAuthGate"), source.indexOf("export const auroraNexusSessionLogin"));
  const login = source.slice(source.indexOf("export const auroraNexusSessionLogin"));
  assert.ok(page.indexOf("companyEntryAllowsMember(entry?.orgId, member.orgId)") < page.indexOf("auroraProtectedShell("));
  assert.ok(login.indexOf("companyEntryAllowsMember(req.body?.orgId, member.orgId)") < login.indexOf("createSessionCookie("));
  assert.match(page, /res\.status\(403\)/);
  assert.match(login, /COMPANY_ACCESS_DENIED/);
  assert.match(source, /HttpOnly; Secure; SameSite=Strict; Path=\//);
  const client = fs.readFileSync(new URL("../src/auroraLoginClient.ts", import.meta.url), "utf8");
  assert.match(source, /loginClient\(entryOrg\)/);
  assert.match(client, /JSON\.stringify\(\{ idToken, orgId \}\)/);
});
