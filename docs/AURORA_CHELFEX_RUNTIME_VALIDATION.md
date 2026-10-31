# CHELFEx 1.1.2-rc.5 ? consolidated review candidate

## Canonical baseline and compatibility
PR #347 merged the canonical auroraChelfex.ts API into main at eef855d8ffbfd5ca63d3410bfba1cefd4863a48f. PR #358 now incorporates that main through a normal merge, preserving both histories and the installed product lineage. Its earlier alternate auroraChelflex.ts module and duplicate API were removed, rather than shipping two incompatible policies or kernels. The production source tree and signed package retain exactly one CHELFEx module and the established task.v1 envelope. No dependency, database, executor, collector, IAM rule or deployment authorization is added.

The canonical contract has fixed native findings; arbitrary supplied conclusions are not accepted. Schema, operation names and output fields from main are preserved. Policy version is 1.1.2-rc.5, explicitly a release candidate, not GA, certification or operational deployment. Exact hashes and CI receipts belong to the corresponding commit, not an earlier green run.

## Changes and reproduced regressions
1. Data-only boundaries: reject unknown/hidden/symbol properties, getters, proxies and custom prototypes without executing them. Accept ordinary cross-realm and null-prototype records. Parse identity authority as an exact primitive enum, never String coercion. Copy only approved primitive task fields. A server-owned context is still mandatory; passing an internal object is not a new authentication mechanism.
2. Evidence integrity: reject null/malformed root snapshots, invalid/native-less clocks, all-zero provenance hashes and impossible calendar timestamps. Preserve existing governance freshness windows, tenant isolation, revocation and valid partial results. Context identity and evidence readiness remain different states.
3. Financial minimization: users without financial.read no longer trigger the financial closing lookup, and visibleProjection also removes reliableResult from the response. Existing authorized finance roles retain access. Tests exercise the actual GET route with synthetic identity/storage and the projection filter used by bootstrap.
4. Risk requirements: replace nested conditional selection with a frozen per-risk policy table included in the policy hash. R0-R4 classification remains operation-derived. Every outcome is recommendation-only and executionAllowed=false.

## Boundary and non-goals
Input task/context are closed data records. Snapshot values originate from the authenticated, filtered canonical data plane; this module is not a JavaScript sandbox, signature verifier or universal authorizer. Internal identity metadata cannot replace requireAccess, membership, facility filtering, MFA or canonical source retrieval. No real tenant/patient data is used by the tests. No generated text is an executor capability. Missing evidence remains pending, never zero. A successful data gate proves only that its checks passed, not that every document is true or that a cloud deployment occurred.

## Reproducible checks
From firebase-migration/functions:
- npm ci --ignore-scripts
- npm run build && npm run lint
- node --import tsx --test test/aurora-chelfex*.test.ts test/aurora-master-engine.test.ts test/aurora-reliable-result.test.ts
- npm test (complete Linux CI also runs Rules, Python/API, updater and installer regressions)
- node --import tsx --test --experimental-test-coverage '--test-coverage-include=**/auroraChelfex.ts' test/aurora-chelfex*.test.ts
- node ../scripts/chelfex-synthetic-readback.cjs

The existing organic workflow runs the same contract/runtime suite on Linux and native Windows/Node22, retaining JSON readback. The existing installer workflow verifies the exact 41-file payload, hashes and historical updater profiles. Coverage is diagnostic, not a proof of absence of defects; counts overlap between suites.

## Independent review handoff
Review the exact final candidate against its recorded main base. Re-run closed-schema adversarial fixtures, identity/scope negative tests, finance-role minimization, risk/receipt invariants, source revocation/freshness and compiled Windows parity. Check that only auroraChelfex.ts is built, that the policy mirror agrees byte-for-byte in meaning with the executable policy, and that changes outside the increment were retained. Report actionable findings with file/line, reproducible case, risk and remediation. Distinguish automated review, independent human approval, CI, synthetic local evaluation, real authenticated HML and production. Do not authorize a merge or deployment from this document alone.

## Rollback and remaining release gates
A review rejection leaves this branch isolated. After any future authorized merge, revert this increment using reviewed Git history and rebuild the same signed package; no data migration is involved. Operational rollout still needs applicable review, exact-source CI, protected environment approval, predecessor/rollback evidence and authenticated cloud readback. This candidate does not renew any old HML, Drive, credential or risk-acceptance window.

## Separate-review correction
The first automated review reproduced loss of valid action counts/SLA findings when a partial financial snapshot was redacted before readiness validation. This was a regression in the first candidate, not a justification to expose amounts. The corrected pipeline validates the canonical snapshot inside the authenticated tenant path, then uses the same financial-redaction helper before inference and serialization. Both bootstrap and master pass a server-derived restriction; no client-supplied readiness flag is trusted. New positive/negative tests retain operational counts and SLA findings while withholding all financial amounts, and preserve DENY for tampered, stale or revoked subset proofs. Review and CI for a previous SHA are not final approval of this correction.

A second separate review reproduced severity escalation after redaction even when the data assessment stayed REVIEW. The native insight function now derives the non-monetary partial-readiness boolean directly from the canonical validated subset before masking amounts; it never trusts a supplied snapshot readiness marker. Every downstream intent uses this shared boundary. Regression assertions now require ATTENTION/PRIORIZAR, zero critical findings and HIGH (not CRITICAL) financial-quality severity for valid partial records under restricted roles, plus no monetary values in any returned insight. Tampered or missing subset proof remains critical/denied.

The third review traced the same readiness contract to the separate native-insight GET route. That route now passes the authenticated canonical snapshot and server-derived financial restriction to the shared inference boundary, matching bootstrap and master. Actual-handler tests cover all five intents, restricted and authorized roles, method/authentication/facility/intent failures, forged redaction overrides, zero writes and input immutability. All production call sites of generateNativeInsight and visibleProjection were enumerated; refresh uses redaction only when returning its response, not as an inference input.

The fourth review tested revocation and freshness on the standalone native-insight route. Arithmetic consistency alone was insufficient to restore partial-readiness claims. Partial availability now also requires the canonical governance assessment, and the authenticated native-insight handler rejects mismatched tenants and any DENY assessment before inference, using one shared clock. New cases cover revoked, stale, future, foreign, tampered and provenance-missing snapshots for viewer/operator/auditor roles; all reject without findings, financial lookups or writes. Direct redacted inference likewise cannot advertise partial availability from revoked/stale sources.

## Independent current-main reconciliation — 2026-10-31

Review inputs: candidate `c09cdb4d6771f86396d831a20c7d2835127b8db1` and
main `8afda9fd28f963ebb663673b9c6c0a3324381a7d`. Their normal merge is
conflict-free. All #365 release-path, installed-proof and owner-policy changes
are preserved; only the reproducible writer inventory needs regeneration.

Two additional adversarial reproductions failed before correction:

1. **Tenant response boundary (high, conditional on a wrongly materialized
   snapshot):** bootstrap serialized a snapshot whose embedded orgId differed
   from authenticated membership. CHELFEx refused its evidence, but the sibling
   projection response still disclosed it. Bootstrap and master now return 409
   before serialization/inference for this mismatch, matching native insight.
   This does not demonstrate unauthorized Firestore writes or a production leak.
2. **Inconsistent provenance gates (medium):** native insight accepted an all-zero
   SHA-256 placeholder even though CHELFEx rejected it. Master could likewise
   produce priorities next to a blocked CHELFEx receipt. The existing shared
   data-governance gate now rejects placeholders. Its timestamp check reuses the
   same canonical UTC/calendar validator as CHELFEx; impossible dates cannot
   become normalized current evidence. Governance policy is version 1.1.1.

The two failing route regressions pass after correction. An additional
master/CHELFEx impossible-date regression passes. Build/typecheck and the expanded
281-case directed suite pass locally (Node 24); Node 22 and exact-source CI are
separate receipts. Initial broad local run had three YAML-test failures caused
by absent Ruby, not passing evidence for those tests. No tests were disabled.

The CHELFEx 1.1.2-rc.5 policy table/hash and task.v1 envelope are unchanged. There
is still one auroraChelfex.ts module; timestamp validation moved into existing
data governance, not a second kernel. The lexical writer inventory retains 169
candidate files / 1314 locations, without claiming installed enforcement.

Review limitations: authenticated canonical storage is the trust root; enum
metadata and a nonzero hash do not cryptographically authenticate arbitrary
internal objects. Snapshot nested objects are not a JavaScript sandbox. Route
fixtures substitute identity/storage and are not a real authenticated HML test.
Native Windows CI and installation/readback remain distinct. This review is not
human GitHub approval, certification, merge or deployment authorization.
