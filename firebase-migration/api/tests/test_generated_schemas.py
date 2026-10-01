import json
from pathlib import Path

from jsonschema import Draft202012Validator

from wmgj_api.models import AiAnalysisRequest, AiStructuredOutput, DashboardSnapshot


SCHEMAS = Path(__file__).parents[2] / "schemas"


def test_generated_contracts_match_pydantic_models():
    contracts = {
        "ai-analysis-request.schema.json": AiAnalysisRequest,
        "ai-analysis-output.schema.json": AiStructuredOutput,
        "dashboard-snapshot.schema.json": DashboardSnapshot,
    }
    for filename, model in contracts.items():
        exported = json.loads((SCHEMAS / filename).read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(exported)
        exported.pop("$schema")
        exported.pop("$id")
        assert exported == model.model_json_schema(by_alias=True)
