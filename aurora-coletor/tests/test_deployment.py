import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import aurora_deployment as deployment
import aurora_cloud_sync as sync
from test_cloud_sync import fixture, response, processed_response, ORG, ORIGIN


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.state.chmod(0o700)
        self.payload = fixture()

    def run_setup(self, **kwargs):
        return deployment.run(self.payload, ORIGIN, ORG, self.state, **kwargs)

    def test_offline_validation_and_no_secret_or_business_values_in_checkpoint(self):
        network = Mock()
        original = copy.deepcopy(self.payload)
        result = self.run_setup(token='DO-NOT-PERSIST', transport=network)
        network.assert_not_called()
        self.assertEqual(result['status'], 'LOCAL_VALIDATED')
        self.assertEqual(original, self.payload)
        checkpoint = (self.state / deployment.STATE_NAME).read_text()
        for private in ('DO-NOT-PERSIST', 'amountCents', ORIGIN, ORG, str(self.state), 'externalDocumentId'):
            self.assertNotIn(private, checkpoint)
        self.assertFalse(result['fullSynchronizationVerified'])

    def test_missing_credential_then_resume_with_ping_only(self):
        network = Mock()
        first = self.run_setup(connect=True, transport=network)
        self.assertEqual(first['code'], 'INTEGRATION_CREDENTIAL_REQUIRED')
        network.assert_not_called()
        network.return_value = (200, {'ok': True, 'orgId': ORG})
        retry = self.run_setup(token='test-token', connect=True, transport=network)
        self.assertEqual(retry['attempt'], 2)
        self.assertEqual(retry['status'], 'CONNECTION_VERIFIED')
        self.assertEqual(network.call_count, 1)
        self.assertFalse(retry['receiptVerifiedThisRun'])

    def test_cached_receipt_reposts_same_payload_key_and_revalidates_authentication(self):
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, response(self.payload))])
        first = self.run_setup(token='test-token', send=True, transport=network)
        original_post = network.call_args.args
        self.assertTrue(first['receiptVerifiedThisRun'])
        self.assertFalse(first['processingVerifiedThisRun'])
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}),
                                   (200, processed_response(self.payload, True))])
        second = self.run_setup(token='rotated-token', send=True, transport=network)
        self.assertEqual(network.call_count, 2)
        self.assertEqual(network.call_args.args[0], original_post[0])
        self.assertEqual(network.call_args.args[2:], original_post[2:])
        self.assertEqual(second['status'], 'SAMPLE_RECEIPT_VERIFIED')
        self.assertTrue(second['previousReceiptCached'])
        self.assertTrue(second['receiptVerifiedThisRun'])
        self.assertTrue(second['processingVerifiedThisRun'])
        # Preserve the exact v1 receipt accepted by the rollback component.
        legacy_expected = dict(sync.synchronize(self.payload, ORIGIN, ORG),
                               status='DUPLICATE', cloudReceiptVerified=True)
        self.assertEqual(second['receipt'], legacy_expected)
        self.assertFalse(second['fullSynchronizationVerified'])
        denied = self.run_setup(send=True, transport=Mock())
        self.assertEqual(denied['status'], 'BLOCKED')
        self.assertEqual(denied['receipt'], second['receipt'])
        self.assertFalse(denied['processingVerifiedThisRun'])

    def test_first_post_before_setup_then_same_key_replay_after_setup(self):
        reply = processed_response(self.payload, operational_complete=False)
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, reply)])
        first = self.run_setup(token='test-token', send=True, transport=network)
        original_post = network.call_args.args
        self.assertEqual(first['status'], 'SAMPLE_RECEIPT_VERIFIED')
        self.assertTrue(first['receiptVerifiedThisRun'])
        self.assertTrue(first['processingVerifiedThisRun'])
        self.assertEqual(first['processingProof'], reply['installation'])
        self.assertIs(first['processingProof']['operationalComplete'], False)
        self.assertEqual(first['nextAction'], 'COMPLETE_AUTHENTICATED_SETUP')
        self.assertEqual(first['receipt']['status'], 'ACCEPTED')
        checkpoint = deployment.read_json(self.state / deployment.STATE_NAME)
        self.assertEqual(checkpoint['receipt'], first['receipt'])
        self.assertEqual(checkpoint['processingProof'], first['processingProof'])

        # A ping after authenticated setup still cannot upgrade this cached proof.
        ping = Mock(return_value=(200, {'ok': True, 'orgId': ORG,
                                       'installation': processed_response(self.payload)['installation']}))
        connected = self.run_setup(token='test-token', connect=True, transport=ping)
        self.assertEqual(ping.call_count, 1)
        self.assertTrue(ping.call_args.args[0].endswith('/ping'))
        self.assertEqual(connected['receipt'], first['receipt'])
        self.assertEqual(connected['processingProof'], first['processingProof'])
        self.assertFalse(connected['processingVerifiedThisRun'])

        wrong_version = processed_response(self.payload, duplicate=True, operational_complete=False)
        wrong_version['installation']['sourceVersion'] = 2
        rejected = self.run_setup(token='test-token', send=True, transport=Mock(
            side_effect=[(200, {'ok': True, 'orgId': ORG}), (200, wrong_version)]))
        self.assertEqual(rejected['status'], 'BLOCKED')
        self.assertEqual(rejected['code'], 'CLOUD_PROCESSING_PROOF_MISMATCH')
        self.assertEqual(rejected['receipt'], first['receipt'])
        self.assertEqual(rejected['processingProof'], first['processingProof'])
        self.assertFalse(rejected['processingVerifiedThisRun'])
        self.assertFalse(rejected['receiptVerifiedThisRun'])

        # Completing setup is external to this collector; only a bound POST proves it.
        completed_reply = processed_response(self.payload, duplicate=True, operational_complete=True)
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (200, completed_reply)])
        completed = self.run_setup(token='rotated-token', send=True, transport=network)
        self.assertEqual(network.call_count, 2)
        self.assertEqual(network.call_args.args[0], original_post[0])
        self.assertEqual(network.call_args.args[2:], original_post[2:])
        self.assertEqual(completed['sampleKey'], first['sampleKey'])
        self.assertTrue(completed['previousReceiptCached'])
        self.assertTrue(completed['processingVerifiedThisRun'])
        self.assertEqual(completed['processingProof'], completed_reply['installation'])
        self.assertIs(completed['processingProof']['operationalComplete'], True)
        self.assertEqual(completed['nextAction'], 'VERIFY_CONTINUITY_WITH_SUBSEQUENT_EVENTS')
        self.assertEqual(completed['receipt'], dict(first['receipt'], status='DUPLICATE'))
        for result in (first, connected, completed):
            self.assertFalse(result['fullSynchronizationVerified'])
            self.assertFalse(result['productionReleased'])

    def test_connect_with_cached_receipt_remains_ping_only_without_current_processing_proof(self):
        first = self.run_setup(token='test-token', send=True, transport=Mock(
            side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, processed_response(self.payload))]))
        network = Mock(return_value=(200, {'ok': True, 'orgId': ORG,
                                          'installation': processed_response(self.payload)['installation']}))
        result = self.run_setup(token='test-token', connect=True, transport=network)
        self.assertEqual(network.call_count, 1)
        self.assertTrue(network.call_args.args[0].endswith('/ping'))
        self.assertEqual(result['status'], 'PREVIOUS_RECEIPT_CACHED')
        self.assertEqual(result['receipt'], first['receipt'])
        self.assertFalse(result['receiptVerifiedThisRun'])
        self.assertFalse(result['processingVerifiedThisRun'])

    def test_cached_v1_receipt_migrates_without_changing_payload_or_key(self):
        first = self.run_setup(token='test-token', send=True, transport=Mock(
            side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, response(self.payload))]))
        first['componentVersion'] = '1.0.0'
        del first['processingProof']
        deployment.atomic_json(self.state / deployment.STATE_NAME, first)
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}),
                                   (200, processed_response(self.payload, True))])
        result = self.run_setup(token='test-token', send=True, transport=network)
        self.assertEqual(result['componentVersion'], '1.0.1')
        self.assertEqual(result['sampleKey'], first['sampleKey'])
        self.assertTrue(result['processingVerifiedThisRun'])

    def test_cached_receipt_timeout_then_pending_projection_retries_same_post(self):
        first = self.run_setup(token='test-token', send=True, transport=Mock(
            side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, response(self.payload))]))
        posts = []
        for reply in (sync.SyncError('RETRYABLE_TRANSPORT_ERROR'),
                      (200, dict(response(self.payload, True),
                                 installation={'state': 'PENDING_PROJECTION', 'firstIngestionVerified': False})),
                      (200, processed_response(self.payload, True))):
            network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), reply])
            result = self.run_setup(token='test-token', send=True, transport=network)
            posts.append(network.call_args.args[2:])
            self.assertEqual(result['sampleKey'], first['sampleKey'])
            if len(posts) == 1:
                self.assertEqual(result['status'], 'BLOCKED')
                self.assertEqual(result['receipt'], first['receipt'])
                self.assertFalse(result['processingVerifiedThisRun'])
            elif len(posts) == 2:
                self.assertEqual(result['processingProof']['state'], 'PENDING_PROJECTION')
                self.assertFalse(result['processingVerifiedThisRun'])
        self.assertEqual(posts[0], posts[1])
        self.assertEqual(posts[1], posts[2])
        self.assertTrue(result['processingVerifiedThisRun'])

    def test_cached_receipt_wrong_tenant_or_projection_never_claims_processing(self):
        original = self.run_setup(token='test-token', send=True, transport=Mock(
            side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, response(self.payload))]))
        wrong = processed_response(self.payload, True)
        wrong['installation']['sourceVersion'] = 2
        for replies in ([(200, {'ok': True, 'orgId': 'other-org'})],
                        [(200, {'ok': True, 'orgId': ORG}), (200, wrong)]):
            network = Mock(side_effect=replies)
            result = self.run_setup(token='test-token', send=True, transport=network)
            self.assertEqual(result['status'], 'BLOCKED')
            self.assertEqual(result['receipt'], original['receipt'])
            self.assertFalse(result['processingVerifiedThisRun'])
            self.assertFalse(result['receiptVerifiedThisRun'])

    def test_timeout_after_post_reuses_idempotency_on_resume(self):
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), sync.SyncError('RETRYABLE_TRANSPORT_ERROR')])
        failed = self.run_setup(token='test-token', send=True, transport=network)
        original_key = network.call_args.args[3]
        self.assertEqual(failed['status'], 'BLOCKED')
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (200, response(self.payload, True))])
        resumed = self.run_setup(token='test-token', send=True, transport=network)
        self.assertEqual(resumed['receipt']['status'], 'DUPLICATE')
        self.assertEqual(network.call_args.args[3], original_key)

    def test_wrong_tenant_and_bad_receipt_never_complete(self):
        for replies in ([(200, {'ok': True, 'orgId': 'other-org'})],
                        [(200, {'ok': True, 'orgId': ORG}), (202, dict(response(self.payload), documentId='wrong'))]):
            result = self.run_setup(token='test-token', send=True, transport=Mock(side_effect=replies))
            self.assertEqual(result['status'], 'BLOCKED')
            self.assertIsNone(result['receipt'])

    def test_target_and_sample_conflict_preserve_checkpoint_before_network(self):
        self.run_setup()
        checkpoint = self.state / deployment.STATE_NAME
        before = checkpoint.read_bytes()
        for org, origin, payload in [('other-org', ORIGIN, self.payload),
                                     (ORG, 'https://other.invalid', self.payload),
                                     (ORG, ORIGIN, dict(self.payload, amountCents=3)),
                                     (ORG, ORIGIN, dict(self.payload, externalDocumentId='synthetic-other')),
                                     (ORG, ORIGIN, dict(self.payload, sourceSystem='MV')),
                                     (ORG, ORIGIN, dict(self.payload, sourceVersion=2))]:
            network = Mock()
            with self.assertRaisesRegex(sync.SyncError, 'CHECKPOINT_'):
                deployment.run(payload, origin, org, self.state, 'test', True, True, network)
            network.assert_not_called()
            self.assertEqual(checkpoint.read_bytes(), before)

    def test_busy_or_stale_lock_is_never_force_removed(self):
        lock = self.state / 'integration-setup.lock'
        lock.write_text('held')
        with self.assertRaisesRegex(sync.SyncError, 'BUSY_OR_INTERRUPTED'):
            self.run_setup()
        self.assertEqual(lock.read_text(), 'held')

    def test_corrupt_receipt_and_schema_fail_closed(self):
        checkpoint = self.state / deployment.STATE_NAME
        for patch in ({'receipt': {'status': 'ACCEPTED'}}, {'schemaVersion': 'unknown'}, {'attempt': True}):
            checkpoint.unlink(missing_ok=True)
            value = self.run_setup()
            checkpoint.write_text(json.dumps(dict(value, **patch)))
            with self.assertRaisesRegex(sync.SyncError, 'CHECKPOINT_'):
                self.run_setup()

    @unittest.skipUnless(os.name == 'posix', 'POSIX symlink test; Windows junctions rejected by safe_path')
    def test_symlink_checkpoint_and_world_readable_state_rejected(self):
        outside = self.state / 'outside.json'
        outside.write_text('{}')
        (self.state / deployment.STATE_NAME).symlink_to(outside)
        with self.assertRaisesRegex(sync.SyncError, 'LINK_PATH'):
            self.run_setup()
        (self.state / deployment.STATE_NAME).unlink()
        self.state.chmod(0o755)
        with self.assertRaisesRegex(sync.SyncError, 'PRIVATE_STATE'):
            self.run_setup()

    def test_installed_bundle_runs_independently_and_keeps_prior_state(self):
        first = deployment.install_assets(ROOT, self.state)
        self.assertFalse(first['alreadyInstalled'])
        sample = self.state / 'synthetic.json'
        sample.write_text(json.dumps(self.payload))
        directory = self.state / 'integration'
        module = directory / deployment.VERSION / 'aurora_deployment.py'
        result = subprocess.run([sys.executable, str(module), '--input', str(sample),
                                 '--origin', ORIGIN, '--org', ORG, '--state-dir', str(directory / 'state')],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'LOCAL_VALIDATED')
        checkpoint = directory / 'state' / deployment.STATE_NAME
        before = checkpoint.read_bytes()
        self.assertTrue(deployment.install_assets(ROOT, self.state)['alreadyInstalled'])
        self.assertEqual(checkpoint.read_bytes(), before)
        module.write_text('tampered')
        with self.assertRaisesRegex(sync.SyncError, 'INSTALLED_COMPONENT_CONFLICT'):
            deployment.install_assets(ROOT, self.state)
        self.assertEqual(module.read_text(), 'tampered')


    def test_cached_processing_proof_tamper_blocks_before_network(self):
        first = self.run_setup(token='test-token', send=True, transport=Mock(
            side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, processed_response(self.payload))]))
        first['processingProof']['canonicalSnapshotHash'] = 'a' * 64
        checkpoint = self.state / deployment.STATE_NAME
        deployment.atomic_json(checkpoint, first)
        before = checkpoint.read_bytes()
        network = Mock()
        with self.assertRaisesRegex(sync.SyncError, 'CHECKPOINT_RECEIPT_CONFLICT'):
            self.run_setup(token='test-token', send=True, transport=network)
        network.assert_not_called()
        self.assertEqual(checkpoint.read_bytes(), before)

    def test_error_details_and_credentials_are_not_persisted(self):
        secret = 'synthetic-private-secret'
        network = Mock(side_effect=sync.SyncError('bad response contains ' + secret))
        result = self.run_setup(token=secret, send=True, transport=network)
        self.assertEqual(result['code'], 'INTEGRATION_FAILED')
        self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn(secret, (self.state / deployment.STATE_NAME).read_text())

    def test_component_patch_preserves_legacy_bundle_and_records_reviewed_hashes(self):
        legacy = self.state / 'integration' / '1.0.0'
        legacy.mkdir(parents=True)
        sentinel = legacy / 'aurora_deployment.py'
        sentinel.write_bytes(b'# synthetic legacy bundle')
        before = sentinel.read_bytes()
        result = deployment.install_assets(ROOT, self.state)
        self.assertEqual(result['version'], '1.0.1')
        manifest = deployment.read_json(self.state / 'integration' / deployment.VERSION / 'manifest.json')
        self.assertEqual(manifest['schemaVersion'], deployment.SCHEMA)
        self.assertEqual(manifest['version'], deployment.VERSION)
        for name in deployment.ASSETS:
            self.assertEqual(manifest['sha256'][name], deployment.hashlib.sha256((ROOT / name).read_bytes()).hexdigest())
        self.assertEqual(sentinel.read_bytes(), before)

    def test_installer_entrypoint_prepares_component_without_network(self):
        result = subprocess.run([sys.executable, str(ROOT.parent / 'desktop' / 'install_windows_beta.py'),
                                 'prepare-integration', '--target', str(self.state)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['version'], deployment.VERSION)

    def test_windows_beta_does_not_trust_generic_manifest_fields_of_other_versions(self):
        installer = (ROOT.parent / 'desktop' / 'install_windows_beta.py').read_text(encoding='utf-8')
        # Behavioral coverage lives in test_windows_beta_continuity.py on Linux/Windows.
        # This packaging contract forbids restoring the old permissive version scan.
        self.assertNotIn('prior_manifests', installer)
        self.assertIn('known_identity(previous, expected)', installer)
        self.assertIn('elif any(p.exists() for p in shortcuts):', installer)
        self.assertIn('EXISTING_INSTALLATION_REQUIRES_REVIEW', installer)

    def test_errors_map_to_concrete_actions(self):
        for code, action in [('BLOCKED_HTTP_401', 'CREDENTIAL'), ('BLOCKED_HTTP_404', 'DEPLOY'),
                             ('RETRYABLE_HTTP_503', 'RETRY'), ('CLOUD_RECEIPT_MISMATCH', 'RECONCILE')]:
            result = self.run_setup(token='test-token', connect=True, transport=Mock(side_effect=sync.SyncError(code)))
            self.assertIn(action, result['nextAction'])
            self.assertFalse(result['connectionVerified'])


if __name__ == '__main__':
    unittest.main()
