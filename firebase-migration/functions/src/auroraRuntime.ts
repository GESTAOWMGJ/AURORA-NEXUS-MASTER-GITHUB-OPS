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
  isActiveOrganization,
  validCsrf,
  verifyAuroraAccess,
  type AuroraMember
} from "./auroraAccess.js";
import { validEvidenceRef, validateEvidenceSelection, validateResolutionEvidence } from "./auroraEvidence.js";
import {
  DASHBOARD_PROJECTION_ENGINE_VERSION,
  buildProjection,
  parseActionCommand,
  type ProjectionSource
} from "./auroraEngine.js";
import { generateNativeInsight, parseNativeInsightIntent } from "./auroraNativeIntelligence.js";
import { managerInputTransitionPatch, publicAuditEvent, publicEligibleEvidence } from "./auroraOperationalViews.js";
import { buildReleaseStatus } from "./auroraReleaseStatus.js";
import { autoObserveResolvedDocumentAction } from "./auroraOrganicAutoObserve.js";
import { auroraDb } from "./firebase.js";

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const CSRF_HMAC_KEY = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
const SOURCE_LIMIT = 1000;
const EVIDENCE_SCAN_LIMIT = 200;
const EVIDENCE_RESPONSE_LIMIT = 50;
const AUDIT_SCAN_LIMIT = 200;
const AUDIT_EVENT_LIMIT = 50;
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

function timestampIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function publicAction(id: string, data: Record<string, unknown>): Record<string, unknown> | null {
  const targetType = safeString(data.targetType, 64);
  const targetId = safeString(data.targetId, 160);
  const reasonCode = safeString(data.reasonCode, 64);
  const riskLevel = safeString(data.riskLevel, 16);
  const status = safeString(data.status, 32);
  const revision = data.revision;
  if (!targetType || !targetId || !reasonCode || !riskLevel || !status || !Number.isSafeInteger(revision)) return null;
  if (!["invoice", "bankTransaction", "sourceDocument", "reconciliation", "auditFinding", "managementInput"].includes(targetType)) return null;
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(riskLevel)) return null;
  if (!["OPEN", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"].includes(status)) return null;
  const dueAt = timestampIso(data.dueAt);
  const createdAt = timestampIso(data.createdAt);
  const updatedAt = timestampIso(data.updatedAt);
  const title = safeString(data.title, 120);
  const details = safeString(data.details, 1000);
  const evidenceRefs = Array.isArray(data.evidenceRefs)
    ? data.evidenceRefs.filter(validEvidenceRef).slice(0, 20)
    : [];
  return { id, targetType, targetId, reasonCode, riskLevel, status, revision, dueAt, createdAt, updatedAt, title, details, evidenceRefs };
}

function boundedEvidenceRefs(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const refs = value.map((item) => typeof item === "string" ? item.trim() : "");
  return refs.every(validEvidenceRef) && new Set(refs).size === refs.length ? refs : null;
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

async function readProjectionSource(orgId: string, competence: string): Promise<ProjectionSource> {
  const entries = await Promise.all(sourceCollections.map(async (name) => {
    const snapshot = await auroraDb.collection(`organizations/${orgId}/${name}`)
      .where("competence", "==", competence)
      .limit(SOURCE_LIMIT + 1)
      .get();
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
  if (!organization.exists || !isActiveOrganization(organization.data())) throw new Error("ORGANIZATION_DISABLED");
  const data = organization.data() ?? {};
  const competence = safeString(data.projectionCompetence, 7) ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) throw new Error("PROJECTION_COMPETENCE_REQUIRED");
  return { competence, enabled: data.projectionEnabled === true && data.projectionMode === "SHADOW" };
}

export async function refreshProjection(orgId = DEFAULT_ORG_ID, actor: ProjectionActor = { uid: "scheduler", role: "system", source: "SCHEDULER" }): Promise<Record<string, unknown>> {
  const settings = await projectionSettings(orgId);
  if (!settings.enabled) throw new Error("PROJECTION_DISABLED");
  const source = await readProjectionSource(orgId, settings.competence);
  const projection = buildProjection(source, new Date(), { orgId, competence: settings.competence });
  const dataQuality = projection.dataQuality as Record<string, unknown>;
  if (projection.state === "NO_SOURCE") throw new Error("PROJECTION_NO_SOURCE");
  if (dataQuality.complete !== true) throw new Error("PROJECTION_DATA_QUALITY_BLOCKED");

  const snapshotId = randomUUID();
  const sourceHash = createHash("sha256").update(JSON.stringify(stableValue(source))).digest("hex");
  const storedProjection = {
    ...projection,
    generatedAt: FieldValue.serverTimestamp(),
    engine: { name: "aurora-projection", version: DASHBOARD_PROJECTION_ENGINE_VERSION, mode: "SHADOW" },
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
      orgId,
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
        ? auroraDb.collection(`organizations/${member.orgId}/actionItems`).limit(100).get()
        : Promise.resolve(null)
    ]);
    const empty: ProjectionSource = { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [] };
    const competence = safeString(org.data()?.projectionCompetence, 7) ?? new Date().toISOString().slice(0, 7);
    const rawProjection = snapshot.exists
      ? { ...snapshot.data(), generatedAt: snapshot.data()?.generatedAt?.toDate?.().toISOString?.() ?? null }
      : { ...buildProjection(empty, new Date(), { orgId: member.orgId, competence }), generatedAt: null };
    const safeActions = actions
      ? actions.docs.map((doc) => publicAction(doc.id, doc.data())).filter((item): item is Record<string, unknown> => item !== null)
        .sort((a, b) => Date.parse(String(b.updatedAt ?? b.createdAt ?? 0)) - Date.parse(String(a.updatedAt ?? a.createdAt ?? 0)))
      : [];
    const nowMs = Date.now();
    const actionSummary = safeActions.reduce<{
      total: number;
      open: number;
      inProgress: number;
      resolved: number;
      cancelled: number;
      overdue: number;
    }>((summary, item) => {
      const status = String(item.status ?? "");
      if (status === "OPEN") summary.open += 1;
      else if (status === "ACKNOWLEDGED") summary.inProgress += 1;
      else if (status === "RESOLVED") summary.resolved += 1;
      else if (status === "CANCELLED") summary.cancelled += 1;
      const dueMs = item.dueAt ? Date.parse(String(item.dueAt)) : NaN;
      if (!["RESOLVED", "CANCELLED"].includes(status) && Number.isFinite(dueMs) && dueMs < nowMs) summary.overdue += 1;
      summary.total += 1;
      return summary;
    }, { total: 0, open: 0, inProgress: 0, resolved: 0, cancelled: 0, overdue: 0 });
    res.status(200).json({
      ok: true,
      environment: "HOMOLOGATION",
      mode: "SHADOW",
      organization: { id: member.orgId, name: String(org.data()?.name ?? "WMGJ") },
      member: { email: member.email, role: member.role, mfaVerified: member.mfaVerified },
      projection: visibleProjection(rawProjection, member),
      release: buildReleaseStatus(org.data() ?? {}),
      actions: safeActions,
      actionSummary
    });
  }
);

export const auroraNexusEvidence = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS] },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "GET") { res.set("Allow", "GET"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!can(member, "actions.write", ["platform_admin", "org_admin", "director", "auditor", "operator"])) {
      res.status(403).json({ ok: false, code: "PERMISSION_DENIED" });
      return;
    }
    try {
      const snapshot = await auroraDb.collection(`organizations/${member.orgId}/sourceDocuments`)
        .orderBy("updatedAt", "desc")
        .limit(EVIDENCE_SCAN_LIMIT)
        .get();
      const evidence = snapshot.docs
        .map((doc) => publicEligibleEvidence(doc.id, doc.data(), member.orgId))
        .filter((item): item is Record<string, unknown> => item !== null)
        .slice(0, EVIDENCE_RESPONSE_LIMIT);
      res.status(200).json({ ok: true, evidence, limit: EVIDENCE_RESPONSE_LIMIT });
    } catch (error) {
      logger.error("Aurora evidence list failed", { code: error instanceof Error ? error.message : "EVIDENCE_LIST_FAILED" });
      res.status(500).json({ ok: false, code: "EVIDENCE_LIST_FAILED" });
    }
  }
);

export const auroraNexusAuditEvents = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS] },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "GET") { res.set("Allow", "GET"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!can(member, "audit.read", ["platform_admin", "org_admin", "director", "auditor"])) {
      res.status(403).json({ ok: false, code: "PERMISSION_DENIED" });
      return;
    }
    try {
      const snapshot = await auroraDb.collection(`organizations/${member.orgId}/auditEvents`)
        .orderBy("occurredAt", "desc")
        .limit(AUDIT_SCAN_LIMIT)
        .get();
      const events = snapshot.docs
        .map((doc) => publicAuditEvent(doc.id, doc.data(), member.orgId))
        .filter((item): item is Record<string, unknown> => item !== null)
        .slice(0, AUDIT_EVENT_LIMIT);
      res.status(200).json({ ok: true, events, limit: AUDIT_EVENT_LIMIT });
    } catch (error) {
      logger.error("Aurora audit list failed", { code: error instanceof Error ? error.message : "AUDIT_LIST_FAILED" });
      res.status(500).json({ ok: false, code: "AUDIT_LIST_FAILED" });
    }
  }
);

export const auroraNexusNativeInsight = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS] },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "GET") { res.set("Allow", "GET"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!can(member, "dashboard.read", ["platform_admin", "org_admin", "director", "auditor", "operator", "finance", "viewer"])) {
      res.status(403).json({ ok: false, code: "PERMISSION_DENIED" });
      return;
    }
    const intent = parseNativeInsightIntent(String(req.query.intent ?? "EXECUTIVE"));
    if (!intent) { res.status(400).json({ ok: false, code: "INVALID_NATIVE_INTENT" }); return; }

    const snapshot = await auroraDb.doc(`organizations/${member.orgId}/dashboardSnapshots/current`).get();
    if (!snapshot.exists) {
      res.status(409).json({ ok: false, code: "FIREBASE_NATIVE_SNAPSHOT_REQUIRED" });
      return;
    }
    const snapshotData = snapshot.data() ?? {};
    const generatedAtValue = snapshotData.generatedAt;
    const generatedAt = generatedAtValue
      && typeof generatedAtValue === "object"
      && "toDate" in generatedAtValue
      && typeof (generatedAtValue as { toDate?: unknown }).toDate === "function"
        ? (generatedAtValue as { toDate(): Date }).toDate().toISOString()
        : null;
    const rawProjection: Record<string, unknown> = {
      ...snapshotData,
      generatedAt
    };
    const nativeDataPlaneValue = rawProjection["nativeDataPlane"];
    const nativeDataPlane = nativeDataPlaneValue && typeof nativeDataPlaneValue === "object" && !Array.isArray(nativeDataPlaneValue)
      ? nativeDataPlaneValue as Record<string, unknown>
      : {};
    if (nativeDataPlane.storage !== "FIRESTORE" || nativeDataPlane.sourceAccessDuringInference !== false) {
      res.status(409).json({ ok: false, code: "FIREBASE_NATIVE_CONTRACT_REQUIRED" });
      return;
    }
    const projection = visibleProjection(rawProjection, member);
    res.status(200).json({
      ok: true,
      environment: "HOMOLOGATION",
      mode: "FIREBASE_NATIVE",
      sourceAccessDuringInference: false,
      externalAiUsed: false,
      insight: generateNativeInsight(projection, intent)
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
    if (command.type === "CREATE_REVIEW" && !validEvidenceRef(command.targetId)) {
      res.status(400).json({ ok: false, code: "INVALID_TARGET_ID" });
      return;
    }
    const createEvidenceRefs = command.type === "CREATE_REVIEW" && command.targetType === "managementInput"
      ? boundedEvidenceRefs((req.body as Record<string, unknown>).evidenceRefs)
      : null;
    if (command.type === "CREATE_REVIEW" && command.targetType === "managementInput" && !createEvidenceRefs) {
      res.status(400).json({ ok: false, code: "EVIDENCE_SELECTION_REQUIRED" });
      return;
    }
    if (command.type === "RESOLVE" && !can(member, "actions.resolve", ["platform_admin", "org_admin", "director", "auditor"])) { res.status(403).json({ ok: false, code: "RESOLUTION_PERMISSION_REQUIRED" }); return; }
    if (!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) { res.status(400).json({ ok: false, code: "INVALID_IDEMPOTENCY_KEY" }); return; }
    const commandHash = createHash("sha256").update(JSON.stringify({
      ...command,
      ...(createEvidenceRefs ? { evidenceRefs: createEvidenceRefs } : {})
    })).digest("hex");
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
        let auditTargetType: string | null = null;
        let auditTargetId: string | null = null;
        let auditFromState: string | null = null;
        let auditToState: string;
        let auditRevision: number;
        let auditEvidenceRefCount: number;
        if (command.type === "CREATE_REVIEW") {
          const dueAt = Timestamp.fromDate(new Date(command.dueAt));
          const linkedEvidenceRefs = command.targetType === "managementInput" ? createEvidenceRefs ?? [] : [];
          if (command.targetType === "managementInput") {
            const evidence = await validateEvidenceSelection(member.orgId, linkedEvidenceRefs, async (path) => {
              const snapshot = await tx.get(auroraDb.doc(path));
              return snapshot.exists ? snapshot.data() ?? {} : null;
            });
            if (!evidence.ok) throw new Error(evidence.code);
            const managerInputRef = auroraDb.doc(`organizations/${member.orgId}/managerInputs/${command.targetId}`);
            tx.create(managerInputRef, {
              orgId: member.orgId,
              actionId: actionRef.id,
              title: command.title,
              details: command.details ?? null,
              competence: command.competence,
              dueAt,
              state: "OPEN",
              revision: 1,
              evidenceRefs: evidence.evidenceRefs,
              createdBy: member.uid,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              sanitized: true,
              sensitivity: "INTERNAL"
            });
          }
          tx.create(actionRef, {
            orgId: member.orgId,
            targetType: command.targetType,
            targetId: command.targetId,
            title: command.title ?? null,
            details: command.details ?? null,
            reasonCode: command.reasonCode,
            riskLevel: command.riskLevel,
            competence: command.competence,
            dueAt,
            status: "OPEN",
            revision: 1,
            evidenceRefs: linkedEvidenceRefs,
            createdBy: member.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            sanitized: true,
            sensitivity: "INTERNAL"
          });
          auditTargetType = command.targetType;
          auditTargetId = command.targetId;
          auditToState = "OPEN";
          auditRevision = 1;
          auditEvidenceRefCount = linkedEvidenceRefs.length;
        } else {
          const current = await tx.get(actionRef);
          if (!current.exists) throw new Error("ACTION_NOT_FOUND");
          const currentData = current.data() ?? {};
          if (currentData.orgId !== member.orgId) throw new Error("ACTION_SCOPE_VIOLATION");
          if (currentData.revision !== command.expectedRevision) throw new Error("REVISION_CONFLICT");
          const currentStatus = safeString(currentData.status, 32);
          if (!currentStatus || ["RESOLVED", "CANCELLED"].includes(currentStatus)) throw new Error("INVALID_TRANSITION");
          if (command.type === "ACKNOWLEDGE" && currentStatus !== "OPEN") throw new Error("INVALID_TRANSITION");
          const targetType = safeString(currentData.targetType, 64);
          const targetId = safeString(currentData.targetId, 160);
          if (!targetType || !targetId || !validEvidenceRef(targetId)) throw new Error("TARGET_NOT_FOUND");
          const managerInputRef = targetType === "managementInput"
            ? auroraDb.doc(`organizations/${member.orgId}/managerInputs/${targetId}`)
            : null;
          const managerInputSnapshot = managerInputRef ? await tx.get(managerInputRef) : null;
          const managerInputData = managerInputSnapshot?.exists ? managerInputSnapshot.data() ?? {} : null;
          if (command.type === "RESOLVE") {
            if (currentStatus !== "ACKNOWLEDGED") throw new Error("INVALID_TRANSITION");
            if (["HIGH", "CRITICAL"].includes(String(currentData.riskLevel)) && !member.mfaVerified) throw new Error("MFA_REQUIRED");
            const evidence = await validateResolutionEvidence({
              orgId: member.orgId,
              actionId: actionRef.id,
              action: currentData,
              evidenceRefs: command.evidenceRefs
            }, async (path) => {
              const snapshot = await tx.get(auroraDb.doc(path));
              return snapshot.exists ? snapshot.data() ?? {} : null;
            });
            if (!evidence.ok) throw new Error(evidence.code);
          }
          const targetPatch = managerInputTransitionPatch({
            orgId: member.orgId,
            actionId: actionRef.id,
            actorUid: member.uid,
            expectedRevision: command.expectedRevision,
            type: command.type,
            ...(command.type === "RESOLVE" ? {
              resolutionCode: command.resolutionCode,
              resolutionEvidenceRefs: command.evidenceRefs
            } : {}),
            action: currentData,
            managerInput: managerInputData
          });
          const nextStatus = command.type === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED";
          tx.update(actionRef, {
            status: nextStatus,
            ...(command.type === "RESOLVE" ? {
              resolutionCode: command.resolutionCode,
              evidenceRefs: command.evidenceRefs
            } : {}),
            revision: command.expectedRevision + 1,
            updatedBy: member.uid,
            updatedAt: FieldValue.serverTimestamp()
          });
          if (managerInputRef && targetPatch) {
            tx.update(managerInputRef, { ...targetPatch, updatedAt: FieldValue.serverTimestamp() });
          }
          auditTargetType = targetType;
          auditTargetId = targetId;
          auditFromState = currentStatus;
          auditToState = nextStatus;
          auditRevision = command.expectedRevision + 1;
          auditEvidenceRefCount = command.type === "RESOLVE"
            ? command.evidenceRefs.length
            : boundedEvidenceRefs(currentData.evidenceRefs)?.length ?? 0;
        }
        const eventRef = auroraDb.doc(`organizations/${member.orgId}/auditEvents/${randomUUID()}`);
        tx.create(eventRef, {
          action: `ACTION_${command.type}`,
          type: `ACTION_${command.type}`,
          orgId: member.orgId,
          actionId: actionRef.id,
          targetType: auditTargetType,
          targetId: auditTargetId,
          fromState: auditFromState,
          toState: auditToState,
          revision: auditRevision,
          evidenceRefCount: auditEvidenceRefCount,
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
      let organicObservation: unknown = null;
      if (command.type === "RESOLVE") {
        try {
          organicObservation = await autoObserveResolvedDocumentAction(member.orgId, result.actionId, member);
        } catch (organicError) {
          logger.warn("Aurora organic document observation deferred", {
            actionId: result.actionId,
            error: organicError instanceof Error ? organicError.message : String(organicError)
          });
          organicObservation = { recorded: false, code: "ORGANIC_OBSERVATION_DEFERRED" };
        }
      }
      res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result, organicObservation });
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACTION_FAILED";
      const status = code === "ACTION_NOT_FOUND" ? 404
        : code === "MFA_REQUIRED" ? 403
          : ["ACTION_SCOPE_VIOLATION", "TARGET_SCOPE_VIOLATION", "EVIDENCE_SCOPE_VIOLATION"].includes(code) ? 403
            : ["IDEMPOTENCY_CONFLICT", "REVISION_CONFLICT", "TARGET_REVISION_CONFLICT", "TARGET_STATE_CONFLICT", "TARGET_ACTION_MISMATCH", "INVALID_TRANSITION", "TARGET_NOT_FOUND", "EVIDENCE_NOT_FOUND", "EVIDENCE_NOT_ELIGIBLE", "EVIDENCE_NOT_LINKED", "EVIDENCE_SET_MISMATCH"].includes(code) ? 409 : 500;
      if (status === 500) logger.error("Aurora action failed", { code });
      res.status(status).json({ ok: false, code: status === 500 ? "ACTION_FAILED" : code });
    }
  }
);

export const auroraNexusProjectionEngine = onSchedule(
  { schedule: "every 15 minutes", timeZone: "America/Sao_Paulo", retryCount: 1, maxInstances: 1, timeoutSeconds: 300 },
  async () => {
    const organizations = await auroraDb.collection("organizations")
      .where("active", "==", true)
      .limit(20)
      .get();
    const orgIds = organizations.empty ? [DEFAULT_ORG_ID] : organizations.docs.map((doc) => doc.id);
    const failures: Array<{ orgId: string; code: string }> = [];

    for (const orgId of orgIds) {
      try {
        await refreshProjection(orgId);
        logger.info("Aurora projection refreshed", { orgId });
      } catch (error) {
        const code = error instanceof Error ? error.message : "PROJECTION_FAILED";
        if (["PROJECTION_DISABLED", "PROJECTION_COMPETENCE_REQUIRED", "PROJECTION_NO_SOURCE"].includes(code)) {
          logger.info("Aurora projection skipped safely", { orgId, code });
          continue;
        }
        failures.push({ orgId, code });
        logger.error("Aurora projection failed", { orgId, code });
      }
    }
    if (failures.length > 0) throw new Error(`PROJECTION_TENANT_FAILURES:${failures.length}`);
  }
);
