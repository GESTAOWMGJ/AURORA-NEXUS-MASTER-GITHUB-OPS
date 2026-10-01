/** AURORA-ORG-001: bounded tool composition and observational feedback.
 * Pure functions only. No model training, I/O, new datastore or source mutation.
 */
import {digest, HASH, TEMPLATES, type Memory, type Proposal, type Signal} from './auroraOrganicCore.js';

export const LEARNING_VERSION = '1.2.0';
const STEPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  REWORK_CHECKLIST: ['VERIFY_CURRENT_EVIDENCE', 'GROUP_DISTINCT_CASES', 'REVIEW_REWORK_CAUSE', 'REVIEW_CORRECTIVE_ROUTINE', 'RECORD_OBSERVED_OUTCOME'],
  DECISION_REGISTER: ['VERIFY_CURRENT_EVIDENCE', 'GROUP_DISTINCT_CASES', 'REVIEW_VALIDATED_DECISIONS', 'CHECK_APPLICABILITY_BEFORE_REUSE', 'RECORD_OBSERVED_OUTCOME'],
  EXCEPTION_REGISTER: ['VERIFY_CURRENT_EVIDENCE', 'GROUP_DISTINCT_CASES', 'REVIEW_BILLING_EXCEPTION', 'REQUEST_CONTRACT_PRODUCTION_INVOICE_BANK_COMPARISON', 'RECORD_OBSERVED_OUTCOME'],
  SECTOR_INVENTORY: ['VERIFY_CURRENT_EVIDENCE', 'GROUP_DISTINCT_CASES', 'REVIEW_SECTOR_NEED', 'REVIEW_CAPACITY_AND_WORKFLOW', 'RECORD_OBSERVED_OUTCOME']
});
export type ToolPlan = {
  id: string; proposalId: string; proposalRevision: number; version: string;
  fingerprint: string; template: string; sector: string; category: string;
  operation: 'COUNT_VALIDATED_SIGNALS_WITH_REVIEW_REPORT';
  permissions: ['READ_SANITIZED_VALIDATED_SIGNALS'];
  steps: string[]; checks: {code: string; passed: boolean}[];
  readyForReview: boolean; automaticActivation: false;
};
export type ToolReport = {
  planId: string; planFingerprint: string; template: string;
  rows: {caseRef: string; validatedSignals: number; evidenceReferences: number}[];
  checklist: {step: string; status: 'VERIFIED_BY_RUNTIME'|'PENDING_HUMAN_REVIEW'}[];
  interpretation: 'OBSERVATIONAL_NOT_CAUSAL'; sourceMutation: false;
};
type ObservedRun = {id: string; proposalId: string; revision: number; fingerprint: string; outcome: string|null};
type Approved = {status: string; revision: number; fingerprint: string; planFingerprint?: string};
type LearningInput = {orgId: string; version: number; memory: Memory|null; runs: ObservedRun[]; approvals: Record<string, Approved>};

function selected(memory: Memory, p: Proposal): Signal[] {
  const refs = new Set(p.signalRefs), blocked = new Set(memory.deferredSignalRefs);
  return memory.signals.filter(e => refs.has(e.id) && !blocked.has(e.id));
}
export function compileToolPlan(memory: Memory, p: Proposal): ToolPlan {
  const es = selected(memory, p);
  const {definitionFingerprint, revision: _revision, history: _history, ...definition} = p;
  const steps = [...(STEPS[p.template] ?? [])];
  const cases = new Set(es.map(e => e.caseRef)), refs = new Set(es.flatMap(e => e.evidenceRefs));
  const checks = [
    {code:'DEFINITION_INTEGRITY',passed:digest(definition) === definitionFingerprint},
    {code:'CURRENT_VALIDATED_EVIDENCE',passed:p.status === 'GENERATED_AWAITING_HUMAN_REVIEW' && es.length === p.signalRefs.length && new Set(p.signalRefs).size === p.signalRefs.length},
    {code:'THRESHOLD_AND_COVERAGE',passed:cases.size >= 3 && refs.size >= 3 && cases.size === p.distinctCases && [...refs].sort().join() === [...p.evidenceRefs].sort().join()},
    {code:'TENANT_SECTOR_CATEGORY',passed:p.org === memory.org && es.every(e => e.org === memory.org && e.sector === p.sector && e.category === p.category)},
    {code:'TEMPLATE_SIGNAL_MATCH',passed:steps.length > 0 && es.every(e => e.kind !== 'TOOL_OUTCOME' && TEMPLATES[e.kind] === p.template && HASH.test(e.decisionRef))},
    {code:'BOUNDED_READ_ONLY',passed:p.operation === 'COUNT_VALIDATED_SIGNALS' && p.permissions.join() === 'READ_SANITIZED_VALIDATED_SIGNALS' && p.activationAllowed === false && p.humanReviewRequired === true}
  ];
  const planDefinition = {
    proposalId:p.id, proposalRevision:p.revision, definitionFingerprint:p.definitionFingerprint,
    version:LEARNING_VERSION, template:p.template, sector:p.sector, category:p.category,
    operation:'COUNT_VALIDATED_SIGNALS_WITH_REVIEW_REPORT' as const,
    permissions:['READ_SANITIZED_VALIDATED_SIGNALS'] as ['READ_SANITIZED_VALIDATED_SIGNALS'], steps
  };
  const fingerprint = digest(planDefinition);
  return {id:digest([memory.org,'organic-plan',p.id,fingerprint]),proposalId:p.id,proposalRevision:p.revision,version:LEARNING_VERSION,fingerprint,template:p.template,sector:p.sector,category:p.category,operation:planDefinition.operation,permissions:planDefinition.permissions,steps,checks,readyForReview:checks.every(c => c.passed),automaticActivation:false};
}

/** Called ONLY after the service has revalidated proofs, MFA and current approval. */
export function buildToolReport(memory: Memory, p: Proposal, plan: ToolPlan): ToolReport {
  const current = compileToolPlan(memory,p);
  if(!current.readyForReview || current.fingerprint !== plan.fingerprint || current.id !== plan.id) throw new Error('CURRENT_EVIDENCE_REQUIRED');
  const grouped = new Map<string,Signal[]>();
  for(const e of selected(memory,p)) grouped.set(e.caseRef,[...(grouped.get(e.caseRef)??[]),e]);
  return {
    planId:current.id,planFingerprint:current.fingerprint,template:p.template,
    rows:[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([caseRef,es])=>({caseRef,validatedSignals:es.length,evidenceReferences:new Set(es.flatMap(e=>e.evidenceRefs)).size})),
    checklist:current.steps.map(step=>({step,status:['VERIFY_CURRENT_EVIDENCE','GROUP_DISTINCT_CASES'].includes(step)?'VERIFIED_BY_RUNTIME':'PENDING_HUMAN_REVIEW'})),
    interpretation:'OBSERVATIONAL_NOT_CAUSAL',sourceMutation:false
  };
}

/** Derived from the existing checkpoint; no parallel memory or automatic activation. */
export function learningCycle(s: LearningInput) {
  const memory=s.memory, blocked=new Set(memory?.deferredSignalRefs??[]);
  const verified=(memory?.signals??[]).filter(e=>!blocked.has(e.id));
  const groups=new Map<string,Signal[]>();
  for(const e of verified.filter(e=>e.kind!=='TOOL_OUTCOME')) {
    const k=digest([s.orgId,e.kind,e.sector,e.category]);groups.set(k,[...(groups.get(k)??[]),e]);
  }
  const needs=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([id,es])=>({
    id,kind:es[0]!.kind,sector:es[0]!.sector,category:es[0]!.category,
    distinctCases:new Set(es.map(e=>e.caseRef)).size,evidenceReferences:new Set(es.flatMap(e=>e.evidenceRefs)).size,
    minimumCases:3,minimumReferences:3
  }));
  const tools=(memory?.proposals??[]).map(p=>{
    const plan=compileToolPlan(memory!,p), approval=s.approvals[p.id];
    const relevantRuns=s.runs.filter(r=>r.proposalId===p.id);
    // Results from superseded fingerprints remain history, never evidence of current effectiveness.
    const current=new Map<string,string>();
    for(const e of verified.filter(e=>e.kind==='TOOL_OUTCOME'&&e.toolId===p.id)) {
      const run=relevantRuns.find(r=>r.revision===p.revision&&r.fingerprint===p.definitionFingerprint&&r.outcome===e.outcome&&e.evidenceRefs.includes(digest([s.orgId,'run',r.id])));
      if(run) current.set(e.caseRef,e.outcome!);
    }
    const outcomes:Record<string,number>={BENEFIT:0,NO_BENEFIT:0,ADVERSE:0};
    for(const outcome of current.values()) outcomes[outcome]=(outcomes[outcome]??0)+1;
    // Preserve adverse history conservatively, even if its supporting source is later revoked.
    const adverseHistory=relevantRuns.some(r=>r.outcome==='ADVERSE');
    const pilot=approval?.status==='PILOT'&&approval.revision===p.revision&&approval.fingerprint===p.definitionFingerprint&&approval.planFingerprint===plan.fingerprint;
    const nextAction=adverseHistory?'SUSPEND_AND_REVIEW':!plan.readyForReview?'REVALIDATE_EVIDENCE':(outcomes.NO_BENEFIT??0)>0?'REFINE_FOR_REVIEW':!pilot?'REVIEW_CANDIDATE':(outcomes.BENEFIT??0)>0?'CONTINUE_OBSERVATION':'MEASURE_PILOT';
    return {
      ...plan,currentObservations:current.size,currentOutcomes:outcomes,
      historicalRuns:relevantRuns.filter(r=>r.fingerprint!==p.definitionFingerprint||r.revision!==p.revision).length,
      adverseHistory,nextAction,
      maintenanceId:digest([s.orgId,'organic-maintenance',plan.id,nextAction]),
      causalBenefitEstablished:false,measuredFinancialGain:null
    };
  });
  return {schemaVersion:'aurora.organic.learning.v1',version:LEARNING_VERSION,stateVersion:s.version,org:s.orgId,mode:'GOVERNED_READ_ONLY',needs,tools,modelTraining:false,automaticActivation:false};
}
