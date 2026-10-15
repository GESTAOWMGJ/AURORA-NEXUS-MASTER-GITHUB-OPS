"""Synthetic package boundaries; no app, cloud, network or operational receipts."""
import base64
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import plistlib
import stat
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

import build_unified_beta as build
import verify_unified_beta as verifier


SOURCE = "a" * 40
OTHER = "b" * 40
VERSION = "1.1.0-beta.1"


def write(root, name, data):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def fixture(root):
    runtime = {"lib/auroraRuntime.js": b"synthetic runtime\n", "lib/auroraFrontend.js": b"synthetic interface\n"}
    for name, data in runtime.items():
        write(root, name, data)
    for component in ("server", "web"):
        manifest = {"schemaVersion": 1, "sourceSha": SOURCE, "version": VERSION,
                    "files": {n: build.digest(b) for n, b in runtime.items()}}
        write(root, "runtime-release/" + component + "-manifest.json", build.json_bytes(manifest))
    for component, field, version in (("iaMaster", "sourceRevision", "1.1.0"),
                                      ("windowsIntegration", "sourceSha", "1.0.1")):
        content = {"synthetic.txt": b"synthetic " + component.encode()}
        manifest = {"schemaVersion": 1, field: SOURCE, "version": version, "dirty": False,
                    "files": {n: build.digest(b) for n, b in content.items()}}
        raw = build.json_bytes(manifest)
        write(root, "runtime-release/" + component + "-manifest.json", raw)
        write(root, "runtime-release/" + component + "-package.zip",
              build.archive_bytes({**content, "manifest.json": raw}))
    win = {"desktop/install_windows_beta.py": b"synthetic install fixture only\n",
           "aurora-coletor/client_agent.py": b"synthetic agent fixture only\n"}
    win_manifest = {"schemaVersion": 1, "sourceCommit": SOURCE, "clientVersion": "0.2.0-beta.4",
                    "files": {n: build.digest(b) for n, b in win.items()}}
    plist = {"CFBundleName": "Aurora Nexus HML", "CFBundleIdentifier": "br.com.auroranexus.desktop.hml",
             "CFBundleVersion": "1", "CFBundleShortVersionString": "0.2.0"}
    mac = {"Aurora Nexus HML.app/Contents/Info.plist": plistlib.dumps(plist),
           "Aurora Nexus HML.app/Contents/MacOS/aurora-portal": b"synthetic mac fixture only\n"}
    payloads = {"AURORA-NEXUS-Instalar.exe": b"MZ synthetic guided fixture",
                "AURORA-NEXUS-Windows-x64-HML.exe": b"MZ synthetic old launcher",
                "AURORA-NEXUS-Windows-Beta.zip": build.archive_bytes({**win, "manifest.json": build.json_bytes(win_manifest)}),
                "AURORA-NEXUS-Mac-HML.zip": build.archive_bytes(mac)}
    rows = []
    for name, data in sorted(payloads.items()):
        write(root, "private-downloads/" + name, data)
        rows.append({"name": name, "platform": "mac" if "Mac" in name else "windows",
                     "size": len(data), "sha256": build.digest(data), "signed": False})
    satellite = {"schemaVersion": 1, "sourceCommit": SOURCE, "version": "0.2.0-hml.20261001", "files": rows}
    write(root, "runtime-release/satellite-manifest.json", build.json_bytes(satellite))


def extract(data, root):
    # Names/types/limits are validated before this bounded synthetic extraction.
    for name, content in build.zip_files(data).items():
        write(root, name, content)


def reseal(root):
    files = verifier.read_tree(root)
    envelope = json.loads(files["release-envelope.json"])
    envelope["files"] = build.records({n: b for n, b in files.items()
                                       if n not in ("release-envelope.json", "SHA256SUMS")})
    write(root, "release-envelope.json", build.json_bytes(envelope))
    files = verifier.read_tree(root)
    write(root, "SHA256SUMS", "".join(build.digest(b) + "  " + n + "\n" for n, b in sorted(files.items())
                                    if n != "SHA256SUMS").encode())


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="aurora-unified-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.functions = self.root / "functions"
        fixture(self.functions)

    def candidate(self):
        return build.build_candidate(self.functions, SOURCE)

    def test_reproducible_common_identity_and_preserved_component_versions(self):
        first, index = self.candidate()
        second, _ = self.candidate()
        self.assertEqual(first, second)
        self.assertEqual(index["releaseId"], "aurora-" + VERSION + "-" + SOURCE)
        self.assertIsNone(index["certificateSha256"])
        self.assertFalse(index["complete"])
        self.assertEqual(index["components"]["iaMaster"]["version"], "1.1.0")
        self.assertEqual(index["components"]["satellite"]["version"], "0.2.0-hml.20261001")
        self.assertEqual(index["adoption"]["mac"]["bundleIdentifier"], "br.com.auroranexus.desktop.hml")
        self.assertEqual(index["adoption"]["ios"]["requestedDistribution"], "NATIVE_TESTFLIGHT_APP_STORE")
        self.assertEqual(index["adoption"]["ios"]["nativeDeliveryStatus"], "PENDING_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE")
        self.assertEqual(index["adoption"]["ios"]["availableWebChannel"], "EXISTING_PWA")
        self.assertEqual(index["missingTargets"], ["ios-native"])

    def test_candidate_extraction_has_exact_closed_set(self):
        data, index = self.candidate()
        files, checked = build.verify_candidate(data, SOURCE)
        extract(data, self.root / "extracted")
        self.assertEqual(verifier.read_tree(self.root / "extracted"), files)
        self.assertEqual(checked, index)
        self.assertEqual(set(files), set(index["files"]) | {"candidate-manifest.json"})

    def test_prepublication_comparison_uses_independent_deployed_manifest_bytes(self):
        data, _ = self.candidate()
        path = self.functions / "runtime-release/server-manifest.json"
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(verifier.VerificationError, "DEPLOYED_MANIFEST_BYTES_CONFLICT"):
            build.verify_candidate(data, SOURCE, self.functions / "runtime-release")

    def test_output_is_reused_only_when_exactly_identical(self):
        path = self.root / "candidate.zip"
        build.write_exclusive(path, b"same synthetic bytes")
        build.write_exclusive(path, b"same synthetic bytes")
        with self.assertRaisesRegex(verifier.VerificationError, "EXISTING_OUTPUT_CONFLICT"):
            build.write_exclusive(path, b"other bytes")
        self.assertEqual(path.read_bytes(), b"same synthetic bytes")

    def test_no_installation_ingestion_or_automation_proof_is_invented(self):
        _, index = self.candidate()
        policy = index["installationAcceptancePolicy"]
        self.assertFalse(policy["installationComplete"])
        self.assertFalse(policy["operationalProofsIncluded"])
        self.assertFalse(policy["loginPingAndCiAreProcessingProof"])
        self.assertEqual(policy["methods"], ["CLOUD_OAUTH", "API_TOKEN", "LOCAL_AGENT", "MANUAL"])
        self.assertEqual(policy["status"], "PENDING")
        self.assertTrue(all(row["acceptance"] == "PENDING" for row in index["adoption"].values()))

    def test_missing_each_binary_payload_blocks_build(self):
        paths = ["runtime-release/" + c + "-package.zip" for c in ("iaMaster", "windowsIntegration")]
        paths += ["private-downloads/" + n for n in sorted(build.SATELLITE_NAMES)]
        for relative in paths:
            with self.subTest(relative=relative):
                path = self.functions / relative
                data = path.read_bytes()
                path.unlink()
                try:
                    with self.assertRaises((OSError, verifier.VerificationError)):
                        self.candidate()
                finally:
                    path.write_bytes(data)

    def test_missing_each_manifest_blocks_build(self):
        for component in verifier.COMPONENTS:
            path = self.functions / "runtime-release" / (component + "-manifest.json")
            data = path.read_bytes()
            path.unlink()
            try:
                with self.subTest(component=component), self.assertRaises(OSError):
                    self.candidate()
            finally:
                path.write_bytes(data)

    def test_mixed_sources_and_aliases_block_build(self):
        for component in verifier.COMPONENTS:
            path = self.functions / "runtime-release" / (component + "-manifest.json")
            raw = path.read_bytes()
            manifest = json.loads(raw)
            manifest["sourceSha"] = OTHER
            path.write_bytes(build.json_bytes(manifest))
            try:
                with self.subTest(component=component), self.assertRaises(verifier.VerificationError):
                    self.candidate()
            finally:
                path.write_bytes(raw)

    def test_runtime_tamper_blocks_before_promotion(self):
        write(self.functions, "lib/auroraRuntime.js", b"changed bytes")
        with self.assertRaisesRegex(verifier.VerificationError, "RUNTIME_PAYLOAD_CONFLICT"):
            self.candidate()

    def test_unexpected_candidate_file_is_rejected_even_if_reindexed(self):
        data, _ = self.candidate()
        files = build.zip_files(data)
        files["unreviewed.py"] = b"must never execute"
        index = json.loads(files["candidate-manifest.json"])
        index["files"] = build.records({n: b for n, b in files.items() if n != "candidate-manifest.json"})
        files["candidate-manifest.json"] = build.json_bytes(index)
        with self.assertRaisesRegex(verifier.VerificationError, "UNEXPECTED_CANDIDATE_FILE"):
            build.verify_candidate(build.archive_bytes(files), SOURCE)

    def test_substituted_verifier_is_rejected_even_if_reindexed(self):
        data, _ = self.candidate()
        files = build.zip_files(data)
        files["VERIFY.py"] = b"synthetic unreviewed verifier"
        index = json.loads(files["candidate-manifest.json"])
        index["files"] = build.records({n: b for n, b in files.items() if n != "candidate-manifest.json"})
        files["candidate-manifest.json"] = build.json_bytes(index)
        with self.assertRaisesRegex(verifier.VerificationError, "REVIEWED_VERIFIER_REQUIRED"):
            build.verify_candidate(build.archive_bytes(files), SOURCE)

    def test_chosen_mac_identity_cannot_be_replaced(self):
        mac_path = self.functions / "private-downloads/AURORA-NEXUS-Mac-HML.zip"
        files = build.zip_files(mac_path.read_bytes())
        name = "Aurora Nexus HML.app/Contents/Info.plist"
        plist = plistlib.loads(files[name])
        plist["CFBundleIdentifier"] = "invalid.alternative"
        files[name] = plistlib.dumps(plist)
        data = build.archive_bytes(files)
        mac_path.write_bytes(data)
        sat_path = self.functions / "runtime-release/satellite-manifest.json"
        sat = json.loads(sat_path.read_bytes())
        for row in sat["files"]:
            if row["name"] == mac_path.name:
                row.update(sha256=build.digest(data), size=len(data))
        sat_path.write_bytes(build.json_bytes(sat))
        with self.assertRaisesRegex(verifier.VerificationError, "CHOSEN_MAC_IDENTITY_CONFLICT"):
            self.candidate()

    def test_traversal_duplicate_case_and_link_entries_are_rejected(self):
        for entries in (
            [("../escape", 0o100644), ("normal", 0o100644)],
            [("normal", 0o100644), ("normal", 0o100644)],
            [("Normal", 0o100644), ("normal", 0o100644)],
            [("link", 0o120777)],
        ):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                for name, mode in entries:
                    entry = zipfile.ZipInfo(name)
                    entry.create_system = 3
                    entry.external_attr = mode << 16
                    archive.writestr(entry, b"synthetic")
            with self.subTest(entries=entries), self.assertRaises(verifier.VerificationError):
                build.zip_files(stream.getvalue())

    def test_workflow_build_and_publisher_use_the_same_candidate_before_cas(self):
        repo = Path(__file__).resolve().parents[1]
        manifests = (repo / "firebase-migration/scripts/build-release-manifests.mjs").read_text()
        workflow = (repo / ".github/workflows/deploy-aurora-firebase.yml").read_text()
        installer = (repo / ".github/workflows/validate-aurora-installers.yml").read_text()
        self.assertIn("desktop/build_unified_beta.py", manifests)
        self.assertIn("unified-beta-candidate.zip", manifests)
        check = workflow.index("Verify complete source-bound unified beta candidate before promotion")
        cas = workflow.index("Publish exact reviewed release with compare-and-swap")
        finalize = workflow.index("Attach public certificate to the same verified beta candidate")
        self.assertLess(check, cas)
        self.assertLess(cas, finalize)
        self.assertIn("runtime-release/unified-beta-candidate.zip", workflow[:cas])
        self.assertIn("--manifests-directory firebase-migration/functions/runtime-release", workflow[:cas])
        self.assertIn("--expected-candidate-sha256", workflow[finalize:])
        self.assertIn("--candidate firebase-migration/functions/runtime-release/unified-beta-candidate.zip", workflow[finalize:])
        self.assertNotIn("build_installers.py", workflow[finalize:])
        self.assertNotIn("rollback", workflow[finalize:])
        self.assertIn("test_unified_beta.py", installer)
        self.assertIn("AURORA-NEXUS-Beta-CANDIDATE.zip", installer)

    def signed(self, index):
        try:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        except ImportError:
            self.skipTest("existing release-verification backend unavailable")
        # Synthetic key exists only in memory; no real key/credentials or cloud access.
        key = Ed25519PrivateKey.generate()
        public = key.public_key()
        cert = {"schemaVersion": 2, "sourceSha": SOURCE, "productVersion": VERSION,
                "canonicalOrigin": "https://auroranexus.com.br", "releaseRunId": "12345",
                "ciRunId": "67890", "publishedAtUtc": "2026-10-14T00:00:00.000Z", "status": "ACTIVE",
                "checks": {n: True for n in ("ciPassed", "humanReviewApproved", "protectedDeploySucceeded", "smokePassed")},
                "components": index["components"]}
        envelope = {"certificate": cert,
                    "signature": base64.urlsafe_b64encode(key.sign(build.signing_bytes(cert))).decode().rstrip("=")}
        der = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        trust = {"publicKeySpkiPem": public.public_bytes(serialization.Encoding.PEM,
                                                       serialization.PublicFormat.SubjectPublicKeyInfo).decode(),
                 "publicKeySha256": build.digest(der)}
        return envelope, trust

    def final(self):
        candidate, index = self.candidate()
        envelope, trust = self.signed(index)
        final, delivery = build.finalize(candidate, build.json_bytes(envelope), build.json_bytes(trust), SOURCE,
                                         trust["publicKeySha256"])
        root = self.root / "delivery"
        extract(final, root)
        return root, final, delivery, candidate

    def test_finalization_preserves_candidate_bytes_and_verifies_certificate(self):
        root, final, delivery, candidate = self.final()
        old_files, _ = build.verify_candidate(candidate, SOURCE)
        final_files = build.zip_files(final)
        self.assertTrue(all(final_files[name] == data for name, data in old_files.items()))
        result = verifier.verify(root)
        self.assertTrue(result["integrityVerified"])
        self.assertTrue(result["signatureVerified"])
        self.assertTrue(result["allDeclaredPayloadsPresent"])
        self.assertFalse(result["complete"])
        self.assertEqual(result["runtimePayloads"], {"server": "VERIFIED_BYTES", "web": "VERIFIED_BYTES"})
        self.assertEqual(delivery["identity"]["certificateSha256"], result["certificateSha256"])
        self.assertEqual(delivery["candidateSha256"], build.digest(candidate))
        self.assertEqual(delivery["publicationAvailability"], "PENDING")

    def test_other_certificate_source_or_component_is_rejected(self):
        candidate, index = self.candidate()
        envelope, trust = self.signed(index)
        for field in ("source", "component"):
            changed = json.loads(json.dumps(envelope))
            if field == "source":
                changed["certificate"]["sourceSha"] = OTHER
            else:
                changed["certificate"]["components"]["server"]["manifestSha256"] = "0" * 64
            with self.subTest(field=field), self.assertRaises(verifier.VerificationError):
                build.finalize(candidate, build.json_bytes(changed), build.json_bytes(trust), SOURCE,
                               trust["publicKeySha256"])

    def test_wrong_out_of_band_trust_anchor_blocks_finalization(self):
        candidate, index = self.candidate()
        envelope, trust = self.signed(index)
        with self.assertRaisesRegex(verifier.VerificationError, "FINAL_DELIVERY_VERIFICATION_REQUIRED"):
            build.finalize(candidate, build.json_bytes(envelope), build.json_bytes(trust), SOURCE, "0" * 64)

    def test_tampered_final_payload_cannot_be_hidden_by_resealing_local_index(self):
        root, _, _, _ = self.final()
        write(root, "payloads/server/lib/auroraRuntime.js", b"tampered")
        reseal(root)
        result = verifier.verify(root)
        self.assertFalse(result["integrityVerified"])
        self.assertEqual(result["errorCode"], "RUNTIME_FILE_INTEGRITY_CONFLICT")

    def test_missing_payload_is_explicit_pending_and_never_complete(self):
        root, _, _, _ = self.final()
        (root / "payloads/satellite/AURORA-NEXUS-Instalar.exe").unlink()
        reseal(root)
        result = verifier.verify(root)
        self.assertTrue(result["integrityVerified"])
        self.assertFalse(result["allDeclaredPayloadsPresent"])
        self.assertFalse(result["complete"])
        self.assertIn("payloads/satellite/AURORA-NEXUS-Instalar.exe", result["missingPayloads"])

    def test_runtime_manifest_only_is_missing_payload_not_closed_delivery(self):
        root, _, _, _ = self.final()
        for component in ("server", "web"):
            for path in (root / "payloads" / component).rglob("*"):
                if path.is_file():
                    path.unlink()
        reseal(root)
        result = verifier.verify(root)
        self.assertTrue(result["integrityVerified"])
        self.assertFalse(result["allDeclaredPayloadsPresent"])
        self.assertFalse(result["complete"])
        for component in ("server", "web"):
            self.assertIn("payloads/" + component + "/lib/auroraRuntime.js", result["missingPayloads"])

    def test_unsigned_delivery_labels_must_equal_signed_identity_and_all_five_pins(self):
        root, _, _, _ = self.final()
        path = root / "release-envelope.json"
        original = path.read_bytes()
        for field in ("releaseId", "productVersion", "components", "identity"):
            envelope = json.loads(original)
            if field in ("releaseId", "productVersion"):
                envelope[field] = "9.9.9-wrong"
            elif field == "components":
                envelope[field]["iaMaster"]["version"] = "9.9.9"
            else:
                envelope[field]["sourceSha"] = OTHER
            path.write_bytes(build.json_bytes(envelope))
            reseal(root)
            with self.subTest(field=field):
                self.assertEqual(verifier.verify(root)["errorCode"], "DELIVERY_CERTIFICATE_IDENTITY_CONFLICT")
            path.write_bytes(original)
            reseal(root)

    def test_server_web_and_certificate_must_share_product_version(self):
        root, _, _, _ = self.final()
        cert_path = root / "trust/certificate.json"
        certificate = json.loads(cert_path.read_bytes())
        certificate["components"]["web"]["version"] = "9.9.9"
        cert_path.write_bytes(build.json_bytes(certificate))
        envelope_path = root / "release-envelope.json"
        envelope = json.loads(envelope_path.read_bytes())
        envelope["components"] = certificate["components"]
        envelope["certificateSha256"] = build.digest(build.signing_bytes(certificate))
        envelope["identity"]["certificateSha256"] = envelope["certificateSha256"]
        envelope_path.write_bytes(build.json_bytes(envelope))
        reseal(root)
        self.assertEqual(verifier.verify(root)["errorCode"], "DELIVERY_CERTIFICATE_IDENTITY_CONFLICT")

    def test_cli_rejects_unverified_requested_trust_and_invalid_signature(self):
        root, _, _, _ = self.final()
        with mock.patch.object(sys, "argv", ["VERIFY.py", "--directory", str(root),
                                            "--trusted-public-key-sha256", "0" * 64]), redirect_stdout(io.StringIO()):
            self.assertEqual(verifier.main(), 2)
        signed = root / "trust/release-envelope-signed.json"
        envelope = json.loads(signed.read_bytes())
        envelope["signature"] = "A" * 86
        signed.write_bytes(build.json_bytes(envelope))
        reseal(root)
        with mock.patch.object(sys, "argv", ["VERIFY.py", "--directory", str(root)]), redirect_stdout(io.StringIO()):
            self.assertEqual(verifier.main(), 2)
        signed.unlink()
        reseal(root)
        self.assertTrue(verifier.verify(root)["integrityVerified"])
        with mock.patch.object(sys, "argv", ["VERIFY.py", "--directory", str(root),
                                            "--trusted-public-key-sha256", "0" * 64]), redirect_stdout(io.StringIO()):
            self.assertEqual(verifier.main(), 2)

    def test_signature_corruption_and_extra_file_fail_closed(self):
        root, _, _, _ = self.final()
        path = root / "trust/release-envelope-signed.json"
        envelope = json.loads(path.read_bytes())
        envelope["signature"] = "A" * 86
        path.write_bytes(build.json_bytes(envelope))
        reseal(root)
        self.assertFalse(verifier.verify(root)["integrityVerified"])
        write(root, "extra.txt", b"unindexed")
        self.assertEqual(verifier.verify(root)["errorCode"], "FILE_SET_CONFLICT")

    def test_links_and_windows_unsafe_names_fail_without_reading_target(self):
        for name in ("../escape", "/absolute", "C:/drive", "back\\slash", "NUL.txt", "part./file", "a//b"):
            with self.subTest(name=name), self.assertRaises(verifier.VerificationError):
                verifier.safe_name(name)
        link = self.root / "linked"
        try:
            link.symlink_to(self.functions, target_is_directory=True)
        except OSError:
            # Windows link creation may require a privilege; simulate its reparse attribute,
            # and prove rejection happens before any payload read.
            with mock.patch.object(verifier, "linked", return_value=True), mock.patch.object(
                    verifier, "read_regular") as reader:
                result = verifier.verify(self.functions)
                reader.assert_not_called()
                self.assertEqual(result["errorCode"], "UNSAFE_ROOT")
            return
        result = verifier.verify(link)
        self.assertFalse(result["integrityVerified"])
        self.assertEqual(result["errorCode"], "UNSAFE_ROOT")


if __name__ == "__main__":
    unittest.main()
