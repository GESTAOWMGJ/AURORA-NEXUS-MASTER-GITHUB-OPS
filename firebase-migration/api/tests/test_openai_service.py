from types import SimpleNamespace

import pytest

from wmgj_api.config import Settings
from wmgj_api.models import AiAnalysisRequest, AiStructuredOutput
from wmgj_api.openai_service import OpenAIAnalysisEngine


def request_model():
    return AiAnalysisRequest.model_validate(
        {
            "taskType": "AUDIT_FINDING_DRAFT",
            "purpose": "Preparar achado estritamente baseado na evidência",
            "sensitivity": "RESTRICTED",
            "dataMinimized": True,
            "humanReviewRequired": True,
            "evidence": [
                {"evidenceRef": "doc:1", "fact": "Pendência registrada", "sourceType": "DOC"}
            ],
        }
    )


class FakeResponses:
    def __init__(self, output):
        self.output = output
        self.kwargs = None

    async def parse(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            id="resp_1",
            status="completed",
            output_parsed=self.output,
            output=[],
            usage=SimpleNamespace(model_dump=lambda mode: {"input_tokens": 3}),
            _request_id="req_1",
        )


@pytest.mark.asyncio
async def test_openai_call_disables_storage_and_uses_typed_output():
    output = AiStructuredOutput(
        executive_summary="Evidência insuficiente para concluir.",
        abstained=True,
        findings=[],
        missing_evidence=["Comprovante de pagamento"],
        recommended_actions=["Solicitar comprovante"],
        limitations=["Sem decisão financeira"],
        needs_human_review=True,
    )
    responses = FakeResponses(output)
    engine = object.__new__(OpenAIAnalysisEngine)
    engine.settings = Settings(openai_api_key="test", openai_model="gpt-5.6")
    engine.client = SimpleNamespace(responses=responses)

    result = await engine.execute(request_model())

    assert responses.kwargs["store"] is False
    assert responses.kwargs["text_format"] is AiStructuredOutput
    assert "tools" not in responses.kwargs
    assert result.result is not None and result.result.needs_human_review is True


@pytest.mark.asyncio
async def test_unknown_evidence_reference_is_rejected():
    output = AiStructuredOutput.model_validate(
        {
            "executiveSummary": "Achado",
            "abstained": False,
            "findings": [
                {
                    "title": "Referência inválida",
                    "rationale": "Não existe na entrada",
                    "riskLevel": "HIGH",
                    "evidenceRefs": ["doc:inventado"],
                    "ruleRefs": [],
                    "confidenceSignal": 0.2,
                }
            ],
            "missingEvidence": [],
            "recommendedActions": [],
            "limitations": [],
            "needsHumanReview": True,
        }
    )
    responses = FakeResponses(output)
    engine = object.__new__(OpenAIAnalysisEngine)
    engine.settings = Settings(openai_api_key="test", openai_model="gpt-5.6")
    engine.client = SimpleNamespace(responses=responses)

    with pytest.raises(Exception, match="unknown evidence"):
        await engine.execute(request_model())


@pytest.mark.asyncio
async def test_direct_identifier_in_model_output_is_rejected():
    output = AiStructuredOutput(
        executive_summary="O CPF 123.456.789-00 apareceu indevidamente.",
        abstained=True,
        findings=[],
        missing_evidence=["Comprovante desidentificado"],
        recommended_actions=["Revisar fora do modelo"],
        limitations=["Saída bloqueada"],
        needs_human_review=True,
    )
    responses = FakeResponses(output)
    engine = object.__new__(OpenAIAnalysisEngine)
    engine.settings = Settings(openai_api_key="test", openai_model="gpt-5.6")
    engine.client = SimpleNamespace(responses=responses)

    with pytest.raises(Exception, match="direct personal identifier"):
        await engine.execute(request_model())
