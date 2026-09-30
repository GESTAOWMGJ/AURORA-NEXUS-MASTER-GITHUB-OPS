# Synthetic source-to-Firestore mapping

| Synthetic source | Firestore destination | Key | Invariant |
|---|---|---|---|
| `tenants[]` | `tenants/{tenantId}` | `id` | Unique tenant ID |
| `sites[]` | `tenants/{tenantId}/sites/{siteId}` | `id` | Existing parent tenant |
| `records[]` | `tenants/{tenantId}/records/{recordId}` | `id` | Existing tenant/site; revision ≥ 1 |

The fixture is a structural mirror only. It contains no field names copied from
real persons, messages, examinations, medical records, Gmail, Drive or Sheets.
The dry-run performs zero external reads and zero external writes, then reports
counts, a canonical SHA-256 checksum, duplicates and orphan relationships.
