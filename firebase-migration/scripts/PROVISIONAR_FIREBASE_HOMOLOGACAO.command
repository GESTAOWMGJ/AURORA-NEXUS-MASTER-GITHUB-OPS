#!/bin/bash
set -Eeuo pipefail
umask 077

# WMGJ — provisionamento controlado, exclusivamente de homologação.
ROOT="${WMGJ_ROOT:-$HOME/WMGJ_OPERACAO}"
CONFIG="$ROOT/config/wmgj.env"
APPROVAL="$ROOT/config/APPROVE_FIREBASE_HOMOLOGATION"
STATE="$ROOT/state"
LOGS="$ROOT/logs"
APPLY="$ROOT/bin/wmgj-firebase-homologation.sh"
FINAL_STATE="$ROOT/bin/wmgj-final-state.sh"
INSTALL_DEPS="$ROOT/bin/wmgj-install-dependencies.sh"
PREFIX="wmgj-hml-jfn"
DISPLAY_NAME="WMGJ Firestore Homologacao"
REGION="southamerica-east1"
ORG_ID="wmgj"
KEY_ID="apps-script-homolog-2026-08"
BUDGET_VALUE="100"
RUN_ID="hml-$(date '+%Y%m%d-%H%M%S')-$$"
LOG="$LOGS/provision-$RUN_ID.log"
MARKER="$STATE/firebase-controlled-provisioning.json"
mkdir -p "$ROOT/config" "$STATE" "$LOGS"

write_marker() {
  local ok="$1" status="$2" detail="${3:-}"
  cat > "$MARKER" <<JSON
{"ok":$ok,"status":"$status","projectId":"${PROJECT_ID:-}","environment":"HOMOLOGATION","orgId":"wmgj","detail":"$detail","productionMutation":false,"sourceMutation":false,"updatedAt":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
JSON
  chmod 600 "$MARKER"
}

fail() {
  local code="$1" status="$2" detail="$3"
  write_marker false "$status" "$detail"
  printf '\nERRO [%s] %s\nLog: %s\n' "$status" "$detail" "$LOG" >&2
  [ -x "$FINAL_STATE" ] && "$FINAL_STATE" --write >/dev/null 2>&1 || true
  exit "$code"
}

set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if [ -f "$CONFIG" ]; then
    awk -v key="$key" -v value="$value" 'BEGIN{f=0} index($0,key"=")==1{print key"="value;f=1;next}{print} END{if(!f)print key"="value}' "$CONFIG" > "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" > "$tmp"
  fi
  mv "$tmp" "$CONFIG"
  chmod 600 "$CONFIG"
}

require_local() {
  [ "$(uname -s)" = "Darwin" ] || fail 10 BLOCKED_NOT_MACOS "Exclusivo para macOS."
  [ "$(id -u)" -ne 0 ] || fail 11 BLOCKED_ROOT "Não use sudo/root."
  [ -t 0 ] && [ -t 1 ] || fail 12 BLOCKED_NON_INTERACTIVE "Abra pelo Finder/Terminal; TRIGGERcmd não executa o apply."
  [ -x "$APPLY" ] || fail 13 BLOCKED_INSTALLER_MISSING "Script-base ausente: $APPLY"
}

ensure_tools() {
  local missing="" cmd
  for cmd in firebase gcloud jq git node npm java openssl security curl; do
    command -v "$cmd" >/dev/null 2>&1 || missing="$missing $cmd"
  done
  if [ -n "$missing" ]; then
    printf 'Dependências ausentes:%s\nDigite INSTALAR para usar o instalador WMGJ: ' "$missing"
    read -r answer
    [ "$answer" = INSTALAR ] || fail 20 BLOCKED_LOCAL_DEPENDENCIES "Toolchain incompleto."
    [ -x "$INSTALL_DEPS" ] && command -v brew >/dev/null 2>&1 || fail 21 BLOCKED_HOMEBREW "Homebrew/instalador indisponível."
    "$INSTALL_DEPS" || fail 22 FAILED_DEPENDENCY_INSTALL "Instalação de dependências falhou."
    hash -r
  fi
  [ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || fail 23 BLOCKED_NODE_VERSION "Node 22 é obrigatório."
  local jv jm
  jv="$(java -version 2>&1 | awk -F'"' '/version/{print $2;exit}')"; jm="${jv%%.*}"
  case "$jm" in ''|*[!0-9]*) jm=0;; esac
  [ "$jm" -ge 21 ] || fail 24 BLOCKED_JAVA_VERSION "Java 21+ é obrigatório."
}

ensure_auth() {
  firebase projects:list --json >/dev/null 2>&1 || firebase login --reauth || fail 30 BLOCKED_FIREBASE_AUTH "Login Firebase não concluído."
  gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . || gcloud auth login || fail 31 BLOCKED_GCLOUD_AUTH "Login gcloud não concluído."
  gcloud auth application-default print-access-token >/dev/null 2>&1 || gcloud auth application-default login || fail 32 BLOCKED_ADC_AUTH "ADC não concluída."
}

choose_project() {
  PROJECT_ID="${WMGJ_FIREBASE_PROJECT_ID:-}"
  [ -n "$PROJECT_ID" ] || PROJECT_ID="$PREFIX-$(date '+%Y%m%d')-$(openssl rand -hex 2)"
  case "$PROJECT_ID" in "$PREFIX"-*) ;; *) fail 40 BLOCKED_PROJECT_PREFIX "ID deve iniciar por $PREFIX-.";; esac
  case "$PROJECT_ID" in *prod*|*production*|*live*|*principal*) fail 41 BLOCKED_PRODUCTION_ID "Marcador de produção proibido.";; esac
  printf '%s' "$PROJECT_ID" | grep -Eq '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' || fail 42 BLOCKED_PROJECT_FORMAT "Project ID inválido."
}

choose_billing() {
  local f count idx choice current
  f="$(mktemp)"
  gcloud billing accounts list --filter='open=true' --format='value(name,displayName)' > "$f" 2>/dev/null || fail 50 BLOCKED_BILLING_LIST "Não foi possível listar billing."
  sed -i '' '/^[[:space:]]*$/d' "$f" 2>/dev/null || true
  count="$(wc -l < "$f" | tr -d ' ')"; [ "$count" -ge 1 ] || fail 51 BLOCKED_NO_BILLING "Nenhuma conta aberta."
  current="${WMGJ_BILLING_ACCOUNT_ID:-}"
  if [ -n "$current" ] && awk -F '\t' -v id="$current" '$1==id||$1=="billingAccounts/"id{f=1}END{exit f?0:1}' "$f"; then
    BILLING_ID="${current#billingAccounts/}"
  elif [ "$count" -eq 1 ]; then
    BILLING_ID="$(awk -F '\t' 'NR==1{print $1}' "$f")"; BILLING_ID="${BILLING_ID#billingAccounts/}"
  else
    printf '\nContas abertas:\n'; idx=1
    while IFS=$'\t' read -r id name; do printf '  %s) %s — %s\n' "$idx" "${id#billingAccounts/}" "$name"; idx=$((idx+1)); done < "$f"
    printf 'Selecione a conta de HOMOLOGAÇÃO: '; read -r choice
    case "$choice" in ''|*[!0-9]*) rm -f "$f"; fail 52 BLOCKED_BILLING_SELECTION "Seleção inválida.";; esac
    [ "$choice" -ge 1 ] && [ "$choice" -le "$count" ] || { rm -f "$f"; fail 53 BLOCKED_BILLING_SELECTION "Fora da faixa."; }
    BILLING_ID="$(awk -F '\t' -v n="$choice" 'NR==n{print $1}' "$f")"; BILLING_ID="${BILLING_ID#billingAccounts/}"
  fi
  rm -f "$f"
}

choose_app_access() {
  local raw email
  raw="${AURORA_NEXUS_ALLOWED_EMAILS:-}"
  if [ -z "$raw" ]; then
    printf 'E-mails individuais autorizados no app (separados por vírgula; não use grupo compartilhado): '
    read -r raw
  fi
  ALLOWED_EMAILS="$(printf '%s' "$raw" | tr ';' ',' | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g;s/,,*/,/g;s/^,//;s/,$//')"
  [ -n "$ALLOWED_EMAILS" ] || fail 54 BLOCKED_ALLOWED_EMAILS "Informe ao menos um e-mail individual."
  OLD_IFS="$IFS"; IFS=','
  for email in $ALLOWED_EMAILS; do
    printf '%s' "$email" | grep -Eq '^[A-Za-z0-9.!#$%&'"'"'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' \
      || { IFS="$OLD_IFS"; fail 55 BLOCKED_ALLOWED_EMAILS "Formato de e-mail inválido."; }
  done
  IFS="$OLD_IFS"
}

configure() {
  set_env WMGJ_FIREBASE_PROJECT_ID "$PROJECT_ID"
  set_env WMGJ_FIREBASE_DISPLAY_NAME '"WMGJ Firestore Homologacao"'
  set_env WMGJ_FIREBASE_LOCATION "$REGION"
  set_env WMGJ_FIREBASE_REGION "$REGION"
  set_env WMGJ_FIRESTORE_DATABASE_ID '"(default)"'
  set_env WMGJ_FIREBASE_ORG_ID "$ORG_ID"
  set_env WMGJ_HMAC_KEY_ID "$KEY_ID"
  set_env WMGJ_REPO_BRANCH main
  set_env WMGJ_BILLING_ACCOUNT_ID "$BILLING_ID"
  set_env WMGJ_ROTATE_HMAC NO
  set_env WMGJ_FIRESTORE_DRY_RUN true
  set_env WMGJ_FIRESTORE_MAX_ROWS 10
}

confirm() {
  cat <<PLAN

=== FIREBASE WMGJ — HOMOLOGAÇÃO CONTROLADA ===
Project ID:      $PROJECT_ID
Região:          $REGION
Organização:     organizations/$ORG_ID
Billing:         $BILLING_ID
Orçamento:       $BUDGET_VALUE na moeda da conta (alerta; não é teto)
Firestore:       Native, (default), delete protection ENABLED
Dados clínicos:  DESABILITADOS
Produção:        NÃO selecionada e NÃO alterada
Apps Script:     DRY_RUN=true
PLAN
  printf 'Digite PROVISIONAR HOMOLOGACAO: '; read -r phrase
  [ "$phrase" = "PROVISIONAR HOMOLOGACAO" ] || fail 60 CANCELLED_CONFIRMATION "Frase divergente."
  printf 'Digite o Project ID exatamente: '; read -r check
  [ "$check" = "$PROJECT_ID" ] || fail 61 CANCELLED_PROJECT_CONFIRMATION "Project ID divergente."
  cat > "$APPROVAL" <<EOF2
APPROVED=YES
APPROVED_PROJECT_ID=$PROJECT_ID
APPROVED_ENVIRONMENT=HOMOLOGATION
PRODUCTION_AUTHORIZED=NO
APPROVED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
EOF2
  chmod 600 "$APPROVAL"
}

project_exists() {
  firebase projects:list --json 2>/dev/null | jq -e --arg p "$PROJECT_ID" '..|objects|select(.projectId?==$p)' >/dev/null 2>&1
}

cost_controls() {
  project_exists || firebase projects:create "$PROJECT_ID" --display-name "$DISPLAY_NAME" --non-interactive || fail 70 FAILED_PROJECT_CREATE "ID ocupado ou permissão insuficiente."
  gcloud billing projects link "$PROJECT_ID" --billing-account "$BILLING_ID" --quiet || fail 71 FAILED_BILLING_LINK "Vínculo de billing falhou."
  gcloud projects update "$PROJECT_ID" --update-labels='environment=homologation,system=wmgj,data_scope=nonclinical,managed_by=jfn' --quiet >/dev/null || fail 72 FAILED_LABELS "Labels falharam."
  gcloud services enable billingbudgets.googleapis.com --project "$PROJECT_ID" --quiet || fail 73 FAILED_BUDGET_API "API de budget falhou."
  local name currency amount existing
  name="WMGJ HML $PROJECT_ID"
  currency="$(gcloud billing accounts describe "$BILLING_ID" --format='value(currencyCode)' 2>/dev/null || true)"; [ -n "$currency" ] || currency=BRL
  amount="${BUDGET_VALUE}${currency}"
  existing="$(gcloud billing budgets list --billing-account "$BILLING_ID" --filter="displayName='$name'" --format='value(name)' 2>/dev/null | head -n1 || true)"
  [ -n "$existing" ] || gcloud billing budgets create --billing-account "$BILLING_ID" --display-name "$name" --budget-amount "$amount" --filter-projects "projects/$PROJECT_ID" --calendar-period month --threshold-rule percent=0.50 --threshold-rule percent=0.80 --threshold-rule percent=1.00 --quiet || fail 74 FAILED_BUDGET "Budget falhou."
  printf '{"ok":true,"projectId":"%s","budget":"%s","thresholds":[0.5,0.8,1.0],"productionMutation":false}\n' "$PROJECT_ID" "$amount" > "$STATE/firebase-cost-controls.json"
}

configure_app_secrets() {
  local name csrf
  gcloud services enable secretmanager.googleapis.com --project "$PROJECT_ID" --quiet || fail 78 FAILED_SECRET_MANAGER_API "Secret Manager indisponível."
  for name in AURORA_NEXUS_ALLOWED_EMAILS AURORA_NEXUS_CSRF_HMAC_KEY; do
    gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1 \
      || gcloud secrets create "$name" --project "$PROJECT_ID" --replication-policy=automatic --quiet >/dev/null \
      || fail 79 FAILED_APP_SECRET_CREATE "Não foi possível criar $name."
  done
  printf '%s' "$ALLOWED_EMAILS" | gcloud secrets versions add AURORA_NEXUS_ALLOWED_EMAILS --project "$PROJECT_ID" --data-file=- --quiet >/dev/null \
    || fail 79 FAILED_APP_SECRET_VERSION "Não foi possível versionar a allowlist."
  csrf="$(openssl rand -hex 32)"
  printf '%s' "$csrf" | gcloud secrets versions add AURORA_NEXUS_CSRF_HMAC_KEY --project "$PROJECT_ID" --data-file=- --quiet >/dev/null \
    || fail 79 FAILED_APP_SECRET_VERSION "Não foi possível versionar a chave CSRF."
  unset csrf ALLOWED_EMAILS AURORA_NEXUS_ALLOWED_EMAILS
  printf '{"ok":true,"projectId":"%s","allowedEmailsSecret":true,"csrfHmacSecret":true,"valuesExposed":false}\n' "$PROJECT_ID" > "$STATE/firebase-app-secrets.json"
}

configure_app_guardrails() {
  local token payload url
  token="$(gcloud auth application-default print-access-token 2>/dev/null)" || fail 76 FAILED_ADC_TOKEN "ADC indisponível para configurar a organização."
  payload='{"fields":{"active":{"booleanValue":true},"environment":{"stringValue":"HOMOLOGATION"},"projectionEnabled":{"booleanValue":false},"projectionMode":{"stringValue":"SHADOW"},"organicEnabled":{"booleanValue":true},"organicSectors":{"arrayValue":{"values":[{"stringValue":"AUDIT"},{"stringValue":"FINANCE"}]}},"clinicalSensitiveEnabled":{"booleanValue":false},"productionMutation":{"booleanValue":false},"sourceMutation":{"booleanValue":false}}}'
  url="https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents/organizations/$ORG_ID?updateMask.fieldPaths=active&updateMask.fieldPaths=environment&updateMask.fieldPaths=projectionEnabled&updateMask.fieldPaths=projectionMode&updateMask.fieldPaths=organicEnabled&updateMask.fieldPaths=organicSectors&updateMask.fieldPaths=clinicalSensitiveEnabled&updateMask.fieldPaths=productionMutation&updateMask.fieldPaths=sourceMutation"
  curl -fsS -X PATCH -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data "$payload" "$url" >/dev/null \
    || fail 77 FAILED_APP_GUARDRAILS "Não foi possível fixar os bloqueios iniciais da organização."
  printf '{"ok":true,"projectId":"%s","orgId":"%s","projectionEnabled":false,"projectionMode":"SHADOW","organicEnabled":true,"organicSectors":["AUDIT","FINANCE"],"clinicalSensitiveEnabled":false,"productionMutation":false,"sourceMutation":false}\n' "$PROJECT_ID" "$ORG_ID" > "$STATE/firebase-app-guardrails.json"
}

verify() {
  local billing db functions ingest_secret allowed_secret csrf_secret org org_json token deploy budget health_url health=false ok=false
  billing="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)"
  db=false; firebase firestore:databases:list --project "$PROJECT_ID" --json 2>/dev/null | grep -Fq '(default)' && db=true
  functions="$(firebase functions:list --project "$PROJECT_ID" --json 2>/dev/null | jq -c '[..|objects|.id?//.name?//empty]|unique' 2>/dev/null || printf '[]')"
  for fn in ingestWmgjEvent runtimeHealth auroraNexusAuthGate auroraNexusSessionLogin auroraNexusSessionLogout auroraNexusBootstrap auroraNexusNativeInsight auroraNexusMasterEngine auroraNexusAction auroraNexusRefresh auroraNexusProjectionEngine auroraNexusOrganic auroraNexusIntegrationKeys auroraNexusIntegrationPing; do
    printf '%s' "$functions" | grep -Fq "$fn" || fail 80 VERIFY_FUNCTIONS "Function obrigatória ausente: $fn"
  done
  ingest_secret=false; firebase functions:secrets:get WMGJ_INGEST_HMAC_KEYRING --project "$PROJECT_ID" >/dev/null 2>&1 && ingest_secret=true
  allowed_secret=false; firebase functions:secrets:get AURORA_NEXUS_ALLOWED_EMAILS --project "$PROJECT_ID" >/dev/null 2>&1 && allowed_secret=true
  csrf_secret=false; firebase functions:secrets:get AURORA_NEXUS_CSRF_HMAC_KEY --project "$PROJECT_ID" >/dev/null 2>&1 && csrf_secret=true
  org=false
  token="$(gcloud auth application-default print-access-token 2>/dev/null || true)"
  if [ -n "$token" ]; then
    org_json="$(curl -fsS -H "Authorization: Bearer $token" "https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents/organizations/$ORG_ID" 2>/dev/null || true)"
    printf '%s' "$org_json" | jq -e '.fields.active.booleanValue==true and .fields.environment.stringValue=="HOMOLOGATION" and .fields.projectionEnabled.booleanValue==false and .fields.projectionMode.stringValue=="SHADOW" and .fields.organicEnabled.booleanValue==true and ([.fields.organicSectors.arrayValue.values[]?.stringValue] | index("AUDIT")) != null and ([.fields.organicSectors.arrayValue.values[]?.stringValue] | index("FINANCE")) != null and .fields.clinicalSensitiveEnabled.booleanValue==false and .fields.productionMutation.booleanValue==false and .fields.sourceMutation.booleanValue==false' >/dev/null 2>&1 && org=true
  fi
  deploy=false; [ -f "$STATE/firebase-deploy.json" ] && jq -e --arg p "$PROJECT_ID" '.ok==true and .projectId==$p and .productionMutation==false' "$STATE/firebase-deploy.json" >/dev/null 2>&1 && deploy=true
  budget=false; gcloud billing budgets list --billing-account "$BILLING_ID" --filter="displayName='WMGJ HML $PROJECT_ID'" --format='value(name)' 2>/dev/null | grep -q . && budget=true
  health_url="$(gcloud functions describe runtimeHealth --gen2 --region "$REGION" --project "$PROJECT_ID" --format='value(serviceConfig.uri)' 2>/dev/null || true)"
  [ -n "$health_url" ] && curl -fsS "$health_url" | jq -e '.ok==true and .service=="wmgj-firestore-ingestion"' >/dev/null 2>&1 && health=true
  [ "$billing" = True ] && [ "$db" = true ] && [ "$ingest_secret" = true ] && [ "$allowed_secret" = true ] && [ "$csrf_secret" = true ] && [ "$org" = true ] && [ "$deploy" = true ] && [ "$budget" = true ] && [ "$health" = true ] && ok=true
  cat > "$STATE/firebase-homologation-verification.json" <<JSON
{"ok":$ok,"projectId":"$PROJECT_ID","environment":"HOMOLOGATION","billingEnabled":"$billing","firestore":$db,"ingestHmacSecret":$ingest_secret,"allowedEmailsSecret":$allowed_secret,"csrfHmacSecret":$csrf_secret,"organizationWmgj":$org,"projectionEnabled":false,"projectionMode":"SHADOW","deployMarker":$deploy,"budget":$budget,"runtimeHealth":$health,"functions":$functions,"appsScriptDryRunRequired":true,"clinicalSensitiveEnabled":false,"productionMutation":false,"sourceMutation":false}
JSON
  [ "$ok" = true ] || fail 81 HOMOLOGATION_VERIFICATION_INCOMPLETE "Consulte firebase-homologation-verification.json."
}

require_local
write_marker false STARTED "Nenhuma mutação em produção autorizada."
exec > >(tee -a "$LOG") 2>&1
trap 'c=$?; write_marker false FAILED_UNHANDLED "exitCode=$c"; exit "$c"' ERR INT TERM
ensure_tools
ensure_auth
[ -f "$CONFIG" ] && . "$CONFIG"
choose_project
choose_billing
choose_app_access
configure
confirm
write_marker false APPROVED_LOCAL "Produção bloqueada."
cost_controls
write_marker false COST_CONTROLS_READY "Projeto HML, billing e orçamento preparados."
configure_app_secrets
ROOT="$ROOT" WMGJ_ROOT="$ROOT" "$APPLY" --apply
configure_app_guardrails

gcloud firestore fields ttls update expiresAt --collection-group=requestNonces --database='(default)' --enable-ttl --project="$PROJECT_ID" --async --quiet || fail 75 FAILED_NONCE_TTL "TTL de nonces não iniciou."
printf '{"ok":true,"projectId":"%s","collectionGroup":"requestNonces","field":"expiresAt","enableRequested":true,"productionMutation":false}\n' "$PROJECT_ID" > "$STATE/firebase-ttl-policy.json"

verify
write_marker true HOMOLOGATION_PROVISIONED "Firebase HML validado; Apps Script segue DRY_RUN=true."
[ -x "$FINAL_STATE" ] && "$FINAL_STATE" --write || true
cat <<DONE

FIREBASE WMGJ DE HOMOLOGAÇÃO PROVISIONADO
Project ID: $PROJECT_ID
Produção alterada: NÃO
Planilha-fonte alterada: NÃO
Próximo gate: Script Properties HML → wmgjFirestoreDiagnostico() → wmgjFirestoreMigracaoDryRun(10)
DONE
open "$STATE/ESTADO_FINAL_WMGJ_FIREBASE.md" >/dev/null 2>&1 || true
