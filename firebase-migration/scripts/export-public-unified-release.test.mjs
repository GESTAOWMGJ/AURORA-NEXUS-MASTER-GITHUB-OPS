import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {collectPublicRelease} from './export-public-unified-release.mjs';

const sourceSha='a'.repeat(40),releaseRunId='12345';
const {publicKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({type:'spki',format:'pem'}).toString();
function options(overrides={}) {
  const certificate={schemaVersion:2,sourceSha,releaseRunId};
  return {sourceSha,releaseRunId,publicKey:pem,
    readEnvelope:async()=>({certificate,signature:'PUBLIC_TEST_SIGNATURE'}),
    verifyEnvelope:()=>({status:'CANDIDATE_UNVERIFIED',certificate,certificateSha256:'b'.repeat(64)}),
    ...overrides};
}

test('exports only the verified public envelope and SPKI trust',async()=>{
  const result=await collectPublicRelease(options());
  assert.deepEqual(Object.keys(result.envelope).sort(),['certificate','signature']);
  assert.deepEqual(Object.keys(result.trust).sort(),['publicKeySha256','publicKeySpkiPem']);
  assert.match(result.trust.publicKeySha256,/^[a-f0-9]{64}$/);
  assert.equal(result.sourceSha,sourceSha);
});

test('passes exact source to the existing protocol verifier',async()=>{
  let observed;
  await collectPublicRelease(options({verifyEnvelope:(envelope,key,config)=>{
    observed=config;return {status:'CANDIDATE_UNVERIFIED',certificate:envelope.certificate,
      certificateSha256:'b'.repeat(64)};
  }}));
  assert.deepEqual(observed,{expectedSourceSha:sourceSha});
});

for(const [name,certificate] of [
  ['other source',{schemaVersion:2,sourceSha:'c'.repeat(40),releaseRunId}],
  ['other deployment run',{schemaVersion:2,sourceSha,releaseRunId:'54321'}],
  ['partial V1',{schemaVersion:1,sourceSha,releaseRunId}],
]) test('rejects '+name+' before public export',async()=>{
  await assert.rejects(()=>collectPublicRelease(options({
    verifyEnvelope:()=>({status:'CANDIDATE_UNVERIFIED',certificate})})),/EXACT_ACTIVE_RELEASE_READ_REQUIRED/);
});

test('rejected cryptographic verification is never exported',async()=>{
  await assert.rejects(()=>collectPublicRelease(options({
    verifyEnvelope:()=>({status:'INVALID_ACTIVE_PIN'})})),/EXACT_ACTIVE_RELEASE_READ_REQUIRED/);
});

test('unexpected SDK/public fields are not serialized',async()=>{
  await assert.rejects(()=>collectPublicRelease(options({
    readEnvelope:async()=>({certificate:{},signature:'public',unexpected:'synthetic'})})),
  /PUBLIC_ENVELOPE_FIELDS_REQUIRED/);
});
