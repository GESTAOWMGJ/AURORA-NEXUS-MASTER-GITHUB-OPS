#!/usr/bin/env python3
"""Aurora Coletor installer.

Standard library only. The installer refuses an existing target and writes only
inside the target directory. The collector reads the configured input folder and
writes state only to the local state directory under the target.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from urllib.parse import urlparse
import re
import shutil
import shlex
import plistlib
from aurora_onboarding import installation_config, install_assets
from connector_setup import interactive_install as install_connectors
import stat
import sys

ORG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
FACILITY_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{1,63}$")
IDENTITY_RE = re.compile(r"^[a-z0-9][a-z0-9_.:-]{2,127}$")
PLACEHOLDER_MARKERS = {
    "ENDERECO-AUTORIZADO",
    "ENDPOINT-OFICIAL",
    "ID-INSTITUICAO",
    "UNIDADE",
    "example.com",
    "localhost",
    "TOKEN",
    "SECRET",
    "PASSWORD",
}
SERVICE_USER = "aurora-collector"


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
    if parsed.fragment:
        fail("--endpoint não deve conter fragmento")
    if any(marker.lower() in value.lower() for marker in PLACEHOLDER_MARKERS):
        fail("--endpoint contém marcador/placeholder ou segredo aparente")
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


def validate_identity(identity: str) -> str:
    value = identity.strip()
    if not IDENTITY_RE.fullmatch(value):
        fail("--identity inválido")
    if any(marker.lower() in value.lower() for marker in PLACEHOLDER_MARKERS):
        fail("--identity contém marcador/placeholder")
    return value


def validate_expiration(expires_at: str) -> str:
    value = expires_at.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        fail("--credential-expires-at deve ser ISO-8601")
    if dt.tzinfo is None:
        fail("--credential-expires-at deve incluir fuso horário ou Z")
    if dt <= datetime.now(timezone.utc):
        fail("--credential-expires-at deve estar no futuro")
    return expires_at.strip()


def default_expiration() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=90)).replace(microsecond=0).isoformat()


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


def write_text(path: Path, content: str, mode: int = 0o600) -> None:
    path.write_text(content, encoding="utf-8")
    try:
        path.chmod(mode)
    except OSError:
        pass


def make_executable(path: Path) -> None:
    try:
        current = path.stat().st_mode
        path.chmod(current | stat.S_IXUSR)
    except OSError:
        pass


def default_identity(org: str, facility: str) -> str:
    return f"aurora-collector-{org}-{facility.lower()}-hml-001"


def build_config(args: argparse.Namespace, target: Path, watch_dir: Path) -> dict[str, object]:
    org = validate_org(args.org)
    facility = validate_facility(args.facility)
    identity = validate_identity(args.identity or default_identity(org, facility))
    expires_at = validate_expiration(args.credential_expires_at or default_expiration())
    return {
        "schemaVersion": "aurora.collector.config.v2",
        "installedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "environment": args.environment,
        "org": org,
        "facility": facility,
        "technicalIdentityId": identity,
        "credentialExpiresAt": expires_at,
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
    collector_src = source_dir / "aurora_collector.py"
    if not collector_src.exists():
        fail("aurora_collector.py não encontrado ao lado do install.py")

    target = validate_target(args.target)
    watch_dir = validate_watch_dir(args.watch_dir)
    config = build_config(args, target, watch_dir)
    identity = str(config["technicalIdentityId"])
    onboarding = installation_config(args, target, watch_dir)

    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    (target / "bin").mkdir(mode=0o700)
    (target / "state").mkdir(mode=0o700)
    (target / "log").mkdir(mode=0o700)

    shutil.copy2(collector_src, target / "bin" / "aurora_collector.py")
    try:
        (target / "bin" / "aurora_collector.py").chmod(0o700)
    except OSError:
        pass

    write_text(target / "collector-config.json", json.dumps(config, ensure_ascii=False, indent=2) + "\n", 0o600)

    run_sh = f"""#!/bin/sh
set -eu
exec {shlex.quote(sys.executable)} {shlex.quote(str(target / 'bin' / 'aurora_collector.py'))} --config {shlex.quote(str(target / 'collector-config.json'))} "$@"
"""
    write_text(target / "run.sh", run_sh, 0o700)
    make_executable(target / "run.sh")

    run_ps1 = f"""$ErrorActionPreference = 'Stop'
python "{target / 'bin' / 'aurora_collector.py'}" --config "{target / 'collector-config.json'}" @args
"""
    write_text(target / "run.ps1", run_ps1, 0o600)

    service_example = f"""[Unit]
Description=Aurora Nexus Collector ({identity})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={SERVICE_USER}
Group={SERVICE_USER}
WorkingDirectory={target}
EnvironmentFile=/etc/aurora-coletor/{identity}.env
ExecStart={target / 'run.sh'} --watch
Restart=on-failure
RestartSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={target / 'state'} {target / 'log'}
ReadOnlyPaths={watch_dir}

[Install]
WantedBy=multi-user.target
"""
    write_text(target / "aurora-coletor.service.example", service_example, 0o600)

    env_example = """# Modelo sem token. O arquivo real deve pertencer ao usuário do serviço e usar chmod 600.
# NUNCA versionar nem enviar este valor em prompt, print, log ou linha de comando.
AURORA_COLLECTOR_TOKEN=
"""
    write_text(target / "aurora-coletor.env.example", env_example, 0o600)

    launchd_example = plistlib.dumps({
        "Label": f"br.com.auroranexus.collector.{identity}",
        "ProgramArguments": [sys.executable, str(target / "bin" / "aurora_collector.py"), "--config", str(target / "collector-config.json"), "--watch"],
        "RunAtLoad": True, "KeepAlive": True,
        "StandardOutPath": str(target / "log" / "collector.out.log"),
        "StandardErrorPath": str(target / "log" / "collector.err.log"),
    }).decode("utf-8")
    write_text(target / "aurora-coletor.launchd.plist.example", launchd_example, 0o600)
    install_assets(source_dir, target, onboarding)
    connector_manifest = None
    if args.setup_connectors:
        connector_manifest = install_connectors(target, org=org)

    print("INSTALAÇÃO PREPARADA")
    print("Descoberta documental: autorizada localmente" if onboarding["authorization"]["approved"] else "Descoberta documental: bloqueada até autorização institucional")
    print("Ferramentas adaptativas: rascunhos locais; nenhuma ativação ou implantação automática")
    print(f"Target: {target}")
    print(f"Entrada: {watch_dir}")
    print(f"Estado local: {target / 'state'}")
    print(f"Identidade técnica: {identity}")
    print(f"Execução de validação: {target / 'run.sh'}")
    print(f"Execução autorizada única: {target / 'run.sh'} --once")
    if connector_manifest:
        print("Conectores: Drive → extração contínua → Firebase configurados para ativação após autorização/teste")
        print(f"Manifesto sem segredos: {target / 'connectors' / 'connectors.json'}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Instalador do Aurora Coletor")
    parser.add_argument("--target", required=True, help="Destino absoluto. Deve não existir.")
    parser.add_argument("--watch-dir", required=True, help="Pasta absoluta de entrada. Deve existir.")
    parser.add_argument("--endpoint", required=True, help="Endpoint HTTPS autorizado de ingestão.")
    parser.add_argument("--org", required=True, help="ID da instituição em minúsculas. Ex.: wmgj")
    parser.add_argument("--facility", required=True, help="Referência da unidade em MAIÚSCULAS. Ex.: WMGJ")
    parser.add_argument("--identity", default=None, help="Identidade técnica. Padrão: aurora-collector-<org>-<facility>-hml-001")
    parser.add_argument("--credential-expires-at", default=None, help="Expiração ISO-8601. Padrão: agora + 90 dias.")
    parser.add_argument("--environment", default="homologation", choices=["homologation"], help="Ambiente permitido nesta versão.")
    parser.add_argument("--poll-seconds", type=int, default=30, help="Intervalo de varredura.")
    parser.add_argument("--max-file-bytes", type=int, default=10 * 1024 * 1024, help="Tamanho máximo por arquivo.")
    parser.add_argument("--recursive", action="store_true", help="Varre subpastas da entrada.")
    parser.add_argument("--auth-env", default="AURORA_COLLECTOR_TOKEN", help="Nome da variável de ambiente do bearer token.")
    parser.add_argument("--authorize-discovery", action="store_true", help="Autoriza apenas descoberta local de metadados no escopo documentado.")
    parser.add_argument("--discovery-root", action="append", help="Pasta institucional autorizada. Repetível; padrão: watch-dir.")
    parser.add_argument("--discovery-actor-ref", help="ID técnico do responsável pela autorização, sem nome pessoal.")
    parser.add_argument("--discovery-authorization-ref", help="Referência técnica da autorização institucional.")
    parser.add_argument("--discovery-expires-at", help="Vencimento da autorização ISO-8601 com fuso. Não é a credencial do coletor.")
    parser.add_argument("--setup-connectors", action="store_true", help="Abre o assistente seguro de conectores Drive/Firebase e integração externa. Segredos são solicitados interativamente.")
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
    except Exception as exc:  # pragma: no cover
        fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
