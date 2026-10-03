import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const rules = await fs.readFile(
  new URL('../firestore/firestore.rules', import.meta.url),
  'utf8'
);

test('clinicalEvidence combina gate explícito com RBAC e facility scope', () => {
  assert.match(
    rules,
    /function clinicalSensitiveEnabled\(orgId\) \{[\s\S]*?activeOrganization\(orgId\)[\s\S]*?\.clinicalSensitiveEnabled == true;[\s\S]*?\}/
  );
  assert.match(
    rules,
    /match \/clinicalEvidence\/\{evidenceId\} \{\s*allow read: if clinicalSensitiveEnabled\(orgId\)\s*&& canReadClinical\(orgId\)\s*&& facilityAllowed\(orgId, resource\.data\);/
  );
});
