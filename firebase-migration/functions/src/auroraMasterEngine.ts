import { generateNativeInsight, type NativeInsightFinding } from "./auroraNativeIntelligence.js";
import { nativeRoutineSummary } from "./auroraNativeRoutines.js";

export const AURORA_MASTER_ENGINE_VERSION = "0.1.0-native-governed";

type MasterContext = {
  actionSummary?: Record<string, unknown>;
  financialStatus?: Record<string, unknown> | null;
  release?: Record<string, unknown>;
};

const SEVERITY_RANK: Record<NativeInsightFinding["severity"], number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function insightFindings(value: Record<string, unknown>): NativeInsightFinding[] {
  return Array.isArray(value.findings)
    ? value.findings.filter((item): item is NativeInsightFinding =>
        Boolean(item) && typeof item === "object" && typeof (item as NativeInsightFinding).code === "string")
    : [];
}

function uniqueFindings(groups: NativeInsightFinding[][]): NativeInsightFinding[] {
  const byCode = new Map<string, NativeInsightFinding>();
  for (const item of groups.flat()) {
    const current = byCode.get(item.code);
    if (!current || SEVERITY_RANK[item.severity] > SEVERITY_RANK[current.severity]) {
      byCode.set(item.code, item);
    }
  }
  return [...byCode.values()]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.code.localeCompare(b.code));
}

export function buildMasterOperationalState(
  projection: Record<string, unknown>,
  context: MasterContext = {},
  now = new Date()
): Record<string, unknown> {
  const executive = generateNativeInsight(projection, "EXECUTIVE", now);
  const revenue = generateNativeInsight(projection, "REVENUE_RISK", now);
  const sla = generateNativeInsight(projection, "SLA_RISK", now);
  const quality = generateNativeInsight(projection, "DATA_QUALITY", now);
  const next = generateNativeInsight(projection, "NEXT_ACTION", now);

  const findings = uniqueFindings([
    insightFindings(executive),
    insightFindings(revenue),
    insightFindings(sla),
    insightFindings(quality)
  ]).slice(0, 12);
  const nextFinding = insightFindings(next)[0] ?? null;
  const critical = findings.filter((item) => item.severity === "CRITICAL").length;
  const high = findings.filter((item) => item.severity === "HIGH").length;
  const summary = record(context.actionSummary);
  const operations = record(projection.operations);
  const hasActionSummary = Object.keys(summary).length > 0;
  const openActions = hasActionSummary
    ? finiteNumber(summary.open) + finiteNumber(summary.inProgress)
    : finiteNumber(operations.openActions);
  const overdueActions = hasActionSummary
    ? finiteNumber(summary.overdue)
    : finiteNumber(operations.overdueActions);
  const routines = record(projection.nativeRoutines);
  const routineState = Object.keys(routines).length > 0 ? routines : nativeRoutineSummary();
  const release = record(context.release);
  const financial = record(context.financialStatus);

  const operationalState = critical > 0
    ? "BLOCKED"
    : high > 0 || overdueActions > 0
      ? "ATTENTION"
      : "CONTROLLED";
  const cycleStage = critical > 0
    ? "COMPROVAR"
    : high > 0 || overdueActions > 0
      ? "PRIORIZAR"
      : openActions > 0
        ? "AGIR"
        : findings.length > 0
          ? "VALIDAR"
          : "MEDIR";

  return {
    engine: "AURORA_MASTER_OPERATIONAL_ENGINE",
    version: AURORA_MASTER_ENGINE_VERSION,
    mode: "FIREBASE_NATIVE_GOVERNED",
    externalProviderUsed: false,
    externalAiRequired: false,
    sourceAccessDuringInference: false,
    explainable: true,
    generatedAt: now.toISOString(),
    operationalState,
    cycleStage,
    cycle: [
      "OBSERVAR",
      "INGESTAR",
      "COMPROVAR",
      "CONFRONTAR",
      "DETECTAR",
      "PRIORIZAR",
      "AGIR",
      "VALIDAR",
      "MEDIR",
      "APRENDER",
      "REUTILIZAR"
    ],
    headline: nextFinding?.title ?? "Operação sem exceção prioritária detectada no snapshot atual.",
    nextAction: nextFinding ? {
      code: nextFinding.code,
      severity: nextFinding.severity,
      title: nextFinding.title,
      detail: nextFinding.detail,
      action: nextFinding.action,
      evidencePath: nextFinding.evidencePath,
      humanGate: ["CRITICAL", "HIGH"].includes(nextFinding.severity)
    } : null,
    priorities: findings,
    workload: {
      openActions,
      overdueActions,
      criticalFindings: critical,
      highFindings: high
    },
    routines: routineState,
    financialGate: {
      competence: projection.competence ?? null,
      distributionState: financial.distributionGateState ?? null,
      canApproveDistribution: financial.canApproveDistribution === true
    },
    release: {
      productVersion: release.productVersion ?? null,
      releaseTrain: release.releaseTrain ?? null,
      engineeringReadinessPercent: release.engineeringReadinessPercent ?? null
    },
    commandSurface: [
      { command: "REFRESH_PROJECTION", endpoint: "/api/refresh", humanGate: false, sourceMutation: false },
      { command: "CREATE_REVIEW", endpoint: "/api/actions", humanGate: true, sourceMutation: false },
      { command: "ACKNOWLEDGE_ACTION", endpoint: "/api/actions", humanGate: true, sourceMutation: false },
      { command: "RESOLVE_WITH_EVIDENCE", endpoint: "/api/actions", humanGate: true, sourceMutation: false },
      { command: "MANAGE_INTEGRATION", endpoint: "/api/integration-keys", humanGate: true, sourceMutation: false },
      { command: "DISTRIBUTION_DECISION", endpoint: "/api/distribution-approval", humanGate: true, sourceMutation: false }
    ],
    governance: {
      humanReviewForCriticalDecisions: true,
      autonomousSourceMutation: false,
      autonomousFinancialMovement: false,
      autonomousClinicalDecision: false,
      arbitraryCodeExecution: false,
      tenantIsolationRequired: true,
      auditTrailRequired: true
    },
    knowledge: {
      modusOperandi: "AURORA-MO-001",
      organicLearning: "AURORA-ORG-001",
      nativeIntelligence: "AURORA_NATIVE_INTELLIGENCE",
      tenantRawDataTransfer: false
    },
    source: {
      type: "FIREBASE_CANONICAL_SNAPSHOT",
      schemaVersion: projection.schemaVersion ?? null,
      policyVersion: projection.policyVersion ?? null,
      competence: projection.competence ?? null,
      asOf: projection.asOf ?? projection.generatedAt ?? null
    }
  };
}
