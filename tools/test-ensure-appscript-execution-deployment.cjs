'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'ensure-appscript-execution-deployment.sh'),'utf8').replace(/\r\n/g,'\n');

test('canonical Apps Script publisher pins an explicit immutable version before redeploy',()=>{
  assert.match(script,/clasp version "\$description"/);
  assert.match(script,/clasp versions --json/);
  assert.match(script,/clasp redeploy "\$deployment_id" --versionNumber "\$version_number" --description "\$description" --json/);
  assert.match(script,/clasp deploy --versionNumber "\$version_number" --description "\$description" --json/);
  assert.match(script,/\.versionNumber\|tonumber\) == \$expected/);
  assert.doesNotMatch(script,/clasp redeploy "\$deployment_id" --description/);
});
