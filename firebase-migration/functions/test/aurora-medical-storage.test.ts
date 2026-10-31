import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { persistMedicalAttachment } from '../src/auroraMedicalPartnerRuntime.ts';
import { validateMedicalAttachment } from '../src/auroraMedicalPartnerPolicy.ts';

const bytes=Buffer.from('%PDF-1.7\nSynthetic destination only\n%%EOF');
const attachment=validateMedicalAttachment({kind:'CRM_CERTIFICATE',mimeType:'application/pdf',base64:bytes.toString('base64')});
function fixture() {
  let saveError=false, readError=false, stored=bytes, meta:any={generation:'123456789',size:String(bytes.length),contentType:'application/pdf',metadata:{sha256:attachment.sha256}};
  const calls:any[]=[];
  const bucket:any={file:(key:string,options?:any)=>{
    calls.push({key,options});
    return {save:async(data:Buffer,opts:any)=>{calls.push({save:opts});assert.deepEqual(data,bytes);if(saveError)throw Error('UNKNOWN_UPLOAD_OUTCOME');},
      getMetadata:async()=>[meta],createReadStream:(opts:any)=>{
        assert.equal(options.generation,'123456789');assert.equal(opts.end,bytes.length);assert.equal(opts.decompress,false);
        return readError?Readable.from((async function*(){throw Error('GENERATION_REMOVED');})()):Readable.from([stored]);
      }};
  }};
  return {bucket,calls,set:(changes:any)=>{if('saveError'in changes)saveError=changes.saveError;if('readError'in changes)readError=changes.readError;
    if('stored'in changes)stored=changes.stored;if('meta'in changes)meta=changes.meta;}};
}
test('native create-only write verifies exact stored generation even after a lost response',async()=>{
  for(const saveError of [false,true]){
    const f=fixture();f.set({saveError});
    assert.deepEqual(await persistMedicalAttachment(f.bucket,'synthetic-object',attachment),{generation:'123456789'});
    assert.deepEqual(f.calls.find(x=>x.save).save.preconditionOpts,{ifGenerationMatch:0});
    assert.deepEqual(f.calls.filter(x=>x.options).map(x=>x.options),[{generation:'123456789'}]);
  }
});
test('matching metadata cannot certify different, truncated or oversized bytes',async()=>{
  for(const stored of [Buffer.alloc(bytes.length,65),bytes.subarray(1),Buffer.concat([bytes,Buffer.from('x')])]){
    const f=fixture();f.set({saveError:true,stored});
    await assert.rejects(persistMedicalAttachment(f.bucket,'synthetic-object',attachment),/PRIVATE_STORAGE_CONFLICT/);
  }
});
test('missing metadata and invalid or imprecise generation cannot become a receipt',async()=>{
  for(const meta of [null,{}, {generation:'9007199254740993',size:bytes.length,contentType:'application/pdf'},
    {generation:'1',size:bytes.length,contentType:'application/pdf',contentEncoding:'gzip'}]){
    const f=fixture();f.set({meta});await assert.rejects(persistMedicalAttachment(f.bucket,'synthetic-object',attachment),/PRIVATE_STORAGE_(CONFLICT|UPLOAD_UNVERIFIED)/);
    assert.equal(f.calls.filter(x=>x.options).length,0);
  }
});
test('a disappeared generation is pending instead of falling back to the current object',async()=>{
  const f=fixture();f.set({readError:true});
  await assert.rejects(persistMedicalAttachment(f.bucket,'synthetic-object',attachment),/PRIVATE_STORAGE_READBACK_UNAVAILABLE/);
  assert.equal(f.calls.filter(x=>x.options).length,1);
});
