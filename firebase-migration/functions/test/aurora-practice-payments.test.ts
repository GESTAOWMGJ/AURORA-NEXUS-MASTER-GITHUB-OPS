import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { createPracticeCheckout, practicePaymentConfig, verifyPracticePaymentEvent } from '../src/auroraPracticePayments.js';

const orgId='synthetic-practice',config={accountId:'acct_synthetic',apiSecretVersion:'projects/synthetic-project/secrets/aurora-practice-synthetic-practice-stripe-test-api/versions/1',webhookSecretVersion:'projects/synthetic-project/secrets/aurora-practice-synthetic-practice-stripe-test-webhook/versions/1'};
const org={environment:'HOMOLOGATION',practiceOperations:{dataMode:'SYNTHETIC'},providerWriteEnabled:true,practicePayments:{...config,mode:'TEST',enabled:true}};
test('payment settings cannot select another tenant secret, latest version, live mode or another provider account',()=>{
 assert.deepEqual(practicePaymentConfig(org,orgId),config);
 for(const patch of [{mode:'LIVE'},{apiSecretVersion:config.apiSecretVersion.replace(orgId,'other-organization')},{webhookSecretVersion:config.apiSecretVersion},{apiSecretVersion:config.apiSecretVersion.replace('/1','/latest')}])assert.throws(()=>practicePaymentConfig({...org,practicePayments:{...org.practicePayments,...patch}},orgId));
 assert.throws(()=>practicePaymentConfig({...org,providerWriteEnabled:false},orgId));
});
test('checkout sends no contact or clinical content, binds server amount and stable idempotency',async()=>{
 const calls:any[]=[];const input={orgId,chargeId:'synthetic-charge',amountCents:20000,config};
 const session={id:'cs_test_synthetic',url:'https://checkout.stripe.com/c/pay/synthetic',livemode:false,mode:'payment',amount_total:20000,currency:'brl',metadata:{auroraOrgId:orgId,auroraChargeId:input.chargeId}};
 const fetcher=(async(url:any,init:any)=>{calls.push({url,init});return new Response(JSON.stringify(String(url).endsWith('/account')?{id:config.accountId}:session),{status:200});}) as typeof fetch;
 const key='sk_test_'+'synthetic-fixture';assert.equal((await createPracticeCheckout(input,key,fetcher)).sessionId,session.id);await createPracticeCheckout(input,key,fetcher);
 assert.equal(calls[1].init.headers['Idempotency-Key'],calls[3].init.headers['Idempotency-Key']);
 const body=calls[1].init.body as URLSearchParams;assert.equal(body.get('line_items[0][price_data][unit_amount]'),'20000');assert.equal(body.get('customer_email'),null);assert.equal(body.get('metadata[auroraOrgId]'),orgId);
 await assert.rejects(createPracticeCheckout(input,'sk_live_'+'synthetic-fixture',fetcher));
 session.url='https://attacker.example.invalid/';await assert.rejects(createPracticeCheckout(input,key,fetcher),/PAYMENT_URL_INVALID/);
 session.url='https://checkout.stripe.com/c/pay/synthetic';session.amount_total=1;await assert.rejects(createPracticeCheckout(input,key,fetcher),/PAYMENT_PROVIDER_MISMATCH/);
});
test('webhook verifies raw bytes, timestamp tolerance, multiple rotation signatures, test mode and shape',()=>{
 const secret='whsec_'+'synthetic-fixture',now=Date.parse('2026-10-26T10:00:00Z'),t=now/1000,raw=Buffer.from(JSON.stringify({id:'evt_synthetic',type:'checkout.session.completed',livemode:false}));
 const signature=createHmac('sha256',secret).update(t+'.').update(raw).digest('hex');
 const header='t='+t+',v1='+'0'.repeat(64)+',v1='+signature;
 assert.equal(verifyPracticePaymentEvent(raw,header,secret,now).id,'evt_synthetic');
 assert.throws(()=>verifyPracticePaymentEvent(Buffer.from(raw.toString()+' '),header,secret,now),/SIGNATURE/);
 assert.throws(()=>verifyPracticePaymentEvent(raw,header,secret,now+301000),/EXPIRED/);
 assert.throws(()=>verifyPracticePaymentEvent(raw,header+',t='+t,secret,now),/SIGNATURE/);
 assert.throws(()=>verifyPracticePaymentEvent(raw,header,'whsec_wrong',now),/SIGNATURE/);
 const live=Buffer.from(JSON.stringify({id:'evt_synthetic',type:'x',livemode:true})),sig=createHmac('sha256',secret).update(t+'.').update(live).digest('hex');assert.throws(()=>verifyPracticePaymentEvent(live,'t='+t+',v1='+sig,secret,now),/INVALID_PAYMENT_EVENT/);
});
