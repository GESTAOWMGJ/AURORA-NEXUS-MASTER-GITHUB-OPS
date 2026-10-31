import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
const require = createRequire(new URL('../functions/package.json',import.meta.url));
const {initializeApp,deleteApp} = require('firebase-admin/app');
const {getFirestore,Timestamp} = require('firebase-admin/firestore');
const {guardedCanonicalTransaction,expireLegacyRuntimeLock,writerLeasePath,WRITER_GUARDIAN_ID,CANONICAL_WRITE_RESOURCE} = require('../functions/lib/auroraWriterGuardian.js');

// No fallback to production or ADC: this suite can only use a local emulator.
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):\d+$/);
const apps = [0,1].map(n=>initializeApp({projectId:'wmgj-firestore-rules-test'},`writer-guardian-${n}`));
const databases = apps.map(app=>getFirestore(app));
const tenants = [];
function tenant(name) {const id=`guardian-${name}`;tenants.push(id);return id;}
after(async()=>{for(const id of tenants)await databases[0].recursiveDelete(databases[0].doc(`organizations/${id}`));await Promise.all(apps.map(deleteApp));});

test('two independent SDK clients serialize a canonical receipt without replacing its key',async()=>{
  const org=tenant('concurrent'),path=`organizations/${org}/apiIdempotency/original-key`;
  const result=await Promise.all(Array.from({length:8},(_,i)=>{
    const db=databases[i%2];
    return guardedCanonicalTransaction(db,org,async tx=>{
      const receipt=db.doc(path),prior=await tx.get(receipt);
      if(prior.exists)return 'DUPLICATE';
      tx.create(receipt,{result:'one'});
      tx.create(db.doc(`organizations/${org}/sourceDocuments/original-entity`),{version:1});
      return 'ACCEPTED';
    });
  }));
  assert.equal(result.filter(x=>x==='ACCEPTED').length,1);
  assert.equal(result.filter(x=>x==='DUPLICATE').length,7);
  const lease=(await databases[0].doc(writerLeasePath(org)).get()).data();
  assert.equal(lease.state,'RELEASED');assert.equal(lease.epoch,1);
  assert.equal((await databases[0].collection(`organizations/${org}/apiIdempotency`).get()).size,1);
});

test('expired Xeon epoch is replaced; its late token cannot commit after cloud handoff',async()=>{
  const db=databases[0],org=tenant('handoff'),path=writerLeasePath(org);
  const token={orgId:org,resourceKey:CANONICAL_WRITE_RESOURCE,ownerId:'synthetic-xeon',epoch:11};
  await db.doc(path).set({...token,guardianId:WRITER_GUARDIAN_ID,holder:'WINDOWS_XEON_PHYSICAL_SERVER',expiresAt:1,state:'LOCKED'});
  await guardedCanonicalTransaction(db,org,async tx=>{tx.create(db.doc(`organizations/${org}/sourceDocuments/current`),{current:true});});
  assert.equal((await db.doc(path).get()).data().epoch,12);
  await assert.rejects(guardedCanonicalTransaction(databases[1],org,async tx=>{
    tx.create(databases[1].doc(`organizations/${org}/sourceDocuments/stale`),{stale:true});
  },token),/STALE_WRITER_FENCED/);
  assert.equal((await db.doc(`organizations/${org}/sourceDocuments/stale`).get()).exists,false);
});

test('failed document transaction leaves no lease/effect and independent next item commits',async()=>{
  const db=databases[0],org=tenant('partial');
  await assert.rejects(guardedCanonicalTransaction(db,org,async tx=>{
    tx.create(db.doc(`organizations/${org}/sourceDocuments/bad`),{});throw Error('INVALID_DOCUMENT');
  }),/INVALID_DOCUMENT/);
  assert.equal((await db.doc(writerLeasePath(org)).get()).exists,false);
  await guardedCanonicalTransaction(db,org,async tx=>{tx.create(db.doc(`organizations/${org}/sourceDocuments/good`),{});});
  assert.equal((await db.collection(`organizations/${org}/sourceDocuments`).get()).size,1);
});

test('legacy expiry and guardian release share a commit; renewed locks and fencing epochs survive',async()=>{
  const db=databases[0],other=databases[1],org=tenant('legacy-expiry');
  const ref=db.doc(`organizations/${org}/runtimeLocks/legacy`),lease=db.doc(writerLeasePath(org));
  await ref.set({state:'LOCKED',leaseUntil:Timestamp.fromMillis(1)});
  const scanned=await ref.get();assert.equal(scanned.data().state,'LOCKED');
  // A second client renews after the watchdog scan. The fixed transition must
  // consult the live document, not expire the earlier snapshot.
  await other.doc(ref.path).update({leaseUntil:Timestamp.fromMillis(Date.now()+60000)});
  assert.equal(await expireLegacyRuntimeLock(db,org,'legacy'),false);
  assert.equal((await ref.get()).data().state,'LOCKED');assert.equal((await lease.get()).exists,false);
  await ref.update({leaseUntil:Timestamp.fromMillis(1)});
  assert.equal(await expireLegacyRuntimeLock(db,org,'legacy'),true);
  const [expired,released]=await Promise.all([ref.get(),lease.get()]);
  assert.equal(expired.data().state,'EXPIRED');assert.equal(released.data().state,'RELEASED');
  assert.equal(released.data().epoch,1);assert.equal(expired.updateTime.isEqual(released.updateTime),true);
  assert.equal(await expireLegacyRuntimeLock(other,org,'legacy'),false);
  await assert.rejects(expireLegacyRuntimeLock(db,org,lease.id),/INVALID_LEGACY_LOCK_SCOPE/);
  assert.equal((await lease.get()).updateTime.isEqual(released.updateTime),true);
});

for(const phase of ['before','after']) test(`SIGKILL ${phase} commit preserves original receipt on recovery`,{timeout:180000},async()=>{
  const org=tenant(`crash-${phase}`),db=databases[0];
  const child=fork(new URL('./writer-guardian-crash-child.cjs',import.meta.url),[org,phase],{stdio:['ignore','ignore','ignore','ipc']});
  try {
    const ready=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error('CHILD_EXITED_BEFORE_CHECKPOINT');})]);
    assert.equal(ready[0].phase,phase);
    const exited=once(child,'exit');child.kill('SIGKILL');await exited;
    // Model the existing bridge's bounded caller retry, preserving identity.
    // Killing the process does NOT immediately release provider transaction locks.
    const killedAt=performance.now();
    let result, attempts=0, cycles=0, pending;
    for(let cycle=1;cycle<=2;cycle++){
      cycles=cycle;
      for(let attempt=1;attempt<=3;attempt++){
        attempts++;
        try {
          result=await guardedCanonicalTransaction(db,org,async tx=>{
            const receipt=db.doc(`organizations/${org}/apiIdempotency/original-key`),prior=await tx.get(receipt);
            if(prior.exists)return 'DUPLICATE';
            tx.create(receipt,{effect:'one'});return 'ACCEPTED';
          });
          break;
        } catch(error){
          if(error.code!=='GUARDIAN_CONTENTION_RETRY')throw error;
          assert.equal(error.status,503);pending=error;
          if(attempt<3)await delay(attempt*750);
        }
      }
      if(result)break;
      // Budget exhaustion is PENDING, not recovered. Preserve that evidence.
      // A later EXISTING caller cycle may retry once the provider's idle lock
      // timeout has elapsed. No new runtime scheduler or guard retry is added.
      assert.equal(phase,'before');
      assert.equal((await db.doc(`organizations/${org}/apiIdempotency/original-key`).get()).exists,false);
      const independent=tenant(`crash-independent-${cycle}`);
      await guardedCanonicalTransaction(db,independent,async tx=>{
        tx.create(db.doc(`organizations/${independent}/sourceDocuments/healthy`),{healthy:true});
      });
      if(cycle===1)await delay(Math.max(0,65_000-(performance.now()-killedAt)));
    }
    if(!result)throw pending;
    console.log(JSON.stringify({fixture:'SYNTHETIC_PROCESS_CRASH',phase,attempts,cycles,firstCycleDeferred:cycles>1,result}));
    assert.equal(result,phase==='before'?'ACCEPTED':'DUPLICATE');
    assert.equal((await db.collection(`organizations/${org}/apiIdempotency`).get()).size,1);
    assert.equal((await db.doc(writerLeasePath(org)).get()).data().epoch,1);
  } finally {if(child.exitCode===null)child.kill('SIGKILL');}
});
