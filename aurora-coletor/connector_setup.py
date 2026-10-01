#!/usr/bin/env python3
"""Aurora Nexus connector bootstrap.

Collects integration data at install time without putting secrets in command-line
arguments or ordinary JSON configuration. Secrets are written only to a private
0600 environment file; the public manifest stores presence flags and hashes only.

Standard library only.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
from typing import Callable
from urllib.parse import urlparse

SCHEMA_VERSION = "aurora.connectors.install.v1"
KEY_PREFIX = "anx"
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$")
SAFE_ORG = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")


class ConnectorSetupError(ValueError):
    pass


@dataclass(frozen=True)
class AuroraIssuedKey:
    key_id: str
    api_key: str
    sha256: str
    expires_at: str
    scopes: tuple[str, ...]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def validate_org(value: str) -> str:
    value = value.strip()
    if not SAFE_ORG.fullmatch(value):
        raise ConnectorSetupError("org inválido")
    return value


def validate_https_url(value: str, *, field: str) -> str:
    value = value.strip()
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
        raise ConnectorSetupError(f"{field} deve ser URL HTTPS absoluta sem credenciais ou fragmento")
    return value.rstrip("/")


def validate_identifier(value: str, *, field: str) -> str:
    value = value.strip()
    if not SAFE_NAME.fullmatch(value):
        raise ConnectorSetupError(f"{field} inválido")
    return value


def validate_drive_folder_id(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", value):
        raise ConnectorSetupError("Google Drive folder ID inválido")
    return value


def validate_hmac_secret(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[A-Fa-f0-9]{64}", value):
        raise ConnectorSetupError("HMAC secret deve conter exatamente 32 bytes em hexadecimal")
    return value.lower()


def issue_aurora_api_key(
    org: str,
    connector_name: str,
    scopes: tuple[str, ...] = ("integration.read", "integration.write"),
    days: int = 90,
) -> AuroraIssuedKey:
    validate_org(org)
    validate_identifier(connector_name, field="connector")
    if not scopes or any(not SAFE_NAME.fullmatch(scope) for scope in scopes):
        raise ConnectorSetupError("scope inválido")
    if days < 1 or days > 365:
        raise ConnectorSetupError("validade da chave deve ficar entre 1 e 365 dias")
    key_id = "ik_" + secrets.token_hex(8)
    secret = secrets.token_urlsafe(32)
    api_key = f"{KEY_PREFIX}_{key_id}.{secret}"
    expires = (utc_now() + timedelta(days=days)).replace(microsecond=0).isoformat()
    return AuroraIssuedKey(
        key_id=key_id,
        api_key=api_key,
        sha256=sha256_text(api_key),
        expires_at=expires,
        scopes=scopes,
    )


def _secret_prompt(label: str, prompt: Callable[[str], str] = getpass.getpass) -> str:
    value = prompt(label).strip()
    if not value:
        raise ConnectorSetupError(f"valor sensível obrigatório ausente: {label.rstrip(': ')}")
    if "\n" in value or "\r" in value:
        raise ConnectorSetupError("segredo contém quebra de linha")
    return value


def _public_prompt(label: str, prompt: Callable[[str], str] = input) -> str:
    return prompt(label).strip()


def _safe_env_name(name: str) -> str:
    candidate = re.sub(r"[^A-Za-z0-9_]", "_", name.upper())
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,80}", candidate):
        raise ConnectorSetupError("nome de variável de ambiente inválido")
    return candidate


def write_private_env(path: Path, secrets_map: dict[str, str]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    lines: list[str] = []
    for key, value in sorted(secrets_map.items()):
        env_key = _safe_env_name(key)
        if "\n" in value or "\r" in value or "\x00" in value:
            raise ConnectorSetupError(f"segredo inválido: {env_key}")
        escaped = value.replace("'", "'\"'\"'")
        lines.append(f"{env_key}='{escaped}'")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    except Exception:
        try:
            path.unlink()
        except OSError:
            pass
        raise
    try:
        path.chmod(0o600)
    except OSError:
        pass


def redacted_secret_inventory(secrets_map: dict[str, str]) -> dict[str, dict[str, object]]:
    return {
        _safe_env_name(key): {
            "configured": bool(value),
            "sha256": sha256_text(value) if value else None,
            "valueStoredInManifest": False,
        }
        for key, value in sorted(secrets_map.items())
    }


def build_install_bundle(
    *,
    org: str,
    drive_folder_id: str,
    firestore_ingest_url: str,
    firestore_hmac_key_id: str,
    firestore_hmac_secret: str,
    external_system_name: str | None = None,
    external_base_url: str | None = None,
    external_api_key: str | None = None,
    issue_reverse_key: bool = True,
    key_days: int = 90,
) -> tuple[dict[str, object], dict[str, str], AuroraIssuedKey | None]:
    org = validate_org(org)
    folder = validate_drive_folder_id(drive_folder_id)
    ingest = validate_https_url(firestore_ingest_url, field="Firebase ingest URL")
    key_id = validate_identifier(firestore_hmac_key_id, field="HMAC key ID")
    hmac_secret = validate_hmac_secret(firestore_hmac_secret)

    secrets_map = {"AURORA_FIRESTORE_HMAC_SECRET": hmac_secret}
    external: dict[str, object] | None = None
    issued: AuroraIssuedKey | None = None
    if external_system_name or external_base_url or external_api_key:
        if not (external_system_name and external_base_url and external_api_key):
            raise ConnectorSetupError("integração externa exige nome, URL e chave do sistema externo")
        system = validate_identifier(external_system_name, field="sistema externo")
        base_url = validate_https_url(external_base_url, field="external base URL")
        secrets_map[f"AURORA_EXTERNAL_{system}_API_KEY"] = external_api_key
        external = {
            "name": system,
            "baseUrl": base_url,
            "apiKeyEnv": _safe_env_name(f"AURORA_EXTERNAL_{system}_API_KEY"),
            "status": "CONFIGURED_AWAITING_CONNECTIVITY_TEST",
        }
        if issue_reverse_key:
            issued = issue_aurora_api_key(org, system, days=key_days)
            secrets_map["AURORA_ISSUED_API_KEY"] = issued.api_key

    manifest: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": utc_now().replace(microsecond=0).isoformat(),
        "org": org,
        "mode": "PLUG_AND_PLAY_CONNECTORS",
        "googleDrive": {
            "folderId": folder,
            "contentRead": True,
            "sourceMutation": False,
            "continuousExtraction": True,
            "pollMinutes": 15,
        },
        "firebase": {
            "ingestUrl": ingest,
            "hmacKeyId": key_id,
            "hmacSecretEnv": "AURORA_FIRESTORE_HMAC_SECRET",
            "mirrorRequired": True,
        },
        "externalSystem": external,
        "issuedAuroraCredential": None if not issued else {
            "keyId": issued.key_id,
            "sha256": issued.sha256,
            "expiresAt": issued.expires_at,
            "scopes": list(issued.scopes),
            "rawKeyStoredInManifest": False,
            "registrationState": "AWAITING_SERVER_REGISTRATION",
            "registrationRequest": {
                "action": "REGISTER_HASH",
                "name": external["name"] if external else "external-system",
                "keyId": issued.key_id,
                "tokenHash": issued.sha256,
                "expiresAt": issued.expires_at,
                "scopes": list(issued.scopes),
            },
        },
        "secrets": redacted_secret_inventory(secrets_map),
    }
    return manifest, secrets_map, issued


def interactive_install(
    target: Path,
    *,
    org: str,
    public_prompt: Callable[[str], str] = input,
    secret_prompt: Callable[[str], str] = getpass.getpass,
) -> dict[str, object]:
    validate_org(org)
    folder = validate_drive_folder_id(_public_prompt("Google Drive folder ID: ", public_prompt))
    ingest_url = validate_https_url(_public_prompt("Firebase/Aurora ingest URL (HTTPS): ", public_prompt), field="Firebase ingest URL")
    hmac_key_id = validate_identifier(_public_prompt("Aurora HMAC key ID: ", public_prompt), field="HMAC key ID")
    hmac_secret = validate_hmac_secret(_secret_prompt("Aurora HMAC secret (64 hex; oculto): ", secret_prompt))

    external_name = _public_prompt("Sistema externo a integrar (Enter para nenhum): ", public_prompt)
    external_url = None
    external_key = None
    if external_name:
        external_name = validate_identifier(external_name, field="sistema externo")
        external_url = validate_https_url(_public_prompt("URL base do sistema externo (HTTPS): ", public_prompt), field="external base URL")
        external_key = _secret_prompt("API key/secret do sistema externo (oculto): ", secret_prompt)

    manifest, secret_values, issued = build_install_bundle(
        org=org,
        drive_folder_id=folder,
        firestore_ingest_url=ingest_url,
        firestore_hmac_key_id=hmac_key_id,
        firestore_hmac_secret=hmac_secret,
        external_system_name=external_name or None,
        external_base_url=external_url,
        external_api_key=external_key,
        issue_reverse_key=bool(external_name),
    )
    connectors_dir = target / "connectors"
    connectors_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest_path = connectors_dir / "connectors.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        manifest_path.chmod(0o600)
    except OSError:
        pass
    write_private_env(connectors_dir / "secrets.env", secret_values)

    if issued:
        print("AURORA API KEY — exibição única:")
        print(issued.api_key)
        print("Cadastre a impressão digital indicada em connectors.json no servidor Aurora antes do uso.")
    return manifest
