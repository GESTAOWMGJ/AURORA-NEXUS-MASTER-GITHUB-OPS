import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { Script, createContext } from "node:vm";
import test from "node:test";
import { auroraProtectedShell, type LoadedWebBuild } from "../src/auroraFrontend.js";

const member = { uid: "synthetic-reader", email: "reader@example.invalid", orgId: "synthetic-company", role: "operator",
  permissions: [], facilityIds: [], allFacilities: false, mfaVerified: false };
const build: LoadedWebBuild = { sourceSha: "a".repeat(40), version: "1.0.0-test", manifestSha256: "b".repeat(64), fileIntegrityVerified: true };
function canonical(web = build) {
  return { verification: { status: "VERIFIED_ACTIVE_PIN" }, certificate: { sourceSha: web.sourceSha,
    productVersion: web.version, canonicalOrigin: "https://auroranexus.com.br", components: {
      web: { sourceSha: web.sourceSha, version: web.version, manifestSha256: web.manifestSha256 },
      server: { sourceSha: web.sourceSha, version: web.version, manifestSha256: "c".repeat(64) } } },
    localServer: { status: "PACKAGE_FILES_VERIFIED", sourceSha: web.sourceSha, version: web.version, manifestMatches: true, fileIntegrityVerified: true },
    allClientsSynchronized: false };
}
const snapshot = (value: unknown = canonical()) => ({ canonicalVersion: value, release: { productVersion: "9.0.0-unverified-cockpit", gates: [] },
  projection: { competence: "2026-10", financialCents: {}, operations: {}, coverage: {}, modules: [] }, actions: [] });
type Handler = (event?: any) => unknown;
class Element {
  textContent = ""; className = ""; hidden = false; disabled = false; value = ""; checked = false; resets = 0;
  children: Element[] = []; handlers = new Map<string, Handler>(); button: Element | null = null;
  classList = { remove: (_name: string) => {} };
  addEventListener(name: string, callback: Handler) { this.handlers.set(name, callback); }
  appendChild(child: Element) { this.children.push(child); return child; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; this.textContent = ""; }
  querySelector(selector: string) { assert.equal(selector, "button"); return this.button ??= new Element(); }
  reset() { this.resets++; this.value = ""; }
  scrollIntoView() {}
}
const response = (status: number, body: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(loaded: LoadedWebBuild | null = build, initial = snapshot()) {
  const html = auroraProtectedShell(member, { action: "synthetic-action", refresh: "synthetic-refresh", integrationKey: "synthetic-integration",
    distributionApproval: "synthetic-distribution", logout: "synthetic-logout" }, "/portal", loaded ?? undefined);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]!);
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1]!, new Element()]));
  const el = (id: string) => { const value = elements.get(id); assert.ok(value, `Known DOM id: ${id}`); return value; };
  const calls: { url: string; options: any }[] = [], redirects: string[] = [], intervals: { callback: Handler; ms: number }[] = [];
  const handlers = new Map<string, Handler>();
  let fetcher = async (_url: string, _options: any): Promise<any> => response(200, initial);
  const document = { getElementById: el, createElement: () => new Element(), addEventListener() {}, visibilityState: "visible", activeElement: null as any };
  const navigator = { onLine: true };
  const context = createContext({ document, navigator, window: { addEventListener: (name: string, callback: Handler) => handlers.set(name, callback) },
    location: { replace: (url: string) => redirects.push(url), reload: () => { throw new Error("Automatic reload forbidden"); } },
    Intl, Date, AbortController, crypto: { randomUUID: () => "synthetic-request" },
    setInterval: (callback: Handler, ms: number) => intervals.push({ callback, ms }), setTimeout: () => 1, clearTimeout() {},
    fetch: (url: string, options: any) => { calls.push({ url, options }); return fetcher(url, options); } });
  scripts.forEach(script => new Script(script).runInContext(context)); await setImmediate();
  return { html, el, calls, redirects, handlers, document, navigator, intervals,
    fetchWith: (fn: typeof fetcher) => { fetcher = fn; }, run: (code: string) => new Script(code).runInContext(context) };
}

test("the emitted page compares its captured web build to the official pin without claiming other clients", async () => {
  const f = await fixture();
  assert.equal(f.el("app-release").textContent, build.version);
  assert.match(f.el("app-server-status").textContent, /Arquivos verificados/);
  assert.match(f.el("app-web-build").textContent, /MATCH_REPORTED/);
  assert.match(f.el("app-version-detail").textContent, /demais clientes não foram verificados/);
  assert.equal(f.intervals.find(item => item.ms === 60_000)?.ms, 60_000);
  assert.equal(f.calls[0]?.options.cache, "no-store");
});

test("a new bootstrap pin never rewrites the old loaded build or reloads unsaved edits", async () => {
  const f = await fixture(); const next = { ...build, sourceSha: "d".repeat(40), version: "1.0.1-test", manifestSha256: "e".repeat(64) };
  f.el("review-title").value = "Unsaved synthetic edit";
  f.fetchWith(async () => response(200, snapshot(canonical(next)))); await f.run("load()");
  assert.equal(f.el("app-release").textContent, next.version);
  assert.equal(f.el("app-web-build").textContent, build.version + " · UPDATE_NOT_APPLIED");
  assert.match(f.el("app-version-detail").textContent, /após concluir suas edições/);
  assert.equal(f.el("review-title").value, "Unsaved synthetic edit"); assert.equal(f.el("create-review").resets, 0);
  assert.equal(f.run("loadedPageBuild.sourceSha"), build.sourceSha); assert.equal(f.redirects.length, 0);
});

test("every web identity field and verified file bytes matter even if the numeric version is unchanged", async () => {
  for (const change of [{ sourceSha: "d".repeat(40) }, { version: "1.0.1-test" }, { manifestSha256: "e".repeat(64) }]) {
    const f = await fixture({ ...build, ...change }); assert.match(f.el("app-web-build").textContent, /UPDATE_NOT_APPLIED/);
  }
  for (const missing of [null, { ...build, fileIntegrityVerified: false }, { ...build, sourceSha: null }]) {
    const f = await fixture(missing);
    assert.equal(f.el("app-web-build").textContent, "WEB_BUILD_UNKNOWN");
  }
});

test("absent or unverified canonical pins never use cockpit or fresh server metadata as the official version", async () => {
  for (const candidate of [null, { ...canonical(), verification: { status: "NO_ACTIVE_PIN" } },
    { ...canonical(), verification: { status: "INVALID_ACTIVE_PIN" } },
    { ...canonical(), certificate: { ...canonical().certificate, canonicalOrigin: "https://synthetic.invalid" } }]) {
    const f = await fixture(build, snapshot(candidate)); assert.equal(f.el("app-release").textContent, "Não confirmada");
    assert.equal(f.el("app-web-build").textContent, "WEB_BUILD_UNKNOWN"); assert.equal(f.el("app-server-status").textContent, "Não confirmado");
  }
});

test("server mismatch does not become verified merely because its verification flags are true", async () => {
  const candidate = canonical(); candidate.localServer.sourceSha = "d".repeat(40);
  const f = await fixture(build, snapshot(candidate)); assert.match(f.el("app-server-status").textContent, /Servidor não confirmado/);
  assert.match(f.el("app-web-build").textContent, /MATCH_REPORTED/);
});

test("offline and failed polls remove current-match claims and preserve forms until a successful online check", async () => {
  const f = await fixture(); f.el("review-title").value = "Unsaved edit";
  f.navigator.onLine = false; f.handlers.get("offline")!();
  assert.equal(f.el("app-web-build").textContent, "WEB_BUILD_UNKNOWN"); assert.equal(f.el("app-release").textContent, "Não confirmada");
  const count = f.calls.length; await f.run("maybeReload()"); assert.equal(f.calls.length, count);
  assert.equal(f.el("review-title").value, "Unsaved edit");
  f.navigator.onLine = true; f.fetchWith(async () => response(503)); await f.run("load()");
  assert.equal(f.el("app-web-build").textContent, "WEB_BUILD_UNKNOWN");
  f.fetchWith(async () => response(200, snapshot())); await f.run("load()");
  assert.match(f.el("app-web-build").textContent, /MATCH_REPORTED/); assert.equal(f.el("review-title").value, "Unsaved edit");
});

test("polling waits during active edits and resumes without clearing them", async () => {
  const f = await fixture(); f.el("review-title").value = "Editing";
  f.document.activeElement = { closest: (selector: string) => selector === "form" ? f.el("create-review") : null };
  const count = f.calls.length; await f.run("maybeReload()"); assert.equal(f.calls.length, count);
  assert.match(f.el("sync-status").textContent, /sem edição em andamento/);
  f.document.activeElement = null; await f.run("maybeReload()"); assert.equal(f.calls.length, count + 1);
  assert.equal(f.el("review-title").value, "Editing");
});

test("authorization loss erases build/version fields and pending bootstrap JSON cannot restore them", async () => {
  const f = await fixture(); const pending = deferred<any>();
  f.fetchWith(async () => ({ status: 200, ok: true, json: () => pending.promise }));
  const loading = f.run("load()"); await setImmediate(); f.run("stopSessionView()");
  pending.resolve(snapshot()); await loading;
  for (const id of ["app-release", "app-server-status", "app-web-build", "app-version-detail"]) assert.equal(f.el(id).textContent, "—");
  assert.equal(f.run("loadedPageBuild"), null);
  const count = f.calls.length; await f.run("maybeReload()"); assert.equal(f.calls.length, count);
  f.handlers.get("offline")!(); assert.equal(f.el("app-web-build").textContent, "—");
});

for (const status of [401, 403]) test(`bootstrap authorization ${status} clears the loaded-build fields through the real handler`, async () => {
  const f = await fixture(); f.fetchWith(async () => response(status)); await f.run("load()");
  for (const id of ["app-release", "app-server-status", "app-web-build", "app-version-detail"]) assert.equal(f.el(id).textContent, "—");
  assert.equal(f.run("loadedPageBuild"), null); assert.equal(f.el("content").hidden, true);
  const count = f.calls.length; await f.run("maybeReload()"); assert.equal(f.calls.length, count);
});

test("unsafe metadata cannot close the emitted script or produce a matching page", async () => {
  const f = await fixture({ ...build, version: '</script><script>throw new Error("injected")</script>' });
  assert.equal(f.html.includes('</script><script>throw new Error("injected")</script>'), false);
  assert.equal(f.el("app-web-build").textContent, "WEB_BUILD_UNKNOWN");
});
