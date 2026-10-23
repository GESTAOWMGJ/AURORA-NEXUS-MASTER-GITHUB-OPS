import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {nativeIngestionClient,nativeIngestionSection} from '../src/auroraNativeIngestionView.js';
import {documentObservationIdentity,documentObservationHash,observationAcquisitionHash,parseDocumentObservationPayload} from '../src/auroraDocumentObservation.js';
import {immutableEntityVersionId} from '../src/auroraCanonicalVersions.js';
import type {AuroraMember} from '../src/auroraAccess.js';

const member:AuroraMember={uid:'synthetic-master',email:'synthetic@example.test',orgId:'synthetic',role:'org_admin',permissions:[],facilityIds:[],allFacilities:true,mfaVerified:true};
function harness(file:any,controls:{autoPrepare?:boolean;bootstrap?:Promise<any>;endSessionAtReceipt?:boolean;mutateReceipt?:(receipt:any)=>void}={}) {
  const callbacks:Record<string,Function>={},events:Record<string,Function>={},requests:Array<{url:string;body:string;idempotency:string}>=[];
  const button={disabled:false},legacyButton={disabled:false};
  const nodes:Record<string,any>={
    'native-ingestion-status':{textContent:''},'native-ingestion-form':{elements:[legacyButton],reset(){},querySelector:()=>legacyButton,addEventListener(){}},
    'document-intake-status':{textContent:''},'document-intake-preview':{textContent:'',hidden:true},
    'document-intake-file':{files:[file]},'document-intake-consent':{checked:true},'document-intake-system':{value:'ERP'},
    'document-intake-form':{elements:[button],reset(){},querySelector:()=>button,addEventListener:(name:string,callback:Function)=>{callbacks[name]=callback;}}
  };
  const fetch=async(url:string,options:any)=>{
    if(url==='/api/bootstrap')return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>controls.bootstrap??{ok:true,organization:{id:member.orgId},installation:{state:'PENDING_SOURCE'}}};
    const raw=JSON.parse(options.body),payload=parseDocumentObservationPayload(raw);assert.ok(payload);
    assert.equal(url,'/api/integration/documents');assert.equal(options.headers['x-aurora-csrf'],'synthetic-ingest');
    requests.push({url,body:options.body,idempotency:options.headers['idempotency-key']});
    const duplicate=requests.length>1;
    const identity=documentObservationIdentity(member.orgId,payload);
    const keyId='web_'+createHash('sha256').update(member.orgId+':'+member.uid).digest('hex').slice(0,32);
    const receiptId=createHash('sha256').update('document-observation:'+keyId+':'+options.headers['idempotency-key']).digest('hex');
    const receipt={ok:true,schemaVersion:'aurora.document.observation.receipt.v1',code:'DOCUMENT_OBSERVATION_RECORDED',
      orgId:member.orgId,documentId:identity.id,receiptId,versionId:immutableEntityVersionId('sourceDocument',identity.entityKey,1),revision:1,
      observationHash:documentObservationHash(member.orgId,payload),acquisitionHash:observationAcquisitionHash(payload.acquisition),
      extractionStatus:payload.extraction.status,nativeReady:false,sourceIndependent:false,sourceVersion:null,
      firstIngestionVerified:false,operationalComplete:false,recorded:!duplicate,duplicate,accepted:false};
    controls.mutateReceipt?.(receipt);
    return {ok:true,status:duplicate?200:202,headers:{get:()=> 'application/json'},json:async()=>{
      if(controls.endSessionAtReceipt&&!duplicate){events['aurora:session-ended']!();assert.equal(options.signal.aborted,true);}
      return receipt;
    }};
  };
  runInNewContext(nativeIngestionClient(member,{ingest:'synthetic-ingest',refresh:'synthetic-refresh'},controls.autoPrepare??false),{
    document:{getElementById:(id:string)=>nodes[id]},window:{addEventListener:(name:string,callback:Function)=>{events[name]=callback;},dispatchEvent(){}},
    fetch,crypto:globalThis.crypto,TextEncoder,TextDecoder,Uint8Array,DataView,Blob,DecompressionStream,AbortController,
    setTimeout,clearTimeout,Event,console:{log(){throw Error('NO_DOCUMENT_LOGGING');}}
  });
  return {nodes,requests,events,submit:()=>callbacks.submit!({preventDefault(){}})};
}

test('manual web reads actual file bytes and persists/replays only closed observation proof',async()=>{
  const text='Sentinela privada sintética. Nenhum valor operacional validado.';
  const h=harness(new File([text],'private-name-not-for-server.txt',{type:'text/plain'}));
  await h.submit();assert.equal(h.requests.length,2);assert.equal(h.requests[0]!.body,h.requests[1]!.body);
  assert.equal(h.requests[0]!.idempotency,h.requests[1]!.idempotency);
  const payload=JSON.parse(h.requests[0]!.body);assert.equal(payload.operation,'OBSERVE_DOCUMENT_EXTRACTION');
  assert.equal(payload.acquisition.byteLength,new TextEncoder().encode(text).length);assert.equal(payload.extraction.status,'COMPLETE');
  assert.equal(payload.acquisition.provider,'MANUAL');assert.equal(payload.expectedRevision,0);
  for(const forbidden of [text,'private-name-not-for-server','raw_text','xmlLeaves','candidates','amountCents','nativeReady'])assert.equal(h.requests[0]!.body.includes(forbidden),false);
  assert.match(h.nodes['document-intake-status'].textContent,/repetição confirmada/);
  assert.match(h.nodes['document-intake-status'].textContent,/pendentes de revisão/);
  assert.match(h.nodes['document-intake-preview'].textContent,/Sentinela privada/);
  h.events.pagehide!();assert.equal(h.nodes['document-intake-preview'].textContent,'');
});
test('PDF manual records an explicit missing backend and never pretends extraction or installation',async()=>{
  const h=harness(new File(['%PDF-1.7\nsynthetic'],'synthetic.pdf',{type:'application/pdf'}));
  await h.submit();assert.equal(h.requests.length,2);
  const payload=JSON.parse(h.requests[0]!.body);assert.equal(payload.extraction.status,'PENDING');
  assert.equal(payload.extraction.code,'BACKEND_REQUIRED');assert.equal(payload.extraction.textSha256,null);
  assert.match(h.nodes['document-intake-status'].textContent,/permanecem pendentes/);
});
test('late file read after pagehide cannot send raw bytes or an observation',async()=>{
  let resolve!:Function;const delayed=new Promise<ArrayBuffer>(done=>{resolve=done;});
  const h=harness({name:'synthetic.txt',size:4,arrayBuffer:()=>delayed});
  const running=h.submit();h.events.pagehide!();resolve(new TextEncoder().encode('test').buffer);await running;
  assert.equal(h.requests.length,0);assert.equal(h.nodes['document-intake-preview'].textContent,'');
});
test('consent/size gates run before reading bytes and the UI preserves the canonical JSON path',async()=>{
  let reads=0;const h=harness({name:'oversized.txt',size:1048577,arrayBuffer:()=>{reads++;return Promise.resolve(new ArrayBuffer(1));}});
  await h.submit();assert.equal(reads,0);assert.equal(h.requests.length,0);
  const html=nativeIngestionSection(member);assert.match(html,/native-ingestion-form/);assert.match(html,/document-intake-form/);assert.match(html,/\.docx/);assert.match(html,/PDF, imagens/);
  assert.doesNotMatch(nativeIngestionSection({...member,mfaVerified:false}),/id="document-intake-form"/);
});
test('session end after first HTTP response aborts its controller and prevents replay/success',async()=>{
  const h=harness(new File(['Texto sintético'],'synthetic.txt'),{endSessionAtReceipt:true});
  await h.submit();assert.equal(h.requests.length,1);assert.equal(h.nodes['document-intake-preview'].textContent,'');
  assert.doesNotMatch(h.nodes['document-intake-status'].textContent,/repetição confirmada/);
  assert.match(h.nodes['native-ingestion-status'].textContent,/Sessão encerrada/);
});
test('manual extraction waits for the existing preparation cycle before reading or posting',async()=>{
  let release!:Function,reads=0;const bootstrap=new Promise<any>(resolve=>{release=resolve;});
  const h=harness({name:'synthetic.txt',size:4,arrayBuffer:async()=>{reads++;return new TextEncoder().encode('test').buffer;}},{autoPrepare:true,bootstrap});
  const running=h.submit();await Promise.resolve();assert.equal(reads,0);assert.equal(h.requests.length,0);
  release({ok:true,organization:{id:member.orgId},installation:{state:'PENDING_SOURCE'}});await running;
  assert.equal(reads,1);assert.equal(h.requests.length,2);
});
test('foreign receipt key, document or immutable version cannot certify manual observation',async()=>{
  for(const field of ['receiptId','documentId','versionId']){
    const h=harness(new File(['Texto sintético'],'synthetic.txt'),{mutateReceipt:receipt=>{receipt[field]='f'.repeat(field==='receiptId'?64:48);}});
    await h.submit();assert.equal(h.requests.length,1);assert.doesNotMatch(h.nodes['document-intake-status'].textContent,/repetição confirmada/);
    assert.match(h.nodes['document-intake-status'].textContent,/ainda não confirmado/);
  }
});
