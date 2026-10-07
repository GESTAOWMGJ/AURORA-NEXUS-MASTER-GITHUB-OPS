#!/usr/bin/env python3
"""Package the existing Windows beta client and its local dependencies."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

NAME = 'AURORA-NEXUS-Windows-Beta.zip'
SOURCES = ('desktop/install_windows_beta.py', 'aurora-coletor/aurora_deployment.py',
           'aurora-coletor/aurora_cloud_sync.py')
LAUNCHER = r'''@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if not errorlevel 1 (
  py -3 desktop\install_windows_beta.py install
  goto result
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if errorlevel 1 (
  echo Python 3.10 ou superior e necessario. Instale pelo site oficial python.org.
  pause
  exit /b 1
)
python desktop\install_windows_beta.py install
:result
if errorlevel 1 (
  echo A instalacao nao foi concluida. Preserve esta mensagem para diagnostico.
  pause
  exit /b 1
)
echo AURORA NEXUS instalado. Abra pelo atalho AURORA NEXUS no menu Iniciar.
pause
'''


def build(repo, output, source_sha=None):
    repo, output = Path(repo), Path(output)
    if source_sha is None:
        source_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    if not re.fullmatch(r'[a-f0-9]{40}', source_sha):
        raise ValueError('EXACT_SOURCE_SHA_REQUIRED')
    files = {name: (repo / name).read_bytes() for name in SOURCES}
    match = re.search(rb'^VERSION = "([^"]+)"', files[SOURCES[0]], re.MULTILINE)
    if not match:
        raise ValueError('CLIENT_VERSION_REQUIRED')
    version = match.group(1).decode('ascii')
    files['INSTALAR-AURORA-NEXUS.cmd'] = LAUNCHER.replace('\n', '\r\n').encode('ascii')
    files['LEIA-PRIMEIRO.txt'] = (
        f'AURORA NEXUS Windows {version}\n'
        'Extraia todo o ZIP e abra INSTALAR-AURORA-NEXUS.cmd. Requer Windows, Edge e Python 3.10+.\n'
        'Atualiza o cliente de acesso existente por usuario, preservando o portal e a instalacao anterior.\n'
        'O portal exige login individual. Nenhuma senha, dado operacional ou modelo de IA acompanha o pacote.\n'
        'O pacote nao instala servico, banco offline ou dependencia. Nao desative protecoes do Windows.\n'
        'Sem assinatura de editor. SHA-256 verifica integridade, nao identidade do editor.\n'
        'Compilacao e testes de pacote nao comprovam instalacao no seu dispositivo.\n'
    ).encode('utf-8')
    manifest = {'schemaVersion': 1, 'clientVersion': version, 'sourceCommit': source_sha,
                'environment': 'HML', 'productionReleased': False, 'deviceInstallationVerified': False,
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}}
    files['manifest.json'] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    output.mkdir(parents=True, exist_ok=True)
    target = output / NAME
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(build(Path(__file__).resolve().parents[1], args.output))
