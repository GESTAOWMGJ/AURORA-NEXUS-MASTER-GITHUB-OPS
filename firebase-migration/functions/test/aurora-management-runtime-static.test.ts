import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtime = readFileSync(new URL("../src/auroraRuntime.ts", import.meta.url), "utf8");
const firebase = JSON.parse(readFileSync(new URL("../../firebase.json", import.meta.url), "utf8"));

test("management evidence and audit APIs are authenticated, scoped and bounded", () => {
  for (const symbol of ["auroraNexusEvidence", "auroraNexusAuditEvents"]) {
    assert.match(runtime, new RegExp(`export const ${symbol} = onRequest`));
  }
  assert.match(runtime, /requireAccess\(req, res\)/);
  assert.match(runtime, /organizations\/\$\{member\.orgId\}\/sourceDocuments/);
  assert.match(runtime, /orderBy\("updatedAt", "desc"\)/);
  assert.match(runtime, /limit\(EVIDENCE_SCAN_LIMIT\)/);
  assert.match(runtime, /organizations\/\$\{member\.orgId\}\/auditEvents/);
  assert.match(runtime, /orderBy\("occurredAt", "desc"\)/);
  assert.match(runtime, /limit\(AUDIT_SCAN_LIMIT\)/);
  assert.match(runtime, /slice\(0, AUDIT_EVENT_LIMIT\)/);

  const rewrites = firebase.hosting.rewrites as Array<{ source: string; function?: { functionId: string } }>;
  assert.equal(rewrites.find((item) => item.source === "/api/evidence")?.function?.functionId, "auroraNexusEvidence");
  assert.equal(rewrites.find((item) => item.source === "/api/audit-events")?.function?.functionId, "auroraNexusAuditEvents");
});

test("management target and action transition in one transaction without clearing evidence", () => {
  assert.match(runtime, /runTransaction/);
  assert.match(runtime, /command\.type === "CREATE_REVIEW" && !validEvidenceRef\(command\.targetId\)/);
  assert.match(runtime, /validateEvidenceSelection/);
  assert.match(runtime, /actionId: actionRef\.id/);
  assert.match(runtime, /actionId: actionRef\.id,\n\s+actorUid:/);
  assert.match(runtime, /revision: 1/);
  assert.match(runtime, /managerInputTransitionPatch/);
  assert.match(runtime, /tx\.update\(managerInputRef/);
  assert.doesNotMatch(runtime, /evidenceRefs: command\.type === "RESOLVE" \? command\.evidenceRefs : \[\]/);
  assert.match(runtime, /EVIDENCE_SET_MISMATCH/);
});

test("recent activity is served from auditEvents, not reconstructed from actions", () => {
  assert.doesNotMatch(runtime, /const recentActivity = safeActions/);
  assert.match(runtime, /publicAuditEvent/);
  assert.match(runtime, /auditEvents/);
});
