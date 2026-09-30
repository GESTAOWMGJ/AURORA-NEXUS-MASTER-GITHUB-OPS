# Preliminary AI risk classification

| Module | Boundary | Preliminary risk | Current control |
|---|---|---:|---|
| Operational dashboard | `NON_CLINICAL` | Low | Synthetic data; read mode |
| Metadata classifier | `CLINICAL_USE_BLOCKED` | Medium | Sanitized allowlist; structured output; human review |
| Readiness API | `CLINICAL_READINESS_ONLY` | Low | Read-only; no real data; no mutation routes |
| Future clinical output | `CLINICAL_USE_BLOCKED` | Not classified | Not implemented; formal intended-use and SaMD assessment required |

The preliminary labels are engineering risk triage, not regulatory or clinical
approval. Any new intended use requires reassessment before implementation.
