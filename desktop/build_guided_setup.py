#!/usr/bin/env python3
"""Build the existing Windows beta installer as a guided, self-contained EXE."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from build_windows_beta_bundle import build as build_bundle

NAME = 'AURORA-NEXUS-Instalar.exe'


def build(repo, output, source_sha):
    repo, output = Path(repo), Path(output)
    env = {**os.environ, 'GO111MODULE': 'off', 'GOTOOLCHAIN': 'local', 'GOPROXY': 'off', 'CGO_ENABLED': '0'}
    with tempfile.TemporaryDirectory(prefix='aurora-setup-build-') as temp:
        work = Path(temp)
        for source in (repo / 'desktop/windows_setup').glob('*.go'):
            shutil.copyfile(source, work / source.name)
        payload = build_bundle(repo, work / 'payload', source_sha)
        shutil.copyfile(payload, work / 'payload.zip')
        subprocess.run(['go', 'test', '-tags', 'aurora_windows_setup', '-v'], cwd=work, env=env, check=True)
        output.mkdir(parents=True, exist_ok=True)
        subprocess.run(['go', 'build', '-tags', 'aurora_windows_setup', '-trimpath', '-ldflags',
                        f'-H=windowsgui -s -w -X main.sourceCommit={source_sha}',
                        '-o', str(output / NAME), '.'], cwd=work,
                       env={**env, 'GOOS': 'windows', 'GOARCH': 'amd64'}, check=True)
    return output / NAME
