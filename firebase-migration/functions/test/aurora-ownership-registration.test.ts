import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const policyUrl = new URL('../../policy/aurora-nexus-ownership-registration-v1.json', import.meta.url);
const manifestUrl = new URL('../../policy/manifest.json', import.meta.url);
const certificateUrl = new URL('../../../docs/evidence/aurora-nexus-inpi-br512026009261-2.pdf', import.meta.url);

test('project manifest binds the INPI software registration to immutable evidence', async () => {
  const [policyBytes, manifestBytes, certificateBytes] = await Promise.all([
    readFile(policyUrl),
    readFile(manifestUrl),
    readFile(certificateUrl)
  ]);
  const policy = JSON.parse(policyBytes.toString());
  const manifest = JSON.parse(manifestBytes.toString());

  assert.equal(manifest.ownershipAndRegistration.file, 'aurora-nexus-ownership-registration-v1.json');
  assert.equal(manifest.ownershipAndRegistration.id, 'AURORA-OWNERSHIP-REGISTRATION-001');
  assert.equal(policy.softwareRegistration.processNumber, 'BR512026009261-2');
  assert.equal(policy.softwareRegistration.title, 'AURORA NEXUS');
  assert.equal(policy.softwareRegistration.holder.legalName, 'JF NETO SERVICOS MEDICOS LTDA');
  assert.equal(policy.softwareRegistration.author.name, 'JOAO DE FREITAS NETO');
  assert.equal(policy.certificateEvidence.fileSizeBytes, certificateBytes.length);
  assert.equal(createHash('sha256').update(certificateBytes).digest('hex'), policy.certificateEvidence.sha256);
});

test('professional declaration remains separate from the INPI evidence boundary', async () => {
  const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
  assert.equal(policy.professionalGovernance.source, 'DIRECT_OWNER_STATEMENT_2026-10-21');
  assert.equal(policy.professionalGovernance.state, 'DECLARED_PENDING_PRIMARY_REGISTRY_EVIDENCE');
  assert.deepEqual(policy.professionalGovernance.medicalRegistrations, [
    {council: 'CRM', state: 'PR', number: '55137'},
    {council: 'CRM', state: 'SP', number: '214745'}
  ]);
  assert.equal(policy.professionalGovernance.technicalRole.title, 'DIRETOR_TECNICO');
  assert.equal(policy.claimBoundaries.softwareRegistrationCertified, true);
  assert.equal(policy.claimBoundaries.trademarkRegistrationClaimed, false);
  assert.equal(policy.claimBoundaries.anvisaApprovalClaimed, false);
  assert.equal(policy.claimBoundaries.crmStandingVerifiedByThisEvidence, false);
  assert.equal(policy.claimBoundaries.technicalDirectorAppointmentVerifiedByThisEvidence, false);
  assert.equal(policy.runtimeEffect.productionMutation, false);
});
