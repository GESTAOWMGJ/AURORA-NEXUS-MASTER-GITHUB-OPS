import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { Script } from 'node:vm';
import { createPracticeOperations, practiceCipher, practiceHash, normalizePracticeRequest } from '../src/auroraPracticeOperations.js';
import { practiceWebsite, practiceWorkspaceScript, practiceConfirmationPage } from '../src/auroraPracticeWorkspaceView.js';
import type { ProfileActor } from '../src/auroraUserProfilePolicy.js';
import type { ProfileStore } from '../src/auroraUserProfiles.js';
import type { EnvelopeKey } from '../src/auroraCryptoEnvelope.js';

const owner:ProfileActor={uid:'synthetic-owner',orgId:'synthetic-practice',role:'practice_owner',mfaVerified:true,allFacilities:true};
const now=Date.parse('2026-10-26T10:00:00.000Z'),future='2026-10-27T10:00:00.000Z',base=`organizations/${owner.orgId}`;
const business={name:'Consultório Sintético',profession:'Psicologia',registration:'REGISTRO-FICTICIO',publicEmail:'office@example.invalid',publicPhone:'',publicAddress:'',timezone:'America/Sao_Paulo',hours:'Segunda a sexta, das 8h às 18h',cancellationPolicy:'Solicite com 24 horas de antecedência.',services:[{id:'service-synthetic',name:'Consulta',durationMinutes:50,priceCents:20000}]};
function fixture(){
 const org={active:true,profile:'PERSONALITE',environment:'HOMOLOGATION',practiceOperations:{enabled:true,dataMode:'SYNTHETIC'}};
 const rows=new Map<string,any>([[base,org],[base+'/members/'+owner.uid,{active:true,role:owner.role,allFacilities:true,profileVersion:1,profileState:'READY'}]]);
 const keys=new Map<string,Buffer>();
 const key:EnvelopeKey={keyResource:'projects/synthetic-project/locations/southamerica-east1/keyRings/test/cryptoKeys/test',wrapKey:async b=>{const tag=randomBytes(32);keys.set(tag.toString('hex'),Buffer.from(b));return {ciphertext:tag};},unwrapKey:async b=>{const k=keys.get(b.toString('hex'));if(!k)throw Error('missing test key');return Buffer.from(k);}};
 let lock=Promise.resolve(),clock=now;
 const store:ProfileStore={transaction:async body=>{const wait=lock;let release!:()=>void;lock=new Promise(r=>release=r);await wait;const draft=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));let wrote=false;try{const result=await body({read:async p=>{assert.equal(wrote,false);return structuredClone(draft.get(p));},create:(p,d)=>{wrote=true;assert.equal(draft.has(p),false);draft.set(p,structuredClone(d));},update:(p,d)=>{wrote=true;assert.equal(draft.has(p),true);draft.set(p,{...draft.get(p),...structuredClone(d)});}});rows.clear();draft.forEach((v,k)=>rows.set(k,v));return result;}finally{release();}}};
 const engine=createPracticeOperations(store,practiceCipher(()=>key),()=>clock);let sequence=0;
 const mutate=async(action:string,data:any,actor=owner)=>engine.mutate(actor,{action,data,expectedRevision:(await engine.read(actor)).revision,requestId:'synthetic-request-'+(++sequence)});
 const role=(role:string)=>{const actor={...owner,uid:role,role};rows.set(base+'/members/'+role,{active:true,role,allFacilities:true,profileVersion:1,profileState:'READY'});return actor;};
 const appointment=async(consent=true)=>{await mutate('SAVE_BUSINESS',business);const c=await mutate('ADD_CONTACT',{name:'Contato Sintético',email:'person@example.invalid',phone:'',messageConsent:consent});return mutate('BOOK',{contactId:c.entityId,serviceId:business.services[0]!.id,startsAt:future});};
 return {engine,rows,mutate,role,appointment,store,key,advance:(ms:number)=>clock+=ms};
}
const rejects=(code:string)=>(e:any)=>{assert.equal(e.code,code);return true;};
test('workflow persists encrypted agenda, individual capability confirmation, finance, knowledge and website',async()=>{
 const f=fixture(),a=await f.appointment();
 const link=await f.mutate('ISSUE_CONFIRMATION',{appointmentId:a.entityId});
 assert.equal(JSON.stringify([...f.rows]).includes(link.confirmationToken),false);
 assert.equal(JSON.stringify([...f.rows]).includes('Contato Sintético'),false);
 assert.deepEqual(await f.engine.confirm(owner.orgId,a.entityId,link.confirmationToken),{ok:true,replayed:false});
 assert.deepEqual(await f.engine.confirm(owner.orgId,a.entityId,link.confirmationToken),{ok:true,replayed:true});
 const charge=await f.mutate('ADD_CHARGE',{appointmentId:a.entityId,amountCents:20000,dueAt:future});
 const credit=await f.mutate('ADD_BANK_ENTRY',{externalRef:'synthetic-credit',amountCents:20000,bookedAt:future,sourceHash:practiceHash('synthetic statement')});
 await f.mutate('RECONCILE',{chargeId:charge.entityId,bankEntryId:credit.entityId});
 const state=await f.engine.read(owner);assert.equal(state.totals.manuallyMatchedCents,20000);assert.equal(state.totals.providerConfirmedCents,0);assert.equal(state.charges[0].paymentState,'PENDING');
 await f.mutate('SAVE_KNOWLEDGE',{question:'Como funciona o estacionamento?',answer:'Estacionamento na rua.'});
 assert.equal((await f.engine.answer(owner,'estacionamento')).answer,'Estacionamento na rua.');
 assert.equal((await f.engine.answer(owner,'prescrever medicamento')).source,'ADMINISTRATIVE_SCOPE');
 await f.mutate('SAVE_WEBSITE',{headline:'Cuidado e escuta',about:'Apresentação sintética',contactLabel:'Entre em contato',desiredDomain:'exemplo.com.br'});
 const site=await f.engine.read(owner);await f.mutate('APPROVE_WEBSITE',{contentHash:site.websiteContentHash});
 assert.ok(practiceWebsite(await f.engine.read(owner)).includes('office@example.invalid'));
 await f.mutate('SAVE_BUSINESS',{...business,hours:'8h às 17h'});assert.equal((await f.engine.read(owner)).website.approvedHash,null);
});
test('tenant isolation includes no inherited WMGJ membership and ciphertext transplant rejection',async()=>{
 const f=fixture();await f.appointment();
 await assert.rejects(f.engine.read({...owner,orgId:'wmgj'}),rejects('PRACTICE_PERMISSION_DENIED'));
 const other={...owner,orgId:'synthetic-other'};const b='organizations/'+other.orgId;
 f.rows.set(b,structuredClone(f.rows.get(base)));f.rows.set(b+'/members/'+owner.uid,structuredClone(f.rows.get(base+'/members/'+owner.uid)));
 assert.equal((await f.engine.read(other)).contacts.length,0);
 f.rows.set(b+'/runtimeCheckpoints/practice-operations-v1',structuredClone(f.rows.get(base+'/runtimeCheckpoints/practice-operations-v1')));
 await assert.rejects(f.engine.read(other),/AAD/);
});
test('revocation blocks reads, answers, writes and idempotent replay immediately',async()=>{
 const f=fixture(),r={action:'ADD_TASK',data:{title:'Tarefa',dueAt:future},requestId:'synthetic-task-01',expectedRevision:0};
 await f.engine.mutate(owner,r);f.rows.get(base+'/members/'+owner.uid).active=false;
 for(const action of [()=>f.engine.read(owner),()=>f.engine.answer(owner,'horários'),()=>f.engine.mutate(owner,r)])await assert.rejects(action(),rejects('PRACTICE_MEMBERSHIP_REVOKED'));
});
test('least privilege projections and mutations do not inherit generic admin or clinical rights',async()=>{
 const f=fixture();await f.appointment();
 for(const role of ['practice_reception','practice_finance','practice_editor']){
  const a=f.role(role),s=await f.engine.read(a);assert.equal('contacts'in s,role==='practice_reception');assert.equal('charges'in s,role==='practice_finance');assert.equal('website'in s,role==='practice_editor');
  await assert.rejects(f.mutate('SAVE_KNOWLEDGE',{question:'Segredo',answer:'Não'},a),rejects('PRACTICE_PERMISSION_DENIED'));
 }
 await assert.rejects(f.engine.read(f.role('org_admin')),rejects('PRACTICE_PERMISSION_DENIED'));
 for(const a of [{...owner,mfaVerified:false},{...owner,allFacilities:false},{...owner,uid:'../owner'}])await assert.rejects(f.engine.read(a),rejects('PRACTICE_PERMISSION_DENIED'));
});
test('real data mode and production cannot be enabled by flipping an operations flag',async()=>{
 for(const patch of [{environment:'PRODUCTION'},{practiceOperations:{enabled:true,dataMode:'REAL'}},{profile:'WMGJ'}]){const f=fixture();Object.assign(f.rows.get(base),patch);await assert.rejects(f.engine.read(owner),rejects('PRACTICE_OPERATIONS_NOT_ENABLED'));}
});
test('concurrent edits, replay and conflicting idempotency requests remain atomic',async()=>{
 const f=fixture(),r={action:'ADD_TASK',data:{title:'Tarefa',dueAt:future},requestId:'synthetic-task-01',expectedRevision:0};
 const results=await Promise.all([f.engine.mutate(owner,r),f.engine.mutate(owner,r)]);assert.equal(results.filter(r=>r.replayed).length,1);assert.equal((await f.engine.read(owner)).tasks.length,1);
 await assert.rejects(f.engine.mutate(owner,{...r,data:{title:'Outra',dueAt:future}}),rejects('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(f.engine.mutate(owner,{...r,requestId:'synthetic-task-02'}),rejects('REVISION_CONFLICT'));
});
test('appointment overlap, absent references and dates are rejected without changes',async()=>{
 const f=fixture();await f.appointment();const s=await f.engine.read(owner);
 await assert.rejects(f.mutate('BOOK',{contactId:s.contacts[0].id,serviceId:business.services[0]!.id,startsAt:future}),rejects('SLOT_ALREADY_RESERVED'));
 await assert.rejects(f.mutate('BOOK',{contactId:'not-present',serviceId:business.services[0]!.id,startsAt:future}),rejects('REFERENCE_NOT_FOUND'));
 assert.equal((await f.engine.read(owner)).revision,s.revision);
 assert.throws(()=>normalizePracticeRequest({action:'BOOK',requestId:'synthetic-request',expectedRevision:0,data:{contactId:'synthetic-contact',serviceId:'synthetic-service',startsAt:'2026-02-30T10:00:00.000Z'}}),rejects('INVALID_DATE'));
});
test('confirmation requires consent, exact org, current capability, expiry and open appointment',async()=>{
 const missing=fixture(),a0=await missing.appointment(false);await assert.rejects(missing.mutate('ISSUE_CONFIRMATION',{appointmentId:a0.entityId}),rejects('MESSAGE_CONSENT_REQUIRED'));
 const f=fixture(),a=await f.appointment(),first=await f.mutate('ISSUE_CONFIRMATION',{appointmentId:a.entityId}),second=await f.mutate('ISSUE_CONFIRMATION',{appointmentId:a.entityId});
 await assert.rejects(f.engine.confirm(owner.orgId,a.entityId,first.confirmationToken),rejects('CONFIRMATION_UNAVAILABLE'));
 await assert.rejects(f.engine.confirm('synthetic-other',a.entityId,second.confirmationToken),rejects('CONFIRMATION_UNAVAILABLE'));
 await f.mutate('SET_APPOINTMENT',{appointmentId:a.entityId,status:'CANCELLED'});await assert.rejects(f.engine.confirm(owner.orgId,a.entityId,second.confirmationToken),rejects('CONFIRMATION_UNAVAILABLE'));
 const g=fixture(),b=await g.appointment(),l=await g.mutate('ISSUE_CONFIRMATION',{appointmentId:b.entityId});g.advance(86400000);await assert.rejects(g.engine.confirm(owner.orgId,b.entityId,l.confirmationToken),rejects('CONFIRMATION_UNAVAILABLE'));
});
test('reminders deduplicate and never claim sent; token receipts never retain secret',async()=>{
 const f=fixture(),a=await f.appointment();await f.mutate('DRAFT_REMINDER',{appointmentId:a.entityId});await f.mutate('DRAFT_REMINDER',{appointmentId:a.entityId});const s=await f.engine.read(owner);assert.equal(s.drafts.length,1);assert.equal(s.drafts[0].status,'DRAFT');assert.equal(s.connections.whatsapp,'NOT_CONNECTED');
 const r={action:'ISSUE_CONFIRMATION',data:{appointmentId:a.entityId},requestId:'synthetic-capability',expectedRevision:s.revision};const first=await f.engine.mutate(owner,r),replay=await f.engine.mutate(owner,r);assert.ok(first.confirmationToken);assert.equal(replay.confirmationToken,undefined);
});
test('financial evidence cannot forge a provider payment or reuse an allocation',async()=>{
 const f=fixture(),a=await f.appointment(),c=await f.mutate('ADD_CHARGE',{appointmentId:a.entityId,amountCents:20000,dueAt:future});
 const b=await f.mutate('ADD_BANK_ENTRY',{externalRef:'synthetic-credit',amountCents:19000,bookedAt:future,sourceHash:practiceHash('source')});
 await assert.rejects(f.mutate('RECONCILE',{chargeId:c.entityId,bankEntryId:b.entityId}),rejects('AMOUNT_MISMATCH'));
 await assert.rejects(f.mutate('ADD_CHARGE',{appointmentId:a.entityId,amountCents:20000,dueAt:future,paymentState:'PAID_PROVIDER'}),rejects('INVALID_FIELDS'));
 await assert.rejects(f.mutate('ADD_BANK_ENTRY',{externalRef:'synthetic-credit',amountCents:19000,bookedAt:future,sourceHash:practiceHash('source')}),rejects('BANK_ENTRY_EXISTS'));
});
test('revoked business knowledge stops retrieval and roles cannot close each others tasks',async()=>{
 const f=fixture(),k=await f.mutate('SAVE_KNOWLEDGE',{question:'Estacionamento?',answer:'Resposta sintética'});await f.mutate('REVOKE_KNOWLEDGE',{knowledgeId:k.entityId});assert.equal((await f.engine.answer(owner,'estacionamento')).source,'NO_APPROVED_ANSWER');
 const reception=f.role('practice_reception'),finance=f.role('practice_finance'),t=await f.mutate('ADD_TASK',{title:'Secretaria',dueAt:future},reception);await assert.rejects(f.mutate('COMPLETE_TASK',{taskId:t.entityId},finance),rejects('PRACTICE_PERMISSION_DENIED'));
});
test('website escapes content and client scripts compile without a GET confirmation mutation',()=>{
 new Script(practiceWorkspaceScript);const page=practiceConfirmationPage();for(const script of page.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script[1]!);
 assert.ok(page.includes('location.hash'));assert.ok(page.includes('history.replaceState'));assert.ok(page.includes('b.onclick=async'));
 const site=practiceWebsite({business:{...business,name:'<script>alert(1)</script>'},website:{headline:'<img onerror=alert(1)>',about:'A & B'}});assert.equal(site.includes('<script>'),false);assert.ok(site.includes('&lt;img'));
});
test('provider payment binds account, organization, amount, mode, session and immutable event receipt',async()=>{
 const f=fixture(),a=await f.appointment(),charge=await f.mutate('ADD_CHARGE',{appointmentId:a.entityId,amountCents:20000,dueAt:future});
 await assert.rejects(f.engine.checkoutContext(owner,charge.entityId),rejects('PAYMENT_TEST_CONNECTION_REQUIRED'));
 Object.assign(f.rows.get(base),{providerWriteEnabled:true,practicePayments:{enabled:true,mode:'TEST',accountId:'acct_synthetic'}});
 const context=await f.engine.checkoutContext(owner,charge.entityId),session={sessionId:'cs_test_synthetic',accountId:'acct_synthetic',mode:'TEST'};
 await f.engine.attachCheckout(owner,charge.entityId,session,context.configHash);
 assert.equal((await f.engine.attachCheckout(owner,charge.entityId,session,context.configHash)).replayed,true);
 const event={id:'evt_synthetic',type:'checkout.session.completed',livemode:false,data:{object:{id:session.sessionId,mode:'payment',livemode:false,payment_status:'paid',currency:'brl',amount_total:20000,metadata:{auroraOrgId:owner.orgId,auroraChargeId:charge.entityId}}}};
 for(const patch of [{amount_total:1},{currency:'usd'},{id:'cs_test_other'},{livemode:true},{metadata:{auroraOrgId:'other',auroraChargeId:charge.entityId}}])await assert.rejects(f.engine.recordPayment(owner.orgId,{...event,data:{object:{...event.data.object,...patch}}},context.configHash),rejects('PAYMENT_PROVIDER_MISMATCH'));
 assert.equal((await f.engine.recordPayment(owner.orgId,{...event,data:{object:{...event.data.object,payment_status:'unpaid'}}},context.configHash)).ignored,true);
 assert.equal((await f.engine.read(owner)).totals.providerConfirmedCents,0);
 await f.engine.recordPayment(owner.orgId,event,context.configHash);
 assert.equal((await f.engine.read(owner)).totals.providerConfirmedCents,20000);
 assert.equal((await f.engine.recordPayment(owner.orgId,event,context.configHash)).replayed,true);
 await assert.rejects(f.engine.recordPayment(owner.orgId,{...event,account:'acct_other'},context.configHash),rejects('PAYMENT_EVENT_CONFLICT'));
 f.rows.get(base).practicePayments.accountId='acct_changed';await assert.rejects(f.engine.recordPayment(owner.orgId,event,context.configHash),rejects('PAYMENT_CONFIGURATION_CHANGED'));
});
