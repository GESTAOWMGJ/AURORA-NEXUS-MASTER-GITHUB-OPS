import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "migration" / "dry_run.py"
FIXTURE = ROOT / "tests" / "fixtures" / "synthetic" / "migration-source.json"
spec = importlib.util.spec_from_file_location("migration_dry_run", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_synthetic_dry_run_reconciles_without_external_io() -> None:
    result = module.reconcile(json.loads(FIXTURE.read_text(encoding="utf-8")))

    assert result["mode"] == "DRY_RUN"
    assert result["externalReads"] == 0
    assert result["externalWrites"] == 0
    assert result["counts"] == {"tenants": 1, "sites": 1, "records": 2}
    assert result["duplicates"] == {"tenants": [], "sites": [], "records": []}
    assert result["orphans"] == []
    assert result["reconciled"] is True


def test_non_synthetic_source_is_blocked() -> None:
    with pytest.raises(ValueError, match="REAL_OR_UNVERIFIED_SOURCE_BLOCKED"):
        module.reconcile({"source": "SHEETS_PRODUCTION"})
