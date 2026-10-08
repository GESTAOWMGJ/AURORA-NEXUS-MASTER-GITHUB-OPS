#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const path = require("node:path");

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

const result = {
  orchestrator: "AURORA_CLOUD_FAILSAFE_ROBOT_ORCHESTRATOR",
  version: "1.3.0",
  activeDeliverable: ACTIVE_DELIVERABLE,
  trigger: "CLOUD_HEALTH_OR_WINDOWS_XEON_ONLINE_CONFIRMED",
  mode: "PLAN_ONLY",
  evidenceState: "SPECIFIED",
  operationalIntegrationVerified: false,
  failoverExecuted: false,
  passed: policyChecks.every((check) => check.ok) && semanticChecks.every((check) => check.ok),
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
  semanticChecks
};

// This is a bounded local executor, not a remote dispatcher or a failover router.
// Existing authenticated cloud ingestion remains in aurora_cloud_sync.py.
const SAFE_ROBOTS = new Set([
  "platform-unification-robot", "certification-security-gate",
  "security-privacy-update-bot", "organic-improvement-backlog"
]);

function executeSafeRobots(plan, options = {}) {
  const root = options.root || ROOT;
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new Error("INVALID_TIMEOUT");
  }
  const run = options.run || spawnSync;
  const receipts = [];
  let failed = !plan.passed;
  for (const robot of plan.startupOrder) {
    if (failed) {
      receipts.push({ id: robot.id, state: "NOT_EXECUTED_PRIOR_FAILURE" });
      continue;
    }
    if (!SAFE_ROBOTS.has(robot.id)) {
      receipts.push({ id: robot.id, state: robot.command.startsWith("policy:")
        ? "DECLARATIVE_POLICY" : "EXPLICIT_INPUT_REQUIRED" });
      continue;
    }
    // Resolve from fixed source registry, never from a supplied command string.
    const fixed = robots.find(item => item.id === robot.id);
    const script = fixed.command.slice("node ".length);
    let execution;
    try {
      execution = run(process.execPath, [path.join(root, script)], {
        cwd: root, shell: false, timeout: timeoutMs, maxBuffer: 1024 * 1024,
        encoding: "utf8", windowsHide: true,
        // Read-only robots do not need cloud/integration credentials.
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
          AURORA_DRY_RUN: "1" }
      });
    } catch (_) {
      execution = { status: null, error: { code: "SPAWN_FAILED" } };
    }
    const stdout = String(execution.stdout || "");
    let output;
    try { output = JSON.parse(stdout); } catch (_) { output = null; }
    const gate = robot.id !== "organic-improvement-backlog";
    const validOutput = output && (gate ? output.passed === true
      : Array.isArray(output.backlog) && output.dryRun === true);
    const ok = execution.status === 0 && !execution.error && !execution.signal && Boolean(validOutput);
    receipts.push({ id: robot.id, state: ok ? "LOCAL_EXECUTION_VERIFIED" : "FAILED",
      exitCode: Number.isInteger(execution.status) ? execution.status : null,
      failure: ok ? null : execution.error?.code === "ETIMEDOUT" ? "TIMEOUT"
        : execution.error ? "SPAWN_OR_BUFFER_ERROR" : execution.signal ? "SIGNAL"
        : execution.status !== 0 ? "NONZERO_EXIT" : "OUTPUT_CONTRACT_REJECTED",
      outputSha256: createHash("sha256").update(stdout).digest("hex") });
    failed = !ok;
  }
  return { ...plan, mode: "EXECUTE_LOCAL_READ_ONLY", passed: !failed,
    evidenceState: "LOCAL_EXECUTION_RECEIPTS", localRobotsPassed: !failed,
    operationalIntegrationVerified: false, failoverExecuted: false,
    executionLocation: "CURRENT_HOST", receipts };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--execute-local") || args.length > 1) {
    console.log(JSON.stringify({ passed: false, code: "UNSUPPORTED_ARGUMENT" }));
    process.exitCode = 1;
  } else {
    const output = args.includes("--execute-local") ? executeSafeRobots(result) : result;
    console.log(JSON.stringify(output, null, 2));
    if (!output.passed) process.exitCode = 1;
  }
}
module.exports = { executeSafeRobots, result };
