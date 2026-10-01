import json
from pathlib import Path
import stat
import tempfile
import unittest
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import connector_setup as c
import one_click_deploy


class ConnectorSetupTest(unittest.TestCase):
    def test_issued_key_is_random_and_manifest_gets_hash_only(self):
        issued = c.issue_aurora_api_key("wmgj", "tasy")
        self.assertTrue(issued.api_key.startswith("anx_ik_"))
        self.assertEqual(len(issued.sha256), 64)
        self.assertIn("documents.ingest", issued.scopes)
        self.assertNotIn(issued.api_key, json.dumps({
            "keyId": issued.key_id, "sha256": issued.sha256, "expiresAt": issued.expires_at
        }))

    def test_bundle_never_contains_raw_secrets(self):
        manifest, secrets_map, issued = c.build_install_bundle(
            org="wmgj",
            drive_folder_id="1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-",
            firestore_ingest_url="https://api.auroranexus.com.br/ingest",
            firestore_hmac_key_id="drive-prod-001",
            firestore_hmac_secret="ab" * 32,
            external_system_name="tasy",
            external_base_url="https://erp.example.org/api",
            external_api_key="external-super-secret",
        )
        encoded = json.dumps(manifest)
        self.assertNotIn("ab" * 32, encoded)
        self.assertNotIn("external-super-secret", encoded)
        self.assertNotIn(issued.api_key, encoded)
        self.assertEqual(manifest["firebase"]["mirrorRequired"], True)
        self.assertEqual(manifest["googleDrive"]["continuousExtraction"], True)
        self.assertEqual(secrets_map["AURORA_FIRESTORE_HMAC_SECRET"], "ab" * 32)

    def test_document_sources_are_multi_erp_and_firebase_native(self):
        sources = c.normalize_document_sources(
            "1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-",
            [
                {"sourceId": "mv-faturamento", "system": "MV", "folderId": "1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-", "slaMinutes": 60},
                {"sourceId": "tasy-contas", "system": "TASY", "folderId": "1AttD216I2uYk44twuAYHwkDBa8tGAEIo", "slaMinutes": 120},
                {"sourceId": "erp-outros", "system": "ERP", "folderId": "1Q7uhuOorLFO2GjFyU_cPeS3qSMBMTHNQ", "slaMinutes": 1440},
            ],
        )
        self.assertEqual([item["system"] for item in sources], ["MV", "TASY", "ERP"])
        manifest, _, _ = c.build_install_bundle(
            org="wmgj",
            drive_folder_id="1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-",
            firestore_ingest_url="https://api.auroranexus.com.br/ingest",
            firestore_hmac_key_id="drive-prod-001",
            firestore_hmac_secret="ab" * 32,
            document_sources=sources,
        )
        self.assertEqual(len(manifest["documentSources"]), 3)
        self.assertEqual(manifest["nativeDataPlane"]["storage"], "FIRESTORE")
        self.assertFalse(manifest["nativeDataPlane"]["sourceAccessRequiredAfterIngest"])
        self.assertFalse(manifest["nativeDataPlane"]["externalAiFallbackDefault"])
        self.assertEqual(manifest["documentInputs"]["canonicalApiPath"], "/api/integration/documents")
        self.assertEqual(manifest["documentInputs"]["requiredApiScope"], "documents.ingest")

    def test_document_source_rejects_unknown_system_and_invalid_sla(self):
        with self.assertRaises(c.ConnectorSetupError):
            c.normalize_document_sources("1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-", [
                {"sourceId": "bad-source", "system": "UNKNOWN", "folderId": "1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-", "slaMinutes": 60}
            ])
        with self.assertRaises(c.ConnectorSetupError):
            c.normalize_document_sources("1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-", [
                {"sourceId": "mv-source", "system": "MV", "folderId": "1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-", "slaMinutes": 1}
            ])

    def test_private_env_permissions_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "private" / "secrets.env"
            c.write_private_env(path, {"AURORA_TOKEN": "secret"})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertIn("AURORA_TOKEN='secret'", path.read_text())
            with self.assertRaises(FileExistsError):
                c.write_private_env(path, {"AURORA_TOKEN": "other"})

    def test_rejects_non_https_and_weak_hmac(self):
        with self.assertRaises(c.ConnectorSetupError):
            c.validate_https_url("http://example.com", field="x")
        with self.assertRaises(c.ConnectorSetupError):
            c.validate_hmac_secret("weak")

    def test_external_connector_is_all_or_nothing(self):
        with self.assertRaises(c.ConnectorSetupError):
            c.build_install_bundle(
                org="wmgj",
                drive_folder_id="1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-",
                firestore_ingest_url="https://api.auroranexus.com.br/ingest",
                firestore_hmac_key_id="drive-prod-001",
                firestore_hmac_secret="ab" * 32,
                external_system_name="tasy",
            )

    def test_one_click_executes_real_installer_and_uses_stable_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            watch = root / "incoming"
            watch.mkdir()
            target = root / "aurora"
            rc = one_click_deploy.main([
                "--one-click",
                "--target", str(target),
                "--watch-dir", str(watch),
                "--endpoint", "https://api.auroranexus.com.br/coletor",
                "--org", "wmgj",
                "--facility", "WMGJ",
                "--without-connectors",
            ])
            self.assertEqual(rc, 0)
            self.assertTrue((target / "run.sh").is_file())
            commands = json.loads((target / "support" / "triggercmd-commands.json").read_text())
            command_text = json.dumps(commands)
            self.assertIn(str(target / "run.sh"), command_text)
            self.assertNotIn("one_click_deploy.py --one-click", command_text)
            self.assertFalse((target / "connectors").exists())


if __name__ == "__main__":
    unittest.main()
