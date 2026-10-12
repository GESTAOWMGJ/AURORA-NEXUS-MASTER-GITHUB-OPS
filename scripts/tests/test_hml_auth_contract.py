#!/usr/bin/env python3
"""Offline regression of the real HML workflow blocks; never contacts Firebase.

Run: python -m unittest discover -s scripts/tests -p test_hml_auth_contract.py -v
Requires Python 3.9+, PyYAML, bash, jq and Node 22. All credentials/responses are synthetic.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
TARGETS = {
    "aurora-hml-auth-smoke-once.yml": ("smoke", "Validate HML login and organic runtime"),
    "deploy-aurora-firebase.yml": ("deploy", "Authenticated smoke test without stored password"),
}
START = "# signInWithCustomToken does not return localId. Validate identity server-side."
END = 'echo "AUTH_SMOKE_UID_VERIFIED"'
TOKEN = "SYNTHETIC_TEST_TOKEN_NOT_A_CREDENTIAL"
UID = "synthetic-smoke-user"
GOOD_AUTH = {"idToken": TOKEN, "refreshToken": "SYNTHETIC_REFRESH", "expiresIn": "3600", "isNewUser": False}
GOOD_ACCOUNT = {"users": [{"localId": UID, "disabled": False}]}
SHELL_TEST_TIMEOUT = 60 if os.name == "nt" else 10


def shell_path(path):
    """Git Bash accepts POSIX drive paths; Linux keeps its native paths."""
    value = str(Path(path).resolve()).replace("\\", "/")
    if os.name == "nt":
        return "/" + value[0].lower() + value[2:]
    return value


class UniqueKeyLoader(yaml.BaseLoader):
    """Keep GitHub's 'on' key a string and reject silently overwritten YAML keys."""

    def construct_mapping(self, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in result:
                raise yaml.constructor.ConstructorError(
                    "mapping", node.start_mark, f"duplicate key: {key}", key_node.start_mark
                )
            result[key] = self.construct_object(value_node, deep=deep)
        return result


def load_workflow(path):
    return yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueKeyLoader)


def actual_block(filename):
    job_id, name = TARGETS[filename]
    workflow = load_workflow(WORKFLOWS / filename)
    steps = [step for step in workflow["jobs"][job_id]["steps"] if step.get("name") == name]
    if len(steps) != 1:
        raise AssertionError(f"{filename}: expected exactly one smoke step")
    script = steps[0]["run"]
    if script.count(START) != 1 or script.count(END) != 1:
        raise AssertionError(f"{filename}: identity validation block missing or duplicated")
    if ".localId // empty" in script:
        raise AssertionError(f"{filename}: obsolete custom-token response check returned")
    if script.count("accounts:lookup?key=") != 1:
        raise AssertionError(f"{filename}: account lookup missing or duplicated")
    return script[script.index(START):script.index(END) + len(END)] + "\n"


class WorkflowStructureTests(unittest.TestCase):
    def test_all_workflows_parse_and_all_bash_blocks_have_valid_syntax(self):
        paths = sorted(set(WORKFLOWS.glob("*.yml")) | set(WORKFLOWS.glob("*.yaml")))
        self.assertGreaterEqual(len(paths), 2)
        scripts = 0
        for path in paths:
            with self.subTest(workflow=path.name):
                workflow = load_workflow(path)
                self.assertIsInstance(workflow, dict)
                self.assertIn("on", workflow)
                self.assertIsInstance(workflow.get("jobs"), dict)
                default_shell = workflow.get("defaults", {}).get("run", {}).get("shell", "bash")
                for job_id, job in workflow["jobs"].items():
                    ids = [s["id"] for s in job.get("steps", []) if "id" in s]
                    self.assertEqual(len(ids), len(set(ids)), f"{path.name}/{job_id}: duplicate step id")
                    job_shell = job.get("defaults", {}).get("run", {}).get("shell", default_shell)
                    for index, step in enumerate(job.get("steps", [])):
                        if "run" not in step:
                            continue
                        shell = step.get("shell", job_shell).split()[0]
                        self.assertIn(shell, ("bash", "sh"), f"Add explicit syntax validation for {shell}: {path.name}/{job_id}/{index}")
                        # Expressions are runner substitutions, not Bash parameter expansions.
                        script = re.sub(r"\$\{\{.*?\}\}", "AURORA_CI_EXPRESSION", step["run"], flags=re.S)
                        result = subprocess.run([shell, "-n"], input=script, text=True, capture_output=True, timeout=10)
                        self.assertEqual(result.returncode, 0, f"{path.name}/{job_id}/{index}: {result.stderr}")
                        scripts += 1
        print(f"WORKFLOW_SYNTAX_PASS files={len(paths)} shell_blocks={scripts}", flush=True)

    def test_duplicate_yaml_keys_are_rejected(self):
        with self.assertRaises(yaml.constructor.ConstructorError):
            yaml.load("jobs:\n  smoke: {}\n  smoke: {}\n", Loader=UniqueKeyLoader)

    def test_canonical_route_gate_precedes_auth_and_deploy_smokes_exact_hml_host(self):
        gate = "Require canonical HTTPS and HML routing before cloud authentication"
        for filename, (job_id, name) in TARGETS.items():
            workflow = load_workflow(WORKFLOWS / filename)
            steps = workflow["jobs"][job_id]["steps"]
            gates = [index for index, step in enumerate(steps) if step.get("name") == gate]
            self.assertEqual(len(gates), 1)
            auth = next(index for index, step in enumerate(steps)
                        if step.get("uses", "").startswith("google-github-actions/auth@"))
            self.assertLess(gates[0], auth)
            self.assertIn('node firebase-migration/scripts/check-canonical-preflight.mjs "$PROJECT_ID"',
                          steps[gates[0]]["run"])
            smoke = next(step["run"] for step in steps if step.get("name") == name)
            self.assertIn('="https://auroranexus.com.br"', smoke)
            if filename == "deploy-aurora-firebase.yml":
                self.assertIn('technical_origin="https://${PROJECT_ID}.web.app"', smoke)
                self.assertIn('"${technical_origin}/__sessionLogin"', smoke)
                self.assertIn('"${technical_origin}/api/bootstrap"', smoke)
            else:
                self.assertNotIn('.web.app', smoke)
            self.assertNotIn('--location', smoke)
            self.assertNotRegex(smoke, r'curl[^\n]*\s-L\b')
        deploy = load_workflow(WORKFLOWS / "deploy-aurora-firebase.yml")["jobs"]["deploy"]["steps"]
        negative = next(step["run"] for step in deploy if step.get("name") == "Smoke test private shell and deployed functions")
        self.assertEqual(negative.count('.web.app'), 1)
        self.assertIn('technical_origin="https://${PROJECT_ID}.web.app"', negative)
        public_gate = 'CANONICAL_PREFLIGHT_SCOPE=routing-only'
        technical_gate = 'CANONICAL_PREFLIGHT_SCOPE=technical-api'
        self.assertEqual(negative.count(public_gate), 1)
        self.assertEqual(negative.count(technical_gate), 1)
        self.assertLess(negative.index(public_gate), negative.index(technical_gate))
        self.assertIn('technical_headers="$(mktemp "${RUNNER_TEMP}/aurora-technical-headers.XXXXXX")"', negative)
        self.assertIn('--dump-header "$technical_headers"', negative)
        self.assertIn('--output "$technical_shell"', negative)
        self.assertIn('if [ "$technical_status" = "308" ]; then', negative)
        self.assertIn("tolower($0) ~ /^location:/", negative)
        self.assertIn('test "$technical_location" = "${canonical_origin}/portal"', negative)
        self.assertIn('elif [ "$technical_status" = "200" ]; then', negative)
        self.assertIn('assert_private_login "$technical_shell" "$technical_headers"', negative)
        self.assertIn('assert_private_login "$canonical_shell" "$canonical_headers" canonical', negative)
        self.assertIn('!hasUsableLoginForm(html)', negative)
        self.assertIn('browserGuard', negative)
        self.assertIn('Technical Firebase host exposed the private shell', negative)
        self.assertEqual(negative.count('assert_auth_required "'), 7)
        self.assertIn('code="$(jq -r', negative)
        self.assertIn('Anonymous smoke contract mismatch', negative)
        self.assertNotIn('shell="$(curl --fail --silent --show-error --max-time 30 "${canonical_origin}/portal")"', negative)
        self.assertNotIn('grep -Fq "Ambiente privado"', negative)
        self.assertIn('-H "Origin: ${canonical_origin}"', negative)
        self.assertIn('"${technical_origin}/api/bootstrap"', negative)
        self.assertIn('"${canonical_origin}/api/bootstrap"', negative)
        self.assertIn('assert_auth_required "canonical-bootstrap"', negative)
        self.assertNotIn('base_url', negative)
        user_profiles = next(step["run"] for step in deploy if step.get("name") == "Verify user profile API rejects anonymous access")
        self.assertIn('-H "Origin: ${canonical_origin}"', user_profiles)
        self.assertIn('technical_origin="https://${PROJECT_ID}.web.app"', user_profiles)
        self.assertIn('"${technical_origin}/api/user-profiles"', user_profiles)
        auth = next(step["run"] for step in deploy if step.get("name") == "Authenticated smoke test without stored password")
        self.assertNotIn('base_url', auth)
        self.assertIn('technical_origin="https://${PROJECT_ID}.web.app"', auth)
        self.assertIn('"${technical_origin}/__sessionLogin"', auth)
        self.assertNotIn('AUTH_PRIVATE_SHELL_VERIFIED', auth)

    def test_technical_probe_requires_functional_login_or_verified_canonical_redirect(self):
        steps = load_workflow(WORKFLOWS / "deploy-aurora-firebase.yml")["jobs"]["deploy"]["steps"]
        smoke = next(step["run"] for step in steps if step.get("name") == "Smoke test private shell and deployed functions")
        start = smoke.index('technical_headers="$(mktemp')
        end = smoke.index('assert_auth_required() {', start)
        probe = smoke[start:end]
        self.assertNotIn('--location', probe)
        self.assertNotRegex(probe, r'\s-L\b')
        prefix = '''set -euo pipefail
canonical_origin="https://auroranexus.com.br"
technical_origin="https://wmgj-hml-jfn-20260927.web.app"
mktemp() {
  local path="${1/XXXXXX/synthetic}"
  test "$path" != "$1"
  : > "$path"
  printf '%s' "$path"
}
# TemporaryDirectory performs fixture cleanup after the shell returns.
rm() { :; }
curl() {
  local headers="" output="" last="" status="" location="" body=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dump-header) headers="$2"; shift 2 ;;
      --output) output="$2"; shift 2 ;;
      --write-out|--max-time) shift 2 ;;
      --silent|--show-error) shift ;;
      *) last="$1"; shift ;;
    esac
  done
  if [ "$last" = "${technical_origin}/" ]; then
    status="$TEST_TECHNICAL_STATUS"; location="$TEST_TECHNICAL_LOCATION"; body="$TEST_TECHNICAL_BODY"
  else
    test "$last" = "${canonical_origin}/portal"
    status="$TEST_CANONICAL_STATUS"; body="$TEST_CANONICAL_BODY"
  fi
  printf 'HTTP/2 %s\\r\\n%s: %s\\r\\nContent-Type: %s\\r\\n\\r\\n' "$status" "$TEST_LOCATION_HEADER" "$location" "$TEST_CONTENT_TYPE" > "$headers"
  printf '%s' "$body" > "$output"
  printf '%s' "$status"
}
'''
        login = '<form id="login-form"><input name="email" type="email"><input name="password" type="password"><button id="submit" type="submit">Entrar</button></form>'
        guard = '<script>location.replace("https://auroranexus.com.br/portal"+location.search)</script>'
        gate_source = (ROOT / "firebase-migration/functions/src/auroraAuthGate.ts").read_text(encoding="utf-8")
        host_bound_guard = re.search(r'function technicalHostBrowserRedirect\(\): string \{[\s\S]*?return `([^`]+)`;', gate_source).group(1)
        landing = '<!doctype html><html><head><script src="/_next/static/main.js"></script></head><body>Portal público</body></html>'
        for status, location, body, canonical_status, canonical_body, expected in [
            ('200', '', login, '200', landing, 0),
            ('308', 'https://auroranexus.com.br/portal', '', '200', login, 0),
            ('308', 'https://auroranexus.com.br/portal', '', '200', host_bound_guard + login, 0),
            ('308', 'https://auroranexus.com.br/portal', '', '200', guard + login, 91),
            ('308', 'https://example.test/portal', '', '200', login, 1),
            ('308', 'http://auroranexus.com.br/portal', '', '200', login, 1),
            ('308', 'https://auroranexus.com.br/portal?next=evil', '', '200', login, 1),
            ('308', 'https://auroranexus.com.br/portal', '', '200', landing, 91),
            ('308', 'https://auroranexus.com.br/portal', '', '308', '', 1),
            ('200', '', guard, '200', login, 91),
            ('200', '', guard + login, '200', login, 91),
            ('200', '', host_bound_guard + login, '200', login, 91),
            ('200', '', '<meta http-equiv="refresh" content="0;url=/portal">' + login, '200', login, 91),
            ('200', '', '<html><title>Aurora Nexus | Login</title></html>', '200', login, 91),
            ('200', '', login.replace('type="password"', 'type="password" disabled'), '200', login, 91),
            ('200', '', login.replace('name="email"', 'id="email"'), '200', login, 91),
            ('200', '', landing, '200', login, 91),
            ('200', '', guard + 'Centro de gestão WMGJ', '200', login, 90),
            ('308', 'https://auroranexus.com.br/portal', 'Centro de gestão WMGJ', '200', login, 90),
            ('302', 'https://auroranexus.com.br/portal', '', '200', login, 90),
        ]:
            with self.subTest(status=status, location=location, body=body):
                with tempfile.TemporaryDirectory() as temporary:
                    bridge = ""
                    if os.name == "nt":
                        # Git Bash can retain inherited native Node pipe handles
                        # after the command completes. Pump the same Node script
                        # through Python with explicit streams on Windows.
                        node_bridge = Path(temporary) / "node-bridge.py"
                        node_bridge.write_text('''import os, re, subprocess, sys
args = [value[1] + ":" + value[2:] if re.match(r"^/[A-Za-z]/", value) else value for value in sys.argv[1:]]
result = subprocess.run([os.environ["TEST_NODE_EXECUTABLE"], *args], input=sys.stdin.buffer.read(), capture_output=True, timeout=20)
sys.stdout.buffer.write(result.stdout)
sys.stderr.buffer.write(result.stderr)
sys.exit(result.returncode)
''', encoding="utf-8")
                        bridge = "node() { " + shlex.quote(shell_path(sys.executable)) + " " + shlex.quote(shell_path(node_bridge)) + ' "$@"; }\n'
                    result = subprocess.run(['bash', '--noprofile', '--norc', '-c', prefix + bridge + probe],
                                            env=dict(os.environ, RUNNER_TEMP=shell_path(temporary),
                                                     TEST_TECHNICAL_STATUS=status,
                                                     TEST_TECHNICAL_LOCATION=location,
                                                     TEST_TECHNICAL_BODY=body,
                                                     TEST_CANONICAL_STATUS=canonical_status,
                                                     TEST_CANONICAL_BODY=canonical_body,
                                                     TEST_LOCATION_HEADER='lOcAtIoN',
                                                     TEST_NODE_EXECUTABLE=shutil.which('node') or 'node',
                                                     TEST_CONTENT_TYPE='text/html; charset=utf-8'),
                                            capture_output=True, timeout=SHELL_TEST_TIMEOUT)
                    self.assertEqual(result.returncode, expected, result.stderr.decode())

    def test_anonymous_contract_mismatch_is_sanitized_and_actionable(self):
        steps = load_workflow(WORKFLOWS / "deploy-aurora-firebase.yml")["jobs"]["deploy"]["steps"]
        smoke = next(step["run"] for step in steps if step.get("name") == "Smoke test private shell and deployed functions")
        start = smoke.index('assert_auth_required() {')
        end = smoke.index('if [ "$technical_status" = "308" ]; then', start)
        helper = smoke[start:end]
        for status, payload, expected, expected_code in [
            ('401', '{"ok":false,"code":"AUTH_REQUIRED"}', 0, None),
            ('403', '{"ok":false,"code":"CROSS_SITE_REJECTED","secret":"must-not-leak"}', 91, 'CROSS_SITE_REJECTED'),
            ('401', 'not-json-with-secret', 91, 'NON_JSON'),
        ]:
            with self.subTest(status=status, payload=payload):
                with tempfile.TemporaryDirectory() as temporary:
                    response = Path(temporary) / 'response.json'
                    response.write_text(payload, encoding='utf-8')
                    script = f'''set -euo pipefail
{helper}
assert_auth_required "synthetic-endpoint" "{status}" "{shell_path(response)}"
'''
                    result = subprocess.run(['bash', '--noprofile', '--norc', '-c', script],
                                            capture_output=True, timeout=10)
                    self.assertEqual(result.returncode, expected, result.stderr.decode())
                    stderr = result.stderr.decode()
                    self.assertNotIn('must-not-leak', stderr)
                    self.assertNotIn('not-json-with-secret', stderr)
                    if expected_code:
                        self.assertIn('synthetic-endpoint', stderr)
                        self.assertIn(f'HTTP {status}', stderr)
                        self.assertIn(f'code {expected_code}', stderr)

    def test_canonical_redirect_requires_anonymous_api_denial(self):
        steps = load_workflow(WORKFLOWS / "deploy-aurora-firebase.yml")["jobs"]["deploy"]["steps"]
        smoke = next(step["run"] for step in steps if step.get("name") == "Smoke test private shell and deployed functions")
        helper_start = smoke.index('assert_auth_required() {')
        gate_start = smoke.index('if [ "$technical_status" = "308" ]; then', helper_start)
        gate_end = smoke.index('\nbootstrap_status=', gate_start)
        helper_and_gate = smoke[helper_start:gate_end]
        for root_status, api_status, payload, expected in [
            ('308', '401', '{"ok":false,"code":"AUTH_REQUIRED"}', 0),
            ('308', '200', '{"ok":true,"secret":"must-not-leak"}', 91),
            ('308', '401', '{"ok":false,"code":"OTHER_DENIAL"}', 91),
            ('308', '200', '<html>Public landing</html>', 91),
            ('308', '403', '{"ok":false,"code":"CROSS_SITE_REJECTED"}', 91),
            ('200', '200', 'must-not-call-canonical', 0),
        ]:
            with self.subTest(root_status=root_status, api_status=api_status):
                with tempfile.TemporaryDirectory() as temporary:
                    env = dict(os.environ, RUNNER_TEMP=shell_path(temporary),
                               TEST_ROOT_STATUS=root_status, TEST_API_STATUS=api_status,
                               TEST_API_PAYLOAD=payload)
                    prefix = '''set -euo pipefail
canonical_origin="https://auroranexus.com.br"
technical_status="$TEST_ROOT_STATUS"
negative_response="$(mktemp "${RUNNER_TEMP}/canonical-api.XXXXXX.json")"
trap 'rm -f "$negative_response"' EXIT
rm() { :; }
curl() {
  local output="" last=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output) output="$2"; shift 2 ;;
      --write-out|--max-time|-H) shift 2 ;;
      --silent|--show-error) shift ;;
      *) last="$1"; shift ;;
    esac
  done
  test "$last" = "${canonical_origin}/api/bootstrap"
  test "$TEST_API_PAYLOAD" != "must-not-call-canonical"
  printf '%s' "$TEST_API_PAYLOAD" > "$output"
  printf '%s' "$TEST_API_STATUS"
}
'''
                    result = subprocess.run(['bash', '--noprofile', '--norc', '-c', prefix + helper_and_gate],
                                            env=env, capture_output=True, timeout=10)
                    self.assertEqual(result.returncode, expected, result.stderr.decode())
                    self.assertNotIn('must-not-leak', result.stdout.decode() + result.stderr.decode())

    def test_critical_deploy_steps_are_unique_and_gates_remain(self):
        workflow = load_workflow(WORKFLOWS / "deploy-aurora-firebase.yml")
        self.assertEqual(set(workflow["on"]), {"workflow_dispatch"})
        deploy = workflow["jobs"]["deploy"]
        self.assertEqual(deploy["needs"], "validate")
        self.assertEqual(deploy["environment"], "firebase-homologation")
        self.assertEqual(deploy["if"], "${{ inputs.deploy_confirmation == 'DEPLOY_HOMOLOGATION' }}")
        names = [s.get("name") for job in workflow["jobs"].values() for s in job.get("steps", [])]
        critical = [
            "Require dispatch from main", "Pin immutable candidate to current main",
            "Validate full Firebase and API contract suite", "Validate target and deployment scope",
            "Require the validated main candidate", "Reconfirm immutable main immediately before deploy",
            "Require protected deployment configuration", "Preflight protected homologation resources",
            "Deploy Functions, Hosting, Rules and indexes", "Smoke test private shell and deployed functions",
            "Authenticated smoke test without stored password",
        ]
        for name in critical:
            self.assertEqual(names.count(name), 1, name)
        names = [s.get("name") for s in deploy["steps"]]
        self.assertLess(names.index(critical[7]), names.index(critical[8]))
        self.assertLess(names.index(critical[8]), names.index(critical[10]))
        deploy_step = next(s for s in deploy["steps"] if s.get("name") == critical[8])
        runtime_account = "299889357292-compute@developer.gserviceaccount.com"
        self.assertEqual(deploy_step["env"]["AURORA_RUNTIME_SERVICE_ACCOUNT"], runtime_account)
        self.assertIn(f'test "$AURORA_RUNTIME_SERVICE_ACCOUNT" = "{runtime_account}"', deploy_step["run"])
        self.assertIn('runtime_env="functions/.env.${PROJECT_ID}"', deploy_step["run"])
        self.assertIn("trap 'rm -f -- \"$runtime_env\"' EXIT", deploy_step["run"])
        self.assertIn(
            'printf \'%s\\n\' "AURORA_RUNTIME_SERVICE_ACCOUNT=$AURORA_RUNTIME_SERVICE_ACCOUNT" > "$runtime_env"',
            deploy_step["run"],
        )
        smoke = load_workflow(WORKFLOWS / "aurora-hml-auth-smoke-once.yml")
        self.assertEqual(smoke["on"]["push"]["branches"], ["main"])
        self.assertEqual(smoke["jobs"]["smoke"]["environment"], "firebase-homologation")
        for filename in TARGETS:
            actual_block(filename)
        print(f"CRITICAL_STEPS_PASS unique={len(critical) + 1}", flush=True)


class AuthContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for executable in ("bash", "jq", "node"):
            if not shutil.which(executable):
                raise RuntimeError(f"Required test executable not available: {executable}")
        cls.blocks = {filename: actual_block(filename) for filename in TARGETS}

    def execute(self, filename, auth=GOOD_AUTH, account=GOOD_ACCOUNT, http="200", transport="0", original=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            auth_text = auth if isinstance(auth, str) else json.dumps(auth)
            account_text = account if isinstance(account, str) else json.dumps(account)
            for name in ("auth-out.json", "auth-response.json"):
                (root / name).write_text(auth_text, encoding="utf-8")
            mock = root / "bin"
            mock.mkdir()
            curl_script = mock / "curl.py"
            curl_script.write_text('''import json, os, pathlib, re, sys
def native_path(value):
    if os.name == "nt" and re.match(r"^/[A-Za-z]/", value):
        value = value[1] + ":" + value[2:]
    return pathlib.Path(value)
root = pathlib.Path(os.environ["MOCK_ROOT"])
args = sys.argv[1:]
(root / "curl-called").write_text("called")
assert args[-1] == "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=SYNTHETIC_KEY"
assert "--insecure" not in args and "-k" not in args
payload = native_path(args[args.index("--data-binary") + 1][1:])
assert json.loads(payload.read_text()) == {"idToken": os.environ["TEST_TOKEN"]}
# POSIX permissions are enforced in CI; Windows has ACLs rather than mode bits.
if os.name != "nt":
    assert payload.stat().st_mode & 0o077 == 0
transport = int(os.environ["MOCK_TRANSPORT"])
if transport:
    sys.exit(transport)
out = native_path(args[args.index("-o") + 1])
out.write_text(os.environ["MOCK_ACCOUNT"])
print(os.environ["MOCK_HTTP"], end="")
''', encoding="utf-8")
            # A shell function cannot accidentally resolve to a real network curl
            # when Windows and POSIX PATH formats differ.
            curl_command = shlex.quote(shell_path(sys.executable)) + " " + shlex.quote(shell_path(curl_script))
            env = dict(os.environ, smoke_dir=shell_path(root),
                       auth_response=shell_path(root / "auth-response.json"), MOCK_ROOT=str(root),
                       SMOKE_UID=UID, api_key="SYNTHETIC_KEY", TEST_TOKEN=TOKEN,
                       MOCK_ACCOUNT=account_text, MOCK_HTTP=http, MOCK_TRANSPORT=transport,
                       TMPDIR=shell_path(root))
            # Do not inherit an opt-in shell trace from a developer's environment.
            for name in ("BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS"):
                env.pop(name, None)
            block = self.blocks[filename]
            if original:
                block = '''id_token="$(jq -r '.idToken // empty' "$auth_response")"
local_id="$(jq -r '.localId // empty' "$auth_response")"
test -n "$id_token"
test "$local_id" = "$SMOKE_UID"
'''
            # Windows environment names are case-insensitive (tmp collides with
            # TMP); assign this workflow variable in Bash itself.
            script = "set -euo pipefail\ntmp=" + shlex.quote(shell_path(root)) + "\ncurl() { " + curl_command + ' "$@"; }\n' + block
            result = subprocess.run(["bash", "--noprofile", "--norc", "-c", script],
                                    env=env, text=True, capture_output=True, timeout=10)
            return result, (root / "curl-called").exists()

    def test_original_reproduces_exit_1_for_valid_response_without_local_id(self):
        result, called = self.execute(next(iter(TARGETS)), original=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(called)

    def test_both_real_blocks_accept_valid_response_and_verify_lookup_payload(self):
        for filename in TARGETS:
            with self.subTest(workflow=filename):
                result, called = self.execute(filename)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(called)
                self.assertIn("AUTH_SMOKE_UID_VERIFIED", result.stdout)
                self.assertEqual(result.stdout.count(TOKEN), 1)
                self.assertIn("::add-mask::" + TOKEN, result.stdout)
                self.assertNotIn(TOKEN, result.stderr)

    def test_missing_invalid_or_malformed_id_token_is_rejected_before_network(self):
        invalid = [{}, {"idToken": None}, {"idToken": ""}, {"idToken": False}, {"idToken": 42},
                   {"idToken": []}, {"idToken": {}}, {"idToken": ["token"]}, "not-json"]
        for filename in TARGETS:
            for auth in invalid:
                with self.subTest(workflow=filename, auth=auth):
                    result, called = self.execute(filename, auth=auth)
                    self.assertEqual(result.returncode, 72)
                    self.assertFalse(called)

    def test_uid_mismatch_cannot_be_hidden_by_local_id_in_auth_response(self):
        for filename in TARGETS:
            with self.subTest(workflow=filename):
                result, _ = self.execute(filename, auth=dict(GOOD_AUTH, localId=UID), account={"users": [{"localId": "other-user"}]})
                self.assertEqual(result.returncode, 75)

    def test_disabled_user_is_rejected(self):
        for filename in TARGETS:
            with self.subTest(workflow=filename):
                result, _ = self.execute(filename, account={"users": [{"localId": UID, "disabled": True}]})
                self.assertEqual(result.returncode, 75)

    def test_optional_disabled_flag_may_be_absent(self):
        for filename in TARGETS:
            with self.subTest(workflow=filename):
                result, _ = self.execute(filename, account={"users": [{"localId": UID}]})
                self.assertEqual(result.returncode, 0)

    def test_empty_multiple_invalid_or_malformed_account_response_is_rejected(self):
        invalid = [{}, {"users": []}, {"users": [{"localId": UID}, {"localId": UID}]},
                   {"users": None}, {"users": {}}, {"users": [None]}, {"users": [{}]}, "not-json"]
        for filename in TARGETS:
            for account in invalid:
                with self.subTest(workflow=filename, account=account):
                    result, _ = self.execute(filename, account=account)
                    self.assertEqual(result.returncode, 75)

    def test_http_failure_is_rejected_without_response_dump(self):
        for filename in TARGETS:
            for status in ("400", "401", "403", "500"):
                with self.subTest(workflow=filename, status=status):
                    result, _ = self.execute(filename, http=status, account={"error": {"message": "SENSITIVE_SYNTHETIC_MARKER"}})
                    self.assertEqual(result.returncode, 74)
                    self.assertNotIn("SENSITIVE_SYNTHETIC_MARKER", result.stdout + result.stderr)

    def test_transport_failure_is_rejected(self):
        for filename in TARGETS:
            for status in ("6", "7", "28"):
                with self.subTest(workflow=filename, status=status):
                    result, _ = self.execute(filename, transport=status)
                    self.assertEqual(result.returncode, 73)


if __name__ == "__main__":
    unittest.main(verbosity=2)
