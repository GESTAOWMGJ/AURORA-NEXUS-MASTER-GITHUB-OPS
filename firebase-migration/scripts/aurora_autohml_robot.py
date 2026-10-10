#!/usr/bin/env python3
"""AURORA HML autonomous evidence robot. Offline by default; no write/cloud provisioning."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
CHECKS = {
    "repository-targets": ["node", "--test", "scripts/tests/repository-targets.test.mjs"],
    "auth-contract": [sys.executable, "-m", "unittest", "discover", "-s", "scripts/tests", "-p", "test_hml_auth_contract.py"],
    "readonly-gate": [sys.executable, "-m", "unittest", "discover", "-s", "scripts/tests", "-p", "test_hml_gate_readonly.py"],
    "canonical-routing": ["node", "--test", "scripts/tests/check_canonical_preflight.test.mjs"],
}
BLOCKERS = ("oauth_renewal", "wif_live_exchange", "authenticated_smoke", "immutable_ingestion", "restore_test")

def decide(checks, evidence):
    # Independent externally verified evidence is required; offline checks cannot promote.
    if not all(v.get("status") == "PASS" for v in checks.values()):
        return "BLOCKED"
    if not all(evidence.get(k) is True for k in BLOCKERS):
        return "AWAITING_OPERATIONAL_EVIDENCE"
    return "ELIGIBLE_FOR_CONTROLLED_REVIEW"

def execute(names, runner=subprocess.run, evidence=None):
    checks = {}
    for name in names:
        if name not in CHECKS:
            raise ValueError("CHECK_NOT_ALLOWLISTED")
        try:
            proc = runner(CHECKS[name], cwd=ROOT, capture_output=True, text=True, timeout=120,
                          check=False)
            checks[name] = {"status": "PASS" if proc.returncode == 0 else "FAIL",
                            "exitCode": proc.returncode}
        except (OSError, subprocess.TimeoutExpired):
            checks[name] = {"status": "UNKNOWN", "exitCode": None}
    operational = {key: False for key in BLOCKERS}
    # No external proof supplied here: CLI never accepts asserted approval as a release gate.
    result = {"schemaVersion":"aurora.autohml.v1","observedAt":datetime.now(timezone.utc).isoformat(),
              "mode":"OFFLINE_READONLY","checks":checks,"operationalEvidence":operational,
              "decision":decide(checks, operational),"credentialsTouched":False,
              "cloudMutationAttempted":False,"releaseApproved":False}
    canonical = json.dumps({k:v for k,v in result.items() if k != "observedAt"},sort_keys=True,separators=(",",":")).encode()
    result["evidenceSha256"] = hashlib.sha256(canonical).hexdigest()
    return result

def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument("--output", type=Path)
    p.add_argument("--checks", nargs="+", choices=sorted(CHECKS), default=list(CHECKS))
    args=p.parse_args(argv)
    report=execute(args.checks)
    payload=json.dumps(report,ensure_ascii=False,indent=2)+"\n"
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(payload,encoding="utf8")
    print(payload)
    return 0 if all(x["status"]=="PASS" for x in report["checks"].values()) else 2

if __name__=="__main__":
    raise SystemExit(main())
