import { z } from "zod";

const boundedCount = z.number().int().nonnegative().max(10_000_000);

export const shadowSnapshotSchema = z
  .object({
    snapshotId: z.uuid(),
    tenantId: z.string().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/),
    siteId: z.string().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/).nullable(),
    schemaVersion: z.literal(1),
    sourceSystem: z.literal("APPS_SCRIPT_V3"),
    mode: z.literal("SHADOW"),
    observedAt: z.iso.datetime({ offset: true }),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    pipelineVersion: z.string().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/),
    competence: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    dataClass: z.literal("AGGREGATED_NON_CLINICAL"),
    safeguards: z
      .object({
        identifiersExcluded: z.literal(true),
        clinicalFieldsExcluded: z.literal(true),
        rawRowsExcluded: z.literal(true),
        freeTextExcluded: z.literal(true),
      })
      .strict(),
    metrics: z
      .object({
        pending: boundedCount,
        processing: boundedCount,
        processed: boundedCount,
        humanReview: boundedCount,
        duplicates: boundedCount,
        errors: boundedCount,
      })
      .strict(),
    sla: z
      .object({
        queueOldestAgeMinutes: boundedCount.nullable(),
        humanReviewOverdue: boundedCount,
        lastSuccessfulRunAt: z.iso.datetime({ offset: true }).nullable(),
      })
      .strict(),
    governance: z
      .object({
        evidenceCoverageRate: z.number().min(0).max(1),
        reconciliationState: z.enum([
          "NOT_EVALUATED",
          "PENDING_EVIDENCE",
          "RECONCILED",
          "DIVERGENT",
        ]),
        productionCutoverRequested: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type ShadowSnapshot = z.infer<typeof shadowSnapshotSchema>;

export const shadowPolicy = Object.freeze({
  version: "shadow-sla-1.0.0",
  maximumQueueAgeMinutes: 60,
  maximumErrors: 0,
  maximumOverdueReviews: 0,
  minimumEvidenceCoverageRate: 0.95,
});

export const shadowBreachCodes = [
  "QUEUE_SLA_BREACH",
  "PROCESSING_ERRORS_PRESENT",
  "HUMAN_REVIEW_OVERDUE",
  "EVIDENCE_COVERAGE_LOW",
  "RECONCILIATION_DIVERGENT",
] as const;

export type ShadowBreachCode = (typeof shadowBreachCodes)[number];

export interface ShadowEvaluation {
  policyVersion: string;
  state: "PASS" | "REVIEW_REQUIRED";
  breachCodes: ShadowBreachCode[];
  learningDisposition: "NO_CHANGE" | "PENDING_HUMAN_REVIEW";
}

export function evaluateShadowSnapshot(snapshot: ShadowSnapshot): ShadowEvaluation {
  const breachCodes: ShadowBreachCode[] = [];

  if (
    snapshot.sla.queueOldestAgeMinutes !== null &&
    snapshot.sla.queueOldestAgeMinutes > shadowPolicy.maximumQueueAgeMinutes
  ) {
    breachCodes.push("QUEUE_SLA_BREACH");
  }
  if (snapshot.metrics.errors > shadowPolicy.maximumErrors) {
    breachCodes.push("PROCESSING_ERRORS_PRESENT");
  }
  if (snapshot.sla.humanReviewOverdue > shadowPolicy.maximumOverdueReviews) {
    breachCodes.push("HUMAN_REVIEW_OVERDUE");
  }
  if (
    snapshot.governance.evidenceCoverageRate <
    shadowPolicy.minimumEvidenceCoverageRate
  ) {
    breachCodes.push("EVIDENCE_COVERAGE_LOW");
  }
  if (snapshot.governance.reconciliationState === "DIVERGENT") {
    breachCodes.push("RECONCILIATION_DIVERGENT");
  }

  return {
    policyVersion: shadowPolicy.version,
    state: breachCodes.length === 0 ? "PASS" : "REVIEW_REQUIRED",
    breachCodes,
    learningDisposition:
      breachCodes.length === 0 ? "NO_CHANGE" : "PENDING_HUMAN_REVIEW",
  };
}
