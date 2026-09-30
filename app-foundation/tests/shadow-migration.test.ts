import { describe, expect, it } from "vitest";
import {
  evaluateShadowSnapshot,
  shadowSnapshotSchema,
} from "../functions/src/shadow-contracts.ts";
import { validShadowSignature } from "../functions/src/shadow-ingest.ts";
import { hmacSha256 } from "../functions/src/crypto.ts";

const validSnapshot = {
  snapshotId: "aeb190dc-3d12-4fb6-8c88-b08b49d96abc",
  tenantId: "wmgj-test",
  siteId: "unit-test",
  schemaVersion: 1,
  sourceSystem: "APPS_SCRIPT_V3",
  mode: "SHADOW",
  observedAt: "2026-09-12T18:00:00-03:00",
  sequence: 1,
  pipelineVersion: "v1.0.1-pipeline-estavel",
  competence: "2026-09",
  dataClass: "AGGREGATED_NON_CLINICAL",
  safeguards: {
    identifiersExcluded: true,
    clinicalFieldsExcluded: true,
    rawRowsExcluded: true,
    freeTextExcluded: true,
  },
  metrics: {
    pending: 2,
    processing: 0,
    processed: 98,
    humanReview: 0,
    duplicates: 1,
    errors: 0,
  },
  sla: {
    queueOldestAgeMinutes: 10,
    humanReviewOverdue: 0,
    lastSuccessfulRunAt: "2026-09-12T17:55:00-03:00",
  },
  governance: {
    evidenceCoverageRate: 0.98,
    reconciliationState: "RECONCILED",
    productionCutoverRequested: false,
  },
} as const;

describe("migração Firebase em shadow mode", () => {
  it("aceita somente snapshot agregado e não clínico", () => {
    expect(shadowSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
    expect(
      shadowSnapshotSchema.safeParse({
        ...validSnapshot,
        patientName: "campo proibido",
      }).success,
    ).toBe(false);
  });

  it("impede solicitação de cutover pelo payload", () => {
    expect(
      shadowSnapshotSchema.safeParse({
        ...validSnapshot,
        governance: {
          ...validSnapshot.governance,
          productionCutoverRequested: true,
        },
      }).success,
    ).toBe(false);
  });

  it("aprova snapshot dentro do SLA sem gerar mudança automática", () => {
    const evaluation = evaluateShadowSnapshot(
      shadowSnapshotSchema.parse(validSnapshot),
    );
    expect(evaluation.state).toBe("PASS");
    expect(evaluation.learningDisposition).toBe("NO_CHANGE");
  });

  it("transforma desvios em observação pendente de revisão humana", () => {
    const snapshot = shadowSnapshotSchema.parse({
      ...validSnapshot,
      metrics: { ...validSnapshot.metrics, errors: 2 },
      sla: { ...validSnapshot.sla, queueOldestAgeMinutes: 90 },
      governance: {
        ...validSnapshot.governance,
        evidenceCoverageRate: 0.8,
        reconciliationState: "DIVERGENT",
      },
    });
    const evaluation = evaluateShadowSnapshot(snapshot);
    expect(evaluation.state).toBe("REVIEW_REQUIRED");
    expect(evaluation.learningDisposition).toBe("PENDING_HUMAN_REVIEW");
    expect(evaluation.breachCodes).toEqual([
      "QUEUE_SLA_BREACH",
      "PROCESSING_ERRORS_PRESENT",
      "EVIDENCE_COVERAGE_LOW",
      "RECONCILIATION_DIVERGENT",
    ]);
  });

  it("valida assinatura HMAC sem aceitar formato ambíguo", () => {
    const secret = "test-only-secret-with-at-least-32-characters";
    const timestamp = "1789232400";
    const body = JSON.stringify(validSnapshot);
    const signature = `sha256=${hmacSha256(secret, `${timestamp}.${body}`)}`;
    expect(validShadowSignature(secret, timestamp, body, signature)).toBe(true);
    expect(validShadowSignature(secret, timestamp, `${body} `, signature)).toBe(false);
    expect(validShadowSignature(secret, timestamp, body, signature.toUpperCase())).toBe(false);
  });
});
