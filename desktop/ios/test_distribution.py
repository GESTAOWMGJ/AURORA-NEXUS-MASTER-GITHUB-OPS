import copy
import datetime as dt
import hashlib
import json
import os
import plistlib
import struct
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
import zlib
from pathlib import Path
from unittest.mock import patch

import configure
import distribution
import test_configure as fixtures


def png(kind=2, width=1024, alpha=False):
    def chunk(name, body):
        return struct.pack('>I', len(body)) + name + body + struct.pack('>I', zlib.crc32(name + body) & 0xffffffff)
    header = struct.pack('>IIBBBBB', width, 1024, 8, kind, 0, 0, 0)
    raw = (b'\0' + b'\x10\x30\x40' * width) * 1024
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + (chunk(b'tRNS', b'\0' * 6) if alpha else b'')
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class DistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.icon = png()

    def setUp(self):
        self.fixture = fixtures.IOSConfigurationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.repo, self.ios = self.fixture.repo, self.fixture.ios
        self.sha = configure.identity(self.repo, None, True)['sourceSha']
        self.identity = {
            'schemaVersion': 'aurora.ios.distribution.v1', 'bundleIdentifier': 'br.com.synthetic.aurora',
            'teamId': 'ABCDEFGHIJ', 'appIdPrefix': 'KLMNOPQRST', 'appStoreAppId': '1234567890',
            'profileUuid': '01234567-89AB-CDEF-0123-456789ABCDEF',
            'distributionCertificateSha256': hashlib.sha256(b'synthetic certificate').hexdigest(),
            'approvedIconSha256': hashlib.sha256(self.icon).hexdigest(),
            'exportComplianceReviewed': True, 'usesNonExemptEncryption': False,
        }
        self.profile = {
            'UUID': self.identity['profileUuid'], 'TeamIdentifier': ['ABCDEFGHIJ'],
            'ApplicationIdentifierPrefix': ['KLMNOPQRST'], 'Platform': ['iOS'],
            'ExpirationDate': dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=10),
            'DeveloperCertificates': [b'synthetic certificate'],
            'Entitlements': {'application-identifier': 'KLMNOPQRST.br.com.synthetic.aurora',
                             'com.apple.developer.team-identifier': 'ABCDEFGHIJ',
                             'get-task-allow': False, 'beta-reports-active': True},
        }

    def prepare(self, sha=None, number='42'):
        return distribution.prepare(self.repo, self.ios, self.identity, self.icon, self.profile, sha or self.sha, number)

    def test_unconfigured_identity_is_blocked(self):
        value = {key: None for key in distribution.FIELDS}
        value["schemaVersion"] = "aurora.ios.distribution.v1"
        with self.assertRaises(ValueError):
            distribution.validate_identity(value)

    def test_identity_is_closed_and_cannot_embed_secrets(self):
        for field in ['privateKey', 'p12', 'password', 'token']:
            value = dict(self.identity, **{field: 'synthetic'})
            with self.subTest(field=field), self.assertRaises(ValueError):
                distribution.validate_identity(value)

    def test_identity_rejects_injection_missing_values_and_synthetic_bundles(self):
        for key, value in [('teamId', 'TEAM";BAD=YES'), ('profileUuid', '../profile'),
                           ('bundleIdentifier', 'local.auroranexus.ios.unsigned'),
                           ('bundleIdentifier', 'com.example.aurora'), ('appStoreAppId', None),
                           ('distributionCertificateSha256', 'a' * 40), ('exportComplianceReviewed', 1),
                           ('usesNonExemptEncryption', 0)]:
            identity = dict(self.identity, **{key: value})
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                distribution.validate_identity(identity)

    def test_distinct_legacy_app_prefix_is_not_assumed_equal_to_team(self):
        distribution.validate_profile(self.profile, self.identity)

    def test_rejects_development_adhoc_enterprise_expired_and_wrong_identity_profiles(self):
        changes = [('ProvisionedDevices', ['synthetic-device']), ('ProvisionsAllDevices', True),
                   ('TeamIdentifier', ['OTHERTEAM0']), ('UUID', 'wrong'), ('Platform', ['OSX']),
                   ('ApplicationIdentifierPrefix', ['ABCDEFGHIJ']),
                   ('ExpirationDate', dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)),
                   ('DeveloperCertificates', [b'different certificate'])]
        for key, value in changes:
            profile = copy.deepcopy(self.profile); profile[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                distribution.validate_profile(profile, self.identity)

    def test_rejects_debug_wildcard_or_added_capabilities(self):
        for key, value in [('get-task-allow', True), ('get-task-allow', 0),
                           ('beta-reports-active', False), ('application-identifier', 'KLMNOPQRST.*'),
                           ('aps-environment', 'production')]:
            profile = copy.deepcopy(self.profile); profile['Entitlements'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                distribution.validate_profile(profile, self.identity)

    def test_complete_approved_rgb_icon_validates(self):
        distribution.validate_icon(self.icon, self.identity['approvedIconSha256'])

    def test_icon_rejects_transparency_wrong_size_corruption_and_changed_hash(self):
        for icon in [png(alpha=True), png(width=512), png(kind=6), self.icon[:-1], self.icon + b'trailing']:
            with self.subTest(size=len(icon)), self.assertRaises(ValueError):
                distribution.validate_icon(icon, hashlib.sha256(icon).hexdigest())
        with self.assertRaises(ValueError):
            distribution.validate_icon(self.icon, '0' * 64)

    def test_exact_sha_required_before_any_generated_output(self):
        with self.assertRaises(ValueError):
            self.prepare(sha='b' * 40)
        self.assertFalse((self.ios / 'Generated').exists())

    def test_dirty_sources_block_distribution(self):
        (self.ios / 'unreviewed.py').write_text('pass', encoding='utf-8')
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse((self.ios / 'Generated').exists())

    def test_release_only_signing_and_archive_app_not_ui_tests(self):
        receipt = self.prepare()
        root = self.ios / 'Generated'
        project = (root / 'AuroraNexus.xcodeproj/project.pbxproj').read_text(encoding='utf-8')
        self.assertEqual(project.count('CODE_SIGNING_ALLOWED = YES'), 1)
        self.assertEqual(project.count('CODE_SIGNING_ALLOWED = NO'), 5)
        self.assertEqual(project.count('DEVELOPMENT_TEAM ='), 1)
        self.assertIn('ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon', project)
        self.assertIn('INFOPLIST_FILE = DistributionInfo.plist', project)
        entries = ET.parse(root / 'AuroraNexus.xcodeproj/xcshareddata/xcschemes/AuroraNexus.xcscheme').findall('./BuildAction/BuildActionEntries/BuildActionEntry')
        self.assertEqual([entry.get('buildForArchiving') for entry in entries], ['YES', 'NO'])
        self.assertEqual(receipt['state'], 'PREPARED_NOT_SIGNED')
        self.assertFalse(receipt['testFlightVerified'])
        self.assertFalse(receipt['appStorePublished'])

    def test_export_is_manual_offline_and_does_not_renumber(self):
        self.prepare()
        value = plistlib.loads((self.ios / 'Generated/ExportOptions.plist').read_bytes())
        self.assertEqual(value['method'], 'app-store-connect')
        self.assertEqual(value['destination'], 'export')
        self.assertEqual(value['signingStyle'], 'manual')
        self.assertFalse(value['manageAppVersionAndBuildNumber'])
        self.assertEqual(value['provisioningProfiles'], {self.identity['bundleIdentifier']: self.identity['profileUuid']})

    def test_generated_info_preserves_identity_security_and_ipad_support(self):
        self.prepare()
        value = plistlib.loads((self.ios / 'Generated/DistributionInfo.plist').read_bytes())
        self.assertEqual(value['CFBundleDisplayName'], 'AURORA NEXUS')
        self.assertNotIn('NSAppTransportSecurity', value)
        self.assertFalse(value['ITSAppUsesNonExemptEncryption'])
        self.assertEqual(len(value['UISupportedInterfaceOrientations~ipad']), 4)
        self.assertFalse(any('UsageDescription' in key for key in value))

    def test_signing_request_is_not_signature_or_ed25519_release_certificate(self):
        self.prepare()
        value = json.loads((self.ios / 'Generated/BuildProvenance.json').read_text(encoding='utf-8'))
        self.assertEqual(value['signingStatus'], 'APPLE_SIGNING_REQUESTED')
        self.assertEqual(value['distribution'], 'APP_STORE_CANDIDATE')
        self.assertIsNone(value['certificateSha256'])
        self.assertFalse(value['nativeAcceptanceVerified'])
        self.assertEqual(len(value), 10)

    def test_build_number_validates_before_writes(self):
        for number in ['0', '10000', '-1', '1;UPLOAD=YES']:
            with self.subTest(number=number), self.assertRaises(ValueError):
                self.prepare(number=number)
        self.assertFalse((self.ios / 'Generated').exists())

    def test_output_hardlink_is_not_overwritten(self):
        root = self.ios / 'Generated'; root.mkdir()
        original = root / 'original'; original.write_bytes(b'preserve')
        os.link(original, root / 'linked')
        with self.assertRaises(ValueError):
            distribution.write_generated(root, 'linked', b'changed')
        self.assertEqual(original.read_bytes(), b'preserve')

    def test_ipa_rejects_path_traversal_and_duplicate_members(self):
        for paths in [['../escape'], ['/absolute'], ['Payload\\evil'], ['Payload/a', 'Payload/./a']]:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory); ipa = root / 'candidate.ipa'
                with zipfile.ZipFile(ipa, 'w') as archive:
                    for name in paths: archive.writestr(name, b'synthetic')
                with self.subTest(paths=paths), self.assertRaises(ValueError):
                    distribution.extract_ipa(ipa, root / 'unpacked')

    def test_toolchain_is_not_inferred_from_windows_or_old_xcode(self):
        with patch.object(distribution.sys, 'platform', 'win32'), self.assertRaises(ValueError):
            distribution.check_toolchain()
        with patch.object(distribution.sys, 'platform', 'darwin'), patch.object(distribution, 'run', side_effect=[b'Xcode 16.4\n', b'18.5']), self.assertRaises(ValueError):
            distribution.check_toolchain()
        with patch.object(distribution.sys, 'platform', 'darwin'), patch.object(distribution, 'run', side_effect=[b'Xcode 26.0\n', b'26.0']):
            distribution.check_toolchain()

    def test_metadata_is_draft_and_does_not_invent_store_links(self):
        value = json.loads((Path(__file__).parent / 'AppStore/metadata.pt-BR.json').read_text(encoding='utf-8'))
        self.assertEqual(value['status'], 'DRAFT_NOT_SUBMITTED')
        self.assertLessEqual(len(value['name']), 30)
        self.assertLessEqual(len(value['subtitle']), 30)
        self.assertLessEqual(len(value['keywords']), 100)
        self.assertLessEqual(len(value['description']), 4000)
        self.assertIsNone(value['appStoreURL'])
        self.assertIsNone(value['testFlightURL'])



class SignedExportVerificationTests(DistributionTests):
    # Inherit setup, not all parent cases (loader below confines the extra suite).
    def mocked_export(self, change=None, wrong_certificate=False, command_failure=False):
        prepared = self.prepare()
        generated = self.ios / 'Generated'
        bundle = self.ios / 'fixture-export/Payload/AuroraNexus.app'
        bundle.mkdir(parents=True)
        info = plistlib.loads((generated / 'DistributionInfo.plist').read_bytes())
        info.update(CFBundleIdentifier=self.identity['bundleIdentifier'], CFBundleVersion='42',
                    CFBundleShortVersionString='2.3.4', CFBundleSupportedPlatforms=['iPhoneOS'])
        provenance = json.loads((generated / 'BuildProvenance.json').read_text(encoding='utf-8'))
        entitlements = copy.deepcopy(self.profile['Entitlements'])
        if change: change(info, provenance, entitlements)
        (bundle / 'Info.plist').write_bytes(plistlib.dumps(info))
        (bundle / 'BuildProvenance.json').write_text(json.dumps(provenance), encoding='utf-8')
        (bundle / 'embedded.mobileprovision').write_bytes(b'synthetic-not-an-Apple-profile')
        ipa = self.ios / 'fixture.ipa'
        with zipfile.ZipFile(ipa, 'w') as archive:
            for file in bundle.iterdir(): archive.write(file, 'Payload/AuroraNexus.app/' + file.name)
        commands = []
        def mocked_run(command):
            commands.append(command)
            if command_failure: raise RuntimeError('Synthetic codesign failure')
            if '--extract-certificates' in command:
                Path(command[3] + '0').write_bytes(b'wrong certificate' if wrong_certificate else b'synthetic certificate')
            if '--entitlements' in command: return plistlib.dumps(entitlements)
            return b''
        with patch.object(distribution, 'run', side_effect=mocked_run), patch.object(distribution, 'decode_profile', return_value=self.profile):
            receipt = distribution.verify_ipa(ipa, prepared)
        return receipt, commands

    def test_mocked_signed_export_is_not_an_apple_upload_receipt(self):
        receipt, commands = self.mocked_export()
        self.assertEqual(receipt['state'], 'SIGNED_IPA_VERIFIED_LOCALLY')
        self.assertFalse(receipt['testFlightVerified'])
        self.assertFalse(receipt['appStorePublished'])
        self.assertTrue(any(command[:2] == ['codesign', '--verify'] for command in commands))
        self.assertTrue(any('codeSign' in command for command in commands))

    def test_simulator_or_forged_provenance_is_rejected(self):
        with self.assertRaises(ValueError):
            self.mocked_export(lambda info, source, ent: info.update(CFBundleSupportedPlatforms=['iPhoneSimulator']))

    def test_ipa_cannot_claim_native_acceptance(self):
        with self.assertRaises(ValueError):
            self.mocked_export(lambda info, source, ent: source.update(nativeAcceptanceVerified=True))

    def test_wrong_signer_is_rejected(self):
        with self.assertRaises(ValueError): self.mocked_export(wrong_certificate=True)

    def test_shared_keychain_group_is_rejected(self):
        with self.assertRaises(ValueError):
            self.mocked_export(lambda info, source, ent: ent.update({'keychain-access-groups': ['KLMNOPQRST.*']}))

    def test_codesign_failure_cannot_produce_success(self):
        with self.assertRaises(RuntimeError): self.mocked_export(command_failure=True)


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite([loader.loadTestsFromTestCase(DistributionTests)])
    suite.addTests(SignedExportVerificationTests(name) for name in SignedExportVerificationTests.__dict__ if name.startswith('test_'))
    return suite

if __name__ == '__main__':
    unittest.main()
