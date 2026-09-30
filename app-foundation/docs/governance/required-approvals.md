# Required approvals

No single approval may activate clinical use, production deployment or real-data
migration. The following independent approvals are required:

- back-end engineering;
- front-end engineering and accessibility;
- API, schema and event contracts;
- security and privacy;
- LGPD owner or DPO;
- clinical owner or medical technical director;
- production and migration owner.

Repository handles are intentionally not invented. CODEOWNERS entries remain
commented placeholders until GitHub identities are formally designated.

## Gate rule

The deploy workflow additionally requires a protected GitHub Environment, exact
commit SHA, explicit release tag, `ENABLE_PRODUCTION_DEPLOY=true`, and a separate
`ENABLE_REAL_DATA_MIGRATION=true` before any real-data migration step may exist.
