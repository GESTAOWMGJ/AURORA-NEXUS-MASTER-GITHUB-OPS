#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

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
    id: "resolutive-algorithm-policy",
    command: "policy: firebase-migration/policy/resolutive-algorithm-policy-v1.json",
    scope: ["decision", "release", "rollback"]
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
  "firebase-migration/policy/autonomous-bugfix-realtime-audit-v1.json",
  "firebase-migration/policy/resolutive-algorithm-policy-v1.json",
  "firebase-migration/policy/digital-security-certification-layer-v1.json",
  "firebase-migration/policy/certification-readiness-v1.json",
  "firebase-migration/policy/security-baseline-v1.json"
];

function exists(filePath) {
  return fs.existsSync(path.join(ROOT, filePath));
}

const policyChecks = requiredPolicies.map((filePath) => ({
  path: filePath,
  ok: exists(filePath)
}));

const result = {
  orchestrator: "AURORA_WINDOWS_ONLINE_ROBOT_ORCHESTRATOR",
  version: "1.0.0",
  trigger: "WINDOWS_XEON_ONLINE_CONFIRMED",
  mode: "START_ALL_SAFE_ROBOTS",
  passed: policyChecks.every((check) => check.ok),
  startupOrder: robots,
  executionRules: [
    "Run heavy builds, indexing and sync on the Windows Xeon physical server when connected.",
    "Keep MacBook as light supervision/interface station.",
    "Use small reversible patches with validation and rollback.",
    "Do not expose secrets, rotate credentials or migrate clinical-sensitive data without fresh approval.",
    "Do not declare certification obtained without formal certificate."
  ],
  policyChecks
};

console.log(JSON.stringify(result, null, 2));

if (!result.passed) {
  process.exitCode = 1;
}
