import assert from "node:assert/strict";
import test from "node:test";
import { CSRF_PURPOSES, csrfTokenForSession, validCsrf } from "../src/auroraAccess.ts";

const secret = "ab".repeat(32);

test("CSRF funciona quando o Hosting encaminha somente __session", () => {
  const cookie = "__session=session-cookie-from-firebase-hosting";
  const token = csrfTokenForSession(cookie, secret, CSRF_PURPOSES.action);
  assert.equal(typeof token, "string");
  assert.equal(validCsrf(cookie, token, secret, CSRF_PURPOSES.action), true);
});

test("CSRF rejeita sessão diferente, token adulterado e formato inválido", () => {
  const cookie = "other=value; __session=session-a; ignored=value";
  const token = csrfTokenForSession(cookie, secret, CSRF_PURPOSES.action);
  assert.ok(token);
  assert.equal(validCsrf("__session=session-b", token, secret, CSRF_PURPOSES.action), false);
  assert.equal(validCsrf(cookie, token, secret, CSRF_PURPOSES.refresh), false);
  assert.equal(validCsrf(cookie, token, "cd".repeat(32), CSRF_PURPOSES.action), false);
  assert.equal(validCsrf(cookie, `${token.slice(0, -1)}x`, secret, CSRF_PURPOSES.action), false);
  assert.equal(validCsrf(cookie, "not-a-token", secret, CSRF_PURPOSES.action), false);
  assert.equal(validCsrf(undefined, token, secret, CSRF_PURPOSES.action), false);
  assert.equal(validCsrf(`${cookie}; __session=duplicate`, token, secret, CSRF_PURPOSES.action), false);
});

test("cada render recebe nonce novo sem invalidar a sessão", () => {
  const cookie = "__session=session-a";
  const first = csrfTokenForSession(cookie, secret, CSRF_PURPOSES.action);
  const second = csrfTokenForSession(cookie, secret, CSRF_PURPOSES.action);
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  assert.equal(validCsrf(cookie, first, secret, CSRF_PURPOSES.action), true);
  assert.equal(validCsrf(cookie, second, secret, CSRF_PURPOSES.action), true);
});

test("CSRF falha fechado para segredo ausente ou inválido", () => {
  const cookie = "__session=session-a";
  assert.equal(csrfTokenForSession(cookie, "", CSRF_PURPOSES.action), null);
  assert.equal(csrfTokenForSession(cookie, "not-hex", CSRF_PURPOSES.action), null);
});
