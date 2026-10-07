"""Build the existing native kernel into the Windows local component; no downloads."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]

def build(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    functions = ROOT / 'firebase-migration/functions'
    subprocess.run(['node', str(functions / 'node_modules/typescript/bin/tsc'),
                    'src/auroraMasterEngine.ts', '--module', 'commonjs', '--target', 'ES2022',
                    '--outDir', str(output / 'kernel'), '--rootDir', 'src', '--strict',
                    '--esModuleInterop', '--skipLibCheck'], cwd=functions, check=True)
    for name in ['server.cjs', 'index.html', 'app.js', 'app.css', 'manage.cjs', 'knowledge-registry.cjs']:
        shutil.copyfile(Path(__file__).parent / name, output / name)
    shutil.copyfile(ROOT / 'docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md', output / 'modus-operandi.md')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all', '--',
                 'desktop/ia-master', 'firebase-migration/functions/src',
                 'docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md'], cwd=ROOT, text=True).strip())
    manifest = {'component': 'AURORA_IA_MASTER', 'version': '1.0.1', 'sourceRevision': revision,
                'dirty': dirty, 'nodeMinimumMajor': 22, 'externalAiEnabled': False,
                'files': {str(p.relative_to(output)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in sorted(output.rglob('*')) if p.is_file()}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = output.with_suffix('.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(output.rglob('*')):
            if p.is_file(): z.write(p, p.relative_to(output))
    print(json.dumps({'archive': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'sourceRevision': revision, 'dirty': dirty}))
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    build(parser.parse_args().output)
