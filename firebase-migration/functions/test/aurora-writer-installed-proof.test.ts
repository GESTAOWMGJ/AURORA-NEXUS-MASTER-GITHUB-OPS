import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyInstalledWriterObservation,sessionFromCookieJar} from '../../scripts/verify-installed-writer-guardian.mjs';

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
