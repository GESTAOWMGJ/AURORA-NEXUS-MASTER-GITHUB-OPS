'use strict';
// The signed package's fixed local assets only. No npm/module search or network.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {pathToFileURL}=require('node:url');
const MAX_BYTES=1048576,DEADLINE_MS=10000;
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function read(name,maximum){
  const target=path.join(__dirname,name),before=fs.lstatSync(target);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum)throw Error('BACKEND_REQUIRED');
  const fd=fs.openSync(target,'r');
  try{const opened=fs.fstatSync(fd),bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),named=fs.lstatSync(target);
    if(bytes.length>maximum||[opened,after,named].some(item=>item.dev!==before.dev||item.ino!==before.ino||item.size!==before.size||item.mtimeMs!==before.mtimeMs||item.nlink!==1))throw Error('BACKEND_REQUIRED');
    return bytes;
  }finally{fs.closeSync(fd);}
}
async function extractPdfText(bytes){
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||major===22&&minor<13)throw Error('BACKEND_REQUIRED');
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_BYTES)throw Error('LIMIT_EXCEEDED');
  const pins=require('./document_pdf_pins.cjs');
  let data;
  for(const [name,pin]of Object.entries(pins.files)){
    const raw=read(name,pin.size);if(raw.length!==pin.size||sha(raw)!==pin.sha256)throw Error('BACKEND_REQUIRED');
    if(name==='document_pdf_data.bin')data=new Uint8Array(raw);
  }
  return new Promise((resolve,reject)=>{
    const worker=new Worker(pathToFileURL(path.join(__dirname,'document_pdf_runtime.mjs')),
      {env:{TZ:'UTC'},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    let finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);void worker.terminate();error?reject(Error(error)):resolve(result);};
    const timer=setTimeout(()=>finish('LIMIT_EXCEEDED'),DEADLINE_MS);
    worker.on('message',result=>{
      if(!['aurora.pdf.text.result.v1','aurora.pdf.text.error.v1'].includes(result?.schemaVersion))return;
      if(result?.schemaVersion==='aurora.pdf.text.error.v1')finish(['LIMIT_EXCEEDED','ENCRYPTED_DOCUMENT','BACKEND_REQUIRED'].includes(result.code)?result.code:'MALFORMED_DOCUMENT');
      else finish(null,result);
    });
    worker.once('error',()=>finish('BACKEND_REQUIRED'));
    worker.once('exit',()=>finish('BACKEND_REQUIRED'));
    const copy=new Uint8Array(bytes);worker.postMessage({schemaVersion:'aurora.pdf.text.request.v1',bytes:copy,data},[copy.buffer,data.buffer]);
  });
}
module.exports={extractPdfText};
