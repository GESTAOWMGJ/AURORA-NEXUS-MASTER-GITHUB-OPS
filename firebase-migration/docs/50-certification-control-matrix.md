# AURORA NEXUS — Certification Control Matrix

**Code:** AURORA-CERT-002  
**Date:** 2026-10-07  
**Scope:** ISO/IEC 27001:2022, ISO/IEC 27701:2025, ISO 9001:2026, ISO/IEC 25010:2023 support mapping.  
**Status:** DRAFT EVIDENCE MAP. Not a certificate and not an auditor opinion.

## Evidence states

| State | Meaning |
|---|---|
| SPECIFIED | Requirement or control exists as design/policy |
| IMPLEMENTED | Code/process exists |
| TESTED | Local or synthetic test exists |
| CI_VERIFIED | Verified in CI on a traceable commit |
| HML_VERIFIED | Verified in homologation/runtime |
| PRODUCTION_VERIFIED | Verified in production/customer environment |
| AUDITED_INDEPENDENTLY | Reviewed by independent assessor/pentest/auditor |
| CERTIFIED | Covered by valid certificate from certification body |

## ISO/IEC 27001:2022 readiness matrix

| Domain | AURORA control | Evidence path | Current state | Gap to certification |
|---|---|---|---|---|
| Context and ISMS scope | define product, tenant, cloud, desktop and operational boundaries | `docs/AURORA_CERTIFICATION_READINESS_20261007.md` | SPECIFIED | legal entity scope and exclusions need executive approval |
| Leadership and accountability | owner-based risk register and executive risk acceptance | `firebase-migration/docs/32-security-risk-register.md` | SPECIFIED | named RACI outside public repo required |
| Risk assessment | STRIDE/LGPD threat model and risk scoring | `firebase-migration/docs/30-threat-model.md`, `firebase-migration/docs/32-security-risk-register.md` | SPECIFIED | internal audit validation required |
| Risk treatment | treatment plan for HIGH/CRITICAL risks | `firebase-migration/docs/32-security-risk-register.md` | SPECIFIED | due dates and residual approvals required |
| Asset inventory | data/source inventory and critical assets | `firebase-migration/docs/01-inventario-fonte.md`, `firebase-migration/docs/30-threat-model.md` | SPECIFIED | production asset register export required |
| Access control | membership, RBAC, MFA, backend revalidation | `firebase-migration/policy/security-baseline-v1.json`, auth tests and deploy smoke | HML_VERIFIED for HML smoke | access review matrix required |
| Cryptography | AES-256-GCM envelope, KMS, HMAC, SHA-256, forbidden algorithms | `firebase-migration/policy/security-baseline-v1.json`, `firebase-migration/docs/23-crypto-key-management-policy.md` | IMPLEMENTED/HML partial | KMS evidence and key lifecycle review required |
| Operations security | backup, PITR, restore, logs, HML gates | `firebase-migration/docs/35-firestore-cmek-hml-spec.md`, deploy workflows | HML_VERIFIED partial | recurrent restore evidence required |
| Secure development | tests, CodeQL, dependency review, lockfiles, rollback | workflows, vulnerability report | CI_VERIFIED partial | branch ruleset and SBOM required |
| Supplier/security dependencies | subprocessors, connected apps, cloud providers | `firebase-migration/docs/34-dpa-template-lgpd.md` | SPECIFIED | vendor register required |
| Incident management | incident response plan and LGPD communication workflow | `firebase-migration/docs/33-incident-response-plan.md` | SPECIFIED | tabletop exercise required |
| Business continuity | backup/restore and degraded operation | `firebase-migration/docs/25-crypto-hml-deployment-runbook.md` | SPECIFIED/HML partial | BCP/DR test schedule required |
| Compliance | LGPD, privacy, security baseline, clinical gate | `firebase-migration/docs/31-lgpd-ropa.md`, `firebase-migration/docs/37-clinical-sensitive-release-gate.md` | SPECIFIED | formal privacy review and DPO approval required |

## ISO/IEC 27701:2025 readiness matrix

| Privacy area | AURORA control | Evidence path | Current state | Gap |
|---|---|---|---|---|
| PIMS scope | privacy scope tied to ISMS and tenant processing | `docs/AURORA_CERTIFICATION_READINESS_20261007.md` | SPECIFIED | controller/processor role per client required |
| PII inventory | RoPA and data classification | `firebase-migration/docs/31-lgpd-ropa.md` | SPECIFIED | customer-specific RoPA completion required |
| Purpose limitation | source authorization, labels/folders and minimization | security baseline, RoPA | SPECIFIED | technical allowlist per connector required |
| Data subject handling | access, correction, deletion and evidence workflow | DPA template/RoPA | SPECIFIED | portal/API workflow needs runtime proof |
| Processor obligations | DPA clauses and audit support | `firebase-migration/docs/34-dpa-template-lgpd.md` | SPECIFIED | signed DPA and subprocessor list required |
| Breach notification | incident response and LGPD timing | `firebase-migration/docs/33-incident-response-plan.md` | SPECIFIED | exercise and contact registry required |
| Retention/deletion | retention by class and legal hold | security baseline required docs | SPECIFIED | retention schedule must be finalized |
| Privacy by design | clinical-sensitive gate and data minimization | `firebase-migration/docs/37-clinical-sensitive-release-gate.md` | SPECIFIED | HML and independent validation required before health data |

## ISO 9001:2026 readiness matrix

| QMS area | AURORA control | Evidence path | Current state | Gap |
|---|---|---|---|---|
| Customer requirements | pilot scope, authenticated client, guided installer | release docs and installer validation | CI_VERIFIED/HML_VERIFIED | customer acceptance record required |
| Process control | gated deploy, immutable SHA, HML smoke, rollback | GitHub Actions deploy runs | HML_VERIFIED | formal SOP and owner approval required |
| Quality objectives | deploy success, smoke pass, defect leakage, MTTR | release progress docs | SPECIFIED | objective dashboard required |
| Nonconformity/CAPA | incident, risk and defect remediation | risk register, IRP | SPECIFIED | CAPA register required |
| Document control | versioned docs in Git and audit trails | repository history | IMPLEMENTED | controlled document index required |
| Internal audit | audit checklist and evidence register | this matrix | SPECIFIED | internal audit execution required |
| Management review | risk, metrics, findings and decisions | certification plan | SPECIFIED | minutes and decisions required |
| Continual improvement | organic engine and improvement backlog | `docs/aurora-autonomous-improvement-runbook.md` | IMPLEMENTED | governance of AI-generated changes required |

## ISO/IEC 25010:2023 software quality evidence

| Quality characteristic | AURORA evidence | Required metric |
|---|---|---|
| Functional suitability | authenticated smoke, private shell, organic endpoint, installer validation | pass rate per release |
| Performance efficiency | cloud/physical offload design and desktop light mode | response time, CPU, RAM, startup impact |
| Compatibility | Firebase web, desktop, Google Workspace, connectors | browser/platform matrix |
| Interaction capability | guided installer and authenticated client setup | task completion and error recovery |
| Reliability | idempotency, restore, rollback, smoke tests | RTO/RPO and failure recurrence |
| Security | RBAC, MFA, HMAC, KMS, tenant isolation, CodeQL | zero critical/high unresolved |
| Maintainability | modular tests, docs, runbooks, workflows | change failure rate and test coverage |
| Flexibility | multi-tenant org/facility model and connector design | tenant onboarding time |
| Safety | clinical-sensitive gate and human review controls | zero unsafe autonomous critical action |

## Certification pack completeness checklist

| Artifact | Current state | Required before auditor |
|---|---|---|
| ISMS scope | SPECIFIED | approve formally |
| Statement of Applicability | MISSING | create and approve |
| Risk assessment methodology | SPECIFIED | approve and apply |
| Risk treatment plan | SPECIFIED | add dates and residual approvals |
| Internal audit report | MISSING | execute |
| Management review record | MISSING | execute |
| Access review | MISSING | export and approve |
| SBOM/provenance | PARTIAL | generate and attach to release |
| Vulnerability management report | SPECIFIED | update from current scans |
| Backup/restore evidence | PARTIAL | attach recent restore proof |
| Incident exercise | MISSING | tabletop and record actions |
| Supplier register | MISSING | create |
| Retention schedule | MISSING | create |
| Pentest | MISSING | external execution before sensitive scale |
