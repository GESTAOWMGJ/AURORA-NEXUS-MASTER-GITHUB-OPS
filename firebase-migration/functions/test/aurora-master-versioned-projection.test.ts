import assert from "node:assert/strict";
import test from "node:test";
import { auroraDb } from "../src/firebase.js";
import { refreshProjection } from "../src/auroraRuntime.js";
import { buildMasterOperationalState } from "../src/auroraMasterEngine.js";
import { immutableEntityVersionId, mergedDocumentForAudit, nextCanonicalEntityRevision } from "../src/index.js";

// Exercise the real projection reader/writer and master planner with a local SDK
// double. Ingestion acceptance/Firestore atomicity remain separate test gates.
test("master consumes current entities after PR123 revisions, never the history as revenue", async (t) => {
  const orgId = "tenant-versioning-synthetic";
  const base = `organizations/${orgId}`;
  const competence = "2026-10";
  const invoiceV1 = {
    orgId, competence, entityKey: "invoice-synthetic", schemaVersion: 1,
    revision: 1, sourceVersion: 1, workflowState: "VALIDATED", totalCents: 10_000,
    source: { system: "SHEETS", sourceId: "sheet-synthetic", contentHash: "a".repeat(64) }
  };
  const invoiceV2 = mergedDocumentForAudit(invoiceV1, {
    revision: nextCanonicalEntityRevision(invoiceV1.revision), sourceVersion: 1,
    totalCents: 6_000, source: { contentHash: "b".repeat(64) }
  });
  const invoiceV3 = mergedDocumentForAudit(invoiceV2, {
    revision: nextCanonicalEntityRevision(invoiceV2.revision), sourceVersion: 1,
    source: { contentHash: "c".repeat(64) }
  });
  const collections: Record<string, Array<Record<string, unknown>>> = {
    invoices: [invoiceV1],
    bankTransactions: [{ orgId, competence, revision: 1, sourceVersion: 1,
      workflowState: "VALIDATED", status: "RECONCILED", amountCents: 6_000 }],
    glosses: [], actionItems: [], sourceDocuments: [], reconciliations: [], auditFindings: []
  };
  const entityHistory = new Map([[immutableEntityVersionId("invoice", "invoice-synthetic", 1), structuredClone(invoiceV1)]]);
  const stored = new Map<string, any>();
  const reads: string[] = [];
  t.mock.method(auroraDb, "doc", ((path: string) => ({ path, get: async () => {
    assert.equal(path, base);
    return { exists: true, data: () => ({ active: true, projectionEnabled: true,
      projectionMode: "SHADOW", projectionCompetence: competence }) };
  } })) as any);
  t.mock.method(auroraDb, "collection", ((path: string) => {
    assert.ok(path.startsWith(`${base}/`), "reads must stay in the authorized tenant");
    const name = path.slice(base.length + 1);
    assert.ok(Object.hasOwn(collections, name), `unexpected source/history read: ${path}`);
    reads.push(name);
    return { limit: (limit: number) => ({ get: async () => {
      assert.equal(limit, 1001);
      return { size: collections[name]!.length, docs: collections[name]!.map(data => ({ data: () => data })) };
    } }) };
  }) as any);
  t.mock.method(auroraDb, "runTransaction", (async (callback: any) => {
    const tx = {
      create: (ref: { path: string }, data: any) => {
        assert.ok(ref.path.startsWith(`${base}/dashboardSnapshotHistory/`) || ref.path.startsWith(`${base}/auditEvents/`));
        assert.equal(stored.has(ref.path), false, "immutable history must not be overwritten");
        stored.set(ref.path, data);
      },
      set: (ref: { path: string }, data: any) => {
        assert.ok(ref.path.startsWith(`${base}/dashboardSnapshots/`), "projection must not mutate ingested entities or versions");
        stored.set(ref.path, data);
      }
    };
    return callback(tx);
  }) as any);

  async function refresh() {
    await refreshProjection(orgId);
    const snapshot = stored.get(`${base}/dashboardSnapshots/current`);
    return { snapshot, master: buildMasterOperationalState(snapshot) as any };
  }
  const first = await refresh();

  await t.test("persisted projection envelope is accepted and retains financial provenance", () => {
    assert.equal(first.master.governance.dataAssessment.decision, "ALLOW");
    assert.equal(first.master.source.snapshotId, first.snapshot.snapshotId);
    assert.equal(first.master.source.sourceHash, first.snapshot.sourceHash);
    assert.equal(first.master.source.schemaVersion, 2); // Not entity schemaVersion=1.
    assert.equal(first.snapshot.financialCents.invoicedCents, 10_000);
    assert.equal(first.snapshot.financialCents.outstandingCents, 4_000);
    assert.ok(first.master.priorities.some((p: any) => p.code === "REVENUE_GAP"));
  });

  collections.invoices = [invoiceV2];
  entityHistory.set(immutableEntityVersionId("invoice", "invoice-synthetic", 2), structuredClone(invoiceV2) as any);
  const corrected = await refresh();
  await t.test("same Sheets sourceVersion with higher canonical revision replaces the aggregate", () => {
    assert.equal(invoiceV2.sourceVersion, 1);
    assert.equal(invoiceV2.revision, 2);
    assert.equal(corrected.snapshot.sampleSizes.invoices, 1);
    assert.equal(corrected.snapshot.financialCents.invoicedCents, 6_000);
    assert.equal(corrected.snapshot.financialCents.outstandingCents, 0);
    assert.notEqual(corrected.snapshot.sourceHash, first.snapshot.sourceHash);
    assert.notEqual(corrected.snapshot.snapshotId, first.snapshot.snapshotId);
    assert.equal(corrected.master.priorities.some((p: any) => p.code === "REVENUE_GAP"), false);
    assert.equal(first.snapshot.financialCents.invoicedCents, 10_000);
    assert.deepEqual(entityHistory.get(immutableEntityVersionId("invoice", "invoice-synthetic", 1)), invoiceV1);
    assert.equal(stored.get(`${base}/dashboardSnapshotHistory/${first.snapshot.snapshotId}`), first.snapshot);
  });

  const unchanged = await refresh();
  await t.test("unchanged canonical input preserves source hash and recommendations", () => {
    assert.equal(unchanged.snapshot.sourceHash, corrected.snapshot.sourceHash);
    assert.deepEqual(unchanged.master.priorities, corrected.master.priorities);
    assert.deepEqual(unchanged.snapshot.financialCents, corrected.snapshot.financialCents);
    assert.equal(entityHistory.size, 2);
  });

  collections.invoices = [invoiceV3];
  const metadataOnly = await refresh();
  await t.test("revision-only changes invalidate source provenance even when money is unchanged", () => {
    assert.deepEqual(metadataOnly.snapshot.financialCents, corrected.snapshot.financialCents);
    assert.notEqual(metadataOnly.snapshot.sourceHash, corrected.snapshot.sourceHash);
    assert.equal(metadataOnly.master.source.sourceHash, metadataOnly.snapshot.sourceHash);
    assert.equal(metadataOnly.master.financialGate.canApproveDistribution, false);
    assert.ok(metadataOnly.master.commandSurface.every((c: any) => c.executionAllowed === false));
  });

  await t.test("revoked or stale versioned snapshots fail closed before financial inference", () => {
    for (const patch of [{ revoked: true }, { asOf: "2020-01-01T00:00:00Z" }]) {
      const input = { ...metadataOnly.snapshot, ...patch };
      Object.defineProperty(input, "financialCents", { get() { throw new Error("INFERENCE_MUST_NOT_RUN"); } });
      const result = buildMasterOperationalState(input) as any;
      assert.equal(result.operationalState, "BLOCKED");
      assert.equal(result.governance.dataAssessment.decision, "DENY");
    }
    assert.equal(reads.includes("entityVersions"), false);
    assert.equal(reads.length, 4 * Object.keys(collections).length);
  });
});
