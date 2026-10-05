import { generateNativeInsight, type NativeInsightFinding } from "./auroraNativeIntelligence.js";
import { nativeRoutineSummary } from "./auroraNativeRoutines.js";
import { iaMasterCapability } from "./auroraIaMaster.js";
import { assessNativeData, DATA_GOVERNANCE_POLICY, knownCount, masterCommandSurface } from "./auroraDataGovernance.js";

export const AURORA_MASTER_ENGINE_VERSION = "0.2.0-data-governance";
type MasterContext = {
  actionSummary?: Record<string, unknown>;
  financialStatus?: Record<string, unknown> | null;
  release?: Record<string, unknown>;
};
const SEVERITY_RANK: Record<NativeInsightFinding["severity"], number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function insightFindings(value: Record<string, unknown>): NativeInsightFinding[] {
  return Array.isArray(value.findings) ? value.findings.filter((item): item is NativeInsightFinding =>
    Boolean(item) && typeof item === "object" && typeof (item as NativeInsightFinding).code === "string") : [];
}
function uniqueFindings(groups: NativeInsightFinding[][]): NativeInsightFinding[] {
  const byCode = new Map<string, NativeInsightFinding>();
  for (const item of groups.flat()) {
    const current = byCode.get(item.code);
    if (!current || SEVERITY_RANK[item.severity] > SEVERITY_RANK[current.severity]) byCode.set(item.code, item);
  }
  return [...byCode.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.code.localeCompare(b.code));
}
function governanceReviewFinding(reasonCodes: readonly string[]): NativeInsightFinding {
  const coverageUnproven = reasonCodes.includes("GOV_DOCUMENT_COVERAGE_UNPROVEN");
  return {
    code: "DATA_GOVERNANCE_REVIEW_REQUIRED", severity: "HIGH",
    title: coverageUnproven ? "Cobertura documental não comprovada" : "Revisão documental exigida pela governança",
    detail: reasonCodes.join(", "),
    action: [
      coverageUnproven ? "Regenerar a projeção canônica e validar as contagens documentais ausentes ou inválidas; ausência não representa zero." : "",
      reasonCodes.includes("GOV_DOCUMENT_REVIEW_REQUIRED") ? "Revisar os documentos com fragilidade, dependência da origem ou SLA vencido no fluxo autorizado." : "",
      "Registrar evidências e submeter a revisão humana antes de decidir."
    ].filter(Boolean).join(" "),
    evidencePath: "projection.documentIntelligence"
  };
}

/** Pure planner: no tool calls, financial writes, source access, or model provider. */
export function buildMasterOperationalState(
  projection: Record<string, unknown>, context: MasterContext = {}, now = new Date()
): Record<string, unknown> {
  const assessment = assessNativeData(projection, now);
  const denied = assessment.decision === "DENY";
  // The data gate runs BEFORE inference, including the bootstrap's empty fallback.
  const nativeFindings = denied ? [] : uniqueFindings([
    insightFindings(generateNativeInsight(projection, "EXECUTIVE", now)),
    insightFindings(generateNativeInsight(projection, "REVENUE_RISK", now)),
    insightFindings(generateNativeInsight(projection, "SLA_RISK", now)),
    insightFindings(generateNativeInsight(projection, "DATA_QUALITY", now))
  ]);
  const reviewFinding = assessment.decision === "REVIEW" ? governanceReviewFinding(assessment.reasonCodes) : null;
  // Surface REVIEW reasons before ordinary findings, without masking a critical finding.
  const findings = reviewFinding ? [
    ...nativeFindings.filter(item => item.severity === "CRITICAL"),
    reviewFinding,
    ...nativeFindings.filter(item => item.severity !== "CRITICAL")
  ] : nativeFindings;
  const operations = denied ? {} : record(projection.operations);
  // Do not merge a live, truncated, or cross-period action list into a canonical snapshot.
  const openActions = knownCount(operations.openActions);
  const overdueActions = knownCount(operations.overdueActions);
  const workloadComplete = openActions !== null && overdueActions !== null;
  const critical = findings.filter(item => item.severity === "CRITICAL").length;
  const high = findings.filter(item => item.severity === "HIGH").length;
  const nextFinding: NativeInsightFinding | null = denied ? {
    code: "DATA_GOVERNANCE_BLOCKED", severity: "CRITICAL",
    title: "Leitura operacional bloqueada pela governança de dados",
    detail: assessment.reasonCodes.join(", "),
    action: "Validar identidade, escopo, proveniência, qualidade e atualidade do snapshot no fluxo autorizado. Não ampliar permissões nem apagar evidências para liberar o motor.",
    evidencePath: "projection.nativeDataPlane"
  } : findings[0] ?? (!workloadComplete ? {
    code: "WORKLOAD_UNPROVEN", severity: "HIGH", title: "Carga operacional não comprovada",
    detail: "Contagens ausentes ou inválidas não representam zero.",
    action: "Regenerar a projeção canônica e confirmar cobertura antes de decidir.", evidencePath: "projection.operations"
  } : null);
  const operationalState = denied || critical > 0 ? "BLOCKED"
    : assessment.decision === "REVIEW" || !workloadComplete || findings.length > 0 || (overdueActions ?? 0) > 0 ? "ATTENTION" : "CONTROLLED";
  const cycleStage = operationalState === "BLOCKED" ? "COMPROVAR"
    : operationalState === "ATTENTION" ? "PRIORIZAR" : (openActions ?? 0) > 0 ? "AGIR" : "MEDIR";
  const release = record(context.release);
  return {
    engine: "AURORA_MASTER_OPERATIONAL_ENGINE", version: AURORA_MASTER_ENGINE_VERSION,
    mode: "FIREBASE_NATIVE_GOVERNED", externalProviderUsed: false, externalAiRequired: false,
    sourceAccessDuringInference: false, explainable: true,
    generatedAt: Number.isFinite(now.getTime()) ? now.toISOString() : null,
    operationalState, cycleStage,
    cycle: ["OBSERVAR", "INGESTAR", "COMPROVAR", "CONFRONTAR", "DETECTAR", "PRIORIZAR", "AGIR", "VALIDAR", "MEDIR", "APRENDER", "REUTILIZAR"],
    headline: nextFinding?.title ?? "Nenhuma exceção detectada neste recorte autorizado; isto não comprova ausência de risco.",
    nextAction: nextFinding ? { ...nextFinding, humanGate: true } : null,
    priorities: denied && nextFinding ? [nextFinding] : findings.slice(0, 12),
    // Existing UI uses String(value). Keep presentation explicit; numeric metrics stay nullable.
    workload: {
      openActions: openActions ?? "Sem fonte", overdueActions: overdueActions ?? "Sem fonte",
      criticalFindings: denied ? "Não avaliado" : critical, highFindings: denied ? "Não avaliado" : high
    },
    workloadMetrics: {
      openActions, overdueActions, complete: workloadComplete,
      criticalFindings: denied ? null : critical, highFindings: denied ? null : high
    },
    routines: nativeRoutineSummary(),
    iaMaster: iaMasterCapability(),
    financialGate: {
      competence: denied ? null : projection.competence ?? null,
      distributionState: "USE_AUTHORIZED_FINANCIAL_ENDPOINT",
      canApproveDistribution: false,
      reason: "O Motor Mestre não autoriza distribuição. A decisão pertence ao endpoint autenticado com MFA, revisão e evidência financeira."
    },
    release: {
      productVersion: release.productVersion ?? null, releaseTrain: release.releaseTrain ?? null,
      engineeringReadinessPercent: release.engineeringReadinessPercent ?? null
    },
    commandSurface: masterCommandSurface(assessment.decision),
    governance: {
      ...DATA_GOVERNANCE_POLICY, dataAssessment: assessment,
      humanReviewForCriticalDecisions: true, autonomousSourceMutation: false,
      autonomousFinancialMovement: false, autonomousClinicalDecision: false,
      arbitraryCodeExecution: false, tenantIsolationRequired: true, auditTrailRequired: true,
      executionAuthorization: "NOT_GRANTED_BY_MASTER",
      controlCoverage: "MASTER_DATA_GATE_AND_COMMAND_PLANNING",
      decisionTracePersisted: false,
      auditNote: "Este objeto é uma avaliação; não é uma aprovação, um token de capacidade nem uma gravação no audit ledger."
    },
    knowledge: {
      modusOperandi: "AURORA-MO-001", organicLearning: "AURORA-ORG-001",
      dataGovernance: DATA_GOVERNANCE_POLICY.id,
      nativeIntelligence: "AURORA_NATIVE_INTELLIGENCE", tenantRawDataTransfer: false,
      modelWeightsTrained: false
    },
    source: {
      type: "FIREBASE_CANONICAL_SNAPSHOT", snapshotId: assessment.snapshotId, sourceHash: assessment.sourceHash,
      schemaVersion: projection.schemaVersion ?? null, policyVersion: projection.policyVersion ?? null,
      competence: denied ? null : projection.competence ?? null, asOf: denied ? null : projection.asOf ?? null
    }
  };
}
