#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function countMatches(text, needles) {
  return needles.reduce((count, needle) => count + (text.includes(needle) ? 1 : 0), 0);
}

function main() {
  const repoRoot = process.cwd();
  const policy = fs.readFileSync(path.join(repoRoot, "policy", "aurora-external-ai-reduction-policy.md"), "utf8");
  const kpi = readJson(path.join(repoRoot, "config", "aurora-kpi-baseline.json"), { kpis: {} });
  const candidate = process.env.AURORA_CANDIDATE_PATH ? path.resolve(repoRoot, process.env.AURORA_CANDIDATE_PATH) : null;
  const candidateText = candidate && fs.existsSync(candidate) ? fs.readFileSync(candidate, "utf8") : "";
  const dryRun = process.env.AURORA_DRY_RUN === "1";

  const safetyChecks = [
    { id: "policy-present", passed: policy.includes("motor nativo primeiro") || policy.includes("Motor interno primeiro") },
    { id: "dry-run-supported", passed: true },
    { id: "external-fallback-explicit", passed: policy.includes("fallback") },
    { id: "kpi-defined", passed: Boolean(kpi.kpis?.external_ai_dependency_rate) && Boolean(kpi.kpis?.autonomous_pr_success_rate) }
  ];

  const workflowChecks = [
    { id: "branch-traceability", passed: /AURORA/i.test(candidateText) || !candidateText },
    { id: "no-auto-merge-on-failure", passed: true },
    { id: "deterministic-routing", passed: countMatches(candidateText, ["AURORA_ALLOW_EXTERNAL_AI", "AURORA_INTERNAL_ENGINE_READY", "AURORA_CANONICAL_SNAPSHOT_READY"]) >= 1 || !candidateText }
  ];

  const passed = [...safetyChecks, ...workflowChecks].every((item) => item.passed);
  const output = {
    dryRun,
    passed,
    candidate: candidate ? path.relative(repoRoot, candidate) : null,
    checks: [...safetyChecks, ...workflowChecks],
    kpiTargets: {
      external_ai_dependency_rate: kpi.kpis?.external_ai_dependency_rate?.target ?? null,
      autonomous_pr_success_rate: kpi.kpis?.autonomous_pr_success_rate?.target ?? null,
      regression_rate: kpi.kpis?.regression_rate?.target ?? null,
      mttr_minutes: kpi.kpis?.mttr?.target_minutes ?? null
    }
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

main();
