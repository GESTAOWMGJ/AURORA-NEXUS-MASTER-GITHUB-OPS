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

function scoreItem(item) {
  const weights = { security: 5, reliability: 4, autonomy: 4, regression: 3, cost: 2, docs: 1 };
  return (weights[item.kind] || 1) * (item.impact || 1);
}

function main() {
  const repoRoot = process.cwd();
  const kpi = readJson(path.join(repoRoot, "config", "aurora-kpi-baseline.json"), { kpis: {} });
  const policy = fs.readFileSync(path.join(repoRoot, "policy", "aurora-external-ai-reduction-policy.md"), "utf8");
  const backlog = [
    {
      id: "reduce-external-ai-fallbacks",
      title: "Reducing external AI fallback paths",
      kind: "autonomy",
      impact: 5,
      evidence: "Policy mandates internal-first routing and explicit fallback reasons."
    },
    {
      id: "add-deterministic-eval-gates",
      title: "Adding deterministic evaluation gates",
      kind: "security",
      impact: 5,
      evidence: "PRs must be gated by local policy, security, and regression checks."
    },
    {
      id: "measure-autonomous-pr-success",
      title: "Measuring autonomous PR success",
      kind: "reliability",
      impact: 4,
      evidence: `Baseline KPI target: ${kpi.kpis?.autonomous_pr_success_rate?.target ?? "unset"}`
    },
    {
      id: "publish-wmgj-runbook",
      title: "Publishing WMGJ ops runbook",
      kind: "docs",
      impact: 2,
      evidence: policy.includes("Revisão mensal") ? "Policy references monthly review" : "Policy present"
    }
  ].map((item) => ({ ...item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (process.env.AURORA_DRY_RUN === "1") {
    process.stdout.write(`${JSON.stringify({ dryRun: true, backlog }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), backlog }, null, 2)}\n`);
}

main();
