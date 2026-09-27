#!/usr/bin/env python3
"""Aurora Coletor runtime.

Python standard library only.

Default mode validates configuration and scans eligible input counts without
transmitting content. Transmission requires an explicit ``--once`` or ``--watch``
execution and an authorization token supplied by environment.
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import ssl
import sys
import time
from datetime import datetime, timezone
from typing import Any
from urllib import error, request
from urllib.parse import urlparse

USER_AGENT = "Aurora-Coletor/2.0 stdlib"
TOKEN_ENV_DEFAULT = "AURORA_COLLECTOR_TOKEN"
RETRYABLE_STATUS_CODES = {408, 429}
MAX_BACKOFF_SECONDS = 3600
ALLOWED_STATES = {"PENDING", "RETRY", "AWAITING_REVIEW", "BLOCKED"}
ACCEPTED_RECEIPT_STATES = {
    "AWAITING_REVIEW",
    "AGUARDANDO_CONFERENCIA",
    "AGUARDANDO CONFERENCIA",
    "AGUARDANDO CONFERÊNCIA",
}
ORG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
FACILITY_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{1,63}$")
IDENTITY_RE = re.compile(r"^[a-z0-9][a-z0-9_.:-]{2,127}$")
PLACEHOLDER_MARKERS = (
    "ENDERECO-AUTORIZADO",
    "ENDPOINT-OFICIAL",
    "ID-INSTITUICAO",
    "UNIDADE",
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "example.com",
    "localhost",
)


class CollectorError(Exception):
    """Base collector exception."""


class ConfigError(CollectorError):
    """Invalid local configuration."""


class AuthorizationError(CollectorError):
    """Authorization failed; interrupt the cycle."""


class PermanentFileError(CollectorError):
    """A file cannot be processed until an operator investigates."""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_utc(value: str | None) -> float | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).timestamp()


def is_windows_absolute(path: str) -> bool:
    return bool(re.match(r"^[a-zA-Z]:[\\/].+", path) or path.startswith("\\\\"))


def is_absolute_path(path: str) -> bool:
    return Path(path).is_absolute() or is_windows_absolute(path)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_endpoint(endpoint: str) -> str:
    value = endpoint.strip()
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ConfigError("endpoint deve ser HTTPS absoluto")
    if parsed.username or parsed.password:
        raise ConfigError("endpoint não pode conter usuário ou senha")
    if parsed.fragment:
        raise ConfigError("endpoint não pode conter fragmento")
    if any(marker.lower() in value.lower() for marker in PLACEHOLDER_MARKERS):
        raise ConfigError("endpoint contém placeholder ou segredo aparente")
    return value.rstrip("/")


def validate_org(org: str) -> str:
    value = org.strip()
    if value != value.lower() or not ORG_RE.fullmatch(value):
        raise ConfigError("org deve usar minúsculas, números e hífen")
    return value


def validate_facility(facility: str) -> str:
    value = facility.strip()
    if value != value.upper() or not FACILITY_RE.fullmatch(value):
        raise ConfigError("facility deve usar referência em maiúsculas")
    return value


def validate_identity(identity: str) -> str:
    value = identity.strip()
    if not IDENTITY_RE.fullmatch(value):
        raise ConfigError("technicalIdentityId inválido")
    if any(marker.lower() in value.lower() for marker in PLACEHOLDER_MARKERS):
        raise ConfigError("technicalIdentityId contém placeholder")
    return value


def validate_expiration(value: str | None) -> str | None:
    if not value:
        return None
    expires_ts = parse_utc(value)
    if expires_ts is None:
        raise ConfigError("credentialExpiresAt inválido")
    if expires_ts <= time.time():
        raise ConfigError("credentialExpiresAt expirado")
    return value


def load_config(config_path: Path) -> dict[str, Any]:
    with config_path.open("r", encoding="utf-8") as fh:
        config = json.load(fh)

    required = ["org", "facility", "endpoint", "watchDir", "stateDir", "technicalIdentityId"]
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise ConfigError("configuração incompleta: " + ", ".join(missing))

    config["org"] = validate_org(str(config["org"]))
    config["facility"] = validate_facility(str(config["facility"]))
    config["endpoint"] = validate_endpoint(str(config["endpoint"]))
    config["technicalIdentityId"] = validate_identity(str(config["technicalIdentityId"]))
    config["credentialExpiresAt"] = validate_expiration(config.get("credentialExpiresAt"))

    for key in ("watchDir", "stateDir"):
        path = str(config[key])
        if not is_absolute_path(path):
            raise ConfigError(f"{key} deve ser caminho absoluto")

    watch_dir = Path(str(config["watchDir"]))
    if not watch_dir.exists() or not watch_dir.is_dir():
        raise ConfigError("watchDir não existe ou não é diretório")

    poll_seconds = int(config.get("pollSeconds", 30))
    if poll_seconds < 5:
        raise ConfigError("pollSeconds deve ser >= 5")
    config["pollSeconds"] = poll_seconds

    max_file_bytes = int(config.get("maxFileBytes", 10 * 1024 * 1024))
    if max_file_bytes < 1:
        raise ConfigError("maxFileBytes deve ser positivo")
    config["maxFileBytes"] = max_file_bytes

    allowed = config.get("allowedExtensions", [".csv", ".json", ".jsonl"])
    config["allowedExtensions"] = sorted({str(ext).lower() for ext in allowed})
    config["authTokenEnv"] = str(config.get("authTokenEnv", TOKEN_ENV_DEFAULT))
    return config


def ensure_db(state_dir: Path) -> sqlite3.Connection:
    state_dir.mkdir(parents=True, exist_ok=True)
    db_path = state_dir / "collector-state.sqlite3"
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS queue (
          local_id TEXT PRIMARY KEY,
          org TEXT NOT NULL,
          facility TEXT NOT NULL,
          technical_identity_id TEXT NOT NULL,
          file_sha256 TEXT NOT NULL,
          normalized_sha256 TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL,
          next_attempt_at TEXT,
          receipt_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (state IN ('PENDING', 'RETRY', 'AWAITING_REVIEW', 'BLOCKED'))
        )
        """
    )
    conn.commit()
    return conn


def iter_files(watch_dir: Path, recursive: bool, allowed: set[str], max_bytes: int) -> list[Path]:
    iterator = watch_dir.rglob("*") if recursive else watch_dir.iterdir()
    files: list[Path] = []
    now = time.time()
    for path in iterator:
        if not path.is_file():
            continue
        if path.suffix.lower() not in allowed:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_size <= 0 or stat.st_size > max_bytes:
            continue
        # Avoid reading files still being written.
        if now - stat.st_mtime < 2:
            continue
        files.append(path)
    return sorted(files)


def normalize_json_bytes(raw: bytes) -> bytes:
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except Exception as exc:
        raise PermanentFileError("json inválido") from exc
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def normalize_jsonl_bytes(raw: bytes) -> bytes:
    try:
        text = raw.decode("utf-8-sig")
        normalized_lines = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            data = json.loads(stripped)
            normalized_lines.append(json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    except Exception as exc:
        raise PermanentFileError("jsonl inválido") from exc
    return ("\n".join(normalized_lines) + ("\n" if normalized_lines else "")).encode("utf-8")


def normalize_csv_bytes(raw: bytes) -> bytes:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise PermanentFileError("csv fora de utf-8") from exc
    # Normalize line endings and parse/write CSV to collapse platform-specific formatting.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    src = io.StringIO(text)
    rows = list(csv.reader(src))
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def normalize_content(path: Path) -> tuple[str, bytes, bytes]:
    raw = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix == ".json":
        normalized = normalize_json_bytes(raw)
    elif suffix == ".jsonl":
        normalized = normalize_jsonl_bytes(raw)
    elif suffix == ".csv":
        normalized = normalize_csv_bytes(raw)
    else:
        raise PermanentFileError("extensão não autorizada")
    return suffix, raw, normalized


def local_id_for(org: str, facility: str, identity_id: str, file_hash: str) -> str:
    return sha256_bytes(f"{org}|{facility}|{identity_id}|{file_hash}".encode("utf-8"))


def backoff_seconds(attempts: int) -> int:
    # First retry around 30s, then 60/120/240... capped at 1h.
    return min(MAX_BACKOFF_SECONDS, 30 * (2 ** max(0, min(attempts - 1, 7))))


def retry_after(attempts: int) -> str:
    return datetime.fromtimestamp(time.time() + backoff_seconds(attempts), tz=timezone.utc).replace(microsecond=0).isoformat()


def row_due(row: sqlite3.Row | tuple[Any, ...]) -> bool:
    next_attempt_at = row["next_attempt_at"] if isinstance(row, sqlite3.Row) else row[0]
    ts = parse_utc(next_attempt_at)
    return ts is None or ts <= time.time()


def upsert_seen(
    conn: sqlite3.Connection,
    local_id: str,
    org: str,
    facility: str,
    identity_id: str,
    file_hash: str,
    normalized_hash: str,
) -> str:
    row = conn.execute("SELECT state, next_attempt_at FROM queue WHERE local_id = ?", (local_id,)).fetchone()
    now = utc_now()
    if row is None:
        conn.execute(
            """
            INSERT INTO queue (
              local_id, org, facility, technical_identity_id, file_sha256,
              normalized_sha256, attempts, state, next_attempt_at, receipt_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 'PENDING', NULL, NULL, ?, ?)
            """,
            (local_id, org, facility, identity_id, file_hash, normalized_hash, now, now),
        )
        conn.commit()
        return "PENDING"
    return str(row[0])


def mark_retry(conn: sqlite3.Connection, local_id: str, attempts: int) -> None:
    conn.execute(
        "UPDATE queue SET state = 'RETRY', next_attempt_at = ?, updated_at = ? WHERE local_id = ?",
        (retry_after(attempts), utc_now(), local_id),
    )
    conn.commit()


def mark_blocked(conn: sqlite3.Connection, local_id: str) -> None:
    conn.execute(
        "UPDATE queue SET state = 'BLOCKED', next_attempt_at = NULL, updated_at = ? WHERE local_id = ?",
        (utc_now(), local_id),
    )
    conn.commit()


def mark_awaiting_review(conn: sqlite3.Connection, local_id: str, receipt_id: str) -> None:
    conn.execute(
        """
        UPDATE queue
        SET state = 'AWAITING_REVIEW',
            next_attempt_at = NULL,
            receipt_id = ?,
            updated_at = ?
        WHERE local_id = ?
        """,
        (receipt_id, utc_now(), local_id),
    )
    conn.commit()


def increment_attempt(conn: sqlite3.Connection, local_id: str) -> int:
    conn.execute(
        "UPDATE queue SET attempts = attempts + 1, updated_at = ? WHERE local_id = ?",
        (utc_now(), local_id),
    )
    conn.commit()
    row = conn.execute("SELECT attempts FROM queue WHERE local_id = ?", (local_id,)).fetchone()
    return int(row[0])


class NoRedirectHandler(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        return None


def post_payload(endpoint: str, payload: dict[str, Any], headers: dict[str, str], timeout: int = 30) -> tuple[int, str]:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = request.Request(endpoint, data=body, method="POST")
    for key, value in headers.items():
        req.add_header(key, value)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", USER_AGENT)
    opener = request.build_opener(NoRedirectHandler)
    context = ssl.create_default_context()
    try:
        with opener.open(req, timeout=timeout, context=context) as resp:  # type: ignore[arg-type]
            return int(resp.status), resp.read(4096).decode("utf-8", errors="replace")
    except TypeError:
        # Python build_opener().open has no context kwarg in some versions.
        https_handler = request.HTTPSHandler(context=context)
        opener = request.build_opener(NoRedirectHandler, https_handler)
        try:
            with opener.open(req, timeout=timeout) as resp:
                return int(resp.status), resp.read(4096).decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            return int(exc.code), exc.read(4096).decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        return int(exc.code), exc.read(4096).decode("utf-8", errors="replace")


def validate_receipt(response_text: str, expected_hash: str) -> tuple[str, str]:
    try:
        receipt = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise PermanentFileError("recibo não é JSON") from exc

    receipt_id = receipt.get("receiptId") or receipt.get("id")
    state = str(receipt.get("state") or "").strip()
    content_hash = (
        receipt.get("normalizedContentHash")
        or receipt.get("contentHash")
        or receipt.get("contentSha256")
        or receipt.get("normalized_sha256")
    )

    if not isinstance(receipt_id, str) or len(receipt_id.strip()) < 6:
        raise PermanentFileError("recibo sem ID válido")
    if not isinstance(content_hash, str) or content_hash.lower() != expected_hash.lower():
        raise PermanentFileError("recibo com hash divergente")
    normalized_state = state.upper().replace("-", "_")
    if normalized_state not in ACCEPTED_RECEIPT_STATES:
        raise PermanentFileError("recibo com estado inválido")
    return receipt_id.strip(), normalized_state


def build_payload(
    config: dict[str, Any],
    extension: str,
    file_hash: str,
    normalized_hash: str,
    raw: bytes,
) -> dict[str, Any]:
    return {
        "schemaVersion": "aurora.collector.batch.v2",
        "environment": str(config.get("environment", "homologation")),
        "org": config["org"],
        "facility": config["facility"],
        "technicalIdentityId": config["technicalIdentityId"],
        "observedAt": utc_now(),
        "file": {
            "byteSha256": file_hash,
            "normalizedContentHash": normalized_hash,
            "size": len(raw),
            "extension": extension,
        },
        "content": {
            "encoding": "base64",
            "body": base64.b64encode(raw).decode("ascii"),
        },
    }


def scan_counts(config: dict[str, Any]) -> dict[str, int]:
    watch_dir = Path(str(config["watchDir"]))
    state_dir = Path(str(config["stateDir"]))
    allowed = set(config["allowedExtensions"])
    max_bytes = int(config["maxFileBytes"])
    recursive = bool(config.get("recursive", False))
    ensure_db(state_dir)
    files = iter_files(watch_dir, recursive, allowed, max_bytes)
    return {
        "eligible": len(files),
        "state_ready": 1,
    }


def queue_status_counts(conn: sqlite3.Connection) -> dict[str, int]:
    counts = {state.lower(): 0 for state in ALLOWED_STATES}
    for state, total in conn.execute("SELECT state, COUNT(*) FROM queue GROUP BY state"):
        counts[str(state).lower()] = int(total)
    return counts


def require_token(config: dict[str, Any]) -> str:
    env_name = str(config.get("authTokenEnv", TOKEN_ENV_DEFAULT))
    token = os.environ.get(env_name)
    if not token:
        raise ConfigError(f"token ausente no ambiente: {env_name}")
    if "\n" in token or "\r" in token or len(token.strip()) < 16:
        raise ConfigError("token de ambiente inválido")
    return token.strip()


def transmit_once(config: dict[str, Any]) -> dict[str, int]:
    token = require_token(config)
    watch_dir = Path(str(config["watchDir"]))
    state_dir = Path(str(config["stateDir"]))
    allowed = set(config["allowedExtensions"])
    max_bytes = int(config["maxFileBytes"])
    recursive = bool(config.get("recursive", False))
    org = str(config["org"])
    facility = str(config["facility"])
    identity_id = str(config["technicalIdentityId"])
    endpoint = str(config["endpoint"])

    conn = ensure_db(state_dir)
    conn.row_factory = sqlite3.Row

    result = {
        "checked": 0,
        "queued": 0,
        "sent": 0,
        "retry": 0,
        "blocked": 0,
        "skipped": 0,
        "auth_failed": 0,
    }

    for path in iter_files(watch_dir, recursive, allowed, max_bytes):
        result["checked"] += 1
        try:
            extension, raw, normalized = normalize_content(path)
        except PermanentFileError:
            # Hash bytes only; do not store the file path/name.
            try:
                file_hash = sha256_file(path)
            except OSError:
                result["skipped"] += 1
                continue
            normalized_hash = sha256_bytes(b"blocked-normalization")
            local_id = local_id_for(org, facility, identity_id, file_hash)
            upsert_seen(conn, local_id, org, facility, identity_id, file_hash, normalized_hash)
            mark_blocked(conn, local_id)
            result["blocked"] += 1
            continue

        file_hash = sha256_bytes(raw)
        normalized_hash = sha256_bytes(normalized)
        local_id = local_id_for(org, facility, identity_id, file_hash)
        state = upsert_seen(conn, local_id, org, facility, identity_id, file_hash, normalized_hash)

        row = conn.execute("SELECT state, next_attempt_at FROM queue WHERE local_id = ?", (local_id,)).fetchone()
        if row and row["state"] == "AWAITING_REVIEW":
            result["skipped"] += 1
            continue
        if row and row["state"] == "BLOCKED":
            result["blocked"] += 1
            continue
        if row and row["state"] == "RETRY" and not row_due(row):
            result["skipped"] += 1
            continue

        result["queued"] += 1
        attempts = increment_attempt(conn, local_id)
        payload = build_payload(config, extension, file_hash, normalized_hash, raw)
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Aurora-Org": org,
            "X-Aurora-Facility": facility,
            "X-Aurora-Technical-Identity": identity_id,
            "X-Aurora-Content-Sha256": normalized_hash,
            "X-Aurora-Local-Id": local_id,
        }

        try:
            status, response_text = post_payload(endpoint, payload, headers)
        except Exception:
            mark_retry(conn, local_id, attempts)
            result["retry"] += 1
            continue

        if status in (401, 403):
            mark_blocked(conn, local_id)
            result["auth_failed"] += 1
            raise AuthorizationError("autorização rejeitada; ciclo interrompido")
        if status in RETRYABLE_STATUS_CODES or status >= 500:
            mark_retry(conn, local_id, attempts)
            result["retry"] += 1
            continue
        if 200 <= status < 300:
            try:
                receipt_id, _state = validate_receipt(response_text, normalized_hash)
            except PermanentFileError:
                mark_blocked(conn, local_id)
                result["blocked"] += 1
                continue
            mark_awaiting_review(conn, local_id, receipt_id)
            result["sent"] += 1
            continue

        mark_blocked(conn, local_id)
        result["blocked"] += 1

    result.update(queue_status_counts(conn))
    return result


def print_counts(prefix: str, counts: dict[str, int]) -> None:
    ordered = sorted(counts.items())
    rendered = " ".join(f"{key}={value}" for key, value in ordered)
    print(f"{prefix} {rendered}".strip())


def run_validate(config_path: Path) -> int:
    config = load_config(config_path)
    counts = scan_counts(config)
    print_counts("VALIDATED", counts)
    return 0


def run_once(config_path: Path) -> int:
    config = load_config(config_path)
    try:
        counts = transmit_once(config)
    except AuthorizationError:
        print_counts("AUTH_BLOCKED", {"auth_failed": 1})
        return 2
    print_counts("CYCLE", counts)
    return 0


def run_watch(config_path: Path) -> int:
    config = load_config(config_path)
    interval = int(config["pollSeconds"])
    while True:
        try:
            counts = transmit_once(config)
            print_counts("CYCLE", counts)
        except AuthorizationError:
            print_counts("AUTH_BLOCKED", {"auth_failed": 1})
            return 2
        except Exception:
            # Keep details out of logs; supervisor may capture only aggregate signal.
            print_counts("CYCLE_ERROR", {"retry": 1})
        time.sleep(interval)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aurora Coletor")
    parser.add_argument("--config", required=True, help="Caminho para collector-config.json")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Transmite um ciclo autorizado e sai")
    mode.add_argument("--watch", action="store_true", help="Executa ciclos contínuos com intervalo da configuração")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    config_path = Path(args.config)
    if args.once:
        return run_once(config_path)
    if args.watch:
        return run_watch(config_path)
    return run_validate(config_path)


if __name__ == "__main__":
    raise SystemExit(main())
