"""Synthetic public identity tests; no credentials, live GETs, state or ingestion."""
import base64
from contextlib import redirect_stdout
import copy
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import published_release as release
import client_agent as agent
import aurora_deployment as deployment
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

NEXT = 'a' * 40
ORG = 'fixture-org'
NOW = datetime(2026, 10, 13, 12, tzinfo=timezone.utc).timestamp()
TISS_FILES = ('tiss-tool.cjs', 'tiss-browser.cjs', 'tiss-local.js',
              'client-agent/aurora_tiss.py', 'tiss-fixtures/sadt-valid.xml')


def master_package(tiss=False):
    files = {'public-fixture-%02d.cjs' % index: ('synthetic public %d' % index).encode()
             for index in range(34)}
    if tiss:
        files.update({name: ('synthetic public ' + name).encode() for name in TISS_FILES})
    manifest = {'component': 'AURORA_IA_MASTER', 'version': '1.1.0', 'sourceRevision': NEXT,
                'dirty': False, 'externalAiEnabled': False, 'nodeMinimumMajor': 22,
                'files': {name: release.digest(value) for name, value in files.items()}}
    if tiss:
        manifest['tissTool'] = {'id': 'AURORA-TISS-SADT-001', 'version': '1.0.0', 'configured': False,
                                'processing': 'LOCAL_EPHEMERAL', 'realPortalEnabled': False,
                                'submissionEnabled': False}
    return manifest, files


def pair():
    key = Ed25519PrivateKey.generate()
    public = key.public_key()
    return key, {'publicKeySpkiPem': public.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode(),
                 'publicKeySha256': release.digest(public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))}


def envelope(key, hashes=None, schema=2):
    hashes = hashes or {}
    certificate = {'schemaVersion': schema, 'sourceSha': NEXT, 'productVersion': '1.1.0-beta.1',
                   'canonicalOrigin': release.ORIGIN, 'releaseRunId': '13', 'ciRunId': '12',
                   'publishedAtUtc': '2026-10-13T11:00:00.000Z', 'status': 'ACTIVE',
                   'checks': {name: True for name in release.CHECKS},
                   'components': {name: {'version': '1.0.1' if name == 'windowsIntegration' else '1.1.0',
                                         'sourceSha': NEXT, 'manifestSha256': hashes.get(name, 'c' * 64)}
                                  for name in (release.COMPONENTS if schema == 2 else release.COMPONENTS[:3])}}
    return {'certificate': certificate,
            'signature': base64.urlsafe_b64encode(key.sign(release.signing_bytes(certificate))).decode().rstrip('=')}


def response(env, nonce):
    covered = [name for name in release.COMPONENTS if name in env['certificate']['components']]
    complete = env['certificate']['schemaVersion'] == 2
    return {'schemaVersion': 'aurora.active-release-read.v1', 'source': release.SOURCE, 'canonicalOrigin': release.ORIGIN,
            'orgId': ORG, 'requestNonce': nonce, 'observedAtUtc': '2026-10-13T12:00:00.000Z',
            'certificateSha256': release.digest(release.signing_bytes(env['certificate'])), 'envelope': env,
            'runtime': {'sourceSha': NEXT, 'serverManifestSha256': env['certificate']['components']['server']['manifestSha256'],
                        'webManifestSha256': env['certificate']['components']['web']['manifestSha256']},
            'componentCoverage': {'status': 'COMPLETE_SIGNED_COMPONENT_SET' if complete else 'PARTIAL', 'complete': complete,
                                  'requiredComponents': list(release.COMPONENTS), 'coveredComponents': covered,
                                  'missingComponents': [name for name in release.COMPONENTS if name not in covered]},
            'nativeMacInstallation': 'UNVERIFIED', 'deviceInstallationVerified': False}


class NativeResponse:
    def __init__(self, body):
        self.body = body
        self.status = 200
        self.headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def geturl(self):
        return release.READ_URL

    def read(self, limit):
        return json.dumps(self.body).encode()[:limit]


class PublishedReleaseTests(unittest.TestCase):
    def setUp(self):
        self.key, self.trust = pair()
        self.env = envelope(self.key)

    def read(self, mutate=None, env=None):
        requests = []
        def open_request(req, timeout):
            requests.append(req)
            body = response(env or self.env, req.get_header('X-aurora-release-nonce'))
            if mutate:
                mutate(body)
            return NativeResponse(body)
        opener = Mock()
        opener.open.side_effect = open_request
        with patch.object(release.request, 'build_opener', return_value=opener), patch.object(release.time, 'time', return_value=NOW):
            pin = release.read_active_pin('synthetic-process-only', self.trust, NEXT, ORG)
        return pin, requests

    def master_candidate(self, manifest):
        raw = json.dumps(manifest).encode()
        candidate = release.verify_candidate(envelope(self.key, {'iaMaster': release.digest(raw)}), self.trust, NEXT, NOW)
        return candidate, raw

    def test_governance_exact_public_fixture_matches_ed25519_domain(self):
        fixture_path = Path(__file__).parent / 'fixtures/active-release-v2-public-contract.json'
        fixture = json.loads(fixture_path.read_text())
        self.assertTrue(fixture['testOnly'])
        self.assertFalse(fixture['actualRunOrOwnerApproval'])
        # Locate the deliberately public fixture fields without treating it as real trust.
        body = fixture['response']
        trust = {'publicKeySpkiPem': fixture['syntheticPublicKeyPem'], 'publicKeySha256': fixture['syntheticPublicKeySpkiSha256']}
        candidate = release.verify_candidate(body['envelope'], trust, body['runtime']['sourceSha'], NOW)
        self.assertEqual(candidate.certificate_sha256, body['certificateSha256'])
        self.assertEqual(candidate.status, 'CANDIDATE_UNVERIFIED')

    def test_isolated_candidates_and_caller_forged_pins_cannot_activate(self):
        candidate = release.verify_candidate(self.env, self.trust, NEXT, NOW)
        with self.assertRaisesRegex(release.ReleaseError, 'FRESH_CANONICAL'):
            release.require_active(candidate, NOW)
        with self.assertRaisesRegex(release.ReleaseError, 'FRESH_CANONICAL'):
            release.require_active({'complete': True}, NOW)
        copy_cert = candidate.certificate
        copy_cert['sourceSha'] = 'b' * 40
        self.assertEqual(candidate.certificate['sourceSha'], NEXT)

    def test_v1_is_verified_partial_and_rejected_by_active_v2_gate(self):
        pin, _ = self.read(env=envelope(self.key, schema=1))
        with self.assertRaisesRegex(release.ReleaseError, 'FRESH_CANONICAL'):
            release.require_active(pin, NOW)

    def test_exact_checks_trust_source_signature_and_json_duplicates(self):
        invalid = copy.deepcopy(self.env)
        invalid['certificate']['checks']['ownerApproved'] = True
        with self.assertRaisesRegex(release.ReleaseError, 'INVALID_RELEASE_CERTIFICATE'):
            release.verify_candidate(invalid, self.trust, NEXT, NOW)
        for trust, source in [({**self.trust, 'publicKeySha256': 'f' * 64}, NEXT), (self.trust, 'b' * 40)]:
            with self.assertRaises(release.ReleaseError):
                release.verify_candidate(self.env, trust, source, NOW)
        invalid = copy.deepcopy(self.env)
        invalid['signature'] = 'A' * 86
        with self.assertRaisesRegex(release.ReleaseError, 'SIGNATURE'):
            release.verify_candidate(invalid, self.trust, NEXT, NOW)
        with self.assertRaisesRegex(release.ReleaseError, 'DUPLICATE'):
            release.parse(b'{"source":1,"source":2}')

    def test_native_fixed_origin_method_nonce_freshness_and_organization(self):
        pin, requests = self.read()
        self.assertTrue(release.require_active(pin, NOW, ORG).complete_signed_set)
        req = requests[0]
        self.assertEqual(req.full_url, release.READ_URL)
        self.assertEqual(req.method, 'GET')
        self.assertIsNone(req.get_header('Cookie'))
        self.assertRegex(req.get_header('X-aurora-release-nonce'), '^[a-f0-9]{64}$')
        for at, org in [(NOW + 31, ORG), (NOW, 'other-org')]:
            with self.assertRaisesRegex(release.ReleaseError, 'FRESH_CANONICAL'):
                release.require_active(pin, at, org)

    def test_cached_nonce_wrong_org_runtime_extra_fields_and_stale_reads_fail(self):
        mutations = [lambda b: b.update(requestNonce='f' * 64), lambda b: b.update(orgId='other-org'),
                     lambda b: b['runtime'].update(sourceSha='b' * 40), lambda b: b.update(currentPointer=True),
                     lambda b: b.update(observedAtUtc='2026-10-12T12:00:00.000Z')]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(release.ReleaseError):
                self.read(mutate)

    def test_network_errors_are_fixed_and_no_proxy_or_redirect_handlers(self):
        with patch.object(release.request, 'build_opener') as build:
            build.return_value.open.side_effect = OSError('PRIVATE_RESPONSE synthetic bearer never print')
            with self.assertRaisesRegex(release.ReleaseError, '^CANONICAL_RELEASE_READ_FAILED$'):
                release.read_active_pin('synthetic', self.trust, NEXT, ORG)
            handlers = build.call_args.args
            self.assertEqual(handlers[0].proxies, {})
            self.assertIsNone(handlers[1].redirect_request(None, None, 302, None, {}, 'https://other.example'))
            self.assertGreaterEqual(handlers[2]._context.minimum_version, release.ssl.TLSVersion.TLSv1_2)

    def test_seven_file_package_requires_exact_signed_raw_manifest_and_byte_closure(self):
        files = {name: ('synthetic public ' + name).encode() for name in release.WINDOWS_FILES}
        manifest = {'component': 'AURORA_WINDOWS_INTEGRATION', 'version': '1.0.1', 'sourceSha': NEXT,
                    'files': {name: release.digest(value) for name, value in files.items()}}
        raw = json.dumps(manifest).encode()
        candidate = release.verify_candidate(envelope(self.key, {'windowsIntegration': release.digest(raw)}), self.trust, NEXT, NOW)
        self.assertFalse(release.assess_manifest(candidate, 'windowsIntegration', raw, files)['installed'])
        for changed in [{**files, 'extra.txt': b'public'}, {**files, 'client_agent.py': b'changed'}]:
            with self.assertRaises(release.ReleaseError):
                release.assess_manifest(candidate, 'windowsIntegration', raw, changed)
        with self.assertRaisesRegex(release.ReleaseError, 'SIGNED_MANIFEST'):
            release.assess_manifest(candidate, 'windowsIntegration', raw + b' ', files)

    def test_legacy_34_and_tiss_39_signed_master_packages_are_candidates_only(self):
        for tiss, count in ((False, 34), (True, 39)):
            with self.subTest(tiss=tiss):
                manifest, files = master_package(tiss)
                self.assertEqual(len(files), count)
                candidate, raw = self.master_candidate(manifest)
                result = release.assess_manifest(candidate, 'iaMaster', raw, files)
                self.assertEqual(result['status'], 'SIGNED_COMPONENT_BYTES_VERIFIED')
                self.assertEqual(result['sourceSha'], NEXT)
                self.assertEqual(result['manifestSha256'], release.digest(raw))
                self.assertEqual(result['version'], '1.1.0')
                for field in ('currentPointerVerified', 'installed', 'allClientsSynchronized'):
                    self.assertIs(result[field], False)
                with self.assertRaisesRegex(release.ReleaseError, '^FRESH_CANONICAL_V2_PIN_REQUIRED$'):
                    release.require_active(candidate, NOW, ORG)

    def test_xsd_45_signed_closure_requires_all_schemas_and_fixed_capabilities(self):
        manifest, files = master_package(True)
        for name in release.TISS_XSD_FILES:
            files[name] = ('synthetic schema ' + name).encode()
            manifest['files'][name] = release.digest(files[name])
        manifest['tissTool']['version'] = '1.0.1'
        candidate, raw = self.master_candidate(manifest)
        result = release.assess_manifest(candidate, 'iaMaster', raw, files)
        self.assertEqual(result['status'], 'SIGNED_COMPONENT_BYTES_VERIFIED')
        self.assertFalse(result['installed'])
        for missing in release.TISS_XSD_FILES:
            changed = copy.deepcopy(manifest)
            changed['files']['unrelated.txt'] = changed['files'].pop(missing)
            self.assertFalse(release.ia_master_manifest_shape(changed))
        for key, value in [('version', '1.0.0'), ('realPortalEnabled', True), ('submissionEnabled', True)]:
            changed = copy.deepcopy(manifest)
            changed['tissTool'][key] = value
            self.assertFalse(release.ia_master_manifest_shape(changed))
        changed_files = dict(files)
        changed_files[next(iter(release.TISS_XSD_FILES))] = b'tampered schema'
        with self.assertRaises(release.ReleaseError):
            release.assess_manifest(candidate, 'iaMaster', raw, changed_files)

    def test_tiss_master_requires_signed_exact_manifest_and_file_bytes(self):
        manifest, files = master_package(True)
        candidate, raw = self.master_candidate(manifest)
        for changed in (raw + b' ', raw.replace(b'LOCAL_EPHEMERAL', b'REMOTE_PROCESSING')):
            with self.subTest(changed=changed[-20:]), self.assertRaisesRegex(release.ReleaseError, '^SIGNED_MANIFEST_BYTES_CONFLICT$'):
                release.assess_manifest(candidate, 'iaMaster', changed, files)
        changed_envelope = envelope(self.key, {'iaMaster': release.digest(raw)})
        changed_envelope['certificate']['components']['iaMaster']['manifestSha256'] = 'd' * 64
        with self.assertRaisesRegex(release.ReleaseError, '^RELEASE_SIGNATURE_REJECTED$'):
            release.verify_candidate(changed_envelope, self.trust, NEXT, NOW)
        for name in TISS_FILES:
            with self.subTest(name=name):
                with self.assertRaisesRegex(release.ReleaseError, '^PACKAGE_CLOSURE_CONFLICT$'):
                    release.assess_manifest(candidate, 'iaMaster', raw, {key: value for key, value in files.items() if key != name})
                with self.assertRaisesRegex(release.ReleaseError, '^PACKAGE_FILE_BYTES_CONFLICT$'):
                    release.assess_manifest(candidate, 'iaMaster', raw, {**files, name: b'changed public bytes'})

    def test_signed_tiss_master_cannot_replace_required_files_at_same_count(self):
        for name in TISS_FILES:
            with self.subTest(name=name):
                manifest, files = master_package(True)
                files['replacement.cjs'] = files.pop(name)
                manifest['files']['replacement.cjs'] = manifest['files'].pop(name)
                self.assertEqual(len(files), 39)
                candidate, raw = self.master_candidate(manifest)
                with self.assertRaisesRegex(release.ReleaseError, '^PACKAGE_CLOSURE_CONFLICT$'):
                    release.assess_manifest(candidate, 'iaMaster', raw, files)

    def test_signed_tiss_metadata_requires_exact_fields_values_and_boolean_types(self):
        original, files = master_package(True)
        changes = [('id', 'OTHER-TOOL'), ('version', '1.0.1'), ('processing', 'REMOTE'),
                   ('configured', True), ('realPortalEnabled', True), ('submissionEnabled', True),
                   ('configured', 0), ('realPortalEnabled', 0), ('submissionEnabled', 0),
                   ('configured', 1), ('realPortalEnabled', 1), ('submissionEnabled', 1),
                   ('configured', None), ('extra', False)]
        variants = []
        for field, value in changes:
            manifest = copy.deepcopy(original)
            manifest['tissTool'][field] = value
            variants.append((field + '=' + repr(value), manifest))
        for field in original['tissTool']:
            manifest = copy.deepcopy(original)
            del manifest['tissTool'][field]
            variants.append(('missing ' + field, manifest))
        for value in (None, [], 'AURORA-TISS-SADT-001'):
            variants.append(('wrong object ' + repr(value), {**original, 'tissTool': value}))
        variants.append(('missing object', {key: value for key, value in original.items() if key != 'tissTool'}))
        for label, manifest in variants:
            with self.subTest(variant=label):
                candidate, raw = self.master_candidate(manifest)
                with self.assertRaisesRegex(release.ReleaseError, '^PACKAGE_CLOSURE_CONFLICT$'):
                    release.assess_manifest(candidate, 'iaMaster', raw, files)

    def test_legacy_master_rejects_tiss_metadata_and_partial_tiss_files(self):
        for value in (None, {}, master_package(True)[0]['tissTool']):
            manifest, files = master_package()
            manifest['tissTool'] = value
            candidate, raw = self.master_candidate(manifest)
            with self.subTest(metadata=value), self.assertRaisesRegex(release.ReleaseError, '^PACKAGE_CLOSURE_CONFLICT$'):
                release.assess_manifest(candidate, 'iaMaster', raw, files)
        for name in TISS_FILES + tuple(name.upper() for name in TISS_FILES):
            with self.subTest(file=name):
                manifest, files = master_package()
                files[name] = files.pop('public-fixture-00.cjs')
                manifest['files'][name] = manifest['files'].pop('public-fixture-00.cjs')
                self.assertEqual(len(files), 34)
                candidate, raw = self.master_candidate(manifest)
                with self.assertRaisesRegex(release.ReleaseError, '^PACKAGE_CLOSURE_CONFLICT$'):
                    release.assess_manifest(candidate, 'iaMaster', raw, files)

    def test_master_package_identity_and_lineage_remain_required_for_both_compositions(self):
        for tiss in (False, True):
            for field, value in (('component', 'OTHER_COMPONENT'), ('sourceRevision', 'b' * 40),
                                 ('version', '9.0.0'), ('dirty', True), ('externalAiEnabled', True),
                                 ('nodeMinimumMajor', 21)):
                with self.subTest(tiss=tiss, field=field):
                    manifest, files = master_package(tiss)
                    manifest[field] = value
                    candidate, raw = self.master_candidate(manifest)
                    with self.assertRaisesRegex(release.ReleaseError, '^PACKAGE_IDENTITY_CONFLICT$'):
                        release.assess_manifest(candidate, 'iaMaster', raw, files)

    def test_master_composition_helper_rejects_invalid_and_case_ambiguous_names(self):
        for manifest in (None, [], {}, {'files': []}, {'files': {1: 'c' * 64}}):
            with self.subTest(manifest=manifest):
                self.assertIs(release.ia_master_manifest_shape(manifest), False)
        manifest, _ = master_package(True)
        manifest['files']['TISS-TOOL.CJS'] = manifest['files'].pop('public-fixture-00.cjs')
        self.assertIs(release.ia_master_manifest_shape(manifest), False)

    def test_preflight_defaults_readonly_and_missing_credential_does_not_authenticate(self):
        control = {'trust': self.trust, 'expectedSourceSha': NEXT, 'manifestPath': str(Path.cwd() / 'windowsIntegration-manifest.json')}
        with patch.object(release, 'read_active_pin') as read, patch.object(release, '_public_bytes') as files:
            self.assertEqual(release.release_status(control, ORG)['status'], 'PENDING_CANONICAL_READ_REQUIRED')
            self.assertEqual(release.release_status(control, ORG, read_active=True)['status'], 'PENDING_PROCESS_CREDENTIAL')
            read.assert_not_called()
            files.assert_not_called()

    def test_shared_preflight_verifies_actual_public_seven_files_after_native_pin(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'windowsIntegration-manifest.json'
            files = {name: (Path(release.__file__).parent / name).read_bytes() for name in release.WINDOWS_FILES}
            raw = json.dumps({'component': 'AURORA_WINDOWS_INTEGRATION', 'version': '1.0.1', 'sourceSha': NEXT,
                              'files': {name: release.digest(value) for name, value in files.items()}}).encode()
            path.write_bytes(raw)
            env = envelope(self.key, {'windowsIntegration': release.digest(raw)})
            pin, _ = self.read(env=env)
            control = {'trust': self.trust, 'expectedSourceSha': NEXT, 'manifestPath': str(path)}
            with patch.object(release, 'read_active_pin', return_value=pin), patch.object(release.time, 'time', return_value=NOW):
                result = release.release_status(control, ORG, 'synthetic', True)
            self.assertTrue(result['currentPointerVerified'], result)
            self.assertTrue(result['localComponentBytesVerified'])
            self.assertFalse(result['activated'])
            self.assertFalse(result['ingestTargetChanged'])

    def test_public_package_read_preserves_crlf_and_ctrl_z_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'synthetic-public-bytes.bin'
            raw=b'A\r\nB\x1aC';path.write_bytes(raw)
            self.assertEqual(release._public_bytes(path,64),raw)


class ExistingEntryPointTests(unittest.TestCase):
    def config(self, base):
        root = base / 'public-exports'
        root.mkdir()
        key, trust = pair()
        return {'schemaVersion': agent.SCHEMA, 'instanceId': 'a' * 32, 'org': ORG,
                'origin': 'https://aurora-nexus-authgate-95hc95q9.uc.gateway.dev',
                'stateDir': str(base / 'state'), 'roots': [str(root)], 'providers': [],
                'tokenEnv': 'AURORA_INTEGRATION_TOKEN',
                'authorization': {'approved': True, 'actorRef': 'synthetic-admin', 'documentRef': 'synthetic-approval', 'expiresAt': '2099-01-01T00:00:00Z'},
                'releaseControl': {'trust': trust, 'expectedSourceSha': NEXT,
                                   'manifestPath': str(base / 'windowsIntegration-manifest.json')}}

    def test_client_cli_release_status_has_no_state_source_provider_or_network_by_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            config = self.config(base)
            path = base / 'agent-config.json'
            path.write_text(json.dumps(config))
            with patch.object(release, 'read_active_pin') as network, patch.object(agent, 'local_documents') as documents, redirect_stdout(io.StringIO()) as output:
                self.assertEqual(agent.main(['--config', str(path), '--release-status']), 2)
                network.assert_not_called()
                documents.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())['status'], 'PENDING_CANONICAL_READ_REQUIRED')
            self.assertFalse(Path(config['stateDir']).exists())

    def test_configured_existing_cycle_blocks_before_transport_sources_and_providers(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = self.config(Path(temporary))
            config['providers'] = [{'provider': 'GOOGLE_DRIVE', 'folderId': 'explicit-folder', 'tokenEnv': 'AURORA_PROVIDER_TOKEN'}]
            transport, provider = Mock(), Mock()
            with patch.object(release, 'read_active_pin', side_effect=release.ReleaseError('CANONICAL_RELEASE_READ_FAILED')) as read, patch.object(agent, 'local_documents') as documents, patch.object(agent, 'load_secret') as vault:
                result = agent.cycle(config, {'AURORA_INTEGRATION_TOKEN': 'synthetic'}, transport, provider)
            self.assertEqual(result['state'], 'PENDING_PUBLISHED_RELEASE')
            self.assertFalse(result['connectionVerified'])
            read.assert_called_once()
            transport.assert_not_called()
            provider.assert_not_called()
            documents.assert_not_called()
            vault.assert_not_called()
            self.assertFalse(Path(config['stateDir']).exists())

    def test_adapter_release_plan_without_sample_checkpoint_or_bearer(self):
        with patch.object(release, 'read_active_pin') as network, patch.object(deployment, 'run') as run, redirect_stdout(io.StringIO()) as output:
            result = deployment.main(['--release-plan', '--org', ORG])
        self.assertEqual(result, 2)
        self.assertEqual(json.loads(output.getvalue())['status'], 'PENDING_PUBLIC_RELEASE_CONFIGURATION')
        network.assert_not_called()
        run.assert_not_called()

    def test_read_active_requires_separate_explicit_cli_mode(self):
        with redirect_stdout(io.StringIO()) as output:
            self.assertEqual(deployment.main(['--org', ORG, '--read-active']), 2)
        self.assertEqual(json.loads(output.getvalue())['code'], 'EXPLICIT_RELEASE_PLAN_REQUIRED')

    def test_adapter_configured_send_cannot_touch_sample_if_published_gate_pending(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = self.config(Path(temporary))
            path = Path(temporary) / 'release-public-config.json'
            path.write_text(json.dumps(config['releaseControl']))
            with patch.object(release, 'release_status', return_value={'status': 'PENDING_V2_COMPONENT_COVERAGE', 'currentPointerVerified': False}) as preflight, patch.object(deployment, 'run') as run, redirect_stdout(io.StringIO()):
                result = deployment.main(['--org', ORG, '--release-config', str(path), '--send', '--input', 'private-path-must-not-read',
                                          '--origin', config['origin'], '--state-dir', config['stateDir']])
            self.assertEqual(result, 2)
            run.assert_not_called()
            self.assertTrue(preflight.call_args.args[3])
            self.assertEqual(config['origin'], 'https://aurora-nexus-authgate-95hc95q9.uc.gateway.dev')


if __name__ == '__main__':
    unittest.main()
