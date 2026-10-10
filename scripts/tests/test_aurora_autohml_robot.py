import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

path = Path(__file__).resolve().parents[2] / "firebase-migration/scripts/aurora_autohml_robot.py"
spec = importlib.util.spec_from_file_location("aurora_robot", path)
robot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(robot)

class RobotTests(unittest.TestCase):
    def test_all_offline_checks_never_imply_live_homologation(self):
        calls = []
        def fake(args, **kwargs):
            calls.append(args)
            self.assertTrue(kwargs["capture_output"])
            self.assertLessEqual(kwargs["timeout"],120)
            return SimpleNamespace(returncode=0)
        report=robot.execute(list(robot.CHECKS),runner=fake)
        self.assertEqual(len(calls),len(robot.CHECKS))
        self.assertEqual(report["decision"],"AWAITING_OPERATIONAL_EVIDENCE")
        self.assertFalse(report["releaseApproved"])
        self.assertFalse(report["cloudMutationAttempted"])
        self.assertFalse(report["credentialsTouched"])
    def test_failure_blocks(self):
        def fake(args,**kwargs): return SimpleNamespace(returncode=1)
        self.assertEqual(robot.execute(["readonly-gate"],runner=fake)["decision"],"BLOCKED")
    def test_unknown_check_rejected(self):
        with self.assertRaises(ValueError): robot.execute(["gcloud iam grant"])
    def test_live_evidence_requires_all_gates(self):
        checks={"x":{"status":"PASS"}}
        self.assertEqual(robot.decide(checks,{}),"AWAITING_OPERATIONAL_EVIDENCE")
        self.assertEqual(robot.decide(checks,{k:True for k in robot.BLOCKERS}),"ELIGIBLE_FOR_CONTROLLED_REVIEW")
        self.assertEqual(robot.decide({"x":{"status":"FAIL"}},{k:True for k in robot.BLOCKERS}),"BLOCKED")

if __name__=="__main__":unittest.main()
