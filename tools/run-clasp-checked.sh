#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: run-clasp-checked.sh FUNCTION OUTPUT_JSON [PARAMS_JSON]" >&2
  exit 64
fi

function_name="$1"
output_json="$2"
params_json="${3-}"
execution_deployment_id="${APPS_SCRIPT_EXECUTION_DEPLOYMENT_ID-}"

if [[ ! "$function_name" =~ ^[A-Za-z_][A-Za-z0-9_]{0,127}$ ]]; then
  echo "::error title=Apps Script invalid function name::The requested function name is outside the fail-closed allowlist." >&2
  exit 64
fi
if [ -n "$params_json" ] && ! jq -e 'type == "array"' <<<"$params_json" >/dev/null 2>&1; then
  echo "::error title=Apps Script invalid parameters::Function parameters must be one valid JSON array." >&2
  exit 64
fi
if [[ ! "$execution_deployment_id" =~ ^[A-Za-z0-9_-]{20,512}$ ]]; then
  echo "::error title=Apps Script deployment ID missing::A canonical API-executable deployment ID is required." >&2
  exit 64
fi
if [ ! -f .clasp.json ] || ! jq -e 'type=="object" and (.scriptId|type=="string" and length>0)' .clasp.json >/dev/null 2>&1; then
  echo "::error title=Apps Script project configuration missing::A valid project .clasp.json is required." >&2
  exit 64
fi

tmp_out="$(mktemp)"
tmp_err="$(mktemp)"
tmp_project="$(mktemp -d)"
cleanup() { rm -f "$tmp_out" "$tmp_err"; rm -rf "$tmp_project"; }
trap cleanup EXIT

# clasp 3.4.1 passes .clasp.json's scriptId to scripts.run. The Execution API
# requires the API-executable deployment ID, not the mutable project script ID.
# Keep list/push configuration untouched and run from an isolated config.
jq --arg deployment "$execution_deployment_id" \
  '.scriptId=$deployment | .rootDir="."' .clasp.json > "$tmp_project/.clasp.json"
chmod 600 "$tmp_project/.clasp.json"

# --json is a clasp global option. Put it before the canonical command name so
# aliases/Commander parsing cannot silently fall back to human-oriented output.
cmd=(clasp --json run-function "$function_name" --nondev)
if [ -n "$params_json" ]; then
  cmd+=(--params "$params_json")
fi

set +e
(
  cd "$tmp_project"
  CI=1 NO_COLOR=1 "${cmd[@]}"
) >"$tmp_out" 2>"$tmp_err"
rc=$?
set -e

if grep -Eqi 'Unable to run script function|NOT_AUTHORIZED|permission to run the script function' "$tmp_out" "$tmp_err"; then
  echo "::error title=Apps Script Execution API unauthorized::Function $function_name could not run with the configured OAuth identity." >&2
  exit 71
fi
if grep -Eqi 'Script function not found|API executable not published|not deployed as API executable' "$tmp_out" "$tmp_err"; then
  echo "::error title=Apps Script API executable unavailable::Function $function_name is not reachable through a deployed API executable." >&2
  exit 72
fi
if [ "$rc" -ne 0 ]; then
  echo "::error title=Apps Script execution failed::Function $function_name exited with clasp status $rc." >&2
  exit "$rc"
fi
if [ "$(wc -c < "$tmp_out")" -gt 1048576 ]; then
  echo "::error title=Apps Script oversized response::Function $function_name exceeded the one-megabyte response limit." >&2
  exit 73
fi
if ! jq -e 'type=="object" and has("response") and (.error == null) and (.response != null)' "$tmp_out" >/dev/null 2>&1; then
  error_code="$(jq -r 'if type=="object" then (.error.code // "UNKNOWN") else "UNKNOWN" end' "$tmp_out" 2>/dev/null || printf 'UNKNOWN')"
  error_code="$(printf '%s' "$error_code" | tr -cd 'A-Za-z0-9_.:-' | cut -c1-80)"
  test -n "$error_code" || error_code="UNKNOWN"
  echo "::error title=Apps Script invalid execution response::Function $function_name returned an invalid or unsuccessful JSON envelope (code $error_code); response details were withheld." >&2
  exit 73
fi

umask 077
cp "$tmp_out" "$output_json"
