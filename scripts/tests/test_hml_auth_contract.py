#!/usr/bin/env python3
"""Offline regression of the real HML workflow blocks; never contacts Firebase.

Run: python -m unittest discover -s scripts/tests -p test_hml_auth_contract.py -v
Requires Python 3.9+, PyYAML, bash and jq. All credentials/responses are synthetic.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
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
        smoke = load_workflow(WORKFLOWS / "aurora-hml-auth-smoke-once.yml")
        self.assertEqual(smoke["on"]["push"]["branches"], ["main"])
        self.assertEqual(smoke["jobs"]["smoke"]["environment"], "firebase-homologation")
        for filename in TARGETS:
            actual_block(filename)
        print(f"CRITICAL_STEPS_PASS unique={len(critical) + 1}", flush=True)


class AuthContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for executable in ("bash", "jq"):
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
            curl = mock / "curl"
            curl.write_text(f"#!{sys.executable}\n" + '''import json, os, pathlib, sys
root = pathlib.Path(os.environ["tmp"])
args = sys.argv[1:]
(root / "curl-called").write_text("called")
assert args[-1] == "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=SYNTHETIC_KEY"
assert "--insecure" not in args and "-k" not in args
payload = pathlib.Path(args[args.index("--data-binary") + 1][1:])
assert json.loads(payload.read_text()) == {"idToken": os.environ["TEST_TOKEN"]}
assert payload.stat().st_mode & 0o077 == 0
transport = int(os.environ["MOCK_TRANSPORT"])
if transport:
    sys.exit(transport)
out = pathlib.Path(args[args.index("-o") + 1])
out.write_text(os.environ["MOCK_ACCOUNT"])
print(os.environ["MOCK_HTTP"], end="")
''', encoding="utf-8")
            curl.chmod(0o700)
            env = dict(os.environ, tmp=str(root), smoke_dir=str(root), auth_response=str(root / "auth-response.json"),
                       SMOKE_UID=UID, api_key="SYNTHETIC_KEY", TEST_TOKEN=TOKEN,
                       MOCK_ACCOUNT=account_text, MOCK_HTTP=http, MOCK_TRANSPORT=transport,
                       PATH=str(mock) + os.pathsep + os.environ["PATH"])
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
            result = subprocess.run(["bash", "--noprofile", "--norc", "-c", "set -euo pipefail\n" + block],
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
