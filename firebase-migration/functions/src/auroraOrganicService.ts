import {CATEGORIES,KINDS,digest,fail,reconcile,executeReadOnly,type Approval,type Memory,type Signal} from './auroraOrganicCore.js';
import {compileToolPlan,buildToolReport,learningCycle,type ToolReport} from './auroraOrganicLearning.js';
import {validateResolutionEvidence,validEvidenceRef,type FirestoreDocumentReader} from './auroraEvidence.js';
export const STATE_ID='aurora-organic-v1';
export const MAX_SIGNALS=64, MAX_RUNS=64;
const WRITERS=['platform_admin','org_admin','director','auditor'];
export type Actor={uid:string;orgId:string;role:string;permissions:string[];allFacilities:boolean;mfaVerified:boolean};
export type Proof={signalHash:string;actorUid:string;actionId:string|null;snapshotHash:string|null;runId:string|null};
export type Run={id:string;proposalId:string;revision:number;fingerprint:string;actorUid:string;result:ReturnType<typeof executeReadOnly>&{report?:ToolReport};outcome:string|null};
export type State={schemaVersion:1;orgId:string;version:number;memory:Memory|null;proofs:Record<string,Proof>;approvals:Record<string,Approval&{planFingerprint?:string}>;runs:Run[]};
export type Command={type:'OBSERVE'|'REVALIDATE'|'APPROVE_PILOT'|'EXECUTE'|'ROLLBACK'|'OUTCOME';expectedVersion:number;kind?:Signal['kind'];category?:Signal['category'];sector?:string;actionId?:string;proposalId?:string;proposalRevision?:number;runId?:string;outcome?:Signal['outcome']};
const BODY_KEYS:Record<Command['type'],string[]>={OBSERVE:['type','expectedVersion','kind','category','sector','actionId'],REVALIDATE:['type','expectedVersion'],APPROVE_PILOT:['type','expectedVersion','proposalId','proposalRevision'],EXECUTE:['type','expectedVersion','proposalId','proposalRevision'],ROLLBACK:['type','expectedVersion','proposalId','proposalRevision'],OUTCOME:['type','expectedVersion','runId','outcome']};
export function parseCommand(raw:unknown):Command {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) fail('INVALID_COMMAND');
  const c=raw as Command,keys=Object.hasOwn(BODY_KEYS,c.type)?BODY_KEYS[c.type]:null;
  if(!keys||Object.keys(c).sort().join()!==[...keys].sort().join()||!Number.isSafeInteger(c.expectedVersion)||c.expectedVersion<0) fail('INVALID_COMMAND');
  if(c.type==='OBSERVE'&&(!KINDS.includes(c.kind!)||c.kind==='TOOL_OUTCOME'||!CATEGORIES.includes(c.category!)||typeof c.sector!=='string'||!/^[A-Z][A-Z0-9_]{1,31}$/.test(c.sector)||!validEvidenceRef(c.actionId))) fail('INVALID_COMMAND');
  if(['APPROVE_PILOT','EXECUTE','ROLLBACK'].includes(c.type)&&(!/^[a-f0-9]{64}$/.test(c.proposalId??'')||!Number.isSafeInteger(c.proposalRevision)||c.proposalRevision!<1)) fail('INVALID_COMMAND');
  if(c.type==='OUTCOME'&&(!/^[a-f0-9]{64}$/.test(c.runId??'')||!['BENEFIT','NO_BENEFIT','ADVERSE'].includes(c.outcome??''))) fail('INVALID_COMMAND');
  return structuredClone(c);
}
export function allowedActor(a:Actor,review=false):boolean {
  return a.allFacilities && (WRITERS.includes(a.role)||a.permissions.includes(review?'organic.review':'organic.write')) && (!review||a.mfaVerified);
}
function activeWriter(data:Record<string,unknown>|null):boolean {
  return data?.active===true&&data.allFacilities===true&&(WRITERS.includes(String(data.role))||(Array.isArray(data.permissions)&&data.permissions.includes('organic.write')));
}
async function actionSnapshot(org:string,id:string,read:FirestoreDocumentReader):Promise<{hash:string;caseRef:string;evidenceRefs:string[]}|null> {
  if(!validEvidenceRef(id)) return null;
  const a=await read(`organizations/${org}/actionItems/${id}`);
  if(!a||a.orgId!==org||a.status!=='RESOLVED'||!Number.isSafeInteger(a.revision)||typeof a.updatedBy!=='string'||!validEvidenceRef(a.updatedBy)) return null;
  if(!activeWriter(await read(`organizations/${org}/members/${a.updatedBy}`))) return null;
  const refs=a.evidenceRefs;
  if(!Array.isArray(refs)||!refs.length||refs.length>5||refs.some(x=>!validEvidenceRef(x))) return null;
  const records:Record<string,unknown>={action:a};
  const wrapped:FirestoreDocumentReader=async path=>{const value=await read(path);if(value) records[path]=value;return value;};
  const v=await validateResolutionEvidence({orgId:org,actionId:id,action:a,evidenceRefs:refs as string[]},wrapped);
  if(!v.ok) return null;
  for(const ref of v.evidenceRefs) {
    const d=records[`organizations/${org}/sourceDocuments/${ref}`] as Record<string,unknown>;
    if(!d||!['VALIDATED','CLOSED'].includes(String(d.workflowState))||d.revoked===true||d.deleted===true||d.active===false) return null;
    const legacyReviewed=d.reviewState==='APPROVED'&&['PUBLIC','INTERNAL'].includes(String(d.sensitivity));
    const firebaseNativeSanitized=d.sensitivity==='RESTRICTED'
      &&d.sanitized===true
      &&d.nativeReady===true
      &&d.sourceIndependent===true
      &&d.externalFetchRequired!==true
      &&d.canonicalSnapshotVersion===1
      &&typeof d.canonicalSnapshotHash==='string'
      &&/^[a-f0-9]{64}$/.test(d.canonicalSnapshotHash);
    if(!legacyReviewed&&!firebaseNativeSanitized) return null;
    // An expiry is not inferred from filename or modification time.
    if(d.expiresAt!==undefined) {
      const raw=d.expiresAt as {toMillis?:()=>number};
      const expiry=typeof raw?.toMillis==='function'?raw.toMillis():typeof d.expiresAt==='string'?Date.parse(d.expiresAt):NaN;
      if(!Number.isFinite(expiry)||expiry<=Date.now()) return null;
    }
  }
  return {hash:digest(records),caseRef:digest([org,a.targetType,a.targetId]),evidenceRefs:v.evidenceRefs.map(ref=>digest([org,'sourceDocuments',ref])).sort()};
}
function config(org:Record<string,unknown>):Set<string> {
  if(!Array.isArray(org.organicSectors)||!org.organicSectors.length||org.organicSectors.length>16||org.organicSectors.some(x=>typeof x!=='string'||!/^[A-Z][A-Z0-9_]{1,31}$/.test(x))) fail('ORGANIC_SECTORS_NOT_CONFIGURED');
  return new Set(org.organicSectors as string[]);
}
export function emptyState(orgId:string):State {return {schemaVersion:1,orgId,version:0,memory:null,proofs:{},approvals:{},runs:[]};}
export async function transition(original:State|null,c:Command|null,a:Actor,org:Record<string,unknown>,read:FirestoreDocumentReader,operationId:string):Promise<{state:State;result:Record<string,unknown>}> {
  if(!allowedActor(a)) fail('PERMISSION_DENIED');
  if(org.active!==true) fail('ORGANIZATION_DISABLED');
  const sectors=config(org),s=original?structuredClone(original):emptyState(a.orgId);
  if(s.schemaVersion!==1||s.orgId!==a.orgId||!Number.isSafeInteger(s.version)||!Array.isArray(s.runs)||s.runs.length>MAX_RUNS||(s.memory?.signals.length??0)>MAX_SIGNALS) fail('MEMORY_SCOPE_OR_SCHEMA_INVALID');
  if(c&&c.expectedVersion!==s.version) fail('REVISION_CONFLICT');
  if(c&&c.type!=='ROLLBACK'&&org.organicEnabled!==true) fail('ORGANIC_DISABLED');
  if(c&&['APPROVE_PILOT','EXECUTE','ROLLBACK'].includes(c.type)&&!allowedActor(a,true)) fail('MFA_AND_REVIEW_PERMISSION_REQUIRED');
  const inputs:Signal[]=[];
  if(c?.type==='OBSERVE') {
    if(!sectors.has(c.sector!)) fail('SECTOR_NOT_AUTHORIZED');
    const snap=await actionSnapshot(a.orgId,c.actionId!,read);if(!snap) fail('VERIFIED_RESOLVED_ACTION_REQUIRED');
    const event:Signal={schemaVersion:'aurora.organic.signal.v1',id:digest([a.orgId,c.kind,c.category,c.sector,c.actionId,snap.hash,a.uid]),org:a.orgId,sector:c.sector!,kind:c.kind!,category:c.category!,caseRef:snap.caseRef,evidenceRefs:snap.evidenceRefs,decisionRef:snap.hash,toolId:null,outcome:null};
    inputs.push(event);s.proofs[event.id]={signalHash:digest(event),actorUid:a.uid,actionId:c.actionId!,snapshotHash:snap.hash,runId:null};
  }
  if(c?.type==='OUTCOME') {
    const run=s.runs.find(r=>r.id===c.runId);if(!run) fail('RUN_NOT_FOUND');
    if(run.outcome&&run.outcome!==c.outcome) fail('OUTCOME_CONFLICT');
    const p=s.memory?.proposals.find(p=>p.id===run.proposalId);if(!p) fail('PROPOSAL_NOT_FOUND');
    // Multiple executions over the same source cases are ONE effectiveness observation.
    const event:Signal={schemaVersion:'aurora.organic.signal.v1',id:digest([a.orgId,'outcome',run.id,c.outcome]),org:a.orgId,sector:p.sector,kind:'TOOL_OUTCOME',category:p.category as Signal['category'],caseRef:digest([a.orgId,p.id,run.fingerprint]),evidenceRefs:[digest([a.orgId,'run',run.id])],decisionRef:digest([run.id,c.outcome,a.uid]),toolId:p.id,outcome:c.outcome!};
    inputs.push(event);s.proofs[event.id]={signalHash:digest(event),actorUid:a.uid,actionId:null,snapshotHash:null,runId:run.id};run.outcome=c.outcome!;
  }
  const all=[...(s.memory?.signals??[]),...inputs],verified=new Set<string>();
  for(const e of all.filter(e=>e.kind!=='TOOL_OUTCOME')) {
    const proof=s.proofs[e.id];
    if(!proof||proof.signalHash!==digest(e)||!sectors.has(e.sector)||!validEvidenceRef(proof.actorUid)||!activeWriter(await read(`organizations/${a.orgId}/members/${proof.actorUid}`))) continue;
    const snap=await actionSnapshot(a.orgId,proof.actionId!,read);
    if(snap&&snap.hash===proof.snapshotHash&&snap.hash===e.decisionRef&&snap.caseRef===e.caseRef&&snap.evidenceRefs.join()===e.evidenceRefs.join()) verified.add(e.id);
  }
  const historySectors=new Set([...sectors,...all.map(e=>e.sector)]);
  const knownTools=new Set(s.memory?.proposals.map(p=>p.id)??[]);
  const candidate=reconcile(a.orgId,s.memory,inputs,historySectors,e=>verified.has(e.id),knownTools);
  for(const e of all.filter(e=>e.kind==='TOOL_OUTCOME')) {
    const proof=s.proofs[e.id],run=s.runs.find(r=>r.id===proof?.runId);
    const p=candidate.proposals.find(p=>p.id===e.toolId);
    if(!proof||proof.signalHash!==digest(e)||!run||!p||!sectors.has(e.sector)||!validEvidenceRef(proof.actorUid)||!validEvidenceRef(run.actorUid)) continue;
    if(!activeWriter(await read(`organizations/${a.orgId}/members/${proof.actorUid}`))||!activeWriter(await read(`organizations/${a.orgId}/members/${run.actorUid}`))) continue;
    if(p.status==='GENERATED_AWAITING_HUMAN_REVIEW'&&run.revision===p.revision&&run.fingerprint===p.definitionFingerprint&&run.outcome===e.outcome&&run.proposalId===e.toolId&&e.evidenceRefs.join()===digest([a.orgId,'run',run.id])) verified.add(e.id);
  }
  // Reconcile against the original memory, not the intermediate candidate: revisions advance once.
  s.memory=reconcile(a.orgId,s.memory,inputs,historySectors,e=>verified.has(e.id),knownTools);
  if(s.memory.signals.length>MAX_SIGNALS) fail('MEMORY_LIMIT_REVIEW_REQUIRED');
  for(const [id,approval] of Object.entries(s.approvals)) {
    const p=s.memory.proposals.find(p=>p.id===id);
    if(!p||p.status!=='GENERATED_AWAITING_HUMAN_REVIEW'||p.revision!==approval.revision||p.definitionFingerprint!==approval.fingerprint||approval.planFingerprint!==compileToolPlan(s.memory,p).fingerprint||!validEvidenceRef(approval.actorUid)||!activeWriter(await read(`organizations/${a.orgId}/members/${approval.actorUid}`))) approval.status='ROLLED_BACK';
  }
  for(const performance of s.memory.performance) if(performance.recommendation==='REVIEW_OR_ROLLBACK'&&s.approvals[performance.toolId]) s.approvals[performance.toolId]!.status='ROLLED_BACK';
  // Adverse history must not disappear when old evidence loses eligibility.
  for(const run of s.runs) if(run.outcome==='ADVERSE'&&s.approvals[run.proposalId]) s.approvals[run.proposalId]!.status='ROLLED_BACK';
  let result:Record<string,unknown>={kind:c?.type??'READ',readOnly:true};
  if(c&&['APPROVE_PILOT','EXECUTE','ROLLBACK'].includes(c.type)) {
    const p=s.memory.proposals.find(p=>p.id===c.proposalId);if(!p) fail('PROPOSAL_NOT_FOUND');
    if(p.revision!==c.proposalRevision) fail('PROPOSAL_REVISION_CONFLICT');
    if(c.type==='ROLLBACK') s.approvals[p.id]={revision:p.revision,fingerprint:p.definitionFingerprint,actorUid:a.uid,status:'ROLLED_BACK'};
    else if(c.type==='APPROVE_PILOT') {
      const plan=compileToolPlan(s.memory,p);
      if(!plan.readyForReview||s.runs.some(r=>r.proposalId===p.id&&r.outcome==='ADVERSE')) fail('CURRENT_EVIDENCE_REQUIRED');
      s.approvals[p.id]={revision:p.revision,fingerprint:p.definitionFingerprint,planFingerprint:plan.fingerprint,actorUid:a.uid,status:'PILOT'};
    } else {
      const approval=s.approvals[p.id];if(!approval) fail('CURRENT_APPROVAL_REQUIRED');
      const plan=compileToolPlan(s.memory,p);
      if(approval.planFingerprint!==plan.fingerprint) fail('CURRENT_APPROVAL_REQUIRED');
      const output={...executeReadOnly(s.memory,p.id,approval),report:buildToolReport(s.memory,p,plan)};
      if(s.runs.length>=MAX_RUNS) fail('RUN_LIMIT_REVIEW_REQUIRED');
      const run={id:digest([a.orgId,'organic-run',operationId]),proposalId:p.id,revision:p.revision,fingerprint:p.definitionFingerprint,actorUid:a.uid,result:output,outcome:null};
      s.runs.push(run);result={...result,runId:run.id,...output};
    }
  }
  if(c) s.version++;
  if(Buffer.byteLength(JSON.stringify(s))>180000) fail('MEMORY_LIMIT_REVIEW_REQUIRED');
  return {state:s,result};
}
export function publicState(s:State):Record<string,unknown> {
  return {learning:learningCycle(s),version:s.version,signalCount:s.memory?.signals.length??0,deferredCount:s.memory?.deferredSignalRefs.length??0,proposals:(s.memory?.proposals??[]).map(p=>({id:p.id,template:p.template,sector:p.sector,category:p.category,revision:p.revision,status:p.status,cases:p.distinctCases,evidenceReferences:p.evidenceRefs.length,approval:s.approvals[p.id]?.status??'AWAITING_REVIEW'})),runs:s.runs.map(r=>({id:r.id,proposalId:r.proposalId,revision:r.revision,result:r.result,outcome:r.outcome})),performance:s.memory?.performance??[]};
}
