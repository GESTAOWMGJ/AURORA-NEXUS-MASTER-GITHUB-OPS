import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { immutableEntityVersionId } from '../src/auroraCanonicalVersions.ts';

const backend = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8").replace(/\r\n/g, '\n');
const rules = readFileSync(new URL("../../firestore/firestore.rules", import.meta.url), "utf8").replace(/\r\n/g, '\n');

test("accepted ingestion persists an immutable version snapshot", () => {
  assert.match(backend, /immutableEntityVersionId\(/);
  assert.match(backend, /collection\("entityVersions"\)\.doc\(versionId\)/);
  assert.match(backend, /const versionSnap = await tx\.get\(versionRef\)/);
  assert.match(backend, /ENTITY_VERSION_CONFLICT/);
  assert.match(backend, /const versionSnapshot = stableValue\([\s\S]*mergedDocumentForAudit/);
  assert.match(backend, /tx\.create\(versionRef, \{/);
  assert.doesNotMatch(backend, /tx\.set\(versionRef/);
  assert.match(backend, /beforeHash,/);
  assert.match(backend, /afterHash,/);
  assert.match(backend, /snapshot: versionSnapshot/);
  assert.match(backend, /versionCount: FieldValue\.increment\(1\)/);
});

test("version identity is bound to the canonical entity revision", () => {
  assert.equal(immutableEntityVersionId('sourceDocument','DRIVE:known',1),'599ac3dc7348351b014b82f571bb0f445e9cb72c92390c3e');
  assert.equal(immutableEntityVersionId('sourceDocument','DRIVE:known',2),'2146fa9dd713cc31c61926b1b1f5a5a793c3be43a3574066');
  assert.notEqual(immutableEntityVersionId('sourceDocument','DRIVE:known',1),
    immutableEntityVersionId('sourceDocument','DRIVE:known',2));
  assert.notEqual(immutableEntityVersionId('sourceDocument','DRIVE:known',1),
    immutableEntityVersionId('invoice','DRIVE:known',1));
  assert.notEqual(immutableEntityVersionId('sourceDocument','DRIVE:known',1),
    immutableEntityVersionId('sourceDocument','DRIVE:other',1));
  assert.match(backend, /const revision = nextCanonicalEntityRevision\(previous\?\.revision\)/);
  assert.match(backend, /revision,\n\s+sourceVersion: event\.sourceVersion/);
  assert.match(backend, /versionId: result\.versionId/);
  assert.match(backend, /revision: result\.revision/);
});

test("immutable entity versions are not readable or writable by clients", () => {
  assert.match(
    rules,
    /match \/entityVersions\/\{versionId\} \{\n\s+allow read, write: if false;\n\s+\}/
  );
});
