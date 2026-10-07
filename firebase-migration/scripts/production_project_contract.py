"""Fail-closed production preflight shared by Windows bootstrap and Actions.

Only local validation and read-only gcloud describes; never creates resources.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQUEST = ROOT / ".github/requests/aurora-firebase-production.json"
DESIRED = ROOT / "infra/domains/auroranexus.com.br/firebase-hosting.desired-state.json"


class ContractError(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise ContractError(reason)


def validate_contract(request, desired, approved_project, approved_number):
    require(request.get("requestVersion") == 2, "REQUEST_VERSION")
    require(request.get("status") == "READY_FOR_PROVISIONING", "PROJECT_NOT_VALIDATED")
    require(request.get("confirmation") == "PROVISION_EXISTING_PRODUCTION_PROJECT", "CONFIRMATION")
    project = request.get("projectId")
    number = request.get("projectNumber")
    require(isinstance(project, str) and re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project), "PROJECT_ID")
    require(project != "wmgj-ops" and not project.startswith("wmgj-hml-"), "NON_PRODUCTION_PROJECT")
    firebase = desired.get("firebase", {})
    historical = firebase.get("historicalProductionProjectCandidates", [])
    require(isinstance(historical, list), "HISTORICAL_CANDIDATES")
    require(all(isinstance(item, dict) for item in historical), "HISTORICAL_CANDIDATES")
    require(project not in [item.get("projectId") for item in historical], "HISTORICAL_CANDIDATE")
    require(isinstance(number, str) and re.fullmatch(r"[1-9][0-9]{0,19}", number), "PROJECT_NUMBER")
    require(project == approved_project and number == approved_number, "APPROVED_PROJECT_MISMATCH")
    require(firebase.get("productionProjectId") == project, "DOMAIN_PROJECT_MISMATCH")
    require(firebase.get("productionProjectNumber") == number, "DOMAIN_PROJECT_NUMBER_MISMATCH")
    require(firebase.get("productionProvisioningStatus") == "READY_FOR_PROVISIONING", "DOMAIN_NOT_READY")
    require(request.get("region") == "southamerica-east1", "REGION")
    require(request.get("organizationId") == "wmgj", "ORGANIZATION")
    for state in (request, firebase.get("productionGuardrails", {})):
        require(state.get("deploymentStage") == "COLD_PRODUCTION", "DEPLOYMENT_STAGE")
        for field in ("productionMutation", "sourceMutation", "clinicalSensitiveEnabled"):
            require(state.get(field) is False, "GUARDRAILS")
    require(firebase["productionGuardrails"].get("projectionEnabled") is False, "PROJECTION")
    require(firebase["productionGuardrails"].get("projectionMode") == "SHADOW", "PROJECTION_MODE")
    sha = request.get("expectedSourceSha")
    require(isinstance(sha, str) and re.fullmatch(r"[a-f0-9]{40}", sha), "SOURCE_SHA")
    return project, number


def validate_wif(project, number, provider, service_account):
    expected = f"projects/{number}/locations/global/workloadIdentityPools/aurora-github/providers/github"
    require(provider == expected, "WIF_PROJECT_MISMATCH")
    require(service_account == f"aurora-prod-deploy@{project}.iam.gserviceaccount.com", "SERVICE_ACCOUNT_MISMATCH")


def lookup_failure(args, category):
    # Emit only fixed labels, never cloud stderr, credentials or response bodies.
    stages = {("projects", "describe"): "PROJECT", ("billing", "projects", "describe"): "BILLING"}
    stage = stages.get(tuple(args[:-1]), "UNKNOWN")
    return ContractError(f"GCP_LOOKUP_FAILED_NO_MUTATION:{stage}:{category}")


def describe(args):
    executable = shutil.which("gcloud")
    require(executable is not None, "GCLOUD_UNAVAILABLE")
    try:
        result = subprocess.run([executable, *args, "--format=json", "--quiet"],
                                capture_output=True, text=True, timeout=60, check=False)
    except subprocess.TimeoutExpired as error:
        raise lookup_failure(args, "TIMEOUT") from error
    except OSError as error:
        raise lookup_failure(args, "EXECUTION_ERROR") from error
    if result.returncode != 0:
        detail = result.stderr or ""
        category = "UNCLASSIFIED"
        for marker in ("SERVICE_DISABLED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "IAM_PERMISSION_DENIED",
                       "PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND", "RESOURCE_EXHAUSTED",
                       "UNAVAILABLE", "DEADLINE_EXCEEDED"):
            if marker in detail:
                category = marker
                break
        raise lookup_failure(args, category)
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise ContractError("GCP_RESPONSE_INVALID") from error
    require(isinstance(value, dict), "GCP_RESPONSE_INVALID")
    return value


def verify_live(project, number):
    metadata = describe(["projects", "describe", project])
    require(metadata.get("projectId") == project, "GCP_PROJECT_MISMATCH")
    require(str(metadata.get("projectNumber", "")) == number, "GCP_PROJECT_NUMBER_MISMATCH")
    require(metadata.get("lifecycleState") == "ACTIVE", "GCP_PROJECT_NOT_ACTIVE")
    billing = describe(["billing", "projects", "describe", project])
    require(billing.get("projectId") == project and billing.get("billingEnabled") is True, "GCP_BILLING_NOT_ENABLED")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approved-project", required=True)
    parser.add_argument("--approved-number", required=True)
    parser.add_argument("--verify-live", action="store_true")
    parser.add_argument("--require-wif", action="store_true")
    parser.add_argument("--wif-provider", default="")
    parser.add_argument("--service-account", default="")
    args = parser.parse_args(argv)
    try:
        request = json.loads(REQUEST.read_text(encoding="utf-8"))
        desired = json.loads(DESIRED.read_text(encoding="utf-8"))
        project, number = validate_contract(request, desired, args.approved_project, args.approved_number)
        if args.require_wif:
            validate_wif(project, number, args.wif_provider, args.service_account)
        if args.verify_live:
            verify_live(project, number)
    except (ContractError, OSError, ValueError, TypeError, AttributeError) as error:
        reason = str(error) if isinstance(error, ContractError) else "INVALID_CONTRACT"
        print(f"AURORA_PRODUCTION_BLOCKED={reason}", file=sys.stderr)
        return 41
    print("AURORA_PRODUCTION_PROJECT_LIVE_VERIFIED" if args.verify_live else "AURORA_PRODUCTION_CONTRACT_VALID")
    return 0


if __name__ == "__main__":
    sys.exit(main())
