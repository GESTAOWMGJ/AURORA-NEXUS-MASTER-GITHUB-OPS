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
from test_cloud_sync import fixture, response, ORG, ORIGIN


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

    def test_cached_receipt_skips_post_but_revalidates_authentication(self):
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, response(self.payload))])
        first = self.run_setup(token='test-token', send=True, transport=network)
        self.assertTrue(first['receiptVerifiedThisRun'])
        network = Mock(return_value=(200, {'ok': True, 'orgId': ORG}))
        second = self.run_setup(token='rotated-token', send=True, transport=network)
        self.assertEqual(network.call_count, 1)
        self.assertTrue(network.call_args.args[0].endswith('/ping'))
        self.assertEqual(second['status'], 'PREVIOUS_RECEIPT_CACHED')
        self.assertTrue(second['previousReceiptCached'])
        self.assertFalse(second['receiptVerifiedThisRun'])
        self.assertFalse(second['fullSynchronizationVerified'])
        denied = self.run_setup(send=True, transport=Mock())
        self.assertEqual(denied['status'], 'BLOCKED')
        self.assertEqual(denied['receipt'], first['receipt'])

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
                                     (ORG, ORIGIN, dict(self.payload, amountCents=3))]:
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
