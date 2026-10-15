import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/auroraLoginClient.ts", import.meta.url), "utf8");
const gate = fs.readFileSync(new URL("../src/auroraAuthGate.ts", import.meta.url), "utf8");
const recovery = fs.readFileSync(new URL("../src/auroraPasswordRecovery.ts", import.meta.url), "utf8");

test("setup receives a session-bound refresh CSRF token only after membership checks", () => {
  const start = gate.indexOf('if (req.path === "/setup")');
  const setup = gate.slice(start, gate.indexOf("if (isDownload)", start));
  assert.ok(start > gate.indexOf("await resolveMember(decoded)"));
  assert.ok(start > gate.indexOf("companyEntryAllowsMember(entry?.orgId, member.orgId)"));
  assert.match(setup, /csrfTokenForSession\(req.get\("cookie"\), AURORA_NEXUS_CSRF_HMAC_KEY.value\(\), CSRF_PURPOSES.refresh\)/);
  assert.match(setup, /if \(!refreshCsrf\)/);
  assert.match(setup, /res.status\(503\)/);
  assert.match(setup, /CSRF_PURPOSES.integrationKey/);
  assert.match(setup, /if\(!integrationCsrf\)/);
  assert.match(setup, /setupPage\(member, refreshCsrf, ingestCsrf,integrationCsrf\)/);
});

test("private login exposes reset without account enumeration", () => {
  assert.match(recovery, /sendPasswordResetEmail\(auth, email\)/);
  assert.match(recovery, /Se o e-mail estiver autorizado, as instruções de redefinição serão enviadas\./);
  assert.doesNotMatch(recovery, /Usuário não existe|Conta não encontrada|E-mail não cadastrado/);
  assert.match(source, /passwordRecoveryClient\(\)/);
});

test("reset action normalizes identity, validates syntax and throttles duplicates", () => {
  assert.match(recovery, /normalizeRecoveryEmail/);
  assert.match(recovery, /validRecoveryEmail/);
  assert.match(recovery, /recoveryCooldownUntil/);
  assert.match(recovery, /Date\.now\(\) < recoveryCooldownUntil/);
  assert.match(recovery, /Informe um e-mail válido\./);
});

test("recovery links are HTTPS, host-bound and require one valid reset code", () => {
  assert.match(recovery, /recoveryHosts/);
  assert.match(recovery, /link\.protocol !== 'https:'/);
  assert.match(recovery, /modes\.length !== 1/);
  assert.match(recovery, /codes\.length !== 1/);
  assert.match(recovery, /\^\[A-Za-z0-9_-\]\{1,2048\}\$/);
});

test("account security is rendered only after current membership and gets a session-bound logout token", () => {
  const start = gate.indexOf('if (req.path === "/account-security")');
  const end = gate.indexOf('if (req.path === "/setup")', start);
  assert.ok(start > gate.indexOf("await resolveMember(decoded)"));
  assert.ok(start > gate.indexOf("companyEntryAllowsMember(entry?.orgId, member.orgId)"));
  assert.match(gate.slice(start, end), /CSRF_PURPOSES.logout/);
  assert.match(gate.slice(start, end), /if \(!logoutCsrf\)/);
  assert.match(gate.slice(start, end), /accountSecurityPage\(member, logoutCsrf\)/);
});
