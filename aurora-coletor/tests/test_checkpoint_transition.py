"""Synthetic native-reader cryptographic and crash/CAS checkpoint regressions.

Only temporary fixture paths and a generated test key are used. The native
release reader is exercised through its HTTPS opener seam; no real endpoint,
credential, installation, process, device or owner approval is involved.
"""
import base64
import builtins
from contextlib import redirect_stdout
import copy
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import aurora_deployment as deployment
import aurora_cloud_sync as sync
import published_release as release
from test_cloud_sync import fixture, ORG
from test_installation_integration import CanonicalTransport, accepted_response
from test_published_release import pair, envelope, response, NativeResponse, NOW, NEXT


class InterruptedPublication(BaseException):
    pass


class TransitionTransport(CanonicalTransport):
    def __init__(self, clock, **kwargs):
        super().__init__(**kwargs)
        self.clock, self.readbacks, self.on_readback = clock, [], None
        self.key_id = 'ik_' + 'a' * 16

    def current(self, payload, key, duplicate):
        result = accepted_response(payload, duplicate, self.configured)
        acceptance = result['installation']['acceptance']
        acceptance['receiptId'] = sync.digest('integration-document:' + self.key_id + ':' + key)
        acceptance['verifiedAt'] = datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        return result

    def __call__(self, url, token, payload=None, key=None):
        if '/api/integration/ping?documentId=' in url:
            self.readbacks.append(url)
            raw, idem = self.posts[-1]
            body = {'ok': True, 'orgId': ORG, 'keyId': self.key_id,
                    'installation': self.current(raw, idem, True)['installation']}
            if self.on_readback:
                self.on_readback(body, len(self.readbacks))
            return 200, body
        status, result = super().__call__(url, token, payload, key)
        if payload is not None:
            result = self.current(payload, key, status == 200)
        return status, result


class CheckpointTransitionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.state, self.package, self.runtime = (self.base / name for name in ('state', 'package', 'runtime'))
        for directory in (self.state, self.package, self.runtime):
            directory.mkdir(mode=0o700)
        self.raw, self.now = fixture(), NOW
        self.active = self.state / deployment.STATE_NAME
        deployment.run(self.raw, 'https://synthetic-hml.example.invalid', ORG, self.state)
        self.previous = self.active.read_bytes()
        self.ia_state = self.state / 'ia-master'
        self.ia_state.mkdir()
        (self.ia_state / 'control.key').write_bytes(b'synthetic-identity-only\n')
        (self.ia_state / 'organization.txt').write_text(ORG + '\n')
        self.ia_package = self.runtime / 'components' / 'ia-master' / '1.0.1'
        self.ia_package.mkdir(parents=True)
        self.attempt = self.runtime / 'installation-rollbacks' / 'published-11111111-2222-3333-4444-555555555555'
        self.attempt.mkdir(parents=True)
        self.key, self.trust = pair()
        win_files = {name: ('# synthetic signed fixture ' + name + '\n').encode() for name in deployment.ASSETS}
        for name, data in win_files.items():
            (self.package / name).write_bytes(data)
        self.win_manifest = {'component': 'AURORA_WINDOWS_INTEGRATION', 'version': '1.0.7', 'sourceSha': NEXT,
                             'files': {name: release.digest(data) for name, data in win_files.items()}}
        self.manifest_path = self.base / 'windowsIntegration-manifest.json'
        self.manifest_path.write_bytes(deployment._transition_encoded(self.win_manifest))
        ia_files = {f'fixture{index}.cjs': f'// synthetic signed file {index}\n'.encode() for index in range(34)}
        for name, data in ia_files.items():
            (self.ia_package / name).write_bytes(data)
        self.ia_manifest = {'component': 'AURORA_IA_MASTER', 'version': '1.1.0', 'sourceRevision': NEXT,
                            'dirty': False, 'externalAiEnabled': False, 'nodeMinimumMajor': 22,
                            'files': {name: release.digest(data) for name, data in ia_files.items()}}
        ia_bytes = deployment._transition_encoded(self.ia_manifest)
        (self.ia_package / 'manifest.json').write_bytes(ia_bytes)
        self.env = envelope(self.key, {'windowsIntegration': release.digest(self.manifest_path.read_bytes()),
                                       'iaMaster': release.digest(ia_bytes)})
        self.env['certificate']['components']['windowsIntegration']['version'] = '1.0.7'
        self.resign(self.env)
        self.cert_sha = release.digest(release.signing_bytes(self.env['certificate']))
        metadata = {'version': '1.1.0', 'sourceRevision': NEXT, 'organization': ORG,
                    'rollbackPath': str(self.attempt), 'publishedCertificateSha256': self.cert_sha,
                    'signedComponentManifestSha256': release.digest(ia_bytes), 'binding': '127.0.0.1',
                    'externalAiEnabled': False, 'existingClientPreserved': True}
        (self.ia_state / 'installation.json').write_bytes(deployment._transition_encoded(metadata))
        tree = {name: release.digest(data) for name, data in {**ia_files, 'manifest.json': ia_bytes}.items()}
        self.journal = {'schemaVersion': 'aurora.published.activation.v2', 'phase': 'COMPLETED',
                        'id': self.attempt.name.removeprefix('published-'), 'stateDir': str(self.ia_state),
                        'packageDir': str(self.ia_package), 'helperPath': str(self.runtime / 'server-location-manager.cjs'),
                        'sourceSha': NEXT, 'certificateSha256': self.cert_sha,
                        'trustedPublicKeySha256': self.trust['publicKeySha256'], 'acceptedEnvelope': self.env,
                        'manifestSha256': release.digest(ia_bytes),
                        'nextTreeSha256': release.digest(release.canonical(tree).encode()),
                        'nextMetadataSha256': release.digest((self.ia_state / 'installation.json').read_bytes()),
                        'identity': {'control': release.digest((self.ia_state / 'control.key').read_bytes()),
                                     'organization': release.digest((self.ia_state / 'organization.txt').read_bytes()),
                                     'checkpoint': release.digest(self.previous)},
                        'runtimeProof': {'localProcessesVerified': True, 'modelAvailable': True,
                                         'sourceSha': NEXT, 'manifestSha256': release.digest(ia_bytes)}}
        self.journal_path = self.attempt / 'journal.json'
        self.journal_path.write_bytes(deployment._transition_encoded(self.journal))
        old, preview = json.loads(self.previous), sync.synchronize(self.raw, release.ORIGIN, ORG)
        self.plan = {'schemaVersion': deployment.TRANSITION_SCHEMA, 'stateDirectory': str(self.state),
                     'packageDirectory': str(self.package), 'expectedPreviousSha256': release.digest(self.previous),
                     'expectedPreviousTargetBinding': old['targetBinding'], 'expectedPreviousSampleKey': old['sampleKey'],
                     'nextOrigin': release.ORIGIN, 'nextTargetBinding': sync.digest(release.ORIGIN + ':' + ORG),
                     'nextSampleKey': preview['idempotencyKey'], 'payloadSha256': preview['payloadSha256'],
                     'method': 'API_TOKEN', 'orgId': ORG, 'expectedSourceSha': NEXT,
                     'expectedCertificateSha256': self.cert_sha,
                     'iaAnchor': {'attemptDirectory': str(self.attempt), 'journalSha256': release.digest(self.journal_path.read_bytes())},
                     'previousTransition': None, 'publicReleaseControl': {'trust': self.trust,
                     'expectedSourceSha': NEXT, 'manifestPath': str(self.manifest_path)}, 'envelope': self.env}
        self.transport, self.reads, self.on_read = self.make_transport(), [], None
        opener = Mock()
        def open_request(req, timeout):
            self.reads.append(req)
            body = response(self.env, req.get_header('X-aurora-release-nonce'))
            body['orgId'] = ORG
            body['observedAtUtc'] = datetime.fromtimestamp(self.now, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            if self.on_read:
                self.on_read(req, body, len(self.reads))
            return NativeResponse(body)
        opener.open.side_effect = open_request
        for change in (patch.object(release.request, 'build_opener', return_value=opener),
                       patch.object(release.time, 'time', side_effect=lambda: self.now),
                       patch.object(deployment, '__file__', str(self.package / 'aurora_deployment.py'))):
            change.start()
            self.addCleanup(change.stop)

    def execute(self, recover=False):
        return deployment.transition_checkpoint(self.plan, self.raw, 'SYNTHETIC_MEMORY_ONLY',
                                                transport=self.transport, recover=recover)

    def make_transport(self, **kwargs):
        return TransitionTransport(lambda: self.now, **kwargs)

    def directory(self):
        return self.state / 'checkpoint-transitions' / release.digest(deployment._transition_encoded(self.plan))

    def assert_unpublished(self):
        self.assertEqual(self.active.read_bytes(), self.previous)
        self.assertFalse((self.state / 'integration-setup.lock').exists())
        self.assertFalse((self.directory() / 'commit.json').exists())

    def set_previous(self, value):
        self.previous = deployment._transition_encoded(value)
        self.active.write_bytes(self.previous)
        self.journal['identity']['checkpoint'] = release.digest(self.previous)
        self.journal_path.write_bytes(deployment._transition_encoded(self.journal))
        self.plan['expectedPreviousSha256'] = release.digest(self.previous)
        self.plan['iaAnchor']['journalSha256'] = release.digest(self.journal_path.read_bytes())

    def resign(self, value):
        value['signature'] = base64.urlsafe_b64encode(self.key.sign(release.signing_bytes(value['certificate']))).decode().rstrip('=')

    def test_default_plan_cli_reads_no_credential_or_release_module_and_writes_no_state(self):
        plan_path = self.base / 'reviewed-plan.json'
        plan_path.write_bytes(deployment._transition_encoded(self.plan))
        sample_path = self.base / 'sample.json'
        sample_path.write_bytes(deployment._transition_encoded(self.raw))
        before = {path.relative_to(self.state): path.read_bytes() for path in self.state.rglob('*') if path.is_file()}
        actual_import = builtins.__import__
        def guarded_import(name, *args, **kwargs):
            if name == 'published_release':
                raise AssertionError('preview imported optional release consumer')
            return actual_import(name, *args, **kwargs)
        actual_get = os.environ.get
        def guarded_environment(name, *args):
            if name == 'AURORA_INTEGRATION_TOKEN':
                raise AssertionError('preview read a credential')
            return actual_get(name, *args)
        with patch('builtins.__import__', side_effect=guarded_import), patch.object(deployment.os.environ, 'get', side_effect=guarded_environment), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(deployment.main(['--checkpoint-transition-plan', str(plan_path), '--input', str(sample_path)]), 0)
        self.assertEqual(json.loads(output.getvalue())['status'], 'EXPLICIT_PLAN_NOT_AUTHORITY')
        self.assertEqual(self.reads, [])
        self.assertEqual(self.transport.posts, [])
        self.assertEqual(before, {path.relative_to(self.state): path.read_bytes() for path in self.state.rglob('*') if path.is_file()})

    def test_signed_native_reader_two_posts_and_same_checkpoint_commit_preserve_identity(self):
        journal_before = self.journal_path.read_bytes()
        result = self.execute()
        directory = self.directory()
        self.assertEqual(result['status'], 'CHECKPOINT_TRANSITION_COMMITTED')
        self.assertEqual(len(self.transport.posts), 2)
        self.assertEqual(self.transport.posts[0], self.transport.posts[1])
        self.assertEqual(len(self.reads), 4)
        self.assertEqual(len({req.get_header('X-aurora-release-nonce') for req in self.reads}), 4)
        self.assertEqual(len(self.transport.readbacks), 2)
        self.assertTrue(all(req.full_url == release.READ_URL and req.method == 'GET' for req in self.reads))
        self.assertEqual(self.journal_path.read_bytes(), journal_before)
        self.assertEqual((directory / 'checkpoint.previous').read_bytes(), self.previous)
        self.assertEqual((directory / 'checkpoint.moved.previous').read_bytes(), self.previous)
        self.assertEqual((directory / 'checkpoint.next').read_bytes(), self.active.read_bytes())
        commit = json.loads((directory / 'commit.json').read_bytes())
        self.assertEqual(set(commit), {'schemaVersion', 'planSha256', 'previousSha256', 'nextSha256', 'proofSha256'})
        self.assertEqual(commit['planSha256'], directory.name)
        self.assertEqual(commit['proofSha256'], release.digest((directory / 'proof.json').read_bytes()))
        self.assertEqual(result['checkpointTransition']['commitSha256'], release.digest((directory / 'commit.json').read_bytes()))
        saved = json.loads(self.active.read_bytes())
        self.assertEqual(saved['componentVersion'], '1.0.7')
        self.assertEqual(saved['receipt']['status'], 'DUPLICATE')
        self.assertTrue(saved['installationAcceptance']['eligible'])
        self.assertNotIn('orgId', saved['installationAcceptance'])
        self.assertFalse(result['installationComplete'])
        self.assertFalse(result['allClientsSynchronized'])
        self.assertTrue(result['installationAcceptance']['eligible'])
        self.assertEqual(result['installationAcceptance']['orgId'], ORG)
        self.assertFalse((self.state / 'integration-setup.lock').exists())
        for path in directory.iterdir():
            for private in ('SYNTHETIC_MEMORY_ONLY', 'amountCents', 'externalDocumentId'):
                self.assertNotIn(private.encode(), path.read_bytes())

    def test_prior_transition_cannot_cross_ia_anchor_even_with_rehashed_local_artifacts(self):
        original_plan = copy.deepcopy(self.plan)
        first = self.execute()
        source = Path(first['checkpointTransition']['directory'])
        foreign_plan = copy.deepcopy(original_plan)
        foreign_plan['iaAnchor']['journalSha256'] = 'f' * 64
        encoded = deployment._transition_encoded(foreign_plan)
        forged = self.state / 'checkpoint-transitions' / release.digest(encoded)
        forged.mkdir()
        (forged / 'plan.json').write_bytes(encoded)
        for name in ('checkpoint.previous', 'checkpoint.next', 'proof.json'):
            shutil.copyfile(source / name, forged / name)
        commit = json.loads((source / 'commit.json').read_bytes())
        commit['planSha256'] = forged.name
        (forged / 'commit.json').write_bytes(deployment._transition_encoded(commit))
        current = self.active.read_bytes()
        checkpoint = json.loads(current)
        self.plan.update(expectedPreviousSha256=release.digest(current),
                         expectedPreviousTargetBinding=checkpoint['targetBinding'],
                         expectedPreviousSampleKey=checkpoint['sampleKey'],
                         previousTransition={'directory': str(forged),
                                             'commitSha256': release.digest((forged / 'commit.json').read_bytes())})
        with self.assertRaisesRegex(sync.SyncError, 'CHAIN_CONFLICT'):
            self.execute()
        self.assertEqual(self.active.read_bytes(), current)

    def test_generic_run_requires_explicit_transition_for_existing_ia_parent_checkpoint(self):
        network = Mock()
        before = {path.relative_to(self.state): path.read_bytes() for path in self.state.rglob('*') if path.is_file()}
        with self.assertRaisesRegex(sync.SyncError, 'EXPLICIT_CHECKPOINT_TRANSITION_REQUIRED'):
            deployment.run(self.raw, release.ORIGIN, ORG, self.state, token='synthetic', send=True, transport=network)
        network.assert_not_called()
        self.assertEqual(before, {path.relative_to(self.state): path.read_bytes() for path in self.state.rglob('*') if path.is_file()})

    def test_unconfigured_automation_and_missing_replay_fail_before_journal_writes(self):
        for transport, code in ((self.make_transport(configured=False), 'AUTHORITATIVE_AUTOMATION'),
                                (self.make_transport(always_accepted=True), 'CURRENT_PROCESSING_REPLAY')):
            with self.subTest(code=code):
                self.transport = transport
                with self.assertRaisesRegex(sync.SyncError, code):
                    self.execute()
                self.assert_unpublished()
                self.assertFalse((self.state / 'checkpoint-transitions').exists())

    def test_old_receipt_is_opaque_and_never_revalidated_with_current_bearer(self):
        previous = json.loads(self.previous)
        previous['receipt'] = {'status': 'OLD_UNTRUSTED_RECEIPT'}
        previous['processingProof'] = {'historical': 'not-current-authority'}
        self.set_previous(previous)
        self.assertEqual(self.execute()['status'], 'CHECKPOINT_TRANSITION_COMMITTED')
        self.assertEqual(len(self.transport.posts), 2)

    def assert_historical_checkpoint_transition(self, version):
        previous = json.loads(self.previous)
        previous['componentVersion'] = version
        self.set_previous(previous)
        self.assertEqual(self.execute()['status'], 'CHECKPOINT_TRANSITION_COMMITTED')
        self.assertEqual(json.loads(self.active.read_bytes())['componentVersion'], '1.0.7')
        self.assertEqual((self.directory() / 'checkpoint.previous').read_bytes(), self.previous)

    def test_historical_100_checkpoint_transitions_to_current_component(self):
        self.assert_historical_checkpoint_transition('1.0.0')

    def test_historical_101_checkpoint_transitions_to_current_component(self):
        self.assert_historical_checkpoint_transition('1.0.1')

    def test_historical_102_checkpoint_transitions_to_current_component(self):
        self.assert_historical_checkpoint_transition('1.0.2')

    def test_historical_103_checkpoint_transitions_to_current_component(self):
        self.assert_historical_checkpoint_transition('1.0.3')

    def test_historical_104_checkpoint_transitions_to_current_component(self):
        self.assert_historical_checkpoint_transition('1.0.4')

    def test_historical_105_checkpoint_transitions_to_current_component(self):
        self.assert_historical_checkpoint_transition('1.0.5')

    def test_historical_106_checkpoint_transitions_to_current_component(self):
        self.assert_historical_checkpoint_transition('1.0.6')

    def successor_release_on_same_installed_ia(self):
        """Only the signed current Windows package/pin advance; installed IA stays A."""
        source = 'b' * 40
        self.package = self.base / 'successor-package'
        self.package.mkdir(mode=0o700)
        for name in deployment.ASSETS:
            (self.package / name).write_bytes(('# successor public fixture ' + name + '\n').encode())
        self.win_manifest = {'component': 'AURORA_WINDOWS_INTEGRATION', 'version': deployment.VERSION,
                             'sourceSha': source, 'files': {name: release.digest((self.package / name).read_bytes())
                                                          for name in deployment.ASSETS}}
        self.manifest_path = self.base / 'successor' / 'windowsIntegration-manifest.json'
        self.manifest_path.parent.mkdir()
        self.manifest_path.write_bytes(deployment._transition_encoded(self.win_manifest))
        self.env = copy.deepcopy(self.env)
        self.env['certificate']['sourceSha'] = source
        for component in self.env['certificate']['components'].values():
            component['sourceSha'] = source
        self.env['certificate']['components']['windowsIntegration']['manifestSha256'] = release.digest(self.manifest_path.read_bytes())
        self.resign(self.env)
        self.plan.update(expectedSourceSha=source, envelope=copy.deepcopy(self.env),
                         expectedCertificateSha256=release.digest(release.signing_bytes(self.env['certificate'])),
                         packageDirectory=str(self.package), publicReleaseControl={'trust': self.trust,
                         'expectedSourceSha': source, 'manifestPath': str(self.manifest_path)})
        self.on_read = lambda req, body, count: body['runtime'].update(sourceSha=source)
        deployment.__file__ = str(self.package / 'aurora_deployment.py')

    def test_new_credential_replay_under_current_pin_preserves_historical_signed_ia_and_tuple(self):
        first = self.execute()
        previous, anchor_bytes = self.active.read_bytes(), self.journal_path.read_bytes()
        previous_proof = json.loads((Path(first['checkpointTransition']['directory']) / 'proof.json').read_bytes())
        self.successor_release_on_same_installed_ia()
        old = json.loads(previous)
        self.plan.update(expectedPreviousSha256=release.digest(previous), expectedPreviousTargetBinding=old['targetBinding'],
                         expectedPreviousSampleKey=old['sampleKey'], previousTransition=first['checkpointTransition'])
        self.transport.key_id = 'ik_' + 'b' * 16
        result = self.execute()
        next_proof = json.loads((self.directory() / 'proof.json').read_bytes())
        self.assertEqual(result['status'], 'CHECKPOINT_TRANSITION_COMMITTED')
        self.assertEqual((self.directory() / 'checkpoint.previous').read_bytes(), previous)
        self.assertEqual(self.journal_path.read_bytes(), anchor_bytes)
        self.assertNotEqual(previous_proof['installationAcceptance']['receiptId'], next_proof['installationAcceptance']['receiptId'])
        for field in ('documentId', 'versionId', 'sourceVersion', 'revision', 'canonicalSnapshotHash'):
            self.assertEqual(previous_proof['processingProof'][field], next_proof['processingProof'][field])
        self.assertEqual(len(self.transport.posts), 4)
        self.assertTrue(all('&receiptId=' in url for url in self.transport.readbacks))
        for url in self.transport.readbacks[-2:]:
            self.assertTrue(url.endswith('&receiptId=' + next_proof['installationAcceptance']['receiptId']))
        before = {path.name: path.read_bytes() for path in self.directory().iterdir()}
        self.execute(recover=True)
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.directory().iterdir()})

    def test_historical_ia_bytes_changed_cannot_be_rebound_by_new_pin(self):
        self.successor_release_on_same_installed_ia()
        (self.ia_package / 'fixture0.cjs').write_bytes(b'// changed historical bytes\n')
        with self.assertRaisesRegex(sync.SyncError, 'PACKAGE_FILE_BYTES_CONFLICT'):
            self.execute()
        self.assertEqual(self.transport.posts, [])
        self.assert_unpublished()

    def test_historical_windows_package_change_cannot_be_hidden_by_new_pin(self):
        old_package = self.package
        first = self.execute()
        previous = self.active.read_bytes()
        self.successor_release_on_same_installed_ia()
        old = json.loads(previous)
        self.plan.update(expectedPreviousSha256=release.digest(previous), expectedPreviousTargetBinding=old['targetBinding'],
                         expectedPreviousSampleKey=old['sampleKey'], previousTransition=first['checkpointTransition'])
        (old_package / 'provider_connectors.py').write_bytes(b'# changed historical public component\n')
        with self.assertRaisesRegex(sync.SyncError, 'PACKAGE_FILE_BYTES_CONFLICT'):
            self.execute()
        self.assertEqual(len(self.transport.posts), 2)
        self.assertEqual(self.active.read_bytes(), previous)
        self.assertFalse((self.directory() / 'commit.json').exists())

    def test_current_transition_rejects_prior_signed_component_before_posts_or_writes(self):
        for version in ('1.0.1','1.0.2','1.0.3','1.0.4','1.0.5','1.0.6'):
            with self.subTest(version=version):
                self.win_manifest['version'] = version
                self.manifest_path.write_bytes(deployment._transition_encoded(self.win_manifest))
                pin = self.env['certificate']['components']['windowsIntegration']
                pin.update(version=version, manifestSha256=release.digest(self.manifest_path.read_bytes()))
                self.resign(self.env)
                self.plan['expectedCertificateSha256'] = release.digest(release.signing_bytes(self.env['certificate']))
                with self.assertRaisesRegex(sync.SyncError, 'CHECKPOINT_TRANSITION_COMPONENT_VERSION_CONFLICT'):
                    self.execute()
                self.assertEqual(self.transport.posts, [])
                self.assertFalse((self.state / 'checkpoint-transitions').exists())
                self.assert_unpublished()

    def test_invalid_envelope_cannot_reach_network_or_local_writes(self):
        self.plan['envelope'] = {**self.env, 'signature': 'A' * 86}
        with self.assertRaisesRegex(sync.SyncError, 'SIGNATURE'):
            self.execute()
        self.assertEqual(self.reads, [])
        self.assertEqual(self.transport.posts, [])
        self.assert_unpublished()

    def test_nonce_org_and_live_certificate_are_bound_by_native_reader(self):
        for mutation, code in ((lambda body: body.update(requestNonce='f' * 64), 'CANONICAL_RESPONSE_BINDING'),
                               (lambda body: body.update(orgId='other-org'), 'CANONICAL_RESPONSE_BINDING')):
            self.on_read = lambda req, body, count: mutation(body)
            with self.assertRaisesRegex(sync.SyncError, code):
                self.execute()
            self.assert_unpublished()
        different = copy.deepcopy(self.env)
        different['certificate']['productVersion'] = '1.1.0-beta.99'
        self.resign(different)
        def changed(req, body, count):
            body['envelope'] = different
            body['certificateSha256'] = release.digest(release.signing_bytes(different['certificate']))
        self.on_read = changed
        with self.assertRaisesRegex(sync.SyncError, 'CERTIFICATE_CONFLICT'):
            self.execute()
        self.assertEqual(self.transport.posts, [])
        self.assert_unpublished()

    def test_changed_public_package_bytes_fail_before_document_transport(self):
        (self.package / 'provider_connectors.py').write_bytes(b'# foreign public code\n')
        with self.assertRaisesRegex(sync.SyncError, 'PACKAGE_FILE_BYTES_CONFLICT'):
            self.execute()
        self.assertEqual(self.transport.posts, [])
        self.assert_unpublished()

    def test_ia_anchor_hash_and_signature_are_both_required(self):
        before = self.journal_path.read_bytes()
        self.journal_path.write_bytes(before + b' ')
        with self.assertRaisesRegex(sync.SyncError, 'ANCHOR_CHANGED'):
            self.execute()
        self.assert_unpublished()
        changed = copy.deepcopy(self.journal)
        changed['acceptedEnvelope']['signature'] = 'A' * 86
        self.journal_path.write_bytes(deployment._transition_encoded(changed))
        self.plan['iaAnchor']['journalSha256'] = release.digest(self.journal_path.read_bytes())
        with self.assertRaisesRegex(sync.SyncError, 'SIGNATURE'):
            self.execute()
        self.assertEqual(self.transport.posts, [])
        self.assert_unpublished()

    def test_revocation_after_real_posts_still_blocks_before_any_journal_write(self):
        def revoke(req, body, count):
            if count == 2:
                raise OSError('synthetic revoked')
        self.on_read = revoke
        with self.assertRaisesRegex(sync.SyncError, 'CANONICAL_RELEASE_READ_FAILED'):
            self.execute()
        self.assertEqual(len(self.transport.posts), 2)
        self.assertFalse((self.state / 'checkpoint-transitions').exists())
        self.assert_unpublished()

    def test_thirty_second_ttl_is_enforced_after_slow_local_validation(self):
        native = deployment._transition_local
        calls = 0
        def slow(*args):
            nonlocal calls
            calls += 1
            native(*args)
            if calls == 3:
                self.now += 31
        with patch.object(deployment, '_transition_local', side_effect=slow):
            with self.assertRaisesRegex(sync.SyncError, 'FRESH_CANONICAL'):
                self.execute()
        self.assert_unpublished()
        self.assertTrue((self.directory() / 'proof.json').exists())

    def test_writer_during_final_tls_is_preserved_without_false_commit(self):
        foreign = b'{"foreign":"concurrent writer"}\n'
        def writer(req, body, count):
            if count == 3:
                self.active.write_bytes(foreign)
        self.on_read = writer
        with self.assertRaisesRegex(sync.SyncError, 'CONCURRENT_WRITER'):
            self.execute()
        self.assertEqual(self.active.read_bytes(), foreign)
        self.assertFalse((self.directory() / 'commit.json').exists())
        self.assertEqual((self.directory() / 'checkpoint.previous').read_bytes(), self.previous)
        self.assertTrue((self.state / 'integration-setup.lock').exists())

    def test_writer_after_move_is_not_overwritten_and_retains_owned_lock(self):
        actual = deployment._transition_exclusive
        foreign = b'{"foreign":"created after predecessor move"}\n'
        def race(path, data):
            if path == self.active:
                self.active.write_bytes(foreign)
            return actual(path, data)
        with patch.object(deployment, '_transition_exclusive', side_effect=race):
            with self.assertRaisesRegex(sync.SyncError, 'CONCURRENT_WRITER'):
                self.execute()
        self.assertEqual(self.active.read_bytes(), foreign)
        self.assertEqual((self.directory() / 'checkpoint.moved.previous').read_bytes(), self.previous)
        self.assertTrue((self.state / 'integration-setup.lock').exists())
        self.assertFalse((self.directory() / 'commit.json').exists())
        with self.assertRaisesRegex(sync.SyncError, 'CONCURRENT_WRITER'):
            self.execute(recover=True)
        self.assertEqual(self.active.read_bytes(), foreign)
        self.assertTrue((self.state / 'integration-setup.lock').exists())

    def crash_at(self, target_name):
        actual = deployment._transition_exclusive
        def interrupted(path, data):
            if path.name == target_name:
                raise InterruptedPublication()
            return actual(path, data)
        with patch.object(deployment, '_transition_exclusive', side_effect=interrupted):
            with self.assertRaises(InterruptedPublication):
                self.execute()

    def test_recovery_after_move_reposts_current_sample_and_completes_exclusively(self):
        self.crash_at(deployment.STATE_NAME)
        self.assertFalse(self.active.exists())
        self.assertTrue((self.state / 'integration-setup.lock').exists())
        before_posts = len(self.transport.posts)
        result = self.execute(recover=True)
        self.assertEqual(len(self.transport.posts), before_posts + 2)
        self.assertEqual(self.active.read_bytes(), (self.directory() / 'checkpoint.next').read_bytes())
        self.assertEqual(result['status'], 'CHECKPOINT_TRANSITION_COMMITTED')
        self.assertFalse((self.state / 'integration-setup.lock').exists())

    def test_recovery_of_published_next_requires_current_authority_and_does_not_rewrite_proof(self):
        self.crash_at('commit.json')
        directory = self.directory()
        next_bytes, proof_bytes = self.active.read_bytes(), (directory / 'proof.json').read_bytes()
        self.transport = self.make_transport(configured=False)
        with self.assertRaisesRegex(sync.SyncError, 'AUTHORITATIVE_AUTOMATION'):
            self.execute(recover=True)
        self.assertEqual(self.active.read_bytes(), next_bytes)
        self.assertEqual((directory / 'proof.json').read_bytes(), proof_bytes)
        self.assertTrue((self.state / 'integration-setup.lock').exists())
        self.transport = self.make_transport()
        self.execute(recover=True)
        self.assertEqual(self.active.read_bytes(), next_bytes)
        self.assertEqual((directory / 'proof.json').read_bytes(), proof_bytes)

    def test_recovery_before_move_reuses_existing_immutable_preparation(self):
        self.crash_at('proof.json')
        self.assert_unpublished()
        plan_bytes = (self.directory() / 'plan.json').read_bytes()
        self.execute(recover=True)
        self.assertEqual((self.directory() / 'plan.json').read_bytes(), plan_bytes)
        self.assertEqual(len(self.transport.posts), 4)

    def test_recovery_of_directory_only_and_plan_only_preparation_is_exclusive(self):
        for name in ('plan.json', 'checkpoint.previous'):
            with self.subTest(interrupted_before=name):
                self.crash_at(name)
                self.assert_unpublished()
                self.assertFalse((self.directory() / name).exists())
                result = self.execute(recover=True)
                self.assertEqual(result['status'], 'CHECKPOINT_TRANSITION_COMMITTED')
                # Use a distinct explicit plan for the next interruption window.
                checkpoint = json.loads(self.active.read_bytes())
                self.plan = copy.deepcopy(self.plan)
                self.plan.update(expectedPreviousSha256=release.digest(self.active.read_bytes()),
                                 expectedPreviousTargetBinding=checkpoint['targetBinding'],
                                 expectedPreviousSampleKey=checkpoint['sampleKey'],
                                 previousTransition=result['checkpointTransition'])
                self.previous = self.active.read_bytes()

    def test_recovery_rejects_changed_journal_and_foreign_lock(self):
        self.crash_at('commit.json')
        proof_path = self.directory() / 'proof.json'
        proof = json.loads(proof_path.read_bytes())
        proof['installationAcceptance']['configurationHash'] = 'f' * 64
        proof_path.write_bytes(deployment._transition_encoded(proof))
        with self.assertRaisesRegex(sync.SyncError, 'CURRENT_PROOF_CONFLICT'):
            self.execute(recover=True)
        self.assertTrue((self.state / 'integration-setup.lock').exists())
        lock = self.state / 'integration-setup.lock'
        foreign = b'foreign writer lock\n'
        lock.write_bytes(foreign)
        with self.assertRaises((sync.SyncError, ValueError)):
            self.execute(recover=True)
        self.assertEqual(lock.read_bytes(), foreign)

    def test_committed_recovery_is_idempotent_but_still_reauthenticates_and_replays(self):
        first = self.execute()
        current = self.active.read_bytes()
        before = {path.name: path.read_bytes() for path in self.directory().iterdir()}
        second = self.execute(recover=True)
        self.assertEqual(second, first)
        self.assertEqual(self.active.read_bytes(), current)
        self.assertEqual(len(self.transport.posts), 4)
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.directory().iterdir()})

    def test_subsequent_transition_links_immutable_predecessor_and_rejects_tampering(self):
        first = self.execute()
        first_directory = Path(first['checkpointTransition']['directory'])
        current = self.active.read_bytes()
        current_value = json.loads(current)
        self.plan = copy.deepcopy(self.plan)
        self.plan.update(expectedPreviousSha256=release.digest(current),
                         expectedPreviousTargetBinding=current_value['targetBinding'],
                         expectedPreviousSampleKey=current_value['sampleKey'],
                         previousTransition=first['checkpointTransition'])
        second = self.execute()
        self.assertNotEqual(first['checkpointTransition']['directory'], second['checkpointTransition']['directory'])
        self.assertEqual((self.directory() / 'checkpoint.previous').read_bytes(), current)
        first_commit = first_directory / 'commit.json'
        first_commit.write_bytes(first_commit.read_bytes() + b' ')
        with self.assertRaisesRegex(sync.SyncError, 'CHAIN_CONFLICT'):
            self.execute(recover=True)

    def test_live_operation_owner_cannot_be_recovered_by_another_operation(self):
        self.crash_at('commit.json')
        lock = self.state / 'integration-setup.lock'
        value = json.loads(lock.read_bytes())
        value['pid'] = os.getpid() + 1
        lock.write_bytes(deployment._transition_encoded(value))
        with patch.object(deployment, '_transition_process_running', return_value=True):
            with self.assertRaisesRegex(sync.SyncError, 'INSTALLATION_BUSY'):
                self.execute(recover=True)
        self.assertTrue(lock.exists())

    def test_plan_shape_and_sample_cannot_silently_change_target_method_or_payload(self):
        for change in ({'method': 'MANUAL'}, {'nextOrigin': 'https://other.example.invalid'},
                       {'payloadSha256': 'f' * 64}, {'extraAuthorization': True}):
            with self.subTest(change=change):
                changed = {**self.plan, **change}
                with self.assertRaises(sync.SyncError):
                    deployment.transition_checkpoint(changed, self.raw, 'synthetic', transport=self.transport)
        self.assertEqual(self.reads, [])
        self.assertEqual(self.transport.posts, [])
        self.assert_unpublished()

    def test_current_get_rejects_revoked_automation_before_publication(self):
        def revoke(body, count):
            body['installation']['acceptance']['eligible'] = False
            body['installation']['acceptance']['state'] = 'PENDING_AUTOMATION'
            body['installation']['acceptance']['automationVerified'] = False
        self.transport.on_readback = revoke
        with self.assertRaisesRegex(sync.SyncError, 'AUTHORITATIVE_AUTOMATION'):
            self.execute()
        self.assert_unpublished()
        self.assertEqual(len(self.transport.posts), 2)

    def test_current_get_revocation_after_publication_retains_lock_and_recovery_is_current(self):
        def revoke(body, count):
            if count == 2:
                body['installation']['acceptance']['eligible'] = False
                body['installation']['acceptance']['state'] = 'PENDING_AUTOMATION'
                body['installation']['acceptance']['automationVerified'] = False
        self.transport.on_readback = revoke
        with self.assertRaisesRegex(sync.SyncError, 'AUTHORITATIVE_AUTOMATION'):
            self.execute()
        self.assertEqual(self.active.read_bytes(), (self.directory() / 'checkpoint.next').read_bytes())
        self.assertTrue((self.state / 'integration-setup.lock').exists())
        self.assertFalse((self.directory() / 'commit.json').exists())
        self.transport.on_readback = None
        self.execute(recover=True)
        self.assertFalse((self.state / 'integration-setup.lock').exists())

    def test_current_get_binds_receipt_to_actual_key_and_rejects_stale_authority(self):
        for change, code in ((lambda body: body.update(keyId='ik_' + 'b' * 16), 'AUTHORITATIVE_AUTOMATION'),
                             (lambda body: body['installation']['acceptance'].update(
                                 verifiedAt=datetime.fromtimestamp(self.now - 31, timezone.utc).isoformat()),
                              'FRESH_INSTALLATION_AUTHORITY')):
            with self.subTest(code=code):
                self.transport.on_readback = lambda body, count: change(body)
                with self.assertRaisesRegex(sync.SyncError, code):
                    self.execute(recover=self.directory().exists())
                self.assert_unpublished()

    def test_returned_acceptance_is_from_last_current_get_without_rewriting_immutable_proof(self):
        def advance(body, count):
            self.now += 1
            body['installation']['acceptance']['verifiedAt'] = datetime.fromtimestamp(self.now, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        self.transport.on_readback = advance
        result = self.execute()
        proof = json.loads((self.directory() / 'proof.json').read_bytes())
        self.assertNotEqual(result['installationAcceptance']['verifiedAt'], proof['installationAcceptance']['verifiedAt'])
        self.assertEqual(result['installationAcceptance']['verifiedAt'], datetime.fromtimestamp(self.now, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))

    def test_recovery_interruption_releases_native_guard_and_keeps_owned_checkpoint_lock(self):
        self.crash_at('commit.json')
        actual = deployment._transition_current_server
        def interrupted(*args):
            raise InterruptedPublication()
        with patch.object(deployment, '_transition_current_server', side_effect=interrupted):
            with self.assertRaises(InterruptedPublication):
                self.execute(recover=True)
        self.assertTrue((self.state / 'integration-setup.lock').exists())
        self.assertFalse((self.directory() / 'recovery.lock').exists())
        self.execute(recover=True)
        self.assertFalse((self.state / 'integration-setup.lock').exists())

    def test_current_server_clock_eighty_milliseconds_ahead_is_bounded_and_accepted(self):
        def ahead(body, count):
            body['installation']['acceptance']['verifiedAt'] = datetime.fromtimestamp(self.now + .08, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        self.transport.on_readback = ahead
        result = self.execute()
        self.assertEqual(result['status'], 'CHECKPOINT_TRANSITION_COMMITTED')
        self.assertEqual(result['installationAcceptance']['verifiedAt'], datetime.fromtimestamp(self.now + .08, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))

    def test_current_server_clock_thirty_one_seconds_ahead_is_rejected(self):
        def ahead(body, count):
            body['installation']['acceptance']['verifiedAt'] = datetime.fromtimestamp(self.now + 31, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        self.transport.on_readback = ahead
        with self.assertRaisesRegex(sync.SyncError, 'FRESH_INSTALLATION_AUTHORITY'):
            self.execute()
        self.assert_unpublished()


if __name__ == '__main__':
    unittest.main()
