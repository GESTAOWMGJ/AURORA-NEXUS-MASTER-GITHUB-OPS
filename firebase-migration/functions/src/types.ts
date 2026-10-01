export const EVENT_TYPES = [
  "ENTITY_UPSERT",
  "DOCUMENT_UPSERT",
  "RUNTIME_CHECKPOINT",
  "AI_RUN_RECORDED"
] as const;

export const WORKFLOW_STATES = [
  "RECEIVED",
  "QUEUED",
  "CLASSIFIED",
  "EXTRACTED",
  "NORMALIZED",
  "PENDING_EVIDENCE",
  "PENDING_HUMAN_REVIEW",
  "BLOCKED",
  "VALIDATED",
  "CLOSED",
  "FAILED",
  "DEAD_LETTER"
] as const;

export const REVIEW_STATES = [
  "NOT_REQUIRED",
  "PENDING",
  "APPROVED",
  "REJECTED"
] as const;

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type EventType = typeof EVENT_TYPES[number];
export type WorkflowState = typeof WORKFLOW_STATES[number];
export type ReviewState = typeof REVIEW_STATES[number];
export type RiskLevel = typeof RISK_LEVELS[number];

export interface WmgjSource {
  system: "GMAIL" | "DRIVE" | "SHEETS" | "APPS_SCRIPT" | "MANUAL";
  sourceId: string;
  parentId?: string;
  fileName?: string;
  mimeType?: string;
  url?: string;
  contentHash?: string;
  hashMethod?: "content_sha256" | "metadata_sha256_fallback" | "row_sha256";
}

export interface WmgjActor {
  type: "SYSTEM" | "USER" | "AI";
  id: string;
  source: string;
}

export interface WmgjIngestionEvent {
  schemaVersion: 1;
  eventId: string;
  eventType: EventType;
  orgId: string;
  occurredAt: string;
  sourceVersion: number;
  idempotencyKey: string;
  entityType: string;
  entityKey: string;
  actor: WmgjActor;
  source: WmgjSource;
  workflowState: WorkflowState;
  reviewState: ReviewState;
  riskLevel: RiskLevel;
  sensitivity: "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CLINICAL_SENSITIVE";
  competence?: string;
  documentType?: string;
  record: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  event?: WmgjIngestionEvent;
}
