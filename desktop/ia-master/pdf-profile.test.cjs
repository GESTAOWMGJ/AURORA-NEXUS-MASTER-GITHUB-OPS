'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const api=require('./published-update.cjs');
const base=['client_agent.py','provider_connectors.py','client_secret_store.py','install_client_agent.py','aurora_cloud_sync.py','aurora_deployment.py','published_release.py'];
const intake=['document_intake.py','document_intake.cjs','document_intake_core.cjs','document_fact_mapping.cjs','document-intake-manifest.json'];
const pdf=['document_pdf_runtime.mjs','document_pdf_node.cjs','document_pdf_pins.cjs','document_pdf_api.mjs','document_pdf_worker.mjs','document_pdf_data.bin','document_pdf_LICENSE.txt','document_pdf_vendor.json'];
const fixed=new Set(['document_pdf_worker.mjs','document_pdf_data.bin']);
function cleanup(directory){
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('aurora-pdf-profile-'));
  fs.rmSync(directory,{recursive:true,force:true});
}
function signed(directory,version,names,changed,component='windowsIntegration'){
  const pair=crypto.generateKeyPairSync('ed25519'),source='a'.repeat(40);
  const trust={publicKeySpkiPem:pair.publicKey.export({type:'spki',format:'pem'}).toString(),publicKeySha256:api.digest(pair.publicKey.export({type:'spki',format:'der'}))};
  fs.mkdirSync(directory,{recursive:true});const files={};
  for(const name of names){const bytes=changed?.name===name?changed.bytes:fixed.has(path.posix.basename(name))?fs.readFileSync(path.join(__dirname,'../../aurora-coletor',path.posix.basename(name))):Buffer.from('synthetic closed public profile');
    fs.mkdirSync(path.dirname(path.join(directory,name)),{recursive:true});fs.writeFileSync(path.join(directory,name),bytes);files[name]=api.digest(bytes);}
  const raw=Buffer.from(JSON.stringify({component:component==='iaMaster'?'AURORA_IA_MASTER':'AURORA_WINDOWS_INTEGRATION',version:component==='iaMaster'?'1.1.0':version,...(component==='iaMaster'?{sourceRevision:source,dirty:false,nodeMinimumMajor:22,externalAiEnabled:false,clientAgent:{component:'AURORA_CLIENT_AGENT',version,configured:false,sourceAuthorizationRequired:true,providerConnectionsVerified:false}}:{sourceSha:source}),files}));fs.writeFileSync(path.join(directory,'manifest.json'),raw);
  const certificate={schemaVersion:2,sourceSha:source,productVersion:'1.1.0-beta.2',canonicalOrigin:api.ORIGIN,releaseRunId:'13',ciRunId:'12',
    publishedAtUtc:'2026-10-23T01:00:00.000Z',status:'ACTIVE',checks:{ciPassed:true,humanReviewApproved:true,protectedDeploySucceeded:true,smokePassed:true},
    components:Object.fromEntries(api.COMPONENTS.map(name=>[name,{version:name==='windowsIntegration'?(component==='iaMaster'?'1.0.9':version):'1.1.0',sourceSha:source,manifestSha256:name===component?api.digest(raw):'c'.repeat(64)}]))};
  const candidate=api.verifyCandidate({certificate,signature:crypto.sign(null,api.signingBytes(certificate),pair.privateKey).toString('base64url')},trust,source);
  return ()=>api.inspectPackage(candidate,component,directory,raw);
}
test('authenticated 1.0.7,1.0.8,1.0.9 select seven,twelve,twenty files independently',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-pdf-profile-'));t.after(()=>cleanup(temp));
  for(const [version,names]of [['1.0.7',base],['1.0.8',[...base,...intake]],['1.0.9',[...base,...intake,...pdf]]]){
    const read=signed(path.join(temp,version),version,names);assert.equal(read().version,version);
  }
  assert.throws(signed(path.join(temp,'wrong-version'),'1.0.8',[...base,...intake,...pdf]),/PACKAGE_CLOSURE_CONFLICT/);
});
test('resigned wrong fixed worker hash, prefix alone and missing PDF asset cannot pass the new closure',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-pdf-profile-'));t.after(()=>cleanup(temp));
  assert.throws(signed(path.join(temp,'short'),'1.0.9',[...base,...intake,...pdf],{name:'document_pdf_worker.mjs',bytes:Buffer.from('not official')}),/PDF_TRUSTED_PROFILE_PIN_CONFLICT/);
  assert.throws(signed(path.join(temp,'large'),'1.0.9',[...base,...intake,...pdf],{name:'document_pdf_worker.mjs',bytes:Buffer.alloc(1048577)}),/PACKAGE_FILE_BYTES_CONFLICT/);
  assert.throws(signed(path.join(temp,'missing'),'1.0.9',[...base,...intake,...pdf.slice(1)]),/PACKAGE_CLOSURE_CONFLICT/);
});

test('IA 34/39/47 selects exact signed agent version and fixed PDF closure independently',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-pdf-profile-'));t.after(()=>cleanup(temp));
  const shared=['README.md','app.css','app.js','index.html','knowledge-registry.cjs','manage.cjs','modus-operandi.md','published-update.cjs',
    'publisher.cjs','safe-read.cjs','server.cjs','studio-local.css','studio-local.js','studio.cjs','update.cjs',
    ...['source-serif-4-regular.woff2','source-serif-4-semibold.woff2','atkinson-hyperlegible-next.woff2','Source-Serif-OFL.txt','Atkinson-Hyperlegible-Next-OFL.txt','provenance.json'].map(name=>'assets/fonts/'+name),
    ...['auroraMasterEngine','auroraNativeIntelligence','auroraNativeRoutines','auroraIaMaster','auroraProductionOrchestrator','auroraDataGovernance'].map(name=>'kernel/'+name+'.js')];
  const names=extra=>[...shared,...[...base,...extra].map(name=>'client-agent/'+name)];
  for(const [version,extra,count]of [['1.0.2',[],34],['1.0.4',[],34],['1.0.5',intake,39],['1.0.6',[...intake,...pdf],47]])
    assert.equal(Object.keys(signed(path.join(temp,version),version,names(extra),null,'iaMaster')().files).length,count+1);
  assert.throws(signed(path.join(temp,'wrong-agent'),'1.0.5',names([...intake,...pdf]),null,'iaMaster'),/PACKAGE_CLOSURE_CONFLICT/);
  assert.throws(signed(path.join(temp,'wrong-pdf'),'1.0.6',names([...intake,...pdf]),{name:'client-agent/document_pdf_worker.mjs',bytes:Buffer.from('wrong fixed worker')},'iaMaster'),/PDF_TRUSTED_PROFILE_PIN_CONFLICT/);
});
