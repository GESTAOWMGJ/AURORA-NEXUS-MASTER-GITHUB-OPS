export type FinancialFocus = {
  tone: "danger" | "warn" | "info" | "neutral";
  title: string;
  label: string;
  amountCents: number | null;
  explanation: string;
  nextHref: "#monthly-closing-summary" | "#gloss-summary";
  nextLabel: string;
  coverageIncomplete: boolean;
  period: string;
};

/** Values are already canonical cents. Coercion would turn absence into money. */
export function formatFinancialCents(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return "Sem fonte";
  const cents = BigInt(value);
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  // Divide integers only: Number.MAX_SAFE_INTEGER / 100 loses the final cent.
  const signedWhole = cents < 0n ? (whole === 0n ? -0 : -whole) : whole;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .formatToParts(signedWhole)
    .map(part => part.type === "fraction" ? fraction : part.value)
    .join("");
}

function presentationRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function presentationTag(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function presentationPositiveCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function presentationPeriod(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) {
    return "Competência não confirmada";
  }
  return `Competência ${value.slice(5)}/${value.slice(0, 4)}`;
}

function presentationCoverageIncomplete(bootstrap: Record<string, unknown>): boolean {
  const projection = presentationRecord(bootstrap.projection);
  const closing = presentationRecord(bootstrap.financialStatus);
  const quality = presentationRecord(projection.dataQuality);
  const coverage = presentationRecord(projection.coverage);
  if (closing.sourceComplete !== true || quality.complete !== true || quality.sourcePresent !== true
    || presentationTag(projection.completeness) !== "COMPLETE"
    || coverage.evidencePercent !== 100 || coverage.reconciliationPercent !== 100) return true;
  if (!Array.isArray(projection.sources) || projection.sources.length === 0) return true;
  return projection.sources.some(source => {
    const state = presentationRecord(source);
    return state.missing !== false || presentationTag(state.completeness) !== "COMPLETE";
  });
}

function presentationScenario(bootstrap: Record<string, unknown>): "TEST_ONLY" | "SHADOW" | null {
  const projection = presentationRecord(bootstrap.projection);
  const closing = presentationRecord(bootstrap.financialStatus);
  const tags = [bootstrap.environment, bootstrap.mode, projection.environment, projection.mode,
    projection.state, closing.environment, closing.mode, closing.state].map(presentationTag);
  if (bootstrap.testOnly === true || projection.testOnly === true || closing.testOnly === true
    || bootstrap.synthetic === true || projection.synthetic === true || closing.synthetic === true
    || tags.some(tag => ["TEST_ONLY", "SYNTHETIC", "HML_SYNTHETIC"].includes(tag))) return "TEST_ONLY";
  return tags.some(tag => ["SHADOW", "SHADOW_UPDATE"].includes(tag)) ? "SHADOW" : null;
}

/** A presentation priority, never a new financial calculation or authorization. */
export function buildFinancialFocus(input: unknown): FinancialFocus {
  const bootstrap = presentationRecord(input);
  const projection = presentationRecord(bootstrap.projection);
  const financial = presentationRecord(projection.financialCents);
  const closing = presentationRecord(bootstrap.financialStatus);
  const amounts = presentationRecord(closing.amounts);
  const overdue = presentationPositiveCents(amounts.overduePayablesCents);
  const gloss = presentationPositiveCents(financial.glossCents);
  const cashGap = presentationPositiveCents(amounts.revenueToCashGapCents);
  const coverageIncomplete = presentationCoverageIncomplete(bootstrap);
  let focus: FinancialFocus;
  if (overdue !== null) {
    focus = {
      tone: "danger", title: "Contas vencidas não esperam.", label: "Obrigações vencidas",
      amountCents: overdue,
      explanation: "Vencimentos abertos no recorte. Priorize o prazo mais urgente e confira o saldo registrado antes de agir.",
      nextHref: "#monthly-closing-summary", nextLabel: "Ver vencimentos", coverageIncomplete,
      period: presentationPeriod(closing.competence)
    };
  } else if (gloss !== null) {
    focus = {
      tone: "warn", title: "Receita em disputa.", label: "Glosas em revisão", amountCents: gloss,
      explanation: "Glosas registradas na projeção. O valor não comprova perda definitiva nem recuperação; confira causa, prazo e evidência.",
      nextHref: "#gloss-summary", nextLabel: "Revisar glosas", coverageIncomplete,
      period: presentationPeriod(projection.competence)
    };
  } else if (cashGap !== null) {
    focus = {
      tone: "info", title: "Faturar ainda não é receber.", label: "Diferença entre previsão e caixa",
      amountCents: cashGap,
      explanation: "Diferença canônica entre receita prevista e saldo do fechamento. Não representa perda confirmada nem recebimento futuro garantido.",
      nextHref: "#monthly-closing-summary", nextLabel: "Conferir previsão e saldo", coverageIncomplete,
      period: presentationPeriod(closing.competence)
    };
  } else {
    focus = {
      tone: "neutral", title: "Seu caixa merece uma leitura clara.", label: "Resumo financeiro", amountCents: null,
      explanation: "Confira saldo, recebimentos conciliados e próximos vencimentos. A ausência de alerta neste recorte não comprova ausência de obrigações ou perdas.",
      nextHref: "#monthly-closing-summary", nextLabel: "Ver resumo financeiro", coverageIncomplete,
      period: presentationPeriod(closing.competence ?? projection.competence)
    };
  }
  if (coverageIncomplete) focus.explanation += " Valores do recorte. Complete as fontes antes de decidir.";
  const scenario = presentationScenario(bootstrap);
  if (scenario === "TEST_ONLY") {
    focus.explanation += " Cenário de teste: valores sintéticos; não comprovam dinheiro da operação.";
  } else if (scenario === "SHADOW") {
    focus.explanation += " Modo SHADOW: leitura observacional; não libera distribuição ou movimentação financeira.";
  }
  return focus;
}

/** Fixed browser functions only. Render returned text with textContent. */
export function financialPresentationClient(): string {
  return [formatFinancialCents, presentationRecord, presentationTag, presentationPositiveCents,
    presentationPeriod, presentationCoverageIncomplete, presentationScenario, buildFinancialFocus]
    .map(helper => helper.toString()).join("\n\n");
}
