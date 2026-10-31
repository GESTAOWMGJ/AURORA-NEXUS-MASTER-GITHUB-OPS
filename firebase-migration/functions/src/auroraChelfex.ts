import { createHash } from 'node:crypto';
import { assessNativeData } from './auroraDataGovernance.js';
import { generateNativeInsight, type NativeInsightFinding } from './auroraNativeIntelligence.js';

/** Code is the executable policy; the JSON mirror is checked by regression tests. */
export const CHELFEX_POLICY = Object.freeze({
  id: 'AURORA-CHELFEX-001', version: '1.0.0', schema: 'aurora.chelfex.task.v1',
  mode: 'RECOMMEND_ONLY', maxConclusions: 12, maxObjectiveBytes: 1024,
  executionAllowed: false, sourceMutation: false, automaticLearning: false,
  riskByOperation: Object.freeze({ READ: 'R0', PROPOSE: 'R1', REVERSIBLE_CHANGE: 'R2',
    OPERATIONAL_CHANGE: 'R3', FINANCIAL_COMMITMENT: 'R4', CLINICAL_CHANGE: 'R4',
    IRREVERSIBLE_CHANGE: 'R4' })
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
function closed(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
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
  return structuredClone(value) as ChelfexTask;
}
export function classifyChelfexRisk(operation: unknown) {
  if (typeof operation !== 'string' || !Object.hasOwn(CHELFEX_POLICY.riskByOperation, operation)) {
    throw new Error('CHELFEX_OPERATION_NOT_SUPPORTED');
  }
  return CHELFEX_POLICY.riskByOperation[operation as ChelfexOperation];
}
function contextValid(value: unknown): value is ChelfexContext {
  return closed(value, ['orgId', 'authority']) && typeof value.orgId === 'string' && ID.test(value.orgId)
    && ['AUTHENTICATED_SERVER', 'LOCAL_UNVERIFIED_PREVIEW'].includes(String(value.authority));
}

/**
 * Pure, synchronous assessment. Context is supplied by the authenticated caller,
 * never deserialized from HTTP/model input. Local imports remain unverified even
 * with valid snapshot fields. This return value is not an authorization token.
 * Objective text is only hashed: it never selects an operation or becomes code.
 */
export function buildChelfexContract(raw: unknown, context: unknown,
  projection: Record<string, unknown>, now = new Date()) {
  let task: ChelfexTask | null = null;
  const blockers: string[] = [];
  try { task = parseChelfexTask(raw); } catch { blockers.push('CHELFEX_CLOSED_SCHEMA_REQUIRED'); }
  const validContext = contextValid(context);
  if (!validContext) blockers.push('CHELFEX_VERIFIED_CONTEXT_REQUIRED');
  if (validContext && task && (task.orgId !== context.orgId || projection.orgId !== context.orgId)) {
    blockers.push('CHELFEX_TENANT_MISMATCH');
  }
  const local = validContext && context.authority === 'LOCAL_UNVERIFIED_PREVIEW';
  if (local) blockers.push('CHELFEX_SOURCE_AUTHENTICITY_UNVERIFIED');
  // Do not inspect another tenant's values or expose its evidence identifiers.
  const scopeValid = validContext && task !== null && task.orgId === context.orgId && projection.orgId === context.orgId;
  const assessment = scopeValid ? assessNativeData(projection, now) : null;
  if (assessment?.decision === 'DENY') blockers.push(...assessment.reasonCodes);
  const eligible = scopeValid && !local && assessment !== null && assessment.decision !== 'DENY';
  const riskLevel = task ? classifyChelfexRisk(task.operation) : 'R4';
  const requirements = riskLevel === 'R0' || riskLevel === 'R1' ? []
    : riskLevel === 'R2' ? ['SERVER_AUTHORIZATION', 'EXISTING_ALLOWLISTED_ENDPOINT', 'TESTS', 'ROLLBACK', 'READBACK']
      : riskLevel === 'R3' ? ['SERVER_AUTHORIZATION', 'APPLICABLE_MFA', 'INDEPENDENT_REVIEW', 'ENVIRONMENT_GATE', 'ROLLBACK', 'READBACK']
        : ['HUMAN_INTERVENTION', 'SEPARATE_RISK_ACCEPTANCE', 'RECOVERY_EVIDENCE'];
  if (['R2', 'R3', 'R4'].includes(riskLevel)) blockers.push('CHELFEX_EXECUTION_NOT_IMPLEMENTED');
  const evidence = eligible ? [{
    id: 'canonical-snapshot', orgId: context.orgId,
    snapshotId: assessment.snapshotId!, sourceHash: assessment.sourceHash!,
    asOf: projection.asOf as string, schemaVersion: projection.schemaVersion as number,
    policyVersion: projection.policyVersion as string, validation: 'CURRENT_GOVERNED_SNAPSHOT' as const
  }] : [];
  const findings = eligible ? generateNativeInsight(projection, 'EXECUTIVE', now).findings as NativeInsightFinding[] : [];
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
    tenantScope: validContext ? context.orgId : null,
    contextVerification: !scopeValid ? 'REJECTED' : local ? 'LOCAL_UNVERIFIED_PREVIEW' : 'AUTHENTICATED_SERVER',
    objectiveHash: task ? createHash('sha256').update(task.objective).digest('hex') : null,
    operation: task?.operation ?? null, riskLevel,
    status: !eligible || ['R2', 'R3', 'R4'].includes(riskLevel) ? 'BLOCKED' : 'RECOMMENDATION_ONLY',
    evidence, conclusions,
    decision: !eligible ? 'REVALIDATE_CONTEXT_AND_EVIDENCE'
      : requirements.length ? 'REVIEW_REQUIREMENTS_IN_EXISTING_WORKFLOW' : 'REVIEW_NATIVE_RECOMMENDATION',
    requirements, blockers: [...new Set(blockers)],
    acceptanceCriteria: ['AUTHENTICATED_TENANT_CONTEXT', 'CURRENT_EVIDENCE', 'NO_EXECUTOR_SIDE_EFFECTS'],
    verification: { schema: task ? 'PASSED' : 'FAILED',
      evidence: eligible ? 'PASSED' : 'NOT_VERIFIED', dataDecision: assessment?.decision ?? 'NOT_EVALUATED',
      execution: 'NOT_RUN', authenticatedReadback: 'NOT_PERFORMED', hml: 'NOT_ATTESTED' },
    authorization: 'NOT_GRANTED', executionAllowed: false, sourceMutation: false,
    rollback: 'NOT_APPLICABLE_NO_MUTATION', lessonRef: null, decisionTracePersisted: false
  };
}
