import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBetaProductionOrchestrator } from '../src/auroraProductionOrchestrator.js';

test('beta production orchestrator keeps install light and refreshes every login', () => {
  const result = buildBetaProductionOrchestrator({
    dataQuality: { sourcePresent: true },
    operations: { openActions: 0, overdueActions: 0 },
    documentIntelligence: { pendingDocumentFlow: 0 },
    nativeDataPlane: { storage: 'FIRESTORE', sourceAccessDuringInference: false }
  }, {
    productionCommand: {
      approvedProjectConfigured: true,
      wifProviderConfigured: true,
      serviceAccountConfigured: true
    },
    release: { productVersion: '1.0.0-rc.1', releaseTrain: '2026.09', engineeringReadinessPercent: 55 }
  }, new Date('2026-10-05T19:00:00.000Z'));

  assert.equal(result.engine, 'AURORA_BETA_PRODUCTION_ORCHESTRATOR');
  assert.equal(result.redundancyPolicy.installableClient, 'SINGLE_ACT_LIGHT_INSTALL');
  assert.equal(result.redundancyPolicy.heavyValidation, 'POST_LOGIN_OR_FAILURE_ONLY');
  assert.deepEqual(result.postLoginContract.actions, [
    'CLIENT_VERSION_REFRESH',
    'ON_TIME_DOCUMENT_INGESTION',
    'PENDING_QUEUE_REFRESH',
    'INTERFACE_IMPROVEMENT_REFRESH'
  ]);
  assert.equal(result.commandGate.lastKnownBlocker, null);
});

test('beta production orchestrator reports command credential blocker without exposing values', () => {
  const result = buildBetaProductionOrchestrator({
    dataQuality: { sourcePresent: true },
    nativeDataPlane: { storage: 'FIRESTORE', sourceAccessDuringInference: false }
  }, {}, new Date('2026-10-05T19:00:00.000Z'));

  assert.equal(result.commandGate.valuesExposed, false);
  assert.deepEqual(result.commandGate.requiredProtectedVariables, [
    'APPROVED_PROJECT',
    'WIF_PROVIDER',
    'PROVISION_SERVICE_ACCOUNT'
  ]);
  assert.equal(result.nextAction.blocker, 'COMMAND_CREDENTIALS_REQUIRED');
  assert.doesNotMatch(JSON.stringify(result), /token|secret|PRIVATE KEY/i);
});

test('beta production orchestrator distinguishes missing source from zero work', () => {
  const result = buildBetaProductionOrchestrator({
    dataQuality: { sourcePresent: false },
    operations: {},
    documentIntelligence: {},
    nativeDataPlane: { storage: 'FIRESTORE', sourceAccessDuringInference: false }
  }, {
    productionCommand: {
      approvedProjectConfigured: true,
      wifProviderConfigured: true,
      serviceAccountConfigured: true
    }
  });

  const ingestion = result.actions.find((item: Record<string, unknown>) => item.id === 'on-time-document-ingestion');
  assert.equal(ingestion?.state, 'PENDING');
  assert.equal(ingestion?.blocker, 'SOURCE_REFRESH_REQUIRED');
  assert.equal(result.nextAction.id, 'on-time-document-ingestion');
});
