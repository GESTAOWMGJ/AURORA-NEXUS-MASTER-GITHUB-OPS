import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../wmgj_api/static/", import.meta.url);

async function readStatic(name) {
  return readFile(new URL(name, staticRoot), "utf8");
}

test("dashboard declara escopo, estados independentes e modo demo", async () => {
  const html = await readStatic("dashboard.html");

  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /id="transport-value"/);
  assert.match(html, /id="freshness-value"/);
  assert.match(html, /id="completeness-value"/);
  assert.match(html, /id="severity-value"/);
  assert.match(html, /dados integralmente sintéticos/i);
  assert.match(html, /id="org-input"/);
  assert.match(html, /id="competence-input"/);
  assert.match(html, /\/assets\/dashboard\.css/);
  assert.match(html, /\/assets\/dashboard\.js/);
});

test("cliente permanece somente leitura e sem persistência local", async () => {
  const javascript = await readStatic("dashboard.js");

  assert.match(javascript, /const POLL_INTERVAL_MS = 60_000;/);
  assert.match(javascript, /method: "GET"/);
  assert.match(javascript, /cache: "no-store"/);
  assert.match(javascript, /"X-Firebase-AppCheck": authContext\.appCheckToken/);
  assert.match(javascript, /Authorization: `Bearer \$\{authContext\.idToken\}`/);
  assert.match(javascript, /organizations\/\{orgId\}\/dashboards\/operational/);
  assert.doesNotMatch(javascript, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(javascript, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  for (const field of [
    "facilityId",
    "asOf",
    "policyVersion",
    "pendingHumanReview",
    "duplicateEvents",
    "billedAmount",
    "reconciliationDifference",
    "criticalFindings",
    "evidenceGaps",
    "lastSuccessAt",
    "freshness",
    "expectedCadenceSeconds",
    "staleAfterSeconds",
    "missing",
    "evidenceRefs",
  ]) {
    assert.match(javascript, new RegExp(field));
  }
  assert.match(javascript, /— · não aferid[oa]/);
});

test("estilos preservam foco, toque, movimento reduzido e alto contraste", async () => {
  const css = await readStatic("dashboard.css");

  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
});
