import copy
import json
import subprocess
import unittest
from unittest.mock import patch

import production_project_contract as contract


class ProductionProjectContractTests(unittest.TestCase):
    def setUp(self):
        self.request = json.loads(contract.REQUEST.read_text())
        self.desired = json.loads(contract.DESIRED.read_text())
        self.project = "aurora-test-prod-123"  # Synthetic fixture; no cloud lookup.
        self.number = "123456789012"

    def ready(self):
        self.request.update(status="READY_FOR_PROVISIONING",
                            confirmation="PROVISION_EXISTING_PRODUCTION_PROJECT",
                            projectId=self.project, projectNumber=self.number)
        self.desired["firebase"].update(productionProjectId=self.project,
                                       productionProjectNumber=self.number,
                                       productionProvisioningStatus="READY_FOR_PROVISIONING")

    def validate(self, project=None, number=None):
        return contract.validate_contract(self.request, self.desired,
                                          self.project if project is None else project,
                                          self.number if number is None else number)

    def test_checked_in_contract_blocks_before_any_gcp_lookup(self):
        with patch.object(contract, "describe") as lookup:
            self.assertEqual(contract.main(["--approved-project=" + self.project,
                                           "--approved-number=" + self.number, "--verify-live"]), 41)
            lookup.assert_not_called()
        self.assertEqual(self.request["projectId"], "wmgj-prod-jfn-20261005")
        self.assertEqual(self.request["projectNumber"], "616997609173")
        self.assertEqual(self.request["status"], "BLOCKED_PROJECT_NOT_VALIDATED")
        self.assertIsNone(self.request["confirmation"])
        self.assertIsNone(self.desired["firebase"]["productionProjectId"])
        self.assertIsNone(self.desired["firebase"]["productionProjectNumber"])

    def test_complete_explicit_contract_is_accepted(self):
        self.ready()
        self.assertEqual(self.validate(), (self.project, self.number))

    def test_missing_malformed_historical_and_hml_ids_are_blocked(self):
        for value in (None, "", "PENDING_FIREBASE_PROJECT_SELECTION", "Aurora Production",
                      "123456789012", "aurora-nexus-prod-wmgj", "wmgj-hml-jfn-20260927",
                      "wmgj-hml-another", "wmgj-ops", "-bad-project", "bad-project-", "a" * 31):
            with self.subTest(value=value):
                self.ready()
                self.request["projectId"] = value
                self.desired["firebase"]["productionProjectId"] = value
                with self.assertRaises(contract.ContractError):
                    contract.validate_contract(self.request, self.desired, value, self.number)

    def test_number_required_as_explicit_numeric_string(self):
        for value in (None, "", "0", 123456789012, "PENDING", "123\n"):
            with self.subTest(value=value):
                self.ready()
                self.request["projectNumber"] = value
                self.desired["firebase"]["productionProjectNumber"] = value
                with self.assertRaises(contract.ContractError):
                    contract.validate_contract(self.request, self.desired, self.project, value)

    def test_approved_environment_and_domain_must_agree(self):
        self.ready()
        for project, number in (("", self.number), ("other-production", self.number),
                                (self.project, ""), (self.project, "999999999999")):
            with self.subTest(project=project, number=number), self.assertRaises(contract.ContractError):
                self.validate(project, number)
        for field, value in (("productionProjectId", "other-production"),
                             ("productionProjectNumber", "999999999999"),
                             ("productionProvisioningStatus", "BLOCKED_PROJECT_NOT_VALIDATED")):
            self.ready()
            self.desired["firebase"][field] = value
            with self.subTest(field=field), self.assertRaises(contract.ContractError):
                self.validate()

    def test_old_request_and_relaxed_guardrails_are_rejected(self):
        self.ready()
        baseline = copy.deepcopy(self.request)
        for field, value in (("requestVersion", 1), ("confirmation", "CREATE_PRODUCTION_PROJECT"),
                             ("status", None), ("productionMutation", True),
                             ("sourceMutation", True), ("clinicalSensitiveEnabled", True),
                             ("region", "us-central1"), ("expectedSourceSha", "main")):
            self.request = copy.deepcopy(baseline)
            self.request[field] = value
            with self.subTest(field=field), self.assertRaises(contract.ContractError):
                self.validate()

    def test_wif_and_service_account_are_bound_to_project_and_number(self):
        provider = f"projects/{self.number}/locations/global/workloadIdentityPools/aurora-github/providers/github"
        account = f"aurora-prod-deploy@{self.project}.iam.gserviceaccount.com"
        contract.validate_wif(self.project, self.number, provider, account)
        for wrong_provider, wrong_account in (("", account), (provider.replace(self.number, "999"), account),
                                              (provider, ""), (provider, "hml@wmgj-hml-jfn-20260927.iam.gserviceaccount.com")):
            with self.subTest(provider=wrong_provider, account=wrong_account), self.assertRaises(contract.ContractError):
                contract.validate_wif(self.project, self.number, wrong_provider, wrong_account)

    def test_live_success_uses_only_project_and_billing_describe(self):
        metadata = {"projectId": self.project, "projectNumber": self.number, "lifecycleState": "ACTIVE"}
        billing = {"projectId": self.project, "billingEnabled": True}
        with patch.object(contract, "describe", side_effect=[metadata, billing]) as lookup:
            contract.verify_live(self.project, self.number)
            self.assertEqual([call.args[0] for call in lookup.call_args_list],
                             [["projects", "describe", self.project], ["billing", "projects", "describe", self.project]])

    def test_live_mismatch_or_deleted_project_blocks_before_billing(self):
        for delta in ({"projectId": "other-production"}, {"projectNumber": "999"},
                      {"lifecycleState": "DELETE_REQUESTED"}, {"lifecycleState": None}):
            metadata = {"projectId": self.project, "projectNumber": self.number, "lifecycleState": "ACTIVE", **delta}
            with self.subTest(delta=delta), patch.object(contract, "describe", return_value=metadata) as lookup:
                with self.assertRaises(contract.ContractError):
                    contract.verify_live(self.project, self.number)
                self.assertEqual(lookup.call_count, 1)

    def test_unverified_billing_is_not_linked_automatically(self):
        metadata = {"projectId": self.project, "projectNumber": self.number, "lifecycleState": "ACTIVE"}
        for billing in ({}, {"projectId": self.project, "billingEnabled": False},
                        {"projectId": "other-production", "billingEnabled": True}):
            with self.subTest(billing=billing), patch.object(contract, "describe", side_effect=[metadata, billing]):
                with self.assertRaises(contract.ContractError):
                    contract.verify_live(self.project, self.number)

    def test_lookup_failures_never_fall_through_to_create(self):
        for result in (subprocess.CompletedProcess([], 1, "", "PERMISSION_DENIED"),
                       subprocess.CompletedProcess([], 1, "", "NOT_FOUND"),
                       subprocess.CompletedProcess([], 0, "not-json", ""),
                       subprocess.CompletedProcess([], 0, "[]", "")):
            with self.subTest(result=result), patch.object(contract.shutil, "which", return_value="gcloud"), \
                    patch.object(contract.subprocess, "run", return_value=result) as run:
                with self.assertRaises(contract.ContractError):
                    contract.verify_live(self.project, self.number)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.args[0], ["gcloud", "projects", "describe", self.project, "--format=json", "--quiet"])
        with patch.object(contract.shutil, "which", return_value="gcloud"), \
                patch.object(contract.subprocess, "run", side_effect=subprocess.TimeoutExpired("gcloud", 60)):
            with self.assertRaises(contract.ContractError):
                contract.verify_live(self.project, self.number)


if __name__ == "__main__":
    unittest.main()
