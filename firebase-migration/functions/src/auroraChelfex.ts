import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { assessNativeData } from './auroraDataGovernance.js';
import { generateNativeInsight, type NativeInsightFinding } from './auroraNativeIntelligence.js';

/** Code is the executable policy; the JSON mirror is checked by regression tests. */
export const CHELFEX_POLICY = Object.freeze({
  id: 'AURORA-CHELFEX-001', version: '1.1.2-rc.5', schema: 'aurora.chelfex.task.v1',
  mode: 'RECOMMEND_ONLY', financialVisibility: 'CANONICAL_READINESS_THEN_REDACTED_INFERENCE', maxConclusions: 12, maxObjectiveBytes: 1024,
  executionAllowed: false, sourceMutation: false, automaticLearning: false,
  riskByOperation: Object.freeze({ READ: 'R0', PROPOSE: 'R1', REVERSIBLE_CHANGE: 'R2',
    OPERATIONAL_CHANGE: 'R3', FINANCIAL_COMMITMENT: 'R4', CLINICAL_CHANGE: 'R4',
    IRREVERSIBLE_CHANGE: 'R4' }),
  requirementsByRisk: Object.freeze({
    R0: Object.freeze([] as const), R1: Object.freeze([] as const),
    R2: Object.freeze(['SERVER_AUTHORIZATION', 'EXISTING_ALLOWLISTED_ENDPOINT', 'TESTS', 'ROLLBACK', 'READBACK'] as const),
    R3: Object.freeze(['SERVER_AUTHORIZATION', 'APPLICABLE_MFA', 'INDEPENDENT_REVIEW', 'ENVIRONMENT_GATE', 'ROLLBACK', 'READBACK'] as const),
    R4: Object.freeze(['HUMAN_INTERVENTION', 'SEPARATE_RISK_ACCEPTANCE', 'RECOVERY_EVIDENCE'] as const)
  })
} as const);
export const CHELFEX_POLICY_HASH = createHash('sha256').update(JSON.stringify(CHELFEX_POLICY)).digest('hex');
export type ChelfexOperation = keyof typeof CHELFEX_POLICY.riskByOperation;
export type ChelfexContext = {
  orgId: string;
  authority: 'AUTHENTICATED_SERVER' | 'LOCAL_UNVERIFIED_PREVIEW';
};
export type ChelfexTask = {
  schemaVersion: 'aurora.chelfex.task.v1'; orgId: string;
  operation: ChelfexOperation; objective: string;
};
const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Data-only own properties; accepts ordinary records across Node VM realms. */
function dataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null) {
    if (types.isProxy(prototype) || Object.getPrototypeOf(prototype) !== null) return false;
    const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    if (!constructor || !Object.hasOwn(constructor, 'value') || typeof constructor.value !== 'function'
      || Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(Object)) return false;
  }
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return dataRecord(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  const expected = value.length === 20 ? value.slice(0, -1) + '.000Z' : value;
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === expected;
}
export function parseChelfexTask(value: unknown): ChelfexTask {
  if (!closed(value, ['schemaVersion', 'orgId', 'operation', 'objective'])
    || value.schemaVersion !== CHELFEX_POLICY.schema
    || typeof value.orgId !== 'string' || !ID.test(value.orgId)
    || typeof value.operation !== 'string' || !Object.hasOwn(CHELFEX_POLICY.riskByOperation, value.operation)
    || typeof value.objective !== 'string' || !value.objective.trim()
    || Buffer.byteLength(value.objective, 'utf8') > CHELFEX_POLICY.maxObjectiveBytes) {
    throw new Error('CHELFEX_CLOSED_SCHEMA_REQUIRED');
  }
  return { schemaVersion: CHELFEX_POLICY.schema, orgId: value.orgId,
    operation: value.operation as ChelfexOperation, objective: value.objective };
}
export function classifyChelfexRisk(operation: unknown) {
  if (typeof operation !== 'string' || !Object.hasOwn(CHELFEX_POLICY.riskByOperation, operation)) {
    throw new Error('CHELFEX_OPERATION_NOT_SUPPORTED');
  }
  return CHELFEX_POLICY.riskByOperation[operation as ChelfexOperation];
}
export function parseChelfexContext(value: unknown): ChelfexContext | null {
  if (!closed(value, ['orgId', 'authority']) || typeof value.orgId !== 'string' || !ID.test(value.orgId)
    || (value.authority !== 'AUTHENTICATED_SERVER' && value.authority !== 'LOCAL_UNVERIFIED_PREVIEW')) return null;
  return { orgId: value.orgId, authority: value.authority };
}

/**
 * Pure, synchronous assessment. Context is supplied by the authenticated caller,
 * never deserialized from HTTP/model input. Local imports remain unverified even
 * with valid snapshot fields. This return value is not an authorization token.
 * Objective text is only hashed: it never selects an operation or becomes code.
 */
export function buildChelfexContract(raw: unknown, rawContext: unknown,
  rawProjection: unknown, now: Date = new Date(), redactFinancial = false) {
  let task: ChelfexTask | null = null;
  const blockers: string[] = [];
  try { task = parseChelfexTask(raw); } catch { blockers.push('CHELFEX_CLOSED_SCHEMA_REQUIRED'); }
  const context = parseChelfexContext(rawContext);
  if (!context) blockers.push('CHELFEX_VERIFIED_CONTEXT_REQUIRED');
  const snapshotValid = dataRecord(rawProjection);
  const projection = snapshotValid ? rawProjection : {};
  if (!snapshotValid) blockers.push('CHELFEX_SNAPSHOT_SHAPE_REQUIRED');
  if (context && task && (task.orgId !== context.orgId || projection.orgId !== context.orgId)) {
    blockers.push('CHELFEX_TENANT_MISMATCH');
  }
  const local = context?.authority === 'LOCAL_UNVERIFIED_PREVIEW';
  if (local) blockers.push('CHELFEX_SOURCE_AUTHENTICITY_UNVERIFIED');
  const clockMs = !types.isProxy(now) && types.isDate(now) ? Date.prototype.getTime.call(now) : NaN;
  const clockValid = Number.isFinite(clockMs);
  if (!clockValid) blockers.push('CHELFEX_CLOCK_REQUIRED');
  const clock = new Date(clockMs);
  // No foreign provenance or values are read after a scope rejection.
  const scopeValid = context !== null && task !== null && snapshotValid
    && task.orgId === context.orgId && projection.orgId === context.orgId;
  const provenanceValid = scopeValid && typeof projection.sourceHash === 'string'
    && /^[a-f0-9]{64}$/i.test(projection.sourceHash) && projection.sourceHash !== '0'.repeat(64)
    && canonicalTimestamp(projection.asOf);
  if (scopeValid && !provenanceValid) blockers.push('CHELFEX_PROVENANCE_REQUIRED');
  const assessment = scopeValid && clockValid && provenanceValid ? assessNativeData(projection, clock) : null;
  if (assessment?.decision === 'DENY') blockers.push(...assessment.reasonCodes);
  if (assessment?.decision === 'REVIEW') blockers.push('CHELFEX_DATA_REVIEW_REQUIRED');
  const eligible = scopeValid && !local && assessment !== null && assessment.decision !== 'DENY';
  const riskLevel = task ? classifyChelfexRisk(task.operation) : 'R4';
  const requirements = [...CHELFEX_POLICY.requirementsByRisk[riskLevel]];
  const executionBlocked = riskLevel !== 'R0' && riskLevel !== 'R1';
  if (executionBlocked) blockers.push('CHELFEX_EXECUTION_NOT_IMPLEMENTED');
  const evidence = eligible ? [{
    id: 'canonical-snapshot', orgId: context.orgId,
    snapshotId: assessment.snapshotId!, sourceHash: assessment.sourceHash!,
    asOf: projection.asOf as string, schemaVersion: projection.schemaVersion as number,
    policyVersion: projection.policyVersion as string, validation: 'CURRENT_GOVERNED_SNAPSHOT' as const
  }] : [];
  // Restriction is server-owned and can only remove data; it never grants access.
  const findings = eligible ? generateNativeInsight(projection, 'EXECUTIVE', clock, redactFinancial).findings as NativeInsightFinding[] : [];
  // Native rules produce these fields, never narrative documents or the objective.
  const conclusions = findings.slice(0, CHELFEX_POLICY.maxConclusions - 2).map(f => ({
    id: f.code, status: 'INFERENCE' as 'FACT' | 'INFERENCE' | 'PENDING',
    text: f.title, evidenceRefs: ['canonical-snapshot'], evidencePath: f.evidencePath,
    verification: 'RULE_EVALUATED' as string
  }));
  if (eligible && conclusions.length === 0) conclusions.push({
    id: 'NO_EXCEPTION_IN_EVALUATED_RULES', status: 'INFERENCE',
    text: 'Nenhuma exceção detectada pelas regras avaliadas; cobertura integral não comprovada.',
    evidenceRefs: ['canonical-snapshot'], evidencePath: 'projection', verification: 'RULE_EVALUATED'
  });
  if (eligible && assessment.decision === 'REVIEW') conclusions.unshift({
    id: 'GOVERNANCE_REVIEW_REQUIRED', status: 'PENDING',
    text: assessment.reasonCodes.join(', '), evidenceRefs: ['canonical-snapshot'],
    evidencePath: 'projection.dataQuality', verification: 'REVIEW_REQUIRED'
  });
  if (eligible) conclusions.unshift({
    id: 'SNAPSHOT_ACCEPTED_BY_DATA_GATE', status: 'FACT',
    text: 'O snapshot passou pelas verificações de governança nesta avaliação.',
    evidenceRefs: ['canonical-snapshot'], evidencePath: 'projection.nativeDataPlane', verification: 'GATE_EVALUATED'
  });
  if (!eligible) conclusions.push({
    id: 'CONTEXT_OR_EVIDENCE_PENDING', status: 'PENDING',
    text: 'Contexto autenticado e evidência atual são necessários.', evidenceRefs: [],
    evidencePath: 'none', verification: 'NOT_VERIFIED'
  });
  return {
    contract: CHELFEX_POLICY.id, version: CHELFEX_POLICY.version,
    policyHash: CHELFEX_POLICY_HASH, mode: CHELFEX_POLICY.mode,
    tenantScope: context?.orgId ?? null,
    contextVerification: !scopeValid ? 'REJECTED' : local ? 'LOCAL_UNVERIFIED_PREVIEW' : 'AUTHENTICATED_SERVER',
    objectiveHash: task ? createHash('sha256').update(task.objective).digest('hex') : null,
    operation: task?.operation ?? null, riskLevel,
    status: !eligible || executionBlocked ? 'BLOCKED' : 'RECOMMENDATION_ONLY',
    evidence, conclusions,
    decision: !eligible ? 'REVALIDATE_CONTEXT_AND_EVIDENCE'
      : requirements.length ? 'REVIEW_REQUIREMENTS_IN_EXISTING_WORKFLOW' : 'REVIEW_NATIVE_RECOMMENDATION',
    requirements, blockers: [...new Set(blockers)],
    acceptanceCriteria: ['AUTHENTICATED_TENANT_CONTEXT', 'CURRENT_EVIDENCE', 'NO_EXECUTOR_SIDE_EFFECTS'],
    verification: { schema: task ? 'PASSED' : 'FAILED',
      evidence: eligible ? 'PASSED' : 'NOT_VERIFIED', dataDecision: assessment?.decision ?? 'NOT_EVALUATED',
      execution: 'NOT_RUN', authenticatedReadback: 'NOT_PERFORMED', hml: 'NOT_ATTESTED' },
    authorization: 'NOT_GRANTED' as const, executionAllowed: false as const, sourceMutation: false as const,
    rollback: 'NOT_APPLICABLE_NO_MUTATION', lessonRef: null, decisionTracePersisted: false
  };
}

export type ChelfexContract = ReturnType<typeof buildChelfexContract>;
