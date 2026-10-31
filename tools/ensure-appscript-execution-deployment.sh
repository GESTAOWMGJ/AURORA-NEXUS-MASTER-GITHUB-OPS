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

# Recovery must retain the preflighted identity, even if remote state changes.
if [ -n "${CANONICAL_DEPLOYMENT_ID:-}" ] && [ "$deployment_id" != "$CANONICAL_DEPLOYMENT_ID" ]; then
  echo "CANONICAL_DEPLOYMENT_CHANGED" >&2
  exit 74
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Always bind the canonical deployment to an immutable Apps Script version for
# the exact Git source SHA, even when the pushed .gs bytes are unchanged.
version_output="$(clasp version "$description")"
version_number="$(sed -nE 's/.*Created version ([0-9]+)\..*/\1/p' <<<"$version_output" | tail -n 1)"
if [[ ! "$version_number" =~ ^[1-9][0-9]*$ ]]; then
  versions="$(clasp versions --json)"
  version_number="$(jq -r --arg description "$description" '
    [.[] | select((.description // "") == $description) | (.versionNumber|tonumber)]
    | max // empty
  ' <<<"$versions")"
fi
[[ "$version_number" =~ ^[1-9][0-9]*$ ]]

if [ -n "$deployment_id" ]; then
  clasp redeploy "$deployment_id" --versionNumber "$version_number" --description "$description" --json >"$tmp"
else
  clasp deploy --versionNumber "$version_number" --description "$description" --json >"$tmp"
fi

jq -e --argjson expected "$version_number" '
  .deploymentId and (.versionNumber|tonumber) == $expected
' "$tmp" >/dev/null
umask 077
cp "$tmp" "$output_json"
