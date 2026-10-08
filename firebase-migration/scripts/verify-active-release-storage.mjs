import {createRequire} from 'node:module';
import {verifyActiveReleaseEnvelope} from '../functions/lib/auroraActiveRelease.js';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const projectId=process.env.PROJECT_ID;
if(projectId!=='wmgj-hml-jfn-20260927')throw Error('HML_PROJECT_REQUIRED');
const db=getFirestore(initializeApp({projectId}));
const rows=await db.collection('platformRuntime').limit(2).get();
if(!rows.empty){
  if(rows.size!==1||rows.docs[0].id!=='activeRelease')throw Error('UNEXPECTED_RUNTIME_DOCUMENT');
  const result=verifyActiveReleaseEnvelope(rows.docs[0].data(),process.env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY);
  if(result.status!=='CANDIDATE_UNVERIFIED')throw Error('PROTECTED_ACTIVE_RELEASE_INVALID');
}
console.log('AURORA_PROTECTED_RUNTIME_STORAGE_VERIFIED');
