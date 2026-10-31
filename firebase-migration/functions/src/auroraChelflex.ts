/** Pure CHELFEx adapter. The authenticated caller supplies the separate boundary.
 * JSON, prompts, documents and this receipt are never capabilities or commands. */
import { createHash } from "node:crypto";

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const CHELFEX_POLICY = freeze({
  id: "AURORA-CHELFEX-001", version: "1.1.1-candidate",
  mode: "RECOMMENDATION_ONLY", executionEnabled: false,
  maxEvidenceAgeMs: 30 * 60 * 1000,
  risk: ["R0", "R1", "R2", "R3", "R4"] as const,
  operationRisk: {
    READ_STATE: "R0", PROPOSE: "R1", REVERSIBLE_CHANGE: "R2",
    PRODUCTION_DEPLOY: "R3", OPERATIONAL_INGEST: "R3", PERMISSION_CHANGE: "R3", CLIENT_DATA_CHANGE: "R3",
    FINANCIAL_OBLIGATION: "R4", CLINICAL_DECISION: "R4", IRREVERSIBLE_CHANGE: "R4", UNKNOWN: "R4"
  } as const,
  requirements: {
    R0: [] as string[], R1: ["REVIEW_BEFORE_APPLY"],
    R2: ["SERVER_AUTHORIZATION", "ISOLATED_CHANGE", "TESTS", "ROLLBACK"],
    R3: ["SERVER_AUTHORIZATION", "MFA_IF_REQUIRED", "INDEPENDENT_REVIEW", "HML", "ROLLBACK", "READBACK"],
    R4: ["HUMAN_INTERVENTION", "NO_EXECUTION"]
  }
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const CHELFEX_POLICY_SHA256 = hash(JSON.stringify(CHELFEX_POLICY));
export type ChelfexRisk = typeof CHELFEX_POLICY.risk[number];
export type ChelfexOperation = keyof typeof CHELFEX_POLICY.operationRisk;
type Ref = { id: string; path: string };
type Conclusion = { id: string; statement: string; kind: "FACT" | "INFERENCE" | "PENDING"; evidenceRefs: Ref[] };
type Input = { tenantId: string; objective: string; requestedRisk: ChelfexRisk; conclusions: Conclusion[] };
export type ChelfexEvidence = {
  id: string; tenantId: string; sourceHash: string; verified: boolean; revoked: boolean;
  observedAt: string; validUntil: string | null; verifiedClaimHashes: string[];
};
/** Server-owned arguments, never copied from a request body. Not an auth mechanism. */
export type ChelfexBoundary = {
  tenantId: string; authenticated: boolean; scopeFiltered: boolean;
  source: "FIREBASE_CANONICAL" | "LOCAL_IMPORT" | "UNVERIFIED";
  governanceDecision: "ALLOW" | "REVIEW" | "DENY";
  operation: ChelfexOperation; evidence: ChelfexEvidence[];
};
export function chelfexClaimHash(statement: string, refs: Ref[]): string {
  return hash(JSON.stringify({ statement, evidenceRefs: refs.map(r => ({ id: r.id, path: r.path })) }));
}
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_:.\/-]{1,128}$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) && v !== "0".repeat(64);
const list = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max
  && Reflect.ownKeys(v).length === v.length + 1
  && Array.from({ length: v.length }, (_, index) => Object.getOwnPropertyDescriptor(v, String(index)))
    .every(descriptor => descriptor !== undefined && Object.hasOwn(descriptor, "value"));
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const iso = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) return false;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString() === v.replace(/(?<!\.\d{3})Z$/, ".000Z");
};
function closed(value: unknown, names: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(value);
  return own.length === names.length && own.every(k => typeof k === "string" && names.includes(k)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, k) ?? {}, "value"));
}
function decode(raw: unknown): Input {
  if (!closed(raw, ["tenantId", "objective", "requestedRisk", "conclusions"]) || !id(raw.tenantId)
    || !text(raw.objective, 1000) || !CHELFEX_POLICY.risk.includes(raw.requestedRisk as ChelfexRisk)
    || !list(raw.conclusions, 100)) throw Error("CHELFEX_SCHEMA_REJECTED");
  const seen = new Set<string>();
  for (const c of raw.conclusions) {
    if (!closed(c, ["id", "statement", "kind", "evidenceRefs"]) || !id(c.id) || seen.has(c.id)
      || !text(c.statement, 2000) || typeof c.kind !== "string" || !["FACT", "INFERENCE", "PENDING"].includes(c.kind)
      || !list(c.evidenceRefs, 100)) throw Error("CHELFEX_CONCLUSION_REJECTED");
    seen.add(c.id);
    const refs = new Set<string>();
    for (const r of c.evidenceRefs) {
      if (!closed(r, ["id", "path"]) || !id(r.id) || typeof r.path !== "string"
        || !/^[A-Za-z0-9_.\[\]-]{1,256}$/.test(r.path) || refs.has(r.id + "|" + r.path)) throw Error("CHELFEX_REFERENCE_REJECTED");
      refs.add(r.id + "|" + r.path);
    }
  }
  return raw as unknown as Input;
}
function boundary(raw: unknown): ChelfexBoundary {
  if (!closed(raw, ["tenantId", "authenticated", "scopeFiltered", "source", "governanceDecision", "operation", "evidence"])
    || !id(raw.tenantId) || typeof raw.authenticated !== "boolean" || typeof raw.scopeFiltered !== "boolean"
    || typeof raw.source !== "string" || !["FIREBASE_CANONICAL", "LOCAL_IMPORT", "UNVERIFIED"].includes(raw.source)
    || typeof raw.governanceDecision !== "string" || !["ALLOW", "REVIEW", "DENY"].includes(raw.governanceDecision)
    || typeof raw.operation !== "string" || !Object.hasOwn(CHELFEX_POLICY.operationRisk, raw.operation)
    || !list(raw.evidence, 100)) throw Error("CHELFEX_BOUNDARY_REJECTED");
  const seen = new Set<string>();
  for (const e of raw.evidence) {
    if (!closed(e, ["id", "tenantId", "sourceHash", "verified", "revoked", "observedAt", "validUntil", "verifiedClaimHashes"])
      || !id(e.id) || seen.has(e.id) || e.tenantId !== raw.tenantId || !digest(e.sourceHash)
      || typeof e.verified !== "boolean" || typeof e.revoked !== "boolean" || !iso(e.observedAt)
      || (e.validUntil !== null && (!iso(e.validUntil) || Date.parse(e.validUntil) < Date.parse(e.observedAt)))
      || !list(e.verifiedClaimHashes, 100) || !e.verifiedClaimHashes.every(digest)) throw Error("CHELFEX_EVIDENCE_REJECTED");
    seen.add(e.id);
  }
  return raw as unknown as ChelfexBoundary;
}

/** Explicit clock, no IO, no executor, no provider and no authorization side effects. */
export function evaluateChelflex(raw: unknown, serverBoundary: unknown, now: Date) {
  const input = decode(raw), ctx = boundary(serverBoundary);
  if (input.tenantId !== ctx.tenantId) throw Error("CHELFEX_TENANT_REJECTED");
  const ms = now instanceof Date ? now.getTime() : NaN;
  const clockValid = Number.isFinite(ms);
  const contextVerified = ctx.authenticated && ctx.scopeFiltered && ctx.source === "FIREBASE_CANONICAL"
    && ctx.governanceDecision !== "DENY" && clockValid;
  const eligible = (e: ChelfexEvidence) => contextVerified && e.verified && !e.revoked
    && e.validUntil !== null && Date.parse(e.observedAt) <= ms && Date.parse(e.validUntil) > ms
    && ms - Date.parse(e.observedAt) <= CHELFEX_POLICY.maxEvidenceAgeMs;
  const evidence = new Map(ctx.evidence.map(e => [e.id, e]));
  const conclusions = input.conclusions.map(c => {
    const selected = c.evidenceRefs.map(r => evidence.get(r.id));
    const supported = c.evidenceRefs.length > 0 && selected.every(e => !!e && eligible(e));
    // A source link is not proof of an arbitrary statement. Exact claims need a server-owned binding.
    const claimVerified = supported && selected.every(e => e?.verifiedClaimHashes.includes(chelfexClaimHash(c.statement, c.evidenceRefs)));
    const kind = c.kind === "FACT" ? (!supported ? "PENDING" : claimVerified ? "FACT" : "INFERENCE") : c.kind;
    return { id: c.id, statement: c.statement, kind, requestedKind: c.kind,
      evidenceRefs: c.evidenceRefs.map(r => ({ ...r })),
      verification: !supported ? "NOT_VERIFIED" : c.kind === "FACT" && claimVerified ? "CLAIM_VERIFIED" : "SOURCE_VERIFIED_ONLY",
      blockers: !supported ? ["MISSING_REVOKED_STALE_OR_UNVERIFIED_EVIDENCE"]
        : c.kind === "FACT" && !claimVerified ? ["CLAIM_NOT_VERIFIED"] : [] };
  });
  const floor = CHELFEX_POLICY.operationRisk[ctx.operation];
  const risk = CHELFEX_POLICY.risk[Math.max(CHELFEX_POLICY.risk.indexOf(floor), CHELFEX_POLICY.risk.indexOf(input.requestedRisk))]!;
  const blockers = [
    ...(!contextVerified ? ["CONTEXT_NOT_VERIFIED"] : []), ...(!clockValid ? ["CLOCK_NOT_VERIFIED"] : []),
    ...(ctx.governanceDecision === "DENY" ? ["DATA_GOVERNANCE_DENIED"] : []),
    ...(ctx.governanceDecision === "REVIEW" ? ["DATA_REVIEW_REQUIRED"] : []),
    ...(["R2", "R3", "R4"].includes(risk) ? ["EXECUTION_NOT_AVAILABLE_IN_ADAPTER"] : []),
    ...(risk === "R4" ? ["R4_STOP"] : []),
    ...(conclusions.some(c => c.blockers.length > 0) ? ["EVIDENCE_REVIEW_REQUIRED"] : [])
  ];
  return {
    contract: CHELFEX_POLICY.id, version: CHELFEX_POLICY.version, policySha256: CHELFEX_POLICY_SHA256,
    tenantScope: ctx.tenantId, objective: input.objective, riskLevel: risk, riskBasis: ctx.operation,
    requestedRisk: input.requestedRisk, mode: "RECOMMENDATION_ONLY" as const,
    applied: false, executionAuthorized: false, executionState: "NOT_RUN" as const,
    authorization: "NOT_GRANTED", verification: contextVerified ? "CONTEXT_VERIFIED" : "CONTEXT_UNVERIFIED",
    verificationScope: "SERVER_BOUNDARY_AND_REFERENCED_EVIDENCE_ONLY",
    runtimeDeploymentVerified: false, independentReviewVerified: false,
    requiredGates: [...CHELFEX_POLICY.requirements[risk]], blockers,
    evidence: ctx.evidence.map(e => ({ id: e.id, sourceHash: e.sourceHash, observedAt: e.observedAt,
      validUntil: e.validUntil, revoked: e.revoked, eligible: eligible(e) })), conclusions
  };
}
