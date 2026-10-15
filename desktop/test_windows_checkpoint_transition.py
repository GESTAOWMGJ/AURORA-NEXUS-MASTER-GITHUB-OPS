"""Installer caller contract; cryptographic transition tests live with deployment."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('transition_installer', Path(__file__).with_name('install_windows_beta.py'))
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'aurora-coletor' / 'tests'))
from test_cloud_sync import fixture

ORIGIN = 'https://auroranexus.com.br'
SOURCE = 'a' * 40
ORG = 'fixture-org'
FLAGS = ('processingVerified', 'receiptPersisted', 'replayVerified', 'automationConfigured', 'automationVerified')


class WindowsCheckpointTransitionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'AuroraNexus'
        self.state = self.root / 'integration' / 'state'
        (self.state / 'ia-master').mkdir(parents=True)
        (self.state / 'ia-master' / 'installation.json').write_text('{}')
        self.sample = Path(self.tmp.name) / 'synthetic.json'
        self.sample.write_text(json.dumps(fixture()))
        self.plan_path = Path(self.tmp.name) / 'public-plan.json'
        self.plan = {'stateDirectory': str(self.state), 'orgId': ORG, 'nextOrigin': ORIGIN,
                     'method': 'API_TOKEN', 'expectedSourceSha': SOURCE}
        self.save_plan()
        self.acceptance = {'eligible': True, 'orgId': ORG, 'canonicalOrigin': ORIGIN,
                           'method': 'API_TOKEN', **{key: True for key in FLAGS}}
        self.result = {'status': 'CHECKPOINT_TRANSITION_COMMITTED', 'installationAcceptance': self.acceptance,
                       'checkpointTransition': {'directory': 'public-reference', 'commitSha256': 'b' * 64},
                       'targetBinding': 'c' * 64, 'sampleKey': 'win-v1:' + 'd' * 64}

    def save_plan(self):
        self.plan_path.write_text(json.dumps(self.plan))

    def call(self, **kwargs):
        return installer.verify_installation_integration(self.root, self.sample, ORG, ORIGIN, 'API_TOKEN',
            transition_plan_path=self.plan_path, expected_source=SOURCE, **kwargs)

    def test_same_installation_uses_fresh_transition_once_without_untracked_checkpoint_writes(self):
        for recover in (False, True):
            with self.subTest(recover=recover), \
                 patch.object(installer.integration_deployment, 'transition_checkpoint', return_value=self.result) as transition, \
                 patch.object(installer.integration_deployment, 'integrate_installation') as legacy, \
                 patch.dict(installer.os.environ, {'AURORA_INTEGRATION_TOKEN': 'synthetic-process-only'}):
                result = self.call(transition_recover=recover)
                self.assertTrue(result['eligible'])
                self.assertFalse(result['installationComplete'])
                self.assertEqual(result['checkpointTransition'], self.result['checkpointTransition'])
                self.assertEqual(transition.call_count, 1)
                self.assertEqual(transition.call_args.args[0], self.plan)
                self.assertEqual(transition.call_args.args[2], 'synthetic-process-only')
                self.assertEqual(transition.call_args.kwargs, {'recover': recover})
                legacy.assert_not_called()

    def test_existing_ia_cannot_fall_back_to_implicit_adapter_writes(self):
        with patch.object(installer.integration_deployment, 'integrate_installation') as legacy:
            with self.assertRaisesRegex(ValueError, 'EXPLICIT_CHECKPOINT_TRANSITION_REQUIRED'):
                installer.verify_installation_integration(self.root, self.sample, ORG, ORIGIN, 'API_TOKEN')
            legacy.assert_not_called()

    def test_foreign_state_org_source_or_origin_never_reaches_transition(self):
        for field, value in [('stateDirectory', str(self.state / 'another-state')), ('orgId', 'another-org'),
                             ('expectedSourceSha', 'e' * 40), ('nextOrigin', 'https://other.example.invalid')]:
            with self.subTest(field=field), patch.object(installer.integration_deployment, 'transition_checkpoint') as transition:
                previous = self.plan[field]
                self.plan[field] = value
                self.save_plan()
                with self.assertRaisesRegex(ValueError, 'SAME_INSTALLATION_TRANSITION_REQUIRED'):
                    self.call()
                transition.assert_not_called()
                self.plan[field] = previous

    def test_pending_or_client_flags_cannot_complete_installer_gate(self):
        for update in ({'status': 'PENDING'}, {'installationAcceptance': {**self.acceptance, 'eligible': False}},
                       {'installationAcceptance': {**self.acceptance, 'automationVerified': 'true'}}):
            with self.subTest(update=update), \
                 patch.object(installer.integration_deployment, 'transition_checkpoint', return_value={**self.result, **update}):
                with self.assertRaisesRegex(ValueError, 'AUTHORITATIVE_AUTOMATION_INTEGRATION_REQUIRED'):
                    self.call()

    def test_recovery_requires_explicit_plan(self):
        with self.assertRaisesRegex(ValueError, 'EXPLICIT_CHECKPOINT_TRANSITION_PLAN_REQUIRED'):
            installer.verify_installation_integration(self.root, self.sample, ORG, ORIGIN, 'API_TOKEN', transition_recover=True)


if __name__ == '__main__':
    unittest.main()
