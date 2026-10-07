import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servePrivateDownloads } from '../src/auroraDownloads.ts';
const admin = { role: 'org_admin', permissions: [], orgId: 'synthetic' };
function response() { return { statusCode: 0, body: null as any, headers: {} as Record<string,string>, set(k:string,v:string){this.headers[k]=v;return this;}, status(n:number){this.statusCode=n;return this;}, json(v:any){this.body=v;return this;}, send(v:any){this.body=v;return this;}, type(v:string){this.headers['Content-Type']=v;return this;} }; }
async function fixture() {
 const root=await mkdtemp(join(tmpdir(),'aurora-download-test-'));
 const bytes=Buffer.from('synthetic-package');
 const files=['AURORA-NEXUS-Mac-HML.zip','AURORA-NEXUS-Windows-x64-HML.exe'].map((name,i)=>({name,label:i?'Windows':'Mac',platform:i?'windows':'mac',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),signed:false}));
 for(const f of files)await writeFile(join(root,f.name),bytes);
 const manifest={schemaVersion:1,version:'test-hml',channel:'homologation',productionApproved:false,portalUrl:'https://wmgj-hml-jfn-20260927.web.app/',files};
 await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));
 return {root,bytes,files,manifest,clean:()=>rm(root,{recursive:true,force:true})};
}
test('anonymous listing redirects to login before any release file access',async()=>{const r=response();await servePrivateDownloads({method:'GET',path:'/downloads'},r,null,'/does-not-exist');assert.equal(r.statusCode,303);assert.equal(r.headers.Location,'/');});
test('anonymous binary is denied',async()=>{const r=response();await servePrivateDownloads({method:'GET',path:'/downloads/AURORA-NEXUS-Mac-HML.zip'},r,null);assert.equal(r.statusCode,401);});
test('standard viewer cannot download unsigned HML packages',async()=>{const r=response();await servePrivateDownloads({method:'GET',path:'/downloads'},r,{...admin,role:'viewer'});assert.equal(r.statusCode,403);});
test('POST is never accepted',async()=>{const r=response();await servePrivateDownloads({method:'POST',path:'/downloads'},r,admin);assert.equal(r.statusCode,405);});
test('missing staged release is not presented as available',async()=>{const r=response();await servePrivateDownloads({method:'GET',path:'/downloads'},r,admin,'/does-not-exist');assert.equal(r.statusCode,503);assert.deepEqual(r.body,{code:'RELEASE_NOT_READY'});});
test('authenticated page contains only private relative download links',async()=>{const f=await fixture();try{const r=response();await servePrivateDownloads({method:'GET',path:'/downloads'},r,admin,f.root);assert.equal(r.statusCode,200);assert.match(r.body,/href="\/downloads\/AURORA-NEXUS-Mac-HML.zip"/);assert.match(r.body,/sem assinatura/i);assert.doesNotMatch(r.body,/storage.googleapis|github.com|signedUrl/);assert.match(r.headers['Cache-Control'],/no-store/);}finally{await f.clean();}});
test('download verifies content size and hash',async()=>{const f=await fixture();try{const r=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+f.files[0].name},r,admin,f.root);assert.equal(r.statusCode,200);assert.deepEqual(r.body,f.bytes);assert.match(r.headers['Content-Disposition'],/^attachment;/);}finally{await f.clean();}});
test('tampered binary is never served',async()=>{const f=await fixture();try{await writeFile(join(f.root,f.files[0].name),'changed');const r=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+f.files[0].name},r,admin,f.root);assert.equal(r.statusCode,503);}finally{await f.clean();}});
for(const path of ['/downloads/../secrets','/downloads/%2e%2e/private','/downloads/anything.exe'])test('reject path '+path,async()=>{const r=response();await servePrivateDownloads({method:'GET',path},r,admin);assert.equal(r.statusCode,404);});
test('production manifest is rejected by HML distribution',async()=>{const f=await fixture();try{await writeFile(join(f.root,'manifest.json'),JSON.stringify({...f.manifest,productionApproved:true}));const r=response();await servePrivateDownloads({method:'GET',path:'/downloads'},r,admin,f.root);assert.equal(r.statusCode,503);}finally{await f.clean();}});
test('HEAD checks integrity but returns no executable body',async()=>{const f=await fixture();try{const r=response();await servePrivateDownloads({method:'HEAD',path:'/downloads/'+f.files[0].name},r,admin,f.root);assert.equal(r.statusCode,200);assert.equal(r.body,'');assert.equal(r.headers['Content-Length'],String(f.bytes.length));}finally{await f.clean();}});
test('symlink package rejected',async t=>{const f=await fixture();try{await rm(join(f.root,f.files[0].name));try{await symlink(join(f.root,f.files[1].name),join(f.root,f.files[0].name));}catch{t.skip('symlink unavailable');return;}const r=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+f.files[0].name},r,admin,f.root);assert.equal(r.statusCode,503);}finally{await f.clean();}});

test('listing never advertises a missing package',async()=>{const f=await fixture();try{await rm(join(f.root,f.files[0].name));const r=response();await servePrivateDownloads({method:'GET',path:'/downloads'},r,admin,f.root);assert.equal(r.statusCode,503);}finally{await f.clean();}});


test('beta bundle requires membership and verifies integrity before serving', async()=>{
 const f=await fixture();
 try {
  const name='AURORA-NEXUS-Windows-Beta.zip';
  await writeFile(join(f.root,name),f.bytes);
  f.manifest.files.push({...f.files[1],name,label:'Windows beta'});
  await writeFile(join(f.root,'manifest.json'),JSON.stringify(f.manifest));
  const anonymous=response();
  await servePrivateDownloads({method:'GET',path:'/downloads/'+name},anonymous,null,f.root);
  assert.equal(anonymous.statusCode,401);
  const allowed=response();
  await servePrivateDownloads({method:'GET',path:'/downloads/'+name},allowed,admin,f.root);
  assert.equal(allowed.statusCode,200);
  assert.equal(allowed.headers['Content-Type'],'application/zip');
  assert.deepEqual(allowed.body,f.bytes);
  await writeFile(join(f.root,name),'tampered');
  const damaged=response();
  await servePrivateDownloads({method:'GET',path:'/downloads/'+name},damaged,admin,f.root);
  assert.equal(damaged.statusCode,503);
 } finally {await f.clean();}
});

test('legacy release remains valid and absent beta bundle is 404',async()=>{
 const f=await fixture();
 try {const r=response();await servePrivateDownloads({method:'GET',path:'/downloads/AURORA-NEXUS-Windows-Beta.zip'},r,admin,f.root);assert.equal(r.statusCode,404);}
 finally {await f.clean();}
});
