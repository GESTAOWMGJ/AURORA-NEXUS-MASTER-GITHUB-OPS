import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPage } from '../src/auroraSetup.ts';
import vm from 'node:vm';
test('setup escapes organization identity and never exposes credential inputs',()=>{
 const html=setupPage({orgId:'<script>alert(1)</script>',mfaVerified:false});
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>alert(1)</script>'));
 assert.ok(!html.includes('type="password"'));
 assert.ok(html.includes('Segundo fator não confirmado'));
});
test('setup separates membership, network proof and physical installation',()=>{
 const html=setupPage({orgId:'synthetic',mfaVerified:true});
 assert.ok(html.includes('Segundo fator confirmado'));
 assert.ok(html.includes("fetch('/api/bootstrap'"));
 assert.ok(html.includes("cache:'no-store'"));
 assert.ok(html.includes('não comprova ingestão ou sincronização'));
 assert.ok(html.includes('ainda não está disponível'));
});

import {companyEntry,isCompanySlug} from '../src/auroraTenantEntry.ts';
test('setup is a reserved application route, never a tenant selector',()=>{assert.equal(companyEntry('/setup'),null);assert.equal(isCompanySlug('setup'),false);});

const proof={state:'FIRST_INGESTION_VERIFIED',firstIngestionVerified:true,documentId:'a'.repeat(48),sourceVersion:1,revision:1,versionId:'b'.repeat(48),canonicalSnapshotHash:'c'.repeat(64),sourceSystem:'ERP',verifiedAt:'2026-10-08T05:00:00Z'};
const payload=(installation:any=proof,org='synthetic')=>({ok:true,organization:{id:org},installation});
const committed=(installation:any={...proof,operationalComplete:true},orgId='synthetic')=>({ok:true,orgId,installation});
const response=(data:any,status=200,contentType='application/json')=>({status,ok:status===200,headers:{get:()=>contentType},json:async()=>data});
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve))};
async function wizard(replies:any[],csrf='session-bound-synthetic-csrf'){
 const html=setupPage({orgId:'synthetic',mfaVerified:true},csrf);
 const script=html.match(/<script>([\s\S]*?)<\/script>/i)![1];
 const callbacks:any={},nodes:any=Object.fromEntries(['check','connection','complete','ingestion'].map(id=>[id,{disabled:true,textContent:'',addEventListener(_event:string,cb:any){callbacks[id]=cb}}]));
 const calls:any[]=[],timers=new Map<number,()=>void>(),navigations:string[]=[];let timerId=0;
 const context={document:{getElementById:(id:string)=>nodes[id]},fetch:async(url:string,options:any)=>{
  calls.push({url,options});const item=replies.length>1?replies.shift():replies[0];
  if(item instanceof Error)throw item;
  return typeof item==='function'?item(url,options):item;
 },AbortSignal,setTimeout:(cb:()=>void,delay:number)=>{assert.equal(delay,5000);timers.set(++timerId,cb);return timerId},clearTimeout:(id:number)=>{timers.delete(id)},window:{location:{assign:(url:string)=>navigations.push(url)}}};
 vm.runInNewContext(script,context);await flush();
 return {html,nodes,calls,timers,callbacks,navigations,tick:async()=>{const next=timers.entries().next().value;if(next){timers.delete(next[0]);next[1]();await flush()}}};
}
test('wizard starts readback automatically but requires a tenant completion receipt',async()=>{
 const result=await wizard([response(payload()),response(committed())]);
 assert.ok(result.html.includes('id="complete" type="button" disabled'));
 assert.equal(result.nodes.complete.disabled,false);
 assert.deepEqual(result.calls.map(c=>c.url),['/api/bootstrap','/api/refresh']);
 const request=result.calls[1].options;
 assert.equal(request.method,'POST');assert.equal(request.credentials,'same-origin');assert.equal(request.redirect,'error');assert.equal(request.cache,'no-store');
 assert.equal(request.headers['x-aurora-csrf'],'session-bound-synthetic-csrf');
 assert.deepEqual(JSON.parse(request.body),{operation:'COMPLETE_INSTALLATION'});
 result.callbacks.complete();assert.deepEqual(result.navigations,['/portal']);
});
test('pending projection resumes existing refresh then rereads before completion',async()=>{
 const result=await wizard([response(payload({state:'PENDING_PROJECTION'})),response({ok:true,projection:{}}),response(payload()),response(committed())]);
 assert.deepEqual(result.calls.map(c=>c.url),['/api/bootstrap','/api/refresh','/api/bootstrap','/api/refresh']);
 assert.deepEqual(JSON.parse(result.calls[1].options.body),{});
 assert.equal(result.nodes.complete.disabled,false);
});
test('pending sources and canonical data never trigger refresh or completion',async()=>{
 for(const state of ['PENDING_SOURCE','PENDING_CANONICAL_DATA']){
  const result=await wizard([response(payload({state}))]);
  assert.equal(result.calls.length,1);assert.equal(result.nodes.complete.disabled,true);
  result.callbacks.complete();assert.deepEqual(result.navigations,[]);
 }
});
test('malformed or stale first-ingestion evidence never starts completion',async()=>{
 for(const installation of [undefined,{...proof,sourceVersion:0},{...proof,verifiedAt:null},{...proof,revision:0},{...proof,versionId:null},{...proof,canonicalSnapshotHash:'bad'},{...proof,sourceSystem:''}]){
  const result=await wizard([response(payload(installation??null))]);
  assert.equal(result.calls.length,1);assert.equal(result.nodes.complete.disabled,true);
 }
});
test('missing, foreign or expired session proof blocks writes and polling',async()=>{
 for(const reply of [response(payload(proof,'foreign')),response({ok:true,installation:proof}),response(payload(),401),response(payload(),403)]){
  const result=await wizard([reply]);assert.equal(result.calls.length,1);assert.equal(result.nodes.complete.disabled,true);assert.equal(result.timers.size,0);
 }
 const noCsrf=await wizard([response(payload())],'');
 assert.equal(noCsrf.calls.length,1);assert.equal(noCsrf.nodes.complete.disabled,true);assert.equal(noCsrf.timers.size,0);
});
test('completion stays disabled on uncommitted, foreign or mismatching receipts',async()=>{
 for(const result of [{ok:true},committed({...proof,operationalComplete:false}),committed({...proof,operationalComplete:true,sourceVersion:2}),
 committed({...proof,operationalComplete:true,documentId:'d'.repeat(48)}),committed({...proof,operationalComplete:true,revision:2}),
 committed({...proof,operationalComplete:true,versionId:'d'.repeat(48)}),committed({...proof,operationalComplete:true,canonicalSnapshotHash:'d'.repeat(64)}),
 committed({...proof,operationalComplete:true,sourceSystem:'MV'}),committed(undefined,'foreign')]){
  const wizardResult=await wizard([response(payload()),response(result)]);
  assert.equal(wizardResult.nodes.complete.disabled,true);wizardResult.callbacks.complete();assert.deepEqual(wizardResult.navigations,[]);
 }
});
test('access denied during projection stops automatic retries',async()=>{
 for(const status of [401,403]){
  const result=await wizard([response(payload({state:'PENDING_PROJECTION'})),response({ok:false},status)]);
  assert.equal(result.calls.length,2);assert.equal(result.timers.size,0);assert.equal(result.nodes.complete.disabled,true);
 }
});
test('automatic polling is bounded to twelve sequential attempts',async()=>{
 // Supply a route-aware responder for all bootstrap/refresh requests.
 // Each attempt performs bootstrap, one refresh, then readback, without parallel calls.
 // A perpetually pending response never issues COMPLETE_INSTALLATION.
 const pending=await wizard([(url:string)=>response(url==='/api/bootstrap'?payload({state:'PENDING_PROJECTION'}):{ok:true})]);
 for(let i=0;i<20;i++)await pending.tick();
 assert.equal(pending.calls.filter(c=>c.url==='/api/refresh').length,12);
 assert.equal(pending.calls.filter(c=>c.url==='/api/bootstrap').length,24);
 assert.equal(pending.timers.size,0);assert.equal(pending.nodes.complete.disabled,true);
});
test('network errors are bounded and never turn readiness into success',async()=>{
 const result=await wizard([new Error('NETWORK')]);for(let i=0;i<20;i++)await result.tick();
 assert.equal(result.calls.length,12);assert.equal(result.timers.size,0);assert.equal(result.nodes.complete.disabled,true);
});
test('manual checking cannot create competing refresh requests',async()=>{
 let release:any;
 const pending=await wizard([response(payload({state:'PENDING_PROJECTION'})),()=>new Promise(resolve=>{release=resolve}),response(payload()),response(committed())]);
 assert.equal(pending.calls.length,2);
 pending.callbacks.check();pending.callbacks.check();await flush();
 assert.equal(pending.calls.length,2);assert.equal(pending.nodes.complete.disabled,true);
 release(response({ok:true}));await flush();
 assert.equal(pending.calls.length,4);assert.equal(pending.nodes.complete.disabled,false);
});
test('finish remains disabled while the server commits and on non-JSON completion',async()=>{
 let release:any;
 const result=await wizard([response(payload()),()=>new Promise(resolve=>{release=resolve})]);
 assert.equal(result.calls.length,2);assert.equal(result.nodes.complete.disabled,true);
 result.callbacks.complete();assert.deepEqual(result.navigations,[]);
 result.callbacks.check();await flush();assert.equal(result.calls.length,2);
 release(response(committed()));await flush();assert.equal(result.nodes.complete.disabled,false);
 const nonJson=await wizard([response(payload()),response(committed(),200,'text/html')]);
 assert.equal(nonJson.nodes.complete.disabled,true);
});
test('projection readback revalidates tenant before attempting completion',async()=>{
 const result=await wizard([response(payload({state:'PENDING_PROJECTION'})),response({ok:true}),response(payload(proof,'foreign'))]);
 assert.equal(result.calls.length,3);assert.equal(result.nodes.complete.disabled,true);assert.equal(result.timers.size,0);
});
test('CSRF template is safely embedded and no transport credential storage is introduced',()=>{
 const html=setupPage({orgId:'synthetic',mfaVerified:true},'</script><script>bad()</script>');
 assert.ok(!html.includes('</script><script>bad()'));
 assert.ok(html.includes('\\u003c/script>'));
 assert.doesNotMatch(html,/localStorage|Bearer/);
 assert.ok(html.includes("fetch('/api/refresh'"));
});
