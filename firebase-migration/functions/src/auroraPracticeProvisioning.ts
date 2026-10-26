import { createHash } from 'node:crypto';
import { createProfileEngine, type ProfileStore, type ProfileAuth, type ProfileTx } from './auroraUserProfiles.js';
import { ProfileError, profileAdmin, normalizeProfileRequest, type ProfileActor } from './auroraUserProfilePolicy.js';
import { isCompanySlug } from './auroraTenantEntry.js';

/** Grants are server-only, independently reviewed records, never request-supplied assertions.
 * Stored in existing runtimeCheckpoints; no new database or email-based account adoption. */
export function createPracticeProvisioner(store: ProfileStore, auth: ProfileAuth, clock = Date.now) {
  return async function provision(actor: ProfileActor, grantId: string) {
    if (!profileAdmin(actor) || actor.role === 'practice_owner' || !/^[a-zA-Z0-9_-]{16,80}$/.test(grantId)) throw new ProfileError('PRACTICE_PROVISIONER_REQUIRED', 403);
    const grantPath = `organizations/${actor.orgId}/runtimeCheckpoints/practice-grant-${grantId}`;
    const readGrant = async (tx: ProfileTx) => {
      const operatorOrg = await tx.read(`organizations/${actor.orgId}`);
      const operator = await tx.read(`organizations/${actor.orgId}/members/${actor.uid}`);
      const grant = await tx.read(grantPath);
      if (operatorOrg?.active !== true || operator?.active !== true || operator.allFacilities !== true
          || !['org_admin','platform_admin'].includes(operator.role) || operator.role !== actor.role
          || (operator.onboardingRequired === true && operator.onboardingState !== 'COMPLETE')) throw new ProfileError('PRACTICE_OPERATOR_REVOKED',403);
      if (!grant || grant.status !== 'APPROVED' || grant.actorUid !== actor.uid
          || typeof grant.verifiedBy !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(grant.verifiedBy) || grant.verifiedBy === actor.uid
          || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= clock()
          || grant.entityVerified !== true || grant.professionalVerified !== true || grant.ownerConsent !== true
          || !isCompanySlug(grant.orgId) || grant.orgId === 'wmgj' || grant.orgId === actor.orgId
          || ![grant.entityRef,grant.professionalRef].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v))) throw new ProfileError('PRACTICE_VALIDATED_GRANT_REQUIRED',403);
      const reviewer = await tx.read(`organizations/${actor.orgId}/members/${grant.verifiedBy}`);
      if (reviewer?.active !== true || reviewer.allFacilities !== true || !Array.isArray(reviewer.permissions)
          || !reviewer.permissions.includes('practice.validate')
          || (reviewer.onboardingRequired === true && reviewer.onboardingState !== 'COMPLETE')) throw new ProfileError('PRACTICE_REVIEWER_REVOKED',403);
      // Validate before creating any Firestore or Auth state.
      normalizeProfileRequest({action:'CREATE',requestId:grantId,email:grant.email,displayName:grant.displayName,role:'practice_owner',allFacilities:true,facilityIds:[]});
      return grant;
    };
    const grant = await store.transaction(readGrant);
    const fingerprint = createHash('sha256').update(JSON.stringify(grant)).digest('hex');
    const base = `organizations/${grant.orgId}`;
    const binding = { grantPath, fingerprint, entityRef:grant.entityRef, professionalRef:grant.professionalRef };
    const authorize = async (tx: ProfileTx) => {
      const current = await readGrant(tx);
      if (createHash('sha256').update(JSON.stringify(current)).digest('hex') !== fingerprint) throw new ProfileError('PRACTICE_GRANT_CHANGED');
      const org = await tx.read(base);
      if (org && (org.profile !== 'PERSONALITE' || Object.entries(binding).some(([key,value]) => org.practiceBinding?.[key] !== value)
          || !['PENDING','READY'].includes(org.provisioningState) || org.active !== (org.provisioningState === 'READY'))) throw new ProfileError('PRACTICE_ORGANIZATION_CONFLICT');
      return org;
    };
    await store.transaction(async tx => {
      const org = await authorize(tx);
      if (!org) tx.create(base, { active:false, profile:'PERSONALITE', profileVersion:'0.1.2',
        provisioningState:'PENDING', practiceBinding:binding, userProfilesEnabled:true,
        projectionEnabled:false, clinicalSensitiveEnabled:false, clinicalStorageEnabled:false,
        providerWriteEnabled:false, createdAtUtc:new Date(clock()).toISOString() });
    });
    const targetActor = {...actor, orgId:grant.orgId};
    const engine = createProfileEngine(store, auth, clock, async tx => { await authorize(tx); });
    const result = await engine.create(targetActor, {action:'CREATE',requestId:grantId,email:grant.email,
      displayName:grant.displayName,role:'practice_owner',allFacilities:true,facilityIds:[]});
    await store.transaction(async tx => {
      const org = await authorize(tx);
      const owner = await tx.read(`${base}/members/${result.uid}`);
      if (owner?.active !== true || owner.profileState !== 'READY' || owner.role !== 'practice_owner') throw new ProfileError('PRACTICE_OWNER_NOT_READY');
      if (org?.provisioningState === 'PENDING') {
        tx.update(base,{active:true, provisioningState:'READY'});
        tx.create(`${base}/auditEvents/practice-activation`,{type:'PRACTICE_PROVISIONED',actorUid:actor.uid,
          ownerUid:result.uid, entityRef:grant.entityRef, professionalRef:grant.professionalRef, atUtc:new Date(clock()).toISOString()});
      }
    });
    return {...result, loginPath:'/portal', profileVersion:'0.1.2', clinicalAccess:false};
  };
}
