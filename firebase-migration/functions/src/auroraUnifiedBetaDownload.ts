/** Read-only bridge from the packaged candidate to the existing protected pin. */
import { createPublicKey } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIVE_RELEASE_SOURCE, verifyActiveReleaseEnvelope } from './auroraActiveRelease.js';
import { finalizeUnifiedBeta, UNIFIED_MAX_ARCHIVE, unifiedDigest, type UnifiedFinalization } from './auroraUnifiedBetaArchive.js';

type Runtime = {
  verification: {status:string;certificateSha256?:string};
  runtimeBuild: {sourceSha:string|null;manifestSha256:string|null;fileIntegrityVerified:boolean};
  runtimeBuildWeb: {sourceSha:string|null;manifestSha256:string|null;fileIntegrityVerified:boolean};
  localServer: {fileIntegrityVerified:boolean};localWeb?:{fileIntegrityVerified:boolean};
};
type Dependencies = {publicKey:()=>string|undefined;readFixedEnvelope:()=>Promise<unknown>;
  readCandidate:()=>Promise<Uint8Array>;readRuntime:()=>Promise<Runtime>;now?:()=>number};
export type CurrentUnifiedBeta = UnifiedFinalization & {assertCurrent:()=>Promise<void>;release:()=>void};
export class UnifiedBetaBusyError extends Error {constructor(){super('UNIFIED_BETA_BUSY');this.name='UnifiedBetaBusyError';}}
const need=(condition:unknown,code:string)=>{if(!condition)throw Error(code);};

export function createUnifiedBetaReader(deps:Dependencies):()=>Promise<CurrentUnifiedBeta> {
  // Capture the candidate's bytes at process startup, like the existing runtime
  // manifests. A later disk replacement cannot relabel an already loaded process.
  const initial=Promise.resolve().then(()=>deps.readCandidate()).then(b=>Buffer.from(b));
  void initial.catch(()=>{});
  let cached:UnifiedFinalization|undefined;
  let inFlight=false;
  return async()=>{
    // No queue and no repeated file work while another response owns the permit.
    // The caller holds it through reauthorization and the final current-pin guard.
    if(inFlight)throw new UnifiedBetaBusyError();inFlight=true;
    let released=false;const release=()=>{if(!released){released=true;inFlight=false;}};
    try{
    const startup=await initial,current=Buffer.from(await deps.readCandidate());
    need(current.equals(startup),'CANDIDATE_CHANGED_AFTER_START');
    const publicKey=deps.publicKey();need(typeof publicKey==='string','TRUST_UNAVAILABLE');
    const key=createPublicKey(publicKey!);need(key.asymmetricKeyType==='ed25519','ED25519_REQUIRED');
    const trustedHash=unifiedDigest(key.export({type:'spki',format:'der'}));
    const raw=await deps.readFixedEnvelope(),checked=verifyActiveReleaseEnvelope(raw,publicKey,{now:deps.now?.()});
    if(checked.status!=='CANDIDATE_UNVERIFIED')throw Error('CURRENT_REFERENCE_REQUIRED');
    const certificate=checked.certificate,runtime=await deps.readRuntime();
    need(runtime.verification.status==='VERIFIED_ACTIVE_PIN'&&runtime.verification.certificateSha256===checked.certificateSha256
      &&runtime.runtimeBuild.fileIntegrityVerified&&runtime.runtimeBuildWeb.fileIntegrityVerified&&runtime.localServer.fileIntegrityVerified&&runtime.localWeb?.fileIntegrityVerified
      &&runtime.runtimeBuild.sourceSha===certificate.sourceSha&&runtime.runtimeBuildWeb.sourceSha===certificate.sourceSha
      &&runtime.runtimeBuild.manifestSha256===certificate.components.server.manifestSha256&&runtime.runtimeBuildWeb.manifestSha256===certificate.components.web.manifestSha256,'CURRENT_RUNTIME_REQUIRED');
    if(!cached||cached.certificateSha256!==checked.certificateSha256)cached=finalizeUnifiedBeta({candidate:current,envelope:raw,publicKeySpkiPem:publicKey!,trustedPublicKeySha256:trustedHash,
      sourceSha:certificate.sourceSha,expectedCandidateSha256:unifiedDigest(startup),now:deps.now?.()});
    const result=cached;
    const assertCurrent=async()=>{
      const [latestBytes,latestRaw]=await Promise.all([deps.readCandidate(),deps.readFixedEnvelope()]);
      need(Buffer.from(latestBytes).equals(startup),'CANDIDATE_CHANGED_DURING_READ');
      need(deps.publicKey()===publicKey,'TRUST_CHANGED_DURING_READ');
      const latest=verifyActiveReleaseEnvelope(latestRaw,publicKey,{now:deps.now?.()});
      need(latest.status==='CANDIDATE_UNVERIFIED'&&latest.certificateSha256===result.certificateSha256,'REFERENCE_CHANGED_DURING_READ');
    };
    await assertCurrent();return {...result,assertCurrent,release};
    }catch(error){release();throw error;}
  };
}

/** Fixed packaged path only. No filename, source SHA or root comes from HTTP. */
export async function readPackagedUnifiedCandidate():Promise<Buffer> {
  const base=resolve(__dirname,'..'),parts=['runtime-release','unified-beta-candidate.zip'];
  let path=base;
  for(let i=0;i<parts.length;i++){
    path=resolve(path,parts[i]!);const before=await lstat(path);
    if(before.isSymbolicLink()||(i===0?!before.isDirectory():!before.isFile()||before.nlink!==1||before.size>UNIFIED_MAX_ARCHIVE))throw Error('UNSAFE_PACKAGED_CANDIDATE');
  }
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat();need(before.isFile()&&before.nlink===1&&before.size<=UNIFIED_MAX_ARCHIVE,'UNSAFE_PACKAGED_CANDIDATE');
    const storage=Buffer.alloc(Math.min(before.size+1,UNIFIED_MAX_ARCHIVE+1));let length=0;
    while(length<storage.length){const part=await handle.read(storage,length,storage.length-length,null);if(!part.bytesRead)break;length+=part.bytesRead;}
    const after=await handle.stat(),pathAfter=await lstat(path);
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&length===before.size&&pathAfter.isFile()&&!pathAfter.isSymbolicLink()&&pathAfter.nlink===1&&pathAfter.dev===after.dev&&pathAfter.ino===after.ino,'PACKAGED_CANDIDATE_CHANGED');
    return storage.subarray(0,length);
  }finally{await handle.close();}
}

// AuthGate creates this once at process initialization; HTTP reads happen only
// after its existing session/member boundary. No new authority or resource.
export async function makeRuntimeUnifiedBetaReader():Promise<()=>Promise<CurrentUnifiedBeta>> {
  const [{auroraDb},{readRuntimeActiveRelease}]=await Promise.all([import('./firebase.js'),import('./auroraActiveReleaseRuntime.js')]);
  return createUnifiedBetaReader({publicKey:()=>process.env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY,readCandidate:readPackagedUnifiedCandidate,
    readFixedEnvelope:async()=>{const snapshot=await auroraDb.doc(ACTIVE_RELEASE_SOURCE).get();return snapshot.exists?snapshot.data():undefined;},readRuntime:readRuntimeActiveRelease});
}
