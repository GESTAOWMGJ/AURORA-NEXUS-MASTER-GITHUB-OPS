import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,unlinkSync,linkSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {IA_MASTER_FILES,WINDOWS_INTEGRATION_FILES,readComponentPackage,windowsIntegrationPackage,
  retainComponentPackage,retainComponentZip} from '../../scripts/release-component-packages.mjs';
const sourceSha='a'.repeat(40),hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function fixture(t:any){
  const temporary=mkdtempSync(join(tmpdir(),'aurora-components-contract-'));
  t.after(()=>{assert.equal(dirname(temporary),tmpdir());assert.ok(temporary.split(/[\\/]/).at(-1)?.startsWith('aurora-components-contract-'));rmSync(temporary,{recursive:true,force:true});});
  const directory=join(temporary,'ia-master');mkdirSync(directory);
  const fileBytes=Object.fromEntries(IA_MASTER_FILES.map((name:string)=>[name,Buffer.from('synthetic public '+name+'\n')]));
  const manifest:any={component:'AURORA_IA_MASTER',version:'1.1.0',sourceRevision:sourceSha,dirty:false,nodeMinimumMajor:22,externalAiEnabled:false,
    clientAgent:{component:'AURORA_CLIENT_AGENT',version:'1.0.1',configured:false,sourceAuthorizationRequired:true,providerConnectionsVerified:false},
    files:Object.fromEntries(Object.entries(fileBytes).map(([name,bytes])=>[name,hash(bytes as Uint8Array)]))};
  const rewrite=()=>writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const [name,bytes] of Object.entries(fileBytes)){const file=join(directory,...name.split('/'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes as Uint8Array);}
  rewrite();return {temporary,directory,manifest,fileBytes,rewrite};
}
test('existing package closure yields separate real IA34 and Windows7 manifests without config or acceptance claims',async t=>{
  const f=fixture(t),ia=await readComponentPackage(f.directory,'iaMaster',sourceSha),windows=windowsIntegrationPackage(ia,sourceSha);
  assert.equal(Object.keys(ia.fileBytes).length,34);assert.equal(Object.keys(windows.fileBytes).length,7);
  assert.deepEqual(Object.keys(windows.fileBytes).sort(),[...WINDOWS_INTEGRATION_FILES].sort());
  for(const name of WINDOWS_INTEGRATION_FILES)assert.ok(Buffer.from(windows.fileBytes[name]).equals(Buffer.from(ia.fileBytes['client-agent/'+name])));
  assert.equal(windows.manifest.sourceSha,sourceSha);assert.equal(windows.manifest.component,'AURORA_WINDOWS_INTEGRATION');
  assert.equal('configured' in windows.manifest,false);assert.equal('installationVerified' in windows.manifest,false);
});
for(const scenario of ['wrong source','dirty','configured agent','extra claimed path','missing claim','changed bytes','missing public file','extra private file'])test(`component closure rejects ${scenario}`,async t=>{
  const f=fixture(t);
  if(scenario==='wrong source')f.manifest.sourceRevision='b'.repeat(40);
  if(scenario==='dirty')f.manifest.dirty=true;if(scenario==='configured agent')f.manifest.clientAgent.configured=true;
  if(scenario==='extra claimed path')f.manifest.files['../private']=hash(Buffer.from('synthetic'));
  if(scenario==='missing claim')delete f.manifest.files['published-update.cjs'];
  if(scenario==='changed bytes')writeFileSync(join(f.directory,'server.cjs'),'changed');
  if(scenario==='missing public file')unlinkSync(join(f.directory,'client-agent/published_release.py'));
  if(scenario==='extra private file')writeFileSync(join(f.directory,'control.key'),'synthetic extra');
  f.rewrite();await assert.rejects(readComponentPackage(f.directory,'iaMaster',sourceSha),/COMPONENT_/);
});
test('hardlinked public input is rejected without following or reading a private path',async t=>{
  const f=fixture(t),file=join(f.directory,'server.cjs');linkSync(file,join(f.temporary,'second-public-link'));
  await assert.rejects(readComponentPackage(f.directory,'iaMaster',sourceSha),/COMPONENT_PATH_REJECTED/);
});
test('linked package directory is rejected before a file claim is accepted',async t=>{
  const f=fixture(t),link=join(f.temporary,'linked-package');
  try{symlinkSync(f.directory,link,process.platform==='win32'?'junction':'dir');}catch(error:any){if(['EPERM','EACCES'].includes(error.code)){t.skip('Local symbolic-link creation unavailable');return;}throw error;}
  await assert.rejects(readComponentPackage(link,'iaMaster',sourceSha),/COMPONENT_PATH_REJECTED/);
});
test('retention preserves divergent generated package bytes instead of overwriting them',async t=>{
  const f=fixture(t),ia=await readComponentPackage(f.directory,'iaMaster',sourceSha),output=join(f.temporary,'retained');
  const target=await retainComponentPackage(output,'ia-master-package',ia);
  const file=join(target,'server.cjs');writeFileSync(file,'concurrent-public-change');
  await assert.rejects(retainComponentPackage(output,'ia-master-package',ia),/GENERATED_COMPONENT_CHANGED/);
  assert.equal(readFileSync(file,'utf8'),'concurrent-public-change');
});
test('archive binds the exact expanded manifest and public files and is deterministic',async t=>{
  const f=fixture(t),ia=await readComponentPackage(f.directory,'iaMaster',sourceSha),output=join(f.temporary,'retained');
  const target=await retainComponentPackage(output,'ia-master-package',ia),zip=join(output,'ia-master.zip');
  const first=await retainComponentZip(process.platform==='win32'?'python':'python3',target,zip,ia);
  const second=await retainComponentZip(process.platform==='win32'?'python':'python3',target,zip,ia);
  assert.equal(first.sha256,second.sha256);assert.equal(first.sha256,hash(readFileSync(zip)));
  assert.ok(first.size>0);assert.equal(readFileSync(zip).subarray(0,2).toString(),'PK');
});
