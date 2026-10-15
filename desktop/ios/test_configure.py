import importlib.util
import json
import pathlib
import plistlib
import re
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("ios_configure", ROOT / "configure.py")
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class IOSConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aurora-ios-config-test-")
        self.addCleanup(self.temp.cleanup)
        self.repo = pathlib.Path(self.temp.name)
        self.ios = self.repo / "desktop" / "ios"
        for name in configure.SOURCES + (configure.UI_TEST, "App/Info.plist"):
            path = self.ios / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((ROOT / name).read_bytes())
        (self.ios / ".gitignore").write_bytes((ROOT / ".gitignore").read_bytes())
        version = self.repo / configure.VERSION_SOURCE
        version.parent.mkdir(parents=True)
        version.write_text('export const AURORA_PRODUCT_VERSION = "2.3.4-beta.9";\n', encoding="utf-8")
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True, capture_output=True)
        subprocess.run(["git", "add", "."], cwd=self.repo, check=True, capture_output=True)
        subprocess.run(["git", "-c", "user.name=Synthetic Test", "-c", "user.email=synthetic@example.invalid",
                        "-c", "commit.gpgsign=false", "commit", "-qm", "synthetic"],
                       cwd=self.repo, check=True, capture_output=True)

    def generate(self, bundle=None, test_identity=True, build="42"):
        return configure.configure(self.repo, self.ios, bundle, test_identity, build)

    def test_dynamic_same_checkout_identity_and_unsigned_metadata(self):
        data = self.generate()
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.repo, text=True).strip()
        self.assertEqual(data["productVersion"], "2.3.4-beta.9")
        self.assertEqual(data["sourceSha"], sha)
        self.assertEqual(data["releaseId"], "aurora-2.3.4-beta.9-" + sha)
        self.assertEqual(data["bundleIdentifier"], "local.auroranexus.ios.unsigned")
        self.assertEqual(data["bundleIdentityStatus"], "UNSIGNED_TEST_IDENTITY")
        self.assertIsNone(data["certificateSha256"])
        self.assertFalse(data["nativeAcceptanceVerified"])
        self.assertEqual(data["signingStatus"], "UNSIGNED")
        self.assertEqual(json.loads((self.ios / "Generated/BuildProvenance.json").read_bytes()), data)
        self.assertEqual(len(data), 10)

    def test_configured_bundle_is_never_claimed_registered_with_apple(self):
        data = self.generate("example.synthetic.aurora", False)
        self.assertEqual(data["bundleIdentifier"], "example.synthetic.aurora")
        self.assertEqual(data["bundleIdentityStatus"], "CONFIGURED_UNVERIFIED_WITH_APPLE")
        self.assertEqual(data["distribution"], "NATIVE_IOS_CANDIDATE")

    def test_dirty_version_or_untracked_ios_cannot_claim_checkout_source(self):
        (self.ios / "unreviewed.swift").write_text("// synthetic", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Commit iOS"):
            self.generate()
        self.assertFalse((self.ios / "Generated").exists())

    def test_identity_must_be_explicit_and_cannot_inject_project_settings(self):
        for bundle, test in [(None, False), ("example.app.ios", True), ('bad.id";TEAM=X', False), ("two.parts", False)]:
            with self.subTest(bundle=bundle, test=test), self.assertRaises(ValueError):
                self.generate(bundle, test)
        self.assertFalse((self.ios / "Generated").exists())

    def test_reject_noncanonical_or_ambiguous_product_version(self):
        for text in ['export const AURORA_PRODUCT_VERSION = "latest";',
                     'export const AURORA_PRODUCT_VERSION = "1.2.3";\nexport const AURORA_PRODUCT_VERSION = "4.5.6";']:
            (self.repo / configure.VERSION_SOURCE).write_text(text, encoding="utf-8")
            with self.assertRaises(ValueError):
                self.generate()
        self.assertFalse((self.ios / "Generated").exists())

    def test_project_closes_real_source_set_and_has_no_signing_credentials(self):
        self.generate()
        project = (self.ios / "Generated/AuroraNexus.xcodeproj/project.pbxproj").read_text(encoding="utf-8")
        for name in configure.SOURCES + (configure.UI_TEST,):
            self.assertIn('path = "../' + name + '";', project)
        self.assertEqual(project.count("isa = PBXSourcesBuildPhase;"), 2)
        self.assertEqual(project.count("isa = PBXNativeTarget;"), 2)
        self.assertIn("MARKETING_VERSION = \"2.3.4\"", project)
        self.assertIn("CURRENT_PROJECT_VERSION = 42", project)
        self.assertIn("CODE_SIGNING_ALLOWED = NO", project)
        for prohibited in ["DEVELOPMENT_TEAM", "PROVISIONING_PROFILE", "CODE_SIGN_ENTITLEMENTS", "CODE_SIGN_IDENTITY"]:
            self.assertNotIn(prohibited, project)
        ids = re.findall(r"^\s*([A-F0-9]{24}) = \{", project, re.MULTILINE)
        self.assertEqual(len(ids), len(set(ids)))
        for reference in re.findall(r"\b[A-F0-9]{24}\b", project):
            self.assertIn(reference, ids)
        self.generate()
        self.assertEqual(project, (self.ios / "Generated/AuroraNexus.xcodeproj/project.pbxproj").read_text(encoding="utf-8"))

    def test_shared_scheme_wires_only_synthetic_ui_test_target(self):
        self.generate()
        path = self.ios / "Generated/AuroraNexus.xcodeproj/xcshareddata/xcschemes/AuroraNexus.xcscheme"
        tests = ET.parse(path).getroot().findall("./TestAction/Testables/TestableReference/BuildableReference")
        self.assertEqual(len(tests), 1)
        self.assertEqual(tests[0].attrib["BlueprintName"], "AuroraNexusUITests")
        self.assertEqual(tests[0].attrib["BlueprintIdentifier"], configure.oid("target:test"))
        self.assertIn('--aurora-ui-test', (ROOT / configure.UI_TEST).read_text(encoding="utf-8"))

    def test_info_uses_build_settings_and_has_no_tls_or_permissions_exception(self):
        info = plistlib.loads((ROOT / "App/Info.plist").read_bytes())
        self.assertEqual(info["CFBundleIdentifier"], "$(PRODUCT_BUNDLE_IDENTIFIER)")
        self.assertEqual(info["CFBundleShortVersionString"], "$(MARKETING_VERSION)")
        self.assertEqual(info["CFBundleVersion"], "$(CURRENT_PROJECT_VERSION)")
        self.assertNotIn("NSAppTransportSecurity", info)
        self.assertFalse(any("UsageDescription" in key for key in info))

    def test_missing_payload_and_invalid_build_number_fail_before_output(self):
        for number in ["0", "-1", "1;SIGN=YES", "1234567890"]:
            with self.assertRaises(ValueError):
                self.generate(build=number)
        (self.ios / configure.SOURCES[0]).unlink()
        with self.assertRaises(ValueError):
            self.generate()
        self.assertFalse((self.ios / "Generated").exists())

    def test_workflow_existing_pipeline_uses_exact_source_explicit_project_and_unsigned_simulator(self):
        text = (ROOT.parents[1] / ".github/workflows/ios.yml").read_text(encoding="utf-8")
        for token in ["github.event.pull_request.head.sha || github.sha", "persist-credentials: false",
                      "desktop/ios/configure.py", "swift test", "AuroraNexus.xcodeproj", "-scheme AuroraNexus",
                      "CODE_SIGNING_ALLOWED=NO", "test-without-building", "--unsigned-test-identity",
                      "unsigned-ios-simulator-", "AURORA_IOS_BUNDLE_IDENTIFIER"]:
            self.assertIn(token, text)
        for token in ["app-store-connect", "notarytool", "-exportArchive", "allowProvisioningUpdates", "secrets."]:
            self.assertNotIn(token, text)


if __name__ == "__main__":
    unittest.main()
