import assert from "node:assert/strict";
import test from "node:test";
import { assessDocumentWatch } from "../src/auroraDocumentGovernance.ts";

const now = new Date("2026-10-01T15:00:00Z");

test("healthy native Firebase document creates no governance issue", () => {
  assert.equal(assessDocumentWatch("doc-1", {
    workflowState: "VALIDATED",
    nativeReady: true,
    sourceIndependent: true,
    externalFetchRequired: false,
    missingFieldsCount: 0,
    documentFragility: "NONE",
    canonicalSnapshotHash: "a".repeat(64),
    sourceVersion: 1
  }, now), null);
});

test("degraded MV document becomes high-risk rework candidate", () => {
  const assessment = assessDocumentWatch("doc-2", {
    workflowState: "VALIDATED",
    nativeReady: false,
    sourceIndependent: false,
    externalFetchRequired: true,
    documentFragility: "DEGRADED_EXTRACTION",
    originSystem: "MV",
    sourceVersion: 2
  }, now);
  assert.ok(assessment);
  assert.equal(assessment.riskLevel, "HIGH");
  assert.equal(assessment.reasonCode, "MISSING_EVIDENCE");
  assert.equal(assessment.organicSignalKind, "REWORK");
  assert.deepEqual(assessment.codes, ["DOCUMENT_FRAGILITY"]);
});

test("overdue TASY flow carries SLA and bottleneck signals", () => {
  const assessment = assessDocumentWatch("doc-3", {
    workflowState: "PENDING_HUMAN_REVIEW",
    nativeReady: true,
    sourceIndependent: true,
    externalFetchRequired: false,
    documentFragility: "NONE",
    slaDueAt: "2026-10-01T12:00:00Z",
    originSystem: "TASY",
    sourceVersion: 3
  }, now);
  assert.ok(assessment);
  assert.equal(assessment.reasonCode, "SLA_BREACH");
  assert.equal(assessment.riskLevel, "HIGH");
  assert.equal(assessment.codes.includes("DOCUMENT_SLA_OVERDUE"), true);
  assert.equal(assessment.codes.includes("FLOW_BOTTLENECK"), true);
});

test("watch fingerprint changes when source version changes", () => {
  const base = {
    workflowState: "PENDING_HUMAN_REVIEW",
    nativeReady: false,
    sourceIndependent: false,
    externalFetchRequired: true,
    documentFragility: "LOW_CONFIDENCE",
    slaDueAt: "2026-10-02T12:00:00Z"
  };
  const a = assessDocumentWatch("doc-4", { ...base, sourceVersion: 1 }, now);
  const b = assessDocumentWatch("doc-4", { ...base, sourceVersion: 2 }, now);
  assert.ok(a && b);
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("test records never produce operational document issues", () => {
  assert.equal(assessDocumentWatch("doc-test", {
    environment: "TESTE",
    workflowState: "FAILED",
    nativeReady: false,
    sourceIndependent: false
  }, now), null);
});
