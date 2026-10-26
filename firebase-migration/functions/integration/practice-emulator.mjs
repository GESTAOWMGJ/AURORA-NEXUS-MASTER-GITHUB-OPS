import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createPracticeProvisioner } from '../lib/auroraPracticeProvisioning.js';
import { createProfileEngine } from '../lib/auroraUserProfiles.js';
import { managedProfileMatches } from '../lib/auroraUserProfilePolicy.js';

// Refuse all nonlocal hosts; this harness can never target a real project.
for (const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])
 assert.match(process.env[name]??'',/^(127\.0\.0\.1|localhost):[0-9]+$/);
const projectId='wmgj-firestore-rules-test';
const app=initializeApp({projectId},'practice-emulator');
const db=getFirestore(app),auth=getAuth(app);
const store={transaction:body=>db.runTransaction(tx=>body({read:async p=>(await tx.get(db.doc(p))).data(),create:(p,d)=>tx.create(db.doc(p),d),update:(p,d)=>tx.update(db.doc(p),d)}))};
const actor={uid:'synthetic-operator',orgId:'synthetic-operator-org',role:'org_admin',allFacilities:true,mfaVerified:true};
const grantId='synthetic-emulator-grant-01',base=`organizations/${actor.orgId}`;
const host=`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
async function request(path,body){const r=await fetch(host+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.ok,true,'Emulator Auth request failed');return data;}
const endpoint=name=>`/identitytoolkit.googleapis.com/v1/accounts:${name}?key=synthetic-key`;
try{
 await db.doc(base).set({active:true});
 await db.doc(`${base}/members/${actor.uid}`).set({active:true,role:'org_admin',allFacilities:true});
 await db.doc(`${base}/members/synthetic-reviewer`).set({active:true,allFacilities:true,permissions:['practice.validate']});
 await db.doc(`${base}/runtimeCheckpoints/practice-grant-${grantId}`).set({status:'APPROVED',actorUid:actor.uid,verifiedBy:'synthetic-reviewer',expiresAt:Date.now()+3600000,entityVerified:true,professionalVerified:true,ownerConsent:true,entityRef:'synthetic-entity-01',professionalRef:'synthetic-professional-01',orgId:'synthetic-practice-emulator',email:'owner@example.invalid',displayName:'Synthetic Owner'});
 const provision=createPracticeProvisioner(store,auth);
 const owner=await provision(actor,grantId);
 assert.equal((await provision(actor,grantId)).uid,owner.uid);
 assert.equal((await db.doc(`organizations/${owner.orgId}`).get()).data().active,true);
 assert.equal((await db.doc(`organizations/${owner.orgId}/members/${actor.uid}`).get()).exists,false);
 await request(endpoint('sendOobCode'),{requestType:'PASSWORD_RESET',email:'owner@example.invalid'});
 let codes=(await request(`/emulator/v1/projects/${projectId}/oobCodes`)).oobCodes;
 const reset=codes.find(c=>c.requestType==='PASSWORD_RESET');assert.ok(reset);
 // A synthetic user chooses this ephemeral password; the application never generates or returns one.
 const password=(await import('node:crypto')).randomBytes(24).toString('base64url');
 await request(endpoint('resetPassword'),{oobCode:reset.oobCode,newPassword:password});
 let signed=await request(endpoint('signInWithPassword'),{email:'owner@example.invalid',password,returnSecureToken:true});
 await request(endpoint('sendOobCode'),{requestType:'VERIFY_EMAIL',idToken:signed.idToken});
 codes=(await request(`/emulator/v1/projects/${projectId}/oobCodes`)).oobCodes;
 await request(endpoint('update'),{oobCode:codes.find(c=>c.requestType==='VERIFY_EMAIL').oobCode});
 signed=await request(endpoint('signInWithPassword'),{email:'owner@example.invalid',password,returnSecureToken:true});
 const token=await auth.verifyIdToken(signed.idToken);
 const membership=(await db.doc(`organizations/${owner.orgId}/members/${owner.uid}`).get()).data();
 assert.equal(token.email_verified,true);
 assert.equal(managedProfileMatches(token,membership,owner.orgId),false,'first factor must never open the portal');
 const ownerActor={...actor,uid:owner.uid,orgId:owner.orgId,role:'practice_owner'};
 const profiles=createProfileEngine(store,auth);
 const staff=await profiles.create(ownerActor,{action:'CREATE',requestId:'synthetic-emulator-staff-01',email:'editor@example.invalid',displayName:'Synthetic Editor',role:'practice_editor',allFacilities:true,facilityIds:[]});
 await profiles.revoke(ownerActor,staff.uid);
 assert.equal((await auth.getUser(staff.uid)).disabled,true);
 assert.equal((await db.doc(`organizations/${owner.orgId}/members/${staff.uid}`).get()).data().active,false);
 console.log('PERSONALITE_EMULATOR_OK: organization, Auth identity, idempotency, email/password recovery, verified email, first-factor denial, staff revocation. TOTP provider ceremony requires HML.');
}finally{await db.terminate();await deleteApp(app);}
