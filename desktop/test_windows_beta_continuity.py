import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
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

    def run_install(self, probe=None, shell=None):
        with patch.object(installer, 'probe', side_effect=probe or (lambda:self.proof)), \
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


if __name__ == '__main__':
    unittest.main()
