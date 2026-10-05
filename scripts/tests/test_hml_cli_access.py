import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'firebase-migration/scripts'))
import hml_cli_access as access

ACCOUNT = 'synthetic@example.invalid'
PROJECT = {'projectId': access.PROJECT, 'projectNumber': access.NUMBER, 'lifecycleState': 'ACTIVE'}


class FakeCli:
    def __init__(self, profiles=None, accounts=None, project=None):
        self.profiles = profiles if profiles is not None else []
        self.accounts = accounts if accounts is not None else [{'account': ACCOUNT, 'status': 'ACTIVE'}]
        self.project = project if project is not None else PROJECT
        self.calls, self.logins = [], 0
        self.core = dict(self.profiles[0].get('properties', {}).get('core', {})) if self.profiles else {}

    def run(self, args):
        self.calls.append(args)
        if args[:3] == ['config', 'configurations', 'list']: return self.profiles
        if args[:2] == ['auth', 'list']: return self.accounts
        if args[:2] == ['projects', 'describe']: return self.project
        if args[:2] == ['config', 'set']: self.core[args[2].split('/')[-1]] = args[3]
        if args[:2] == ['config', 'list']: return {'core': self.core}

    def login(self):
        self.logins += 1
        self.core['account'] = ACCOUNT


def existing(project=access.PROJECT, account=ACCOUNT):
    return [{'name': access.PROFILE, 'properties': {'core': {'project': project, 'account': account}}}]


class CliAccessTests(unittest.TestCase):
    def test_default_is_plan_without_reading_credentials(self):
        with patch.object(access, 'Cli') as cli, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(access.main([]), 0)
        cli.assert_not_called()

    def test_setup_reuses_credential_and_writes_only_local_profile(self):
        cli = FakeCli(); result = access.setup(cli)
        self.assertEqual(cli.logins, 0)
        self.assertEqual(result['status'], 'LOCAL_PROFILE_READY')
        self.assertNotIn(ACCOUNT, json.dumps(result))
        self.assertFalse(result['tokenExported']); self.assertFalse(result['releaseApproved'])
        mutations = [x for x in cli.calls if x[:2] == ['config', 'set'] or x[:3] == ['config', 'configurations', 'create']]
        self.assertEqual(len(mutations), 3)
        self.assertIn('--no-activate', mutations[0])
        for args in mutations[1:]: self.assertIn('--configuration=' + access.PROFILE, args)
        self.assertLess(next(i for i,x in enumerate(cli.calls) if x[:2] == ['projects','describe']), cli.calls.index(mutations[0]))

    def test_existing_profile_is_idempotent_and_preserves_account(self):
        cli = FakeCli(profiles=existing(), accounts=[])
        access.setup(cli)
        self.assertFalse(any(x[:2] == ['config','set'] for x in cli.calls))
        self.assertFalse(any(x[:2] == ['auth','list'] for x in cli.calls))

    def test_different_project_never_overwritten_even_for_login(self):
        for login in (False, True):
            cli = FakeCli(profiles=existing('other-project'))
            with self.assertRaisesRegex(access.AccessError, 'PROFILE_PROJECT_CONFLICT'): access.setup(cli, login=login)
            self.assertEqual(len(cli.calls), 1); self.assertEqual(cli.logins, 0)

    def test_missing_ambiguous_or_unsafe_account_blocks_all_mutation(self):
        for accounts in ([], [None], [{'status':'INACTIVE'}], [{'status':'ACTIVE','account':'x&command'}], [{'status':'ACTIVE','account':ACCOUNT}]*2):
            cli = FakeCli(accounts=accounts)
            with self.assertRaises(access.AccessError): access.setup(cli)
            self.assertFalse(any(x[:2] == ['config','set'] for x in cli.calls))
            self.assertFalse(any('create' in x for x in cli.calls))

    def test_project_identity_mismatch_blocks_local_setup(self):
        for changed in ({'projectId':'other'}, {'projectNumber':'123456'}, {'lifecycleState':'DELETE_REQUESTED'}):
            cli = FakeCli(project={**PROJECT, **changed})
            with self.assertRaisesRegex(access.AccessError,'PROJECT_IDENTITY_UNVERIFIED'): access.setup(cli)
            self.assertFalse(any('create' in x for x in cli.calls))

    def test_login_requires_explicit_mode_and_does_not_use_default_account(self):
        cli = FakeCli(accounts=[])
        self.assertEqual(access.setup(cli, login=True)['status'], 'LOCAL_PROFILE_READY')
        self.assertEqual(cli.logins, 1)
        self.assertFalse(any(x[:2] == ['auth','list'] for x in cli.calls))

    def test_chrome_preference_is_process_local_and_login_is_profile_scoped(self):
        with tempfile.TemporaryDirectory() as root:
            chrome = Path(root) / 'Google/Chrome/Application/chrome.exe'
            chrome.parent.mkdir(parents=True); chrome.touch()
            cli = object.__new__(access.Cli); cli.executable='gcloud'; cli.env={'ProgramFiles':root, 'CLOUDSDK_CORE_DISABLE_PROMPTS':'1'}
            with patch.object(access, 'os', SimpleNamespace(name='nt')), patch.object(access.subprocess,'run', return_value=SimpleNamespace(returncode=0)) as run:
                cli.login()
            args, kwargs = run.call_args
            self.assertIn('--configuration=' + access.PROFILE, args[0])
            self.assertEqual(kwargs['env']['BROWSER'], '"' + str(chrome) + '" %s')
            self.assertNotIn('CLOUDSDK_CORE_DISABLE_PROMPTS',kwargs['env'])
            self.assertNotIn('BROWSER',cli.env)
            self.assertNotIn('--update-adc',args[0]); self.assertNotIn('--enable-gdrive-access',args[0])

    def test_errors_redact_raw_cli_output(self):
        cli = object.__new__(access.Cli); cli.executable='gcloud'; cli.env={}
        with patch.object(access.subprocess,'run',return_value=SimpleNamespace(returncode=1,stderr='403 secret-marker')):
            with self.assertRaisesRegex(access.AccessError,'^READ_PERMISSION_DENIED$'): cli.run(['projects','describe',access.PROJECT])


if __name__ == '__main__': unittest.main()
