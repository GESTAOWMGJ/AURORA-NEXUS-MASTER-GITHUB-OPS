'use strict';
const {createRequire}=require('node:module');
const fromFunctions=createRequire(require('node:path').resolve(__dirname,'../functions/package.json'));
const {initializeApp}=fromFunctions('firebase-admin/app');
const {getFirestore}=fromFunctions('firebase-admin/firestore');
const {guardedCanonicalTransaction}=fromFunctions('../functions/lib/auroraWriterGuardian.js');
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))process.exit(2);
const [org,mode]=process.argv.slice(2);
if(!/^guardian-crash-(before|after)$/.test(org)||!['before','after'].includes(mode))process.exit(2);
const db=getFirestore(initializeApp({projectId:'wmgj-firestore-rules-test'}));
const hold=()=>new Promise(()=>{setInterval(()=>{},1000);});
guardedCanonicalTransaction(db,org,async tx=>{
  const ref=db.doc(`organizations/${org}/apiIdempotency/original-key`);
  const prior=await tx.get(ref);if(prior.exists)return;
  tx.create(ref,{effect:'one'});
  if(mode==='before'){process.send({phase:'before'});await hold();}
}).then(async()=>{process.send({phase:'after'});await hold();}).catch(()=>process.exit(3));
