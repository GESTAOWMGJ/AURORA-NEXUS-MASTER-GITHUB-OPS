import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { Script, createContext } from "node:vm";
import test from "node:test";
import { auroraProtectedShell } from "../src/auroraFrontend.js";
import { fixtureDom, addHandler, type Handler } from "./aurora-browser-dom.fixture.ts";

const member = { uid: "synthetic-master", email: "synthetic@example.invalid", orgId: "synthetic-company", role: "org_admin",
  permissions: [], facilityIds: [], allFacilities: true, mfaVerified: true };
const html = auroraProtectedShell(member, { action: "synthetic-action", refresh: "synthetic-refresh", integrationKey: "synthetic-integration",
  distributionApproval: "synthetic-distribution", userProfile: "synthetic-profile", logout: "synthetic-logout" });
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => match[1]!);
const credential = "ANX1-" + "S".repeat(43);
const snapshot = { projection: { competence: "2026-10", financialCents: {}, operations: {}, coverage: {}, modules: [] }, actions: [] };
const profiles = { ok: true, engineEnabled: true, currentAdminUid: member.uid, profiles: [
  { uid: member.uid, name: "Synthetic master", role: "org_admin", active: true, managed: false, onboardingState: null },
  { uid: "anx_" + "a".repeat(40), name: "Synthetic professional", role: "operator", active: true, managed: true, onboardingState: "INVITED" }
] };
const response = (status: number, body: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
async function fixture() {
  const { elements, document } = fixtureDom(html);
  const el = (id: string) => { const element = elements.get(id); assert.ok(element, `Known DOM id: ${id}`); return element; };
  el("profile-invitation").hidden = true;
  const calls: { url: string; options: any }[] = []; const redirects: string[] = []; const winHandlers = new Map<string, Handler>();
  let fetcher = async (url: string, options: any): Promise<any> => url === "/api/bootstrap" ? response(200, snapshot)
    : url === "/api/user-profiles" && !options?.method ? response(200, profiles) : response(200, { keys: [] });
  const context = createContext({
    document,
    window: { addEventListener: (name: string, callback: Handler) => addHandler(winHandlers, name, callback), dispatchEvent: (event: Event) => { winHandlers.get(event.type)?.(event); return true; }, confirm: () => true },
    navigator: { onLine: true }, location: { origin: "https://auroranexus.com.br", hostname: "auroranexus.com.br", hash: "", search: "", replace: (url: string) => redirects.push(url) }, history: { pushState() {} }, matchMedia: () => ({ matches: false }), Event, Intl, Date, AbortController,
    crypto: { randomUUID: () => "synthetic-invitation-0001" }, setInterval() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: (url: string, options: any) => { calls.push({ url, options }); return fetcher(url, options); }
  });
  scripts.forEach(script => new Script(script).runInContext(context));
  await setImmediate();
  const invite = el("profile-list").children.flatMap(row => row.children).find(child => child.textContent === "Gerar nova senha de cadastro");
  assert.ok(invite, "The actual profile listing produces an invitation button");
  return { el, calls, redirects, winHandlers, fetchWith: (fn: typeof fetcher) => { fetcher = fn; },
    run: (code: string) => new Script(code).runInContext(context),
    issue: async () => { await invite.handlers.get("click")!(); },
    logout: async () => { await el("logout").handlers.get("click")!(); } };
}

test("a displayed invitation is cleared immediately even when remote logout fails and no navigation occurs", async () => {
  const f = await fixture();
  f.run('showProfileInvitation({registrationPassword:"' + credential + '"})');
  assert.equal(f.el("profile-registration-password").textContent, credential); assert.equal(f.el("profile-invitation").hidden, false);
  f.fetchWith(async () => response(503));
  await f.logout();
  assert.equal(f.redirects.length, 0); assert.equal(f.el("profile-registration-password").textContent, "");
  assert.equal(f.el("profile-invitation").hidden, true); assert.equal(f.el("profile-status").textContent, "Sessão encerrada.");
  assert.match(f.el("notice").textContent, /encerramento no servidor não foi confirmado/);
});

test("a late successful ISSUE response after logout cannot repopulate the secret or ended-session status", async () => {
  const f = await fixture(); const pending = deferred<any>();
  f.fetchWith(async (url, options) => url === "/api/user-profiles" && JSON.parse(options.body).action === "ISSUE_INVITATION"
    ? pending.promise : response(503));
  const issue = f.issue(); await setImmediate();
  await f.logout();
  pending.resolve(response(200, { ok: true, registrationPassword: credential })); await issue;
  assert.equal(f.el("profile-registration-password").textContent, ""); assert.equal(f.el("profile-invitation").hidden, true);
  assert.equal(f.el("profile-status").textContent, "Sessão encerrada.");
});

test("authorization loss while ISSUE JSON is pending clears the secret and blocks the late parsed payload", async () => {
  const f = await fixture(); const parsed = deferred<any>();
  f.fetchWith(async url => url === "/api/user-profiles" ? { status: 200, ok: true, json: () => parsed.promise } : response(403));
  f.run('showProfileInvitation({registrationPassword:"' + credential + '"})');
  const issue = f.issue(); await setImmediate(); await f.run("load()");
  parsed.resolve({ ok: true, registrationPassword: credential }); await issue;
  assert.equal(f.el("profile-registration-password").textContent, ""); assert.equal(f.el("profile-invitation").hidden, true);
  assert.equal(f.el("profile-status").textContent, "Sessão encerrada."); assert.equal(f.redirects.length, 0);
});

test("a late ISSUE network error does not overwrite the ended-session status and stale buttons cannot issue again", async () => {
  const f = await fixture(); const pending = deferred<any>();
  f.fetchWith(async () => pending.promise);
  const issue = f.issue(); await setImmediate(); f.run("stopSessionView()");
  pending.reject(new Error("synthetic network outage")); await issue;
  assert.equal(f.el("profile-status").textContent, "Sessão encerrada.");
  const count = f.calls.length; await f.issue(); assert.equal(f.calls.length, count);
  assert.equal(f.run('showProfileInvitation({registrationPassword:"' + credential + '"})'), false);
  assert.equal(f.el("profile-registration-password").textContent, ""); assert.equal(f.el("profile-invitation").hidden, true);
});

test("an authorized ISSUE still displays once and page exit or the hide button erases it", async () => {
  const f = await fixture(); f.fetchWith(async () => response(200, { ok: true, registrationPassword: credential }));
  await f.issue(); assert.equal(f.el("profile-registration-password").textContent, credential);
  assert.equal(f.el("profile-invitation").hidden, false);
  const post = f.calls.find(call => call.options?.method === "POST")!;
  assert.equal(post.options.cache, "no-store"); assert.equal(post.options.credentials, "same-origin");
  assert.equal(post.options.headers["X-Aurora-CSRF"], "synthetic-profile");
  f.winHandlers.get("pagehide")!(); assert.equal(f.el("profile-registration-password").textContent, "");
  f.run('showProfileInvitation({registrationPassword:"' + credential + '"})');
  await f.el("profile-clear-invitation").handlers.get("click")!();
  assert.equal(f.el("profile-registration-password").textContent, ""); assert.equal(f.el("profile-invitation").hidden, true);
});
