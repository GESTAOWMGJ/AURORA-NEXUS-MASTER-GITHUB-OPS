import assert from 'node:assert/strict';
import test from 'node:test';
import { iaMasterCapability } from '../src/auroraIaMaster.js';
import { iaMasterSection } from '../src/auroraIaMasterView.js';
import { AURORA_NATIVE_ROUTINES } from '../src/auroraNativeRoutines.js';
test('IA Master does not convert connected chat plugins or local presence into authority', () => {
  const result = iaMasterCapability();
  assert.equal(result.localServer.state, 'NOT_ATTESTED_BY_CLOUD');
  assert.equal(result.policy.maxExternalAiCalls, 0);
  assert.equal(result.policy.arbitraryCodeExecution, false);
  assert.equal(result.policy.tenantRawDataTransfer, false);
  assert.equal(result.development.autonomousDeployment, false);
  assert.ok(result.integrations.every(i => i.localState !== 'CONNECTED'));
  assert.equal(AURORA_NATIVE_ROUTINES.find(r => r.id === result.policy.id)?.state, 'NATIVE_GOVERNED');
});
test('private Master Studio is rendered only for the full-scope MFA administrator', () => {
  assert.equal(iaMasterSection(), '');
  const html = iaMasterSection({orgId:'synthetic-company',role:'org_admin',allFacilities:true,mfaVerified:true});
  assert.match(html, /IA Master/);
  assert.match(html, /master-pair-ticket/);
  assert.match(html, /master-task-form/);
  assert.doesNotMatch(html, /token=|Authorization|fetch\(|iframe|script/);
});
