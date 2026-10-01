import json
from pathlib import Path

from wmgj_api.models import AiAnalysisRequest


def test_synthetic_eval_cases_are_valid_and_deidentified():
    path = Path(__file__).parents[1] / "evals" / "cases.jsonl"
    cases = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert len(cases) >= 3
    for case in cases:
        request = AiAnalysisRequest.model_validate(case["input"])
        assert request.sensitivity.value != "CLINICAL_SENSITIVE"
        serialized = request.model_dump_json().lower()
        assert "cpf" not in serialized
        assert "cns" not in serialized
