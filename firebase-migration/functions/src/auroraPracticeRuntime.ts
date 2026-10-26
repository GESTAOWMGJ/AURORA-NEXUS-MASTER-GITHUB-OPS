import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { CSRF_PURPOSES, csrfTokenForSession, validCsrf, verifyAuroraAccess } from './auroraAccess.js';
import { GoogleKmsEnvelopeKey } from './auroraCryptoEnvelope.js';
import { profileStore } from './auroraUserProfileRuntime.js';
import { createPracticeOperations, practiceCipher, PracticeError } from './auroraPracticeOperations.js';
import { practiceConfirmationPage, practiceWebsite } from './auroraPracticeWorkspaceView.js';
import { createPracticeCheckout, practicePaymentConfig, practiceSecret, verifyPracticePaymentEvent } from './auroraPracticePayments.js';

const emails = defineSecret('AURORA_NEXUS_ALLOWED_EMAILS');
const csrf = defineSecret('AURORA_NEXUS_CSRF_HMAC_KEY');
const origins = new Set(['https://auroranexus.com.br', 'https://wmgj-hml-jfn-20260927.web.app']);
export const practiceEngine = createPracticeOperations(profileStore, practiceCipher(org => {
  if (org.crypto?.state !== 'HML_READY' || org.crypto?.algorithm !== 'AES-256-GCM'
    || org.crypto?.envelopeVersion !== 1 || typeof org.crypto?.keyResource !== 'string') {
    throw new PracticeError('WORKSPACE_CRYPTO_NOT_READY', 503);
  }
  return new GoogleKmsEnvelopeKey(org.crypto.keyResource);
}));

export function practiceMutationContext(req: {get(name:string):string|undefined}): boolean {
  return origins.has(String(req.get('origin'))) && (!req.get('sec-fetch-site') || req.get('sec-fetch-site') === 'same-origin')
    && String(req.get('content-type')).split(';',1)[0]?.trim().toLowerCase() === 'application/json';
}
export const auroraNexusPractice = onRequest({cors:false, timeoutSeconds:60, maxInstances:4, secrets:[emails,csrf]}, async(req,res)=>{
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');res.set('X-Frame-Options','DENY');
  try {
    const webhook=req.path.match(/^\/api\/practice-payments\/([a-z][a-z0-9-]{1,62})$/);
    if(webhook&&req.method==='POST'){
      const orgId=webhook[1]!,target=await practiceEngine.paymentTarget(orgId),config=practicePaymentConfig(target.org,orgId);
      const event=verifyPracticePaymentEvent(req.rawBody,String(req.get('stripe-signature')??''),await practiceSecret(config.webhookSecretVersion));
      res.json(await practiceEngine.recordPayment(orgId,event,target.configHash));return;
    }
    // A GET never consumes the confirmation. The capability lives in the URL fragment,
    // is removed before interaction, and is posted only after the visitor presses Confirmar.
    if(req.path === '/practice-confirm' && req.method === 'GET') {
      res.set('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
      res.type('html').send(practiceConfirmationPage());return;
    }
    if(req.path === '/api/practice-confirm' && req.method === 'POST') {
      if(!practiceMutationContext(req))throw new PracticeError('REQUEST_CONTEXT_REJECTED',403);
      const b=req.body;
      if(!b||typeof b!=='object'||Object.keys(b).sort().join(',')!=='appointmentId,orgId,token'
        ||typeof b.orgId!=='string'||typeof b.appointmentId!=='string'||typeof b.token!=='string')throw new PracticeError('CONFIRMATION_UNAVAILABLE',404);
      res.json(await practiceEngine.confirm(b.orgId,b.appointmentId,b.token));return;
    }
    if(req.path !== '/api/practice')throw new PracticeError('NOT_FOUND',404);
    const actor=await verifyAuroraAccess(req.get('cookie'),emails.value());
    if(!actor)throw new PracticeError('AUTH_REQUIRED',401);
    if(req.method==='GET') {
      const token=csrfTokenForSession(req.get('cookie'),csrf.value(),CSRF_PURPOSES.practice);
      if(!token)throw new PracticeError('CSRF_NOT_READY',503);
      res.json({ok:true,...await practiceEngine.read(actor),csrf:token,orgId:actor.orgId});return;
    }
    if(req.method!=='POST'){res.set('Allow','GET, POST');throw new PracticeError('METHOD_NOT_ALLOWED',405);}
    if(!practiceMutationContext(req)||!validCsrf(req.get('cookie'),req.get('x-aurora-csrf'),csrf.value(),CSRF_PURPOSES.practice))throw new PracticeError('CSRF_REJECTED',403);
    if(Buffer.byteLength(JSON.stringify(req.body??{}))>24_000)throw new PracticeError('REQUEST_TOO_LARGE',413);
    if(req.body?.action==='CHECKOUT_TEST'&&Object.keys(req.body).sort().join(',')==='action,chargeId'&&typeof req.body.chargeId==='string'){
      const chargeId=req.body.chargeId,context=await practiceEngine.checkoutContext(actor,chargeId),config=practicePaymentConfig(context.org,actor.orgId);
      const session=await createPracticeCheckout({orgId:actor.orgId,chargeId,amountCents:context.amountCents,config},await practiceSecret(config.apiSecretVersion));
      await practiceEngine.attachCheckout(actor,chargeId,session,context.configHash);
      res.json({ok:true,url:session.url,mode:'TEST'});return;
    }
    if(req.body?.action==='ASK'&&Object.keys(req.body).sort().join(',')==='action,question') {
      res.json({ok:true,...await practiceEngine.answer(actor,req.body.question)});return;
    }
    if(req.body?.action==='EXPORT_WEBSITE'&&Object.keys(req.body).join(',')==='action') {
      const state=await practiceEngine.read(actor);
      if(!state.website||state.website.approvedHash!==state.websiteContentHash)throw new PracticeError('WEBSITE_APPROVAL_REQUIRED',403);
      res.json({ok:true,html:practiceWebsite(state),published:false});return;
    }
    res.json({ok:true,...await practiceEngine.mutate(actor,req.body)});
  } catch(error) {
    const known=error instanceof PracticeError;
    res.status(known?error.status:503).json({ok:false,code:known?error.code:'PRACTICE_UNAVAILABLE'});
  }
});
