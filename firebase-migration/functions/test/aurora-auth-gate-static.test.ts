import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/auroraLoginClient.ts", import.meta.url), "utf8");
const gate = fs.readFileSync(new URL("../src/auroraAuthGate.ts", import.meta.url), "utf8");

test("setup receives a session-bound refresh CSRF token only after membership checks", () => {
  const start = gate.indexOf('if (req.path === "/setup")');
  const setup = gate.slice(start, gate.indexOf("if (isDownload)", start));
  assert.ok(start > gate.indexOf("await resolveMember(decoded)"));
  assert.ok(start > gate.indexOf("companyEntryAllowsMember(entry?.orgId, member.orgId)"));
  assert.match(setup, /csrfTokenForSession\(req.get\("cookie"\), AURORA_NEXUS_CSRF_HMAC_KEY.value\(\), CSRF_PURPOSES.refresh\)/);
  assert.match(setup, /if \(!refreshCsrf\)/);
  assert.match(setup, /res.status\(503\)/);
  assert.match(setup, /setupPage\(member, refreshCsrf\)/);
});

test("private login exposes reset without account enumeration", () => {
  assert.match(source, /sendPasswordResetEmail\(auth, email\)/);
  assert.match(source, /Se o e-mail estiver autorizado, as instruções de redefinição serão enviadas\./);
  assert.doesNotMatch(source, /Usuário não existe|Conta não encontrada|E-mail não cadastrado/);
});

test("reset action requires a syntactically plausible email before Firebase call", () => {
  assert.match(source, /!email \|\| !email\.includes\('@'\)/);
  assert.match(source, /Informe o e-mail autorizado\./);
});
