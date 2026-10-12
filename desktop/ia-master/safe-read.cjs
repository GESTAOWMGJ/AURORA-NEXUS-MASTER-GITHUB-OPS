'use strict';
const fs = require('node:fs');

const SNAPSHOT_FIELDS = ['dev', 'ino', 'nlink', 'mode', 'size', 'mtimeNs', 'ctimeNs'];
const CHUNK_BYTES = 65536;
function demand(condition, code) { if (!condition) throw Error(code); }
function regular(stat, maximum) {
  demand(SNAPSHOT_FIELDS.every(field => typeof stat[field] === 'bigint') &&
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink > 0n &&
    stat.size >= 0n && stat.size <= BigInt(maximum), 'SAFE_FILE_TYPE_OR_SIZE_REQUIRES_REVIEW');
}
function unchanged(left, right) {
  demand(SNAPSHOT_FIELDS.every(field => left[field] === right[field]), 'SAFE_FILE_CHANGED');
}
function observePath(filename, maximum, expected) {
  let stat;
  try { stat = fs.lstatSync(filename, { bigint: true }); }
  catch { throw Error('SAFE_FILE_CHANGED'); }
  regular(stat, maximum); unchanged(expected, stat);
}

function readRegularFile(filename, maxBytes) {
  demand(typeof filename === 'string' && filename.length > 0 && !filename.includes('\0') &&
    Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes < Number.MAX_SAFE_INTEGER,
  'SAFE_READ_ARGUMENTS_INVALID');
  let descriptor;
  try {
    // O_NOFOLLOW protects the final component where the OS implements it. On
    // Windows the descriptor/path comparisons remain required. This is not an
    // assertion that all ancestor/reparse-point races have been eliminated.
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    descriptor = fs.openSync(filename, flags);
    const before = fs.fstatSync(descriptor, { bigint: true });
    regular(before, maxBytes); observePath(filename, maxBytes, before);
    const chunks = [];
    // One sentinel byte detects growth without reading or allocating the grown
    // file. The budget is at most maxBytes + 1 and never exceeds sizeBefore + 1.
    const readLimit = Number(before.size) + 1;
    let total = 0;
    while (total < readLimit) {
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, readLimit - total));
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      demand(Number.isInteger(count) && count >= 0 && count <= buffer.length, 'SAFE_FILE_CHANGED');
      if (count === 0) break;
      total += count;
      demand(total <= maxBytes, 'SAFE_FILE_TYPE_OR_SIZE_REQUIRES_REVIEW');
      demand(total <= Number(before.size), 'SAFE_FILE_CHANGED');
      chunks.push(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    regular(after, maxBytes); unchanged(before, after);
    observePath(filename, maxBytes, after);
    demand(total === Number(before.size), 'SAFE_FILE_CHANGED');
    return Buffer.concat(chunks, total);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

module.exports = { readRegularFile };
