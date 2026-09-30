import { z } from "zod";

export const operationalActions = [
  "diagnosticar",
  "processarFila",
  "reprocessarErros",
  "auditarCodigo",
  "validarStatus",
  "abrirRevisao",
  "marcarRevisado",
] as const;

export const operationalReasonCodes = [
  "MANUAL_DIAGNOSTIC",
  "QUEUE_REQUEST",
  "ELIGIBLE_RETRY",
  "TECHNICAL_AUDIT",
  "STATUS_VALIDATION",
  "HUMAN_REVIEW_OPENED",
  "HUMAN_REVIEW_DECIDED",
] as const;

const reasonCodeByAction = {
  diagnosticar: "MANUAL_DIAGNOSTIC",
  processarFila: "QUEUE_REQUEST",
  reprocessarErros: "ELIGIBLE_RETRY",
  auditarCodigo: "TECHNICAL_AUDIT",
  validarStatus: "STATUS_VALIDATION",
  abrirRevisao: "HUMAN_REVIEW_OPENED",
  marcarRevisado: "HUMAN_REVIEW_DECIDED",
} as const;

const targetedReviewActions = new Set<
  (typeof operationalActions)[number]
>(["abrirRevisao", "marcarRevisado"]);

export const operationalActionSchema = z
  .object({
    tenantId: z.string().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/),
    siteId: z.string().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/).nullable(),
    commandId: z.uuid(),
    action: z.enum(operationalActions),
    reasonCode: z.enum(operationalReasonCodes),
    targetId: z
      .string()
      .min(3)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .nullable(),
    expectedRevision: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (reasonCodeByAction[value.action] !== value.reasonCode) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "REASON_CODE_ACTION_MISMATCH",
      });
    }

    const requiresTarget = targetedReviewActions.has(value.action);
    if (requiresTarget && (value.targetId === null || value.expectedRevision === null)) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "REVIEW_TARGET_AND_REVISION_REQUIRED",
      });
    }
    if (!requiresTarget && (value.targetId !== null || value.expectedRevision !== null)) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "TARGET_NOT_ALLOWED_FOR_ACTION",
      });
    }
  });

export type OperationalAction = z.infer<typeof operationalActionSchema>;

export const actionPermission: Record<OperationalAction["action"], string> = {
  diagnosticar: "operations.command",
  processarFila: "operations.command",
  reprocessarErros: "operations.command",
  auditarCodigo: "audit.command",
  validarStatus: "operations.command",
  abrirRevisao: "validation.open",
  marcarRevisado: "validation.decide",
};

export const mfaRequiredActions = new Set<OperationalAction["action"]>([
  "auditarCodigo",
  "marcarRevisado",
]);

const classificationSignals = [
  "invoice",
  "bank",
  "production",
  "contract",
  "quality",
  "nps",
  "unknown",
] as const;

const allowedMimeTypes = [
  "application/json",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const evidenceKindHints = [
  "contrato",
  "financeiro",
  "producao_agregada",
  "qualidade",
  "outro",
] as const;

const classificationReasonCodes = [
  "AMOUNT_PRESENT",
  "COMPETENCE_PRESENT",
  "CONTRACT_REFERENCE_PRESENT",
  "SOURCE_SIGNAL",
  "INSUFFICIENT_METADATA",
  "LOW_CONFIDENCE",
  "CATEGORY_AMBIGUOUS",
] as const;

export const sanitizedClassificationInputSchema = z
  .object({
    sourceKind: z.enum(["SHEETS", "GMAIL", "DRIVE", "UPLOAD", "WEBHOOK"]),
    mimeType: z.enum(allowedMimeTypes),
    evidenceKindHint: z.enum(evidenceKindHints),
    amountPresent: z.boolean(),
    competencePresent: z.boolean(),
    contractReferencePresent: z.boolean(),
    signals: z.array(z.enum(classificationSignals)).max(12),
  })
  .strict();

export const classificationOutputSchema = z
  .object({
    category: z.enum([
      "financeiro",
      "produtividade",
      "contrato",
      "qualidade",
      "outro",
    ]),
    confidence: z.number().min(0).max(1),
    reviewRequired: z.boolean(),
    reasonCodes: z.array(z.enum(classificationReasonCodes)).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.confidence < 0.6 && !value.reviewRequired) {
      context.addIssue({
        code: "custom",
        path: ["reviewRequired"],
        message: "LOW_CONFIDENCE_REQUIRES_REVIEW",
      });
    }
  });

export type SanitizedClassificationInput = z.infer<
  typeof sanitizedClassificationInputSchema
>;
export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

export const classificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "confidence", "reviewRequired", "reasonCodes"],
  properties: {
    category: {
      type: "string",
      enum: [
        "financeiro",
        "produtividade",
        "contrato",
        "qualidade",
        "outro",
      ],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reviewRequired: { type: "boolean" },
    reasonCodes: {
      type: "array",
      maxItems: 8,
      items: { type: "string", enum: classificationReasonCodes },
    },
  },
} as const;
