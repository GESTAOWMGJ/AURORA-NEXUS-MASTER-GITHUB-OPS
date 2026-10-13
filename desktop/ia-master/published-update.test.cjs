'use strict';
// Synthetic transaction fixtures execute the actual module with only its fixed
// bootstrap manifest fingerprint replaced. Production has no test trust bypass.
// All files are disposable public fixtures; HTTPS, loopback and native managers
// are intercepted. This is never proof of a live D installation or approval.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const real = require('./published-update.cjs');
const WINDOWS = ['client_agent.py','provider_connectors.py','client_secret_store.py','install_client_agent.py','aurora_cloud_sync.py','aurora_deployment.py','published_release.py'];
const OLD = '56a813aac38390d928122cb774a16b3503977d72', NEXT = 'a'.repeat(40);
const h = real.digest, encode = value => Buffer.from(JSON.stringify(value));
function keyPair() {
  const pair = crypto.generateKeyPairSync('ed25519');
  return { ...pair, trust: { publicKeySpkiPem: pair.publicKey.export({type:'spki',format:'pem'}).toString(),
    publicKeySha256:h(pair.publicKey.export({type:'spki',format:'der'})) } };
}
function envelope(pair, hashes = {}, schema = 2) {
  const components = Object.fromEntries(real.COMPONENTS.slice(0,schema===2?5:3).map(name=>[name,{version:name==='windowsIntegration'?'1.0.1':'1.1.0',sourceSha:NEXT,manifestSha256:hashes[name]||'c'.repeat(64)}]));
  const certificate={schemaVersion:schema,sourceSha:NEXT,productVersion:'1.1.0-beta.1',canonicalOrigin:real.ORIGIN,
    releaseRunId:'13',ciRunId:'12',publishedAtUtc:'2026-10-13T11:00:00.000Z',status:'ACTIVE',
    checks:{ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true},components};
  return {certificate,signature:crypto.sign(null,real.signingBytes(certificate),pair.privateKey).toString('base64url')};
}
function response(env, nonce, org='fixture-org') {
  const covered=real.COMPONENTS.filter(name=>env.certificate.components[name]),complete=env.certificate.schemaVersion===2;
  return {schemaVersion:'aurora.active-release-read.v1',source:real.SOURCE,canonicalOrigin:real.ORIGIN,orgId:org,requestNonce:nonce,
    observedAtUtc:new Date().toISOString(),certificateSha256:h(real.signingBytes(env.certificate)),envelope:env,
    runtime:{sourceSha:NEXT,serverManifestSha256:env.certificate.components.server.manifestSha256,webManifestSha256:env.certificate.components.web.manifestSha256},
    componentCoverage:{status:complete?'COMPLETE_SIGNED_COMPONENT_SET':'PARTIAL',complete,requiredComponents:real.COMPONENTS,coveredComponents:covered,missingComponents:real.COMPONENTS.filter(n=>!covered.includes(n))},
    nativeMacInstallation:'UNVERIFIED',deviceInstallationVerified:false};
}
function emitResponse(callback, body, status=200, headers={'content-type':'application/json','cache-control':'no-store'}) {
  const req = new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>req.emit('error',Error('private raw failure bearer must never escape'));
  req.end=()=>setImmediate(()=>{
    const res=new EventEmitter();res.statusCode=status;res.headers=headers;res.resume=()=>{};
    callback(res);
    res.emit('data',encode(body));res.emit('end');
  });
  return req;
}
function load(overrides = {}, bootstrapHash, bootstrapHelper, runtimeRoot, windowsRoot) {
  const module={exports:{}};
  let source=fs.readFileSync(path.join(__dirname,'published-update.cjs'),'utf8');
  if(bootstrapHash) source=source.replace("'d48d98e6ab94d5e08bcb82732eca6b78e84bd93fc2db9e6022b550ea1e9c63c8'","'"+bootstrapHash+"'");
  if(bootstrapHelper) source=source.replace("'5c9a54d9d2c5fb980f88f4d73998ead5ae7d06dc877a1446c4f35249cb9d3eed'","'"+bootstrapHelper+"'");
  if(runtimeRoot) source=source.replace("'D:\\\\AuroraNexus'",JSON.stringify(runtimeRoot));
  if(windowsRoot) source=source.replace("'C:\\\\Windows'",JSON.stringify(windowsRoot));
  const sandbox={module,exports:module.exports,Buffer,URL,structuredClone,console,setTimeout,clearTimeout,process:overrides.process||process,
    require:name=>overrides[name]||(name==='./safe-read.cjs'?require('./safe-read.cjs'):require(name))};
  vm.runInNewContext(source,sandbox,{filename:'published-update.cjs'});
  return module.exports;
}
function nativeReader(env, modify, capture) {
  return {request:(options,callback)=>{
    capture?.(options);
    const body=response(env,options.headers['X-Aurora-Release-Nonce']);
    modify?.(body);
    return emitResponse(callback,body);
  }};
}
function writeFiles(directory, files) {
  fs.mkdirSync(directory,{recursive:true});
  for(const [name,bytes]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(directory,name)),{recursive:true});fs.writeFileSync(path.join(directory,name),bytes);}
}
function packageFixture(directory, names, source=NEXT, component='iaMaster') {
  const files=Object.fromEntries(names.map(name=>[name,Buffer.from('synthetic public '+name)]));
  const manifest={component:component==='iaMaster'?'AURORA_IA_MASTER':'AURORA_WINDOWS_INTEGRATION',version:component==='iaMaster'?'1.1.0':'1.0.1',
    ...(component==='iaMaster'?{sourceRevision:source,dirty:false,nodeMinimumMajor:22,externalAiEnabled:false}:{sourceSha:source}),
    files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,h(bytes)]))};
  const bytes=encode(manifest);writeFiles(directory,{...files,'manifest.json':bytes});
  return {files,manifest,bytes};
}
function transactionFixture(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-published-synthetic-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const local=path.join(base,'C-user-local'),root=path.join(base,'D-runtime'),state=path.join(local,'AuroraNexus','integration','state','ia-master'),pkg=path.join(root,'components','ia-master','1.0.1');
  const names=['manage.cjs','knowledge-registry.cjs','server.cjs',...Array.from({length:23},(_,i)=>'public-'+i+'.txt')];
  const baseline=packageFixture(pkg,names,OLD);
  const candidateDir=path.join(base,'candidate'),candidate=packageFixture(candidateDir,[...names,...Array.from({length:8},(_,i)=>'new-'+i+'.txt')]);
  const identity={'control.key':Buffer.from('synthetic control identity'), 'organization.txt':Buffer.from('fixture-org')};
  writeFiles(state,identity);fs.writeFileSync(path.join(state,'git-task-marker.txt'),'synthetic Git backlink retained C');
  fs.writeFileSync(path.join(path.dirname(state),'integration-setup.json'),'synthetic HML sample checkpoint');
  const metadata=encode({version:'1.1.0',sourceRevision:OLD,organization:'fixture-org',binding:'127.0.0.1',externalAiEnabled:false,existingClientPreserved:true});
  fs.writeFileSync(path.join(state,'installation.json'),metadata);
  const helper=path.join(root,'server-location-manager.cjs');fs.writeFileSync(helper,'synthetic reviewed helper D state C');
  const windowsRoot=path.join(base,'protected-system-fixture'),systemDirectory=path.join(windowsRoot,'System32');
  const powershellHome=path.join(systemDirectory,'WindowsPowerShell','v1.0'),powershell=path.join(powershellHome,'powershell.exe');
  fs.mkdirSync(powershellHome,{recursive:true});
  const layout={runtimeRoot:root,stateDir:state,helperPath:helper,nodeExecutable:process.execPath,expectedHelperSha256:h(fs.readFileSync(helper)),
    expectedNodeSha256:h(fs.readFileSync(process.execPath)),expectedInstallationSha256:h(metadata),
    expectedCheckpointSha256:h(fs.readFileSync(path.join(path.dirname(state),'integration-setup.json')))};
  const pair=keyPair(),env=envelope(pair,{iaMaster:h(candidate.bytes)}),commands=[];let running=true;
  const controls={fault:null,failStartOnce:false,denyOwner:false,denyStage:false,foreignListener:false,alterResponse:null,powerShellCalls:[],toolMissing:false};
  const descriptors=new Map();
  const fsProxy=new Proxy(fs,{get(target,key){
    if(key==='lstatSync')return (filename,...args)=>{
      // Only synthetic metadata: no substitute executable is written or run.
      if(filename===powershell){if(controls.toolMissing)throw Error('synthetic unavailable tool');return fs.lstatSync(helper,...args);}
      return fs.lstatSync(filename,...args);
    };
    if(key==='openSync')return (filename,flags,...args)=>{
      controls.fault?.('before-open',filename,flags);
      const fd=fs.openSync(filename,flags,...args);descriptors.set(fd,filename);return fd;
    };
    if(key==='fsyncSync')return fd=>{
      const result=fs.fsyncSync(fd);controls.fault?.('after-durable',descriptors.get(fd),fd);return result;
    };
    if(key==='closeSync')return fd=>{descriptors.delete(fd);return fs.closeSync(fd);};
    if(key==='renameSync') return (a,b)=>{controls.fault?.('before-rename',a,b);const result=fs.renameSync(a,b);controls.fault?.('after-rename',a,b);return result;};
    if(key==='writeFileSync') return (a,b,...rest)=>{
      controls.fault?.('before-write',typeof a==='number'?descriptors.get(a):a,b);return fs.writeFileSync(a,b,...rest);
    };
    return target[key];
  }});
  const child={execFileSync:(exe,args,opts)=>{
    if(exe===powershell){
      controls.powerShellCalls.push({exe,args,options:opts});
      assert.equal(opts.cwd,systemDirectory);assert.equal(opts.env.PATH,systemDirectory);assert.equal(opts.env.Path,undefined);
      assert.equal(opts.env.SystemRoot,windowsRoot);assert.equal(opts.env.PSModulePath,path.join(powershellHome,'Modules'));
      if(args.join(' ').includes('currentOwnerAuthorized'))return JSON.stringify({currentOwnerAuthorized:!controls.denyOwner&&!(opts.env.AURORA_RELEASE_STAGE&&controls.denyStage)});
      return JSON.stringify({listeners:running?[
        {port:38765,address:controls.foreignListener?'0.0.0.0':'127.0.0.1',pid:999901,exe:process.execPath,command:'"'+process.execPath+'" "'+path.join(pkg,'server.cjs')+'"'},
        {port:11435,address:'127.0.0.1',pid:999902,exe:path.join(root,'components','ollama','0.35.1','ollama.exe'),command:'ignored'}
      ]:[]});
    }
    assert.equal(exe,process.execPath);assert.equal(args[0],helper);assert.equal(opts.env.AURORA_INTEGRATION_TOKEN,undefined);assert.equal(opts.cwd,root);
    commands.push(args[1]);
    if(args[1]==='start'&&controls.failStartOnce){controls.failStartOnce=false;throw Error('private native failure');}
    running=args[1]==='start';return Buffer.from('ignored public operation output');
  }};
  const loopback={get:(options,callback)=>{
    const req=emitResponse(callback,options.port===38765?(()=>{
      const current=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json'),'utf8'));
      return {service:'AURORA_IA_MASTER',version:'1.1.0',processManifest:{status:'PROCESS_MANIFEST_OBSERVED',dirty:false,sourceRevision:current.sourceRevision,manifestSha256:h(fs.readFileSync(path.join(pkg,'manifest.json')))}};
    })():{models:[{name:'qwen3:8b'}]});
    req.end();return req;
  }};
  const fakeProcess={...process,platform:'win32',versions:{...process.versions,node:'22.0.0'},pid:999990,execPath:process.execPath,
    env:{LOCALAPPDATA:local,SystemRoot:windowsRoot,WINDIR:windowsRoot,PATH:path.join(base,'untrusted-path')},
    kill:()=>{const e=Error('synthetic stopped process');e.code='ESRCH';throw e;}};
  const api=load({'node:fs':fsProxy,'node:child_process':child,'node:http':loopback,
    'node:https':nativeReader(env,b=>controls.alterResponse?.(b)),process:fakeProcess},h(baseline.bytes),layout.expectedHelperSha256,root,windowsRoot);
  const before={control:h(identity['control.key']),org:h(identity['organization.txt']),checkpoint:layout.expectedCheckpointSha256,git:h(fs.readFileSync(path.join(state,'git-task-marker.txt')))};
  const assertIdentity=()=>{assert.equal(h(fs.readFileSync(path.join(state,'control.key'))),before.control);assert.equal(h(fs.readFileSync(path.join(state,'organization.txt'))),before.org);
    assert.equal(h(fs.readFileSync(path.join(path.dirname(state),'integration-setup.json'))),before.checkpoint);assert.equal(h(fs.readFileSync(path.join(state,'git-task-marker.txt'))),before.git);};
  const options=async()=>({mode:'activate',pin:await api.readActivePin('synthetic-process-bearer',pair.trust,NEXT,'fixture-org'),bearer:'synthetic-process-bearer',trust:pair.trust,
    expectedSourceSha:NEXT,expectedOrg:'fixture-org',layout,packageDirectory:candidateDir,manifestBytes:candidate.bytes,stageDirectory:path.join(root,'reviewed-stage')});
  return {base,root,state,pkg,layout,pair,env,candidate,candidateDir,baseline,commands,controls,api,options,metadata,assertIdentity,fakeProcess,powershell,systemDirectory};
}
test('isolated verified V2 remains candidate, V1 partial and no activation authority',async()=>{
  const pair=keyPair(),v2=real.verifyCandidate(envelope(pair),pair.trust,NEXT),v1=real.verifyCandidate(envelope(pair,{},1),pair.trust,NEXT);
  assert.equal(v2.status,'CANDIDATE_UNVERIFIED');assert.equal(v2.allClientsSynchronized,false);assert.equal(v1.completeSignedSet,false);
  assert.throws(()=>real.requireActive(v2),/FRESH_CANONICAL/);assert.throws(()=>real.requireActive({...v2}),/FRESH_CANONICAL/);
  await assert.rejects(real.activatePublished({pin:v2}),/EXPLICIT_ACTIVATION/);
});
test('trusted public fingerprint, exact checks, source and signature are required',()=>{
  const pair=keyPair(),env=envelope(pair);
  assert.throws(()=>real.verifyCandidate(env,{...pair.trust,publicKeySha256:'f'.repeat(64)},NEXT),/UNTRUSTED/);
  assert.throws(()=>real.verifyCandidate(env,pair.trust,'b'.repeat(40)),/EXPECTED_SOURCE/);
  const extra=structuredClone(env);extra.certificate.checks.ownerApproved=true;assert.throws(()=>real.verifyCandidate(extra,pair.trust,NEXT),/INVALID_RELEASE/);
  env.signature='A'.repeat(86);assert.throws(()=>real.verifyCandidate(env,pair.trust,NEXT),/SIGNATURE/);
});
test('canonical native TLS pins org nonce runtime and no-store without leaking errors',async()=>{
  const pair=keyPair(),env=envelope(pair);let options;
  const api=load({'node:https':nativeReader(env,null,o=>{options=o;})});
  const pin=await api.readActivePin('synthetic-process-only',pair.trust,NEXT,'fixture-org');
  assert.equal(pin.completeSignedSet,true);api.requireActive(pin);
  assert.equal(options.hostname,'auroranexus.com.br');assert.equal(options.path,'/api/integration/active-release');
  assert.equal(options.rejectUnauthorized,true);assert.equal(options.minVersion,'TLSv1.2');assert.equal(options.agent,false);
  assert.match(options.headers['X-Aurora-Release-Nonce'],/^[a-f0-9]{64}$/);assert.equal(options.headers.Cookie,undefined);
  assert.throws(()=>api.requireActive(pin,Date.now()+31000),/FRESH_CANONICAL/);
  for(const mutate of [b=>b.orgId='other-org',b=>b.requestNonce='a'.repeat(64),b=>b.runtime.sourceSha='b'.repeat(40),b=>b.componentCoverage.complete=false,b=>b.currentPointer=true]){
    await assert.rejects(load({'node:https':nativeReader(env,mutate)}).readActivePin('synthetic',pair.trust,NEXT,'fixture-org'),/CANONICAL_/);
  }
  await assert.rejects(load({'node:https':{request:(_,cb)=>emitResponse(cb,{},302)}}).readActivePin('synthetic',pair.trust,NEXT,'fixture-org'),/READ_REJECTED/);
});
test('CLI existing published plan has zero authentication, requests or writes',async()=>{
  const api=load({'node:https':{request:()=>{throw Error('NETWORK_MUST_NOT_RUN');}},'node:fs':{...fs,writeFileSync:()=>{throw Error('WRITE_MUST_NOT_RUN');}}});
  assert.equal((await api.runCli([],{})).status,'READ_ONLY_PLAN');
  const child=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'update.cjs'),'published','--plan'],{encoding:'utf8'});
  assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout).activated,false);
});
test('34-file signed IA and 7-file Windows closures reject extras and changed bytes',t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-package-proof-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const ia=packageFixture(path.join(base,'ia'),Array.from({length:34},(_,i)=>'public-'+i+'.txt'));
  const win=packageFixture(path.join(base,'win'),WINDOWS,NEXT,'windowsIntegration'),pair=keyPair();
  const candidate=real.verifyCandidate(envelope(pair,{iaMaster:h(ia.bytes),windowsIntegration:h(win.bytes)}),pair.trust,NEXT);
  assert.equal(Object.keys(real.inspectPackage(candidate,'iaMaster',path.join(base,'ia'),ia.bytes).files).length,35);
  assert.equal(Object.keys(real.inspectPackage(candidate,'windowsIntegration',path.join(base,'win'),win.bytes).files).length,8);
  fs.writeFileSync(path.join(base,'ia','extra.txt'),'public extra');assert.throws(()=>real.inspectPackage(candidate,'iaMaster',path.join(base,'ia'),ia.bytes),/CLOSURE/);
  fs.writeFileSync(path.join(base,'win','client_agent.py'),'changed');assert.throws(()=>real.inspectPackage(candidate,'windowsIntegration',path.join(base,'win'),win.bytes),/FILE_BYTES/);
});
test('stage is idempotent, resumable when complete and never activated',t=>{
  const f=transactionFixture(t),candidate=f.api.verifyCandidate(f.env,f.pair.trust,NEXT),destination=path.join(f.root,'stage');
  const options={candidate,packageDirectory:f.candidateDir,manifestBytes:f.candidate.bytes,destination};
  assert.equal(f.api.stageCandidate(options).activated,false);assert.equal(f.api.stageCandidate(options).status,'CANDIDATE_STAGED_NOT_CURRENT');
  fs.renameSync(destination,destination+'.preparing');assert.equal(f.api.stageCandidate(options).activated,false);
  assert.equal(f.commands.length,0);f.assertIdentity();
});
test('activation preserves C identities and Git paths with D helper and real byte readback',async t=>{
  const f=transactionFixture(t),result=await f.api.activatePublished(await f.options());
  assert.equal(result.status,'SIGNED_LOCAL_COMPONENT_APPLIED');assert.equal(result.cloudReceiptVerified,false);
  assert.deepEqual(f.commands,['stop','start']);f.assertIdentity();
  assert.equal(h(fs.readFileSync(path.join(f.pkg,'manifest.json'))),h(f.candidate.bytes));
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),false);
  const again=await f.api.activatePublished(await f.options());
  assert.equal(again.status,'SIGNED_LOCAL_COMPONENT_ALREADY_APPLIED');assert.deepEqual(f.commands,['stop','start']);
});
for(const phase of ['baseline-rename','candidate-rename','metadata-rename','new-start'])test('owned rollback restores all bytes after '+phase,async t=>{
  const f=transactionFixture(t);let fired=false;
  if(phase==='new-start') f.controls.failStartOnce=true;
  else f.controls.fault=(when,a,b)=>{
    const match=phase==='baseline-rename'?when==='after-rename'&&String(b).endsWith('component.previous'):
      phase==='candidate-rename'?when==='after-rename'&&String(a).endsWith(path.join('reviewed-stage','package')):
      when==='after-durable'&&String(a).endsWith('installation.json');
    if(!fired&&match){fired=true;throw Error('SYNTHETIC_IO_FAILURE');}
  };
  await assert.rejects(f.api.activatePublished(await f.options()),/SYNTHETIC_IO_FAILURE|OWNED_MANAGER_OPERATION_FAILED|METADATA_CAS_CONFLICT/);
  assert.equal(h(fs.readFileSync(path.join(f.pkg,'manifest.json'))),h(f.baseline.bytes));
  assert.deepEqual(fs.readFileSync(path.join(f.state,'installation.json')),f.metadata);f.assertIdentity();
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),false);
});
test('interrupted recovery retries after package restore and journal save failure',async t=>{
  const f=transactionFixture(t);let fail=true;
  f.controls.fault=(when,a,b)=>{
    if(fail&&when==='after-rename'&&String(b).endsWith('component.previous'))throw Error('SYNTHETIC_INTERRUPTION');
    if(fail&&when==='before-write'&&String(a).includes('journal.json.')&&String(b).includes('ROLLED_BACK_LOCAL_PREVIOUS'))throw Error('SYNTHETIC_JOURNAL_FAILURE');
  };
  // Make the first rollback fail before restoration, leaving the owned lock.
  const original=f.controls.fault;let rollbackBlocked=false;
  f.controls.fault=(when,a,b)=>{original(when,a,b);if(fail&&when==='after-rename'&&String(b)===f.pkg){rollbackBlocked=true;throw Error('SYNTHETIC_AFTER_RESTORE');}};
  await assert.rejects(f.api.activatePublished(await f.options()),/ROLLBACK_INCOMPLETE/);
  assert.equal(rollbackBlocked,true);fail=false;
  const attempt=path.join(f.root,'installation-rollbacks',fs.readdirSync(path.join(f.root,'installation-rollbacks'))[0]);
  const result=await f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt});
  assert.equal(result.status,'ROLLED_BACK_LOCAL_PREVIOUS');f.assertIdentity();
  assert.deepEqual(fs.readFileSync(path.join(f.state,'installation.json')),f.metadata);
  assert.equal((await f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt})).alreadyRecovered,true);
});
test('pre-stop guards reject owner, helper hash, private stage ACL, foreign listener and nested staging',async t=>{
  for(const mutation of [f=>f.controls.denyOwner=true,f=>fs.writeFileSync(f.layout.helperPath,'changed helper'),
    f=>f.controls.denyStage=true,f=>f.controls.foreignListener=true,f=>f.layout.expectedCheckpointSha256='f'.repeat(64)]){
    const f=transactionFixture(t);mutation(f);await assert.rejects(f.api.activatePublished(await f.options()));assert.deepEqual(f.commands,[]);f.assertIdentity();
  }
  const f=transactionFixture(t),options=await f.options();options.stageDirectory=path.join(f.pkg,'nested-stage');
  await assert.rejects(f.api.activatePublished(options),/SEPARATE_PRIVATE_STAGE/);assert.equal(fs.existsSync(options.stageDirectory),false);
});
test('canonical pointer failure before stop preserves the running baseline',async t=>{
  const f=transactionFixture(t);let reads=0;
  f.controls.alterResponse=body=>{if(++reads===2)body.requestNonce='f'.repeat(64);};
  await assert.rejects(f.api.activatePublished(await f.options()),/CANONICAL_RESPONSE_BINDING/);
  assert.deepEqual(f.commands,[]);assert.equal(h(fs.readFileSync(path.join(f.pkg,'manifest.json'))),h(f.baseline.bytes));f.assertIdentity();
});
test('canonical pointer failure after start rolls back only its own new component',async t=>{
  const f=transactionFixture(t);let reads=0;
  f.controls.alterResponse=body=>{if(++reads===3)body.runtime.sourceSha='b'.repeat(40);};
  await assert.rejects(f.api.activatePublished(await f.options()),/CANONICAL_RUNTIME_CONFLICT/);
  assert.deepEqual(f.commands,['stop','start','stop','start']);
  assert.equal(h(fs.readFileSync(path.join(f.pkg,'manifest.json'))),h(f.baseline.bytes));
  assert.deepEqual(fs.readFileSync(path.join(f.state,'installation.json')),f.metadata);f.assertIdentity();
});
test('concurrent new content is never overwritten by rollback',async t=>{
  const f=transactionFixture(t);let fired=false;
  f.controls.fault=(when,a,b)=>{if(!fired&&when==='after-rename'&&a.endsWith(path.join('reviewed-stage','package'))){
    fired=true;fs.writeFileSync(path.join(f.pkg,'concurrent.txt'),'synthetic concurrent owner');throw Error('SYNTHETIC_CONCURRENCY');}};
  await assert.rejects(f.api.activatePublished(await f.options()),/ROLLBACK_INCOMPLETE/);
  assert.equal(fs.readFileSync(path.join(f.pkg,'concurrent.txt'),'utf8'),'synthetic concurrent owner');f.assertIdentity();
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),true);
});
test('native proof uses the fixed Windows binary and controlled CWD, not PATH lookup',async t=>{
  const f=transactionFixture(t);await f.api.activatePublished(await f.options());
  assert.ok(f.controls.powerShellCalls.length>0);
  for(const call of f.controls.powerShellCalls){
    assert.equal(call.exe,f.powershell);assert.equal(path.isAbsolute(call.exe),true);
    assert.equal(call.options.cwd,f.systemDirectory);
    assert.equal(call.options.env.PATH,f.systemDirectory);
    assert.equal(call.options.env.PSModulePath,path.join(path.dirname(f.powershell),'Modules'));
    assert.ok(call.args.includes('-NoProfile'));
  }
  assert.equal(fs.existsSync(f.powershell),false); // Metadata stub only, no substitute exe/PoC.
});
test('native proof fails closed before a child when Windows root, architecture or tool is unavailable',async t=>{
  for(const mutation of [f=>f.fakeProcess.env.SystemRoot=path.join(f.base,'unapproved-windows'),
    f=>f.fakeProcess.env.WINDIR=path.join(f.base,'unapproved-windows'),f=>f.fakeProcess.arch='ia32',
    f=>f.controls.toolMissing=true]){
    const f=transactionFixture(t);mutation(f);
    await assert.rejects(f.api.activatePublished(await f.options()),/LOCAL_OWNER_OR_PROCESS_PROOF_UNAVAILABLE/);
    assert.equal(f.controls.powerShellCalls.length,0);assert.deepEqual(f.commands,[]);f.assertIdentity();
  }
});
function attemptOf(f){
  const directory=path.join(f.root,'installation-rollbacks');
  return path.join(directory,fs.readdirSync(directory).find(name=>name.startsWith('published-')));
}
for(const moment of ['after-displace','before-exclusive-create'])test('metadata publication preserves a writer inserted '+moment,async t=>{
  const f=transactionFixture(t),installation=path.join(f.state,'installation.json');
  const concurrent=encode({syntheticConcurrentWriter:true,revision:'legitimate-public-metadata'});
  let inserted=false;
  f.controls.fault=(when,a,b)=>{
    const matched=moment==='after-displace'?when==='after-rename'&&a===installation&&String(b).includes('.displaced-'):
      when==='before-open'&&a===installation&&b==='wx';
    if(!inserted&&matched){inserted=true;fs.writeFileSync(installation,concurrent);}
  };
  await assert.rejects(f.api.activatePublished(await f.options()),/LOCAL_APPLICATION_ROLLBACK_INCOMPLETE/);
  assert.equal(inserted,true);assert.deepEqual(fs.readFileSync(installation),concurrent);
  const attempt=attemptOf(f),journal=JSON.parse(fs.readFileSync(path.join(attempt,'journal.json')));
  assert.deepEqual(fs.readFileSync(path.join(attempt,'metadata.previous')),f.metadata);
  assert.deepEqual(fs.readFileSync(installation+'.displaced-'+journal.id),f.metadata);
  assert.equal(fs.existsSync(installation+'.prepared-'+journal.id),true);
  const commands=[...f.commands];
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt}),/RECOVERY_METADATA_CHANGED/);
  assert.deepEqual(fs.readFileSync(installation),concurrent);assert.deepEqual(f.commands,commands);f.assertIdentity();
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),true);
});
test('metadata writer between final CAS check and displacement is preserved byte for byte',async t=>{
  const f=transactionFixture(t),installation=path.join(f.state,'installation.json');
  const concurrent=encode({syntheticConcurrentWriter:true,revision:'changed-before-displacement'});let inserted=false;
  f.controls.fault=(when,a,b)=>{
    if(!inserted&&when==='before-rename'&&a===installation&&String(b).includes('.displaced-')){
      inserted=true;fs.writeFileSync(installation,concurrent);
    }
  };
  await assert.rejects(f.api.activatePublished(await f.options()),/LOCAL_APPLICATION_ROLLBACK_INCOMPLETE/);
  assert.deepEqual(fs.readFileSync(installation),concurrent);
  assert.deepEqual(fs.readFileSync(path.join(attemptOf(f),'metadata.previous')),f.metadata);f.assertIdentity();
});
test('restore exclusive creation preserves an intervening writer and rejects later recovery',async t=>{
  const f=transactionFixture(t),installation=path.join(f.state,'installation.json');
  const concurrent=encode({syntheticConcurrentWriter:true,revision:'during-owned-rollback'});let inserted=false;
  f.controls.failStartOnce=true;
  f.controls.fault=(when,a,b)=>{
    if(!inserted&&when==='after-rename'&&a===installation&&String(b).includes('.candidate-')){
      inserted=true;fs.writeFileSync(installation,concurrent);
    }
  };
  await assert.rejects(f.api.activatePublished(await f.options()),/LOCAL_APPLICATION_ROLLBACK_INCOMPLETE/);
  assert.equal(inserted,true);assert.deepEqual(fs.readFileSync(installation),concurrent);
  const attempt=attemptOf(f),journal=JSON.parse(fs.readFileSync(path.join(attempt,'journal.json')));
  assert.deepEqual(fs.readFileSync(installation+'.recovery-'+journal.id),f.metadata);
  assert.equal(h(fs.readFileSync(installation+'.candidate-'+journal.id)),journal.nextMetadataSha256);
  assert.deepEqual(fs.readFileSync(path.join(attempt,'metadata.previous')),f.metadata);
  const commands=[...f.commands];
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt}),/RECOVERY_METADATA_CHANGED/);
  assert.deepEqual(f.commands,commands);assert.deepEqual(fs.readFileSync(installation),concurrent);f.assertIdentity();
});
test('partial exclusive restoration fails closed and retains both complete backups',async t=>{
  const f=transactionFixture(t),installation=path.join(f.state,'installation.json');let interrupted=false;
  f.controls.failStartOnce=true;
  f.controls.fault=(when,a,bytes)=>{
    if(!interrupted&&when==='before-write'&&a===installation&&Buffer.isBuffer(bytes)&&h(bytes)===h(f.metadata)){
      interrupted=true;throw Error('SYNTHETIC_CRASH_AFTER_EXCLUSIVE_OPEN');
    }
  };
  await assert.rejects(f.api.activatePublished(await f.options()),/LOCAL_APPLICATION_ROLLBACK_INCOMPLETE/);
  assert.equal(interrupted,true);assert.equal(fs.readFileSync(installation).length,0);
  const attempt=attemptOf(f),journal=JSON.parse(fs.readFileSync(path.join(attempt,'journal.json')));
  assert.deepEqual(fs.readFileSync(path.join(attempt,'metadata.previous')),f.metadata);
  assert.deepEqual(fs.readFileSync(installation+'.recovery-'+journal.id),f.metadata);
  assert.equal(h(fs.readFileSync(installation+'.candidate-'+journal.id)),journal.nextMetadataSha256);
  const commands=[...f.commands];
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt}),/RECOVERY_METADATA_CHANGED/);
  assert.equal(fs.readFileSync(installation).length,0);assert.deepEqual(f.commands,commands);f.assertIdentity();
});
