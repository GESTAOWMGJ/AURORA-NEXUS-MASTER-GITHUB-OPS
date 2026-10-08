"""Read-only production publication gates. Never changes IAM, DNS, data or backups."""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from production_project_contract import ContractError, validate_contract, validate_wif, verify_live

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "wmgj-prod-jfn-20261005"
NUMBER = "616997609173"
ORIGIN = "https://auroranexus.com.br"
REGION = "southamerica-east1"
RUNTIME_ACCOUNT = f"aurora-prod-runtime@{PROJECT}.iam.gserviceaccount.com"
RUNTIME_AUTH_ROLE = f"projects/{PROJECT}/roles/auroraRuntimeAuth"
AUTH_PERMISSIONS = {"firebaseauth.users.get", "firebaseauth.users.createSession",
                    "firebaseauth.users.create", "firebaseauth.users.update"}


def require(condition, code):
    if not condition:
        raise ContractError(code)


def validate_database(database):
    require(database.get("name") == f"projects/{PROJECT}/databases/(default)", "DATABASE_TARGET")
    require(database.get("locationId") == REGION, "DATABASE_REGION")
    require(database.get("deleteProtectionState") == "DELETE_PROTECTION_ENABLED", "DELETE_PROTECTION")
    require(database.get("pointInTimeRecoveryEnablement") == "POINT_IN_TIME_RECOVERY_ENABLED", "PITR")


def select_backup(backups, schedules, now):
    require(isinstance(schedules, list) and len(schedules) > 0, "SCHEDULED_BACKUP_REQUIRED")
    require(isinstance(backups, list), "BACKUP_INVENTORY_INVALID")
    ready = [b for b in backups if isinstance(b, dict) and b.get("state") == "READY"
             and b.get("database") == f"projects/{PROJECT}/databases/(default)"
             and b.get("name", "").startswith(f"projects/{PROJECT}/locations/{REGION}/backups/")]
    require(bool(ready), "READY_PRODUCTION_BACKUP_REQUIRED")
    backup = max(ready, key=lambda b: b.get("snapshotTime", ""))
    try:
        snapshot = dt.datetime.fromisoformat(backup["snapshotTime"].replace("Z", "+00:00"))
        age = (now - snapshot).total_seconds()
    except (ValueError, KeyError, TypeError):
        raise ContractError("BACKUP_TIME_INVALID") from None
    require(0 <= age <= 24 * 3600, "READY_BACKUP_NOT_WITHIN_24H")
    return backup


def guardrail_fields(document):
    fields = document.get("fields", {})
    expected = {"active": {"booleanValue": True}, "environment": {"stringValue": "PRODUCTION"},
                "clinicalSensitiveEnabled": {"booleanValue": False},
                "productionMutation": {"booleanValue": False}, "sourceMutation": {"booleanValue": False}}
    require(all(fields.get(k) == v for k, v in expected.items()), "PRODUCTION_ORGANIZATION_GUARDRAILS")
    require(fields.get("projectionMode") == {"stringValue": "SHADOW"}, "PROJECTION_MODE")
    return expected


def validate_restore(restored, backup, source_org, restored_org):
    name = restored.get("name", "")
    require(re.fullmatch(rf"projects/{PROJECT}/databases/prod-restore-[a-z0-9-]{{3,40}}", name) is not None,
            "RESTORE_DATABASE_TARGET")
    require(restored.get("locationId") == REGION, "RESTORE_REGION")
    require(restored.get("sourceInfo", {}).get("backup", {}).get("backup") == backup["name"],
            "RESTORE_BACKUP_PROVENANCE")
    require(guardrail_fields(source_org) == guardrail_fields(restored_org), "RESTORE_GUARDRAIL_PARITY")
    return name


def validate_auth(config):
    require(config.get("name") in (f"projects/{PROJECT}/config", f"projects/{NUMBER}/config"), "AUTH_PROJECT_MISMATCH")
    require(config.get("authorizedDomains") == ["auroranexus.com.br"], "AUTH_CANONICAL_DOMAIN_REQUIRED")
    require(config.get("signIn", {}).get("email", {}).get("enabled") is True, "AUTH_EMAIL_SIGNIN_REQUIRED")
    mfa = config.get("mfa", {})
    require(mfa.get("state") in ("ENABLED", "MANDATORY"), "AUTH_MFA_REQUIRED")
    require(any(isinstance(provider, dict) and provider.get("state") in ("ENABLED", "MANDATORY")
                and isinstance(provider.get("totpProviderConfig"), dict)
                for provider in mfa.get("providerConfigs", [])), "AUTH_TOTP_PROVIDER_REQUIRED")


def validate_runtime_identity(account, policy, auth_role, secret_policies):
    require(account.get("email") == RUNTIME_ACCOUNT and account.get("disabled") is not True,
            "APPROVED_RUNTIME_ACCOUNT_REQUIRED")
    member = "serviceAccount:" + RUNTIME_ACCOUNT
    bindings = [binding for binding in policy.get("bindings", []) if member in binding.get("members", [])]
    roles = {binding.get("role") for binding in bindings}
    require(roles <= {RUNTIME_AUTH_ROLE, "roles/datastore.user", "roles/logging.logWriter"}, "RUNTIME_BROAD_ROLE_REJECTED")
    require(any(binding.get("role") == RUNTIME_AUTH_ROLE and not binding.get("condition") for binding in bindings),
            "RUNTIME_AUTH_ROLE_REQUIRED")
    require(auth_role.get("name") == RUNTIME_AUTH_ROLE and auth_role.get("deleted") is not True
            and set(auth_role.get("includedPermissions", [])) == AUTH_PERMISSIONS,
            "RUNTIME_AUTH_PERMISSIONS_MISMATCH")
    database = f"projects/{PROJECT}/databases/(default)"
    data = [binding for binding in bindings if binding.get("role") == "roles/datastore.user"]
    require(bool(data) and all(binding.get("condition", {}).get("expression", "").replace(" ", "").replace("'", '"')
                             == f'resource.name=="{database}"' for binding in data), "RUNTIME_DEFAULT_DATABASE_SCOPE_REQUIRED")
    require(len(secret_policies) == 3 and all(any(binding.get("role") == "roles/secretmanager.secretAccessor"
            and member in binding.get("members", []) and not binding.get("condition")
            for binding in secret.get("bindings", [])) for secret in secret_policies), "RUNTIME_SECRET_SCOPES_REQUIRED")


def validate_published_runtime(functions, expected):
    require(isinstance(functions, list), "FUNCTION_INVENTORY_INVALID")
    found = {function.get("name", "").rsplit("/", 1)[-1]: function for function in functions}
    for handler in expected:
        function = found.get(handler, {})
        require(function.get("name", "").startswith(f"projects/{PROJECT}/locations/{REGION}/functions/")
                and function.get("state") == "ACTIVE"
                and function.get("serviceConfig", {}).get("serviceAccountEmail") == RUNTIME_ACCOUNT,
                "PUBLISHED_APPROVED_RUNTIME_REQUIRED")


def validate_restore_operation(operations, database, backup):
    require(isinstance(operations, list), "RESTORE_OPERATION_INVENTORY_INVALID")
    for operation in operations:
        if not isinstance(operation, dict):
            continue
        meta = operation.get("metadata", {})
        if (operation.get("name", "").startswith(database + "/operations/")
                and operation.get("done") is True and not operation.get("error")
                and meta.get("@type") == "type.googleapis.com/google.firestore.admin.v1.RestoreDatabaseMetadata"
                and meta.get("operationState") == "SUCCESSFUL"
                and meta.get("database") == database and meta.get("backup") == backup["name"]):
            return operation["name"]
    raise ContractError("SUCCESSFUL_PRODUCTION_RESTORE_OPERATION_REQUIRED")


def validate_ci(run, sha):
    require(run.get("head_sha") == sha and run.get("head_branch") == "main", "CI_SOURCE_MISMATCH")
    require(run.get("status") == "completed" and run.get("conclusion") == "success", "CI_NOT_SUCCESSFUL")
    require(run.get("path", "").split("@", 1)[0] == ".github/workflows/validate-firestore-migration.yml", "CI_WORKFLOW_MISMATCH")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ContractError("REDIRECT_BLOCKED")


def read_json(url, headers=None):
    try:
        with urllib.request.build_opener(NoRedirect()).open(
                urllib.request.Request(url, headers=headers or {}), timeout=30) as response:
            require(response.status == 200, "READ_STATUS_INVALID")
            result = json.loads(response.read(2_000_000))
        require(isinstance(result, dict), "READ_RESPONSE_INVALID")
        return result
    except urllib.error.HTTPError as error:
        raise ContractError(f"READ_ONLY_LOOKUP_HTTP_{error.code}") from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ContractError("READ_ONLY_LOOKUP_FAILED") from None


def gcloud(*args):
    executable = shutil.which("gcloud")
    require(executable is not None, "GCLOUD_UNAVAILABLE")
    try:
        result = subprocess.run([executable, *args], capture_output=True, text=True, timeout=60, check=False)
    except (subprocess.TimeoutExpired, OSError):
        raise ContractError("GCLOUD_READ_FAILED") from None
    require(result.returncode == 0, "GCLOUD_READ_FAILED")
    return result.stdout


def metadata(*args):
    try:
        return json.loads(gcloud(*args, "--format=json", "--quiet"))
    except ValueError:
        raise ContractError("GCLOUD_RESPONSE_INVALID") from None


def local_contract(env, head):
    require(env.get("APPROVED_PROJECT") == PROJECT and env.get("APPROVED_PROJECT_NUMBER") == NUMBER, "APPROVED_PROJECT_MISMATCH")
    request = json.loads((ROOT / ".github/requests/aurora-firebase-production.json").read_text(encoding="utf-8"))
    desired = json.loads((ROOT / "infra/domains/auroranexus.com.br/firebase-hosting.desired-state.json").read_text(encoding="utf-8"))
    validate_contract(request, desired, PROJECT, NUMBER)
    validate_wif(PROJECT, NUMBER, env.get("WIF_PROVIDER", ""), env.get("PROVISION_SERVICE_ACCOUNT", ""))
    require(env.get("GITHUB_REF") == "refs/heads/main", "MAIN_REQUIRED")
    require(re.fullmatch(r"[a-f0-9]{40}", head or "") is not None
            and env.get("GITHUB_SHA") == head and env.get("EXPECTED_MAIN_SHA") == head, "IMMUTABLE_SOURCE_REQUIRED")
    require(env.get("DEPLOY_STAGE") in ("PUBLISH_BACKEND", "PUBLISH_HOSTING"), "PUBLICATION_STAGE_REQUIRED")
    require(env.get("DEPLOY_CONFIRMATION") == "PUBLISH_PRODUCTION_BETA", "PUBLICATION_CONFIRMATION_REQUIRED")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predeploy", action="store_true")
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    try:
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        local_contract(os.environ, head)
        require(os.environ.get("GCLOUD_PROJECT", PROJECT) == PROJECT, "CLI_PROJECT_MISMATCH")
        if args.predeploy:
            print("AURORA_PRODUCTION_PREDEPLOY_CONTRACT_VALID")
            return 0
        verify_live(PROJECT, NUMBER)
        validate_runtime_identity(
            metadata("iam", "service-accounts", "describe", RUNTIME_ACCOUNT, f"--project={PROJECT}"),
            metadata("projects", "get-iam-policy", PROJECT),
            metadata("iam", "roles", "describe", "auroraRuntimeAuth", f"--project={PROJECT}"),
            [metadata("secrets", "get-iam-policy", secret, f"--project={PROJECT}") for secret in
             ("AURORA_NEXUS_ALLOWED_EMAILS", "AURORA_NEXUS_CSRF_HMAC_KEY", "WMGJ_INGEST_HMAC_KEYRING")])
        validate_ci(read_json(f"https://api.github.com/repos/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/{os.environ.get('VALIDATION_RUN_ID', '')}",
                             {"Authorization": f"Bearer {os.environ.get('GH_TOKEN', '')}", "Accept": "application/vnd.github+json"}), head)
        validate_database(metadata("firestore", "databases", "describe", "--database=(default)", f"--project={PROJECT}"))
        backup = select_backup(metadata("firestore", "backups", "list", f"--location={REGION}", f"--project={PROJECT}"),
                               metadata("firestore", "backups", "schedules", "list", "--database=(default)", f"--project={PROJECT}"),
                               dt.datetime.now(dt.timezone.utc))
        restore_id = os.environ.get("RESTORE_DATABASE", "")
        require(re.fullmatch(r"prod-restore-[a-z0-9-]{3,40}", restore_id) is not None, "RESTORE_DATABASE_REQUIRED")
        token = gcloud("auth", "print-access-token").strip()
        headers = {"Authorization": f"Bearer {token}", "x-goog-user-project": PROJECT}
        base = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases"
        source = read_json(f"{base}/(default)/documents/organizations/wmgj", headers)
        restored_org = read_json(f"{base}/{restore_id}/documents/organizations/wmgj", headers)
        restored = metadata("firestore", "databases", "describe", f"--database={restore_id}", f"--project={PROJECT}")
        restored_name = validate_restore(restored, backup, source, restored_org)
        operation = validate_restore_operation(metadata("firestore", "operations", "list", f"--database={restore_id}", f"--project={PROJECT}"),
                                               restored_name, backup)
        for secret in ("AURORA_NEXUS_ALLOWED_EMAILS", "AURORA_NEXUS_CSRF_HMAC_KEY", "WMGJ_INGEST_HMAC_KEYRING"):
            version = metadata("secrets", "versions", "describe", "latest", f"--secret={secret}", f"--project={PROJECT}")
            require(version.get("state") == "ENABLED", "PRODUCTION_SECRET_VERSION_REQUIRED")
        validate_auth(read_json(f"https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/config", headers))
        if os.environ["DEPLOY_STAGE"] == "PUBLISH_HOSTING":
            config = json.loads((ROOT / "firebase-migration/firebase.production.json").read_text(encoding="utf-8"))
            validate_published_runtime(metadata("functions", "list", "--v2", f"--project={PROJECT}"),
                                       {route["function"]["functionId"] for route in config["hosting"]["rewrites"]})
            require(read_json(f"{ORIGIN}/__/firebase/init.json").get("projectId") == PROJECT, "CANONICAL_DOMAIN_PROJECT_MISMATCH")
        proof = {"schemaVersion": 1, "gate": "PRODUCTION_RELEASE_PREFLIGHT", "verifiedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                 "projectId": PROJECT, "projectNumber": NUMBER, "sourceSha": head, "stage": os.environ["DEPLOY_STAGE"],
                 "runtimeServiceAccount": RUNTIME_ACCOUNT,
                 "backup": backup["name"], "backupSnapshot": backup["snapshotTime"], "restoreDatabase": restored_name, "restoreOperation": operation,
                 "guardrailHash": hashlib.sha256(json.dumps(guardrail_fields(source), sort_keys=True).encode()).hexdigest(),
                 "canonicalOrigin": ORIGIN, "clinicalSensitiveEnabled": False, "sourceMutation": False,
                 "operationalIngestionVerified": False}
        if args.evidence:
            args.evidence.parent.mkdir(parents=True, exist_ok=True)
            args.evidence.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(proof, sort_keys=True))
        return 0
    except (ContractError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        code = str(error) if isinstance(error, ContractError) else "INVALID_RELEASE_INPUT"
        print(json.dumps({"ok": False, "gate": "PRODUCTION_RELEASE_PREFLIGHT", "code": code}), file=sys.stderr)
        return 41


if __name__ == "__main__":
    raise SystemExit(main())
