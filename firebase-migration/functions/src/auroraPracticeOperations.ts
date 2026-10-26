import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { encryptEnvelope, decryptEnvelope, type EnvelopeKey, type AuroraEncryptedEnvelope } from './auroraCryptoEnvelope.js';
import type { ProfileStore, ProfileTx } from './auroraUserProfiles.js';
import type { ProfileActor } from './auroraUserProfilePolicy.js';
import { isPracticeRole } from './auroraPracticePolicy.js';

export const PRACTICE_OPERATIONS_VERSION = '0.2.0';
type Row = Record<string, any>;
export class PracticeError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
function fail(code: string, status = 400): never { throw new PracticeError(code, status); }
export const practiceHash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const id = (v: unknown): string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(v) ? v : fail('INVALID_REFERENCE');
function object(v: unknown, keys: string[]): Row {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail('INVALID_FIELDS');
  return v as Row;
}
function text(v: unknown, max: number, required = true): string {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim()) || /[\u0000-\u001f<>]/.test(v)) fail('INVALID_TEXT');
  return (v as string).trim();
}
function integer(v: unknown, min: number, max: number): number {
  return Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max ? Number(v) : fail('INVALID_NUMBER');
}
function timestamp(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || (!Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v)) fail('INVALID_DATE');
  return v as string;
}
function email(v: unknown): string {
  const value = text(v, 254, false).toLowerCase();
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : fail('INVALID_EMAIL');
}
const phone = (v: unknown): string => { const value = text(v, 20, false); return !value || /^\+?[0-9 ()-]{8,20}$/.test(value) ? value : fail('INVALID_PHONE'); };
const actions: Record<string, string[]> = {
  SAVE_BUSINESS:['practice_owner'], ADD_CONTACT:['practice_owner','practice_reception'],
  BOOK:['practice_owner','practice_reception'], SET_APPOINTMENT:['practice_owner','practice_reception'],
  ISSUE_CONFIRMATION:['practice_owner','practice_reception'], DRAFT_REMINDER:['practice_owner','practice_reception'],
  ADD_CHARGE:['practice_owner','practice_finance'], ADD_BANK_ENTRY:['practice_owner','practice_finance'],
  RECONCILE:['practice_owner','practice_finance'], SAVE_KNOWLEDGE:['practice_owner'], REVOKE_KNOWLEDGE:['practice_owner'],
  SAVE_WEBSITE:['practice_owner','practice_editor'], APPROVE_WEBSITE:['practice_owner'],
  ADD_TASK:['practice_owner','practice_reception','practice_finance','practice_editor'], COMPLETE_TASK:['practice_owner','practice_reception','practice_finance','practice_editor']
};
export type PracticeRequest = { action: string; requestId: string; expectedRevision: number; data: Row };
export function normalizePracticeRequest(raw: unknown): PracticeRequest {
  const r=object(raw,['action','requestId','expectedRevision','data']);
  if(typeof r.action!=='string'||!Object.hasOwn(actions,r.action))fail('UNKNOWN_ACTION');
  const base={action:r.action,requestId:id(r.requestId),expectedRevision:integer(r.expectedRevision,0,Number.MAX_SAFE_INTEGER),data:{} as Row};
  const d=r.data;
  switch(r.action){
    case 'SAVE_BUSINESS': {
      const b=object(d,['name','profession','registration','publicEmail','publicPhone','publicAddress','timezone','hours','cancellationPolicy','services']);
      const timezone=text(b.timezone,80);try{new Intl.DateTimeFormat('pt-BR',{timeZone:timezone});}catch{fail('INVALID_TIMEZONE');}
      if(!Array.isArray(b.services)||b.services.length>30)fail('INVALID_SERVICES');
      const services=b.services.map((v:unknown)=>{const s=object(v,['id','name','durationMinutes','priceCents']);return {id:id(s.id),name:text(s.name,100),durationMinutes:integer(s.durationMinutes,5,240),priceCents:integer(s.priceCents,0,10_000_000)};});
      if(new Set(services.map((s:Row)=>s.id)).size!==services.length)fail('DUPLICATE_SERVICE');
      base.data={name:text(b.name,100),profession:text(b.profession,80),registration:text(b.registration,60),publicEmail:email(b.publicEmail),publicPhone:phone(b.publicPhone),publicAddress:text(b.publicAddress,200,false),timezone,hours:text(b.hours,500,false),cancellationPolicy:text(b.cancellationPolicy,1200,false),services};break;
    }
    case 'ADD_CONTACT': {const c=object(d,['name','email','phone','messageConsent']);if(typeof c.messageConsent!=='boolean')fail('CONSENT_REQUIRED');base.data={name:text(c.name,100),email:email(c.email),phone:phone(c.phone),messageConsent:c.messageConsent};break;}
    case 'BOOK': {const a=object(d,['contactId','serviceId','startsAt']);base.data={contactId:id(a.contactId),serviceId:id(a.serviceId),startsAt:timestamp(a.startsAt)};break;}
    case 'SET_APPOINTMENT': {const a=object(d,['appointmentId','status']);if(!['CONFIRMED','CANCELLED','COMPLETED','NO_SHOW'].includes(a.status))fail('INVALID_APPOINTMENT_STATE');base.data={appointmentId:id(a.appointmentId),status:a.status};break;}
    case 'ISSUE_CONFIRMATION': case 'DRAFT_REMINDER': {const a=object(d,['appointmentId']);base.data={appointmentId:id(a.appointmentId)};break;}
    case 'ADD_CHARGE': {const a=object(d,['appointmentId','amountCents','dueAt']);base.data={appointmentId:id(a.appointmentId),amountCents:integer(a.amountCents,1,10_000_000),dueAt:timestamp(a.dueAt)};break;}
    case 'ADD_BANK_ENTRY': {const b=object(d,['externalRef','amountCents','bookedAt','sourceHash']);if(!/^[a-f0-9]{64}$/.test(b.sourceHash))fail('SOURCE_HASH_REQUIRED');base.data={externalRef:id(b.externalRef),amountCents:integer(b.amountCents,1,10_000_000),bookedAt:timestamp(b.bookedAt),sourceHash:b.sourceHash,source:'MANUAL_STATEMENT'};break;}
    case 'RECONCILE': {const a=object(d,['chargeId','bankEntryId']);base.data={chargeId:id(a.chargeId),bankEntryId:id(a.bankEntryId)};break;}
    case 'SAVE_KNOWLEDGE': {const k=object(d,['question','answer']);base.data={question:text(k.question,200),answer:text(k.answer,1200)};break;}
    case 'REVOKE_KNOWLEDGE': {const k=object(d,['knowledgeId']);base.data={knowledgeId:id(k.knowledgeId)};break;}
    case 'SAVE_WEBSITE': {const w=object(d,['headline','about','contactLabel','desiredDomain']);const domain=text(w.desiredDomain,150,false).toLowerCase();if(domain&&!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|psc|med)\.br$/.test(domain))fail('INVALID_DOMAIN');base.data={headline:text(w.headline,120),about:text(w.about,2400),contactLabel:text(w.contactLabel,60),desiredDomain:domain};break;}
    case 'APPROVE_WEBSITE': {const w=object(d,['contentHash']);if(!/^[a-f0-9]{64}$/.test(w.contentHash))fail('CONTENT_HASH_REQUIRED');base.data={contentHash:w.contentHash};break;}
    case 'ADD_TASK': {const t=object(d,['title','dueAt']);base.data={title:text(t.title,160),dueAt:timestamp(t.dueAt)};break;}
    case 'COMPLETE_TASK': {const t=object(d,['taskId']);base.data={taskId:id(t.taskId)};break;}
  }
  return base;
}
export function emptyPracticeState(): Row { return {schemaVersion:1,revision:0,business:null,contacts:[],appointments:[],charges:[],bankEntries:[],knowledge:[],website:null,tasks:[],drafts:[]}; }
const find=(rows:Row[],key:string):Row=>rows.find(r=>r.id===key)??fail('REFERENCE_NOT_FOUND',404);
const dateLabel=(a:Row,s:Row)=>new Intl.DateTimeFormat('pt-BR',{timeZone:s.business?.timezone??'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(a.startsAt));
export function websiteContentHash(s:Row):string{return practiceHash(JSON.stringify({business:s.business,website:s.website&&{headline:s.website.headline,about:s.website.about,contactLabel:s.website.contactLabel,desiredDomain:s.website.desiredDomain}}));}

/** Pure administrative reducer. Never sends messages, starts inference, or moves money. */
export function reducePractice(state: Row, r: PracticeRequest, actor: ProfileActor, now: number, newId: string, confirmationToken?: string): {state:Row;result:Row} {
  if(!actor.mfaVerified||!actor.allFacilities||!actions[r.action]?.includes(actor.role))fail('PRACTICE_PERMISSION_DENIED',403);
  if(state.schemaVersion!==1||state.revision!==r.expectedRevision)fail('REVISION_CONFLICT',409);
  const s=structuredClone(state),d=r.data,at=new Date(now).toISOString();let result:Row={entityId:newId};
  switch(r.action){
    case 'SAVE_BUSINESS': s.business={...d,updatedAt:at};if(s.website)s.website.approvedHash=null;break;
    case 'ADD_CONTACT': s.contacts.push({...d,id:newId,consentRecordedAt:at});break;
    case 'BOOK': {
      find(s.contacts,d.contactId);if(!s.business)fail('BUSINESS_REQUIRED');const service=find(s.business.services,d.serviceId);
      const start=Date.parse(d.startsAt),end=start+service.durationMinutes*60_000;
      if(start<=now||start>now+366*86400_000)fail('APPOINTMENT_DATE_RANGE');
      if(s.appointments.some((a:Row)=>a.status!=='CANCELLED'&&Date.parse(a.startsAt)<end&&Date.parse(a.endsAt)>start))fail('SLOT_ALREADY_RESERVED',409);
      s.appointments.push({...d,id:newId,endsAt:new Date(end).toISOString(),serviceName:service.name,status:'RESERVED',createdAt:at});break;
    }
    case 'SET_APPOINTMENT': {const a=find(s.appointments,d.appointmentId);if(['CANCELLED','COMPLETED','NO_SHOW'].includes(a.status))fail('APPOINTMENT_ALREADY_CLOSED',409);if(['COMPLETED','NO_SHOW'].includes(d.status)&&Date.parse(a.startsAt)>now)fail('APPOINTMENT_NOT_STARTED');a.status=d.status;a.updatedAt=at;a.confirmation=null;result={entityId:a.id};break;}
    case 'ISSUE_CONFIRMATION': {
      const a=find(s.appointments,d.appointmentId),c=find(s.contacts,a.contactId);
      if(!c.messageConsent)fail('MESSAGE_CONSENT_REQUIRED',403);
      if(!['RESERVED','CONFIRMED'].includes(a.status)||Date.parse(a.startsAt)<=now)fail('APPOINTMENT_NOT_OPEN');
      if(!confirmationToken||!/^[a-zA-Z0-9_-]{43}$/.test(confirmationToken))fail('CONFIRMATION_TOKEN_REQUIRED');
      a.confirmation={tokenHash:practiceHash(confirmationToken),expiresAt:Math.min(now+48*3600_000,Date.parse(a.startsAt)),confirmedAt:null};
      result={entityId:a.id,confirmationToken,expiresAt:a.confirmation.expiresAt};break;
    }
    case 'DRAFT_REMINDER': {
      const a=find(s.appointments,d.appointmentId),c=find(s.contacts,a.contactId);if(!c.messageConsent)fail('MESSAGE_CONSENT_REQUIRED',403);
      if(!['RESERVED','CONFIRMED'].includes(a.status)||Date.parse(a.startsAt)<=now)fail('APPOINTMENT_NOT_OPEN');
      const existing=s.drafts.find((x:Row)=>x.appointmentId===a.id&&x.kind==='REMINDER'&&x.appointmentStartsAt===a.startsAt);
      if(existing){result={entityId:existing.id};break;}
      s.drafts.push({id:newId,appointmentId:a.id,appointmentStartsAt:a.startsAt,kind:'REMINDER',status:'DRAFT',text:`Olá, ${c.name}. Seu horário está reservado para ${dateLabel(a,s)}. Por favor, confirme sua disponibilidade. Se precisar reagendar, fale com a recepção.`,createdAt:at});break;
    }
    case 'ADD_CHARGE': {const a=find(s.appointments,d.appointmentId);if(a.status==='CANCELLED')fail('APPOINTMENT_CANCELLED');if(s.charges.some((c:Row)=>c.appointmentId===a.id))fail('CHARGE_ALREADY_EXISTS',409);s.charges.push({...d,id:newId,currency:'brl',paymentState:'PENDING',reconciliationState:'UNRECONCILED',providerSession:null,createdAt:at});break;}
    case 'ADD_BANK_ENTRY': if(s.bankEntries.some((b:Row)=>b.externalRef===d.externalRef))fail('BANK_ENTRY_EXISTS',409);s.bankEntries.push({...d,id:newId,matchedChargeId:null,recordedBy:actor.uid,createdAt:at});break;
    case 'RECONCILE': {const c=find(s.charges,d.chargeId),b=find(s.bankEntries,d.bankEntryId);if(b.matchedChargeId||c.reconciliationState!=='UNRECONCILED')fail('ALREADY_RECONCILED',409);if(c.amountCents!==b.amountCents)fail('AMOUNT_MISMATCH',409);b.matchedChargeId=c.id;c.reconciliationState='MANUAL_STATEMENT_MATCH';c.bankEntryId=b.id;c.reconciledBy=actor.uid;c.reconciledAt=at;result={entityId:c.id};break;}
    case 'SAVE_KNOWLEDGE': s.knowledge.push({...d,id:newId,state:'APPROVED',approvedBy:actor.uid,approvedAt:at});break;
    case 'REVOKE_KNOWLEDGE': {const k=find(s.knowledge,d.knowledgeId);k.state='REVOKED';k.revokedAt=at;result={entityId:k.id};break;}
    case 'SAVE_WEBSITE': s.website={...d,approvedHash:null,updatedAt:at};break;
    case 'APPROVE_WEBSITE': if(!s.business||!s.website||websiteContentHash(s)!==d.contentHash)fail('WEBSITE_CHANGED',409);s.website.approvedHash=d.contentHash;s.website.approvedAt=at;s.website.approvedBy=actor.uid;break;
    case 'ADD_TASK': s.tasks.push({...d,id:newId,role:actor.role,status:'OPEN',createdAt:at});break;
    case 'COMPLETE_TASK': {const t=find(s.tasks,d.taskId);if(actor.role!=='practice_owner'&&t.role!==actor.role)fail('PRACTICE_PERMISSION_DENIED',403);t.status='DONE';t.completedAt=at;result={entityId:t.id};break;}
  }
  for(const name of ['contacts','appointments','charges','bankEntries','knowledge','tasks','drafts'])if(s[name].length>500)fail('WORKSPACE_CAPACITY_REACHED',409);
  s.revision++;s.updatedAt=at;
  if(Buffer.byteLength(JSON.stringify(s))>500_000)fail('WORKSPACE_CAPACITY_REACHED',409);
  return {state:s,result:{...result,revision:s.revision,action:r.action}};
}

export function practiceSnapshot(s:Row,actor:ProfileActor):Row {
  const owner=actor.role==='practice_owner',reception=owner||actor.role==='practice_reception',finance=owner||actor.role==='practice_finance',editor=owner||actor.role==='practice_editor';
  if(!isPracticeRole(actor.role)||!actor.mfaVerified||!actor.allFacilities)fail('PRACTICE_PERMISSION_DENIED',403);
  return {version:PRACTICE_OPERATIONS_VERSION,revision:s.revision,updatedAt:s.updatedAt??null,business:s.business,
    ...(reception?{contacts:s.contacts,appointments:s.appointments.map(({confirmation,...a}:Row)=>({...a,confirmationState:confirmation?.confirmedAt?'CONFIRMED':confirmation?'LINK_ISSUED':'NOT_ISSUED'})),drafts:s.drafts}:{}),
    ...(finance?{appointmentReferences:s.appointments.map((a:Row)=>({id:a.id,startsAt:a.startsAt,status:a.status})),charges:s.charges,bankEntries:s.bankEntries,totals:{billedCents:s.charges.reduce((n:number,c:Row)=>n+c.amountCents,0),providerConfirmedCents:s.charges.filter((c:Row)=>c.paymentState==='PAID_PROVIDER').reduce((n:number,c:Row)=>n+c.amountCents,0),manuallyMatchedCents:s.charges.filter((c:Row)=>c.reconciliationState==='MANUAL_STATEMENT_MATCH').reduce((n:number,c:Row)=>n+c.amountCents,0),bankApiConnected:false}}:{}),
    knowledge:s.knowledge.filter((k:Row)=>k.state==='APPROVED'),...(editor?{website:s.website,websiteContentHash:s.website?websiteContentHash(s):null}:{}),
    tasks:s.tasks.filter((t:Row)=>owner||t.role===actor.role),externalAiRequired:false,clinicalRecordsSupported:false};
}

export function answerPractice(s:Row,question:string):Row {
  const q=text(question,500).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/diagnostic|prescrev|medicamento|suicid|prontuario|laudo|paciente.*sintoma/.test(q))return {answer:'Este assistente cuida da gestão administrativa. Encaminhe a questão clínica à profissional responsável.',source:'ADMINISTRATIVE_SCOPE',externalCalls:0};
  const active=s.knowledge.filter((k:Row)=>k.state==='APPROVED');
  const tokens=q.match(/[a-z0-9]{4,}/g)??[];
  const ranked=active.map((k:Row)=>({k,score:tokens.filter(t=>k.question.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(t)).length})).filter((x:Row)=>x.score>0).sort((a:Row,b:Row)=>b.score-a.score);
  if(ranked[0])return {answer:ranked[0].k.answer,source:'OWNER_APPROVED_BUSINESS_KNOWLEDGE',knowledgeId:ranked[0].k.id,externalCalls:0};
  if(/horario|funcionamento/.test(q))return {answer:s.business?.hours||'Cadastre os horários em Meu negócio.',source:'BUSINESS_PROFILE',externalCalls:0};
  if(/cancel|reagend/.test(q))return {answer:s.business?.cancellationPolicy||'Cadastre a regra de cancelamento em Meu negócio.',source:'BUSINESS_PROFILE',externalCalls:0};
  if(/valor|preco|servico/.test(q))return {answer:s.business?.services?.map((v:Row)=>`${v.name}: ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v.priceCents/100)}; ${v.durationMinutes} minutos.`).join(' ')||'Cadastre os serviços em Meu negócio.',source:'BUSINESS_PROFILE',externalCalls:0};
  return {answer:'Posso consultar horários, serviços, valores e regras aprovadas do consultório. A titular pode ensinar uma nova resposta em Memória do negócio.',source:'NO_APPROVED_ANSWER',externalCalls:0};
}

export type PracticeCipher = {seal(state:Row,org:Row,orgId:string):Promise<AuroraEncryptedEnvelope>;open(value:AuroraEncryptedEnvelope,org:Row,orgId:string):Promise<Row>};
export function practiceCipher(keyFor:(org:Row)=>EnvelopeKey):PracticeCipher {
  const aad=(orgId:string)=>({orgId,entityType:'practice-operations',schemaVersion:'1',logicalId:'practice-operations-v1'});
  return {seal:(s,o,id)=>encryptEnvelope(JSON.stringify(s),aad(id),keyFor(o)),open:async(e,o,id)=>{const b=await decryptEnvelope(e,aad(id),keyFor(o));try{return JSON.parse(b.toString('utf8'));}finally{b.fill(0);}}};
}
export function createPracticeOperations(store:ProfileStore,cipher:PracticeCipher,clock=Date.now) {
  async function access(tx:ProfileTx,actor:ProfileActor) {
    if(!/^[a-z][a-z0-9-]{1,62}$/.test(actor.orgId)||actor.orgId==='wmgj'||typeof actor.uid!=='string'||!actor.uid||actor.uid.length>128||/[\/\x00-\x1f]/.test(actor.uid)||!isPracticeRole(actor.role)||!actor.mfaVerified||!actor.allFacilities)fail('PRACTICE_PERMISSION_DENIED',403);
    const base=`organizations/${actor.orgId}`,org=await tx.read(base),member=await tx.read(`${base}/members/${actor.uid}`);
    if(!org||org.active!==true||org.profile!=='PERSONALITE'||org.practiceOperations?.enabled!==true||org.environment!=='HOMOLOGATION'||org.practiceOperations.dataMode!=='SYNTHETIC')fail('PRACTICE_OPERATIONS_NOT_ENABLED',403);
    if(member?.active!==true||member.role!==actor.role||member.allFacilities!==true||member.profileState!=='READY'||member.profileVersion!==1)fail('PRACTICE_MEMBERSHIP_REVOKED',403);
    return {base,org};
  }
  async function load(tx:ProfileTx,base:string,org:Row,orgId:string){const row=await tx.read(`${base}/runtimeCheckpoints/practice-operations-v1`);const state=row?await cipher.open(row.envelope,org,orgId):emptyPracticeState();if(state.schemaVersion!==1||!Number.isSafeInteger(state.revision))fail('WORKSPACE_INVALID',503);return {row,state};}
  function paymentGuard(org:Row|undefined,configHash?:string):asserts org is Row {
    if(!org||org.active!==true||org.profile!=='PERSONALITE'||org.environment!=='HOMOLOGATION'||org.practiceOperations?.enabled!==true||org.practiceOperations.dataMode!=='SYNTHETIC'||org.providerWriteEnabled!==true||org.practicePayments?.enabled!==true||org.practicePayments.mode!=='TEST')fail('PAYMENT_TEST_CONNECTION_REQUIRED',412);
    if(configHash&&practiceHash(JSON.stringify(org.practicePayments))!==configHash)fail('PAYMENT_CONFIGURATION_CHANGED',409);
  }
  async function savePayment(tx:ProfileTx,base:string,org:Row,orgId:string,state:Row,auditId:string,audit:Row){
    state.revision++;state.updatedAt=new Date(clock()).toISOString();const envelope=await cipher.seal(state,org,orgId);
    tx.update(`${base}/runtimeCheckpoints/practice-operations-v1`,{envelope,revision:state.revision,updatedAt:state.updatedAt});
    tx.create(`${base}/auditEvents/${auditId}`,{...audit,at:state.updatedAt,revision:state.revision});
  }
  return {
    paymentTarget:(orgId:string)=>store.transaction(async tx=>{if(!/^[a-z][a-z0-9-]{1,62}$/.test(orgId)||orgId==='wmgj')fail('PAYMENT_TEST_CONNECTION_REQUIRED',412);const org=await tx.read(`organizations/${orgId}`);paymentGuard(org);return {org,configHash:practiceHash(JSON.stringify(org.practicePayments))};}),
    checkoutContext:(actor:ProfileActor,chargeId:string)=>store.transaction(async tx=>{
      id(chargeId);const {base,org}=await access(tx,actor);if(!['practice_owner','practice_finance'].includes(actor.role))fail('PRACTICE_PERMISSION_DENIED',403);paymentGuard(org);
      const {state}=await load(tx,base,org,actor.orgId),charge=find(state.charges,chargeId);if(charge.paymentState!=='PENDING'||find(state.appointments,charge.appointmentId).status==='CANCELLED')fail('CHARGE_NOT_PAYABLE',409);
      return {org,amountCents:charge.amountCents,configHash:practiceHash(JSON.stringify(org.practicePayments))};
    }),
    attachCheckout:(actor:ProfileActor,chargeId:string,session:Row,configHash:string)=>store.transaction(async tx=>{
      id(chargeId);const {base,org}=await access(tx,actor);if(!['practice_owner','practice_finance'].includes(actor.role))fail('PRACTICE_PERMISSION_DENIED',403);paymentGuard(org,configHash);
      if(session.mode!=='TEST'||session.accountId!==org.practicePayments.accountId||!/^cs_test_[A-Za-z0-9]+$/.test(session.sessionId))fail('PAYMENT_PROVIDER_MISMATCH',409);
      const {state}=await load(tx,base,org,actor.orgId),c=find(state.charges,chargeId);
      if(c.paymentState!=='PENDING'||find(state.appointments,c.appointmentId).status==='CANCELLED')fail('CHARGE_NOT_PAYABLE',409);
      if(c.providerSession){if(c.providerSession.id!==session.sessionId||c.providerSession.accountId!==session.accountId)fail('CHECKOUT_ALREADY_BOUND',409);return {ok:true,replayed:true};}
      c.providerSession={id:session.sessionId,accountId:session.accountId,mode:'TEST'};
      await savePayment(tx,base,org,actor.orgId,state,`practice-checkout-${practiceHash(session.sessionId)}`,{type:'PRACTICE_TEST_CHECKOUT_BOUND',chargeId,actorUid:actor.uid});return {ok:true,replayed:false};
    }),
    recordPayment:(orgId:string,event:Row,configHash:string)=>store.transaction(async tx=>{
      if(!/^[a-z][a-z0-9-]{1,62}$/.test(orgId)||orgId==='wmgj')fail('PAYMENT_TEST_CONNECTION_REQUIRED',412);
      const base=`organizations/${orgId}`,org=await tx.read(base);paymentGuard(org,configHash);
      if(event.livemode!==false||!/^evt_[A-Za-z0-9]+$/.test(event.id))fail('INVALID_PAYMENT_EVENT');
      if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return {ok:true,ignored:true};
      const op=`practice-payment-${practiceHash(event.id)}`,receipt=await tx.read(`${base}/apiIdempotency/${op}`),fingerprint=practiceHash(JSON.stringify(event));
      if(receipt){if(receipt.fingerprint!==fingerprint)fail('PAYMENT_EVENT_CONFLICT',409);return {ok:true,replayed:true};}
      const s=event.data?.object;if(!s||s.livemode!==false||s.mode!=='payment'||s.currency!=='brl'||s.metadata?.auroraOrgId!==orgId||typeof s.metadata?.auroraChargeId!=='string'||(event.account&&event.account!==org.practicePayments.accountId))fail('PAYMENT_PROVIDER_MISMATCH',409);
      if(s.payment_status!=='paid')return {ok:true,ignored:true};
      const {state}=await load(tx,base,org,orgId),c=find(state.charges,s.metadata.auroraChargeId);
      if(c.amountCents!==s.amount_total||c.providerSession?.id!==s.id||c.providerSession?.accountId!==org.practicePayments.accountId)fail('PAYMENT_PROVIDER_MISMATCH',409);
      c.paymentState='PAID_PROVIDER';c.paidAt??=new Date(clock()).toISOString();
      await savePayment(tx,base,org,orgId,state,op,{type:'PRACTICE_TEST_PAYMENT_CONFIRMED',chargeId:c.id,eventId:event.id});
      tx.create(`${base}/apiIdempotency/${op}`,{fingerprint,eventId:event.id});return {ok:true,replayed:false};
    }),
    read:(actor:ProfileActor):Promise<Row>=>store.transaction(async tx=>{const {base,org}=await access(tx,actor);const {state}=await load(tx,base,org,actor.orgId);return {...practiceSnapshot(state,actor),dataMode:org.practiceOperations.dataMode,connections:{stripe:org.practicePayments?.enabled===true?'CONFIGURED_NOT_HEALTH_CHECKED':'NOT_CONNECTED',bank:'NOT_CONNECTED',email:'NOT_CONNECTED',whatsapp:'NOT_CONNECTED',domain:'NOT_REGISTERED_BY_PLATFORM'}};}),
    answer:(actor:ProfileActor,question:string)=>store.transaction(async tx=>{const {base,org}=await access(tx,actor);const {state}=await load(tx,base,org,actor.orgId);return answerPractice(state,question);}),
    mutate:(actor:ProfileActor,raw:unknown)=>{const r=normalizePracticeRequest(raw);return store.transaction(async tx=>{
      const {base,org}=await access(tx,actor);if(!actions[r.action]?.includes(actor.role))fail('PRACTICE_PERMISSION_DENIED',403);
      const op=practiceHash(`${actor.uid}\n${r.requestId}`),opPath=`${base}/apiIdempotency/practice-${op}`,prior=await tx.read(opPath),fingerprint=practiceHash(JSON.stringify(r));
      if(prior){if(prior.fingerprint!==fingerprint||prior.actorUid!==actor.uid)fail('IDEMPOTENCY_CONFLICT',409);return {...prior.result,replayed:true};}
      const {row,state}=await load(tx,base,org,actor.orgId),token=r.action==='ISSUE_CONFIRMATION'?randomBytes(32).toString('base64url'):undefined;
      const next=reducePractice(state,r,actor,clock(),op.slice(0,32),token),envelope=await cipher.seal(next.state,org,actor.orgId);
      // One-time token is never retained in an idempotency receipt or audit.
      const {confirmationToken,...receipt}=next.result;
      const data={schemaVersion:1,revision:next.state.revision,envelope,updatedAt:next.state.updatedAt};
      if(row)tx.update(`${base}/runtimeCheckpoints/practice-operations-v1`,data);else tx.create(`${base}/runtimeCheckpoints/practice-operations-v1`,data);
      tx.create(opPath,{fingerprint,actorUid:actor.uid,result:receipt});
      tx.create(`${base}/auditEvents/practice-${op}`,{type:'PRACTICE_OPERATION',action:r.action,actorUid:actor.uid,revision:next.state.revision,at:next.state.updatedAt});
      return {...next.result,replayed:false};
    });},
    confirm:(orgId:string,appointmentId:string,token:string)=>store.transaction(async tx=>{
      if(!/^[a-z][a-z0-9-]{1,62}$/.test(orgId)||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('CONFIRMATION_UNAVAILABLE',404);id(appointmentId);
      const base=`organizations/${orgId}`,org=await tx.read(base);if(org?.active!==true||org.profile!=='PERSONALITE'||org.practiceOperations?.enabled!==true||org.environment!=='HOMOLOGATION'||org.practiceOperations.dataMode!=='SYNTHETIC')fail('CONFIRMATION_UNAVAILABLE',404);
      const {row,state}=await load(tx,base,org,orgId),a=state.appointments.find((a:Row)=>a.id===appointmentId),c=a?.confirmation;
      if(!a||!c||!['RESERVED','CONFIRMED'].includes(a.status)||c.expiresAt<=clock()||typeof c.tokenHash!=='string'||!/^[a-f0-9]{64}$/.test(c.tokenHash)||!timingSafeEqual(Buffer.from(c.tokenHash),Buffer.from(practiceHash(token))))fail('CONFIRMATION_UNAVAILABLE',404);
      if(c.confirmedAt)return {ok:true,replayed:true};
      a.status='CONFIRMED';c.confirmedAt=new Date(clock()).toISOString();state.revision++;state.updatedAt=c.confirmedAt;
      const envelope=await cipher.seal(state,org,orgId);tx.update(`${base}/runtimeCheckpoints/practice-operations-v1`,{...row,envelope,revision:state.revision,updatedAt:state.updatedAt});
      tx.create(`${base}/auditEvents/practice-confirm-${practiceHash(token)}`,{type:'APPOINTMENT_CONFIRMED',appointmentId,at:state.updatedAt});return {ok:true,replayed:false};
    })
  };
}
