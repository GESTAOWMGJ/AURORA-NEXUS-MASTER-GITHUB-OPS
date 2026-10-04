import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.resolve(here, "../src/auroraRuntime.ts"), "utf8");
const frontend = fs.readFileSync(path.resolve(here, "../src/auroraFrontend.ts"), "utf8");
const firebase = fs.readFileSync(path.resolve(here, "../../firebase.json"), "utf8");
const workflow = fs.readFileSync(path.resolve(here, "../../../.github/workflows/deploy-aurora-firebase.yml"), "utf8");

test("motor mestre possui endpoint privado e contrato Firebase nativo", () => {
  const block = runtime.slice(runtime.indexOf("export const auroraNexusMasterEngine"), runtime.indexOf("export const auroraNexusRefresh"));
  assert.match(block, /FIREBASE_NATIVE_SNAPSHOT_REQUIRED/);
  assert.match(block, /FIREBASE_NATIVE_CONTRACT_REQUIRED/);
  assert.match(block, /sourceAccessDuringInference:\\s*false/);
  assert.match(block, /externalAiUsed:\\s*false/);
  assert.doesNotMatch(block, /openai|gemini|anthropic/i);
  assert.doesNotMatch(block, /readProjectionSource/);
});

test("interface promove o motor mestre como controle primário", () => {
  assert.match(frontend, /Motor Mestre Operacional/);
  assert.match(frontend, /id="master-operational"/);
  assert.match(frontend, /\\/api\\/master-engine/);
  assert.match(frontend, /não depende de GPT, Gemini ou outro provedor externo/i);
});

test("hosting e deploy protegido incluem o motor mestre", () => {
  assert.match(firebase, /"source": "\\/api\\/master-engine"/);
  assert.match(firebase, /"functionId": "auroraNexusMasterEngine"/);
  assert.match(workflow, /functions:auroraNexusMasterEngine/);
  assert.match(workflow, /"auroraNexusMasterEngine"/);
  assert.match(workflow, /master\\.externalAiRequired == false/);
  assert.match(workflow, /master\\.governance\\.arbitraryCodeExecution == false/);
});
