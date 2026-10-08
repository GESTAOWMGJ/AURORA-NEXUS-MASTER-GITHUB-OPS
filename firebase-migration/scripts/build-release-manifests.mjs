import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const functions=resolve(repo,'firebase-migration/functions');
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(sourceSha))throw Error('SOURCE_SHA_REQUIRED');
execFileSync('git',['diff','--exit-code','HEAD','--'],{cwd:repo,stdio:'pipe'});
const policy=await readFile(resolve(functions,'src/auroraReleaseStatus.ts'),'utf8');
const version=/AURORA_PRODUCT_VERSION\s*=\s*"([^"]+)"/.exec(policy)?.[1];
if(!version)throw Error('PRODUCT_VERSION_REQUIRED');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function collect(directory,base,predicate=()=>true){
  const files={};
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=resolve(directory,entry.name);
    if(entry.isSymbolicLink())throw Error('RELEASE_SYMLINK_REJECTED');
    if(entry.isDirectory())Object.assign(files,await collect(path,base,predicate));
    else if(entry.isFile()&&predicate(path))files[relative(base,path).replaceAll('\\','/')]=digest(await readFile(path));
  }
  return files;
}
const serverFiles=await collect(resolve(functions,'lib'),functions,path=>path.endsWith('.js'));
if(!serverFiles['lib/auroraRuntime.js']||!serverFiles['lib/auroraActiveReleaseRuntime.js'])throw Error('BUILT_RUNTIME_REQUIRED');
const sources=await collect(resolve(functions,'src'),functions,path=>path.endsWith('.ts')&&!path.endsWith('.d.ts'));
const expectedFiles=Object.keys(sources).map(name=>name.replace(/^src\//,'lib/').replace(/\.ts$/,'.js')).sort();
if(JSON.stringify(Object.keys(serverFiles).sort())!==JSON.stringify(expectedFiles))throw Error('STALE_OR_INCOMPLETE_BUILD_REJECTED');
// The web pin attests the dynamic interface emitted by Functions, whose bytes
// the serving process can observe. Static hosting assets are deployed together
// but their remote/browser installation is never inferred from this manifest.
// Include the complete compiled dependency closure, including web update,
// tenant routing and IA/profile view helpers imported by the renderers.
const webFiles={...serverFiles};
const output=resolve(functions,'runtime-release');await mkdir(output,{recursive:true});
for(const [component,files] of [['server',serverFiles],['web',webFiles]]){
  const bytes=JSON.stringify({schemaVersion:1,sourceSha,version,files},null,2)+'\n';
  await writeFile(resolve(output,`${component}-manifest.json`),bytes);
  console.log(JSON.stringify({component,sourceSha,version,manifestSha256:digest(bytes),fileCount:Object.keys(files).length}));
}
// Satellite pin comes only from the exact installer manifest produced by predeploy.
const satellite=await readFile(resolve(functions,'private-downloads/manifest.json'));
const data=JSON.parse(satellite);
if(data.sourceCommit!==sourceSha||typeof data.version!=='string'||!Array.isArray(data.files)||!data.files.length)throw Error('SATELLITE_SOURCE_CONFLICT');
for(const file of data.files){
  if(typeof file.name!=='string'||!/^[A-Za-z0-9._-]+\.(?:zip|exe)$/.test(file.name)
      ||!Number.isSafeInteger(file.size)||file.size<1)throw Error('SATELLITE_PACKAGE_CONFLICT');
  const bytes=await readFile(resolve(functions,'private-downloads',file.name));
  if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw Error('SATELLITE_PACKAGE_CONFLICT');
}
await writeFile(resolve(output,'satellite-manifest.json'),satellite);
console.log(JSON.stringify({component:'satellite',sourceSha,version:data.version,manifestSha256:digest(satellite)}));
