#!/usr/bin/env python3
"""Deterministic, read-only migration reconciliation for synthetic fixtures."""

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def duplicate_ids(rows: list[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for row in rows:
        row_id = str(row.get("id", ""))
        if row_id in seen:
            duplicates.add(row_id)
        seen.add(row_id)
    return sorted(duplicates)


def reconcile(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("source") != "SYNTHETIC_DETERMINISTIC":
        raise ValueError("REAL_OR_UNVERIFIED_SOURCE_BLOCKED")

    tenants = payload.get("tenants", [])
    sites = payload.get("sites", [])
    records = payload.get("records", [])
    tenant_ids = {row["id"] for row in tenants}
    site_ids = {row["id"] for row in sites}
    orphans = sorted(
        row["id"]
        for row in records
        if row.get("tenantId") not in tenant_ids or row.get("siteId") not in site_ids
    )
    duplicates = {
        "tenants": duplicate_ids(tenants),
        "sites": duplicate_ids(sites),
        "records": duplicate_ids(records),
    }

    return {
        "mode": "DRY_RUN",
        "externalReads": 0,
        "externalWrites": 0,
        "source": payload["source"],
        "counts": {"tenants": len(tenants), "sites": len(sites), "records": len(records)},
        "checksum": canonical_hash(payload),
        "duplicates": duplicates,
        "orphans": orphans,
        "reconciled": not orphans and not any(duplicates.values()),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture", type=Path)
    args = parser.parse_args()
    payload = json.loads(args.fixture.read_text(encoding="utf-8"))
    print(json.dumps(reconcile(payload), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
