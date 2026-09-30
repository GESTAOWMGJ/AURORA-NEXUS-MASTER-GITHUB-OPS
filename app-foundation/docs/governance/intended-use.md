# Intended use — clinical-readiness only

## Classification

`CLINICAL_READINESS_ONLY`. The current application is an operational and audit
demonstrator. It may display synthetic readiness evidence but must not diagnose,
predict prognosis, prescribe, triage, discharge, request examinations, recommend
treatment, or communicate clinical output to a patient.

## Boundaries

- The current Sheets/Apps Script operation remains authoritative.
- Firestore and FastAPI use synthetic deterministic fixtures only.
- Every potentially clinical capability is absent or fail-closed.
- Human review is necessary but not sufficient for future clinical activation.
- Regulatory, privacy, security, institutional and clinical approvals remain
  independent gates.

## Prohibited claims

Technical tests do not constitute clinical validation. A workflow definition is
not a deployment. A dry-run is not a migration. No document in this PR authorizes
real data, production use, patient communication or clinical decision support.
