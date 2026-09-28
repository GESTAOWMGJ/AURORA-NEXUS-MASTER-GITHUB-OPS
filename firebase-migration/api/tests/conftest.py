from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import wmgj_api.app as app_module
from wmgj_api.auth import get_identity
from wmgj_api.config import Settings, get_settings
from wmgj_api.errors import IdempotencyConflictError, PolicyBlockedError, RevisionConflictError
from wmgj_api.models import (
    AiRunResponse,
    AiRunStatus,
    AiStructuredOutput,
    AuditMetrics,
    CompletenessState,
    DashboardAlert,
    DashboardSnapshot,
    FinancialMetrics,
    Membership,
    OperationalSeverity,
    PipelineMetrics,
    ReviewRequest,
    ReviewResponse,
    ReviewState,
    RiskLevel,
    Role,
    SourceState,
    VerifiedIdentity,
)
from wmgj_api.openai_service import AiExecution
from wmgj_api.repositories import get_repository


class FakeRepository:
    def __init__(self) -> None:
        self.memberships = {
            ("wmgj", "admin"): Membership(
                uid="admin", role=Role.ORG_ADMIN, active=True, all_facilities=True
            )
        }
        self.snapshot = DashboardSnapshot(
            schema_version=2,
            org_id="wmgj",
            competence="2026-08",
            generated_at=datetime.now(UTC) - timedelta(seconds=120),
            as_of=datetime.now(UTC) - timedelta(seconds=120),
            policy_version="dashboard-v1",
            completeness=CompletenessState.PARTIAL,
            severity=OperationalSeverity.ATTENTION,
            pipeline=PipelineMetrics(
                total=25,
                queued=4,
                processing=2,
                validated=15,
                pending_human_review=3,
                failed=1,
                dead_letter=0,
                duplicate_events=2,
            ),
            financial=FinancialMetrics(
                billed_amount=1000,
                received_amount=800,
                pending_amount=200,
                reconciliation_difference=0,
            ),
            audit=AuditMetrics(
                open_findings=2,
                critical_findings=1,
                overdue_actions=1,
                evidence_gaps=1,
            ),
            sources=[
                SourceState(source="GMAIL", completeness=CompletenessState.COMPLETE),
                SourceState(source="SHEETS", completeness=CompletenessState.PARTIAL),
            ],
            alerts=[
                DashboardAlert(
                    alert_id="a1",
                    severity=RiskLevel.HIGH,
                    title="Conciliação pendente",
                    detail="Requer revisão humana",
                    evidence_refs=["doc:1"],
                    created_at=datetime.now(UTC),
                )
            ],
            sanitized=True,
            sensitivity="INTERNAL",
            state="SHADOW",
            financial_cents={
                "invoicedCents": 100_000,
                "receivedCents": 80_000,
                "glossCents": 0,
                "outstandingCents": 20_000,
            },
            operations={"openActions": 2, "overdueActions": 1, "openFindings": 2},
            coverage={"evidencePercent": 80, "reconciliationPercent": 75},
            sample_sizes={
                "invoices": 10,
                "bankTransactions": 8,
                "glosses": 1,
                "actionItems": 2,
                "sourceDocuments": 5,
                "reconciliations": 4,
                "auditFindings": 2,
            },
            data_quality={
                "complete": True,
                "sourcePresent": True,
                "invalidFinancialRecords": 0,
                "validFinancialRecords": 19,
            },
            modules=[
                {"id": f"M{index:02d}", "name": name, "status": "LEARNING"}
                for index, name in enumerate(
                    [
                        "Ingestão e Proveniência Documental",
                        "Contratos, Regras e Evidências",
                        "Ciclo de Receita e Conciliação",
                        "Glosas, Recursos e Divergências",
                        "SLA e Workflow",
                        "Governança e Planos de Ação",
                        "Indicadores e Relatórios",
                        "Integrações e Conectores",
                        "Segurança, LGPD e Segregação",
                        "Trilha de Auditoria e Integridade",
                    ],
                    start=1,
                )
            ],
            engine={"name": "aurora-projection", "version": 2, "mode": "SHADOW"},
            source_limit=1000,
            source_hash="a" * 64,
            snapshot_id="123e4567-e89b-42d3-a456-426614174000",
        )
        self.runs: dict[str, AiRunResponse] = {}
        self.idempotency: dict[str, tuple[str, str]] = {}

    async def ready(self) -> bool:
        return True

    async def get_membership(self, org_id: str, uid: str):
        return self.memberships.get((org_id, uid))

    async def get_dashboard_snapshot(self, org_id: str, competence: str):
        if org_id == "wmgj" and competence == self.snapshot.competence:
            return self.snapshot
        return None

    async def reserve_ai_run(
        self,
        org_id,
        uid,
        idempotency_key,
        request_hash,
        sensitivity,
        evidence_refs,
        model,
        prompt_version,
        ruleset_version,
    ):
        existing = self.idempotency.get(idempotency_key)
        if existing:
            existing_hash, run_id = existing
            if existing_hash != request_hash:
                raise IdempotencyConflictError()
            return self.runs[run_id].model_copy(update={"duplicate": True}), False
        run = AiRunResponse(
            run_id=str(uuid4()),
            org_id=org_id,
            status=AiRunStatus.PROCESSING,
            review_state=ReviewState.PENDING,
            model=model,
            prompt_version=prompt_version,
            ruleset_version=ruleset_version,
            sensitivity=sensitivity,
            evidence_refs=evidence_refs,
            input_hash=request_hash,
            created_at=datetime.now(UTC),
            revision=1,
        )
        self.runs[run.run_id] = run
        self.idempotency[idempotency_key] = (request_hash, run.run_id)
        return run, True

    async def complete_ai_run(self, org_id, run_id, response, usage):
        completed = response.model_copy(update={"revision": 2})
        self.runs[run_id] = completed
        return completed

    async def fail_ai_run(self, org_id, run_id):
        failed = self.runs[run_id].model_copy(
            update={"status": AiRunStatus.FAILED, "revision": 2}
        )
        self.runs[run_id] = failed
        return failed

    async def get_ai_run(self, org_id, run_id):
        return self.runs.get(run_id)

    async def review_ai_run(self, org_id, run_id, reviewer_uid, review: ReviewRequest):
        run = self.runs[run_id]
        if run.revision != review.expected_revision:
            raise RevisionConflictError()
        review_refs = set(review.evidence_refs)
        if review.decision.value == "APPROVED" and not review_refs:
            raise PolicyBlockedError()
        if not review_refs.issubset(set(run.evidence_refs)):
            raise PolicyBlockedError()
        reviewed = run.model_copy(
            update={"review_state": ReviewState(review.decision.value), "revision": run.revision + 1}
        )
        self.runs[run_id] = reviewed
        return ReviewResponse(
            run_id=run_id,
            decision=review.decision,
            reviewer_uid=reviewer_uid,
            reviewed_at=datetime.now(UTC),
            revision=reviewed.revision,
        )


class FakeAnalysisEngine:
    async def execute(self, request, safety_identifier=None):
        result = AiStructuredOutput(
            executive_summary="Há uma pendência documentada para revisão.",
            abstained=False,
            findings=[
                {
                    "title": "Conciliação pendente",
                    "rationale": "A evidência informa divergência ainda não validada.",
                    "riskLevel": "HIGH",
                    "evidenceRefs": [request.evidence[0].evidence_ref],
                    "ruleRefs": ["REGRA_EVIDENCIA"],
                    "confidenceSignal": 0.8,
                }
            ],
            missing_evidence=[],
            recommended_actions=["Submeter a conciliação à revisão humana"],
            limitations=["Não fecha competência"],
            needs_human_review=True,
        )
        return AiExecution(
            status=AiRunStatus.COMPLETED_PENDING_REVIEW,
            result=result,
            response_id="resp_test",
            request_id="req_test",
            output_hash="a" * 64,
            latency_ms=12,
            usage={"input_tokens": 10, "output_tokens": 20},
        )


@pytest.fixture
def fake_repository() -> FakeRepository:
    return FakeRepository()


@pytest.fixture
def client(fake_repository: FakeRepository, monkeypatch: pytest.MonkeyPatch):
    settings = Settings(
        env="test",
        firebase_project_id="test-project",
        allowed_orgs=("wmgj",),
        openai_execution_enabled=True,
        clinical_ai_enabled=False,
        require_app_check=False,
        require_mfa_for_reviews=True,
        dashboard_delayed_after_seconds=90,
        dashboard_stale_after_seconds=300,
    )

    async def fake_identity() -> VerifiedIdentity:
        return VerifiedIdentity(uid="admin", mfa_verified=True)

    app_module.app.dependency_overrides[get_identity] = fake_identity
    app_module.app.dependency_overrides[get_repository] = lambda: fake_repository
    app_module.app.dependency_overrides[get_settings] = lambda: settings
    monkeypatch.setattr(app_module, "get_analysis_engine", lambda: FakeAnalysisEngine())
    with TestClient(app_module.app) as test_client:
        yield test_client
    app_module.app.dependency_overrides.clear()
