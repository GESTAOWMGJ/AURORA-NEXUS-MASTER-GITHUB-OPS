import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { auroraIdentityMark } from "../src/auroraDesignSystem.js";
import { fixtureDom } from "./aurora-browser-dom.fixture.js";
// Preserve the native .mjs import when the functions tsconfig targets CommonJS.
const importEsm = new Function("url", "return import(url)") as (url: string) => Promise<any>;
const parser = importEsm(new URL("../../scripts/check-canonical-preflight.mjs", import.meta.url).href);

const source = fs.readFileSync(new URL("../src/auroraAuthGate.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

// Execute the actual handlers with synthetic identity and Firebase adapters.
// No SDK initialization, credentials, network requests or storage writes occur.
function fixture(ready?: string, member: any = null) {
  const exported: any = {};
  const state = { privateShells: 0, sessionReads: 0, memberReads: 0, downloadReauthorized: null as any };
  const access = {
    CSRF_PURPOSES: { action: "action", refresh: "refresh", userProfile: "userProfile", integrationKey: "integrationKey", distributionApproval: "distributionApproval", logout: "logout" },
    SESSION_COOKIE_NAME: "aurora-session",
    csrfTokenForSession: () => "synthetic-csrf",
    verifySession: async () => { state.sessionReads++; return member ? { uid: "synthetic-user" } : null; },
    resolveMember: async () => { state.memberReads++; return member; },
    parseAllowedEmails: () => new Set(["synthetic@example.test"]),
    identityMayEnter: () => true,
    validCsrf: () => true
  };
  const modules: Record<string, any> = {
    "firebase-functions/params": { defineSecret: () => ({ value: () => "synthetic-secret" }) },
    "firebase-functions/v2/https": { onRequest: (_options: unknown, handler: unknown) => handler },
    "firebase-functions/logger": { error: () => {}, warn: () => {} },
    "./auroraAccess.js": access,
    "./auroraFrontend.js": { auroraProtectedShell: () => { state.privateShells++; return "<nav></nav>Centro de gestão WMGJ"; } },
    "./auroraActiveReleaseRuntime.js": { readRuntimeActiveRelease: async () => ({ runtimeBuildWeb: {} }) },
    "./firebase.js": { auroraAuth: {} },
    "./auroraDownloads.js": { servePrivateDownloads: async (_req:any,_res:any,_member:any,_root:any,unified:any) => { if(unified)state.downloadReauthorized=await unified.reauthorize(); } },
    "./auroraUnifiedBetaDownload.js": { makeRuntimeUnifiedBetaReader: async () => async () => { throw Error('SYNTHETIC_READER_NOT_CONFIGURED'); } },
    "./auroraSetup.js": { setupPage: () => "synthetic-setup" },
    "./auroraLoginClient.js": { loginClient: () => "" },
    "./auroraPasswordRecovery.js": { passwordRecoveryMarkup: () => "" },
    "./auroraAccountSecurity.js": { accountSecurityPage: () => "synthetic-security" },
    "./auroraDesignSystem.js": { auroraDesignStyles: () => "", auroraIdentityMark },
    "./auroraTenantEntry.js": {
      CANONICAL_PORTAL_PATH: "/portal",
      companyEntry: (path: string) => path === "/empresa/other" ? { orgId: "other", path } : null,
      companyEntryAllowsMember: (entry: string | undefined, org: string) => !entry || entry === org,
      companyEntryPath: (org: string) => `/empresa/${org}`,
      companyManifest: () => ({}), portalManifest: () => ({}),
      isCompanySlug: () => true, userFacingEntryPath: () => "/portal"
    }
  };
  const env = ready === undefined ? {} : { AURORA_CANONICAL_PORTAL_READY: ready };
  vm.runInNewContext(compiled, {
    exports: exported, process: { env }, Buffer,
    require: (name: string) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected adapter: ${name}`);
      return modules[name];
    }
  }, { filename: "auroraAuthGate.fixture.cjs" });
  async function request(handler = "auroraNexusAuthGate", path = "/", host = "wmgj-hml-jfn-20260927.web.app", method = "GET") {
    const result = { status: 200, headers: {} as Record<string, string>, body: "", payload: null as any };
    const res: any = {
      set: (name: string, value: string) => { result.headers[name.toLowerCase()] = value; return res; },
      status: (status: number) => { result.status = status; return res; },
      type: (type: string) => { result.headers["content-type"] = type; return res; },
      send: (body: string) => { result.body = body; return res; },
      json: (payload: any) => { result.payload = payload; return res; },
      redirect: (status: number, location: string) => { result.status = status; result.headers.location = location; return res; }
    };
    const req: any = { method, path, originalUrl: path, query: {},
      get: (name: string) => name.toLowerCase() === "host" ? host : undefined };
    await exported[handler](req, res);
    return result;
  }
  return { request, state };
}

function assertStandardHeaders(headers: Record<string, string>) {
  assert.match(headers["cache-control"]!, /no-store/);
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.match(headers["content-security-policy"]!, /frame-ancestors 'none'/);
  assert.match(headers["content-security-policy"]!, /connect-src 'self' https:\/\/identitytoolkit.googleapis.com https:\/\/securetoken.googleapis.com/);
}

test('downloads receive live session and membership reauthorization from the real AuthGate',async()=>{
  const member={uid:'synthetic-user',orgId:'synthetic',role:'org_admin',permissions:[]};
  const current=fixture(undefined,member);
  await current.request('auroraNexusAuthGate','/downloads','auroranexus.com.br');
  assert.equal(current.state.sessionReads,2);assert.equal(current.state.memberReads,2);
  assert.equal(current.state.downloadReauthorized,member);
});

test("technical login remains functional with canonical readiness absent or false", async () => {
  const { hasUsableLoginForm } = await parser;
  for (const ready of [undefined, "false", "TRUE", "1"]) {
    for (const host of ["wmgj-hml-jfn-20260927.web.app", "wmgj-hml-jfn-20260927.firebaseapp.com"]) {
      const current = fixture(ready);
      const response = await current.request("auroraNexusAuthGate", "/", host);
      assert.equal(response.status, 200);
      assert.ok(hasUsableLoginForm(response.body));
      assert.doesNotMatch(response.body, /location\.replace\("https:\/\/auroranexus.com.br/);
      assert.doesNotMatch(response.body, /Centro de gestão WMGJ/);
      assert.doesNotMatch(response.headers["content-security-policy"]!, /127\.0\.0\.1|localhost/);
      assertStandardHeaders(response.headers);
      assert.equal(current.state.privateShells, 0);
    }
  }
});

test("explicit canonical readiness redirects technical hosts to the exact HTTPS portal", async () => {
  const { hasUsableLoginForm } = await parser;
  for (const host of ["wmgj-hml-jfn-20260927.web.app", "wmgj-hml-jfn-20260927.firebaseapp.com"]) {
    const current = fixture("true");
    const response = await current.request("auroraNexusAuthGate", "/", host);
    assert.equal(response.status, 308);
    assert.equal(response.headers.location, "https://auroranexus.com.br/portal");
    assert.equal(response.body, "");
    assertStandardHeaders(response.headers);
    assert.equal(current.state.privateShells, 0);
  }
  const canonical = await fixture("true").request("auroraNexusAuthGate", "/portal", "auroranexus.com.br");
  assert.equal(canonical.status, 200);
  assert.ok(hasUsableLoginForm(canonical.body));
});

test("served second-factor controls share the submit form and retain separate recovery and descriptions", async () => {
  const response = await fixture().request("auroraNexusAuthGate", "/portal", "auroranexus.com.br");
  const { document } = fixtureDom(response.body);
  const form = document.getElementById("mfa-form")!;
  for (const id of ["mfa-factor", "mfa-code", "mfa-submit", "mfa-recovery-help"]) {
    assert.equal(document.getElementById(id)!.closest("form"), form);
  }
  assert.equal(document.getElementById("mfa-submit")!.getAttribute("type"), "submit");
  assert.equal(document.getElementById("mfa-recovery-help")!.getAttribute("type"), "button");
  const code = document.getElementById("mfa-code")!;
  assert.equal(code.getAttribute("required"), "");
  assert.equal(code.getAttribute("pattern"), "[0-9]{6,8}");
  for (const id of code.getAttribute("aria-describedby")!.split(/\s+/)) assert.ok(document.getElementById(id));
  assert.equal(document.getElementById("mfa-panel")!.getAttribute("hidden"), "");
  assert.match(response.body, /<meta http-equiv="Content-Security-Policy" content="form-action 'none'">/);
  assert.equal(response.status, 200);
  assertStandardHeaders(response.headers);
});

test("login and session method denials retain the restricted CSP", async () => {
  for (const [handler, path, method] of [
    ["auroraNexusAuthGate", "/", "POST"],
    ["auroraNexusSessionLogin", "/__sessionLogin", "GET"],
    ["auroraNexusSessionLogout", "/__sessionLogout", "GET"]
  ]) {
    const response = await fixture().request(handler, path, "wmgj-hml-jfn-20260927.web.app", method);
    assert.equal(response.status, 405);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.code, "METHOD_NOT_ALLOWED");
    assertStandardHeaders(response.headers);
    assert.doesNotMatch(response.headers["content-security-policy"]!, /127\.0\.0\.1|localhost/);
  }
});

test("local Master bridge CSP requires organization-wide administrator membership and verified MFA", async () => {
  for (const role of ["platform_admin", "org_admin", "director", "auditor", "operator"]) {
    for (const allFacilities of [false, true]) {
      for (const mfaVerified of [false, true]) {
        const current = fixture(undefined, { orgId: "synthetic", role, allFacilities, mfaVerified, permissions: [] });
        const response = await current.request("auroraNexusAuthGate", "/portal");
        assert.equal(response.status, 200);
        assert.equal(current.state.privateShells, 1);
        assertStandardHeaders(response.headers);
        const connect = response.headers["content-security-policy"]!.split("; ").find(value => value.startsWith("connect-src"))!;
        assert.equal(connect.includes("http://127.0.0.1:38765"), allFacilities && mfaVerified && ["platform_admin", "org_admin"].includes(role));
        assert.doesNotMatch(connect, /localhost|127\.0\.0\.1:(?!38765)/);
      }
    }
  }
});

test("tenant denial and public account screens never gain the local Master bridge CSP", async () => {
  const member = { orgId: "synthetic", role: "platform_admin", allFacilities: true, mfaVerified: true, permissions: [] };
  const current = fixture(undefined, member);
  const denied = await current.request("auroraNexusAuthGate", "/empresa/other");
  assert.equal(denied.status, 403);
  assert.equal(current.state.privateShells, 0);
  assert.doesNotMatch(denied.headers["content-security-policy"]!, /127\.0\.0\.1|localhost/);
  for (const path of ["/account-recovery", "/account-security", "/setup", "/manifest.webmanifest"]) {
    const response = await fixture(undefined, member).request("auroraNexusAuthGate", path);
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.headers["content-security-policy"]!, /127\.0\.0\.1|localhost/);
  }
});
