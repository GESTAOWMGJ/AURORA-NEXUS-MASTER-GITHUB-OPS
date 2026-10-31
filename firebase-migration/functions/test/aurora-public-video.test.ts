import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {publicVideoResponse,PUBLIC_VIDEO_PATH} from '../src/auroraPublicVideo.ts';
const bytes=readFileSync(new URL('../../hosting/aurora-nexus'+PUBLIC_VIDEO_PATH,import.meta.url));
test('full public video and HEAD preserve exact reviewed bytes and metadata',()=>{
  const full=publicVideoResponse('GET',PUBLIC_VIDEO_PATH)!;
  assert.equal(full.status,200);assert.deepEqual(full.body,bytes);
  assert.equal(full.headers['Content-Length'],String(bytes.length));
  const head=publicVideoResponse('HEAD',PUBLIC_VIDEO_PATH,'bytes=0-31')!;
  assert.equal(head.status,200);assert.equal(head.body.length,0);
  assert.equal(head.headers['Content-Length'],String(bytes.length));
});
test('video ranges return real 206 byte slices, including open and suffix ranges',()=>{
  for(const [range,start,end] of [['bytes=0-31',0,31],['bytes=32-',32,bytes.length-1],['bytes=-32',bytes.length-32,bytes.length-1],['bytes=64000-999999',64000,bytes.length-1]] as const){
    const result=publicVideoResponse('GET',PUBLIC_VIDEO_PATH,range)!;
    assert.equal(result.status,206);assert.deepEqual(result.body,bytes.subarray(start,end+1));
    assert.equal(result.headers['Content-Range'],`bytes ${start}-${end}/${bytes.length}`);
    assert.equal(result.headers['Content-Length'],String(end-start+1));
  }
});
test('malformed, multipart, oversized and unsatisfiable intervals fail closed',()=>{
  for(const range of ['bytes=','bytes=-','bytes=-0','bytes=4-3','bytes=64299-','bytes=0-1,3-4','bytes=9007199254740992-','items=0-1','bytes=__proto__-1']){
    const result=publicVideoResponse('GET',PUBLIC_VIDEO_PATH,range)!;
    assert.equal(result.status,416,range);assert.equal(result.body.length,0);
    assert.equal(result.headers['Content-Range'],`bytes */${bytes.length}`);
  }
});
test('If-Range is bound to current content and no arbitrary public path is exposed',()=>{
  const full=publicVideoResponse('GET',PUBLIC_VIDEO_PATH)!;
  assert.equal(publicVideoResponse('GET',PUBLIC_VIDEO_PATH,'bytes=0-31',full.headers.ETag)!.status,206);
  assert.equal(publicVideoResponse('GET',PUBLIC_VIDEO_PATH,'bytes=0-31','"old"')!.status,200);
  for(const path of ['/wmgj/medicos/gestao','/downloads','/api/master','/arquivos/wmgj/../secret',PUBLIC_VIDEO_PATH+'/x'])assert.equal(publicVideoResponse('GET',path),null);
  assert.equal(publicVideoResponse('POST',PUBLIC_VIDEO_PATH)!.status,405);
});
test('exact video rewrite defeats static precedence while preserving private routes and smoke assertion',()=>{
  for(const file of ['firebase.json','firebase.production.json']){
    const config=JSON.parse(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
    assert.ok(config.hosting.ignore.includes(PUBLIC_VIDEO_PATH.slice(1)));
    assert.equal(config.hosting.rewrites[0].source,PUBLIC_VIDEO_PATH);
    assert.equal(config.hosting.rewrites[0].function.functionId,'auroraNexusAuthGate');
    assert.ok(config.hosting.rewrites.some((r:any)=>r.source==='**'&&r.function.functionId==='auroraNexusAuthGate'));
  }
  const gate=readFileSync(new URL('../src/auroraAuthGate.ts',import.meta.url),'utf8');
  assert.ok(gate.indexOf('const publicVideo=')<gate.indexOf('const decoded = await verifySession'));
  const smoke=readFileSync(new URL('../../scripts/verify-credmed-public-release.mjs',import.meta.url),'utf8');
  assert.match(smoke,/assert.equal\(partial.code,206/);
});
