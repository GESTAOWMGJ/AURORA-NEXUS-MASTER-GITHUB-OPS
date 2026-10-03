import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(new URL("../../../tools/run-clasp-checked.sh", import.meta.url));
const functionName = "auroraRc11ConfigurarEndpointExistente";
const generic = "UNEXPECTED_APPS_SCRIPT_EXECUTION_ERROR";
const canaries = [
  "short secret with spaces!",
  "hmac=" + "a1".repeat(32),
  "refresh_token=1//synthetic.oauth/token+value==",
  "-----BEGIN PRIVATE KEY-----\\nsynthetic private material\\n-----END PRIVATE KEY-----",
  "::warning::INJECTED_WORKFLOW_COMMAND",
  "RC11_SYNTHETIC_SECRET_SHOULD_NEVER_BE_PRINTED",
];
const secretText = canaries.join("\r\n");

function execute(stdout: string, stderr = "", exitCode = 0, withParams = false) {
  const dir = mkdtempSync(join(tmpdir(), "rc11-clasp-test-"));
  try {
    const out = join(dir, "result.json");
    const args = join(dir, "args.json");
    writeFileSync(join(dir, "fixture-out"), stdout, { mode: 0o600 });
    writeFileSync(join(dir, "fixture-err"), stderr, { mode: 0o600 });
    writeFileSync(join(dir, "clasp"), `#!/bin/sh
printf '%s\\n' "$@" > "$CLASP_TEST_DIR/args.json"
cat "$CLASP_TEST_DIR/fixture-out"
cat "$CLASP_TEST_DIR/fixture-err" >&2
exit "$CLASP_TEST_EXIT"
`, { mode: 0o700 });
    const params = withParams ? [JSON.stringify(["https://example.invalid/ingestWmgjEvent", secretText])] : [];
    const result = spawnSync("bash", [runner, functionName, out, ...params], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: dir + ":" + process.env.PATH,
        TMPDIR: dir,
        CLASP_TEST_DIR: dir,
        CLASP_TEST_EXIT: String(exitCode),
      },
    });
    assert.ifError(result.error);
    const output = existsSync(out) ? readFileSync(out, "utf8") : null;
    const mode = existsSync(out) ? statSync(out).mode & 0o777 : null;
    const expectedFiles = ["args.json", "clasp", "fixture-err", "fixture-out", ...(output === null ? [] : ["result.json"])];
    assert.deepEqual(readdirSync(dir).sort(), expectedFiles.sort(), "temporary response files must be removed");
    return { ...result, output, mode, args: readFileSync(args, "utf8").trimEnd().split("\n") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertDiagnostic(stdout: string, expected = generic, code = "3") {
  const result = execute(stdout, secretText, 0, true);
  assert.equal(result.status, 73);
  assert.equal(result.stdout, "");
  assert.equal(result.output, null, "invalid envelopes must not be saved as successful output");
  assert.equal(result.stderr, `::error title=Apps Script invalid execution response::Function ${functionName} returned error code ${code}: ${expected}\n`);
  for (const canary of canaries) assert.equal((result.stdout + result.stderr).includes(canary), false);
}

test("clasp diagnostic emits known RC11 identifiers without secret suffixes or raw output", () => {
  for (const id of ["RC11_HMAC_EXISTENTE_AUSENTE", "RC11_HMAC_PROBE_INESPERADO", "RC11_CABECALHO_BLOQUEADO"]) {
    assertDiagnostic(JSON.stringify({ error: { code: 3, details: [{ errorMessage: `Error: ${id}: ${secretText}` }] } }), id);
  }
});

test("clasp diagnostic covers every exception identifier in the canonical RC11 source", () => {
  const source = readFileSync(new URL("../../../src/34_AURORA_RC11_FIRESTORE_CONTROL.gs", import.meta.url), "utf8");
  const identifiers = new Set([...source.matchAll(/new Error\('(?<id>RC11_[A-Z0-9_]+)/g)].map(match => match.groups!.id));
  assert.ok(identifiers.size > 0);
  for (const id of identifiers) {
    assertDiagnostic(JSON.stringify({ error: { code: 3, details: [{ errorMessage: id + ": " + secretText }] } }), id);
  }
});

test("clasp diagnostic falls back safely for arbitrary, forged or embedded RC11 messages", () => {
  for (const message of [secretText, "", "RC11_HMAC_EXISTENTE_AUSENTE_SECRET", "RC11_HMAC_EXISTENTE_AUSENTElowercase", "prefixRC11_HMAC_EXISTENTE_AUSENTE", [secretText], { message: secretText }]) {
    assertDiagnostic(JSON.stringify({ error: { code: 3, details: [{ errorMessage: message }] } }));
  }
});

test("clasp diagnostic permits only numeric RPC codes and controlled fallback messages", () => {
  for (const code of [secretText, "3", -1, 17, 3.5, null, { secretText }, [3]]) {
    assertDiagnostic(JSON.stringify({ error: { code, message: "RC11_HMAC_INVALIDO: " + secretText } }), "RC11_HMAC_INVALIDO", "UNKNOWN");
  }
  assertDiagnostic(JSON.stringify({ error: { code: 7, message: "Error: RC11_KEYRING_INVALIDO: " + secretText } }), "RC11_KEYRING_INVALIDO", "7");
});

test("clasp diagnostic fails closed for malformed, absent, mixed and multiple envelopes", () => {
  for (const value of ["", secretText, "not json", "null", "[]", "{}", "true", JSON.stringify(secretText), JSON.stringify({ response: null }), JSON.stringify({ error: secretText }), JSON.stringify({ error: { details: secretText } }), '{"error":{"code":3}}\n{"response":{"ok":true}}']) {
    assertDiagnostic(value, generic, "UNKNOWN");
  }
  assertDiagnostic(JSON.stringify({ response: { ok: true }, error: { code: 3, message: secretText } }));
});

test("clasp success preserves the nondev invocation, params and private result without logging", () => {
  const payload = JSON.stringify({ response: { ok: true, dryRun: true } });
  const result = execute(payload, secretText, 0, true);
  assert.equal(result.status, 0);
  assert.equal(result.stdout + result.stderr, "");
  assert.equal(result.output, payload);
  assert.equal(result.mode, 0o600);
  assert.deepEqual(result.args, ["run", functionName, "--nondev", "--json", "--params", JSON.stringify(["https://example.invalid/ingestWmgjEvent", secretText])]);
});

test("clasp OAuth, deployment and process failures retain fail-closed exit codes without output leaks", () => {
  for (const [message, processCode, expectedCode] of [["NOT_AUTHORIZED", 0, 71], ["API executable not published", 0, 72], ["unexpected process failure", 19, 19]] as const) {
    const result = execute(secretText, message + "\n" + secretText, processCode);
    assert.equal(result.status, expectedCode);
    assert.equal(result.stdout, "");
    assert.equal(result.output, null);
    for (const canary of canaries) assert.equal(result.stderr.includes(canary), false);
  }
});
