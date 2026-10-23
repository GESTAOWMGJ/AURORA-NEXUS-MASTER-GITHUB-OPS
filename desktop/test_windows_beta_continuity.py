import base64
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
import zipfile
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('continuity_installer', Path(__file__).with_name('install_windows_beta.py'))
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)
OLD_PORTAL = 'https://wmgj-hml-jfn-20260927.web.app'
OLD_SOURCE = '354f611f642ce6b62c489d6b06f254587aaef84b'
OLD_SCRIPT_HASH = '1b2a7c7b3c842c9dbc884111ea9c6ead091bb196200793e763cb5d2c319c7a92'


class Response:
    def __init__(self, code, content, kind='text/html'):
        self.code = code
        self.content = content.encode()
        self.headers = {'Content-Type': kind}
    def read(self, _limit): return self.content
    def __enter__(self): return self
    def __exit__(self, *args): pass


LOGIN = '<form id="login-form"><input id="email" type="email"><input id="password" type="password"><button id="submit" type="submit">Entrar</button></form>'


class CanonicalProbeTests(unittest.TestCase):
    def probe_with(self, canonical_html=LOGIN, bootstrap_status=401, bootstrap_code='AUTH_REQUIRED',
                   auth_project='wmgj-hml-jfn-20260927', auth_status=200):
        self.urls = []

        def open_request(request, **_kwargs):
            url = request.full_url
            self.urls.append(url)
            # Healthy fallback deliberately differs from the canonical destination.
            if url.startswith(OLD_PORTAL):
                if url.endswith('/login'):
                    return Response(200, '<title>Aurora Nexus | Login</title>' + LOGIN)
                return Response(401, '{"code":"AUTH_REQUIRED"}', 'application/json')
            if url == installer.BASE:
                return Response(200, canonical_html)
            if url == 'https://auroranexus.com.br/api/bootstrap':
                return Response(bootstrap_status, json.dumps({'code': bootstrap_code}), 'application/json')
            if url == 'https://auroranexus.com.br/__/firebase/init.json':
                return Response(auth_status, json.dumps({'projectId':auth_project, 'apiKey':'synthetic-never-log'}), 'application/json')
            if url == 'https://auroranexus.com.br/portal/api/bootstrap':
                return Response(307, '<title>Redirect to /portal</title>')
            return Response(401, '{"code":"AUTH_REQUIRED"}', 'application/json')

        with patch.object(installer.urllib.request, 'build_opener', return_value=SimpleNamespace(open=open_request)):
            return installer.probe()

    def test_healthy_fallback_cannot_approve_public_canonical_vision_and_404_api(self):
        with self.assertRaises(ValueError):
            self.probe_with('<title>Visão</title><main>Visão</main>', 404, 'NOT_FOUND')

    def test_title_alone_does_not_establish_login_first(self):
        with self.assertRaises(ValueError):
            self.probe_with('<title>Aurora Nexus | Login</title>')

    def test_same_origin_login_form_and_denied_bootstrap_are_required(self):
        proof = self.probe_with()
        self.assertEqual(proof['probedPortal'], installer.BASE)
        self.assertTrue(proof['sameOriginBootstrapVerified'])
        self.assertTrue(proof['sameOriginAuthProjectVerified'])
        self.assertNotIn('synthetic-never-log', json.dumps(proof))
        self.assertFalse(any(url.startswith(OLD_PORTAL) for url in self.urls))
        self.assertIn('https://auroranexus.com.br/api/bootstrap', self.urls)
        self.assertNotIn('https://auroranexus.com.br/portal/api/bootstrap', self.urls)

    def test_redirected_or_public_or_missing_bootstrap_is_rejected(self):
        for status, code in [(200, 'OK'), (307, 'AUTH_REQUIRED'), (404, 'NOT_FOUND'), (401, 'OTHER')]:
            with self.subTest(status=status, code=code), self.assertRaises(ValueError):
                self.probe_with(bootstrap_status=status, bootstrap_code=code)

    def test_wrong_or_unreachable_auth_namespace_is_rejected(self):
        for project, status in [('wmgj-ops', 200), (None, 200), ('wmgj-hml-jfn-20260927', 404),
                                ('wmgj-hml-jfn-20260927', 307)]:
            with self.subTest(project=project, status=status), self.assertRaisesRegex(ValueError, 'AUTH_PROJECT'):
                self.probe_with(auth_project=project, auth_status=status)

    def test_disabled_split_or_external_login_form_is_rejected(self):
        invalid = [LOGIN.replace('type="submit"', 'type="submit" disabled'),
                   LOGIN.replace('<input ', '<input form="other" ').replace('<button ', '<button form="other" '),
                   LOGIN.replace('<input id="email"', '<fieldset disabled><input id="email"').replace('</form>', '</fieldset></form>'),
                   '<fieldset disabled>' + LOGIN + '</fieldset>',
                   LOGIN.replace('<form id="login-form">', '<form id="login-form" action="https://other.example/login">'),
                   LOGIN.replace('<form id="login-form">', '<form id="login-form" action="javascript:void(0)">'),
                   '<form id="login-form"><input id="email" type="email"></form>'
                   '<form id="login-form"><input id="password" type="password"><button id="submit" type="submit">Go</button></form>']
        for html in invalid:
            with self.subTest(html=html), self.assertRaisesRegex(ValueError, 'LOGIN_NOT_VERIFIED'):
                self.probe_with(html)


class WindowsContinuityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.local = self.directory / 'local'
        self.roaming = self.directory / 'roaming'
        self.user = self.directory / 'user'
        self.programs = self.directory / 'programs'
        self.edge = self.programs / 'Microsoft/Edge/Application/msedge.exe'
        self.edge.parent.mkdir(parents=True)
        self.edge.write_bytes(b'synthetic-edge')
        self.root = self.local / 'AuroraNexus'
        self.target = self.root / 'client' / installer.VERSION
        self.target.mkdir(parents=True)
        self.link = self.roaming / 'Microsoft/Windows/Start Menu/Programs/AURORA NEXUS.lnk'
        self.link.parent.mkdir(parents=True)
        self.link.write_text(json.dumps({'target': str(self.edge), 'arguments': '--app=' + OLD_PORTAL + '/', 'workingDirectory': str(self.target)}))
        self.manifest_path = self.target / 'installation.json'
        self.previous = {
            'clientVersion': installer.VERSION, 'portal': OLD_PORTAL,
            'frontendPolicy': 'PRESERVE_DEPLOYED_MAIN', 'reviewedMainSha': OLD_SOURCE,
            'environment': 'HML', 'offlineBusinessApp': False,
            'installedAtUtc': '2026-10-01T12:00:00+00:00', 'shortcuts': [str(self.link)],
            'launchTarget': str(self.edge), 'sourceScriptSha256': OLD_SCRIPT_HASH,
            'integrationComponent': {'version': '1.0.0', 'alreadyInstalled': False},
            'probe': {'loginReachable': True, 'anonymousAccessDenied': True},
            'gatewayDatabaseChanged': False, 'cloudDeploymentPerformed': False,
            'productionReleased': False, 'macUpdated': False, 'iosNativeAppBuilt': False,
            'customSetting': {'preserve': True},
        }
        self.write_previous()
        self.data = self.root / 'integration/state'
        self.data.mkdir(parents=True)
        (self.data / 'synthetic-settings.json').write_text('{"keep":true}')
        self.original_manifest = self.manifest_path.read_bytes()
        self.original_link = self.link.read_bytes()
        self.environment = dict(os.environ, LOCALAPPDATA=str(self.local), APPDATA=str(self.roaming),
                                USERPROFILE=str(self.user), PROGRAMFILES=str(self.programs), **{'PROGRAMFILES(X86)':str(self.programs)})
        fake_os = SimpleNamespace(**os.__dict__)
        fake_os.name = 'nt'
        fake_os.environ = self.environment
        self.os_patch = patch.object(installer, 'os', fake_os)
        self.os_patch.start()
        self.addCleanup(self.os_patch.stop)
        self.source_patch=patch.object(installer,'package_source',return_value=installer.SOURCE_SHA)
        self.source_patch.start();self.addCleanup(self.source_patch.stop)
        self.proof = {'atUtc': '2026-10-07T12:00:00+00:00', 'loginReachable': True,
                      'anonymousAccessDenied': True, 'probedPortal': installer.BASE,
                      'sameOriginBootstrapVerified': True, 'authenticatedSyncVerified': False,
                      'sameOriginAuthProjectVerified': True,
                      'realDataCopied': False, 'checks': []}

    def write_previous(self):
        self.manifest_path.write_text(json.dumps(self.previous), encoding='utf-8')

    def shell(self, command, **_kwargs):
        script = base64.b64decode(command[-1]).decode('utf-16le')
        paths = re.findall(r"CreateShortcut\('((?:[^']|'')*)'\)", script)
        paths = [Path(value.replace("''", "'")) for value in paths]
        if 'READ_ONLY_SHORTCUT' in script:
            return SimpleNamespace(returncode=0, stdout=paths[0].read_text())
        for path in paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({'target': str(self.edge), 'arguments': '--app=' + installer.BASE,
                                       'workingDirectory': str(self.target)}))
        return SimpleNamespace(returncode=0, stdout='')

    def run_install(self, probe=None, shell=None, integration=None):
        with patch.object(installer, 'probe', side_effect=probe or (lambda:self.proof)), \
             patch.object(installer,'verify_installation_integration',side_effect=integration or (lambda *args:{'eligible':True,'automationVerified':True})), \
             patch.object(installer.subprocess, 'run', side_effect=shell or self.shell), \
             contextlib.redirect_stdout(io.StringIO()):
            return installer.install()

    def backup(self):
        return next((self.root / 'installation-rollbacks').iterdir())

    def run_rollback(self, backup=None, shell=None):
        with patch.object(installer.subprocess, 'run', side_effect=shell or self.shell), contextlib.redirect_stdout(io.StringIO()):
            installer.rollback(backup or self.backup())

    def assert_original(self):
        self.assertEqual(self.manifest_path.read_bytes(), self.original_manifest)
        self.assertEqual(self.link.read_bytes(), self.original_link)
        self.assertEqual((self.data / 'synthetic-settings.json').read_text(), '{"keep":true}')

    def test_known_previous_beta4_is_migrated_in_place_with_backup(self):
        self.run_install()
        current = json.loads(self.manifest_path.read_text())
        self.assertEqual(current['clientVersion'], installer.VERSION)
        self.assertEqual(current['portal'], installer.BASE)
        self.assertEqual(current['customSetting'], {'preserve':True})
        self.assertEqual(current['installedAtUtc'], self.previous['installedAtUtc'])
        self.assertEqual(json.loads(self.link.read_text())['arguments'], '--app=' + installer.BASE)
        self.assertEqual((self.data / 'synthetic-settings.json').read_text(), '{"keep":true}')
        backups = list((self.root / 'installation-rollbacks').glob('*/receipt.json'))
        self.assertEqual(len(backups), 1)

    def test_unhealthy_destination_blocks_before_backup_or_writes(self):
        def deny():
            raise ValueError('CANONICAL_PORTAL_LOGIN_NOT_VERIFIED')
        with self.assertRaisesRegex(ValueError, 'CANONICAL_PORTAL'):
            self.run_install(probe=deny)
        self.assertEqual(self.manifest_path.read_bytes(), self.original_manifest)
        self.assertEqual(self.link.read_bytes(), self.original_link)
        self.assertFalse((self.root / 'installation-rollbacks').exists())

    def test_unverified_integration_does_not_backup_replace_or_claim_installed(self):
        def pending(*args):raise ValueError('AUTHENTICATED_AUTOMATION_INTEGRATION_REQUIRED')
        with self.assertRaisesRegex(ValueError,'AUTHENTICATED_AUTOMATION'):
            self.run_install(integration=pending)
        self.assert_original();self.assertFalse((self.root/'installation-rollbacks').exists())

    def test_method_hint_without_real_source_agent_is_rejected_before_state_creation(self):
        for method in ('CLOUD_OAUTH','LOCAL_AGENT'):
            with self.assertRaisesRegex(ValueError,'EXISTING_AUTHORIZED_SOURCE_AGENT_REQUIRED'):
                installer.verify_installation_integration(self.root,None,None,None,method)
        self.assert_original()

    def test_no_approved_sample_does_not_create_another_checkpoint(self):
        with self.assertRaisesRegex(ValueError,'AUTHENTICATED_AUTOMATION'):
            installer.verify_installation_integration(self.root,None,None,None,'API_TOKEN')
        self.assertFalse((self.data/'integration-setup.json').exists());self.assert_original()

    def test_unknown_identity_or_promoted_gate_is_rejected_before_probe(self):
        fields = [('portal', 'https://other.example/portal'), ('reviewedMainSha', '0' * 40),
                  ('sourceScriptSha256', '0' * 64), ('frontendPolicy', 'OTHER'),
                  ('offlineBusinessApp', True), ('productionReleased', True),
                  ('technicalSmokeBase', OLD_PORTAL)]
        for key, value in fields:
            with self.subTest(key=key):
                original = dict(self.previous)
                self.previous[key] = value
                self.write_previous()
                before = self.manifest_path.read_bytes()
                with patch.object(installer, 'probe') as probe, self.assertRaisesRegex(ValueError, 'IDENTITY_CONFLICT'):
                    installer.install()
                probe.assert_not_called()
                self.assertEqual(self.manifest_path.read_bytes(), before)
                self.previous = original
                self.write_previous()
        self.assertFalse((self.root / 'installation-rollbacks').exists())

    def test_known_canonical_baseline_with_original_trailing_slash_is_compatible(self):
        self.previous.update(portal=installer.BASE, technicalSmokeBase=OLD_PORTAL,
                             frontendPolicy='CANONICAL_PORTAL_SINGLE_ENTRY', reviewedMainSha=installer.SOURCE_SHA,
                             sourceScriptSha256='f33f138b018e39275055418563a3a1c4ff34a92eed0747b95a34e84525abda78')
        self.write_previous()
        link = json.loads(self.link.read_text())
        link['arguments'] = '--app=' + installer.BASE + '/'
        self.link.write_text(json.dumps(link))
        self.run_install()
        self.assertEqual(json.loads(self.link.read_text())['arguments'], '--app=' + installer.BASE)

    def test_reinstall_preserves_identity_and_unknown_settings(self):
        self.run_install()
        self.run_install()
        current = json.loads(self.manifest_path.read_text())
        self.assertEqual(current['clientVersion'], installer.VERSION)
        self.assertEqual(current['customSetting'], {'preserve':True})
        self.assertEqual(current['installedAtUtc'], self.previous['installedAtUtc'])
        self.assertEqual(len(list((self.root / 'installation-rollbacks').glob('*/receipt.json'))), 2)

    def test_fallback_or_incomplete_proof_cannot_approve_migration(self):
        for key, value in [('probedPortal', OLD_PORTAL), ('sameOriginBootstrapVerified', False),
                           ('sameOriginAuthProjectVerified', False)]:
            with self.subTest(key=key):
                proof = dict(self.proof, **{key:value})
                with self.assertRaisesRegex(ValueError, 'CANONICAL_PORTAL_PROOF_REQUIRED'):
                    self.run_install(probe=lambda:proof)
                self.assert_original()
                self.assertFalse((self.root / 'installation-rollbacks').exists())

    def test_manifest_or_shortcut_changed_during_probe_is_not_overwritten(self):
        for path in [self.manifest_path, self.link]:
            with self.subTest(path=path.name):
                original = path.read_bytes()
                def change():
                    path.write_bytes(b'concurrent-writer')
                    return self.proof
                with self.assertRaisesRegex(ValueError, 'CHANGED_REQUIRES_REVIEW'):
                    self.run_install(probe=change)
                self.assertEqual(path.read_bytes(), b'concurrent-writer')
                self.assertFalse((self.root / 'installation-rollbacks').exists())
                path.write_bytes(original)

    def test_stale_install_lock_is_preserved_and_blocks_writes(self):
        lock = self.root / 'client/.beta4-install.lock'
        lock.write_bytes(b'another-installer')
        with self.assertRaisesRegex(ValueError, 'BUSY_OR_INTERRUPTED'):
            self.run_install()
        self.assertEqual(lock.read_bytes(), b'another-installer')
        self.assert_original()
        self.assertFalse((self.root / 'installation-rollbacks').exists())

    def test_failed_staging_does_not_change_registered_client(self):
        def fail(command, **kwargs):
            script = base64.b64decode(command[-1]).decode('utf-16le')
            if 'READ_ONLY_SHORTCUT' not in script:
                raise subprocess.CalledProcessError(1, ['synthetic-powershell'])
            return self.shell(command, **kwargs)
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_install(shell=fail)
        self.assert_original()

    def test_failed_manifest_commit_automatically_restores_shortcuts(self):
        replace = installer.replace_unchanged
        def fail(path, before, after):
            if path == self.manifest_path:
                raise OSError('synthetic-commit-failure')
            return replace(path, before, after)
        with patch.object(installer, 'replace_unchanged', side_effect=fail), self.assertRaises(OSError):
            self.run_install()
        self.assert_original()
        self.assertEqual(json.loads((self.backup() / 'receipt.json').read_text())['state'], 'ROLLED_BACK')

    def test_manual_rollback_restores_exact_previous_client_and_preserves_data(self):
        self.run_install()
        backup = self.backup()
        self.run_rollback(backup)
        self.assert_original()
        self.assertEqual(json.loads((backup / 'receipt.json').read_text())['state'], 'ROLLED_BACK')

    def test_rollback_rejects_changed_client_without_overwriting_it(self):
        self.run_install()
        current_manifest = self.manifest_path.read_bytes()
        self.link.write_bytes(b'concurrent-writer')
        with self.assertRaisesRegex(ValueError, 'CHANGED_REQUIRES_REVIEW'):
            self.run_rollback()
        self.assertEqual(self.link.read_bytes(), b'concurrent-writer')
        self.assertEqual(self.manifest_path.read_bytes(), current_manifest)

    def test_rollback_rejects_tampered_backup(self):
        self.run_install()
        current = self.manifest_path.read_bytes(), self.link.read_bytes()
        (self.backup() / 'before-shortcut-0.lnk').write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'BACKUP_INTEGRITY_FAILED'):
            self.run_rollback()
        self.assertEqual((self.manifest_path.read_bytes(), self.link.read_bytes()), current)

    def test_rollback_partial_failure_restores_current_client(self):
        self.run_install()
        current = self.manifest_path.read_bytes(), self.link.read_bytes()
        replace = installer.replace_unchanged
        def fail(path, before, after):
            if path == self.manifest_path:
                raise OSError('synthetic-rollback-failure')
            return replace(path, before, after)
        with patch.object(installer, 'replace_unchanged', side_effect=fail), self.assertRaises(OSError):
            self.run_rollback()
        self.assertEqual((self.manifest_path.read_bytes(), self.link.read_bytes()), current)
        self.assertEqual(json.loads((self.backup() / 'receipt.json').read_text())['state'], 'COMMITTED')

    def test_hardlinked_manifest_is_rejected(self):
        other = self.target / 'other.json'
        os.link(self.manifest_path, other)
        with self.assertRaises(ValueError):
            self.run_install()
        self.assert_original()

    def test_registered_shortcut_changed_during_staging_is_preserved(self):
        def change(command, **kwargs):
            result = self.shell(command, **kwargs)
            script = base64.b64decode(command[-1]).decode('utf-16le')
            if 'READ_ONLY_SHORTCUT' not in script:
                self.link.write_bytes(b'concurrent-staging-writer')
            return result
        with self.assertRaisesRegex(ValueError, 'CHANGED_REQUIRES_REVIEW'):
            self.run_install(shell=change)
        self.assertEqual(self.link.read_bytes(), b'concurrent-staging-writer')
        self.assertEqual(self.manifest_path.read_bytes(), self.original_manifest)

    def test_added_optional_desktop_shortcut_is_removed_by_rollback(self):
        desktop = self.user / 'Desktop/AURORA JFN - Inicio'
        desktop.mkdir(parents=True)
        new_link = desktop / 'AURORA NEXUS.lnk'
        self.run_install()
        self.assertTrue(new_link.is_file())
        self.run_rollback()
        self.assertFalse(new_link.exists())
        self.assert_original()

    @unittest.skipUnless(os.name == 'nt', 'Native WScript shortcut roundtrip requires Windows')
    def test_native_windows_shortcuts_migrate_and_rollback_in_scratch_only(self):
        native_run = subprocess.run
        with patch.object(installer, 'BASE', OLD_PORTAL + '/'):
            installer.write_shortcuts(self.target, self.edge, [self.link])
        import ctypes
        short = ctypes.create_unicode_buffer(32768)
        short_name = ctypes.windll.kernel32.GetShortPathNameW
        short_name.argtypes = (ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint)
        short_name.restype = ctypes.c_uint
        length = short_name(str(self.directory), short, len(short))
        self.assertGreater(length, 0)
        self.assertLess(length, len(short))
        short_root = Path(short.value)
        installer.verify_shortcut(self.link, short_root / self.target.relative_to(self.directory),
                                  short_root / self.edge.relative_to(self.directory), OLD_PORTAL + '/')
        self.original_link = self.link.read_bytes()
        self.run_install(shell=native_run)
        installer.verify_shortcut(self.link, self.target, self.edge, installer.BASE)
        self.run_rollback(shell=native_run)
        self.assert_original()

    def test_new_client_installation_uses_same_gate_and_preserves_existing_data(self):
        self.manifest_path.unlink()
        self.target.rmdir()
        self.link.unlink()
        native_run = subprocess.run if os.name == 'nt' else self.shell
        self.run_install(shell=native_run)
        current = json.loads(self.manifest_path.read_text())
        self.assertEqual(current['clientVersion'], installer.VERSION)
        self.assertEqual(current['portal'], installer.BASE)
        self.assertFalse(current['productionReleased'])
        self.assertEqual((self.data / 'synthetic-settings.json').read_text(), '{"keep":true}')

    def test_reparse_ancestor_is_rejected_on_python_without_is_junction(self):
        lstat = Path.lstat
        def attributes(path):
            if path == self.target:
                return SimpleNamespace(st_file_attributes=0x400)
            return lstat(path)
        with patch.object(installer, 'deployment_safe_path', side_effect=lambda path:path), \
             patch.object(Path, 'lstat', attributes), self.assertRaisesRegex(ValueError, 'LINK_PATH_REJECTED'):
            installer.file_bytes(self.manifest_path)
        self.assert_original()

    def test_unknown_prior_version_cannot_authorize_overwriting_a_shortcut(self):
        self.manifest_path.unlink()
        self.target.rmdir()
        prior = self.root / 'client/unknown-version/installation.json'
        prior.parent.mkdir()
        prior.write_text(json.dumps(dict(self.previous, clientVersion='unknown-version')))
        with patch.object(installer, 'probe') as probe, self.assertRaisesRegex(ValueError, 'EXISTING_INSTALLATION_REQUIRES_REVIEW'):
            installer.install()
        probe.assert_not_called()
        self.assertEqual(self.link.read_bytes(), self.original_link)
        self.assertFalse((self.root / 'installation-rollbacks').exists())

    def test_shortcut_verification_keeps_exact_url_and_directory_identity(self):
        expected = {'target':str(self.edge), 'arguments':'--app=' + installer.BASE,
                    'workingDirectory':str(self.target)}
        for key, value in [('arguments', '--app=' + installer.BASE + '/'),
                           ('target', str(self.edge.with_name('other.exe'))),
                           ('workingDirectory', str(self.target.parent))]:
            with self.subTest(key=key), patch.object(installer, 'read_shortcut', return_value=dict(expected, **{key:value})), \
                 self.assertRaisesRegex(ValueError, 'SHORTCUT_IDENTITY_CONFLICT'):
                installer.verify_shortcut(self.link, self.target, self.edge, installer.BASE)


class SignedPublishedContinuityTests(unittest.TestCase):
    """Real Ed25519/ZIP/checkpoint validators, synthetic transport and scratch paths only."""

    def setUp(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'aurora-coletor/tests'))
        from test_checkpoint_transition import CheckpointTransitionTests
        import published_release as release
        self.release, self.deployment = release, installer.integration_deployment
        self.errors = (ValueError, release.ReleaseError)
        self.f = CheckpointTransitionTests()
        self.addCleanup(self.f.doCleanups)
        self.f.setUp()
        f = self.f
        self.root = f.base / 'local/AuroraNexus'
        new_state = self.root / 'integration/state'
        new_state.parent.mkdir(parents=True)
        f.state.rename(new_state)
        f.state, f.active, f.ia_state = new_state, new_state / self.deployment.STATE_NAME, new_state / 'ia-master'
        self.target = self.root / 'client' / installer.VERSION
        self.target.mkdir(parents=True)
        self.edge = f.base / 'programs/Microsoft/Edge/Application/msedge.exe'
        self.link = f.base / 'roaming/Microsoft/Windows/Start Menu/Programs/AURORA NEXUS.lnk'
        self.edge.parent.mkdir(parents=True)
        self.edge.write_bytes(b'synthetic-edge')
        self.link.parent.mkdir(parents=True)
        self.link.write_bytes(b'synthetic-preserved-shortcut')
        self.shortcut_before = self.link.read_bytes()
        self.real_installer = Path(installer.__file__).read_bytes()
        self.asset_bytes = {name: (f.package / name).read_bytes() for name in self.deployment.ASSETS}
        self.old_source, self.new_source = 'a' * 40, 'b' * 40
        self.create_release(self.old_source, b'# exact synthetic signed predecessor installer\n', version='1.0.7')
        # Materialize the historical checkpoint under its own version guard.
        # All later validation and execution use the current 1.0.8 guard.
        with patch.object(self.deployment, 'VERSION', '1.0.7'):
            old_result = f.execute()
        self.old_reference = old_result['checkpointTransition']
        self.old_plan = copy.deepcopy(f.plan)
        self.old_ia_manifest = (f.ia_package / 'manifest.json').read_bytes()
        self.old_ia_metadata = (f.ia_state / 'installation.json').read_bytes()
        self.old_script_hash = installer.fingerprint((Path(f.plan['packageDirectory']).parent / 'desktop/install_windows_beta.py').read_bytes())
        self.previous = self.identity(self.old_source)
        self.previous.update(launchTarget=str(self.edge), shortcuts=[str(self.link)],
                             sourceScriptSha256=self.old_script_hash, rollbackBackupId='1' * 32,
                             probe={'installationAcceptance': {'checkpointTransition': self.old_reference}},
                             **{name: False for name in ('gatewayDatabaseChanged', 'cloudDeploymentPerformed',
                                                        'productionReleased', 'macUpdated', 'iosNativeAppBuilt')})
        self.manifest = self.target / 'installation.json'
        self.manifest.write_bytes(self.encode(self.previous))
        self.snapshots = {'manifest': self.manifest.read_bytes(), 'shortcut-0': self.link.read_bytes()}
        backup = self.root / 'installation-rollbacks' / ('1' * 32)
        backup.mkdir(parents=True)
        artifacts = {}
        for label, value in self.snapshots.items():
            before = b'synthetic older client bytes\n'
            (backup / installer.backup_name(label)).write_bytes(before)
            artifacts[label] = {'beforeSha256': installer.fingerprint(before), 'afterSha256': installer.fingerprint(value)}
        self.receipt_path = backup / 'receipt.json'
        self.receipt_path.write_bytes(self.encode({'schemaVersion': 1, 'clientVersion': installer.VERSION,
                                                 'state': 'COMMITTED', 'artifacts': artifacts}))
        self.create_release(self.new_source, self.real_installer, self.old_reference)
        self.expected = self.identity(self.new_source)
        self.plan_path, self.input_path = f.base / 'current-plan.json', f.base / 'authorized-synthetic-input.json'
        self.save_plan()
        self.input_path.write_bytes(self.encode(f.raw))
        for change in (patch.object(installer, '__file__', str(self.bundle / 'desktop/install_windows_beta.py')),
                       patch.object(installer, 'COLLECTOR_SOURCE', f.package),
                       patch.object(self.deployment.sync, 'request_json', side_effect=lambda *args: f.transport(*args)),
                       patch.dict(os.environ, {'AURORA_INTEGRATION_TOKEN': 'SYNTHETIC_PROCESS_ONLY'})):
            change.start()
            self.addCleanup(change.stop)

    def encode(self, value):
        return self.deployment._transition_encoded(value)

    def identity(self, source):
        return {'clientVersion': installer.VERSION, 'portal': installer.BASE,
                'technicalSmokeBase': installer.TECHNICAL_SMOKE_BASE, 'frontendPolicy': 'CANONICAL_PORTAL_SINGLE_ENTRY',
                'reviewedMainSha': source, 'environment': 'HML', 'offlineBusinessApp': False}

    def save_plan(self):
        self.plan_path.write_bytes(self.encode(self.f.plan))

    def save_previous(self):
        self.manifest.write_bytes(self.encode(self.previous))
        self.snapshots['manifest'] = self.manifest.read_bytes()
        receipt = json.loads(self.receipt_path.read_bytes())
        receipt['artifacts']['manifest']['afterSha256'] = installer.fingerprint(self.snapshots['manifest'])
        self.receipt_path.write_bytes(self.encode(receipt))

    def create_release(self, source, script, bridge=None, version='1.0.8'):
        f, release = self.f, self.release
        self.bundle = f.base / ('bundle-' + source[0])
        f.package = self.bundle / 'aurora-coletor'
        f.package.mkdir(parents=True)
        names = release.LEGACY_WINDOWS_FILES if version == '1.0.7' else release.WINDOWS_FILES
        assets = {name: self.asset_bytes[name] for name in names}
        payloads = {**{'aurora-coletor/' + name: value for name, value in assets.items()},
                    'desktop/install_windows_beta.py': script, 'INSTALAR-AURORA-NEXUS.cmd': b'@echo off\n',
                    'LEIA-PRIMEIRO.txt': b'Synthetic public release fixture only.\n'}
        for name, value in payloads.items():
            path = self.bundle / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
        manifest = {'schemaVersion': 1, 'clientVersion': installer.VERSION, 'sourceCommit': source,
                    'files': {name: release.digest(value) for name, value in payloads.items()}}
        (self.bundle / 'manifest.json').write_bytes(self.encode(manifest))
        unified = f.base / ('unified-' + source[0])
        manifests = unified / 'manifests'
        manifests.mkdir(parents=True)
        f.manifest_path = manifests / 'windowsIntegration-manifest.json'
        f.win_manifest = {'schemaVersion': 1, 'platform': 'windows', 'component': 'AURORA_WINDOWS_INTEGRATION',
                          'version': version, 'sourceSha': source,
                          'files': {name: release.digest(value) for name, value in assets.items()}}
        f.manifest_path.write_bytes(self.encode(f.win_manifest))
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zip:
            for name in (*payloads, 'manifest.json'):
                zip.writestr(name, (self.bundle / name).read_bytes())
        zipped = archive.getvalue()
        path = unified / 'payloads/satellite/AURORA-NEXUS-Windows-Beta.zip'
        path.parent.mkdir(parents=True)
        path.write_bytes(zipped)
        self.zip_path = path
        satellite = {'sourceCommit': source, 'version': '0.2.0-hml.20261001', 'portalUrl': installer.BASE,
                     'files': [{'name': name, 'size': len(zipped) if name.endswith('Beta.zip') else 1,
                                'sha256': release.digest(zipped) if name.endswith('Beta.zip') else 'c' * 64}
                               for name in ('AURORA-NEXUS-Windows-Beta.zip', 'AURORA-NEXUS-Mac-HML.zip',
                                            'AURORA-NEXUS-Windows-x64-HML.exe', 'Instalar.exe')]}
        satellite_bytes = self.encode(satellite)
        (manifests / 'satellite-manifest.json').write_bytes(satellite_bytes)
        f.ia_manifest['sourceRevision'] = source
        ia_bytes = self.encode(f.ia_manifest)
        (f.ia_package / 'manifest.json').write_bytes(ia_bytes)
        from test_published_release import envelope
        f.env = envelope(f.key, {'windowsIntegration': release.digest(f.manifest_path.read_bytes()),
                                'iaMaster': release.digest(ia_bytes), 'satellite': release.digest(satellite_bytes)})
        f.env['certificate']['sourceSha'] = source
        for name, pin in f.env['certificate']['components'].items():
            pin['sourceSha'] = source
            if name == 'windowsIntegration':
                pin['version'] = version
        f.resign(f.env)
        f.cert_sha = release.digest(release.signing_bytes(f.env['certificate']))
        suffix = '1' if source == self.old_source else '2'
        f.attempt = f.runtime / 'installation-rollbacks' / ('published-' + suffix * 8 + '-' + '-'.join([suffix * 4] * 3) + '-' + suffix * 12)
        f.attempt.mkdir(parents=True, exist_ok=True)
        metadata = json.loads((f.ia_state / 'installation.json').read_bytes())
        metadata.update(sourceRevision=source, rollbackPath=str(f.attempt), publishedCertificateSha256=f.cert_sha,
                        signedComponentManifestSha256=release.digest(ia_bytes))
        (f.ia_state / 'installation.json').write_bytes(self.encode(metadata))
        tree = {name: release.digest((f.ia_package / name).read_bytes()) for name in (*f.ia_manifest['files'], 'manifest.json')}
        journal = copy.deepcopy(f.journal)
        journal.update(id=f.attempt.name.removeprefix('published-'), stateDir=str(f.ia_state), sourceSha=source,
                       certificateSha256=f.cert_sha, acceptedEnvelope=f.env, manifestSha256=release.digest(ia_bytes),
                       nextTreeSha256=release.digest(release.canonical(tree).encode()),
                       nextMetadataSha256=release.digest((f.ia_state / 'installation.json').read_bytes()))
        journal['identity']['checkpoint'] = release.digest(f.active.read_bytes())
        journal['runtimeProof'].update(sourceSha=source, manifestSha256=release.digest(ia_bytes))
        if bridge:
            journal['checkpointTransitionFromPrevious'] = bridge
        f.journal_path = f.attempt / 'journal.json'
        f.journal_path.write_bytes(self.encode(journal))
        current = json.loads(f.active.read_bytes())
        f.plan.update(stateDirectory=str(f.state), packageDirectory=str(f.package), expectedSourceSha=source,
                      expectedCertificateSha256=f.cert_sha, envelope=f.env,
                      expectedPreviousSha256=release.digest(f.active.read_bytes()),
                      expectedPreviousTargetBinding=current['targetBinding'], expectedPreviousSampleKey=current['sampleKey'],
                      iaAnchor={'attemptDirectory': str(f.attempt), 'journalSha256': release.digest(f.journal_path.read_bytes())},
                      previousTransition=None,
                      publicReleaseControl={'trust': f.trust, 'expectedSourceSha': source, 'manifestPath': str(f.manifest_path)})
        f.on_read = lambda _req, body, _count: body['runtime'].update(sourceSha=source)
        f.transport = f.make_transport()
        self.deployment.__file__ = str(f.package / 'aurora_deployment.py')

    def verify(self):
        return installer.verified_client_predecessor(self.root, self.target, self.edge, [self.link], self.previous,
                                                   self.expected, self.snapshots, self.plan_path, self.input_path)

    def assert_original(self):
        self.assertEqual(self.manifest.read_bytes(), self.snapshots['manifest'])
        self.assertEqual(self.link.read_bytes(), self.snapshots['shortcut-0'])

    def complete_transition(self):
        result = self.f.execute()
        return {'checkpointTransition': result['checkpointTransition'], 'eligible': True}

    def test_valid_m3_to_m4_uses_actual_signatures_and_exact_old_and_new_installers(self):
        proof = self.verify()
        self.assertEqual(installer.known_identity(self.previous, self.expected, proof), 'SIGNED_PUBLISHED_PREDECESSOR')
        self.assertNotEqual(self.old_script_hash, installer.fingerprint(self.real_installer))
        self.assertGreater(len(self.f.reads), 0)
        self.assertEqual(len(self.f.transport.posts), 0)
        acceptance = self.complete_transition()
        proof.revalidate(acceptance)
        self.assertGreaterEqual(len(self.f.transport.readbacks), 3)
        self.assertEqual(len(self.f.transport.posts), 2)
        self.assert_original()

    def test_signed_predecessor_and_current_release_keep_separate_seven_and_twelve_file_profiles(self):
        self.assertEqual(len(self.asset_bytes), 12)
        self.assertEqual(set(self.asset_bytes), set(self.release.WINDOWS_FILES))
        for plan, version, names in ((self.old_plan, '1.0.7', self.release.LEGACY_WINDOWS_FILES),
                                     (self.f.plan, '1.0.8', self.release.WINDOWS_FILES)):
            self.assertEqual(plan['envelope']['certificate']['components']['windowsIntegration']['version'], version)
            manifest = json.loads(Path(plan['publicReleaseControl']['manifestPath']).read_bytes())
            self.assertEqual(manifest['version'], version)
            self.assertEqual(set(manifest['files']), set(names))
            candidate = self.release.verify_candidate(plan['envelope'], self.f.trust, plan['expectedSourceSha'])
            installer._signed_client_bundle({'files': {}, 'absent': set(), 'release': self.release}, plan, candidate)

    def test_signed_zip_cannot_mix_historical_and_current_file_profiles(self):
        for plan, add_intake in ((self.old_plan, True), (self.f.plan, False)):
            manifest_root = Path(plan['publicReleaseControl']['manifestPath']).parent
            archive_path = manifest_root.parent / 'payloads/satellite/AURORA-NEXUS-Windows-Beta.zip'
            satellite_path = manifest_root / 'satellite-manifest.json'
            archive_before, satellite_before = archive_path.read_bytes(), satellite_path.read_bytes()
            with zipfile.ZipFile(io.BytesIO(archive_before)) as zipped:
                files = {name: zipped.read(name) for name in zipped.namelist()}
            manifest = json.loads(files['manifest.json'])
            for name in self.release.INTAKE_FILES:
                path = 'aurora-coletor/' + name
                if add_intake:
                    files[path] = self.asset_bytes[name]
                    manifest['files'][path] = self.release.digest(files[path])
                else:
                    files.pop(path)
                    manifest['files'].pop(path)
            files['manifest.json'] = self.encode(manifest)
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
                for name, value in files.items():
                    zipped.writestr(name, value)
            satellite = json.loads(satellite_before)
            satellite['files'][0].update(sha256=self.release.digest(archive.getvalue()), size=len(archive.getvalue()))
            try:
                archive_path.write_bytes(archive.getvalue())
                satellite_path.write_bytes(self.encode(satellite))
                envelope = copy.deepcopy(plan['envelope'])
                envelope['certificate']['components']['satellite']['manifestSha256'] = self.release.digest(satellite_path.read_bytes())
                self.f.resign(envelope)
                candidate = self.release.verify_candidate(envelope, self.f.trust, plan['expectedSourceSha'])
                with self.subTest(version=manifest['sourceCommit'], addedIntake=add_intake), \
                     self.assertRaisesRegex(ValueError, 'SIGNED_CLIENT_ZIP_CLOSURE_CONFLICT'):
                    installer._signed_client_bundle({'files': {}, 'absent': set(), 'release': self.release}, plan, candidate)
            finally:
                archive_path.write_bytes(archive_before)
                satellite_path.write_bytes(satellite_before)
        self.assert_original()

    def test_signed_zip_rejects_unknown_component_version(self):
        envelope = copy.deepcopy(self.f.env)
        envelope['certificate']['components']['windowsIntegration']['version'] = '1.0.9'
        self.f.resign(envelope)
        candidate = self.release.verify_candidate(envelope, self.f.trust, self.new_source)
        with self.assertRaisesRegex(ValueError, 'SIGNED_CLIENT_COMPONENT_VERSION_CONFLICT'):
            installer._signed_client_bundle({'files': {}, 'absent': set(), 'release': self.release}, self.f.plan, candidate)
        self.assert_original()

    def test_generic_metadata_and_unregistered_proof_cannot_authorize(self):
        for proof in (None, {'verified': True}, installer._ClientPredecessor()):
            with self.subTest(proof=type(proof).__name__), self.assertRaisesRegex(ValueError, 'IDENTITY_CONFLICT'):
                installer.known_identity(self.previous, self.expected, proof)
        self.assert_original()

    def test_commit_state_or_actual_metadata_hash_mismatch_blocks(self):
        raw = self.receipt_path.read_bytes()
        for change in ('PREPARED', 'wrong-hash'):
            receipt = json.loads(raw)
            if change == 'wrong-hash':
                receipt['artifacts']['manifest']['afterSha256'] = '0' * 64
            else:
                receipt['state'] = change
            self.receipt_path.write_bytes(self.encode(receipt))
            with self.assertRaisesRegex(ValueError, 'COMMITTED_CLIENT'):
                self.verify()
            self.assert_original()
        self.receipt_path.write_bytes(raw)

    def test_previous_identity_and_exact_installer_hash_cannot_be_forged(self):
        for field, value in (('portal', OLD_PORTAL), ('sourceScriptSha256', '0' * 64),
                             ('reviewedMainSha', 'c' * 40), ('productionReleased', True)):
            original = self.previous[field]
            self.previous[field] = value
            self.save_previous()
            try:
                with self.subTest(field=field), self.assertRaises(self.errors):
                    proof = self.verify()
                    installer.known_identity(self.previous, self.expected, proof)
            finally:
                self.previous[field] = original
                self.save_previous()
            self.assert_original()

    def test_previous_envelope_with_foreign_key_or_forged_signature_is_rejected(self):
        old_plan_path = Path(self.old_reference['directory']) / 'plan.json'
        # A local writer may rehash the record but cannot sign the old package with the trusted key.
        old = json.loads(old_plan_path.read_bytes())
        from test_published_release import pair
        foreign, _ = pair()
        for sign in (lambda data: b'0' * 64, lambda data: foreign.sign(data)):
            changed = copy.deepcopy(old)
            changed['envelope']['signature'] = base64.urlsafe_b64encode(sign(self.release.signing_bytes(changed['envelope']['certificate']))).decode().rstrip('=')
            ref = self.rehash_record(self.old_reference, changed)
            self.previous['probe']['installationAcceptance']['checkpointTransition'] = ref
            self.save_previous()
            with self.assertRaisesRegex(self.release.ReleaseError, 'SIGNATURE_REJECTED'):
                self.verify()
        self.assert_original()

    def rehash_record(self, reference, plan):
        original = Path(reference['directory'])
        encoded = self.encode(plan)
        directory = original.parent / installer.fingerprint(encoded)
        directory.mkdir()
        (directory / 'plan.json').write_bytes(encoded)
        for name in ('checkpoint.previous', 'checkpoint.next', 'proof.json'):
            (directory / name).write_bytes((original / name).read_bytes())
        commit = json.loads((original / 'commit.json').read_bytes())
        commit['planSha256'] = directory.name
        (directory / 'commit.json').write_bytes(self.encode(commit))
        return {'directory': str(directory), 'commitSha256': installer.fingerprint((directory / 'commit.json').read_bytes())}

    def test_altered_zip_or_unclosed_caller_is_rejected(self):
        for path in (self.zip_path, self.bundle / 'desktop/install_windows_beta.py', self.bundle / 'manifest.json'):
            raw = path.read_bytes()
            path.write_bytes(raw + b'\nchanged')
            with self.subTest(path=path.name), self.assertRaises(self.errors):
                self.verify()
            path.write_bytes(raw)
        self.assert_original()

    def test_hardlinked_signed_artifact_is_rejected(self):
        alias = self.zip_path.with_name('hardlink.zip')
        os.link(self.zip_path, alias)
        with self.assertRaises(self.errors):
            self.verify()
        self.assert_original()

    def test_signed_zip_still_rejects_links_traversal_duplicates_and_entry_bounds(self):
        files = {name: (self.bundle / name).read_bytes() for name in
                 (*installer.PACKAGE_SOURCES, 'INSTALAR-AURORA-NEXUS.cmd', 'LEIA-PRIMEIRO.txt', 'manifest.json')}
        for invalid in ('link', 'traversal', 'duplicate', 'large'):
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
                for name, value in files.items():
                    entry = zipfile.ZipInfo(name)
                    entry.external_attr = (0o120777 if invalid == 'link' and name == 'LEIA-PRIMEIRO.txt' else 0o100644) << 16
                    zipped.writestr(entry, b'x' * (1024 * 1024 + 1) if invalid == 'large' and name == 'LEIA-PRIMEIRO.txt' else value)
                if invalid == 'traversal':
                    zipped.writestr('../escape', b'x')
                if invalid == 'duplicate':
                    zipped.writestr('MANIFEST.JSON', files['manifest.json'])
            self.zip_path.write_bytes(archive.getvalue())
            satellite_path = self.f.manifest_path.parent / 'satellite-manifest.json'
            satellite = json.loads(satellite_path.read_bytes())
            satellite['files'][0].update(sha256=installer.fingerprint(archive.getvalue()), size=len(archive.getvalue()))
            satellite_path.write_bytes(self.encode(satellite))
            envelope = copy.deepcopy(self.f.env)
            envelope['certificate']['components']['satellite']['manifestSha256'] = installer.fingerprint(satellite_path.read_bytes())
            self.f.resign(envelope)
            candidate = self.release.verify_candidate(envelope, self.f.trust, self.new_source)
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, 'ZIP_CLOSURE_CONFLICT'):
                installer._signed_client_bundle({'files': {}, 'absent': set()}, self.f.plan, candidate)
        self.assert_original()

    def test_pin_revoked_or_source_changed_during_read_is_rejected(self):
        def revoked(_req, body, _count):
            body['runtime']['sourceSha'] = self.new_source
            body['envelope']['certificate']['status'] = 'REVOKED'
        self.f.on_read = revoked
        with self.assertRaises(self.errors):
            self.verify()
        self.assert_original()

    def test_stale_pin_cannot_be_used_after_a_delay(self):
        proof = self.verify()
        self.f.now += 31
        with self.assertRaisesRegex(self.release.ReleaseError, 'FRESH_CANONICAL_V2_PIN_REQUIRED'):
            proof.require_fresh()
        self.assert_original()

    def test_checkpoint_without_explicit_chain_is_rejected(self):
        raw = self.f.active.read_bytes()
        self.f.active.write_bytes(raw + b'\n')
        with self.assertRaisesRegex(ValueError, 'CHECKPOINT_HEAD_REQUIRED'):
            self.verify()
        self.assert_original()

    def test_concurrent_client_writer_during_native_reader_is_preserved(self):
        def writer(_req, body, _count):
            body['runtime']['sourceSha'] = self.new_source
            self.link.write_bytes(b'concurrent-writer')
        self.f.on_read = writer
        with self.assertRaisesRegex(ValueError, 'CHANGED_REQUIRES_REVIEW'):
            self.verify()
        self.assertEqual(self.link.read_bytes(), b'concurrent-writer')
        self.assertEqual(self.manifest.read_bytes(), self.snapshots['manifest'])

    def test_runtime_checkpoint_can_advance_with_a_verified_immutable_chain(self):
        f = self.f
        current_plan, current_env = copy.deepcopy(f.plan), copy.deepcopy(f.env)
        current_ia = (f.ia_package / 'manifest.json').read_bytes()
        current_metadata = (f.ia_state / 'installation.json').read_bytes()
        f.plan, f.env = copy.deepcopy(self.old_plan), copy.deepcopy(self.old_plan['envelope'])
        checkpoint = json.loads(f.active.read_bytes())
        f.plan.update(previousTransition=self.old_reference, expectedPreviousSha256=installer.fingerprint(f.active.read_bytes()),
                      expectedPreviousTargetBinding=checkpoint['targetBinding'], expectedPreviousSampleKey=checkpoint['sampleKey'])
        (f.ia_package / 'manifest.json').write_bytes(self.old_ia_manifest)
        (f.ia_state / 'installation.json').write_bytes(self.old_ia_metadata)
        self.deployment.__file__ = str(Path(f.plan['packageDirectory']) / 'aurora_deployment.py')
        f.on_read = lambda _req, body, _count: body['runtime'].update(sourceSha=self.old_source)
        with patch.object(self.deployment, 'VERSION', '1.0.7'):
            advanced = f.execute()
        f.plan, f.env = current_plan, current_env
        self.deployment.__file__ = str(f.package / 'aurora_deployment.py')
        (f.ia_package / 'manifest.json').write_bytes(current_ia)
        (f.ia_state / 'installation.json').write_bytes(current_metadata)
        anchor = Path(f.plan['iaAnchor']['attemptDirectory']) / 'journal.json'
        journal = json.loads(anchor.read_bytes())
        journal['identity']['checkpoint'] = installer.fingerprint(f.active.read_bytes())
        journal['checkpointTransitionFromPrevious'] = advanced['checkpointTransition']
        anchor.write_bytes(self.encode(journal))
        checkpoint = json.loads(f.active.read_bytes())
        f.plan.update(expectedPreviousSha256=installer.fingerprint(f.active.read_bytes()),
                      expectedPreviousTargetBinding=checkpoint['targetBinding'], expectedPreviousSampleKey=checkpoint['sampleKey'],
                      iaAnchor={**f.plan['iaAnchor'], 'journalSha256': installer.fingerprint(anchor.read_bytes())})
        f.on_read = lambda _req, body, _count: body['runtime'].update(sourceSha=self.new_source)
        self.save_plan()
        proof = self.verify()
        self.assertEqual(installer.known_identity(self.previous, self.expected, proof), 'SIGNED_PUBLISHED_PREDECESSOR')
        self.assert_original()

    def staged_shortcuts(self, _target, _edge, paths):
        for path in paths:
            path.write_bytes(b'new synthetic shortcut')

    def update(self, predecessor, acceptance):
        with patch.object(installer, 'write_shortcuts', side_effect=self.staged_shortcuts):
            return installer.update_client(self.root, self.target, self.edge, [self.link], self.previous,
                self.expected, {'atUtc': '2026-10-15T12:00:00Z', 'installationAcceptance': acceptance},
                self.snapshots, predecessor)

    def test_signed_update_commits_backup_exact_readback_and_new_transition_reference(self):
        predecessor = self.verify()
        acceptance = self.complete_transition()
        backup = self.update(predecessor, acceptance)
        receipt = json.loads((backup / 'receipt.json').read_bytes())
        actual = self.manifest.read_bytes()
        self.assertEqual(receipt['state'], 'COMMITTED')
        self.assertEqual(receipt['artifacts']['manifest']['afterSha256'], installer.fingerprint(actual))
        self.assertEqual((backup / 'before-manifest.json').read_bytes(), self.snapshots['manifest'])
        self.assertEqual((backup / 'before-shortcut-0.lnk').read_bytes(), self.shortcut_before)
        value = json.loads(actual)
        self.assertEqual(value['reviewedMainSha'], self.new_source)
        self.assertEqual(value['probe']['installationAcceptance']['checkpointTransition'], acceptance['checkpointTransition'])

    def test_real_install_caller_uses_signed_predecessor_and_new_explicit_checkpoint(self):
        environment = dict(os.environ, LOCALAPPDATA=str(self.f.base / 'local'), APPDATA=str(self.f.base / 'roaming'),
                           USERPROFILE=str(self.f.base / 'user'), PROGRAMFILES=str(self.f.base / 'programs'),
                           **{'PROGRAMFILES(X86)': str(self.f.base / 'programs')})
        fake_os = SimpleNamespace(**os.__dict__)
        fake_os.name, fake_os.environ = 'nt', environment
        shortcut = {'target': str(self.edge), 'arguments': '--app=' + installer.BASE, 'workingDirectory': str(self.target)}
        portal = {'atUtc': '2026-10-15T12:00:00Z', 'probedPortal': installer.BASE,
                  'sameOriginBootstrapVerified': True, 'sameOriginAuthProjectVerified': True}
        transition = self.deployment.transition_checkpoint
        def synthetic_transport(plan, raw, token, recover=False):
            return transition(plan, raw, token, transport=self.f.transport, recover=recover)
        with patch.object(installer, 'os', fake_os), patch.object(installer, 'read_shortcut', return_value=shortcut), \
             patch.object(installer, 'write_shortcuts', side_effect=self.staged_shortcuts), \
             patch.object(self.deployment, 'transition_checkpoint', side_effect=synthetic_transport), \
             patch.object(installer, 'probe', return_value=portal), contextlib.redirect_stdout(io.StringIO()) as output:
            installer.install(str(self.input_path), self.f.plan['orgId'], self.release.ORIGIN, 'API_TOKEN',
                              integration_transition_plan=str(self.plan_path))
        result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'CLIENT_INSTALLED')
        self.assertTrue(result['automationIntegrationVerified'])
        self.assertEqual(len(self.f.transport.posts), 2)
        metadata = json.loads(self.manifest.read_bytes())
        self.assertEqual(metadata['reviewedMainSha'], self.new_source)
        self.assertEqual(metadata['integrationComponent']['version'], '1.0.8')
        self.assertEqual(json.loads(self.f.active.read_bytes())['receipt']['status'], 'DUPLICATE')
        self.assertEqual((Path(result['rollbackBackup']) / 'before-manifest.json').read_bytes(), self.snapshots['manifest'])
        self.assertNotIn('SYNTHETIC_PROCESS_ONLY', output.getvalue())

    def test_owned_failure_rolls_back_client_but_preserves_new_operational_checkpoint(self):
        predecessor = self.verify()
        acceptance = self.complete_transition()
        checkpoint = self.f.active.read_bytes()
        replace = installer.replace_unchanged
        def fail(path, before, after):
            if path == self.manifest:
                raise OSError('synthetic manifest commit failure')
            return replace(path, before, after)
        with patch.object(installer, 'replace_unchanged', side_effect=fail), self.assertRaises(OSError):
            self.update(predecessor, acceptance)
        self.assert_original()
        self.assertEqual(self.f.active.read_bytes(), checkpoint)
        receipts = [json.loads(path.read_bytes()) for path in (self.root / 'installation-rollbacks').glob('*/receipt.json')]
        self.assertEqual(sorted(value['state'] for value in receipts), ['COMMITTED', 'ROLLED_BACK'])

    def test_revocation_after_staging_blocks_assets_and_registered_client_writes(self):
        predecessor = self.verify()
        acceptance = self.complete_transition()
        checkpoint = self.f.active.read_bytes()
        def stage(*args):
            self.staged_shortcuts(*args)
            def revoke(_req, body, _count):
                body['runtime']['sourceSha'] = self.new_source
                body['envelope']['certificate']['status'] = 'REVOKED'
            self.f.on_read = revoke
        with patch.object(installer, 'write_shortcuts', side_effect=stage), \
             patch.object(installer, 'install_integration_assets') as assets, self.assertRaises(self.release.ReleaseError):
            installer.update_client(self.root, self.target, self.edge, [self.link], self.previous, self.expected,
                {'atUtc': '2026-10-15T12:00:00Z', 'installationAcceptance': acceptance}, self.snapshots, predecessor)
        assets.assert_not_called()
        self.assert_original()
        self.assertEqual(self.f.active.read_bytes(), checkpoint)

    def test_expiry_during_final_replacements_triggers_owned_rollback(self):
        predecessor = self.verify()
        acceptance = self.complete_transition()
        replace = installer.replace_unchanged
        def delay(path, before, after):
            result = replace(path, before, after)
            if path == self.manifest and after != self.snapshots['manifest']:
                self.f.now += 31
            return result
        with patch.object(installer, 'replace_unchanged', side_effect=delay), \
             self.assertRaisesRegex(self.release.ReleaseError, 'FRESH_CANONICAL_V2_PIN_REQUIRED'):
            self.update(predecessor, acceptance)
        self.assert_original()

    def test_current_acceptance_is_rechecked_and_writer_during_get_is_preserved(self):
        predecessor = self.verify()
        acceptance = self.complete_transition()
        def writer(_body, _count):
            self.link.write_bytes(b'current-get-writer')
        self.f.transport.on_readback = writer
        with self.assertRaisesRegex(ValueError, 'CHANGED_REQUIRES_REVIEW'):
            predecessor.revalidate(acceptance)
        self.assertEqual(self.link.read_bytes(), b'current-get-writer')
        self.assertEqual(self.manifest.read_bytes(), self.snapshots['manifest'])

    def test_new_current_authority_must_still_verify_automation(self):
        predecessor = self.verify()
        acceptance = self.complete_transition()
        self.f.transport.configured = False
        with self.assertRaisesRegex(ValueError, 'AUTOMATION'):
            predecessor.revalidate(acceptance)
        self.assert_original()

    def test_absent_backup_is_part_of_compare_and_swap(self):
        backup = self.receipt_path.parent / 'before-shortcut-0.lnk'
        backup.unlink()
        receipt = json.loads(self.receipt_path.read_bytes())
        receipt['artifacts']['shortcut-0']['beforeSha256'] = None
        self.receipt_path.write_bytes(self.encode(receipt))
        predecessor = self.verify()
        def writer(_req, body, _count):
            body['runtime']['sourceSha'] = self.new_source
            backup.write_bytes(b'new writer')
        self.f.on_read = writer
        with self.assertRaisesRegex(ValueError, 'CHANGED_REQUIRES_REVIEW'):
            predecessor.revalidate()
        self.assertEqual(backup.read_bytes(), b'new writer')
        self.assert_original()


class ManualReadbackCallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'AuroraNexus'
        self.input = self.base / 'approved-manual.json'
        self.input.write_text(json.dumps({
            'sourceSystem': 'ERP', 'externalDocumentId': 'synthetic-manual-caller',
            'sourceVersion': 1, 'occurredAt': '2026-10-15T00:00:00Z',
            'documentType': 'OTHER', 'competence': None, 'amountCents': None,
            'count': None, 'workflowState': 'VALIDATED', 'slaDueAt': None,
            'nativeReady': True, 'sourceIndependent': True,
            'documentFragility': 'NONE', 'missingFieldsCount': 0,
        }), encoding='utf-8')
        self.eligible = {'eligible': True, 'method': 'MANUAL', 'installationComplete': False,
                         'documentReplayPerformedByInstaller': False, 'checkpointChanged': False}

    def verify(self, method='MANUAL', **options):
        return installer.verify_installation_integration(self.root, self.input,
            'synthetic-org', 'https://auroranexus.com.br', method, **options)

    def test_manual_readback_does_not_create_an_operational_checkpoint(self):
        before = self.input.read_bytes()
        with patch.object(installer.integration_deployment, 'integrate_installation',
                          return_value=self.eligible) as integrate:
            result = self.verify()
        self.assertEqual(result, self.eligible)
        self.assertIsNone(integrate.call_args.args[3])
        self.assertEqual(integrate.call_args.kwargs['method'], 'MANUAL')
        self.assertFalse(self.root.exists())
        self.assertEqual(self.input.read_bytes(), before)

    def test_existing_ia_anchor_and_checkpoint_remain_unchanged_on_manual_readback(self):
        state = self.root / 'integration/state'
        anchor = state / 'ia-master/installation.json'
        anchor.parent.mkdir(parents=True)
        anchor.write_bytes(b'{"existingAnchor":"preserve"}')
        checkpoint = state / 'integration-setup.json'
        checkpoint.write_bytes(b'{"existingCheckpoint":"preserve"}')
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        with patch.object(installer.integration_deployment, 'integrate_installation',
                          return_value=self.eligible):
            self.verify()
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes()
                                 for p in self.root.rglob('*') if p.is_file()})

    def test_manual_readback_failure_does_not_stage_or_promote_the_client(self):
        with patch.object(installer.integration_deployment, 'integrate_installation',
                          side_effect=ValueError('AUTHORITATIVE_MANUAL_RECEIPT_REQUIRED')):
            with self.assertRaisesRegex(ValueError, 'AUTHORITATIVE_MANUAL_RECEIPT_REQUIRED'):
                self.verify()
        self.assertFalse(self.root.exists())

    def test_manual_readback_cannot_execute_a_checkpoint_transition(self):
        with patch.object(installer.integration_deployment, 'integrate_installation') as integrate:
            with self.assertRaisesRegex(ValueError, 'SEPARATE_CHECKPOINT_TRANSITION_REQUIRED'):
                self.verify(transition_plan_path=self.base / 'not-read.json')
        integrate.assert_not_called()
        self.assertFalse(self.root.exists())

    def test_api_writing_path_still_requires_a_transition_for_existing_ia_anchor(self):
        anchor = self.root / 'integration/state/ia-master/installation.json'
        anchor.parent.mkdir(parents=True)
        anchor.write_bytes(b'{"existingAnchor":"preserve"}')
        with patch.object(installer.integration_deployment, 'integrate_installation') as integrate:
            with self.assertRaisesRegex(ValueError, 'EXPLICIT_CHECKPOINT_TRANSITION_REQUIRED'):
                self.verify(method='API_TOKEN')
        integrate.assert_not_called()
        self.assertEqual(anchor.read_bytes(), b'{"existingAnchor":"preserve"}')


if __name__ == '__main__':
    unittest.main()
