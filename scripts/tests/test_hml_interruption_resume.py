import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("hml_resume", Path(__file__).resolve().parents[1] / "test_hml_interruption_resume.py")
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.event = h.synthetic_event("fixed-synthetic-test")
        self.doc = {"fields": {"is_test": {"booleanValue": True}, "revision": {"integerValue": "1"}},
                    "updateTime": "2026-10-08T00:00:00Z"}

    def verify(self, count=1, doc=None, missing=False, before=None):
        def get(path, token):
            if path.startswith("invoices/"):
                return self.doc if doc is None else doc
            return None if missing else {"fields": {}}
        with patch.object(h, "firestore_get", side_effect=get), patch.object(h, "exact_query", return_value=[{}] * count):
            return h.verify_once(self.event, "not-a-real-token", before)

    def test_exact_single_effect_and_revision_required(self):
        proof = self.verify()
        self.assertTrue(all(value == 1 for value in proof["counts"].values()))
        self.assertEqual(proof["revision"], 1)

    def test_second_audit_or_version_record_blocks_acceptance(self):
        with self.assertRaisesRegex(h.GateError, "EXACTLY_ONE_EFFECT"):
            self.verify(count=2)

    def test_missing_idempotency_or_audit_record_blocks_acceptance(self):
        with self.assertRaisesRegex(h.GateError, "EXACTLY_ONE_EFFECT"):
            self.verify(missing=True)

    def test_second_revision_blocks_acceptance(self):
        doc = copy.deepcopy(self.doc)
        doc["fields"]["revision"]["integerValue"] = "2"
        with self.assertRaisesRegex(h.GateError, "REVISION_OR_IMMUTABLE_VERSION_INVALID"):
            self.verify(doc=doc)

    def test_missing_synthetic_marker_blocks_acceptance(self):
        doc = copy.deepcopy(self.doc)
        doc["fields"]["is_test"]["booleanValue"] = False
        with self.assertRaisesRegex(h.GateError, "SYNTHETIC_MARKER"):
            self.verify(doc=doc)

    def test_retry_that_changes_entity_blocks_acceptance(self):
        before = copy.deepcopy(self.doc)
        before["updateTime"] = "2026-10-07T23:59:59Z"
        with self.assertRaisesRegex(h.GateError, "DUPLICATE_CHANGED"):
            self.verify(before=before)

    def test_legacy_backend_is_observation_without_current_contract_acceptance(self):
        legacy = copy.deepcopy(self.doc)
        del legacy["fields"]["revision"]
        with patch.object(h, "firestore_get", side_effect=lambda path, token: legacy if path.startswith("invoices/") else {"fields": {}}), patch.object(h, "exact_query", side_effect=lambda collection, *args: [] if collection == "entityVersions" else [{}]):
            proof = h.verify_once(self.event, "not-a-real-token")
        self.assertFalse(proof["currentIngestionContractVerified"])
        self.assertIsNone(proof["revision"])
        self.assertEqual(proof["counts"]["immutableVersions"], 0)

    def test_partial_version_rollout_is_rejected(self):
        legacy = copy.deepcopy(self.doc)
        del legacy["fields"]["revision"]
        with self.assertRaisesRegex(h.GateError, "REVISION_OR_IMMUTABLE_VERSION_INVALID"):
            self.verify(doc=legacy)

    def test_two_immutable_versions_are_rejected(self):
        with patch.object(h, "firestore_get", side_effect=lambda path, token: self.doc if path.startswith("invoices/") else {"fields": {}}), patch.object(h, "exact_query", side_effect=lambda collection, *args: [{}, {}] if collection == "entityVersions" else [{}]):
            with self.assertRaisesRegex(h.GateError, "REVISION_OR_IMMUTABLE_VERSION_INVALID"):
                h.verify_once(self.event, "not-a-real-token")

    def test_real_owned_worker_can_be_killed_before_send(self):
        child = h.start_worker({"phase": "BEFORE_SEND"})
        self.assertIsNone(child.poll())
        h.stop_owned(child)
        self.assertIsNotNone(child.poll())
        self.assertNotEqual(child.returncode, 0)
        child.stdout.close()
        child.stderr.close()


if __name__ == "__main__":
    unittest.main()
