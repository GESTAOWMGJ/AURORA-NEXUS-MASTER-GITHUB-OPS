import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "wmgj-master-data-demo";
let environment: RulesTestEnvironment;

async function seed(): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const future = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
    const past = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
    await setDoc(doc(firestore, "tenants/tenant-a"), {
      status: "ACTIVE",
    });
    await setDoc(doc(firestore, "tenants/tenant-a/members/user-a"), {
      status: "ACTIVE",
      permissions: [
        "dashboard.read",
        "validation.read",
        "audit.read",
        "shadow.read",
        "learning.read",
      ],
      allSites: true,
      siteIds: [],
      expiresAt: future,
    });
    await setDoc(doc(firestore, "tenants/tenant-a/members/user-site"), {
      status: "ACTIVE",
      permissions: ["dashboard.read", "validation.read", "audit.read", "shadow.read", "learning.read"],
      allSites: false,
      siteIds: ["site-alpha"],
      expiresAt: future,
    });
    await setDoc(doc(firestore, "tenants/tenant-a/members/user-expired"), {
      status: "ACTIVE",
      permissions: ["dashboard.read"],
      allSites: true,
      siteIds: [],
      expiresAt: past,
    });
    await setDoc(
      doc(firestore, "tenants/tenant-a/dashboard_snapshots/current"),
      { siteId: null, status: "OK" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/dashboard_snapshots/site-alpha"),
      { siteId: "site-alpha", status: "OK" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/dashboard_snapshots/site-beta"),
      { siteId: "site-beta", status: "OK" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/validation_tasks/task-1"),
      { siteId: null, status: "OPEN" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/audit_events/event-1"),
      { siteId: null, action: "SYNTHETIC" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/audit_events/event-alpha"),
      { siteId: "site-alpha", action: "SYNTHETIC" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/audit_events/event-beta"),
      { siteId: "site-beta", action: "SYNTHETIC" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/shadow_snapshots/snapshot-alpha"),
      { siteId: "site-alpha", status: "PASS" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/shadow_snapshots/snapshot-beta"),
      { siteId: "site-beta", status: "REVIEW_REQUIRED" },
    );
    await setDoc(
      doc(firestore, "tenants/tenant-a/learning_observations/learning-alpha"),
      { siteId: "site-alpha", status: "PENDING_HUMAN_REVIEW" },
    );
    await setDoc(doc(firestore, "tenants/tenant-b"), {
      status: "ACTIVE",
    });
    await setDoc(
      doc(firestore, "tenants/tenant-b/dashboard_snapshots/current"),
      { siteId: null, status: "OK" },
    );
  });
}

beforeAll(async () => {
  const rulesPath = fileURLToPath(new URL("../firestore.rules", import.meta.url));
  const rules = await readFile(rulesPath, "utf8");
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seed();
});

afterAll(async () => {
  await environment.cleanup();
});

describe("firestore.rules", () => {
  it("nega dashboard sem autenticação", async () => {
    const firestore = environment.unauthenticatedContext().firestore();
    await assertFails(
      getDoc(doc(firestore, "tenants/tenant-a/dashboard_snapshots/current")),
    );
  });

  it("permite leitura autorizada e limitada do dashboard", async () => {
    const firestore = environment
      .authenticatedContext("user-a")
      .firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(firestore, "tenants/tenant-a/dashboard_snapshots"),
          limit(50),
        ),
      ),
    );
  });

  it("exige limite de até 100 itens nas consultas", async () => {
    const firestore = environment.authenticatedContext("user-a").firestore();
    const snapshots = collection(
      firestore,
      "tenants/tenant-a/dashboard_snapshots",
    );

    await assertFails(getDocs(query(snapshots)));
    await assertFails(getDocs(query(snapshots, limit(101))));
  });

  it("restringe dashboard e auditoria à unidade explícita", async () => {
    const firestore = environment
      .authenticatedContext("user-site")
      .firestore();

    await assertSucceeds(
      getDoc(
        doc(
          firestore,
          "tenants/tenant-a/dashboard_snapshots/site-alpha",
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(firestore, "tenants/tenant-a/dashboard_snapshots/site-beta"),
      ),
    );
    await assertFails(
      getDoc(doc(firestore, "tenants/tenant-a/dashboard_snapshots/current")),
    );
    await assertSucceeds(
      getDocs(
        query(
          collection(firestore, "tenants/tenant-a/dashboard_snapshots"),
          where("siteId", "==", "site-alpha"),
          limit(50),
        ),
      ),
    );
    await assertSucceeds(
      getDoc(doc(firestore, "tenants/tenant-a/audit_events/event-alpha")),
    );
    await assertFails(
      getDoc(doc(firestore, "tenants/tenant-a/audit_events/event-beta")),
    );
    await assertFails(
      getDoc(doc(firestore, "tenants/tenant-a/audit_events/event-1")),
    );
  });

  it("nega membro expirado", async () => {
    const firestore = environment
      .authenticatedContext("user-expired")
      .firestore();
    await assertFails(
      getDoc(doc(firestore, "tenants/tenant-a/dashboard_snapshots/current")),
    );
  });

  it("nega escrita direta mesmo para membro ativo", async () => {
    const firestore = environment
      .authenticatedContext("user-a")
      .firestore();
    await assertFails(
      setDoc(
        doc(firestore, "tenants/tenant-a/validation_tasks/task-2"),
        { siteId: null, status: "OPEN" },
      ),
    );
  });

  it("nega leitura cruzada entre tenants", async () => {
    const firestore = environment
      .authenticatedContext("user-a")
      .firestore();
    await assertFails(
      getDoc(doc(firestore, "tenants/tenant-b/dashboard_snapshots/current")),
    );
  });

  it("nega alteração ou exclusão lógica de evento de auditoria", async () => {
    const firestore = environment
      .authenticatedContext("user-a")
      .firestore();
    await assertFails(
      setDoc(
        doc(firestore, "tenants/tenant-a/audit_events/event-1"),
        { siteId: null, action: "ALTERED" },
      ),
    );
  });

  it("restringe shadow e aprendizado à unidade e nega escrita direta", async () => {
    const firestore = environment.authenticatedContext("user-site").firestore();
    await assertSucceeds(
      getDoc(doc(firestore, "tenants/tenant-a/shadow_snapshots/snapshot-alpha")),
    );
    await assertFails(
      getDoc(doc(firestore, "tenants/tenant-a/shadow_snapshots/snapshot-beta")),
    );
    await assertSucceeds(
      getDoc(doc(firestore, "tenants/tenant-a/learning_observations/learning-alpha")),
    );
    await assertFails(
      setDoc(doc(firestore, "tenants/tenant-a/shadow_snapshots/direct-write"), {
        siteId: "site-alpha",
        status: "PASS",
      }),
    );
  });

  it("nega coleções privadas por padrão", async () => {
    const firestore = environment
      .authenticatedContext("user-a")
      .firestore();
    await assertFails(
      getDoc(doc(firestore, "tenants/tenant-a/private_data/secret-1")),
    );
  });
});
