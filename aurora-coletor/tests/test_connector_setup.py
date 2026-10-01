import json
from pathlib import Path
import stat
import tempfile
import unittest

import connector_setup as c


class ConnectorSetupTest(unittest.TestCase):
    def test_issued_key_is_random_and_manifest_gets_hash_only(self):
        issued = c.issue_aurora_api_key("wmgj", "tasy")
        self.assertTrue(issued.api_key.startswith("anx_ik_"))
        self.assertEqual(len(issued.sha256), 64)
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


if __name__ == "__main__":
    unittest.main()
