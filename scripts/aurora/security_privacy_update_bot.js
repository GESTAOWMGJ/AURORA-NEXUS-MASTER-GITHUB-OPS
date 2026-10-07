#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function readText(filePath, fallback = "") {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return fallback; }
}

function readJson(filePath, fallback = {}) {
  try { return JSON.parse(readText(filePath, "{}")); } catch { return fallback; }
}

function has(text, pattern) {
  return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
}

function statusFromEvidence(evidence) {
  if (evidence.every(Boolean)) return "READY_FOR_PLANNED_CHANGE";
  if (evidence.some(Boolean)) return "PARTIAL_EVIDENCE";
  return "EVIDENCE_REQUIRED";
}

function score(item) {
  const urgency = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 1 }[item.risk] || 1;
  const market = item.marketDemand || 1;
  const plausibility = item.plausibility || 1;
  const evidence = item.evidenceScore || 1;
  const complexityPenalty = item.complexity || 1;
  return (urgency * 5) + (market * 4) + (plausibility * 3) + (evidence * 2) - complexityPenalty;
}

function buildBacklog(repoRoot) {
  const securityBaseline = readJson(path.join(repoRoot, "firebase-migration", "policy", "security-baseline-v1.json"), {});
  const certification = readJson(path.join(repoRoot, "firebase-migration", "policy", "certification-readiness-v1.json"), {});
  const riskRegister = readText(path.join(repoRoot, "firebase-migration", "docs", "32-security-risk-register.md"));
  const threatModel = readText(path.join(repoRoot, "firebase-migration", "docs", "30-threat-model.md"));
  const incidentPlan = readText(path.join(repoRoot, "firebase-migration", "docs", "33-incident-response-plan.md"));
  const vulnerabilityReport = readText(path.join(repoRoot, "firebase-migration", "docs", "36-vulnerability-consolidated-report.md"));
  const certPlan = readText(path.join(repoRoot, "docs", "AURORA_CERTIFICATION_READINESS_20261007.md"));

  const candidates = [
    {
      id: "certification-soa-draft",
      title: "Create ISO 27001 Statement of Applicability with evidence links",
      risk: "HIGH",
      marketDemand: 5,
      plausibility: 5,
      complexity: 3,
      evidenceScore: has(certPlan, "Statement of Applicability") ? 3 : 1,
      controlRefs: ["ISO_IEC_27001_2022", "AURORA-CERT-001"],
      evidence: [has(certPlan, "Statement of Applicability"), has(JSON.stringify(certification), "ISO_IEC_27001_2022")],
      proposedAction: "Generate SoA table with included/excluded controls, justification, owner and repo evidence path.",
      guardrail: "Do not mark any control CERTIFIED without external certificate."
    },
    {
      id: "repo-ruleset-required-checks",
      title: "Enforce branch ruleset and required checks for main/release branches",
      risk: "HIGH",
      marketDemand: 5,
      plausibility: 4,
      complexity: 3,
      evidenceScore: has(riskRegister, "R014") ? 3 : 1,
      controlRefs: ["ISO_IEC_27001_2022", "SECURE_SDLC"],
      evidence: [has(riskRegister, "R014"), has(JSON.stringify(securityBaseline), "SPECIFIED_PENDING_GITHUB_RULESET")],
      proposedAction: "Create repository ruleset requiring deploy, auth, CodeQL/security and installer validation checks before merge.",
      guardrail: "Apply through GitHub settings/API with explicit rule review; no bypass for production release."
    },
    {
      id: "access-review-matrix",
      title: "Generate recurring access review matrix",
      risk: "HIGH",
      marketDemand: 5,
      plausibility: 4,
      complexity: 3,
      evidenceScore: has(JSON.stringify(securityBaseline), "leastPrivilege") ? 3 : 1,
      controlRefs: ["ISO_IEC_27001_2022", "ISO_IEC_27701_2025", "LGPD_ANPD"],
      evidence: [has(JSON.stringify(securityBaseline), "leastPrivilege"), has(riskRegister, "R020")],
      proposedAction: "Export and review GitHub, Google Cloud, Firebase, smoke users and connected-app roles monthly.",
      guardrail: "No broad permanent grants; require owner, purpose, expiry and revocation route."
    },
    {
      id: "sbom-release-provenance",
      title: "Generate SBOM and release provenance for backend and installers",
      risk: "HIGH",
      marketDemand: 5,
      plausibility: 4,
      complexity: 4,
      evidenceScore: has(JSON.stringify(securityBaseline), "SBOM_FOR_COMMERCIAL_RELEASE") ? 3 : 1,
      controlRefs: ["ISO_IEC_27001_2022", "ISO_9001_2026", "SUPPLY_CHAIN"],
      evidence: [has(JSON.stringify(securityBaseline), "SBOM_FOR_COMMERCIAL_RELEASE"), has(riskRegister, "R015")],
      proposedAction: "Attach SBOM, artifact hashes and exact source manifest to each commercial beta release.",
      guardrail: "Do not serve unsigned or hash-mismatched artifacts."
    },
    {
      id: "privacy-retention-schedule",
      title: "Finalize retention, deletion and legal hold schedule by data class",
      risk: "HIGH",
      marketDemand: 5,
      plausibility: 4,
      complexity: 3,
      evidenceScore: has(riskRegister, "R017") ? 3 : 1,
      controlRefs: ["ISO_IEC_27701_2025", "LGPD_ANPD"],
      evidence: [has(riskRegister, "R017"), has(JSON.stringify(certification), "RETENTION_DELETION_SCHEDULE")],
      proposedAction: "Create tenant-aware retention matrix for PUBLIC, INTERNAL, RESTRICTED and CLINICAL_SENSITIVE data.",
      guardrail: "Preserve audit evidence and legal hold; do not delete regulated records automatically without policy approval."
    },
    {
      id: "incident-tabletop",
      title: "Run incident tabletop and record corrective actions",
      risk: "HIGH",
      marketDemand: 4,
      plausibility: 5,
      complexity: 2,
      evidenceScore: has(incidentPlan, "tabletop") ? 3 : 1,
      controlRefs: ["ISO_IEC_27001_2022", "LGPD_ANPD"],
      evidence: [has(incidentPlan, "tabletop"), has(incidentPlan, "SEV0")],
      proposedAction: "Simulate credential leak, cross-tenant denial and CMEK failure in HML; create post-exercise CAPA.",
      guardrail: "Do not use real patient data in exercises."
    },
    {
      id: "backup-restore-recurring-proof",
      title: "Schedule recurring backup and restore evidence capture",
      risk: "HIGH",
      marketDemand: 5,
      plausibility: 4,
      complexity: 4,
      evidenceScore: has(JSON.stringify(securityBaseline), "RESTORE_TEST_BEFORE_CUTOVER") ? 3 : 1,
      controlRefs: ["ISO_IEC_27001_2022", "BCP_DR"],
      evidence: [has(JSON.stringify(securityBaseline), "READY_BACKUP"), has(threatModel, "restore")],
      proposedAction: "Persist run ID, source DB, restored DB, reconciliation hash and owner sign-off for each restore proof.",
      guardrail: "Restore into a new database; never overwrite production during tests."
    },
    {
      id: "clinical-sensitive-independent-pentest",
      title: "Gate clinical-sensitive release behind independent pentest",
      risk: "CRITICAL",
      marketDemand: 5,
      plausibility: 3,
      complexity: 5,
      evidenceScore: has(threatModel, "CLINICAL_SENSITIVE") ? 3 : 1,
      controlRefs: ["ISO_IEC_27001_2022", "ISO_IEC_27701_2025", "LGPD_ANPD"],
      evidence: [has(threatModel, "CLINICAL_SENSITIVE"), has(riskRegister, "R028")],
      proposedAction: "Keep health-data path blocked until HML crypto, tenant isolation, restore and external pentest evidence pass.",
      guardrail: "No clinical-sensitive production processing before formal gate approval."
    },
    {
      id: "dependency-market-radar",
      title: "Track dependency and framework changes against market expectations",
      risk: "MEDIUM",
      marketDemand: 4,
      plausibility: 5,
      complexity: 2,
      evidenceScore: has(vulnerabilityReport, "vulnerab") || has(vulnerabilityReport, "GHSA") ? 3 : 1,
      controlRefs: ["ISO_IEC_27001_2022", "ISO_9001_2026"],
      evidence: [Boolean(vulnerabilityReport), has(riskRegister, "R007")],
      proposedAction: "Weekly check for CVE/GHSA, Firebase/Actions runtime changes, ISO transition notes and customer security questionnaire gaps.",
      guardrail: "Do not auto-upgrade production dependencies without CI and rollback."
    }
  ];

  return candidates.map((item) => ({
    ...item,
    evidenceState: statusFromEvidence(item.evidence),
    score: score(item),
    dryRunOnly: true
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function main() {
  const repoRoot = process.cwd();
  const backlog = buildBacklog(repoRoot);
  const output = {
    robot: "AURORA_SECURITY_PRIVACY_UPDATE_BOT",
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    mode: process.env.AURORA_APPLY === "1" ? "RECOMMEND_ONLY_APPLY_DISABLED" : "DRY_RUN_RECOMMEND_ONLY",
    marketReferences: [
      "ISO_IEC_27001_2022",
      "ISO_IEC_27701_2025",
      "ISO_9001_2026",
      "ISO_IEC_25010_2023",
      "LGPD_ANPD",
      "NIST_CSF_2_0",
      "OWASP_ASVS"
    ],
    rules: [
      "Never claim certification without external certificate.",
      "Never broaden IAM automatically.",
      "Never process clinical-sensitive data before the clinical release gate passes.",
      "Every proposed change must have owner, risk, evidence and rollback route.",
      "Market plausibility requires current standard, customer value and implementable evidence."
    ],
    backlog
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
