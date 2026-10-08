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

test('wizard starts readback automatically and only completes for a fresh tenant proof',async()=>{
 const html=setupPage({orgId:'synthetic',mfaVerified:true});
 assert.ok(html.includes('id="complete" type="button" disabled'));
 const script=html.match(/<script>([\s\S]*?)<\/script>/i)![1];
 const run=async(data:any,status=200)=>{
  const nodes:any=Object.fromEntries(['check','connection','complete','ingestion'].map(id=>[id,{disabled:true,textContent:'',addEventListener(){}}]));
  let fetches=0;
  const context={document:{getElementById:(id:string)=>nodes[id]},fetch:async()=>{fetches++;return {status,ok:status===200,headers:{get:()=> 'application/json'},json:async()=>data};},AbortSignal,setTimeout:()=>0,clearTimeout(){},window:{location:{assign(){}}}};
  vm.runInNewContext(script,context); await new Promise(resolve=>setImmediate(resolve));
  return {nodes,fetches};
 };
 const proof={state:'FIRST_INGESTION_VERIFIED',firstIngestionVerified:true,documentId:'a'.repeat(48),sourceVersion:1,verifiedAt:'2026-10-08T05:00:00Z'};
 const payload={ok:true,organization:{id:'synthetic'},installation:proof};
 assert.equal((await run(payload)).nodes.complete.disabled,false);
 for(const data of [{...payload,installation:undefined},{...payload,organization:{id:'foreign'}},
  {...payload,installation:{...proof,sourceVersion:0}},{...payload,installation:{...proof,verifiedAt:null}}]){
  const result=await run(data);assert.equal(result.fetches,1);assert.equal(result.nodes.complete.disabled,true);
 }
 assert.equal((await run(payload,401)).nodes.complete.disabled,true);
});
