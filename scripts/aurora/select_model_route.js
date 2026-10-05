#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function envBool(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function main() {
  const repoRoot = process.cwd();
  const policyPath = path.join(repoRoot, "policy", "aurora-external-ai-reduction-policy.md");
  const kpiPath = path.join(repoRoot, "config", "aurora-kpi-baseline.json");
  const policyText = fs.existsSync(policyPath) ? fs.readFileSync(policyPath, "utf8") : "";
  const kpi = readJson(kpiPath, {});
  const dryRun = envBool("AURORA_DRY_RUN", false);
  const allowExternal = envBool("AURORA_ALLOW_EXTERNAL_AI", false);
  const forceExternal = envBool("AURORA_FORCE_EXTERNAL_AI", false);
  const sourceReady = envBool("AURORA_CANONICAL_SNAPSHOT_READY", true);
  const internalReady = envBool("AURORA_INTERNAL_ENGINE_READY", true);
  const riskLevel = (process.env.AURORA_CHANGE_RISK || "low").toLowerCase();

  let route = "internal";
  let reason = "internal engine preferred by policy";

  if (!internalReady) {
    route = "local";
    reason = "internal engine unavailable; use local/self-hosted fallback";
  } else if (!sourceReady) {
    route = "local";
    reason = "canonical snapshot not ready; use local/self-hosted fallback";
  } else if ((allowExternal || forceExternal) && riskLevel === "low") {
    route = "external";
    reason = "explicitly permitted by policy and low-risk";
  } else if (forceExternal) {
    route = "external";
    reason = "forced external fallback";
  }

  const output = {
    route,
    reason,
    dryRun,
    policy: {
      file: "policy/aurora-external-ai-reduction-policy.md",
      hasPolicy: Boolean(policyText.trim()),
      externalAllowed: allowExternal,
      forceExternal
    },
    kpi: {
      version: kpi.version ?? null,
      external_ai_dependency_rate: kpi.kpis?.external_ai_dependency_rate?.target ?? null
    }
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
