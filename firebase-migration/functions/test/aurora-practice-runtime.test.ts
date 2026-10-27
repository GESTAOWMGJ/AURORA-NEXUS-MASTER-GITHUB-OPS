import assert from 'node:assert/strict';
import test from 'node:test';
import { auroraNexusPractice, practiceEngine, practiceMutationContext } from '../src/auroraPracticeRuntime.js';
import { auroraAuth, auroraDb } from '../src/firebase.js';
import { csrfTokenForSession, CSRF_PURPOSES } from '../src/auroraAccess.js';

test('practice HTTP reuses verified managed session, independent CSRF purpose and bound org',async context=>{
 const previous={allow:process.env.AURORA_NEXUS_ALLOWED_EMAILS,csrf:process.env.AURORA_NEXUS_CSRF_HMAC_KEY};
 const secret='a'.repeat(64),cookie='__session=synthetic-session',uid='synthetic-owner',orgId='synthetic-practice',operation='profile-'+'a'.repeat(64);
 process.env.AURORA_NEXUS_ALLOWED_EMAILS='';process.env.AURORA_NEXUS_CSRF_HMAC_KEY=secret;
 context.after(()=>{for(const [name,value]of [['AURORA_NEXUS_ALLOWED_EMAILS',previous.allow],['AURORA_NEXUS_CSRF_HMAC_KEY',previous.csrf]]){if(value===undefined)delete process.env[name!];else process.env[name!]=value;}});
 let revoked=false,calls=0;
 context.mock.method(auroraAuth,'verifySessionCookie',async()=>({uid,email:'owner@example.invalid',email_verified:true,auroraOrgId:orgId,auroraProfileVersion:1,auroraProfileOperation:operation,firebase:{sign_in_second_factor:'totp'}}));
 context.mock.method(auroraDb,'doc',(path:string)=>({get:async()=>({exists:true,data:()=>path===`organizations/${orgId}`?{active:true,profile:'PERSONALITE'}:{active:!revoked,role:'practice_owner',allFacilities:true,profileVersion:1,profileState:'READY',profileOperationId:operation,authEmail:'owner@example.invalid'}})} as any));
 context.mock.method(practiceEngine,'read',async actor=>{assert.equal(actor.orgId,orgId);return {revision:0,dataMode:'SYNTHETIC'};});
 context.mock.method(practiceEngine,'mutate',async(actor,raw)=>{assert.equal(actor.orgId,orgId);calls++;return {replayed:false};});
 const headers:Record<string,string>={cookie,origin:'https://auroranexus.com.br','content-type':'application/json','sec-fetch-site':'same-origin'};
 async function invoke(method:string,path='/api/practice',body?:any){let status=200,result:any;const res:any={on:()=>res,set:()=>res,setHeader:()=>res,type:()=>res,status:(v:number)=>{status=v;return res;},json:(v:any)=>{result=v;return res;},send:(v:any)=>{result=v;return res;}};await auroraNexusPractice({method,path,body,get:(key:string)=>headers[key]} as any,res);return {status,result};}
 assert.equal((await invoke('GET')).status,200);
 headers['x-aurora-csrf']=csrfTokenForSession(cookie,secret,CSRF_PURPOSES.userProfile)!;
 assert.equal((await invoke('POST','/api/practice',{})).status,403);assert.equal(calls,0);
 headers['x-aurora-csrf']=csrfTokenForSession(cookie,secret,CSRF_PURPOSES.practice)!;
 assert.equal((await invoke('POST','/api/practice',{action:'ADD_TASK'})).status,200);assert.equal(calls,1);
 headers.origin='https://attacker.example.invalid';assert.equal((await invoke('POST','/api/practice',{})).status,403);
 headers.origin='https://auroranexus.com.br';revoked=true;assert.equal((await invoke('GET')).status,401);assert.equal(calls,1);
 assert.equal((await invoke('GET','/practice-confirm')).status,200);
 assert.equal((await invoke('GET','/api/practice-confirm')).status,404);
});
test('mutation context rejects cross-site, absent origins and content type confusion',()=>{
 for(const headers of [{},{origin:'https://auroranexus.com.br','content-type':'text/plain'},{origin:'https://auroranexus.com.br','content-type':'application/json','sec-fetch-site':'cross-site'},{origin:'https://auroranexus.com.br.evil.invalid','content-type':'application/json'}])assert.equal(practiceMutationContext({get:n=>(headers as any)[n]}),false);
});
