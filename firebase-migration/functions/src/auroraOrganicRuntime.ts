import {randomBytes} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {defineSecret} from 'firebase-functions/params';
import {onRequest} from 'firebase-functions/v2/https';
import {can,CSRF_PURPOSES,csrfTokenForSession,validCsrf,verifyAuroraAccess} from './auroraAccess.js';
import {auroraDb} from './firebase.js';
import {digest,fail} from './auroraOrganicCore.js';
import {STATE_ID,parseCommand,transition,publicState,type Actor,type State} from './auroraOrganicService.js';
import {organicPage} from './auroraOrganicView.js';
const ALLOWED_EMAILS=defineSecret('AURORA_NEXUS_ALLOWED_EMAILS');
const CSRF_KEY=defineSecret('AURORA_NEXUS_CSRF_HMAC_KEY');
const EXPECTED_ERRORS=new Set(['INVALID_COMMAND','PERMISSION_DENIED','ORGANIZATION_DISABLED','ORGANIC_SECTORS_NOT_CONFIGURED','MEMORY_SCOPE_OR_SCHEMA_INVALID','REVISION_CONFLICT','ORGANIC_DISABLED','MFA_AND_REVIEW_PERMISSION_REQUIRED','SECTOR_NOT_AUTHORIZED','VERIFIED_RESOLVED_ACTION_REQUIRED','RUN_NOT_FOUND','OUTCOME_CONFLICT','PROPOSAL_NOT_FOUND','MEMORY_LIMIT_REVIEW_REQUIRED','PROPOSAL_REVISION_CONFLICT','CURRENT_EVIDENCE_REQUIRED','CURRENT_APPROVAL_REQUIRED','RUN_LIMIT_REVIEW_REQUIRED','CHECKPOINT_RESERVED_ID_CONFLICT','IDEMPOTENCY_CONFLICT','CONFLICTING_OUTCOME_REQUIRES_REVIEW','PRIOR_DEFINITION_INTEGRITY_MISMATCH']);
export const auroraNexusOrganic=onRequest({cors:false,secrets:[ALLOWED_EMAILS,CSRF_KEY],timeoutSeconds:120,maxInstances:3},async(req,res)=>{
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.set('X-Frame-Options','DENY');res.set('Referrer-Policy','no-referrer');res.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  const nonce=randomBytes(24).toString('base64url');
  res.set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  if(!['GET','POST'].includes(req.method)){res.set('Allow','GET, POST');res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});return;}
  try {
    const member=await verifyAuroraAccess(req.get('cookie'),ALLOWED_EMAILS.value());
    if(!member){res.status(401).json({ok:false,code:'AUTH_REQUIRED'});return;}
    if(!member.allFacilities||!can(member,'organic.write',['platform_admin','org_admin','director','auditor'])){res.status(403).json({ok:false,code:'PERMISSION_DENIED'});return;}
    if(req.method==='GET'&&req.query.format!=='json'){
      const token=csrfTokenForSession(req.get('cookie'),CSRF_KEY.value(),CSRF_PURPOSES.organic);
      if(!token){res.status(503).json({ok:false,code:'CSRF_NOT_CONFIGURED'});return;}
      res.status(200).type('html').send(organicPage(token,nonce));return;
    }
    let command:ReturnType<typeof parseCommand>|null=null,idempotencyKey='';
    if(req.method==='POST'){
      if(req.get('sec-fetch-site')&&req.get('sec-fetch-site')!=='same-origin'){res.status(403).json({ok:false,code:'CROSS_SITE_REJECTED'});return;}
      if(String(req.get('content-type')??'').split(';')[0]?.trim().toLowerCase()!=='application/json'){res.status(415).json({ok:false,code:'UNSUPPORTED_MEDIA_TYPE'});return;}
      if((req.rawBody?.byteLength??Buffer.byteLength(JSON.stringify(req.body??{})))>8192){res.status(413).json({ok:false,code:'BODY_TOO_LARGE'});return;}
      if(!validCsrf(req.get('cookie'),req.get('x-aurora-csrf'),CSRF_KEY.value(),CSRF_PURPOSES.organic)){res.status(403).json({ok:false,code:'CSRF_REJECTED'});return;}
      idempotencyKey=req.get('idempotency-key')??'';
      if(!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)){res.status(400).json({ok:false,code:'INVALID_IDEMPOTENCY_KEY'});return;}
      command=parseCommand(req.body);
    }
    const orgPath=`organizations/${member.orgId}`,stateRef=auroraDb.doc(`${orgPath}/runtimeCheckpoints/${STATE_ID}`);
    const cmd=command,commandHash=cmd?digest(cmd):null;
    const idemId=digest([member.orgId,'organic',member.uid,idempotencyKey]);
    const response=await auroraDb.runTransaction(async tx=>{
      // Cache reads within this transaction only. Every external dependency is read before writes.
      const cache=new Map<string,Record<string,unknown>|null>();
      const read=async(path:string)=>{if(cache.has(path))return cache.get(path)!;const doc=await tx.get(auroraDb.doc(path));const data=doc.exists?doc.data()??{}:null;cache.set(path,data);return data;};
      const org=await read(orgPath),membership=await read(`${orgPath}/members/${member.uid}`),record=await read(stateRef.path);
      if(!org||membership?.active!==true||membership.allFacilities!==true) fail('PERMISSION_DENIED');
      const actor:Actor={...member,role:String(membership.role??''),permissions:Array.isArray(membership.permissions)?membership.permissions.filter((p):p is string=>typeof p==='string'):[],allFacilities:membership.allFacilities===true};
      if(record&&(record.orgId!==member.orgId||!Object.hasOwn(record,'organic'))) fail('CHECKPOINT_RESERVED_ID_CONFLICT');
      const original=(record?.organic as State|null|undefined)??null;
      const idemRef=auroraDb.doc(`${orgPath}/apiIdempotency/${idemId}`),idem=cmd?await read(idemRef.path):null;
      if(idem&&(idem.commandHash!==commandHash||idem.actorUid!==member.uid)) fail('IDEMPOTENCY_CONFLICT');
      const computed=await transition(original,idem?null:cmd,actor,org,read,idemId);
      if(cmd&&!idem){
        tx.set(stateRef,{orgId:member.orgId,organic:computed.state,sanitized:true,sensitivity:'INTERNAL',updatedAt:FieldValue.serverTimestamp()},{merge:true});
        tx.create(idemRef,{commandHash,actorUid:member.uid,result:computed.result,createdAt:FieldValue.serverTimestamp()});
        tx.create(auroraDb.doc(`${orgPath}/auditEvents/${digest(['organic-audit',idemId])}`),{orgId:member.orgId,type:`ORGANIC_${cmd.type}`,action:`ORGANIC_${cmd.type}`,actorUid:member.uid,actorRole:actor.role,commandHash,stateHash:digest(computed.state),stateVersion:computed.state.version,occurredAt:FieldValue.serverTimestamp(),sanitized:true,sensitivity:'INTERNAL'});
      }
      return {ok:true,environment:'HOMOLOGATION',mode:'SHADOW',enabled:org.organicEnabled===true,sectors:org.organicSectors,state:publicState(computed.state),result:idem?idem.result:computed.result,duplicate:Boolean(idem)};
    });
    res.status(req.method==='POST'&&!response.duplicate?201:200).json(response);
  } catch(error){
    const raw=error instanceof Error?error.message:'ORGANIC_FAILED',code=EXPECTED_ERRORS.has(raw)?raw:'ORGANIC_FAILED';
    const status=code==='INVALID_COMMAND'?400:['PERMISSION_DENIED','MFA_AND_REVIEW_PERMISSION_REQUIRED'].includes(code)?403:code==='ORGANIC_FAILED'?500:409;
    res.status(status).json({ok:false,code});
  }
});
