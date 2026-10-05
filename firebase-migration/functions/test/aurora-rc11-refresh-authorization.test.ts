import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { DecodedIdToken } from "firebase-admin/auth";
import { can, resolveMember, type AuroraMember } from "../src/auroraAccess.js";
import { auroraDb } from "../src/firebase.js";

const runtime = readFileSync(new URL("../src/auroraRuntime.ts", import.meta.url), "utf8");
const workflowPath = fileURLToPath(new URL("../../../.github/workflows/aurora-rc11-post-ingest-finalize.yml", import.meta.url));
const workflow = readFileSync(workflowPath, "utf8");
const refresh = runtime.slice(runtime.indexOf("export const auroraNexusRefresh"), runtime.indexOf("export const auroraNexusAction"));
const refreshRoles = ["platform_admin", "org_admin", "director", "auditor"];

function member(role: string, permissions: string[] = []): AuroraMember {
  return { uid: "synthetic-smoke", email: "smoke@example.invalid", orgId: "wmgj", role, permissions, facilityIds: [], allFacilities: true, mfaVerified: false };
}

function claimedAdmin(): DecodedIdToken {
  return {
    aud: "synthetic-project", auth_time: 1, exp: 2, iat: 1,
    iss: "https://securetoken.google.com/synthetic-project",
    sub: "synthetic-smoke", uid: "synthetic-smoke", email: "smoke@example.invalid",
    firebase: { identities: {}, sign_in_provider: "custom" },
    role: "platform_admin", permissions: ["dashboard.refresh"], orgId: "different-org"
  };
}

test("refresh keeps its exact capability gate before any projection write", () => {
  const match = refresh.match(/can\(member,\s*"dashboard\.refresh",\s*(\[[^\]]+\])\)/);
  assert.ok(match?.[1]);
  assert.deepEqual(JSON.parse(match[1]), refreshRoles);
  const access = refresh.indexOf("await requireAccess(req, res)");
  const csrf = refresh.indexOf("if (!validCsrf(");
  const permission = refresh.indexOf('if (!can(member, "dashboard.refresh"');
  const write = refresh.indexOf("await refreshProjection(");
  assert.ok(access >= 0 && csrf > access && permission > csrf && write > permission);
  assert.match(refresh.slice(permission, write), /code: "PERMISSION_DENIED"[^\n]*return;/);
  assert.match(runtime, /else if \(!member\.allFacilities\) res\.status\(403\)\.json\(\{ ok: false, code: "ORG_WIDE_SCOPE_REQUIRED" \}\)/);
});

test("read-only roles and unrelated or wildcard permissions cannot refresh", () => {
  for (const role of ["viewer", "operator", "finance", "unknown"]) {
    for (const permissions of [[], ["dashboard.read", "financial.read"], ["dashboard.*"], ["*"], ["DASHBOARD.REFRESH"]]) {
      assert.equal(can(member(role, permissions), "dashboard.refresh", refreshRoles), false, `${role}:${permissions.join(",")}`);
    }
  }
});

test("existing privileged roles retain refresh without an IAM or MFA shortcut", () => {
  for (const role of refreshRoles) {
    assert.equal(can(member(role), "dashboard.refresh", refreshRoles), true, role);
  }
});

test("the existing exact application grant is supported but does not grant other actions", () => {
  const granular = member("viewer", ["dashboard.refresh"]);
  assert.equal(can(granular, "dashboard.refresh", refreshRoles), true);
  assert.equal(can(granular, "actions.write", refreshRoles), false);
  assert.equal(can(granular, "financial.read", refreshRoles), false);
});

test("Firestore membership, not custom role claims, determines effective authorization", async (t) => {
  const reads: string[] = [];
  t.mock.method(auroraDb, "doc", (path: string) => {
    reads.push(path);
    assert.ok(["organizations/wmgj", "organizations/wmgj/members/synthetic-smoke"].includes(path));
    const data = path === "organizations/wmgj" ? { active: true } : {
      active: true, role: "viewer", permissions: ["dashboard.read", 7],
      facilityIds: [], allFacilities: false
    };
    return { get: async () => ({ exists: true, data: () => data }) } as unknown as ReturnType<typeof auroraDb.doc>;
  });
  const resolved = await resolveMember(claimedAdmin());
  assert.ok(resolved);
  assert.equal(resolved.role, "viewer");
  assert.equal(resolved.orgId, "wmgj");
  assert.deepEqual(resolved.permissions, ["dashboard.read"]);
  assert.equal(resolved.allFacilities, false);
  assert.equal(resolved.mfaVerified, false);
  assert.equal(can(resolved, "dashboard.refresh", refreshRoles), false);
  assert.deepEqual(reads.sort(), ["organizations/wmgj", "organizations/wmgj/members/synthetic-smoke"]);
});

test("claims cannot revive a missing or inactive organization or membership", async (t) => {
  for (const blocked of ["missing-member", "inactive-member", "missing-org", "inactive-org"]) {
    await t.test(blocked, async (sub) => {
      sub.mock.method(auroraDb, "doc", (path: string) => {
        const isOrg = path === "organizations/wmgj";
        assert.ok(isOrg || path === "organizations/wmgj/members/synthetic-smoke");
        const exists = blocked !== (isOrg ? "missing-org" : "missing-member");
        const active = blocked !== (isOrg ? "inactive-org" : "inactive-member");
        return { get: async () => ({ exists, data: () => ({ active, role: "viewer", permissions: ["dashboard.read"] }) }) } as unknown as ReturnType<typeof auroraDb.doc>;
      });
      assert.equal(await resolveMember(claimedAdmin()), null);
    });
  }
});

test("post-ingest smoke uses the authenticated read path, not a privileged refresh", () => {
  const start = workflow.indexOf("      - name: Test native intelligence against real HML data");
  const end = workflow.indexOf("      - name: Verify final Apps Script kill switch", start);
  assert.ok(start >= 0 && end > start);
  const smoke = workflow.slice(start, end);
  assert.match(smoke, /signInWithCustomToken/);
  assert.match(smoke, /__sessionLogin/);
  assert.match(smoke, /--cookie "\$d\/cookies\.txt"/);
  assert.match(smoke, /for intent in REVENUE_RISK SLA_RISK NEXT_ACTION EXECUTIVE/);
  assert.match(smoke, /CANONICAL_NATIVE_SNAPSHOT_VERIFIED/);
  assert.match(smoke, /nativeDataPlane\.mapValue\.fields\.storage\.stringValue=="FIRESTORE"/);
  assert.match(smoke, /sourceAccessDuringInference\.booleanValue==false/);
  assert.doesNotMatch(smoke, /api\/refresh|X-Aurora-CSRF|refresh_csrf|setCustomUserClaims|dashboard\.refresh/);
  assert.doesNotMatch(smoke, /add-iam-policy-binding|set-iam-policy|\/members\/|(?:-X|--request)\s+(?:PATCH|PUT|DELETE)/);
});

test("post-ingest YAML, every run shell and critical step uniqueness are validated", () => {
  const parsed = spawnSync("ruby", ["-rjson", "-ryaml", "-e", "puts JSON.generate(YAML.load_file(ARGV.fetch(0)))", workflowPath], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  const document = JSON.parse(parsed.stdout) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> };
  const steps = document.jobs.finalize?.steps;
  assert.ok(steps);
  for (const name of ["Validate immutable post-ingest request", "Verify canonical native projection", "Test native intelligence against real HML data", "Verify final Apps Script kill switch"]) {
    assert.equal(steps.filter((step) => step.name === name).length, 1, name);
  }
  for (const step of steps) {
    if (typeof step.run !== "string") continue;
    const checked = spawnSync("bash", ["-n"], { input: step.run, encoding: "utf8" });
    assert.equal(checked.status, 0, `${step.name}: ${checked.stderr}`);
  }
  assert.ok(steps.findIndex((step) => step.name === "Verify canonical native projection") < steps.findIndex((step) => step.name === "Test native intelligence against real HML data"));
});
