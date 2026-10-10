"""Exercise the generated status helper with no service, network or secret access."""
import os
from pathlib import Path
import shlex
import tempfile
import unittest
from test_bootstrap import heredoc, run


class StatusProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="aurora-status-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / "account with spaces"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ, HOME=str(self.home),
                        PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        self.env.pop("TCMD_COMPUTER_ID", None)
        self.stub("hostname", "echo fixture-imac")
        self.stub("sw_vers", "echo 10.13.6")
        self.stub("uname", "echo x86_64")
        self.stub("df", "printf 'Filesystem Used\nfixture 19%%\n'")
        self.launchctl = self.stub("launchctl", "exit 1")
        self.ps = self.stub("ps", "exit 1")
        self.script = self.root / "status.sh"
        self.script.write_text(heredoc("jfn_status_mac.sh")
                               .replace("/bin/launchctl", shlex.quote(str(self.launchctl)))
                               .replace("/bin/ps", shlex.quote(str(self.ps))))

    def stub(self, name, body):
        p = self.bin / name
        p.write_text("#!/bin/bash\n" + body + "\n")
        p.chmod(0o700)
        return p

    def service(self, pid="1337", executable=None, state="S", label="com.jfn.triggercmd.imac"):
        self.stub("launchctl", "printf '%s\\n' " + shlex.quote("PID Status Label\n" + pid + " 0 " + label))
        executable = executable or str(self.home / "Applications/node16/bin/node")
        self.stub("ps", 'test "$1" = -p && test "$2" = 1337 || exit 2\n'
                  'case "$4" in\ncomm=) printf "%s\\n" ' + shlex.quote(executable) +
                  ' ;;\nstat=) printf "%s\\n" ' + shlex.quote(state) + ' ;;\nesac')

    def status(self, expected):
        result = run(["bash", str(self.script)], env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("triggercmd=" + expected, result.stdout)
        self.assertIn("REMOTE_CONNECTIVITY=UNKNOWN", result.stdout)
        self.assertRegex(result.stdout, r"timestamp=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
        self.assertNotIn("OFFLINE", result.stdout)
        self.assertNotIn("ONLINE", result.stdout)
        self.assertNotIn(str(self.home), result.stdout)
        return result.stdout

    def test_node_managed_pid_without_any_console_argv(self):
        # Same observation as shell exec Node on the native iMac: argv is never read.
        self.service()
        self.assertIn("managed_pid=1337", self.status("PROCESS_PRESENT"))

    def test_direct_node_launch_has_same_result(self):
        self.service(state="S+")
        self.status("PROCESS_PRESENT")

    def test_shell_wrapper_without_verified_node_is_unknown(self):
        self.service(executable="/bin/bash")
        self.status("PROCESS_UNKNOWN")

    def test_unrelated_node_or_reused_pid_is_not_accepted(self):
        self.service(executable="/usr/local/bin/node")
        self.status("PROCESS_UNKNOWN")

    def test_loaded_service_without_pid_is_absent(self):
        self.service(pid="-")
        self.status("PROCESS_ABSENT")

    def test_other_service_does_not_count(self):
        self.service(label="com.jfn.triggercmd.imac.other")
        self.status("PROCESS_ABSENT")

    def test_launchctl_failure_does_not_mean_offline(self):
        self.status("PROCESS_UNKNOWN")

    def test_process_disappears_or_ps_denied_is_unknown(self):
        self.service()
        self.stub("ps", "exit 1")
        self.status("PROCESS_UNKNOWN")

    def test_zombie_is_not_present(self):
        self.service(state="Z")
        self.status("PROCESS_ABSENT")

    def test_empty_ps_state_is_unknown(self):
        self.service(state="")
        self.status("PROCESS_UNKNOWN")

    def test_invalid_pid_never_passed_to_ps(self):
        self.service(pid="bad-private-value")
        self.stub("ps", "echo SHOULD_NOT_RUN >&2; exit 99")
        self.assertNotIn("bad-private-value", self.status("PROCESS_UNKNOWN"))

    def test_duplicate_service_rows_are_unknown(self):
        self.stub("launchctl", "printf 'PID Status Label\\n1337 0 com.jfn.triggercmd.imac\\n1338 0 com.jfn.triggercmd.imac\\n'")
        self.status("PROCESS_UNKNOWN")


if __name__ == "__main__":
    unittest.main()
