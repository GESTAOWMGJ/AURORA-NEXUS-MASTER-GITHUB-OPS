import assert from 'node:assert/strict';
import test from 'node:test';
import { Script,createContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { webUpdateClient } from '../src/auroraWebUpdateClient.js';

test('web/PWA updater checks immediately and daily, resumes after offline/hidden, and never reloads or caches private data',async()=>{
  let now=0, updates=0;const registered:any[]=[];const timers:any[]=[];const handlers=new Map<string,any>();
  const document={visibilityState:'visible',addEventListener:(n:string,h:any)=>handlers.set(n,h)};
  const navigator={onLine:true,serviceWorker:{register:async(...args:any[])=>{registered.push(args);return {update:async()=>{updates++;}};}}};
  new Script(webUpdateClient()).runInContext(createContext({document,navigator,Date:{now:()=>now},window:{addEventListener:(n:string,h:any)=>handlers.set(n,h)},setInterval:(fn:any,ms:number)=>timers.push({fn,ms})}));
  await setImmediate();assert.equal(updates,1);assert.equal(registered[0][0],'/service-worker.js');assert.equal(registered[0][1].updateViaCache,'none');
  assert.equal(timers[0].ms,86_400_000);await handlers.get('visibilitychange')();assert.equal(updates,1);
  now+=86_400_001;document.visibilityState='hidden';await timers[0].fn();assert.equal(updates,1);
  document.visibilityState='visible';navigator.onLine=false;await handlers.get('visibilitychange')();assert.equal(updates,1);
  navigator.onLine=true;await handlers.get('online')();assert.equal(updates,2);assert.equal(registered.length,1);
  assert.doesNotMatch(webUpdateClient(),/location|caches\.|localStorage|sessionStorage|fetch\(/);
});
