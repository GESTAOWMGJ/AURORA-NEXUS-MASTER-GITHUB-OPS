// Offline synthetic browser test in a NEW disposable profile. Never attach to a
// user browser, login, document folder, credential store or deployed environment.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {pdfTextBrowserClientSource} from '../functions/src/auroraDocumentPdfBrowser.ts';
import {documentIntakeClientEngine,createDocumentIntakeEngine} from '../functions/src/auroraDocumentIntakeCore.ts';
import {PDF_TEXT_ASSETS} from '../functions/src/auroraDocumentPdfAssets.ts';
import {createRequire} from 'node:module';
const {extractPdfText:nodePdf}=createRequire(import.meta.url)('../../aurora-coletor/document_pdf_node.cjs');
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
if(args.length!==4||!args.includes('--browser-executable')||!args.includes('--output'))throw Error('EXPLICIT_BROWSER_AND_OUTPUT_REQUIRED');
const executable=resolve(option('--browser-executable')),output=resolve(option('--output'));
await mkdir(output,{recursive:true});
const profile=resolve(output,'browser-profile-'+randomUUID());await mkdir(profile);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),assets=resolve(root,'aurora-coletor');
const nonce=randomUUID(),requests=[];
function pdf(texts,imageOnly=false){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],kids=[];
  for(const text of texts){const page=objects.length+1; kids.push(page);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 3 0 R >> ${imageOnly?`/XObject << /Im0 ${page+2} 0 R >>`:''} >> /Contents ${page+1} 0 R >>`);
    const literal=text.replace(/[\\()]/g,'\\$&').replace(/[\u0080-\u00ff]/g,char=>'\\'+char.charCodeAt(0).toString(8).padStart(3,'0'));
    const content=imageOnly?'q 20 0 0 20 0 0 cm /Im0 Do Q':`BT /F1 12 Tf 20 300 Td (${literal}) Tj ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    if(imageOnly)objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nRGB\nendstream');}
  objects[1]=`<< /Type /Pages /Kids [${kids.map(id=>id+' 0 R').join(' ')}] /Count ${texts.length} >>`;
  let raw='%PDF-1.7\n',offsets=[];objects.forEach((body,index)=>{offsets.push(raw.length);raw+=`${index+1} 0 obj\n${body}\nendobj\n`;});
  const xref=raw.length;raw+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  raw+=offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
  return Array.from(Buffer.from(raw+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
}
const cases=[{name:'actual_two_page_text',bytes:pdf(['Aurora synthetic invoice text','Gestão Café']),status:'PARTIAL',code:'BOUNDED_EXTRACTION_PARTIAL'},
  {name:'no_text_requires_ocr',bytes:pdf([''],true),status:'PENDING',code:'BACKEND_REQUIRED'},
  {name:'page_budget',bytes:pdf(Array(33).fill('small')),status:'FAILED',code:'LIMIT_EXCEEDED'},
  {name:'malformed',bytes:Array.from(Buffer.from('%PDF-1.7\nsynthetic malformed')),status:'FAILED',code:'MALFORMED_DOCUMENT'},
  {name:'encrypted',bytes:Array.from(await readFile(resolve(root,'firebase-migration/functions/test/fixtures/document-intake/password-synthetic.pdf'))),status:'FAILED',code:'ENCRYPTED_DOCUMENT'}];
const script=`${documentIntakeClientEngine()}\n${pdfTextBrowserClientSource()}\n(async()=>{
 const proofs=[];for(const item of ${JSON.stringify(cases)}){
 const result=await documentIntakeEngine.extract(new Uint8Array(item.bytes),'application/pdf',{extractPdfText});
 proofs.push({name:item.name,status:result.extraction.status,code:result.extraction.code,method:result.extraction.method,
  pages:result.extraction.coverage.processedUnits,textSha256:result.extraction.textSha256,
  textMatches:item.name==='actual_two_page_text'?result.text.includes('Aurora synthetic invoice text')&&result.text.includes('Gestão Café'):result.text==='',
  passed:result.extraction.status===item.status&&result.extraction.code===item.code});
 }
 const NativeWorker=globalThis.Worker;let created=0,terminated=0;
 globalThis.Worker=class extends NativeWorker{
  constructor(...args){super(...args);created++;}
  postMessage(){} // Real backend worker waits idle; simulate a lost response.
  terminate(){terminated++;return super.terminate();}
 };
 let deadlineCode;try{await extractPdfText(new Uint8Array(${JSON.stringify(cases[0].bytes)}));}
 catch(error){deadlineCode=error.message;}finally{globalThis.Worker=NativeWorker;}
 const deadline={code:deadlineCode,created,terminated,passed:deadlineCode==='LIMIT_EXCEEDED'&&created===1&&terminated===1};
 window.auroraPdfProof={cases:proofs,deadline,allPassed:proofs.every(proof=>proof.passed&&proof.textMatches)&&deadline.passed};
})().catch(()=>{window.auroraPdfProof={allPassed:false,error:'BROWSER_HARNESS_FAILED'}});`;
const server=createServer(async(req,res)=>{
  requests.push(req.url);res.setHeader('Cache-Control','no-store');
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; worker-src 'self'; object-src 'none'`);
    res.end(`<html><body>Offline Aurora synthetic PDF test<script nonce="${nonce}">${script.replaceAll('</script','<\\/script')}</script></body></html>`);return;}
  const name=String(req.url).replace('/assets/document-intake/','');
  if(req.url!=='/assets/document-intake/'+name||!Object.hasOwn(PDF_TEXT_ASSETS.files,name)){res.statusCode=404;res.end();return;}
  if(name==='document_pdf_runtime.mjs')res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'");
  res.setHeader('Content-Type',name.endsWith('.mjs')?'application/javascript':name.endsWith('.json')?'application/json':'application/octet-stream');
  res.end(await readFile(resolve(assets,name)));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
let child,socket;
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
try{
  child=spawn(executable,['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run',
    '--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;
  for(let count=0;count<100;count++){try{port=Number((await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await sleep(100);}}
  if(!port)throw Error('ISOLATED_BROWSER_DEBUG_ENDPOINT_UNAVAILABLE');
  const endpoint=await (await fetch('http://127.0.0.1:'+port+'/json/version')).json();
  socket=new WebSocket(endpoint.webSocketDebuggerUrl);await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});
  let next=0;const pending=new Map(),workerTargets=new Set(),workerDestroyed=new Set(),workerSessions=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));
    if(message.method==='Target.targetCreated'&&message.params.targetInfo.type==='worker'&&message.params.targetInfo.url.startsWith(origin))workerTargets.add(message.params.targetInfo.targetId);
    if(message.method==='Target.targetDestroyed'&&workerTargets.has(message.params.targetId))workerDestroyed.add(message.params.targetId);
    if(message.method==='Target.attachedToTarget'&&message.params.targetInfo.type==='worker'){
      workerTargets.add(message.params.targetInfo.targetId);workerSessions.set(message.params.sessionId,message.params.targetInfo.targetId);}
    if(message.method==='Target.detachedFromTarget'&&workerSessions.has(message.params.sessionId))workerDestroyed.add(workerSessions.get(message.params.sessionId));
    if(message.id){const item=pending.get(message.id);pending.delete(message.id);message.error?item.reject(Error('BROWSER_PROTOCOL_ERROR')):item.resolve(message.result);}});
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Target.setDiscoverTargets',{discover:true});
  await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'worker',exclude:false}]},sessionId);
  await call('Page.enable',{},sessionId);await call('Page.navigate',{url:origin},sessionId);
  let proof;
  for(let count=0;count<300;count++){await sleep(100);const result=await call('Runtime.evaluate',{expression:'window.auroraPdfProof??null',returnByValue:true},sessionId);proof=result.result.value;if(proof)break;}
  if(!proof)throw Error('BROWSER_PROOF_TIMEOUT');
  for(let count=0;count<30&&workerDestroyed.size<workerTargets.size;count++)await sleep(100);
  proof.workerTargets={created:workerTargets.size,destroyed:workerDestroyed.size,active:workerTargets.size-workerDestroyed.size};
  proof.allPassed=proof.allPassed&&proof.workerTargets.created===6&&proof.workerTargets.active===0;
  const nodeCases=[];for(const item of cases){const result=await createDocumentIntakeEngine().extract(new Uint8Array(item.bytes),'application/pdf',{extractPdfText:nodePdf});
    const browser=proof.cases.find(row=>row.name===item.name);
    nodeCases.push({name:item.name,status:result.extraction.status,code:result.extraction.code,textSha256:result.extraction.textSha256,
      parity:browser?.status===result.extraction.status&&browser?.code===result.extraction.code&&browser?.textSha256===result.extraction.textSha256});}
  proof.nodeCases=nodeCases;proof.allPassed=proof.allPassed&&nodeCases.every(row=>row.parity);
  const receipt={schemaVersion:'aurora.pdf.synthetic.browser.v1',observedAt:new Date().toISOString(),browser:endpoint.Browser,
    sourceCommit:'WORKING_TREE_CANDIDATE',profile:PDF_TEXT_ASSETS.profile,
    runtimeSha256:PDF_TEXT_ASSETS.files['document_pdf_runtime.mjs'].sha256,
    privateUserProfileUsed:false,credentialUsed:false,realDocumentsUsed:false,runtimeRemoteBackend:false,
    sameOriginAssetRequests:requests.filter(url=>url!=='/favicon.ico'),...proof};
  await writeFile(resolve(output,'browser-proof.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({allPassed:proof.allPassed,cases:proof.cases?.length??0,receipt:resolve(output,'browser-proof.json'),sha256:createHash('sha256').update(await readFile(resolve(output,'browser-proof.json'))).digest('hex')}));
  if(!proof.allPassed)process.exitCode=1;
  await call('Browser.close');
}finally{socket?.close();child?.kill();server.close();}
