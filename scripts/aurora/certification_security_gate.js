#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const requiredFiles = [
  "docs/AURORA_CERTIFICATION_READINESS_20261007.md",
  "docs/AURORA_DIGITAL_SECURITY_CERTIFICATION_LAYER.md",
  "docs/AURORA_SECURITY_PRIVACY_UPDATE_BOT.md",
  "firebase-migration/docs/50-certification-control-matrix.md",
  "firebase-migration/policy/certification-readiness-v1.json",
  "firebase-migration/policy/digital-security-certification-layer-v1.json",
  "firebase-migration/policy/resolutive-algorithm-policy-v1.json",
  "firebase-migration/policy/security-baseline-v1.json",
  "firebase-migration/docs/30-threat-model.md",
  "firebase-migration/docs/31-lgpd-ropa.md",
  "firebase-migration/docs/32-security-risk-register.md",
  "firebase-migration/docs/33-incident-response-plan.md",
  "firebase-migration/docs/37-clinical-sensitive-release-gate.md"
];

function absolute(filePath) {
  return path.join(ROOT, filePath);
}

function readText(filePath) {
  try {
    return fs.readFileSync(absolute(filePath), "utf8");
  } catch (_error) {
    return "";
  }
}

const fileChecks = requiredFiles.map((filePath) => ({
  path: filePath,
  ok: fs.existsSync(absolute(filePath))
}));

const certificationProfile = readText("firebase-migration/policy/certification-readiness-v1.json");
const digitalLayer = readText("firebase-migration/policy/digital-security-certification-layer-v1.json");
const securityBaseline = readText("firebase-migration/policy/security-baseline-v1.json");
const resolutivePolicy = readText("firebase-migration/policy/resolutive-algorithm-policy-v1.json");
const combinedPolicy = [certificationProfile, digitalLayer, securityBaseline, resolutivePolicy].join("\n");

const policyChecks = [
  {
    id: "no-premature-certification-claim",
    ok: certificationProfile.includes("PREPARATION_NOT_CERTIFIED")
      && certificationProfile.includes('"certificationClaimAllowed": false')
  },
  {
    id: "least-privilege-required",
    ok: /leastPrivilege|LEAST_PRIVILEGE/.test(combinedPolicy)
  },
  {
    id: "clinical-sensitive-data-gated",
    ok: combinedPolicy.includes("CLINICAL_SENSITIVE")
  },
  {
    id: "bot-cannot-change-iam",
    ok: digitalLayer.includes('"botMayChangeIAM": false')
  },
  {
    id: "single-resolutive-path",
    ok: resolutivePolicy.includes("SINGLE_BEST_PATH_BY_DEFAULT")
      && resolutivePolicy.includes("MOST_RESOLUTIVE_SAFE_PATH")
  },
  {
    id: "no-redundant-confirmation-loop",
    ok: resolutivePolicy.includes("NO_CONFIRMATION_DEPENDENCY_WHEN_EVIDENCE_AND_AUTHORIZATION_ARE_SUFFICIENT")
      && resolutivePolicy.includes("PROMPT_LOOPS")
  },
  {
    id: "truth-must-be-evidence-linked",
    ok: resolutivePolicy.includes("GENERATED_INFORMATION_MUST_BE_EVIDENCE_LINKED")
      && resolutivePolicy.includes("confirmed")
  }
];

const passed = fileChecks.every((check) => check.ok) && policyChecks.every((check) => check.ok);

console.log(JSON.stringify({
  gate: "AURORA_CERTIFICATION_SECURITY_GATE",
  version: "1.1.0",
  passed,
  fileChecks,
  policyChecks
}, null, 2));

if (!passed) {
  process.exitCode = 1;
}
