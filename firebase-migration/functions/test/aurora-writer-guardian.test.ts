import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedCanonicalTransaction, writerLeasePath, WRITER_GUARDIAN_ID,
  CANONICAL_WRITE_RESOURCE, type WriterToken } from '../src/auroraWriterGuardian.js';
import { arbitrateWriter } from '../src/realtimePlatformGuardian.js';

// Optimistic, atomic SDK double: retries callbacks after a competing commit.
// It is not evidence of Firestore deployment or physical Xeon handoff.
function fixture() {
  const values = new Map<string, any>(), versions = new Map<string, number>();
  let now = 1_000_000, retries = 0;
  const put = (path: string, data: any) => {
    values.set(path, structuredClone(data)); versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  const db: any = { doc: (path: string) => ({path}), runTransaction: async (body: any) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reads = new Map<string, number>(), pending: {path: string; data: any; create: boolean}[] = [];
      const tx: any = {
        get: async ({path}: any) => {
          assert.equal(pending.length, 0, 'Firestore reads must precede writes');
          reads.set(path, versions.get(path) ?? 0);
          const value = structuredClone(values.get(path));
          return {exists: value !== undefined, data: () => value, readTime: {toMillis: () => now}};
        },
        set: ({path}: any, data: any) => {pending.push({path, data, create:false}); return tx;},
        create: ({path}: any, data: any) => {pending.push({path, data, create:true}); return tx;}
      };
      const result = await body(tx);
      if ([...reads].some(([path, version]) => (versions.get(path) ?? 0) !== version)) { retries++; continue; }
      for (const write of pending) if (write.create) assert.equal(values.has(write.path), false);
      for (const write of pending) put(write.path, write.data);
      return result;
    }
    throw Error('TRANSACTION_RETRIES_EXHAUSTED');
  }};
  const reserve = (orgId: string, ownerId: string, epoch: number, platform = 'CLOUD_CONTROL_PLANE') => {
    put(writerLeasePath(orgId), {guardianId: WRITER_GUARDIAN_ID, orgId, resourceKey: CANONICAL_WRITE_RESOURCE,
      holder: platform, ownerId, epoch, expiresAt: now + 45_000, state:'LOCKED'});
    return {orgId, resourceKey: CANONICAL_WRITE_RESOURCE, ownerId, epoch};
  };
  return { db, values, put, reserve, advance: (ms: number) => {now += ms;}, retries: () => retries };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {resolve = done;});
  return {promise, resolve};
};

test('two cloud instances cannot renew one another by platform name', () => {
  const first = arbitrateWriter({currentLease:null,candidatePlatform:'CLOUD_CONTROL_PLANE',candidateId:'one',expectedEpoch:undefined,now:100,ttlMs:45000});
  const denied = arbitrateWriter({currentLease:first.lease,candidatePlatform:'CLOUD_CONTROL_PLANE',candidateId:'two',expectedEpoch:1,now:200,ttlMs:45000});
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, 'STALE_WRITER_FENCED');
  const noId = arbitrateWriter({currentLease:null,candidatePlatform:'CLOUD_CONTROL_PLANE',candidateId:undefined,expectedEpoch:undefined,now:100,ttlMs:45000});
  assert.equal(noId.allowed, false);
});

test('concurrent requests retain the existing receipt key and only one business effect', async () => {
  const f = fixture(), org = 'synthetic';
  const receipt = f.db.doc(`organizations/${org}/apiIdempotency/existing-key`);
  const source = f.db.doc(`organizations/${org}/sourceDocuments/same-document`);
  const start = deferred(), bothRead = deferred(); let waiting = 0;
  const run = () => guardedCanonicalTransaction(f.db, org, async tx => {
    const prior = await tx.get(receipt);
    if (prior.exists) return 'DUPLICATE';
    if (++waiting === 2) bothRead.resolve();
    await start.promise;
    tx.create(source, {version:1}); tx.create(receipt, {documentId:'same-document'});
    return 'ACCEPTED';
  });
  const first = run(), second = run(); await bothRead.promise; start.resolve();
  assert.deepEqual((await Promise.all([first,second])).sort(), ['ACCEPTED','DUPLICATE']);
  assert.equal(f.retries(),1);
  assert.equal(f.values.size,3);
  assert.equal(f.values.get(writerLeasePath(org)).epoch,1);
  assert.equal(f.values.get(writerLeasePath(org)).state,'RELEASED');
});

test('late owner is fenced on transaction retry after takeover', async () => {
  const f = fixture(), token = f.reserve('synthetic','old-owner',4);
  const entered = deferred(), resume = deferred();
  const late = guardedCanonicalTransaction(f.db,'synthetic',async tx => {
    entered.resolve(); await resume.promise;
    tx.set(f.db.doc('organizations/synthetic/sourceDocuments/stale'),{old:true});
  },token);
  await entered.promise;
  f.advance(45_001); f.reserve('synthetic','new-owner',5);
  resume.resolve();
  await assert.rejects(late,/STALE_WRITER_FENCED/);
  assert.equal(f.values.has('organizations/synthetic/sourceDocuments/stale'),false);
  assert.equal(f.values.get(writerLeasePath('synthetic')).ownerId,'new-owner');
});

test('live Xeon lease blocks cloud writes; expiry permits a higher epoch', async () => {
  const f = fixture(), token = f.reserve('synthetic','xeon-owner',8,'WINDOWS_XEON_PHYSICAL_SERVER');
  let called = 0;
  const write = () => guardedCanonicalTransaction(f.db,'synthetic',async tx => {
    called++; tx.set(f.db.doc('organizations/synthetic/sourceDocuments/one'),{ok:true});
  });
  await assert.rejects(write(),/SPLIT_BRAIN_PREVENTED/); assert.equal(called,0);
  f.advance(45_001); await write();
  assert.equal(f.values.get(writerLeasePath('synthetic')).epoch,9);
  await assert.rejects(guardedCanonicalTransaction(f.db,'synthetic',async () => {},token),/STALE_WRITER_FENCED/);
});

test('tenant, resource and lease control writes cannot cross the guard', async () => {
  const f = fixture(), token = f.reserve('other','foreign',1);
  await assert.rejects(guardedCanonicalTransaction(f.db,'synthetic',async () => {},token),/INVALID_WRITER_SCOPE/);
  for (const path of ['organizations/other/sourceDocuments/x', writerLeasePath('synthetic')]) {
    await assert.rejects(guardedCanonicalTransaction(f.db,'synthetic',async tx => {tx.set(f.db.doc(path),{});}),/WRITER_SCOPE_VIOLATION/);
    assert.equal(f.values.has(path),false);
  }
  assert.throws(() => writerLeasePath('../other'),/INVALID_WRITER_SCOPE/);
  assert.throws(() => writerLeasePath('synthetic','invented-other-resource'),/INVALID_WRITER_SCOPE/);
});

test('malformed lease and unavailable server time fail closed', async () => {
  const f = fixture(); f.put(writerLeasePath('synthetic'),{guardianId:WRITER_GUARDIAN_ID,orgId:'synthetic',resourceKey:CANONICAL_WRITE_RESOURCE,epoch:NaN});
  await assert.rejects(guardedCanonicalTransaction(f.db,'synthetic',async () => {}),/INVALID_LEASE_RECORD/);
  const db:any = {doc:()=>({}),runTransaction:async (fn:any)=>fn({get:async()=>({exists:false})})};
  await assert.rejects(guardedCanonicalTransaction(db,'synthetic',async () => {}),/GUARDIAN_SERVER_CLOCK_UNAVAILABLE/);
});

test('an item failure rolls back its writes and the next eligible item still commits', async () => {
  const f = fixture(), outcomes:string[]=[];
  for (const item of ['bad','good']) {
    try { await guardedCanonicalTransaction(f.db,'synthetic',async tx => {
      tx.set(f.db.doc(`organizations/synthetic/sourceDocuments/${item}`),{item});
      if (item==='bad') throw Error('DOCUMENT_INVALID');
    }); outcomes.push('COMMITTED'); } catch {outcomes.push('PENDING');}
  }
  assert.deepEqual(outcomes,['PENDING','COMMITTED']);
  assert.equal(f.values.has('organizations/synthetic/sourceDocuments/bad'),false);
  assert.equal(f.values.get(writerLeasePath('synthetic')).epoch,1);
});

test('unknown commit outcome is recovered with the old receipt, never a new identity', async () => {
  const f = fixture(), original = f.db.runTransaction;
  let loseResponse = true;
  f.db.runTransaction = async (body:any) => {
    const result = await original(body);
    if (loseResponse) {loseResponse=false;throw Error('RESPONSE_LOST_AFTER_COMMIT');}
    return result;
  };
  const call = () => guardedCanonicalTransaction(f.db,'synthetic',async tx => {
    const receipt=f.db.doc('organizations/synthetic/apiIdempotency/original-key');
    const existing=await tx.get(receipt);if(existing.exists)return 'DUPLICATE';
    tx.create(receipt,{effect:'one'});return 'ACCEPTED';
  });
  await assert.rejects(call(),/RESPONSE_LOST_AFTER_COMMIT/);
  assert.equal(await call(),'DUPLICATE'); assert.equal(f.values.size,2);
});

test('the original guarded token cannot be replayed after atomic release', async () => {
  const f = fixture(), token:WriterToken=f.reserve('synthetic','cloud-owner',3);
  await guardedCanonicalTransaction(f.db,'synthetic',async tx => {
    tx.set(f.db.doc('organizations/synthetic/sourceDocuments/one'),{version:1});
  },token);
  await assert.rejects(guardedCanonicalTransaction(f.db,'synthetic',async () => {},token),/STALE_WRITER_FENCED/);
});
