#!/usr/bin/env node
"use strict";
// Authorized High Sierra exercise: apply twice, then restore the starting state.
// The CLI never accepts a fixture host, runtime, executable or arbitrary command.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const SOURCE_BLOB = "1e18e6b0b8b20bcec3c19a72ee36df2967ce81ef";
const HELPER_HASH = "2b297b67682fae05e8128e5051a18ac52c5217d116357d0ae387d72ee73d6b5f";
const LABEL = "com.jfn.triggercmd.imac";
const FILES = [".TRIGGERcmdData/jfn_status_mac.sh", ".TRIGGERcmdData/aurora_nexus_status.sh",
  ".TRIGGERcmdData/aurora_nexus_sincronizar.sh", ".TRIGGERcmdData/restart_triggercmd_headless.sh",
  ".TRIGGERcmdData/commands.json", "Library/LaunchAgents/com.jfn.triggercmd.imac.plist"];
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
const fail = code => { throw new Error(code); };
function safe(p) {
  for (let q = path.resolve(p); ; q = path.dirname(q)) {
    try { if (fs.lstatSync(q).isSymbolicLink()) fail("SYMLINK_REJECTED"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    if (path.dirname(q) === q) break;
  }
}
function inspect(p) {
  safe(p);
  let st;
  try { st = fs.statSync(p); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o7000)) fail("FILE_OWNER_OR_MODE_INVALID");
  const bytes = fs.readFileSync(p);
  return {hash: digest(bytes), mode: st.mode & 0o777, bytes};
}
const same = (a, b) => a === null || b === null ? a === b : a.hash === b.hash && a.mode === b.mode;
function privateWrite(p, bytes) { fs.writeFileSync(p, bytes, {flag: "wx", mode: 0o600}); }
function managedPid(home, exec) {
  const r = exec("/bin/launchctl", ["list"]);
  if (r.status !== 0) return null;
  const rows = r.stdout.trim().split(/\r?\n/).map(x => x.trim().split(/\s+/)).filter(x => x[2] === LABEL);
  if (rows.length !== 1 || !/^[1-9][0-9]*$/.test(rows[0][0])) return null;
  const pid = rows[0][0], comm = exec("/bin/ps", ["-p", pid, "-o", "comm="]), state = exec("/bin/ps", ["-p", pid, "-o", "stat="]);
  return comm.status === 0 && state.status === 0 &&
    comm.stdout.trim() === path.join(home, "Applications/node16/bin/node") &&
    state.stdout.trim() && !state.stdout.trim().startsWith("Z") ? pid : null;
}
function waitManaged(home, exec) {
  for (let i = 0; i < 10; i++) {
    const pid = managedPid(home, exec);
    if (pid) return pid;
    exec("/bin/sleep", ["1"]);
  }
  fail("MANAGED_NODE_NOT_READY");
}
function validatePlist(p, exec) {
  const r = exec("/usr/bin/plutil", ["-convert", "json", "-o", "-", p]);
  let obj;
  try { obj = JSON.parse(r.stdout); } catch (_) { fail("BASELINE_PLIST_INVALID"); }
  if (r.status !== 0 || obj.Label !== LABEL) fail("BASELINE_PLIST_LABEL_INVALID");
}
function exercise({home, installer, source, exec, mode = "--exercise", recovery, emit = console.log}) {
  const blob = crypto.createHash("sha1").update("blob " + source.length + "\0").update(source).digest("hex");
  if (blob !== SOURCE_BLOB) fail("REVIEWED_INSTALLER_REQUIRED");
  if (!["--exercise", "--restore"].includes(mode)) fail("INVALID_MODE");
  const targets = FILES.map(f => path.join(home, f));
  const support = path.join(home, "Library/Application Support/AuroraNexus-iMac");
  safe(support); targets.forEach(safe);
  fs.mkdirSync(support, {recursive: true, mode: 0o700});
  const lock = path.join(support, ".native-bootstrap-test.lock");
  try { fs.mkdirSync(lock, {mode: 0o700}); } catch (_) { fail("NATIVE_TEST_BUSY_OR_STALE_LOCK"); }
  let runDir, record;
  const journal = () => {
    const p = path.join(runDir, "record.json"), tmp = p + ".tmp-" + crypto.randomBytes(6).toString("hex");
    privateWrite(tmp, JSON.stringify(record, null, 2) + "\n"); fs.renameSync(tmp, p);
  };
  const snapshot = (name) => targets.map((p, i) => {
    const s = inspect(p);
    if (!s) return null;
    const dest = path.join(runDir, i + "." + name);
    privateWrite(dest, s.bytes);
    if (digest(fs.readFileSync(dest)) !== s.hash) fail("SNAPSHOT_VERIFY_FAILED");
    return {hash: s.hash, mode: s.mode};
  });
  const matches = entries => targets.every((p, i) => same(inspect(p), entries[i]));
  const noBootstrap = () => {
    safe(path.join(support, ".bootstrap.lock"));
    if (fs.existsSync(path.join(support, ".bootstrap.lock"))) fail("BOOTSTRAP_BUSY_OR_STALE_LOCK");
  };
  const restore = () => {
    noBootstrap();
    // Validate every backup and every target before stopping the service.
    const originals = record.before.map((s, i) => {
      if (!s) return null;
      const b = inspect(path.join(runDir, i + ".before"));
      if (!b || b.hash !== s.hash) fail("BASELINE_BACKUP_INVALID");
      return b.bytes;
    });
    const unchanged = () => targets.forEach((p, i) => {
      const current = inspect(p);
      if (!same(current, record.before[i]) &&
          !(record.installed && same(current, record.installed[i]))) fail("RESTORE_BLOCKED_CONCURRENT_CHANGE");
    });
    unchanged();
    validatePlist(path.join(runDir, "5.before"), exec);
    if (matches(record.before)) {
      if (!managedPid(home, exec)) {
        const services = exec("/bin/launchctl", ["list"]);
        if (services.status !== 0) fail("SERVICE_STATE_UNKNOWN");
        const listed = services.stdout.split(/\r?\n/).some(x => x.trim().split(/\s+/)[2] === LABEL);
        if (!listed && exec("/bin/launchctl", ["load", targets[5]]).status !== 0) fail("RESTORE_LOAD_FAILED");
      }
      const pid = waitManaged(home, exec);
      record.phase = "RESTORED"; journal(); emit("BASELINE_ALREADY_RESTORED");
      emit("BASELINE_RESTORED_MANAGED_PID=" + pid); return;
    }
    if (!record.installed) fail("NO_INSTALLED_SNAPSHOT_REVIEW_BOOTSTRAP_BACKUP");
    record.phase = "RESTORING"; journal();
    const oldPid = managedPid(home, exec);
    if (exec("/bin/launchctl", ["unload", targets[5]]).status !== 0) fail("RESTORE_UNLOAD_FAILED");
    const stopped = exec("/bin/launchctl", ["list"]);
    if (stopped.status !== 0 || stopped.stdout.split(/\r?\n/).some(x => x.trim().split(/\s+/)[2] === LABEL)) fail("RESTORE_SERVICE_STILL_LOADED");
    if (oldPid) {
      let running;
      for (let i = 0; i < 5; i++) {
        const state = exec("/bin/ps", ["-p", oldPid, "-o", "stat="]);
        running = state.status === 0 && state.stdout.trim() && !state.stdout.trim().startsWith("Z");
        if (!running) break;
        exec("/bin/sleep", ["1"]);
      }
      if (running) fail("RESTORE_PROCESS_STILL_RUNNING");
    }
    unchanged();
    for (let i = 0; i < targets.length; i++) {
      if (originals[i] === null) {
        if (inspect(targets[i])) fs.renameSync(targets[i], path.join(runDir, i + ".removed"));
      } else {
        const tmp = targets[i] + ".native-restore-" + crypto.randomBytes(6).toString("hex");
        privateWrite(tmp, originals[i]); fs.chmodSync(tmp, record.before[i].mode);
        fs.renameSync(tmp, targets[i]);
      }
    }
    if (!matches(record.before)) fail("RESTORE_FILES_VERIFY_FAILED");
    if (exec("/bin/launchctl", ["load", targets[5]]).status !== 0) fail("RESTORE_LOAD_FAILED");
    const pid = waitManaged(home, exec);
    record.phase = "RESTORED"; record.restoredAt = new Date().toISOString(); journal();
    emit("BASELINE_RESTORED_OK files=6 bytes=IDENTICAL modes=IDENTICAL managed_pid=" + pid);
  };
  try {
    noBootstrap();
    if (mode === "--restore") {
      runDir = path.resolve(recovery || ""); safe(runDir);
      if (path.dirname(runDir) !== support || !/^native-bootstrap-test\.[A-Za-z0-9]+$/.test(path.basename(runDir))) fail("RECOVERY_PATH_INVALID");
      const file = inspect(path.join(runDir, "record.json"));
      if (!file) fail("RECOVERY_RECORD_MISSING");
      record = JSON.parse(file.bytes.toString("utf8"));
      const valid = list => Array.isArray(list) && list.length === 6 && list.every(s => s === null ||
        (s && /^[a-f0-9]{64}$/.test(s.hash) && Number.isInteger(s.mode) && s.mode >= 0 && s.mode <= 0o777));
      if (record.version !== 1 || record.sourceBlob !== SOURCE_BLOB || !valid(record.before) ||
          !record.before[5] || (record.installed !== null && !valid(record.installed))) fail("RECOVERY_RECORD_INVALID");
      restore(); return;
    }
    if (!managedPid(home, exec)) fail("WORKING_MANAGED_BASELINE_REQUIRED");
    if (inspect(targets[0])?.hash !== HELPER_HASH || !inspect(targets[5])) fail("VALIDATED_BASELINE_REQUIRED");
    validatePlist(targets[5], exec);
    const preflight = exec("/bin/bash", [installer, "--preflight", "--confirm-host", "iMac-de-Joao.local"]);
    if (preflight.status !== 0 || !preflight.stdout.includes("AURORA_IMAC_NATIVE_PREFLIGHT_OK")) fail("NATIVE_PREFLIGHT_FAILED");
    runDir = fs.mkdtempSync(path.join(support, "native-bootstrap-test.")); fs.chmodSync(runDir, 0o700);
    emit("NATIVE_BACKUP=" + runDir);
    record = {version: 1, sourceBlob: SOURCE_BLOB, phase: "PREPARED", before: snapshot("before"), installed: null}; journal();
    let failure;
    try {
      for (let n = 1; n <= 2; n++) {
        if (n === 1 && !matches(record.before)) fail("BASELINE_CHANGED_BEFORE_APPLY");
        if (n === 2 && !matches(record.installed)) fail("BASELINE_CHANGED_BEFORE_REPEAT");
        const result = exec("/bin/bash", [installer, "--apply", "--confirm-host", "iMac-de-Joao.local"]);
        privateWrite(path.join(runDir, "apply-" + n + ".log"), (result.stdout || "") + (result.stderr || ""));
        emit("BOOTSTRAP_APPLY_" + n + "_EXIT_CODE=" + (result.status === null ? "UNKNOWN" : result.status));
        if (result.status !== 0) fail("BOOTSTRAP_APPLY_FAILED");
        if (n === 1) {
          record.installed = snapshot("installed");
          if (record.installed.some(s => s === null)) fail("INSTALLED_FILE_MISSING");
          record.phase = "INSTALLED"; journal();
        }
        if (!matches(record.installed)) fail("IDEMPOTENCE_FAILED_OR_CONCURRENT_CHANGE");
        if (inspect(targets[0])?.hash !== HELPER_HASH) fail("INSTALLED_HELPER_CHANGED");
        emit("BOOTSTRAP_APPLY_" + n + "_MANAGED_PID=" + waitManaged(home, exec));
      }
      emit("BOOTSTRAP_FILE_IDEMPOTENCE_OK");
      if (record.before.every((s, i) => same(s, record.installed[i]))) fail("NO_FILE_CHANGE_TO_EXERCISE_ROLLBACK");
    } catch (e) { failure = e; }
    restore();
    if (failure) throw failure;
    emit("AURORA_NATIVE_BOOTSTRAP_ROLLBACK_OK");
    emit("REMOTE_RECHECK=PENDING APP_UPDATE=NO MIRROR_SYNC=NO");
  } finally { fs.rmdirSync(lock); }
}
if (require.main === module) {
  try {
    const mode = process.argv[2];
    if (!((mode === "--exercise" && process.argv.length === 3) || (mode === "--restore" && process.argv.length === 4))) fail("USAGE_EXERCISE_OR_RESTORE_BACKUP");
    if (process.platform !== "darwin" || process.arch !== "x64" || process.versions.node.split(".")[0] !== "16") fail("HIGHSIERRA_NODE16_REQUIRED");
    const env = {...process.env};
    for (const key of ["BASH_ENV", "ENV", "TCMD_COMPUTER_ID", "TCMD_COMMAND_ID"]) delete env[key];
    const exec = (file, args) => cp.spawnSync(file, args, {env, encoding: "utf8", timeout: 45000, maxBuffer: 2 * 1024 * 1024});
    if (exec("/bin/hostname", []).stdout.trim() !== "iMac-de-Joao.local" ||
        exec("/usr/bin/sw_vers", ["-productVersion"]).stdout.trim() !== "10.13.6") fail("HOST_OR_OS_MISMATCH");
    const installer = path.join(__dirname, "INSTALL_AURORA_TRIGGERCMD_BASE.sh");
    exercise({home: process.env.HOME, installer, source: fs.readFileSync(installer), exec, mode, recovery: process.argv[3]});
  } catch (e) {
    console.error(/^[A-Z0-9_]+$/.test(e.message) ? e.message : "NATIVE_EXERCISE_FAILED_KEEP_BACKUPS");
    process.exitCode = 1;
  }
}
module.exports = {exercise, FILES};
