#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: ensure-appscript-execution-deployment.sh OUTPUT_JSON" >&2
  exit 64
fi

output_json="$1"
prefix="AURORA_EXECUTION_API_CANONICAL"
description="$prefix ${GITHUB_SHA:-manual}"

deployments="$(clasp deployments --json)"
deployment_id="$(jq -r --arg prefix "$prefix" '
  [.[] | select((.description // "") | startswith($prefix))]
  | sort_by(.versionNumber // 0)
  | last
  | .deploymentId // empty
' <<<"$deployments")"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if [ -n "$deployment_id" ]; then
  clasp redeploy "$deployment_id" --description "$description" --json >"$tmp"
else
  clasp deploy --description "$description" --json >"$tmp"
fi

jq -e '.deploymentId and (.versionNumber|tonumber) >= 1' "$tmp" >/dev/null
umask 077
cp "$tmp" "$output_json"
