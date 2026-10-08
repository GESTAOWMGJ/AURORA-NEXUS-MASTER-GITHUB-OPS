import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

import build_windows_beta_bundle as bundle


class WindowsBetaBundleTests(unittest.TestCase):
    def test_bundle_is_reproducible_and_contains_complete_dependencies(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo = Path(__file__).resolve().parents[1]
            first = bundle.build(repo, root / 'one', 'a' * 40)
            second = bundle.build(repo, root / 'two', 'a' * 40)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                for name, digest in manifest['files'].items():
                    self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), digest)
                self.assertEqual(manifest['sourceCommit'], 'a' * 40)
                self.assertFalse(manifest['deviceInstallationVerified'])
                extracted = root / 'extracted'
                archive.extractall(extracted)
            state = root / 'state'
            state.mkdir(mode=0o700)
            # Exercise imports and the real bundled entrypoint, without network or Windows mutation.
            result = subprocess.run([sys.executable, str(extracted / bundle.SOURCES[0]),
                                     'prepare-integration', '--target', str(state)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            integration = json.loads(result.stdout)
            self.assertEqual(integration['version'], '1.0.1')
            component = state / 'integration' / integration['version']
            installed_manifest = json.loads((component / 'manifest.json').read_text())
            self.assertEqual(installed_manifest['version'], integration['version'])
            for name, digest in installed_manifest['sha256'].items():
                self.assertEqual(hashlib.sha256((component / name).read_bytes()).hexdigest(), digest)

    def test_bundle_rejects_unpinned_source(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, 'EXACT_SOURCE_SHA_REQUIRED'):
                bundle.build(Path(__file__).resolve().parents[1], temp, 'main')


if __name__ == '__main__':
    unittest.main()
