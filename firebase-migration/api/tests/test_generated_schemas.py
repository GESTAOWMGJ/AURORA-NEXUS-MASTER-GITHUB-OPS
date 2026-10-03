import json
from pathlib import Path

from jsonschema import Draft202012Validator
from pydantic import TypeAdapter

from wmgj_api.models import (
    AiAnalysisRequest,
    AiStructuredOutput,
    DASHBOARD_SNAPSHOT_ADAPTER,
    DashboardSnapshotV2,
    DashboardSnapshotV3,
)


SCHEMAS = Path(__file__).parents[2] / "schemas"


def test_generated_contracts_match_pydantic_models():
    contracts = {
        "ai-analysis-request.schema.json": TypeAdapter(AiAnalysisRequest),
        "ai-analysis-output.schema.json": TypeAdapter(AiStructuredOutput),
        "dashboard-snapshot.schema.json": DASHBOARD_SNAPSHOT_ADAPTER,
        "dashboard-snapshot.v2.schema.json": TypeAdapter(DashboardSnapshotV2),
        "dashboard-snapshot.v3.schema.json": TypeAdapter(DashboardSnapshotV3),
    }
    for filename, adapter in contracts.items():
        exported = json.loads((SCHEMAS / filename).read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(exported)
        exported.pop("$schema")
        exported.pop("$id")
        assert exported == adapter.json_schema(by_alias=True)
