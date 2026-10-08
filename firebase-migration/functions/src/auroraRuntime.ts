import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
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
import { validateResolutionEvidence } from "./auroraEvidence.js";
import { buildProjection, isOperationalRecord, parseActionCommand, type ProjectionSource } from "./auroraEngine.js";
import { generateNativeInsight, parseNativeInsightIntent } from "./auroraNativeIntelligence.js";
import { buildMasterOperationalState } from "./auroraMasterEngine.js";
import { buildReleaseStatus } from "./auroraReleaseStatus.js";
import { autoObserveResolvedDocumentAction } from "./auroraOrganicAutoObserve.js";
import { loadFinancialClosingStatus } from "./auroraFinancialDecisionRuntime.js";
import { auroraDb } from "./firebase.js";
import { readRuntimeActiveRelease } from "./auroraActiveReleaseRuntime.js";
import { readInstallationReadiness } from "./auroraInstallationReadiness.js";
import { immutableEntityVersionId } from "./auroraCanonicalVersions.js";

export async function loadInstallationReadiness(orgId: string, documentId?: string) {
  return auroraDb.runTransaction(async tx => {
    const org = await tx.get(auroraDb.doc(`organizations/${orgId}`));
    const active = org.exists && isActiveOrganization(org.data())
      && org.data()?.projectionEnabled === true && org.data()?.projectionMode === 'SHADOW';
    return readInstallationReadiness(orgId, async path => {
      if (!active) return null;
      const snap = await tx.get(auroraDb.doc(path));
      return snap.exists ? snap.data() ?? null : null;
    }, documentId);
  });
}

export async function completeInstallation(orgId: string, uid: string) {
  return auroraDb.runTransaction(async tx => {
    const org = await tx.get(auroraDb.doc(`organizations/${orgId}`));
    if (!org.exists || !isActiveOrganization(org.data())) throw new Error('ORGANIZATION_DISABLED');
    if (org.data()?.projectionEnabled !== true || org.data()?.projectionMode !== 'SHADOW') {
      throw new Error('PROJECTION_DISABLED');
    }
    const proof = await readInstallationReadiness(orgId, async path => {
      const snap = await tx.get(auroraDb.doc(path));
      return snap.exists ? snap.data() ?? null : null;
    });
    if (!proof.firstIngestionVerified) throw new Error('FIRST_INGESTION_PENDING');
    if (!proof.operationalComplete) {
      tx.set(auroraDb.doc(`organizations/${orgId}/runtimeCheckpoints/installation`), {
        orgId, state:'COMPLETE', documentId:proof.documentId, versionId:proof.versionId,
        sourceVersion:proof.sourceVersion, canonicalSnapshotHash:proof.canonicalSnapshotHash,
        completedBy:uid, completedAt:FieldValue.serverTimestamp()
      });
    }
    return {...proof, operationalComplete:true};
  });
}

const ALLOWED_EMAILS = defineSecret("AURORA_NEXUS_ALLOWED_EMAILS");
const CSRF_HMAC_KEY = defineSecret("AURORA_NEXUS_CSRF_HMAC_KEY");
const SOURCE_LIMIT = 1000;
const sourceCollections = ["invoices", "bankTransactions", "glosses", "actionItems", "sourceDocuments", "reconciliations", "auditFindings"] as const;

type ResponseLike = { set(name: string, value: string): unknown };
type ProjectionActor = { uid: string; role: string; source: "USER" | "SCHEDULER" | "INTEGRATION" };

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
  return { id, targetType, targetId, reasonCode, riskLevel, status, revision, dueAt, createdAt, updatedAt, title, details };
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

async function readProjectionSource(orgId: string, tx: Transaction): Promise<ProjectionSource> {
  const entries = await Promise.all(sourceCollections.map(async (name) => {
    const snapshot = await tx.get(auroraDb.collection(`organizations/${orgId}/${name}`).limit(SOURCE_LIMIT + 1));
    if (snapshot.size > SOURCE_LIMIT) throw new Error(`SOURCE_LIMIT_EXCEEDED:${name}`);
    return [name, snapshot.docs.map((doc) => name === 'sourceDocuments'
      ? {...doc.data(), _documentId:doc.id} : doc.data())] as const;
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

async function projectionSettings(orgId: string, tx: Transaction): Promise<{ competence: string; enabled: boolean }> {
  const organization = await tx.get(auroraDb.doc(`organizations/${orgId}`));
  if (!organization.exists || !isActiveOrganization(organization.data())) throw new Error("ORGANIZATION_DISABLED");
  const data = organization.data() ?? {};
  const competence = safeString(data.projectionCompetence, 7) ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) throw new Error("PROJECTION_COMPETENCE_REQUIRED");
  return { competence, enabled: data.projectionEnabled === true && data.projectionMode === "SHADOW" };
}

export async function refreshProjection(orgId = DEFAULT_ORG_ID, actor: ProjectionActor = { uid: "scheduler", role: "system", source: "SCHEDULER" }): Promise<Record<string, unknown>> {
  return auroraDb.runTransaction(async (tx) => {
  // Source and current projection share the transaction read point. A paused worker
  // cannot publish an old source snapshot over a newer committed revision.
  const settings = await projectionSettings(orgId, tx);
  if (!settings.enabled) throw new Error("PROJECTION_DISABLED");
  const source = await readProjectionSource(orgId, tx);
  const projection = buildProjection(source, new Date(), { orgId, competence: settings.competence });
  const dataQuality = projection.dataQuality as Record<string, unknown>;
  if (projection.state === "NO_SOURCE") throw new Error("PROJECTION_NO_SOURCE");
  if (dataQuality.complete !== true) throw new Error("PROJECTION_DATA_QUALITY_BLOCKED");

  const sourceHash = createHash("sha256").update(JSON.stringify(stableValue(source))).digest("hex");
  const snapshotId = actor.source === 'INTEGRATION'
    ? createHash('sha256').update(`integration:${settings.competence}:${sourceHash}`).digest('hex')
    : randomUUID();
  const storedProjection = {
    ...projection,
    generatedAt: FieldValue.serverTimestamp(),
    engine: { name: "aurora-projection", version: 2, mode: "SHADOW" },
    sourceLimit: SOURCE_LIMIT,
    sourceHash,
    snapshotId,
    integrationReadback: source.sourceDocuments.filter(doc =>
      isOperationalRecord(doc) && doc.orgId === orgId && doc.nativeReady === true && doc.sourceIndependent === true
      && typeof doc.entityKey === 'string' && Number.isSafeInteger(doc.revision)
      && Number(doc.revision) >= 1 && /^[a-f0-9]{64}$/.test(String(doc.canonicalSnapshotHash ?? ''))
    ).map(doc => ({documentId:doc._documentId, sourceVersion:doc.sourceVersion,
      revision:doc.revision, versionId:immutableEntityVersionId('sourceDocument',String(doc.entityKey),Number(doc.revision)),
      canonicalSnapshotHash:doc.canonicalSnapshotHash}))
  };
  const base = `organizations/${orgId}`;
    const historyRef = auroraDb.doc(`${base}/dashboardSnapshotHistory/${snapshotId}`);
    const history = actor.source === 'INTEGRATION' ? await tx.get(historyRef) : null;
    if (history?.exists) {
      const recorded = history.data();
      if (recorded?.sourceHash !== sourceHash || recorded.orgId !== orgId || recorded.snapshotId !== snapshotId) {
        throw new Error('PROJECTION_HISTORY_CONFLICT');
      }
      const currentRef = auroraDb.doc(`${base}/dashboardSnapshots/current`);
      const current = await tx.get(currentRef);
      if (current.data()?.sourceHash !== sourceHash) {
        tx.set(auroraDb.doc(`${base}/dashboardSnapshots/${deterministicSnapshotId(settings.competence)}`), recorded);
        tx.set(currentRef, recorded);
      }
      return projection;
    }
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
  return projection;
  });
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
    const mayReadFinancialStatus = can(member, "financial.read", ["platform_admin", "org_admin", "director", "auditor", "finance"]);
    const [org, snapshot, actions, canonicalVersion] = await Promise.all([
      auroraDb.doc(`organizations/${member.orgId}`).get(),
      auroraDb.doc(`organizations/${member.orgId}/dashboardSnapshots/current`).get(),
      mayReadActions
        ? auroraDb.collection(`organizations/${member.orgId}/actionItems`).limit(100).get()
        : Promise.resolve(null),
      readRuntimeActiveRelease()
    ]);
    const empty: ProjectionSource = { invoices: [], bankTransactions: [], glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: [] };
    const competence = safeString(org.data()?.projectionCompetence, 7) ?? new Date().toISOString().slice(0, 7);
    let financialStatus: Record<string, unknown> | null = null;
    if (mayReadFinancialStatus) {
      try {
        financialStatus = await loadFinancialClosingStatus(member.orgId, competence);
      } catch (error) {
        logger.warn("Financial closing status unavailable", {
          orgId: member.orgId,
          competence,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
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
    const recentActivity = safeActions.slice(0, 12).map((item) => ({
      actionId: item.id,
      title: item.title ?? item.targetId,
      status: item.status,
      riskLevel: item.riskLevel,
      at: item.updatedAt ?? item.createdAt ?? null
    }));
    res.status(200).json({
      ok: true,
      installation: await loadInstallationReadiness(member.orgId),
      environment: "HOMOLOGATION",
      mode: "SHADOW",
      organization: { id: member.orgId, name: String(org.data()?.name ?? "WMGJ") },
      member: { email: member.email, role: member.role, mfaVerified: member.mfaVerified },
      projection: visibleProjection(rawProjection, member),
      masterEngine: buildMasterOperationalState(visibleProjection(rawProjection, member), {
        actionSummary,
        financialStatus,
        release: buildReleaseStatus(org.data() ?? {})
      }),
      financialStatus,
      release: buildReleaseStatus(org.data() ?? {}),
      canonicalVersion,
      actions: safeActions,
      actionSummary,
      recentActivity
    });
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

export const auroraNexusMasterEngine = onRequest(
  { cors: false, secrets: [ALLOWED_EMAILS] },
  async (req, res) => {
    apiHeaders(res);
    if (req.method !== "GET") { res.set("Allow", "GET"); res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" }); return; }
    const member = await requireAccess(req, res); if (!member) return;
    if (!can(member, "dashboard.read", ["platform_admin", "org_admin", "director", "auditor", "operator", "finance", "viewer"])) {
      res.status(403).json({ ok: false, code: "PERMISSION_DENIED" });
      return;
    }

    const [snapshot, org] = await Promise.all([
      auroraDb.doc(`organizations/${member.orgId}/dashboardSnapshots/current`).get(),
      auroraDb.doc(`organizations/${member.orgId}`).get()
    ]);
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
    const rawProjection: Record<string, unknown> = { ...snapshotData, generatedAt };
    const nativeDataPlaneValue = rawProjection["nativeDataPlane"];
    const nativeDataPlane = nativeDataPlaneValue && typeof nativeDataPlaneValue === "object" && !Array.isArray(nativeDataPlaneValue)
      ? nativeDataPlaneValue as Record<string, unknown>
      : {};
    if (nativeDataPlane.storage !== "FIRESTORE" || nativeDataPlane.sourceAccessDuringInference !== false) {
      res.status(409).json({ ok: false, code: "FIREBASE_NATIVE_CONTRACT_REQUIRED" });
      return;
    }
    const projection = visibleProjection(rawProjection, member);
    const competence = typeof projection.competence === "string" ? projection.competence : null;
    const financialStatus = competence
      ? await loadFinancialClosingStatus(member.orgId, competence)
      : null;
    const canonicalVersion = await readRuntimeActiveRelease();
    const release = { ...buildReleaseStatus(org.data() ?? {}), canonicalVersion };
    res.status(200).json({
      ok: true,
      environment: "HOMOLOGATION",
      mode: "AURORA_MASTER_NATIVE",
      sourceAccessDuringInference: false,
      externalAiUsed: false,
      canonicalVersion,
      master: buildMasterOperationalState(projection, { financialStatus, release })
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
      if (req.body?.operation === 'COMPLETE_INSTALLATION') {
        const installation = await completeInstallation(member.orgId, member.uid);
        res.status(200).json({ok:true, orgId:member.orgId, installation});
        return;
      }
      if (req.body?.operation !== undefined && req.body.operation !== 'REFRESH') {
        res.status(400).json({ok:false, code:'INVALID_OPERATION'}); return;
      }
      const projection = await refreshProjection(member.orgId, { uid: member.uid, role: member.role, source: "USER" });
      res.status(200).json({ ok: true, projection: visibleProjection(projection, member) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "PROJECTION_FAILED";
      const status = ["PROJECTION_DISABLED", "PROJECTION_NO_SOURCE", "PROJECTION_DATA_QUALITY_BLOCKED", "PROJECTION_COMPETENCE_REQUIRED", "FIRST_INGESTION_PENDING", "ORGANIZATION_DISABLED"].includes(code) ? 409 : 500;
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
          const dueAt = Timestamp.fromDate(new Date(command.dueAt));
          if (command.targetType === "managementInput") {
            const managerInputRef = auroraDb.doc(`organizations/${member.orgId}/managerInputs/${command.targetId}`);
            tx.create(managerInputRef, {
              orgId: member.orgId,
              title: command.title,
              details: command.details ?? null,
              competence: command.competence,
              dueAt,
              state: "OPEN",
              evidenceRefs: [],
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
            : ["IDEMPOTENCY_CONFLICT", "REVISION_CONFLICT", "INVALID_TRANSITION", "TARGET_NOT_FOUND", "EVIDENCE_NOT_FOUND", "EVIDENCE_NOT_LINKED"].includes(code) ? 409 : 500;
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
