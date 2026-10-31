import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {lstat, readdir, mkdir, writeFile, realpath} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';

const require=createRequire(import.meta.url);
const {readRegularFile}=require('../../desktop/ia-master/safe-read.cjs');
const WINDOWS_INTEGRATION_VERSION='1.0.8';
export const WINDOWS_INTEGRATION_FILES=Object.freeze(['aurora_cloud_sync.py','aurora_deployment.py','client_agent.py',
  'client_secret_store.py','install_client_agent.py','provider_connectors.py','published_release.py',
  'document_intake.py','document_intake.cjs','document_intake_core.cjs','document_fact_mapping.cjs','document-intake-manifest.json']);
export const IA_MASTER_FILES=Object.freeze([
  'README.md','app.css','app.js','index.html','knowledge-registry.cjs','manage.cjs','modus-operandi.md','published-update.cjs',
  'publisher.cjs','safe-read.cjs','server.cjs','studio-local.css','studio-local.js','studio.cjs','update.cjs',
  ...WINDOWS_INTEGRATION_FILES.map(name=>'client-agent/'+name),
  'assets/fonts/source-serif-4-regular.woff2','assets/fonts/source-serif-4-semibold.woff2',
  'assets/fonts/atkinson-hyperlegible-next.woff2','assets/fonts/Source-Serif-OFL.txt',
  'assets/fonts/Atkinson-Hyperlegible-Next-OFL.txt','assets/fonts/provenance.json',
  ...['auroraMasterEngine','auroraNativeIntelligence','auroraNativeRoutines','auroraIaMaster','auroraProductionOrchestrator','auroraDataGovernance','auroraReliableResult','auroraChelfex']
    .map(name=>'kernel/'+name+'.js')]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const demand=(condition,code)=>{if(!condition)throw Error(code);};
const safeName=name=>typeof name==='string'&&/^[A-Za-z0-9._/-]+$/.test(name)&&!name.startsWith('/')
  &&name.split('/').every(part=>part&&part!=='.'&&part!=='..'
    &&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const sameNames=(left,right)=>JSON.stringify([...left].sort())===JSON.stringify([...right].sort());

export async function readPackageFile(directory,name,maximum=8*1024*1024){
  demand(safeName(name),'COMPONENT_PATH_REJECTED');
  const base=resolve(directory),file=resolve(base,...name.split('/'));
  demand(file.startsWith(base+'/')||file.startsWith(base+'\\'),'COMPONENT_PATH_REJECTED');
  let cursor=base;
  demand(!(await lstat(cursor)).isSymbolicLink()&&(await lstat(cursor)).isDirectory(),'COMPONENT_PATH_REJECTED');
  for(const part of name.split('/')){
    cursor=resolve(cursor,part);const info=await lstat(cursor);
    demand(!info.isSymbolicLink()&&(cursor===file?info.isFile()&&info.nlink===1&&info.size<=maximum:info.isDirectory()),'COMPONENT_PATH_REJECTED');
  }
  demand((await realpath(file)).startsWith((await realpath(base))+'/')||(await realpath(file)).startsWith((await realpath(base))+'\\'),'COMPONENT_PATH_REJECTED');
  return readRegularFile(file,maximum);
}

async function packageNames(directory){
  const names=[];
  async function visit(sub=''){
    for(const entry of await readdir(resolve(directory,sub),{withFileTypes:true})){
      const name=sub?sub+'/'+entry.name:entry.name;
      demand(safeName(name)&&!entry.isSymbolicLink(),'COMPONENT_PATH_REJECTED');
      if(entry.isDirectory())await visit(name);
      else {demand(entry.isFile(),'COMPONENT_PATH_REJECTED');names.push(name);}
      demand(names.length<=200,'COMPONENT_SIZE_REJECTED');
    }
  }
  await visit();return names;
}

export async function readComponentPackage(directory,component,expectedSourceSha){
  demand(/^[a-f0-9]{40}$/.test(expectedSourceSha),'COMPONENT_SOURCE_REQUIRED');
  demand(['iaMaster','windowsIntegration'].includes(component),'COMPONENT_IDENTITY_CONFLICT');
  const manifestBytes=await readPackageFile(directory,'manifest.json',65536);
  let manifest;try{manifest=JSON.parse(manifestBytes.toString('utf8'));}catch{throw Error('COMPONENT_MANIFEST_INVALID');}
  demand(manifest&&typeof manifest==='object'&&!Array.isArray(manifest),'COMPONENT_MANIFEST_INVALID');
  const expected=component==='iaMaster'?IA_MASTER_FILES:WINDOWS_INTEGRATION_FILES;
  const revision=component==='iaMaster'?manifest.sourceRevision:manifest.sourceSha;
  demand(manifest&&revision===expectedSourceSha&&manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files)
    &&sameNames(Object.keys(manifest.files),expected),'COMPONENT_MANIFEST_INVALID');
  if(component==='iaMaster')demand(manifest.component==='AURORA_IA_MASTER'&&manifest.version==='1.1.0'&&manifest.dirty===false
    &&manifest.nodeMinimumMajor===22&&manifest.externalAiEnabled===false
    &&manifest.clientAgent?.component==='AURORA_CLIENT_AGENT'&&manifest.clientAgent.version==='1.0.5'
    &&manifest.clientAgent.configured===false&&manifest.clientAgent.sourceAuthorizationRequired===true
    &&manifest.clientAgent.providerConnectionsVerified===false,'COMPONENT_IDENTITY_CONFLICT');
  else demand(manifest.schemaVersion===1&&manifest.component==='AURORA_WINDOWS_INTEGRATION'&&manifest.version===WINDOWS_INTEGRATION_VERSION
    &&manifest.platform==='windows','COMPONENT_IDENTITY_CONFLICT');
  const actualNames=await packageNames(directory);
  demand(sameNames(actualNames,[...expected,'manifest.json'])&&new Set(actualNames.map(name=>name.toLowerCase())).size===actualNames.length,
    'COMPONENT_FILE_COMPOSITION_CONFLICT');
  const fileBytes={};let total=manifestBytes.length;
  for(const name of expected){
    const bytes=await readPackageFile(directory,name);total+=bytes.length;
    demand(total<=16*1024*1024&&digest(bytes)===manifest.files[name],'COMPONENT_FILES_CONFLICT');fileBytes[name]=bytes;
  }
  return {manifest,manifestBytes,fileBytes};
}

export function windowsIntegrationPackage(iaMasterPackage,expectedSourceSha){
  demand(iaMasterPackage.manifest.sourceRevision===expectedSourceSha,'COMPONENT_SOURCE_REQUIRED');
  const fileBytes={};
  for(const name of WINDOWS_INTEGRATION_FILES){
    const bytes=iaMasterPackage.fileBytes['client-agent/'+name];
    demand(bytes instanceof Uint8Array,'COMPONENT_FILES_CONFLICT');fileBytes[name]=bytes;
  }
  const manifest={schemaVersion:1,component:'AURORA_WINDOWS_INTEGRATION',version:WINDOWS_INTEGRATION_VERSION,sourceSha:expectedSourceSha,
    platform:'windows',files:Object.fromEntries(WINDOWS_INTEGRATION_FILES.map(name=>[name,digest(fileBytes[name])]))};
  return {manifest,manifestBytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n'),fileBytes};
}

/** Write only a fixed generated public package; an existing divergent package fails closed. */
export async function retainComponentPackage(outputDirectory,name,pkg){
  demand(['ia-master-package','windows-integration-package'].includes(name),'COMPONENT_PATH_REJECTED');
  const root=resolve(outputDirectory),target=resolve(root,name);
  demand(dirname(target)===root,'COMPONENT_PATH_REJECTED');
  await mkdir(root,{recursive:true});
  demand(!(await lstat(root)).isSymbolicLink(),'COMPONENT_PATH_REJECTED');
  try{await mkdir(target);}catch(error){if(error.code!=='EEXIST')throw error;}
  demand((await lstat(target)).isDirectory()&&!(await lstat(target)).isSymbolicLink(),'COMPONENT_PATH_REJECTED');
  const prior=await packageNames(target);
  demand(prior.every(entry=>entry==='manifest.json'||Object.hasOwn(pkg.fileBytes,entry)),'COMPONENT_FILE_COMPOSITION_CONFLICT');
  for(const [relativeName,bytes] of Object.entries({...pkg.fileBytes,'manifest.json':pkg.manifestBytes})){
    demand(safeName(relativeName),'COMPONENT_PATH_REJECTED');
    const destination=resolve(target,...relativeName.split('/'));
    await mkdir(dirname(destination),{recursive:true});
    try{await writeFile(destination,bytes,{flag:'wx'});}catch(error){
      if(error.code!=='EEXIST'||!Buffer.from(await readPackageFile(target,relativeName)).equals(Buffer.from(bytes)))throw Error('GENERATED_COMPONENT_CHANGED');
    }
  }
  const retained=await readComponentPackage(target,name==='ia-master-package'?'iaMaster':'windowsIntegration',
    pkg.manifest.sourceRevision??pkg.manifest.sourceSha);
  demand(retained.manifestBytes.equals(pkg.manifestBytes),'GENERATED_COMPONENT_CHANGED');
  return target;
}

/** Deterministic public archive; names and bytes are checked again before retention. */
export async function retainComponentZip(python,packageDirectory,outputFilename,pkg){
  const entries=Object.fromEntries(Object.entries({...pkg.fileBytes,'manifest.json':pkg.manifestBytes}).map(([name,bytes])=>[name,digest(bytes)]));
  const script=`import hashlib,io,json,pathlib,stat,sys,zipfile
root=pathlib.Path(sys.argv[1]).resolve(strict=True);expected=json.loads(sys.argv[2]);out=io.BytesIO()
actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
assert actual==set(expected)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in sorted(expected):
  p=root.joinpath(*name.split('/'));info=p.lstat();assert not p.is_symlink() and stat.S_ISREG(info.st_mode) and info.st_nlink==1
  data=p.read_bytes();assert len(data)<=8*1024*1024 and hashlib.sha256(data).hexdigest()==expected[name]
  zi=zipfile.ZipInfo(name,(1980,1,1,0,0,0));zi.compress_type=zipfile.ZIP_DEFLATED;zi.external_attr=0o100644<<16;z.writestr(zi,data)
sys.stdout.buffer.write(out.getvalue())`;
  let bytes;try{bytes=execFileSync(python,['-c',script,packageDirectory,JSON.stringify(entries)],{maxBuffer:17*1024*1024,windowsHide:true});}
  catch{throw Error('COMPONENT_ZIP_BUILD_REJECTED');}
  demand(bytes.length<=16*1024*1024,'COMPONENT_SIZE_REJECTED');
  try{await writeFile(outputFilename,bytes,{flag:'wx'});}catch(error){
    if(error.code!=='EEXIST'||!readRegularFile(outputFilename,16*1024*1024).equals(bytes))throw Error('GENERATED_COMPONENT_CHANGED');
  }
  return {size:bytes.length,sha256:digest(bytes)};
}
