# AURORA NEXUS — Autonomous Improvement Runbook

## Goal

Run safe autonomous improvement cycles for AURORA NEXUS with Firebase as the source of truth and GitHub as the review gate.

## Normal cycle

1. Generate backlog from current KPIs and operational signals.
2. Select the lowest-risk candidate.
3. Route through native/internal processing first.
4. Evaluate candidate change.
5. Open a draft PR only if the gate passes.
6. Let the eval workflow validate policy, security, and regression risk.

## Incident handling

- If a workflow fails, stop automation for that change set.
- Capture the failing log and candidate artifact.
- Re-run in dry-run mode before any retry.
- Escalate to human review if failure touches auth, secrets, data loss, or policy.

## Rollback

- Revert the PR or the last deployed change.
- Restore previous checkpoint if the issue affects runtime state.
- Mark the incident against `mttr`.
- Add a backlog item for the root cause.

## Safety gates

- No auto-merge on gate failure.
- No external AI without explicit policy permission.
- No hidden network calls in scripts.
- No mutation without dry-run support and traceable PR metadata.

## Branch and PR traceability

- Branch format: `aurora/self-sufficient/<short-topic>`
- PR title format: `AURORA: <verb> <area> [autonomous]`
- Every PR must reference the workflow run and candidate ID.

## Operational KPIs

- `external_ai_dependency_rate`
- `autonomous_pr_success_rate`
- `regression_rate`
- `mttr`

## WMGJ learning loop

1. Detect recurring operational pain.
2. Capture it in Firebase with evidence.
3. Turn it into a deterministic rule or self-hosted capability.
4. Keep external AI as fallback only.
5. Record the result in the backlog and KPI baseline.
