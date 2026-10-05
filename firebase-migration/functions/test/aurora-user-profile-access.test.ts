import assert from 'node:assert/strict';
import test from 'node:test';
import { auroraAuth, auroraDb } from '../src/firebase.js';
import { auroraNexusUserProfiles } from '../src/auroraUserProfileRuntime.js';
import { CSRF_PURPOSES, csrfTokenForSession, verifyAuroraAccess } from '../src/auroraAccess.js';
import { auroraNexusSessionLogin } from '../src/auroraAuthGate.js';

const cookie='__session=synthetic-cookie', secret='a'.repeat(64), email='synthetic@example.invalid';
const org='synthetic-company', uid='synthetic-person', operation='profile-'+'b'.repeat(64);
function fixture(context:any) {
  const names=['AURORA_NEXUS_ALLOWED_EMAILS','AURORA_NEXUS_CSRF_HMAC_KEY'];
  const previous=names.map(name=>process.env[name]);
  process.env[names[0]]=email;process.env[names[1]]=secret;
  context.after(()=>names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];}));
  let decoded:any={uid,email,auroraOrgId:org,email_verified:true,firebase:{sign_in_provider:'password',sign_in_second_factor:'totp'}};
  let member:any={active:true,role:'org_admin',allFacilities:true}; let organization:any={active:true,userProfilesEnabled:true};
  const paths:string[]=[], collections:string[]=[], mutations:string[]=[];
  context.mock.method(auroraAuth,'verifySessionCookie',async()=>decoded);
  context.mock.method(auroraAuth,'verifyIdToken',async()=>decoded);
  context.mock.method(auroraAuth,'createSessionCookie',async()=>{mutations.push('session');return 'synthetic-session';});
  context.mock.method(auroraAuth,'createUser',async()=>{mutations.push('user');throw new Error('Unexpected write');});
  context.mock.method(auroraDb,'doc',(path:string)=>{paths.push(path); return {get:async()=>({exists:true,data:()=>path.includes('/members/')?member:organization})};});
  context.mock.method(auroraDb,'collection',(path:string)=>{collections.push(path);return {limit:(n:number)=>{assert.equal(n,101);return {get:async()=>({size:1,docs:[{id:'synthetic',data:()=>({displayName:'Pessoa',role:'viewer',active:true,profileVersion:1,authEmail:'must-not-return@example.invalid'})}]})};}};});
  async function invoke(fn:any, method='POST', body:any={}, overrides:Record<string,string>={}) {
    const headers:any={cookie,'content-type':'application/json','sec-fetch-site':'same-origin','x-aurora-csrf':csrfTokenForSession(cookie,secret,CSRF_PURPOSES.userProfile),...overrides};
    let status=200, result:any, responseHeaders:any={};
    const res:any={on:()=>res,set:(k:string,v:string)=>{responseHeaders[k]=v;return res;},setHeader:(k:string,v:string)=>{responseHeaders[k]=v;return res;}, status:(s:number)=>{status=s;return res;}, json:(data:any)=>{result=data;return res;},send:(data:any)=>{result=data;return res;}};
    await fn({method,body,headers,get:(name:string)=>headers[name.toLowerCase()]},res);
    return {status,result,responseHeaders};
  }
  return {invoke,paths,collections,mutations,decoded:(patch:any)=>{decoded={...decoded,...patch};},member:(patch:any)=>{member={...member,...patch};},organization:(patch:any)=>{organization={...organization,...patch};}};
}

test('profile endpoint rejects absent session, non-admin, missing MFA and invalid CSRF without writes',async context=>{
  const f=fixture(context);
  assert.equal((await f.invoke(auroraNexusUserProfiles,'POST',{}, {cookie:''})).status,401);
  f.member({role:'viewer'}); assert.equal((await f.invoke(auroraNexusUserProfiles)).status,403);
  f.member({role:'org_admin'}); f.decoded({firebase:{sign_in_provider:'password'}});
  assert.equal((await f.invoke(auroraNexusUserProfiles)).result.code,'PROFILE_ADMIN_MFA_REQUIRED');
  f.decoded({firebase:{sign_in_second_factor:'totp'}});
  for(const override of [{'x-aurora-csrf':''},{'x-aurora-csrf':csrfTokenForSession(cookie,secret,CSRF_PURPOSES.integrationKey)!},{'sec-fetch-site':'cross-site'},{'cookie':'__session=different'}]) {
    assert.equal((await f.invoke(auroraNexusUserProfiles,'POST',{action:'CREATE'},override)).status,403);
  }
  assert.equal((await f.invoke(auroraNexusUserProfiles,'POST',{}, {'content-type':'text/plain'})).status,415);
  assert.equal((await f.invoke(auroraNexusUserProfiles,'DELETE')).status,405);
  assert.deepEqual(f.mutations,[]);
});

test('profile listing uses only signed company and omits email and claims',async context=>{
  const f=fixture(context); const response=await f.invoke(auroraNexusUserProfiles,'GET',{orgId:'other-company'});
  assert.equal(response.status,200); assert.deepEqual(f.collections,[`organizations/${org}/members`]);
  assert.equal(JSON.stringify(response.result).includes('must-not-return'),false);
  assert.equal(response.responseHeaders['Cache-Control'],'no-store');
  f.organization({userProfilesEnabled:false}); assert.equal((await f.invoke(auroraNexusUserProfiles,'GET')).result.engineEnabled,false);
});

test('managed identity uses live membership without global email-list edits and loses access immediately on revocation',async context=>{
  const f=fixture(context);
  f.decoded({auroraProfileVersion:1,auroraProfileOperation:operation});
  f.member({profileVersion:1,profileOperationId:operation,profileState:'READY',authEmail:email,role:'viewer',allFacilities:false});
  assert.equal((await verifyAuroraAccess(cookie,'bootstrap-admin@example.invalid'))?.role,'viewer');
  f.member({active:false}); assert.equal(await verifyAuroraAccess(cookie,email),null);
  f.member({active:true}); f.decoded({auroraProfileVersion:undefined});
  assert.equal(await verifyAuroraAccess(cookie,email),null,'stripped managed marker cannot use legacy allowlist');
});

test('real session handler rejects managed first factor and wrong company before issuing session',async context=>{
  const f=fixture(context);
  f.decoded({auroraProfileVersion:1,auroraProfileOperation:operation});
  f.member({profileVersion:1,profileOperationId:operation,profileState:'READY',authEmail:email});
  f.decoded({firebase:{sign_in_provider:'password'}});
  assert.equal((await f.invoke(auroraNexusSessionLogin,'POST',{idToken:'synthetic',orgId:org})).status,403);
  f.decoded({firebase:{sign_in_second_factor:'totp'},email_verified:false});
  assert.equal((await f.invoke(auroraNexusSessionLogin,'POST',{idToken:'synthetic',orgId:org})).status,403);
  f.decoded({email_verified:true});
  assert.equal((await f.invoke(auroraNexusSessionLogin,'POST',{idToken:'synthetic',orgId:'other-company'})).result.code,'COMPANY_ACCESS_DENIED');
  assert.deepEqual(f.mutations,[]);
  const result=await f.invoke(auroraNexusSessionLogin,'POST',{idToken:'synthetic',orgId:org});
  assert.equal(result.status,204); assert.deepEqual(f.mutations,['session']);
  assert.match(result.responseHeaders['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);
});
