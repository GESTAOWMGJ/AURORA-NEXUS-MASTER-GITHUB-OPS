/** AURORA-ORG-001: deterministic parity adapter for the existing Python reducer. */
import { createHash } from 'node:crypto';
export const KINDS = ['REWORK','VALIDATED_DECISION','BILLING_EXCEPTION','SECTOR_NEED','TOOL_OUTCOME'] as const;
export const CATEGORIES = ['CONTRACT','FISCAL','FINANCIAL','PRODUCTION','GOVERNANCE','AUDIT'] as const;
export const TEMPLATES: Record<string,string> = {REWORK:'REWORK_CHECKLIST',VALIDATED_DECISION:'DECISION_REGISTER',BILLING_EXCEPTION:'EXCEPTION_REGISTER',SECTOR_NEED:'SECTOR_INVENTORY'};
export type Signal = {schemaVersion:'aurora.organic.signal.v1';id:string;org:string;sector:string;kind:typeof KINDS[number];category:typeof CATEGORIES[number];caseRef:string;evidenceRefs:string[];decisionRef:string;toolId:string|null;outcome:'BENEFIT'|'NO_BENEFIT'|'ADVERSE'|null};
export type Proposal = {id:string;org:string;sector:string;category:string;template:string;operation:string;permissions:string[];activationAllowed:false;humanReviewRequired:true;status:string;distinctCases:number;evidenceRefs:string[];signalRefs:string[];definitionFingerprint:string;revision:number;history:{revision:number;definitionFingerprint:string}[]};
export type Memory = {schemaVersion:'aurora.organic.memory.v1';org:string;mode:string;modelTraining:false;activationAllowed:false;signals:Signal[];deferredSignalRefs:string[];proposals:Proposal[];performance:{toolId:string;distinctCases:number;outcomes:Record<string,number>;recommendation:string}[];limitations:string[]};
export const HASH = /^[a-f0-9]{64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const KEYS = ['schemaVersion','id','org','sector','kind','category','caseRef','evidenceRefs','decisionRef','toolId','outcome'].sort();
export function canonical(value:unknown):string {
  function ordered(v:unknown):unknown {
    if(Array.isArray(v)) return v.map(ordered);
    if(v && typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered((v as Record<string,unknown>)[k])]));
    return v;
  }
  return JSON.stringify(ordered(value)).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
export function digest(value:unknown):string {return createHash('sha256').update(canonical(value)).digest('hex');}
export function fail(code:string):never {throw new Error(code);}
export function signal(raw:unknown,org:string,sectors:ReadonlySet<string>):Signal {
  if(!raw || typeof raw!=='object' || Array.isArray(raw) || Object.keys(raw).sort().join()!==KEYS.join()) fail('CLOSED_SIGNAL_SCHEMA_REQUIRED');
  const e=structuredClone(raw) as Signal;
  if(e.schemaVersion!=='aurora.organic.signal.v1') fail('CLOSED_SIGNAL_SCHEMA_REQUIRED');
  if(e.org!==org) fail('CROSS_TENANT_SIGNAL');
  if(!sectors.has(e.sector)) fail('SECTOR_NOT_AUTHORIZED');
  if(!KINDS.includes(e.kind) || !CATEGORIES.includes(e.category)) fail('SIGNAL_VOCABULARY_REJECTED');
  if([e.id,e.caseRef,e.decisionRef].some(x=>typeof x!=='string'||!HASH.test(x))) fail('OPAQUE_HASH_REFERENCES_REQUIRED');
  if(!Array.isArray(e.evidenceRefs)||e.evidenceRefs.length<1||e.evidenceRefs.length>20||e.evidenceRefs.some(x=>typeof x!=='string'||!HASH.test(x))) fail('BOUNDED_EVIDENCE_REFERENCES_REQUIRED');
  e.evidenceRefs=[...new Set(e.evidenceRefs)].sort();
  if(e.kind==='TOOL_OUTCOME') {
    if(!['BENEFIT','NO_BENEFIT','ADVERSE'].includes(e.outcome??'') || typeof e.toolId!=='string'||!/^[a-f0-9]{32,64}$/.test(e.toolId)) fail('TOOL_OUTCOME_INVALID');
  } else if(e.toolId!==null || e.outcome!==null) fail('OUTCOME_FIELDS_NOT_APPLICABLE');
  return e;
}
function definition(p:Proposal):Record<string,unknown> {
  const {definitionFingerprint,revision,history,...d}=p;return d;
}
export function reconcile(org:string,previous:Memory|null,inputs:Signal[],sectors:ReadonlySet<string>,verify:(s:Signal)=>boolean,knownTools:ReadonlySet<string>=new Set()):Memory {
  if(!REF.test(org)||!sectors.size||[...sectors].some(s=>!REF.test(s))) fail('TENANT_OR_SECTOR_REGISTRY_INVALID');
  if(previous&&(previous.org!==org||previous.schemaVersion!=='aurora.organic.memory.v1')) fail('MEMORY_SCOPE_OR_SCHEMA_INVALID');
  const old=previous?structuredClone(previous):null;
  if(!Array.isArray(inputs)||!Array.isArray(old?.signals??[])||inputs.length>5000||(old?.signals.length??0)>5000) fail('MEMORY_LIMIT_REVIEW_REQUIRED');
  const events=new Map<string,Signal>();
  for(const raw of [...(old?.signals??[]),...inputs]) {
    const e=signal(raw,org,sectors),prior=events.get(e.id);
    if(prior&&canonical(prior)!==canonical(e)) fail('EVENT_ID_CONTENT_CONFLICT');events.set(e.id,e);
  }
  if(events.size>5000) fail('MEMORY_LIMIT_REVIEW_REQUIRED');
  const accepted:Signal[]=[],deferred:string[]=[];
  for(const [,e] of [...events].sort(([a],[b])=>a<b?-1:a>b?1:0)) {
    if(verify(structuredClone(e))===true) accepted.push(e);else deferred.push(e.id);
  }
  const groups=new Map<string,Signal[]>(),outcomes=new Map<string,Map<string,string>>();
  for(const e of accepted) {
    if(e.kind==='TOOL_OUTCOME') {
      const tool=e.toolId!;if(!knownTools.has(tool)) fail('UNKNOWN_OR_UNSCOPED_TOOL');
      const cases=outcomes.get(tool)??new Map<string,string>(),prior=cases.get(e.caseRef);
      if(prior&&prior!==e.outcome) fail('CONFLICTING_OUTCOME_REQUIRES_REVIEW');
      cases.set(e.caseRef,e.outcome!);outcomes.set(tool,cases);
    } else {const k=canonical([e.kind,e.sector,e.category]);groups.set(k,[...(groups.get(k)??[]),e]);}
  }
  const oldDrafts=new Map((old?.proposals??[]).map(p=>[p.id,p]));
  for(const p of oldDrafts.values()) {
    if(p.org!==org||p.activationAllowed!==false) fail('PRIOR_PROPOSAL_SCOPE_INVALID');
    if(digest(definition(p))!==p.definitionFingerprint) fail('PRIOR_DEFINITION_INTEGRITY_MISMATCH');
  }
  const drafts=new Map<string,Proposal>();
  for(const es of groups.values()) {
    const e=es[0]!,cases=new Set(es.map(s=>s.caseRef)),refs=[...new Set(es.flatMap(s=>s.evidenceRefs))].sort();
    if(cases.size<3||refs.length<3) continue;
    const id=digest([org,'organic-proposal-v1',e.kind,e.sector,e.category]),before=oldDrafts.get(id);
    const d={id,org,sector:e.sector,category:e.category,template:TEMPLATES[e.kind]!,operation:'COUNT_VALIDATED_SIGNALS',permissions:['READ_SANITIZED_VALIDATED_SIGNALS'],activationAllowed:false as const,humanReviewRequired:true as const,status:'GENERATED_AWAITING_HUMAN_REVIEW',distinctCases:cases.size,evidenceRefs:refs,signalRefs:es.map(s=>s.id).sort()};
    const fp=digest(d),changed=before?.definitionFingerprint!==fp;
    drafts.set(id,{...d,definitionFingerprint:fp,revision:(before?.revision??0)+Number(changed),history:[...(before?.history??[]),...(before&&changed?[{revision:before.revision,definitionFingerprint:before.definitionFingerprint}]:[])]});
  }
  for(const [id,before] of oldDrafts) if(!drafts.has(id)) {
    const p=structuredClone(before);p.status='EVIDENCE_REVALIDATION_REQUIRED';p.activationAllowed=false;
    const fp=digest(definition(p));
    if(fp!==before.definitionFingerprint){p.revision++;p.history.push({revision:before.revision,definitionFingerprint:before.definitionFingerprint});p.definitionFingerprint=fp;}
    drafts.set(id,p);
  }
  const performance=[...outcomes].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([toolId,cases])=>{
    const counts:Record<string,number>={};for(const x of cases.values()) counts[x]=(counts[x]??0)+1;
    return {toolId,distinctCases:cases.size,outcomes:counts,recommendation:counts.ADVERSE?'REVIEW_OR_ROLLBACK':'HUMAN_EFFECTIVENESS_REVIEW'};
  });
  return {schemaVersion:'aurora.organic.memory.v1',org,mode:'SHADOW_PROPOSALS_ONLY',modelTraining:false,activationAllowed:false,signals:[...events].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,e])=>e),deferredSignalRefs:deferred,proposals:[...drafts].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,p])=>p),performance,limitations:['Not connected to deployed event ingestion.','Verification is a trusted-caller responsibility.','Counts are not causal evidence of benefit.','No financial, clinical or contractual mutation.']};
}
export type Approval={revision:number;fingerprint:string;actorUid:string;status:'PILOT'|'ROLLED_BACK'};
/** Fixed read-only executor. It cannot interpret a document or execute generated code. */
export function executeReadOnly(memory:Memory,proposalId:string,approval:Approval):{cases:number;evidenceReferences:number;signals:number;financialMutation:false} {
  const p=memory.proposals.find(x=>x.id===proposalId);
  if(!p||p.status!=='GENERATED_AWAITING_HUMAN_REVIEW'||approval.status!=='PILOT'||approval.revision!==p.revision||approval.fingerprint!==p.definitionFingerprint) fail('CURRENT_APPROVAL_REQUIRED');
  if(p.operation!=='COUNT_VALIDATED_SIGNALS'||!Object.values(TEMPLATES).includes(p.template)||p.permissions.join()!=='READ_SANITIZED_VALIDATED_SIGNALS') fail('EXECUTOR_NOT_ALLOWED');
  const allowed=new Set(p.signalRefs),deferred=new Set(memory.deferredSignalRefs),es=memory.signals.filter(e=>allowed.has(e.id)&&!deferred.has(e.id));
  if(es.length!==p.signalRefs.length||es.some(e=>e.org!==memory.org||e.sector!==p.sector||e.category!==p.category)||new Set(es.map(e=>e.caseRef)).size<3) fail('CURRENT_EVIDENCE_REQUIRED');
  return {cases:new Set(es.map(e=>e.caseRef)).size,evidenceReferences:new Set(es.flatMap(e=>e.evidenceRefs)).size,signals:es.length,financialMutation:false};
}
