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
const combinedPolicy = [certificationProfile, digitalLayer, securityBaseline].join("\n");

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
  }
];

const passed = fileChecks.every((check) => check.ok) && policyChecks.every((check) => check.ok);

console.log(JSON.stringify({
  gate: "AURORA_CERTIFICATION_SECURITY_GATE",
  version: "1.0.0",
  passed,
  fileChecks,
  policyChecks
}, null, 2));

if (!passed) {
  process.exitCode = 1;
}
