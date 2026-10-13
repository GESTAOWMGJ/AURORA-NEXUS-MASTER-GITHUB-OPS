# HML release execution evidence — 2026-10-13

Source baseline: `884a283ec55b2c339c5b74b0ae877664865576fc`.
Project: `wmgj-hml-jfn-20260927`. Canonical origin: `https://auroranexus.com.br`.

## Verified facts

- PR232: canonical preflight accepts a complete usable native AuthGate document while preserving TLS, security headers, project identity and anonymous denial. Unique probe URLs avoid stale negative Hosting cache responses.
- PR236: authenticated deployment smoke compares the returned product version with AURORA_PRODUCT_VERSION from the compiled candidate. Twenty shell blocks passed syntax validation; a current-version fixture passed and the stale-version fixture failed. PR checks passed before merge.
- PR237: synthetic smoke token explicitly binds its organization without changing the real user, membership, IAM or production.
- CI38421009800 completed successfully for the baseline.
- Run38421805573 was initiated by the repository owner and received real protected-environment approval. Both candidate validation and protected deployment succeeded, including authenticated smoke and canonical source-bound runtime verification.
- The canonical publisher refused promotion with EXACT_CHECKS_NOT_VERIFIED. The checks API showed cancelled deployment and publication checks from prior run38421301022 alongside successful current deployment checks. No active certificate was published by this failure.
- Prior run38418073061 verified AUTHGATE_TRAFFIC_ROLLBACK_VERIFIED after its authenticated smoke failed. This is rollback evidence for that run, not a claim that all later failures rolled back.

## Resolution and pending proofs

This evidence-only increment creates a fresh immutable source candidate. Its release must obtain its own successful CI, owner-origin protected deployment, authenticated smoke and signed compare-and-swap promotion. Keep the publisher strict: do not convert cancelled or failed historical checks into success or bypass certificate validation. NONE is valid only while an authenticated read confirms the active certificate is absent; a concurrent promotion requires predecessor reconciliation.

Cloud remains primary. Mac contingency was authorized and its existing backup node reused; the most recent remote inventory found both Mac and Windows offline. A timed-out Mac update must be reconciled on reconnection before retry. No current physical installation, full synchronization, production release or native-learning adoption is established by this document. The existing operations automation holds the resumption instruction.

## Reusable operational lesson

Status: VALIDATED for the checks API behavior and protected deployment; PENDING for signed publication and physical convergence. Bind probes to the actual candidate, organization and exact source. Preserve one owner of deployment effects, reconcile concurrent main advancement and unknown remote outcomes, and distinguish deployment success from certificate promotion and device receipts. No credentials or private client documents are included.
