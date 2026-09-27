#!/usr/bin/env python3
"""Aurora Coletor runtime.

No third-party dependencies. Reads administrative CSV/JSON files from an input
folder and writes processing state only under the configured local state folder.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sqlite3
import sys
import time
from datetime import datetime, timezone
from urllib import error, request

USER_AGENT = "Aurora-Coletor/1.0 stdlib"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_db(state_dir: Path) -> sqlite3.Connection:
    state_dir.mkdir(parents=True, exist_ok=True)
    db_path = state_dir / "collector-state.sqlite3"
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS files (
          idempotency_key TEXT PRIMARY KEY,
          relative_path TEXT NOT NULL,
          absolute_path_hash TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          size INTEGER NOT NULL,
          mtime_ns INTEGER NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          first_seen_at TEXT NOT NULL,
          last_attempt_at TEXT,
          last_error TEXT,
          sent_at TEXT
        )
        """
    )
    conn.commit()
    return conn


def load_config(config_path: Path) -> dict[str, object]:
    with config_path.open("r", encoding="utf-8") as fh:
        config = json.load(fh)
    required = ["org", "facility", "endpoint", "watchDir", "stateDir"]
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise ValueError(f"configuração incompleta: {', '.join(missing)}")
    return config


def iter_files(watch_dir: Path, recursive: bool, allowed: set[str], max_bytes: int) -> list[Path]:
    iterator = watch_dir.rglob("*") if recursive else watch_dir.iterdir()
    files: list[Path] = []
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
        if time.time() - stat.st_mtime < 2:
            continue
        files.append(path)
    return sorted(files)


def read_payload_body(path: Path) -> tuple[str, str]:
    raw = path.read_bytes()
    try:
        return "utf-8", raw.decode("utf-8")
    except UnicodeDecodeError:
        return "base64", base64.b64encode(raw).decode("ascii")


def build_payload(path: Path, watch_dir: Path, config: dict[str, object], file_hash: str, stat: os.stat_result) -> dict[str, object]:
    relative_path = str(path.relative_to(watch_dir))
    encoding, body = read_payload_body(path)
    media_type, _ = mimetypes.guess_type(path.name)
    return {
        "schemaVersion": "aurora.collector.event.v1",
        "org": str(config["org"]),
        "facility": str(config["facility"]),
        "capturedAt": utc_now(),
        "source": {
            "kind": "filesystem-dropbox",
            "relativePath": relative_path,
            "fileName": path.name,
        },
        "file": {
            "sha256": file_hash,
            "size": stat.st_size,
            "mtimeNs": stat.st_mtime_ns,
            "mediaType": media_type or "application/octet-stream",
            "extension": path.suffix.lower(),
        },
        "content": {
            "encoding": encoding,
            "body": body,
        },
    }


def make_idempotency_key(org: str, facility: str, relative_path: str, file_hash: str, size: int, mtime_ns: int) -> str:
    raw = f"{org}|{facility}|{relative_path}|{file_hash}|{size}|{mtime_ns}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def should_send(conn: sqlite3.Connection, key: str) -> bool:
    row = conn.execute("SELECT status FROM files WHERE idempotency_key = ?", (key,)).fetchone()
    return row is None or row[0] != "sent"


def record_seen(
    conn: sqlite3.Connection,
    key: str,
    relative_path: str,
    path_hash: str,
    file_hash: str,
    size: int,
    mtime_ns: int,
) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO files (
          idempotency_key, relative_path, absolute_path_hash, sha256, size,
          mtime_ns, status, first_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        """,
        (key, relative_path, path_hash, file_hash, size, mtime_ns, utc_now()),
    )
    conn.commit()


def mark_attempt(conn: sqlite3.Connection, key: str) -> None:
    conn.execute(
        "UPDATE files SET attempts = attempts + 1, last_attempt_at = ?, status = 'sending' WHERE idempotency_key = ?",
        (utc_now(), key),
    )
    conn.commit()


def mark_sent(conn: sqlite3.Connection, key: str) -> None:
    conn.execute(
        "UPDATE files SET status = 'sent', sent_at = ?, last_error = NULL WHERE idempotency_key = ?",
        (utc_now(), key),
    )
    conn.commit()


def mark_error(conn: sqlite3.Connection, key: str, message: str) -> None:
    conn.execute(
        "UPDATE files SET status = 'error', last_error = ? WHERE idempotency_key = ?",
        (message[:500], key),
    )
    conn.commit()


def post_payload(endpoint: str, payload: dict[str, object], headers: dict[str, str], timeout: int = 30) -> tuple[int, str]:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = request.Request(endpoint, data=body, method="POST")
    for key, value in headers.items():
        req.add_header(key, value)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", USER_AGENT)
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            response_text = resp.read(4096).decode("utf-8", errors="replace")
            return int(resp.status), response_text
    except error.HTTPError as exc:
        response_text = exc.read(4096).decode("utf-8", errors="replace")
        return int(exc.code), response_text


def scan_once(config: dict[str, object]) -> int:
    watch_dir = Path(str(config["watchDir"]))
    state_dir = Path(str(config["stateDir"]))
    allowed = {str(ext).lower() for ext in config.get("allowedExtensions", [".csv", ".json", ".jsonl"])}
    max_bytes = int(config.get("maxFileBytes", 10 * 1024 * 1024))
    recursive = bool(config.get("recursive", False))
    org = str(config["org"])
    facility = str(config["facility"])
    endpoint = str(config["endpoint"])
    auth_env = str(config.get("authTokenEnv", "AURORA_COLLECTOR_TOKEN"))

    conn = ensure_db(state_dir)
    sent = 0
    for path in iter_files(watch_dir, recursive, allowed, max_bytes):
        stat = path.stat()
        file_hash = sha256_file(path)
        relative_path = str(path.relative_to(watch_dir))
        key = make_idempotency_key(org, facility, relative_path, file_hash, stat.st_size, stat.st_mtime_ns)
        path_hash = hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()
        record_seen(conn, key, relative_path, path_hash, file_hash, stat.st_size, stat.st_mtime_ns)
        if not should_send(conn, key):
            continue

        payload = build_payload(path, watch_dir, config, file_hash, stat)
        headers = {
            "X-Aurora-Org": org,
            "X-Aurora-Facility": facility,
            "X-Aurora-Idempotency-Key": key,
        }
        token = os.environ.get(auth_env)
        if token:
            headers["Authorization"] = f"Bearer {token}"

        mark_attempt(conn, key)
        status, response_text = post_payload(endpoint, payload, headers)
        if 200 <= status < 300:
            mark_sent(conn, key)
            sent += 1
            print(f"SENT {relative_path} {status}")
        else:
            mark_error(conn, key, f"HTTP {status}: {response_text}")
            print(f"ERROR {relative_path} HTTP {status}", file=sys.stderr)
    return sent


def run(config_path: Path, once: bool, interval: int) -> int:
    config = load_config(config_path)
    if once:
        scan_once(config)
        return 0
    while True:
        try:
            scan_once(config)
        except Exception as exc:  # keep service alive; error is local only
            print(f"collector loop error: {exc}", file=sys.stderr)
        time.sleep(interval)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aurora Coletor runtime")
    parser.add_argument("--config", required=True, help="Caminho para config.json")
    parser.add_argument("--once", action="store_true", help="Executa uma varredura e sai")
    parser.add_argument("--interval", type=int, default=30, help="Intervalo quando rodando continuamente")
    args = parser.parse_args(argv)
    if args.interval < 5:
        parser.error("--interval deve ser >= 5")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    return run(Path(args.config), args.once, args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
