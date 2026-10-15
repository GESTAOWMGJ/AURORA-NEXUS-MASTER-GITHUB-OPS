import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPublicFunding, collapseInstrumentSnapshot} from '../lib/public-funding.mjs';
const record = overrides => ({orgId:'demo-a',nature:'CASH',stage:'ANNOUNCED',amountCents:10000,creditDate:null,dueDate:null,sourceRef:'synthetic-source',evidenceReviewed:false,beneficiaryMatched:false,...overrides});
const row = overrides => ({orgId:'demo-a',snapshotId:'snapshot-1',grantorId:'demo-grantor',beneficiaryCnpj:'00000000000000',instrumentId:'demo-instrument',year:'2026',globalCents:10000,reportedReleasedCents:5000,sourceRef:'synthetic-a',author:'A',...overrides});
test('announcement is not receipt',()=>assert.equal(assessPublicFunding(record(), 'demo-a').confirmedCashCents,null));
test('tax credits never become cash',()=>assert.equal(assessPublicFunding(record({nature:'FINANCIAL_CREDIT'}),'demo-a').classification,'NON_CASH_BENEFIT'));
test('donated property never becomes cash',()=>assert.equal(assessPublicFunding(record({nature:'IN_KIND'}),'demo-a').confirmedCashCents,null));
test('payer payment record is not bank confirmation',()=>assert.equal(assessPublicFunding(record({stage:'PAYMENT_RECORDED',evidenceReviewed:true}),'demo-a').confirmedCashCents,null));
test('reviewed bank evidence permits a dated receipt conclusion, not a payment',()=>{
 const got=assessPublicFunding(record({stage:'BANK_CREDIT',creditDate:'2026-09-03',dueDate:'2026-09-01',beneficiaryMatched:true,evidenceReviewed:true}),'demo-a');
 assert.equal(got.confirmedCashCents,10000);assert.equal(got.daysAfterDue,2);assert.equal(got.paymentAuthorized,false);
});
test('no due date means no timeliness conclusion',()=>assert.equal(assessPublicFunding(record({stage:'BANK_CREDIT',creditDate:'2026-09-03',beneficiaryMatched:true,evidenceReviewed:true}),'demo-a').timeliness,'NOT_ASSESSABLE'));
test('reject another institution',()=>assert.throws(()=>assessPublicFunding(record(),'demo-b'),/ORG_MISMATCH/));
test('reject impossible dates and fractional cents',()=>{
 assert.throws(()=>assessPublicFunding(record({creditDate:'2026-02-30'}),'demo-a'),/INVALID_DATE/);
 assert.throws(()=>assessPublicFunding(record({amountCents:0.5}),'demo-a'),/INVALID_CENTS/);
});
test('null never becomes zero',()=>assert.equal(assessPublicFunding(record({amountCents:null}),'demo-a').confirmedCashCents,null));
test('collapse authors rather than multiplying instrument',()=>{const got=collapseInstrumentSnapshot([row(),row({author:'B',sourceRef:'synthetic-b'})]);assert.equal(got.length,1);assert.equal(got[0].reportedReleasedCents,5000);assert.equal(got[0].inputRows,2);});
test('conflicting source stays unresolved',()=>{const got=collapseInstrumentSnapshot([row(),row({reportedReleasedCents:5100})])[0];assert.equal(got.reportedReleasedCents,null);assert.ok(got.flags.includes('CONFLICTING_SOURCE_VALUES'));});
test('reported release exceeding stated total triggers review',()=>assert.ok(collapseInstrumentSnapshot([row({reportedReleasedCents:20000})])[0].flags.includes('RELEASED_EXCEEDS_STATED_GLOBAL')));
test('do not collapse separate snapshots or grantors',()=>assert.equal(collapseInstrumentSnapshot([row(),row({snapshotId:'snapshot-2'}),row({grantorId:'grantor-2'})]).length,3));
test('zero is retained without becoming an actual receipt',()=>{const got=collapseInstrumentSnapshot([row({reportedReleasedCents:0})])[0];assert.equal(got.reportedReleasedCents,0);assert.equal(got.confirmedCashCents,null);});
