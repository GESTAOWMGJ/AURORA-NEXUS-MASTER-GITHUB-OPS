import { createHash, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { can, DEFAULT_ORG_ID, validCsrf, verifyAuroraAccess, type AuroraMember } from "./auroraAccess.js";
import { buildProjection, parseActionCommand, type ProjectionSource } from "./auroraEngine.js";
import { auroraDb } from "./firebase.js";

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const SOURCE_LIMIT = 1000;
const sourceCollections = ["invoices", "bankTransactions", "glosses", "actionItems", "sourceDocuments", "reconciliations", "auditFindings"] as const;

type ResponseLike = { set(name: string, value: string): unknown };
function apiHeaders(res: ResponseLike): void {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function publicAction(id: string, data: Record<string, unknown>): Record<string, unknown> {
  const safe = (name: string): unknown => {
    const value = data[name];
    if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
      return (value as { toDate(): Date }).toDate().toISOString();
    }
    return value ?? null;
  };
  return { id, targetType: safe("targetType"), targetId: safe("targetId"), reasonCode: safe("reasonCode"), riskLevel: safe("riskLevel"), status: safe("status"), revision: safe("revision"), dueAt: safe("dueAt") };
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

export async function refreshProjection(orgId = DEFAULT_ORG_ID): Promise<Record<string, unknown>> {
  const source = await readProjectionSource(orgId);
  const projection = { ...buildProjection(source), dataQuality: { sourceLimit: SOURCE_LIMIT, complete: true } };
  await auroraDb.doc(`organizations/${orgId}/dashboardSnapshots/current`).set({
    ...projection,
    generatedAt: FieldValue.serverTimestamp(),
    engine: { name: "aurora-projection", version: 1, mode: "SHADOW" },
    sourceLimit: SOURCE_LIMIT
  });
  return projection;
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
    const projection = snapshot.exists
      ? { ...snapshot.data(), generatedAt: snapshot.data()?.generatedAt?.toDate?.().toISOString?.() ?? null }
      : { ...buildProjection(empty), generatedAt: null, state: "NO_SOURCE" };
    res.status(200).json({
      ok: true,
      organization: { id: member.orgId, name: String(org.data()?.name ?? "WMGJ") },
      member: { email: member.email, role: member.role },
      projection,
      actions: actions ? actions.docs.map((doc) => publicAction(doc.id, doc.data())) : []
    });
  }
);

export const auroraNexusRefresh = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS], timeoutSeconds: 120, memory: "512MiB" },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "POST") { res.set("Allow", "POST"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    if (!String(req.get("content-type") ?? "").toLowerCase().startsWith("application/json")) { res.status(415).json({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"))) { res.status(403).json({ ok: false, code: "CSRF_REJECTED" }); return; }
    if (!can(member, "dashboard.refresh", ["platform_admin", "org_admin", "director", "auditor"])) { res.status(403).json({ ok: false, code: "PERMISSION_DENIED" }); return; }
    const projection = await refreshProjection(member.orgId);
    await auroraDb.collection(`organizations/${member.orgId}/auditEvents`).add({
      type: "DASHBOARD_PROJECTION_REFRESHED", actorUid: member.uid, actorRole: member.role,
      occurredAt: FieldValue.serverTimestamp(), sanitized: true, sensitivity: "INTERNAL"
    });
    res.status(200).json({ ok: true, projection });
  }
);

export const auroraNexusAction = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS] },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "POST") { res.set("Allow", "POST"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    if (!String(req.get("content-type") ?? "").toLowerCase().startsWith("application/json")) { res.status(415).json({ ok: false, code: "UNSUPPORTED_MEDIA_TYPE" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!validCsrf(req.get("cookie"), req.get("x-aurora-csrf"))) { res.status(403).json({ ok: false, code: "CSRF_REJECTED" }); return; }
    if (!can(member, "actions.write", ["platform_admin", "org_admin", "director", "auditor", "operator"])) { res.status(403).json({ ok: false, code: "PERMISSION_DENIED" }); return; }
    const command = parseActionCommand(req.body);
    const idempotencyKey = String(req.get("idempotency-key") ?? "");
    if (!command) { res.status(400).json({ ok: false, code: "INVALID_COMMAND" }); return; }
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
          tx.create(actionRef, { targetType: command.targetType, targetId: command.targetId, reasonCode: command.reasonCode, riskLevel: command.riskLevel, status: "OPEN", revision: 1, createdBy: member.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), sanitized: true, sensitivity: "INTERNAL" });
        } else {
          const current = await tx.get(actionRef);
          if (!current.exists) throw new Error("ACTION_NOT_FOUND");
          if (current.data()?.revision !== command.expectedRevision) throw new Error("REVISION_CONFLICT");
          if (["RESOLVED", "CANCELLED"].includes(String(current.data()?.status))) throw new Error("INVALID_TRANSITION");
          tx.update(actionRef, { status: command.type === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED", resolutionCode: command.type === "RESOLVE" ? command.resolutionCode : null, revision: command.expectedRevision + 1, updatedBy: member.uid, updatedAt: FieldValue.serverTimestamp() });
        }
        const eventRef = auroraDb.doc(`organizations/${member.orgId}/auditEvents/${randomUUID()}`);
        tx.create(eventRef, { type: `ACTION_${command.type}`, actionId: actionRef.id, actorUid: member.uid, actorRole: member.role, commandHash, occurredAt: FieldValue.serverTimestamp(), sanitized: true, sensitivity: "INTERNAL" });
        tx.create(idemRef, { commandHash, actionId: actionRef.id, createdAt: FieldValue.serverTimestamp() });
        return { actionId: actionRef.id, duplicate: false };
      });
      res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACTION_FAILED";
      const status = code === "ACTION_NOT_FOUND" ? 404 : ["IDEMPOTENCY_CONFLICT", "REVISION_CONFLICT", "INVALID_TRANSITION"].includes(code) ? 409 : 500;
      if (status === 500) logger.error("Aurora action failed", { code });
      res.status(status).json({ ok: false, code: status === 500 ? "ACTION_FAILED" : code });
    }
  }
);

export const auroraNexusProjectionEngine = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", retryCount: 1, maxInstances: 1 },
  async () => {
    try { await refreshProjection(DEFAULT_ORG_ID); logger.info("Aurora projection refreshed", { orgId: DEFAULT_ORG_ID }); }
    catch (error) { logger.error("Aurora projection failed", { orgId: DEFAULT_ORG_ID, error: error instanceof Error ? error.message : String(error) }); throw error; }
  }
);
