/**
 * Read-only external smoke of AURORA-CRED-MED-001 published public shell/media.
 * HML/production opt-in via explicit --origin; no applicant data, credentials,
 * uploads, session tokens, mutable state, or user-supplied filesystem paths.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from 'node:https';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {verifyHeadLength,verifyVideoRangeResponse} from './credmed-http-transport-contract.mjs';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--origin'||![
  'https://wmgj-hml-jfn-20260927.web.app',
  'https://auroranexus.com.br',
  'https://wmgj-prod-jfn-20261005.web.app'
].includes(args[1]))throw new Error('CREDMED_ORIGIN_NOT_ALLOWLISTED');
const origin=args[1];
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../hosting/aurora-nexus/arquivos/wmgj');
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
assert.equal(manifest.scope,'PUBLIC_BLANK_TEMPLATES_ONLY');
const files=[...manifest.files,...manifest.videoAssets];
assert.equal(files.length,3);

function fetch(path,method='GET',headers={}){
  return new Promise((done,fail)=>{
    const url=new URL(path,origin);
    if(url.origin!==origin) return fail(new Error('ORIGIN_CONFLICT'));
    const req=request(url,{method,headers,timeout:18000,rejectUnauthorized:true},res=>{
      if(res.statusCode>=300&&res.statusCode<400){res.resume();return fail(new Error('REDIRECT_REJECTED:'+path));}
      let size=0;const chunks=[];
      res.on('data',buf=>{size+=buf.length;if(size>512*1024){res.destroy();fail(new Error('RESPONSE_TOO_LARGE'));return;}chunks.push(buf);});
      res.on('error',fail);
      res.on('end',()=>done({code:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));
    });
    req.on('error',fail);req.on('timeout',()=>req.destroy(new Error('SMOKE_TIMEOUT')));req.end();
  });
}
function checkMime(value,expected){assert.match(String(value||''),new RegExp('^'+expected.replace('/','\\/')+'(?:;|$)','i'));}
function checkHeaders(res,file){
  assert.equal(res.code,200,'asset should be downloadable: '+file.name);
  checkMime(res.headers['content-type'],file.mimeType);
  assert.match(String(res.headers['content-disposition']||''),/^attachment(?:;|$)/i);
  assert.equal(res.headers['x-content-type-options'],'nosniff');
}
const form=await fetch('/wmgj/medicos');
assert.equal(form.code,200,'public form not available');
checkMime(form.headers['content-type'],'text/html');
const html=form.bytes.toString('utf8');
for(const key of ['<title>Pré-cadastro médico','Seu próximo passo profissional começa aqui','name="crmNumber"','data-kind="CRM_CERTIFICATE"','name="noticeAccepted"'])
  assert.ok(html.includes(key),'FORM_CONTENT_MISSING:'+key);
for(const file of files)assert.ok(html.includes('/arquivos/wmgj/'+file.name),'FORM_MISSING_DOWNLOAD_LINK:'+file.name);
console.log('PUBLIC_FORM_VERIFIED',origin,'bytes='+form.bytes.length);

const privatePage=await fetch('/wmgj/medicos/gestao');
assert.equal(privatePage.code,403,'anonymous access to management should be denied');
console.log('PRIVATE_MANAGEMENT_DENIED');

for(const f of files){
  const path='/arquivos/wmgj/'+f.name;
  const head=await fetch(path,'HEAD');checkHeaders(head,f);
  console.log(verifyHeadLength(head,f),f.name);
  const get=await fetch(path);
  checkHeaders(get,f);
  assert.equal(get.bytes.length,f.bytes);
  assert.equal(createHash('sha256').update(get.bytes).digest('hex'),f.sha256);
  console.log('DOWNLOAD_VERIFIED',f.name,'bytes='+f.bytes,'SHA256='+f.sha256);
  if(f.mimeType==='video/mp4'){
    const partial=await fetch(path,'GET',{Range:'bytes=0-31'});
    console.log(verifyVideoRangeResponse(partial,get,f));
  }
}
console.log('CREDMED_PUBLIC_DOWNLOADS_AND_BOUNDARIES_VERIFIED');
