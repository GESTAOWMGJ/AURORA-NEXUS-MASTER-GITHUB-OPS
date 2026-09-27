import assert from "node:assert/strict";
import test from "node:test";
import { auroraProtectedShell } from "../src/auroraFrontend.ts";

test("shell privado carrega dados somente pela API autenticada e não contém demo pública", () => {
  const html = auroraProtectedShell(
    { uid: "u1", email: "gestor@example.test", orgId: "wmgj", role: "auditor", permissions: [], facilityIds: [], allFacilities: true, mfaVerified: true },
    { action: "csrf-action", refresh: "csrf-refresh", logout: "csrf-logout" }
  );
  assert.match(html, /fetch\('\/api\/bootstrap'/);
  assert.match(html, /X-Aurora-CSRF/);
  assert.match(html, /fetch\('\/api\/actions'/);
  assert.match(html, /csrf\.action/);
  assert.match(html, /csrf\.refresh/);
  assert.match(html, /csrf\.logout/);
  assert.match(html, /Sem fonte/);
  assert.match(html, /Não insira nome/);
  assert.doesNotMatch(html, /demo pública/i);
});

test("shell escapa identidade antes de renderizar", () => {
  const html = auroraProtectedShell(
    { uid: "u1", email: "<script>alert(1)</script>", orgId: "wmgj", role: "viewer", permissions: [], facilityIds: [], allFacilities: true, mfaVerified: false },
    { action: "csrf-action", refresh: "csrf-refresh", logout: "csrf-logout" }
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});
