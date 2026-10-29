import { formatFinancialCents } from "./auroraFinancialPresentation.js";

type Member = {
  orgId: string;
  role: string;
  permissions: string[];
  allFacilities: boolean;
  mfaVerified: boolean;
};

type RecordMap = Record<string, unknown>;

export function mayReadFinancialPanel(member: Member): boolean {
  if (!member.allFacilities || !member.mfaVerified || member.role === "patient") return false;
  if (["platform_admin", "org_admin", "director", "auditor", "finance"].includes(member.role)) return true;
  return member.permissions.includes("financial.read") || member.permissions.includes("shareholder.report.read");
}

export function validFinancialCompetence(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function record(value: unknown): RecordMap {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordMap : {};
}

function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function safeEvidence(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 512;
}

export type FinancialPanelView = {
  orgId: string;
  orgName: string;
  competence: string;
  observedAt: string;
  closingStatus: string;
  sourceComplete: boolean;
  snapshotHash: string | null;
  financialCents: Record<string, number | null>;
  invoiceIssued: "COMPROVADO" | "NAO_COMPROVADO";
  invoiceSent: "COMPROVADO" | "NAO_COMPROVADO";
  bankReconciled: "COMPROVADO" | "NAO_COMPROVADO";
  notes: string[];
};

export function buildFinancialPanelView(input: {
  orgId: string;
  orgName: string;
  competence: string;
  closing: RecordMap | null;
  report: RecordMap | null;
  status: RecordMap | null;
  now?: Date;
}): FinancialPanelView {
  if (!validFinancialCompetence(input.competence)) throw new Error("INVALID_FINANCIAL_COMPETENCE");
  const report = record(input.report);
  const financial = record(report.financialCents);
  const status = record(input.status);
  const closing = record(input.closing);
  const fields = ["forecastCents", "billableCents", "billedCents", "receivableCents",
    "receivedCents", "cashBalanceCents", "closingResultCents", "glossCents"];
  const values: Record<string, number | null> = {};
  for (const field of fields) values[field] = cents(financial[field]);
  const closingStatus = typeof closing.status === "string" && closing.status.length <= 50
    ? closing.status.trim().toUpperCase() : "NAO_COMPROVADO";
  const sourceComplete = status.sourceComplete === true
    && report.state === "READY_FOR_PDF"
    && record(report.completeness).completeFinancialSnapshot === true;
  const emitted = closing.invoiceXmlReadbackVerified === true
    && safeEvidence(closing.invoiceXmlEvidenceRef)
    && safeEvidence(closing.invoiceNumber);
  const sent = emitted && closing.invoiceSentVerified === true
    && safeEvidence(closing.invoiceSentEvidenceRef)
    && typeof closing.invoiceSentAt === "string" && Number.isFinite(Date.parse(closing.invoiceSentAt));
  const received = closing.bankReconciliationVerified === true
    && safeEvidence(closing.bankReconciliationEvidenceRef)
    && values.receivedCents !== null;
  const hash = record(report.closing).closingHash;
  return {
    orgId: input.orgId,
    orgName: input.orgName,
    competence: input.competence,
    observedAt: (input.now ?? new Date()).toISOString(),
    closingStatus,
    sourceComplete,
    snapshotHash: typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash) ? hash : null,
    financialCents: values,
    invoiceIssued: emitted ? "COMPROVADO" : "NAO_COMPROVADO",
    invoiceSent: sent ? "COMPROVADO" : "NAO_COMPROVADO",
    bankReconciled: received ? "COMPROVADO" : "NAO_COMPROVADO",
    notes: [
      "Dados consultados no fechamento canônico da empresa. A leitura não executa conciliação bancária.",
      "Valor faturado não equivale a nota fiscal enviada; valor recebido não equivale a crédito bancário conciliado.",
      "Ausência de documento ou valor não significa zero, glosa ou inadimplência.",
      sourceComplete ? "Fontes agregadas completas conforme estado registrado." : "Cobertura documental ou aprovação do fechamento ainda incompleta."
    ]
  };
}

function html(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function amount(value: number | null): string {
  return value === null ? "Não comprovado" : formatFinancialCents(value);
}

export function renderFinancialPanelHtml(v: FinancialPanelView): string {
  const rows: Array<[string, number | null]> = [
    ["Produção de referência (estimativa)", v.financialCents.forecastCents ?? null],
    ["Valor apto a faturar (registrado)", v.financialCents.billableCents ?? null],
    ["Faturamento registrado", v.financialCents.billedCents ?? null],
    ["Recebimentos registrados", v.financialCents.receivedCents ?? null],
    ["A receber registrado", v.financialCents.receivableCents ?? null],
    ["Saldo de caixa no fechamento", v.financialCents.cashBalanceCents ?? null],
    ["Resultado do fechamento", v.financialCents.closingResultCents ?? null],
    ["Glosas e divergências em revisão", v.financialCents.glossCents ?? null]
  ];
  const stage: Array<[string, string]> = [
    ["Nota fiscal emitida e XML vinculado", v.invoiceIssued],
    ["Envio da nota ao tomador comprovado", v.invoiceSent],
    ["Recebimento bancário conciliado", v.bankReconciled]
  ];
  const report = [
    "AURORA NEXUS | STATUS FINANCEIRO",
    "Empresa: " + v.orgName,
    "Competência: " + v.competence,
    "Leitura do sistema: " + v.observedAt,
    "Fechamento: " + v.closingStatus,
    "Cobertura: " + (v.sourceComplete ? "completa conforme fonte" : "incompleta / em validação"),
    ...rows.map(([label, value]) => label + ": " + amount(value)),
    ...stage.map(([label, state]) => label + ": " + (state === "COMPROVADO" ? "Com evidência" : "Não comprovado")),
    "Observação: faturamento, envio e caixa são etapas independentes; valores registrados exigem evidências."
  ].join("\n");
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="refresh" content="60"><title>AURORA NEXUS | Situação Financeira</title>'
    + '<style>body{margin:0;background:#f5f1e8;color:#13363c;font:16px/1.55 system-ui,Arial,sans-serif}'
    + 'main{max-width:1000px;margin:24px auto;padding:16px}header{background:#103d47;color:white;padding:24px;border-radius:14px}'
    + 'h1{font:normal 2rem Georgia,serif;margin:0 0 8px}a{color:#0a6570}header a{color:#f6e5bb}'
    + 'h2{font:normal 1.5rem Georgia,serif}.meta{font-size:.86rem;opacity:.9}.box{background:white;padding:20px;border:1px solid #d9ddd9;border-radius:12px;margin-top:15px}'
    + '.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:12px}.tile{padding:14px;background:#f2f6f4;border-radius:10px}'
    + '.tile b{display:block;font-size:.86rem}.value{font-weight:750;font-size:1.24rem;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td{padding:10px 4px;border-bottom:1px solid #e7e9e6}'
    + 'td:last-child{text-align:right;font-weight:600}input,button{font:inherit;padding:10px;border-radius:7px;border:1px solid #aebdb9}button{background:#124e59;color:white;cursor:pointer}'
    + 'textarea{width:100%;box-sizing:border-box;min-height:220px;padding:12px;border:1px solid #cad1ca;border-radius:8px;resize:vertical}'
    + '.warning{border-left:4px solid #b28e49;padding-left:14px}.fine{font-size:.88rem;color:#53686b}@media(max-width:600px){td:last-child{white-space:normal}.box{padding:14px}}'
    + '</style></head><body><main><header><div class="meta">AURORA NEXUS · FIN-STATUS-001 · acesso privado</div>'
    + '<h1>Situação financeira</h1><div>' + html(v.orgName) + ' · competência ' + html(v.competence) + '</div>'
    + '<div class="meta">Consulta em ' + html(v.observedAt) + ' · Atualização da página a cada 60 segundos</div>'
    + '<a href="/portal">Voltar à gestão</a></header>'
    + '<section class="box"><form method="get" action="/financeiro"><label for="period">Competência </label>'
    + '<input id="period" name="competence" type="month" required value="' + html(v.competence) + '">'
    + ' <button type="submit">Consultar</button></form></section>'
    + '<section class="box"><h2>Valores do fechamento</h2><div class="tiles">'
    + rows.slice(2,6).map(([label,value]) => '<div class="tile"><b>' + html(label) + '</b><div class="value">' + html(amount(value)) + '</div></div>').join("")
    + '</div><table>' + rows.map(([label,value]) => '<tr><td>' + html(label) + '</td><td>' + html(amount(value)) + '</td></tr>').join("") + '</table></section>'
    + '<section class="box"><h2>Documentos e conciliação</h2><p>Fechamento: <b>' + html(v.closingStatus)
    + '</b> · Cobertura: <b>' + (v.sourceComplete ? "completa conforme fonte" : "incompleta / em validação") + '</b></p><table>'
    + stage.map(([label,state]) => '<tr><td>' + html(label) + '</td><td>' + (state === "COMPROVADO" ? "Com evidência" : "Não comprovado") + '</td></tr>').join("")
    + '</table><p class="fine warning">Valores do fechamento não constituem prova isolada de emissão fiscal, envio, glosa ou quitação bancária.</p></section>'
    + '<section class="box"><h2>Relatório para os sócios</h2><p class="fine">Selecione o texto abaixo e copie para o grupo institucional.</p>'
    + '<textarea readonly aria-label="Relatório financeiro para copiar">' + html(report) + '</textarea>'
    + '<p class="fine">Este painel usa dados da organização autenticada, não permite selecionar outra empresa e não disponibiliza dados de pacientes.</p>'
    + '</section></main></body></html>';
}
