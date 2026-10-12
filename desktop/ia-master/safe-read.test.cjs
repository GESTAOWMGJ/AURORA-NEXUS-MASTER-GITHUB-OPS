'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { readRegularFile } = require('./safe-read.cjs');
const source = fs.readFileSync(path.join(__dirname, 'safe-read.cjs'), 'utf8');
function fixture(t, bytes = Buffer.from('synthetic original')) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-safe-read-'));
  const filename = path.join(directory, 'source.txt'); fs.writeFileSync(filename, bytes);
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'aurora-safe-read-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { directory, filename, bytes };
}
// Dependency substitution belongs only to this test harness. The production API
// has no factory, adapter, third argument, or pathname-based read fallback.
function instrument(t, hooks = {}) {
  const openDescriptors = new Set(), calls = { open: 0, close: 0, read: 0, lstat: 0, fstat: 0, requestedBytes: 0, readBytes: 0, maxChunk: 0, flags: null };
  const adapter = {
    constants: fs.constants,
    openSync(filename, flags) {
      calls.open++; calls.flags = flags;
      const descriptor = fs.openSync(filename, flags); openDescriptors.add(descriptor);
      try { hooks.afterOpen?.(filename, descriptor); } catch (error) { fs.closeSync(descriptor); openDescriptors.delete(descriptor); throw error; }
      return descriptor;
    },
    fstatSync(descriptor, options) {
      assert.equal(typeof descriptor, 'number'); assert.deepEqual(options.bigint, true); calls.fstat++;
      hooks.beforeFstat?.(descriptor, calls.fstat);
      const result = fs.fstatSync(descriptor, options);
      return hooks.fstatResult ? hooks.fstatResult(result, calls.fstat) : result;
    },
    lstatSync(filename, options) {
      assert.equal(options.bigint, true); calls.lstat++;
      const result = fs.lstatSync(filename, options);
      hooks.afterLstat?.(filename, calls.lstat);
      return hooks.lstatResult ? hooks.lstatResult(result, calls.lstat) : result;
    },
    readSync(descriptor, buffer, offset, length, position) {
      assert.equal(typeof descriptor, 'number'); assert.ok(openDescriptors.has(descriptor)); assert.equal(position, null);
      calls.read++; calls.requestedBytes += length; calls.maxChunk = Math.max(calls.maxChunk, length);
      hooks.beforeRead?.(descriptor, calls.read);
      const result = fs.readSync(descriptor, buffer, offset, hooks.readLength ? hooks.readLength(length) : length, position);
      calls.readBytes += result;
      hooks.afterRead?.(descriptor, calls.read);
      return result;
    },
    closeSync(descriptor) { calls.close++; assert.ok(openDescriptors.has(descriptor)); fs.closeSync(descriptor); openDescriptors.delete(descriptor); }
  };
  const loaded = { exports: {} };
  vm.runInNewContext('(function(require, module) {\n' + source + '\n})', { Buffer }, { filename: 'safe-read-test-module.cjs' })((name) => {
    assert.equal(name, 'node:fs'); return adapter;
  }, loaded);
  t.after(() => assert.equal(openDescriptors.size, 0, 'All descriptors acquired by the reader must be closed.'));
  return { read: loaded.exports.readRegularFile, calls, openDescriptors };
}
function replaceFile(value, replacement = Buffer.from('synthetic replacement')) {
  fs.renameSync(value.filename, path.join(value.directory, 'displaced.txt'));
  fs.writeFileSync(value.filename, replacement);
}
test('returns the exact bounded regular-file bytes and also accepts an empty file at a zero limit', t => {
  const value = fixture(t, Buffer.from('ação 🎯\n', 'utf8'));
  assert.deepEqual(readRegularFile(value.filename, value.bytes.length), value.bytes);
  const empty = fixture(t, Buffer.alloc(0)); assert.deepEqual(readRegularFile(empty.filename, 0), Buffer.alloc(0));
});
test('reads through one descriptor with BigInt stats, capped chunks and readonly/no-follow flags', t => {
  const value = fixture(t, Buffer.alloc(150000, 71)), reader = instrument(t);
  assert.deepEqual(reader.read(value.filename, value.bytes.length), value.bytes);
  assert.equal(reader.calls.open, 1); assert.equal(reader.calls.close, 1);
  assert.equal(reader.calls.fstat, 2); assert.equal(reader.calls.lstat, 2);
  assert.ok(reader.calls.maxChunk <= 65536);
  assert.equal(reader.calls.readBytes, value.bytes.length);
  const expectedFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  assert.equal(reader.calls.flags, expectedFlags);
});
test('partial descriptor reads reassemble the complete file without a pathname fallback', t => {
  const value = fixture(t), reader = instrument(t, { readLength: length => Math.min(3, length) });
  assert.deepEqual(reader.read(value.filename, 100), value.bytes);
  assert.ok(reader.calls.read > 2); assert.equal(reader.calls.readBytes, value.bytes.length); assert.equal(reader.calls.close, 1);
});
test('rejects invalid caller limits and paths without opening a file or accepting an injected filesystem', t => {
  const value = fixture(t), reader = instrument(t);
  for (const limit of [-1, 1.5, Infinity, NaN, '25', null, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => reader.read(value.filename, limit), /SAFE_READ_ARGUMENTS_INVALID/);
  }
  for (const filename of ['', null, Buffer.from(value.filename), { toString: () => value.filename }, 'bad\0path']) {
    assert.throws(() => reader.read(filename, 100), /SAFE_READ_ARGUMENTS_INVALID/);
  }
  assert.equal(reader.calls.open, 0);
  let overrideCalled = false;
  assert.deepEqual(reader.read(value.filename, 100, { readFileSync() { overrideCalled = true; return Buffer.from('forged'); } }), value.bytes);
  assert.equal(overrideCalled, false);
});
test('initial absence retains ENOENT and no descriptor is leaked', t => {
  const value = fixture(t), reader = instrument(t);
  assert.throws(() => reader.read(path.join(value.directory, 'missing.txt'), 100), error => error.code === 'ENOENT');
  assert.equal(reader.calls.close, 0);
});
test('over-limit file and directory are refused before any content read', t => {
  const value = fixture(t), reader = instrument(t);
  assert.throws(() => reader.read(value.filename, value.bytes.length - 1), /SAFE_FILE_TYPE_OR_SIZE_REQUIRES_REVIEW/);
  assert.equal(reader.calls.read, 0); assert.equal(reader.calls.close, 1);
  // Windows may reject opening a directory with EISDIR/EPERM before it has a fd;
  // Unix opens it, then the descriptor type gate rejects it. Neither can read it.
  assert.throws(() => reader.read(value.directory, 100)); assert.equal(reader.calls.read, 0);
});
test('path replacement immediately after open is detected before reading the descriptor', t => {
  const value = fixture(t), reader = instrument(t, { afterOpen() { replaceFile(value); } });
  assert.throws(() => reader.read(value.filename, 100), /SAFE_FILE_CHANGED/);
  assert.equal(reader.calls.read, 0); assert.equal(reader.calls.close, 1);
  assert.equal(fs.readFileSync(value.filename, 'utf8'), 'synthetic replacement');
});
test('replacement after the first pathname observation is rejected without returning bytes', t => {
  const value = fixture(t), reader = instrument(t, { afterLstat(filename, count) { if (count === 1) replaceFile(value, Buffer.from('different bytes')); } });
  assert.throws(() => reader.read(value.filename, 100), /SAFE_FILE_CHANGED/);
  assert.equal(reader.calls.close, 1);
});
test('disappearance of the original pathname after reading is rejected', t => {
  const value = fixture(t), reader = instrument(t, { afterRead(descriptor, count) { if (count === 1) fs.renameSync(value.filename, path.join(value.directory, 'removed.txt')); } });
  assert.throws(() => reader.read(value.filename, 100), /SAFE_FILE_CHANGED/); assert.equal(reader.calls.close, 1);
});
test('same-size content rewrite during reading is detected using final nanosecond metadata', t => {
  const value = fixture(t, Buffer.alloc(70000, 65)); let changed = false;
  const reader = instrument(t, { afterRead(descriptor, count) {
    if (count !== 1) return;
    fs.writeFileSync(value.filename, Buffer.alloc(value.bytes.length, 66));
    // Deterministic even on filesystems with coarse modification timestamps.
    fs.utimesSync(value.filename, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z')); changed = true;
  } });
  assert.throws(() => reader.read(value.filename, value.bytes.length), /SAFE_FILE_CHANGED/);
  assert.equal(changed, true); assert.equal(reader.calls.close, 1);
});
test('growth before the first read is bounded to the initial size plus one byte', t => {
  const value = fixture(t, Buffer.from('small'));
  const reader = instrument(t, { beforeRead(descriptor, count) { if (count === 1) fs.appendFileSync(value.filename, Buffer.alloc(1024 * 1024, 67)); } });
  assert.throws(() => reader.read(value.filename, 1024), /SAFE_FILE_CHANGED/);
  assert.equal(reader.calls.read, 1); assert.equal(reader.calls.requestedBytes, value.bytes.length + 1); assert.equal(reader.calls.close, 1);
});
test('growth at the maximum and truncation fail closed and close the descriptor', t => {
  const value = fixture(t), growth = instrument(t, { beforeRead(descriptor, count) { if (count === 1) fs.appendFileSync(value.filename, 'x'); } });
  assert.throws(() => growth.read(value.filename, value.bytes.length), /SAFE_FILE_TYPE_OR_SIZE_REQUIRES_REVIEW/); assert.equal(growth.calls.close, 1);
  const shortened = fixture(t), shrink = instrument(t, { beforeRead(descriptor, count) { if (count === 1) fs.truncateSync(shortened.filename, 2); } });
  assert.throws(() => shrink.read(shortened.filename, 100), /SAFE_FILE_CHANGED/); assert.equal(shrink.calls.close, 1);
});
test('identity and permission/link-count changes between fd snapshots fail closed', t => {
  for (const field of ['dev', 'ino', 'nlink', 'mode', 'mtimeNs', 'ctimeNs']) {
    const value = fixture(t), reader = instrument(t, { fstatResult(stat, count) { return count === 2 ? { ...stat, [field]: stat[field] + 1n, isFile: () => true, isSymbolicLink: () => false } : stat; } });
    assert.throws(() => reader.read(value.filename, 100), /SAFE_FILE_CHANGED/); assert.equal(reader.calls.close, 1);
  }
});
test('a symbolic final component is refused even when the OS has no O_NOFOLLOW flag', t => {
  const value = fixture(t), reader = instrument(t, { lstatResult(stat) { return { ...stat, isFile: () => true, isSymbolicLink: () => true }; } });
  assert.throws(() => reader.read(value.filename, 100), /SAFE_FILE_TYPE_OR_SIZE_REQUIRES_REVIEW/);
  assert.equal(reader.calls.read, 0); assert.equal(reader.calls.close, 1);
});
test('failed fstat, path observation, and read each close the acquired descriptor', t => {
  const first = fixture(t), fstat = instrument(t, { beforeFstat() { throw Error('SYNTHETIC_FSTAT_FAILURE'); } });
  assert.throws(() => fstat.read(first.filename, 100), /SYNTHETIC_FSTAT_FAILURE/); assert.equal(fstat.calls.close, 1);
  const second = fixture(t), lstat = instrument(t, { afterOpen() { fs.unlinkSync(second.filename); } });
  assert.throws(() => lstat.read(second.filename, 100), /SAFE_FILE_CHANGED|SAFE_FILE_TYPE_OR_SIZE_REQUIRES_REVIEW/); assert.equal(lstat.calls.close, 1);
  const third = fixture(t), read = instrument(t, { beforeRead() { throw Error('SYNTHETIC_READ_FAILURE'); } });
  assert.throws(() => read.read(third.filename, 100), /SYNTHETIC_READ_FAILURE/); assert.equal(read.calls.close, 1);
});
