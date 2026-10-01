export const AURORA_NATIVE_INTELLIGENCE_VERSION = "0.2.0-firebase-native";

export type NativeInsightIntent =
  | "EXECUTIVE"
  | "REVENUE_RISK"
  | "SLA_RISK"
  | "DATA_QUALITY"
  | "NEXT_ACTION";

export type NativeInsightFinding = {
  code: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  detail: string;
  action: string;
  evidencePath: string;
};

const INTENTS = new Set<NativeInsightIntent>([
  "EXECUTIVE",
  "REVENUE_RISK",
  "SLA_RISK",
  "DATA_QUALITY",
  "NEXT_ACTION"
]);

const PRIORITY: Record<NativeInsightFinding["severity"], number> = {
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseNativeInsightIntent(value: unknown): NativeInsightIntent | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase() as NativeInsightIntent;
  return INTENTS.has(normalized) ? normalized : null;
}

function finding(
  code: string,
  severity: NativeInsightFinding["severity"],
  title: string,
  detail: string,
  action: string,
  evidencePath: string
): NativeInsightFinding {
  return { code, severity, title, detail, action, evidencePath };
}

function matchesIntent(item: NativeInsightFinding, intent: NativeInsightIntent): boolean {
  if (intent === "EXECUTIVE" || intent === "NEXT_ACTION") return true;
  if (intent === "REVENUE_RISK") {
    return ["FINANCIAL_DATA_QUALITY", "REVENUE_GAP", "GLOSS_EXPOSURE", "RECONCILIATION_GAP"].includes(item.code);
  }
  if (intent === "SLA_RISK") {
    return ["SLA_OVERDUE", "DOCUMENT_SLA_OVERDUE", "FLOW_BOTTLENECK", "AUDIT_FINDINGS"].includes(item.code);
  }
  return ["FINANCIAL_DATA_QUALITY", "EVIDENCE_GAP", "NO_SOURCE", "FIREBASE_NATIVE_GAP", "DOCUMENT_FRAGILITY", "EXTERNAL_AI_PATH"].includes(item.code);
}

export function generateNativeInsight(
  projection: Record<string, unknown>,
  intent: NativeInsightIntent,
  now = new Date()
): Record<string, unknown> {
  const dataQuality = record(projection.dataQuality);
  const financial = record(projection.financialCents);
  const operations = record(projection.operations);
  const coverage = record(projection.coverage);
  const documentIntelligence = record(projection.documentIntelligence);
  const nativeDataPlane = record(projection.nativeDataPlane);

  const findings: NativeInsightFinding[] = [];
  const sourcePresent = dataQuality.sourcePresent === true;
  const invalidFinancialRecords = finiteNumber(dataQuality.invalidFinancialRecords) ?? 0;
  const outstandingCents = finiteNumber(financial.outstandingCents);
  const glossCents = finiteNumber(financial.glossCents);
  const overdueActions = finiteNumber(operations.overdueActions) ?? 0;
  const openFindings = finiteNumber(operations.openFindings) ?? 0;
  const evidencePercent = finiteNumber(coverage.evidencePercent);
  const reconciliationPercent = finiteNumber(coverage.reconciliationPercent);
  const fragileDocuments = finiteNumber(documentIntelligence.fragileDocuments) ?? 0;
  const sourceDependentDocuments = finiteNumber(documentIntelligence.sourceDependentDocuments) ?? 0;
  const overdueDocumentSla = finiteNumber(documentIntelligence.overdueDocumentSla) ?? 0;
  const pendingDocumentFlow = finiteNumber(documentIntelligence.pendingDocumentFlow) ?? 0;
  const externalAiDocuments = finiteNumber(documentIntelligence.externalAiDocuments) ?? 0;

  if (nativeDataPlane.storage !== "FIRESTORE" || nativeDataPlane.sourceAccessDuringInference !== false) {
    findings.push(finding(
      "FIREBASE_NATIVE_GAP",
      "CRITICAL",
      "Plano nativo Firebase incompleto",
      "A inteligência nativa exige snapshot canônico persistido no Firebase e não pode depender de releitura da origem durante a inferência.",
      "Regenerar o snapshot Firebase e bloquear inferência até o contrato sourceAccessDuringInference=false estar comprovado.",
      "projection.nativeDataPlane"
    ));
  } else if (sourceDependentDocuments > 0) {
    findings.push(finding(
      "FIREBASE_NATIVE_GAP",
      "HIGH",
      "Documentos ainda dependentes da origem",
      `${sourceDependentDocuments} documento(s) não possuem snapshot operacional suficiente para continuidade independente da origem.`,
      "Reprocessar somente os documentos dependentes até nativeReady/sourceIndependent ficarem confirmados no Firebase.",
      "projection.documentIntelligence.sourceDependentDocuments"
    ));
  }

  if (!sourcePresent) {
    findings.push(finding(
      "NO_SOURCE",
      "HIGH",
      "Sem fonte operacional suficiente",
      "A projeção atual não possui dados operacionais suficientes para produzir uma leitura confiável.",
      "Validar ingestão, proveniência e competência antes de interpretar ausência de valor como zero.",
      "projection.dataQuality.sourcePresent"
    ));
  }

  if (invalidFinancialRecords > 0) {
    findings.push(finding(
      "FINANCIAL_DATA_QUALITY",
      "CRITICAL",
      "Qualidade financeira bloqueante",
      `${invalidFinancialRecords} registro(s) financeiro(s) não possuem representação canônica válida em centavos.`,
      "Corrigir os registros inválidos e regenerar a projeção antes de calcular margem, perda ou receita recuperada.",
      "projection.dataQuality.invalidFinancialRecords"
    ));
  }

  if (outstandingCents !== null && outstandingCents > 0) {
    findings.push(finding(
      "REVENUE_GAP",
      "HIGH",
      "Diferença entre faturado e recebido",
      `Existe diferença operacional de ${outstandingCents} centavos entre faturado validado e recebido conciliado. Isso ainda não prova perda definitiva.`,
      "Confrontar competência, nota, crédito bancário, glosa, retenção e prazo contratual antes de classificar o valor como revenue leakage.",
      "projection.financialCents.outstandingCents"
    ));
  }

  if (glossCents !== null && glossCents > 0) {
    findings.push(finding(
      "GLOSS_EXPOSURE",
      "MEDIUM",
      "Exposição a glosas",
      `Há ${glossCents} centavos em glosas representadas na projeção atual.`,
      "Priorizar glosas por valor, prazo recursal, causa-raiz e evidência disponível.",
      "projection.financialCents.glossCents"
    ));
  }

  if (overdueActions > 0) {
    findings.push(finding(
      "SLA_OVERDUE",
      "HIGH",
      "SLA vencido",
      `${overdueActions} ação(ões) permanecem abertas além do prazo conhecido.`,
      "Ordenar por risco, aging e impacto; atribuir responsável e registrar evidência de resolução.",
      "projection.operations.overdueActions"
    ));
  }

  if (openFindings > 0) {
    findings.push(finding(
      "AUDIT_FINDINGS",
      "MEDIUM",
      "Achados de auditoria ainda abertos",
      `${openFindings} achado(s) permanecem sem encerramento na projeção atual.`,
      "Revisar materialidade, recorrência, causa-raiz e vínculo com plano de ação.",
      "projection.operations.openFindings"
    ));
  }

  if (fragileDocuments > 0) {
    findings.push(finding(
      "DOCUMENT_FRAGILITY",
      fragileDocuments > 5 ? "HIGH" : "MEDIUM",
      "Fragilidade documental detectada",
      `${fragileDocuments} documento(s) apresentam extração degradada, baixa confiança ou campos canônicos ausentes.`,
      "Abrir tratamento por causa-raiz, origem e recorrência; validar a correção e alimentar o ciclo orgânico somente com resultado comprovado.",
      "projection.documentIntelligence.fragileDocuments"
    ));
  }

  if (overdueDocumentSla > 0) {
    findings.push(finding(
      "DOCUMENT_SLA_OVERDUE",
      "HIGH",
      "SLA documental vencido",
      `${overdueDocumentSla} documento(s) permanecem pendentes após o SLA configurado para a fonte.`,
      "Priorizar por aging e impacto, corrigir o gargalo do fluxo e registrar evidência do fechamento.",
      "projection.documentIntelligence.overdueDocumentSla"
    ));
  }

  if (pendingDocumentFlow > 0) {
    findings.push(finding(
      "FLOW_BOTTLENECK",
      pendingDocumentFlow > 10 ? "HIGH" : "MEDIUM",
      "Gargalo no fluxo documental",
      `${pendingDocumentFlow} documento(s) ainda não atingiram estado VALIDATED/CLOSED.`,
      "Separar fila por origem (MV/TASY/ERP), estágio e fragilidade; promover melhoria orgânica somente após validação humana do resultado.",
      "projection.documentIntelligence.pendingDocumentFlow"
    ));
  }

  if (externalAiDocuments > 0) {
    findings.push(finding(
      "EXTERNAL_AI_PATH",
      "LOW",
      "Uso residual de IA externa",
      `${externalAiDocuments} documento(s) registram classificação por provedor externo.`,
      "Revisar se o padrão já pode ser absorvido por regra nativa antes de novas chamadas externas.",
      "projection.documentIntelligence.externalAiDocuments"
    ));
  }

  if (evidencePercent !== null && evidencePercent < 100) {
    findings.push(finding(
      "EVIDENCE_GAP",
      evidencePercent < 80 ? "HIGH" : "MEDIUM",
      "Cobertura documental incompleta",
      `Cobertura de evidências em ${evidencePercent}%.`,
      "Completar fontes faltantes antes de promover inferências para fatos confirmados.",
      "projection.coverage.evidencePercent"
    ));
  }

  if (reconciliationPercent !== null && reconciliationPercent < 100) {
    findings.push(finding(
      "RECONCILIATION_GAP",
      reconciliationPercent < 80 ? "HIGH" : "MEDIUM",
      "Conciliação incompleta",
      `Cobertura de conciliação em ${reconciliationPercent}%.`,
      "Fechar diferenças por competência e preservar pendências não conciliadas como exceções abertas.",
      "projection.coverage.reconciliationPercent"
    ));
  }

  const relevant = findings
    .filter((item) => matchesIntent(item, intent))
    .sort((a, b) => PRIORITY[b.severity] - PRIORITY[a.severity] || a.code.localeCompare(b.code));

  const selected = intent === "NEXT_ACTION" ? relevant.slice(0, 1) : relevant.slice(0, 6);
  const headline = selected.length === 0
    ? "Nenhuma exceção explicável foi detectada para este recorte."
    : selected[0]!.title;

  return {
    engine: "AURORA_NATIVE_INTELLIGENCE",
    version: AURORA_NATIVE_INTELLIGENCE_VERSION,
    mode: "FIREBASE_NATIVE_DETERMINISTIC",
    externalProviderUsed: false,
    explainable: true,
    intent,
    generatedAt: now.toISOString(),
    headline,
    findings: selected,
    limitation: "Motor nativo: análise determinística exclusiva do snapshot governado no Firebase. Não relê a origem durante a inferência, não usa provedor externo e mantém revisão humana para decisões críticas.",
    source: {
      type: "FIREBASE_CANONICAL_SNAPSHOT",
      schemaVersion: projection.schemaVersion ?? null,
      policyVersion: projection.policyVersion ?? null,
      competence: projection.competence ?? null,
      asOf: projection.asOf ?? null,
      sourceAccessRequired: false,
      externalAiRequired: false
    }
  };
}
