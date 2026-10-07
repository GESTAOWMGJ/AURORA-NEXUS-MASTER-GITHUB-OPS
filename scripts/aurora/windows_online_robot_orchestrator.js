#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const ACTIVE_DELIVERABLE = "2026.10.07-dev.2";

const robots = [
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

const semanticChecks = [
  {
    id: "active-deliverable-bound",
    ok: deliverableText.includes(ACTIVE_DELIVERABLE)
      && manifestText.includes(ACTIVE_DELIVERABLE)
      && hardeningText.includes(ACTIVE_DELIVERABLE)
  },
  {
    id: "single-path-required",
    ok: deliverableText.includes("oneOperationalEntrypoint")
      && hardeningText.includes("oneActiveDevelopmentDeliverable")
      && hardeningText.includes("noParallelDeliveryTracks")
  },
  {
    id: "failsafe-required",
    ok: hardeningText.includes("cloudAndPhysicalServerMustHaveFailoverPath")
      && hardeningText.includes("clientMustHaveSafeDegradedMode")
  }
];

const result = {
  orchestrator: "AURORA_CLOUD_FAILSAFE_ROBOT_ORCHESTRATOR",
  version: "1.2.0",
  activeDeliverable: ACTIVE_DELIVERABLE,
  trigger: "CLOUD_HEALTH_OR_WINDOWS_XEON_ONLINE_CONFIRMED",
  mode: "START_ALL_SAFE_ROBOTS_WITH_FAILOVER",
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
    "Do not expose secrets, rotate credentials or migrate clinical-sensitive data without fresh approval.",
    "Do not declare certification obtained without formal certificate."
  ],
  policyChecks,
  semanticChecks
};

console.log(JSON.stringify(result, null, 2));

if (!result.passed) {
  process.exitCode = 1;
}
