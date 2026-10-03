"""Offline safety tests: no CLI login, cloud request, secret or real identity."""
from contextlib import redirect_stdout
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "hml_readonly_preflight.py"
SPEC = importlib.util.spec_from_file_location("hml_preflight", SCRIPT)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
NOW = datetime(2026, 10, 3, 0, 0, tzinfo=timezone.utc)
DB = "projects/" + M.PROJECT + "/databases/(default)"


def fixture():
    return {
        "project": {"projectId": M.PROJECT, "projectNumber": "123456", "lifecycleState": "ACTIVE"},
        "billing": {"projectId": M.PROJECT, "billingEnabled": True},
        "services": [{"config": {"name": "secretmanager.googleapis.com"}, "state": "ENABLED"}],
        "allowlist": {"name": "projects/123456/secrets/AURORA_NEXUS_ALLOWED_EMAILS/versions/3", "state": "ENABLED"},
        "csrf": {"name": "projects/123456/secrets/AURORA_NEXUS_CSRF_HMAC_KEY/versions/2", "state": "ENABLED"},
        "database": {"name": DB, "uid": "synthetic-current-db", "locationId": M.REGION,
                     "deleteProtectionState": "DELETE_PROTECTION_ENABLED", "pointInTimeRecoveryEnablement": "POINT_IN_TIME_RECOVERY_ENABLED"},
        "schedules": [{"name": DB + "/backupSchedules/synthetic", "retention": "604800s", "dailyRecurrence": {}}],
        "backups": [{"name": "synthetic-backup", "database": DB, "databaseUid": "synthetic-current-db",
                     "state": "READY", "snapshotTime": (NOW - timedelta(hours=1)).isoformat(),
                     "expireTime": (NOW + timedelta(days=6)).isoformat()}],
    }


class FixtureReader:
    def __init__(self, values=None, errors=None):
        self.values, self.errors, self.calls = values or fixture(), errors or {}, []

    def read(self, key):
        self.calls.append(key)
        return deepcopy(self.values[key]), self.errors.get(key)


class PreflightTests(unittest.TestCase):
    def report(self, values=None, errors=None):
        return M.audit(FixtureReader(values, errors), now=NOW, collect=True)

    def test_default_plan_performs_no_queries_and_proves_nothing(self):
        reader = FixtureReader()
        report = M.audit(reader, now=NOW)
        self.assertEqual(reader.calls, [])
        self.assertEqual(report["mode"], "PLAN_ONLY")
        self.assertEqual(report["summary"][M.VERIFIED], 0)
        self.assertEqual(report["summary"][M.UNKNOWN], len(M.CATALOG))
        self.assertFalse(report["releaseApproved"])

    def test_positive_metadata_cannot_release_hml_or_promote_manual_gates(self):
        report = self.report()
        self.assertEqual(report["summary"][M.VERIFIED], 10)
        self.assertEqual(report["summary"][M.PENDING], 0)
        self.assertFalse(report["releaseApproved"])
        self.assertFalse(report["cloudMutation"])
        self.assertFalse(report["secretPayloadRead"])
        for gate in ["budget_alerts", "wif_service_account", "secret_runtime_access", "users_memberships_mfa",
                     "protected_environment", "deployed_rules", "app_check", "restore_rehearsal", "dns_https_ssl", "authenticated_smoke"]:
            self.assertEqual(report["gates"][gate]["status"], M.UNKNOWN, gate)

    def test_access_failure_is_unknown_never_confirmed_absence(self):
        report = self.report(errors={key: "QUERY_FAILED" for key in M.COMMANDS})
        self.assertEqual(report["summary"][M.UNKNOWN], len(M.CATALOG))
        self.assertEqual(report["summary"][M.PENDING], 0)

    def test_observed_disabled_resources_are_pending(self):
        data = fixture()
        data["billing"]["billingEnabled"] = False
        data["services"] = []
        data["allowlist"]["state"] = "DISABLED"
        data["schedules"] = []
        for gate in ["billing_enabled", "secret_manager_api", "allowlist_metadata", "backup_schedule"]:
            self.assertEqual(self.report(data)["gates"][gate]["status"], M.PENDING)

    def test_missing_fields_and_wrong_types_do_not_become_false(self):
        data = fixture()
        data["billing"]["billingEnabled"] = "true"
        data["allowlist"].pop("state")
        data["services"] = [{}]
        data["database"].pop("pointInTimeRecoveryEnablement")
        for gate in ["billing_enabled", "allowlist_metadata", "secret_manager_api", "pitr"]:
            self.assertEqual(self.report(data)["gates"][gate]["status"], M.UNKNOWN)

    def test_scope_mismatch_cannot_confirm_resources(self):
        data = fixture()
        data["project"]["projectId"] = "other-project"
        data["billing"]["projectId"] = "other-project"
        data["allowlist"]["name"] = "projects/other-project/secrets/AURORA_NEXUS_ALLOWED_EMAILS/versions/1"
        data["database"]["name"] = "projects/other-project/databases/(default)"
        for gate in ["project_active", "billing_enabled", "allowlist_metadata", "firestore_location", "recent_backup"]:
            self.assertEqual(self.report(data)["gates"][gate]["status"], M.UNKNOWN)

    def test_raw_fields_and_identifiers_are_never_reported(self):
        data = fixture()
        marker = "SYNTHETIC_PRIVATE_CONTENT_DO_NOT_EMIT"
        for key in ["project", "billing", "allowlist", "csrf", "database"]:
            data[key]["unexpectedPayload"] = marker
        output = json.dumps(self.report(data))
        for value in [marker, "123456", "synthetic-current-db", "synthetic-backup"]:
            self.assertNotIn(value, output)

    def test_backup_age_expiry_and_identity_are_required(self):
        for change in [
            {"snapshotTime": (NOW - timedelta(hours=24, seconds=1)).isoformat()},
            {"snapshotTime": (NOW + timedelta(seconds=1)).isoformat()},
            {"expireTime": NOW.isoformat()},
            {"databaseUid": "synthetic-old-db"},
            {"database": "projects/other-project/databases/(default)"},
            {"state": "CREATING"},
        ]:
            with self.subTest(change=change):
                data = fixture()
                data["backups"][0].update(change)
                self.assertEqual(self.report(data)["gates"]["recent_backup"]["status"], M.PENDING)

    def test_exact_24_hour_boundary_is_eligible(self):
        data = fixture()
        data["backups"][0]["snapshotTime"] = (NOW - timedelta(hours=24)).isoformat()
        self.assertEqual(self.report(data)["gates"]["recent_backup"]["status"], M.VERIFIED)

    def test_malformed_backup_metadata_remains_unknown(self):
        for change in [{"snapshotTime": "bad"}, {"snapshotTime": "2026-10-02T23:00:00"}, {"expireTime": None}, {"databaseUid": None}, {"database": None}, {"state": None}]:
            data = fixture()
            data["backups"][0].update(change)
            self.assertEqual(self.report(data)["gates"]["recent_backup"]["status"], M.UNKNOWN)

    def test_same_name_recreated_database_is_not_same_backup_source(self):
        data = fixture()
        data["database"]["uid"] = "recreated-database"
        self.assertEqual(self.report(data)["gates"]["recent_backup"]["status"], M.PENDING)

    def test_every_gate_has_owner_risk_action_acceptance_and_blocker(self):
        for gate in self.report()["gates"].values():
            for field in ["status", "evidence", "risk", "suggestedOwner", "nextAction", "acceptanceCriterion"]:
                self.assertTrue(gate[field], field)
            self.assertEqual(gate["blocker"] is None, gate["status"] == M.VERIFIED)

    def test_cli_executes_only_fixed_read_commands_without_shell_or_prompt(self):
        calls = []
        def runner(argv, **kwargs):
            calls.append((argv, kwargs))
            return SimpleNamespace(returncode=0, stdout="{}", stderr="")
        reader = M.MetadataReader(executable="/test/gcloud", runner=runner)
        for key in M.COMMANDS:
            reader.read(key)
        self.assertEqual(len(calls), 8)
        for argv, kwargs in calls:
            self.assertIn("--project=" + M.PROJECT, argv)
            self.assertTrue("list" in argv or "describe" in argv)
            self.assertFalse(set(argv) & {"access", "create", "update", "delete", "enable", "restore", "deploy", "login", "print-access-token"})
            self.assertNotIn("shell", kwargs)
            self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
            self.assertEqual(kwargs["timeout"], 20)
            self.assertEqual(kwargs["env"]["CLOUDSDK_CORE_LOG_HTTP"], "false")

    def test_reader_rejects_arbitrary_query(self):
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_QUERY"):
            M.MetadataReader(executable="/test/gcloud").read("delete")

    def test_errors_never_echo_subprocess_output(self):
        marker = "SYNTHETIC_PRIVATE_ERROR"
        for result, expected in [
            (SimpleNamespace(returncode=1, stdout=marker, stderr=marker), "QUERY_FAILED"),
            (SimpleNamespace(returncode=0, stdout=marker, stderr=""), "INVALID_JSON"),
            (SimpleNamespace(returncode=0, stdout="x" * 2_000_001, stderr=""), "METADATA_TOO_LARGE"),
        ]:
            reader = M.MetadataReader(executable="/test/gcloud", runner=lambda *a, **k: result)
            self.assertEqual(reader.read("allowlist"), (None, expected))

    def test_timeout_and_missing_cli_are_unknown(self):
        with patch.object(M.shutil, "which", return_value=None):
            self.assertEqual(M.MetadataReader().read("project"), (None, "GCLOUD_UNAVAILABLE"))
        def timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired("synthetic", 20, output="PRIVATE")
        self.assertEqual(M.MetadataReader(executable="/test/gcloud", runner=timeout).read("project"), (None, "QUERY_TIMEOUT"))

    def test_collect_cli_returns_nonzero_and_explicit_unknown_without_cloud_cli(self):
        output = io.StringIO()
        with patch.object(M.shutil, "which", return_value=None), redirect_stdout(output):
            self.assertEqual(M.main(["--collect"]), 2)
        report = json.loads(output.getvalue())
        self.assertFalse(report["releaseApproved"])
        self.assertEqual(report["summary"][M.UNKNOWN], len(M.CATALOG))

    def test_caller_cannot_override_the_project(self):
        with self.assertRaises(SystemExit) as error, patch.object(M, "MetadataReader") as reader:
            with patch("sys.stderr", io.StringIO()):
                M.main(["--project=other-project"])
        self.assertEqual(error.exception.code, 2)
        reader.assert_not_called()

    def test_backup_cli_never_calls_cloud_and_rejects_invalid_or_foreign_input(self):
        for value in ["bad", "[]", "{}", json.dumps({"database": {"name": "projects/other-project/databases/(default)"}, "backups": []})]:
            output = io.StringIO()
            with patch.object(M, "MetadataReader") as reader, patch("sys.stdin", io.StringIO(value)), redirect_stdout(output):
                self.assertEqual(M.main(["--check-backup"]), 2)
            reader.assert_not_called()
            self.assertFalse(json.loads(output.getvalue())["releaseApproved"])

    def test_backup_cli_acceptance_is_not_release_approval(self):
        data = fixture()
        current = datetime.now(timezone.utc)
        data["backups"][0].update(snapshotTime=(current - timedelta(hours=1)).isoformat(), expireTime=(current + timedelta(days=1)).isoformat())
        value = json.dumps({"database": data["database"], "backups": data["backups"]})
        output = io.StringIO()
        with patch.object(M, "MetadataReader") as reader, patch("sys.stdin", io.StringIO(value)), redirect_stdout(output):
            self.assertEqual(M.main(["--check-backup"]), 0)
        reader.assert_not_called()
        result = json.loads(output.getvalue())
        self.assertEqual(result["status"], M.VERIFIED)
        self.assertFalse(result["releaseApproved"])

    def test_empty_weekly_schedule_does_not_prove_recurrence(self):
        data = fixture()
        data["schedules"][0].pop("dailyRecurrence")
        data["schedules"][0]["weeklyRecurrence"] = {}
        self.assertEqual(self.report(data)["gates"]["backup_schedule"]["status"], M.UNKNOWN)

    def test_workflows_enforce_backup_check_before_mutations(self):
        root = SCRIPT.parents[2]
        deploy = (root / ".github/workflows/deploy-aurora-firebase.yml").read_text()
        restore = (root / ".github/workflows/aurora-rc11-recovery-real-ingest.yml").read_text()
        helper = "python3 firebase-migration/scripts/hml_readonly_preflight.py --check-backup"
        self.assertLess(deploy.index(helper), deploy.index("- name: Deploy Functions, Hosting, Rules and indexes"))
        self.assertLess(restore.index(helper), restore.index("- name: Execute and prove real restore"))
        self.assertIn('echo "READY_BACKUP_REQUIRED_BEFORE_DEPLOY" >&2\n            exit 52', deploy)
        self.assertNotIn("bootstrap allowed only", deploy)


if __name__ == "__main__":
    unittest.main()
