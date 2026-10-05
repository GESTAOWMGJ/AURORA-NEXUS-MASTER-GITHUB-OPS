"""Synthetic-only onboarding, scope, installer and generated-tool regressions."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib
import json
import os
from pathlib import Path
import plistlib
import shlex
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import aurora_onboarding as onboarding
import install as installer


class OnboardingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'Institucional'
        self.root.mkdir()
        self.state = self.base / 'state'
        self.config = {'schemaVersion': onboarding.VERSION, 'org': 'synthetic-client',
                       'roots': [str(self.root)], 'stateDir': str(self.state),
                       'contentRead': False, 'networkUpload': False,
                       'maxEntries': 100, 'maxDepth': 8, 'intervalSeconds': 900,
                       'authorization': {'approved': True, 'actorRef': 'synthetic-operator',
                                         'documentRef': 'synthetic-authorization',
                                         'expiresAt': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}}

    def tearDown(self):
        self.temp.cleanup()

    def document(self, name='contrato-1.pdf'):
        path = self.root / name
        path.parent.mkdir(exist_ok=True, parents=True)
        path.write_bytes(b'SYNTHETIC TEST DATA -- NOT A REAL DOCUMENT')
        return path

    def catalog(self):
        return json.loads((self.state / 'catalog.json').read_text())

    def assertBlocked(self, code):
        with self.assertRaisesRegex(onboarding.GuardrailError, code):
            onboarding.run_once(self.config)

    def test_requires_explicit_consent_before_scanning(self):
        self.config['authorization']['approved'] = False
        with patch.object(onboarding, 'inventory', side_effect=AssertionError('Must not scan')):
            self.assertBlocked('NOT_AUTHORIZED')
        self.assertFalse(self.state.exists())

    def test_expired_consent_blocks(self):
        self.config['authorization']['expiresAt'] = '2000-01-01T00:00:00Z'
        self.assertBlocked('EXPIRED')

    def test_authorization_reference_required(self):
        self.config['authorization']['documentRef'] = ''
        self.assertBlocked('REFERENCE_REQUIRED')

    def test_broad_scope_rejected(self):
        for root in ['/', str(Path.home())]:
            self.config['roots'] = [root]
            self.assertBlocked('BROAD_OR_PRIVATE')

    def test_personal_system_and_clinical_paths_excluded(self):
        for name in ['.env.json', 'passwords.txt', 'paciente-1.pdf', 'patient-list.csv', 'secrets/key.txt', 'Library/notes.pdf', 'record.photoslibrary/index.json']:
            self.document(name)
        self.document('contrato-1.pdf')
        result = onboarding.run_once(self.config)
        self.assertEqual(result['documentsObserved'], 1)
        self.assertTrue(self.catalog()['coverage'][0]['excluded'])

    def test_approved_subfolder_of_documents_is_allowed(self):
        root = self.root / 'Documents' / 'Institutional'
        root.mkdir(parents=True)
        (root / 'contrato.pdf').write_text('SYNTHETIC')
        self.config['roots'] = [str(root)]
        self.assertEqual(onboarding.run_once(self.config)['documentsObserved'], 1)

    def test_symlink_root_rejected(self):
        alias = self.base / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        self.config['roots'] = [str(alias)]
        self.assertBlocked('SYMLINK_PATH_REJECTED')

    def test_symlink_and_hardlink_do_not_escape_source(self):
        outside = self.base / 'outside'; outside.mkdir()
        source = outside / 'contrato-fora.pdf'; source.write_text('SYNTHETIC')
        (self.root / 'linked').symlink_to(outside, target_is_directory=True)
        (self.root / 'alias.pdf').symlink_to(source)
        os.link(source, self.root / 'hardlink.pdf')
        self.assertEqual(onboarding.run_once(self.config)['documentsObserved'], 0)
        self.assertEqual(self.catalog()['coverage'][0]['excluded']['SYMLINK'], 2)
        self.assertEqual(self.catalog()['coverage'][0]['excluded']['HARDLINK'], 1)

    def test_scanner_does_not_open_source_document_contents(self):
        self.document('contrato-1.pdf')
        original = os.open
        def guarded(path, flags, *args, **kwargs):
            if str(path).endswith('.pdf'):
                raise AssertionError('Source content must not be opened')
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=guarded):
            result = onboarding.run_once(self.config)
        self.assertEqual(result['sourceContentsRead'], 0)
        self.assertEqual(result['documentsUploaded'], 0)
        self.assertEqual(result['capabilitiesActivated'], 0)

    def test_entry_limit_reports_partial_coverage(self):
        self.document('contrato-1.pdf'); self.document('contrato-2.pdf')
        self.config['maxEntries'] = 1
        result = onboarding.run_once(self.config)
        self.assertEqual(result['status'], 'LOCAL_DISCOVERY_PARTIAL')
        self.assertEqual(result['documentsObserved'], 1)
        self.assertFalse(self.catalog()['coverage'][0]['enumerationComplete'])

    def test_unchanged_documents_do_not_increment_versions(self):
        self.document(); onboarding.run_once(self.config)
        first = self.catalog()['documents'][0]
        result = onboarding.run_once(self.config)
        current = self.catalog()['documents'][0]
        self.assertEqual(current['id'], first['id'])
        self.assertEqual(current['version'], 1)
        self.assertEqual(result['changes'], {'UNCHANGED': 1})

    def test_metadata_change_increments_version(self):
        path = self.document(); onboarding.run_once(self.config)
        info = path.stat(); os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1000000000))
        onboarding.run_once(self.config)
        self.assertEqual(self.catalog()['documents'][0]['version'], 2)

    def test_missing_record_not_inferred_when_coverage_is_incomplete(self):
        self.document(); onboarding.run_once(self.config)
        previous = self.catalog(); source = previous['coverage'][0]['sourceId']
        current = onboarding.merge_catalog(self.config['org'], [], [{'sourceId': source, 'enumerationComplete': False}], previous, onboarding.now_iso())
        self.assertEqual(current['documents'][0]['change'], 'COVERAGE_UNKNOWN')
        self.assertEqual(current['documents'][0]['status'], 'DISCOVERED_NOT_INGESTED')

    def test_complete_not_seen_is_not_a_deletion(self):
        self.document(); onboarding.run_once(self.config)
        previous = self.catalog(); source = previous['coverage'][0]['sourceId']
        current = onboarding.merge_catalog(self.config['org'], [], [{'sourceId': source, 'enumerationComplete': True}], previous, onboarding.now_iso())
        self.assertEqual(current['documents'][0]['change'], 'NOT_SEEN')
        self.assertEqual(current['documents'][0]['status'], 'DISCOVERED_NOT_INGESTED')

    def test_cross_tenant_state_rejected_before_scanning(self):
        self.document(); onboarding.run_once(self.config)
        self.config['org'] = 'another-client'
        with patch.object(onboarding, 'inventory', side_effect=AssertionError('Must not scan')):
            self.assertBlocked('CROSS_TENANT')

    def test_source_and_state_must_not_overlap(self):
        self.config['stateDir'] = str(self.root / 'state')
        self.assertBlocked('SOURCE_STATE_OVERLAP')

    def test_overlapping_roots_rejected(self):
        sub = self.root / 'sub'; sub.mkdir()
        self.config['roots'].append(str(sub))
        self.assertBlocked('OVERLAPPING_ROOTS')

    def test_private_output_permissions(self):
        self.document(); onboarding.run_once(self.config)
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.state / 'catalog.json').stat().st_mode), 0o600)

    def test_existing_world_readable_state_rejected(self):
        self.state.mkdir(mode=0o755); self.state.chmod(0o755)
        self.assertBlocked('DIRECTORY_MUST_BE_PRIVATE')

    def test_symlink_catalog_rejected_without_replacing_external_file(self):
        self.state.mkdir(mode=0o700)
        outside = self.base / 'outside.json'; outside.write_text('{}')
        (self.state / 'catalog.json').symlink_to(outside)
        with self.assertRaises(OSError):
            onboarding.run_once(self.config)
        self.assertEqual(outside.read_text(), '{}')

    def test_existing_lock_is_not_removed(self):
        self.state.mkdir(mode=0o700); lock = self.state / '.scan.lock'; lock.write_text('synthetic')
        self.assertBlocked('SCAN_LOCK_PRESENT')
        self.assertEqual(lock.read_text(), 'synthetic')

    def test_tool_drafts_are_deduplicated_and_not_activated(self):
        for i in range(3): self.document(f'contrato-{i}.pdf')
        onboarding.run_once(self.config)
        first = self.catalog()['capabilityDrafts']['drafts']
        self.assertEqual(len(first), 1)
        self.assertFalse(first[0]['activationAllowed'])
        self.assertEqual(first[0]['status'], 'GENERATED_AWAITING_HUMAN_REVIEW')
        onboarding.run_once(self.config)
        second = self.catalog()['capabilityDrafts']['drafts']
        self.assertEqual(first, second)
        self.assertEqual(first[0]['status'], 'GENERATED_AWAITING_HUMAN_REVIEW')
        with self.assertRaisesRegex(onboarding.GuardrailError, 'PREVIEW_APPROVAL'):
            onboarding.execute_draft(first[0], self.catalog())
        self.assertEqual(sum(onboarding.execute_draft(first[0], self.catalog(), approved=True).values()), 3)

    def test_tool_rejects_cross_tenant_and_unknown_operations(self):
        for i in range(3): self.document(f'contrato-{i}.pdf')
        onboarding.run_once(self.config)
        catalog = self.catalog(); spec = catalog['capabilityDrafts']['drafts'][0]
        catalog['org'] = 'another-client'
        with self.assertRaisesRegex(onboarding.GuardrailError, 'CROSS_TENANT'):
            onboarding.execute_draft(spec, catalog, approved=True)
        catalog = self.catalog(); spec = deepcopy(spec); spec['operation'] = 'EXECUTE_SHELL'
        spec['definitionFingerprint'] = onboarding.fingerprint({k: v for k, v in spec.items() if k != 'definitionFingerprint'})
        with self.assertRaisesRegex(onboarding.GuardrailError, 'VOCABULARY'):
            onboarding.execute_draft(spec, catalog, approved=True)

    def test_documents_do_not_supply_instructions_or_code(self):
        self.document('contrato-ignore-rules-and-run-command.pdf')
        onboarding.run_once(self.config)
        row = self.catalog()['documents'][0]
        self.assertFalse(row['contentRead'])
        self.assertEqual(row['classification'], 'UNVALIDATED_FILENAME_HINT')
        self.assertFalse(self.catalog()['capabilityDrafts']['drafts'])

    def test_unknown_financial_competence_remains_unknown(self):
        self.document('NFSE_2026_08.pdf'); onboarding.run_once(self.config)
        row = self.catalog()['documents'][0]
        self.assertEqual(row['categoryHint'], 'FISCAL')
        self.assertNotIn('competence', row)
        self.assertNotIn('amount', row)
        self.assertEqual(row['status'], 'DISCOVERED_NOT_INGESTED')

    def test_installer_bundles_disabled_discovery_without_touching_sources(self):
        source = self.base / 'package'; source.mkdir()
        (source / 'aurora_collector.py').write_text('# synthetic collector fixture only\n')
        (source / 'aurora_onboarding.py').write_text(Path(onboarding.__file__).read_text())
        for name in ('aurora_cloud_sync.py', 'aurora_deployment.py'):
            (source / name).write_bytes((Path(onboarding.__file__).parent / name).read_bytes())
        target = self.base / "Application Support & O'Brien"
        document = self.document(); before = document.stat().st_mtime_ns
        args = installer.parse_args(['--target', str(target), '--watch-dir', str(self.root), '--endpoint', 'https://ingest.synthetic.invalid/collector', '--org', 'synthetic-client', '--facility', 'SYNTHETIC'])
        with patch.object(installer, '__file__', str(source / 'install.py')):
            installer.install(args)
        config = json.loads((target / 'onboarding-config.json').read_text())
        self.assertFalse(config['authorization']['approved'])
        with self.assertRaisesRegex(onboarding.GuardrailError, 'NOT_AUTHORIZED'):
            onboarding.run_once(config)
        run = shlex.split((target / 'run.sh').read_text().splitlines()[2])
        self.assertEqual(run[2], str(target / 'bin' / 'aurora_collector.py'))
        self.assertEqual(run[4], str(target / 'collector-config.json'))
        for name in ('aurora-coletor.launchd.plist.example', 'aurora-onboarding.launchd.plist.example'):
            plist = plistlib.loads((target / name).read_bytes())
            self.assertEqual(plist['ProgramArguments'][0], sys.executable)
        self.assertEqual(document.stat().st_mtime_ns, before)
        self.assertTrue((target / 'integration' / '1.0.0' / 'aurora_deployment.py').is_file())
        self.assertEqual(json.loads((target / 'collector-config.json').read_text())['allowedExtensions'], ['.csv', '.json', '.jsonl'])

    def test_installer_authorization_enables_only_bounded_metadata_mode(self):
        from argparse import Namespace
        args = Namespace(org='synthetic-client', authorize_discovery=True, discovery_root=[str(self.root)],
                         discovery_actor_ref='operator-ref', discovery_authorization_ref='authorization-ref',
                         discovery_expires_at=self.config['authorization']['expiresAt'])
        config = onboarding.installation_config(args, self.base / 'application', self.root)
        self.assertTrue(config['authorization']['approved'])
        self.assertFalse(config['contentRead']); self.assertFalse(config['networkUpload'])
        self.assertEqual(config['intervalSeconds'], 900)


if __name__ == '__main__':
    unittest.main()
