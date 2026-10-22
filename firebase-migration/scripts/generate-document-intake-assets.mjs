import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),functions=resolve(root,'firebase-migration/functions'),output=resolve(root,'aurora-coletor');
const write=process.argv.length===3&&process.argv[2]==='--write';
if(!write&&!(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--check'))throw Error('EXPLICIT_GENERATOR_MODE_REQUIRED');
if(Number(process.versions.node.split('.')[0])<22)throw Error('NODE_22_REQUIRED');
const names={auroraDocumentIntakeCore:'document_intake_core.cjs',auroraDocumentFactMapping:'document_fact_mapping.cjs'};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const temporary=await mkdtemp(resolve(tmpdir(),'aurora-intake-generated-'));
try{
  const compiler=JSON.parse(await readFile(resolve(functions,'node_modules/typescript/package.json'),'utf8'));
  execFileSync(process.execPath,[resolve(functions,'node_modules/typescript/bin/tsc'),...Object.keys(names).map(name=>'src/'+name+'.ts'),
    '--module','commonjs','--target','ES2022','--outDir',temporary,'--rootDir','src','--strict','--esModuleInterop','--skipLibCheck','--newLine','lf'],
    {cwd:functions,stdio:'pipe',windowsHide:true,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^NODE_(?:OPTIONS|PATH)$/i.test(key)))});
  const files={},sources={};
  for(const [name,target]of Object.entries(names)){
    const bytes=await readFile(resolve(temporary,name+'.js'));files[target]=digest(bytes);
    sources[name+'.ts']=digest(Buffer.from((await readFile(resolve(functions,'src',name+'.ts'),'utf8')).replaceAll('\r\n','\n')));
    const destination=resolve(output,target);
    if(write){try{const stat=await lstat(destination);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw Error('GENERATED_ASSET_PATH_REJECTED');}catch(error){if(error.code!=='ENOENT')throw error;}await writeFile(destination,bytes);}
    else if(!bytes.equals(await readFile(destination)))throw Error('DOCUMENT_INTAKE_GENERATED_DRIFT');
  }
  for(const name of ['document_intake.cjs','document_intake.py'])files[name]=digest(await readFile(resolve(output,name)));
  const manifest=Buffer.from(JSON.stringify({schemaVersion:'aurora.document.intake.assets.v1',generatorVersion:'1.0.0',compilerVersion:compiler.version,sources,files},null,2)+'\n');
  const target=resolve(output,'document-intake-manifest.json');
  if(write)await writeFile(target,manifest);
  else if(!manifest.equals(await readFile(target)))throw Error('DOCUMENT_INTAKE_MANIFEST_DRIFT');
  process.stdout.write(JSON.stringify({status:write?'GENERATED':'GENERATED_BYTES_VERIFIED',sourceCount:2,fileCount:4,manifestSha256:digest(manifest),runtimeDownloads:false})+'\n');
}finally{
  if(dirname(temporary)!==resolve(tmpdir())||!basename(temporary).startsWith('aurora-intake-generated-'))throw Error('GENERATOR_TEMP_PATH_REJECTED');
  await rm(temporary,{recursive:true,force:true});
}
