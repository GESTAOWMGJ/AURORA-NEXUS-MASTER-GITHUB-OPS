// Fixed, text-only PDF.js profile. Runs ONLY in a disposable browser/Node worker.
// Never render, enumerate/execute actions, use document URLs, or fetch a backend.
const MAX_BYTES=1048576,MAX_TEXT=262144,MAX_PAGES=32,MAX_ITEMS=20000;
const encoder=new TextEncoder();
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
const need=(value,code='MALFORMED_DOCUMENT')=>{if(!value)fail(code);};
const normalize=text=>text.replace(/\r\n?/g,'\n').normalize('NFC');
for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts']){
  Object.defineProperty(globalThis,name,{value:()=>fail('BACKEND_REQUIRED'),writable:false,configurable:false});
}
// PDF.js diagnostics may include untrusted strings. No extractor diagnostics
// leave this worker; the parent receives only the closed result/error contract.
for(const name of ['log','warn','error','info','debug'])console[name]=()=>{};
const node=typeof process==='object'&&process.versions?.node;
const channel=node?(await import('node:worker_threads')).parentPort:null;
const send=value=>channel?channel.postMessage(value):globalThis.postMessage(value);
let used=false;
async function extract(request){
  need(!used);used=true;
  need(request&&Object.keys(request).sort().join(',')==='bytes,data,schemaVersion'&&request.schemaVersion==='aurora.pdf.text.request.v1');
  need(request.bytes instanceof Uint8Array&&request.bytes.length>0&&request.bytes.length<=MAX_BYTES,'LIMIT_EXCEEDED');
  need(request.data instanceof Uint8Array&&request.data.length===1991651,'BACKEND_REQUIRED');
  const raw=request.data,headerSize=new DataView(raw.buffer,raw.byteOffset,4).getUint32(0,false);
  need(headerSize>0&&headerSize<65536&&4+headerSize<raw.length,'BACKEND_REQUIRED');
  const index=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.subarray(4,4+headerSize)));
  need(index.schemaVersion==='aurora.pdf.text.data.v1'&&Array.isArray(index.entries)&&index.entries.length===185,'BACKEND_REQUIRED');
  const entries=new Map();let next=0;
  for(const entry of index.entries){
    need(entry&&Object.keys(entry).sort().join(',')==='name,offset,sha256,size'
      &&/^(?:cmaps|standard_fonts)\/[A-Za-z0-9_.-]+$/.test(entry.name)&&!entries.has(entry.name)
      &&Number.isSafeInteger(entry.offset)&&entry.offset===next&&Number.isSafeInteger(entry.size)&&entry.size>=0
      &&entry.size<=MAX_BYTES&&/^[a-f0-9]{64}$/.test(entry.sha256),'BACKEND_REQUIRED');
    next+=entry.size;need(4+headerSize+next<=raw.length,'BACKEND_REQUIRED');entries.set(entry.name,entry);
  }
  need(4+headerSize+next===raw.length,'BACKEND_REQUIRED');
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  need(await digest(raw)==='e345cc3e6465356b3a48c2da62561b3ea99277b7b79be31c5dc80b9e779b1eac','BACKEND_REQUIRED');
  class BinaryDataFactory {
    async fetch({kind,filename}){
      const directory=kind==='cMapUrl'?'cmaps':kind==='standardFontDataUrl'?'standard_fonts':null;
      need(directory&&typeof filename==='string'&&/^[A-Za-z0-9_.-]+$/.test(filename),'BACKEND_REQUIRED');
      const entry=entries.get(directory+'/'+filename);need(entry,'BACKEND_REQUIRED');
      const value=raw.slice(4+headerSize+entry.offset,4+headerSize+entry.offset+entry.size);
      need(await digest(value)===entry.sha256,'BACKEND_REQUIRED');return value;
    }
  }
  // Use the official worker's loopback message handler INSIDE this outer worker.
  // No nested worker, eval, canvas, Wasm or optional native library is needed for
  // streamTextContent. The outer worker supplies the enforced kill deadline.
  const worker=await import('./document_pdf_worker.mjs');
  globalThis.pdfjsWorker={WorkerMessageHandler:worker.WorkerMessageHandler};
  const pdfjs=await import('./document_pdf_api.mjs');
  need(pdfjs.version==='6.4.299','BACKEND_REQUIRED');
  let task,document;
  try{
    task=pdfjs.getDocument({data:request.bytes,BinaryDataFactory,verbosity:0,isEvalSupported:false,
      cMapPacked:true,useWorkerFetch:false,useSystemFonts:false,useWasm:false,
      disableFontFace:true,enableXfa:false,stopAtErrors:true,
      isOffscreenCanvasSupported:false,isImageDecoderSupported:false,
      maxImageSize:0,canvasMaxAreaInBytes:0,disableRange:true,disableStream:true,disableAutoFetch:true});
    document=await task.promise;
    need(Number.isSafeInteger(document.numPages)&&document.numPages>0&&document.numPages<=MAX_PAGES,'LIMIT_EXCEEDED');
    const segments=[];let bytes=0,items=0;
    for(let number=1;number<=document.numPages;number++){
      const page=await document.getPage(number),reader=page.streamTextContent({includeMarkedContent:false,disableNormalization:false}).getReader();
      try{
        while(true){
          const {value,done}=await reader.read();if(done)break;
          need(value&&Array.isArray(value.items),'MALFORMED_DOCUMENT');
          for(const item of value.items){
            need(++items<=MAX_ITEMS,'LIMIT_EXCEEDED');need(item&&typeof item.str==='string');
            need(item.str.length<=MAX_TEXT,'LIMIT_EXCEEDED');
            const text=normalize(item.str)+(item.hasEOL?'\n':'');
            // Reserve expanded UTF-8 output BEFORE retaining any new item.
            bytes+=encoder.encode(text).length+(segments.length?1:0);need(bytes<=MAX_TEXT,'LIMIT_EXCEEDED');
            if(text.trim())segments.push({locator:'pdf/page['+number+']/item['+items+']',text});
          }
        }
      }finally{await reader.cancel().catch(()=>{});page.cleanup();}
    }
    return {schemaVersion:'aurora.pdf.text.result.v1',pages:document.numPages,segments};
  }finally{if(task)await task.destroy().catch(()=>{});}
}
async function receive(request){
  try{send(await extract(request));}
  catch(error){const code=error?.name==='PasswordException'?'ENCRYPTED_DOCUMENT':
    ['BACKEND_REQUIRED','LIMIT_EXCEEDED','MALFORMED_DOCUMENT'].includes(error?.safeCode)?error.safeCode:'MALFORMED_DOCUMENT';
    send({schemaVersion:'aurora.pdf.text.error.v1',code});}
  finally{if(channel)channel.close();else globalThis.close();}
}
if(channel)channel.once('message',receive);else globalThis.onmessage=event=>{globalThis.onmessage=null;void receive(event.data);};
