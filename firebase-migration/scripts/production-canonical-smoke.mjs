import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const project='wmgj-prod-jfn-20261005',origin='https://auroranexus.com.br';
function gate(value,code){if(!value)throw Error(code);}
try{
  gate(process.env.GCLOUD_PROJECT===project,'PROJECT_MISMATCH');
  const token=process.env.FIREBASE_PROD_SMOKE_ID_TOKEN;
  gate(typeof token==='string'&&token.length>100,'NOMINAL_MFA_SESSION_REQUIRED');
  const {initializeApp,applicationDefault}=require('firebase-admin/app');
  const {getAuth}=require('firebase-admin/auth');
  const auth=getAuth(initializeApp({projectId:project,credential:applicationDefault()}));
  const identity=await auth.verifyIdToken(token,true);
  gate(identity.email_verified===true&&identity.uid===process.env.FIREBASE_PROD_SMOKE_UID,'NOMINAL_IDENTITY_MISMATCH');
  gate(identity.firebase?.sign_in_second_factor&&![null,'custom','anonymous'].includes(identity.firebase?.sign_in_provider??null),'REAL_MFA_REQUIRED');
  const age=Date.now()/1000-identity.auth_time;
  gate(Number.isFinite(age)&&age>=0&&age<15*60,'RECENT_NOMINAL_AUTH_REQUIRED');
  if(process.argv.includes('--identity-only')){
    console.log(JSON.stringify({gate:'PRODUCTION_NOMINAL_IDENTITY',verified:true,mfaVerified:true,projectId:project}));
    process.exit(0);
  }
  const request=(path,options={})=>fetch(origin+path,{...options,redirect:'manual',signal:AbortSignal.timeout(30000)});
  const config=await request('/__/firebase/init.json');
  gate(config.status===200&&(await config.json()).projectId===project,'CANONICAL_PROJECT_MISMATCH');
  const anonymous=await request('/api/bootstrap');
  gate(anonymous.status===401,'ANONYMOUS_ACCESS_NOT_REJECTED');
  const login=await request('/__sessionLogin',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'Sec-Fetch-Site':'same-origin'},body:JSON.stringify({idToken:token,orgId:'wmgj'})});
  gate(login.status===204,'NOMINAL_LOGIN_FAILED');
  const cookies=login.headers.getSetCookie();
  const session=cookies.find(cookie=>cookie.startsWith('__session='));
  gate(session&&/;\s*HttpOnly/i.test(session)&&/;\s*Secure/i.test(session)&&/;\s*SameSite=Strict/i.test(session),'SESSION_COOKIE_CONTROLS_REQUIRED');
  const headers={Cookie:session.split(';',1)[0]};
  const portal=await request('/portal',{headers});
  gate(portal.status===200&&!portal.headers.has('location'),'CANONICAL_PORTAL_REDIRECT_OR_FAILURE');
  const denied=await request('/scope-proof-other-org',{headers});
  gate(denied.status===403,'CROSS_TENANT_ACCESS_NOT_REJECTED');
  const bootstrap=await request('/api/bootstrap',{headers});
  gate(bootstrap.status===200,'AUTHENTICATED_BOOTSTRAP_FAILED');
  const data=await bootstrap.json();
  gate(data.ok===true&&data.organization?.id==='wmgj','AUTHENTICATED_TENANT_MISMATCH');
  for(const key of ['runtimeBuild','runtimeBuildWeb']){
    const runtime=data.canonicalVersion?.[key];
    gate(runtime?.sourceSha===process.env.GITHUB_SHA&&runtime?.fileIntegrityVerified===true,'CANONICAL_SOURCE_MISMATCH');
  }
  console.log(JSON.stringify({gate:'PRODUCTION_CANONICAL_SMOKE',verified:true,projectId:project,sourceSha:process.env.GITHUB_SHA,
    canonicalOrigin:origin,nominalIdentityFingerprint:createHash('sha256').update(project+':'+identity.uid).digest('hex'),
    mfaVerified:true,tenantVerified:true,negativeAnonymousVerified:true,negativeTenantVerified:true,
    serverManifestSha256:data.canonicalVersion.runtimeBuild.manifestSha256,webManifestSha256:data.canonicalVersion.runtimeBuildWeb.manifestSha256,
    installationVerified:false,firstOperationalIngestionVerified:false}));
}catch(error){
  const code=error instanceof Error&&/^[A-Z_]{3,80}$/.test(error.message)?error.message:'PRODUCTION_SMOKE_FAILED';
  console.error(JSON.stringify({ok:false,gate:'PRODUCTION_CANONICAL_SMOKE',code}));
  process.exit(41);
}
