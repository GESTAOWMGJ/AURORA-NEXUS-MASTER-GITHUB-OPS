/** Deterministic HTTP download integrity contract for AURORA-CRED-MED-001.
 * Firebase Hosting may serve public assets chunked and ignore Range. Neither
 * transport choice weakens the required full-body digest verification.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyHeadLength(head, item) {
  assert.equal(head.bytes.length, 0, 'HEAD_MUST_NOT_RETURN_BODY');
  const declared = head.headers['content-length'];
  if (declared === undefined) return 'HEAD_LENGTH_UNSPECIFIED_GET_HASH_REQUIRED';
  assert.match(String(declared), /^(0|[1-9][0-9]*)$/, 'HEAD_CONTENT_LENGTH_INVALID');
  assert.equal(Number(declared), item.bytes, 'HEAD_CONTENT_LENGTH_MISMATCH');
  return 'HEAD_CONTENT_LENGTH_MATCH';
}

export function verifyVideoRangeResponse(partial, full, item) {
  if (partial.code === 206) {
    assert.equal(partial.bytes.length, 32, 'RANGE_LENGTH_MISMATCH');
    assert.equal(String(partial.headers['content-range']), 'bytes 0-31/' + item.bytes, 'RANGE_TOTAL_MISMATCH');
    assert.deepEqual(partial.bytes, full.bytes.subarray(0, 32), 'RANGE_PREFIX_MISMATCH');
    return 'MP4_RANGE_206_VERIFIED';
  }
  if (partial.code === 200) {
    assert.match(String(partial.headers['content-type'] || ''), /^video\/mp4(?:;|$)/i, 'RANGE_FALLBACK_MIME_MISMATCH');
    assert.match(String(partial.headers['content-disposition'] || ''), /^attachment(?:;|$)/i, 'RANGE_FALLBACK_DISPOSITION_MISMATCH');
    assert.equal(partial.bytes.length, item.bytes, 'RANGE_FALLBACK_LENGTH_MISMATCH');
    assert.equal(digest(partial.bytes), item.sha256, 'RANGE_FALLBACK_HASH_MISMATCH');
    return 'MP4_RANGE_FALLBACK_200_FULL_SHA256_VERIFIED';
  }
  assert.fail('UNEXPECTED_RANGE_HTTP_STATUS:' + partial.code);
}
