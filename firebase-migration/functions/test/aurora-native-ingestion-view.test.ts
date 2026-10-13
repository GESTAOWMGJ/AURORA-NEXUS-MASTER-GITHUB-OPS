import test from 'node:test';
import assert from 'node:assert/strict';
import {Script,createContext} from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import {nativeIngestionClient} from '../src/auroraNativeIngestionView.ts';
const member={uid:'synthetic',email:'synthetic@example.test',orgId:'synthetic-org',role:'org_admin',permissions:[],facilityIds:[],allFacilities:true,mfaVerified:true};
const proof={state:'FIRST_INGESTION_VERIFIED',firstIngestionVerified:true,documentId:'a'.repeat(48),sourceVersion:1,revision:1,versionId:'b'.repeat(48),canonicalSnapshotHash:'c'.repeat(64),sourceSystem:'ERP',verifiedAt:'2026-10-13T00:00:00Z',operationalComplete:false};
async function run(responses:any[]){
 const status={textContent:''},form={addEventListener(){},reset(){},elements:[]},calls:any[]=[];
 const context=createContext({document:{getElementById:(id:string)=>id==='native-ingestion-status'?status:form},window:{addEventListener(){}},AbortController,setTimeout:()=>1,clearTimeout(){},Date,fetch:async(url:string,options:any)=>{calls.push({url,options});return {status:200,ok:true,headers:{get:()=> 'application/json'},json:async()=>responses.shift()}}});
 new Script(nativeIngestionClient(member,{ingest:'synthetic-ingest',refresh:'synthetic-refresh'})).runInContext(context);await setImmediate();return {status,calls};
}
test('first login completes only the same tenant and immutable processed version',async()=>{
 const {status,calls}=await run([{ok:true,organization:{id:member.orgId},installation:proof},{ok:true,orgId:member.orgId,installation:{...proof,operationalComplete:true}}]);
 assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].options.body).operation,'COMPLETE_INSTALLATION');assert.match(status.textContent,/operação preparada/);
});
test('a different completion version never becomes ready',async()=>{
 const {status}=await run([{ok:true,organization:{id:member.orgId},installation:proof},{ok:true,orgId:member.orgId,installation:{...proof,sourceVersion:2,operationalComplete:true}}]);assert.match(status.textContent,/Preparação pendente/);
});
test('foreign tenant stops before any installation write',async()=>{
 const {status,calls}=await run([{ok:true,organization:{id:'other-org'},installation:proof}]);assert.equal(calls.length,1);assert.match(status.textContent,/Sessão encerrada/);
});
test('missing native CSRF configuration emits no automatic requests',()=>{assert.equal(nativeIngestionClient(member,{ingest:'',refresh:'synthetic'}),'')});

import {webcrypto} from 'node:crypto';
function importHarness(fetcher:(url:string,options:any)=>Promise<any>,autoPrepare=true){
 const status={textContent:''},button={disabled:false},file={size:100,text:async()=>JSON.stringify({sourceVersion:1})};
 const handlers:Record<string,Function>={},events:Record<string,Function>={};
 const form={addEventListener:(name:string,handler:Function)=>{handlers[name]=handler},reset(){},elements:[],querySelector:()=>button};
 const nodes:Record<string,any>={'native-ingestion-status':status,'native-ingestion-form':form,'native-ingestion-file':{files:[file]},'native-ingestion-consent':{checked:true}};
 const context=createContext({document:{getElementById:(id:string)=>nodes[id]},window:{addEventListener:(name:string,handler:Function)=>{events[name]=handler},dispatchEvent(){}},AbortController,setTimeout:()=>1,clearTimeout(){},Date,Event,TextEncoder,crypto:webcrypto,fetch:fetcher});
 new Script(nativeIngestionClient(member,{ingest:'synthetic-ingest',refresh:'synthetic-refresh'},autoPrepare)).runInContext(context);
 return {status,button,file,nodes,events,submit:()=>handlers.submit({preventDefault(){}})};
}
const response=(data:any,status=200)=>({ok:status>=200&&status<300,status,headers:{get:()=> 'application/json'},json:async()=>data});
const pending=()=>response({ok:true,organization:{id:member.orgId},installation:{state:'PENDING_SOURCE'}});
const accepted=()=>response({ok:true,orgId:member.orgId,accepted:true,documentId:'a'.repeat(48),sourceVersion:1});
test('submit during bootstrap is retained and sent once after the check',async()=>{
 let release!:(value:any)=>void;let reads=0;const posts:any[]=[];
 const h=importHarness(async(url,options)=>{if(url==='/api/bootstrap'){if(++reads===1)return new Promise(resolve=>{release=resolve});return pending()}posts.push(options);return accepted()});
 const submission=h.submit();assert.match(h.status.textContent,/Aguardando/);assert.equal(h.button.disabled,true);
 await h.submit();release(pending());await submission;
 assert.equal(posts.length,1);assert.match(h.status.textContent,/1 registro\(s\) com recibo/);
});
test('reading the selected file immediately shows progress',async()=>{
 let release!:(value:string)=>void;const h=importHarness(async()=>accepted(),false);
 h.file.text=()=>new Promise(resolve=>{release=resolve});const submission=h.submit();
 assert.match(h.status.textContent,/Lendo/);release('{"sourceVersion":1}');await submission;
});
test('payload rejection shows safe reason and retains receipt count',async()=>{
 let writes=0;const h=importHarness(async()=>++writes===1?accepted():response({ok:false,code:'INVALID_DOCUMENT_PAYLOAD',secret:'never-display'},400),false);
 h.file.text=async()=>JSON.stringify([{sourceVersion:1},{sourceVersion:1}]);await h.submit();
 assert.match(h.status.textContent,/1 registro\(s\) com recibo/);assert.match(h.status.textContent,/formato/);assert.doesNotMatch(h.status.textContent,/never-display/);
});
test('logout while waiting never sends the queued document',async()=>{
 let release!:(value:any)=>void;let writes=0;
 const h=importHarness(async(url)=>url==='/api/bootstrap'?new Promise(resolve=>{release=resolve}):(writes++,accepted()));
 const submission=h.submit();h.events['aurora:session-ended']();release(pending());await submission;
 assert.equal(writes,0);assert.match(h.status.textContent,/Sessão encerrada/);
});
test('received documents awaiting review never revert to the empty source prompt',async()=>{
 const {status}=await run([{ok:true,organization:{id:member.orgId},installation:{state:'PENDING_CANONICAL_DATA'}}]);
 assert.match(status.textContent,/Documentos recebidos; validação/);assert.doesNotMatch(status.textContent,/Conecte uma fonte/);
});
test('lost response can resume with the identical idempotency key',async()=>{
 const keys:string[]=[];const h=importHarness(async(_url,options)=>{keys.push(options.headers['idempotency-key']);if(keys.length===1)throw Error('network');return response({ok:true,orgId:member.orgId,duplicate:true,documentId:'a'.repeat(48),sourceVersion:1})},false);
 await h.submit();assert.match(h.status.textContent,/0 registro\(s\) com recibo/);await h.submit();
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.match(h.status.textContent,/1 registro\(s\) com recibo/);
});
