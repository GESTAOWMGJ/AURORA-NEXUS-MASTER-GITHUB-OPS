import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// Handler mocks and the emulator do not verify deployed collection-group indexes.
// A field override replaces inherited indexes, so the collection defaults matter too.
test('bearer keyId equality lookup has a group index and retains collection defaults', () => {
  const config = JSON.parse(readFileSync(new URL('../../firestore/firestore.indexes.json', import.meta.url), 'utf8'));
  const overrides = config.fieldOverrides.filter((field: any) =>
    field.collectionGroup === 'integrationCredentials' && field.fieldPath === 'keyId');
  assert.equal(overrides.length, 1, 'declare the credential lookup index once');
  const signatures = overrides[0].indexes.map((index: any) =>
    `${index.queryScope}:${index.order ?? index.arrayConfig}`).sort();
  assert.deepEqual(signatures, [
    'COLLECTION:ASCENDING',
    'COLLECTION:CONTAINS',
    'COLLECTION:DESCENDING',
    'COLLECTION_GROUP:ASCENDING',
  ]);
});
