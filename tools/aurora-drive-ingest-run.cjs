'use strict';
// Invokes the existing Apps Script intake and verifies its canonical receipts.
// Private source identifiers and execution responses never enter public artifacts.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const PROJECT = 'wmgj-hml-jfn-20260927';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,256}$/.test(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stable = value => JSON.stringify(value,(_,item)=>item && !Array.isArray(item) && typeof item==='object' ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
function parseScope(raw, expectedHash) {
  if (typeof raw !== 'string' || raw.length > 131072 || !hex(expectedHash) || sha(raw) !== expectedHash) fail('DRIVE_PRIVATE_SCOPE_HASH_MISMATCH');
  const scope=JSON.parse(raw);
  if (scope.schemaVersion!=='aurora.authorized-drive-source-scope.v1' || scope.orgId!=='wmgj' || scope.projectId!==PROJECT
    || scope.authorization?.realDataAuthorized!==true || scope.authorization?.sourceMutationAllowed!==false
    || !Array.isArray(scope.sources) || scope.sources.length<1 || scope.sources.length>12
    || !Array.isArray(scope.fileIds) || scope.fileIds.length>200 || !scope.fileIds.every(id)
    || !Array.isArray(scope.excludedFolderIds) || scope.excludedFolderIds.length>100 || !scope.excludedFolderIds.every(id)) fail('DRIVE_PRIVATE_SCOPE_REJECTED');
  const sourceIds=new Set(),folders=new Set();
  for(const source of scope.sources) {
    if(!source||source.system!=='DRIVE'||source.active!==true||!id(source.folderId)
      || !/^[a-zA-Z0-9_-]{1,80}$/.test(source.sourceId||'') || !Number.isInteger(source.slaMinutes)
      || source.slaMinutes<5 || source.slaMinutes>43200 || sourceIds.has(source.sourceId)||folders.has(source.folderId)) fail('DRIVE_SOURCE_SCOPE_REJECTED');
    sourceIds.add(source.sourceId);folders.add(source.folderId);
  }
  if(scope.fileIds.length!==new Set(scope.fileIds).size || scope.excludedFolderIds.some(x=>folders.has(x))) fail('DRIVE_SCOPE_OVERLAP_REJECTED');
  return scope;
}
function makeRequest(scope, mode, scopeSha256, readbackOffset=0) {
  return {mode,orgId:scope.orgId,sources:scope.sources,fileIds:scope.fileIds,excludedFolderIds:scope.excludedFolderIds,maxScan:300,limit:20,expectedScopeSha256:scopeSha256||null,...(mode==='READBACK'?{readbackOffset}:{})};
}
function rejectRuntimeFailure(envelope) {
  const value=envelope?.response;
  if(value?.ok!==false || value.code==='AURORA_DRIVE_BATCH_PENDING')return;
  const allowed=['AURORA_CONNECTOR_REUSE_OWNER_REQUIRED','AURORA_DRIVE_REQUEST_REJECTED',
    'AURORA_DRIVE_SOURCE_SCOPE_REJECTED','AURORA_DRIVE_TENANT_MISMATCH','AURORA_DRIVE_DEPENDENCY_MISSING',
    'AURORA_DRIVE_CONFIGURATION_INVALID','AURORA_DRIVE_SCOPE_CHANGED','AURORA_DRIVE_SOURCE_UNAVAILABLE',
    'AURORA_DRIVE_RESULT_INVALID','AURORA_DRIVE_RECEIPT_COVERAGE_INVALID','AURORA_DRIVE_DEADLINE_EXCEEDED',
    'AURORA_DRIVE_CURSOR_CONFLICT','AURORA_DRIVE_CURSOR_LIMIT','AURORA_DRIVE_DEPTH_OR_CYCLE',
    'AURORA_DRIVE_INFLIGHT_RECONCILIATION_REQUIRED','AURORA_DRIVE_LIMIT_INVALID','AURORA_DRIVE_QUEUE_CONTRACT',
    'AURORA_DRIVE_QUEUE_SCOPE_INVALID','AURORA_DRIVE_QUEUE_TENANT_CONFLICT','AURORA_DRIVE_SCOPE_LIMIT',
    'AURORA_DRIVE_SCOPE_REQUIRED','AURORA_DRIVE_SOURCE_INVALID','AURORA_DRIVE_PROCESS_CURSOR_INVALID',
    'AURORA_DRIVE_READBACK_CURSOR_INVALID','AURORA_DRIVE_ENGINE_BUSY','AURORA_DRIVE_SERVICE_QUOTA',
    'AURORA_DRIVE_EXECUTION_UNCONFIRMED'];
  const error=new Error(allowed.includes(value.code)?value.code:'DRIVE_RUNTIME_REJECTED');
  if(['GUARD','SHARED_LOCK','EXECUTE','READBACK','RESULT'].includes(value.failureStage))error.failureStage=value.failureStage;
  throw error;
}
async function withSharedLockRetry(invoke,beforeRetry=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onBusy=()=>{}) {
  for(let attempt=0;attempt<5;attempt++) {
    const envelope=await invoke(attempt),value=envelope?.response;
    if(value?.ok!==false || value.code!=='AURORA_DRIVE_ENGINE_BUSY')return envelope;
    if(envelope?.error || value.failureStage!=='SHARED_LOCK' || !hex(value.scopeSha256)
      || value.triggersChanged!==false || value.globalSettingsChanged!==false || value.sourceMutation!==false
      || !Array.isArray(value.privateReadbackPlan) || value.privateReadbackPlan.length!==0
      || value.scan?.complete!==false || !['examined','queued','aliases'].every(key=>value.scan?.[key]===0)
      || !['attempted','accepted','duplicates','pending','failed','review','extractionErrors','aliases','replayVerified'].every(key=>value.processing?.[key]===0))fail('DRIVE_BUSY_RESPONSE_REJECTED');
    onBusy(attempt+1);
    if(attempt===4){rejectRuntimeFailure(envelope);}
    await wait(10000*(attempt+1));
    await beforeRetry();
  }
}
function sanitizeBatch(envelope) {
  rejectRuntimeFailure(envelope);
  const v=envelope?.response;
  if(envelope?.error || !v || typeof v!=='object' || typeof v.ok!=='boolean' || !hex(v.scopeSha256)
    || v.triggersChanged!==false || v.globalSettingsChanged!==false) fail('DRIVE_BATCH_RESPONSE_REJECTED');
  const out={ok:v.ok,code:/^[A-Z_0-9]{1,100}$/.test(v.code||'')?v.code:'DRIVE_BATCH_UNSPECIFIED',scopeSha256:v.scopeSha256,triggersChanged:false,globalSettingsChanged:false,scan:{},processing:{}};
  for(const [section,keys] of [['scan',['examined','queued','aliases']],['processing',['attempted','accepted','duplicates','pending','failed','review','extractionErrors','replayVerified']]]) {
    for(const key of keys){if(!Number.isSafeInteger(v[section]?.[key])||v[section][key]<0)fail('DRIVE_BATCH_COUNTER_REJECTED');out[section][key]=v[section][key];}
  }
  if(typeof v.scan?.complete!=='boolean')fail('DRIVE_SCAN_COMPLETENESS_REJECTED');out.scan.complete=v.scan.complete;
  return out;
}
function decode(v) {
  if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;
  if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;
  if('nullValue'in v)return null;if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
  if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);return null;
}
async function verifyReadback(plan,orgId,token,fetcher=fetch) {
  if(!Array.isArray(plan)||plan.length>40||orgId!=='wmgj'||!token)fail('DRIVE_READBACK_PLAN_REJECTED');
  let verified=0;const evidence=[];
  for(const row of plan){
    if(!row||!/^[a-f0-9]{48}$/.test(row.entityId||'')||!id(row.sourceId)||!hex(row.contentHash)
      ||!hex(row.contentSha256)||!hex(row.textSha256)||!hex(row.canonicalSnapshotHash)
      ||row.contentHash!==row.contentSha256||row.replayVerified!==true
      ||!Number.isSafeInteger(row.revision)||row.revision<1||!/^[A-Za-z0-9_-]{1,200}$/.test(row.versionId||'')
      ||!Number.isSafeInteger(row.sourceVersion)||row.sourceVersion<1)fail('DRIVE_READBACK_IDENTITY_REJECTED');
    const url=new URL('https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/organizations/'+orgId+'/sourceDocuments/'+row.entityId);
    for(const name of ['orgId','entityType','source','sourceVersion','revision','extractionComplete','nativeReady','canonicalSnapshotHash','extractionEvidence','workflowState','reviewState','sourceIndependent','externalFetchRequired'])url.searchParams.append('mask.fieldPaths',name);
    const response=await fetcher(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(25000)});
    if(!response.ok)fail('DRIVE_CANONICAL_READBACK_FAILED');const doc=await response.json();
    const data=Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,decode(v)]));
    if(data.orgId!==orgId||data.entityType!=='sourceDocument'||data.source?.sourceId!==row.sourceId
      ||data.source?.contentHash!==row.contentHash||data.sourceVersion!==row.sourceVersion
      ||data.revision!==row.revision||!['DRIVE','SHEETS'].includes(data.source?.system))fail('DRIVE_CANONICAL_IDENTITY_MISMATCH');
    const proof=data.extractionEvidence;
    if(data.extractionComplete!==true||data.nativeReady!==false||data.sourceIndependent!==false||data.externalFetchRequired!==true
      ||data.workflowState!=='PENDING_HUMAN_REVIEW'||data.reviewState!=='PENDING'||data.canonicalSnapshotHash!==row.canonicalSnapshotHash
      ||proof?.schemaVersion!==1||proof.contentSha256!==row.contentSha256||proof.textSha256!==row.textSha256
      ||proof.sourceVersion!==row.sourceVersion||proof.coverage!=='TEXT_EXTRACTED_REVIEW_PENDING'||proof.financialFactsApproved!==false
      ||!Number.isSafeInteger(proof.textLength)||proof.textLength<1)fail('DRIVE_EXTRACTION_READBACK_MISMATCH');
    const versionUrl=new URL('https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/organizations/'+orgId+'/entityVersions/'+row.versionId);
    for(const field of ['orgId','entityId','entityType','revision','sourceVersion','snapshot'])versionUrl.searchParams.append('mask.fieldPaths',field);
    const versionResponse=await fetcher(versionUrl,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(25000)});
    if(!versionResponse.ok)fail('DRIVE_IMMUTABLE_READBACK_FAILED');
    const rawVersion=await versionResponse.json();const version=Object.fromEntries(Object.entries(rawVersion.fields||{}).map(([k,v])=>[k,decode(v)]));
    if(version.orgId!==orgId||version.entityId!==row.entityId||version.entityType!=='sourceDocument'||version.revision!==row.revision
      ||version.sourceVersion!==row.sourceVersion||version.snapshot?.source?.contentHash!==row.contentHash
      ||version.snapshot?.canonicalSnapshotHash!==row.canonicalSnapshotHash||stable(version.snapshot?.extractionEvidence)!==stable(proof))fail('DRIVE_IMMUTABLE_READBACK_MISMATCH');
    verified++;evidence.push({entityIdSha256:sha(row.entityId),contentHash:row.contentHash,textSha256:row.textSha256,sourceVersion:data.sourceVersion,extractionComplete:true,nativeReady:false,revision:data.revision,replayVerified:true,immutableVersionVerified:true});
  }
  return {verified,evidence};
}
async function verifyCoverage(getPage,verifyPlan) {
  let offset=0,expectedTotals=null,pages=0,returned=0;
  const verified=new Map(),aliases=new Map(),sourceIds=new Set();
  for(;;){
    const value=await getPage(offset),c=value?.coverage;
    if(value?.ok!==true||value.code!=='AURORA_DRIVE_READBACK_PLAN'||!c
      ||!Array.isArray(value.privateReadbackPlan)||!Array.isArray(value.privateAliasRows)
      ||value.triggersChanged!==false||value.globalSettingsChanged!==false)fail('DRIVE_COVERAGE_PAGE_REJECTED');
    for(const key of ['offset','total','documents','aliases','pending','returned','pageDocuments','pageAliases','pagePending'])if(!Number.isSafeInteger(c[key])||c[key]<0)fail('DRIVE_COVERAGE_COUNTER_REJECTED');
    if(c.offset!==offset||c.documents+c.aliases+c.pending!==c.total||c.pageDocuments+c.pageAliases+c.pagePending!==c.returned
      ||c.returned>20||value.privateReadbackPlan.length!==c.pageDocuments+c.pageAliases||value.privateAliasRows.length!==c.pageAliases
      ||typeof c.complete!=='boolean'||c.complete!==(c.nextOffset===null)
      ||(!c.complete&&(!Number.isSafeInteger(c.nextOffset)||c.nextOffset!==offset+c.returned||c.returned===0)))fail('DRIVE_COVERAGE_PAGINATION_REJECTED');
    const totals={total:c.total,documents:c.documents,aliases:c.aliases,pending:c.pending};
    if(expectedTotals&&stable(expectedTotals)!==stable(totals))fail('DRIVE_COVERAGE_CHANGED');expectedTotals=totals;
    const pageReceipts=new Map();
    for(const row of value.privateReadbackPlan){
      const key=sha(stable(row));pageReceipts.set(row.entityId,row);
      if(!verified.has(row.entityId)){
        const checked=await verifyPlan([row]);if(checked.verified!==1)fail('DRIVE_COVERAGE_READBACK_FAILED');
        verified.set(row.entityId,{key,sourceId:row.sourceId});sourceIds.add(row.sourceId);
      }else if(verified.get(row.entityId).key!==key)fail('DRIVE_COVERAGE_RECEIPT_CHANGED');
    }
    for(const alias of value.privateAliasRows){
      const primary=pageReceipts.get(alias.entityId);
      if(!id(alias.fileId)||!id(alias.primaryFileId)||alias.fileId===alias.primaryFileId||!hex(alias.contentHash)
        ||!primary||primary.sourceId!==alias.primaryFileId||primary.contentHash!==alias.contentHash||aliases.has(alias.fileId))fail('DRIVE_ALIAS_PROOF_REJECTED');
      aliases.set(alias.fileId,alias.entityId);
    }
    pages++;returned+=c.returned;
    if(c.complete)break;
    if(pages>10000)fail('DRIVE_COVERAGE_PAGE_LIMIT');offset=c.nextOffset;
  }
  if(returned!==expectedTotals.total||verified.size!==expectedTotals.documents||aliases.size!==expectedTotals.aliases
    ||[...aliases.keys()].some(id=>sourceIds.has(id)))fail('DRIVE_COVERAGE_INCOMPLETE');
  return{...expectedTotals,pages,canonicalDocumentsVerified:verified.size,aliasReferencesVerified:aliases.size,allReceiptsVerified:true};
}
function command(exe,args,cwd){const r=cp.spawnSync(exe,args,{cwd,encoding:'utf8',windowsHide:true,timeout:420000,maxBuffer:16000000,env:{...process.env,DEBUG:'',NODE_DEBUG:''},stdio:['ignore','pipe','pipe']});if(r.error||r.status!==0)fail('DRIVE_COORDINATOR_COMMAND_FAILED');return r.stdout;}
async function verifyRecovery(repo,token) {
  const base='projects/'+PROJECT+'/databases/(default)';
  const get=async suffix=>{const r=await fetch('https://firestore.googleapis.com/v1/'+suffix,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(25000)});if(!r.ok)fail('DRIVE_RECOVERY_METADATA_UNAVAILABLE');return r.json();};
  const database=await get(base),schedules=await get(base+'/backupSchedules');
  let allBackups=[],pageToken='';
  do{const page=await get('projects/'+PROJECT+'/locations/southamerica-east1/backups'+(pageToken?'?pageToken='+encodeURIComponent(pageToken):''));allBackups.push(...page.backups||[]);pageToken=page.nextPageToken||'';}while(pageToken);
  const backup=allBackups.filter(x=>x.database===base&&x.state==='READY').sort((a,b)=>Date.parse(b.snapshotTime)-Date.parse(a.snapshotTime))[0];
  const age=backup?(Date.now()-Date.parse(backup.snapshotTime))/3600000:NaN;
  if(database.name!==base||database.locationId!=='southamerica-east1'||database.deleteProtectionState!=='DELETE_PROTECTION_ENABLED'
    ||database.pointInTimeRecoveryEnablement!=='POINT_IN_TIME_RECOVERY_ENABLED'||!(schedules.backupSchedules||[]).length||!(age>=0&&age<=24))fail('DRIVE_DEFAULT_RECOVERY_PREREQUISITES_FAILED');
  // This existing restore exercised the actual ingestion database. Later sample
  // ingestion failed in that run; only these completed recovery steps are reused.
  const runId='39259943399',restoredSourceSha='3ad8082c231f703f716df9aab3e4fb9dc6ec7f99';
  const api=suffix=>JSON.parse(command('gh',['api','repos/'+process.env.GITHUB_REPOSITORY+'/'+suffix],repo));
  const run=api('actions/runs/'+runId),jobs=api('actions/runs/'+runId+'/jobs');
  const content=api('contents/.github/workflows/aurora-rc11-recovery-real-ingest.yml?ref='+restoredSourceSha);
  const workflow=Buffer.from(content.content,'base64').toString('utf8');
  const job=jobs.jobs?.find(x=>x.steps?.some(s=>s.name==='Execute and prove real restore'));
  const required=['Verify recovery prerequisites','Execute and prove real restore','Cleanup temporary restore database'];
  if(run.head_sha!==restoredSourceSha||sha(workflow)!=='cbe741048a1082b7706d758701a47537153878a1906500db1536f212d4689f99'
    ||!required.every(name=>job?.steps.find(s=>s.name===name)?.conclusion==='success'))fail('DRIVE_DEFAULT_RESTORE_EVIDENCE_REJECTED');
  return {sourceDatabase:'(default)',backupSnapshotTime:backup.snapshotTime,backupAgeHours:age,deleteProtectionEnabled:true,pointInTimeRecoveryEnabled:true,restoreRunId:runId,restoreStepsVerified:true,runConclusion:run.conclusion};
}
async function run() {
  const repo=path.resolve(__dirname,'..'),sourceSha=process.env.EXPECTED_SOURCE_SHA;
  if(!/^[a-f0-9]{40}$/.test(sourceSha||'')||sourceSha!==process.env.GITHUB_SHA||process.env.GITHUB_REF!=='refs/heads/main'
    ||process.env.APPROVED_PROJECT!==PROJECT||command('git',['rev-parse','HEAD'],repo).trim()!==sourceSha)fail('DRIVE_EXACT_SOURCE_REQUIRED');
  const policy=JSON.parse(fs.readFileSync(path.join(repo,'firebase-migration/policy/hml-owner-release-approval-v1.json')));
  const deadline=Date.parse(policy.scope?.validUntilUtc);
  if(policy.scope?.projectId!==PROJECT||policy.scope?.environment!=='firebase-homologation'||policy.integrationAndHmlPublicationAuthorized!==true||!Number.isFinite(deadline)||Date.now()>=deadline)fail('DRIVE_HML_WINDOW_INVALID');
  const scope=parseScope(process.env.AURORA_DRIVE_SCOPE_JSON,process.env.EXPECTED_SCOPE_SHA256);
  const maxBatches=Number(process.env.AURORA_DRIVE_MAX_BATCHES||20);
  if(!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>300)fail('DRIVE_BATCH_LIMIT_INVALID');
  const temporary=process.env.RUNNER_TEMP;if(!temporary||!path.isAbsolute(temporary))fail('DRIVE_PRIVATE_DIRECTORY_REQUIRED');
  const workspace=path.join(temporary,'aurora-drive-private');fs.mkdirSync(workspace,{mode:0o700});
  const reportFile=path.join(temporary,'aurora-drive-intake-summary.json');
  const summary={schemaVersion:'aurora.real-drive-intake-evidence.v1',startedAtUtc:new Date().toISOString(),checkedSourceSha:sourceSha,sourceScopeSha256:process.env.EXPECTED_SCOPE_SHA256,projectId:PROJECT,status:'RUNNING',batches:[],canonicalReadbacksVerified:0,sourceMutation:false,newSchedulerCreated:false,complete:false};
  const save=()=>fs.writeFileSync(reportFile,JSON.stringify(summary,null,2)+'\n',{mode:0o600});save();
  const gate=()=>{if(Date.now()>=deadline)fail('DRIVE_HML_WINDOW_EXPIRED');};
  const workflow=fs.readFileSync(path.join(repo,'.github/workflows/deploy-appscript.yml'),'utf8');
  const scriptId=workflow.match(/^\s+APPS_SCRIPT_ID:\s*([A-Za-z0-9_-]+)\s*$/m)?.[1];if(!scriptId)fail('DRIVE_SCRIPT_BINDING_MISSING');
  const writeProject=directory=>fs.writeFileSync(path.join(directory,'.clasp.json'),JSON.stringify({scriptId,projectId:PROJECT,rootDir:'.'}),{mode:0o600,flag:'wx'});writeProject(workspace);
  const {selectDeployment}=require('./aurora-cloud-synthetic-probe.cjs');
  const deployment=()=>selectDeployment(JSON.parse(command('clasp',['deployments','--json'],workspace)),sourceSha);
  const before=deployment();
  const published=path.join(workspace,'published');fs.mkdirSync(published,{mode:0o700});writeProject(published);
  command('clasp',['pull','--versionNumber',String(before.versionNumber),'--json'],published);
  for(const module of ['00_CORE_WMGJ','01_PIPELINE_CONFIABILIDADE_WMGJ','04_EXTRACAO_DOCUMENTAL_WMGJ','09D_REPLAY_MENSAGEM_GMAIL_WMGJ','35_AURORA_FIRESTORE_BRIDGE_WMGJ','36_AURORA_FIRESTORE_MIGRATION_WMGJ','37_AURORA_CONECTORES_PLUG_AND_PLAY']){
    const candidates=['.gs','.js'].map(ext=>path.join(published,module+ext)).filter(fs.existsSync);
    if(candidates.length!==1||fs.readFileSync(candidates[0],'utf8').replace(/\r\n/g,'\n')!==fs.readFileSync(path.join(repo,'src',module+'.gs'),'utf8').replace(/\r\n/g,'\n'))fail('DRIVE_PUBLISHED_SOURCE_MISMATCH');
  }
  summary.publishedVersionNumber=before.versionNumber;save();
  const call=async(request,n)=>{
    const envelope=await withSharedLockRetry(attempt=>{
      gate();const output=path.join(workspace,'result-'+n+'-'+attempt+'.json');
      command('bash',[path.join(repo,'tools/run-clasp-checked.sh'),'auroraExecutarIngestaoDriveAutorizada',output,JSON.stringify([request])],workspace);
      return JSON.parse(fs.readFileSync(output,'utf8'));
    },()=>{gate();if(stable(deployment())!==stable(before))fail('DRIVE_PUBLISHED_SOURCE_CHANGED');},undefined,attempt=>{
      summary.sharedLockWaits=(summary.sharedLockWaits||0)+1;save();
      console.log(JSON.stringify({code:'AURORA_DRIVE_ENGINE_BUSY',retry:attempt,canonicalWritesAttempted:false}));
    });
    rejectRuntimeFailure(envelope);return envelope;
  };
  try{
    summary.recovery=await verifyRecovery(repo,command('gcloud',['auth','print-access-token'],repo).trim());save();
    let lastScopeSha256=null,stalledAttempts=0;
    for(let n=0;n<maxBatches;n++){
      gate();if(stable(deployment())!==stable(before))fail('DRIVE_PUBLISHED_SOURCE_CHANGED');
      const preview=await call(makeRequest(scope,'PREVIEW'),n+'-preview');
      const previewValue=preview?.response;if(preview?.error||previewValue?.ok!==true||!hex(previewValue.scopeSha256))fail('DRIVE_PREVIEW_REJECTED');
      if(lastScopeSha256&&lastScopeSha256!==previewValue.scopeSha256)fail('DRIVE_SCOPE_CHANGED_DURING_EXECUTION');lastScopeSha256=previewValue.scopeSha256;
      const envelope=await call(makeRequest(scope,'EXECUTE',previewValue.scopeSha256),n+'-execute');
      const batch=sanitizeBatch(envelope);if(batch.scopeSha256!==previewValue.scopeSha256)fail('DRIVE_SCOPE_CHANGED_DURING_EXECUTION');
      const token=command('gcloud',['auth','print-access-token'],repo).trim();
      const readback=await verifyReadback(envelope.response.privateReadbackPlan||[],scope.orgId,token);
      if(readback.verified!==batch.processing.accepted+batch.processing.duplicates||readback.verified!==batch.processing.replayVerified)fail('DRIVE_RECEIPT_COVERAGE_MISMATCH');
      batch.canonicalReadback=readback;summary.batches.push(batch);summary.canonicalReadbacksVerified+=readback.verified;save();
      console.log(JSON.stringify({batch:n+1,scan:batch.scan,processing:batch.processing,canonicalReadbacksVerified:readback.verified}));
      if(!batch.ok||batch.processing.failed>0)fail('DRIVE_BATCH_HAS_UNRESOLVED_FAILURE');
      const progress=batch.processing.accepted+batch.processing.duplicates+batch.scan.aliases;
      stalledAttempts=progress>0?0:stalledAttempts+batch.processing.attempted;
      if(batch.scan.complete&&batch.processing.pending===0)break;
      if(batch.scan.complete&&batch.processing.pending>0&&stalledAttempts>=batch.processing.pending){summary.pendingExtractionRequiresFollowup=true;break;}
    }
    let pageNumber=0;
    const token=command('gcloud',['auth','print-access-token'],repo).trim();
    summary.coverage=await verifyCoverage(async offset=>{
      const envelope=await call(makeRequest(scope,'READBACK',lastScopeSha256,offset),'coverage-'+(++pageNumber));
      if(envelope?.error||envelope?.response?.scopeSha256!==lastScopeSha256)fail('DRIVE_COVERAGE_SCOPE_MISMATCH');return envelope.response;
    },plan=>verifyReadback(plan,scope.orgId,token));
    summary.complete=summary.batches.at(-1)?.scan.complete===true&&summary.coverage.pending===0;
    summary.fullSynchronizationVerified=false;summary.documentReviewRequired=true;save();
    if(stable(deployment())!==stable(before))fail('DRIVE_PUBLISHED_SOURCE_CHANGED');
    summary.status=summary.complete?'VERIFIED':'RESUMABLE';
  }catch(error){summary.status='INCOMPLETE';summary.code=/^[A-Z_0-9]{1,100}$/.test(error.message)?error.message:'DRIVE_EXECUTION_UNCONFIRMED';if(error.failureStage)summary.failureStage=error.failureStage;throw error;}
  finally{summary.finishedAtUtc=new Date().toISOString();save();}
  return summary;
}
module.exports={parseScope,makeRequest,sanitizeBatch,verifyReadback,verifyCoverage,sha,rejectRuntimeFailure,withSharedLockRetry};
if(require.main===module)run().then(result=>console.log(JSON.stringify({status:result.status,complete:result.complete,batches:result.batches.length,canonicalReadbacksVerified:result.canonicalReadbacksVerified}))).catch(error=>{console.error(/^[A-Z_0-9]{1,100}$/.test(error.message)?error.message:'DRIVE_INTAKE_UNCONFIRMED');process.exitCode=1;});
