'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const script=path.join(__dirname,'windows_online_robot_orchestrator.js');
const win={skip:process.platform!=='win32'};
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-robot-contract-'));
  const receipts=path.join(dir,'receipts');
  fs.mkdirSync(path.join(dir,'scripts','aurora'),{recursive:true});
  fs.cpSync(path.join(root,'firebase-migration','policy'),path.join(dir,'firebase-migration','policy'),{recursive:true});
  fs.copyFileSync(script,path.join(dir,'scripts','aurora','windows_online_robot_orchestrator.js'));
  for(const name of ['platform_unification_robot','certification_security_gate','security_privacy_update_bot','generate_improvement_backlog','evaluate_candidate_change']){
    const body="require('node:fs').appendFileSync('calls.txt',"+JSON.stringify(name+'\n')+");console.log(JSON.stringify({passed:process.env.AURORA_TEST_FAIL!=="+JSON.stringify(name)+"}));";
    fs.writeFileSync(path.join(dir,'scripts','aurora',name+'.js'),body);
  }
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  function run(args=['--execute'],extra={}){
    const r=spawnSync(process.execPath,[path.join(dir,'scripts','aurora','windows_online_robot_orchestrator.js'),...args],{cwd:dir,env:{...process.env,AURORA_ROBOT_RECEIPT_DIR:receipts,...extra},encoding:'utf8',timeout:15000});
    assert.ifError(r.error);return {code:r.status,value:JSON.parse(r.stdout)};
  }
  const calls=()=>fs.existsSync(path.join(dir,'calls.txt'))?fs.readFileSync(path.join(dir,'calls.txt'),'utf8').trim().split('\n'):[];
  return {dir,receipts,run,calls};
}
test('plan mode starts no scripts and creates no receipt',t=>{
  const f=fixture(t),r=f.run([]);assert.equal(r.code,0);assert.equal(r.value.mode,'PLAN_ONLY');assert.equal(f.calls().length,0);assert.equal(fs.existsSync(f.receipts),false);
});
test('failed preflight starts no child process',t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.dir,'firebase-migration','policy','manifest.json'));
  const r=f.run();assert.equal(r.code,1);assert.equal(r.value.executionError,'PREFLIGHT_FAILED');assert.equal(f.calls().length,0);
});
test('invalid policy JSON is rejected before execution',win,t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.dir,'firebase-migration','policy','security-baseline-v1.json'),'{');
  const r=f.run();assert.equal(r.code,1);assert.equal(f.calls().length,0);
});
test('another executor lock is preserved and prevents duplicate execution',win,t=>{
  const f=fixture(t);fs.mkdirSync(f.receipts);const lock=path.join(f.receipts,'orchestrator.lock');fs.writeFileSync(lock,'other-executor');
  const r=f.run();assert.equal(r.value.executionError,'EXECUTOR_BUSY');assert.equal(f.calls().length,0);assert.equal(fs.readFileSync(lock,'utf8'),'other-executor');
});
test('successful execution writes evidence without runtime or certification claims',win,t=>{
  const f=fixture(t),r=f.run();assert.equal(r.code,0);assert.equal(f.calls().length,5);assert.equal(r.value.executionResults.filter(x=>x.kind==='policy').length,4);
  assert.equal(r.value.operationalLoopsStarted,0);assert.equal(r.value.cloudFailoverVerified,false);assert.equal(r.value.deploymentPerformed,false);assert.equal(r.value.formalCertificationObtained,false);
  assert.equal(fs.existsSync(r.value.receiptPath),true);assert.equal(fs.existsSync(path.join(f.receipts,'orchestrator.lock')),false);
});
test('a failed child gate prevents later checks',win,t=>{
  const f=fixture(t),r=f.run(['--execute'],{AURORA_TEST_FAIL:'certification_security_gate'});
  assert.equal(r.code,1);assert.deepEqual(f.calls(),['platform_unification_robot','certification_security_gate']);assert.equal(fs.existsSync(path.join(f.receipts,'orchestrator.lock')),false);
});
test('execution requires an explicit absolute receipt directory',win,t=>{
  const f=fixture(t),r=f.run(['--execute'],{AURORA_ROBOT_RECEIPT_DIR:''});assert.equal(r.code,1);assert.equal(r.value.executionError,'ABSOLUTE_RECEIPT_DIRECTORY_REQUIRED');assert.equal(f.calls().length,0);
});
