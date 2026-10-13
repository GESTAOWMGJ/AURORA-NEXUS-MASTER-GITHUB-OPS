import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ACTIVE_RELEASE_ORIGIN,ACTIVE_RELEASE_SOURCE,activeReleaseSigningBytes,type ActiveReleaseCertificate} from '../src/auroraActiveRelease.js';
import {ACTIVE_RELEASE_READ_PATH,createActiveReleaseReadHandler} from '../src/auroraActiveReleaseRead.js';
import {credentialAllowsScope,issueIntegrationCredential,parseIntegrationApiKey,tokenHashMatches} from '../src/auroraIntegrationCredential.js';

const now=Date.parse('2026-10-13T12:00:00.000Z'),sourceSha='a'.repeat(40),nonce='b'.repeat(64);
const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
function fixture(schemaVersion:1|2=2){
  const component={sourceSha,version:'1.1.0-test',manifestSha256:'c'.repeat(64)};
  const certificate:ActiveReleaseCertificate={schemaVersion,sourceSha,productVersion:'1.1.0-test',canonicalOrigin:ACTIVE_RELEASE_ORIGIN,
    ciRunId:'12',releaseRunId:'13',publishedAtUtc:'2026-10-13T11:00:00.000Z',status:'ACTIVE',
    checks:{ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true},
    components:{server:{...component},web:{...component},satellite:{...component},
      ...(schemaVersion===2?{iaMaster:{...component},windowsIntegration:{...component}}:{})}};
  const envelope:any={certificate,signature:sign(null,activeReleaseSigningBytes(certificate),keys.privateKey).toString('base64url')};
  const certificateSha256=createHash('sha256').update(activeReleaseSigningBytes(certificate)).digest('hex');
  const issued=issueIntegrationCredential(['integration.read'],1,new Date(now));
  const credential:any={active:true,scopes:issued.scopes,tokenHash:issued.tokenHash,expiresAt:{toDate:()=>issued.expiresAt}};
  const runtime:any={verification:{status:'VERIFIED_ACTIVE_PIN',certificateSha256},
    runtimeBuild:{sourceSha,manifestSha256:component.manifestSha256,fileIntegrityVerified:true},
    runtimeBuildWeb:{sourceSha,manifestSha256:component.manifestSha256,fileIntegrityVerified:true},
    localServer:{fileIntegrityVerified:true},localWeb:{fileIntegrityVerified:true}};
  let authCalls=0,readCalls=0,authorityCalls=0,issuerActive=true,orgActive=true;
  const deps={publicKey:()=>publicKey,now:()=>now,
    authorize:async(header:unknown)=>{authCalls++;const parsed=typeof header==='string'&&header.startsWith('Bearer ')?parseIntegrationApiKey(header.slice(7)):null;
      return parsed&&credentialAllowsScope(credential,'integration.read',new Date(now))&&tokenHashMatches(parsed.apiKey,credential.tokenHash)
        ?{orgId:'wmgj',keyId:issued.keyId,name:'synthetic'}:null;},
    authorityActive:async()=>{authorityCalls++;return issuerActive&&orgActive;},
    readFixedProtectedEnvelope:async()=>{readCalls++;return envelope;},readRuntime:async()=>runtime};
  const headers:Record<string,string>={'authorization':'Bearer '+issued.apiKey,'x-aurora-release-nonce':nonce};
  const request:any={method:'GET',path:ACTIVE_RELEASE_READ_PATH,query:{},get:(name:string)=>headers[name.toLowerCase()]};
  const response:any={headers:{},code:null,body:null,set(name:string,value:string){this.headers[name]=value;return this;},
    status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;}};
  return {deps,headers,request,response,envelope,certificate,credential,runtime,
    calls:()=>({authCalls,readCalls,authorityCalls}),disableIssuer:()=>{issuerActive=false;},disableOrg:()=>{orgActive=false;}};
}
test('private reader returns a closed current-pointer response with exact runtime, nonce and tenant',async()=>{
  const f=fixture();await createActiveReleaseReadHandler(f.deps)(f.request,f.response);
  assert.equal(f.response.code,200);assert.equal(f.calls().authCalls,2);assert.equal(f.calls().authorityCalls,2);
  assert.deepEqual(Object.keys(f.response.body).sort(),['schemaVersion','source','canonicalOrigin','orgId','requestNonce','observedAtUtc',
    'certificateSha256','envelope','runtime','componentCoverage','nativeMacInstallation','deviceInstallationVerified'].sort());
  assert.equal(f.response.body.source,ACTIVE_RELEASE_SOURCE);assert.equal(f.response.body.orgId,'wmgj');assert.equal(f.response.body.requestNonce,nonce);
  assert.equal(f.response.body.componentCoverage.complete,true);assert.equal(f.response.body.nativeMacInstallation,'UNVERIFIED');
  assert.equal(f.response.body.deviceInstallationVerified,false);assert.equal('currentPointer' in f.response.body,false);
  assert.match(f.response.headers['Cache-Control'],/private.*no-store/);assert.equal(f.response.headers.Vary,'Authorization');
  assert.equal(JSON.stringify(f.response.body).includes('synthetic'),false);assert.equal(JSON.stringify(f.response.body).includes('anx_'),false);
});
test('legitimate v1 protected pointer remains readable as partial, never full convergence',async()=>{
  const f=fixture(1);await createActiveReleaseReadHandler(f.deps)(f.request,f.response);
  assert.equal(f.response.code,200);assert.equal(f.response.body.componentCoverage.status,'PARTIAL');assert.equal(f.response.body.componentCoverage.complete,false);
  assert.deepEqual(f.response.body.componentCoverage.missingComponents,['iaMaster','windowsIntegration']);
});
test('pointer revocation during the runtime read cannot be returned as current',async()=>{
  const f=fixture();f.deps.readRuntime=async()=>{f.envelope.signature='a'.repeat(86);return f.runtime;};
  await createActiveReleaseReadHandler(f.deps)(f.request,f.response);
  assert.equal(f.response.code,409);assert.equal(f.response.body.code,'ACTIVE_RELEASE_CHANGED_DURING_READ');
  assert.equal(f.calls().readCalls,2);assert.equal('envelope' in f.response.body,false);
});
test('pointer promotion during the runtime read cannot return the prior signed release',async()=>{
  const f=fixture();f.deps.readRuntime=async()=>{
    f.certificate.releaseRunId='14';
    f.envelope.signature=sign(null,activeReleaseSigningBytes(f.certificate),keys.privateKey).toString('base64url');return f.runtime;
  };
  await createActiveReleaseReadHandler(f.deps)(f.request,f.response);
  assert.equal(f.response.code,409);assert.equal(f.response.body.code,'ACTIVE_RELEASE_CHANGED_DURING_READ');
  assert.equal('envelope' in f.response.body,false);
});
for(const scenario of ['anonymous','cookie only','wrong scope','expired','revoked','wrong hash'])test(`reader denies ${scenario} before protected data read`,async()=>{
  const f=fixture();
  if(scenario==='anonymous'||scenario==='cookie only')delete f.headers.authorization;
  if(scenario==='cookie only')f.headers.cookie='synthetic-cookie';
  if(scenario==='wrong scope')f.credential.scopes=['documents.ingest'];
  if(scenario==='expired')f.credential.expiresAt={toDate:()=>new Date(now)};
  if(scenario==='revoked')f.credential.active=false;
  if(scenario==='wrong hash')f.credential.tokenHash='a'.repeat(64);
  await createActiveReleaseReadHandler(f.deps)(f.request,f.response);
  assert.equal(f.response.code,401);assert.equal(f.calls().readCalls,0);assert.match(f.response.headers['Cache-Control'],/no-store/);
});
for(const scenario of ['issuer','organization','revoked during read','tenant changed during read'])test(`reader revalidates ${scenario}`,async()=>{
  const f=fixture();if(scenario==='issuer')f.disableIssuer();if(scenario==='organization')f.disableOrg();
  if(scenario==='revoked during read')f.deps.readRuntime=async()=>{f.credential.active=false;return f.runtime;};
  if(scenario==='tenant changed during read'){
    const first=f.deps.authorize;let calls=0;f.deps.authorize=async(header)=>{const p=await first(header);return ++calls===2&&p?{...p,orgId:'other'}:p;};
  }
  await createActiveReleaseReadHandler(f.deps)(f.request,f.response);assert.equal(f.response.code,403);
  assert.equal('envelope' in f.response.body,false);
});
for(const scenario of ['missing nonce','upper nonce','short nonce','query locator','write method'])test(`reader rejects ${scenario}`,async()=>{
  const f=fixture();if(scenario==='missing nonce')delete f.headers['x-aurora-release-nonce'];
  if(scenario==='upper nonce')f.headers['x-aurora-release-nonce']='A'.repeat(64);
  if(scenario==='short nonce')f.headers['x-aurora-release-nonce']='a';
  if(scenario==='query locator')f.request.query={source:'private/customer'};if(scenario==='write method')f.request.method='POST';
  await createActiveReleaseReadHandler(f.deps)(f.request,f.response);assert.equal(f.response.code,scenario==='write method'?405:400);
  assert.equal(f.calls().readCalls,0);
});
for(const scenario of ['bad signature','unknown schema','revoked certificate','extra raw document','missing role','foreign source','wrong runtime hash','missing web proof'])test(`reader rejects ${scenario} without exposing raw data`,async()=>{
  const f=fixture();if(scenario==='bad signature')f.envelope.signature='a'.repeat(86);
  if(scenario==='unknown schema')f.certificate.schemaVersion=3 as any;
  if(scenario==='revoked certificate')f.certificate.status='REVOKED' as any;
  if(scenario==='extra raw document')f.envelope.customerData='PRIVATE_MARKER';
  if(scenario==='missing role')delete f.certificate.components.iaMaster;
  if(scenario==='foreign source')f.runtime.runtimeBuild.sourceSha='d'.repeat(40);
  if(scenario==='wrong runtime hash')f.runtime.runtimeBuildWeb.manifestSha256='d'.repeat(64);
  if(scenario==='missing web proof')delete f.runtime.localWeb;
  await createActiveReleaseReadHandler(f.deps)(f.request,f.response);assert.equal(f.response.code,409);
  assert.equal('envelope' in f.response.body,false);assert.equal(JSON.stringify(f.response.body).includes('PRIVATE_MARKER'),false);
});
test('read outages and exceptions are sanitized; both Hosting routers reuse the existing function',async()=>{
  const f=fixture();f.deps.readFixedProtectedEnvelope=async()=>{throw Error('PRIVATE_MARKER');};
  await createActiveReleaseReadHandler(f.deps)(f.request,f.response);assert.equal(f.response.code,503);
  assert.equal(JSON.stringify(f.response.body).includes('PRIVATE_MARKER'),false);
  for(const config of ['firebase.json','firebase.production.json']){
    const json=JSON.parse(readFileSync(new URL('../../'+config,import.meta.url),'utf8'));
    const routes=json.hosting.rewrites.filter((entry:any)=>entry.source===ACTIVE_RELEASE_READ_PATH);
    assert.equal(routes.length,1);assert.equal(routes[0].function.functionId,'auroraNexusIntegrationPing');
  }
});
