import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const beta=path.join(root,'desktop/beta');
const release=JSON.parse(fs.readFileSync(path.join(beta,'release.json'),'utf8'));
const workflow=fs.readFileSync(path.join(root,'.github/workflows/aurora-rc11-post-ingest-finalize.yml'),'utf8');
test('single product with explicit beta and immutable base',()=>{
 assert.equal(release.product,'AURORA NEXUS'); assert.equal(release.channel,'HOMOLOGATION_BETA');
 assert.match(release.sourceCommit,/^[a-f0-9]{40}$/); assert.equal(release.productionApproved,false);
 assert.equal(release.portalUrl,'https://wmgj-hml-jfn-20260927.web.app/');
});
test('Windows client is not falsely described as native/PWA or physical replica',()=>{
 assert.equal(release.platforms.windows.nativeBinary,false);
 assert.equal(release.localBootstrapStore,'INFRASTRUCTURE_ONLY_NOT_A_REPLICA');
 assert.equal(release.authenticatedCloudSync,'NOT_VERIFIED');
});
test('Mac baseline is preserved and iOS native build not claimed',()=>{
 assert.equal(release.platforms.macos.delivery,'EXISTING_APP_PRESERVED');
 assert.equal(release.platforms.ios.nativeBinary,false); assert.equal(release.platforms.ios.deviceTested,false);
});
test('all installer payload hashes match',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(beta,'SHA256SUMS.json'),'utf8'));
 assert.equal(manifest.files.length,4); assert.equal(new Set(manifest.files.map(f=>f.path)).size,4);
 for(const f of manifest.files){assert.equal(createHash('sha256').update(fs.readFileSync(path.join(beta,f.path))).digest('hex'),f.sha256);}
});
test('post-ingest repair uses full closure then publishes Hosting',()=>{
 const deploy=workflow.indexOf('--only "$targets"');
 const check=workflow.indexOf('node "$checker" check',deploy);
 const hosting=workflow.indexOf('--only hosting',deploy);
 assert.ok(deploy>0 && check>deploy && hosting>check);
 assert.ok(!workflow.includes('--only functions:auroraNexusSessionLogin,functions:auroraNexusNativeInsight,hosting'));
});
test('final evidence derives gates from actual steps, not hardcoded success',()=>{
 assert.ok(workflow.includes('RECONCILE_OUTCOME: ${{ steps.reconcile.outcome }}'));
 assert.ok(workflow.includes('realWmgjSample:($rec=="success")'));
 assert.ok(workflow.includes('ingestedByThisWorkflow:false'));
 assert.ok(!workflow.includes('reconciled:true'));
});
test('integration probe checks actual bearer-key denial contract',()=>{
 assert.ok(workflow.includes('.code=="INVALID_INTEGRATION_KEY"'));
 assert.ok(fs.readFileSync(path.join(beta,'Client.ps1'),'utf8').includes("@('/api/integration/ping',401,'INVALID_INTEGRATION_KEY')"));
});
test('protected environment, source guards and kill switch retained',()=>{
 assert.ok(workflow.includes('environment: firebase-homologation'));
 assert.ok(workflow.includes('git rev-parse refs/remotes/origin/main'));
 assert.ok(workflow.includes('auroraRc11KillSwitch'));
 assert.ok(workflow.includes('clinicalSensitiveEnabled==false'));
});
