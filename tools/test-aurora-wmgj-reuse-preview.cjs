'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {createHash} = require('node:crypto');
const {sanitizePreview,readPreview,run,failureEvidence,command,main,previewAuthorizationDeadline} = require('./aurora-wmgj-reuse-preview.cjs');
function sample() {
  return {ok:true,code:'AURORA_CONNECTOR_REUSE_CONFIG_ONLY_VERIFIED',state:'PENDING_TRIGGER_REVIEW',
    scope:'WMGJ_EXISTING_SOURCE_CONFIG_ONLY',sourceIdentified:true,sourceCount:1,metadataAccessVerified:true,
    existingHmacReused:true,configurationSha256:'a'.repeat(64),triggerCount:1,handlerHashes:['b'.repeat(64)],
    triggerReviewRequired:true,configurationWriteEligible:false,configurationChanged:false,configurationUncertain:false,
    rollbackVerified:false,configOnly:true,sourceActive:false,triggersChanged:false,contentRead:false,
    providerConsentVerified:false,firstIngestionVerified:false,operationalReady:false,installationComplete:false,complete:false};
}
test('preview preserves pending trigger metadata and never certifies provider access or installation',()=>{
  const value = sample(); assert.deepEqual(sanitizePreview({response:value}),value);
});
test('reject unknown fields and secret-bearing remote codes, errors, hash fields and handler names',()=>{
  const secret = 'synthetic-secret-not-for-output';
  for (const change of [{secret},{code:secret},{configurationSha256:secret},{handlerHashes:[secret]},
    {sourceCount:2},{triggerCount:2},{configurationChanged:true},{operationalReady:true},{complete:true}]) {
    assert.throws(()=>sanitizePreview({response:{...sample(),...change}}),/^Error: CONNECTOR_REUSE_PREVIEW_REJECTED$/);
  }
  assert.throws(()=>sanitizePreview({response:sample(),error:{message:secret}}),/PREVIEW_REJECTED/);
});

test('descriptor reader bounds bytes, rejects hardlinks, and closes after invalid JSON or a concurrent write',()=>{
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'aurora-preview-reader-test-'));
  const file = path.join(root,'preview.json'), alias = path.join(root,'alias.json');
  const originalRead = fs.readSync, originalClose = fs.closeSync;
  let closed = 0;
  try {
    fs.closeSync = fd => {closed++; return originalClose(fd);};
    fs.writeFileSync(file,JSON.stringify({response:sample()}));
    assert.deepEqual(readPreview(file),sample());
    assert.equal(closed,1);
    fs.linkSync(file,alias);
    assert.throws(()=>readPreview(file),/PREVIEW_REJECTED/);
    fs.unlinkSync(alias);
    fs.writeFileSync(file,' '.repeat(65537));
    assert.throws(()=>readPreview(file),/PREVIEW_REJECTED/);
    fs.writeFileSync(file,'{');
    assert.throws(()=>readPreview(file),SyntaxError);
    fs.writeFileSync(file,JSON.stringify({response:sample()}));
    let changed = false;
    fs.readSync = (...args) => {
      if (!changed) {changed=true; fs.appendFileSync(file,' '.repeat(70000));}
      return originalRead(...args);
    };
    assert.throws(()=>readPreview(file),/PREVIEW_REJECTED/);
    assert.equal(closed,5);
  } finally {
    fs.readSync=originalRead; fs.closeSync=originalClose;
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.match(path.basename(root),/^aurora-preview-reader-test-/);
    assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('Linux runner refuses a symbolic-link output before reading its target',
  {skip:typeof fs.constants.O_NOFOLLOW !== 'number'},()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-preview-nofollow-test-'));
  try {
    const target=path.join(root,'target.json'), link=path.join(root,'preview.json');
    fs.writeFileSync(target,JSON.stringify({response:sample()})); fs.symlinkSync(target,link);
    assert.throws(()=>readPreview(link),{code:'ELOOP'});
  } finally {
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.match(path.basename(root),/^aurora-preview-nofollow-test-/);
    assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
    fs.rmSync(root,{recursive:true,force:true});
  }
});
test('execute only PREVIEW in a source-verified version and re-read the same deployment afterwards',()=>{
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'aurora-reuse-preview-test-'));
  const env = {GITHUB_REF:process.env.GITHUB_REF,GITHUB_SHA:process.env.GITHUB_SHA};
  const sourceSha = 'c'.repeat(40); let executions=0,pulls=0,preview;
  try {
    process.env.GITHUB_REF='refs/heads/main'; process.env.GITHUB_SHA=sourceSha;
    fs.mkdirSync(path.join(root,'src')); fs.mkdirSync(path.join(root,'.github/workflows'),{recursive:true});
    fs.mkdirSync(path.join(root,'firebase-migration/policy'),{recursive:true});
    for (const name of ['00_CORE_WMGJ','37_AURORA_CONECTORES_PLUG_AND_PLAY']) fs.writeFileSync(path.join(root,'src',name+'.gs'),'// synthetic '+name+'\n');
    fs.writeFileSync(path.join(root,'appsscript.json'),'{}');
    fs.writeFileSync(path.join(root,'.github/workflows/deploy-appscript.yml'),'env:\n  APPS_SCRIPT_ID: existing-synthetic-script-00001\n');
    fs.writeFileSync(path.join(root,'firebase-migration/policy/hml-owner-release-approval-v1.json'),JSON.stringify({
      scope:{projectId:'wmgj-hml-jfn-20260927',environment:'firebase-homologation',branch:'main',validUntilUtc:'2026-10-16T03:00:00Z'},integrationAndHmlPublicationAuthorized:true}));
    const exec=(bin,args,cwd)=>{
      if (bin==='git') return args[0]==='rev-parse'?sourceSha:'';
      if (bin==='clasp' && args[0]==='deployments') return JSON.stringify([{description:'AURORA_EXECUTION_API_CANONICAL '+sourceSha,versionNumber:23,deploymentId:'synthetic-deployment-00001'}]);
      if (bin==='clasp' && args[0]==='pull') {
        pulls++;
        for (const name of ['00_CORE_WMGJ','37_AURORA_CONECTORES_PLUG_AND_PLAY']) fs.copyFileSync(path.join(root,'src',name+'.gs'),path.join(cwd,name+'.gs'));
        fs.writeFileSync(path.join(cwd,'appsscript.json'),'{}'); return '';
      }
      if (bin==='bash') {
        executions++; assert.equal(args[1],'auroraReaproveitarFonteWmgjConfigOnly');
        preview=JSON.parse(args[3])[0]; assert.equal(preview.mode,'PREVIEW'); assert.equal(preview.expectedConfigurationSha256,null);
        fs.writeFileSync(args[2],JSON.stringify({response:sample()})); return '';
      }
      throw new Error('UNREVIEWED_TEST_COMMAND');
    };
    const proof=run({repo:root,temporary:root,sourceSha,exec,now:()=>Date.parse('2026-10-15T04:00:00Z')});
    assert.equal(executions,1); assert.equal(pulls,2); assert.equal(proof.publishedVersionStable,true);
    assert.equal(proof.providerIngestionOrInstallationVerified,false); assert.equal(proof.complete,false);
    assert.equal(proof.runtimeFunctionHashesVerified,false);
    assert.equal(proof.existingHmacClaimScope,'PRESERVED_CONFIGURATION_FORMAT_ONLY');
    assert.equal(Object.keys(preview).length,8);
  } finally {
    for (const [key,value] of Object.entries(env)) value===undefined?delete process.env[key]:process.env[key]=value;
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.match(path.basename(root),/^aurora-reuse-preview-test-/);
    assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
    fs.rmSync(root,{recursive:true,force:true});
  }
});

// Every command is injected. These fixtures never invoke git, clasp or a shell.
function withDiagnosticFixture(operation) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-preview-diagnostic-test-'));
  const env={GITHUB_REF:process.env.GITHUB_REF,GITHUB_SHA:process.env.GITHUB_SHA};
  const sourceSha='c'.repeat(40), calls=[];
  const deployment={description:'AURORA_EXECUTION_API_CANONICAL '+sourceSha,versionNumber:23,
    deploymentId:'synthetic-deployment-00001'};
  try {
    process.env.GITHUB_REF='refs/heads/main'; process.env.GITHUB_SHA=sourceSha;
    fs.mkdirSync(path.join(root,'src'));
    fs.mkdirSync(path.join(root,'.github/workflows'),{recursive:true});
    fs.mkdirSync(path.join(root,'firebase-migration/policy'),{recursive:true});
    for(const name of ['00_CORE_WMGJ','37_AURORA_CONECTORES_PLUG_AND_PLAY'])
      fs.writeFileSync(path.join(root,'src',name+'.gs'),'// synthetic '+name+'\n');
    fs.writeFileSync(path.join(root,'appsscript.json'),'{}');
    fs.writeFileSync(path.join(root,'.github/workflows/deploy-appscript.yml'),
      'env:\n  APPS_SCRIPT_ID: existing-synthetic-script-00001\n');
    fs.writeFileSync(path.join(root,'firebase-migration/policy/hml-owner-release-approval-v1.json'),JSON.stringify({
      scope:{projectId:'wmgj-hml-jfn-20260927',environment:'firebase-homologation',branch:'main',
        validUntilUtc:'2026-10-16T03:00:00Z'},integrationAndHmlPublicationAuthorized:true}));
    const fallback=(bin,args,cwd)=>{
      if(bin==='git') return args[0]==='rev-parse'?sourceSha:'';
      if(bin==='clasp' && args[0]==='deployments') return JSON.stringify([deployment]);
      if(bin==='clasp' && args[0]==='pull') {
        for(const name of ['00_CORE_WMGJ','37_AURORA_CONECTORES_PLUG_AND_PLAY'])
          fs.copyFileSync(path.join(root,'src',name+'.gs'),path.join(cwd,name+'.gs'));
        fs.writeFileSync(path.join(cwd,'appsscript.json'),'{}'); return '';
      }
      if(bin==='bash') {
        assert.equal(args[1],'auroraReaproveitarFonteWmgjConfigOnly');
        assert.equal(JSON.parse(args[3])[0].mode,'PREVIEW');
        fs.writeFileSync(args[2],JSON.stringify({response:sample()})); return '';
      }
      throw new Error('UNREVIEWED_TEST_COMMAND');
    };
    const options=(override=fallback)=>({repo:root,temporary:root,sourceSha,
      now:()=>Date.parse('2026-10-15T04:00:00Z'),exec:(bin,args,cwd)=>{
        calls.push({bin,command:args[0],args:[...args]}); return override(bin,args,cwd);
      }});
    return operation({root,sourceSha,deployment,calls,fallback,options});
  } finally {
    for(const [key,value] of Object.entries(env)) value===undefined?delete process.env[key]:process.env[key]=value;
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.match(path.basename(root),/^aurora-preview-diagnostic-test-/);
    assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
    fs.rmSync(root,{recursive:true,force:true});
  }
}

function assertDeploymentObservations(evidence,count,versions) {
  const observations=evidence.deploymentObservations;
  assert.deepEqual(Object.keys(observations).sort(),['after','afterReads','maxAfterReads','retryDelayMs']);
  assert.equal(observations.maxAfterReads,5); assert.equal(observations.retryDelayMs,10000);
  assert.equal(observations.afterReads,count); assert.equal(observations.after.length,count);
  assert.ok(count>=1&&count<=5);
  for(const observation of observations.after) {
    assert.deepEqual(Object.keys(observation).sort(),['canonicalCount','deploymentIdValid',
      'deploymentIdentitySha256','descriptionSha256','expectedDescriptionCount','rowCount',
      'shape','versionNumber','versionNumberValid']);
    assert.ok(['ARRAY','NON_ARRAY'].includes(observation.shape));
    for(const key of ['canonicalCount','expectedDescriptionCount','rowCount'])
      assert.ok(observation[key]===null||(Number.isSafeInteger(observation[key])&&observation[key]>=0));
    for(const key of ['deploymentIdValid','versionNumberValid'])assert.equal(typeof observation[key],'boolean');
    assert.ok(observation.versionNumber===null||Number.isSafeInteger(observation.versionNumber)&&observation.versionNumber>=1);
    for(const key of ['deploymentIdentitySha256','descriptionSha256'])
      assert.ok(observation[key]===null||/^[a-f0-9]{64}$/.test(observation[key]));
  }
  if(versions)assert.deepEqual(observations.after.map(observation=>observation.versionNumber),versions);
}

function captureRejectedFixture(fixture,exec,{phase,reason,secret,...commandDetail},runtime={}) {
  const stdout=[],stderr=[]; let caught;
  const status=main({temporary:fixture.root,stdout:value=>stdout.push(value),stderr:value=>stderr.push(value),
    preview:()=>{try{return run({...fixture.options(exec),...runtime});}catch(error){caught=error;throw error;}}});
  assert.equal(status,1);
  assert.equal(caught.message,'CONNECTOR_REUSE_PREVIEW_REJECTED');
  assert.deepEqual(stdout,[]);
  assert.deepEqual(stderr,['CONNECTOR_REUSE_PREVIEW_REJECTED']);
  const file=path.join(fixture.root,'connector-reuse-preview.json');
  const artifact=fs.readFileSync(file,'utf8'), evidence=JSON.parse(artifact);
  const {deploymentObservations,...legacyEvidence}=evidence;
  const afterReads=fixture.calls.filter(call=>call.command==='deployments').length-1;
  if(afterReads>0)assertDeploymentObservations(evidence,afterReads);
  else assert.equal(deploymentObservations,undefined);
  assert.deepEqual(legacyEvidence,{
    schemaVersion:'aurora.wmgj.existing-source-preview-failure.v1',status:'REJECTED',
    code:'CONNECTOR_REUSE_PREVIEW_REJECTED',phase,reason,exitCode:null,spawnFailure:null,signal:null,
    complete:false,providerIngestionOrInstallationVerified:false,...commandDetail});
  // Windows does not expose POSIX permission bits; keep this check mandatory on Linux CI.
  if(process.platform!=='win32') assert.equal(fs.statSync(file).mode & 0o777,0o600);
  const visible=artifact+JSON.stringify(stdout)+JSON.stringify(stderr)+caught.message;
  assert.equal(visible.includes(secret),false);
  assert.equal(visible.includes(fixture.root),false);
  return evidence;
}

test('Git dirty gates retain rejection and report only a fixed reason, never private paths',()=>{
  const secret='synthetic-secret-git-private-path';
  for(const [commandName,reason] of [['diff','TRACKED_DIRTY'],['status','SCOPED_UNTRACKED_OR_DIRTY']]) {
    withDiagnosticFixture(fixture=>{
      captureRejectedFixture(fixture,(bin,args,cwd)=>bin==='git' && args[0]===commandName
        ? ' M src/'+secret+'.gs\n' : fixture.fallback(bin,args,cwd),
      {phase:'PREFLIGHT_GIT',reason,secret});
      assert.equal(fixture.calls.some(call=>call.bin!=='git'),false);
    });
  }
});

test('predeployment command, JSON and selection failures have bounded diagnostics without remote output',t=>{
  const secret='synthetic-secret-deployment-output';
  t.mock.method(cp,'spawnSync',(_bin,_args,options)=>{
    assert.equal(options.env.DEBUG,''); assert.equal(options.env.NODE_DEBUG,'');
    return {status:7,stdout:secret,stderr:secret,signal:secret,error:{code:secret,message:secret}};
  });
  for(const [kind,reason,details] of [
    ['command','COMMAND_FAILED',{exitCode:7,spawnFailure:'OTHER',signal:'OTHER'}],
    ['json','JSON_INVALID',{}],
    ['selection','DEPLOYMENT_SELECTION_INVALID',{deploymentSelection:{shape:'ARRAY',rowCount:2,
      canonicalCount:2,expectedDescriptionCount:2,versionNumberValid:false,deploymentIdValid:false,
      versionNumber:null,deploymentIdentitySha256:null,descriptionSha256:null}}]
  ]) {
    withDiagnosticFixture(fixture=>{
      captureRejectedFixture(fixture,(bin,args,cwd)=>{
        if(bin!=='clasp' || args[0]!=='deployments') return fixture.fallback(bin,args,cwd);
        if(kind==='command') return command(bin,[...args,secret],path.join(cwd,secret));
        if(kind==='json') return '{'+secret;
        return JSON.stringify([fixture.deployment,{...fixture.deployment,deploymentId:secret}]);
      },{phase:'DEPLOYMENT_BEFORE',reason,secret,...details});
      assert.equal(fixture.calls.some(call=>call.command==='pull' || call.bin==='bash'),false);
    });
  }
});

test('initial stale canonical description converges before any source pull or preview',()=> {
  withDiagnosticFixture(fixture=>{
    const known=fixture.deployment;
    const stale={...known,versionNumber:known.versionNumber-1,
      description:'AURORA_EXECUTION_API_CANONICAL '+'d'.repeat(40)};
    let reads=0; const waits=[];
    const exec=(bin,args,cwd)=>{
      if(bin==='clasp'&&args[0]==='deployments'){
        reads++;
        return JSON.stringify([reads===1?stale:known]);
      }
      return fixture.fallback(bin,args,cwd);
    };
    const proof=run({...fixture.options(exec),wait:milliseconds=>{
      waits.push(milliseconds);
      assert.equal(reads,1);
      assert.equal(fixture.calls.filter(call=>call.command==='pull').length,0);
      assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,0);
    }});
    assert.equal(reads,3);
    assert.equal(waits.length,1);
    assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1);
    assert.deepEqual(fixture.calls.filter(call=>call.command==='pull').map(call=>call.args[2]),['23','23']);
    assert.equal(proof.published.versionNumber,23);
  });
});

test('post-preview selection failures identify bounded predicates and retain rejection without exporting deployment metadata',()=>{
  const secret='synthetic-private-deployment-metadata';
  const hash=value=>createHash('sha256').update(value).digest('hex');
  for(const kind of ['missing','duplicate','stale-description','invalid-version','invalid-id','non-array']) {
    withDiagnosticFixture(fixture=>{
      const known=fixture.deployment;
      const staleDescription='AURORA_EXECUTION_API_CANONICAL '+secret;
      const rows=kind==='missing'?[]:kind==='duplicate'?[known,known]
        :kind==='stale-description'?[{...known,description:staleDescription}]
        :kind==='invalid-version'?[{...known,versionNumber:secret}]
        :kind==='invalid-id'?[{...known,deploymentId:'private:'+secret}]
        :{private:secret};
      const single=['stale-description','invalid-version','invalid-id'].includes(kind);
      const versionValid=single&&kind!=='invalid-version';
      const idValid=single&&kind!=='invalid-id';
      let reads=0;
      const evidence=captureRejectedFixture(fixture,(bin,args,cwd)=>{
        if(bin==='clasp'&&args[0]==='deployments'&&++reads===2)return JSON.stringify(rows);
        return fixture.fallback(bin,args,cwd);
      },{phase:'DEPLOYMENT_AFTER',reason:'DEPLOYMENT_SELECTION_INVALID',secret,
        deploymentSelection:{shape:kind==='non-array'?'NON_ARRAY':'ARRAY',
          rowCount:kind==='non-array'?null:kind==='missing'?0:kind==='duplicate'?2:1,
          canonicalCount:kind==='non-array'?null:kind==='missing'?0:kind==='duplicate'?2:1,
          expectedDescriptionCount:kind==='non-array'?null:kind==='duplicate'?2:
            kind==='invalid-version'||kind==='invalid-id'?1:0,
          versionNumberValid:versionValid,deploymentIdValid:idValid,
          versionNumber:versionValid?known.versionNumber:null,
          deploymentIdentitySha256:idValid?hash(known.deploymentId):null,
          descriptionSha256:single?hash(kind==='stale-description'?staleDescription:known.description):null}});
      assert.equal(reads,2);
      assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1);
      assert.equal(fixture.calls.filter(call=>call.command==='pull').length,1);
      assert.equal(JSON.stringify(evidence).includes(known.deploymentId),false);
      assert.equal(JSON.stringify(evidence).includes(known.description),false);
    });
  }
});

for(const descriptionKind of ['previous-sha','same-sha']) {
  test('an older '+descriptionKind+' observation converges to the exact initial deployment without another preview or older source pull',()=>{
    withDiagnosticFixture(fixture=>{
      const known=fixture.deployment;
      const older={...known,versionNumber:known.versionNumber-1,
        description:'AURORA_EXECUTION_API_CANONICAL '+(descriptionKind==='same-sha'?fixture.sourceSha:'d'.repeat(40))};
      let reads=0; const waits=[];
      const exec=(bin,args,cwd)=>{
        if(bin==='clasp'&&args[0]==='deployments') {
          reads++;
          return JSON.stringify([reads===2?older:known]);
        }
        return fixture.fallback(bin,args,cwd);
      };
      const proof=run({...fixture.options(exec),wait:milliseconds=>{
        waits.push(milliseconds);
        assert.equal(reads,2);
        assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1);
        assert.deepEqual(fixture.calls.filter(call=>call.command==='pull').map(call=>call.args[2]),['23']);
      }});
      assert.equal(reads,3); assert.equal(waits.length,1);
      assert.ok(Number.isSafeInteger(waits[0])&&waits[0]>0&&waits[0]<=10000);
      assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1);
      assert.deepEqual(fixture.calls.filter(call=>call.command==='pull').map(call=>call.args[2]),['23','23']);
      assert.equal(proof.published.versionNumber,23);
      assert.equal(proof.published.deploymentIdentitySha256,
        createHash('sha256').update(known.deploymentId).digest('hex'));
      assert.deepEqual(Object.keys(proof.published.hashes).sort(),['00_CORE_WMGJ','37_AURORA_CONECTORES_PLUG_AND_PLAY']);
      assert.equal(proof.publishedVersionStable,true);
      assertDeploymentObservations(proof,2,[22,23]);
      assert.equal(proof.complete,false); assert.equal(proof.providerIngestionOrInstallationVerified,false);
    });
  });

  test('five older '+descriptionKind+' observations exhaust the limit and remain rejected without pulling an old version',()=>{
    withDiagnosticFixture(fixture=>{
      const known=fixture.deployment;
      const older={...known,versionNumber:22,
        description:'AURORA_EXECUTION_API_CANONICAL '+(descriptionKind==='same-sha'?fixture.sourceSha:'d'.repeat(40))};
      let reads=0; const waits=[];
      captureRejectedFixture(fixture,(bin,args,cwd)=>{
        if(bin==='clasp'&&args[0]==='deployments')return JSON.stringify([++reads===1?known:older]);
        return fixture.fallback(bin,args,cwd);
      },{phase:'DEPLOYMENT_AFTER',reason:'DEPLOYMENT_SELECTION_INVALID',secret:known.deploymentId,
        deploymentSelection:{shape:'ARRAY',rowCount:1,canonicalCount:1,
          expectedDescriptionCount:descriptionKind==='same-sha'?1:0,
          versionNumberValid:true,deploymentIdValid:true,versionNumber:22,
          deploymentIdentitySha256:createHash('sha256').update(known.deploymentId).digest('hex'),
          descriptionSha256:createHash('sha256').update(older.description).digest('hex')}},
      {wait:milliseconds=>waits.push(milliseconds)});
      assert.equal(reads,6); assert.equal(waits.length,4);
      assert.ok(waits.every(milliseconds=>Number.isSafeInteger(milliseconds)&&milliseconds>0&&milliseconds<=10000));
      assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1);
      assert.deepEqual(fixture.calls.filter(call=>call.command==='pull').map(call=>call.args[2]),['23']);
    });
  });
}

test('post-preview changed identity, newer version, ambiguity or same-version wrong description cannot trigger a wait or source pull',()=>{
  for(const kind of ['newer-version','newer-previous-sha','different-id','older-different-id',
    'older-different-id-same-sha','ambiguous-older','same-version-wrong-sha','older-malformed-description']) {
    withDiagnosticFixture(fixture=>{
      const known=fixture.deployment;
      const previous='AURORA_EXECUTION_API_CANONICAL '+'d'.repeat(40);
      const older={...known,versionNumber:22,description:previous};
      const rows=kind==='newer-version'?[{...known,versionNumber:24}]
        :kind==='newer-previous-sha'?[{...older,versionNumber:24}]
        :kind==='different-id'?[{...known,deploymentId:'synthetic-different-deployment-00002'}]
        :kind==='older-different-id'?[{...older,deploymentId:'synthetic-different-deployment-00002'}]
        :kind==='older-different-id-same-sha'?[{...known,versionNumber:22,deploymentId:'synthetic-different-deployment-00002'}]
        :kind==='ambiguous-older'?[older,older]
        :kind==='same-version-wrong-sha'?[{...known,description:previous}]
        :[{...older,description:'AURORA_EXECUTION_API_CANONICAL malformed'}];
      let reads=0,waits=0,caught;
      assert.throws(()=>run({...fixture.options((bin,args,cwd)=>{
        if(bin==='clasp'&&args[0]==='deployments')return JSON.stringify(++reads===1?[known]:rows);
        return fixture.fallback(bin,args,cwd);
      }),wait:()=>waits++}),error=>{
        caught=error; return error.message==='CONNECTOR_REUSE_PREVIEW_REJECTED';
      },kind);
      assert.equal(reads,2,kind); assert.equal(waits,0,kind);
      assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1,kind);
      assert.deepEqual(fixture.calls.filter(call=>call.command==='pull').map(call=>call.args[2]),['23'],kind);
      assert.equal(failureEvidence(caught).phase,'DEPLOYMENT_AFTER',kind);
      assertDeploymentObservations(failureEvidence(caught),1);
    });
  }
});

test('a persistently stale canonical observation before preview exhausts bounded convergence without reading stale source',()=>{
  withDiagnosticFixture(fixture=>{
    let reads=0,waits=0,caught;
    assert.throws(()=>run({...fixture.options((bin,args,cwd)=>{
      if(bin==='clasp'&&args[0]==='deployments') {
        reads++;
        return JSON.stringify([{...fixture.deployment,versionNumber:22,
          description:'AURORA_EXECUTION_API_CANONICAL '+'d'.repeat(40)}]);
      }
      return fixture.fallback(bin,args,cwd);
    }),wait:()=>waits++}),error=>{
      caught=error; return error.message==='CONNECTOR_REUSE_PREVIEW_REJECTED';
    });
    assert.equal(reads,5); assert.equal(waits,4);
    assert.equal(failureEvidence(caught).phase,'DEPLOYMENT_BEFORE');
    assert.equal(fixture.calls.some(call=>call.bin==='bash'||call.command==='pull'),false);
  });
});

test('policy expiry during any permitted wait blocks the next deployment read and all further source pulls',()=>{
  for(const expiresDuringWait of [1,2,3,4]) {
    withDiagnosticFixture(fixture=>{
      const deadline=Date.parse('2026-10-16T03:00:00Z');
      let clock=deadline-1000,reads=0,waits=0;
      captureRejectedFixture(fixture,(bin,args,cwd)=>{
        if(bin==='clasp'&&args[0]==='deployments')return JSON.stringify([++reads===1?fixture.deployment:
          {...fixture.deployment,versionNumber:22,description:'AURORA_EXECUTION_API_CANONICAL '+'d'.repeat(40)}]);
        return fixture.fallback(bin,args,cwd);
      },{phase:'PREFLIGHT_POLICY',reason:'POLICY_WINDOW_INVALID',secret:fixture.deployment.deploymentId},
      {now:()=>clock,wait:()=>{if(++waits===expiresDuringWait)clock=deadline;}});
      assert.equal(waits,expiresDuringWait);
      assert.equal(reads,expiresDuringWait+1);
      assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1);
      assert.deepEqual(fixture.calls.filter(call=>call.command==='pull').map(call=>call.args[2]),['23']);
    });
  }
});

test('deployment convergence still requires exact sources and manifest after the preview',()=>{
  for(const mismatch of ['source','manifest']) {
    withDiagnosticFixture(fixture=>{
      let reads=0,pulls=0,waits=0,caught;
      assert.throws(()=>run({...fixture.options((bin,args,cwd)=>{
        if(bin==='clasp'&&args[0]==='deployments')return JSON.stringify([++reads===2?
          {...fixture.deployment,versionNumber:22,description:'AURORA_EXECUTION_API_CANONICAL '+'d'.repeat(40)}:fixture.deployment]);
        const result=fixture.fallback(bin,args,cwd);
        if(bin==='clasp'&&args[0]==='pull'&&++pulls===2) {
          if(mismatch==='source')fs.appendFileSync(path.join(cwd,'00_CORE_WMGJ.gs'),'// incompatible published source\n');
          else fs.writeFileSync(path.join(cwd,'appsscript.json'),'{"timeZone":"Etc/UTC"}');
        }
        return result;
      }),wait:()=>waits++}),error=>{
        caught=error; return error.message==='CONNECTOR_REUSE_PREVIEW_REJECTED';
      });
      assert.equal(reads,3); assert.equal(waits,1); assert.equal(pulls,2);
      assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1);
      assert.deepEqual(fixture.calls.filter(call=>call.command==='pull').map(call=>call.args[2]),['23','23']);
      assert.equal(failureEvidence(caught).phase,'SOURCE_AFTER');
      assert.equal(failureEvidence(caught).reason,mismatch==='source'?'SOURCE_HASH_MISMATCH':'MANIFEST_INVALID_OR_MISMATCH');
      assertDeploymentObservations(failureEvidence(caught),2,[22,23]);
    });
  }
});

test('preview DTO, envelope and value failures retain all gates and never serialize rejected content',()=>{
  const secret='synthetic-secret-preview-payload';
  for(const [envelope,reason] of [
    [{response:{...sample(),privateToken:secret}},'DTO_SCHEMA_INVALID'],
    [{response:sample(),error:{message:secret}},'ENVELOPE_INVALID'],
    [{response:{...sample(),code:secret}},'DTO_VALUES_INVALID'],
    [{response:{...sample(),contentRead:true}},'DTO_VALUES_INVALID']
  ]) {
    withDiagnosticFixture(fixture=>{
      captureRejectedFixture(fixture,(bin,args,cwd)=>{
        if(bin!=='bash') return fixture.fallback(bin,args,cwd);
        fs.writeFileSync(args[2],JSON.stringify(envelope)); return '';
      },{phase:'PREVIEW_READ',reason,secret});
      assert.equal(fixture.calls.filter(call=>call.command==='deployments').length,1);
      assert.equal(fixture.calls.filter(call=>call.command==='pull').length,1);
      assert.equal(fixture.calls.filter(call=>call.bin==='bash').length,1);
    });
  }
});

test('a valid expired config-only preview remains accepted without certifying activation',()=>{
  withDiagnosticFixture(fixture=>{
    const value={...sample(),ok:false,code:'AURORA_CONNECTOR_REUSE_EXPIRED',state:'PENDING_CONFIGURATION',
      sourceIdentified:false,sourceCount:0,metadataAccessVerified:false,existingHmacReused:false,
      configurationSha256:null,triggerCount:null,handlerHashes:[],triggerReviewRequired:false};
    const stdout=[],stderr=[];
    const status=main({temporary:fixture.root,stdout:v=>stdout.push(v),stderr:v=>stderr.push(v),preview:()=>
      run(fixture.options((bin,args,cwd)=>{
        if(bin!=='bash') return fixture.fallback(bin,args,cwd);
        fs.writeFileSync(args[2],JSON.stringify({response:value})); return '';
      }))});
    assert.equal(status,0); assert.deepEqual(stderr,[]); assert.equal(stdout.length,1);
    const evidence=JSON.parse(fs.readFileSync(path.join(fixture.root,'connector-reuse-preview.json'),'utf8'));
    assert.equal(evidence.schemaVersion,'aurora.wmgj.existing-source-preview-evidence.v1');
    assert.deepEqual(evidence.summary,value);
    assert.equal(evidence.complete,false); assert.equal(evidence.providerIngestionOrInstallationVerified,false);
    assert.equal(fixture.calls.filter(call=>call.command==='deployments').length,2);
    assert.equal(fixture.calls.filter(call=>call.command==='pull').length,2);
  });
});

test('untrusted error metadata and messages cannot forge a phase or escape the failure artifact',()=>{
  withDiagnosticFixture(fixture=>{
    const secret='synthetic-secret-error-message';
    const error=Object.assign(new Error(secret),{
      phase:'DEPLOYMENT_BEFORE',reason:'COMMAND_FAILED',exitCode:2,spawnFailure:secret,signal:secret,
      deploymentSelection:{private:secret}});
    const stdout=[],stderr=[];
    assert.equal(main({temporary:fixture.root,preview:()=>{throw error;},
      stdout:v=>stdout.push(v),stderr:v=>stderr.push(v)}),1);
    const evidence=failureEvidence(error);
    assert.equal(evidence.phase,'UNKNOWN'); assert.equal(evidence.reason,'UNEXPECTED');
    assert.equal(evidence.exitCode,null); assert.equal(evidence.spawnFailure,null); assert.equal(evidence.signal,null);
    assert.equal(Object.hasOwn(evidence,'deploymentSelection'),false);
    const artifact=fs.readFileSync(path.join(fixture.root,'connector-reuse-preview.json'),'utf8');
    assert.deepEqual(JSON.parse(artifact),evidence); assert.equal(artifact.includes(secret),false);
    assert.deepEqual(stdout,[]); assert.deepEqual(stderr,['CONNECTOR_REUSE_PREVIEW_REJECTED']);
  });
});


test('scoped continuous Drive authorization permits metadata preview after global HML expiry without renewing global scope',()=>{
  const policy={scope:{validUntilUtc:'2026-10-26T03:00:00.000Z',
    continuousDriveScopeSha256:'d'.repeat(64),continuousDriveDecisionId:'AURORA-HML-CONTINUOUS-DRIVE-20261026'},
    reaffirmations:[{decisionId:'AURORA-HML-CONTINUOUS-DRIVE-20261026',exactPrivateScopeSha256:'d'.repeat(64),
      validUntilUtc:'2026-10-27T04:30:00.000Z',continuousDriveTriggerAuthorized:true,processExistingAuthorized:true,
      queueMetadataRemediationAuthorized:true,realSourceActivationAuthorized:true,sourceMutationAuthorized:false,
      newSourceEnrollmentAuthorized:false,productionAuthorized:false,clinicalSensitiveAuthorized:false}]};
  const now=Date.parse('2026-10-26T05:00:00.000Z');
  assert.equal(previewAuthorizationDeadline(policy,now),Date.parse('2026-10-27T04:30:00.000Z'));
  assert.equal(policy.scope.validUntilUtc,'2026-10-26T03:00:00.000Z');
  policy.reaffirmations[0].sourceMutationAuthorized=true;
  assert.throws(()=>previewAuthorizationDeadline(policy,now),/CONNECTOR_REUSE_PREVIEW_REJECTED/);
  policy.reaffirmations[0].sourceMutationAuthorized=false;
  policy.scope.continuousDriveScopeSha256='e'.repeat(64);
  assert.throws(()=>previewAuthorizationDeadline(policy,now),/CONNECTOR_REUSE_PREVIEW_REJECTED/);
});
