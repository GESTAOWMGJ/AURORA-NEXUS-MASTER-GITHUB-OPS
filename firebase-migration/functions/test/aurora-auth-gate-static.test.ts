import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/auroraLoginClient.ts", import.meta.url), "utf8");

test("private login exposes reset without account enumeration", () => {
  assert.match(source, /sendPasswordResetEmail\(auth, email\)/);
  assert.match(source, /Se o e-mail estiver autorizado, as instruções de redefinição serão enviadas\./);
  assert.doesNotMatch(source, /Usuário não existe|Conta não encontrada|E-mail não cadastrado/);
});

test("reset action requires a syntactically plausible email before Firebase call", () => {
  assert.match(source, /!email \|\| !email\.includes\('@'\)/);
  assert.match(source, /Informe o e-mail autorizado\./);
});
