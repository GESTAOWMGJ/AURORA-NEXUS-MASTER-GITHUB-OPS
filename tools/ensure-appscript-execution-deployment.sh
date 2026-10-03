#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: ensure-appscript-execution-deployment.sh OUTPUT_JSON" >&2
  exit 64
fi

output_json="$1"
prefix="AURORA_EXECUTION_API_CANONICAL"
source_sha="${GITHUB_SHA-}"
if [[ ! "$source_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo "::error title=Apps Script source SHA missing::An exact main commit SHA is required to publish an API deployment." >&2
  exit 64
fi
description="$prefix $source_sha"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

set +e
CI=1 NO_COLOR=1 clasp --json list-deployments >"$tmp_dir/deployments.json" 2>"$tmp_dir/deployments.err"
list_rc=$?
set -e
if [ "$list_rc" -ne 0 ]; then
  echo "::error title=Apps Script deployment lookup failed::clasp exited with status $list_rc; response details were withheld." >&2
  exit "$list_rc"
fi
if ! jq -e '
  type == "array" and
  all(.[];
    type == "object" and
    (.deploymentId | type == "string" and length > 0 and length <= 512) and
    ((.versionNumber == null) or ((.versionNumber | tonumber?) >= 1)) and
    ((.description == null) or (.description | type == "string"))
  )
' "$tmp_dir/deployments.json" >/dev/null 2>&1; then
  echo "::error title=Apps Script invalid deployment list::clasp did not return one valid JSON deployment array; response details were withheld." >&2
  exit 73
fi

matching_count="$(jq -r --arg description "$description" '
  [.[] | select(.description == $description and ((.versionNumber | tonumber?) >= 1))]
  | length
' "$tmp_dir/deployments.json")"
if [ "$matching_count" -gt 1 ]; then
  echo "::error title=Apps Script ambiguous immutable deployment::More than one API deployment is bound to the exact source SHA." >&2
  exit 73
fi

set +e
if [ "$matching_count" -eq 1 ]; then
  jq -c --arg description "$description" '
    [.[] | select(.description == $description and ((.versionNumber | tonumber?) >= 1))][0]
  ' "$tmp_dir/deployments.json" >"$tmp_dir/deployment.json"
  deploy_rc=$?
  reused=true
else
  CI=1 NO_COLOR=1 clasp --json create-deployment --description "$description" \
    >"$tmp_dir/deployment.json" 2>"$tmp_dir/deployment.err"
  deploy_rc=$?
  reused=false
fi
set -e
if [ "$deploy_rc" -ne 0 ]; then
  echo "::error title=Apps Script canonical deployment failed::clasp exited with status $deploy_rc; response details were withheld." >&2
  exit "$deploy_rc"
fi

if ! jq -e --arg description "$description" '
  type == "object" and
  (.deploymentId | type == "string" and length > 0 and length <= 512) and
  ((.versionNumber | tonumber?) >= 1) and
  .description == $description
' "$tmp_dir/deployment.json" >/dev/null 2>&1; then
  echo "::error title=Apps Script invalid deployment response::clasp did not return the expected canonical JSON deployment; response details were withheld." >&2
  exit 73
fi

deployment_id="$(jq -r '.deploymentId' "$tmp_dir/deployment.json")"
version_number="$(jq -r '.versionNumber | tonumber' "$tmp_dir/deployment.json")"
[[ "$deployment_id" =~ ^[A-Za-z0-9_-]{20,512}$ ]]
[[ "$version_number" =~ ^[0-9]+$ ]]
test "$version_number" -ge 1
umask 077
jq -n \
  --arg deploymentId "$deployment_id" \
  --argjson versionNumber "$version_number" \
  --arg description "$description" \
  --arg sourceSha "$source_sha" \
  --argjson reused "$reused" \
  '{deploymentId:$deploymentId,versionNumber:$versionNumber,description:$description,sourceSha:$sourceSha,reused:$reused}' \
  > "$output_json"
