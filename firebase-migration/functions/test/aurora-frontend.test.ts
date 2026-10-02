import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auroraProtectedShell } from "../src/auroraFrontend.ts";

test("shell privado carrega dados somente pela API autenticada e não contém demo pública", () => {
  const html = auroraProtectedShell(
    { uid: "u1", email: "gestor@example.test", orgId: "wmgj", role: "auditor", permissions: [], facilityIds: [], allFacilities: true, mfaVerified: true },
    { action: "csrf-action", refresh: "csrf-refresh", integrationKey: "csrf-integration", logout: "csrf-logout" }
  );
  assert.match(html, /fetch\('\/api\/bootstrap'/);
  assert.match(html, /X-Aurora-CSRF/);
  assert.match(html, /fetch\('\/api\/actions'/);
  assert.match(html, /fetch\('\/api\/evidence'/);
  assert.match(html, /fetch\('\/api\/audit-events'/);
  assert.match(html, /csrf\.action/);
  assert.match(html, /csrf\.refresh/);
  assert.match(html, /csrf\.logout/);
  assert.match(html, /Sem fonte/);
  assert.match(html, /Não insira nome/);
  assert.match(html, /Resolver revisão com evidência/);
  assert.match(html, /evidenceRefs/);
  assert.match(html, /id="review-evidence" multiple required/);
  assert.match(html, /id="resolve-evidence" multiple required/);
  assert.match(html, /EVIDENCE_CONFIRMED/);
  assert.match(html, /const sessionMfa=true/);
  assert.match(html, /Aurora Native Intelligence/);
  assert.match(html, /\/api\/native-insight\?intent=/);
  assert.match(html, /Conclusão da versão vendável/);
  assert.match(html, /release\.engineeringReadinessPercent/);
  assert.match(html, /Registrar ação no app/);
  assert.match(html, /managementInput/);
  assert.match(html, /Registro de ações/);
  assert.match(html, /Atividade recente/);
  assert.match(html, /Trilha de auditoria recente/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /service-worker\.js/);
  assert.doesNotMatch(html, /demo pública/i);
});

test("shell escapa identidade antes de renderizar", () => {
  const html = auroraProtectedShell(
    { uid: "u1", email: "<script>alert(1)</script>", orgId: "wmgj", role: "viewer", permissions: [], facilityIds: [], allFacilities: true, mfaVerified: false },
    { action: "csrf-action", refresh: "csrf-refresh", integrationKey: "csrf-integration", logout: "csrf-logout" }
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /const sessionMfa=false/);
});

test("login conclui desafio TOTP antes de trocar o ID token por sessão", () => {
  const source = readFileSync(new URL("../src/auroraAuthGate.ts", import.meta.url), "utf8");
  assert.match(source, /auth\/multi-factor-auth-required/);
  assert.match(source, /firebaseAuthApi\.TotpMultiFactorGenerator\.assertionForSignIn/);
  assert.match(source, /firebaseAuthApi\.getMultiFactorResolver\(auth, error\)/);
  assert.match(source, /await mfaResolver\.resolveSignIn\(assertion\)/);
  assert.match(source, /await createPrivateSession\(credential\)/);
  assert.match(source, /autocomplete="one-time-code"/);
  assert.match(source, /manifest\.webmanifest/);
  assert.match(source, /service-worker\.js/);
});
