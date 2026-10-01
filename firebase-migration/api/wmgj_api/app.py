import re
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .auth import require_permission
from .config import Settings, get_settings
from .errors import (
    IdempotencyConflictError,
    NotConfiguredError,
    NotFoundError,
    PolicyBlockedError,
    RevisionConflictError,
    UpstreamServiceError,
    WmgjError,
)
from .models import (
    AiAnalysisRequest,
    AiRunResponse,
    AiTaskType,
    DashboardResponse,
    Freshness,
    FreshnessState,
    Permission,
    Principal,
    ReviewRequest,
    ReviewResponse,
    Role,
    Sensitivity,
)
from .openai_service import AnalysisEngine, get_analysis_engine
from .privacy import contains_direct_identifier
from .repositories import Repository, canonical_json, get_repository, sha256


STATIC_DIR = Path(__file__).with_name("static")
IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9._:-]{8,256}$")

app = FastAPI(
    title="WMGJ Control Plane",
    version="0.1.0",
    description="BFF de homologação para dashboard, IA auditável e revisão humana.",
)
app.mount("/assets", StaticFiles(directory=STATIC_DIR, check_dir=False), name="assets")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    )
    if request.url.path.startswith("/v1/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(NotFoundError)
async def not_found_handler(_request: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"code": exc.code})


@app.exception_handler(IdempotencyConflictError)
async def idempotency_handler(_request: Request, exc: IdempotencyConflictError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"code": exc.code})


@app.exception_handler(RevisionConflictError)
async def revision_handler(_request: Request, exc: RevisionConflictError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"code": exc.code})


@app.exception_handler(PolicyBlockedError)
async def policy_handler(_request: Request, exc: PolicyBlockedError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"code": exc.code})


@app.exception_handler(NotConfiguredError)
async def config_handler(_request: Request, exc: NotConfiguredError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"code": exc.code})


@app.exception_handler(UpstreamServiceError)
async def upstream_handler(_request: Request, exc: UpstreamServiceError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"code": exc.code})


@app.exception_handler(WmgjError)
async def domain_handler(_request: Request, exc: WmgjError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"code": exc.code})


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    redacted = []
    for error in exc.errors()[:20]:
        location = [str(item) for item in error.get("loc", ()) if item != "body"]
        redacted.append(
            {
                "field": ".".join(location) or "request",
                "type": str(error.get("type") or "validation_error"),
            }
        )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"code": "REQUEST_VALIDATION_ERROR", "errors": redacted},
    )


def ensure_org_allowed(org_id: str, settings: Settings) -> None:
    if org_id not in settings.allowed_orgs:
        raise HTTPException(status_code=403, detail={"code": "ORG_NOT_ALLOWED"})


def enforce_ai_policy(
    request: AiAnalysisRequest,
    principal: Principal,
    settings: Settings,
) -> None:
    if not settings.openai_execution_enabled:
        raise PolicyBlockedError("OpenAI execution is disabled")
    references = [item.evidence_ref for item in request.evidence]
    if len(references) != len(set(references)):
        raise PolicyBlockedError("evidenceRefs must be unique")
    text_fields = [request.purpose]
    text_fields.extend(item.fact for item in request.evidence)
    text_fields.extend(item.evidence_ref for item in request.evidence)
    if contains_direct_identifier(text_fields):
        raise PolicyBlockedError("direct personal identifier detected in AI evidence")
    clinical = (
        request.sensitivity == Sensitivity.CLINICAL_SENSITIVE
        or request.task_type == AiTaskType.CLINICAL_AUDIT_DRAFT
    )
    if clinical and not settings.clinical_ai_enabled:
        raise PolicyBlockedError("clinical AI is disabled")
    if clinical and principal.role not in {
        Role.PLATFORM_ADMIN,
        Role.ORG_ADMIN,
        Role.AUDITOR,
        Role.MEDICAL_AUDITOR,
    }:
        raise PolicyBlockedError("clinical AI requires medical audit permission")
    if clinical and settings.require_mfa_for_reviews and not principal.mfa_verified:
        raise PolicyBlockedError("clinical AI requires MFA")


def freshness_for(generated_at: datetime, settings: Settings) -> Freshness:
    now = datetime.now(UTC)
    normalized = generated_at if generated_at.tzinfo else generated_at.replace(tzinfo=UTC)
    age = max(0, int((now - normalized).total_seconds()))
    if age <= settings.dashboard_delayed_after_seconds:
        state_value = FreshnessState.FRESH
    elif age <= settings.dashboard_stale_after_seconds:
        state_value = FreshnessState.DELAYED
    else:
        state_value = FreshnessState.STALE
    return Freshness(state=state_value, age_seconds=age, generated_at=normalized)


@app.get("/", include_in_schema=False)
async def root(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "service": settings.service_name,
        "environment": settings.env,
        "schemaVersion": 1,
        "dashboard": "/dashboard?demo=1",
    }


@app.get("/dashboard", include_in_schema=False)
async def dashboard_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "dashboard.html", media_type="text/html")


@app.get("/health/live")
async def health_live(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "ok": True,
        "service": settings.service_name,
        "schemaVersion": 1,
        "time": datetime.now(UTC).isoformat(),
    }


@app.get("/health/ready")
async def health_ready(settings: Settings = Depends(get_settings)) -> JSONResponse:
    configured = bool(settings.firebase_project_id)
    firestore_ready = False
    if configured:
        try:
            firestore_ready = await get_repository().ready()
        except Exception:
            firestore_ready = False
    ready = configured and firestore_ready
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "ready": ready,
            "configuration": "READY" if configured else "MISSING",
            "firestore": "READY" if firestore_ready else "UNAVAILABLE",
        },
    )


@app.get(
    "/v1/organizations/{org_id}/dashboards/operational",
    response_model=DashboardResponse,
    response_model_by_alias=True,
)
async def operational_dashboard(
    org_id: str,
    competence: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    principal: Principal = Depends(require_permission(Permission.DASHBOARD_READ)),
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> DashboardResponse:
    ensure_org_allowed(org_id, settings)
    if not principal.all_facilities:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ORG_WIDE_SCOPE_REQUIRED"},
        )
    snapshot = await repository.get_dashboard_snapshot(org_id, competence)
    if snapshot is None:
        raise NotFoundError("dashboard snapshot not found")
    if snapshot.org_id != org_id:
        raise UpstreamServiceError("dashboard snapshot organization mismatch")
    return DashboardResponse(
        snapshot=snapshot,
        freshness=freshness_for(snapshot.generated_at, settings),
    )


@app.post(
    "/v1/organizations/{org_id}/ai-runs",
    response_model=AiRunResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_ai_run(
    org_id: str,
    request: AiAnalysisRequest,
    response: Response,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    principal: Principal = Depends(require_permission(Permission.AI_RUN_CREATE)),
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> AiRunResponse:
    ensure_org_allowed(org_id, settings)
    if not IDEMPOTENCY_KEY.fullmatch(idempotency_key):
        raise HTTPException(status_code=400, detail={"code": "INVALID_IDEMPOTENCY_KEY"})
    enforce_ai_policy(request, principal, settings)
    request_hash = sha256(canonical_json(request.model_dump(mode="json", by_alias=True)))
    evidence_refs = [item.evidence_ref for item in request.evidence]
    reserved, created = await repository.reserve_ai_run(
        org_id=org_id,
        uid=principal.uid,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        sensitivity=request.sensitivity,
        evidence_refs=evidence_refs,
        model=settings.openai_model,
        prompt_version=settings.openai_prompt_version,
        ruleset_version=settings.openai_ruleset_version,
    )
    if not created:
        response.status_code = status.HTTP_200_OK
        return reserved

    try:
        engine: AnalysisEngine = get_analysis_engine()
        execution = await engine.execute(
            request,
            safety_identifier=sha256(f"{org_id}:{principal.uid}"),
        )
        completed = reserved.model_copy(
            update={
                "status": execution.status,
                "result": execution.result,
                "response_id": execution.response_id,
                "request_id": execution.request_id,
                "output_hash": execution.output_hash,
                "latency_ms": execution.latency_ms,
            }
        )
        return await repository.complete_ai_run(org_id, reserved.run_id, completed, execution.usage)
    except Exception:
        await repository.fail_ai_run(org_id, reserved.run_id)
        raise


@app.get(
    "/v1/organizations/{org_id}/ai-runs/{run_id}",
    response_model=AiRunResponse,
    response_model_by_alias=True,
)
async def get_ai_run(
    org_id: str,
    run_id: str,
    _principal: Principal = Depends(require_permission(Permission.AI_RUN_READ)),
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> AiRunResponse:
    ensure_org_allowed(org_id, settings)
    run = await repository.get_ai_run(org_id, run_id)
    if run is None:
        raise NotFoundError("AI run not found")
    return run


@app.post(
    "/v1/organizations/{org_id}/ai-runs/{run_id}/reviews",
    response_model=ReviewResponse,
    response_model_by_alias=True,
)
async def review_ai_run(
    org_id: str,
    run_id: str,
    review: ReviewRequest,
    principal: Principal = Depends(require_permission(Permission.AI_RUN_REVIEW)),
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> ReviewResponse:
    ensure_org_allowed(org_id, settings)
    if settings.require_mfa_for_reviews and not principal.mfa_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "MFA_REQUIRED", "message": "review requires MFA"},
        )
    if contains_direct_identifier([review.rationale, *review.evidence_refs]):
        raise PolicyBlockedError("direct personal identifier detected in review")
    return await repository.review_ai_run(org_id, run_id, principal.uid, review)
