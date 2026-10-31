#!/usr/bin/env python3
"""Owner-interactive OAuth renewal; only the protected HML secret is written."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request

REPO = "GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS"
ENVIRONMENT = "firebase-homologation"
SCRIPT_ID = "1_fQPqaq0EjaugyIF6jyuENDhJ2c2oTFm1kC-wdjmfaDqyRzy_uqwtiSW"
PROJECT_ID = "wmgj-hml-jfn-20260927"


class RenewalError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise RenewalError(code)


def scopes(token):
    value = token.get("scope")
    require(isinstance(value, str) and value.strip(), "BASELINE_OR_GRANTED_SCOPES_MISSING")
    return set(value.split())


def verify_credential(old, new, identity, expected_email):
    require(bool(new.get("refresh_token")) and bool(new.get("access_token")), "NEW_CREDENTIAL_INCOMPLETE")
    require(new.get("client_id") == old.get("client_id"), "OAUTH_CLIENT_CHANGED")
    require(new.get("client_secret") == old.get("client_secret"), "OAUTH_CLIENT_CHANGED")
    require(scopes(new) == scopes(old), "OAUTH_SCOPES_CHANGED")
    require(identity.get("verified_email") is True and identity.get("email") == expected_email,
            "OAUTH_OWNER_MISMATCH")


def canonical_deployment(items):
    matches = [x for x in items if x.get("description", "").startswith("AURORA_EXECUTION_API_CANONICAL ")]
    require(len(matches) == 1, "CANONICAL_DEPLOYMENT_NOT_UNIQUE")
    item = matches[0]
    require(bool(item.get("deploymentId")) and int(item.get("versionNumber", 0)) >= 1,
            "CANONICAL_DEPLOYMENT_INVALID")
    require(re.fullmatch(r"AURORA_EXECUTION_API_CANONICAL [a-f0-9]{40}", item["description"]) is not None,
            "CANONICAL_SOURCE_SHA_MISSING")
    return item


def run(args, **kwargs):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=kwargs.pop("timeout", 90), **kwargs)
    require(result.returncode == 0, "OFFICIAL_COMMAND_FAILED")
    return result.stdout


def renew(args):
    baseline_path = Path(args.baseline).expanduser().resolve()
    baseline_bytes = baseline_path.read_bytes()
    old = json.loads(baseline_bytes)["tokens"]["default"]
    expected_scopes = scopes(old)
    require(old.get("client_id") and old.get("client_secret"), "EXISTING_CLIENT_REQUIRED")
    gh = shutil.which("gh") or str(Path.home() / ".local/bin/gh")
    require(run([gh, "api", "user", "--jq", ".login"]).decode().strip() == "GESTAOWMGJ", "GITHUB_OWNER_MISMATCH")
    environment = json.loads(run([gh, "api", f"repos/{REPO}/environments/{ENVIRONMENT}"]))
    require(any(x.get("type") == "required_reviewers" and x.get("reviewers") for x in environment.get("protection_rules", [])),
            "PROTECTED_ENVIRONMENT_REQUIRED")
    require(environment.get("deployment_branch_policy") is not None, "PROTECTED_BRANCH_POLICY_REQUIRED")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="aurora-oauth-") as directory:
        root = Path(directory)
        auth = root / "renewed.json"
        client = root / "client.json"
        client.write_text(json.dumps({"installed": {"client_id": old["client_id"],
            "client_secret": old["client_secret"], "project_id": PROJECT_ID,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token", "redirect_uris": ["http://localhost"]}}))
        (root / "appsscript.json").write_text(json.dumps({"timeZone": "America/Sao_Paulo",
            "runtimeVersion": "V8", "oauthScopes": sorted(expected_scopes)}))
        (root / ".clasp.json").write_text(json.dumps({"scriptId": SCRIPT_ID, "projectId": PROJECT_ID, "rootDir": "."}))
        clasp = ["npx", "--yes", "--package", "@google/clasp@3.4.1", "clasp", "--auth", str(auth)]
        print("WAITING_FOR_OWNER_GOOGLE_CONSENT", flush=True)
        # The official CLI opens the browser and receives the loopback callback.
        # Never echo callback URLs, tokens, provider errors, or credentials.
        result = subprocess.run(clasp + ["login", "--creds", str(client), "--use-project-scopes"],
            cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
        require(result.returncode == 0, "OWNER_CONSENT_NOT_COMPLETED")
        new = json.loads(auth.read_bytes())["tokens"]["default"]
        request = urllib.request.Request("https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": "Bearer " + new["access_token"]})
        with urllib.request.urlopen(request, timeout=30) as response:
            identity = json.load(response)
        verify_credential(old, new, identity, args.expected_email)
        deployment = canonical_deployment(json.loads(run(clasp + ["deployments", "--json"], cwd=root)))
        # Do not overwrite or roll back a concurrently changed local credential.
        require(baseline_path.read_bytes() == baseline_bytes, "LOCAL_CREDENTIAL_CHANGED_CONCURRENTLY")
        payload = json.dumps({"tokens": {"default": new}}).encode()
        run([gh, "secret", "set", "CLASPRC_JSON", "--repo", REPO, "--env", ENVIRONMENT], input=payload)
        metadata = json.loads(run([gh, "api", f"repos/{REPO}/environments/{ENVIRONMENT}/secrets/CLASPRC_JSON"]))
        require(metadata.get("name") == "CLASPRC_JSON", "ENVIRONMENT_SECRET_READBACK_FAILED")
        print(json.dumps({"state": "OAUTH_REAUTHORIZED_ENVIRONMENT_SECRET_UPDATED",
            "environment": ENVIRONMENT, "secretUpdatedAt": metadata.get("updated_at"),
            "clientIdSha256": hashlib.sha256(new["client_id"].encode()).hexdigest(),
            "scopesUnchanged": True, "localCredentialUnchanged": baseline_path.read_bytes() == baseline_bytes,
            "previousDeploymentIdSha256": hashlib.sha256(deployment["deploymentId"].encode()).hexdigest(),
            "previousVersion": deployment["versionNumber"], "previousDescription": deployment["description"],
            "deploymentExecuted": False, "operationalWrites": 0}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default="~/.clasprc.json")
    parser.add_argument("--expected-email", required=True)
    args = parser.parse_args()
    try:
        renew(args)
    except (Exception, KeyboardInterrupt) as error:
        # Only codes authored by this helper may leave the process.
        code = str(error) if type(error) is RenewalError else "OAUTH_RENEWAL_FAILED_OR_CANCELLED"
        print(code, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
