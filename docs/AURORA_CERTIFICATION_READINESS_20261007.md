# AURORA NEXUS — Certification Readiness Plan

**Code:** AURORA-CERT-001  
**Date:** 2026-10-07  
**Scope:** AURORA NEXUS software, Firebase/Google Cloud runtime, GitHub CI/CD, desktop beta installers, data governance, security, privacy and quality management evidence.  
**Status:** PREPARATION. This document does not claim that AURORA NEXUS is certified.

## 1. Target certification track

AURORA NEXUS shall be prepared for the following certification and assessment path:

| Track | Current reference | Purpose | AURORA posture |
|---|---|---|---|
| Information security management | ISO/IEC 27001:2022 | ISMS requirements, risk-based security management and continuous improvement | Primary certification target |
| Privacy information management | ISO/IEC 27701:2025 | Privacy management for personal information and processor/controller accountability | Privacy extension/readiness target |
| Quality management | ISO 9001:2026 | Quality management system, customer requirements, process control and improvement | Management system target |
| Software product quality | ISO/IEC 25010:2023 | Software quality model for specification, measurement and evaluation | Engineering quality model, not certification claim |
| Data protection compliance | LGPD/ANPD | Brazilian personal data and health data obligations | Mandatory compliance baseline |
| Secure software development | NIST SSDF / OWASP ASVS / CodeQL evidence | Secure SDLC and application security assurance | Supporting evidence track |

## 2. Non-negotiable certification rules

1. Never market AURORA NEXUS as ISO certified until a competent certification body issues a valid certificate.
2. Treat HML success as evidence, not certification.
3. Keep clinical-sensitive processing blocked until the clinical gate is formally approved, tested and risk-accepted.
4. Preserve tenant isolation, least privilege, MFA for privileged roles, immutable release evidence and rollback.
5. Maintain traceability from requirement to control, test, runtime evidence, owner and risk decision.
6. Any HIGH or CRITICAL residual risk requires owner, due date, treatment and formal acceptance before sensitive production scale.
7. Every audit artifact must distinguish: SPECIFIED, IMPLEMENTED, TESTED, CI_VERIFIED, HML_VERIFIED, PRODUCTION_VERIFIED, AUDITED_INDEPENDENTLY and CERTIFIED.

## 3. Existing evidence base

AURORA already contains substantial evidence for certification preparation:

| Evidence | Repository path | Use in audit |
|---|---|---|
| Security baseline | `firebase-migration/policy/security-baseline-v1.json` | ISMS security requirements, cryptography, SDLC and evidence states |
| Threat model | `firebase-migration/docs/30-threat-model.md` | Risk identification and security design rationale |
| Risk register | `firebase-migration/docs/32-security-risk-register.md` | Risk treatment and residual risk tracking |
| Incident response plan | `firebase-migration/docs/33-incident-response-plan.md` | Incident management and LGPD response readiness |
| RoPA | `firebase-migration/docs/31-lgpd-ropa.md` | Privacy processing inventory |
| DPA template | `firebase-migration/docs/34-dpa-template-lgpd.md` | Processor/controller contracting evidence |
| Crypto key policy | `firebase-migration/docs/23-crypto-key-management-policy.md` | Key management and cryptographic governance |
| Crypto architecture | `firebase-migration/docs/24-cryptographic-architecture-and-pqc-roadmap.md` | Cryptographic design and crypto agility |
| Vulnerability report | `firebase-migration/docs/36-vulnerability-consolidated-report.md` | Vulnerability management evidence |
| Clinical-sensitive gate | `firebase-migration/docs/37-clinical-sensitive-release-gate.md` | Health data release blocking control |
| Firebase HML deploy evidence | GitHub Actions `Deploy Aurora Firebase Homologation` | Runtime deployment and smoke verification |
| Installer validation | GitHub Actions `Validate Aurora Installers` | Desktop beta packaging and integrity evidence |

## 4. Certification backlog

| Priority | Gap | Required action | Owner class | Blocker status |
|---|---|---|---|---|
| P0 | Statement of Applicability | Create ISO 27001 SoA with control inclusion, exclusion and evidence links | Security/Governance | Blocks ISO audit |
| P0 | ISMS scope | Define legal entity, products, sites, cloud projects, excluded systems and customer boundary | Executive/Security | Blocks ISO audit |
| P0 | Internal audit program | Schedule internal audit, auditor independence and corrective action workflow | Governance | Blocks certification |
| P0 | Management review | Create quarterly management review minutes template and metrics | Executive | Blocks certification |
| P0 | Branch protection/ruleset | Enforce required checks on `main` and release branches | Repo Admin | HIGH risk open |
| P0 | Access review | Produce user/IAM/membership review matrix for GitHub, Google Cloud, Firebase and connected apps | IAM | HIGH risk open |
| P0 | Backup/restore proof | Store latest backup/restore evidence with SHA/run/project/date | Operations | Required before sensitive production |
| P0 | Independent pentest | Commission external pentest before real clinical-sensitive scale | Security | Required before health data |
| P1 | SBOM and provenance | Generate SBOM for beta installers and backend packages; link to release artifact hashes | Release/AppSec | Commercial readiness |
| P1 | Retention schedule | Finalize retention/deletion/legal hold matrix by data class and tenant | Privacy | LGPD readiness |
| P1 | Vendor register | Maintain subprocessors, DPA status, geography, purpose and transfer basis | Privacy/Legal | Customer due diligence |
| P1 | Quality objectives | Define SLOs, defect leakage, deployment success, recovery time and customer support metrics | Quality/Operations | ISO 9001 readiness |
| P1 | CAPA workflow | Corrective/preventive action workflow for incidents, defects, audit findings and customer complaints | Quality/Governance | ISO 9001 readiness |
| P2 | Trust center pack | Build public-safe security dossier without secrets or sensitive internals | Commercial/Security | Sales enablement |

## 5. Release gates for certified posture

No release shall be labelled “certification-ready” unless all of the following are true:

1. Current `main` has successful CI for Firebase/API, CodeQL/security, Firestore rules, auth smoke and installer validation.
2. Security baseline status is not weaker than `HML_VERIFIED` for the controls claimed in customer-facing material.
3. HIGH and CRITICAL risks have current owner, status, due date and treatment decision.
4. No unresolved critical/high dependency advisory affects runtime or installer artifacts.
5. Access review was performed for GitHub, Google Cloud/Firebase, deploy service accounts and smoke users.
6. Backup and restore evidence exists for the relevant environment.
7. Incident response plan has been exercised or explicitly marked pending exercise.
8. Privacy artifacts cover purpose, legal basis, data classes, retention, processor/subprocessor and data subject handling.
9. Release artifacts have hashes, provenance and rollback instructions.
10. No patient-identifiable or clinical-sensitive data path is active without the clinical-sensitive release gate passing.

## 6. Quality management model

AURORA quality shall be measured against ISO/IEC 25010:2023 characteristics as operational metrics:

| Characteristic | AURORA metric |
|---|---|
| Functional suitability | passing user workflows, smoke tests and acceptance criteria |
| Performance efficiency | response time, CPU/RAM load, background mode and cloud/offload design |
| Compatibility | browser, desktop beta, Firebase, Google Workspace and connector compatibility |
| Interaction capability | authenticated private shell, guided installer and error recovery clarity |
| Reliability | deploy success, rollback, retries, idempotency and restore evidence |
| Security | access control, audit trail, encryption, tenant isolation and vulnerability management |
| Maintainability | test coverage, modular code, documented runbooks and controlled change |
| Flexibility | tenant onboarding, configurable org/facility scopes and connector plug-in model |
| Safety | human review gates and clinical-sensitive blocking controls |

## 7. Immediate implementation order

1. Create ISO control matrix and evidence register.
2. Create SoA draft for ISO/IEC 27001:2022 and privacy mapping for ISO/IEC 27701:2025.
3. Enforce repo rulesets and required checks.
4. Generate access review export and approve least-privilege exceptions.
5. Generate SBOM/provenance for installer and backend artifacts.
6. Run internal audit and management review.
7. Remediate findings.
8. Select external certification body and define stage 1/stage 2 audit schedule.

## 8. References

- ISO/IEC 27001:2022 — Information security management systems requirements: https://www.iso.org/standard/27001
- ISO/IEC 27701:2025 — Privacy information management: https://www.iso.org/standard/27701
- ISO 9001:2026 — Quality management systems requirements: https://committee.iso.org/standard/9001
- ISO/IEC 25010:2023 — Systems and software product quality model: https://www.iso.org/standard/78176
