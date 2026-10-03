"""Synthetic helper-only replacement: no real device, service manager or network."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs = require("fs");
const {control} = require(process.argv[1]);
const config = JSON.parse(process.argv[2]);
const source = fs.readFileSync(process.argv[3]);
try {
  const result = control({
    mode: config.mode, home: config.home, source,
    now: () => new Date("2026-10-03T15:00:00Z"),
    exec: (file, args) => ({
      status: args[0] === "-n" ? 0 : (config.failNative ? 1 : 0),
      stdout: "JFN_MAC triggercmd=PROCESS_PRESENT"
    })
  });
  console.log(result.join("\n"));
} catch (e) { console.log(e.message); process.exitCode = 1; }
"""


class StatusReplacementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="helper-replacement-test-")
        self.addCleanup(self.tmp.cleanup)
        # macOS exposes its temp root through /var -> /private/var. Resolve only
        # the fixture root, keeping production symlink rejection unchanged.
        self.home = Path(self.tmp.name).resolve() / "synthetic account"
        self.target = self.home / ".TRIGGERcmdData/jfn_status_mac.sh"
        self.target.parent.mkdir(parents=True)
        self.original = b"#!/bin/bash\necho ORIGINAL\n"
        self.target.write_bytes(self.original)
        self.target.chmod(0o700)
        self.log = self.home / "Library/Logs/TRIGGERcmd-iMac.log"
        self.log.parent.mkdir(parents=True)
        self.log.write_text("PRIVATE_OLD_LOG_NOT_FOR_OUTPUT\n")
        self.support = self.home / "Library/Application Support/AuroraNexus-iMac"
        self.state = self.support / "status-helper-replacement.json"
        self.protected = self.target.parent / "token.tkn"
        self.protected.write_text("SYNTHETIC_CREDENTIAL_DO_NOT_READ")

    def call(self, mode="--apply", **extra):
        config = dict(mode=mode, home=str(self.home), **extra)
        return subprocess.run(["node", "-e", HARNESS, str(ROOT / "REPLACE_STATUS_HELPER.js"),
                               json.dumps(config), str(ROOT / "INSTALL_AURORA_TRIGGERCMD_BASE.sh")],
                              capture_output=True, text=True, timeout=20)

    def test_replace_preserves_backup_mode_and_unrelated_files(self):
        result = self.call()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("AURORA_STATUS_HELPER_REPLACED_OK", result.stdout)
        state = json.loads(self.state.read_text())
        self.assertEqual((self.support / state["backup"] / "original.sh").read_bytes(), self.original)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.protected.read_text(), "SYNTHETIC_CREDENTIAL_DO_NOT_READ")
        self.assertNotIn("SYNTHETIC_CREDENTIAL", result.stdout)

    def test_repeat_does_not_replace_backup_or_reset_log_baseline(self):
        self.assertEqual(self.call().returncode, 0)
        before = self.state.read_bytes()
        self.log.write_text(self.log.read_text() + "new line\n")
        result = self.call()
        self.assertIn("HELPER_ALREADY_REPLACED", result.stdout)
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(len(list(self.support.glob("status-helper-backup.*"))), 1)

    def test_failed_native_validation_restores_original(self):
        result = self.call(failNative=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ORIGINAL_RESTORED", result.stdout)
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertFalse(self.state.exists())
        self.assertFalse((self.support / ".status-helper-replacement.lock").exists())

    def test_explicit_rollback_restores_bytes_and_mode(self):
        self.assertEqual(self.call().returncode, 0)
        self.assertIn("HELPER_ROLLBACK_OK", self.call("--rollback").stdout)
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)

    def test_rollback_preserves_concurrent_edit(self):
        self.assertEqual(self.call().returncode, 0)
        self.target.write_text("subsequent local edit")
        result = self.call("--rollback")
        self.assertIn("ROLLBACK_TARGET_CHANGED", result.stdout)
        self.assertEqual(self.target.read_text(), "subsequent local edit")

    def test_symlink_is_not_followed(self):
        self.target.unlink()
        self.target.symlink_to(self.protected)
        self.assertIn("SYMLINK_REJECTED", self.call().stdout)
        self.assertFalse(self.support.exists())

    def test_lock_blocks_reentry(self):
        (self.support / ".status-helper-replacement.lock").mkdir(parents=True)
        self.assertIn("REPLACEMENT_BUSY", self.call().stdout)
        self.assertEqual(self.target.read_bytes(), self.original)

    def test_receipt_only_returns_allowed_new_status_fields(self):
        self.assertEqual(self.call().returncode, 0)
        with self.log.open("a") as f:
            f.write("PRIVATE_NEW_DATA secret=SYNTHETIC\n")
            f.write("output: JFN_MAC timestamp=2026-10-03T15:00:01Z host=iMac-de-Joao.local macOS=10.13.6 arch=x86_64 disco=19% triggercmd=PROCESS_PRESENT managed_pid=1337 REMOTE_CONNECTIVITY=UNKNOWN private=HIDDEN\n")
        result = self.call("--receipt")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("NEW_LOCAL_STATUS_RECORDS=1", result.stdout)
        for private in ("PRIVATE", "HIDDEN", "SYNTHETIC"):
            self.assertNotIn(private, result.stdout)
        self.assertIn("REQUIRES_DISPATCH_CORRELATION", result.stdout)

    def test_old_timestamp_is_not_new_receipt(self):
        self.assertEqual(self.call().returncode, 0)
        with self.log.open("a") as f:
            f.write("JFN_MAC timestamp=2026-10-03T14:59:59Z host=iMac-de-Joao.local macOS=10.13.6 arch=x86_64 disco=19% triggercmd=PROCESS_PRESENT managed_pid=1337 REMOTE_CONNECTIVITY=UNKNOWN\n")
        self.assertIn("NEW_LOCAL_STATUS_RECORDS=0", self.call("--receipt").stdout)

    def test_rotated_log_requires_review(self):
        self.assertEqual(self.call().returncode, 0)
        self.log.rename(self.log.with_suffix(".old"))
        self.log.write_text("rotated")
        self.assertIn("LOG_ROTATED_OR_TRUNCATED", self.call("--receipt").stdout)


if __name__ == "__main__":
    unittest.main()
