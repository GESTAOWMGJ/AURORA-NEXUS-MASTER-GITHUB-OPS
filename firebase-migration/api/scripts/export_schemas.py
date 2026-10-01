"""Export Pydantic contracts. Generated JSON must be committed with model changes."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from wmgj_api.models import AiAnalysisRequest, AiStructuredOutput, DashboardSnapshot


TARGET = Path(__file__).parents[2] / "schemas"
CONTRACTS = {
    "ai-analysis-request.schema.json": AiAnalysisRequest,
    "ai-analysis-output.schema.json": AiStructuredOutput,
    "dashboard-snapshot.schema.json": DashboardSnapshot,
}


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for filename, model in CONTRACTS.items():
        schema = model.model_json_schema(by_alias=True)
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        schema["$id"] = f"https://wmgj.example/schemas/{filename}"
        path = TARGET / filename
        path.write_text(
            json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
