"""Exercise orchestration in synthetic accounts, never real launchctl or network."""
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r'''
const fs = require("fs"), path = require("path");
const {exercise, FILES} = require(process.argv[1]);
const c = JSON.parse(process.argv[2]), installer = process.argv[3];
let source = fs.readFileSync(installer), applied = 0, loaded = c.initialLoaded !== false, pid = 1337;
const targets = FILES.map(f => path.join(c.home, f));
const support = path.join(c.home, "Library/Application Support/AuroraNexus-iMac");
const messages = [], calls = [];
const exec = (file, args) => {
  calls.push(path.basename(file) + " " + args.join(" "));
  const ok = stdout => ({status: 0, stdout, stderr: ""});
  if (file === "/bin/bash") {
    if (args.includes("--preflight")) return ok("AURORA_IMAC_NATIVE_PREFLIGHT_OK");
    applied++;
    if ((c.scenario === "first-fail" && applied === 1) ||
        (c.scenario === "second-fail" && applied === 2)) return {status: 5, stdout: "", stderr: "PRIVATE_FAILURE"};
    for (let i = 1; i < targets.length; i++) {
      fs.mkdirSync(path.dirname(targets[i]), {recursive: true});
      fs.writeFileSync(targets[i], "installed " + i + "\n");
      fs.chmodSync(targets[i], i < 4 ? 0o700 : 0o600);
    }
    pid++;
    if (applied === 2 && c.scenario === "concurrent") fs.writeFileSync(targets[1], "CONCURRENT_EDIT");
    if (applied === 2 && c.scenario === "bad-backup") {
      const dir = fs.readdirSync(support).find(x => x.startsWith("native-bootstrap-test."));
      fs.writeFileSync(path.join(support, dir, "0.before"), "CORRUPTED");
    }
    return {status: 0, stdout: "PRIVATE_APPLY_OUTPUT", stderr: ""};
  }
  if (file === "/bin/launchctl") {
    if (args[0] === "list") return ok(loaded ? pid + " 0 com.jfn.triggercmd.imac\n" : "");
    if (args[0] === "unload") {
      if (c.scenario === "unload-fail") return {status: 9, stdout: "", stderr: "PRIVATE_ERROR"};
      loaded = false; return ok("");
    }
    if (c.scenario === "reload-fail") return {status: 9, stdout: "", stderr: "PRIVATE_ERROR"};
    loaded = true; pid++; return ok("");
  }
  if (file === "/bin/ps") return loaded ? ok(args[3] === "comm=" ? path.join(c.home, "Applications/node16/bin/node") : "S") : {status: 1, stdout: "", stderr: ""};
  if (file === "/usr/bin/plutil") return ok(JSON.stringify({Label: c.scenario === "wrong-label" ? "another.service" : "com.jfn.triggercmd.imac"}));
  if (file === "/bin/sleep") return ok("");
  throw new Error("UNEXPECTED_COMMAND");
};
if (c.scenario === "bad-source") source = Buffer.concat([source, Buffer.from("\n# unexpected\n")]);
try {
  exercise({home: c.home, installer, source, exec, mode: c.mode || "--exercise",
    recovery: c.recovery, emit: x => messages.push(x)});
} catch (e) { messages.push("ERROR=" + e.message); process.exitCode = 1; }
console.log(JSON.stringify({messages, calls, applied, loaded}));
'''


class NativeBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="native-bootstrap-fixture-")
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve() / "synthetic account"
        self.paths = [self.home / ".TRIGGERcmdData" / name for name in
                      ["jfn_status_mac.sh", "aurora_nexus_status.sh", "aurora_nexus_sincronizar.sh",
                       "restart_triggercmd_headless.sh", "commands.json"]]
        self.paths.append(self.home / "Library/LaunchAgents/com.jfn.triggercmd.imac.plist")
        source = (ROOT / "INSTALL_AURORA_TRIGGERCMD_BASE.sh").read_text()
        helper = re.search(r'cat > "\$STAGE/jfn_status_mac.sh" <<\'EOF\'\n(.*?)\nEOF', source, re.S).group(1) + "\n"
        for i, p in enumerate(self.paths):
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(helper if i == 0 else "original " + str(i) + "\n")
            p.chmod(0o700 if i < 4 else 0o600)
        self.before = [(p.read_bytes(), p.stat().st_mode & 0o777) for p in self.paths]
        self.token = self.paths[0].parent / "token.tkn"
        self.token.write_text("SYNTHETIC_CREDENTIAL_UNTOUCHED")
        self.support = self.home / "Library/Application Support/AuroraNexus-iMac"

    def call(self, **options):
        result = subprocess.run(["node", "-e", HARNESS, str(ROOT / "TEST_NATIVE_BOOTSTRAP.js"),
                                 json.dumps(dict(home=str(self.home), **options)),
                                 str(ROOT / "INSTALL_AURORA_TRIGGERCMD_BASE.sh")],
                                capture_output=True, text=True, timeout=20)
        self.assertTrue(result.stdout.strip(), result.stderr)
        return result.returncode, json.loads(result.stdout)

    def assert_baseline(self):
        self.assertEqual([(p.read_bytes(), p.stat().st_mode & 0o777) for p in self.paths], self.before)
        self.assertEqual(self.token.read_text(), "SYNTHETIC_CREDENTIAL_UNTOUCHED")

    def test_two_applies_restore_all_bytes_modes_and_service(self):
        rc, result = self.call()
        self.assertEqual(rc, 0, result)
        self.assertEqual(result["applied"], 2)
        self.assertTrue(result["loaded"])
        self.assert_baseline()
        text = "\n".join(result["messages"])
        self.assertIn("AURORA_NATIVE_BOOTSTRAP_ROLLBACK_OK", text)
        self.assertIn("BASELINE_RESTORED_OK", text)
        self.assertNotIn("PRIVATE", text)
        self.assertNotIn("SYNTHETIC_CREDENTIAL", text)
        record = json.loads(next(self.support.glob("native-bootstrap-test.*/record.json")).read_text())
        self.assertEqual(record["phase"], "RESTORED")

    def test_failed_first_apply_never_reports_success(self):
        rc, result = self.call(scenario="first-fail")
        self.assertNotEqual(rc, 0)
        self.assert_baseline()
        self.assertIn("BASELINE_ALREADY_RESTORED", result["messages"])
        self.assertNotIn("AURORA_NATIVE_BOOTSTRAP_ROLLBACK_OK", result["messages"])

    def test_failed_second_apply_restores_starting_baseline(self):
        rc, result = self.call(scenario="second-fail")
        self.assertNotEqual(rc, 0)
        self.assert_baseline()
        self.assertTrue(any("BASELINE_RESTORED_OK" in s for s in result["messages"]))

    def test_concurrent_edit_blocks_restore_before_service_stop(self):
        rc, result = self.call(scenario="concurrent")
        self.assertNotEqual(rc, 0)
        self.assertEqual(self.paths[1].read_text(), "CONCURRENT_EDIT")
        self.assertFalse(any(c.startswith("launchctl unload") for c in result["calls"]))
        self.assertIn("ERROR=RESTORE_BLOCKED_CONCURRENT_CHANGE", result["messages"])

    def test_corrupt_backup_blocks_restore_before_service_stop(self):
        rc, result = self.call(scenario="bad-backup")
        self.assertNotEqual(rc, 0)
        self.assertFalse(any(c.startswith("launchctl unload") for c in result["calls"]))
        self.assertIn("ERROR=BASELINE_BACKUP_INVALID", result["messages"])

    def test_failed_unload_can_be_recovered_from_record(self):
        rc, result = self.call(scenario="unload-fail")
        self.assertNotEqual(rc, 0)
        self.assertTrue(result["loaded"])
        backup = next(self.support.glob("native-bootstrap-test.*"))
        rc, result = self.call(mode="--restore", recovery=str(backup))
        self.assertEqual(rc, 0, result)
        self.assert_baseline()

    def test_originally_absent_file_is_preserved_in_recovery_directory(self):
        self.paths[2].unlink()
        rc, result = self.call()
        self.assertEqual(rc, 0, result)
        self.assertFalse(self.paths[2].exists())
        self.assertEqual(next(self.support.glob("native-bootstrap-test.*/2.removed")).read_text(), "installed 2\n")

    def test_restored_files_without_service_are_not_success_and_can_recover(self):
        rc, result = self.call(scenario="reload-fail")
        self.assertNotEqual(rc, 0)
        self.assertFalse(result["loaded"])
        self.assert_baseline()
        self.assertIn("ERROR=RESTORE_LOAD_FAILED", result["messages"])
        self.assertNotIn("AURORA_NATIVE_BOOTSTRAP_ROLLBACK_OK", result["messages"])
        backup = next(self.support.glob("native-bootstrap-test.*"))
        rc, result = self.call(mode="--restore", recovery=str(backup), initialLoaded=False)
        self.assertEqual(rc, 0, result)
        self.assertTrue(result["loaded"])

    def test_unreviewed_source_cannot_start_exercise(self):
        rc, result = self.call(scenario="bad-source")
        self.assertNotEqual(rc, 0)
        self.assertEqual(result["calls"], [])
        self.assertFalse(self.support.exists())
        self.assert_baseline()

    def test_symlink_target_is_not_followed(self):
        self.paths[1].unlink()
        self.paths[1].symlink_to(self.token)
        rc, result = self.call()
        self.assertNotEqual(rc, 0)
        self.assertEqual(result["calls"], [])
        self.assertEqual(self.token.read_text(), "SYNTHETIC_CREDENTIAL_UNTOUCHED")

    def test_foreign_plist_label_blocks_before_apply(self):
        rc, result = self.call(scenario="wrong-label")
        self.assertNotEqual(rc, 0)
        self.assertEqual(result["applied"], 0)
        self.assert_baseline()


if __name__ == "__main__":
    unittest.main()
