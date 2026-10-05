import assert from 'node:assert/strict';
import test from 'node:test';
import { Script, createContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { webUpdateClient } from '../src/auroraWebUpdateClient.js';

const DAY = 86_400_000;
const RETRY = 900_000;

function harness(options: { register?: () => Promise<any>; update?: () => Promise<void> } = {}) {
  let now = 0, updates = 0, timerId = 0;
  const registrations: any[] = [];
  const timers = new Map<number, { fn: () => Promise<void>; due: number; interval?: number }>();
  const handlers = new Map<string, () => Promise<void>>();
  const document = { visibilityState: 'visible', addEventListener: (n: string, h: any) => handlers.set(n, h) };
  const registration = { update: async () => { updates++; await options.update?.(); } };
  const navigator = { onLine: true, serviceWorker: { register: async (...args: any[]) => {
    registrations.push(args);
    return options.register ? options.register() : registration;
  } } };
  new Script(webUpdateClient()).runInContext(createContext({
    document, navigator, Date: { now: () => now },
    window: { addEventListener: (n: string, h: any) => handlers.set(n, h) },
    setTimeout: (fn: () => Promise<void>, delay: number) => {
      const id = ++timerId; timers.set(id, { fn, due: now + delay }); return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: (fn: () => Promise<void>, interval: number) => {
      const id = ++timerId; timers.set(id, { fn, due: now + interval, interval }); return id;
    }
  }));
  return {
    document, navigator, registrations, timers, handlers,
    updates: () => updates,
    remaining: () => [...timers.values()].map(t => t.due - now),
    advance: async (ms: number) => {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now && timers.delete(id)) {
          await timer.fn();
          if (timer.interval) timers.set(id, { ...timer, due: now + timer.interval });
        }
      }
      await setImmediate();
    }
  };
}

test('web/PWA checks immediately, then daily, without forced reload or private cache', async () => {
  const h = harness(); await setImmediate();
  assert.equal(h.updates(), 1);
  assert.equal(h.registrations[0][0], '/service-worker.js');
  assert.equal(h.registrations[0][1].updateViaCache, 'none');
  assert.deepEqual(h.remaining(), [DAY]);
  await h.handlers.get('visibilitychange')!();
  await h.advance(DAY - 1); assert.equal(h.updates(), 1);
  await h.advance(1); assert.equal(h.updates(), 2);
  assert.equal(h.registrations.length, 1);
  assert.deepEqual(h.remaining(), [DAY]);
  assert.doesNotMatch(webUpdateClient(), /location|caches\.|localStorage|sessionStorage|fetch\(/);
});

test('registration failure retries after 15 minutes without a foreground or online event', async () => {
  let calls = 0, updates = 0;
  const h = harness({ register: async () => {
    if (++calls === 1) throw new Error('transient');
    return { update: async () => { updates++; } };
  } });
  await setImmediate();
  assert.deepEqual(h.remaining(), [RETRY]);
  await h.advance(RETRY - 1); assert.equal(calls, 1);
  await h.advance(1);
  assert.equal(calls, 2); assert.equal(updates, 1);
  assert.deepEqual(h.remaining(), [DAY]);
});

test('update failures retry at bounded intervals and restore the daily cadence on success', async () => {
  let attempts = 0;
  const h = harness({ update: async () => { if (++attempts <= 2) throw new Error('transient'); } });
  await setImmediate();
  await h.advance(RETRY); assert.equal(h.updates(), 2);
  assert.deepEqual(h.remaining(), [RETRY]);
  await h.advance(RETRY); assert.equal(h.updates(), 3);
  assert.equal(h.registrations.length, 1);
  assert.deepEqual(h.remaining(), [DAY]);
});

test('hidden and offline clients pause; foreground and reconnect resume with one timer', async () => {
  const h = harness(); await setImmediate();
  h.document.visibilityState = 'hidden';
  await h.advance(DAY); assert.equal(h.updates(), 1); assert.equal(h.timers.size, 0);
  h.document.visibilityState = 'visible'; h.navigator.onLine = false;
  await h.handlers.get('visibilitychange')!(); assert.equal(h.updates(), 1);
  h.navigator.onLine = true;
  await h.handlers.get('online')!(); assert.equal(h.updates(), 2);
  assert.deepEqual(h.remaining(), [DAY]);
});

test('overlapping events cannot create concurrent updates or duplicate retry timers', async () => {
  let finish!: () => void;
  const h = harness({ update: () => new Promise<void>(resolve => { finish = resolve; }) });
  await setImmediate();
  await h.handlers.get('online')!();
  await h.handlers.get('visibilitychange')!();
  assert.equal(h.updates(), 1); assert.equal(h.timers.size, 0);
  finish(); await setImmediate();
  assert.deepEqual(h.remaining(), [DAY]);
});

test('unsupported clients exit without scheduling work', () => {
  new Script(webUpdateClient()).runInContext(createContext({ navigator: {} }));
});
