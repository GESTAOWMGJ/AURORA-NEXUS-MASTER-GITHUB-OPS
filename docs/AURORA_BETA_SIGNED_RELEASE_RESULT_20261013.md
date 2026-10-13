# Signed beta publication — verified result

Date: 2026-10-13. Scope: authorized homologation only, project wmgj-hml-jfn-20260927.

- Product version: 1.1.0-beta.1.
- Active source: f57dc429c158ae439b1b4945d02fa59020d8cab2.
- Exact CI: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/38423653844 — success.
- Protected release: https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/38423912426 — success for candidate validation, deployment and signed publication.
- Publisher returned ACTIVE_PIN_PUBLISHED with certificateSha256 c266645df3363df1789064507c52aad741ffc0a126059016315047215add0a0b.
- Authenticated Firebase Console readback of platformRuntime/activeRelease confirmed status ACTIVE, productVersion 1.1.0-beta.1, sourceSha f57dc429c158ae439b1b4945d02fa59020d8cab2, releaseRunId38423912426, publishedAtUtc2026-10-13T15:49:05.428Z.
- Deployment authenticated smoke and canonical source-bound server/web runtime verification passed.

The main branch was read back at the active source after publication. This result is recorded in an evidence branch to preserve the source-bound active release; this evidence-only commit is not itself the deployed source.

## Pending external evidence

Mac and Windows were offline in the latest authorized device inventory. Device installation remains unverified, as the publisher explicitly reported deviceInstallationVerified=false. A Mac git update request timed out; reconcile its outcome before retry. Reuse the existing backup-node, application identity and operations automation. Cloud remains primary; Mac is temporary compatible contingency, Windows failback requires verified availability and health. Physical synchronization and native learning adoption require separate receipts.

Future release requests must re-read and validate the current certificate and use its hash as CAS predecessor. NONE is no longer a valid predecessor for an existing active release. No production mutation, patient data migration, new scheduler, credential exposure or repeat of completed restore/HMAC/ingestion/reconciliation was performed by this publication.
