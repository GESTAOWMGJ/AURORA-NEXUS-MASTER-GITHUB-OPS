import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

install_spec = importlib.util.spec_from_file_location("aurora_install", ROOT / "install.py")
aurora_install = importlib.util.module_from_spec(install_spec)
assert install_spec and install_spec.loader
install_spec.loader.exec_module(aurora_install)

collector_spec = importlib.util.spec_from_file_location("aurora_collector", ROOT / "aurora_collector.py")
aurora_collector = importlib.util.module_from_spec(collector_spec)
assert collector_spec and collector_spec.loader
collector_spec.loader.exec_module(aurora_collector)


class InstallValidationTest(unittest.TestCase):
    def test_org_requires_lowercase(self):
        self.assertEqual(aurora_install.validate_org("wmgj"), "wmgj")
        with self.assertRaises(SystemExit):
            aurora_install.validate_org("WMGJ")

    def test_facility_requires_uppercase(self):
        self.assertEqual(aurora_install.validate_facility("WMGJ"), "WMGJ")
        with self.assertRaises(SystemExit):
            aurora_install.validate_facility("wmgj")

    def test_endpoint_requires_https_and_no_placeholder(self):
        self.assertEqual(
            aurora_install.validate_endpoint("https://api.auroranexus.com.br/coletor/"),
            "https://api.auroranexus.com.br/coletor",
        )
        with self.assertRaises(SystemExit):
            aurora_install.validate_endpoint("http://api.auroranexus.com.br/coletor")
        with self.assertRaises(SystemExit):
            aurora_install.validate_endpoint("https://ENDERECO-AUTORIZADO")
        with self.assertRaises(SystemExit):
            aurora_install.validate_endpoint("https://user:pass@api.auroranexus.com.br/coletor")

    def test_target_refuses_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                aurora_install.validate_target(tmp)

    def test_identity_default(self):
        self.assertEqual(
            aurora_install.default_identity("wmgj", "WMGJ"),
            "aurora-collector-wmgj-wmgj-hml-001",
        )


class CollectorRuntimeTest(unittest.TestCase):
    def test_validate_receipt(self):
        h = "a" * 64
        receipt_id, state = aurora_collector.validate_receipt(
            json.dumps({"receiptId": "rcpt_123456", "normalizedContentHash": h, "state": "AWAITING_REVIEW"}),
            h,
        )
        self.assertEqual(receipt_id, "rcpt_123456")
        self.assertEqual(state, "AWAITING_REVIEW")

    def test_validate_receipt_rejects_hash_mismatch(self):
        with self.assertRaises(aurora_collector.PermanentFileError):
            aurora_collector.validate_receipt(
                json.dumps({"receiptId": "rcpt_123456", "normalizedContentHash": "b" * 64, "state": "AWAITING_REVIEW"}),
                "a" * 64,
            )

    def test_default_mode_validates_without_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            watch = root / "in"
            state = root / "state"
            watch.mkdir()
            (watch / "data.json").write_text('{"b":2,"a":1}', encoding="utf-8")
            cfg = root / "collector-config.json"
            cfg.write_text(json.dumps({
                "org": "wmgj",
                "facility": "WMGJ",
                "technicalIdentityId": "aurora-collector-wmgj-hml-001",
                "credentialExpiresAt": "2999-01-01T00:00:00+00:00",
                "endpoint": "https://api.auroranexus.com.br/coletor",
                "watchDir": str(watch),
                "stateDir": str(state),
                "pollSeconds": 30,
                "allowedExtensions": [".json"],
            }), encoding="utf-8")
            self.assertEqual(aurora_collector.run_validate(cfg), 0)
            self.assertTrue((state / "collector-state.sqlite3").exists())

    def test_once_requires_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            watch = root / "in"
            state = root / "state"
            watch.mkdir()
            cfg = root / "collector-config.json"
            cfg.write_text(json.dumps({
                "org": "wmgj",
                "facility": "WMGJ",
                "technicalIdentityId": "aurora-collector-wmgj-hml-001",
                "credentialExpiresAt": "2999-01-01T00:00:00+00:00",
                "endpoint": "https://api.auroranexus.com.br/coletor",
                "watchDir": str(watch),
                "stateDir": str(state),
                "pollSeconds": 30,
            }), encoding="utf-8")
            old = os.environ.pop("AURORA_COLLECTOR_TOKEN", None)
            try:
                with self.assertRaises(aurora_collector.ConfigError):
                    aurora_collector.transmit_once(aurora_collector.load_config(cfg))
            finally:
                if old is not None:
                    os.environ["AURORA_COLLECTOR_TOKEN"] = old


if __name__ == "__main__":
    unittest.main()
