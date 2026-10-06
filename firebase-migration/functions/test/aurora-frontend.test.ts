import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auroraProtectedShell } from "../src/auroraFrontend.ts";

test("shell privado carrega dados somente pela API autenticada e não contém demo pública", () => {
  const html = auroraProtectedShell(
    { uid: "u1", email: "gestor@example.test", orgId: "wmgj", role: "auditor", permissions: [], facilityIds: [], allFacilities: true, mfaVerified: true },
    { action: "csrf-action", refresh: "csrf-refresh", integrationKey: "csrf-integration", distributionApproval: "csrf-distribution", logout: "csrf-logout" }
  );
  assert.match(html, /fetch\('\/api\/bootstrap'/);
  assert.match(html, /X-Aurora-CSRF/);
  assert.match(html, /fetch\('\/api\/actions'/);
  assert.match(html, /csrf\.action/);
  assert.match(html, /csrf\.refresh/);
  assert.match(html, /csrf\.logout/);
  assert.match(html, /Sem fonte/);
  assert.match(html, /Não insira nome/);
  assert.match(html, /Resolver revisão com evidência/);
  assert.match(html, /evidenceRefs/);
  assert.match(html, /EVIDENCE_CONFIRMED/);
  assert.match(html, /const sessionMfa=true/);
  assert.match(html, /Aurora Native Intelligence/);
  assert.match(html, /\/api\/native-insight\?intent=/);
  assert.match(html, /Conclusão da versão vendável/);
  assert.match(html, /release\.engineeringReadinessPercent/);
  assert.match(html, /Registrar ação no app/);
  assert.match(html, /managementInput/);
  assert.match(html, /Registro de ações/);
  assert.match(html, /Motor de implantação/);
  assert.match(html, /impact danger/);
  assert.match(html, /resolver primeiro/);
  assert.match(html, /caixa real/);
  assert.match(html, /Atividade recente/);
  assert.match(html, /Fechamento mensal — visão rápida/);
  assert.match(html, /Aprovar liberação para distribuição/);
  assert.match(html, /\/api\/distribution-approval/);
  assert.match(html, /csrf\.distributionApproval/);
  assert.match(html, /Não executa PIX/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /service-worker\.js/);
  assert.doesNotMatch(html, /demo pública/i);
});

test("shell escapa identidade antes de renderizar", () => {
  const html = auroraProtectedShell(
    { uid: "u1", email: "<script>alert(1)</script>", orgId: "wmgj", role: "viewer", permissions: [], facilityIds: [], allFacilities: true, mfaVerified: false },
    { action: "csrf-action", refresh: "csrf-refresh", integrationKey: "csrf-integration", distributionApproval: "csrf-distribution", logout: "csrf-logout" }
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /const sessionMfa=false/);
});

test("login conclui desafio TOTP antes de trocar o ID token por sessão", () => {
  const source = readFileSync(new URL("../src/auroraAuthGate.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/auroraLoginClient.ts", import.meta.url), "utf8");
  assert.match(client, /auth\/multi-factor-auth-required/);
  assert.match(client, /TotpMultiFactorGenerator\.assertionForSignIn/);
  assert.match(client, /await resolver\.resolveSignIn\(assertion\)/);
  assert.match(client, /await completeLogin\(credential\.user\)/);
  assert.match(source, /autocomplete="one-time-code"/);
  assert.match(source, /manifest\.webmanifest/);
  assert.match(client, /webUpdateClient\(\)/);
  assert.match(readFileSync(new URL("../src/auroraWebUpdateClient.ts", import.meta.url), "utf8"), /service-worker\.js/);
});
