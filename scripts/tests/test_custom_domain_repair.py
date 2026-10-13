"""Execute the real custom-domain Bash step offline with synthetic API responses."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

from test_hml_auth_contract import load_workflow, WORKFLOWS

PROJECT = 'wmgj-hml-jfn-20260927'
SITE = f'projects/{PROJECT}/sites/{PROJECT}'
RESOURCE = f'{SITE}/customDomains/auroranexus.com.br'

# A shell function intercepts every curl invocation; unexpected requests fail closed.
MOCK = r'''
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
url = args[-1]
method = args[args.index('-X') + 1] if '-X' in args else 'GET'
payload = json.loads(args[args.index('--data') + 1]) if '--data' in args else None
root = Path(os.environ['MOCK_ROOT'])
with (root / 'requests.jsonl').open('a') as log:
    log.write(json.dumps({'method': method, 'url': url, 'payload': payload}) + '\n')
site = os.environ['MOCK_SITE']
resource = os.environ['MOCK_RESOURCE']
base = 'https://firebasehosting.googleapis.com/v1beta1/'
scenario = os.environ['MOCK_SCENARIO']
domain = {'name': resource, 'hostState': 'HOST_ACTIVE',
          'ownershipState': os.environ['MOCK_OWNER'], 'cert': {'state': 'CERT_ACTIVE'},
          'reconciling': False}
if scenario == 'undelete':
    domain.update(deleteTime='2026-01-01T00:00:00Z', etag='synthetic-etag')
code, body = '200', {}
if method == 'GET' and url == base + site:
    body = {'name': site, 'defaultUrl': 'https://' + os.environ['PROJECT_ID'] + '.web.app'}
elif method == 'GET' and url == base + site + '/customDomains?pageSize=100&showDeleted=true':
    body = {'customDomains': [] if scenario == 'create' else [domain]}
elif method == 'GET' and url == base + resource:
    count_file = root / 'gets'
    count = int(count_file.read_text()) if count_file.exists() else 0
    count_file.write_text(str(count + 1))
    code, body = ('404', {}) if scenario == 'create' and count == 0 else ('200', domain)
elif method == 'GET' and url == base + 'projects/' + os.environ['PROJECT_ID'] + '/sites?pageSize=100':
    body = {'sites': [{'name': site}]}
elif method == 'POST' and scenario == 'create' and url in (
        base + site + '/customDomains?customDomainId=auroranexus.com.br&validateOnly=true',
        base + site + '/customDomains?customDomainId=auroranexus.com.br'):
    assert payload == {}
    body = {'name': 'operations/synthetic-create'}
elif method == 'POST' and scenario == 'undelete' and url == base + resource + ':undelete':
    assert payload in ({'validateOnly': True, 'etag': 'synthetic-etag'},
                       {'validateOnly': False, 'etag': 'synthetic-etag'})
    body = {'name': 'operations/synthetic-undelete'}
else:
    sys.exit('UNEXPECTED_REQUEST: ' + method + ' ' + url)
Path(args[args.index('-o') + 1]).write_text(json.dumps(body))
print(code, end='')
'''


class CustomDomainRepairTests(unittest.TestCase):
    def execute(self, scenario, mode='REPAIR_HML_DOMAIN', owner='OWNERSHIP_MISMATCH', original=False):
        workflow = load_workflow(WORKFLOWS / 'repair-aurora-custom-domain.yml')
        script = next(s['run'] for s in workflow['jobs']['repair']['steps']
                      if s.get('name') == 'Inspect and repair exact custom domain')
        if original:
            script = script.replace('mutationPerformed:($action == "CREATE_REQUESTED" or $action == "UNDELETE_REQUESTED")',
                                    'mutationPerformed:false')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mock = root / 'mock.py'
            mock.write_text(MOCK)
            env = dict(os.environ, PROJECT_ID=PROJECT, APPROVED_PROJECT=PROJECT,
                       DEPLOY_SERVICE_ACCOUNT='synthetic-service-account',
                       REPAIR_CONFIRMATION=mode, DOMAIN='auroranexus.com.br', RUNNER_TEMP=tmp,
                       MOCK_ROOT=tmp, MOCK_SITE=SITE, MOCK_RESOURCE=RESOURCE,
                       MOCK_SCENARIO=scenario, MOCK_OWNER=owner)
            for key in ('BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS'):
                env.pop(key, None)
            prefix = ('gcloud() { case "$*" in\n'
                      "  'auth list --filter=status:ACTIVE --format=value(account)') printf '%s' synthetic-service-account ;;\n"
                      "  'auth print-access-token') printf '%s' SYNTHETIC_TOKEN ;;\n"
                      '  *) return 99 ;; esac; }\n'
                      'sleep() { :; }\n'
                      'curl() { ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(mock)) + ' "$@"; }\n')
            result = subprocess.run(['bash', '--noprofile', '--norc', '-c', prefix + script],
                                    env=env, capture_output=True, text=True, timeout=20)
            evidence = {p.name: json.loads(p.read_text()) for p in root.glob('aurora-custom-domain*.json')}
            requests = [json.loads(line) for line in (root / 'requests.jsonl').read_text().splitlines()]
            self.assertNotIn('Authorization:', result.stdout + result.stderr)
            return result, evidence, requests

    def check_wait(self, scenario, action, mutated, mode='REPAIR_HML_DOMAIN'):
        result, evidence, requests = self.execute(scenario, mode)
        self.assertEqual(result.returncode, 84, result.stderr)
        wait = evidence['aurora-custom-domain-ownership-wait.json']
        self.assertEqual(wait['stage'], 'WAITING_FOR_FIREBASE_OWNERSHIP_RECHECK')
        self.assertEqual(wait['ownershipState'], 'OWNERSHIP_MISMATCH')
        self.assertEqual(wait['action'], action)
        self.assertIs(wait['mutationPerformed'], mutated)
        self.assertIs(wait['dnsChanged'], False)
        self.assertIs(wait['iamChanged'], False)
        self.assertEqual(evidence['aurora-custom-domain-evidence.json']['action'], action)
        mutations = [r for r in requests if r['method'] != 'GET'
                     and 'validateOnly=true' not in r['url']
                     and (r['payload'] or {}).get('validateOnly') is not True]
        self.assertEqual(len(mutations), int(mutated))
        return requests

    def test_existing_mismatch_is_read_only_even_with_repair_authorized(self):
        requests = self.check_wait('existing', 'EXISTING_EXPECTED_SITE', False)
        self.assertTrue(all(r['method'] == 'GET' for r in requests))

    def test_authorized_create_reports_successful_mutation_while_waiting(self):
        self.check_wait('create', 'CREATE_REQUESTED', True)

    def test_authorized_undelete_reports_successful_mutation_while_waiting(self):
        self.check_wait('undelete', 'UNDELETE_REQUESTED', True)

    def test_validate_only_never_mutates_or_emits_repair_wait(self):
        for scenario, action in [('existing', 'EXISTING_EXPECTED_SITE'),
                                 ('create', 'CREATE_REQUIRED'), ('undelete', 'UNDELETE_REQUIRED')]:
            with self.subTest(scenario=scenario):
                result, evidence, requests = self.execute(scenario, 'VALIDATE_ONLY')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('aurora-custom-domain-ownership-wait.json', evidence)
                self.assertEqual(evidence['aurora-custom-domain-evidence.json']['action'], action)
                for r in requests:
                    if r['method'] != 'GET':
                        self.assertTrue('validateOnly=true' in r['url'] or r['payload']['validateOnly'] is True)

    def test_active_ownership_does_not_emit_wait(self):
        for scenario in ('existing', 'create', 'undelete'):
            with self.subTest(scenario=scenario):
                result, evidence, _ = self.execute(scenario, owner='OWNERSHIP_ACTIVE')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('aurora-custom-domain-ownership-wait.json', evidence)

    def test_original_receipt_contradicts_recorded_create_and_undelete(self):
        for scenario in ('create', 'undelete'):
            with self.subTest(scenario=scenario):
                result, evidence, requests = self.execute(scenario, original=True)
                self.assertEqual(result.returncode, 84, result.stderr)
                self.assertIs(evidence['aurora-custom-domain-ownership-wait.json']['mutationPerformed'], False)
                self.assertTrue(any(r['method'] == 'POST' and 'validateOnly=true' not in r['url']
                                    and (r['payload'] or {}).get('validateOnly') is not True for r in requests))


if __name__ == '__main__':
    unittest.main()
