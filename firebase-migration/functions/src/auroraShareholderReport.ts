import { createHash } from "node:crypto";

export const AURORA_SHAREHOLDER_REPORT_SKILL_ID = "AURORA-FIN-SOC-001";
export const AURORA_SHAREHOLDER_REPORT_VERSION = 1;
export const AURORA_SHAREHOLDER_REPORT_TEMPLATE = "AURORA-FIN-SOC-001-INSTITUTIONAL-v1";

export type ShareholderReportState =
  | "BLOCKED_CLOSING"
  | "REQUIRES_HUMAN_APPROVAL_EVIDENCE"
  | "READY_FOR_PDF";

type FinancialKey =
  | "forecastCents"
  | "billableCents"
  | "billedCents"
  | "receivableCents"
  | "receivedCents"
  | "recoverableCents"
  | "glossCents"
  | "expensesCents"
  | "taxesCents"
  | "transfersCents"
  | "closingResultCents";

const FINANCIAL_KEYS: FinancialKey[] = [
  "forecastCents",
  "billableCents",
  "billedCents",
  "receivableCents",
  "receivedCents",
  "recoverableCents",
  "glossCents",
  "expensesCents",
  "taxesCents",
  "transfersCents",
  "closingResultCents"
];

const LABELS: Record<FinancialKey, string> = {
  forecastCents: "Receita prevista",
  billableCents: "Receita faturável",
  billedCents: "Receita faturada",
  receivableCents: "Recebível",
  receivedCents: "Recebido",
  recoverableCents: "Receita recuperável",
  glossCents: "Glosas/divergências informadas",
  expensesCents: "Despesas",
  taxesCents: "Tributos",
  transfersCents: "Repasses",
  closingResultCents: "Resultado de fechamento"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function safeCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeArrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function normalizedStatus(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function timestampIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
      return (value as { toDate(): Date }).toDate().toISOString();
    }
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stableValue((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
  }
  return value;
}

export function shareholderClosingHash(closing: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(stableValue(closing))).digest("hex");
}

function financialMap(closing: Record<string, unknown>): Record<FinancialKey, number | null> {
  const source = isRecord(closing.financialCents) ? closing.financialCents : {};
  return Object.fromEntries(FINANCIAL_KEYS.map((key) => [key, safeCents(source[key])])) as Record<FinancialKey, number | null>;
}

function approvalEvidencePresent(closing: Record<string, unknown>): boolean {
  return safeArrayCount(closing.approvalRefs) > 0
    || safeArrayCount(closing.approvals) > 0
    || Boolean(safeString(closing.approvedBy, 160));
}

function brl(cents: number | null): string {
  return cents === null
    ? "Não comprovado"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function reportMarkdown(
  orgId: string,
  competence: string,
  closingStatus: string,
  state: ShareholderReportState,
  financial: Record<FinancialKey, number | null>,
  openExceptionCount: number | null,
  openExceptionAmountCents: number | null,
  humanApprovalPresent: boolean
): string {
  const lines = [
    "# AURORA NEXUS",
    "## Relatório Financeiro aos Sócios",
    "",
    `**Organização:** ${orgId}`,
    `**Competência:** ${competence}`,
    `**Fechamento:** ${closingStatus || "NÃO COMPROVADO"}`,
    `**Estado do relatório:** ${state}`,
    "",
    "### Síntese financeira",
    ...FINANCIAL_KEYS.map((key) => `- **${LABELS[key]}:** ${brl(financial[key])}`),
    "",
    "### Pendências e exceções",
    `- **Exceções abertas:** ${openExceptionCount === null ? "Não comprovado" : openExceptionCount}`,
    `- **Valor agregado das exceções abertas:** ${brl(openExceptionAmountCents)}`,
    "",
    "### Governança do fechamento",
    `- **Evidência de aprovação humana:** ${humanApprovalPresent ? "Presente" : "Não comprovada"}`,
    "- Ausência de evidência permanece ausência de evidência; nunca é convertida em zero.",
    "- Faturamento não é tratado como recebimento; recebimento exige crédito bancário conciliado.",
    "- Glosa informada não equivale a glosa aceita ou encerrada.",
    "- Pendências potencialmente sobrepostas não são somadas automaticamente.",
    "- O relatório não autoriza pagamento, baixa de recebível, distribuição, alteração de fonte ou cobrança externa.",
    "",
    "### Gate societário",
    "**Distribuição financeira: NÃO AUTORIZADA AUTOMATICAMENTE.**",
    "A deliberação societária exige validação humana expressa e as evidências previstas no gate distributivo vigente."
  ];
  return lines.join("\n");
}

export function buildShareholderReport(
  closing: Record<string, unknown>,
  now = new Date()
): Record<string, unknown> {
  const orgId = safeString(closing.orgId, 120) ?? "wmgj";
  const competence = safeString(closing.competence, 7) ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) throw new Error("INVALID_CLOSING_COMPETENCE");

  const closingStatus = normalizedStatus(closing.status);
  const humanApprovalPresent = approvalEvidencePresent(closing);
  const state: ShareholderReportState =
    closingStatus !== "CLOSED"
      ? "BLOCKED_CLOSING"
      : humanApprovalPresent
        ? "READY_FOR_PDF"
        : "REQUIRES_HUMAN_APPROVAL_EVIDENCE";

  const financial = financialMap(closing);
  const exceptionSummary = isRecord(closing.exceptionSummary) ? closing.exceptionSummary : {};
  const openExceptionCount = safeCount(exceptionSummary.openCount);
  const openExceptionAmountCents = safeCents(exceptionSummary.openAmountCents);
  const closingHash = shareholderClosingHash(closing);
  const reportId = `FIN-SOC-${competence}-${closingHash.slice(0, 16)}`;

  const missingFinancialFields = FINANCIAL_KEYS.filter((key) => financial[key] === null);
  const evidenceCount = safeArrayCount(closing.evidenceRefs);
  const closedAt = timestampIso(closing.closedAt);

  return {
    schemaVersion: AURORA_SHAREHOLDER_REPORT_VERSION,
    skillId: AURORA_SHAREHOLDER_REPORT_SKILL_ID,
    templateId: AURORA_SHAREHOLDER_REPORT_TEMPLATE,
    reportId,
    orgId,
    competence,
    generatedAt: now.toISOString(),
    closing: {
      status: closingStatus || null,
      closedAt,
      closingHash,
      evidenceCount,
      humanApprovalPresent
    },
    state,
    financialCents: financial,
    exceptionSummary: {
      openCount: openExceptionCount,
      openAmountCents: openExceptionAmountCents
    },
    completeness: {
      financialFieldsMissing: missingFinancialFields,
      completeFinancialSnapshot: missingFinancialFields.length === 0
    },
    governance: {
      absenceIsZero: false,
      billingEqualsReceipt: false,
      glossAutoAccepted: false,
      overlappingExceptionsAutoSummed: false,
      sourceMutationAllowed: false,
      externalCollectionAllowed: false,
      paymentAllowed: false,
      automaticDistributionAllowed: false
    },
    pdf: {
      institutional: true,
      sourceFormat: "MARKDOWN",
      ready: state === "READY_FOR_PDF",
      autoSend: false,
      autoDistribution: false
    },
    institutionalMarkdown: reportMarkdown(
      orgId,
      competence,
      closingStatus,
      state,
      financial,
      openExceptionCount,
      openExceptionAmountCents,
      humanApprovalPresent
    ),
    sensitivity: "INTERNAL_RESTRICTED",
    sanitized: true
  };
}
