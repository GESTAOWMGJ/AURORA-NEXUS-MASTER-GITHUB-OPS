/** CHELFEx-Aurora: pure, proposal-only contract. Never call tools or executors. */
import { createHash } from "node:crypto";
export const CHELFEX_POLICY = Object.freeze({
  id: "AURORA-CHELFEX-001", version: "1.1.0-candidate",
  mode: "RECOMMENDATION_ONLY", executionEnabled: false,
  risk: ["R0", "R1", "R2", "R3", "R4"] as const,
  requirements: {
    R0: [] as string[], R1: ["REVIEW_BEFORE_APPLY"],
    R2: ["SERVER_AUTHORIZATION", "ISOLATED_CHANGE", "TESTS", "ROLLBACK"],
    R3: ["SERVER_AUTHORIZATION", "MFA_IF_REQUIRED", "INDEPENDENT_REVIEW", "HML", "ROLLBACK", "READBACK"],
    R4: ["HUMAN_INTERVENTION", "NO_EXECUTION"]
  }
});
export const CHELFEX_POLICY_SHA256 = createHash("sha256").update(JSON.stringify(CHELFEX_POLICY)).digest("hex");
type Risk = "R0" | "R1" | "R2" | "R3" | "R4";
type Evidence = { id: string; tenantId: string; sourceHash: string; verified: boolean; revoked: boolean; validUntil: string | null; observedAt: string };
type Conclusion = { statement: string; kind: "FACT" | "INFERENCE" | "PENDING"; evidenceIds: string[] };
type Input = { tenantId: string; contextVerified: boolean; objective: string; requestedRisk: Risk; evidence: Evidence[]; conclusions: Conclusion[] };
const keys = (value: unknown, allowed: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every(k => allowed.includes(k)) && allowed.every(k => Object.hasOwn(value, k));
const iso = (v: string) => !Number.isNaN(Date.parse(v)) && /^\d{4}-\d\d-\d\dT/.test(v);
const sha = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9:_./-]{1,128}$/.test(v);
function decode(raw: unknown): Input {
  if (!keys(raw, ["tenantId", "contextVerified", "objective", "requestedRisk", "evidence", "conclusions"]) ||
    !id(raw.tenantId) || typeof raw.contextVerified !== "boolean" ||
    typeof raw.objective !== "string" || !raw.objective.trim() || raw.objective.length > 1000 ||
    !CHELFEX_POLICY.risk.includes(raw.requestedRisk as Risk) ||
    !Array.isArray(raw.evidence) || raw.evidence.length > 100 ||
    !Array.isArray(raw.conclusions) || raw.conclusions.length > 100) throw Error("CHELFEX_SCHEMA_REJECTED");
  for (const e of raw.evidence) {
    if (!keys(e, ["id", "tenantId", "sourceHash", "verified", "revoked", "validUntil", "observedAt"]) ||
      !id(e.id) || !id(e.tenantId) || !sha(e.sourceHash) ||
      typeof e.verified !== "boolean" || typeof e.revoked !== "boolean" ||
      (e.validUntil !== null && (typeof e.validUntil !== "string" || !iso(e.validUntil))) ||
      typeof e.observedAt !== "string" || !iso(e.observedAt)) throw Error("CHELFEX_EVIDENCE_REJECTED");
  }
  for (const c of raw.conclusions) {
    if (!keys(c, ["statement", "kind", "evidenceIds"]) ||
      typeof c.statement !== "string" || !c.statement.trim() || c.statement.length > 2000 ||
      !["FACT", "INFERENCE", "PENDING"].includes(c.kind) ||
      !Array.isArray(c.evidenceIds) || c.evidenceIds.length > 100 ||
      !c.evidenceIds.every(id)) throw Error("CHELFEX_CONCLUSION_REJECTED");
  }
  return raw as unknown as Input;
}
/** Caller MUST first authenticate, enforce tenant scope and apply native data governance. */
export function evaluateChelflex(raw: unknown, verifiedTenantId: string, now: Date = new Date()) {
  const input = decode(raw);
  if (!id(verifiedTenantId) || input.tenantId !== verifiedTenantId) throw Error("CHELFEX_TENANT_REJECTED");
  if (!Number.isFinite(now.getTime())) throw Error("CHELFEX_TIME_INVALID");
  const evidence = new Map<string, Evidence>();
  for (const e of input.evidence) {
    if (e.tenantId !== verifiedTenantId || evidence.has(e.id)) throw Error("CHELFEX_EVIDENCE_SCOPE_REJECTED");
    evidence.set(e.id, e);
  }
  const eligible = (e: Evidence) => e.verified && !e.revoked &&
    Date.parse(e.observedAt) <= now.getTime() &&
    (e.validUntil === null || Date.parse(e.validUntil) >= now.getTime());
  const conclusions = input.conclusions.map(c => {
    const selected = c.evidenceIds.map(k => evidence.get(k));
    const supported = input.contextVerified && c.evidenceIds.length > 0 &&
      selected.every((e): e is Evidence => !!e && eligible(e));
    const state = c.kind === "FACT" && !supported ? "PENDING" : c.kind;
    return { statement: c.statement, kind: state, evidenceIds: [...c.evidenceIds],
      verification: supported ? "VERIFIED_SOURCE" : "NOT_VERIFIED",
      blockers: supported ? [] : ["MISSING_REVOKED_STALE_OR_UNVERIFIED_EVIDENCE"] };
  });
  const risk = input.requestedRisk;
  const blockers = [
    ...(!input.contextVerified ? ["CONTEXT_NOT_VERIFIED"] : []),
    ...(risk === "R4" ? ["R4_STOP"] : []),
    ...(conclusions.some(c => c.verification !== "VERIFIED_SOURCE") ? ["EVIDENCE_REVIEW_REQUIRED"] : [])
  ];
  return {
    contract: CHELFEX_POLICY.id, version: CHELFEX_POLICY.version, policySha256: CHELFEX_POLICY_SHA256,
    tenantScope: verifiedTenantId, objective: input.objective, riskLevel: risk,
    mode: "RECOMMENDATION_ONLY" as const, applied: false, executionAuthorized: false,
    executionState: "NOT_RUN" as const, verification: input.contextVerified ? "CONTEXT_VERIFIED" : "CONTEXT_UNVERIFIED",
    requiredGates: [...CHELFEX_POLICY.requirements[risk]], blockers,
    evidence: input.evidence.map(e => ({ id: e.id, sourceHash: e.sourceHash, eligible: eligible(e) })),
    conclusions
  };
}
