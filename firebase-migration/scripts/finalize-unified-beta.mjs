/** Official CLI for the same pure finalizer used by authenticated downloads. */
import {lstat,open,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {finalizeUnifiedBeta,verifyUnifiedCandidate,unifiedDigest,parseUnifiedJson,UNIFIED_MAX_ARCHIVE} from '../functions/lib/auroraUnifiedBetaArchive.js';

import {finalizeClientPatch} from '../functions/lib/auroraClientPatchArchive.js';

async function regular(path,maximum){
  const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum)throw Error('SAFE_PUBLIC_FILE_REQUIRED');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const opened=await handle.stat();if(!opened.isFile()||opened.nlink!==1||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.size>maximum)throw Error('PUBLIC_FILE_CHANGED');
    const storage=Buffer.alloc(Math.min(opened.size+1,maximum+1));let length=0;
    while(length<storage.length){const part=await handle.read(storage,length,storage.length-length,null);if(!part.bytesRead)break;length+=part.bytesRead;}
    const after=await handle.stat(),pathAfter=await lstat(path);
    if(length!==before.size||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||pathAfter.isSymbolicLink()||!pathAfter.isFile()||pathAfter.nlink!==1||pathAfter.dev!==after.dev||pathAfter.ino!==after.ino)throw Error('PUBLIC_FILE_CHANGED');
    return storage.subarray(0,length);
  }finally{await handle.close();}
}
export async function finalizePublicFiles(options){
  const candidate=await regular(options.candidate,UNIFIED_MAX_ARCHIVE),envelope=parseUnifiedJson(await regular(options.publicEnvelope,65536)),trust=parseUnifiedJson(await regular(options.publicTrust,16384));
  if(!trust||Object.keys(trust).sort().join(',')!=='publicKeySha256,publicKeySpkiPem'||trust.publicKeySha256!==options.trustedPublicKeySha256)throw Error('TRUST_ANCHOR_CONFLICT');
  return (options.clientOnly ? finalizeClientPatch : finalizeUnifiedBeta)({candidate,envelope,publicKeySpkiPem:trust.publicKeySpkiPem,trustedPublicKeySha256:options.trustedPublicKeySha256,sourceSha:options.sourceSha,expectedCandidateSha256:options.expectedCandidateSha256});
}
async function main(){
  const argv=process.argv.slice(2);
  const clientOnly=argv[0]==='--client-only';if(clientOnly)argv.shift();
  if(argv[0]==='--verify-candidate'){
    if(clientOnly)throw Error('CONFLICTING_PUBLIC_ARGUMENTS');
    if(argv.length!==5||argv[1]!=='--candidate'||argv[3]!=='--source-sha')throw Error('EXACT_CANDIDATE_ARGUMENTS_REQUIRED');
    const bytes=await regular(argv[2],UNIFIED_MAX_ARCHIVE);verifyUnifiedCandidate(bytes,argv[4]);
    process.stdout.write(JSON.stringify({status:'SOURCE_BOUND_CANDIDATE_UNVERIFIED',complete:false,sourceSha:argv[4],archiveSha256:unifiedDigest(bytes),archiveBytes:bytes.length})+'\n');return;
  }
  const allowed=new Set(['--candidate','--public-envelope','--public-trust','--source-sha','--expected-candidate-sha256','--trusted-public-key-sha256','--output']),values={};
  if(argv.length!==14)throw Error('EXACT_PUBLIC_ARGUMENTS_REQUIRED');
  for(let i=0;i<argv.length;i+=2){const key=argv[i];if(!allowed.has(key)||Object.hasOwn(values,key)||!argv[i+1])throw Error('INVALID_PUBLIC_ARGUMENT');values[key]=argv[i+1];}
  const result=await finalizePublicFiles({clientOnly,candidate:values['--candidate'],publicEnvelope:values['--public-envelope'],publicTrust:values['--public-trust'],sourceSha:values['--source-sha'],expectedCandidateSha256:values['--expected-candidate-sha256'],trustedPublicKeySha256:values['--trusted-public-key-sha256']});
  const output=resolve(values['--output']);
  try{await writeFile(output,result.bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||!(await regular(output,UNIFIED_MAX_ARCHIVE)).equals(result.bytes))throw Error('OUTPUT_CONFLICT');}
  process.stdout.write(JSON.stringify({status:'PREPARADO',scope:clientOnly?'CLIENT_ONLY':'FULL_INTERNAL_EVIDENCE',complete:false,sourceSha:result.sourceSha,releaseId:result.delivery.releaseId,archiveSha256:result.sha256,archiveBytes:result.bytes.length,allDeclaredPayloadsPresent:true})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{process.stderr.write('UNIFIED_BETA_FINALIZATION_REJECTED\n');process.exitCode=2;});
