import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("renew", ROOT / "tools/renew-appscript-oauth.py")
renew = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renew)


class RenewalTests(unittest.TestCase):
    def exercise(self, change=None, login_code=0, concurrent=False, secret_failure=False):
        with tempfile.TemporaryDirectory() as directory:
            baseline = Path(directory) / "baseline.json"
            old = dict(client_id="same-client", client_secret="synthetic-secret",
                       refresh_token="old-refresh", access_token="old-access", scope="openid scope-a")
            baseline.write_text(json.dumps({"tokens": {"default": old, "other": {"preserved": True}}}))
            before = baseline.read_bytes()
            new = dict(old, refresh_token="new-refresh", access_token="new-access")
            identity = {"email": "owner@example.test", "verified_email": True}
            if change:
                change(new, identity)
            written = []
            auth_paths = []

            def command(args, **kwargs):
                if args[1:3] == ["api", "user"]:
                    return b"GESTAOWMGJ\n"
                if args[1:4] == ["secret", "set", "CLASPRC_JSON"]:
                    self.assertEqual(args[-2:], ["--env", "firebase-homologation"])
                    self.assertIn(renew.REPO, args)
                    if secret_failure:
                        raise renew.RenewalError("OFFICIAL_COMMAND_FAILED")
                    written.append(json.loads(kwargs["input"]))
                    return b""
                if args[-1].endswith("/secrets/CLASPRC_JSON"):
                    return b'{"name":"CLASPRC_JSON","updated_at":"synthetic"}'
                if "deployments" in args:
                    return json.dumps([dict(deploymentId="existing", versionNumber=7,
                        description="AURORA_EXECUTION_API_CANONICAL " + "a" * 40)]).encode()
                return json.dumps({"protection_rules": [{"type": "required_reviewers", "reviewers": ["owner"]}],
                    "deployment_branch_policy": {"custom_branch_policies": True}}).encode()

            def login(args, **kwargs):
                self.assertEqual(args[-1], "--use-project-scopes")
                auth = Path(args[args.index("--auth") + 1])
                auth_paths.append(auth)
                self.assertNotEqual(auth, baseline)
                self.assertEqual(auth.parent.stat().st_mode & 0o777, 0o700)
                auth.write_text(json.dumps({"tokens": {"default": new}}))
                if concurrent:
                    baseline.write_text("concurrent change")
                return SimpleNamespace(returncode=login_code)

            args = SimpleNamespace(baseline=str(baseline), expected_email="owner@example.test")
            output = io.StringIO()
            error = None
            try:
                with patch.object(renew, "run", side_effect=command), patch.object(renew.subprocess, "run", side_effect=login), \
                     patch.object(renew.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(identity).encode())), \
                     patch("sys.stdout", output):
                    renew.renew(args)
            except renew.RenewalError as e:
                error = str(e)
            self.assertTrue(all(not p.parent.exists() for p in auth_paths))
            self.assertEqual(baseline.read_bytes(), b"concurrent change" if concurrent else before)
            for sensitive in ["synthetic-secret", "old-refresh", "new-refresh", "new-access"]:
                self.assertNotIn(sensitive, output.getvalue())
            return error, written, output.getvalue()

    def test_success_preserves_local_profiles_and_only_writes_environment(self):
        error, written, output = self.exercise()
        self.assertIsNone(error)
        self.assertEqual(len(written), 1)
        self.assertEqual(list(written[0]["tokens"]), ["default"])
        self.assertIn("OAUTH_REAUTHORIZED_ENVIRONMENT_SECRET_UPDATED", output)

    def test_wrong_owner_never_writes(self):
        error, written, _ = self.exercise(lambda n, i: i.update(email="other@example.test"))
        self.assertEqual(error, "OAUTH_OWNER_MISMATCH")
        self.assertFalse(written)

    def test_changed_client_and_scopes_never_write(self):
        for field, value, code in [("client_id", "other", "OAUTH_CLIENT_CHANGED"),
                                  ("scope", "openid scope-a extra", "OAUTH_SCOPES_CHANGED"),
                                  ("scope", "openid", "OAUTH_SCOPES_CHANGED"),
                                  ("refresh_token", "", "NEW_CREDENTIAL_INCOMPLETE")]:
            with self.subTest(field=field, value=value):
                error, written, _ = self.exercise(lambda n, i: n.update({field: value}))
                self.assertEqual(error, code)
                self.assertFalse(written)

    def test_cancelled_consent_and_concurrent_profile_change_never_write(self):
        for args, code in [({"login_code": 1}, "OWNER_CONSENT_NOT_COMPLETED"),
                           ({"concurrent": True}, "LOCAL_CREDENTIAL_CHANGED_CONCURRENTLY")]:
            error, written, _ = self.exercise(**args)
            self.assertEqual(error, code)
            self.assertFalse(written)

    def test_secret_failure_does_not_claim_success(self):
        error, written, output = self.exercise(secret_failure=True)
        self.assertEqual(error, "OFFICIAL_COMMAND_FAILED")
        self.assertFalse(written)
        self.assertNotIn("OAUTH_REAUTHORIZED_ENVIRONMENT_SECRET_UPDATED", output)

    def test_missing_or_ambiguous_deployment_is_rejected(self):
        item = dict(deploymentId="existing", versionNumber=7,
                    description="AURORA_EXECUTION_API_CANONICAL " + "a" * 40)
        for items in [[], [item, item], [dict(item, description="AURORA_EXECUTION_API_CANONICAL manual")]]:
            with self.assertRaises(renew.RenewalError):
                renew.canonical_deployment(items)


if __name__ == "__main__":
    unittest.main()
