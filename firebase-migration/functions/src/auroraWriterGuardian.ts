import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { arbitrateWriter, DEFAULTS, hashPayload } from './realtimePlatformGuardian.js';

export const WRITER_GUARDIAN_ID = 'AURORA-REALTIME-PLATFORM-GUARDIAN-001';
// Deliberately conservative first migration: all canonical data writes for one
// tenant share one resource. Never derive the lease from an idempotency key.
export const CANONICAL_WRITE_RESOURCE = 'canonical-data';
export type WriterToken = { orgId: string; resourceKey: string; ownerId: string; epoch: number };
export class WriterLeaseError extends Error {
  readonly status = 503;
  constructor(readonly code: string) { super(code); this.name = 'WriterLeaseError'; }
}

export function writerLeasePath(orgId: string, resourceKey = CANONICAL_WRITE_RESOURCE): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(orgId) || resourceKey !== CANONICAL_WRITE_RESOURCE) {
    throw new WriterLeaseError('INVALID_WRITER_SCOPE');
  }
  return `organizations/${orgId}/runtimeLocks/platform-guardian-${hashPayload({ orgId, resourceKey })}`;
}

function clockFromSnapshot(snapshot: { readTime: { toMillis(): number } }): number {
  const now = snapshot.readTime?.toMillis();
  if (!Number.isFinite(now)) throw new WriterLeaseError('GUARDIAN_SERVER_CLOCK_UNAVAILABLE');
  return now;
}

/**
 * Transactional effects only. No HTTP/provider/file effects inside body: the
 * Firestore SDK may retry it. Existing receipt/idempotency logic stays in body.
 * A read conflict with a takeover reruns this callback and fences an old token.
 * This is not a lease endpoint and does not accept authority from request JSON.
 */
export async function guardedCanonicalTransaction<T>(db: Firestore, orgId: string,
  body: (tx: Transaction) => Promise<T>, token?: WriterToken): Promise<T> {
  const resourceKey = CANONICAL_WRITE_RESOURCE;
  const path = writerLeasePath(orgId, resourceKey), ref = db.doc(path);
  if (token && (token.orgId !== orgId || token.resourceKey !== resourceKey)) {
    throw new WriterLeaseError('INVALID_WRITER_SCOPE');
  }
  const ownerId = token?.ownerId ?? randomUUID();
  return db.runTransaction(async tx => {
    const started = performance.now();
    const snap = await tx.get(ref), now = clockFromSnapshot(snap);
    const current = snap.exists ? snap.data() : undefined;
    if (current && (current.guardianId !== WRITER_GUARDIAN_ID || current.orgId !== orgId
      || current.resourceKey !== resourceKey || !['LOCKED','RELEASED'].includes(current.state))) throw new WriterLeaseError('INVALID_LEASE_RECORD');
    const decision = arbitrateWriter({ currentLease: current, candidatePlatform: 'CLOUD_CONTROL_PLANE',
      candidateId: ownerId, expectedEpoch: token?.epoch, now, ttlMs: DEFAULTS.leaseTtlMs });
    if (!decision.allowed || !decision.lease) throw new WriterLeaseError(decision.code);
    let writes = 0;
    const guardedTx = new Proxy(tx, {
      get(target, name) {
        const value = Reflect.get(target, name, target);
        if (['create', 'set', 'update', 'delete'].includes(String(name))) {
          return (...args: any[]) => {
            const destination = args[0]?.path;
            if (typeof destination !== 'string' || !destination.startsWith(`organizations/${orgId}/`)
              || destination.includes('/runtimeLocks/')) throw new WriterLeaseError('WRITER_SCOPE_VIOLATION');
            writes++;
            Reflect.apply(value, target, args);
            return guardedTx;
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const result = await body(guardedTx);
    if (writes) {
      // Never use a device wall clock. Server read time plus monotonic elapsed
      // time is conservative (includes the snapshot request latency).
      const end = now + Math.ceil(performance.now() - started);
      if (end >= decision.lease.expiresAt) throw new WriterLeaseError('STALE_WRITER_FENCED');
      // Atomic release with business effects. Epoch is retained permanently;
      // a failed callback commits neither effects nor a lease. An uncertain
      // commit is reconciled by the ORIGINAL receipt on the next request.
      tx.set(ref, { ...decision.lease, guardianId: WRITER_GUARDIAN_ID, version: '1.1.0',
        orgId, resourceKey, state: 'RELEASED', expiresAt: end, completedAt: end });
    }
    return result;
  });
}
