import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeDocumentIngestion,canImportNativeDocuments} from '../src/auroraNativeIngestion.ts';
import {csrfTokenForSession,validCsrf,CSRF_PURPOSES,type AuroraMember} from '../src/auroraAccess.ts';
const member:AuroraMember={uid:'synthetic-admin',email:'synthetic@example.test',orgId:'synthetic',role:'org_admin',
  permissions:[],facilityIds:[],allFacilities:true,mfaVerified:true};
const headers={origin:'https://auroranexus.com.br','sec-fetch-site':'same-origin',cookie:'__session=synthetic-cookie','x-aurora-csrf':'synthetic-csrf'};
const request=(overrides:Record<string,string>={})=>({get:(name:string)=>({...headers,...overrides} as any)[name]});
const deps=(actor:AuroraMember|null=member)=>({session:async()=>actor,bearer:async()=>null,csrf:()=>true});
test('native session import binds tenant and actor without granting a transport credential',async()=>{
  const result=await authorizeDocumentIngestion(request(),deps());assert.ok('principal' in result);
  if('principal' in result){assert.equal(result.principal.orgId,'synthetic');assert.equal(result.principal.member?.uid,member.uid);
    assert.match(result.principal.keyId,/^web_[a-f0-9]{32}$/);assert.equal((result.principal as any).apiKey,undefined);}
});
test('anonymous, foreign origin, missing MFA, partial scope and revoked access cannot import',async()=>{
  assert.equal((await authorizeDocumentIngestion(request(),deps(null)) as any).code,'AUTH_REQUIRED');
  for(const overrides of [{origin:'https://foreign.example'},{'sec-fetch-site':'cross-site'}])
    assert.equal((await authorizeDocumentIngestion(request(overrides),deps()) as any).code,'CROSS_SITE_REJECTED');
  for(const actor of [{...member,mfaVerified:false},{...member,allFacilities:false},{...member,role:'viewer'}]){
    assert.equal(canImportNativeDocuments(actor),false);
    assert.equal((await authorizeDocumentIngestion(request(),deps(actor)) as any).code,'MFA_AND_INTEGRATION_ADMIN_REQUIRED');}
  assert.equal((await authorizeDocumentIngestion(request(),{...deps(),csrf:()=>false}) as any).code,'CSRF_REJECTED');
});
test('invalid bearer does not fall back to a valid browser session',async()=>{
  let sessions=0;const result=await authorizeDocumentIngestion(request({authorization:'Bearer invalid'}),{
    ...deps(),session:async()=>{sessions++;return member;}});
  assert.equal((result as any).code,'INVALID_INTEGRATION_KEY');assert.equal(sessions,0);
});
test('document CSRF rejects a token from another operation or another session',()=>{
  const key='a'.repeat(64),cookie='__session=synthetic-cookie';
  const token=csrfTokenForSession(cookie,key,CSRF_PURPOSES.documentIngest)!;
  assert.equal(validCsrf(cookie,token,key,CSRF_PURPOSES.documentIngest),true);
  assert.equal(validCsrf(cookie,token,key,CSRF_PURPOSES.integrationKey),false);
  assert.equal(validCsrf('__session=another-cookie',token,key,CSRF_PURPOSES.documentIngest),false);
});
