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
