import assert from "node:assert/strict";
import test from "node:test";
import {
  isEligibleNonClinicalEvidence,
  validateEvidenceSelection,
  validateResolutionEvidence,
  type FirestoreDocumentReader
} from "../src/auroraEvidence.ts";
import { parseActionCommand } from "../src/auroraEngine.ts";

type Documents = Record<string, Record<string, unknown>>;

function reader(documents: Documents): FirestoreDocumentReader {
  return async (path) => documents[path] ?? null;
}

const action = {
  orgId: "wmgj",
  targetType: "invoice",
  targetId: "invoice-1",
  status: "ACKNOWLEDGED"
};

const targetPath = "organizations/wmgj/invoices/invoice-1";
const evidencePath = "organizations/wmgj/sourceDocuments/doc:1";
const eligibleEvidence = {
  orgId: "wmgj",
  sanitized: true,
  sensitivity: "INTERNAL",
  documentType: "FINANCIAL",
  workflowState: "VALIDATED",
  reviewState: "APPROVED"
};

test("RESOLVE aceita somente evidência existente e autorizada pelo alvo", async () => {
  const result = await validateResolutionEvidence({
    orgId: "wmgj",
    actionId: "action-1",
    action,
    evidenceRefs: ["doc:1"]
  }, reader({
    [targetPath]: { orgId: "wmgj", evidenceRefs: ["doc:1"] },
    [evidencePath]: eligibleEvidence
  }));

  assert.deepEqual(result, { ok: true, evidenceRefs: ["doc:1"] });
});

test("EVIDENCE_CONFIRMED não aceita referência inventada", async () => {
  const command = parseActionCommand({
    type: "RESOLVE",
    actionId: "action-1",
    expectedRevision: 1,
    resolutionCode: "EVIDENCE_CONFIRMED",
    evidenceRefs: ["inventada"]
  });
  assert.ok(command?.type === "RESOLVE");

  const result = await validateResolutionEvidence({
    orgId: "wmgj",
    actionId: "action-1",
    action: { ...action, evidenceRefs: ["inventada"] },
    evidenceRefs: command.evidenceRefs
  }, reader({
    [targetPath]: { orgId: "wmgj" }
  }));

  assert.deepEqual(result, { ok: false, code: "EVIDENCE_NOT_FOUND" });
});

test("RESOLVE rejeita evidência existente de outra organização", async () => {
  const result = await validateResolutionEvidence({
    orgId: "wmgj",
    actionId: "action-1",
    action: { ...action, evidenceRefs: ["doc:1"] },
    evidenceRefs: ["doc:1"]
  }, reader({
    [targetPath]: { orgId: "wmgj" },
    [evidencePath]: { ...eligibleEvidence, orgId: "other", actionId: "action-1" }
  }));

  assert.deepEqual(result, { ok: false, code: "EVIDENCE_SCOPE_VIOLATION" });
});

test("RESOLVE rejeita evidência sem vínculo com ação ou alvo", async () => {
  const result = await validateResolutionEvidence({
    orgId: "wmgj",
    actionId: "action-1",
    action,
    evidenceRefs: ["doc:1"]
  }, reader({
    [targetPath]: { orgId: "wmgj" },
    [evidencePath]: { ...eligibleEvidence, targetType: "invoice", targetId: "invoice-2" }
  }));

  assert.deepEqual(result, { ok: false, code: "EVIDENCE_NOT_LINKED" });
});

test("RESOLVE não aceita vínculo declarado somente pela própria evidência", async () => {
  const result = await validateResolutionEvidence({
    orgId: "wmgj",
    actionId: "action-1",
    action,
    evidenceRefs: ["doc:1"]
  }, reader({
    [targetPath]: { orgId: "wmgj" },
    [evidencePath]: { ...eligibleEvidence, actionId: "action-1", targetType: "invoice", targetId: "invoice-1" }
  }));

  assert.deepEqual(result, { ok: false, code: "EVIDENCE_NOT_LINKED" });
});

test("RESOLVE aceita vínculo explícito autorizado pela ação", async () => {
  const result = await validateResolutionEvidence({
    orgId: "wmgj",
    actionId: "action-1",
    action: { ...action, evidenceRefs: ["doc:1"] },
    evidenceRefs: ["doc:1"]
  }, reader({
    [targetPath]: { orgId: "wmgj" },
    [evidencePath]: eligibleEvidence
  }));

  assert.deepEqual(result, { ok: true, evidenceRefs: ["doc:1"] });
});

test("RESOLVE falha fechado quando ação ou alvo não pertencem à organização", async () => {
  const invalidAction = await validateResolutionEvidence({
    orgId: "wmgj",
    actionId: "action-1",
    action: { ...action, orgId: "other" },
    evidenceRefs: ["doc:1"]
  }, reader({}));
  assert.deepEqual(invalidAction, { ok: false, code: "ACTION_SCOPE_VIOLATION" });

  const invalidTarget = await validateResolutionEvidence({
    orgId: "wmgj",
    actionId: "action-1",
    action,
    evidenceRefs: ["doc:1"]
  }, reader({
    [targetPath]: { orgId: "other", evidenceRefs: ["doc:1"] },
    [evidencePath]: { orgId: "wmgj" }
  }));
  assert.deepEqual(invalidTarget, { ok: false, code: "TARGET_SCOPE_VIOLATION" });
});

test("seletor aceita apenas evidência sanitizada, não clínica e governada", async () => {
  assert.equal(isEligibleNonClinicalEvidence(eligibleEvidence, "wmgj"), true);
  for (const rejected of [
    { ...eligibleEvidence, sanitized: false },
    { ...eligibleEvidence, sensitivity: "CLINICAL_SENSITIVE" },
    { ...eligibleEvidence, documentType: "PRONTUARIO_CLINICO" },
    { ...eligibleEvidence, workflowState: "PENDING_HUMAN_REVIEW" },
    { ...eligibleEvidence, reviewState: "PENDING" },
    { ...eligibleEvidence, revoked: true },
    { ...eligibleEvidence, documentType: "LAB_RESULT" },
    { ...eligibleEvidence, documentType: "MEDICAL-RECORD" },
    { ...eligibleEvidence, documentType: "HEALTH_RECORD" },
    { ...eligibleEvidence, documentType: "ICD10" },
    { ...eligibleEvidence, documentType: "EXAME" },
    { ...eligibleEvidence, documentType: "LAUDO" },
    { ...eligibleEvidence, documentType: "OTHER" }
  ]) assert.equal(isEligibleNonClinicalEvidence(rejected, "wmgj"), false);

  const rejected = await validateEvidenceSelection("wmgj", ["doc:1"], reader({
    [evidencePath]: { ...eligibleEvidence, sensitivity: "CLINICAL_SENSITIVE" }
  }));
  assert.deepEqual(rejected, { ok: false, code: "EVIDENCE_NOT_ELIGIBLE" });
});

test("tarefa de gestão exige o mesmo conjunto de evidências na ação, alvo e resolução", async () => {
  const managementAction = {
    orgId: "wmgj",
    targetType: "managementInput",
    targetId: "mgmt-1",
    evidenceRefs: ["doc:1", "doc:2"]
  };
  const documents = {
    "organizations/wmgj/managerInputs/mgmt-1": { orgId: "wmgj", evidenceRefs: ["doc:1", "doc:2"] },
    [evidencePath]: eligibleEvidence,
    "organizations/wmgj/sourceDocuments/doc:2": eligibleEvidence
  };
  const valid = await validateResolutionEvidence({
    orgId: "wmgj", actionId: "action-1", action: managementAction, evidenceRefs: ["doc:2", "doc:1"]
  }, reader(documents));
  assert.deepEqual(valid, { ok: true, evidenceRefs: ["doc:2", "doc:1"] });

  const partial = await validateResolutionEvidence({
    orgId: "wmgj", actionId: "action-1", action: managementAction, evidenceRefs: ["doc:1"]
  }, reader(documents));
  assert.deepEqual(partial, { ok: false, code: "EVIDENCE_SET_MISMATCH" });
});
