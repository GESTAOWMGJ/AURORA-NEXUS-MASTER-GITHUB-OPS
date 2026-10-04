# AURORA NEXUS — Windows beta and coherent HML cloud surface

Base reviewed: `52fb02862e31920d558733d99356e627b4109fd7`.
Existing product runtime version: `1.0.0-rc.1`; portal-client version: `0.3.0-beta.20261004.1`.
This is one product with a versioned Windows web client, not a completed native cross-platform rewrite.

## Verified failure and limited repair
Recovery run 37195696367/job 111416974815 on `70ca974e135df67ceb7501c22eedbd61a755e899` passed existing real-sample ingest/reconciliation and SHADOW projection. Native route repair failed at Hosting finalization: HTTP 400, missing auroraNexusIntegrationPing in southamerica-east1. Deploying only sessionLogin/nativeInsight does not satisfy the remaining Hosting rewrites.
A synthetic check also reproduced a legacy jq context bug: `all($required[]; $deployed | index(.) != null)` can approve an absent function. This patch does not rerun or replace that old candidate. It repairs the existing post-ingest path with exact id+region closure and new regression tests.

The post-ingest path deploys the full set derived from firebase.json, verifies the deployed set, and only then publishes Hosting. It does not re-ingest records. Final evidence derives each gate from the actual step outcome rather than hardcoded true values. Original requests are unchanged; protected firebase-homologation, exact-main check and final kill switch remain required.

## Windows
Installer adds only the HML client version, Desktop/Start-menu shortcuts and optional fixed TRIGGERcmd actions. It preserves existing gateway infrastructure, canonical data, prior commands and applications. Client uses the same existing authenticated portal; it does not copy browser credentials, ingest documents or create a financial replica. SHA-256 detects corruption, not publisher authenticity. No permanent execution-policy change or protection bypass is included.

## macOS / iOS / web
macOS original 1.6.0 baseline must be reconciled by bundle identity, destination and native evidence before any update. Do not overwrite it with an HML launcher. iOS delivery is authenticated web/Home Screen, not an IPA/TestFlight build. The shared release descriptor records these distinctions. Native signing/notarization, iOS device tests and authenticated cloud synchronization remain unverified.

## Release gates
Before cloud finalization: reconcile the pending older deploy, review this PR, validate on the final current-main SHA, approve the protected HML environment, run post-ingest finalization once, and verify authenticated native insights plus integration-key route. Main-data bulk load and physical replication require a separately authenticated scoped adapter, authorized source inventory, idempotency/checkpoint, reconciliation and recovery evidence. No clinical ingestion or production promotion is enabled by this patch.

## Tests executed during preparation
24 Node tests passed; both YAML files loaded; all eight bash blocks in post-ingest passed bash -n. Windows parser/install results and cloud deployment must be recorded separately on the actual device and workflow, not inferred from these tests.
