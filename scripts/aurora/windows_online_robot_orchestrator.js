#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = process.cwd();
const ACTIVE_DELIVERABLE = "2026.10.07-dev.2";

const robots = [
  {
    id: "platform-unification-robot",
    command: "node scripts/aurora/platform_unification_robot.js",
    scope: ["platform", "policy", "cloud", "physical_server", "client", "conflict_certification"]
  },
  {
    id: "certification-security-gate",
    command: "node scripts/aurora/certification_security_gate.js",
    scope: ["cloud", "engine", "client"]
  },
  {
    id: "security-privacy-update-bot",
    command: "node scripts/aurora/security_privacy_update_bot.js",
    scope: ["security", "privacy", "market"]
  },
  {
    id: "autonomous-realtime-bugfix-audit",
    command: "policy: firebase-migration/policy/autonomous-bugfix-realtime-audit-v1.json",
    scope: ["cloud", "physical_server", "client", "engine"]
  },
  {
    id: "cloud-failsafe-router",
    command: "policy: firebase-migration/policy/cloud-failsafe-robot-operation-v1.json",
    scope: ["cloud", "physical_server", "client", "rollback"]
  },
  {
    id: "resolutive-algorithm-policy",
    command: "policy: firebase-migration/policy/resolutive-algorithm-policy-v1.json",
    scope: ["decision", "release", "rollback"]
  },
  {
    id: "operational-delivery-hardening",
    command: "policy: firebase-migration/policy/operational-delivery-hardening-v1.json",
    scope: ["delivery", "continuity", "breakage_prevention"]
  },
  {
    id: "organic-improvement-backlog",
    command: "node scripts/aurora/generate_improvement_backlog.js",
    scope: ["organic_learning", "version_improvement"]
  },
  {
    id: "candidate-change-evaluator",
    command: "node scripts/aurora/evaluate_candidate_change.js",
    scope: ["patch", "validation", "promotion"]
  }
];

const requiredPolicies = [
  "firebase-migration/policy/development-deliverable-v1.json",
  "firebase-migration/policy/manifest.json",
  "firebase-migration/policy/autonomous-bugfix-realtime-audit-v1.json",
  "firebase-migration/policy/cloud-failsafe-robot-operation-v1.json",
  "firebase-migration/policy/resolutive-algorithm-policy-v1.json",
  "firebase-migration/policy/operational-delivery-hardening-v1.json",
  "firebase-migration/policy/platform-unification-conflict-certification-v1.json",
  "firebase-migration/policy/digital-security-certification-layer-v1.json",
  "firebase-migration/policy/certification-readiness-v1.json",
  "firebase-migration/policy/security-baseline-v1.json"
];

const failoverPlan = [
  {
    priority: 1,
    target: "CLOUD_CONTROL_PLANE",
    mode: "primary",
    action: "Run orchestration, gates, release coordination and client routing when health checks pass."
  },
  {
    priority: 2,
    target: "WINDOWS_XEON_PHYSICAL_SERVER",
    mode: "fallback_and_heavy_compute",
    action: "Run heavy builds, indexing, ingestion, repair and artifact work when online or cloud is degraded."
  },
  {
    priority: 3,
    target: "CLIENT_SAFE_DEGRADED_MODE",
    mode: "last_safe_mode",
    action: "Pause unsafe writes, queue retryable jobs and serve authorized read-only cached state when backends are unavailable."
  }
];

function filePath(fileName) {
  return path.join(ROOT, fileName);
}

function exists(fileName) {
  return fs.existsSync(filePath(fileName));
}

function readText(fileName) {
  try {
    return fs.readFileSync(filePath(fileName), "utf8");
  } catch (_error) {
    return "";
  }
}

const policyChecks = requiredPolicies.map((fileName) => ({
  path: fileName,
  ok: exists(fileName)
}));

const deliverableText = readText("firebase-migration/policy/development-deliverable-v1.json");
const manifestText = readText("firebase-migration/policy/manifest.json");
const hardeningText = readText("firebase-migration/policy/operational-delivery-hardening-v1.json");
const unificationText = readText("firebase-migration/policy/platform-unification-conflict-certification-v1.json");

const semanticChecks = [
  {
    id: "active-deliverable-bound",
    ok: deliverableText.includes(ACTIVE_DELIVERABLE)
      && manifestText.includes(ACTIVE_DELIVERABLE)
      && hardeningText.includes(ACTIVE_DELIVERABLE)
      && unificationText.includes(ACTIVE_DELIVERABLE)
  },
  {
    id: "single-path-required",
    ok: deliverableText.includes("oneOperationalEntrypoint")
      && hardeningText.includes("oneActiveDevelopmentDeliverable")
      && hardeningText.includes("noParallelDeliveryTracks")
  },
  {
    id: "platform-unification-required",
    ok: deliverableText.includes("onePlatformUnificationRobot")
      && manifestText.includes("platform-unification-conflict-certification-v1.json")
      && unificationText.includes("AURORA-PLATFORM-UNIFICATION-001")
  },
  {
    id: "failsafe-required",
    ok: hardeningText.includes("cloudAndPhysicalServerMustHaveFailoverPath")
      && hardeningText.includes("clientMustHaveSafeDegradedMode")
  }
];

const executionRequested = process.argv.includes("--execute");
const allowedScripts = new Map([
  ["platform-unification-robot", "scripts/aurora/platform_unification_robot.js"],
  ["certification-security-gate", "scripts/aurora/certification_security_gate.js"],
  ["security-privacy-update-bot", "scripts/aurora/security_privacy_update_bot.js"],
  ["organic-improvement-backlog", "scripts/aurora/generate_improvement_backlog.js"],
  ["candidate-change-evaluator", "scripts/aurora/evaluate_candidate_change.js"]
]);

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseJsonOutput(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function executeRobot(robot) {
  if (robot.command.startsWith("policy: ")) {
    const relativePath = robot.command.slice("policy: ".length);
    if (!requiredPolicies.includes(relativePath) || !exists(relativePath)) {
      return { id: robot.id, kind: "policy", ok: false, path: relativePath, error: "POLICY_NOT_ALLOWLISTED_OR_MISSING" };
    }
    try {
      const raw = readText(relativePath);
      const policy = JSON.parse(raw);
      return {
        id: robot.id,
        kind: "policy",
        ok: true,
        path: relativePath,
        policyId: policy.id || policy.policyId || null,
        version: policy.version || null,
        contentHash: hashText(raw)
      };
    } catch (_error) {
      return { id: robot.id, kind: "policy", ok: false, path: relativePath, error: "INVALID_POLICY_JSON" };
    }
  }

  const relativePath = allowedScripts.get(robot.id);
  if (!relativePath || robot.command !== `node ${relativePath}` || !exists(relativePath)) {
    return { id: robot.id, kind: "node", ok: false, error: "SCRIPT_NOT_ALLOWLISTED_OR_MISSING" };
  }

  const run = spawnSync(process.execPath, [filePath(relativePath)], {
    cwd: ROOT,
    env: { ...process.env, AURORA_DRY_RUN: "1" },
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024
  });
  const stdout = run.stdout || "";
  const stderr = run.stderr || "";
  const parsed = parseJsonOutput(stdout.trim());

  return {
    id: robot.id,
    kind: "node",
    ok: run.status === 0 && !run.error,
    exitCode: run.status,
    signal: run.signal || null,
    outputHash: hashText(stdout),
    evidenceScope: "READ_ONLY_CHECK",
    candidateEvaluated: parsed?.candidate || null,
    stderrHash: stderr ? hashText(stderr) : null,
    reportedPassed: parsed && typeof parsed.passed === "boolean" ? parsed.passed : null,
    error: run.error ? run.error.message : null
  };
}

function currentRevision() {
  const run = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: false
  });
  return run.status === 0 ? run.stdout.trim() : null;
}

const staticPassed = policyChecks.every((check) => check.ok) && semanticChecks.every((check) => check.ok);
const receiptDir = process.env.AURORA_ROBOT_RECEIPT_DIR;
const executionResults = [];
let executionError = null;
let lockPath = null;
if (executionRequested) {
  if (!staticPassed) executionError = "PREFLIGHT_FAILED";
  else if (process.platform !== "win32") executionError = "WINDOWS_EXECUTION_REQUIRED";
  else if (!receiptDir || !path.isAbsolute(receiptDir)) executionError = "ABSOLUTE_RECEIPT_DIRECTORY_REQUIRED";
  else {
    try {
      for (const policy of requiredPolicies) JSON.parse(readText(policy));
      fs.mkdirSync(receiptDir, { recursive: true });
      const candidateLock = path.join(receiptDir, "orchestrator.lock");
      const fd = fs.openSync(candidateLock, "wx");
      lockPath = candidateLock;
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
      finally { fs.closeSync(fd); }
      for (const robot of robots) {
        const entry = executeRobot(robot);
        executionResults.push(entry);
        if (!entry.ok || entry.reportedPassed === false) break;
      }
    } catch (error) {
      executionError = error.code === "EEXIST" ? "EXECUTOR_BUSY" : "PREFLIGHT_OR_EXECUTION_FAILED";
    }
  }
}
const executionPassed = !executionRequested || (!executionError && executionResults.length === robots.length
  && executionResults.every((entry) => entry.ok && entry.reportedPassed !== false));

const result = {
  orchestrator: "AURORA_CLOUD_FAILSAFE_ROBOT_ORCHESTRATOR",
  version: "1.4.1",
  activeDeliverable: ACTIVE_DELIVERABLE,
  revision: currentRevision(),
  trigger: "CLOUD_HEALTH_OR_WINDOWS_XEON_ONLINE_CONFIRMED",
  mode: executionRequested ? "RUN_ALLOWED_READ_ONLY_CHECKS" : "PLAN_ONLY",
  executionRequested,
  executionError,
  evidenceScope: "READ_ONLY_SCRIPT_EXECUTION_AND_POLICY_VALIDATION",
  operationalLoopsStarted: 0,
  cloudFailoverVerified: false,
  deploymentPerformed: false,
  formalCertificationObtained: false,
  passed: staticPassed && executionPassed,
  failoverPlan,
  startupOrder: robots,
  executionRules: [
    "Use cloud control plane as primary path when health checks pass.",
    "Run heavy builds, indexing and sync on the Windows Xeon physical server when connected or when cloud is degraded.",
    "Keep MacBook as light supervision/interface station.",
    "If cloud and server are unavailable, preserve client continuity with safe degraded read-only mode and retry queue.",
    "Use small reversible patches with validation and rollback.",
    "Keep all robots bound to the single active development deliverable.",
    "Run platform unification before promotion to avoid conflicting platform roles.",
    "Do not expose secrets, rotate credentials or migrate clinical-sensitive data without fresh approval.",
    "Do not declare certification obtained without formal certificate."
  ],
  policyChecks,
  semanticChecks,
  executionResults
};

try {
  if (executionRequested && lockPath) {
    const receiptPath = path.join(receiptDir, `aurora-robot-run-${Date.now()}-${process.pid}.json`);
    const temporaryPath = `${receiptPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(result, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, receiptPath);
    result.receiptPath = receiptPath;
  }
} catch (_error) {
  result.passed = false;
  result.receiptError = "RECEIPT_WRITE_FAILED";
} finally {
  if (lockPath) {
    try { fs.unlinkSync(lockPath); }
    catch (_error) { result.passed = false; result.receiptError = "LOCK_RELEASE_FAILED"; }
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result.passed) {
  process.exitCode = 1;
}
