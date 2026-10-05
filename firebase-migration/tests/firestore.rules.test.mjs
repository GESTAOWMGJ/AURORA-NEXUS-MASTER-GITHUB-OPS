import fs from 'node:fs/promises';
import test, { after, before } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where
} from 'firebase/firestore';

const projectId = 'wmgj-firestore-rules-test';
let env;

function member(role, overrides = {}) {
  return {
    role,
    active: true,
    permissions: [],
    allFacilities: false,
    facilityIds: ['facility-alpha'],
    ...overrides
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await Promise.all([
      setDoc(doc(db, 'organizations/wmgj'), { name: 'WMGJ', active: true }),
      setDoc(doc(db, 'organizations/wmgj/members/admin'), member('org_admin', {
        allFacilities: true,
        facilityIds: []
      })),
      setDoc(doc(db, 'organizations/wmgj/members/auditor'), member('auditor', {
        allFacilities: true,
        facilityIds: []
      })),
      setDoc(doc(db, 'organizations/wmgj/members/operator'), member('operator')),
      setDoc(doc(db, 'organizations/wmgj/members/finance'), member('finance')),
      setDoc(doc(db, 'organizations/wmgj/members/medical'), member('medical_auditor')),
      setDoc(doc(db, 'organizations/wmgj/members/viewer'), member('viewer')),
      setDoc(doc(db, 'organizations/wmgj/members/raw-reader'), member('viewer', {
        permissions: ['sources.raw.read']
      })),
      setDoc(doc(db, 'organizations/wmgj/members/ops-reader'), member('viewer', {
        permissions: ['operations.read']
      })),
      setDoc(doc(db, 'organizations/wmgj/members/clinical-reader'), member('viewer', {
        permissions: ['clinical.read']
      })),
      setDoc(doc(db, 'organizations/wmgj/members/clinical-no-facility'), member('viewer', {
        permissions: ['clinical.read'],
        facilityIds: []
      })),
      setDoc(doc(db, 'organizations/wmgj/members/clinical-malformed-scope'), member('viewer', {
        permissions: ['clinical.read'],
        allFacilities: 'true',
        facilityIds: 'facility-alpha'
      })),
      setDoc(doc(db, 'organizations/wmgj/members/clinical-malformed-permission'), member('viewer', {
        permissions: 'clinical.read'
      })),
      setDoc(doc(db, 'organizations/wmgj/members/clinical-inactive'), member('medical_auditor', {
        active: false,
        permissions: ['clinical.read']
      })),
      setDoc(doc(db, 'organizations/wmgj/members/inactive'), member('auditor', {
        active: false,
        allFacilities: true,
        facilityIds: []
      })),
      setDoc(doc(db, 'organizations/inactive-org'), { name: 'Inactive', active: false }),
      setDoc(doc(db, 'organizations/inactive-org/members/org-disabled'), member('org_admin', {
        allFacilities: true,
        facilityIds: []
      })),
      setDoc(doc(db, 'organizations/legacy-org'), { name: 'Missing active flag' }),
      setDoc(doc(db, 'organizations/legacy-org/members/org-active-missing'), member('org_admin', {
        allFacilities: true,
        facilityIds: []
      })),
      setDoc(doc(db, 'organizations/other'), { name: 'Other', active: true }),
      setDoc(doc(db, 'organizations/other/members/other-user'), member('viewer'))
    ]);

    await Promise.all([
      setDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-alpha'), {
        orgId: 'wmgj',
        facilityId: 'facility-alpha',
        workflowState: 'VALIDATED',
        rawText: 'conteúdo restrito'
      }),
      setDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-beta'), {
        orgId: 'wmgj',
        facilityId: 'facility-beta',
        workflowState: 'VALIDATED',
        rawText: 'conteúdo restrito'
      }),
      setDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-alpha/versions/v1'), {
        rawText: 'versão restrita'
      }),
      setDoc(doc(db, 'organizations/other/sourceDocuments/source-other'), {
        orgId: 'other',
        facilityId: 'facility-alpha',
        workflowState: 'VALIDATED'
      }),
      setDoc(doc(db, 'organizations/wmgj/productivityRecords/op-alpha'), {
        orgId: 'wmgj',
        facilityId: 'facility-alpha',
        total: 10
      }),
      setDoc(doc(db, 'organizations/wmgj/productivityRecords/op-beta'), {
        orgId: 'wmgj',
        facilityId: 'facility-beta',
        total: 20
      }),
      setDoc(doc(db, 'organizations/wmgj/financialEntries/fin-alpha'), {
        orgId: 'wmgj',
        facilityId: 'facility-alpha',
        amount: 100
      }),
      setDoc(doc(db, 'organizations/wmgj/financialEntries/fin-beta'), {
        orgId: 'wmgj',
        facilityId: 'facility-beta',
        amount: 200
      }),
      setDoc(doc(db, 'organizations/wmgj/hospitalAccounts/hospital-alpha'), {
        orgId: 'wmgj',
        facilityId: 'facility-alpha',
        status: 'OPEN'
      }),
      setDoc(doc(db, 'organizations/wmgj/hospitalAccounts/hospital-beta'), {
        orgId: 'wmgj',
        facilityId: 'facility-beta',
        status: 'OPEN'
      }),
      setDoc(doc(db, 'organizations/wmgj/clinicalEvidence/clinical-alpha'), {
        orgId: 'wmgj',
        facilityId: 'facility-alpha',
        kind: 'SYNTHETIC'
      }),
      setDoc(doc(db, 'organizations/wmgj/clinicalEvidence/clinical-beta'), {
        orgId: 'wmgj',
        facilityId: 'facility-beta',
        kind: 'SYNTHETIC'
      }),
      setDoc(doc(db, 'organizations/inactive-org/productivityRecords/op-disabled'), {
        orgId: 'inactive-org',
        facilityId: 'facility-alpha',
        total: 10
      }),
      setDoc(doc(db, 'organizations/legacy-org/productivityRecords/op-missing-active'), {
        orgId: 'legacy-org',
        facilityId: 'facility-alpha',
        total: 10
      })
    ]);

    await Promise.all([
      setDoc(doc(db, 'organizations/wmgj/dashboardSnapshots/dash-alpha'), {
        orgId: 'wmgj',
        facilityId: 'facility-alpha',
        sanitized: true,
        sensitivity: 'INTERNAL',
        metrics: { queued: 2 }
      }),
      setDoc(doc(db, 'organizations/wmgj/dashboardSnapshots/dash-beta'), {
        orgId: 'wmgj',
        facilityId: 'facility-beta',
        sanitized: true,
        sensitivity: 'INTERNAL',
        metrics: { queued: 4 }
      }),
      setDoc(doc(db, 'organizations/wmgj/dashboardSnapshots/dash-org'), {
        orgId: 'wmgj',
        sanitized: true,
        sensitivity: 'INTERNAL',
        metrics: { queued: 6 }
      }),
      setDoc(doc(db, 'organizations/wmgj/dashboardSnapshots/dash-unsafe'), {
        orgId: 'wmgj',
        sanitized: false,
        sensitivity: 'RESTRICTED',
        rawText: 'não pode ser exposto'
      }),
      setDoc(doc(db, 'organizations/wmgj/actionItems/action-alpha'), {
        orgId: 'wmgj',
        facilityId: 'facility-alpha',
        status: 'OPEN'
      }),
      setDoc(doc(db, 'organizations/wmgj/auditEvents/audit-alpha'), {
        orgId: 'wmgj',
        facilityId: 'facility-alpha',
        action: 'SYNTHETIC'
      }),
      setDoc(doc(db, 'organizations/wmgj/apiIdempotency/secret-token'), {
        orgId: 'wmgj',
        requestHash: 'secret'
      }),
      setDoc(doc(db, 'organizations/wmgj/privateData/secret'), {
        orgId: 'wmgj',
        value: 'secret'
      })
    ]);
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await fs.readFile(
        new URL('../firestore/firestore.rules', import.meta.url),
        'utf8'
      )
    }
  });
  await env.clearFirestore();
  await seed();
});

after(async () => env?.cleanup());

test('managed identities require matching company, verified email, MFA and current READY membership on direct SDK reads', async () => {
  const uid = 'managed-synthetic';
  const operation = 'profile-' + 'a'.repeat(64);
  const path = `organizations/wmgj/members/${uid}`;
  const profile = member('org_admin', { allFacilities:true, facilityIds:[], profileVersion:1, profileState:'READY',
    authEmail:'managed@example.invalid', profileOperationId:operation });
  const claims = { email:'managed@example.invalid', email_verified:true, auroraOrgId:'wmgj',
    auroraProfileVersion:1, auroraProfileOperation:operation,
    firebase:{sign_in_provider:'password', sign_in_second_factor:'totp'} };
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(),path),profile));
  const read = patch => getDoc(doc(env.authenticatedContext(uid,{...claims,...patch}).firestore(),'organizations/wmgj'));
  await assertSucceeds(read({}));
  for(const patch of [{email_verified:false},{firebase:{sign_in_provider:'password'}},{auroraOrgId:'other-company'},
    {auroraProfileVersion:2},{auroraProfileOperation:'forged'},{email:'another@example.invalid'}]) await assertFails(read(patch));
  await assertFails(getDoc(doc(env.authenticatedContext(uid).firestore(),'organizations/wmgj')));
  const db = env.authenticatedContext(uid,claims).firestore();
  await assertFails(setDoc(doc(db,path),{...profile,role:'platform_admin'}));
  await assertFails(setDoc(doc(db,'organizations/wmgj/apiIdempotency/client-write'),{status:'READY'}));
  await assertFails(getDoc(doc(db,'organizations/other-company')));
  for(const patch of [{active:false},{profileState:'PENDING'},{profileState:'REVOKED'}]) {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(),path),{...profile,...patch}));
    await assertFails(read({}));
  }
});

test('nega toda leitura sem autenticação', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/dashboardSnapshots/dash-alpha'))
  );
});

test('dashboardSnapshots são invisíveis ao SDK cliente; leitura passa pelo BFF', async () => {
  const viewerDb = env.authenticatedContext('viewer').firestore();
  const adminDb = env.authenticatedContext('admin').firestore();

  for (const [db, snapshotId] of [
    [viewerDb, 'dash-alpha'],
    [adminDb, 'dash-alpha'],
    [adminDb, 'dash-org'],
    [adminDb, 'dash-unsafe']
  ]) {
    await assertFails(
      getDoc(doc(db, `organizations/wmgj/dashboardSnapshots/${snapshotId}`))
    );
  }

  await assertFails(
    getDocs(collection(adminDb, 'organizations/wmgj/dashboardSnapshots'))
  );
});

test('viewer não lê sourceDocuments nem suas versões', async () => {
  const db = env.authenticatedContext('viewer').firestore();
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-alpha'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-alpha/versions/v1'))
  );
});

test('permissão explícita libera fonte apenas dentro do facility scope', async () => {
  const db = env.authenticatedContext('raw-reader').firestore();
  await assertSucceeds(
    getDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-alpha'))
  );
  await assertSucceeds(
    getDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-alpha/versions/v1'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-beta'))
  );
});

test('auditor com escopo global lê fonte restrita', async () => {
  const db = env.authenticatedContext('auditor').firestore();
  await assertSucceeds(
    getDoc(doc(db, 'organizations/wmgj/sourceDocuments/source-beta'))
  );
});

test('papel operacional não recebe dados financeiros ou hospitalares', async () => {
  const db = env.authenticatedContext('operator').firestore();
  await assertSucceeds(
    getDoc(doc(db, 'organizations/wmgj/productivityRecords/op-alpha'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/financialEntries/fin-alpha'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/hospitalAccounts/hospital-alpha'))
  );
});

test('papel financeiro não recebe dados operacionais ou hospitalares', async () => {
  const db = env.authenticatedContext('finance').firestore();
  await assertSucceeds(
    getDoc(doc(db, 'organizations/wmgj/financialEntries/fin-alpha'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/productivityRecords/op-alpha'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/hospitalAccounts/hospital-alpha'))
  );
});

test('auditor médico não recebe financeiro ou operação por padrão', async () => {
  const db = env.authenticatedContext('medical').firestore();
  await assertSucceeds(
    getDoc(doc(db, 'organizations/wmgj/hospitalAccounts/hospital-alpha'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/financialEntries/fin-alpha'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/productivityRecords/op-alpha'))
  );
});

for (const uid of ['medical', 'clinical-reader']) {
  test(`clinicalEvidence permite ${uid} no orçamento real de expressões, apenas na unidade`, async () => {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(
      getDoc(doc(db, 'organizations/wmgj/clinicalEvidence/clinical-alpha'))
    );
    await assertFails(
      getDoc(doc(db, 'organizations/wmgj/clinicalEvidence/clinical-beta'))
    );
  });
}

for (const uid of [
  'operator', 'clinical-no-facility', 'clinical-malformed-scope',
  'clinical-malformed-permission', 'clinical-inactive', 'no-membership'
]) {
  test(`clinicalEvidence nega ${uid} sem reduzir os gates para caber no orçamento`, async () => {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(
      getDoc(doc(db, 'organizations/wmgj/clinicalEvidence/clinical-alpha'))
    );
  });
}

test('permissão granular pode liberar somente o domínio operacional', async () => {
  const db = env.authenticatedContext('ops-reader').firestore();
  await assertSucceeds(
    getDoc(doc(db, 'organizations/wmgj/productivityRecords/op-alpha'))
  );
  await assertFails(
    getDoc(doc(db, 'organizations/wmgj/financialEntries/fin-alpha'))
  );
});

test('facility scope bloqueia documento de outra unidade', async () => {
  const financeDb = env.authenticatedContext('finance').firestore();
  const medicalDb = env.authenticatedContext('medical').firestore();
  const viewerDb = env.authenticatedContext('viewer').firestore();

  await assertFails(
    getDoc(doc(financeDb, 'organizations/wmgj/financialEntries/fin-beta'))
  );
  await assertFails(
    getDoc(doc(medicalDb, 'organizations/wmgj/hospitalAccounts/hospital-beta'))
  );
  await assertFails(
    getDoc(doc(viewerDb, 'organizations/wmgj/dashboardSnapshots/dash-beta'))
  );
});

test('consulta de membro limitado exige filtro compatível com facility scope', async () => {
  const db = env.authenticatedContext('operator').firestore();
  const records = collection(db, 'organizations/wmgj/productivityRecords');

  await assertSucceeds(
    getDocs(query(records, where('facilityId', '==', 'facility-alpha'), limit(20)))
  );
  await assertFails(getDocs(query(records, limit(20))));
});

test('actionItems são legíveis, mas toda escrita do cliente é negada', async () => {
  const operatorDb = env.authenticatedContext('operator').firestore();
  const adminDb = env.authenticatedContext('admin').firestore();
  const existing = doc(adminDb, 'organizations/wmgj/actionItems/action-alpha');

  await assertSucceeds(
    getDoc(doc(operatorDb, 'organizations/wmgj/actionItems/action-alpha'))
  );
  await assertFails(
    setDoc(doc(adminDb, 'organizations/wmgj/actionItems/action-new'), {
      orgId: 'wmgj',
      facilityId: 'facility-alpha',
      status: 'OPEN'
    })
  );
  await assertFails(setDoc(existing, { status: 'DONE' }, { merge: true }));
  await assertFails(deleteDoc(existing));
});

test('dashboardSnapshots também negam toda escrita do cliente', async () => {
  const db = env.authenticatedContext('admin').firestore();
  await assertFails(
    setDoc(doc(db, 'organizations/wmgj/dashboardSnapshots/client-write'), {
      sanitized: true,
      sensitivity: 'INTERNAL'
    })
  );
});

test('apiIdempotency é invisível e imutável até para admin', async () => {
  const db = env.authenticatedContext('admin').firestore();
  const token = doc(db, 'organizations/wmgj/apiIdempotency/secret-token');
  await assertFails(getDoc(token));
  await assertFails(setDoc(token, { requestHash: 'changed' }, { merge: true }));
  await assertFails(deleteDoc(token));
});

test('auditEvents continuam sem escrita direta', async () => {
  const db = env.authenticatedContext('admin').firestore();
  await assertSucceeds(
    getDoc(doc(db, 'organizations/wmgj/auditEvents/audit-alpha'))
  );
  await assertFails(
    setDoc(doc(db, 'organizations/wmgj/auditEvents/fake'), {
      orgId: 'wmgj',
      action: 'CLIENT_WRITE'
    })
  );
});

test('nega leitura cruzada entre organizações', async () => {
  const db = env.authenticatedContext('admin').firestore();
  await assertFails(
    getDoc(doc(db, 'organizations/other/sourceDocuments/source-other'))
  );
});

test('organização inativa ou sem active=true bloqueia membros e dados', async () => {
  const disabledDb = env.authenticatedContext('org-disabled').firestore();
  const missingFlagDb = env.authenticatedContext('org-active-missing').firestore();

  for (const [db, orgId, recordId] of [
    [disabledDb, 'inactive-org', 'op-disabled'],
    [missingFlagDb, 'legacy-org', 'op-missing-active']
  ]) {
    await assertFails(getDoc(doc(db, `organizations/${orgId}`)));
    await assertFails(
      getDoc(doc(db, `organizations/${orgId}/productivityRecords/${recordId}`))
    );
  }
});

test('nega membro inativo e coleção desconhecida', async () => {
  const inactiveDb = env.authenticatedContext('inactive').firestore();
  const adminDb = env.authenticatedContext('admin').firestore();

  await assertFails(
    getDoc(doc(inactiveDb, 'organizations/wmgj/dashboardSnapshots/dash-alpha'))
  );
  await assertFails(
    getDoc(doc(adminDb, 'organizations/wmgj/privateData/secret'))
  );
});
