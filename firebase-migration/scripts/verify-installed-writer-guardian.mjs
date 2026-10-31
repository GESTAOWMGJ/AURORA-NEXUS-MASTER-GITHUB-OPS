import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {writerLeasePath,WRITER_GUARDIAN_ID} from '../functions/lib/auroraWriterGuardian.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const origin='https://auroranexus.com.br', project='wmgj-hml-jfn-20260927';
const fail=code=>{throw Error(code);};
const field=(doc,key)=>doc?.fields?.[key]?.stringValue??doc?.fields?.[key]?.integerValue??doc?.fields?.[key]?.doubleValue;

/** Metadata only. A successful HTTP response alone never proves a guarded commit. */
export function verifyInstalledWriterObservation({bootstrap,sourceSha,manifestBytes,before,after,projection,httpStatus}) {
  const manifest=JSON.parse(manifestBytes.toString()),build=bootstrap?.canonicalVersion?.runtimeBuild;
  if(!/^[a-f0-9]{40}$/.test(sourceSha??'')||bootstrap?.ok!==true||bootstrap?.environment!=='HOMOLOGATION'
    ||bootstrap?.organization?.id!=='wmgj'||build?.sourceSha!==sourceSha||build?.manifestSha256!==sha(manifestBytes)
    ||manifest.sourceSha!==sourceSha||!manifest.files?.['lib/realtimePlatformGuardian.js']
    ||!manifest.files?.['lib/auroraWriterGuardian.js'])fail('WRITER_INSTALLED_SOURCE_CONFLICT');
  const policy=bootstrap.release?.writerGuardian;
  if(policy?.routineId!==WRITER_GUARDIAN_ID||policy.version!=='1.1.0'||policy.migratedTransactionBoundaries!==19
    ||policy.allLegacyWritersEnforced!==false)fail('WRITER_INSTALLED_POLICY_CONFLICT');
  const priorEpoch=before?Number(field(before,'epoch')):0,epoch=Number(field(after,'epoch'));
  const sameCommit=typeof after?.updateTime==='string'&&after.updateTime===projection?.updateTime;
  const verified=httpStatus===200&&Number.isSafeInteger(priorEpoch)&&priorEpoch>=0&&Number.isSafeInteger(epoch)&&epoch>priorEpoch
    &&field(after,'guardianId')===WRITER_GUARDIAN_ID&&field(after,'orgId')==='wmgj'
    &&field(after,'resourceKey')==='canonical-data'&&field(after,'state')==='RELEASED'
    &&field(after,'holder')==='CLOUD_CONTROL_PLANE'&&sameCommit
    &&typeof field(projection,'snapshotId')==='string'&&/^[a-f0-9]{64}$/.test(field(projection,'sourceHash')??'');
  return {schemaVersion:'aurora.writer-installed-proof.v1',status:verified?'INSTALLED_COMMIT_VERIFIED':'PENDING_EFFECT_PROOF',
    sourceSha,guardianVersion:policy.version,migratedTransactionBoundaries:19,installedCodeVerified:true,
    canonicalCommitVerified:verified,leaseAndProjectionSameCommit:sameCommit,
    leaseEpoch:Number.isSafeInteger(epoch)?epoch:null,leaseUpdateTime:after?.updateTime??null,
    snapshotIdHash:verified?sha(field(projection,'snapshotId')):null,
    refreshHttpStatus:Number.isInteger(httpStatus)?httpStatus:null,
    allLegacyWritersEnforced:false,physicalHandoffVerified:false,sourceMutation:false};
}

export function sessionFromCookieJar(text) {
  const rows=text.split(/\r?\n/).filter(line=>!line.startsWith('#')||line.startsWith('#HttpOnly_'))
    .map(line=>line.replace(/^#HttpOnly_/, '').split('\t'))
    .filter(row=>row.length===7&&row[0]==='auroranexus.com.br'&&row[3]==='TRUE'&&row[5]==='__session');
  if(rows.length!==1||!/^[A-Za-z0-9._~-]+$/.test(rows[0][6]))fail('WRITER_SMOKE_SESSION_REQUIRED');
  return `__session=${rows[0][6]}`;
}

async function main() {
  try {
    if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS'
      ||process.env.PROJECT_ID!==project)fail('WRITER_SMOKE_CONTEXT_REJECTED');
    const args=process.argv.slice(2),values={};
    for(let i=0;i<args.length;i+=2){if(!['--bootstrap','--cookie-jar','--output'].includes(args[i])||values[args[i]]||!args[i+1])fail('WRITER_SMOKE_INPUT_REJECTED');values[args[i]]=args[i+1];}
    if(Object.keys(values).length!==3)fail('WRITER_SMOKE_INPUT_REJECTED');
    const bootstrap=JSON.parse(readFileSync(values['--bootstrap'],'utf8'));
    const manifestBytes=readFileSync(new URL('../functions/runtime-release/server-manifest.json',import.meta.url));
    const sourceSha=process.env.GITHUB_SHA;
    // Fail before any effect unless the installed source and policy match exactly.
    verifyInstalledWriterObservation({bootstrap,sourceSha,manifestBytes});
    const cookie=sessionFromCookieJar(readFileSync(values['--cookie-jar'],'utf8'));
    const access=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    const getDocument=async path=>{
      const response=await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`,
        {headers:{Authorization:`Bearer ${access}`},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(response.status===404)return null;if(!response.ok)fail('WRITER_SMOKE_READBACK_UNAVAILABLE');return response.json();
    };
    const leasePath=writerLeasePath('wmgj'),before=await getDocument(leasePath);
    const shell=await fetch(origin+'/portal',{headers:{Cookie:cookie},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!shell.ok)fail('WRITER_SMOKE_SHELL_UNAVAILABLE');
    const html=await shell.text(),match=/const csrf=(\{[^\r\n]*?\});const capabilities=/.exec(html);
    const csrf=match?JSON.parse(match[1]).refresh:null;
    if(typeof csrf!=='string'||csrf.length>300)fail('WRITER_SMOKE_CSRF_UNAVAILABLE');
    let httpStatus=null;
    try {
      const response=await fetch(origin+'/api/refresh',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',
        Origin:origin,'Sec-Fetch-Site':'same-origin','X-Aurora-CSRF':csrf},body:'{}',redirect:'error',signal:AbortSignal.timeout(45000)});
      httpStatus=response.status;await response.body?.cancel();
    } catch {/* Unknown outcome: read back; never retry with another identity. */}
    const after=await getDocument(leasePath),projection=await getDocument('organizations/wmgj/dashboardSnapshots/current');
    const result=verifyInstalledWriterObservation({bootstrap,sourceSha,manifestBytes,before,after,projection,httpStatus});
    writeFileSync(values['--output'],JSON.stringify(result,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(result));
  } catch(error) {console.error(JSON.stringify({status:'PENDING_EFFECT_PROOF',code:/^WRITER_[A-Z_]+$/.test(error?.message)?error.message:'WRITER_SMOKE_FAILED'}));process.exitCode=97;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) void main();
