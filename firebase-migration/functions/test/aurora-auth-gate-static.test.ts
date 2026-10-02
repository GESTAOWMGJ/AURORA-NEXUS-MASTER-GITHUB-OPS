import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/auroraAuthGate.ts", import.meta.url), "utf8");

test("private login exposes reset without account enumeration", () => {
  assert.match(source, /firebaseAuthApi\.sendPasswordResetEmail\(auth, email\)/);
  assert.match(source, /Se o e-mail estiver autorizado, as instruções de redefinição serão enviadas\./);
  assert.doesNotMatch(source, /Usuário não existe|Conta não encontrada|E-mail não cadastrado/);
});

test("reset action requires a syntactically plausible email before Firebase call", () => {
  assert.match(source, /!email \|\| !email\.includes\('@'\)/);
  assert.match(source, /Informe o e-mail autorizado\./);
});

test("login uses the pinned modular Web SDK instead of unsupported reserved SDK URLs", () => {
  assert.match(source, /https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.5\/firebase-app\.js/);
  assert.match(source, /https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.5\/firebase-auth\.js/);
  assert.match(source, /import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.5\/firebase-app\.js'\)/);
  assert.match(source, /import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.5\/firebase-auth\.js'\)/);
  assert.match(source, /authApi\.getAuth\(firebaseAppApi\.initializeApp\(config\)\)/);
  assert.match(source, /firebaseAuthApi\.signInWithEmailAndPassword\(auth, email, password\)/);
  assert.match(source, /firebaseAuthApi\.TotpMultiFactorGenerator\.assertionForSignIn/);
  assert.match(source, /firebaseAuthApi\.inMemoryPersistence/);
  assert.doesNotMatch(source, /\/__\/firebase\/(?:9|[1-9][0-9]+)\.[^'"\s]*firebase-(?:app|auth)/);
  assert.doesNotMatch(source, /firebase-app-compat|firebase-auth-compat|firebase\.auth\(\)/);
});

test("login fetches same-origin Firebase config without caching and fails closed", () => {
  assert.match(source, /fetch\('\/__\/firebase\/init\.json'/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /typeof config\.apiKey !== 'string'/);
  assert.match(source, /typeof config\.projectId !== 'string'/);
  assert.match(source, /initializeFirebaseAuth\(\)\.catch/);
  assert.match(source, /Acesso temporariamente indisponível\. Tente novamente em alguns minutos\./);
});

test("auth gate preserves no-store responses and a CSP that allows only the pinned SDK origin", () => {
  assert.match(source, /res\.set\("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"\)/);
  assert.match(source, /"script-src 'self' 'unsafe-inline' https:\/\/www\.gstatic\.com"/);
});
