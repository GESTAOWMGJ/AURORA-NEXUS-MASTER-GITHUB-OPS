#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: run-clasp-checked.sh FUNCTION OUTPUT_JSON [PARAMS_JSON]" >&2
  exit 64
fi

function_name="$1"
output_json="$2"
params_json="${3-}"

tmp_out="$(mktemp)"
tmp_err="$(mktemp)"
cleanup() { rm -f "$tmp_out" "$tmp_err"; }
trap cleanup EXIT

cmd=(clasp run "$function_name" --nondev --json)
if [ -n "$params_json" ]; then
  cmd+=(--params "$params_json")
fi

set +e
"${cmd[@]}" >"$tmp_out" 2>"$tmp_err"
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
if ! jq -e 'type=="object" and has("response") and (.error == null) and (.response != null)' "$tmp_out" >/dev/null 2>&1; then
  error_code="$(jq -r '.error.code // "UNKNOWN"' "$tmp_out" 2>/dev/null || printf 'UNKNOWN')"
  error_message="$(jq -r '.error.details[0].errorMessage // .error.message // "UNKNOWN"' "$tmp_out" 2>/dev/null || printf 'UNKNOWN')"
  error_message="$(printf '%s' "$error_message" | tr '\r\n' '  ' | sed -E 's/[A-Za-z0-9+\/_=-]{32,}/[REDACTED]/g' | cut -c1-240)"
  echo "::error title=Apps Script invalid execution response::Function $function_name returned error code $error_code: $error_message" >&2
  exit 73
fi

umask 077
cp "$tmp_out" "$output_json"
