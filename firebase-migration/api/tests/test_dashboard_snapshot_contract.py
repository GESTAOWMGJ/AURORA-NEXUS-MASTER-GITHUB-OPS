import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from wmgj_api.models import (
    DASHBOARD_SNAPSHOT_ADAPTER,
    DashboardSnapshotV2,
    DashboardSnapshotV3,
)
from wmgj_api.repositories import FirestoreRepository


ROOT = Path(__file__).parents[2]
SCHEMA = ROOT / "schemas" / "dashboard-snapshot.schema.json"
SCHEMA_V2 = ROOT / "schemas" / "dashboard-snapshot.v2.schema.json"
SCHEMA_V3 = ROOT / "schemas" / "dashboard-snapshot.v3.schema.json"
FIXTURES = Path(__file__).parent / "fixtures"
FIXTURE_V2 = FIXTURES / "dashboard_snapshot_stored_v2.json"
FIXTURE_V3 = FIXTURES / "dashboard_snapshot_stored_v3.json"


def stored_snapshot(version: int = 2) -> dict[str, object]:
    fixture = FIXTURE_V2 if version == 2 else FIXTURE_V3
    return json.loads(fixture.read_text(encoding="utf-8"))


class FakeFirestoreSnapshot:
    exists = True

    def __init__(self, document: dict[str, object]) -> None:
        self.document = document

    def to_dict(self) -> dict[str, object]:
        return self.document


class FakeFirestoreClient:
    def __init__(self, document: dict[str, object]) -> None:
        self.document_value = document

    def document(self, _path: str) -> "FakeFirestoreClient":
        return self

    def get(self) -> FakeFirestoreSnapshot:
        return FakeFirestoreSnapshot(self.document_value)


def repository_with(document: dict[str, object]) -> FirestoreRepository:
    repository = object.__new__(FirestoreRepository)
    repository.client = FakeFirestoreClient(document)
    return repository


def test_stored_projection_v2_matches_json_schema_and_model_without_field_loss():
    document = stored_snapshot()
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    schema_v2 = json.loads(SCHEMA_V2.read_text(encoding="utf-8"))

    assert list(Draft202012Validator(schema).iter_errors(document)) == []
    assert list(Draft202012Validator(schema_v2).iter_errors(document)) == []

    parsed = DASHBOARD_SNAPSHOT_ADAPTER.validate_python(document)
    assert type(parsed) is DashboardSnapshotV2
    round_trip = json.loads(
        parsed.model_dump_json(by_alias=True, exclude_unset=True)
    )
    assert round_trip == document


def test_native_projection_v3_matches_json_schema_and_model_without_field_loss():
    document = stored_snapshot(3)
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    schema_v2 = json.loads(SCHEMA_V2.read_text(encoding="utf-8"))
    schema_v3 = json.loads(SCHEMA_V3.read_text(encoding="utf-8"))

    assert list(Draft202012Validator(schema).iter_errors(document)) == []
    assert list(Draft202012Validator(schema_v3).iter_errors(document)) == []
    assert list(Draft202012Validator(schema_v2).iter_errors(document))

    parsed = DASHBOARD_SNAPSHOT_ADAPTER.validate_python(document)
    assert type(parsed) is DashboardSnapshotV3
    round_trip = json.loads(
        parsed.model_dump_json(by_alias=True, exclude_unset=True)
    )
    assert round_trip == document


def test_version_specific_schema_does_not_accept_the_other_version():
    schema_v3 = json.loads(SCHEMA_V3.read_text(encoding="utf-8"))

    assert list(Draft202012Validator(schema_v3).iter_errors(stored_snapshot()))


@pytest.mark.parametrize("version", [2, 3])
def test_stored_projection_rejects_unknown_fields_instead_of_discarding_them(version: int):
    document = {**stored_snapshot(version), "unexpectedField": "must-not-be-discarded"}

    with pytest.raises(ValidationError, match="unexpectedField"):
        DASHBOARD_SNAPSHOT_ADAPTER.validate_python(document)


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [2, 3])
async def test_repository_preserves_the_complete_stored_projection(version: int):
    document = stored_snapshot(version)

    parsed = await repository_with(document).get_dashboard_snapshot("wmgj", "2026-09")

    assert parsed is not None
    round_trip = json.loads(
        parsed.model_dump_json(by_alias=True, exclude_unset=True)
    )
    assert round_trip == document


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [2, 3])
async def test_repository_rejects_unknown_stored_fields_instead_of_filtering_them(version: int):
    document = {**stored_snapshot(version), "unexpectedField": "must-not-be-discarded"}

    with pytest.raises(ValidationError, match="unexpectedField"):
        await repository_with(document).get_dashboard_snapshot("wmgj", "2026-09")


def test_stored_projection_requires_an_explicit_supported_schema_version():
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    missing_version = stored_snapshot()
    missing_version.pop("schemaVersion")
    wrong_version = {**stored_snapshot(), "schemaVersion": 1}

    assert list(Draft202012Validator(schema).iter_errors(missing_version))
    assert list(Draft202012Validator(schema).iter_errors(wrong_version))
    with pytest.raises(ValidationError):
        DASHBOARD_SNAPSHOT_ADAPTER.validate_python(missing_version)
    with pytest.raises(ValidationError):
        DASHBOARD_SNAPSHOT_ADAPTER.validate_python(wrong_version)


def test_native_projection_v3_requires_all_native_blocks():
    document = stored_snapshot(3)
    document.pop("nativeDataPlane")

    with pytest.raises(ValidationError, match="nativeDataPlane"):
        DASHBOARD_SNAPSHOT_ADAPTER.validate_python(document)
