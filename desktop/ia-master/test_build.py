"""Packaging regressions with synthetic compiler output; no downloads or model."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('aurora_local_build', Path(__file__).with_name('build.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BuildArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aurora-build-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    @staticmethod
    def compiler(args, **kwargs):
        output = Path(args[args.index('--outDir') + 1])
        output.mkdir(parents=True)
        (output / 'auroraMasterEngine.js').write_text('// synthetic kernel fixture\n')

    @staticmethod
    def revision(args, **kwargs):
        return ('a' * 40 + '\n') if args[1] == 'rev-parse' else ''

    def build(self, output):
        with patch.object(module.subprocess, 'run', side_effect=self.compiler), patch.object(module.subprocess, 'check_output', side_effect=self.revision):
            return module.build(output)

    def test_dotted_version_retains_full_archive_name(self):
        self.build(self.root / 'release-1.0.2')
        self.assertTrue((self.root / 'release-1.0.2.zip').is_file())
        self.assertFalse((self.root / 'release-1.0.zip').exists())

    def test_existing_archive_is_never_overwritten(self):
        archive = self.root / 'release-1.0.2.zip'
        archive.write_bytes(b'original artifact')
        with self.assertRaises(FileExistsError):
            self.build(self.root / 'release-1.0.2')
        self.assertEqual(archive.read_bytes(), b'original artifact')
        self.assertFalse((self.root / 'release-1.0.2').exists())

    def test_separate_versions_have_separate_archives(self):
        self.build(self.root / 'release-1.0.2')
        first = (self.root / 'release-1.0.2.zip').read_bytes()
        self.build(self.root / 'release-1.0.3')
        self.assertEqual((self.root / 'release-1.0.2.zip').read_bytes(), first)
        self.assertTrue((self.root / 'release-1.0.3.zip').is_file())

if __name__ == '__main__':
    unittest.main()
