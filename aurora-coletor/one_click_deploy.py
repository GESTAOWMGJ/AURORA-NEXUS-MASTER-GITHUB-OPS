#!/usr/bin/env python3
"""Aurora Coletor — one-click installer.

Runs the real installer first and then writes stable support commands. Secrets
are collected interactively by connector_setup; none are accepted on argv.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shlex
import sys

import install as aurora_install


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Aurora Coletor one-click deployment")
    parser.add_argument("--target", default="/opt/aurora-coletor")
    parser.add_argument("--watch-dir", default="/srv/aurora-entrada")
    parser.add_argument("--endpoint", default="https://api.auroranexus.com.br/coletor")
    parser.add_argument("--org", default="wmgj")
    parser.add_argument("--facility", default="WMGJ")
    parser.add_argument("--identity-id", default=None)
    parser.add_argument("--one-click", action="store_true")
    parser.add_argument("--without-connectors", action="store_true", help="Instala o coletor sem abrir o assistente de conectores.")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    install_args = [
        "--target", args.target,
        "--watch-dir", args.watch_dir,
        "--endpoint", args.endpoint,
        "--org", args.org,
        "--facility", args.facility,
    ]
    if args.identity_id:
        install_args += ["--identity", args.identity_id]
    if not args.without_connectors:
        install_args += ["--setup-connectors"]

    rc = aurora_install.main(install_args)
    if rc != 0:
        return rc

    target = Path(args.target)
    support = target / "support"
    support.mkdir(mode=0o700, parents=True, exist_ok=True)
    run_sh = target / "run.sh"
    commands = {
        "schemaVersion": "aurora.triggercmd.commands.v2",
        "commands": [
            {"name": "AURORA COLETOR Validar", "voice": "aurora coletor validar", "command": shlex.quote(str(run_sh))},
            {"name": "AURORA COLETOR Smoke Test", "voice": "aurora coletor smoke test", "command": shlex.quote(str(run_sh)) + " --once"},
            {"name": "AURORA COLETOR Watch", "voice": "aurora coletor watch", "command": shlex.quote(str(run_sh)) + " --watch"},
        ],
    }
    command_file = support / "triggercmd-commands.json"
    command_file.write_text(json.dumps(commands, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        command_file.chmod(0o600)
    except OSError:
        pass

    print("AURORA COLETOR — instalação one-click concluída")
    print("Target:", target)
    print("TRIGGERcmd:", command_file)
    print("Nenhum segredo foi gravado em linha de comando ou no manifesto público.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
