/** Read the existing protected document; export public verification material only. */
import {createHash,createPublicKey} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const fail=code=>{throw Error(code);};

/** Injected readers/verifier permit tests without credentials, cloud or filesystem. */
export async function collectPublicRelease({sourceSha,releaseRunId,publicKey,readEnvelope,verifyEnvelope}) {
  if(!/^[a-f0-9]{40}$/.test(sourceSha??'')||!/^[1-9][0-9]{0,19}$/.test(releaseRunId??'')
    ||typeof publicKey!=='string'||typeof readEnvelope!=='function'||typeof verifyEnvelope!=='function')
    fail('EXACT_PUBLIC_RELEASE_CONTEXT_REQUIRED');
  const key=createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='ed25519')fail('ED25519_PUBLIC_KEY_REQUIRED');
  const envelope=await readEnvelope();
  const verified=verifyEnvelope(envelope,key.export({type:'spki',format:'pem'}).toString(),
    {expectedSourceSha:sourceSha});
  if(verified.status!=='CANDIDATE_UNVERIFIED'||verified.certificate?.schemaVersion!==2
    ||verified.certificate.sourceSha!==sourceSha||verified.certificate.releaseRunId!==releaseRunId)
    fail('EXACT_ACTIVE_RELEASE_READ_REQUIRED');
  // Copy only protocol-defined public fields. Never serialize the SDK response/context.
  if(!envelope||Object.keys(envelope).sort().join(',')!=='certificate,signature')
    fail('PUBLIC_ENVELOPE_FIELDS_REQUIRED');
  return {envelope:{certificate:verified.certificate,signature:envelope.signature},
    trust:{publicKeySpkiPem:key.export({type:'spki',format:'pem'}).toString(),
      publicKeySha256:createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')},
    sourceSha,certificateSha256:verified.certificateSha256};
}

async function main() {
  const env=process.env,output=process.argv[2];
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REF!=='refs/heads/main'
    ||env.GCLOUD_PROJECT!=='wmgj-hml-jfn-20260927'||!output)
    fail('PROTECTED_PUBLIC_EXPORT_CONTEXT_REQUIRED');
  const {verifyActiveReleaseEnvelope}=await import('../functions/lib/auroraActiveRelease.js');
  const require=createRequire(new URL('../functions/package.json',import.meta.url));
  const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
  const database=getFirestore(initializeApp({projectId:env.GCLOUD_PROJECT}));
  const result=await collectPublicRelease({sourceSha:env.GITHUB_SHA,releaseRunId:env.GITHUB_RUN_ID,
    publicKey:env.AURORA_ACTIVE_RELEASE_PUBLIC_KEY,verifyEnvelope:verifyActiveReleaseEnvelope,
    readEnvelope:async()=>{const snapshot=await database.doc('platformRuntime/activeRelease').get();
      if(!snapshot.exists)fail('ACTIVE_RELEASE_READ_REQUIRED');return snapshot.data();}});
  const directory=resolve(output);
  await mkdir(directory,{recursive:false});
  await writeFile(resolve(directory,'release-envelope-signed.json'),JSON.stringify(result.envelope)+'\n',{flag:'wx'});
  await writeFile(resolve(directory,'public-trust.json'),JSON.stringify(result.trust)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({status:'PUBLIC_RELEASE_CERTIFICATE_EXPORTED',sourceSha:result.sourceSha,
    certificateSha256:result.certificateSha256,privateMaterialExported:false})+'\n');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(()=>{process.stderr.write('PUBLIC_RELEASE_EXPORT_REJECTED\n');process.exitCode=2;});
}
