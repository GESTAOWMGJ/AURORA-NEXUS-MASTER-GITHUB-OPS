import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {digest,reconcile,executeReadOnly,type Signal} from '../src/auroraOrganicCore.js';
import {parseCommand,transition,emptyState,publicState,type State,type Actor,type Command} from '../src/auroraOrganicService.js';
import {organicPage} from '../src/auroraOrganicView.js';
const sectors=new Set(['AUDIT']);
const signals:Signal[]=[1,2,3].map(i=>({schemaVersion:'aurora.organic.signal.v1',id:digest(['e',i]),org:'wmgj',sector:'AUDIT',kind:'REWORK',category:'AUDIT',caseRef:digest(['c',i]),evidenceRefs:[digest(['d',i])],decisionRef:digest(['v',i]),toolId:null,outcome:null}));
const actor:Actor={uid:'reviewer-1',orgId:'wmgj',role:'auditor',permissions:[],allFacilities:true,mfaVerified:true};
function fixture(){
 const records:Record<string,Record<string,unknown>>={'organizations/wmgj/members/reviewer-1':{active:true,allFacilities:true,role:'auditor'}};
 for(let i=1;i<=3;i++){
 records[`organizations/wmgj/actionItems/action-${i}`]={orgId:'wmgj',status:'RESOLVED',revision:2,updatedBy:'reviewer-1',targetType:'invoice',targetId:`invoice-${i}`,evidenceRefs:[`doc-${i}`]};
 records[`organizations/wmgj/invoices/invoice-${i}`]={orgId:'wmgj',evidenceRefs:[`doc-${i}`]};
 records[`organizations/wmgj/sourceDocuments/doc-${i}`]={orgId:'wmgj',reviewState:'APPROVED',workflowState:'VALIDATED',sensitivity:'INTERNAL',sourceVersion:1};
 }
 const read=async(path:string)=>records[path]??null;
 return {records,read,org:{active:true,organicEnabled:true,organicSectors:['AUDIT']}};
}
async function prepared(){const f=fixture();let state:State|null=null;for(let i=1;i<=3;i++)state=(await transition(state,{type:'OBSERVE',expectedVersion:i-1,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:`action-${i}`},actor,f.org,f.read,`op-${i}`)).state;return {...f,state:state!};}
async function approved(){const f=await prepared(),p=f.state.memory!.proposals[0]!;f.state=(await transition(f.state,{type:'APPROVE_PILOT',expectedVersion:f.state.version,proposalId:p.id,proposalRevision:p.revision},actor,f.org,f.read,'approve')).state;return f;}
function commandFor(s:State,type:'EXECUTE'|'ROLLBACK'):Command{const p=s.memory!.proposals[0]!;return{type,expectedVersion:s.version,proposalId:p.id,proposalRevision:p.revision};}

test('Python/TypeScript parity for baseline, replay and revocation',()=>{
 const script="import sys,json;sys.path.insert(0,'../../aurora-coletor');import aurora_organic as a;s=json.load(sys.stdin);x=a.reconcile('wmgj',None,s,allowed_sectors=frozenset({'AUDIT'}),verify=lambda e:True);y=a.reconcile('wmgj',x,s,allowed_sectors=frozenset({'AUDIT'}),verify=lambda e:True);z=a.reconcile('wmgj',y,[],allowed_sectors=frozenset({'AUDIT'}),verify=lambda e:e['id']!=s[0]['id']);print(json.dumps([x,y,z]))";
 const r=spawnSync('python3',['-c',script],{input:JSON.stringify(signals),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const a=reconcile('wmgj',null,signals,sectors,()=>true),b=reconcile('wmgj',a,signals,sectors,()=>true),c=reconcile('wmgj',b,[],sectors,e=>e.id!==signals[0]!.id);assert.deepEqual([a,b,c],JSON.parse(r.stdout));
});
test('duplicate cases do not produce a proposal',()=>{const es=signals.map(e=>({...e,caseRef:signals[0]!.caseRef}));assert.equal(reconcile('wmgj',null,es,sectors,()=>true).proposals.length,0);});
test('duplicate source refs do not produce a proposal',()=>{const es=signals.map(e=>({...e,evidenceRefs:signals[0]!.evidenceRefs}));assert.equal(reconcile('wmgj',null,es,sectors,()=>true).proposals.length,0);});
test('cross-tenant signals rejected',()=>assert.throws(()=>reconcile('other',null,signals,sectors,()=>true),/CROSS_TENANT/));
test('payload permission flags are rejected',()=>assert.throws(()=>parseCommand({type:'REVALIDATE',expectedVersion:0,approved:true}),/INVALID_COMMAND/));
test('unknown operation and free text rejected',()=>assert.throws(()=>parseCommand({type:'SHELL',expectedVersion:0,command:'anything'}),/INVALID_COMMAND/));
test('path traversal rejected',()=>assert.throws(()=>parseCommand({type:'OBSERVE',expectedVersion:0,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:'../outside'}),/INVALID_COMMAND/));
test('integrated observation composes a stable proposal',async()=>{const f=await prepared();assert.equal(f.state.memory!.proposals.length,1);assert.equal(f.state.memory!.proposals[0]!.distinctCases,3);assert.deepEqual(f.state.approvals,{});});
test('replaying an observation never duplicates a case',async()=>{const f=await prepared();const n=await transition(f.state,{type:'OBSERVE',expectedVersion:f.state.version,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:'action-1'},actor,f.org,f.read,'repeat');assert.equal(n.state.memory!.signals.length,3);assert.equal(n.state.memory!.proposals[0]!.revision,1);});
test('concurrency conflict is rejected',async()=>{const f=await prepared();await assert.rejects(transition(f.state,{type:'REVALIDATE',expectedVersion:0},actor,f.org,f.read,'conflict'),/REVISION_CONFLICT/);});
test('missing source never counts as validated',async()=>{const f=fixture();delete f.records['organizations/wmgj/sourceDocuments/doc-1'];await assert.rejects(transition(null,{type:'OBSERVE',expectedVersion:0,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:'action-1'},actor,f.org,f.read,'x'),/VERIFIED_RESOLVED/);});
test('sanitized source-independent Firebase evidence can feed organic learning without origin reread',async()=>{
 const f=fixture();
 for(let i=1;i<=3;i++)Object.assign(f.records[`organizations/wmgj/sourceDocuments/doc-${i}`]!,{
   reviewState:'NOT_REQUIRED',
   sensitivity:'RESTRICTED',
   sanitized:true,
   nativeReady:true,
   sourceIndependent:true,
   externalFetchRequired:false,
   canonicalSnapshotVersion:1,
   canonicalSnapshotHash:digest(['canonical',i])
 });
 let state:State|null=null;
 for(let i=1;i<=3;i++)state=(await transition(state,{type:'OBSERVE',expectedVersion:i-1,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:`action-${i}`},actor,f.org,f.read,`native-${i}`)).state;
 assert.equal(state!.memory!.proposals.length,1);
 assert.equal(state!.memory!.deferredSignalRefs.length,0);
});

test('restricted evidence without Firebase-native safeguards is refused',async()=>{
 const f=fixture();
 Object.assign(f.records['organizations/wmgj/sourceDocuments/doc-1']!,{reviewState:'NOT_REQUIRED',sensitivity:'RESTRICTED'});
 await assert.rejects(transition(null,{type:'OBSERVE',expectedVersion:0,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:'action-1'},actor,f.org,f.read,'restricted'),/VERIFIED_RESOLVED/);
});

test('pending or clinical evidence is refused',async()=>{for(const change of [{reviewState:'PENDING'},{sensitivity:'CLINICAL_SENSITIVE'},{revoked:true},{expiresAt:'2020-01-01T00:00:00Z'}]){const f=fixture();Object.assign(f.records['organizations/wmgj/sourceDocuments/doc-1']!,change);await assert.rejects(transition(null,{type:'OBSERVE',expectedVersion:0,kind:'REWORK',category:'AUDIT',sector:'AUDIT',actionId:'action-1'},actor,f.org,f.read,'x'),/VERIFIED_RESOLVED/);}});
test('review requires MFA',async()=>{const f=await prepared(),p=f.state.memory!.proposals[0]!;await assert.rejects(transition(f.state,{type:'APPROVE_PILOT',expectedVersion:3,proposalId:p.id,proposalRevision:1},{...actor,mfaVerified:false},f.org,f.read,'x'),/MFA/);});
test('execution before approval is refused',async()=>{const f=await prepared();await assert.rejects(transition(f.state,commandFor(f.state,'EXECUTE'),actor,f.org,f.read,'x'),/CURRENT_APPROVAL/);});
test('approved executor returns actual bounded counts',async()=>{const f=await approved();const n=await transition(f.state,commandFor(f.state,'EXECUTE'),actor,f.org,f.read,'execute');assert.equal(n.result.cases,3);assert.equal(n.result.financialMutation,false);assert.equal(n.state.runs.length,1);});
test('source changes revoke the pilot before execution',async()=>{const f=await approved();f.records['organizations/wmgj/sourceDocuments/doc-1']!.sourceVersion=2;const view=await transition(f.state,null,actor,f.org,f.read,'read');assert.equal(view.state.approvals[f.state.memory!.proposals[0]!.id]!.status,'ROLLED_BACK');await assert.rejects(transition(f.state,commandFor(f.state,'EXECUTE'),actor,f.org,f.read,'x'),/REVISION|APPROVAL|EVIDENCE/);});
test('reviewer revocation suspends proposals',async()=>{const f=await approved();f.records['organizations/wmgj/members/reviewer-1']!.active=false;const view=await transition(f.state,null,actor,f.org,f.read,'read');assert.equal(view.state.memory!.deferredSignalRefs.length,3);assert.equal(Object.values(view.state.approvals)[0]!.status,'ROLLED_BACK');});
test('sector removal revokes old evidence without discarding history',async()=>{const f=await approved();const view=await transition(f.state,null,actor,{...f.org,organicSectors:['FINANCE']},f.read,'read');assert.equal(view.state.memory!.signals.length,3);assert.equal(view.state.memory!.deferredSignalRefs.length,3);});
test('rollback prevents subsequent execution',async()=>{const f=await approved();const n=await transition(f.state,commandFor(f.state,'ROLLBACK'),actor,f.org,f.read,'rollback');await assert.rejects(transition(n.state,commandFor(n.state,'EXECUTE'),actor,f.org,f.read,'x'),/CURRENT_APPROVAL/);});
test('adverse outcome suspends the read-only pilot',async()=>{const f=await approved();const n=await transition(f.state,commandFor(f.state,'EXECUTE'),actor,f.org,f.read,'execute');const out=await transition(n.state,{type:'OUTCOME',expectedVersion:n.state.version,runId:n.state.runs[0]!.id,outcome:'ADVERSE'},actor,f.org,f.read,'outcome');assert.equal(out.state.memory!.performance[0]!.recommendation,'REVIEW_OR_ROLLBACK');assert.equal(Object.values(out.state.approvals)[0]!.status,'ROLLED_BACK');});
test('a result cannot be reported for an unknown run',async()=>{const f=await prepared();await assert.rejects(transition(f.state,{type:'OUTCOME',expectedVersion:3,runId:digest('missing'),outcome:'BENEFIT'},actor,f.org,f.read,'x'),/RUN_NOT_FOUND/);});
test('viewer and facility-limited actors refused',async()=>{const f=fixture();for(const a of [{...actor,role:'viewer'},{...actor,allFacilities:false}])await assert.rejects(transition(null,null,a,f.org,f.read,'x'),/PERMISSION_DENIED/);});
test('disabled organizations and pilots fail closed',async()=>{const f=fixture();await assert.rejects(transition(null,null,actor,{...f.org,active:false},f.read,'x'),/ORGANIZATION_DISABLED/);await assert.rejects(transition(null,{type:'REVALIDATE',expectedVersion:0},actor,{...f.org,organicEnabled:false},f.read,'x'),/ORGANIC_DISABLED/);});
test('transport error does not become an approved signal',async()=>{const f=await prepared();await assert.rejects(transition(f.state,null,actor,f.org,async()=>{throw new Error('transport');},'x'),/transport/);});
test('public view does not include source IDs or actor IDs',async()=>{const f=await approved();const out=JSON.stringify(publicState(f.state));assert.ok(!out.includes('action-1'));assert.ok(!out.includes('reviewer-1'));assert.ok(!out.includes('snapshotHash'));});
test('fixed executor rejects a changed operation',()=>{const m=reconcile('wmgj',null,signals,sectors,()=>true),p=m.proposals[0]!;p.operation='EXEC';assert.throws(()=>executeReadOnly(m,p.id,{revision:p.revision,fingerprint:p.definitionFingerprint,actorUid:'u',status:'PILOT'}),/EXECUTOR_NOT_ALLOWED/);});
test('private page includes operational lifecycle and parsable script',()=>{const html=organicPage('v1.nonce.signature','nonce');assert.ok(html.includes('JFN-AUD-GOV-001'));assert.ok(html.includes('M03.1'));assert.ok(!html.includes('localStorage'));new Script(html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)![1]!);assert.throws(()=>organicPage('</script>','n'),/INVALID_PAGE/);});
test('runtime uses existing checkpoint, transaction, audit and scoped CSRF',()=>{const code=readFileSync('src/auroraOrganicRuntime.ts','utf8');for(const needle of ['runtimeCheckpoints/','runTransaction','apiIdempotency/','auditEvents/','CSRF_PURPOSES.organic','verifyAuroraAccess','membership?.active'])assert.ok(code.includes(needle),needle);for(const forbidden of ['initializeApp(','eval(','exec(','spawn('])assert.ok(!code.includes(forbidden),forbidden);});
