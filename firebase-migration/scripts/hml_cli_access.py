#!/usr/bin/env python3
"""Explicit local HML CLI setup. Credentials stay in the native gcloud store."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

from hml_gate_readonly import NUMBER, PROFILE, PROJECT, error_code, find_gcloud


class AccessError(Exception):
    pass


class Cli:
    def __init__(self):
        self.executable = find_gcloud()
        if not self.executable:
            raise AccessError("GCLOUD_UNAVAILABLE")
        self.env = dict(os.environ, CLOUDSDK_CORE_LOG_HTTP="false")

    def run(self, args):
        try:
            result = subprocess.run([self.executable, *args, "--quiet"], capture_output=True,
                                    text=True, timeout=30, check=False,
                                    env=dict(self.env, CLOUDSDK_CORE_DISABLE_PROMPTS="1"))
        except (OSError, subprocess.TimeoutExpired):
            raise AccessError("LOCAL_CLI_QUERY_FAILED") from None
        if result.returncode:
            raise AccessError(error_code(result.stderr))
        try:
            return json.loads(result.stdout) if result.stdout.strip() else None
        except (ValueError, TypeError):
            raise AccessError("INVALID_METADATA_JSON") from None

    def login(self):
        env = dict(self.env)
        env.pop("CLOUDSDK_CORE_DISABLE_PROMPTS", None)
        # BROWSER is process-local; do not change Windows' default browser.
        if os.name == "nt":
            for key in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
                root = env.get(key)
                if root:
                    chrome = Path(root) / "Google/Chrome/Application/chrome.exe"
                    if chrome.is_file():
                        env["BROWSER"] = '"' + str(chrome) + '" %s'
                        break
        # Official interactive flow; do not copy browser sessions or export tokens.
        result = subprocess.run([self.executable, "auth", "login", "--brief",
                                 "--configuration=" + PROFILE, "--project=" + PROJECT],
                                env=env, check=False)
        if result.returncode:
            raise AccessError("LOGIN_NOT_COMPLETED")


def setup(cli, login=False):
    profiles = cli.run(["config", "configurations", "list", "--filter=name=" + PROFILE,
                        "--format=json(name,properties.core.account,properties.core.project)"])
    if not isinstance(profiles, list) or len(profiles) > 1:
        raise AccessError("PROFILE_METADATA_INVALID")
    core = {}
    if profiles:
        profile = profiles[0]
        if not isinstance(profile, dict) or profile.get("name") != PROFILE:
            raise AccessError("PROFILE_METADATA_INVALID")
        properties = profile.get("properties", {})
        if not isinstance(properties, dict):
            raise AccessError("PROFILE_METADATA_INVALID")
        core = properties.get("core", {})
        if not isinstance(core, dict) or core.get("project") not in (None, "", PROJECT):
            raise AccessError("PROFILE_PROJECT_CONFLICT")
    account = core.get("account")
    if not login:
        if not account:
            accounts = cli.run(["auth", "list", "--filter=status:ACTIVE", "--format=json(account,status)"])
            if (not isinstance(accounts, list) or len(accounts) != 1
                    or not isinstance(accounts[0], dict) or accounts[0].get("status") != "ACTIVE"):
                raise AccessError("AUTH_LOGIN_REQUIRED")
            account = accounts[0].get("account")
        # Used locally only; must also be safe as a Windows CLI argument.
        if not isinstance(account, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+@-]{1,253}", account):
            raise AccessError("ACCOUNT_METADATA_INVALID")
        project = cli.run(["projects", "describe", PROJECT, "--account=" + account,
                           "--project=" + PROJECT, "--format=json(projectId,projectNumber,lifecycleState)"])
        if (not isinstance(project, dict) or project.get("projectId") != PROJECT
                or str(project.get("projectNumber")) != NUMBER or project.get("lifecycleState") != "ACTIVE"):
            raise AccessError("PROJECT_IDENTITY_UNVERIFIED")
    # Local configuration writes only. Do not activate this profile globally.
    if not profiles:
        cli.run(["config", "configurations", "create", PROFILE, "--no-activate", "--format=json"])
    scope = ["--configuration=" + PROFILE, "--format=json"]
    if core.get("project") != PROJECT:
        cli.run(["config", "set", "core/project", PROJECT, *scope])
    if login:
        cli.login()
    elif core.get("account") != account:
        cli.run(["config", "set", "core/account", account, *scope])
    # Re-read configuration; login's exit code alone does not prove cloud access.
    verified = cli.run(["config", "list", "core/", *scope])
    actual = verified.get("core", {}) if isinstance(verified, dict) else {}
    if not isinstance(actual, dict) or actual.get("project") != PROJECT or not actual.get("account"):
        raise AccessError("PROFILE_SETUP_UNVERIFIED")
    return {"schemaVersion": "aurora.hml.cli-access.v1", "profile": PROFILE,
            "projectId": PROJECT, "status": "LOCAL_PROFILE_READY",
            "credentialStorage": "GCLOUD_NATIVE", "tokenExported": False,
            "cloudMutationAttempted": False, "releaseApproved": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--setup", action="store_true", help="Reuse the locally authenticated account")
    action.add_argument("--login", action="store_true", help="Start official interactive login in this profile")
    args = parser.parse_args(argv)
    if not (args.setup or args.login):
        print(json.dumps({"mode": "PLAN_ONLY", "profile": PROFILE, "projectId": PROJECT}))
        return 0
    try:
        print(json.dumps(setup(Cli(), login=args.login)))
        return 0
    except AccessError as exc:
        print(json.dumps({"status": "BLOCKED", "code": str(exc), "tokenExported": False,
                          "cloudMutationAttempted": False, "releaseApproved": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
