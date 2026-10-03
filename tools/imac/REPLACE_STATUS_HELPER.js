#!/usr/bin/env node
"use strict";
// Node 16 / High Sierra. Only the previously validated status helper is replaced.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const SOURCE_BLOB = "437ad44144701fc176eadf7a099893875f9762b4";
const VALIDATED_SHA = "552962885a89192c9ff053834493deeecb8d1df9";
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
const fail = code => { throw new Error(code); };

function safePath(p) {
  for (let q = path.resolve(p); ; q = path.dirname(q)) {
    if (fs.existsSync(q) || (() => { try { fs.lstatSync(q); return true; } catch (_) { return false; } })()) {
      if (fs.lstatSync(q).isSymbolicLink()) fail("SYMLINK_REJECTED");
    }
    if (path.dirname(q) === q) break;
  }
}
function regular(p) {
  safePath(p);
  const s = fs.statSync(p);
  if (!s.isFile()) fail("REGULAR_FILE_REQUIRED");
  return s;
}
function writePrivate(p, bytes, mode = 0o600) {
  fs.writeFileSync(p, bytes, {flag: "wx", mode});
  fs.chmodSync(p, mode);
}
function candidate(source) {
  const blob = crypto.createHash("sha1").update("blob " + source.length + "\0").update(source).digest("hex");
  if (blob !== SOURCE_BLOB) fail("VALIDATED_SOURCE_MISMATCH");
  const m = source.toString("utf8").match(/cat > "\$STAGE\/jfn_status_mac\.sh" <<'EOF'\n([\s\S]*?)\nEOF/);
  if (!m) fail("HELPER_NOT_FOUND");
  return Buffer.from(m[1] + "\n");
}
function control({mode, home, source, exec, now = () => new Date(), uid = process.getuid()}) {
  const target = path.join(home, ".TRIGGERcmdData/jfn_status_mac.sh");
  const support = path.join(home, "Library/Application Support/AuroraNexus-iMac");
  const statePath = path.join(support, "status-helper-replacement.json");
  const log = path.join(home, "Library/Logs/TRIGGERcmd-iMac.log");
  const next = candidate(source);
  const nextHash = digest(next);
  safePath(target); safePath(support); safePath(statePath);

  const readState = () => {
    regular(statePath);
    const s = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (s.version !== 1 || s.candidateHash !== nextHash ||
        typeof s.backup !== "string" || !/^status-helper-backup\.[A-Za-z0-9]+$/.test(s.backup)) fail("STATE_INVALID");
    return s;
  };
  if (mode === "--receipt") {
    const s = readState();
    if (s.status !== "INSTALLED") fail("HELPER_NOT_INSTALLED");
    regular(target);
    if (digest(fs.readFileSync(target)) !== nextHash) fail("TARGET_CHANGED");
    const st = regular(log);
    if (st.ino !== s.logInode || st.dev !== s.logDevice || st.size < s.logOffset) fail("LOG_ROTATED_OR_TRUNCATED");
    const size = st.size - s.logOffset;
    if (size > 262144) fail("LOG_WINDOW_TOO_LARGE");
    const fd = fs.openSync(log, "r");
    const buf = Buffer.alloc(size);
    try { fs.readSync(fd, buf, 0, size, s.logOffset); } finally { fs.closeSync(fd); }
    const matches = [];
    for (const line of buf.toString("utf8").split(/\r?\n/)) {
      const m = line.match(/JFN_MAC timestamp=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) host=iMac-de-Joao\.local macOS=10\.13\.6 arch=x86_64 disco=(\d+%) triggercmd=(PROCESS_PRESENT|PROCESS_ABSENT|PROCESS_UNKNOWN) managed_pid=(\d+|NONE|UNKNOWN) REMOTE_CONNECTIVITY=UNKNOWN/);
      if (m && Date.parse(m[1]) >= Date.parse(s.armedAt)) matches.push(m[0]);
    }
    return ["ARMED_AT=" + s.armedAt, ...matches,
            "NEW_LOCAL_STATUS_RECORDS=" + matches.length,
            "REMOTE_ROUNDTRIP=REQUIRES_DISPATCH_CORRELATION"];
  }
  const originalStat = regular(target);
  if (originalStat.uid !== uid || !(originalStat.mode & 0o100) || (originalStat.mode & 0o7000)) fail("TARGET_OWNER_OR_MODE_INVALID");
  if (!["--apply", "--rollback"].includes(mode)) fail("INVALID_MODE");
  if (mode === "--apply") regular(log);
  fs.mkdirSync(support, {recursive: true, mode: 0o700});
  const lock = path.join(support, ".status-helper-replacement.lock");
  try { fs.mkdirSync(lock, {mode: 0o700}); } catch (_) { fail("REPLACEMENT_BUSY_OR_STALE_LOCK"); }
  let staged = null;
  try {
    if (fs.existsSync(statePath)) {
      const state = readState();
      if (mode === "--apply") {
        if (state.status !== "INSTALLED" || digest(fs.readFileSync(target)) !== nextHash) fail("EXISTING_TRANSACTION_REQUIRES_REVIEW");
        return ["HELPER_ALREADY_REPLACED", "ARMED_AT=" + state.armedAt];
      }
      if (state.status !== "INSTALLED" || digest(fs.readFileSync(target)) !== nextHash) fail("ROLLBACK_TARGET_CHANGED");
      const backup = path.join(support, state.backup, "original.sh");
      regular(backup);
      const bytes = fs.readFileSync(backup);
      if (digest(bytes) !== state.originalHash || !Number.isInteger(state.originalMode) ||
          state.originalMode < 0 || state.originalMode > 0o777) fail("BACKUP_INVALID");
      staged = target + ".restore-" + crypto.randomBytes(8).toString("hex");
      writePrivate(staged, bytes, state.originalMode);
      fs.renameSync(staged, target); staged = null;
      fs.writeFileSync(statePath, JSON.stringify({...state, status: "ROLLED_BACK"}) + "\n", {mode: 0o600});
      return ["HELPER_ROLLBACK_OK", "RESTART=NO"];
    }
    if (mode === "--rollback") fail("NO_REPLACEMENT_RECORD");
    const original = fs.readFileSync(target);
    const originalHash = digest(original);
    const originalMode = originalStat.mode & 0o777;
    const syntax = exec("/bin/bash", ["-n"], next);
    if (syntax.status !== 0) fail("CANDIDATE_SYNTAX_INVALID");
    const backup = fs.mkdtempSync(path.join(support, "status-helper-backup."));
    fs.chmodSync(backup, 0o700);
    writePrivate(path.join(backup, "original.sh"), original, originalMode);
    writePrivate(path.join(backup, "candidate.sh"), next, originalMode);
    if (digest(fs.readFileSync(path.join(backup, "original.sh"))) !== originalHash) fail("BACKUP_VERIFY_FAILED");
    staged = target + ".candidate-" + crypto.randomBytes(8).toString("hex");
    writePrivate(staged, next, originalMode);
    const current = regular(target);
    if (digest(fs.readFileSync(target)) !== originalHash || current.mode !== originalStat.mode ||
        current.ino !== originalStat.ino || current.uid !== originalStat.uid) fail("TARGET_CHANGED_DURING_PREPARE");
    fs.renameSync(staged, target); staged = null;
    try {
      const test = exec("/bin/bash", [target]);
      if (test.status !== 0 || !/\btriggercmd=PROCESS_PRESENT\b/.test(test.stdout || "")) fail("NATIVE_CHECK_FAILED");
      if (digest(fs.readFileSync(target)) !== nextHash) fail("TARGET_CHANGED_AFTER_REPLACE");
      const logStat = regular(log);
      const state = {version: 1, status: "INSTALLED", candidateHash: nextHash,
        originalHash, originalMode, backup: path.basename(backup),
        armedAt: now().toISOString(), logOffset: logStat.size,
        logInode: logStat.ino, logDevice: logStat.dev};
      writePrivate(statePath, JSON.stringify(state, null, 2) + "\n");
      return ["AURORA_STATUS_HELPER_REPLACED_OK", "VALIDATED_SHA=" + VALIDATED_SHA,
              "BACKUP=" + backup, "ARMED_AT=" + state.armedAt,
              "RESTART=NO REMOTE_TEST=PENDING"];
    } catch (err) {
      regular(target);
      if (digest(fs.readFileSync(target)) !== nextHash) fail("ROLLBACK_BLOCKED_TARGET_CHANGED");
      staged = target + ".restore-" + crypto.randomBytes(8).toString("hex");
      writePrivate(staged, original, originalMode);
      fs.renameSync(staged, target); staged = null;
      fail("NATIVE_CHECK_FAILED_OR_RECORD_FAILED_ORIGINAL_RESTORED");
    }
  } finally {
    // Only private stage/lock files from this call; all backups are retained.
    if (staged && fs.existsSync(staged)) fs.unlinkSync(staged);
    fs.rmdirSync(lock);
  }
}

if (require.main === module) {
  try {
    const mode = process.argv[2];
    if (process.argv.length !== 3 || !["--apply", "--receipt", "--rollback"].includes(mode)) fail("USAGE_APPLY_RECEIPT_OR_ROLLBACK");
    if (process.platform !== "darwin" || process.arch !== "x64" || process.versions.node.split(".")[0] !== "16") fail("HIGHSIERRA_NODE16_REQUIRED");
    const exec = (file, args, input) => {
      const env = {...process.env};
      delete env.TCMD_COMPUTER_ID; delete env.BASH_ENV; delete env.ENV;
      return cp.spawnSync(file, args, {encoding: "utf8", input, env, timeout: 15000});
    };
    if ((exec("/bin/hostname", []).stdout || "").trim() !== "iMac-de-Joao.local" ||
        (exec("/usr/bin/sw_vers", ["-productVersion"]).stdout || "").trim() !== "10.13.6") fail("HOST_OR_OS_MISMATCH");
    const source = fs.readFileSync(path.join(__dirname, "INSTALL_AURORA_TRIGGERCMD_BASE.sh"));
    for (const line of control({mode, home: process.env.HOME, source, exec})) console.log(line);
  } catch (err) {
    console.error(/^[A-Z0-9_]+$/.test(err.message) ? err.message : "STATUS_HELPER_OPERATION_FAILED");
    process.exitCode = 1;
  }
}
module.exports = {control, candidate};
