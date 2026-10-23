import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auroraDb } from "../src/firebase.ts";
import { ingestWmgjEvent } from "../src/index.ts";
import { signHmacV2, type HmacV2Headers } from "../src/security.ts";

// Exercise the real HMAC handler and projection transaction with synthetic data.
// Every Firestore entry point they can reach is replaced; no cloud credentials
// or service is used. Writes become visible only after a successful callback.
function fixture(t: any) {
  const orgId = "synthetic-hmac", base = `organizations/${orgId}`;
  const keyId = "synthetic-hmac-key", secret = "93".repeat(32);
  const stamp = Timestamp.fromMillis(Date.now());
  const previousKeyring = process.env.WMGJ_INGEST_HMAC_KEYRING;
  process.env.WMGJ_INGEST_HMAC_KEYRING = JSON.stringify({
    [keyId]: { active: true, secret, orgIds: [orgId], entityTypes: ["sourceDocument"] }
  });
  t.after(() => {
    if (previousKeyring === undefined) delete process.env.WMGJ_INGEST_HMAC_KEYRING;
    else process.env.WMGJ_INGEST_HMAC_KEYRING = previousKeyring;
  });
  const state = new Map<string, any>([
    [base, { active: true, environment: "HOMOLOGATION", projectionEnabled: true,
      projectionMode: "SHADOW", projectionCompetence: "2026-10",
      sourceMutation: false, productionMutation: false, clinicalSensitiveEnabled: false }],
    ["organizations/synthetic-other/sourceDocuments/foreign", { orgId: "synthetic-other", revision: 7 }]
  ]);
  const reads: string[] = [], writes: string[] = [];
  let failProjectionCommits = 0, projectionAttempts = 0;
  const sourceCollections = new Set(["invoices", "bankTransactions", "glosses", "actionItems",
    "sourceDocuments", "reconciliations", "auditFindings"]);
  const snapshot = (path: string) => ({ path, id: path.split("/").pop(),
    exists: state.has(path), data: () => state.get(path) });
  const document = (path: string): any => ({ path, id: path.split("/").pop(),
    collection: (name: string) => collection(`${path}/${name}`) });
  const collection = (path: string): any => ({ path,
    doc: (id: string) => document(`${path}/${id}`),
    limit: (limit: number) => ({ path, limit }) });
  const plain = (value: any) => value && typeof value === "object"
    && !Array.isArray(value) && !(value instanceof Timestamp);
  const merge = (old: any, patch: any): any => {
    if (!plain(patch) || Object.keys(patch).length === 0) return patch;
    const result = plain(old) ? { ...old } : {};
    for (const [key, value] of Object.entries(patch)) result[key] = merge(result[key], value);
    return result;
  };
  const materialize = (value: any, old: any): any => {
    if (value instanceof FieldValue) {
      if (value.isEqual(FieldValue.serverTimestamp())) return stamp;
      assert.ok(value.isEqual(FieldValue.increment(1)), "unexpected transform");
      return (typeof old === "number" ? old : 0) + 1;
    }
    if (value instanceof Timestamp) return value;
    if (Array.isArray(value)) return value.map((item, index) => materialize(item, old?.[index]));
    return plain(value) ? Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, materialize(item, old?.[key])])) : value;
  };
  t.mock.method(auroraDb, "doc", document as any);
  t.mock.method(auroraDb, "collection", collection as any);
  t.mock.method(auroraDb, "collectionGroup", (() => { throw Error("UNEXPECTED_COLLECTION_GROUP"); }) as any);
  t.mock.method(auroraDb, "runTransaction", (async (callback: any) => {
    const pending: Array<{ path: string; data: any; merge: boolean; create: boolean }> = [];
    let isProjection = false;
    const result = await callback({
      get: async (ref: any) => {
        assert.equal(pending.length, 0, "all reads must precede transaction writes");
        assert.ok(ref.path === base || ref.path.startsWith(`${base}/`), "tenant boundary");
        reads.push(ref.path);
        if (ref.limit === undefined) return snapshot(ref.path);
        isProjection = true;
        assert.equal(ref.limit, 1001);
        assert.ok(sourceCollections.has(ref.path.slice(base.length + 1)));
        const docs = [...state.keys()].filter(path => path.startsWith(`${ref.path}/`)
          && !path.slice(ref.path.length + 1).includes("/")).sort().slice(0, ref.limit).map(snapshot);
        return { size: docs.length, docs };
      },
      create: (ref: any, data: any) => pending.push({ path: ref.path, data, merge: false, create: true }),
      set: (ref: any, data: any, options?: any) => pending.push({ path: ref.path, data,
        merge: options?.merge === true, create: false })
    });
    if (isProjection) {
      projectionAttempts++;
      if (failProjectionCommits > 0) {
        failProjectionCommits--;
        throw Error("synthetic-private-projection-failure");
      }
    }
    const committed = new Map(state);
    for (const write of pending) {
      assert.ok(write.path.startsWith(`${base}/`), "writes must stay in the authenticated tenant");
      if (write.create) assert.equal(committed.has(write.path), false, "create-only history");
      const old = committed.get(write.path), data = materialize(write.data, old);
      committed.set(write.path, write.merge ? merge(old, data) : data);
    }
    for (const write of pending) { state.set(write.path, committed.get(write.path)); writes.push(write.path); }
    return result;
  }) as any);

  const event: any = {
    schemaVersion: 1, eventId: "synthetic-hmac-event-1", eventType: "DOCUMENT_UPSERT", orgId,
    occurredAt: stamp.toDate().toISOString(), sourceVersion: 1,
    idempotencyKey: "synthetic-hmac-document-v1", entityType: "sourceDocument", entityKey: "DRIVE:synthetic-document",
    actor: { type: "SYSTEM", id: "synthetic-bridge", source: "WMGJ_APPS_SCRIPT" },
    source: { system: "DRIVE", sourceId: "synthetic-document", contentHash: "a".repeat(64), hashMethod: "content_sha256" },
    workflowState: "PENDING_HUMAN_REVIEW", reviewState: "PENDING", riskLevel: "LOW", sensitivity: "RESTRICTED",
    competence: "2026-10", documentType: "FINANCIAL",
    record: { category: "financial", confidence: 0.8, extractionComplete: true,
      nativeReady: false, sourceIndependent: false, externalFetchRequired: true, externalAiUsed: false,
      originSystem: "DRIVE", originConnector: "DRIVE_FOLDER", documentFragility: "MISSING_CANONICAL_FIELDS",
      missingFieldsCount: 1, flowStage: "FIREBASE_CANONICALIZED" }
  };
  const call = async (body = event, options: { nonce?: string; signedOrg?: string; secret?: string } = {}) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signed: HmacV2Headers = { signatureVersion: "v2", timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: options.nonce ?? randomUUID(), keyId, orgId: options.signedOrg ?? body.orgId,
      idempotencyKey: body.idempotencyKey, signature: "", method: "POST", contentType: "application/json" };
    signed.signature = signHmacV2(rawBody, signed, options.secret ?? secret);
    const headers: Record<string, string> = { "content-type": signed.contentType!,
      "x-wmgj-signature-version": signed.signatureVersion, "x-wmgj-timestamp": signed.timestamp,
      "x-wmgj-nonce": signed.nonce, "x-wmgj-key-id": signed.keyId, "x-wmgj-org-id": signed.orgId,
      "x-wmgj-idempotency-key": signed.idempotencyKey, "x-wmgj-signature": signed.signature };
    let status = 0, response: any;
    const req: any = { method: "POST", rawBody, body, get: (name: string) => headers[name] };
    const res: any = { on() { return this; }, set() { return this; },
      status(value: number) { status = value; return this; }, json(value: any) { response = value; return this; } };
    await (ingestWmgjEvent as any)(req, res);
    return { status, response };
  };
  return { orgId, base, keyId, state, reads, writes, event, call,
    failNextProjection: () => { failProjectionCommits++; },
    projectionAttempts: () => projectionAttempts,
    entries: (name: string) => [...state].filter(([path]) => path.startsWith(`${base}/${name}/`)) };
}

test("HMAC acceptance survives projection failure; replay recovers once and preserves canonical history", async t => {
  const f = fixture(t);
  f.failNextProjection();
  const first = await f.call();
  assert.equal(first.status, 202);
  assert.equal(first.response.accepted, true);
  assert.equal(first.response.projectionStatus, "PENDING");
  assert.doesNotMatch(JSON.stringify(first.response), /synthetic-private-projection-failure/);
  assert.equal(f.entries("sourceDocuments").length, 1);
  assert.equal(f.entries("entityVersions").length, 1);
  assert.equal(f.entries("integrationEvents").length, 1);
  assert.equal(f.entries("dashboardSnapshotHistory").length, 0);
  assert.equal(f.state.has(`${f.base}/dashboardSnapshots/current`), false);
  const entityPath = `${f.base}/sourceDocuments/${first.response.entityId}`;
  const versionPath = `${f.base}/entityVersions/${first.response.versionId}`;
  const acceptedEntity = JSON.stringify(f.state.get(entityPath));
  const acceptedVersion = JSON.stringify(f.state.get(versionPath));
  assert.equal(f.state.get(`${f.base}/runtimeCheckpoints/ingestion`).acceptedCount, 1);

  const replay = await f.call();
  assert.equal(replay.status, 200);
  assert.equal(replay.response.duplicate, true);
  assert.equal(replay.response.accepted, false);
  assert.equal(replay.response.projectionStatus, "REFRESHED");
  assert.equal(replay.response.versionId, first.response.versionId);
  assert.equal(replay.response.revision, 1);
  const projection = f.state.get(`${f.base}/dashboardSnapshots/current`);
  assert.equal(projection.orgId, f.orgId);
  assert.equal(projection.sampleSizes.sourceDocuments, 1);
  assert.equal(projection.documentIntelligence.pendingDocumentFlow, 1);
  assert.equal(projection.documentIntelligence.nativeReadyDocuments, 0);
  assert.equal(projection.nativeDataPlane.sourceAccessDuringInference, false);
  assert.equal(f.entries("dashboardSnapshotHistory").length, 1);
  const projectionAudit = f.entries("auditEvents").find(([, value]) => value.action === "DASHBOARD_PROJECTION_REFRESHED")![1];
  assert.equal(projectionAudit.actorSource, "INTEGRATION");
  assert.equal(projectionAudit.actorUid, `hmac:${f.keyId}`);

  assert.equal((await f.call()).response.projectionStatus, "REFRESHED");
  assert.equal(f.entries("dashboardSnapshotHistory").length, 1);
  assert.equal(f.entries("auditEvents").length, 2);
  assert.equal(f.entries("entityVersions").length, 1);
  assert.equal(f.entries("integrationEvents").length, 1);
  assert.equal(f.state.get(`${f.base}/runtimeCheckpoints/ingestion`).versionCount, 1);
  assert.equal(JSON.stringify(f.state.get(entityPath)), acceptedEntity);
  assert.equal(JSON.stringify(f.state.get(versionPath)), acceptedVersion);
  assert.equal(f.state.get(`${f.base}/dashboardSnapshots/current`).snapshotId, projection.snapshotId);
  assert.deepEqual(f.state.get("organizations/synthetic-other/sourceDocuments/foreign"), { orgId: "synthetic-other", revision: 7 });

  // A cold dynamic import must follow the ingest module's global configuration.
  const runtime = await import("../src/auroraRuntime.ts");
  assert.deepEqual((runtime.auroraNexusProjectionEngine as any).__endpoint.region, ["southamerica-east1"]);
  assert.deepEqual((runtime.auroraNexusRefresh as any).__endpoint.region, ["southamerica-east1"]);
});

test("HMAC newer source version refreshes the same entity and creates only the next immutable projection", async t => {
  const f = fixture(t), first = await f.call();
  assert.equal(first.response.projectionStatus, "REFRESHED");
  const previous = f.state.get(`${f.base}/dashboardSnapshots/current`);
  const oldVersion = JSON.stringify(f.state.get(`${f.base}/entityVersions/${first.response.versionId}`));
  const update = { ...f.event, eventId: "synthetic-hmac-event-2", idempotencyKey: "synthetic-hmac-document-v2", sourceVersion: 2,
    source: { ...f.event.source, contentHash: "b".repeat(64) },
    record: { ...f.event.record, confidence: 0.9, missingFieldsCount: 2 } };
  const second = await f.call(update);
  assert.equal(second.status, 202);
  assert.equal(second.response.projectionStatus, "REFRESHED");
  assert.equal(second.response.entityId, first.response.entityId);
  assert.equal(second.response.revision, 2);
  assert.notEqual(second.response.versionId, first.response.versionId);
  const current = f.state.get(`${f.base}/dashboardSnapshots/current`);
  assert.notEqual(current.sourceHash, previous.sourceHash);
  assert.notEqual(current.snapshotId, previous.snapshotId);
  assert.equal(current.sampleSizes.sourceDocuments, 1);
  assert.equal(f.entries("sourceDocuments").length, 1);
  assert.equal(f.entries("entityVersions").length, 2);
  assert.equal(f.entries("dashboardSnapshotHistory").length, 2);
  assert.equal(JSON.stringify(f.state.get(`${f.base}/entityVersions/${first.response.versionId}`)), oldVersion);
  assert.deepEqual(f.state.get(`${f.base}/dashboardSnapshotHistory/${previous.snapshotId}`), previous);
  assert.equal((await f.call(update)).response.duplicate, true);
  assert.equal(f.entries("entityVersions").length, 2);
  assert.equal(f.entries("dashboardSnapshotHistory").length, 2);
});

test("HMAC rejects unauthorized organization, signature, signed-body mismatch and nonce replay before projecting", async t => {
  const f = fixture(t);
  assert.equal((await f.call({ ...f.event, orgId: "synthetic-other" })).status, 401);
  assert.equal((await f.call(f.event, { secret: "a4".repeat(32) })).status, 401);
  const mismatch = await f.call({ ...f.event, orgId: "synthetic-other" }, { signedOrg: f.orgId });
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.response.code, "SIGNED_HEADER_BODY_MISMATCH");
  assert.equal(f.writes.length, 0);
  assert.equal(f.projectionAttempts(), 0);

  const nonce = randomUUID(), accepted = await f.call(f.event, { nonce });
  assert.equal(accepted.status, 202);
  const written = f.writes.length, attempts = f.projectionAttempts();
  const replay = await f.call(f.event, { nonce });
  assert.equal(replay.status, 409);
  assert.equal(replay.response.code, "REPLAY_DETECTED");
  assert.equal(f.writes.length, written);
  assert.equal(f.projectionAttempts(), attempts);
  assert.ok(f.reads.every(path => path === f.base || path.startsWith(`${f.base}/`)));
});
