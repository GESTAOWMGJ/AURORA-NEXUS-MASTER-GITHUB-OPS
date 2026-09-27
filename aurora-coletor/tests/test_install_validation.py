import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "install.py"
spec = importlib.util.spec_from_file_location("aurora_install", MODULE_PATH)
aurora_install = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(aurora_install)


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

    def test_target_refuses_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                aurora_install.validate_target(tmp)


if __name__ == "__main__":
    unittest.main()
