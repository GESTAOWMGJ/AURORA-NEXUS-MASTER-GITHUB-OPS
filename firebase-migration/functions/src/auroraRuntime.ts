import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {
  can,
  CSRF_PURPOSES,
  DEFAULT_ORG_ID,
  validCsrf,
  verifyAuroraAccess,
  type AuroraMember
} from "./auroraAccess.js";
import { buildProjection, parseActionCommand, type ProjectionSource } from "./auroraEngine.js";
import { auroraDb } from "./firebase.js";

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const CSRF_HMAC_KEY = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
const SOURCE_LIMIT = 1000;
const sourceCollections = ["invoices", "bankTransactions", "glosses", "actionItems", "sourceDocuments", "reconciliations", "auditFindings"] as const;

type ResponseLike = { set(name: string, value: string): unknown };
type ProjectionActor = { uid: string; role: string; source: "USER" | "SCHEDULER" };

function apiHeaders(res: ResponseLike): void {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function safeString(value: unknown, max = 256): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function publicAction(id: string, data: Record<string, unknown>): Record<string, unknown> | null {
  const targetType = safeString(data.targetType, 64);
  const targetId = safeString(data.targetId, 160);
  const reasonCode = safeString(data.reasonCode, 64);
  const riskLevel = safeString(data.riskLevel, 16);
  const status = safeString(data.status, 32);
  const revision = data.revision;
  if (!targetType || !targetId || !reasonCode || !riskLevel || !status || !Number.isSafeInteger(revision)) return null;
  if (!["invoice", "bankTransaction", "sourceDocument", "reconciliation", "auditFinding"].includes(targetType)) return null;
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(riskLevel)) return null;
  if (!["OPEN", "ACKNOWLEDGED"].includes(status)) return null;
  const dueAt = data.dueAt && typeof data.dueAt === "object" && "toDate" in data.dueAt && typeof (data.dueAt as { toDate?: unknown }).toDate === "function"
    ? (data.dueAt as { toDate(): Date }).toDate().toISOString()
    : typeof data.dueAt === "string" && Number.isFinite(Date.parse(data.dueAt)) ? data.dueAt : null;
  return { id, targetType, targetId, reasonCode, riskLevel, status, revision, dueAt };
}

function sameOriginMutation(req: { get(name: string): string | undefined }): boolean {
  const fetchSite = req.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

function isJson(req: { get(name: string): string | undefined }): boolean {
  return String(req.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function requireAccess(req: { get(name: string): string | undefined }, res: any): Promise<AuroraMember | null> {
  const member = await verifyAuroraAccess(req.get("cookie"), ALLOWED_EMAILS.value());
  if (!member) res.status(401).json({ ok: false, code: "AUTH_REQUIRED" });
  else if (!member.allFacilities) res.status(403).json({ ok: false, code: "ORG_WIDE_SCOPE_REQUIRED" });
  else return member;
  return null;
}

async function readProjectionSource(orgId: string): Promise<ProjectionSource> {
  const entries = await Promise.all(sourceCollections.map(async (name) => {
    const snapshot = await auroraDb.collection(`organizations/${orgId}/${name}`).limit(SOURCE_LIMIT + 1).get();
    if (snapshot.size > SOURCE_LIMIT) throw new Error(`SOURCE_LIMIT_EXCEEDED:${name}`);
    return [name, snapshot.docs.map((doc) => doc.data())] as const;
  }));
  return Object.fromEntries(entries) as ProjectionSource;
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

function deterministicSnapshotId(competence: string): string {
  return createHash("sha256").update(`dashboardSnapshot:${competence}`).digest("hex").slice(0, 48);
}

async function projectionSettings(orgId: string): Promise<{ competence: string; enabled: boolean }> {
  const organization = await auroraDb.doc(`organizations/${orgId}`).get();
  if (!organization.exists || organization.data()?.active === false) throw new Error("ORGANIZATION_DISABLED");
  const data = organization.data() ?? {};
  const competence = safeString(data.projectionCompetence, 7) ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) throw new Error("PROJECTION_COMPETENCE_REQUIRED");
  return { competence, enabled: data.projectionEnabled === true && data.projectionMode === "SHADOW" };
}

export async function refreshProjection(orgId = DEFAULT_ORG_ID, actor: ProjectionActor = { uid: "scheduler", role: "system", source: "SCHEDULER" }): Promise<Record<string, unknown>> {
  const settings = await projectionSettings(orgId);
  if (!settings.enabled) throw new Error("PROJECTION_DISABLED");
  const source = await readProjectionSource(orgId);
  const projection = buildProjection(source, new Date(), { orgId, competence: settings.competence });
  const dataQuality = projection.dataQuality as Record<string, unknown>;
  if (projection.state === "NO_SOURCE") throw new Error("PROJECTION_NO_SOURCE");
  if (dataQuality.complete !== true) throw new Error("PROJECTION_DATA_QUALITY_BLOCKED");

  const snapshotId = randomUUID();
  const sourceHash = createHash("sha256").update(JSON.stringify(stableValue(source))).digest("hex");
  const storedProjection = {
    ...projection,
    generatedAt: FieldValue.serverTimestamp(),
    engine: { name: "aurora-projection", version: 2, mode: "SHADOW" },
    sourceLimit: SOURCE_LIMIT,
    sourceHash,
    snapshotId
  };
  const base = `organizations/${orgId}`;
  await auroraDb.runTransaction(async (tx) => {
    tx.create(auroraDb.doc(`${base}/dashboardSnapshotHistory/${snapshotId}`), storedProjection);
    tx.set(auroraDb.doc(`${base}/dashboardSnapshots/${deterministicSnapshotId(settings.competence)}`), storedProjection);
    tx.set(auroraDb.doc(`${base}/dashboardSnapshots/current`), storedProjection);
    tx.create(auroraDb.doc(`${base}/auditEvents/${randomUUID()}`), {
      action: "DASHBOARD_PROJECTION_REFRESHED",
      type: "DASHBOARD_PROJECTION_REFRESHED",
      actorUid: actor.uid,
      actorRole: actor.role,
      actorSource: actor.source,
      competence: settings.competence,
      snapshotId,
      sourceHash,
      occurredAt: FieldValue.serverTimestamp(),
      sanitized: true,
      sensitivity: "INTERNAL"
    });
  });
  return projection;
}

function visibleProjection(projection: Record<string, unknown>, member: AuroraMember): Record<string, unknown> {
  const mayReadFinance = can(member, "financial.read", ["platform_admin", "org_admin", "director", "auditor", "finance"]);
  if (mayReadFinance) return projection;
  return {
    ...projection,
    financial: { billedAmount: null, receivedAmount: null, pendingAmount: null, reconciliationDifference: null, currency: "BRL" },
    financialCents: { invoicedCents: null, receivedCents: null, glossCents: null, outstandingCents: null }
  };
}

export const auroraNexusBootstrap = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS] },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "GET") { res.set("Allow", "GET"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!can(member, "dashboard.read", ["platform_admin", "org_admin", "director", "auditor", "operator", "finance", "viewer"])) { res.status(403).json({ ok: false, code: "PERMISSION_DENIED" }); return; }
    const mayReadActions = can(member, "actions.read", ["platform_admin", "org_admin", "director", "auditor", "operator", "finance"]);
    const [org, snapshot, actions] = await Promise.all([
      auroraDb.doc(`organizations/${member.orgId}`).get(),
      auroraDb.doc(`organizations/${member.orgId}/dashboardSnapshots/current`).get(),
      mayReadActions
        ? auroraDb.collection(`organizations/${member.orgId}/actionItems`).where("status", "in", ["OPEN", "ACKNOWLEDGED"]).limit(50).get()
        : Promise.resolve(null)
    ]);
    const empty: ProjectionSource = { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [] };
    const competence = safeString(org.data()?.projectionCompetence, 7) ?? new Date().toISOString().slice(0, 7);
    const rawProjection = snapshot.exists
      ? { ...snapshot.data(), generatedAt: snapshot.data()?.generatedAt?.toDate?.().toISOString?.() ?? null }
      : { ...buildProjection(empty, new Date(), { orgId: member.orgId, competence }), generatedAt: null };
    const safeActions = actions ? actions.docs.map((doc) => publicAction(doc.id, doc.data())).filter((item): item is Record<string, unknown> => item !== null) : [];
    res.status(200).json({
      ok: true,
      environment: "HOMOLOGATION",
      mode: "SHADOW",
      organization: { id: member.orgId, name: String(org.data()?.name ?? "WMGJ") },
      member: { email: member.email, role: member.role, mfaVerified: member.mfaVerified },
      projection: visibleProjection(rawProjection, member),
      actions: safeActions
    });
  }
);

export const auroraNexusRefresh = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS, CSRF_HMAC_KEY], timeoutSeconds: 120, memory: "512MiB" },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "POST") { res.set("Allow", "POST"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    if (!sameOriginMutation(req)) { res.status(403).json({ ok: false, code: "CROSS_SITE_REJECTED" }); return; }
    if (!isJson(req)) { res.status(415).json({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"), CSRF_HMAC_KEY.value(), CSRF_PURPOSES.refresh)) { res.status(403).json({ ok: false, code: "CSRF_REJECTED" }); return; }
    if (!can(member, "dashboard.refresh", ["platform_admin", "org_admin", "director", "auditor"])) { res.status(403).json({ ok: false, code: "PERMISSION_DENIED" }); return; }
    try {
      const projection = await refreshProjection(member.orgId, { uid: member.uid, role: member.role, source: "USER" });
      res.status(200).json({ ok: true, projection: visibleProjection(projection, member) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "PROJECTION_FAILED";
      const status = ["PROJECTION_DISABLED", "PROJECTION_NO_SOURCE", "PROJECTION_DATA_QUALITY_BLOCKED", "PROJECTION_COMPETENCE_REQUIRED"].includes(code) ? 409 : 500;
      if (status === 500) logger.error("Aurora projection failed", { code });
      res.status(status).json({ ok: false, code: status === 500 ? "PROJECTION_FAILED" : code });
    }
  }
);

export const auroraNexusAction = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS, CSRF_HMAC_KEY] },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "POST") { res.set("Allow", "POST"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    if (!sameOriginMutation(req)) { res.status(403).json({ ok: false, code: "CROSS_SITE_REJECTED" }); return; }
    if (!isJson(req)) { res.status(415).json({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"), CSRF_HMAC_KEY.value(), CSRF_PURPOSES.action)) { res.status(403).json({ ok: false, code: "CSRF_REJECTED" }); return; }
    if (!can(member, "actions.write", ["platform_admin", "org_admin", "director", "auditor", "operator"])) { res.status(403).json({ ok: false, code: "PERMISSION_DENIED" }); return; }
    const command = parseActionCommand(req.body);
    const idempotencyKey = String(req.get("idempotency-key") ?? "");
    if (!command) { res.status(400).json({ ok: false, code: "INVALID_COMMAND" }); return; }
    if (command.type === "RESOLVE" && !can(member, "actions.resolve", ["platform_admin", "org_admin", "director", "auditor"])) { res.status(403).json({ ok: false, code: "RESOLUTION_PERMISSION_REQUIRED" }); return; }
    if (!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) { res.status(400).json({ ok: false, code: "INVALID_IDEMPOTENCY_KEY" }); return; }
    const commandHash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const idemId = createHash("sha256").update(`${member.orgId}:${idempotencyKey}`).digest("hex");
    try {
      const result = await auroraDb.runTransaction(async (tx) => {
        const idemRef = auroraDb.doc(`organizations/${member.orgId}/apiIdempotency/${idemId}`);
        const idem = await tx.get(idemRef);
        if (idem.exists) {
          if (idem.data()?.commandHash !== commandHash) throw new Error("IDEMPOTENCY_CONFLICT");
          return { actionId: String(idem.data()?.actionId), duplicate: true };
        }
        const actionRef = command.type === "CREATE_REVIEW"
          ? auroraDb.doc(`organizations/${member.orgId}/actionItems/${randomUUID()}`)
          : auroraDb.doc(`organizations/${member.orgId}/actionItems/${command.actionId}`);
        if (command.type === "CREATE_REVIEW") {
          tx.create(actionRef, {
            orgId: member.orgId,
            targetType: command.targetType,
            targetId: command.targetId,
            reasonCode: command.reasonCode,
            riskLevel: command.riskLevel,
            competence: command.competence,
            dueAt: Timestamp.fromDate(new Date(command.dueAt)),
            status: "OPEN",
            revision: 1,
            createdBy: member.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            sanitized: true,
            sensitivity: "INTERNAL"
          });
        } else {
          const current = await tx.get(actionRef);
          if (!current.exists) throw new Error("ACTION_NOT_FOUND");
          const currentData = current.data() ?? {};
          if (currentData.revision !== command.expectedRevision) throw new Error("REVISION_CONFLICT");
          const currentStatus = safeString(currentData.status, 32);
          if (!currentStatus || ["RESOLVED", "CANCELLED"].includes(currentStatus)) throw new Error("INVALID_TRANSITION");
          if (command.type === "ACKNOWLEDGE" && currentStatus !== "OPEN") throw new Error("INVALID_TRANSITION");
          if (command.type === "RESOLVE") {
            if (currentStatus !== "ACKNOWLEDGED") throw new Error("INVALID_TRANSITION");
            if (["HIGH", "CRITICAL"].includes(String(currentData.riskLevel)) && !member.mfaVerified) throw new Error("MFA_REQUIRED");
          }
          tx.update(actionRef, {
            status: command.type === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED",
            resolutionCode: command.type === "RESOLVE" ? command.resolutionCode : null,
            evidenceRefs: command.type === "RESOLVE" ? command.evidenceRefs : [],
            revision: command.expectedRevision + 1,
            updatedBy: member.uid,
            updatedAt: FieldValue.serverTimestamp()
          });
        }
        const eventRef = auroraDb.doc(`organizations/${member.orgId}/auditEvents/${randomUUID()}`);
        tx.create(eventRef, {
          action: `ACTION_${command.type}`,
          type: `ACTION_${command.type}`,
          actionId: actionRef.id,
          actorUid: member.uid,
          actorRole: member.role,
          commandHash,
          occurredAt: FieldValue.serverTimestamp(),
          sanitized: true,
          sensitivity: "INTERNAL"
        });
        tx.create(idemRef, { commandHash, actionId: actionRef.id, createdAt: FieldValue.serverTimestamp() });
        return { actionId: actionRef.id, duplicate: false };
      });
      res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACTION_FAILED";
      const status = code === "ACTION_NOT_FOUND" ? 404
        : code === "MFA_REQUIRED" ? 403
          : ["IDEMPOTENCY_CONFLICT", "REVISION_CONFLICT", "INVALID_TRANSITION"].includes(code) ? 409 : 500;
      if (status === 500) logger.error("Aurora action failed", { code });
      res.status(status).json({ ok: false, code: status === 500 ? "ACTION_FAILED" : code });
    }
  }
);

export const auroraNexusProjectionEngine = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", retryCount: 1, maxInstances: 1 },
  async () => {
    try {
      await refreshProjection(DEFAULT_ORG_ID);
      logger.info("Aurora projection refreshed", { orgId: DEFAULT_ORG_ID });
    } catch (error) {
      const code = error instanceof Error ? error.message : "PROJECTION_FAILED";
      if (["PROJECTION_DISABLED", "PROJECTION_COMPETENCE_REQUIRED", "PROJECTION_NO_SOURCE"].includes(code)) {
        logger.info("Aurora projection skipped safely", { orgId: DEFAULT_ORG_ID, code });
        return;
      }
      logger.error("Aurora projection failed", { orgId: DEFAULT_ORG_ID, code });
      throw error;
    }
  }
);
