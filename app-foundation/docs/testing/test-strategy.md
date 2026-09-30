# Clinical-readiness test strategy

## Current automated scope

- React/TypeScript build and deterministic readiness-model checks;
- Cloud Functions compilation and existing contract tests;
- FastAPI OpenAPI contract, fail-closed behavior and route allowlist;
- Firestore and Storage Rules through the Firebase Emulator Suite;
- secret scanning and dependency review where GitHub supports the event.

All fixtures must be synthetic, deterministic and free of real or pseudonymized
patient data. LLM calls, if tested later, must use frozen mocks.

## Explicit exclusions

The suite does not establish clinical validity, diagnostic performance, safety in
care delivery, LGPD compliance, SaMD classification, production readiness, or
migration authorization. Those remain gated and require independent evidence.
