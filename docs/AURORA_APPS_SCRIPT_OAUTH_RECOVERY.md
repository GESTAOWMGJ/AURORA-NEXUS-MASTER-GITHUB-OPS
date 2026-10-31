# Apps Script: owner OAuth recovery in the protected environment

Incident: #360. Baseline: `eef855d8ffbfd5ca63d3410bfba1cefd4863a48f`.
The owner requested legitimate OAuth renewal, unchanged identity/access, and
credential persistence exclusively in the existing protected Actions environment.

The historical renewal helpers write the repository-level secret. This recovery
uses `tools/renew-appscript-oauth.py` with the existing local clasp client and the
exact scopes recorded in its default profile. It never logs out, revokes access,
creates an OAuth client, changes IAM, or overwrites the local credential profiles.

Run on the owner's Mac with Node/npm, Python 3 and the authenticated GitHub CLI:

```sh
python3 tools/renew-appscript-oauth.py --expected-email '<existing owner email>'
```

The official pinned clasp CLI opens Google's consent page and handles its local
callback. The owner signs in directly. Credential values and callback codes must
never be pasted into chat. Temporary files are private and deleted on exit.
Renewal rejects changed account, client, scopes, missing refresh token, ambiguous
canonical deployment, or a concurrently modified baseline. Only the secret named
`CLASPRC_JSON` in `firebase-homologation` is updated; the repository-level secret
and other profiles remain untouched. This is an environment override, not proof
that credentials used by unrelated legacy workflows have been renewed.

The existing publisher now uses that protected environment and its existing
review/branch rules, shares the HML concurrency group, checks the canonical
deployment before pushing, and preserves that ID when publishing the SHA-bound
immutable version. It removes temporary runner credentials on completion.

After renewal: validate the exact candidate/main SHA and CI, publish using the
canonical workflow, confirm deployment/version and source hash, run protected
STATUS, then obtain a fresh paginated authenticated READBACK. Only then reconcile
each retry candidate by tenant, scope, source ID/version, receipt and remaining
attempt budget. No reprocessing or `EXECUTE` fallback is part of renewal.

Current evidence: offline identity/scope/cancellation/concurrency/cleanup tests
and workflow syntax validation. Google consent, secret write, publication,
STATUS, READBACK and record eligibility require separate runtime receipts.

Rollback: revert only this code increment if necessary. Do not delete receipts,
recreate the project/deployment, reset OAuth profiles or remove environment gates.
A failed/uncertain secret write requires metadata inspection before retry.
