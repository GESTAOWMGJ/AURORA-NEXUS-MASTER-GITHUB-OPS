"""Offline consistency checks for the documentary index; no legal certification."""
import copy
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "docs/registry/aurora-nexus-index.json"
BASE = "cc1ff31d2985acb43b5ba94a3ff3309df8909b71c57ea2ffdd68140050720f3ec52cd01675432428aa99657c0b96cef4113361ac108130b9c553da9f461e3df4"
ADDENDUM = "986c1509121c923d4d3b5a3685649ca0099b2191452ca6d69a2b07b4761689ecf83c3f2ccaaaca2dc086e330d2d2fd7b8276000357c23920929f0a4e1561cac6"


def validate(index):
    if index.get("projectKey") != "JFN-AUD-GOV-001":
        raise ValueError("Project identity changed")
    if index["repository"]["id"] != 1224492398:
        raise ValueError("Repository identity changed")
    objects = index["registrationDossier"]["canonicalObjects"]
    versions = {item["version"]: item for item in objects}
    if len(versions) != len(objects):
        raise ValueError("Duplicate registry version")
    for version, digest in (("1.0.0-RC1", BASE), ("1.0.1-SCOPE-ADD", ADDENDUM)):
        if versions[version]["sha512"] != digest:
            raise ValueError("Historical digest changed")
        if not re.fullmatch(r"[a-f0-9]{64}", versions[version]["sha256"]):
            raise ValueError("Invalid supplemental digest")
    for family in ("softwareRegistration", "trademarkRegistration"):
        evidence = index["rights"][family]
        if type(evidence["verifiedGranted"]) is not bool:
            raise ValueError("Invalid verification state")
        if evidence["verifiedGranted"] and not (
            evidence.get("processNumber") and evidence.get("certificateReference")
        ):
            raise ValueError("Official verification needs its own references")
    if index["representation"]["powerOfAttorney"]["originalAccess"] != "RESTRICTED_NOT_COMMITTED":
        raise ValueError("Private original must remain outside the public index")


class RegistryIndexTests(unittest.TestCase):
    def setUp(self):
        self.index = json.loads(INDEX.read_text(encoding="utf-8"))

    def test_current_index(self):
        validate(self.index)

    def test_changed_base_hash_rejected(self):
        self.index["registrationDossier"]["canonicalObjects"][0]["sha512"] = "0" * 128
        with self.assertRaises(ValueError):
            validate(self.index)

    def test_duplicate_version_rejected(self):
        objects = self.index["registrationDossier"]["canonicalObjects"]
        objects.append(copy.deepcopy(objects[0]))
        with self.assertRaises(ValueError):
            validate(self.index)

    def test_owner_statement_does_not_verify_official_registration(self):
        self.index["rights"]["ownerDeclaration"]["alreadyHomologated"] = True
        self.index["rights"]["softwareRegistration"].update(
            verifiedGranted=True, processNumber=None, certificateReference=None
        )
        with self.assertRaises(ValueError):
            validate(self.index)

    def test_software_certificate_does_not_verify_trademark(self):
        self.index["rights"]["softwareRegistration"].update(
            verifiedGranted=True, processNumber="TEST_ONLY", certificateReference="TEST_ONLY"
        )
        self.index["rights"]["trademarkRegistration"].update(
            verifiedGranted=True, processNumber=None, certificateReference=None
        )
        with self.assertRaises(ValueError):
            validate(self.index)

    def test_other_repository_rejected(self):
        self.index["repository"]["id"] = 1
        with self.assertRaises(ValueError):
            validate(self.index)

    def test_private_original_not_publishable_through_index(self):
        self.index["representation"]["powerOfAttorney"]["originalAccess"] = "PUBLIC"
        with self.assertRaises(ValueError):
            validate(self.index)


if __name__ == "__main__":
    unittest.main()
