#!/usr/bin/env python3
"""Aurora Coletor — implantação one-click segura.

Entrypoint intencionalmente sem segredo embutido. A implementação completa é
documentada em ONE_CLICK_DEPLOYMENT.md e deve ser executada pelo pacote local
aprovado do Aurora Nexus, nunca com token versionado.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main() -> int:
    parser = argparse.ArgumentParser(description="Aurora Coletor one-click deployment gate")
    parser.add_argument("--target", default="/opt/aurora-coletor")
    parser.add_argument("--watch-dir", default="/srv/aurora-entrada")
    parser.add_argument("--endpoint", default="https://api.auroranexus.com.br/coletor")
    parser.add_argument("--org", default="wmgj")
    parser.add_argument("--facility", default="WMGJ")
    parser.add_argument("--identity-id", default="aurora-collector-wmgj-hml-001")
    parser.add_argument("--one-click", action="store_true")
    parser.add_argument("--smoke-once", action="store_true")
    args = parser.parse_args()

    if args.org != args.org.lower():
        raise SystemExit("ERRO: org deve estar em minúsculas")
    if args.facility != args.facility.upper():
        raise SystemExit("ERRO: facility deve estar em maiúsculas")
    if not args.endpoint.startswith("https://"):
        raise SystemExit("ERRO: endpoint deve ser HTTPS")

    target = Path(args.target)
    support = target / "support"
    support.mkdir(parents=True, exist_ok=True)
    commands = {
        "schemaVersion": "aurora.triggercmd.commands.v1",
        "generatedAt": now(),
        "commands": [
            {"name": "AURORA COLETOR Implantar Um Clique", "voice": "aurora coletor implantar", "command": "python3 one_click_deploy.py --one-click"},
            {"name": "AURORA COLETOR Validar", "voice": "aurora coletor validar", "command": f"{target / 'run.sh'}"},
            {"name": "AURORA COLETOR Smoke Test", "voice": "aurora coletor smoke test", "command": f"{target / 'run.sh'} --once"},
        ],
    }
    (support / "triggercmd-commands.json").write_text(json.dumps(commands, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("AURORA COLETOR — pacote one-click inicializado")
    print("Target:", target)
    print("Watch dir:", args.watch_dir)
    print("Endpoint:", args.endpoint)
    print("TRIGGERcmd:", support / "triggercmd-commands.json")
    print("Para segredo e identidade técnica, seguir ONE_CLICK_DEPLOYMENT.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
