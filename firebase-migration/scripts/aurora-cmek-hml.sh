#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
POLICY="$ROOT/firebase-migration/policy/cmek-hml-baseline-v1.json"
MODE="${1:-plan}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "MISSING_TOOL:$1" >&2; exit 2; }; }
for tool in jq gcloud curl sha256sum date; do need "$tool"; done
test -f "$POLICY"

PROJECT_ID="$(jq -r '.projectId' "$POLICY")"
DB_ID="$(jq -r '.databaseId' "$POLICY")"
LOCATION="$(jq -r '.location' "$POLICY")"
KEYRING="$(jq -r '.keyRing' "$POLICY")"
KEY="$(jq -r '.cryptoKey' "$POLICY")"
ROTATION_DAYS="$(jq -r '.rotationDays' "$POLICY")"
RESTORE_PREFIX="$(jq -r '.restoreDatabasePrefix' "$POLICY")"
KMS_RESOURCE="projects/${PROJECT_ID}/locations/${LOCATION}/keyRings/${KEYRING}/cryptoKeys/${KEY}"
SERVICE_AGENT=""

assert_static_gates() {
  test "$(jq -r '.productionMutation' "$POLICY")" = "false"
  test "$(jq -r '.clinicalSensitiveEnabled' "$POLICY")" = "false"
  test "$(jq -r '.realDataAllowed' "$POLICY")" = "false"
  test "$(jq -r '.destructiveOperationsAllowed' "$POLICY")" = "false"
  test "$(jq -r '.keyDestructionAllowed' "$POLICY")" = "false"
  test "$PROJECT_ID" = "wmgj-hml-jfn-20260927"
  test "$DB_ID" = "aurora-hml-cmek"
  test "$LOCATION" = "southamerica-east1"
}
assert_static_gates

active_account() {
  gcloud auth list --filter='status:ACTIVE' --format='value(account)' | head -n1
}

project_number() {
  gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'
}

service_agent() {
  local n
  n="$(project_number)"
  printf 'service-%s@gcp-sa-firestore.iam.gserviceaccount.com' "$n"
}

describe_db() {
  gcloud firestore databases describe --project "$PROJECT_ID" --database "$DB_ID" --format=json
}

plan() {
  echo "AURORA_CMEK_HML_PLAN"
  echo "project=$PROJECT_ID"
  echo "database=$DB_ID"
  echo "location=$LOCATION"
  echo "kms=$KMS_RESOURCE"
  echo "rotationDays=$ROTATION_DAYS"
  echo "deleteProtection=true"
  echo "pitr=true"
  echo "backup=daily/14d"
  echo "productionMutation=false"
  echo "clinicalSensitiveEnabled=false"
  echo "realDataAllowed=false"
  echo "destructiveOperationsAllowed=false"
  echo "keyDestructionAllowed=false"
  if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
    echo "projectReachable=true"
    echo "activeAccount=$(active_account)"
    gcloud firestore databases describe --project "$PROJECT_ID" --database "$DB_ID" --format='value(name)' >/dev/null 2>&1       && echo "databaseAlreadyExists=true" || echo "databaseAlreadyExists=false"
    gcloud kms keys describe "$KEY" --project "$PROJECT_ID" --location "$LOCATION" --keyring "$KEYRING" --format='value(name)' >/dev/null 2>&1       && echo "kmsKeyAlreadyExists=true" || echo "kmsKeyAlreadyExists=false"
  else
    echo "projectReachable=false"
  fi
}

apply() {
  test "${AURORA_CMEK_CONFIRMATION:-}" = "APPLY_AURORA_CMEK_HML" || {
    echo "BLOCKED_CONFIRMATION" >&2; exit 10;
  }
  test "${AURORA_FIRESTORE_CMEK_ACCESS_CONFIRMED:-}" = "YES" || {
    echo "BLOCKED_CMEK_ACCESS_CONFIRMATION" >&2; exit 12;
  }
  test "$(jq -r '.firestoreCmekFeatureAccessState' "$POLICY")" = "EXTERNALLY_CONFIRMED"
  test -n "$(active_account)" || { echo "BLOCKED_NO_GCLOUD_IDENTITY" >&2; exit 11; }

  gcloud services enable firestore.googleapis.com cloudkms.googleapis.com --project "$PROJECT_ID" --quiet
  gcloud beta services identity create --service=firestore.googleapis.com --project "$PROJECT_ID" >/dev/null
  SERVICE_AGENT="$(service_agent)"

  if ! gcloud kms keyrings describe "$KEYRING" --project "$PROJECT_ID" --location "$LOCATION" >/dev/null 2>&1; then
    gcloud kms keyrings create "$KEYRING" --project "$PROJECT_ID" --location "$LOCATION"
  fi

  if ! gcloud kms keys describe "$KEY" --project "$PROJECT_ID" --location "$LOCATION" --keyring "$KEYRING" >/dev/null 2>&1; then
    local rotation_epoch next_rotation_time
    rotation_epoch="$(( $(date -u +%s) + ROTATION_DAYS * 86400 ))"
    # GNU date (Cloud Shell/CI) and BSD date (macOS), always RFC3339 UTC.
    next_rotation_time="$(date -u -d "@$rotation_epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$rotation_epoch" +%Y-%m-%dT%H:%M:%SZ)"
    gcloud kms keys create "$KEY"       --project "$PROJECT_ID"       --location "$LOCATION"       --keyring "$KEYRING"       --purpose=encryption       --rotation-period="${ROTATION_DAYS}d"       --next-rotation-time="$next_rotation_time"       --protection-level=software       --labels=environment=hml,system=aurora-nexus,purpose=firestore-cmek
  fi

  gcloud kms keys add-iam-policy-binding "$KEY"     --project "$PROJECT_ID"     --location "$LOCATION"     --keyring "$KEYRING"     --member="serviceAccount:$SERVICE_AGENT"     --role=roles/cloudkms.cryptoKeyEncrypterDecrypter     --quiet >/dev/null

  if gcloud firestore databases describe --project "$PROJECT_ID" --database "$DB_ID" >/dev/null 2>&1; then
    db_json="$(describe_db)"
    test "$(jq -r '.locationId' <<<"$db_json")" = "$LOCATION"
    test "$(jq -r '.cmekConfig.kmsKeyName // empty' <<<"$db_json")" = "$KMS_RESOURCE"
    echo "AURORA_FIRESTORE_CMEK_RUNTIME_VERIFIED_EXISTING_DB"
  else
    gcloud firestore databases create       --project "$PROJECT_ID"       --database "$DB_ID"       --location "$LOCATION"       --type=firestore-native       --edition=standard       --kms-key-name="$KMS_RESOURCE"       --delete-protection       --enable-pitr       --quiet
    echo "AURORA_FIRESTORE_CMEK_RUNTIME_VERIFIED_CREATE"
  fi

  db_json="$(describe_db)"
  jq -e --arg loc "$LOCATION" --arg key "$KMS_RESOURCE" '
    .locationId==$loc and
    .type=="FIRESTORE_NATIVE" and
    .deleteProtectionState=="DELETE_PROTECTION_ENABLED" and
    .pointInTimeRecoveryEnablement=="POINT_IN_TIME_RECOVERY_ENABLED" and
    .cmekConfig.kmsKeyName==$key
  ' <<<"$db_json" >/dev/null

  if ! gcloud firestore backups schedules list --project "$PROJECT_ID" --database "$DB_ID" --format=json       | jq -e 'map(select(.dailyRecurrence!=null)) | length >= 1' >/dev/null; then
    gcloud firestore backups schedules create       --project "$PROJECT_ID"       --database "$DB_ID"       --recurrence=daily       --retention=14d
  fi

  token="$(gcloud auth print-access-token)"
  sentinel_payload='{"fields":{"kind":{"stringValue":"AURORA_CMEK_HML_SENTINEL"},"synthetic":{"booleanValue":true},"clinicalSensitive":{"booleanValue":false},"productionMutation":{"booleanValue":false}}}'
  curl -fsS -X PATCH     -H "Authorization: Bearer $token"     -H 'Content-Type: application/json'     --data "$sentinel_payload"     "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DB_ID}/documents/securityHml/sentinel" >/dev/null

  # Require active versions after the first synthetic write, not before it.
  # An absent version still blocks completion; it never promotes HML evidence.
  db_json="$(describe_db)"
  if ! jq -e --arg key "$KMS_RESOURCE" '
    .cmekConfig.kmsKeyName==$key and
    (.cmekConfig.activeKeyVersion | type)=="array" and
    (.cmekConfig.activeKeyVersion | length)>=1 and
    all(.cmekConfig.activeKeyVersion[]; startswith($key + "/cryptoKeyVersions/"))
  ' <<<"$db_json" >/dev/null; then
    echo "AURORA_CMEK_ACTIVE_KEY_VERSION_PENDING_AFTER_SYNTHETIC_WRITE" >&2
    exit 13
  fi

  echo "AURORA_CMEK_HML_APPLIED"
  echo "serviceAgent=$SERVICE_AGENT"
  printf '%s' "$KMS_RESOURCE" | sha256sum | awk '{print "kmsResourceSha256="$1}'
}

ready_backup() {
  local source backup_json
  source="projects/${PROJECT_ID}/databases/${DB_ID}"
  backup_json="$(gcloud firestore backups list --project "$PROJECT_ID" --format=json)"
  BACKUP="$(jq -r --arg source "$source" '[.[] | select(.state=="READY" and .database==$source)] | sort_by(.snapshotTime // "") | last | .name // empty' <<<"$backup_json")"
  test -n "$BACKUP" || { echo "BLOCKED_NO_READY_BACKUP" >&2; return 21; }
}

backup_check() {
  ready_backup
  echo "AURORA_CMEK_HML_BACKUP_READY"
  echo "sourceBackup=$BACKUP"
}

verify_restore() {
  local restored backup_json source token original doc
  test -n "${RESTORE_DB:-}" && [[ "$RESTORE_DB" == "$RESTORE_PREFIX"* ]] && [[ "$RESTORE_DB" =~ ^[a-z0-9-]+$ ]] || {
    echo "BLOCKED_RESTORE_DATABASE_REQUIRED" >&2; return 22;
  }
  restored="$(gcloud firestore databases describe --project "$PROJECT_ID" --database "$RESTORE_DB" --format=json)"
  jq -e --arg key "$KMS_RESOURCE" --arg loc "$LOCATION" '
    .locationId==$loc and .type=="FIRESTORE_NATIVE" and
    .cmekConfig.kmsKeyName==$key and
    .deleteProtectionState=="DELETE_PROTECTION_ENABLED" and
    .pointInTimeRecoveryEnablement=="POINT_IN_TIME_RECOVERY_ENABLED" and
    .sourceInfo.progress=="COMPLETED"
  ' <<<"$restored" >/dev/null || { echo "BLOCKED_RESTORE_NOT_COMPLETED_CMEK" >&2; return 23; }
  BACKUP="$(jq -r '.sourceInfo.backup.backup // empty' <<<"$restored")"
  source="projects/${PROJECT_ID}/databases/${DB_ID}"
  backup_json="$(gcloud firestore backups list --project "$PROJECT_ID" --format=json)"
  jq -e --arg backup "$BACKUP" --arg source "$source" 'any(.[]; .name==$backup and .database==$source and .state=="READY")' <<<"$backup_json" >/dev/null || {
    echo "BLOCKED_RESTORE_SOURCE_BACKUP_NOT_READY" >&2; return 24;
  }
  token="$(gcloud auth print-access-token)"
  original="$(curl -fsS -H "Authorization: Bearer $token" "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DB_ID}/documents/securityHml/sentinel")"
  doc="$(curl -fsS -H "Authorization: Bearer $token" "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${RESTORE_DB}/documents/securityHml/sentinel")"
  jq -e '.fields.kind.stringValue=="AURORA_CMEK_HML_SENTINEL" and .fields.synthetic.booleanValue==true and .fields.clinicalSensitive.booleanValue==false and .fields.productionMutation.booleanValue==false' <<<"$original" >/dev/null
  test "$(jq -cS '.fields' <<<"$original")" = "$(jq -cS '.fields' <<<"$doc")" || {
    echo "BLOCKED_RESTORE_SENTINEL_MISMATCH" >&2; return 25;
  }
  echo "AURORA_CMEK_HML_RESTORE_VERIFIED"
  echo "restoreDatabase=$RESTORE_DB"
  echo "sourceBackup=$BACKUP"
}

restore_test() {
  test "${AURORA_CMEK_CONFIRMATION:-}" = "RESTORE_AURORA_CMEK_HML" || {
    echo "BLOCKED_CONFIRMATION" >&2; exit 20;
  }
  ready_backup
  suffix="${GITHUB_RUN_ID:-$(date -u +%Y%m%d%H%M%S)}"
  suffix="$(printf '%s' "$suffix" | tr -cd '0-9' | tail -c 14)"
  RESTORE_DB="${RESTORE_PREFIX}${suffix}"
  test "${#RESTORE_DB}" -le 63
  echo "restoreDatabase=$RESTORE_DB"
  gcloud firestore databases restore --project "$PROJECT_ID" --source-backup="$BACKUP" --destination-database="$RESTORE_DB" --encryption-type=customer-managed-encryption --kms-key-name="$KMS_RESOURCE"
  gcloud firestore databases update --project "$PROJECT_ID" --database "$RESTORE_DB" --delete-protection --enable-pitr --quiet
  verify_restore
}

key_failure_test() {
  test "${AURORA_CMEK_CONFIRMATION:-}" = "TEST_AURORA_CMEK_KEY_FAILURE_HML" || {
    echo "BLOCKED_CONFIRMATION" >&2; exit 30;
  }
  RESTORE_DB="${AURORA_CMEK_RESTORE_DATABASE:-}"
  verify_restore
  db_json="$(describe_db)"
  jq -e --arg key "$KMS_RESOURCE" '.cmekConfig.kmsKeyName==$key and (.cmekConfig.activeKeyVersion | length)==1 and (.cmekConfig.activeKeyVersion[0] | startswith($key + "/cryptoKeyVersions/"))' <<<"$db_json" >/dev/null || {
    echo "BLOCKED_SINGLE_EXPECTED_ACTIVE_KEY_VERSION_REQUIRED" >&2; exit 31;
  }
  version_resource="$(jq -r '.cmekConfig.activeKeyVersion[0]' <<<"$db_json")"
  version="${version_resource##*/}"
  test "$(gcloud kms versions describe "$version" --project "$PROJECT_ID" --location "$LOCATION" --keyring "$KEYRING" --key "$KEY" --format='value(state)')" = "ENABLED"
  # Reject sharing the test key with a database outside the synthetic HML namespace.
  inventory="$(gcloud firestore databases list --project "$PROJECT_ID" --format=json)"
  jq -e --arg key "$KMS_RESOURCE" --arg source "projects/${PROJECT_ID}/databases/${DB_ID}" --arg prefix "projects/${PROJECT_ID}/databases/${RESTORE_PREFIX}" 'all(.[]; .cmekConfig.kmsKeyName!=$key or .name==$source or (.name | startswith($prefix)))' <<<"$inventory" >/dev/null || {
    echo "BLOCKED_KEY_SHARED_OUTSIDE_SYNTHETIC_HML" >&2; exit 34;
  }
  key_test_dir="$(mktemp -d)"
  reenable() {
    gcloud kms versions enable "$version" --project "$PROJECT_ID" --location "$LOCATION" --keyring "$KEYRING" --key "$KEY" --quiet >/dev/null
  }
  cleanup_key_test() {
    if ! reenable; then echo "CMEK_REENABLE_FAILED:manual_recovery_required:$version_resource" >&2; fi
    rm -rf "$key_test_dir"
  }
  trap cleanup_key_test EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  token="$(gcloud auth print-access-token)"
  url="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DB_ID}/documents/securityHml/sentinel"
  original="$(curl -fsS -H "Authorization: Bearer $token" "$url")"
  echo "keyFailureTestStarted=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "keyVersion=$version_resource"
  gcloud kms versions disable "$version" --project "$PROJECT_ID" --location "$LOCATION" --keyring "$KEYRING" --key "$KEY" --quiet
  observed=false
  for _ in $(seq 1 "${AURORA_CMEK_FAILURE_POLLS:-20}"); do
    token="$(gcloud auth print-access-token)"
    code="$(curl -sS -o "$key_test_dir/failure.json" -w '%{http_code}' -H "Authorization: Bearer $token" "$url" || true)"
    if [ "$code" = "400" ] && jq -e '.error.status=="FAILED_PRECONDITION" and (.error.message | contains("customer-managed encryption key"))' "$key_test_dir/failure.json" >/dev/null 2>&1; then
      observed=true; echo "keyUnavailableObserved=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; break
    fi
    sleep "${AURORA_CMEK_FAILURE_POLL_SECONDS:-30}"
  done
  reenable
  test "$(gcloud kms versions describe "$version" --project "$PROJECT_ID" --location "$LOCATION" --keyring "$KEYRING" --key "$KEY" --format='value(state)')" = "ENABLED"
  echo "keyReenabled=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  recovered=false
  for _ in $(seq 1 "${AURORA_CMEK_RECOVERY_POLLS:-20}"); do
    token="$(gcloud auth print-access-token)"
    code="$(curl -sS -o "$key_test_dir/recovery.json" -w '%{http_code}' -H "Authorization: Bearer $token" "$url" || true)"
    if [ "$code" = "200" ] && [ "$(jq -cS '.fields' "$key_test_dir/recovery.json")" = "$(jq -cS '.fields' <<<"$original")" ]; then
      recovered=true; break
    fi
    sleep "${AURORA_CMEK_RECOVERY_POLL_SECONDS:-30}"
  done
  test "$recovered" = true || { echo "CMEK_RECOVERY_NOT_CONFIRMED" >&2; exit 32; }
  echo "keyReadRecovered=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  rm -rf "$key_test_dir"
  trap - EXIT INT TERM
  if [ "$observed" = true ]; then
    echo "AURORA_CMEK_KEY_FAILURE_AND_RECOVERY_VERIFIED"
  else
    echo "AURORA_CMEK_KEY_FAILURE_PENDING_PROPAGATION"; exit 33
  fi
}

case "$MODE" in
  plan) plan ;;
  apply) apply ;;
  backup-check) backup_check ;;
  restore-test) restore_test ;;
  restore-verify) RESTORE_DB="${AURORA_CMEK_RESTORE_DATABASE:-}"; verify_restore ;;
  key-failure-test) key_failure_test ;;
  *) echo "usage: $0 {plan|apply|backup-check|restore-test|restore-verify|key-failure-test}" >&2; exit 64 ;;
esac
