# CHELFEx shared recommendation contract

Policy: AURORA-CHELFEX-001 / 1.1.1-candidate. Supersedes the unvalidated initial adapter in PR #358, not the operational release pointer.

## Trust boundary
The pure adapter accepts a closed request and a separate server-owned boundary. Request JSON cannot supply identity, scope filtering, source verification, grants or executors. The two canonical cloud callers create the boundary only after requireAccess and visibleProjection. Local imports remain unverified even when their data-readiness checks pass. A scope mismatch blocks the planner and its ancillary projections.

## Evidence and risk
Each conclusion has a stable ID and exact source/path references. A verified source alone is not a verified arbitrary claim: FACT additionally requires a server-owned binding to the exact statement and references. Revocation, missing expiry, stale/future observations, duplicate IDs and unknown fields fail closed. Unknown values are not zero. Policy metadata is recursively immutable and hashed from the executable policy. Operation-derived risk R0-R4 cannot be downgraded by a request. Every output remains recommendation-only, with executionAuthorized=false and executionState=NOT_RUN. R2-R4 declare execution blockers and required gates; no executor is linked.

## Shared packaging
Cloud Functions and the Windows package compile the same TypeScript dependency graph. The current IA package contains 41 payload files plus manifest.json; exact historical 40/39-file updater profiles are preserved. The current package requires kernel/auroraChelflex.js. Package tests retain source/hash checks and do not loosen signature, activation or canonical-readback requirements.

## Reproducible verification
- Functions: npm ci --ignore-scripts; npm run build; npm test.
- Directed contract tests: node --import tsx --test test/auroraChelflex.test.ts.
- Package: python desktop/ia-master/build.py --output a-new-isolated-directory.
- Actual compiled parity and HTTP boundary: set AURORA_TEST_BUILD to that directory; run node --test --test-name-pattern=CHELFEx desktop/ia-master/server.test.cjs after compiling Functions.
- AURORA_CHELFEX_READBACK optionally writes a synthetic-only test receipt. It includes exact source revision, dirty flag, platform, policy, evidence, verification, negative authentication/tenant outcomes and executor-call count. It does not prove cloud deployment.
- Installer CI includes Linux package regressions and a Windows/Node22 synthetic readback job. Existing CodeQL, Functions, emulator security-rules and release checks remain required.

## Promotion and limits
A passing build, synthetic HTTP response, automated review or CI is not deployment or independent human approval. The adapter does not assert either. Release publication must use the existing exact-main, source-bound CI, protected environment, applicable review, signed canonical release and authenticated readback gates. No source or policy in this change authorizes financial movement, clinical decisions or unrestricted code execution. No customer data is needed for these tests.
