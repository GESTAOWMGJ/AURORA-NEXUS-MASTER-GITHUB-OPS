#!/usr/bin/env python3
"""Aurora Coletor installer.

Standard library only. The installer refuses an existing target and writes only
inside the target directory. The collector itself reads the configured input
folder and writes state only to the local state directory under the target.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse
import re
import shutil
import stat
import sys
from datetime import datetime, timezone

ORG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
FACILITY_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{1,63}$")
PLACEHOLDER_MARKERS = {
    "ENDERECO-AUTORIZADO",
    "ID-INSTITUICAO",
    "UNIDADE",
    "example.com",
    "localhost",
}


def is_windows_absolute(path: str) -> bool:
    return bool(re.match(r"^[a-zA-Z]:[\\/].+", path) or path.startswith("\\\\"))


def is_absolute_path(path: str) -> bool:
    return Path(path).is_absolute() or is_windows_absolute(path)


def fail(message: str) -> None:
    raise SystemExit(f"ERRO: {message}")


def validate_endpoint(endpoint: str) -> str:
    value = endpoint.strip()
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        fail("--endpoint deve ser uma URL HTTPS absoluta")
    if parsed.username or parsed.password:
        fail("--endpoint não deve conter usuário ou senha")
    if any(marker.lower() in value.lower() for marker in PLACEHOLDER_MARKERS):
        fail("--endpoint contém marcador/placeholder e deve ser substituído")
    return value.rstrip("/")


def validate_org(org: str) -> str:
    value = org.strip()
    if value != value.lower() or not ORG_RE.fullmatch(value):
        fail("--org deve usar minúsculas, números e hífen; exemplo: wmgj")
    return value


def validate_facility(facility: str) -> str:
    value = facility.strip()
    if value != value.upper() or not FACILITY_RE.fullmatch(value):
        fail("--facility deve usar referência em MAIÚSCULAS; exemplo: WMGJ")
    return value


def validate_target(target: str) -> Path:
    if not is_absolute_path(target):
        fail("--target deve ser caminho absoluto")
    path = Path(target)
    if path.exists():
        fail(f"destino já existe: {path}")
    return path


def validate_watch_dir(watch_dir: str) -> Path:
    if not is_absolute_path(watch_dir):
        fail("--watch-dir deve ser caminho absoluto")
    path = Path(watch_dir)
    if not path.exists() or not path.is_dir():
        fail(f"pasta de entrada não existe ou não é diretório: {path}")
    return path


def write_text(path: Path, content: str, mode: int = 0o640) -> None:
    path.write_text(content, encoding="utf-8")
    try:
        path.chmod(mode)
    except OSError:
        pass


def make_executable(path: Path) -> None:
    try:
        current = path.stat().st_mode
        path.chmod(current | stat.S_IXUSR | stat.S_IXGRP)
    except OSError:
        pass


def build_config(args: argparse.Namespace, target: Path, watch_dir: Path) -> dict[str, object]:
    return {
        "schemaVersion": "aurora.collector.config.v1",
        "installedAt": datetime.now(timezone.utc).isoformat(),
        "org": validate_org(args.org),
        "facility": validate_facility(args.facility),
        "endpoint": validate_endpoint(args.endpoint),
        "watchDir": str(watch_dir),
        "stateDir": str(target / "state"),
        "pollSeconds": args.poll_seconds,
        "maxFileBytes": args.max_file_bytes,
        "recursive": bool(args.recursive),
        "allowedExtensions": [".csv", ".json", ".jsonl"],
        "authTokenEnv": args.auth_env,
    }


def install(args: argparse.Namespace) -> None:
    source_dir = Path(__file__).resolve().parent
    collector_src = source_dir / "collector.py"
    if not collector_src.exists():
        fail("collector.py não encontrado ao lado do install.py")

    target = validate_target(args.target)
    watch_dir = validate_watch_dir(args.watch_dir)
    config = build_config(args, target, watch_dir)

    target.mkdir(mode=0o750, parents=True, exist_ok=False)
    (target / "bin").mkdir(mode=0o750)
    (target / "state").mkdir(mode=0o750)
    (target / "log").mkdir(mode=0o750)

    shutil.copy2(collector_src, target / "bin" / "collector.py")
    try:
        (target / "bin" / "collector.py").chmod(0o750)
    except OSError:
        pass

    write_text(target / "config.json", json.dumps(config, ensure_ascii=False, indent=2) + "\n")

    run_sh = f"""#!/bin/sh
set -eu
exec python3 {target / 'bin' / 'collector.py'} --config {target / 'config.json'} "$@"
"""
    write_text(target / "run.sh", run_sh, 0o750)
    make_executable(target / "run.sh")

    run_ps1 = f"""$ErrorActionPreference = 'Stop'
python "{target / 'bin' / 'collector.py'}" --config "{target / 'config.json'}" @args
"""
    write_text(target / "run.ps1", run_ps1, 0o640)

    service_example = f"""[Unit]
Description=Aurora Nexus Coletor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=aurora-coletor
Group=aurora-coletor
WorkingDirectory={target}
ExecStart={target / 'run.sh'}
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={target / 'state'} {target / 'log'}
ReadOnlyPaths={watch_dir}

[Install]
WantedBy=multi-user.target
"""
    write_text(target / "aurora-coletor.service.example", service_example)

    print("INSTALAÇÃO PREPARADA")
    print(f"Target: {target}")
    print(f"Entrada: {watch_dir}")
    print(f"Estado local: {target / 'state'}")
    print(f"Execução: {target / 'run.sh'} --once")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Instalador do Aurora Coletor")
    parser.add_argument("--target", required=True, help="Destino absoluto. Deve não existir.")
    parser.add_argument("--watch-dir", required=True, help="Pasta absoluta de entrada. Deve existir.")
    parser.add_argument("--endpoint", required=True, help="Endpoint HTTPS autorizado de ingestão.")
    parser.add_argument("--org", required=True, help="ID da instituição em minúsculas. Ex.: wmgj")
    parser.add_argument("--facility", required=True, help="Referência da unidade em MAIÚSCULAS. Ex.: WMGJ")
    parser.add_argument("--poll-seconds", type=int, default=30, help="Intervalo de varredura.")
    parser.add_argument("--max-file-bytes", type=int, default=10 * 1024 * 1024, help="Tamanho máximo por arquivo.")
    parser.add_argument("--recursive", action="store_true", help="Varre subpastas da entrada.")
    parser.add_argument("--auth-env", default="AURORA_COLLECTOR_TOKEN", help="Nome da variável de ambiente do bearer token opcional.")
    args = parser.parse_args(argv)
    if args.poll_seconds < 5:
        fail("--poll-seconds deve ser >= 5")
    if args.max_file_bytes < 1:
        fail("--max-file-bytes deve ser positivo")
    return args


def main(argv: list[str] | None = None) -> int:
    try:
        install(parse_args(sys.argv[1:] if argv is None else argv))
        return 0
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - safety net for installer UX
        fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
