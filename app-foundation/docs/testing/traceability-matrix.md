# Traceability matrix

| Requirement | Risk | Control | Test | Evidence | State |
|---|---|---|---|---|---|
| CR-001 | Accidental clinical release | Clinical routes absent; fail-closed flags | OpenAPI route allowlist | `api/tests/test_readiness.py` | CONCLUÍDO E VERIFICADO |
| PRV-002 | Real data in tests | Synthetic deterministic source marker | Response contract assertion | `GET /v1/readiness` | CONCLUÍDO E VERIFICADO |
| TEN-003 | Cross-tenant access | Explicit tenant/site scope | Negative Rules tests | `tests/firestore.rules.test.ts` | CONCLUÍDO E VERIFICADO in prior CI |
| DEP-004 | Accidental deployment | Manual dispatch; dry-run default; dual variables | Workflow static gate | `deploy-production.yml` | PREPARADO, NÃO EXECUTADO |
| VAL-005 | Technical/clinical validation confusion | Independent clinical gate | Required-approvals review | `required-approvals.md` | PENDENTE DE APROVAÇÃO |
| MIG-006 | Firebase interferes with current operation | Opt-in shadow bridge; failure isolation; no return write | Apps Script audit + static CI guards | `src/15_FIREBASE_SHADOW_WMGJ.gs` | CONCLUÍDO E VERIFICADO localmente |
| DAT-007 | Identifiable or clinical data leaves Workspace | Strict positive schema; aggregate-only payload; no raw rows or free text | Negative contract tests | `tests/shadow-migration.test.ts` | CONCLUÍDO E VERIFICADO localmente |
| SLA-008 | Operational deviations remain invisible | Versioned server-side policy and enumerated breach codes | SLA evaluation tests | `shadow-contracts.ts` | CONCLUÍDO E VERIFICADO localmente |
| LRN-009 | Learning loop changes production autonomously | Observation-only record; `autoApplyAllowed=false` | Contract assertions and code review | `continuous-learning.md` | PREPARADO, NÃO EXECUTADO |
| DEP-010 | Wrong Firebase project is targeted | Manual workflow, immutable SHA, protected environment and project allowlist | Workflow YAML/static gate | `deploy-firebase-shadow.yml` | PREPARADO, NÃO EXECUTADO |
