import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("hml_gate", ROOT / "firebase-migration/scripts/hml_gate_readonly.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def fixtures():
    return {"auth": [{"status": "ACTIVE"}],
            "project": {"projectId": gate.PROJECT, "projectNumber": gate.NUMBER, "lifecycleState": "ACTIVE"},
            "iam": {"version": 3, "etag": "private-marker", "bindings": [
                {"role": r, "members": [m]} for r, m in gate.eventarc.required_bindings(gate.NUMBER)]},
            "functions": [{"name": f"projects/{gate.PROJECT}/locations/{gate.REGION}/functions/synthetic",
                           "state": "ACTIVE", "eventTrigger": {"eventType": "synthetic-event"}}],
            "eventarc": [{"name": f"projects/{gate.NUMBER}/locations/{gate.REGION}/triggers/synthetic"}]}


class FakeReader:
    def __init__(self, data=None, errors=None):
        self.data, self.errors, self.calls = data or fixtures(), errors or {}, []

    def read(self, key):
        self.calls.append(key)
        return self.data.get(key), self.errors.get(key)


class ReadonlyGateTests(unittest.TestCase):
    def test_plan_does_not_invoke_cli(self):
        with patch.object(gate, "Reader") as reader, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(gate.main([]), 0)
        reader.assert_not_called()

    def test_empty_auth_list_is_no_active_account_not_one_null_account(self):
        data = fixtures(); data["auth"] = []
        reader = FakeReader(data)
        self.assertEqual(gate.collect(reader)["gates"]["auth"]["evidence"], "AUTH_LOGIN_REQUIRED")
        self.assertEqual(reader.calls, ["auth"])

    def test_ambiguous_or_invalid_auth_never_queries_project(self):
        for auth in (None, {}, [None], [{"status": "INACTIVE"}], [{"status": "ACTIVE"}] * 2):
            data = fixtures(); data["auth"] = auth; reader = FakeReader(data)
            self.assertEqual(gate.collect(reader)["gates"]["auth"]["status"], gate.UNKNOWN)
            self.assertEqual(reader.calls, ["auth"])

    def test_refresh_failure_invalidates_configured_auth(self):
        reader = FakeReader(errors={"project": "AUTH_RENEWAL_REQUIRED"})
        self.assertEqual(gate.collect(reader)["gates"]["auth"]["status"], gate.UNKNOWN)
        self.assertEqual(reader.calls, ["auth", "project"])

    def test_project_identity_mismatch_stops_before_iam(self):
        for values in ({"projectId": "other"}, {"projectNumber": "000000"}, {"lifecycleState": "DELETE_REQUESTED"}):
            data = fixtures(); data["project"].update(values); reader = FakeReader(data)
            self.assertEqual(gate.collect(reader)["gates"]["project"]["status"], gate.UNKNOWN)
            self.assertEqual(reader.calls, ["auth", "project"])

    def test_metadata_success_is_not_release_or_effective_iam(self):
        reader = FakeReader(); report = gate.collect(reader)
        self.assertEqual(reader.calls, list(gate.COMMANDS))
        self.assertTrue(all(g["status"] == gate.VERIFIED for g in report["gates"].values()))
        self.assertEqual(report["gates"]["auth"]["evidence"], "AUTHENTICATED_HML_METADATA_READ")
        self.assertFalse(report["releaseApproved"])
        self.assertFalse(report["cloudMutationAttempted"])
        self.assertEqual(report["gates"]["iam"]["effectiveAccess"], gate.UNKNOWN)
        self.assertEqual(report["gates"]["functions"]["activeCount"], 1)

    def test_absent_or_conditional_binding_never_becomes_a_grant(self):
        data = fixtures(); data["iam"]["bindings"] = []
        result = gate.collect(FakeReader(data))["gates"]["iam"]
        self.assertEqual(result["status"], gate.PENDING)
        self.assertEqual(len(result["missingDirectBindingRoles"]), 3)
        data = fixtures(); data["iam"]["bindings"][0]["condition"] = {"expression": "false"}
        self.assertEqual(gate.collect(FakeReader(data))["gates"]["iam"]["status"], gate.UNKNOWN)

    def test_denied_read_stays_unknown_and_independent_metadata_continues(self):
        report = gate.collect(FakeReader(errors={"iam": "READ_PERMISSION_DENIED"}))
        self.assertEqual(report["gates"]["iam"]["status"], gate.UNKNOWN)
        self.assertEqual(report["gates"]["functions"]["status"], gate.VERIFIED)

    def test_resource_scope_and_shape_are_checked(self):
        for value in ({}, [None], [{"name": "projects/other/locations/elsewhere/functions/x"}]):
            data = fixtures(); data["functions"] = value
            self.assertEqual(gate.collect(FakeReader(data))["gates"]["functions"]["status"], gate.UNKNOWN)

    def test_output_redacts_policy_principals_and_resource_names(self):
        serialized = json.dumps(gate.collect(FakeReader()))
        for forbidden in ("private-marker", ".gserviceaccount.com", "synthetic-event", "/functions/synthetic"):
            self.assertNotIn(forbidden, serialized)

    def test_sdk_discovery_outside_windows_path(self):
        with tempfile.TemporaryDirectory() as root:
            sdk = Path(root) / "Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
            sdk.parent.mkdir(parents=True); sdk.touch()
            with patch.object(gate.shutil, "which", return_value=None), patch.object(gate, "os", SimpleNamespace(name="nt", environ={"LOCALAPPDATA": root})):
                self.assertEqual(gate.find_gcloud(), str(sdk))

    def test_reader_is_allowlisted_scoped_noninteractive_and_bounded(self):
        with patch.object(gate.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="[]")) as run:
            reader = gate.Reader("gcloud")
            for key in gate.COMMANDS:
                reader.read(key); args, kwargs = run.call_args
                self.assertEqual(args[0], ["gcloud", *gate.COMMANDS[key], "--configuration=" + gate.PROFILE, "--project=" + gate.PROJECT, "--quiet"])
                self.assertEqual(kwargs["env"]["CLOUDSDK_CORE_LOG_HTTP"], "false")
                self.assertEqual(kwargs["env"]["CLOUDSDK_CORE_DISABLE_PROMPTS"], "1")
                self.assertEqual(kwargs["timeout"], 30)
            with self.assertRaises(ValueError): reader.read("apply")

    def test_error_classifier_does_not_mistake_login_advice_for_auth_failure(self):
        self.assertEqual(gate.error_code("PERMISSION_DENIED 403. To switch account run gcloud auth login"), "READ_PERMISSION_DENIED")
        self.assertEqual(gate.error_code("You do not currently have an active account selected"), "AUTH_LOGIN_REQUIRED")
        self.assertEqual(gate.error_code("invalid_grant private-token-marker"), "AUTH_RENEWAL_REQUIRED")

    def test_iam_projection_preserves_binding_objects(self):
        self.assertIn("--format=json(version,etag,bindings)", gate.COMMANDS["iam"])

    def test_reader_redacts_failures_and_timeout(self):
        reader = gate.Reader("gcloud")
        for result, expected in ((SimpleNamespace(returncode=1, stderr="403 private-marker"), "READ_PERMISSION_DENIED"),
                                 (SimpleNamespace(returncode=0, stdout="not-json private-marker"), "INVALID_METADATA_JSON")):
            with patch.object(gate.subprocess, "run", return_value=result):
                self.assertEqual(reader.read("project"), (None, expected))
        with patch.object(gate.subprocess, "run", side_effect=subprocess.TimeoutExpired("gcloud", 30)):
            self.assertEqual(reader.read("project"), (None, "METADATA_QUERY_TIMEOUT"))

    def test_blocked_exit_and_scope_override(self):
        with patch.object(gate, "Reader", return_value=FakeReader(errors={"auth": "GCLOUD_UNAVAILABLE"})), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(gate.main(["--collect"]), 2)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): gate.main(["--project", "other"])

    def test_launcher_requires_explicit_login_argument(self):
        source = (ROOT / "tools/windows/DIAG_AURORA_HML.cmd").read_text()
        self.assertIn('if /I "%~1"=="login" goto login', source)
        self.assertLess(source.index("goto diagnose"), source.index(":login"))
        self.assertEqual(source.count("hml_cli_access.py\" --login"), 1)
        self.assertIn('if /I "%~1"=="setup" goto setup', source)
        for forbidden in ("set-iam-policy", "firebase deploy", "ExecutionPolicy Bypass", "auth print-access-token"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__": unittest.main()
