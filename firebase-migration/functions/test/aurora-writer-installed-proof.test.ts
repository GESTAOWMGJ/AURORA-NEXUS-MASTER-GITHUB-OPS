import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {verifyInstalledWriterObservation,sessionFromCookieJar,requireVerifiedInstalledCommit,safeRefreshErrorCode} from '../../scripts/verify-installed-writer-guardian.mjs';

function fixture() {
  const sourceSha='a'.repeat(40),manifestBytes=Buffer.from(JSON.stringify({sourceSha,files:{
    'lib/realtimePlatformGuardian.js':'b'.repeat(64),'lib/auroraWriterGuardian.js':'c'.repeat(64)}}));
  const fields=(data:any)=>Object.fromEntries(Object.entries(data).map(([key,value])=>[key,
    typeof value==='number'?{integerValue:String(value)}:{stringValue:value}]));
  return {sourceSha,manifestBytes,httpStatus:200,
    bootstrap:{ok:true,environment:'HOMOLOGATION',organization:{id:'wmgj'},
      canonicalVersion:{runtimeBuild:{sourceSha,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex')}},
      release:{writerGuardian:{routineId:'AURORA-REALTIME-PLATFORM-GUARDIAN-001',version:'1.1.0',migratedTransactionBoundaries:31,allLegacyWritersEnforced:false}}},
    before:{fields:fields({epoch:4})},
    after:{updateTime:'2026-10-31T12:00:00.000000Z',fields:fields({epoch:5,guardianId:'AURORA-REALTIME-PLATFORM-GUARDIAN-001',
      orgId:'wmgj',resourceKey:'canonical-data',holder:'CLOUD_CONTROL_PLANE',state:'RELEASED'})},
    projection:{updateTime:'2026-10-31T12:00:00.000000Z',fields:fields({snapshotId:'synthetic-snapshot',sourceHash:'d'.repeat(64)})}};
}
test('installed proof joins lease and projection by exact provider commit timestamp',()=>{
  const result=verifyInstalledWriterObservation(fixture());
  assert.equal(result.status,'INSTALLED_COMMIT_VERIFIED');assert.equal(result.canonicalCommitVerified,true);
  assert.equal(result.physicalHandoffVerified,false);assert.equal(result.allLegacyWritersEnforced,false);
  assert.equal(JSON.stringify(result).includes('synthetic-snapshot'),false);
});
test('HTTP success, stale epoch, unrelated commit and unknown HTTP outcome cannot prove guarded execution',()=>{
  for(const change of ['missing','epoch','timestamp','timeout','denied']){
    const f:any=fixture();
    if(change==='missing')f.after=null;
    if(change==='epoch')f.after.fields.epoch.integerValue='4';
    if(change==='timestamp')f.projection.updateTime='2026-10-31T11:59:00.000000Z';
    if(change==='timeout')f.httpStatus=null;
    if(change==='denied')f.httpStatus=503;
    const result=verifyInstalledWriterObservation(f);assert.equal(result.status,'PENDING_EFFECT_PROOF');
    assert.equal(result.installedCodeVerified,true);assert.equal(result.canonicalCommitVerified,false);
  }
});
test('source SHA, manifest and declared coverage must match before any live probe',()=>{
  for(const change of ['sha','manifest','policy','scope','coverage']){
    const f:any=fixture();
    if(change==='sha')f.sourceSha='e'.repeat(40);
    if(change==='manifest')f.manifestBytes=Buffer.from('{}');
    if(change==='policy')f.bootstrap.release.writerGuardian.allLegacyWritersEnforced=true;
    if(change==='coverage')f.bootstrap.release.writerGuardian.migratedTransactionBoundaries=19;
    if(change==='scope')f.bootstrap.organization.id='other';
    assert.throws(()=>verifyInstalledWriterObservation(f),/WRITER_INSTALLED_/);
  }
});
test('cookie jar must contain one secure session for the exact canonical host',()=>{
  const row='#HttpOnly_auroranexus.com.br\tFALSE\t/\tTRUE\t9999999999\t__session\tsynthetic.jwt';
  assert.equal(sessionFromCookieJar(row),'__session=synthetic.jwt');
  for(const value of [row+'\n'+row,row.replace('auroranexus.com.br','foreign.example'),row.replace('\tTRUE\t','\tFALSE\t')])
    assert.throws(()=>sessionFromCookieJar(value),/WRITER_SMOKE_SESSION_REQUIRED/);
});

// Multiple upload paths use their least common ancestor as the archive root.
// Preserve the publisher's established download layout when adding evidence.
test('installed evidence shares the release artifact root expected by the publisher',()=>{
  const workflow=readFileSync(new URL('../../../.github/workflows/deploy-aurora-firebase.yml',import.meta.url),'utf8');
  const upload=workflow.split('      - name: Preserve exact release manifests\n')[1].split('      - name: ')[0];
  const paths=[...upload.matchAll(/^            (.+)$/gm)].map(match=>match[1].trim());
  const root=resolve('firebase-migration/functions/runtime-release');
  assert.ok(paths.length>=6);
  for(const path of paths)assert.ok(resolve(path).startsWith(root+sep),path);
  const output=/--output ([^\s]+aurora-writer-installed-proof.json)/.exec(workflow)?.[1];
  assert.ok(output);assert.equal(dirname(resolve(output)),root);assert.ok(paths.includes(output));
  assert.match(workflow,/path: firebase-migration\/functions\/runtime-release/);
});


test('publication probe fails closed after retaining denied or incomplete evidence',()=>{
  const valid=verifyInstalledWriterObservation(fixture());
  assert.doesNotThrow(()=>requireVerifiedInstalledCommit(valid));
  for(const status of [403,503,null]){
    const f:any=fixture();f.httpStatus=status;
    const proof=verifyInstalledWriterObservation(f);
    assert.equal(proof.canonicalCommitVerified,false);
    assert.throws(()=>requireVerifiedInstalledCommit(proof),/WRITER_INSTALLED_EFFECT_NOT_VERIFIED/);
  }
  for(const change of [{canonicalCommitVerified:false},{installedCodeVerified:false},{leaseAndProjectionSameCommit:false}])
    assert.throws(()=>requireVerifiedInstalledCommit({...valid,...change}),/WRITER_INSTALLED_EFFECT_NOT_VERIFIED/);
});

test('refresh diagnostics expose only known non-sensitive error codes',()=>{
  for(const code of ['PERMISSION_DENIED','CSRF_REJECTED','CROSS_SITE_REJECTED'])
    assert.equal(safeRefreshErrorCode({code,token:'never-log'}),code);
  for(const body of [null,{},'secret',{code:'secret-token'},{code:{token:'secret'}}])
    assert.equal(safeRefreshErrorCode(body),null);
});
