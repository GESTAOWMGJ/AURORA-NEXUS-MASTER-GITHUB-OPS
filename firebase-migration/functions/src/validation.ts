import {
  EVENT_TYPES,
  REVIEW_STATES,
  RISK_LEVELS,
  WORKFLOW_STATES,
  type ValidationResult,
  type WmgjIngestionEvent
} from "./types.js";
import { isAllowedEntityType, validateGenericIngestionPolicy } from "./policy.js";

const ORG_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SAFE_ENTITY = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;
const ISO_COMPETENCE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_BODY_BYTES = 900_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, name: string, errors: string[], max = 512): string {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${name} ausente ou inválido`);
    return "";
  }
  const normalized = value.trim();
  if (normalized.length > max) errors.push(`${name} excede ${max} caracteres`);
  return normalized;
}

function cleanObject(value: unknown, depth = 0): Record<string, unknown> {
  if (!isObject(value) || depth > 8) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (key.length > 128) continue;
    if (Array.isArray(raw)) {
      output[key] = raw.slice(0, 500).map((item) =>
        isObject(item) ? cleanObject(item, depth + 1) : item
      );
    } else if (isObject(raw)) {
      output[key] = cleanObject(raw, depth + 1);
    } else if (["string", "number", "boolean"].includes(typeof raw) || raw === null) {
      output[key] = typeof raw === "string" ? raw.slice(0, 50_000) : raw;
    }
  }
  return output;
}

function containsNestedArray(value: unknown, insideArray = false, depth = 0): boolean {
  if (depth > 10) return true;
  if (Array.isArray(value)) {
    if (insideArray) return true;
    return value.some((item) => containsNestedArray(item, true, depth + 1));
  }
  if (isObject(value)) {
    return Object.values(value).some((item) => containsNestedArray(item, false, depth + 1));
  }
  return false;
}

export function validateEvent(input: unknown, rawBytes: number): ValidationResult {
  const errors: string[] = [];
  if (rawBytes > MAX_BODY_BYTES) errors.push("payload acima do limite permitido");
  if (!isObject(input)) return { ok: false, errors: ["corpo JSON deve ser objeto"] };

  const eventId = requiredString(input.eventId, "eventId", errors, 128);
  const orgId = requiredString(input.orgId, "orgId", errors, 64);
  const occurredAt = requiredString(input.occurredAt, "occurredAt", errors, 64);
  const sourceVersion = input.sourceVersion;
  const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey", errors, 512);
  const entityType = requiredString(input.entityType, "entityType", errors, 64);
  const entityKey = requiredString(input.entityKey, "entityKey", errors, 512);

  if (input.schemaVersion !== 1) errors.push("schemaVersion deve ser 1");
  if (!ORG_ID.test(orgId)) errors.push("orgId fora do padrão seguro");
  if (!SAFE_ENTITY.test(entityType)) errors.push("entityType fora do padrão seguro");
  if (entityType && !isAllowedEntityType(entityType)) errors.push("entityType não permitido");
  if (!ISO_DATE_TIME.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))) {
    errors.push("occurredAt não é data ISO válida");
  }
  if (!Number.isSafeInteger(sourceVersion) || Number(sourceVersion) < 1) {
    errors.push("sourceVersion deve ser inteiro positivo seguro");
  }
  if (!EVENT_TYPES.includes(input.eventType as never)) errors.push("eventType inválido");
  if (!WORKFLOW_STATES.includes(input.workflowState as never)) errors.push("workflowState inválido");
  if (!REVIEW_STATES.includes(input.reviewState as never)) errors.push("reviewState inválido");
  if (!RISK_LEVELS.includes(input.riskLevel as never)) errors.push("riskLevel inválido");
  if (!input.competence || input.competence === "") {
    // competência pode ser desconhecida na ingestão documental.
  } else if (typeof input.competence !== "string" || !ISO_COMPETENCE.test(input.competence)) {
    errors.push("competence deve usar YYYY-MM");
  }

  const sensitivityAllowed = ["PUBLIC", "INTERNAL", "RESTRICTED", "CLINICAL_SENSITIVE"];
  if (!sensitivityAllowed.includes(String(input.sensitivity || ""))) errors.push("sensitivity inválida");
  if (!isObject(input.actor)) errors.push("actor inválido");
  if (!isObject(input.source)) errors.push("source inválido");
  if (!isObject(input.record)) errors.push("record inválido");
  if (containsNestedArray(input.record) || containsNestedArray(input.metadata)) {
    errors.push("arrays aninhados não são compatíveis com o Firestore");
  }

  const actor = isObject(input.actor) ? input.actor : {};
  const source = isObject(input.source) ? input.source : {};
  const actorTypes = ["SYSTEM", "USER", "AI"];
  const sourceSystems = ["GMAIL", "DRIVE", "SHEETS", "APPS_SCRIPT", "MANUAL", "MV", "TASY", "ERP"];
  if (!actorTypes.includes(String(actor.type || ""))) errors.push("actor.type inválido");
  if (!sourceSystems.includes(String(source.system || ""))) errors.push("source.system inválido");
  requiredString(actor.id, "actor.id", errors, 256);
  requiredString(actor.source, "actor.source", errors, 128);
  requiredString(source.sourceId, "source.sourceId", errors, 512);

  if (errors.length > 0) return { ok: false, errors };

  const event: WmgjIngestionEvent = {
    schemaVersion: 1,
    eventId,
    eventType: input.eventType as WmgjIngestionEvent["eventType"],
    orgId,
    occurredAt,
    sourceVersion: Number(sourceVersion),
    idempotencyKey,
    entityType,
    entityKey,
    actor: {
      type: actor.type as WmgjIngestionEvent["actor"]["type"],
      id: String(actor.id),
      source: String(actor.source)
    },
    // A política recebe também extensões desconhecidas de source. Assim, um
    // produtor não consegue esconder PHI em um campo extra antes da validação.
    source: cleanObject(source) as unknown as WmgjIngestionEvent["source"],
    workflowState: input.workflowState as WmgjIngestionEvent["workflowState"],
    reviewState: input.reviewState as WmgjIngestionEvent["reviewState"],
    riskLevel: input.riskLevel as WmgjIngestionEvent["riskLevel"],
    sensitivity: input.sensitivity as WmgjIngestionEvent["sensitivity"],
    competence: typeof input.competence === "string" ? input.competence : undefined,
    documentType: typeof input.documentType === "string" ? input.documentType.slice(0, 128) : undefined,
    record: cleanObject(input.record),
    metadata: cleanObject(input.metadata)
  };

  const policyErrors = validateGenericIngestionPolicy(event);
  if (policyErrors.length > 0) return { ok: false, errors: policyErrors };

  return { ok: true, errors: [], event };
}
