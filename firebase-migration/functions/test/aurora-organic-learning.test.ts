import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,reconcile,type Signal} from '../src/auroraOrganicCore.js';
import {compileToolPlan,buildToolReport,learningCycle} from '../src/auroraOrganicLearning.js';
import {transition,publicState,type State,type Actor,type Command} from '../src/auroraOrganicService.js';
const actor:Actor={uid:'reviewer-1',orgId:'wmgj',role:'auditor',permissions:[],allFacilities:true,mfaVerified:true};
function fixture(){
 const records:Record<string,Record<string,unknown>>={'organizations/wmgj/members/reviewer-1':{active:true,allFacilities:true,role:'auditor'}};
 for(let i=1;i<=4;i++){
  records[`organizations/wmgj/actionItems/action-${i}`]={orgId:'wmgj',status:'RESOLVED',revision:2,updatedBy:'reviewer-1',targetType:'invoice',targetId:`invoice-${i}`,evidenceRefs:[`doc-${i}`]};
  records[`organizations/wmgj/invoices/invoice-${i}`]={orgId:'wmgj',evidenceRefs:[`doc-${i}`]};
  records[`organizations/wmgj/sourceDocuments/doc-${i}`]={orgId:'wmgj',reviewState:'APPROVED',workflowState:'VALIDATED',sensitivity:'INTERNAL',sourceVersion:1};
 }
 return {records,read:async(path:string)=>records[path]??null,org:{active:true,organicEnabled:true,organicSectors:['AUDIT']}};
}
async function prepare(kind:Signal['kind']='REWORK'){
 const f=fixture();let state:State|null=null;
 for(let i=1;i<=3;i++)state=(await transition(state,{type:'OBSERVE',expectedVersion:i-1,kind,category:'AUDIT',sector:'AUDIT',actionId:`action-${i}`},actor,f.org,f.read,`op-${i}`)).state;
 return {...f,state:state!};
}
const proposalCommand=(s:State,type:Command['type']):Command=>({type,expectedVersion:s.version,proposalId:s.memory!.proposals[0]!.id,proposalRevision:s.memory!.proposals[0]!.revision});
async function run(outcome?:'BENEFIT'|'NO_BENEFIT'|'ADVERSE'){
 const f=await prepare();f.state=(await transition(f.state,proposalCommand(f.state,'APPROVE_PILOT'),actor,f.org,f.read,'approve')).state;
 f.state=(await transition(f.state,proposalCommand(f.state,'EXECUTE'),actor,f.org,f.read,'execute')).state;
 if(outcome)f.state=(await transition(f.state,{type:'OUTCOME',expectedVersion:f.state.version,runId:f.state.runs[0]!.id,outcome},actor,f.org,f.read,'outcome')).state;
 return f;
}
for(const [kind,template] of [['REWORK','REWORK_CHECKLIST'],['VALIDATED_DECISION','DECISION_REGISTER'],['BILLING_EXCEPTION','EXCEPTION_REGISTER'],['SECTOR_NEED','SECTOR_INVENTORY']] as const){
 test('compose tested plan for '+kind,async()=>{const f=await prepare(kind),p=f.state.memory!.proposals[0]!,plan=compileToolPlan(f.state.memory!,p);assert.equal(plan.template,template);assert.equal(plan.readyForReview,true);assert.equal(plan.automaticActivation,false);assert.equal(plan.checks.length,6);assert.deepEqual(plan.permissions,['READ_SANITIZED_VALIDATED_SIGNALS']);});
}
test('plan and maintenance identifiers stable on repeated reads',async()=>{const f=await prepare();assert.deepEqual(learningCycle(f.state),learningCycle(structuredClone(f.state)));});
test('execute produces report without inventing completed human checks',async()=>{const f=await run(),r=f.state.runs[0]!.result.report!;assert.equal(r.rows.length,3);assert.equal(r.checklist.filter(c=>c.status==='VERIFIED_BY_RUNTIME').length,2);assert.equal(r.checklist.filter(c=>c.status==='PENDING_HUMAN_REVIEW').length,3);assert.equal(r.sourceMutation,false);});
test('no benefit generates refinement proposal without activation',async()=>{const f=await run('NO_BENEFIT'),t=learningCycle(f.state).tools[0]!;assert.equal(t.nextAction,'REFINE_FOR_REVIEW');assert.equal(t.currentOutcomes.NO_BENEFIT,1);assert.equal(t.automaticActivation,false);});
test('benefit means continue observation, never established financial gain',async()=>{const f=await run('BENEFIT'),t=learningCycle(f.state).tools[0]!;assert.equal(t.nextAction,'CONTINUE_OBSERVATION');assert.equal(t.causalBenefitEstablished,false);assert.equal(t.measuredFinancialGain,null);});
test('old outcome is not reused for changed evidence',async()=>{const f=await run('BENEFIT');f.records['organizations/wmgj/sourceDocuments/doc-1']!.sourceVersion=2;const n=await transition(f.state,null,actor,f.org,f.read,'read');const t=learningCycle(n.state).tools[0]!;assert.equal(t.currentObservations,0);assert.equal(t.currentOutcomes.BENEFIT,0);assert.equal(t.historicalRuns,1);assert.equal(t.nextAction,'REVALIDATE_EVIDENCE');assert.equal(n.state.runs[0]!.outcome,'BENEFIT');});
test('new case creates one revision and does not inherit efficacy',async()=>{const f=await run('BENEFIT'),revision=f.state.memory!.proposals[0]!.revision;const n=await transition(f.state,{type:'OBSERVE',expectedVersion:f.state.version,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:'action-4'},actor,f.org,f.read,'new-case');assert.equal(n.state.memory!.proposals[0]!.revision,revision+1);assert.equal(learningCycle(n.state).tools[0]!.currentObservations,0);});
test('adverse history cannot disappear with source revocation',async()=>{const f=await run('ADVERSE');f.records['organizations/wmgj/sourceDocuments/doc-1']!.revoked=true;const n=await transition(f.state,null,actor,f.org,f.read,'read');assert.equal(learningCycle(n.state).tools[0]!.nextAction,'SUSPEND_AND_REVIEW');assert.equal(Object.values(n.state.approvals)[0]!.status,'ROLLED_BACK');});
test('old approval lacking the new plan fingerprint is invalidated',async()=>{const f=await run();delete Object.values(f.state.approvals)[0]!.planFingerprint;await assert.rejects(transition(f.state,proposalCommand(f.state,'EXECUTE'),actor,f.org,f.read,'try'),/CURRENT_APPROVAL/);});
test('multiple runs on the same source set count as one observation',async()=>{const f=await run('BENEFIT');let n=await transition(f.state,proposalCommand(f.state,'EXECUTE'),actor,f.org,f.read,'second-run');n=await transition(n.state,{type:'OUTCOME',expectedVersion:n.state.version,runId:n.state.runs[1]!.id,outcome:'BENEFIT'},actor,f.org,f.read,'second-outcome');assert.equal(learningCycle(n.state).tools[0]!.currentObservations,1);});
test('revoked author invalidates reported benefit',async()=>{const f=await run('BENEFIT');f.records['organizations/wmgj/members/reviewer-1']!.active=false;const n=await transition(f.state,null,actor,f.org,f.read,'read');assert.equal(learningCycle(n.state).tools[0]!.currentObservations,0);assert.equal(n.state.memory!.deferredSignalRefs.length,4);});
test('unsupported template or modified plan cannot execute',async()=>{const f=await prepare(),m=f.state.memory!,p=m.proposals[0]!,plan=compileToolPlan(m,p);assert.throws(()=>buildToolReport(m,p,{...plan,fingerprint:digest('changed')}),/CURRENT_EVIDENCE/);p.template='EXEC_SHELL';assert.equal(compileToolPlan(m,p).readyForReview,false);});
test('public cycle excludes raw source names and private proof data',async()=>{const f=await run('BENEFIT'),text=JSON.stringify(publicState(f.state));for(const bad of ['action-1','invoice-1','doc-1','reviewer-1','snapshotHash'])assert.ok(!text.includes(bad),bad);});
test('two cases stay a need, never become an executable tool',()=>{const f={schemaVersion:'aurora.organic.signal.v1' as const,org:'wmgj',sector:'AUDIT',kind:'REWORK' as const,category:'AUDIT' as const,toolId:null,outcome:null};const es=[1,2].map(i=>({...f,id:digest(['e',i]),caseRef:digest(['c',i]),evidenceRefs:[digest(['d',i])],decisionRef:digest(['v',i])}));const m=reconcile('wmgj',null,es,new Set(['AUDIT']),()=>true);const out=learningCycle({orgId:'wmgj',version:1,memory:m,runs:[],approvals:{}});assert.equal(out.needs[0]!.distinctCases,2);assert.equal(out.tools.length,0);});
test('read does not mutate existing checkpoint or source records',async()=>{const f=await run('BENEFIT'),before=JSON.stringify(f.state),records=JSON.stringify(f.records);await transition(f.state,null,actor,f.org,f.read,'read');assert.equal(JSON.stringify(f.state),before);assert.equal(JSON.stringify(f.records),records);});

test('learning rejects a checkpoint from another company before exposing observations',async()=>{
 const f=await prepare();
 assert.throws(()=>learningCycle({...f.state,orgId:'company-b'}),/MEMORY_SCOPE_OR_SCHEMA_INVALID/);
});
test('learning rejects mixed tenant signals including deferred ones',async()=>{
 const f=await prepare(),s=structuredClone(f.state),e=s.memory!.signals[0]!;
 e.org='company-b';s.memory!.deferredSignalRefs.push(e.id);
 assert.throws(()=>learningCycle(s),/MEMORY_SCOPE_OR_SCHEMA_INVALID/);
});
test('learning rejects a foreign proposal instead of relabeling it',async()=>{
 const f=await prepare(),s=structuredClone(f.state);
 s.memory!.proposals[0]!.org='company-b';
 assert.throws(()=>learningCycle(s),/MEMORY_SCOPE_OR_SCHEMA_INVALID/);
});
test('learning requires a valid tenant even with an empty memory',()=>{
 for(const orgId of ['', 'company/a', ' company-a ']){
  assert.throws(()=>learningCycle({orgId,version:0,memory:null,runs:[],approvals:{}}),/MEMORY_SCOPE_OR_SCHEMA_INVALID/);
 }
 const empty=learningCycle({orgId:'company-a',version:0,memory:null,runs:[],approvals:{}});
 assert.deepEqual(empty.needs,[]);assert.deepEqual(empty.tools,[]);
});
test('public state refuses a memory mislabeled as the requested company',async()=>{
 const f=await prepare(),s={...f.state,orgId:'company-b'};
 assert.throws(()=>publicState(s),/MEMORY_SCOPE_OR_SCHEMA_INVALID/);
});
async function prepareCompany(orgId:string){
 const f=fixture(),records:Record<string,Record<string,unknown>>={};
 for(const [path,value] of Object.entries(f.records)){
  const copy=structuredClone(value);if(copy.orgId!==undefined)copy.orgId=orgId;
  records[path.replace('organizations/wmgj/','organizations/'+orgId+'/')]=copy;
 }
 const read=async(path:string)=>records[path]??null;
 const member={...actor,orgId};let state:State|null=null;
 for(let i=1;i<=3;i++)state=(await transition(state,{type:'OBSERVE',expectedVersion:i-1,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:'action-'+i},member,f.org,read,'op-'+i)).state;
 return {records,read,org:f.org,actor:member,state:state!};
}
test('same local source names and commands in two companies produce isolated knowledge',async()=>{
 const a=await prepareCompany('company-a'),b=await prepareCompany('company-b');
 const la=learningCycle(a.state),lb=learningCycle(b.state);
 assert.notEqual(la.needs[0]!.id,lb.needs[0]!.id);
 assert.notEqual(la.tools[0]!.id,lb.tools[0]!.id);
 assert.notEqual(la.tools[0]!.fingerprint,lb.tools[0]!.fingerprint);
 assert.notDeepEqual(a.state.memory!.signals.map(s=>s.id),b.state.memory!.signals.map(s=>s.id));
 assert.deepEqual(la.intelligenceBoundary,{tenantId:'company-a',mode:'TENANT_PRIVATE',personalizationSource:'CURRENT_TENANT_ONLY',sharedCapabilities:'VERSIONED_VALIDATED_ABSTRACTIONS_ONLY',tenantDataTransfer:false,tenantRuleTransfer:false});
});
test('adverse learning in company A does not suspend or change company B',async()=>{
 const a=await prepareCompany('company-a'),b=await prepareCompany('company-b');
 const before=JSON.stringify(b.state);
 a.state=(await transition(a.state,proposalCommand(a.state,'APPROVE_PILOT'),a.actor,a.org,a.read,'approve')).state;
 a.state=(await transition(a.state,proposalCommand(a.state,'EXECUTE'),a.actor,a.org,a.read,'execute')).state;
 a.state=(await transition(a.state,{type:'OUTCOME',expectedVersion:a.state.version,runId:a.state.runs[0]!.id,outcome:'ADVERSE'},a.actor,a.org,a.read,'outcome')).state;
 assert.equal(learningCycle(a.state).tools[0]!.nextAction,'SUSPEND_AND_REVIEW');
 assert.equal(learningCycle(b.state).tools[0]!.nextAction,'REVIEW_CANDIDATE');
 assert.equal(learningCycle(b.state).tools[0]!.adverseHistory,false);
 assert.equal(JSON.stringify(b.state),before);
});
test('company B report cannot consume company A plan or checkpoint',async()=>{
 const a=await prepareCompany('company-a'),b=await prepareCompany('company-b');
 const plan=compileToolPlan(a.state.memory!,a.state.memory!.proposals[0]!);
 assert.throws(()=>buildToolReport(b.state.memory!,b.state.memory!.proposals[0]!,plan),/CURRENT_EVIDENCE_REQUIRED/);
 await assert.rejects(transition(a.state,null,b.actor,b.org,b.read,'read'),/MEMORY_SCOPE_OR_SCHEMA_INVALID/);
});
