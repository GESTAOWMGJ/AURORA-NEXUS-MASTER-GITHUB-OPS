import { auroraDesignStyles } from "./auroraDesignSystem.js";
import { formatFinancialCents } from "./auroraFinancialPresentation.js";
import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { can, verifyAuroraAccess } from "./auroraAccess.js";
import { auroraDb } from "./firebase.js";
import { buildShareholderReport } from "./auroraShareholderReport.js";

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");

type ResponseLike = { set(name: string, value: string): unknown };

function apiHeaders(res: ResponseLike, nonce?: string): void {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.set(
    "Content-Security-Policy",
    nonce
      ? `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
      : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  );
}

function safeCompetence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(cents: unknown): string {
  return typeof cents === "number" && Number.isSafeInteger(cents)
    ? formatFinancialCents(cents)
    : "Não comprovado";
}

function reportHtml(report: Record<string, unknown>, nonce: string): string {
  const financial = (report.financialCents && typeof report.financialCents === "object")
    ? report.financialCents as Record<string, unknown>
    : {};
  const exceptionSummary = (report.exceptionSummary && typeof report.exceptionSummary === "object")
    ? report.exceptionSummary as Record<string, unknown>
    : {};
  const closing = (report.closing && typeof report.closing === "object")
    ? report.closing as Record<string, unknown>
    : {};
  const completeness = (report.completeness && typeof report.completeness === "object")
    ? report.completeness as Record<string, unknown>
    : {};

  const rows: Array<[string, unknown]> = [
    ["O que esperávamos receber", financial.forecastCents],
    ["O que estava pronto para faturar", financial.billableCents],
    ["O que já faturamos", financial.billedCents],
    ["O que ainda temos a receber", financial.receivableCents],
    ["O que já entrou", financial.receivedCents],
    ["Valores ainda recuperáveis", financial.recoverableCents],
    ["Glosas e divergências em análise", financial.glossCents],
    ["Despesas", financial.expensesCents],
    ["Tributos", financial.taxesCents],
    ["Repasses", financial.transfersCents],
    ["Saldo em conta", financial.cashBalanceCents],
    ["Resultado apurado no fechamento", financial.closingResultCents],
    ["Quanto pode ser distribuído após validação", financial.distributableCents]
  ];

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AURORA NEXUS | Relatório Financeiro aos Sócios</title>
<style>${auroraDesignStyles()}
body{margin:0;background:var(--bg);color:var(--text)}.page{width:min(1040px,calc(100vw - 32px));margin:32px auto;background:var(--panel);box-shadow:var(--shadow);padding:48px;border-top:4px solid var(--gold);border-radius:0 0 16px 16px}.page>.brand{display:block;letter-spacing:.16em;text-transform:uppercase;color:#81632e;font-size:11px;font-weight:700}.hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}.hero h1{margin:12px 0 10px;font-family:'Source Serif 4',Georgia,serif;font-weight:400;font-size:clamp(28px,3.5vw,38px);letter-spacing:-.025em;line-height:1.15}.hero p{margin:0;color:var(--muted);line-height:1.6}.page .badge{display:inline-flex;border:1px solid var(--line);border-radius:99px;padding:7px 11px;font-size:12px;color:var(--ink);font-weight:650;white-space:nowrap}.page .grid{display:grid;grid-template-columns:1.1fr 1fr;gap:20px}.page .card{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:22px;box-shadow:none;min-width:0}.page .card h2{margin:0 0 18px;font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:21px;color:var(--ink);line-height:1.3}.page table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.5}.page td{padding:12px 0;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.page td:first-child{padding-right:14px}.page td:last-child{text-align:right;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}.page .warn{background:#f4eedf;border-color:#d4bd8e}.gate{background:var(--panel2);border:1px solid #d4bd8e;border-left:3px solid var(--gold);padding:20px;margin-top:22px;line-height:1.65}.gate strong{color:#75521f}.fine{font-size:12px;color:var(--muted);line-height:1.6}.toolbar{display:flex;justify-content:flex-end;margin-bottom:20px}.page .btn{min-height:44px;border:1px solid var(--ink);border-radius:9px;background:var(--ink);color:#fffdf8;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}.page .btn:hover{background:#105064}.page .btn:focus-visible{outline:3px solid var(--info);outline-offset:4px}@media(max-width:800px){.page{padding:28px}.page .grid{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}}@media(max-width:440px){.page{width:calc(100vw - 24px);padding:22px}.page .card{padding:18px}.page table{font-size:13px}.page td{padding:10px 0}.page td:first-child{padding-right:8px}}@media print{@page{size:A4;margin:16mm}body{background:white;color:#000;font-size:10pt}.page{width:auto;margin:0;box-shadow:none;padding:0;border-top:3px solid var(--ink);border-radius:0;background:white}.toolbar{display:none}.hero{margin-bottom:18px;padding-bottom:16px}.hero h1{font-size:24pt}.hero p,.fine{color:#333}.page .grid{display:block}.page .card{border:1px solid #b6bebc;border-radius:0;padding:14px;margin-bottom:16px;background:white;break-inside:auto}.page .card h2{font-size:15pt}.page table{font-size:10pt}.page td{padding:7px 0;border-bottom:1px solid #cbd1cd}.page tr{break-inside:avoid}.page .warn,.gate{background:white;break-inside:avoid}.gate{padding:14px;border-color:#b6bebc}.page>.brand{margin-top:12px;color:var(--ink)}}</style></head><body><main class="page">
<div class="toolbar"><button class="btn" id="print">Exportar / imprimir PDF</button></div>
<div class="brand">AURORA NEXUS · AURORA-FIN-SOC-001</div>
<section class="hero"><div><h1>Relatório Financeiro aos Sócios</h1><p>Competência ${escapeHtml(report.competence)} · organização ${escapeHtml(report.orgId)}<br>Resumo simples: quanto esperávamos, quanto entrou, quanto falta receber e o que pode ser distribuído após validação.</p></div><span class="badge">${escapeHtml(report.state)}</span></section>
<div class="grid">
<section class="card"><h2>Resumo financeiro em linguagem simples</h2><table>${rows.map(([label,value])=>`<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(money(value))}</td></tr>`).join("")}</table></section>
<section class="card warn"><h2>Fechamento e evidência</h2>
<p><strong>Status do fechamento:</strong> ${escapeHtml(closing.status ?? "Não comprovado")}</p>
<p><strong>Fechado em:</strong> ${escapeHtml(closing.closedAt ?? "Não comprovado")}</p>
<p><strong>Aprovação humana:</strong> ${closing.humanApprovalPresent === true ? "Com evidência registrada" : "Não comprovada"}</p>
<p><strong>Exceções abertas:</strong> ${exceptionSummary.openCount === null || exceptionSummary.openCount === undefined ? "Não comprovado" : escapeHtml(exceptionSummary.openCount)}</p>
<p><strong>Valor das exceções abertas:</strong> ${escapeHtml(money(exceptionSummary.openAmountCents))}</p>
<p class="fine">Campos financeiros ausentes: ${Array.isArray(completeness.financialFieldsMissing) && completeness.financialFieldsMissing.length ? escapeHtml(completeness.financialFieldsMissing.join(", ")) : "nenhum no snapshot canônico"}.</p>
</section>
</div>
<section class="gate"><strong>Gate societário.</strong> Este documento não autoriza pagamento, baixa de recebível, aceite de glosa, cobrança externa ou distribuição automática. Qualquer distribuição depende de validação humana expressa e das evidências do fechamento societário vigente.</section>
<p class="fine">Ausência de evidência não é zero. Faturamento não é recebimento. Glosa informada não é glosa aceita. Exceções sobrepostas não são somadas automaticamente. Documento sanitizado e agregado: não contém identificadores de pacientes.</p>
</main><script nonce="${nonce}">document.getElementById("print").addEventListener("click",()=>window.print());</script></body></html>`;
}

export const auroraNexusShareholderReportGenerator = onDocumentWritten(
  "organizations/{orgId}/monthlyClosings/{competence}",
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const orgId = String(event.params.orgId ?? "");
    const competence = safeCompetence(event.params.competence);
    if (!orgId || !competence) {
      logger.error("Shareholder report skipped because path is invalid", { orgId, competence: event.params.competence });
      return;
    }

    const afterData = after.data() as Record<string, unknown>;
    const afterStatus = String(afterData.status ?? "").trim().toUpperCase();
    if (afterStatus !== "CLOSED") return;

    const report = buildShareholderReport({ ...afterData, orgId, competence });
    const reportId = String(report.reportId);
    const closingHash = String((report.closing as Record<string, unknown>).closingHash);
    const base = `organizations/${orgId}`;
    const currentRef = auroraDb.doc(`${base}/shareholderReports/${competence}`);
    const versionRef = auroraDb.doc(`${base}/shareholderReportVersions/${reportId}`);
    const auditRef = auroraDb.doc(`${base}/auditEvents/shareholder-report-${createHash("sha256").update(reportId).digest("hex").slice(0, 32)}`);

    await auroraDb.runTransaction(async (tx) => {
      const current = await tx.get(currentRef);
      if (current.exists && current.data()?.closingHash === closingHash) return;

      tx.create(versionRef, {
        ...report,
        immutable: true,
        createdAt: FieldValue.serverTimestamp()
      });
      tx.set(currentRef, {
        ...report,
        closingHash,
        currentVersionId: reportId,
        supersedesVersionId: current.exists ? current.data()?.currentVersionId ?? null : null,
        createdAt: current.exists ? current.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.set(auditRef, {
        type: "SHAREHOLDER_REPORT_DRAFTED",
        action: "SHAREHOLDER_REPORT_DRAFTED",
        orgId,
        competence,
        reportId,
        closingHash,
        sourceRef: `${base}/monthlyClosings/${competence}`,
        distributionAuthorized: false,
        sourceMutation: false,
        sanitized: true,
        sensitivity: "INTERNAL_RESTRICTED",
        occurredAt: FieldValue.serverTimestamp()
      });
    });
  }
);

export const auroraNexusShareholderReport = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS] },
  async (req, res) => {
    const nonce = randomBytes(24).toString("base64url");
    apiHeaders(res, nonce);
    if (req.method !== "GET") {
      res.set("Allow", "GET");
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const member = await verifyAuroraAccess(req.get("cookie"), ALLOWED_EMAILS.value());
    if (!member) {
      res.status(401).json({ ok: false, code: "AUTH_REQUIRED" });
      return;
    }
    if (!member.allFacilities || !can(member, "shareholder.report.read", ["platform_admin", "org_admin", "director"])) {
      res.status(403).json({ ok: false, code: "PERMISSION_DENIED" });
      return;
    }

    let competence = safeCompetence(req.query.competence);
    if (!competence) {
      const org = await auroraDb.doc(`organizations/${member.orgId}`).get();
      competence = safeCompetence(org.data()?.projectionCompetence);
    }
    if (!competence) {
      res.status(400).json({ ok: false, code: "COMPETENCE_REQUIRED" });
      return;
    }

    const snapshot = await auroraDb.doc(`organizations/${member.orgId}/shareholderReports/${competence}`).get();
    if (!snapshot.exists) {
      res.status(404).json({ ok: false, code: "SHAREHOLDER_REPORT_NOT_READY", competence });
      return;
    }
    const report = snapshot.data() ?? {};
    if (String(req.query.format ?? "").toLowerCase() === "json" || String(req.get("accept") ?? "").includes("application/json")) {
      res.status(200).json({ ok: true, report });
      return;
    }
    res.status(200).type("html").send(reportHtml(report, nonce));
  }
);
