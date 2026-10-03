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
if ! jq -se 'length==1 and (.[0] | type=="object" and has("response") and (.error == null) and (.response != null))' "$tmp_out" >/dev/null 2>&1; then
  # Only fixed RC1.1 identifiers may reach logs. A prefix regex alone could
  # expose a secret disguised as RC11_*. Never print arbitrary API fields.
  error_summary="$(jq -sr '
    (if length == 1 then .[0] else null end)
    | (try .error.code catch null) as $code
    | (try (.error.details[0].errorMessage // .error.message) catch null) as $message
    | [
        "RC11_ABA_AUSENTE", "RC11_CABECALHO_BLOQUEADO",
        "RC11_CONFIRMACAO_INVALIDA", "RC11_CONFIG_INCOMPLETA",
        "RC11_CREDITO_AUSENTE", "RC11_CREDITO_VALOR_INESPERADO",
        "RC11_DRY_RUN_OBRIGATORIO", "RC11_ESCRITA_NAO_ATIVADA",
        "RC11_HMAC_EXISTENTE_AUSENTE", "RC11_HMAC_INVALIDO",
        "RC11_HMAC_PROBE_INESPERADO", "RC11_HMAC_SECRET_INVALIDO",
        "RC11_INGEST_URL_INVALIDA", "RC11_KEY_ID_INVALIDO",
        "RC11_KEYRING_INVALIDO", "RC11_LINHA_NAO_ENCONTRADA",
        "RC11_NF8_CHAVE_AUSENTE", "RC11_NF8_VALOR_INESPERADO",
        "RC11_VALOR_SERVICO_AUSENTE"
      ] as $allowed
    | ($code | if type == "number" then
        if . >= 0 and . <= 16 and floor == . then tostring else "UNKNOWN" end
      else "UNKNOWN" end) as $safe_code
    | ([ $message | select(type == "string")
         | scan("(?<![A-Za-z0-9_])RC11_[A-Za-z0-9_]+(?![A-Za-z0-9_])")
         | select(. as $id | $allowed | index($id))
       ] | .[0] // "UNEXPECTED_APPS_SCRIPT_EXECUTION_ERROR") as $safe_id
    | "\($safe_code): \($safe_id)"
  ' "$tmp_out" 2>/dev/null || printf 'UNKNOWN: UNEXPECTED_APPS_SCRIPT_EXECUTION_ERROR')"
  echo "::error title=Apps Script invalid execution response::Function $function_name returned error code $error_summary" >&2
  exit 73
fi

umask 077
cp "$tmp_out" "$output_json"
