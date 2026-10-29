import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { verifyAuroraAccess } from "./auroraAccess.js";
import { auroraDb } from "./firebase.js";
import { loadFinancialClosingStatus } from "./auroraFinancialDecisionRuntime.js";
import { buildShareholderReport } from "./auroraShareholderReport.js";
import { buildFinancialPanelView, mayReadFinancialPanel, renderFinancialPanelHtml,
  validFinancialCompetence } from "./auroraFinancialPanelView.js";

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");

function currentCompetence(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  return String(year) + "-" + String(month);
}

export const auroraNexusFinancialPanel = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS] },
  async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
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
    if (!mayReadFinancialPanel(member)) {
      res.status(403).json({ ok: false, code: "FINANCIAL_ACCESS_DENIED" });
      return;
    }
    // A route/query must never select a tenant; the verified session is authoritative.
    if (req.query.orgId !== undefined && req.query.orgId !== member.orgId) {
      res.status(403).json({ ok: false, code: "TENANT_MISMATCH" });
      return;
    }
    if (req.query.competence !== undefined && !validFinancialCompetence(req.query.competence)) {
      res.status(400).json({ ok: false, code: "INVALID_COMPETENCE" });
      return;
    }
    try {
      const org = await auroraDb.doc("organizations/" + member.orgId).get();
      if (!org.exists || org.data()?.active !== true) {
        res.status(403).json({ ok: false, code: "ORGANIZATION_INACTIVE" });
        return;
      }
      const competence = validFinancialCompetence(req.query.competence)
        ? req.query.competence
        : validFinancialCompetence(org.data()?.projectionCompetence)
          ? org.data()!.projectionCompetence as string
          : currentCompetence();
      const closing = await auroraDb.doc("organizations/" + member.orgId + "/monthlyClosings/" + competence).get();
      const data = closing.exists ? closing.data() ?? {} : null;
      // The canonical financial calculator returns coverage and provenance, not new billing assertions.
      const status = await loadFinancialClosingStatus(member.orgId, competence);
      const report = data ? buildShareholderReport({ ...data, orgId: member.orgId, competence }) : null;
      const view = buildFinancialPanelView({
        orgId: member.orgId,
        orgName: String(org.data()?.name ?? member.orgId).slice(0, 120),
        competence,
        closing: data,
        report,
        status
      });
      const json = req.path.startsWith("/api/");
      if (json) {
        res.status(200).json({ ok: true, financialStatus: view });
      } else {
        res.status(200).type("html").send(renderFinancialPanelHtml(view));
      }
    } catch (error) {
      logger.error("Financial panel read failed", {
        orgId: member.orgId,
        code: error instanceof Error ? error.name : "UNKNOWN"
      });
      res.status(503).json({ ok: false, code: "FINANCIAL_READ_UNAVAILABLE" });
    }
  }
);
