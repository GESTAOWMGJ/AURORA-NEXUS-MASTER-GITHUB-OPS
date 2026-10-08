import copy
import datetime as dt
import json
import unittest
from pathlib import Path

from production_project_contract import ContractError
from production_release_preflight import (PROJECT, NUMBER, REGION, validate_database, select_backup,
    validate_restore, validate_auth, validate_ci, validate_restore_operation)

NOW = dt.datetime(2026, 10, 8, 6, tzinfo=dt.timezone.utc)
BACKUP = {"name": f"projects/{PROJECT}/locations/{REGION}/backups/proof", "database": f"projects/{PROJECT}/databases/(default)",
          "state": "READY", "snapshotTime": "2026-10-08T05:00:00Z"}
ORG = {"fields": {"active": {"booleanValue": True}, "environment": {"stringValue": "PRODUCTION"},
       "clinicalSensitiveEnabled": {"booleanValue": False}, "productionMutation": {"booleanValue": False},
       "sourceMutation": {"booleanValue": False}, "projectionMode": {"stringValue": "SHADOW"}}}


class ProductionPublicationGateTests(unittest.TestCase):
    def test_production_recovery_accepted(self):
        database = {"name": f"projects/{PROJECT}/databases/(default)", "locationId": REGION,
                    "deleteProtectionState": "DELETE_PROTECTION_ENABLED", "pointInTimeRecoveryEnablement": "POINT_IN_TIME_RECOVERY_ENABLED"}
        validate_database(database)
        self.assertEqual(select_backup([BACKUP], [{"name": "schedule"}], NOW), BACKUP)
        restored = {"name": f"projects/{PROJECT}/databases/prod-restore-proof", "locationId": REGION,
                    "sourceInfo": {"backup": {"backup": BACKUP["name"]}}}
        self.assertEqual(validate_restore(restored, BACKUP, ORG, ORG), restored["name"])

    def test_pitr_is_not_backup_or_restore(self):
        with self.assertRaisesRegex(ContractError, "SCHEDULED_BACKUP_REQUIRED"):
            select_backup([BACKUP], [], NOW)
        with self.assertRaisesRegex(ContractError, "READY_PRODUCTION_BACKUP_REQUIRED"):
            select_backup([], [{}], NOW)

    def test_hml_backup_never_satisfies_production_gate(self):
        backup = dict(BACKUP, database="projects/wmgj-hml-jfn-20260927/databases/(default)")
        with self.assertRaisesRegex(ContractError, "READY_PRODUCTION_BACKUP_REQUIRED"):
            select_backup([backup], [{}], NOW)

    def test_wrong_backup_resource_even_same_database_rejected(self):
        backup = dict(BACKUP, name="projects/wmgj-ops/locations/southamerica-east1/backups/proof")
        with self.assertRaises(ContractError):
            select_backup([backup], [{}], NOW)

    def test_stale_future_and_invalid_snapshot_rejected(self):
        for snapshot in ("2026-10-06T05:00:00Z", "2026-10-09T05:00:00Z", "invalid"):
            with self.subTest(snapshot=snapshot), self.assertRaises(ContractError):
                select_backup([dict(BACKUP, snapshotTime=snapshot)], [{}], NOW)

    def test_backup_not_ready_rejected(self):
        with self.assertRaises(ContractError):
            select_backup([dict(BACKUP, state="CREATING")], [{}], NOW)

    def test_restore_from_different_backup_rejected(self):
        restored = {"name": f"projects/{PROJECT}/databases/prod-restore-proof", "locationId": REGION,
                    "sourceInfo": {"backup": {"backup": BACKUP["name"] + "-other"}}}
        with self.assertRaisesRegex(ContractError, "RESTORE_BACKUP_PROVENANCE"):
            validate_restore(restored, BACKUP, ORG, ORG)

    def test_restore_cannot_point_to_default_hml_or_legacy(self):
        for name in (f"projects/{PROJECT}/databases/(default)", "projects/wmgj-ops/databases/prod-restore-proof",
                     "projects/wmgj-hml-jfn-20260927/databases/prod-restore-proof"):
            with self.subTest(name=name), self.assertRaises(ContractError):
                validate_restore({"name": name}, BACKUP, ORG, ORG)

    def test_recovered_guardrails_must_match_production_not_hml(self):
        restored = {"name": f"projects/{PROJECT}/databases/prod-restore-proof", "locationId": REGION,
                    "sourceInfo": {"backup": {"backup": BACKUP["name"]}}}
        for field, value in (("environment", {"stringValue": "HOMOLOGATION"}),
                             ("clinicalSensitiveEnabled", {"booleanValue": True}),
                             ("productionMutation", {"booleanValue": True}), ("active", {"booleanValue": False})):
            with self.subTest(field=field), self.assertRaises(ContractError):
                wrong = copy.deepcopy(ORG); wrong["fields"][field] = value
                validate_restore(restored, BACKUP, ORG, wrong)

    def test_auth_config_requires_canonical_email_and_mfa(self):
        config = {"name": f"projects/{PROJECT}/config", "authorizedDomains": ["auroranexus.com.br"],
                  "signIn": {"email": {"enabled": True}}, "mfa": {"state": "ENABLED", "providerConfigs": [
                      {"state": "ENABLED", "totpProviderConfig": {"adjacentIntervals": 1}}]}}
        validate_auth(config)
        validate_auth(dict(config, name=f"projects/{NUMBER}/config"))
        for key, value in (("name", "projects/wmgj-ops/config"), ("authorizedDomains", ["hml.web.app"]),
                           ("signIn", {}), ("mfa", {"state": "DISABLED"})):
            with self.subTest(key=key), self.assertRaises(ContractError):
                validate_auth(dict(config, **{key: value}))

    def test_enabled_mfa_without_available_totp_is_not_ready(self):
        config = {"name": f"projects/{PROJECT}/config", "authorizedDomains": ["auroranexus.com.br"],
                  "signIn": {"email": {"enabled": True}}}
        for providers in ([], [{"state": "DISABLED", "totpProviderConfig": {}}],
                          [{"state": "ENABLED"}], [None]):
            with self.subTest(providers=providers), self.assertRaisesRegex(ContractError, "AUTH_TOTP_PROVIDER_REQUIRED"):
                validate_auth(dict(config, mfa={"state": "ENABLED", "providerConfigs": providers}))
        with self.assertRaisesRegex(ContractError, "AUTH_CANONICAL_DOMAIN_REQUIRED"):
            validate_auth(dict(config, authorizedDomains=["auroranexus.com.br", "hml.web.app"]))

    def test_ci_must_be_exact_main_validation_workflow(self):
        sha = "a" * 40
        run = {"head_sha": sha, "head_branch": "main", "status": "completed", "conclusion": "success",
               "path": ".github/workflows/validate-firestore-migration.yml"}
        validate_ci(run, sha)
        for key, value in (("head_sha", "b" * 40), ("head_branch", "draft"), ("status", "in_progress"),
                           ("conclusion", "failure"), ("path", ".github/workflows/validate-aurora-onboarding.yml")):
            with self.subTest(key=key), self.assertRaises(ContractError):
                validate_ci(dict(run, **{key: value}), sha)

    def test_restore_operation_must_really_finish_on_exact_production_backup(self):
        database = f"projects/{PROJECT}/databases/prod-restore-proof"
        meta = {"@type": "type.googleapis.com/google.firestore.admin.v1.RestoreDatabaseMetadata",
                "operationState": "SUCCESSFUL", "database": database, "backup": BACKUP["name"]}
        operation = {"name": database + "/operations/proof", "done": True, "metadata": meta}
        self.assertEqual(validate_restore_operation([operation], database, BACKUP), operation["name"])
        for key, value in (("operationState", "PROCESSING"), ("operationState", "FAILED"),
                           ("database", "projects/wmgj-ops/databases/prod-restore-proof"),
                           ("backup", BACKUP["name"] + "other"), ("@type", "ExportDocumentsMetadata")):
            with self.subTest(key=key, value=value), self.assertRaises(ContractError):
                validate_restore_operation([dict(operation, metadata=dict(meta, **{key: value}))], database, BACKUP)
        for key, value in (("done", False), ("error", {"code": 13})):
            with self.subTest(key=key), self.assertRaises(ContractError):
                validate_restore_operation([dict(operation, **{key: value})], database, BACKUP)

    def test_no_new_scheduler_in_backend_publication_scope(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/aurora-firebase-production.yml").read_text(encoding="utf-8")
        publish = workflow.split("  publish:", 1)[1]
        self.assertNotIn("functions:auroraNexusProjectionEngine", publish)
        self.assertNotIn("functions:runtimeWatchdog", publish)
        self.assertIn("--project wmgj-prod-jfn-20261005", publish)
        self.assertIn("--config firebase.production.json", publish)
        self.assertIn("environment: firebase-production", publish)
        self.assertNotIn("BOOTSTRAP_AURORA_PROD_WIF", publish)

    def test_hml_guard_unchanged_and_production_config_has_own_guard(self):
        root = Path(__file__).resolve().parents[2]
        hml = json.loads((root / "firebase-migration/firebase.json").read_text(encoding="utf-8"))
        production = json.loads((root / "firebase-migration/firebase.production.json").read_text(encoding="utf-8"))
        self.assertEqual(hml["functions"]["predeploy"][0], 'test "$GCLOUD_PROJECT" = "wmgj-hml-jfn-20260927"')
        self.assertIn("production_release_preflight.py", production["functions"]["predeploy"][0])
        self.assertEqual(production["hosting"]["site"], PROJECT)
        self.assertEqual(production["hosting"]["rewrites"], hml["hosting"]["rewrites"])
        self.assertTrue(all(x.get("function", {}).get("region") == REGION for x in production["hosting"]["rewrites"]))

    def test_backend_scope_covers_all_canonical_rewrites_including_onboarding(self):
        root = Path(__file__).resolve().parents[2]
        config = json.loads((root / "firebase-migration/firebase.production.json").read_text(encoding="utf-8"))
        workflow = (root / ".github/workflows/aurora-firebase-production.yml").read_text(encoding="utf-8")
        command = workflow.split("--only functions:ingestWmgjEvent,", 1)[1].split("\n", 1)[0]
        scope = set(command.split(","))
        for route in config["hosting"]["rewrites"]:
            self.assertIn("functions:" + route["function"]["functionId"], scope, route["source"])
        self.assertIn("functions:auroraNexusUserProfiles", scope)


if __name__ == "__main__":
    unittest.main()
