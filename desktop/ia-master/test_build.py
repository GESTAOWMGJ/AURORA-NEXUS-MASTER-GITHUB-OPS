"""Validate the local review package; no installation, runtime download or model."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('aurora_master_build', SOURCE / 'build.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildContract(unittest.TestCase):
    def test_package_hashes_match_sources_and_zip_preserves_every_file(self):
        with tempfile.TemporaryDirectory(prefix='aurora-master-package-contract-') as temporary:
            output = Path(temporary) / 'review-package'
            builder.build(output)
            manifest = json.loads((output / 'manifest.json').read_text())
            self.assertEqual(manifest['version'], '1.1.0')
            self.assertEqual(manifest['clientAgent']['version'], '1.0.5')
            self.assertFalse(manifest['clientAgent']['configured'])
            self.assertFalse(manifest['clientAgent']['providerConnectionsVerified'])
            self.assertFalse(manifest['externalAiEnabled'])
            self.assertEqual(manifest['nodeMinimumMajor'], 22)
            self.assertRegex(manifest['sourceRevision'], r'^[a-f0-9]{40}$')
            self.assertIsInstance(manifest['dirty'], bool)
            required = {'server.cjs', 'studio.cjs', 'knowledge-registry.cjs', 'update.cjs', 'safe-read.cjs', 'publisher.cjs', 'manage.cjs', 'README.md',
                        'index.html', 'app.js', 'app.css', 'studio-local.js', 'studio-local.css', 'modus-operandi.md',
                        'assets/fonts/source-serif-4-regular.woff2', 'assets/fonts/source-serif-4-semibold.woff2',
                        'assets/fonts/atkinson-hyperlegible-next.woff2', 'assets/fonts/Source-Serif-OFL.txt',
                        'assets/fonts/Atkinson-Hyperlegible-Next-OFL.txt', 'assets/fonts/provenance.json',
                        'kernel/auroraMasterEngine.js', 'kernel/auroraIaMaster.js'}
            self.assertTrue(required.issubset(manifest['files']))
            actual = {str(file.relative_to(output)).replace('\\', '/')
                      for file in output.rglob('*') if file.is_file()}
            self.assertEqual(actual, set(manifest['files']) | {'manifest.json'})
            self.assertEqual(len(manifest['files']), 39)
            self.assertIn('published-update.cjs', manifest['files'])
            self.assertEqual({name for name in manifest['files'] if name.startswith('client-agent/')},
                             {'client-agent/' + name for name in ('client_agent.py', 'provider_connectors.py',
                              'client_secret_store.py', 'install_client_agent.py', 'aurora_cloud_sync.py',
                              'aurora_deployment.py', 'published_release.py','document_intake.py','document_intake.cjs',
                              'document_intake_core.cjs','document_fact_mapping.cjs','document-intake-manifest.json')})
            for name, expected in manifest['files'].items():
                self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), expected)
            for name in required - {'modus-operandi.md', 'kernel/auroraMasterEngine.js', 'kernel/auroraIaMaster.js'}:
                original = builder.ROOT / 'firebase-migration/hosting/aurora-nexus' / name if name.startswith('assets/fonts/') else SOURCE / name
                self.assertEqual((output / name).read_bytes(), original.read_bytes())
            self.assertNotIn('control.key', actual)
            self.assertNotIn('organization.txt', actual)
            self.assertFalse(any('knowledge_registry' in name or name.startswith('state/') for name in actual))
            self.assertEqual(manifest['files']['knowledge-registry.cjs'],
                             'dc6c99e407faa11adb46e68d798bd49374e54ada820c0f755520fcfec32abbb8')
            with zipfile.ZipFile(output.with_suffix('.zip')) as archive:
                self.assertEqual(set(archive.namelist()), actual)
                for name in actual:
                    self.assertEqual(archive.read(name), (output / name).read_bytes())
            marker = output / 'existing-candidate.txt'
            marker.write_text('preserve this existing package')
            with self.assertRaises(FileExistsError):
                builder.build(output)
            self.assertEqual(marker.read_text(), 'preserve this existing package')


if __name__ == '__main__':
    unittest.main()
