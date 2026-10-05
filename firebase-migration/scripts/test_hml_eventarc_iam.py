import argparse
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("repair", Path(__file__).with_name("repair-hml-eventarc-iam.py"))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)
PROJECT = "wmgj-hml-jfn-example"
NUMBER = "123456789012"
CONFIRMATION = f"{repair.CONFIRMATION}:{PROJECT}"


class RepairTests(unittest.TestCase):
    def setUp(self):
        output = patch("builtins.print")
        output.start()
        self.addCleanup(output.stop)

    def policy(self):
        return {"version": 3, "etag": "server-etag", "bindings": [
            {"role": "roles/viewer", "members": ["user:admin@example.invalid"],
             "condition": {"title": "existing", "expression": "false"}}],
            "auditConfigs": [{"service": "allServices", "auditLogConfigs": [{"logType": "ADMIN_READ"}]}]}

    def test_only_allowlisted_additions_and_existing_policy_preserved(self):
        before = self.policy()
        original = copy.deepcopy(before)
        after, additions = repair.proposed_policy(before, repair.fingerprint(before), NUMBER)
        self.assertEqual(before, original)
        self.assertEqual(after["bindings"][0], before["bindings"][0])
        self.assertEqual(after["auditConfigs"], before["auditConfigs"])
        self.assertEqual(after["etag"], before["etag"])
        self.assertEqual({(a["role"], a["member"]) for a in additions}, set(repair.required_bindings(NUMBER)))
        self.assertEqual(repair.plan(after, NUMBER), [])

    def test_idempotent_and_retains_other_members(self):
        policy = self.policy()
        role, member = repair.required_bindings(NUMBER)[0]
        policy["bindings"].append({"role": role, "members": ["serviceAccount:other@example.invalid", member]})
        after, additions = repair.proposed_policy(policy, repair.fingerprint(policy), NUMBER)
        self.assertEqual(len(additions), 2)
        self.assertIn("serviceAccount:other@example.invalid", after["bindings"][1]["members"])
        self.assertEqual(repair.proposed_policy(after, repair.fingerprint(after), NUMBER), (after, []))

    def test_stale_review_rejected(self):
        policy = self.policy()
        reviewed = repair.fingerprint(policy)
        policy["etag"] = "new-etag"
        with self.assertRaisesRegex(ValueError, "POLICY_CHANGED"):
            repair.proposed_policy(policy, reviewed, NUMBER)

    def test_conditional_access_is_never_widened(self):
        policy = self.policy()
        role, member = repair.required_bindings(NUMBER)[0]
        policy["bindings"].append({"role": role, "members": [member], "condition": {"expression": "false"}})
        with self.assertRaisesRegex(ValueError, "CONDITIONAL_BINDING"):
            repair.plan(policy, NUMBER)

    def test_invalid_or_unversioned_policy_rejected(self):
        for policy in ({}, {"etag": "x", "bindings": {}}, {"etag": "x", "bindings": [{"role": "x"}]},
                       {"etag": "x", "bindings": [], "version": 99}):
            with self.subTest(policy=policy), self.assertRaises(ValueError):
                repair.plan(policy, NUMBER)

    def args(self, directory, **kwargs):
        defaults = dict(project=PROJECT, expected_project_number=NUMBER, apply=False, confirm="", expected_policy_sha256="", evidence_dir=directory)
        defaults.update(kwargs)
        return argparse.Namespace(**defaults)

    def test_read_only_default_and_private_evidence(self):
        project = {"projectId": PROJECT, "projectNumber": NUMBER, "lifecycleState": "ACTIVE"}
        with tempfile.TemporaryDirectory() as root, patch.object(repair, "execute", side_effect=[project, self.policy()]) as command:
            target = str(Path(root) / "evidence")
            self.assertEqual(repair.run(self.args(target), "gcloud"), 3)
            self.assertEqual(command.call_count, 2)
            self.assertNotIn("set-iam-policy", str(command.call_args_list))
            self.assertEqual((Path(target) / "policy-before.json").stat().st_mode & 0o777, 0o600)

    def test_project_mismatch_never_reads_or_writes_iam(self):
        with patch.object(repair, "execute", return_value={"projectId": "production"}) as command:
            with self.assertRaisesRegex(ValueError, "PROJECT_IDENTITY_MISMATCH"):
                repair.run(self.args("unused"), "gcloud")
            self.assertEqual(command.call_count, 1)

    def test_read_only_preflight_passes_when_bindings_exist_without_any_write(self):
        project = {"projectId": PROJECT, "projectNumber": NUMBER, "lifecycleState": "ACTIVE"}
        policy = self.policy()
        policy, _ = repair.proposed_policy(policy, repair.fingerprint(policy), NUMBER)
        with tempfile.TemporaryDirectory() as root, patch.object(repair, "execute", side_effect=[project, policy]) as command:
            target = str(Path(root) / "evidence")
            self.assertEqual(repair.run(self.args(target), "gcloud"), 0)
            self.assertEqual(command.call_count, 2)
            self.assertNotIn("set-iam-policy", str(command.call_args_list))
            result = json.loads((Path(target) / "result.json").read_text())
            self.assertEqual(result["status"], "BINDINGS_PRESENT")
            self.assertFalse(result["cloudMutationAttempted"])

    def test_non_hml_and_invalid_number_rejected_before_cloud_call(self):
        for values in ({"project": "production"}, {"project": "wmgj-hml-jfn-prod"},
                       {"expected_project_number": "not-a-number"}):
            with self.subTest(values=values), patch.object(repair, "execute") as command:
                with self.assertRaisesRegex(ValueError, "EXPLICIT_HML_TARGET"):
                    repair.run(self.args("unused", **values), "gcloud")
                command.assert_not_called()

    def test_apply_confirmation_is_bound_to_selected_project(self):
        with patch.object(repair, "execute") as command:
            with self.assertRaisesRegex(ValueError, "EXPLICIT_REVIEWED_POLICY"):
                repair.run(self.args("unused", apply=True, confirm=repair.CONFIRMATION,
                                     expected_policy_sha256="a" * 64), "gcloud")
            command.assert_not_called()

    def test_iam_evidence_cannot_be_written_into_repository(self):
        project = {"projectId": PROJECT, "projectNumber": NUMBER, "lifecycleState": "ACTIVE"}
        with patch.object(repair, "execute", side_effect=[project, self.policy()]):
            with self.assertRaisesRegex(ValueError, "OUTSIDE_REPOSITORY"):
                repair.run(self.args(str(Path(__file__).resolve().parent / "private-iam")), "gcloud")

    def test_apply_requires_explicit_review_before_any_cloud_call(self):
        with patch.object(repair, "execute") as command:
            with self.assertRaisesRegex(ValueError, "EXPLICIT_REVIEWED_POLICY"):
                repair.run(self.args("unused", apply=True), "gcloud")
            command.assert_not_called()

    def test_failed_write_is_not_retried_and_keeps_attempt_evidence(self):
        policy = self.policy()
        project = {"projectId": PROJECT, "projectNumber": NUMBER, "lifecycleState": "ACTIVE"}
        with tempfile.TemporaryDirectory() as root, patch.object(repair, "execute", side_effect=[project, policy, RuntimeError("DENIED")]) as command:
            target = str(Path(root) / "evidence")
            with self.assertRaisesRegex(RuntimeError, "DENIED"):
                repair.run(self.args(target, apply=True, confirm=CONFIRMATION,
                                     expected_policy_sha256=repair.fingerprint(policy)), "gcloud")
            self.assertEqual(command.call_count, 3)
            self.assertTrue((Path(target) / "apply-started.json").exists())
            self.assertFalse((Path(target) / "result.json").exists())

    def test_apply_verifies_server_after_write(self):
        policy = self.policy()
        after, _ = repair.proposed_policy(policy, repair.fingerprint(policy), NUMBER)
        project = {"projectId": PROJECT, "projectNumber": NUMBER, "lifecycleState": "ACTIVE"}
        with tempfile.TemporaryDirectory() as root, patch.object(repair, "execute", side_effect=[project, policy, after, after]) as command:
            target = str(Path(root) / "evidence")
            self.assertEqual(repair.run(self.args(target, apply=True, confirm=CONFIRMATION,
                             expected_policy_sha256=repair.fingerprint(policy)), "gcloud"), 0)
            self.assertEqual(command.call_count, 4)
            result = json.loads((Path(target) / "result.json").read_text())
            self.assertEqual(result["status"], "BINDINGS_VERIFIED")
            self.assertFalse(result["deploymentVerified"])


if __name__ == "__main__":
    unittest.main()
