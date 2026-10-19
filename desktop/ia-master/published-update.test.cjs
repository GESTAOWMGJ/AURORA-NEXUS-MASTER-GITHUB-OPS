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
function envelope(pair, hashes = {}, schema = 2, sourceSha = NEXT, windowsVersion = '1.0.1') {
  const components = Object.fromEntries(real.COMPONENTS.slice(0,schema===2?5:3).map(name=>[name,{version:name==='windowsIntegration'?windowsVersion:'1.1.0',sourceSha,manifestSha256:hashes[name]||'c'.repeat(64)}]));
  const certificate={schemaVersion:schema,sourceSha,productVersion:'1.1.0-beta.1',canonicalOrigin:real.ORIGIN,
    releaseRunId:'13',ciRunId:'12',publishedAtUtc:'2026-10-13T11:00:00.000Z',status:'ACTIVE',
    checks:{ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true},components};
  return {certificate,signature:crypto.sign(null,real.signingBytes(certificate),pair.privateKey).toString('base64url')};
}
function response(env, nonce, org='fixture-org') {
  const covered=real.COMPONENTS.filter(name=>env.certificate.components[name]),complete=env.certificate.schemaVersion===2;
  return {schemaVersion:'aurora.active-release-read.v1',source:real.SOURCE,canonicalOrigin:real.ORIGIN,orgId:org,requestNonce:nonce,
    observedAtUtc:new Date().toISOString(),certificateSha256:h(real.signingBytes(env.certificate)),envelope:env,
    runtime:{sourceSha:env.certificate.sourceSha,serverManifestSha256:env.certificate.components.server.manifestSha256,webManifestSha256:env.certificate.components.web.manifestSha256},
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
  const sandbox={module,exports:module.exports,Buffer,URL,structuredClone,console,setTimeout,clearTimeout,Date:overrides.Date||Date,process:overrides.process||process,
    require:name=>overrides[name]||(name==='./safe-read.cjs'?require('./safe-read.cjs'):require(name))};
  vm.runInNewContext(source,sandbox,{filename:'published-update.cjs'});
  return module.exports;
}
function nativeReader(env, modify, capture, status=()=>200) {
  return {request:(options,callback)=>{
    capture?.(options);
    const body=response(env,options.headers['X-Aurora-Release-Nonce']);
    modify?.(body);
    return emitResponse(callback,body,status());
  }};
}
function writeFiles(directory, files) {
  fs.mkdirSync(directory,{recursive:true});
  for(const [name,bytes]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(directory,name)),{recursive:true});fs.writeFileSync(path.join(directory,name),bytes);}
}
function packageFixture(directory, names, source=NEXT, component='iaMaster', windowsVersion='1.0.1') {
  const files=Object.fromEntries(names.map(name=>[name,Buffer.from('synthetic public '+name)]));
  const manifest={component:component==='iaMaster'?'AURORA_IA_MASTER':'AURORA_WINDOWS_INTEGRATION',version:component==='iaMaster'?'1.1.0':windowsVersion,
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
  const controls={fault:null,failStartOnce:false,denyOwner:false,denyStage:false,foreignListener:false,alterResponse:null,powerShellCalls:[],toolMissing:false,
    now:Date.now(),nativeEvent:null,managerEvent:null,localEvent:null,canonicalReads:[],canonicalStatus:200,
    transitionAuthority:null,authorityEvent:null,authorityStatus:200,authorityReads:[]};
  class FixtureDate extends Date { constructor(...args){super(...(args.length?args:[controls.now]));} static now(){return controls.now;} }
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
      controls.nativeEvent?.(args.join(' '),running);
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
    controls.managerEvent?.(args[1],running);
    if(args[1]==='start'&&controls.failStartOnce){controls.failStartOnce=false;throw Error('private native failure');}
    running=args[1]==='start';return Buffer.from('ignored public operation output');
  }};
  const loopback={get:(options,callback)=>{
    controls.localEvent?.(options.port,running);
    const req=emitResponse(callback,options.port===38765?(()=>{
      const current=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json'),'utf8'));
      return {service:'AURORA_IA_MASTER',version:'1.1.0',processManifest:{status:'PROCESS_MANIFEST_OBSERVED',dirty:false,sourceRevision:current.sourceRevision,manifestSha256:h(fs.readFileSync(path.join(pkg,'manifest.json')))}};
    })():{models:[{name:'qwen3:8b'}]});
    req.end();return req;
  }};
  const fakeProcess={...process,platform:'win32',versions:{...process.versions,node:'22.0.0'},pid:999990,execPath:process.execPath,
    env:{LOCALAPPDATA:local,SystemRoot:windowsRoot,WINDIR:windowsRoot,PATH:path.join(base,'untrusted-path')},
    kill:()=>{const e=Error('synthetic stopped process');e.code='ESRCH';throw e;}};
  const reader=nativeReader(env,b=>{b.observedAtUtc=new Date(controls.now).toISOString();controls.alterResponse?.(b);},
    options=>controls.canonicalReads.push({at:controls.now,nonce:options.headers['X-Aurora-Release-Nonce']}),()=>controls.canonicalStatus);
  const api=load({'node:fs':fsProxy,'node:child_process':child,'node:http':loopback,Date:FixtureDate,
    'node:https':{request:(options,callback)=>{
      if(!options.path.startsWith('/api/integration/ping?documentId='))return reader.request(options,callback);
      controls.authorityReads.push(options);const body=structuredClone(controls.transitionAuthority);
      if(body?.installation?.acceptance)body.installation.acceptance.verifiedAt=new Date(controls.now).toISOString();
      controls.authorityEvent?.(body,options);return emitResponse(callback,body,controls.authorityStatus);
    }},process:fakeProcess},h(baseline.bytes),layout.expectedHelperSha256,root,windowsRoot);
  const before={control:h(identity['control.key']),org:h(identity['organization.txt']),checkpoint:layout.expectedCheckpointSha256,git:h(fs.readFileSync(path.join(state,'git-task-marker.txt')))};
  const assertIdentity=()=>{assert.equal(h(fs.readFileSync(path.join(state,'control.key'))),before.control);assert.equal(h(fs.readFileSync(path.join(state,'organization.txt'))),before.org);
    assert.equal(h(fs.readFileSync(path.join(path.dirname(state),'integration-setup.json'))),before.checkpoint);assert.equal(h(fs.readFileSync(path.join(state,'git-task-marker.txt'))),before.git);};
  const options=async()=>({mode:'activate',pin:await api.readActivePin('synthetic-process-bearer',pair.trust,env.certificate.sourceSha,'fixture-org'),bearer:'synthetic-process-bearer',trust:pair.trust,
    expectedSourceSha:env.certificate.sourceSha,expectedOrg:'fixture-org',layout:{...layout},packageDirectory:candidateDir,manifestBytes:candidate.bytes,stageDirectory:path.join(root,'reviewed-stage')});
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
  const result=await f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt,trust:f.pair.trust});
  assert.equal(result.status,'ROLLED_BACK_LOCAL_PREVIOUS');f.assertIdentity();
  assert.deepEqual(fs.readFileSync(path.join(f.state,'installation.json')),f.metadata);
  assert.equal((await f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt,trust:f.pair.trust})).alreadyRecovered,true);
});
function concurrentRestoredInput(f, kind, attempt) {
  const filename=kind==='package'?path.join(f.pkg,'concurrent.txt'):
    kind==='metadata'?path.join(f.state,'installation.json'):path.join(attempt,'journal.json');
  const bytes=kind==='package'?Buffer.from('synthetic legitimate writer during runtime proof'):
    Buffer.concat([fs.readFileSync(filename),Buffer.from(' ')]);
  fs.writeFileSync(filename,bytes);
  return {filename,bytes};
}
for(const window of ['owned-rollback','before-package-move'])for(const kind of ['package','metadata','journal'])
test('post-await '+window+' rejects concurrent '+kind+' without false rollback success',async t=>{
  const f=transactionFixture(t);let changed;
  if(window==='owned-rollback')f.controls.failStartOnce=true;
  else f.controls.managerEvent=operation=>{if(operation==='stop')f.controls.canonicalStatus=403;};
  f.controls.localEvent=port=>{
    const starts=f.commands.filter(command=>command==='start').length;
    if(!changed&&port===11435&&starts===(window==='owned-rollback'?2:1))
      changed=concurrentRestoredInput(f,kind,attemptOf(f));
  };
  await assert.rejects(f.api.activatePublished(await f.options()),/LOCAL_APPLICATION_ROLLBACK_INCOMPLETE/);
  assert.ok(changed);assert.deepEqual(fs.readFileSync(changed.filename),changed.bytes);
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),true);
  const attempt=attemptOf(f),journal=JSON.parse(fs.readFileSync(path.join(attempt,'journal.json')));
  assert.notEqual(journal.phase,'ROLLED_BACK_LOCAL_PREVIOUS');assert.notEqual(journal.phase,'COMPLETED');
  assert.deepEqual(fs.readFileSync(path.join(attempt,'metadata.previous')),f.metadata);f.assertIdentity();
});
for(const locked of [false,true])for(const kind of ['package','metadata','journal'])
test('post-await recovery locked='+locked+' rejects concurrent '+kind+' and preserves recovery evidence',async t=>{
  const f=transactionFixture(t);let interrupt=true;
  if(locked)f.controls.fault=(when,a,b)=>{
    if(interrupt&&when==='after-rename'&&String(b).endsWith('component.previous'))throw Error('SYNTHETIC_INTERRUPTION');
    if(interrupt&&when==='after-rename'&&b===f.pkg&&String(a).endsWith('component.previous'))throw Error('SYNTHETIC_RESTORE_INTERRUPTION');
  };
  else f.controls.failStartOnce=true;
  await assert.rejects(f.api.activatePublished(await f.options()),locked?/ROLLBACK_INCOMPLETE/:/OWNED_MANAGER_OPERATION_FAILED/);
  interrupt=false;const attempt=attemptOf(f);let changed;
  f.controls.localEvent=port=>{if(!changed&&port===11435)changed=concurrentRestoredInput(f,kind,attempt);};
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt,trust:f.pair.trust}),
    kind==='journal'?/ROLLBACK_JOURNAL_CHANGED/:locked?/ROLLBACK_READBACK_CHANGED/:/RECOVERED_BYTES_CHANGED/);
  assert.ok(changed);assert.deepEqual(fs.readFileSync(changed.filename),changed.bytes);
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),locked);
  assert.deepEqual(fs.readFileSync(path.join(attempt,'metadata.previous')),f.metadata);f.assertIdentity();
  if(locked)assert.notEqual(JSON.parse(fs.readFileSync(path.join(attempt,'journal.json'))).phase,'ROLLED_BACK_LOCAL_PREVIOUS');
});
test('already-recovered runtime proof cannot ignore a newly acquired update lock',async t=>{
  const f=transactionFixture(t);f.controls.failStartOnce=true;
  await assert.rejects(f.api.activatePublished(await f.options()),/OWNED_MANAGER_OPERATION_FAILED/);
  const attempt=attemptOf(f),lock=path.join(f.root,'published-update.lock'),bytes=encode({syntheticConcurrentOwner:true});let inserted=false;
  f.controls.localEvent=port=>{if(!inserted&&port===11435){inserted=true;fs.writeFileSync(lock,bytes);}};
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt,trust:f.pair.trust}),/RECOVERY_LOCK_CHANGED/);
  assert.equal(inserted,true);assert.deepEqual(fs.readFileSync(lock),bytes);f.assertIdentity();
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
  const f=transactionFixture(t);
  f.controls.alterResponse=body=>{if(f.commands.includes('start'))body.runtime.sourceSha='b'.repeat(40);};
  await assert.rejects(f.api.activatePublished(await f.options()),/CANONICAL_RUNTIME_CONFLICT/);
  assert.deepEqual(f.commands,['stop','start','stop','start']);
  assert.equal(h(fs.readFileSync(path.join(f.pkg,'manifest.json'))),h(f.baseline.bytes));
  assert.deepEqual(fs.readFileSync(path.join(f.state,'installation.json')),f.metadata);f.assertIdentity();
});
test('native checks exceeding 30 seconds renew nonces without extending the pin lease',async t=>{
  const f=transactionFixture(t);
  f.controls.nativeEvent=()=>{f.controls.now+=35000;};
  f.controls.managerEvent=()=>{
    assert.ok(f.controls.now-f.controls.canonicalReads.at(-1).at<=30000);
    f.controls.now+=35000;
  };
  f.controls.fault=(when,a,b)=>{
    if(when==='before-rename'&&(String(b).endsWith('component.previous')||b===f.pkg))
      assert.ok(f.controls.now-f.controls.canonicalReads.at(-1).at<=30000);
  };
  const options=await f.options(),original=options.pin;
  assert.equal((await f.api.activatePublished(options)).status,'SIGNED_LOCAL_COMPONENT_APPLIED');
  assert.throws(()=>f.api.requireActive(original,f.controls.now),/FRESH_CANONICAL_V2_PIN_REQUIRED/);
  assert.ok(f.controls.canonicalReads.length>=9);
  assert.equal(new Set(f.controls.canonicalReads.map(r=>r.nonce)).size,f.controls.canonicalReads.length);
  assert.equal((await f.api.activatePublished(await f.options())).status,'SIGNED_LOCAL_COMPONENT_ALREADY_APPLIED');
  assert.deepEqual(f.commands,['stop','start']);f.assertIdentity();
});
for(const change of ['certificate','source','revocation'])for(const window of ['pre-stop-native','after-stop','after-first-move','after-start-native','final-native'])
test(change+' during '+window+' delay cannot promote and preserves the owned rollback',async t=>{
  const f=transactionFixture(t);let changed=false,prepared=false;
  const alternate=structuredClone(f.env);alternate.certificate.releaseRunId='14';
  if(change==='source'){
    alternate.certificate.sourceSha='b'.repeat(40);
    for(const component of Object.values(alternate.certificate.components))component.sourceSha='b'.repeat(40);
  }
  alternate.signature=crypto.sign(null,real.signingBytes(alternate.certificate),f.pair.privateKey).toString('base64url');
  const changePointer=()=>{if(changed)return;changed=true;f.controls.now+=35000;
    if(change==='revocation')f.controls.canonicalStatus=403;
    else f.controls.alterResponse=body=>{body.envelope=alternate;body.certificateSha256=h(real.signingBytes(alternate.certificate));};
  };
  f.controls.fault=(when,a,b)=>{
    if(when==='before-write'&&String(a).includes('journal.json.')&&String(b).includes('"phase":"PREPARED"'))prepared=true;
    if(window==='after-first-move'&&when==='after-rename'&&String(b).endsWith('component.previous'))changePointer();
  };
  f.controls.nativeEvent=script=>{
    if(!script.includes('currentOwnerAuthorized'))return;
    if(window==='pre-stop-native'&&prepared&&f.commands.length===0)changePointer();
    if(window==='final-native'&&f.commands.includes('start'))changePointer();
  };
  f.controls.managerEvent=operation=>{if(window==='after-stop'&&operation==='stop')changePointer();};
  f.controls.localEvent=port=>{if(window==='after-start-native'&&port===38765&&f.commands.includes('start'))changePointer();};
  await assert.rejects(f.api.activatePublished(await f.options()),
    change==='certificate'?/CANONICAL_POINTER_CHANGED/:change==='source'?/EXPECTED_SOURCE_CONFLICT/:/CANONICAL_RELEASE_READ_REJECTED/);
  assert.equal(changed,true);
  assert.equal(h(fs.readFileSync(path.join(f.pkg,'manifest.json'))),h(f.baseline.bytes));
  assert.deepEqual(fs.readFileSync(path.join(f.state,'installation.json')),f.metadata);f.assertIdentity();
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),false);
  assert.deepEqual(f.commands,window==='pre-stop-native'?[]:
    ['after-start-native','final-native'].includes(window)?['stop','start','stop','start']:['stop','start']);
  const journal=JSON.parse(fs.readFileSync(path.join(attemptOf(f),'journal.json')));
  assert.equal(journal.phase,window==='pre-stop-native'?'PREPARED_NOT_APPLIED':'ROLLED_BACK_LOCAL_PREVIOUS');
});

async function successorOptions(f, source) {
  const directory=path.join(f.base,'candidate-'+source.slice(0,8));
  const candidate=packageFixture(directory,Object.keys(f.candidate.files),source);
  candidate.files['server.cjs']=Buffer.from('synthetic public server for '+source);
  candidate.manifest.files['server.cjs']=h(candidate.files['server.cjs']);candidate.bytes=encode(candidate.manifest);
  writeFiles(directory,{...candidate.files,'manifest.json':candidate.bytes});
  Object.assign(f.env,envelope(f.pair,{iaMaster:h(candidate.bytes)},2,source));
  f.layout.expectedInstallationSha256=h(fs.readFileSync(path.join(f.state,'installation.json')));
  return {...await f.options(),packageDirectory:directory,manifestBytes:candidate.bytes,
    stageDirectory:path.join(f.root,'reviewed-stage-'+source.slice(0,8))};
}

function signedWindowsFixture(f, source, iaBytes, windowsVersion='1.0.1') {
  const directory=path.join(f.base,'windows-'+source.slice(0,8)),pack=packageFixture(directory,WINDOWS,source,'windowsIntegration',windowsVersion);
  const manifestPath=path.join(f.base,'windows-manifest-'+source.slice(0,8)+'.json');fs.writeFileSync(manifestPath,pack.bytes);
  Object.assign(f.env,envelope(f.pair,{iaMaster:h(iaBytes),windowsIntegration:h(pack.bytes)},2,source,windowsVersion));
  return {directory,manifestPath,envelope:structuredClone(f.env)};
}
async function transitionBase(t, windowsVersion='1.0.1') {
  const f=transactionFixture(t),checkpoint=path.join(path.dirname(f.state),'integration-setup.json');
  const previous={schemaVersion:'aurora.install.integration.v1',componentVersion:'1.0.0',attempt:1,status:'LOCAL_VALIDATED',
    targetBinding:h('https://wmgj-hml-jfn-20260927.web.app:fixture-org'),sampleKey:'win-v1:'+h('old explicit synthetic sample')};
  fs.writeFileSync(checkpoint,Buffer.from(real.canonical(previous)+'\n'));f.layout.expectedCheckpointSha256=h(fs.readFileSync(checkpoint));
  const windows=signedWindowsFixture(f,NEXT,f.candidate.bytes,windowsVersion),applied=await f.api.activatePublished(await f.options());
  return {f,checkpoint,windows,applied};
}
function explicitCheckpointTransition(f, checkpoint, windows, applied, sequence=1, previousTransition=null,
  checkpointVersion=windows.envelope.certificate.components.windowsIntegration.version) {
  const bytes=value=>Buffer.from(real.canonical(value)+'\n'),oldBytes=fs.readFileSync(checkpoint),old=JSON.parse(oldBytes);
  const journalPath=path.join(applied.attempt,'journal.json'),journalBytes=fs.readFileSync(journalPath),journal=JSON.parse(journalBytes);
  const plan={schemaVersion:'aurora.checkpoint.transition.v1',stateDirectory:path.dirname(f.state),expectedPreviousSha256:h(oldBytes),
    expectedPreviousTargetBinding:old.targetBinding,expectedPreviousSampleKey:old.sampleKey,nextOrigin:real.ORIGIN,
    nextTargetBinding:h(real.ORIGIN+':fixture-org'),nextSampleKey:'win-v1:'+h('new explicitly selected sample '+sequence),
    payloadSha256:h('new normalized synthetic payload '+sequence),method:'API_TOKEN',orgId:'fixture-org',
    expectedSourceSha:windows.envelope.certificate.sourceSha,expectedCertificateSha256:h(real.signingBytes(windows.envelope.certificate)),
    iaAnchor:{attemptDirectory:applied.attempt,journalSha256:h(journalBytes)},previousTransition,
    publicReleaseControl:{trust:f.pair.trust,expectedSourceSha:windows.envelope.certificate.sourceSha,manifestPath:windows.manifestPath},
    envelope:windows.envelope,packageDirectory:windows.directory};
  const processingProof={state:'FIRST_INGESTION_VERIFIED',firstIngestionVerified:true,operationalComplete:true,
    documentId:h('doc'+sequence).slice(0,48),sourceVersion:1,revision:1,versionId:h('version'+sequence).slice(0,48),
    canonicalSnapshotHash:h('snapshot'+sequence),sourceSystem:'SYNTHETIC_PUBLIC',verifiedAt:new Date(f.controls.now).toISOString()};
  const acceptance={schemaVersion:'aurora.installation.acceptance.v1',orgId:'fixture-org',canonicalOrigin:real.ORIGIN,
    state:'INSTALLATION_INTEGRATION_VERIFIED',eligible:true,automationScope:'AURORA_CANONICAL_PIPELINE',method:'API_TOKEN',
    configurationHash:h('current configuration'),receiptId:h('integration-document:ik_0123456789abcdef:'+plan.nextSampleKey),
    ...Object.fromEntries(['documentId','versionId','sourceVersion','canonicalSnapshotHash','verifiedAt'].map(key=>[key,processingProof[key]])),
    processingVerified:true,receiptPersisted:true,replayVerified:true,automationConfigured:true,automationVerified:true};
  const receipt={schemaVersion:1,status:'DUPLICATE',payloadSha256:plan.payloadSha256,idempotencyKey:plan.nextSampleKey,
    documentId:processingProof.documentId,cloudReceiptVerified:true};
  const next={schemaVersion:'aurora.install.integration.v1',componentVersion:checkpointVersion,attempt:old.attempt+1,
    targetBinding:plan.nextTargetBinding,sampleKey:plan.nextSampleKey,status:'SAMPLE_RECEIPT_VERIFIED',
    receiptVerifiedThisRun:true,processingVerifiedThisRun:true,receipt,processingProof,
    installationAcceptance:Object.fromEntries(Object.entries(acceptance).filter(([key])=>!['orgId','canonicalOrigin'].includes(key)))};
  const planBytes=bytes(plan),nextBytes=bytes(next),proofBytes=bytes({schemaVersion:'aurora.checkpoint.transition.proof.v1',receipt,processingProof,installationAcceptance:acceptance});
  const directory=path.join(path.dirname(f.state),'checkpoint-transitions',h(planBytes));fs.mkdirSync(directory,{recursive:true});
  const commitBytes=bytes({schemaVersion:'aurora.checkpoint.transition.commit.v1',planSha256:h(planBytes),
    previousSha256:h(oldBytes),nextSha256:h(nextBytes),proofSha256:h(proofBytes)});
  writeFiles(directory,{'plan.json':planBytes,'checkpoint.previous':oldBytes,'checkpoint.next':nextBytes,'proof.json':proofBytes,'commit.json':commitBytes});
  fs.writeFileSync(checkpoint,nextBytes);f.layout.expectedCheckpointSha256=h(nextBytes);
  f.layout.checkpointTransition={directory,commitSha256:h(commitBytes)};
  f.controls.transitionAuthority={ok:true,service:'aurora-nexus-integration',orgId:'fixture-org',keyId:'ik_0123456789abcdef',installation:{...processingProof,acceptance}};
  return {reference:f.layout.checkpointTransition,nextBytes,oldBytes,directory,journalBytes,proofBytes,plan};
}
async function successorWithWindows(f, source, windowsVersion='1.0.1') {
  const options=await successorOptions(f,source),windows=signedWindowsFixture(f,source,options.manifestBytes,windowsVersion);
  options.pin=await f.api.readActivePin('synthetic-process-bearer',f.pair.trust,source,'fixture-org');return {options,windows};
}
for(const signedVersion of ['1.0.1','1.0.2'])test('checkpoint component version binds signed Windows '+signedVersion+' under successor 1.0.2',async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t,signedVersion);
  const transition=explicitCheckpointTransition(f,checkpoint,windows,applied);
  const {options}=await successorWithWindows(f,'b'.repeat(40),'1.0.2');
  assert.equal((await f.api.activatePublished(options)).status,'SIGNED_LOCAL_COMPONENT_APPLIED');
  assert.equal(JSON.parse(fs.readFileSync(checkpoint)).componentVersion,signedVersion);
  assert.deepEqual(fs.readFileSync(path.join(applied.attempt,'journal.json')),transition.journalBytes);
  assert.equal(f.pkg.endsWith(path.join('components','ia-master','1.0.1')),true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.pkg,'manifest.json'))).version,'1.1.0');
});
for(const signedVersion of ['1.0.1','1.0.2'])test('checkpoint component version mismatch rejects signed Windows '+signedVersion,async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t,signedVersion);
  const wrongVersion=signedVersion==='1.0.1'?'1.0.2':'1.0.1';
  const transition=explicitCheckpointTransition(f,checkpoint,windows,applied,1,null,wrongVersion);
  const {options}=await successorWithWindows(f,'b'.repeat(40),signedVersion),commands=[...f.commands];
  await assert.rejects(f.api.activatePublished(options),/CHECKPOINT_TRANSITION_BYTES_CONFLICT/);
  assert.deepEqual(f.commands,commands);assert.deepEqual(fs.readFileSync(checkpoint),transition.nextBytes);
});
test('signed A event B event C carries explicit checkpoint lineage without rewriting completed journals',async t=>{
  const {f,checkpoint,windows,applied:a}=await transitionBase(t);
  const first=explicitCheckpointTransition(f,checkpoint,windows,a);
  const sb=await successorWithWindows(f,'b'.repeat(40)),b=await f.api.activatePublished(sb.options);
  assert.deepEqual(fs.readFileSync(path.join(a.attempt,'journal.json')),first.journalBytes);
  const jb=JSON.parse(fs.readFileSync(path.join(b.attempt,'journal.json')));
  assert.deepEqual(jb.checkpointTransitionFromPrevious,first.reference);
  const second=explicitCheckpointTransition(f,checkpoint,sb.windows,b,2);
  const sc=await successorWithWindows(f,'c'.repeat(40)),c=await f.api.activatePublished(sc.options);
  assert.equal(c.status,'SIGNED_LOCAL_COMPONENT_APPLIED');assert.deepEqual(fs.readFileSync(checkpoint),second.nextBytes);
  assert.deepEqual(fs.readFileSync(path.join(b.attempt,'journal.json')),second.journalBytes);
  assert.equal(f.controls.authorityReads.length>2,true);
  for(const request of f.controls.authorityReads){assert.equal(request.hostname,'auroranexus.com.br');assert.equal(request.rejectUnauthorized,true);
    assert.match(request.path,/^\/api\/integration\/ping\?documentId=[a-f0-9]{48}&receiptId=[a-f0-9]{64}$/);assert.equal(request.headers.Cookie,undefined);}
  assert.equal(fs.readFileSync(path.join(f.state,'control.key'),'utf8'),'synthetic control identity');
  assert.equal(fs.readFileSync(path.join(f.state,'git-task-marker.txt'),'utf8'),'synthetic Git backlink retained C');
});
test('two explicit events on A form one bounded chain before B and remain verifiable on C',async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t);
  const first=explicitCheckpointTransition(f,checkpoint,windows,applied,1);
  const second=explicitCheckpointTransition(f,checkpoint,windows,applied,2,first.reference);
  const sb=await successorWithWindows(f,'b'.repeat(40));await f.api.activatePublished(sb.options);
  const sc=await successorWithWindows(f,'c'.repeat(40));await f.api.activatePublished(sc.options);
  assert.deepEqual(fs.readFileSync(checkpoint),second.nextBytes);
  assert.deepEqual(fs.readFileSync(path.join(applied.attempt,'journal.json')),first.journalBytes);
});
test('credential revalidation under signed B preserves anchor A and current receipt before applying B',async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t,'1.0.6');
  const old=explicitCheckpointTransition(f,checkpoint,windows,applied);
  const oldCheckpoint=fs.readFileSync(checkpoint),oldJournal=fs.readFileSync(path.join(applied.attempt,'journal.json'));
  const sb=await successorWithWindows(f,'b'.repeat(40),'1.0.7');
  const rebound=explicitCheckpointTransition(f,checkpoint,sb.windows,applied,1,old.reference);
  const proof=JSON.parse(rebound.proofBytes),newKey='ik_fedcba9876543210';
  proof.installationAcceptance.receiptId=h('integration-document:'+newKey+':'+rebound.plan.nextSampleKey);
  proof.installationAcceptance.configurationHash=h('new governed automation configuration');
  const next=JSON.parse(rebound.nextBytes);next.installationAcceptance=Object.fromEntries(Object.entries(proof.installationAcceptance).filter(([key])=>!['orgId','canonicalOrigin'].includes(key)));
  const encoded=value=>Buffer.from(real.canonical(value)+'\n'),nextBytes=encoded(next),proofBytes=encoded(proof);
  const commit=JSON.parse(fs.readFileSync(path.join(rebound.directory,'commit.json')));
  commit.nextSha256=h(nextBytes);commit.proofSha256=h(proofBytes);const commitBytes=encoded(commit);
  writeFiles(rebound.directory,{'checkpoint.next':nextBytes,'proof.json':proofBytes,'commit.json':commitBytes});
  fs.writeFileSync(checkpoint,nextBytes);f.layout.expectedCheckpointSha256=h(nextBytes);
  f.layout.checkpointTransition={directory:rebound.directory,commitSha256:h(commitBytes)};
  sb.options.layout=f.layout;
  f.controls.transitionAuthority.keyId=newKey;
  f.controls.transitionAuthority.installation.acceptance=proof.installationAcceptance;
  assert.equal((await f.api.activatePublished(sb.options)).status,'SIGNED_LOCAL_COMPONENT_APPLIED');
  assert.deepEqual(fs.readFileSync(path.join(applied.attempt,'journal.json')),oldJournal);
  assert.deepEqual(fs.readFileSync(path.join(rebound.directory,'checkpoint.previous')),oldCheckpoint);
  assert.deepEqual(fs.readFileSync(checkpoint),nextBytes);
  const oldProof=JSON.parse(old.proofBytes);
  for(const field of ['documentId','versionId','sourceVersion','canonicalSnapshotHash'])assert.equal(proof.processingProof[field],oldProof.processingProof[field]);
  assert.notEqual(proof.installationAcceptance.receiptId,oldProof.installationAcceptance.receiptId);
  for(const request of f.controls.authorityReads)assert.ok(request.path.endsWith('&receiptId='+proof.installationAcceptance.receiptId));
});
test('checkpoint authority is renewed after long native checks with original certificate and 30 second leases',async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t),transition=explicitCheckpointTransition(f,checkpoint,windows,applied);
  const {options}=await successorWithWindows(f,'b'.repeat(40)),original=options.pin;
  f.controls.nativeEvent=()=>{f.controls.now+=35000;};f.controls.managerEvent=()=>{f.controls.now+=35000;};
  assert.equal((await f.api.activatePublished(options)).status,'SIGNED_LOCAL_COMPONENT_APPLIED');
  assert.throws(()=>f.api.requireActive(original),/FRESH_CANONICAL/);
  assert.equal(f.controls.authorityReads.length>2,true);assert.deepEqual(fs.readFileSync(checkpoint),transition.nextBytes);
});
for(const mutation of ['missing-reference','backup','proof','plan','commit','authority','tuple','tuple-revision','automation','foreign-org','receipt-key','control','organization'])
test('checkpoint transition rejects '+mutation+' without stopping accepted A',async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t),transition=explicitCheckpointTransition(f,checkpoint,windows,applied);
  const {options}=await successorWithWindows(f,'b'.repeat(40));
  if(mutation==='missing-reference')delete options.layout.checkpointTransition;
  if(['backup','proof','plan','commit'].includes(mutation))fs.appendFileSync(path.join(transition.directory,
    {backup:'checkpoint.previous',proof:'proof.json',plan:'plan.json',commit:'commit.json'}[mutation]),' ');
  if(mutation==='authority')f.controls.authorityStatus=403;
  if(mutation==='tuple')f.controls.transitionAuthority.installation.acceptance.versionId='e'.repeat(48);
  if(mutation==='tuple-revision')f.controls.transitionAuthority.installation.revision++;
  if(mutation==='automation')f.controls.transitionAuthority.installation.acceptance.automationVerified=false;
  if(mutation==='foreign-org')f.controls.transitionAuthority.orgId='other-org';
  if(mutation==='receipt-key')f.controls.transitionAuthority.keyId='ik_ffffffffffffffff';
  if(mutation==='control')fs.writeFileSync(path.join(f.state,'control.key'),'synthetic legitimate changed identity');
  if(mutation==='organization')fs.writeFileSync(path.join(f.state,'organization.txt'),'different-org');
  const commands=[...f.commands];await assert.rejects(f.api.activatePublished(options));
  assert.deepEqual(f.commands,commands);assert.deepEqual(fs.readFileSync(checkpoint),transition.nextBytes);
  assert.deepEqual(fs.readFileSync(path.join(applied.attempt,'journal.json')),transition.journalBytes);
});
for(const window of ['after-stop','final-native'])test('checkpoint authority revoked '+window+' rolls runtime back while preserving new event',async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t),transition=explicitCheckpointTransition(f,checkpoint,windows,applied);
  const {options}=await successorWithWindows(f,'b'.repeat(40));let changed=false;
  if(window==='after-stop')f.controls.managerEvent=op=>{if(op==='stop'){changed=true;f.controls.transitionAuthority.installation.acceptance.automationVerified=false;}};
  else f.controls.nativeEvent=script=>{if(script.includes('currentOwnerAuthorized')&&f.commands.filter(op=>op==='start').length===2){
    changed=true;f.controls.transitionAuthority.installation.acceptance.automationVerified=false;}};
  await assert.rejects(f.api.activatePublished(options),/CURRENT_CHECKPOINT_AUTHORITY_REQUIRED/);
  assert.equal(changed,true);assert.deepEqual(fs.readFileSync(checkpoint),transition.nextBytes);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.pkg,'manifest.json'))).sourceRevision,NEXT);
  assert.deepEqual(fs.readFileSync(path.join(applied.attempt,'journal.json')),transition.journalBytes);
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),false);
});
test('checkpoint transition is rechecked after authenticated awaits and cannot extend pin TTL',async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t),transition=explicitCheckpointTransition(f,checkpoint,windows,applied);
  const {options}=await successorWithWindows(f,'b'.repeat(40));let mutated=false;
  f.controls.authorityEvent=()=>{f.controls.now+=35000;if(!mutated){mutated=true;fs.appendFileSync(path.join(transition.directory,'proof.json'),' ');}};
  const commands=[...f.commands];await assert.rejects(f.api.activatePublished(options));assert.equal(mutated,true);
  assert.deepEqual(f.commands,commands);assert.deepEqual(fs.readFileSync(checkpoint),transition.nextBytes);
});
test('fresh release pin cannot revive checkpoint authority expired during its TLS await',async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t),transition=explicitCheckpointTransition(f,checkpoint,windows,applied);
  const {options}=await successorWithWindows(f,'b'.repeat(40));let authorityRead=false;
  f.controls.authorityEvent=()=>{authorityRead=true;};
  f.controls.alterResponse=body=>{if(authorityRead){f.controls.now+=31000;body.observedAtUtc=new Date(f.controls.now).toISOString();}};
  const commands=[...f.commands];await assert.rejects(f.api.activatePublished(options),/CURRENT_CHECKPOINT_AUTHORITY_REQUIRED/);
  assert.equal(authorityRead,true);assert.deepEqual(f.commands,commands);assert.deepEqual(fs.readFileSync(checkpoint),transition.nextBytes);
});
for(const futureMs of [80,31000])test('checkpoint authority future skew is bounded, futureMs='+futureMs,async t=>{
  const {f,checkpoint,windows,applied}=await transitionBase(t),transition=explicitCheckpointTransition(f,checkpoint,windows,applied);
  const {options}=await successorWithWindows(f,'b'.repeat(40)),commands=[...f.commands];
  f.controls.authorityEvent=body=>{body.installation.acceptance.verifiedAt=new Date(f.controls.now+futureMs).toISOString();};
  if(futureMs<=30000)assert.equal((await f.api.activatePublished(options)).status,'SIGNED_LOCAL_COMPONENT_APPLIED');
  else {await assert.rejects(f.api.activatePublished(options),/CURRENT_CHECKPOINT_AUTHORITY_REQUIRED/);assert.deepEqual(f.commands,commands);}
  assert.deepEqual(fs.readFileSync(checkpoint),transition.nextBytes);
});
test('signed A to B to C preserves verified envelopes, completed lineage, current metadata CAS and identity',async t=>{
  const f=transactionFixture(t),a=await f.api.activatePublished(await f.options());
  const b=await f.api.activatePublished(await successorOptions(f,'b'.repeat(40)));
  const c=await f.api.activatePublished(await successorOptions(f,'c'.repeat(40)));
  assert.equal(c.status,'SIGNED_LOCAL_COMPONENT_APPLIED');
  const read=result=>JSON.parse(fs.readFileSync(path.join(result.attempt,'journal.json')));
  const ja=read(a),jb=read(b),jc=read(c);
  for(const journal of [ja,jb,jc]){
    assert.equal(journal.schemaVersion,'aurora.published.activation.v2');assert.equal(journal.phase,'COMPLETED');
    assert.equal(journal.trustedPublicKeySha256,f.pair.trust.publicKeySha256);
    const signed=f.api.verifyCandidate(journal.acceptedEnvelope,f.pair.trust,journal.sourceSha);
    assert.equal(signed.certificateSha256,journal.certificateSha256);
    assert.equal(JSON.stringify(journal).includes('synthetic-process-bearer'),false);
  }
  assert.equal(ja.previousRelease.kind,'REVIEWED_BOOTSTRAP');
  assert.equal(jb.previousRelease.sourceSha,NEXT);assert.equal(jc.previousRelease.sourceSha,'b'.repeat(40));
  assert.equal(jb.previousRelease.journalSha256,h(fs.readFileSync(path.join(a.attempt,'journal.json'))));
  assert.equal(jc.previousRelease.journalSha256,h(fs.readFileSync(path.join(b.attempt,'journal.json'))));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.state,'installation.json'))).previousSourceRevision,'b'.repeat(40));
  assert.deepEqual(f.commands,['stop','start','stop','start','stop','start']);f.assertIdentity();
});
for(const failure of ['start','revoked-after-start'])test('successor '+failure+' rolls back to signed B instead of bootstrap',async t=>{
  const f=transactionFixture(t);await f.api.activatePublished(await f.options());
  const b=await f.api.activatePublished(await successorOptions(f,'b'.repeat(40)));
  const bMetadata=fs.readFileSync(path.join(f.state,'installation.json')),bManifest=fs.readFileSync(path.join(f.pkg,'manifest.json'));
  const options=await successorOptions(f,'c'.repeat(40));
  if(failure==='start')f.controls.failStartOnce=true;
  else f.controls.localEvent=port=>{if(port===38765&&JSON.parse(fs.readFileSync(path.join(f.pkg,'manifest.json'))).sourceRevision==='c'.repeat(40)){
    f.controls.now+=35000;f.controls.canonicalStatus=403;
  }};
  await assert.rejects(f.api.activatePublished(options),failure==='start'?/OWNED_MANAGER_OPERATION_FAILED/:/CANONICAL_RELEASE_READ_REJECTED/);
  assert.deepEqual(fs.readFileSync(path.join(f.pkg,'manifest.json')),bManifest);
  assert.deepEqual(fs.readFileSync(path.join(f.state,'installation.json')),bMetadata);f.assertIdentity();
  const attempts=fs.readdirSync(path.join(f.root,'installation-rollbacks')).map(name=>path.join(f.root,'installation-rollbacks',name));
  const failed=attempts.find(dir=>JSON.parse(fs.readFileSync(path.join(dir,'journal.json'))).sourceSha==='c'.repeat(40));
  const recovered=await f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:failed,trust:f.pair.trust});
  assert.equal(recovered.alreadyRecovered,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(b.attempt,'journal.json'))).phase,'COMPLETED');
});
for(const mutation of ['unsigned-history','signature','fingerprint','prior-journal','metadata','package'])
test('signed successor rejects '+mutation+' before stopping the current accepted release',async t=>{
  const f=transactionFixture(t),a=await f.api.activatePublished(await f.options());
  const options=await successorOptions(f,'b'.repeat(40)),journalPath=path.join(a.attempt,'journal.json');
  const journal=JSON.parse(fs.readFileSync(journalPath));
  if(mutation==='unsigned-history'){journal.schemaVersion='aurora.published.activation.v1';delete journal.acceptedEnvelope;}
  if(mutation==='signature')journal.acceptedEnvelope.signature='A'.repeat(86);
  if(mutation==='fingerprint')journal.trustedPublicKeySha256='0'.repeat(64);
  if(mutation==='prior-journal')journal.previousRelease.sourceSha='d'.repeat(40);
  if(['unsigned-history','signature','fingerprint','prior-journal'].includes(mutation))fs.writeFileSync(journalPath,encode(journal));
  if(mutation==='metadata')fs.appendFileSync(path.join(f.state,'installation.json'),' ');
  if(mutation==='package')fs.writeFileSync(path.join(f.pkg,'server.cjs'),'synthetic legitimate concurrent change');
  const commands=[...f.commands];await assert.rejects(f.api.activatePublished(options));
  assert.deepEqual(f.commands,commands);assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),false);f.assertIdentity();
});
test('an ancestor journal changed after B acceptance cannot seed C',async t=>{
  const f=transactionFixture(t),a=await f.api.activatePublished(await f.options());
  await f.api.activatePublished(await successorOptions(f,'b'.repeat(40)));
  const options=await successorOptions(f,'c'.repeat(40));
  fs.appendFileSync(path.join(a.attempt,'journal.json'),' ');
  const commands=[...f.commands];await assert.rejects(f.api.activatePublished(options),/SIGNED_LINEAGE_RECORD_CHANGED/);
  assert.deepEqual(f.commands,commands);f.assertIdentity();
});
test('interrupted successor recovery requires public trust and restores the signed predecessor',async t=>{
  const f=transactionFixture(t);await f.api.activatePublished(await f.options());
  await f.api.activatePublished(await successorOptions(f,'b'.repeat(40)));
  const metadata=fs.readFileSync(path.join(f.state,'installation.json')),manifest=fs.readFileSync(path.join(f.pkg,'manifest.json'));
  const options=await successorOptions(f,'c'.repeat(40));let failing=true,attempt;
  f.controls.fault=(when,a,b)=>{
    if(failing&&when==='after-rename'&&String(a).endsWith(path.join(options.stageDirectory,'package')))throw Error('SYNTHETIC_CANDIDATE_INTERRUPTION');
    if(failing&&when==='after-rename'&&b===f.pkg&&String(a).endsWith('component.previous')){
      attempt=path.dirname(a);throw Error('SYNTHETIC_RESTORE_INTERRUPTION');
    }
  };
  await assert.rejects(f.api.activatePublished(options),/ROLLBACK_INCOMPLETE/);assert.ok(attempt);
  const commands=[...f.commands];
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt}),/SIGNED_LINEAGE_JOURNAL_REQUIRED/);
  assert.deepEqual(f.commands,commands);failing=false;
  assert.equal((await f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt,trust:f.pair.trust})).status,'ROLLED_BACK_LOCAL_PREVIOUS');
  assert.deepEqual(fs.readFileSync(path.join(f.state,'installation.json')),metadata);
  assert.deepEqual(fs.readFileSync(path.join(f.pkg,'manifest.json')),manifest);f.assertIdentity();
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),false);
});
test('legacy rollback recovery stays bootstrap-only and does not retrofit a signed history',async t=>{
  const f=transactionFixture(t);f.controls.failStartOnce=true;
  await assert.rejects(f.api.activatePublished(await f.options()),/OWNED_MANAGER_OPERATION_FAILED/);
  const attempt=attemptOf(f),journalPath=path.join(attempt,'journal.json'),journal=JSON.parse(fs.readFileSync(journalPath));
  journal.schemaVersion='aurora.published.activation.v1';delete journal.acceptedEnvelope;delete journal.trustedPublicKeySha256;delete journal.previousRelease;
  fs.writeFileSync(journalPath,encode(journal));
  assert.equal((await f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt})).alreadyRecovered,true);
  assert.equal(JSON.parse(fs.readFileSync(journalPath)).schemaVersion,'aurora.published.activation.v1');
  assert.equal(h(fs.readFileSync(path.join(f.pkg,'manifest.json'))),h(f.baseline.bytes));f.assertIdentity();
});

for(const window of ['before-stop','before-first-move','before-candidate-move','before-metadata','before-start'])
test('TLS renewal rechecks local CAS '+window+' and never starts or overwrites a foreign writer',async t=>{
  const f=transactionFixture(t);let prepared=false,changed=false;
  f.controls.fault=(when,a,b)=>{if(when==='before-write'&&String(a).includes('journal.json.')&&String(b).includes('"phase":"PREPARED"'))prepared=true;};
  f.controls.alterResponse=()=>{
    const stopped=f.commands.at(-1)==='stop',present=fs.existsSync(f.pkg);
    const source=present?JSON.parse(fs.readFileSync(path.join(f.pkg,'manifest.json'))).sourceRevision:null;
    const metadata=JSON.parse(fs.readFileSync(path.join(f.state,'installation.json')));
    const hit=window==='before-stop'?prepared&&f.commands.length===0:
      window==='before-first-move'?stopped&&source===OLD:
      window==='before-candidate-move'?stopped&&!present:
      window==='before-metadata'?stopped&&source===NEXT&&metadata.sourceRevision===OLD:
      stopped&&source===NEXT&&metadata.sourceRevision===NEXT;
    if(!hit||changed)return;changed=true;fs.mkdirSync(f.pkg,{recursive:true});
    fs.writeFileSync(path.join(f.pkg,'concurrent.txt'),'synthetic legitimate writer during '+window);
  };
  await assert.rejects(f.api.activatePublished(await f.options()),window==='before-stop'?/INSTALLED_BASELINE_CHANGED/:/ROLLBACK_INCOMPLETE/);
  assert.equal(changed,true);assert.equal(fs.readFileSync(path.join(f.pkg,'concurrent.txt'),'utf8'),'synthetic legitimate writer during '+window);
  assert.deepEqual(f.commands,window==='before-stop'?[]:['stop']);
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),window!=='before-stop');f.assertIdentity();
});

for(const repeat of [false,true])test('final canonical renewal cannot hide a concurrent package writer, repeat='+repeat,async t=>{
  const f=transactionFixture(t);if(repeat)await f.api.activatePublished(await f.options());
  let ready=false,changed=false,owners=0;
  f.controls.nativeEvent=script=>{if(script.includes('currentOwnerAuthorized')){
    owners++;if(repeat?owners>=3:f.commands.includes('start'))ready=true;
  }};
  f.controls.alterResponse=()=>{if(ready&&!changed){changed=true;fs.writeFileSync(path.join(f.pkg,'concurrent.txt'),'synthetic concurrent final writer');}};
  const commands=[...f.commands];await assert.rejects(f.api.activatePublished(await f.options()),
    repeat?/PRIOR_SIGNED_APPLICATION_CHANGED/:/LOCAL_APPLICATION_ROLLBACK_INCOMPLETE/);
  assert.equal(changed,true);assert.equal(fs.readFileSync(path.join(f.pkg,'concurrent.txt'),'utf8'),'synthetic concurrent final writer');
  if(repeat)assert.deepEqual(f.commands,commands);
  assert.equal(fs.existsSync(path.join(f.root,'published-update.lock')),!repeat);f.assertIdentity();
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
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt,trust:f.pair.trust}),/RECOVERY_METADATA_CHANGED/);
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
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt,trust:f.pair.trust}),/RECOVERY_METADATA_CHANGED/);
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
  await assert.rejects(f.api.recoverPublished({mode:'recover',layout:f.layout,attemptDirectory:attempt,trust:f.pair.trust}),/RECOVERY_METADATA_CHANGED/);
  assert.equal(fs.readFileSync(installation).length,0);assert.deepEqual(f.commands,commands);f.assertIdentity();
});
