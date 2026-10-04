import importlib.util
import json
from pathlib import Path
import re
import subprocess
import unittest

spec = importlib.util.spec_from_file_location("gate", Path(__file__).with_name("validate-hosting-runtime.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class HostingRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.config = {"hosting": {"rewrites": [
            {"function": {"functionId": name, "region": "southamerica-east1"}}
            for name in ("auroraNexusIntegrationPing", "auroraNexusSessionLogin")]}}
        self.inventory = {"status": "success", "result": [
            {"id": "auroraNexusSessionLogin", "region": "southamerica-east1"}]}

    def test_real_failure_missing_ping_is_not_hidden_by_nonempty_list(self):
        result = gate.validate(self.config, self.inventory)
        self.assertFalse(result["ok"])
        self.assertEqual(result["missing"], ["auroraNexusIntegrationPing@southamerica-east1"])

    def test_native_repair_does_not_waive_other_routes(self):
        self.assertFalse(gate.validate(self.config, self.inventory, ["auroraNexusSessionLogin"])["ok"])

    def test_planned_target_only_waives_its_own_deployment(self):
        self.assertTrue(gate.validate(self.config, self.inventory, ["auroraNexusIntegrationPing"])["ok"])
        with self.assertRaises(ValueError):
            gate.validate(self.config, self.inventory, ["unrelated"])

    def test_wrong_region_and_inactive_function_are_rejected(self):
        for entry in [{"region": "us-central1"}, {"region": "southamerica-east1", "state": "FAILED"}]:
            self.inventory["result"].append({"id": "auroraNexusIntegrationPing", **entry})
            self.assertFalse(gate.validate(self.config, self.inventory)["ok"])
            self.inventory["result"].pop()

    def test_extra_functions_are_allowed(self):
        self.inventory["result"].extend([
            {"id": "auroraNexusIntegrationPing", "region": "southamerica-east1"},
            {"id": "runtimeHealth", "region": "southamerica-east1"}])
        self.assertTrue(gate.validate(self.config, self.inventory)["ok"])

    def test_nested_names_error_and_unknown_shape_cannot_prove_presence(self):
        for inventory in [{"result": {"id": "auroraNexusIntegrationPing"}},
                          {"status": "error", "result": []},
                          {"result": [{"id": "x"}]}]:
            with self.assertRaises(ValueError):
                gate.validate(self.config, inventory)

    def test_actual_deploy_jq_accepts_extra_but_not_missing_functions(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/deploy-aurora-firebase.yml").read_text()
        match = re.search(r"jq -e --argjson expected '(\[[\s\S]*?\])' '([\s\S]*?)' <<<\"\$functions\"", workflow)
        self.assertIsNotNone(match)
        expected = json.loads(match[1])
        for names, success in [(expected + ["ingestWmgjEvent", "auroraNexusCryptoSelfTest"], True),
                               ([name for name in expected if name != "auroraNexusIntegrationPing"], False)]:
            run = subprocess.run(["jq", "-e", "--argjson", "expected", json.dumps(expected), match[2]],
                                 input=json.dumps({"result": [{"id": name} for name in names]}),
                                 text=True, capture_output=True)
            self.assertEqual(run.returncode == 0, success, run.stderr)


if __name__ == "__main__":
    unittest.main()
