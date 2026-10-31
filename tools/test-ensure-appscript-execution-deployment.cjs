'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const script=fs.readFileSync(path.join(__dirname,'ensure-appscript-execution-deployment.sh'),'utf8').replace(/\r\n/g,'\n');

test('canonical Apps Script publisher pins an explicit immutable version before redeploy',()=>{
  assert.match(script,/clasp version "\$description"/);
  assert.match(script,/clasp versions --json/);
  assert.match(script,/clasp redeploy "\$deployment_id" --versionNumber "\$version_number" --description "\$description" --json/);
  assert.match(script,/clasp deploy --versionNumber "\$version_number" --description "\$description" --json/);
  assert.match(script,/\.versionNumber\|tonumber\) == \$expected/);
  assert.doesNotMatch(script,/clasp redeploy "\$deployment_id" --description/);
});

test('recovery refuses changed or missing canonical identity before creating a version',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-deployment-test-'));
  try {
    const clasp=path.join(root,'clasp');
    fs.writeFileSync(clasp,'#!/usr/bin/env bash\nif [ "$1" = deployments ]; then printf "%s" "$FIXTURE_DEPLOYMENTS"; else echo MUTATION >> "$FIXTURE_MARKER"; exit 90; fi\n',{mode:0o700});
    for(const deployments of [[],[{deploymentId:'other',versionNumber:4,description:'AURORA_EXECUTION_API_CANONICAL '+ 'a'.repeat(40)}]]){
      const marker=path.join(root,'mutations');
      const result=spawnSync('bash',[path.join(__dirname,'ensure-appscript-execution-deployment.sh'),path.join(root,'output.json')],{
        encoding:'utf8',env:{...process.env,PATH:root+path.delimiter+process.env.PATH,
          CANONICAL_DEPLOYMENT_ID:'expected',FIXTURE_DEPLOYMENTS:JSON.stringify(deployments),FIXTURE_MARKER:marker}});
      assert.equal(result.status,74);assert.match(result.stderr,/CANONICAL_DEPLOYMENT_CHANGED/);
      assert.equal(fs.existsSync(marker),false);assert.equal(fs.existsSync(path.join(root,'output.json')),false);
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
