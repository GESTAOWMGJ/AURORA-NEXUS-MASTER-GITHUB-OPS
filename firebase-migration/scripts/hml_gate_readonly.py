#!/usr/bin/env python3
"""Fixed HML metadata collector. No login, IAM write, secret access or deploy."""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

PROJECT = "wmgj-hml-jfn-20260927"
NUMBER = "299889357292"
REGION = "southamerica-east1"
PROFILE = "aurora-hml"
VERIFIED, PENDING, UNKNOWN = "COMPROVADO", "PENDENTE", "DESCONHECIDO"
spec = importlib.util.spec_from_file_location("eventarc_plan", Path(__file__).with_name("repair-hml-eventarc-iam.py"))
eventarc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eventarc)
COMMANDS = {
    "auth": ["auth", "list", "--filter=status:ACTIVE", "--format=json(status)"],
    "project": ["projects", "describe", PROJECT, "--format=json(projectId,projectNumber,lifecycleState)"],
    "iam": ["projects", "get-iam-policy", PROJECT, "--format=json(version,etag,bindings)"],
    "functions": ["functions", "list", "--v2", "--regions=" + REGION,
                  "--format=json(name,environment,state,eventTrigger.eventType)"],
    "eventarc": ["eventarc", "triggers", "list", "--location=" + REGION, "--format=json(name)"],
}


def find_gcloud():
    found = shutil.which("gcloud")
    if found:
        return found
    if os.name == "nt":
        for key in ("LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"):
            root = os.environ.get(key)
            if root:
                candidate = Path(root) / "Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
                if candidate.is_file():
                    return str(candidate)
    return None


def error_code(stderr):
    text = stderr.lower()
    if "no active account" in text or "do not currently have an active account" in text:
        return "AUTH_LOGIN_REQUIRED"
    if any(s in text for s in ("invalid_grant", "invalid_rapt", "reauth", "re-auth", "refreshing your current auth tokens")):
        return "AUTH_RENEWAL_REQUIRED"
    if any(s in text for s in ("permission_denied", "permission denied", "403")):
        return "READ_PERMISSION_DENIED"
    if any(s in text for s in ("connection", "timed out", "ssl", "tls", "proxy")):
        return "NETWORK_OR_TLS_FAILURE"
    return "METADATA_QUERY_FAILED"


class Reader:
    def __init__(self, executable=None):
        self.executable = executable or find_gcloud()

    def read(self, key):
        if key not in COMMANDS:
            raise ValueError("QUERY_NOT_ALLOWLISTED")
        if not self.executable:
            return None, "GCLOUD_UNAVAILABLE"
        env = dict(os.environ, CLOUDSDK_CORE_DISABLE_PROMPTS="1", CLOUDSDK_CORE_LOG_HTTP="false")
        try:
            result = subprocess.run([self.executable, *COMMANDS[key], "--configuration=" + PROFILE, "--project=" + PROJECT, "--quiet"],
                                    capture_output=True, text=True, timeout=30, check=False, env=env)
        except subprocess.TimeoutExpired:
            return None, "METADATA_QUERY_TIMEOUT"
        except OSError:
            return None, "GCLOUD_EXECUTION_FAILED"
        if result.returncode:
            return None, error_code(result.stderr)
        try:
            return json.loads(result.stdout), None
        except (ValueError, TypeError):
            return None, "INVALID_METADATA_JSON"


def collect(reader):
    gates = {key: {"status": UNKNOWN, "evidence": "NOT_COLLECTED"} for key in COMMANDS}
    report = {"schemaVersion": "aurora.hml.readonly-gate.v1", "projectId": PROJECT,
              "observedAt": datetime.now(timezone.utc).isoformat(), "gates": gates,
              "cloudMutationAttempted": False, "secretPayloadRead": False,
              "releaseApproved": False, "decision": "AGUARDAR_GATE"}

    def read(key):
        data, error = reader.read(key)
        if error:
            gates[key] = {"status": UNKNOWN, "evidence": error}
        return data, error

    auth, error = read("auth")
    if error:
        return report
    if not isinstance(auth, list) or any(not isinstance(a, dict) or a.get("status") != "ACTIVE" for a in auth):
        gates["auth"]["evidence"] = "AUTH_METADATA_INVALID"
        return report
    if len(auth) != 1:
        gates["auth"]["evidence"] = "AUTH_LOGIN_REQUIRED" if not auth else "AUTH_IDENTITY_REVIEW_REQUIRED"
        return report
    gates["auth"] = {"status": VERIFIED, "evidence": "ONE_ACTIVE_CREDENTIAL_CONFIGURED_NOT_YET_VERIFIED"}
    project, error = read("project")
    if error:
        if error.startswith("AUTH_"):
            gates["auth"] = {"status": UNKNOWN, "evidence": error}
        return report
    if (not isinstance(project, dict) or project.get("projectId") != PROJECT
            or str(project.get("projectNumber")) != NUMBER or project.get("lifecycleState") != "ACTIVE"):
        gates["project"]["evidence"] = "PROJECT_IDENTITY_UNVERIFIED"
        return report
    gates["project"] = {"status": VERIFIED, "evidence": "EXACT_HML_ACTIVE_METADATA"}
    gates["auth"] = {"status": VERIFIED, "evidence": "AUTHENTICATED_HML_METADATA_READ"}
    policy, error = read("iam")
    if not error:
        try:
            additions = eventarc.plan(policy, NUMBER)
            gates["iam"] = {"status": PENDING if additions else VERIFIED,
                            "evidence": "DIRECT_BINDINGS_REVIEW_REQUIRED" if additions else "DIRECT_BINDINGS_PRESENT_METADATA_ONLY",
                            "missingDirectBindingRoles": [a["role"] for a in additions],
                            "effectiveAccess": UNKNOWN}
        except (ValueError, TypeError, KeyError):
            gates["iam"]["evidence"] = "IAM_POLICY_OR_CONDITION_REQUIRES_REVIEW"
    for key, collection in (("functions", "functions"), ("eventarc", "triggers")):
        items, error = read(key)
        if error:
            continue
        prefix = f"projects/{PROJECT}/locations/{REGION}/{collection}/"
        numeric_prefix = f"projects/{NUMBER}/locations/{REGION}/{collection}/"
        if not isinstance(items, list) or any(not isinstance(x, dict) or not isinstance(x.get("name"), str)
                                              or not x["name"].startswith((prefix, numeric_prefix)) for x in items):
            gates[key]["evidence"] = "RESOURCE_SCOPE_UNVERIFIED"
            continue
        gates[key] = {"status": VERIFIED, "evidence": "REGIONAL_METADATA_LISTED", "count": len(items)}
        if key == "functions":
            gates[key]["activeCount"] = sum(x.get("state") == "ACTIVE" for x in items)
            gates[key]["eventDrivenCount"] = sum(isinstance(x.get("eventTrigger"), dict) and bool(x["eventTrigger"].get("eventType")) for x in items)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collect", action="store_true", help="Read metadata using the already authenticated local gcloud identity")
    args = parser.parse_args(argv)
    if not args.collect:
        print(json.dumps({"mode": "PLAN_ONLY", "projectId": PROJECT, "queries": list(COMMANDS), "releaseApproved": False}))
        return 0
    report = collect(Reader())
    print(json.dumps(report, ensure_ascii=False, indent=2))
    # Metadata collection never authorizes IAM changes or deploy, even if all reads succeed.
    return 0 if all(g["status"] == VERIFIED for g in report["gates"].values()) else 2


if __name__ == "__main__":
    raise SystemExit(main())
