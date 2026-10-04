#!/usr/bin/env python3
"""Inspect the HML Eventarc bindings; apply only an explicitly reviewed policy hash.

Run in an authenticated Linux/Cloud Shell environment. No login, credential
export, privilege escalation, deployment or data ingestion is performed here.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

CONFIRMATION = "APPLY_HML_EVENTARC_BINDINGS"


def required_bindings(project_number):
    return (
        ("roles/iam.serviceAccountTokenCreator",
         f"serviceAccount:service-{project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"),
        ("roles/run.invoker",
         f"serviceAccount:{project_number}-compute@developer.gserviceaccount.com"),
        ("roles/eventarc.eventReceiver",
         f"serviceAccount:{project_number}-compute@developer.gserviceaccount.com"),
    )


def fingerprint(policy):
    return hashlib.sha256(json.dumps(policy, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def plan(policy, project_number):
    if not isinstance(policy, dict) or not isinstance(policy.get("etag"), str) or not policy["etag"]:
        raise ValueError("POLICY_ETAG_REQUIRED")
    if policy.get("version", 1) not in (1, 3):
        raise ValueError("POLICY_VERSION_UNSUPPORTED")
    bindings = policy.get("bindings")
    if not isinstance(bindings, list):
        raise ValueError("POLICY_BINDINGS_INVALID")
    for binding in bindings:
        if (not isinstance(binding, dict) or not isinstance(binding.get("role"), str)
                or not isinstance(binding.get("members"), list)
                or not all(isinstance(member, str) for member in binding["members"])):
            raise ValueError("POLICY_BINDINGS_INVALID")
    additions = []
    for role, member in required_bindings(project_number):
        matching = [b for b in bindings if b["role"] == role and member in b["members"]]
        if any("condition" not in b for b in matching):
            continue
        if matching:
            # An existing conditional grant is an intentional boundary, not a
            # missing grant. Never turn it into unrestricted access automatically.
            raise ValueError("CONDITIONAL_BINDING_REQUIRES_REVIEW")
        additions.append({"role": role, "member": member})
    return additions


def proposed_policy(policy, expected_hash, project_number):
    if fingerprint(policy) != expected_hash:
        raise ValueError("POLICY_CHANGED_REVIEW_AGAIN")
    additions = plan(policy, project_number)
    candidate = copy.deepcopy(policy)
    for item in additions:
        existing = next((b for b in candidate["bindings"]
                         if b["role"] == item["role"] and "condition" not in b), None)
        if existing is None:
            candidate["bindings"].append({"role": item["role"], "members": [item["member"]]})
        else:
            existing["members"].append(item["member"])
    return candidate, additions


def save_private(path, data):
    with path.open("x", encoding="utf-8") as stream:
        os.chmod(path, 0o600)
        json.dump(data, stream, indent=2, sort_keys=True)
        stream.write("\n")


def execute(gcloud, args):
    result = subprocess.run([gcloud, *args, "--quiet", "--format=json"],
                            capture_output=True, text=True, timeout=120, check=False)
    if result.returncode:
        # gcloud errors may include account information. Keep terminal evidence
        # minimal; the caller can diagnose with its own authenticated CLI.
        raise RuntimeError("GCLOUD_COMMAND_FAILED:" + args[1])
    return json.loads(result.stdout)


def run(args, gcloud):
    project_id = args.project
    number = args.expected_project_number
    if (not re.fullmatch(r"wmgj-hml-jfn-[a-z0-9-]+", project_id)
            or any(term in project_id for term in ("prod", "live", "principal"))
            or not re.fullmatch(r"[0-9]{6,20}", number)):
        raise ValueError("EXPLICIT_HML_TARGET_REQUIRED")
    if args.apply and (args.confirm != f"{CONFIRMATION}:{project_id}" or not args.expected_policy_sha256):
        raise ValueError("EXPLICIT_REVIEWED_POLICY_REQUIRED")
    project = execute(gcloud, ["projects", "describe", project_id])
    if (project.get("projectId") != project_id or str(project.get("projectNumber")) != number
            or project.get("lifecycleState") != "ACTIVE"):
        raise ValueError("PROJECT_IDENTITY_MISMATCH")
    policy = execute(gcloud, ["projects", "get-iam-policy", project_id])
    additions = plan(policy, number)
    if args.apply:
        candidate, additions = proposed_policy(policy, args.expected_policy_sha256, number)
    evidence = Path(args.evidence_dir).resolve()
    if evidence.is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("IAM_EVIDENCE_MUST_STAY_OUTSIDE_REPOSITORY")
    evidence.mkdir(mode=0o700, parents=False, exist_ok=False)
    os.chmod(evidence, 0o700)
    save_private(evidence / "policy-before.json", policy)
    report = {"project": project_id, "projectNumber": number,
              "policySha256": fingerprint(policy), "additions": additions,
              "status": "REVIEW_REQUIRED" if additions else "BINDINGS_PRESENT",
              "cloudMutationAttempted": False, "deploymentVerified": False,
              "windowsSyncVerified": False}
    save_private(evidence / "plan.json", report)
    if args.apply and additions:
        policy_file = evidence / "policy-proposed.json"
        save_private(policy_file, candidate)
        # Preserve the server etag: concurrent IAM changes must fail the write,
        # never overwrite an administrator's newer policy. No automatic retry.
        save_private(evidence / "apply-started.json", {"cloudMutationAttempted": True})
        report["cloudMutationAttempted"] = True
        execute(gcloud, ["projects", "set-iam-policy", project_id, str(policy_file)])
        after = execute(gcloud, ["projects", "get-iam-policy", project_id])
        save_private(evidence / "policy-after.json", after)
        if plan(after, number):
            raise RuntimeError("BINDINGS_NOT_VERIFIED_AFTER_WRITE")
        report["status"] = "BINDINGS_VERIFIED"
        report["verifiedPolicySha256"] = fingerprint(after)
    save_private(evidence / "result.json", report)
    print(json.dumps(report, sort_keys=True))
    return 0 if report["status"] != "REVIEW_REQUIRED" else 3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--expected-project-number", required=True)
    parser.add_argument("--evidence-dir", required=True, help="New private directory outside the repository")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm", default="")
    parser.add_argument("--expected-policy-sha256", default="")
    args = parser.parse_args()
    try:
        if os.name != "posix":
            raise ValueError("USE_AUTHENTICATED_LINUX_OR_CLOUD_SHELL")
        gcloud = shutil.which("gcloud")
        if not gcloud:
            raise ValueError("GCLOUD_NOT_AVAILABLE")
        return run(args, gcloud)
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"status": "BLOCKED", "code": str(error),
                          "deploymentVerified": False, "windowsSyncVerified": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
