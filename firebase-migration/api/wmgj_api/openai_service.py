import hashlib
import json
from time import perf_counter
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from openai import AsyncOpenAI

from .config import get_settings
from .errors import NotConfiguredError, UpstreamServiceError
from .models import AiAnalysisRequest, AiRunStatus, AiStructuredOutput
from .privacy import contains_direct_identifier


SYSTEM_INSTRUCTIONS = """You draft auditable hospital-operations findings from supplied evidence only.
Use only the evidenceRefs present in the input. Never invent a document, value, rule, diagnosis,
decision, approval, payment, closing status, or clinical conclusion. If evidence is insufficient,
abstain and list the missing evidence. Recommendations are drafts for a qualified human reviewer.
Do not expose chain-of-thought. Return only the requested structured output."""


@dataclass(frozen=True)
class AiExecution:
    status: AiRunStatus
    result: AiStructuredOutput | None
    response_id: str | None
    request_id: str | None
    output_hash: str | None
    latency_ms: int
    usage: dict[str, object]


class AnalysisEngine(Protocol):
    async def execute(
        self, request: AiAnalysisRequest, safety_identifier: str | None = None
    ) -> AiExecution: ...


class OpenAIAnalysisEngine:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_execution_enabled:
            raise NotConfiguredError("OpenAI execution is disabled")
        if settings.openai_api_key is None or not settings.openai_api_key.get_secret_value():
            raise NotConfiguredError("OPENAI_API_KEY is required for AI execution")
        self.settings = settings
        self.client = AsyncOpenAI(api_key=settings.openai_api_key.get_secret_value())

    async def execute(
        self, request: AiAnalysisRequest, safety_identifier: str | None = None
    ) -> AiExecution:
        payload = request.model_dump(mode="json", by_alias=True)
        started = perf_counter()
        try:
            response = await self.client.responses.parse(
                model=self.settings.openai_model,
                instructions=SYSTEM_INSTRUCTIONS,
                input=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                text_format=AiStructuredOutput,
                reasoning={"effort": "medium"},
                max_output_tokens=3_000,
                store=False,
                safety_identifier=safety_identifier,
            )
        except Exception as exc:
            raise UpstreamServiceError("OpenAI request failed") from exc

        latency_ms = max(0, int((perf_counter() - started) * 1_000))
        request_id = getattr(response, "_request_id", None)

        usage = response.usage.model_dump(mode="json") if response.usage else {}
        if response.status == "incomplete":
            return AiExecution(
                status=AiRunStatus.INCOMPLETE,
                result=None,
                response_id=response.id,
                request_id=request_id,
                output_hash=None,
                latency_ms=latency_ms,
                usage=usage,
            )

        parsed = response.output_parsed
        if parsed is None:
            refusal = any(
                getattr(content, "type", "") == "refusal"
                for item in response.output
                for content in getattr(item, "content", [])
            )
            return AiExecution(
                status=AiRunStatus.REFUSED if refusal else AiRunStatus.FAILED,
                result=None,
                response_id=response.id,
                request_id=request_id,
                output_hash=None,
                latency_ms=latency_ms,
                usage=usage,
            )

        allowed_refs = {item.evidence_ref for item in request.evidence}
        used_refs = {
            evidence_ref
            for finding in parsed.findings
            for evidence_ref in finding.evidence_refs
        }
        unknown_refs = sorted(used_refs - allowed_refs)
        if unknown_refs:
            raise UpstreamServiceError("model output referenced unknown evidence")
        if parsed.abstained and parsed.findings:
            raise UpstreamServiceError("abstained output cannot contain findings")
        if contains_direct_identifier(parsed.model_dump(mode="json", by_alias=True)):
            raise UpstreamServiceError("model output contained a direct personal identifier")

        output_json = parsed.model_dump_json(by_alias=True)
        return AiExecution(
            status=AiRunStatus.COMPLETED_PENDING_REVIEW,
            result=parsed,
            response_id=response.id,
            request_id=request_id,
            output_hash=hashlib.sha256(output_json.encode("utf-8")).hexdigest(),
            latency_ms=latency_ms,
            usage=usage,
        )


@lru_cache
def get_analysis_engine() -> AnalysisEngine:
    return OpenAIAnalysisEngine()
