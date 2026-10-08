#!/usr/bin/env python3
"""Install the per-user Aurora web client, preserving the deployed frontend.

This client opens the canonical portal only after its HML auth gate is verified. It is not a data
replica, a Windows service, a browser-auth exporter or a production release.
"""
import argparse
import base64
from contextlib import contextmanager
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import uuid

COLLECTOR_SOURCE = Path(__file__).resolve().parents[1] / "aurora-coletor"
sys.path.insert(0, str(COLLECTOR_SOURCE))
from aurora_deployment import install_assets as install_integration_assets, read_json, safe_path as deployment_safe_path

VERSION = "0.2.0-beta.4"
BASE = "https://auroranexus.com.br/portal"
TECHNICAL_SMOKE_BASE = "https://wmgj-hml-jfn-20260927.web.app"
SOURCE_SHA = "203670bc562bbb48694b08e55af363a07d90a8f5"
AUTH_PROJECT = "wmgj-hml-jfn-20260927"
MAX_BYTES = 262144
LEGACY_SOURCE_SHA = "354f611f642ce6b62c489d6b06f254587aaef84b"
# Exact installer source from main 203670bc, in the two checkout line endings.
LEGACY_SCRIPT_HASHES = {
    "1b2a7c7b3c842c9dbc884111ea9c6ead091bb196200793e763cb5d2c319c7a92",
    "e3d2f1de5b9649d7c9b48be41b12c1436aac6645f35d0a7f3e7e570f3e30ce62",
}
CANONICAL_SCRIPT_HASHES = {
    "f33f138b018e39275055418563a3a1c4ff34a92eed0747b95a34e84525abda78",
    "a43d457bd20cda69d180f499f717262f58cbbe0dad09c60c809e46a40e5762d9",
}


class LoginForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_form = False
        self.fields = set()
        self.complete = False
        self.fieldsets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "fieldset":
            self.fieldsets.append("disabled" in attrs)
        if tag == "form":
            action = urlsplit(attrs.get("action", ""))
            self.fields = set()
            self.in_form = attrs.get("id") == "login-form" and not action.netloc and not action.scheme
        if (not self.in_form or any(self.fieldsets) or "disabled" in attrs
                or attrs.get("form", "login-form") != "login-form"):
            return
        if tag == "input" and attrs.get("id") == "email" and attrs.get("type") == "email":
            self.fields.add("email")
        if tag == "input" and attrs.get("id") == "password" and attrs.get("type") == "password":
            self.fields.add("password")
        if tag == "button" and attrs.get("id") == "submit" and attrs.get("type") == "submit":
            self.fields.add("submit")

    def handle_endtag(self, tag):
        if tag == "fieldset" and self.fieldsets:
            self.fieldsets.pop()
        if tag == "form":
            self.complete |= self.in_form and self.fields == {"email", "password", "submit"}
            self.in_form = False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def inspect_endpoint(path):
    portal = urlsplit(BASE)
    if portal.scheme != "https" or portal.username or portal.password or portal.query or portal.fragment:
        raise ValueError("CANONICAL_PORTAL_URL_REJECTED")
    request = urllib.request.Request(portal.scheme + "://" + portal.netloc + path,
                                     headers={"Accept": "application/json,text/html", "Cache-Control": "no-store"})
    try:
        response = urllib.request.build_opener(NoRedirect).open(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("RESPONSE_TOO_LARGE")
        content_type = response.headers.get("Content-Type", "").split(";")[0]
        code = None
        project = None
        if content_type == "application/json":
            value = json.loads(body)
            code = value.get("code") if isinstance(value, dict) else None
            project = value.get("projectId") if isinstance(value, dict) else None
            if code is not None and (not isinstance(code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", code)):
                code = "UNEXPECTED_CODE"
        login_form = LoginForm()
        if content_type == "text/html":
            login_form.feed(body.decode("utf-8", errors="replace"))
        # Return only bounded diagnostic facts, never private content/cookies.
        return {"path": path, "status": response.code, "contentType": content_type,
                "code": code, "authProjectMatches": project == AUTH_PROJECT,
                "loginFormPresent": login_form.complete,
                "privateShellExposed": b"Centro de gest" in body}


def probe():
    login = inspect_endpoint(urlsplit(BASE).path)
    bootstrap = inspect_endpoint("/api/bootstrap")
    auth_config = inspect_endpoint("/__/firebase/init.json")
    if login["status"] != 200 or not login["loginFormPresent"] or login["privateShellExposed"]:
        raise ValueError("CANONICAL_PORTAL_LOGIN_NOT_VERIFIED")
    if bootstrap["status"] != 401 or bootstrap["code"] != "AUTH_REQUIRED":
        raise ValueError("CANONICAL_PORTAL_BOOTSTRAP_NOT_VERIFIED")
    if auth_config["status"] != 200 or not auth_config["authProjectMatches"]:
        raise ValueError("CANONICAL_PORTAL_AUTH_PROJECT_NOT_VERIFIED")
    checks = [login, bootstrap, auth_config]
    for path in ("/api/integration/ping", "/api/native-insight?intent=EXECUTIVE"):
        try:
            checks.append(inspect_endpoint(path))
        except (OSError, ValueError):
            checks.append({"path": path, "status": None, "code": "PROBE_FAILED"})
    return {"atUtc": dt.datetime.now(dt.timezone.utc).isoformat(), "loginReachable": True,
            "probedPortal": BASE, "sameOriginBootstrapVerified": True,
            "sameOriginAuthProjectVerified": True,
            "anonymousAccessDenied": True, "authenticatedSyncVerified": False,
            "realDataCopied": False, "checks": checks}


def powershell_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def shortcut_script(target, edge, shortcuts):
    lines = ["$ErrorActionPreference='Stop'", "$ProgressPreference='SilentlyContinue'", "$w=New-Object -ComObject WScript.Shell"]
    for path in shortcuts:
        lines.extend([f"$s=$w.CreateShortcut({powershell_literal(path)})",
                      f"$s.TargetPath={powershell_literal(edge)}",
                      f"$s.Arguments={powershell_literal('--app=' + BASE)}",
                      f"$s.WorkingDirectory={powershell_literal(target)}",
                      "$s.Description='AURORA NEXUS - acesso privado de homologacao'",
                      "$s.Save()"])
    return "\n".join(lines)


def safe_path(path):
    path = deployment_safe_path(path)
    # Python 3.10/3.11 lack Path.is_junction(); reject Windows reparse ancestors too.
    for part in (path, *path.parents):
        try:
            if getattr(part.lstat(), "st_file_attributes", 0) & 0x400:
                raise ValueError("LINK_PATH_REJECTED")
        except FileNotFoundError:
            pass
    return path


def file_bytes(path):
    path = safe_path(path)
    if not path.exists():
        return None
    if not path.is_file() or path.stat().st_nlink != 1:
        raise ValueError("INSTALLATION_FILE_REJECTED")
    with path.open("rb") as stream:
        value = stream.read(MAX_BYTES + 1)
    if len(value) > MAX_BYTES:
        raise ValueError("INSTALLATION_FILE_TOO_LARGE")
    return value


def fingerprint(value):
    return hashlib.sha256(value).hexdigest() if value is not None else None


def require_unchanged(path, expected):
    if file_bytes(path) != expected:
        raise ValueError("INSTALLATION_CHANGED_REQUIRES_REVIEW")


def read_shortcut(path):
    script = ("# READ_ONLY_SHORTCUT\n[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\n"
              "$ErrorActionPreference='Stop'\n$w=New-Object -ComObject WScript.Shell\n"
              f"$s=$w.CreateShortcut({powershell_literal(path)})\n"
              "@{target=$s.TargetPath;arguments=$s.Arguments;workingDirectory=$s.WorkingDirectory}|ConvertTo-Json -Compress")
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                            check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(result.stdout)


def verify_shortcut(path, target, edge, portal):
    expected = {"target": str(edge), "arguments": "--app=" + portal, "workingDirectory": str(target)}
    if read_shortcut(path) != expected:
        raise ValueError("SHORTCUT_IDENTITY_CONFLICT")


def write_shortcuts(target, edge, shortcuts):
    encoded = base64.b64encode(shortcut_script(target, edge, shortcuts).encode("utf-16le")).decode("ascii")
    subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], check=True)
    for path in shortcuts:
        if file_bytes(path) is None:
            raise ValueError("SHORTCUT_VERIFICATION_FAILED")
        verify_shortcut(path, target, edge, BASE)


def current_script_hashes():
    value = Path(__file__).read_bytes().replace(b"\r\n", b"\n")
    return {fingerprint(value), fingerprint(value.replace(b"\n", b"\r\n"))}


def known_identity(previous, expected):
    if not isinstance(previous, dict) or previous.get("offlineBusinessApp") is not False:
        raise ValueError("INSTALLATION_IDENTITY_CONFLICT")
    for key in ("gatewayDatabaseChanged", "cloudDeploymentPerformed", "productionReleased", "macUpdated", "iosNativeAppBuilt"):
        if previous.get(key) is not False:
            raise ValueError("INSTALLATION_IDENTITY_CONFLICT")
    legacy = {"clientVersion": VERSION, "portal": TECHNICAL_SMOKE_BASE,
              "frontendPolicy": "PRESERVE_DEPLOYED_MAIN", "reviewedMainSha": LEGACY_SOURCE_SHA,
              "environment": "HML", "offlineBusinessApp": False}
    if (all(previous.get(key) == value for key, value in legacy.items())
            and "technicalSmokeBase" not in previous
            and previous.get("sourceScriptSha256") in LEGACY_SCRIPT_HASHES):
        return "LEGACY_APPROVED_BETA4"
    if (all(previous.get(key) == value for key, value in expected.items())
            and previous.get("sourceScriptSha256") in CANONICAL_SCRIPT_HASHES | current_script_hashes()):
        return "CURRENT_BETA4"
    raise ValueError("INSTALLATION_IDENTITY_CONFLICT")


def previous_shortcut_portal(previous):
    # Both historical installers appended '/', even to the canonical /portal.
    legacy_script = previous.get("sourceScriptSha256") in LEGACY_SCRIPT_HASHES | CANONICAL_SCRIPT_HASHES
    return previous["portal"] + ("/" if legacy_script else "")


@contextmanager
def installation_lock(root):
    lock = safe_path(root / "client" / ".beta4-install.lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    owner = uuid.uuid4().hex.encode("ascii")
    try:
        with lock.open("xb") as stream:
            stream.write(owner)
    except FileExistsError:
        raise ValueError("INSTALLATION_BUSY_OR_INTERRUPTED") from None
    try:
        yield
    finally:
        if file_bytes(lock) == owner:
            lock.unlink()


def backup_name(label):
    return "before-" + label + (".json" if label == "manifest" else ".lnk")


def replace_unchanged(path, before, after):
    require_unchanged(path, before)
    if after is None:
        path.unlink()
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".aurora-update-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(after)
            stream.flush()
            os.fsync(stream.fileno())
        require_unchanged(path, before)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def update_client(root, target, edge, shortcuts, previous, expected, proof, snapshots):
    # The canonical gate has already passed; no backup or install lock is made before it.
    paths = {"manifest": target / "installation.json", **{f"shortcut-{i}":p for i,p in enumerate(shortcuts)}}
    with installation_lock(root):
        for label, path in paths.items():
            require_unchanged(path, snapshots[label])
        backup = safe_path(root / "installation-rollbacks" / uuid.uuid4().hex)
        backup.mkdir(parents=True, mode=0o700)
        receipt = {"schemaVersion": 1, "clientVersion": VERSION, "state": "PREPARED", "artifacts": {}}
        for label, path in paths.items():
            value = snapshots[label]
            if value is not None:
                saved = backup / backup_name(label)
                replace_unchanged(saved, None, value)
                if file_bytes(saved) != value:
                    raise ValueError("BACKUP_INTEGRITY_FAILED")
            receipt["artifacts"][label] = {"beforeSha256": fingerprint(value), "afterSha256": None}
        # Stage WScript output before replacing any registered shortcut.
        staged = [backup / f"after-shortcut-{i}.lnk" for i in range(len(shortcuts))]
        write_shortcuts(target, edge, staged)
        for path in (root / "integration", root / "integration/state", root / "integration/1.0.0"):
            safe_path(path)
        integration = install_integration_assets(COLLECTOR_SOURCE, root)
        manifest = {**(previous or {}), **expected, "installedAtUtc": (previous or {}).get("installedAtUtc", proof["atUtc"]),
                    "updatedAtUtc": proof["atUtc"], "shortcuts": [str(p) for p in shortcuts], "launchTarget": str(edge),
                    "probe": proof, "sourceScriptSha256": fingerprint(Path(__file__).read_bytes()),
                    "gatewayDatabaseChanged": False, "cloudDeploymentPerformed": False,
                    "productionReleased": False, "macUpdated": False, "iosNativeAppBuilt": False,
                    "integrationComponent": integration, "rollbackBackupId": backup.name}
        replacements = {f"shortcut-{i}": file_bytes(p) for i,p in enumerate(staged)}
        replacements["manifest"] = json.dumps(manifest, indent=2, allow_nan=False).encode("utf-8")
        if len(replacements["manifest"]) > MAX_BYTES:
            raise ValueError("INSTALLATION_FILE_TOO_LARGE")
        for label, value in replacements.items():
            receipt["artifacts"][label]["afterSha256"] = fingerprint(value)
        receipt_path = backup / "receipt.json"
        receipt_bytes = json.dumps(receipt, indent=2).encode("utf-8")
        replace_unchanged(receipt_path, None, receipt_bytes)
        for label, path in paths.items():
            require_unchanged(path, snapshots[label])
        applied = []
        try:
            for label, value in replacements.items():
                replace_unchanged(paths[label], snapshots[label], value)
                applied.append(label)
            receipt["state"] = "COMMITTED"
            replace_unchanged(receipt_path, receipt_bytes, json.dumps(receipt, indent=2).encode("utf-8"))
        except Exception:
            # Restore only files still matching this attempt; never overwrite another writer.
            for label in reversed(applied):
                path = paths[label]
                require_unchanged(path, replacements[label])
                original = snapshots[label]
                if original is None:
                    path.unlink()
                else:
                    replace_unchanged(path, replacements[label], original)
            receipt["state"] = "ROLLED_BACK"
            replace_unchanged(receipt_path, receipt_bytes, json.dumps(receipt, indent=2).encode("utf-8"))
            raise
        return backup


def rollback(backup_path):
    if os.name != "nt":
        raise RuntimeError("WINDOWS_REQUIRED")
    root = safe_path(Path(os.environ["LOCALAPPDATA"]) / "AuroraNexus")
    target = root / "client" / VERSION
    backup = safe_path(Path(backup_path))
    if backup.parent != root / "installation-rollbacks" or not re.fullmatch(r"[a-f0-9]{32}", backup.name):
        raise ValueError("ROLLBACK_LOCATION_REJECTED")
    receipt_path = backup / "receipt.json"
    receipt_bytes = file_bytes(receipt_path)
    receipt = read_json(receipt_path)
    require_unchanged(receipt_path, receipt_bytes)
    if receipt.get("schemaVersion") != 1 or receipt.get("clientVersion") != VERSION or receipt.get("state") != "COMMITTED":
        raise ValueError("ROLLBACK_RECEIPT_REJECTED")
    paths = {"manifest": target / "installation.json",
             "shortcut-0": Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/AURORA NEXUS.lnk",
             "shortcut-1": Path(os.environ["USERPROFILE"]) / "Desktop/AURORA JFN - Inicio/AURORA NEXUS.lnk"}
    artifacts = receipt.get("artifacts")
    if not isinstance(artifacts, dict) or not {"manifest", "shortcut-0"} <= artifacts.keys() or not artifacts.keys() <= paths.keys():
        raise ValueError("ROLLBACK_RECEIPT_REJECTED")
    originals = {}
    current = {}
    for label, entry in artifacts.items():
        if not isinstance(entry, dict) or set(entry) != {"beforeSha256", "afterSha256"}:
            raise ValueError("ROLLBACK_RECEIPT_REJECTED")
        if not isinstance(entry["afterSha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", entry["afterSha256"]):
            raise ValueError("ROLLBACK_RECEIPT_REJECTED")
        if entry["beforeSha256"] is not None and (not isinstance(entry["beforeSha256"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", entry["beforeSha256"])):
            raise ValueError("ROLLBACK_RECEIPT_REJECTED")
        originals[label] = file_bytes(backup / backup_name(label))
        if fingerprint(originals[label]) != entry["beforeSha256"] or (label == "manifest" and originals[label] is None):
            raise ValueError("BACKUP_INTEGRITY_FAILED")
        current[label] = file_bytes(paths[label])
        if fingerprint(current[label]) != entry["afterSha256"]:
            raise ValueError("INSTALLATION_CHANGED_REQUIRES_REVIEW")
    previous = read_json(backup / backup_name("manifest"))
    expected = {"clientVersion": VERSION, "portal": BASE, "technicalSmokeBase": TECHNICAL_SMOKE_BASE,
                "frontendPolicy": "CANONICAL_PORTAL_SINGLE_ENTRY", "reviewedMainSha": SOURCE_SHA,
                "environment": "HML", "offlineBusinessApp": False}
    known_identity(previous, expected)
    edge = Path(previous.get("launchTarget", ""))
    allowed_edges = {Path(os.environ.get(key, default)) / "Microsoft/Edge/Application/msedge.exe"
                     for key, default in [("PROGRAMFILES(X86)", "C:/Program Files (x86)"), ("PROGRAMFILES", "C:/Program Files")]}
    if edge not in allowed_edges or not edge.is_file():
        raise ValueError("SHORTCUT_IDENTITY_CONFLICT")
    old_portal = previous_shortcut_portal(previous)
    for label in artifacts:
        if label != "manifest" and originals[label] is not None:
            verify_shortcut(backup / backup_name(label), target, edge, old_portal)
    with installation_lock(root):
        require_unchanged(receipt_path, receipt_bytes)
        for label in artifacts:
            require_unchanged(paths[label], current[label])
        applied = []
        try:
            # The manifest remains the last commit marker, including during rollback.
            for label in sorted(artifacts, key=lambda name: name == "manifest"):
                replace_unchanged(paths[label], current[label], originals[label])
                applied.append(label)
            receipt["state"] = "ROLLED_BACK"
            replace_unchanged(receipt_path, receipt_bytes, json.dumps(receipt, indent=2).encode("utf-8"))
        except Exception:
            for label in reversed(applied):
                replace_unchanged(paths[label], originals[label], current[label])
            raise
    print(json.dumps({"status": "CLIENT_ROLLED_BACK", "clientVersion": VERSION}))


def install():
    if os.name != "nt":
        raise RuntimeError("WINDOWS_REQUIRED")
    # No admin, policy change, browser profile copy or service-account credential.
    local = Path(os.environ["LOCALAPPDATA"])
    roaming = Path(os.environ["APPDATA"])
    edge = next((p for p in [Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")),
                            Path(os.environ.get("PROGRAMFILES", "C:/Program Files"))]
                 if (p / "Microsoft/Edge/Application/msedge.exe").is_file()), None)
    if edge is None:
        raise RuntimeError("MICROSOFT_EDGE_REQUIRED")
    edge = edge / "Microsoft/Edge/Application/msedge.exe"
    root = local / "AuroraNexus"
    target = root / "client" / VERSION
    link = roaming / "Microsoft/Windows/Start Menu/Programs/AURORA NEXUS.lnk"
    desktop = Path(os.environ["USERPROFILE"]) / "Desktop" / "AURORA JFN - Inicio"
    shortcuts = [link]
    if desktop.is_dir():
        shortcuts.append(desktop / "AURORA NEXUS.lnk")
    manifest_file = safe_path(target / "installation.json")
    existed = manifest_file.exists()
    expected = {"clientVersion": VERSION, "portal": BASE, "technicalSmokeBase": TECHNICAL_SMOKE_BASE, "frontendPolicy": "CANONICAL_PORTAL_SINGLE_ENTRY",
                "reviewedMainSha": SOURCE_SHA, "environment": "HML", "offlineBusinessApp": False}
    if existed:
        manifest_bytes = file_bytes(manifest_file)
        previous = read_json(manifest_file)
        require_unchanged(manifest_file, manifest_bytes)
        known_identity(previous, expected)
    elif target.exists():
        raise ValueError("EXISTING_INSTALLATION_REQUIRES_REVIEW")
    elif any(p.exists() for p in shortcuts):
        # Unknown prior versions never authorize replacement by generic portal/policy fields.
        raise ValueError("EXISTING_INSTALLATION_REQUIRES_REVIEW")
    else:
        previous = None
    snapshots = {"manifest": manifest_bytes if existed else None, **{f"shortcut-{i}":file_bytes(p) for i,p in enumerate(shortcuts)}}
    if existed:
        if previous.get("launchTarget") != str(edge) or set(previous.get("shortcuts", [])) != {str(p) for p in shortcuts if p.exists()}:
            raise ValueError("INSTALLATION_IDENTITY_CONFLICT")
        old_portal = previous_shortcut_portal(previous)
        for path in shortcuts:
            if path.exists():
                verify_shortcut(path, target, edge, old_portal)
    proof = probe()
    # Bind approval to precisely the URL used by the client, never a fallback probe.
    if (proof.get("probedPortal") != BASE or proof.get("sameOriginBootstrapVerified") is not True
            or proof.get("sameOriginAuthProjectVerified") is not True):
        raise ValueError("CANONICAL_PORTAL_PROOF_REQUIRED")
    backup = update_client(root, target, edge, shortcuts, previous if existed else None, expected, proof, snapshots)
    print(json.dumps({"status": "CLIENT_INSTALLED", "idempotent": existed,
                      "manifest": str(manifest_file), "rollbackBackup": str(backup), "proof": proof}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("probe", "install", "prepare-integration", "rollback"))
    parser.add_argument("--target", help="Existing installation root for prepare-integration")
    parser.add_argument("--backup", help="Explicit verified installation rollback directory")
    args = parser.parse_args()
    try:
        if args.action == "prepare-integration":
            if not args.target:
                parser.error("--target is required for prepare-integration")
            print(json.dumps(install_integration_assets(COLLECTOR_SOURCE, Path(args.target))))
        elif args.action == "rollback":
            if not args.backup:
                parser.error("--backup is required for rollback")
            rollback(args.backup)
        elif args.action == "probe":
            print(json.dumps(probe(), indent=2))
        else:
            install()
        return 0
    except Exception as error:
        code = str(error)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", code):
            code = "LOCAL_INSTALLATION_FAILED"
        print(json.dumps({"status": "BLOCKED", "code": code, "errorType": type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
