"""Regression of the actual deploy YAML: explicit SHADOW updates remain fail-closed."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import re
import subprocess
import sys
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/deploy-aurora-firebase.yml'


class HmlShadowUpdateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = yaml.load(WORKFLOW.read_text(encoding='utf-8'), Loader=yaml.BaseLoader)
        cls.preflight = next(s['run'] for s in cls.workflow['jobs']['deploy']['steps']
                             if s.get('name') == 'Preflight protected homologation resources')
        match = re.search(r"if ! jq -e --arg mode \"\$DEPLOYMENT_MODE\" '(.*?)' <<<\"\$org_json\" >/dev/null; then", cls.preflight, re.S)
        if not match:
            raise AssertionError('Actual organization gate not found')
        cls.org_filter = match.group(1)
        match = re.search(r"python3 - \"\$backup_snapshot\" \"\$backup_expiry\" <<'PY'\n(.*?)\nPY", cls.preflight, re.S)
        if not match:
            raise AssertionError('Actual backup recency gate not found')
        cls.backup_script = match.group(1)

    def organization(self, projection=False):
        fields = {k: {'booleanValue': v} for k, v in {
            'active': True, 'projectionEnabled': projection, 'organicEnabled': True,
            'clinicalSensitiveEnabled': False, 'productionMutation': False, 'sourceMutation': False,
        }.items()}
        fields.update({'environment': {'stringValue': 'HOMOLOGATION'},
                       'projectionMode': {'stringValue': 'SHADOW'},
                       'organicSectors': {'arrayValue': {'values': [{'stringValue': 'AUDIT'}, {'stringValue': 'FINANCE'}]}}})
        return {'fields': fields}

    def accepted(self, org, mode):
        result = subprocess.run(['jq', '-e', '--arg', 'mode', mode, self.org_filter],
                                input=json.dumps(org), text=True, capture_output=True, timeout=10)
        return result.returncode == 0

    def test_legacy_bootstrap_stays_projection_off(self):
        self.assertTrue(self.accepted(self.organization(False), 'BOOTSTRAP'))
        self.assertFalse(self.accepted(self.organization(True), 'BOOTSTRAP'))

    def test_explicit_update_requires_existing_shadow(self):
        self.assertTrue(self.accepted(self.organization(True), 'SHADOW_UPDATE'))
        self.assertFalse(self.accepted(self.organization(False), 'SHADOW_UPDATE'))

    def test_unknown_mode_is_not_an_update_authorization(self):
        for mode in ['', 'UPDATE', 'shadow_update', 'true', 'PRODUCTION']:
            for projection in [True, False]:
                with self.subTest(mode=mode, projection=projection):
                    self.assertFalse(self.accepted(self.organization(projection), mode))

    def test_booleans_are_strict_and_every_guardrail_remains_required(self):
        for field in ['active', 'projectionEnabled', 'organicEnabled', 'clinicalSensitiveEnabled', 'productionMutation', 'sourceMutation']:
            for value in [None, 'true', 'false', 0, 1]:
                with self.subTest(field=field, value=value):
                    org = self.organization(True)
                    org['fields'][field] = {'booleanValue': value}
                    self.assertFalse(self.accepted(org, 'SHADOW_UPDATE'))
            org = self.organization(True)
            del org['fields'][field]
            self.assertFalse(self.accepted(org, 'SHADOW_UPDATE'))
            org = self.organization(True)
            org['fields'][field]['booleanValue'] = not org['fields'][field]['booleanValue']
            self.assertFalse(self.accepted(org, 'SHADOW_UPDATE'))

    def test_production_or_nonshadow_environment_rejected(self):
        for field, value in [('environment', 'PRODUCTION'), ('environment', ''),
                             ('projectionMode', 'LIVE'), ('projectionMode', '')]:
            org = self.organization(True)
            org['fields'][field]['stringValue'] = value
            self.assertFalse(self.accepted(org, 'SHADOW_UPDATE'))

    def test_both_authorized_organic_sectors_required(self):
        for sectors in [[], ['AUDIT'], ['FINANCE'], ['CLINICAL']]:
            org = self.organization(True)
            org['fields']['organicSectors']['arrayValue']['values'] = [{'stringValue': s} for s in sectors]
            self.assertFalse(self.accepted(org, 'SHADOW_UPDATE'))

    def test_default_and_protected_environment_unchanged(self):
        mode = self.workflow['on']['workflow_dispatch']['inputs']['deployment_mode']
        self.assertEqual(mode['default'], 'BOOTSTRAP')
        self.assertEqual(mode['type'], 'choice')
        self.assertEqual(mode['options'], ['BOOTSTRAP', 'SHADOW_UPDATE'])
        deploy = self.workflow['jobs']['deploy']
        self.assertEqual(deploy['environment'], 'firebase-homologation')
        self.assertEqual(deploy['needs'], 'validate')
        self.assertEqual(deploy['if'], "${{ inputs.deploy_confirmation == 'DEPLOY_HOMOLOGATION' }}")
        self.assertEqual(self.workflow['on'].keys(), {'workflow_dispatch'})

    def test_shadow_update_cannot_proceed_without_ready_backup(self):
        match = re.search(r'if \[ "\$DEPLOYMENT_MODE" = "SHADOW_UPDATE" \] && \[ -z "\$backup_resource" \]; then\n.*?\nfi', self.preflight, re.S)
        self.assertIsNotNone(match)
        for mode, backup, expected in [('SHADOW_UPDATE', '', 46), ('SHADOW_UPDATE', 'ready-backup', 0), ('BOOTSTRAP', '', 0)]:
            script = 'set -euo pipefail\nDEPLOYMENT_MODE=' + mode + '\nbackup_resource=' + backup + '\n' + match.group(0)
            result = subprocess.run(['bash', '-c', script], capture_output=True, timeout=10)
            self.assertEqual(result.returncode, expected)

    def test_real_backup_validator_rejects_stale_future_expired_and_malformed(self):
        now = datetime.now(timezone.utc)
        recent = (now - timedelta(hours=1)).isoformat()
        future_expiry = (now + timedelta(days=7)).isoformat()
        cases = [(recent, future_expiry, 0),
                 ((now - timedelta(hours=25)).isoformat(), future_expiry, 47),
                 ((now + timedelta(hours=1)).isoformat(), future_expiry, 47),
                 (recent, (now - timedelta(seconds=1)).isoformat(), 47),
                 ('invalid', future_expiry, 47), ('', future_expiry, 47),
                 (now.replace(tzinfo=None).isoformat(), future_expiry, 47),
                 (recent, 'invalid', 47)]
        for snapshot, expiry, expected in cases:
            with self.subTest(snapshot=snapshot, expiry=expiry):
                result = subprocess.run([sys.executable, '-', snapshot, expiry], input=self.backup_script,
                                        text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, expected, result.stderr)

    def test_preflight_is_read_only_and_retains_recovery_and_membership_gates(self):
        self.assertNotIn('-X PATCH', self.preflight)
        self.assertNotIn('set-iam-policy', self.preflight)
        self.assertNotIn('secrets versions add', self.preflight)
        for required in ['DELETE_PROTECTION_ENABLED', 'POINT_IN_TIME_RECOVERY_ENABLED',
                         'members/${smoke_uid_path}', '.fields.allFacilities.booleanValue == true',
                         'AURORA_NEXUS_ALLOWED_EMAILS', 'AURORA_NEXUS_CSRF_HMAC_KEY',
                         '.fields.productionMutation.booleanValue == false',
                         'HML_ROOT_COLLECTIONS_INCOMPLETE']:
            self.assertIn(required, self.preflight)

    def test_root_collection_pagination_fails_closed(self):
        for payload, accepted in [({}, True), ({'nextPageToken': ''}, True), ({'nextPageToken': 'unseen'}, False)]:
            result = subprocess.run(['jq', '-e', '(.nextPageToken // "") == ""'],
                                    input=json.dumps(payload), text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode == 0, accepted)


if __name__ == '__main__':
    unittest.main()
