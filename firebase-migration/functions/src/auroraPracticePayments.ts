import { createHmac, timingSafeEqual } from 'node:crypto';
import { PracticeError, practiceHash } from './auroraPracticeOperations.js';
import { GoogleMetadataAccessTokenProvider } from './auroraCryptoEnvelope.js';

export type PracticePaymentConfig={accountId:string;apiSecretVersion:string;webhookSecretVersion:string};
export function practicePaymentConfig(org:Record<string,any>,orgId:string):PracticePaymentConfig {
 const c=org.practicePayments;
 if(org.environment!=='HOMOLOGATION'||org.practiceOperations?.dataMode!=='SYNTHETIC'||org.providerWriteEnabled!==true||c?.enabled!==true||c.mode!=='TEST'||!/^acct_[A-Za-z0-9]+$/.test(c.accountId))throw new PracticeError('PAYMENT_TEST_CONNECTION_REQUIRED',412);
 const prefix=new RegExp('^projects/[a-z0-9-]+/secrets/aurora-practice-'+orgId+'-stripe-test-(api|webhook)/versions/[1-9][0-9]*$');
 if(typeof c.apiSecretVersion!=='string'||typeof c.webhookSecretVersion!=='string'||!prefix.test(c.apiSecretVersion)||!prefix.test(c.webhookSecretVersion)||!c.apiSecretVersion.includes('-api/versions/')||!c.webhookSecretVersion.includes('-webhook/versions/'))throw new PracticeError('PAYMENT_SECRET_BINDING_INVALID',503);
 return {accountId:c.accountId,apiSecretVersion:c.apiSecretVersion,webhookSecretVersion:c.webhookSecretVersion};
}
const tokens=new GoogleMetadataAccessTokenProvider();
export async function practiceSecret(version:string):Promise<string>{
 // Only a validated, server-owned version from practicePaymentConfig reaches here.
 const r=await fetch('https://secretmanager.googleapis.com/v1/'+version+':access',{headers:{Authorization:'Bearer '+await tokens.getAccessToken()},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new PracticeError('PAYMENT_SECRET_UNAVAILABLE',503);
 const d=await r.json() as any;const value=Buffer.from(d.payload?.data??'','base64').toString('utf8').trim();
 if(!value||value.length>500)throw new PracticeError('PAYMENT_SECRET_UNAVAILABLE',503);return value;
}
export async function createPracticeCheckout(input:{orgId:string;chargeId:string;amountCents:number;config:PracticePaymentConfig},key:string,fetcher:typeof fetch=fetch){
 if(!key.startsWith('sk_test_')&&!key.startsWith('rk_test_'))throw new PracticeError('LIVE_PAYMENTS_DISABLED',403);
 if(!Number.isSafeInteger(input.amountCents)||input.amountCents<1||input.amountCents>10_000_000)throw new PracticeError('INVALID_AMOUNT');
 const auth={Authorization:'Bearer '+key};
 const account=await fetcher('https://api.stripe.com/v1/account',{headers:auth,signal:AbortSignal.timeout(10000)});
 if(!account.ok||(await account.json() as any).id!==input.config.accountId)throw new PracticeError('PAYMENT_ACCOUNT_MISMATCH',403);
 const body=new URLSearchParams({mode:'payment','line_items[0][quantity]':'1','line_items[0][price_data][currency]':'brl','line_items[0][price_data][unit_amount]':String(input.amountCents),'line_items[0][price_data][product_data][name]':'Cobrança de teste','metadata[auroraOrgId]':input.orgId,'metadata[auroraChargeId]':input.chargeId,success_url:'https://auroranexus.com.br/portal',cancel_url:'https://auroranexus.com.br/portal'});
 const idempotency=practiceHash(JSON.stringify([input.orgId,input.chargeId,input.amountCents,input.config.accountId,'TEST']));
 const r=await fetcher('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{...auth,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'aurora-'+idempotency},body,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new PracticeError('PAYMENT_PROVIDER_UNAVAILABLE',503);
 const s=await r.json() as any;
 if(s.livemode!==false||s.mode!=='payment'||s.amount_total!==input.amountCents||s.currency!=='brl'||!/^cs_test_[A-Za-z0-9]+$/.test(s.id)||s.metadata?.auroraOrgId!==input.orgId||s.metadata?.auroraChargeId!==input.chargeId)throw new PracticeError('PAYMENT_PROVIDER_MISMATCH',503);
 let url:URL;try{url=new URL(s.url);}catch{throw new PracticeError('PAYMENT_URL_INVALID',503);}
 if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password)throw new PracticeError('PAYMENT_URL_INVALID',503);
 return {sessionId:s.id,url:url.href,accountId:input.config.accountId,mode:'TEST' as const};
}
export function verifyPracticePaymentEvent(raw:Buffer,signature:string,secret:string,now=Date.now()):Record<string,any>{
 if(!secret.startsWith('whsec_')||raw.length>262144||signature.length>2000)throw new PracticeError('INVALID_PAYMENT_SIGNATURE',400);
 const fields=signature.split(',').map(v=>v.split('='));const stamps=fields.filter(v=>v[0]==='t');
 if(stamps.length!==1||!/^\d{10,12}$/.test(stamps[0]?.[1]??''))throw new PracticeError('INVALID_PAYMENT_SIGNATURE',400);
 const t=Number(stamps[0]![1]);if(Math.abs(now/1000-t)>300)throw new PracticeError('PAYMENT_SIGNATURE_EXPIRED',400);
 const expected=createHmac('sha256',secret).update(String(t)+'.').update(raw).digest();
 if(!fields.some(([k,v])=>k==='v1'&&typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)&&timingSafeEqual(expected,Buffer.from(v,'hex'))))throw new PracticeError('INVALID_PAYMENT_SIGNATURE',400);
 let event:any;try{event=JSON.parse(raw.toString('utf8'));}catch{throw new PracticeError('INVALID_PAYMENT_EVENT');}
 if(!event||!/^evt_[A-Za-z0-9]+$/.test(event.id)||event.livemode!==false||typeof event.type!=='string')throw new PracticeError('INVALID_PAYMENT_EVENT');
 return event;
}
