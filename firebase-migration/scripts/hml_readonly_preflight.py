#!/usr/bin/env python3
"""Bounded HML metadata audit. Never authorizes deployment or reads secret data."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import re
import shutil
import subprocess
import sys

PROJECT = "wmgj-hml-jfn-20260927"
REGION = "southamerica-east1"
MAX_BACKUP_AGE = timedelta(hours=24)
VERIFIED, PENDING, UNKNOWN = "COMPROVADO", "PENDENTE", "DESCONHECIDO"

# Fixed argv only: no shell, caller-supplied project, document queries, credential
# export, secret access, IAM changes, service enablement or fallback provisioning.
COMMANDS = {
    "project": ["projects", "describe", PROJECT],
    "billing": ["billing", "projects", "describe", PROJECT],
    "services": ["services", "list", "--enabled", "--filter=config.name:secretmanager.googleapis.com"],
    "allowlist": ["secrets", "versions", "describe", "latest", "--secret=AURORA_NEXUS_ALLOWED_EMAILS"],
    "csrf": ["secrets", "versions", "describe", "latest", "--secret=AURORA_NEXUS_CSRF_HMAC_KEY"],
    "database": ["firestore", "databases", "describe", "--database=(default)"],
    "schedules": ["firestore", "backups", "schedules", "list", "--database=(default)"],
    "backups": ["firestore", "backups", "list", "--location=" + REGION],
}
FORMATS = {
    "project": "json(projectId,projectNumber,lifecycleState)",
    "billing": "json(projectId,billingEnabled)",
    "services": "json(config.name,state)",
    "allowlist": "json(name,state)", "csrf": "json(name,state)",
    "database": "json(name,uid,locationId,deleteProtectionState,pointInTimeRecoveryEnablement)",
    "schedules": "json(name,retention,dailyRecurrence,weeklyRecurrence)",
    "backups": "json(name,database,databaseUid,state,snapshotTime,expireTime)",
}

# Gate scope is intentionally narrow. Secret metadata does not prove payload
# validity, effective secretAccessor permission or successful authentication.
CATALOG = {
    "project_active": ("cloud", "alvo incorreto/inativo", "confirmar o projeto HML ativo"),
    "billing_enabled": ("cloud/financeiro", "indisponibilidade por billing", "comprovar billingEnabled=true no HML"),
    "secret_manager_api": ("cloud/IAM", "API indisponível", "comprovar Secret Manager ENABLED"),
    "allowlist_metadata": ("cloud/IAM", "allowlist indisponível", "comprovar versão latest ENABLED sem ler valor"),
    "csrf_metadata": ("cloud/IAM", "chave indisponível", "comprovar versão latest ENABLED sem ler valor"),
    "firestore_location": ("cloud", "região divergente", "confirmar southamerica-east1 no banco default"),
    "delete_protection": ("cloud", "exclusão acidental", "comprovar DELETE_PROTECTION_ENABLED"),
    "pitr": ("operações", "recuperação insuficiente", "comprovar POINT_IN_TIME_RECOVERY_ENABLED"),
    "backup_schedule": ("operações", "backup sem continuidade", "comprovar agenda com recorrência e retenção"),
    "recent_backup": ("operações", "backup vencido ou de outro banco", "comprovar READY de até 24h, não expirado e mesmo databaseUid"),
    "budget_alerts": ("cloud/financeiro", "custo sem controle", "revisar orçamento/alertas exclusivos do escopo HML"),
    "wif_service_account": ("cloud/IAM", "identidade/privilégio incorreto", "revalidar WIF, service account e menor privilégio"),
    "secret_runtime_access": ("cloud/IAM", "metadado confundido com acesso", "revalidar acesso efetivo do runtime sem exportar valores"),
    "users_memberships_mfa": ("segurança", "acesso indevido", "comprovar membership, isolamento e MFA com identidade autorizada"),
    "protected_environment": ("administrador GitHub", "execução sem revisão", "revalidar firebase-homologation e revisores exigidos"),
    "deployed_rules": ("backend", "CI diferente do publicado", "vincular Rules publicadas ao SHA revisado e testar isolamento"),
    "app_check": ("segurança", "cliente não atestado", "comprovar enforcement e rejeição de atestado inválido"),
    "restore_rehearsal": ("operações", "backup não restaurável", "executar ensaio autorizado e reconciliar resultado"),
    "dns_https_ssl": ("infraestrutura", "destino/TLS incorreto", "comprovar DNS, HTTPS e certificado dos destinos autorizados"),
    "authenticated_smoke": ("QA/segurança", "shell confundido com login", "comprovar login autorizado e negação anônima/outro tenant"),
}


class MetadataReader:
    def __init__(self, executable=None, runner=subprocess.run):
        self.executable = executable or shutil.which("gcloud")
        self.runner = runner

    def read(self, key):
        if key not in COMMANDS:
            raise ValueError("UNSUPPORTED_QUERY")
        if not self.executable:
            return None, "GCLOUD_UNAVAILABLE"
        argv = [self.executable, *COMMANDS[key], "--project=" + PROJECT,
                "--format=" + FORMATS[key], "--quiet", "--verbosity=error"]
        env = dict(os.environ, CLOUDSDK_CORE_DISABLE_PROMPTS="1",
                   CLOUDSDK_CORE_LOG_HTTP="false")
        try:
            result = self.runner(argv, stdin=subprocess.DEVNULL, capture_output=True,
                                 text=True, timeout=20, check=False, env=env)
        except subprocess.TimeoutExpired:
            return None, "QUERY_TIMEOUT"
        except (OSError, UnicodeError):
            return None, "QUERY_UNAVAILABLE"
        if result.returncode != 0:
            # Missing access, resources and transient errors cannot be inferred
            # from a checkbox or converted into a confirmed resource absence.
            return None, "QUERY_FAILED"
        if len(result.stdout) > 2_000_000:
            return None, "METADATA_TOO_LARGE"
        try:
            return json.loads(result.stdout), None
        except (ValueError, TypeError):
            return None, "INVALID_JSON"


def parse_time(value):
    if not isinstance(value, str):
        raise ValueError("INVALID_TIMESTAMP")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("TIMESTAMP_WITHOUT_ZONE")
    return result


def recent_backup_status(backups, database, now):
    """Metadata only; READY is not evidence that a restore rehearsal succeeded."""
    if not isinstance(backups, list) or not isinstance(database, dict):
        return UNKNOWN, "INVALID_METADATA"
    if not isinstance(database.get("name"), str) or not isinstance(database.get("uid"), str) or not database["uid"]:
        return UNKNOWN, "DATABASE_IDENTITY_UNVERIFIED"
    malformed = False
    for backup in backups:
        if not isinstance(backup, dict):
            malformed = True
            continue
        if not isinstance(backup.get("database"), str):
            malformed = True
            continue
        if backup.get("database") != database["name"]:
            continue
        if not isinstance(backup.get("databaseUid"), str) or not backup["databaseUid"]:
            malformed = True
            continue
        if backup["databaseUid"] != database["uid"]:
            continue
        if backup.get("state") not in {"READY", "CREATING", "NOT_AVAILABLE"}:
            malformed = True
            continue
        if backup["state"] != "READY":
            continue
        try:
            snapshot, expiry = parse_time(backup.get("snapshotTime")), parse_time(backup.get("expireTime"))
        except ValueError:
            malformed = True
            continue
        if timedelta(0) <= now - snapshot <= MAX_BACKUP_AGE and expiry > now:
            return VERIFIED, "READY_RECENT_UNEXPIRED_SAME_DATABASE"
    if malformed:
        return UNKNOWN, "INCOMPLETE_BACKUP_METADATA"
    return PENDING, "NO_ELIGIBLE_RECENT_BACKUP"


def audit(reader, now=None, collect=False):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("TIMESTAMP_WITHOUT_ZONE")
    results = {}
    for key in COMMANDS:
        results[key] = reader.read(key) if collect else (None, "NOT_COLLECTED")
    gates = {}

    def record(gate, status, evidence):
        owner, risk, acceptance = CATALOG[gate]
        gates[gate] = {"status": status, "evidence": evidence, "risk": risk,
                       "suggestedOwner": owner, "nextAction": acceptance,
                       "acceptanceCriterion": acceptance,
                       "blocker": None if status == VERIFIED else evidence}

    def metadata(gate, source, check):
        data, error = results[source]
        if error:
            record(gate, UNKNOWN, error)
            return
        try:
            status, code = check(data)
        except (KeyError, TypeError, ValueError, AttributeError):
            status, code = UNKNOWN, "INVALID_METADATA"
        record(gate, status, code)

    def exact(data, field, expected):
        if not isinstance(data, dict) or field not in data or type(data[field]) is not type(expected):
            return UNKNOWN, "INCOMPLETE_METADATA"
        return (VERIFIED, "EXPECTED_METADATA_CONFIRMED") if data[field] == expected else (PENDING, "OBSERVED_METADATA_MISMATCH")

    def project_check(data):
        if data.get("projectId") != PROJECT:
            return UNKNOWN, "PROJECT_IDENTITY_UNVERIFIED"
        return exact(data, "lifecycleState", "ACTIVE")

    metadata("project_active", "project", project_check)
    project = results["project"][0]
    project = project if isinstance(project, dict) and project.get("projectId") == PROJECT else {}
    aliases = {PROJECT}
    if re.fullmatch(r"[0-9]+", str(project.get("projectNumber", ""))):
        aliases.add(str(project["projectNumber"]))
    databases = {"projects/" + p + "/databases/(default)" for p in aliases}

    def billing_check(data):
        if data.get("projectId") != PROJECT:
            return UNKNOWN, "PROJECT_IDENTITY_UNVERIFIED"
        return exact(data, "billingEnabled", True)

    def api_check(data):
        if not isinstance(data, list):
            return UNKNOWN, "INVALID_METADATA"
        if any(not isinstance(row, dict) or not isinstance(row.get("config"), dict) or not row["config"].get("name") for row in data):
            return UNKNOWN, "INCOMPLETE_METADATA"
        for row in data:
            if row["config"]["name"] == "secretmanager.googleapis.com":
                return exact(row, "state", "ENABLED")
        return PENDING, "API_NOT_IN_ENABLED_LIST"

    def secret_check(data, secret):
        names = {"projects/" + p + "/secrets/" + secret + "/versions/" for p in aliases}
        name = data.get("name", "")
        if not isinstance(name, str) or not any(name.startswith(prefix) and re.fullmatch(r"[1-9][0-9]*", name[len(prefix):]) for prefix in names):
            return UNKNOWN, "SECRET_IDENTITY_UNVERIFIED"
        return exact(data, "state", "ENABLED")

    metadata("billing_enabled", "billing", billing_check)
    metadata("secret_manager_api", "services", api_check)
    metadata("allowlist_metadata", "allowlist", lambda data: secret_check(data, "AURORA_NEXUS_ALLOWED_EMAILS"))
    metadata("csrf_metadata", "csrf", lambda data: secret_check(data, "AURORA_NEXUS_CSRF_HMAC_KEY"))

    def database_check(data, field, expected):
        if data.get("name") not in databases:
            return UNKNOWN, "DATABASE_IDENTITY_UNVERIFIED"
        return exact(data, field, expected)

    for gate, field, expected in [
        ("firestore_location", "locationId", REGION),
        ("delete_protection", "deleteProtectionState", "DELETE_PROTECTION_ENABLED"),
        ("pitr", "pointInTimeRecoveryEnablement", "POINT_IN_TIME_RECOVERY_ENABLED"),
    ]:
        metadata(gate, "database", lambda data, f=field, e=expected: database_check(data, f, e))

    def schedule_check(data):
        if not isinstance(data, list):
            return UNKNOWN, "INVALID_METADATA"
        incomplete = False
        for item in data:
            if not isinstance(item, dict):
                incomplete = True
                continue
            name = item.get("name", "")
            scoped = isinstance(name, str) and any(name.startswith(db + "/backupSchedules/") and name[len(db + "/backupSchedules/"):] for db in databases)
            weekly = item.get("weeklyRecurrence", {})
            recurrence = isinstance(item.get("dailyRecurrence"), dict) or (
                isinstance(weekly, dict) and weekly.get("day") in
                {"MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"})
            retention = item.get("retention")
            if scoped and recurrence and isinstance(retention, str) and re.fullmatch(r"[1-9][0-9]*s", retention):
                return VERIFIED, "SCHEDULE_METADATA_CONFIRMED"
            incomplete = True
        return (UNKNOWN, "INCOMPLETE_SCHEDULE_METADATA") if incomplete else (PENDING, "NO_BACKUP_SCHEDULE")

    metadata("backup_schedule", "schedules", schedule_check)
    database, db_error = results["database"]
    if db_error or not isinstance(database, dict) or database.get("name") not in databases:
        record("recent_backup", UNKNOWN, "DATABASE_IDENTITY_UNVERIFIED")
    else:
        metadata("recent_backup", "backups", lambda data: recent_backup_status(data, database, now))
    for gate in CATALOG:
        if gate not in gates:
            record(gate, UNKNOWN, "SEPARATE_EVIDENCE_REQUIRED")
    return {"schemaVersion": "aurora.hml.readonly-preflight.v1", "projectId": PROJECT,
            "observedAt": now.isoformat(), "mode": "COLLECT_METADATA" if collect else "PLAN_ONLY",
            "cloudMutation": False, "secretPayloadRead": False, "releaseApproved": False,
            "decision": "AGUARDAR_GATE", "gates": gates,
            "summary": {status: sum(g["status"] == status for g in gates.values()) for status in (VERIFIED, PENDING, UNKNOWN)}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--collect", action="store_true", help="Read metadata using existing authorized gcloud identity")
    modes.add_argument("--check-backup", action="store_true", help="Validate existing HML database/backup metadata from stdin; no cloud calls")
    args = parser.parse_args(argv)
    if args.check_backup:
        try:
            raw = sys.stdin.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError("METADATA_TOO_LARGE")
            data = json.loads(raw)
            database = data["database"]
            if database["name"] != "projects/" + PROJECT + "/databases/(default)":
                raise ValueError("UNAUTHORIZED_DATABASE")
            status, code = recent_backup_status(data["backups"], database, datetime.now(timezone.utc))
        except (ValueError, TypeError, KeyError, UnicodeError):
            status, code = UNKNOWN, "INVALID_OR_OUT_OF_SCOPE_BACKUP_METADATA"
        print(json.dumps({"gate": "recent_backup", "status": status, "evidence": code,
                          "releaseApproved": False}))
        return 0 if status == VERIFIED else 2
    report = audit(MetadataReader(), collect=args.collect)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    # Exit zero means only that the no-network plan was rendered. Collection
    # never returns release approval: broader gates remain separately evidenced.
    return 2 if args.collect else 0


if __name__ == "__main__":
    sys.exit(main())
