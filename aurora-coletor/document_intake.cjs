'use strict';
// Private stdin/stdout bridge for the installed component. Never import this
// entrypoint into a web service or log its ephemeral extracted document text.
const {inflateRawSync}=require('node:zlib');
const {createDocumentIntakeEngine}=require('./document_intake_core.cjs');
const {mapDocumentFactCandidates}=require('./document_fact_mapping.cjs');
const MAX_BYTES=1048576,MAX_REQUEST=4*Math.ceil(MAX_BYTES/3)+512,MAX_OUTPUT=16*1048576;
const fail=code=>{const error=new Error(code);error.safeCode=code;throw error;};
async function main(){
  if(Number(process.versions.node.split('.')[0])<22)fail('BACKEND_REQUIRED');
  let size=0;const chunks=[];
  for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX_REQUEST)fail('LIMIT_EXCEEDED');chunks.push(chunk);}
  let request;try{request=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('MALFORMED_REQUEST');}
  if(!request||Array.isArray(request)||typeof request!=='object'||Object.keys(request).sort().join(',')!=='bytesBase64,mime,schemaVersion'
    ||request.schemaVersion!=='aurora.document.intake.request.v1'||typeof request.mime!=='string'
    ||!/^[a-z0-9][a-z0-9.+-]{0,79}\/[a-z0-9][a-z0-9.+-]{0,159}$/.test(request.mime)
    ||typeof request.bytesBase64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.bytesBase64))fail('MALFORMED_REQUEST');
  const bytes=Buffer.from(request.bytesBase64,'base64');
  if(bytes.length<1||bytes.length>MAX_BYTES||bytes.toString('base64')!==request.bytesBase64)fail('LIMIT_EXCEEDED');
  const core=await createDocumentIntakeEngine().extract(bytes,request.mime,{inflateRaw:async(data,expected)=>{
    if(!Number.isSafeInteger(expected)||expected<0||expected>8388608)fail('LIMIT_EXCEEDED');
    return inflateRawSync(data,{maxOutputLength:Math.max(1,expected)});
  }});
  const factCandidates=mapDocumentFactCandidates(core);
  const output=JSON.stringify({schemaVersion:'aurora.document.intake.result.v1',core,factCandidates});
  if(Buffer.byteLength(output,'utf8')>MAX_OUTPUT)fail('LIMIT_EXCEEDED');
  process.stdout.write(output+'\n');
}
main().catch(error=>{
  const code=['BACKEND_REQUIRED','LIMIT_EXCEEDED','MALFORMED_REQUEST'].includes(error?.safeCode)?error.safeCode:'DOCUMENT_INTAKE_FAILED';
  process.stdout.write(JSON.stringify({schemaVersion:'aurora.document.intake.error.v1',code})+'\n');process.exitCode=2;
});
