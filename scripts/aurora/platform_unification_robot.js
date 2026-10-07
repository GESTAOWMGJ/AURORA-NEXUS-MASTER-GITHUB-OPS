#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const ACTIVE_DELIVERABLE = "2026.10.07-dev.2";

const requiredFiles = [
  "firebase-migration/policy/manifest.json",
  "firebase-migration/policy/development-deliverable-v1.json",
  "firebase-migration/policy/operational-delivery-hardening-v1.json",
  "firebase-migration/policy/platform-unification-conflict-certification-v1.json",
  "firebase-migration/policy/cloud-failsafe-robot-operation-v1.json",
  "firebase-migration/policy/resolutive-algorithm-policy-v1.json",
  "firebase-migration/policy/autonomous-bugfix-realtime-audit-v1.json",
  "scripts/aurora/windows_online_robot_orchestrator.js",
  "scripts/aurora/certification_security_gate.js"
];

function filePath(name) {
  return path.join(ROOT, name);
}

function readText(name) {
  try {
    return fs.readFileSync(filePath(name), "utf8");
  } catch (_error) {
    return "";
  }
}

function readJson(name) {
  try {
    return JSON.parse(readText(name));
  } catch (_error) {
    return null;
  }
}

function check(id, severity, ok, detail) {
  return { id, severity, ok, detail };
}

const manifest = readJson("firebase-migration/policy/manifest.json");
const deliverable = readJson("firebase-migration/policy/development-deliverable-v1.json");
const unification = readJson("firebase-migration/policy/platform-unification-conflict-certification-v1.json");
const orchestratorText = readText("scripts/aurora/windows_online_robot_orchestrator.js");
const gateText = readText("scripts/aurora/certification_security_gate.js");

const fileChecks = requiredFiles.map((name) => check(
  `file:${name}`,
  "MATERIAL",
  fs.existsSync(filePath(name)),
  name
));

const policyStack = Array.isArray(manifest?.activePolicyStack) ? manifest.activePolicyStack : [];
const semanticChecks = [
  check(
    "active-deliverable-version-aligned",
    "MATERIAL",
    manifest?.activeDeliverable?.version === ACTIVE_DELIVERABLE
      && deliverable?.version === ACTIVE_DELIVERABLE
      && unification?.activeDevelopmentDeliverable === ACTIVE_DELIVERABLE,
    "Manifest, deliverable and unification policy must point to the same active version."
  ),
  check(
    "unification-policy-in-manifest",
    "MATERIAL",
    policyStack.includes("platform-unification-conflict-certification-v1.json"),
    "The platform unification policy must be part of the active policy stack."
  ),
  check(
    "orchestrator-bound-to-deliverable",
    "MATERIAL",
    orchestratorText.includes(ACTIVE_DELIVERABLE) && orchestratorText.includes("platform-unification"),
    "The robot orchestrator must bind platform unification to the active deliverable."
  ),
  check(
    "gate-bound-to-unification",
    "MATERIAL",
    gateText.includes("platform-unification-conflict-certification-v1.json")
      && gateText.includes("AURORA-PLATFORM-UNIFICATION-001"),
    "The certification gate must require platform unification evidence."
  ),
  check(
    "hml-has-no-production-mutation",
    "MATERIAL",
    manifest?.runtime?.productionMutation === false && deliverable?.canonicalRuntime?.productionMutation === false,
    "HML deliverable must not mutate production."
  ),
  check(
    "clinical-sensitive-disabled-for-current-deliverable",
    "MATERIAL",
    manifest?.runtime?.clinicalSensitiveEnabled === false && deliverable?.canonicalRuntime?.clinicalSensitiveEnabled === false,
    "Clinical-sensitive paths remain gated in this deliverable."
  ),
  check(
    "failsafe-roles-present",
    "MATERIAL",
    orchestratorText.includes("CLOUD_CONTROL_PLANE")
      && orchestratorText.includes("WINDOWS_XEON_PHYSICAL_SERVER")
      && orchestratorText.includes("CLIENT_SAFE_DEGRADED_MODE"),
    "Cloud, physical server and client safe mode must have distinct roles."
  ),
  check(
    "external-certification-not-claimed",
    "MATERIAL",
    unification?.certificationType === "INTERNAL_OPERATIONAL_INTEGRATION_CERTIFICATION_NOT_EXTERNAL_ISO_CERTIFICATION",
    "Integration certification is internal and operational, not a formal external ISO claim."
  )
];

const materialConflicts = [...fileChecks, ...semanticChecks].filter((item) => item.severity === "MATERIAL" && !item.ok);
const advisoryConflicts = [...fileChecks, ...semanticChecks].filter((item) => item.severity !== "MATERIAL" && !item.ok);
const resultProfile = materialConflicts.length > 0
  ? "MATERIAL_CONFLICT"
  : advisoryConflicts.length > 0
    ? "ADVISORY_CONFLICT"
    : "CONFLICT_FREE";

const output = {
  robot: "AURORA_PLATFORM_UNIFICATION_ROBOT",
  version: "1.0.0",
  activeDeliverable: ACTIVE_DELIVERABLE,
  resultProfile,
  passed: resultProfile !== "MATERIAL_CONFLICT",
  evidenceState: "POLICY_VALIDATION_ONLY",
  operationalIntegrationVerified: false,
  integrationCertification: {
    certified: false,
    evidenceScope: "REPOSITORY_POLICY_CONSISTENCY_ONLY",
    type: "INTERNAL_OPERATIONAL_INTEGRATION_CERTIFICATION_NOT_EXTERNAL_ISO_CERTIFICATION",
    conflictFree: resultProfile === "CONFLICT_FREE",
    promotionBlocked: resultProfile === "MATERIAL_CONFLICT"
  },
  checks: [...fileChecks, ...semanticChecks],
  materialConflicts,
  advisoryConflicts
};

console.log(JSON.stringify(output, null, 2));

if (!output.passed) {
  process.exitCode = 1;
}

