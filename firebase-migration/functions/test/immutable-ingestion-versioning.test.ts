import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const rules = readFileSync(new URL("../../firestore/firestore.rules", import.meta.url), "utf8");

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
  assert.match(
    backend,
    /sha256Hex\(`v1:\$\{entityType\}:\$\{entityKey\}:revision:\$\{revision\}`\)\.slice\(0, 48\)/
  );
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
