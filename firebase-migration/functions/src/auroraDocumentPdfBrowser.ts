import { PDF_TEXT_ASSETS } from './auroraDocumentPdfAssets.js';

/** Fixed same-origin assets, verified before creating a disposable text worker. */
export function createPdfTextBrowserExtractor(pins:typeof PDF_TEXT_ASSETS) {
  let verified:Promise<Uint8Array>|null=null;
  const fail=(code:string):never=>{throw Error(code);};
  const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),value=>value.toString(16).padStart(2,'0')).join('');
  async function assets():Promise<Uint8Array> {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    let data:Uint8Array|null=null;
    try{
    for(const [name,pin]of Object.entries(pins.files)){
      const response=await fetch('/assets/document-intake/'+name,{credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
      if(!response.ok||!response.body)fail('BACKEND_REQUIRED');
      const advertised=response.headers.get('content-length');if(advertised&&Number(advertised)>pin.size)fail('BACKEND_REQUIRED');
      const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let count=0;
      try{while(true){const part=await reader.read();if(part.done)break;
        count+=part.value.byteLength;if(count>pin.size)fail('BACKEND_REQUIRED');chunks.push(part.value);}}
      finally{await reader.cancel().catch(()=>{});}
      if(count!==pin.size)fail('BACKEND_REQUIRED');const raw=new Uint8Array(count);let offset=0;
      for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
      if(await digest(raw)!==pin.sha256)fail('BACKEND_REQUIRED');if(name==='document_pdf_data.bin')data=raw;
    }
    return data??fail('BACKEND_REQUIRED');
    }finally{clearTimeout(timer);}
  }
  return async (bytes:Uint8Array,signal?:AbortSignal):Promise<any>=>{
    if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>1048576)fail('LIMIT_EXCEEDED');
    if(typeof Worker!=='function'||signal?.aborted)fail('BACKEND_REQUIRED');
    verified??=assets().catch(error=>{verified=null;throw error;});
    const data=new Uint8Array(await verified);if(signal?.aborted)fail('BACKEND_REQUIRED');
    return new Promise((resolve,reject)=>{
      const worker=new Worker('/assets/document-intake/document_pdf_runtime.mjs',{type:'module',name:'aurora-pdf-text'});
      let finished=false;
      const finish=(code:string|null,result?:unknown)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();code?reject(Error(code)):resolve(result);};
      const abort=()=>finish('BACKEND_REQUIRED');signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>finish('LIMIT_EXCEEDED'),10000);
      if(signal?.aborted){abort();return;}
      worker.onmessage=event=>{
        const result=event.data;
        // Upstream worker bootstrap also emits its own private PDF.js "ready"
        // handshake. Only our closed outer result/error schema can settle.
        if(!['aurora.pdf.text.result.v1','aurora.pdf.text.error.v1'].includes(result?.schemaVersion))return;
        if(result?.schemaVersion==='aurora.pdf.text.error.v1')finish(['LIMIT_EXCEEDED','ENCRYPTED_DOCUMENT','BACKEND_REQUIRED'].includes(result.code)?result.code:'MALFORMED_DOCUMENT');
        else finish(null,result);
      };
      worker.onerror=()=>finish('BACKEND_REQUIRED');worker.onmessageerror=()=>finish('BACKEND_REQUIRED');
      const copy=new Uint8Array(bytes);worker.postMessage({schemaVersion:'aurora.pdf.text.request.v1',bytes:copy,data},[copy.buffer,data.buffer]);
    });
  };
}
export function pdfTextBrowserClientSource():string {
  return `const extractPdfText=(()=>{const __name=value=>value;return (${createPdfTextBrowserExtractor.toString()})(${JSON.stringify(PDF_TEXT_ASSETS)});})();`;
}
