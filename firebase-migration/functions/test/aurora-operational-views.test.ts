import assert from "node:assert/strict";
import test from "node:test";
import {
  managerInputTransitionPatch,
  publicAuditEvent,
  publicEligibleEvidence
} from "../src/auroraOperationalViews.ts";

const timestamp = { toDate: () => new Date("2026-10-02T12:00:00Z") };
const eligibleEvidence = {
  orgId: "wmgj",
  sanitized: true,
  sensitivity: "RESTRICTED",
  workflowState: "VALIDATED",
  nativeReady: true,
  sourceIndependent: true,
  externalFetchRequired: false,
  canonicalSnapshotVersion: 1,
  canonicalSnapshotHash: "a".repeat(64),
  documentType: "FINANCIAL",
  originSystem: "TASY",
  competence: "2026-09",
  updatedAt: timestamp
};

test("evidence view exposes only bounded operational metadata", () => {
  assert.deepEqual(publicEligibleEvidence("doc-1", eligibleEvidence, "wmgj"), {
    id: "doc-1",
    category: "FINANCIAL",
    originSystem: "TASY",
    competence: "2026-09",
    workflowState: "VALIDATED",
    updatedAt: "2026-10-02T12:00:00.000Z"
  });
  assert.equal(publicEligibleEvidence("doc-1", { ...eligibleEvidence, sanitized: false }, "wmgj"), null);
  assert.equal(publicEligibleEvidence("doc-1", { ...eligibleEvidence, orgId: "other" }, "wmgj"), null);
});

test("audit view omits actor uid, hashes and narrative fields", () => {
  const view = publicAuditEvent("event-1", {
    orgId: "wmgj",
    sanitized: true,
    sensitivity: "INTERNAL",
    type: "ACTION_RESOLVE",
    actionId: "action-1",
    targetType: "managementInput",
    targetId: "mgmt-1",
    fromState: "ACKNOWLEDGED",
    toState: "RESOLVED",
    revision: 3,
    evidenceRefCount: 2,
    actorRole: "auditor",
    actorUid: "secret-user-id",
    commandHash: "secret-hash",
    title: "narrative must not leave the ledger",
    occurredAt: timestamp
  }, "wmgj");
  assert.deepEqual(view, {
    id: "event-1",
    type: "ACTION_RESOLVE",
    occurredAt: "2026-10-02T12:00:00.000Z",
    actionId: "action-1",
    targetType: "managementInput",
    targetId: "mgmt-1",
    fromState: "ACKNOWLEDGED",
    toState: "RESOLVED",
    revision: 3,
    evidenceRefCount: 2,
    actorRole: "auditor"
  });
  assert.equal(Object.hasOwn(view ?? {}, "actorUid"), false);
  assert.equal(Object.hasOwn(view ?? {}, "commandHash"), false);
  assert.equal(Object.hasOwn(view ?? {}, "title"), false);
});

test("manager input follows action revision without dropping evidence", () => {
  const action = {
    orgId: "wmgj",
    targetType: "managementInput",
    targetId: "mgmt-1",
    evidenceRefs: ["doc-1", "doc-2"]
  };
  const acknowledged = managerInputTransitionPatch({
    orgId: "wmgj",
    actionId: "action-1",
    actorUid: "u-1",
    expectedRevision: 1,
    type: "ACKNOWLEDGE",
    action,
    managerInput: { orgId: "wmgj", actionId: "action-1", state: "OPEN", revision: 1, evidenceRefs: ["doc-2", "doc-1"] }
  });
  assert.deepEqual(acknowledged, {
    state: "ACKNOWLEDGED",
    revision: 2,
    evidenceRefs: ["doc-1", "doc-2"],
    resolutionCode: null,
    updatedBy: "u-1"
  });

  const resolved = managerInputTransitionPatch({
    orgId: "wmgj",
    actionId: "action-1",
    actorUid: "u-2",
    expectedRevision: 2,
    type: "RESOLVE",
    resolutionCode: "EVIDENCE_CONFIRMED",
    resolutionEvidenceRefs: ["doc-2", "doc-1"],
    action,
    managerInput: { orgId: "wmgj", actionId: "action-1", state: "ACKNOWLEDGED", revision: 2, evidenceRefs: ["doc-1", "doc-2"] }
  });
  assert.deepEqual(resolved, {
    state: "RESOLVED",
    revision: 3,
    evidenceRefs: ["doc-1", "doc-2"],
    resolutionCode: "EVIDENCE_CONFIRMED",
    updatedBy: "u-2"
  });
});

test("manager transition fails closed on drift or evidence substitution", () => {
  const action = { targetType: "managementInput", evidenceRefs: ["doc-1", "doc-2"] };
  assert.throws(() => managerInputTransitionPatch({
    orgId: "wmgj", actionId: "action-1", actorUid: "u-1", expectedRevision: 2, type: "RESOLVE",
    resolutionCode: "EVIDENCE_CONFIRMED", resolutionEvidenceRefs: ["doc-1"], action,
    managerInput: { orgId: "wmgj", actionId: "action-1", state: "ACKNOWLEDGED", revision: 2, evidenceRefs: ["doc-1", "doc-2"] }
  }), /EVIDENCE_SET_MISMATCH/);
  assert.throws(() => managerInputTransitionPatch({
    orgId: "wmgj", actionId: "action-1", actorUid: "u-1", expectedRevision: 2, type: "RESOLVE",
    resolutionCode: "EVIDENCE_CONFIRMED", resolutionEvidenceRefs: ["doc-1", "doc-2"], action,
    managerInput: { orgId: "wmgj", actionId: "action-1", state: "OPEN", revision: 2, evidenceRefs: ["doc-1", "doc-2"] }
  }), /TARGET_STATE_CONFLICT/);
  assert.throws(() => managerInputTransitionPatch({
    orgId: "wmgj", actionId: "action-1", actorUid: "u-1", expectedRevision: 2, type: "RESOLVE",
    resolutionCode: "EVIDENCE_CONFIRMED", resolutionEvidenceRefs: ["doc-1", "doc-2"], action,
    managerInput: { orgId: "wmgj", actionId: "action-other", state: "ACKNOWLEDGED", revision: 2, evidenceRefs: ["doc-1", "doc-2"] }
  }), /TARGET_ACTION_MISMATCH/);
});
