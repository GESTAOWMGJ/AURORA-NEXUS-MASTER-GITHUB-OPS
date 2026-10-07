#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const evidenceFiles = [
  ["securityBaseline", "firebase-migration/policy/security-baseline-v1.json"],
  ["certificationProfile", "firebase-migration/policy/certification-readiness-v1.json"],
  ["digitalSecurityLayer", "firebase-migration/policy/digital-security-certification-layer-v1.json"],
  ["riskRegister", "firebase-migration/docs/32-security-risk-register.md"],
  ["certificationPlan", "docs/AURORA_CERTIFICATION_READINESS_20261007.md"]
];

function absolute(filePath) {
  return path.join(ROOT, filePath);
}

function fileExists(filePath) {
  return fs.existsSync(absolute(filePath));
}

function readText(filePath) {
  try {
    return fs.readFileSync(absolute(filePath), "utf8");
  } catch (_error) {
    return "";
  }
}

const evidenceChecks = evidenceFiles.map(([id, filePath]) => ({
  id,
  path: filePath,
  ok: fileExists(filePath)
}));

const evidenceText = evidenceFiles.map(([, filePath]) => readText(filePath)).join("\n");

const semanticChecks = [
  {
    id: "iso-27001-reference",
    ok: evidenceText.includes("ISO_IEC_27001_2022") || evidenceText.includes("ISO/IEC 27001")
  },
  {
    id: "no-premature-certification-claim",
    ok: evidenceText.includes("PREPARATION_NOT_CERTIFIED") || evidenceText.includes("certificationClaimAllowed")
  },
  {
    id: "clinical-sensitive-gate",
    ok: evidenceText.includes("CLINICAL_SENSITIVE") || evidenceText.includes("dados clinicos sensiveis")
  }
];

const backlog = [
  {
    id: "main-ruleset-required-checks",
    priority: 1,
    risk: "HIGH",
    action: "Exigir checks obrigatorios em main e branches de release antes de merge."
  },
  {
    id: "monthly-access-review",
    priority: 2,
    risk: "HIGH",
    action: "Executar revisao mensal de acessos GitHub, Google Cloud, Firebase e usuarios de smoke."
  },
  {
    id: "release-sbom-provenance",
    priority: 3,
    risk: "HIGH",
    action: "Anexar SBOM, manifesto de fonte e hashes dos artefatos em cada release beta."
  },
  {
    id: "backup-restore-proof",
    priority: 4,
    risk: "HIGH",
    action: "Registrar prova recorrente de backup e restore antes de producao com dados sensiveis."
  },
  {
    id: "incident-tabletop",
    priority: 5,
    risk: "HIGH",
    action: "Rodar simulado de incidente para vazamento de credencial, isolamento tenant e falha CMEK."
  },
  {
    id: "clinical-pentest-gate",
    priority: 6,
    risk: "CRITICAL",
    action: "Manter dados clinicos sensiveis bloqueados ate pentest independente e gate formal aprovado."
  }
];

const passed = evidenceChecks.every((check) => check.ok) && semanticChecks.every((check) => check.ok);

const result = {
  robot: "AURORA_SECURITY_PRIVACY_UPDATE_BOT",
  version: "1.1.0",
  mode: "RECOMMEND_ONLY",
  passed,
  guardrails: [
    "Nao altera IAM, regras, chaves, dados ou deploy automaticamente.",
    "Nao declara certificacao obtida sem auditoria formal.",
    "Prioriza reducao de risco operacional e continuidade do cliente."
  ],
  evidenceChecks,
  semanticChecks,
  backlog
};

console.log(JSON.stringify(result, null, 2));

if (!passed) {
  process.exitCode = 1;
}
