import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from wmgj_api.models import DashboardSnapshot
from wmgj_api.repositories import FirestoreRepository


ROOT = Path(__file__).parents[2]
SCHEMA = ROOT / "schemas" / "dashboard-snapshot.schema.json"
FIXTURE = Path(__file__).parent / "fixtures" / "dashboard_snapshot_stored_v2.json"


def stored_snapshot() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


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

    assert list(Draft202012Validator(schema).iter_errors(document)) == []

    parsed = DashboardSnapshot.model_validate(document)
    round_trip = json.loads(
        parsed.model_dump_json(by_alias=True, exclude_unset=True)
    )
    assert round_trip == document


def test_stored_projection_v2_rejects_unknown_fields_instead_of_discarding_them():
    document = {**stored_snapshot(), "unexpectedField": "must-not-be-discarded"}

    with pytest.raises(ValidationError, match="unexpectedField"):
        DashboardSnapshot.model_validate(document)


@pytest.mark.asyncio
async def test_repository_preserves_the_complete_stored_projection():
    document = stored_snapshot()

    parsed = await repository_with(document).get_dashboard_snapshot("wmgj", "2026-09")

    assert parsed is not None
    round_trip = json.loads(
        parsed.model_dump_json(by_alias=True, exclude_unset=True)
    )
    assert round_trip == document


@pytest.mark.asyncio
async def test_repository_rejects_unknown_stored_fields_instead_of_filtering_them():
    document = {**stored_snapshot(), "unexpectedField": "must-not-be-discarded"}

    with pytest.raises(ValidationError, match="unexpectedField"):
        await repository_with(document).get_dashboard_snapshot("wmgj", "2026-09")


def test_stored_projection_requires_explicit_schema_version_2():
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    missing_version = stored_snapshot()
    missing_version.pop("schemaVersion")
    wrong_version = {**stored_snapshot(), "schemaVersion": 1}

    assert list(Draft202012Validator(schema).iter_errors(missing_version))
    assert list(Draft202012Validator(schema).iter_errors(wrong_version))
    with pytest.raises(ValidationError):
        DashboardSnapshot.model_validate(missing_version)
    with pytest.raises(ValidationError):
        DashboardSnapshot.model_validate(wrong_version)
