"""Offline regression tests. No real HOME, LaunchAgent, device or HTTP access.

The apply harness rewrites platform commands in a temporary copy only. These
tests do not prove compatibility with an actual High Sierra device.
"""
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "INSTALL_AURORA_TRIGGERCMD_BASE.sh"
SOURCE = SCRIPT.read_text()
REMOTE = "https://github.com/GESTAOWMGJ/automacao-gestao-wmgj.git"
NAMES = ["jfn_status_mac.sh", "aurora_nexus_status.sh",
         "aurora_nexus_sincronizar.sh", "restart_triggercmd_headless.sh", "commands.json"]


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, timeout=30, **kwargs)


def heredoc(name):
    match = re.search(r'cat > "\$STAGE/' + re.escape(name) + r'" <<\'EOF\'\n(.*?)\nEOF', SOURCE, re.S)
    assert match, name
    return match[1] + "\n"


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="aurora-imac-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.home = self.root / "account & <test> ' quoted"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.trace = self.root / "calls"
        self.env = dict(os.environ, AURORA_TEST_ROOT=str(self.home),
                        AURORA_TEST_TRACE=str(self.trace),
                        PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        self.data = self.home / ".TRIGGERcmdData"
        self.support = self.home / "Library/Application Support/AuroraNexus-iMac"
        self.plist = self.home / "Library/LaunchAgents/com.jfn.triggercmd.imac.plist"

    def stub(self, name, body):
        p = self.bin / name
        p.write_text("#!/bin/bash\n" + body + "\n")
        p.chmod(0o700)
        return str(p)

    def harness(self):
        node = self.home / "Applications/node16/bin/node"
        node.parent.mkdir(parents=True)
        node.write_text('#!/bin/bash\nif [ "$1" = -p ]; then echo "${AURORA_TEST_NODE_MAJOR:-16}"; exit 0; fi\nexec "' + shutil.which("node") + '" "$@"\n')
        node.chmod(0o700)
        agent = self.home / "Applications/TRIGGERcmd-headless/src/agent.js"
        agent.parent.mkdir(parents=True)
        agent.write_text("// inert fixture\n")
        self.data.mkdir()
        (self.data / "token.tkn").write_text("SYNTHETIC_NOT_A_CREDENTIAL")
        (self.data / "computerid.cfg").write_text("synthetic-device")
        self.stub("uname", "echo Darwin")
        self.stub("hostname", "echo authorized-imac")
        self.stub("pgrep", 'test -e "$AURORA_TEST_ROOT/agent-running"')
        self.stub("sleep", "exit 0")
        sysctl = self.stub("sysctl", "echo iMac-fixture")
        # Do not run an actual service manager, even on a macOS CI runner.
        launchctl = self.stub("launchctl", '''
echo "$1" >> "$AURORA_TEST_TRACE"
case "$1" in
  list) test -e "$AURORA_TEST_ROOT/loaded" ;;
  unload) /bin/rm -f "$AURORA_TEST_ROOT/loaded" "$AURORA_TEST_ROOT/agent-running" ;;
  load)
    if [ -e "$AURORA_TEST_ROOT/fail-load-once" ]; then
      /bin/rm "$AURORA_TEST_ROOT/fail-load-once"; exit 7
    fi
    touch "$AURORA_TEST_ROOT/loaded" "$AURORA_TEST_ROOT/agent-running" ;;
esac''')
        # Validate generated XML with stdlib; native plutil is also exercised on macOS.
        validator = self.root / "validate_plist.py"
        validator.write_text("import plistlib,sys\nwith open(sys.argv[1], 'rb') as f: plistlib.load(f)\n")
        py = shutil.which("python3")
        native = '/usr/bin/plutil -lint "$2"\n' if os.uname().sysname == "Darwin" else ""
        plutil = self.stub("plutil", native + f'"{py}" "{validator}" "$2"')
        text = SOURCE.replace('HOME_DIR="$HOME"', 'HOME_DIR="$AURORA_TEST_ROOT"')
        text = text.replace("/usr/sbin/sysctl", sysctl).replace("/bin/launchctl", launchctl)
        text = text.replace("/usr/bin/plutil", plutil)
        self.fixture = self.root / "bootstrap.sh"
        self.fixture.write_text(text)
        return self.fixture

    def apply(self, **kwargs):
        return run(["bash", str(self.fixture), "--apply", "--confirm-host", "authorized-imac"],
                   env=self.env, **kwargs)

    def test_shell_syntax_and_generated_helpers(self):
        self.assertEqual(run(["bash", "-n", str(SCRIPT)]).returncode, 0)
        for name in NAMES[:-1]:
            result = run(["bash", "-n"], input=heredoc(name))
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_default_and_dry_run_have_no_side_effects(self):
        fixture = self.harness()
        before = sorted(str(p.relative_to(self.home)) for p in self.home.rglob("*"))
        for args in ([], ["--dry-run"]):
            result = run(["bash", str(fixture)] + args, env=self.env)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("writes=NO network=NO restart=NO", result.stdout)
        self.assertFalse(self.trace.exists())
        self.assertEqual(before, sorted(str(p.relative_to(self.home)) for p in self.home.rglob("*")))

    def test_invalid_mode_and_missing_or_wrong_confirmation(self):
        fixture = self.harness()
        for args in (["--unknown"], ["--apply"], ["--apply", "--confirm-host", "other-host"],
                     ["--dry-run", "unexpected"]):
            self.assertNotEqual(run(["bash", str(fixture)] + args, env=self.env).returncode, 0)
        self.assertFalse(self.support.exists())

    def test_native_preflight_has_no_writes_or_service_calls(self):
        fixture = self.harness()
        before = sorted(str(p.relative_to(self.home)) for p in self.home.rglob("*"))
        result = run(["bash", str(fixture), "--preflight", "--confirm-host", "authorized-imac"], env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("AURORA_IMAC_NATIVE_PREFLIGHT_OK", result.stdout)
        self.assertIn("REMOTE_CONNECTIVITY=UNKNOWN", result.stdout)
        self.assertEqual(self.trace.read_text().splitlines(), ["list"])
        self.assertEqual(before, sorted(str(p.relative_to(self.home)) for p in self.home.rglob("*")))
        self.assertNotIn("SYNTHETIC_NOT_A_CREDENTIAL", result.stdout + result.stderr)

    def test_wrong_node_major_blocks_before_any_write(self):
        self.harness()
        self.env["AURORA_TEST_NODE_MAJOR"] = "22"
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ERRO_NODE16_OBRIGATORIO", result.stderr)
        self.assertFalse(self.support.exists())
        self.assertFalse(self.trace.exists())

    def test_apply_preserves_commands_and_validates_escaped_plist(self):
        self.harness()
        original = [{"trigger": "Unrelated", "command": "do-not-change"},
                    {"trigger": "JFN Status Mac", "command": "old"}]
        (self.data / "commands.json").write_text(json.dumps(original))
        result = self.apply()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = json.loads((self.data / "commands.json").read_text())
        self.assertIn(original[0], commands)
        self.assertEqual(sum(c["trigger"] == "JFN Status Mac" for c in commands), 1)
        status = next(c for c in commands if c["trigger"] == "JFN Status Mac")
        # Without this provider placeholder, MCP only acknowledges dispatch.
        self.assertEqual(status["voiceReply"], "{{result}}")
        with self.plist.open("rb") as f:
            plist = plistlib.load(f)
        self.assertEqual(plist["ProgramArguments"][0], str(self.home / "Applications/node16/bin/node"))
        self.assertIn("REMOTE_CONNECTIVITY=UNKNOWN", result.stdout)
        self.assertNotIn("SYNTHETIC_NOT_A_CREDENTIAL", result.stdout + result.stderr)
        self.assertEqual((self.data / "commands.json").stat().st_mode & 0o777, 0o600)
        backup = next(self.support.glob("backup.*"))
        self.assertEqual(json.loads((backup / "4.original").read_text()), original)
        self.assertFalse((backup / "token.tkn").exists())

    def test_second_apply_is_idempotent(self):
        self.harness()
        self.assertEqual(self.apply().returncode, 0)
        targets = [self.data / n for n in NAMES] + [self.plist]
        before = [p.read_bytes() for p in targets]
        result = self.apply()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(before, [p.read_bytes() for p in targets])

    def test_invalid_commands_fails_before_install_and_is_sanitized(self):
        self.harness()
        (self.data / "commands.json").write_text("SYNTHETIC_PRIVATE_BAD_JSON")
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("SYNTHETIC_PRIVATE_BAD_JSON", result.stdout + result.stderr)
        self.assertFalse(self.plist.exists())
        self.assertEqual(self.trace.read_text().splitlines(), ["list"])

    def test_concurrent_commands_edit_is_preserved(self):
        self.harness()
        (self.data / "commands.json").write_text("[]")
        validator = self.bin / "plutil"
        with validator.open("a") as f:
            f.write("printf '[]\\n' > \"$AURORA_TEST_ROOT/.TRIGGERcmdData/commands.json\"\n")
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ERRO_COMMANDS_ALTERADO_DURANTE_PREPARO", result.stderr)
        self.assertEqual((self.data / "commands.json").read_text(), "[]\n")
        self.assertFalse(self.plist.exists())

    def test_existing_lock_blocks_reentry(self):
        self.harness()
        (self.support / ".bootstrap.lock").mkdir(parents=True)
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ERRO_BOOTSTRAP_EM_EXECUCAO", result.stderr)
        self.assertFalse(self.plist.exists())

    def test_missing_prerequisite_creates_no_operational_files(self):
        self.harness()
        (self.data / "computerid.cfg").unlink()
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.support.exists())

    def test_symlink_target_is_rejected_before_write(self):
        self.harness()
        outside = self.root / "unrelated.json"
        outside.write_text("unchanged")
        (self.data / "commands.json").symlink_to(outside)
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(outside.read_text(), "unchanged")
        self.assertFalse(self.support.exists())

    def test_unmanaged_agent_is_not_killed(self):
        self.harness()
        (self.home / "agent-running").touch()
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ERRO_AGENTE_NAO_GERENCIADO", result.stderr)
        self.assertTrue((self.home / "agent-running").exists())

    def test_failed_first_load_restores_absent_files(self):
        self.harness()
        (self.home / "fail-load-once").touch()
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ROLLBACK_FILES_OK=1", result.stderr)
        self.assertFalse(self.plist.exists())
        for name in NAMES:
            self.assertFalse((self.data / name).exists())
        self.assertTrue((self.data / "token.tkn").exists())
        self.assertFalse((self.support / ".bootstrap.lock").exists())

    def test_failed_upgrade_restores_original_files_and_loaded_agent(self):
        self.harness()
        self.assertEqual(self.apply().returncode, 0)
        targets = [self.data / n for n in NAMES] + [self.plist]
        (self.data / "jfn_status_mac.sh").write_text("#!/bin/bash\necho ORIGINAL\n")
        before = [p.read_bytes() for p in targets]
        (self.home / "fail-load-once").touch()
        result = self.apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ROLLBACK_FILES_OK=1", result.stderr)
        self.assertEqual(before, [p.read_bytes() for p in targets])
        self.assertTrue((self.home / "loaded").exists())

    def test_no_destructive_sync_or_raw_log_dump(self):
        sync = heredoc("aurora_nexus_sincronizar.sh")
        self.assertNotIn("reset --hard", sync)
        self.assertNotIn("rm -rf", sync)
        self.assertNotIn("pkill", SOURCE)
        self.assertNotIn("tail -", SOURCE)


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="aurora-mirror-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.remote = self.root / "remote.git"
        self.seed = self.root / "seed"
        self.home = self.root / "isolated-home"
        self.home.mkdir()
        self.repo = self.home / "Library/Application Support/AuroraNexus-iMac/repo"
        self.env = dict(os.environ, AURORA_TEST_ROOT=str(self.home), GIT_CONFIG_NOSYSTEM="1",
                        GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT="0")
        for key in list(self.env):
            if key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "TCMD_COMPUTER_ID"):
                self.env.pop(key)
        self.git("init", "--bare", str(self.remote))
        self.git("init", "-b", "main", str(self.seed))
        self.git("-C", str(self.seed), "config", "user.name", "Fixture")
        self.git("-C", str(self.seed), "config", "user.email", "fixture@example.invalid")
        (self.seed / "file").write_text("one")
        self.git("-C", str(self.seed), "add", ".")
        self.git("-C", str(self.seed), "commit", "-m", "fixture")
        self.git("-C", str(self.seed), "remote", "add", "origin", str(self.remote))
        self.git("-C", str(self.seed), "push", "origin", "main")
        self.script = self.root / "sync.sh"
        self.script.write_text(heredoc("aurora_nexus_sincronizar.sh")
                               .replace("$HOME", "$AURORA_TEST_ROOT").replace(REMOTE, str(self.remote)))

    def git(self, *args):
        result = run(["git"] + list(args), env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def sync(self):
        return run(["bash", str(self.script)], env=self.env)

    def test_clone_and_fast_forward_without_network(self):
        self.assertEqual(self.sync().returncode, 0)
        (self.seed / "file").write_text("two")
        self.git("-C", str(self.seed), "commit", "-am", "advance")
        self.git("-C", str(self.seed), "push", "origin", "main")
        result = self.sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / "file").read_text(), "two")

    def test_non_repository_is_preserved(self):
        self.repo.mkdir(parents=True)
        (self.repo / "important").write_text("preserve")
        self.assertNotEqual(self.sync().returncode, 0)
        self.assertEqual((self.repo / "important").read_text(), "preserve")

    def test_dirty_tracked_and_untracked_files_are_preserved(self):
        self.assertEqual(self.sync().returncode, 0)
        (self.repo / "file").write_text("local edit")
        (self.repo / "untracked").write_text("local note")
        result = self.sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ERRO_MIRROR_ALTERACOES_LOCAIS", result.stderr)
        self.assertEqual((self.repo / "file").read_text(), "local edit")
        self.assertTrue((self.repo / "untracked").exists())

    def test_ignored_files_also_block_sync(self):
        self.assertEqual(self.sync().returncode, 0)
        with (self.repo / ".git/info/exclude").open("a") as f:
            f.write("\nprivate-file\n")
        (self.repo / "private-file").write_text("synthetic private")
        self.assertNotEqual(self.sync().returncode, 0)
        self.assertTrue((self.repo / "private-file").exists())

    def test_local_commit_is_not_discarded(self):
        self.assertEqual(self.sync().returncode, 0)
        self.git("-C", str(self.repo), "config", "user.name", "Fixture")
        self.git("-C", str(self.repo), "config", "user.email", "fixture@example.invalid")
        (self.repo / "file").write_text("local commit")
        self.git("-C", str(self.repo), "commit", "-am", "local")
        before = self.git("-C", str(self.repo), "rev-parse", "HEAD")
        self.assertNotEqual(self.sync().returncode, 0)
        self.assertEqual(before, self.git("-C", str(self.repo), "rev-parse", "HEAD"))

    def test_foreign_remote_and_branch_are_rejected(self):
        self.assertEqual(self.sync().returncode, 0)
        self.git("-C", str(self.repo), "remote", "set-url", "origin", str(self.root / "other.git"))
        self.assertIn("ERRO_MIRROR_ORIGIN", self.sync().stderr)
        self.git("-C", str(self.repo), "remote", "set-url", "origin", str(self.remote))
        self.git("-C", str(self.repo), "checkout", "-b", "local-branch")
        self.assertIn("ERRO_MIRROR_BRANCH", self.sync().stderr)

    def test_symlink_is_rejected(self):
        self.repo.parent.mkdir(parents=True)
        self.repo.symlink_to(self.seed, target_is_directory=True)
        self.assertIn("ERRO_MIRROR_SYMLINK", self.sync().stderr)

    def test_symlink_ancestor_is_rejected(self):
        outside = self.root / "unrelated"
        outside.mkdir()
        (self.home / "Library").symlink_to(outside, target_is_directory=True)
        self.assertIn("ERRO_MIRROR_SYMLINK", self.sync().stderr)
        self.assertEqual(list(outside.iterdir()), [])

    def test_mirror_lock_blocks_reentry(self):
        self.repo.parent.mkdir(parents=True)
        (self.repo.parent / ".mirror.lock").mkdir()
        self.assertIn("ERRO_MIRROR_LOCK", self.sync().stderr)
        self.assertFalse(self.repo.exists())


if __name__ == "__main__":
    unittest.main()
