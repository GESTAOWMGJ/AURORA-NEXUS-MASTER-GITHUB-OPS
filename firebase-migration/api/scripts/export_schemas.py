"""Export Pydantic contracts. Generated JSON must be committed with model changes."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from pydantic import TypeAdapter

from wmgj_api.models import (
    AiAnalysisRequest,
    AiStructuredOutput,
    DASHBOARD_SNAPSHOT_ADAPTER,
    DashboardSnapshotV2,
    DashboardSnapshotV3,
)


TARGET = Path(__file__).parents[2] / "schemas"
CONTRACTS = {
    "ai-analysis-request.schema.json": TypeAdapter(AiAnalysisRequest),
    "ai-analysis-output.schema.json": TypeAdapter(AiStructuredOutput),
    "dashboard-snapshot.schema.json": DASHBOARD_SNAPSHOT_ADAPTER,
    "dashboard-snapshot.v2.schema.json": TypeAdapter(DashboardSnapshotV2),
    "dashboard-snapshot.v3.schema.json": TypeAdapter(DashboardSnapshotV3),
}


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for filename, adapter in CONTRACTS.items():
        schema = adapter.json_schema(by_alias=True)
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        schema["$id"] = f"https://wmgj.example/schemas/{filename}"
        path = TARGET / filename
        path.write_text(
            json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
