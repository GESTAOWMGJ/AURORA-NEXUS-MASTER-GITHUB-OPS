import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { activeReleaseSigningBytes } from '../src/auroraActiveRelease.ts';
import { finalizeUnifiedBeta,verifyUnifiedCandidate,canonical,readUnifiedZip,writeUnifiedZip,unifiedDigest,unifiedCrc32,UNIFIED_MAX_EXPANDED,UNIFIED_MAX_ENTRIES,UNIFIED_HELPERS,UNIFIED_NAME } from '../src/auroraUnifiedBetaArchive.ts';
import { createUnifiedBetaReader,UnifiedBetaBusyError } from '../src/auroraUnifiedBetaDownload.ts';
import { servePrivateDownloads } from '../src/auroraDownloads.ts';

const SOURCE='a'.repeat(40),OTHER='b'.repeat(40),NOW=Date.parse('2026-10-15T12:00:00.000Z');
const repo=resolve(import.meta.dirname,'../../..');
const privatePair=generateKeyPairSync('ed25519');
const publicKey=privatePair.publicKey.export({type:'spki',format:'pem'}).toString();
const fingerprint=unifiedDigest(privatePair.publicKey.export({type:'spki',format:'der'}));
const json=(value:any)=>Buffer.from(canonical(value)+'\n');
const response=()=>({statusCode:0,body:null as any,headers:{} as Record<string,string>,set(k:string,v:string){this.headers[k]=v;return this;},status(n:number){this.statusCode=n;return this;},json(v:any){this.body=v;return this;},send(v:any){this.body=v;return this;},end(v:any){this.body=v??'';return this;},type(v:string){this.headers['Content-Type']=v;return this;}});
const admin={uid:'synthetic-user',role:'org_admin',permissions:[] as string[],orgId:'synthetic'};

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'aurora-unified-download-'));
  const script="import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); import test_unified_beta as t; import build_unified_beta as b; r=Path(sys.argv[2]);t.fixture(r/'functions');c,i=b.build_candidate(r/'functions',t.SOURCE);(r/'candidate.zip').write_bytes(c);(r/'index.json').write_bytes(b.json_bytes(i))";
  execFileSync(process.platform==='win32'?'python':'python3',['-I','-S','-B','-c',script,join(repo,'desktop'),root],{stdio:'pipe',windowsHide:true});
  const candidate=await readFile(join(root,'candidate.zip')),index=JSON.parse(await readFile(join(root,'index.json'),'utf8'));
  const cert:any={schemaVersion:2,sourceSha:SOURCE,productVersion:index.productVersion,canonicalOrigin:'https://auroranexus.com.br',releaseRunId:'12345',ciRunId:'67890',publishedAtUtc:'2026-10-14T00:00:00.000Z',status:'ACTIVE',checks:{ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true},components:index.components};
  const signed=(certificate:any)=>({certificate,signature:sign(null,activeReleaseSigningBytes(certificate),privatePair.privateKey).toString('base64url')});
  const envelope=signed(cert);
  const finalize=(changes:Record<string,any>={})=>finalizeUnifiedBeta({candidate,envelope,publicKeySpkiPem:publicKey,trustedPublicKeySha256:fingerprint,sourceSha:SOURCE,expectedCandidateSha256:unifiedDigest(candidate),now:NOW,...changes});
  const proof=finalize();
  const runtime={verification:{status:'VERIFIED_ACTIVE_PIN',certificateSha256:proof.certificateSha256},runtimeBuild:{sourceSha:SOURCE,manifestSha256:cert.components.server.manifestSha256,fileIntegrityVerified:true},runtimeBuildWeb:{sourceSha:SOURCE,manifestSha256:cert.components.web.manifestSha256,fileIntegrityVerified:true},localServer:{fileIntegrityVerified:true},localWeb:{fileIntegrityVerified:true}};
  let currentEnvelope:any=envelope,currentCandidate=candidate,currentRuntime:any=runtime;
  const reader=createUnifiedBetaReader({publicKey:()=>publicKey,readCandidate:async()=>currentCandidate,readFixedEnvelope:async()=>currentEnvelope,readRuntime:async()=>currentRuntime,now:()=>NOW});
  const current=()=>reader();
  const callbacks={read:current,reauthorize:async()=>admin};
  const clean=()=>rm(root,{recursive:true,force:true});
  return {root,candidate,index,envelope,cert,proof,finalize,current,callbacks,runtime,signed,clean,
    setEnvelope:(e:any)=>{currentEnvelope=e;},setCandidate:(b:Buffer)=>{currentCandidate=b;},setRuntime:(r:any)=>{currentRuntime=r;}};
}
async function using(fn:(f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>|void){const f=await fixture();try{await fn(f);}finally{await f.clean();}}

test('current synthetic candidate finalizes reproducibly and retains all payload bytes',()=>using(f=>{
  const again=f.finalize();assert.deepEqual(again.bytes,f.proof.bytes);assert.equal(again.sha256,f.proof.sha256);
  const old=readUnifiedZip(f.candidate),final=readUnifiedZip(f.proof.bytes);for(const [n,b]of old)assert.deepEqual(final.get(n),b);
  assert.equal(f.proof.delivery.complete,false);assert.equal(f.proof.delivery.publicationAvailability,'PENDING');
  assert.deepEqual(f.proof.delivery.missingTargets,['ios-native']);assert.equal(f.proof.delivery.adoption.mac.bundleIdentifier,'br.com.auroranexus.desktop.hml');
  assert.equal(f.proof.bytes.readUInt16LE(8),0,'outer output uses stored entries, independent of zlib');
}));

test('the exact official CLI output equals runtime bytes and passes independent VERIFY.py',()=>using(async f=>{
  const env=join(f.root,'envelope.json'),trust=join(f.root,'public-trust.json'),output=join(f.root,'from-cli.zip');
  await writeFile(env,json(f.envelope));await writeFile(trust,json({publicKeySpkiPem:publicKey,publicKeySha256:fingerprint}));
  execFileSync(process.execPath,[join(repo,'firebase-migration/scripts/finalize-unified-beta.mjs'),'--candidate',join(f.root,'candidate.zip'),'--public-envelope',env,'--public-trust',trust,'--source-sha',SOURCE,'--expected-candidate-sha256',unifiedDigest(f.candidate),'--trusted-public-key-sha256',fingerprint,'--output',output],{stdio:'pipe',windowsHide:true});
  const current=await f.current();try{assert.deepEqual(await readFile(output),current.bytes);}finally{current.release();}
  // CI installs the declared crypto backend globally; this Windows QA host has
  // that same public dependency in its user site, explicitly admitted under -I.
  const script="import sys,json,zipfile,site;from pathlib import Path;sys.path.append(site.getusersitepackages());sys.path.insert(0,sys.argv[1]);import verify_unified_beta as v;r=Path(sys.argv[2]);z=zipfile.ZipFile(r/'from-cli.zip');z.extractall(r/'verified');p=v.verify(r/'verified',sys.argv[3]);assert p['integrityVerified'] and p['signatureVerified'] and p['trustedPublisherVerified'] and p['allDeclaredPayloadsPresent'],p;print(json.dumps({'verified':True,'complete':p['complete']}))";
  const result=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-I','-B','-c',script,join(repo,'desktop'),f.root,fingerprint],{encoding:'utf8',windowsHide:true}));
  assert.equal(result.verified,true);assert.equal(result.complete,false);
}));

test('source helper hashes agree with reviewed LF source and fixture',()=>using(async f=>{
  const source=Buffer.from((await readFile(join(repo,'desktop/verify_unified_beta.py'),'utf8')).replaceAll('\r\n','\n'));
  assert.equal(unifiedDigest(source),UNIFIED_HELPERS['VERIFY.py']);const files=readUnifiedZip(f.candidate);
  for(const [name,hash]of Object.entries(UNIFIED_HELPERS))assert.equal(unifiedDigest(files.get(name)!),hash);
}));

test('prepromotion CLI validates the same candidate without claiming active authority',()=>using(f=>{
  const result=JSON.parse(execFileSync(process.execPath,[join(repo,'firebase-migration/scripts/finalize-unified-beta.mjs'),'--verify-candidate','--candidate',join(f.root,'candidate.zip'),'--source-sha',SOURCE],{encoding:'utf8',windowsHide:true}));
  assert.equal(result.status,'SOURCE_BOUND_CANDIDATE_UNVERIFIED');assert.equal(result.archiveSha256,unifiedDigest(f.candidate));assert.equal(result.certificateSha256,undefined);
}));

for(const field of ['complete','adoption','installationAcceptancePolicy','missingTargets','unexpected'])test('unsigned candidate metadata cannot override '+field,()=>using(f=>{
  const files=readUnifiedZip(f.candidate),index=JSON.parse(files.get('candidate-manifest.json')!.toString());
  if(field==='complete')index.complete=true;
  if(field==='adoption')index.adoption.ios.nativeAppStoreBuild=true;
  if(field==='installationAcceptancePolicy')index.installationAcceptancePolicy.installationComplete=true;
  if(field==='missingTargets')index.missingTargets=[];
  if(field==='unexpected')index.unreviewed=true;
  files.set('candidate-manifest.json',json(index));const candidate=writeUnifiedZip(files);
  assert.throws(()=>f.finalize({candidate,expectedCandidateSha256:unifiedDigest(candidate)}));
}));

test('equivalent file contents with changed ZIP headers are not the packaged canonical candidate',()=>using(f=>{
  const candidate=Buffer.from(f.candidate),central=centralOffset(candidate);candidate.writeUInt16LE(0x5c22,12);candidate.writeUInt16LE(0x5c22,central+14);
  assert.deepEqual([...readUnifiedZip(candidate).keys()],[...readUnifiedZip(f.candidate).keys()]);
  assert.throws(()=>verifyUnifiedCandidate(candidate,SOURCE),/NONCANONICAL_CANDIDATE_ZIP/);
}));

for(const kind of ['source','manifest','signature','trust','candidateHash','uncheckedGate'])test('finalizer rejects '+kind,()=>using(f=>{
  const changes:any={};const envelope=structuredClone(f.envelope);
  if(kind==='source')changes.sourceSha=OTHER;
  if(kind==='manifest')envelope.certificate.components.server.manifestSha256='0'.repeat(64);
  if(kind==='signature')envelope.signature='a'.repeat(86);
  if(kind==='trust')changes.trustedPublicKeySha256='0'.repeat(64);
  if(kind==='candidateHash')changes.expectedCandidateSha256='0'.repeat(64);
  if(kind==='uncheckedGate')envelope.certificate.checks.smokePassed=false;
  changes.envelope=kind==='uncheckedGate'?f.signed(envelope.certificate):envelope;
  assert.throws(()=>f.finalize(changes));
}));

for(const target of ['README.md','VERIFY.py','payloads/server/lib/auroraRuntime.js','unexpected.txt'])test('resealed candidate cannot hide changed '+target,()=>using(f=>{
  const files=readUnifiedZip(f.candidate);files.set(target,Buffer.from('tampered'));
  const index=JSON.parse(files.get('candidate-manifest.json')!.toString());index.files[target]={sha256:unifiedDigest(files.get(target)!),size:files.get(target)!.length};files.set('candidate-manifest.json',json(index));
  const candidate=writeUnifiedZip(files);assert.throws(()=>f.finalize({candidate,expectedCandidateSha256:unifiedDigest(candidate)}));
}));

test('a foreign key included with a delivery is not an out-of-band trust anchor',()=>using(f=>{
  const foreign=generateKeyPairSync('ed25519');const envelope={certificate:f.cert,signature:sign(null,activeReleaseSigningBytes(f.cert),foreign.privateKey).toString('base64url')};
  assert.throws(()=>f.finalize({envelope,publicKeySpkiPem:foreign.publicKey.export({type:'spki',format:'pem'}).toString()}));
}));

for(const kind of ['no pin','runtimeConflict','candidateChanged'])test('reader refuses '+kind,()=>using(async f=>{
  (await f.current()).release();if(kind==='no pin')f.setEnvelope(undefined);
  if(kind==='runtimeConflict')f.setRuntime({...f.runtime,runtimeBuild:{...f.runtime.runtimeBuild,sourceSha:OTHER}});
  if(kind==='candidateChanged')f.setCandidate(Buffer.from('changed'));
  await assert.rejects(f.current());
}));

test('cached public bytes still recheck a concurrent pin and candidate',()=>using(async f=>{
  const first=await f.current();first.release();const second=await f.current();assert.deepEqual(second.bytes,first.bytes);second.release();
  const changed=structuredClone(f.cert);changed.publishedAtUtc='2026-10-14T01:00:00.000Z';f.setEnvelope(f.signed(changed));
  await assert.rejects(first.assertCurrent());
}));

test('GET and HEAD return the same current metadata, with no HEAD body',()=>using(async f=>{
  const get=response(),head=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+UNIFIED_NAME},get,admin,undefined,f.callbacks);
  await servePrivateDownloads({method:'HEAD',path:'/downloads/'+UNIFIED_NAME},head,admin,undefined,f.callbacks);
  assert.equal(get.statusCode,200);assert.deepEqual(get.body,f.proof.bytes);assert.equal(head.statusCode,200);assert.equal(head.body,'');assert.deepEqual(head.headers,get.headers);
  assert.equal(get.headers['Content-Type'],'application/zip');assert.equal(get.headers['X-Aurora-Archive-Sha256'],f.proof.sha256);assert.match(get.headers['Cache-Control'],/private, no-store/);assert.equal(get.headers.ETag,undefined);
}));

test('real Express GET and HEAD do not synthesize ETag or cache the package',()=>using(async f=>{
  const express=createRequire(import.meta.url)('express'),app=express();
  app.use((req:any,res:any)=>{void servePrivateDownloads(req,res,admin,undefined,f.callbacks).catch((error:any)=>res.status(500).end());});
  const server=createServer(app);await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  try{
    const address=server.address();assert.ok(address&&typeof address==='object');const url='http://127.0.0.1:'+address.port+'/downloads/'+UNIFIED_NAME;
    const get=await fetch(url);assert.equal(get.status,200);assert.equal(get.headers.get('etag'),null);assert.match(get.headers.get('cache-control')!,/private, no-store/);
    assert.equal(get.headers.get('content-length'),String(f.proof.bytes.length));assert.deepEqual(Buffer.from(await get.arrayBuffer()),f.proof.bytes);
    const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('etag'),null);assert.equal(head.headers.get('content-length'),get.headers.get('content-length'));assert.equal((await head.arrayBuffer()).byteLength,0);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}));

for(const kind of ['anonymous','viewer','revoked','tenantChanged','principalChanged','permissionRemoved','query'])test('download denies '+kind+' without a package body or digest headers',()=>using(async f=>{
  const r=response();let member:any=admin;const callbacks={...f.callbacks};const req:any={method:'GET',path:'/downloads/'+UNIFIED_NAME};
  if(kind==='anonymous')member=null;if(kind==='viewer')member={...admin,role:'viewer'};
  if(kind==='revoked')callbacks.reauthorize=async()=>null as any;
  if(kind==='tenantChanged')callbacks.reauthorize=async()=>({...admin,orgId:'other'});
  if(kind==='principalChanged')callbacks.reauthorize=async()=>({...admin,uid:'other'});
  if(kind==='permissionRemoved')callbacks.reauthorize=async()=>({...admin,role:'viewer'});
  if(kind==='query')req.query={token:'not-a-credential'};
  await servePrivateDownloads(req,r,member,undefined,callbacks);assert.ok([400,401,403].includes(r.statusCode));assert.ok(!Buffer.isBuffer(r.body));assert.equal(r.headers['Content-Length'],undefined);assert.equal(r.headers['X-Aurora-Archive-Sha256'],undefined);
}));

test('pin promoted during the read prevents a response even with allowed membership',()=>using(async f=>{
  const r=response();const callbacks={...f.callbacks,read:async()=>{const result=await f.current();f.setEnvelope(undefined);return result;}};
  await servePrivateDownloads({method:'GET',path:'/downloads/'+UNIFIED_NAME},r,admin,undefined,callbacks);assert.equal(r.statusCode,503);assert.ok(!Buffer.isBuffer(r.body));
}));

test('pin changed while membership is reauthorized is rejected by the final guard',()=>using(async f=>{
  const callbacks={...f.callbacks,reauthorize:async()=>{f.setEnvelope(undefined);return admin;}};
  const r=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+UNIFIED_NAME},r,admin,undefined,callbacks);
  assert.equal(r.statusCode,503);assert.ok(!Buffer.isBuffer(r.body));assert.equal(r.headers['X-Aurora-Archive-Sha256'],undefined);
}));

test('missing runtime provider cannot advertise or serve Beta One',async()=>{
  const r=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+UNIFIED_NAME},r,admin,'/missing');assert.equal(r.statusCode,503);
});

test('one in-flight permit rejects concurrent requests before extra file work and releases after errors',()=>using(async f=>{
  let reads=0,valid=true;
  const reader=createUnifiedBetaReader({publicKey:()=>publicKey,readCandidate:async()=>{reads++;return f.candidate;},readFixedEnvelope:async()=>valid?f.envelope:undefined,readRuntime:async()=>f.runtime,now:()=>NOW});
  const first=await reader(),before=reads;await assert.rejects(reader(),UnifiedBetaBusyError);assert.equal(reads,before);
  const busy=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+UNIFIED_NAME},busy,admin,undefined,{read:reader,reauthorize:async()=>admin});
  assert.equal(busy.statusCode,503);assert.equal(busy.headers['Retry-After'],'1');assert.equal(reads,before);assert.equal(busy.headers['Content-Length'],undefined);
  const busyListing=response();await servePrivateDownloads({method:'GET',path:'/downloads'},busyListing,admin,'/missing-legacy-must-not-be-read',{read:reader,reauthorize:async()=>admin});
  assert.equal(busyListing.statusCode,503);assert.equal(busyListing.body.code,'RELEASE_BUSY');assert.equal(busyListing.headers['Retry-After'],'1');assert.equal(reads,before);
  first.release();const second=await reader();second.release();valid=false;await assert.rejects(reader());valid=true;const afterError=await reader();afterError.release();
}));

test('response finally releases the permit after authorization denial and pin failure',()=>using(async f=>{
  const denied=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+UNIFIED_NAME},denied,admin,undefined,{...f.callbacks,reauthorize:async()=>null});assert.equal(denied.statusCode,403);
  const next=await f.current();next.release();
  const failed=response();await servePrivateDownloads({method:'GET',path:'/downloads/'+UNIFIED_NAME},failed,admin,undefined,{...f.callbacks,reauthorize:async()=>{f.setEnvelope(undefined);return admin;}});assert.equal(failed.statusCode,503);
  f.setEnvelope(f.envelope);const restored=await f.current();restored.release();
  const missingLegacy=response();await servePrivateDownloads({method:'GET',path:'/downloads'},missingLegacy,admin,'/missing-legacy',f.callbacks);assert.equal(missingLegacy.statusCode,503);
  const afterMissingLegacy=await f.current();afterMissingLegacy.release();
}));

test('listing separates product identity from legacy component versions',()=>using(async f=>{
  const dir=join(f.root,'functions/private-downloads'),rows=f.index.components.satellite;
  const manifest=JSON.parse(await readFile(join(f.root,'functions/runtime-release/satellite-manifest.json'),'utf8'));
  manifest.portalUrl='https://auroranexus.com.br/portal';manifest.channel='homologation';manifest.productionApproved=false;
  for(const item of manifest.files)item.label=item.name;
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
  const r=response();await servePrivateDownloads({method:'GET',path:'/downloads'},r,admin,dir,f.callbacks);assert.equal(r.statusCode,200);
  assert.match(r.body,/Beta One — entrega única/);assert.match(r.body,new RegExp('href="/downloads/'+UNIFIED_NAME.replaceAll('.','\\.')+'"'));
  assert.match(r.body,/Versão do produto 1\.1\.0-beta\.1/);assert.match(r.body,/Componente satélite 0\.2\.0-hml\.20261001/);assert.match(r.body,/Pacote preparado; validações de distribuição em andamento/);assert.doesNotMatch(r.body,/complete=false/);
  assert.doesNotMatch(r.body,/storage\.googleapis|github\.com|signedUrl|token=/);assert.equal(rows.version,'0.2.0-hml.20261001');
  const changed=response();await servePrivateDownloads({method:'GET',path:'/downloads'},changed,admin,dir,{...f.callbacks,reauthorize:async()=>{f.setEnvelope(undefined);return admin;}});
  assert.equal(changed.statusCode,503);assert.ok(typeof changed.body!=='string'||!changed.body.includes('Baixar Beta One'));
}));

test('strict JSON rejects duplicate keys, unsafe numbers and invalid unicode',async()=>{
  const {parseUnifiedJson}=await import('../src/auroraUnifiedBetaArchive.ts');
  for(const raw of ['{"x":1,"x":2}','{"x":9007199254740992}','{"x":"\\ud800"}','[1,]','{"x":NaN}'])assert.throws(()=>parseUnifiedJson(Buffer.from(raw)));
});

function smallZip(){return writeUnifiedZip(new Map([['a.txt',Buffer.from('abc')],['b.txt',Buffer.from('def')]]));}
const centralOffset=(b:Buffer)=>b.readUInt32LE(b.length-6);
for(const kind of ['trailing','truncated','encrypted','descriptor','zip64','extra','symlink','directory','crc','localName','localSize','unicode','caseCollision','prefix','overlap','entryBudget','expansionBudget'])test('ZIP boundary rejects '+kind,()=>{
  let b=smallZip();const c=centralOffset(b);let budget:any=undefined;
  if(kind==='trailing')b=Buffer.concat([b,Buffer.from('x')]);if(kind==='truncated')b=b.subarray(0,b.length-1);
  if(kind==='encrypted'){b.writeUInt16LE(1,6);b.writeUInt16LE(1,c+8);}
  if(kind==='descriptor'){b.writeUInt16LE(8,6);b.writeUInt16LE(8,c+8);}
  if(kind==='zip64'){b.writeUInt16LE(45,4);b.writeUInt16LE(45,c+6);}
  if(kind==='extra')b.writeUInt16LE(1,c+30);
  if(kind==='symlink')b.writeUInt32LE(0xa1ff0000,c+38);
  if(kind==='directory')b.writeUInt32LE(0x41ed0000,c+38);
  if(kind==='crc'){b.writeUInt32LE(0,c+16);b.writeUInt32LE(0,14);}
  if(kind==='localName')b[30]=120;
  if(kind==='localSize')b.writeUInt32LE(4,22);
  if(kind==='unicode'){b[30]=255;b[c+46]=255;}
  if(kind==='caseCollision'){const second=c+46+5,offset=b.readUInt32LE(second+42);b[second+46]=65;b[offset+30]=65;}
  if(kind==='prefix')b=Buffer.concat([Buffer.from('x'),b]);
  if(kind==='overlap')b.writeUInt32LE(1,c+42);
  if(kind==='entryBudget')budget={entries:UNIFIED_MAX_ENTRIES,expanded:0};
  if(kind==='expansionBudget')budget={entries:0,expanded:UNIFIED_MAX_EXPANDED};
  assert.throws(()=>readUnifiedZip(b,budget));
});

test('deflate streams must consume exactly the declared compressed bytes',()=>{
  const stored=writeUnifiedZip(new Map([['a.txt',Buffer.from('abc')]])),oldCentral=centralOffset(stored),encoded=Buffer.concat([deflateRawSync(Buffer.from('abc')),Buffer.from('trailing')]);
  const local=Buffer.from(stored.subarray(0,35)),central=Buffer.from(stored.subarray(oldCentral,stored.length-22)),end=Buffer.from(stored.subarray(stored.length-22));
  local.writeUInt16LE(8,8);local.writeUInt32LE(encoded.length,18);central.writeUInt16LE(8,10);central.writeUInt32LE(encoded.length,20);end.writeUInt32LE(local.length+encoded.length,16);
  assert.throws(()=>readUnifiedZip(Buffer.concat([local,encoded,central,end])));
  assert.equal(unifiedCrc32(Buffer.from('123456789')),0xcbf43926);
});

test('bounded deflate input is supported for existing nested component archives',()=>{
  const stored=writeUnifiedZip(new Map([['a.txt',Buffer.from('abc')]])),oldCentral=centralOffset(stored),encoded=deflateRawSync(Buffer.from('abc'));
  const local=Buffer.from(stored.subarray(0,35)),central=Buffer.from(stored.subarray(oldCentral,stored.length-22)),end=Buffer.from(stored.subarray(stored.length-22));
  local.writeUInt16LE(8,8);local.writeUInt32LE(encoded.length,18);central.writeUInt16LE(8,10);central.writeUInt32LE(encoded.length,20);end.writeUInt32LE(local.length+encoded.length,16);
  assert.deepEqual(readUnifiedZip(Buffer.concat([local,encoded,central,end])).get('a.txt'),Buffer.from('abc'));
});
