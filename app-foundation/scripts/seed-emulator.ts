import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST ausente. Este script recusa escrita fora do emulador.",
  );
}

const projectId = process.env.GCLOUD_PROJECT ?? "wmgj-master-data-demo";
const app = getApps()[0] ?? initializeApp({ projectId });
const db = getFirestore(app);
const tenantId = "wmgj-demo";
const uid = "demo-auditor";
const now = Timestamp.now();

const batch = db.batch();
batch.set(db.doc(`tenants/${tenantId}`), {
  displayCode: "WMGJ-DEMO",
  status: "ACTIVE",
  schemaVersion: 1,
  createdAt: now,
});
batch.set(db.doc(`tenants/${tenantId}/members/${uid}`), {
  status: "ACTIVE",
  roles: ["AUDITOR"],
  permissions: [
    "sources.read",
    "operations.read",
    "operations.command",
    "validation.read",
    "validation.open",
    "dashboard.read",
    "reports.read",
    "audit.read",
  ],
  allSites: true,
  siteIds: [],
  expiresAt: Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000),
  revision: 1,
});
batch.set(db.doc(`tenants/${tenantId}/dashboard_snapshots/current`), {
  tenantId,
  siteId: null,
  dashboardKey: "operational",
  periodStart: now,
  status: "ATENCAO",
  pipeline: {
    pendentes: 4,
    processando: 1,
    processados: 28,
    duplicados: 2,
    erros: 1,
    revisaoHumana: 3,
  },
  schemaVersion: 1,
  generatedAt: now,
});
batch.set(db.doc(`tenants/${tenantId}/validation_tasks/task-demo-001`), {
  tenantId,
  siteId: null,
  sourceId: "source-demo-001",
  category: "financeiro",
  priority: 80,
  status: "OPEN",
  assignedToUid: null,
  dueAt: Timestamp.fromMillis(now.toMillis() + 4 * 60 * 60 * 1000),
  revision: 1,
  createdAt: now,
});
batch.set(db.doc(`tenants/${tenantId}/audit_events/event-demo-001`), {
  tenantId,
  siteId: null,
  aggregateType: "SOURCE",
  aggregateId: "source-demo-001",
  sequence: 1,
  action: "SOURCE_CAPTURED",
  actorKind: "SERVICE",
  actorUid: "seed-emulator",
  occurredAt: now,
  correlationId: "00000000-0000-4000-8000-000000000001",
  reasonCode: "SYNTHETIC_FIXTURE",
  prevEventHash: "GENESIS",
  eventHash: "synthetic-not-for-production",
});

await batch.commit();
process.stdout.write(
  `Seed sintético aplicado ao emulador: tenant=${tenantId}, uid=${uid}\n`,
);
