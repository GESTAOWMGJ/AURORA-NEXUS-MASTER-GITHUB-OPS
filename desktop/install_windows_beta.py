#!/usr/bin/env python3
"""Install the per-user Aurora web client, preserving the deployed frontend.

This client opens the existing private HML application. It is not a data
replica, a Windows service, a browser-auth exporter or a production release.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

COLLECTOR_SOURCE = Path(__file__).resolve().parents[1] / "aurora-coletor"
sys.path.insert(0, str(COLLECTOR_SOURCE))
from aurora_deployment import install_assets as install_integration_assets

VERSION = "0.2.0-beta.4"
BASE = "https://auroranexus.com.br/portal"
TECHNICAL_SMOKE_BASE = "https://wmgj-hml-jfn-20260927.web.app"
SOURCE_SHA = "203670bc562bbb48694b08e55af363a07d90a8f5"
MAX_BYTES = 262144


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def inspect_endpoint(path):
    request = urllib.request.Request(TECHNICAL_SMOKE_BASE + path, headers={"Accept": "application/json,text/html", "Cache-Control": "no-store"})
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
        if content_type == "application/json":
            value = json.loads(body)
            code = value.get("code") if isinstance(value, dict) else None
        # Return only bounded diagnostic facts, never private content/cookies.
        return {"path": path, "status": response.code, "contentType": content_type,
                "code": code, "loginMarker": b"Aurora Nexus | Login" in body,
                "privateShellExposed": b"Centro de gest" in body}


def probe():
    login = inspect_endpoint("/login")
    bootstrap = inspect_endpoint("/api/bootstrap")
    if login["status"] != 200 or not login["loginMarker"] or login["privateShellExposed"]:
        raise ValueError("LOGIN_SURFACE_NOT_VERIFIED")
    if bootstrap["status"] != 401 or bootstrap["code"] != "AUTH_REQUIRED":
        raise ValueError("PRIVATE_BOOTSTRAP_NOT_VERIFIED")
    checks = [login, bootstrap]
    for path in ("/api/integration/ping", "/api/native-insight?intent=EXECUTIVE"):
        try:
            checks.append(inspect_endpoint(path))
        except (OSError, ValueError):
            checks.append({"path": path, "status": None, "code": "PROBE_FAILED"})
    return {"atUtc": dt.datetime.now(dt.timezone.utc).isoformat(), "loginReachable": True,
            "anonymousAccessDenied": True, "authenticatedSyncVerified": False,
            "realDataCopied": False, "checks": checks}


def powershell_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def shortcut_script(target, edge, shortcuts):
    lines = ["$ErrorActionPreference='Stop'", "$w=New-Object -ComObject WScript.Shell"]
    for path in shortcuts:
        lines.extend([f"$s=$w.CreateShortcut({powershell_literal(path)})",
                      f"$s.TargetPath={powershell_literal(edge)}",
                      f"$s.Arguments={powershell_literal('--app=' + BASE + '/')}",
                      f"$s.WorkingDirectory={powershell_literal(target)}",
                      "$s.Description='AURORA NEXUS - acesso privado de homologacao'",
                      "$s.Save()"])
    return "\n".join(lines)


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
    manifest_file = target / "installation.json"
    existed = manifest_file.exists()
    expected = {"clientVersion": VERSION, "portal": BASE, "technicalSmokeBase": TECHNICAL_SMOKE_BASE, "frontendPolicy": "CANONICAL_PORTAL_SINGLE_ENTRY",
                "reviewedMainSha": SOURCE_SHA, "environment": "HML", "offlineBusinessApp": False}
    if existed:
        previous = json.loads(manifest_file.read_text(encoding="utf-8"))
        if any(previous.get(k) != v for k, v in expected.items()):
            raise ValueError("INSTALLATION_IDENTITY_CONFLICT")
    elif target.exists():
        raise ValueError("EXISTING_INSTALLATION_REQUIRES_REVIEW")
    elif any(p.exists() for p in shortcuts):
        prior_manifests = sorted((root / "client").glob("*/installation.json")) if (root / "client").is_dir() else []
        compatible = False
        for prior_manifest in prior_manifests:
            try:
                prior = json.loads(prior_manifest.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if ((prior.get("portal") == BASE or prior.get("portal") in {TECHNICAL_SMOKE_BASE, TECHNICAL_SMOKE_BASE + "/"}) and prior.get("environment") == "HML"
                    and (prior.get("frontendPolicy") == "PRESERVE_DEPLOYED_MAIN" or prior.get("frontendPolicy") == "CANONICAL_PORTAL_SINGLE_ENTRY")
                    and isinstance(prior.get("clientVersion"), str)):
                compatible = True
                break
        if not compatible:
            raise ValueError("EXISTING_INSTALLATION_REQUIRES_REVIEW")
    proof = probe()
    target.mkdir(parents=True, exist_ok=True)
    integration = install_integration_assets(COLLECTOR_SOURCE, root)
    link.parent.mkdir(parents=True, exist_ok=True)
    script = shortcut_script(target, edge, shortcuts)
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], check=True)
    if not all(p.is_file() for p in shortcuts):
        raise RuntimeError("SHORTCUT_VERIFICATION_FAILED")
    manifest = {**expected, "installedAtUtc": proof["atUtc"], "shortcuts": [str(p) for p in shortcuts],
                "launchTarget": str(edge), "probe": proof, "sourceScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "gatewayDatabaseChanged": False, "cloudDeploymentPerformed": False,
                "productionReleased": False, "macUpdated": False, "iosNativeAppBuilt": False}
    manifest["integrationComponent"] = integration
    manifest_file.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"status": "CLIENT_INSTALLED", "idempotent": existed,
                      "manifest": str(manifest_file), "proof": proof}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("probe", "install", "prepare-integration"))
    parser.add_argument("--target", help="Existing installation root for prepare-integration")
    args = parser.parse_args()
    try:
        if args.action == "prepare-integration":
            if not args.target:
                parser.error("--target is required for prepare-integration")
            print(json.dumps(install_integration_assets(COLLECTOR_SOURCE, Path(args.target))))
        elif args.action == "probe":
            print(json.dumps(probe(), indent=2))
        else:
            install()
        return 0
    except Exception as error:
        print(json.dumps({"status": "BLOCKED", "errorType": type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
