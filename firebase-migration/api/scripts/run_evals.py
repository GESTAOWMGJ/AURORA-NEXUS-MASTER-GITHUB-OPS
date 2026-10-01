"""Local, synthetic eval harness. Live execution requires an explicit --live flag."""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from wmgj_api.models import AiAnalysisRequest
from wmgj_api.openai_service import get_analysis_engine


CASES = Path(__file__).parents[1] / "evals" / "cases.jsonl"


def load_cases() -> list[dict]:
    return [json.loads(line) for line in CASES.read_text(encoding="utf-8").splitlines() if line.strip()]


def grade(case: dict, result) -> dict:
    expected = case["expected"]
    output = result.result
    checks = {
        "completed": output is not None,
        "needsHumanReview": bool(output and output.needs_human_review),
        "expectedAbstention": bool(output and output.abstained == expected["abstained"]),
        "groundedEvidence": False,
    }
    if output is not None:
        used = {ref for finding in output.findings for ref in finding.evidence_refs}
        supplied = {item["evidenceRef"] for item in case["input"]["evidence"]}
        required = set(expected["requiredEvidenceRefs"])
        checks["groundedEvidence"] = used <= supplied and required <= used
    return {"caseId": case["caseId"], "passed": all(checks.values()), "checks": checks}


async def main(live: bool) -> int:
    cases = load_cases()
    for case in cases:
        AiAnalysisRequest.model_validate(case["input"])
    if not live:
        print(json.dumps({"mode": "offline-contract-only", "validCases": len(cases)}))
        return 0

    engine = get_analysis_engine()
    results = []
    for case in cases:
        execution = await engine.execute(AiAnalysisRequest.model_validate(case["input"]))
        results.append(grade(case, execution))
    passed = sum(1 for item in results if item["passed"])
    print(json.dumps({"mode": "live", "passed": passed, "total": len(results), "results": results}))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--live",
        action="store_true",
        help="Execute real OpenAI requests. This is opt-in and may incur cost.",
    )
    raise SystemExit(asyncio.run(main(parser.parse_args().live)))
