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
    subprocess.run(['node',str(ROOT/'firebase-migration/scripts/generate-document-intake-assets.mjs'),'--check'],cwd=ROOT,check=True,capture_output=True)
    output.mkdir(parents=True, exist_ok=False)
    functions = ROOT / 'firebase-migration/functions'
    subprocess.run(['node', str(functions / 'node_modules/typescript/bin/tsc'),
                    'src/auroraMasterEngine.ts', '--module', 'commonjs', '--target', 'ES2022',
                    '--outDir', str(output / 'kernel'), '--rootDir', 'src', '--strict',
                    '--esModuleInterop', '--skipLibCheck'], cwd=functions, check=True)
    for name in ['server.cjs', 'studio.cjs', 'knowledge-registry.cjs', 'update.cjs', 'published-update.cjs', 'safe-read.cjs', 'publisher.cjs', 'index.html', 'app.js', 'app.css', 'studio-local.js', 'studio-local.css', 'manage.cjs', 'README.md']:
        shutil.copyfile(Path(__file__).parent / name, output / name)
    # Same installer package: lightweight intake is a separate, declared child component.
    # Packaging does not authorize roots, activate providers or install another model.
    agent_output=output/'client-agent';agent_output.mkdir()
    for name in ['client_agent.py','provider_connectors.py','client_secret_store.py','install_client_agent.py','aurora_cloud_sync.py','aurora_deployment.py','published_release.py',
                 'document_intake.py','document_intake.cjs','document_intake_core.cjs','document_fact_mapping.cjs','document-intake-manifest.json']:
        shutil.copyfile(ROOT/'aurora-coletor'/name,agent_output/name)
    fonts = ROOT / 'firebase-migration/hosting/aurora-nexus/assets/fonts'
    font_output = output / 'assets/fonts'
    font_output.mkdir(parents=True)
    for name in ['source-serif-4-regular.woff2', 'source-serif-4-semibold.woff2',
                 'atkinson-hyperlegible-next.woff2', 'Source-Serif-OFL.txt',
                 'Atkinson-Hyperlegible-Next-OFL.txt', 'provenance.json']:
        source = fonts / name
        if source.is_symlink() or not source.is_file():
            raise ValueError('Font asset must be a regular source file')
        shutil.copyfile(source, font_output / name)
    shutil.copyfile(ROOT / 'docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md', output / 'modus-operandi.md')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all', '--',
                 'desktop/ia-master', 'firebase-migration/functions/src',
                 'aurora-coletor',
                 'firebase-migration/hosting/aurora-nexus/assets/fonts',
                 'docs/AURORA_MO_001_WMGJ_MODUS_OPERANDI.md'], cwd=ROOT, text=True).strip())
    manifest = {'component': 'AURORA_IA_MASTER', 'version': '1.1.0', 'sourceRevision': revision,
                'clientAgent': {'component':'AURORA_CLIENT_AGENT','version':'1.0.5','platforms':['windows','macos'],
                                'configured':False,'sourceAuthorizationRequired':True,'providerConnectionsVerified':False},
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
