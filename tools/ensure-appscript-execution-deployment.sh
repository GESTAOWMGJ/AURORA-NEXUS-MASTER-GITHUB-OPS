#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: ensure-appscript-execution-deployment.sh OUTPUT_JSON" >&2
  exit 64
fi

output_json="$1"
prefix="AURORA_EXECUTION_API_CANONICAL"
description="$prefix ${GITHUB_SHA:-manual}"

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

deployment_id="$(jq -r --arg prefix "$prefix" '
  [.[] | select((.description // "") | startswith($prefix))]
  | map(select((.versionNumber | tonumber?) >= 1))
  | sort_by(.versionNumber | tonumber)
  | last
  | .deploymentId // empty
' "$tmp_dir/deployments.json")"

set +e
if [ -n "$deployment_id" ]; then
  CI=1 NO_COLOR=1 clasp --json update-deployment "$deployment_id" --description "$description" \
    >"$tmp_dir/deployment.json" 2>"$tmp_dir/deployment.err"
else
  CI=1 NO_COLOR=1 clasp --json create-deployment --description "$description" \
    >"$tmp_dir/deployment.json" 2>"$tmp_dir/deployment.err"
fi
deploy_rc=$?
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
umask 077
cp "$tmp_dir/deployment.json" "$output_json"
