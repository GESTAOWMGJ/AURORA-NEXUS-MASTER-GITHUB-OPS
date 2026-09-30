# Deploy and migration runbook — prepared, not executed

1. Keep `dry_run=true` and verify the immutable commit SHA and release tag.
2. Require all independent approvals and a protected GitHub Environment.
3. Confirm backups, RTO/RPO, region, encryption, retention and rollback owners.
4. Rehearse using deterministic synthetic fixtures and reconcile counts,
   checksums, relationships, duplicates and orphans.
5. Enable production deployment separately from real-data migration.
6. Use canary rollout with automatic stop criteria.
7. Reconcile after migration; rollback or roll forward using the approved plan.

The current workflow does not contain a real migration command. Adding one is a
future reviewed change after G4 evidence exists.
