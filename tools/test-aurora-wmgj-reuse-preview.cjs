'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {sanitizePreview,readPreview,run} = require('./aurora-wmgj-reuse-preview.cjs');
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
