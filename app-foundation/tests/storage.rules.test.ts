import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadString } from "firebase/storage";
import { afterAll, beforeAll, describe, it } from "vitest";

const projectId = "wmgj-master-data-demo";
let environment: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = fileURLToPath(new URL("../storage.rules", import.meta.url));
  const rules = await readFile(rulesPath, "utf8");
  environment = await initializeTestEnvironment({
    projectId,
    storage: { host: "127.0.0.1", port: 9199, rules },
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe("storage.rules", () => {
  it("nega upload direto mesmo para usuário autenticado", async () => {
    const storage = environment.authenticatedContext("user-a").storage();
    await assertFails(
      uploadString(ref(storage, "tenants/tenant-a/evidence/demo.txt"), "demo"),
    );
  });

  it("nega download direto sem autenticação", async () => {
    const storage = environment.unauthenticatedContext().storage();
    await assertFails(
      getBytes(ref(storage, "tenants/tenant-a/evidence/demo.txt")),
    );
  });
});
