import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHeadLength, verifyVideoRangeResponse } from "../../scripts/credmed-http-transport-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../hosting/aurora-nexus/arquivos/wmgj");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const item = manifest.videoAssets[0];
const bytes = readFileSync(resolve(root, item.name));
const complete = {bytes};

test("CREDMED: HEAD accepts absent Content-Length, rejects lies and nonempty bodies", () => {
  const empty=Buffer.alloc(0);
  assert.equal(verifyHeadLength({headers:{"transfer-encoding":"chunked"},bytes:empty}, item),
    "HEAD_LENGTH_UNSPECIFIED_GET_HASH_REQUIRED");
  assert.equal(verifyHeadLength({headers:{"content-length":String(item.bytes)},bytes:empty}, item),
    "HEAD_CONTENT_LENGTH_MATCH");
  assert.throws(()=>verifyHeadLength({headers:{"content-length":"0"},bytes:empty}, item), /HEAD_CONTENT_LENGTH_MISMATCH/);
  assert.throws(()=>verifyHeadLength({headers:{"content-length":"1e4"},bytes:empty}, item), /HEAD_CONTENT_LENGTH_INVALID/);
  assert.throws(()=>verifyHeadLength({headers:{},bytes:Buffer.from("x")}, item), /HEAD_MUST_NOT_RETURN_BODY/);
});

test("CREDMED: MP4 Range 200 accepts only complete, original SHA-256 verified bytes", () => {
  const headers={"content-type":"video/mp4","content-disposition":"attachment"};
  const response={code:200,headers,bytes};
  assert.equal(verifyVideoRangeResponse(response,complete,item),"MP4_RANGE_FALLBACK_200_FULL_SHA256_VERIFIED");
  assert.throws(()=>verifyVideoRangeResponse({...response,bytes:bytes.subarray(0,32)},complete,item),/RANGE_FALLBACK_LENGTH_MISMATCH/);
  const tampered=Buffer.from(bytes);tampered[tampered.length-1]^=1;
  assert.throws(()=>verifyVideoRangeResponse({...response,bytes:tampered},complete,item),/RANGE_FALLBACK_HASH_MISMATCH/);
  assert.throws(()=>verifyVideoRangeResponse({...response,headers:{"content-type":"text/html","content-disposition":"attachment"}},complete,item),/RANGE_FALLBACK_MIME_MISMATCH/);
  assert.throws(()=>verifyVideoRangeResponse({...response,headers:{"content-type":"video/mp4"}},complete,item),/RANGE_FALLBACK_DISPOSITION_MISMATCH/);
});

test("CREDMED: MP4 Range 206 verifies exact 32-byte prefix and total size", () => {
  const partial={code:206,headers:{"content-range":"bytes 0-31/"+item.bytes},bytes:bytes.subarray(0,32)};
  assert.equal(verifyVideoRangeResponse(partial,complete,item),"MP4_RANGE_206_VERIFIED");
  assert.throws(()=>verifyVideoRangeResponse({...partial,headers:{"content-range":"bytes 0-31/999"}},complete,item),/RANGE_TOTAL_MISMATCH/);
  assert.throws(()=>verifyVideoRangeResponse({...partial,bytes:bytes.subarray(0,31)},complete,item),/RANGE_LENGTH_MISMATCH/);
  const wrong=Buffer.from(bytes.subarray(0,32));wrong[0]^=1;
  assert.throws(()=>verifyVideoRangeResponse({...partial,bytes:wrong},complete,item),/RANGE_PREFIX_MISMATCH/);
  assert.throws(()=>verifyVideoRangeResponse({...partial,code:416},complete,item),/UNEXPECTED_RANGE_HTTP_STATUS/);
});
