from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class StrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="forbid",
    )


EvidenceReference = Annotated[str, Field(min_length=1, max_length=256)]
DraftListItem = Annotated[str, Field(min_length=1, max_length=1_000)]


class Role(StrEnum):
    PLATFORM_ADMIN = "platform_admin"
    ORG_ADMIN = "org_admin"
    DIRECTOR = "director"
    AUDITOR = "auditor"
    MEDICAL_AUDITOR = "medical_auditor"
    FINANCE = "finance"
    OPERATOR = "operator"
    VIEWER = "viewer"


class Permission(StrEnum):
    DASHBOARD_READ = "dashboard:read"
    AI_RUN_CREATE = "ai_run:create"
    AI_RUN_READ = "ai_run:read"
    AI_RUN_REVIEW = "ai_run:review"


class RiskLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class Sensitivity(StrEnum):
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"
    RESTRICTED = "RESTRICTED"
    CLINICAL_SENSITIVE = "CLINICAL_SENSITIVE"


class CompletenessState(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    EMPTY = "EMPTY"
    INVALID = "INVALID"


class OperationalSeverity(StrEnum):
    NOMINAL = "NOMINAL"
    ATTENTION = "ATTENTION"
    BLOCKED = "BLOCKED"
    UNKNOWN = "UNKNOWN"


class FreshnessState(StrEnum):
    FRESH = "FRESH"
    DELAYED = "DELAYED"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"


class Principal(StrictModel):
    uid: str
    org_id: str
    role: Role
    facility_ids: list[str] = Field(default_factory=list)
    all_facilities: bool = False
    mfa_verified: bool = False


class VerifiedIdentity(StrictModel):
    uid: str
    mfa_verified: bool = False


class PipelineMetrics(StrictModel):
    total: int | None = Field(default=None, ge=0)
    queued: int | None = Field(default=None, ge=0)
    processing: int | None = Field(default=None, ge=0)
    validated: int | None = Field(default=None, ge=0)
    pending_human_review: int | None = Field(default=None, ge=0)
    failed: int | None = Field(default=None, ge=0)
    dead_letter: int | None = Field(default=None, ge=0)
    duplicate_events: int | None = Field(default=None, ge=0)


class FinancialMetrics(StrictModel):
    billed_amount: float | None = Field(default=None, ge=0)
    received_amount: float | None = Field(default=None, ge=0)
    pending_amount: float | None = Field(default=None, ge=0)
    reconciliation_difference: float | None = None
    currency: Literal["BRL"] = "BRL"


class AuditMetrics(StrictModel):
    open_findings: int | None = Field(default=None, ge=0)
    critical_findings: int | None = Field(default=None, ge=0)
    overdue_actions: int | None = Field(default=None, ge=0)
    evidence_gaps: int | None = Field(default=None, ge=0)


class SourceState(StrictModel):
    source: str
    completeness: CompletenessState
    freshness: FreshnessState = FreshnessState.UNKNOWN
    last_success_at: datetime | None = None
    expected_cadence_seconds: int | None = Field(default=None, ge=1)
    stale_after_seconds: int | None = Field(default=None, ge=1)
    missing: bool = False
    detail: str | None = None


class DashboardAlert(StrictModel):
    alert_id: str
    severity: RiskLevel
    title: str
    detail: str
    evidence_refs: list[str] = Field(default_factory=list)
    created_at: datetime


class DashboardFinancialCents(StrictModel):
    invoiced_cents: Annotated[int, Field(ge=0)] | None
    received_cents: Annotated[int, Field(ge=0)] | None
    gloss_cents: Annotated[int, Field(ge=0)] | None
    outstanding_cents: int | None


class DashboardOperations(StrictModel):
    open_actions: int = Field(ge=0)
    overdue_actions: int = Field(ge=0)
    open_findings: int = Field(ge=0)


class DashboardCoverage(StrictModel):
    evidence_percent: Annotated[float, Field(ge=0, le=100)] | None
    reconciliation_percent: Annotated[float, Field(ge=0, le=100)] | None


class DashboardSampleSizes(StrictModel):
    invoices: int = Field(ge=0)
    bank_transactions: int = Field(ge=0)
    glosses: int = Field(ge=0)
    action_items: int = Field(ge=0)
    source_documents: int = Field(ge=0)
    reconciliations: int = Field(ge=0)
    audit_findings: int = Field(ge=0)


class DashboardDataQuality(StrictModel):
    complete: Literal[True]
    source_present: Literal[True]
    invalid_financial_records: Literal[0]
    valid_financial_records: int = Field(ge=0)


class DashboardModule(StrictModel):
    id: Literal["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10"]
    name: str = Field(min_length=1, max_length=128)
    status: Literal["LEARNING"]


class DashboardEngine(StrictModel):
    name: Literal["aurora-projection"]
    version: Literal[2]
    mode: Literal["SHADOW"]


class DashboardSnapshot(StrictModel):
    schema_version: Literal[2]
    org_id: str
    facility_id: str | None = None
    competence: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    generated_at: datetime
    as_of: datetime
    policy_version: str
    completeness: CompletenessState
    severity: OperationalSeverity
    pipeline: PipelineMetrics
    financial: FinancialMetrics
    audit: AuditMetrics
    sources: list[SourceState]
    alerts: list[DashboardAlert] = Field(max_length=50)
    sanitized: Literal[True]
    sensitivity: Literal["INTERNAL"]
    state: Literal["SHADOW"]
    financial_cents: DashboardFinancialCents
    operations: DashboardOperations
    coverage: DashboardCoverage
    sample_sizes: DashboardSampleSizes
    data_quality: DashboardDataQuality
    modules: list[DashboardModule] = Field(min_length=10, max_length=10)
    engine: DashboardEngine
    source_limit: Literal[1000]
    source_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    snapshot_id: str = Field(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    )


class Freshness(StrictModel):
    state: FreshnessState
    age_seconds: int = Field(ge=0)
    generated_at: datetime


class DashboardResponse(StrictModel):
    snapshot: DashboardSnapshot
    freshness: Freshness


class AiTaskType(StrEnum):
    DOCUMENT_CLASSIFICATION = "DOCUMENT_CLASSIFICATION"
    AUDIT_FINDING_DRAFT = "AUDIT_FINDING_DRAFT"
    RECONCILIATION_REVIEW = "RECONCILIATION_REVIEW"
    CLINICAL_AUDIT_DRAFT = "CLINICAL_AUDIT_DRAFT"


class EvidenceItem(StrictModel):
    evidence_ref: str = Field(min_length=1, max_length=256)
    fact: str = Field(min_length=1, max_length=4_000)
    source_type: str = Field(min_length=1, max_length=64)
    observed_at: datetime | None = None


class AiAnalysisRequest(StrictModel):
    task_type: AiTaskType
    purpose: str = Field(min_length=8, max_length=512)
    sensitivity: Sensitivity
    data_minimized: Literal[True]
    human_review_required: Literal[True]
    evidence: list[EvidenceItem] = Field(min_length=1, max_length=50)


class AiFinding(StrictModel):
    title: str = Field(min_length=1, max_length=256)
    rationale: str = Field(min_length=1, max_length=2_000)
    risk_level: RiskLevel
    evidence_refs: list[EvidenceReference] = Field(min_length=1, max_length=20)
    rule_refs: list[EvidenceReference] = Field(default_factory=list, max_length=20)
    confidence_signal: float = Field(ge=0, le=1)


class AiStructuredOutput(StrictModel):
    executive_summary: str = Field(min_length=1, max_length=2_000)
    abstained: bool
    findings: list[AiFinding] = Field(max_length=30)
    missing_evidence: list[DraftListItem] = Field(max_length=30)
    recommended_actions: list[DraftListItem] = Field(max_length=30)
    limitations: list[DraftListItem] = Field(max_length=30)
    needs_human_review: Literal[True]


class AiRunStatus(StrEnum):
    PROCESSING = "PROCESSING"
    COMPLETED_PENDING_REVIEW = "COMPLETED_PENDING_REVIEW"
    REFUSED = "REFUSED"
    INCOMPLETE = "INCOMPLETE"
    FAILED = "FAILED"


class ReviewState(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REVISION_REQUESTED = "REVISION_REQUESTED"


class AiRunResponse(StrictModel):
    schema_version: Literal[1] = 1
    run_id: str
    org_id: str
    provider: Literal["openai"] = "openai"
    status: AiRunStatus
    review_state: ReviewState
    model: str
    prompt_version: str
    ruleset_version: str
    sensitivity: Sensitivity
    evidence_refs: list[EvidenceReference]
    input_hash: str
    output_hash: str | None = None
    response_id: str | None = None
    request_id: str | None = None
    latency_ms: int | None = Field(default=None, ge=0)
    result: AiStructuredOutput | None = None
    created_at: datetime
    completed_at: datetime | None = None
    failed_at: datetime | None = None
    reviewed_at: datetime | None = None
    reviewer_uid: str | None = None
    usage: dict[str, Any] = Field(default_factory=dict)
    revision: int = Field(ge=1)
    duplicate: bool = False


class ReviewDecision(StrEnum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REVISION_REQUESTED = "REVISION_REQUESTED"


class ReviewRequest(StrictModel):
    decision: ReviewDecision
    expected_revision: int = Field(ge=1)
    rationale: str = Field(min_length=10, max_length=2_000)
    evidence_refs: list[EvidenceReference] = Field(default_factory=list, max_length=30)


class ReviewResponse(StrictModel):
    run_id: str
    decision: ReviewDecision
    reviewer_uid: str
    reviewed_at: datetime
    revision: int


class Membership(StrictModel):
    uid: str
    role: Role
    active: bool
    facility_ids: list[str] = Field(default_factory=list)
    all_facilities: bool = False


class StoredAiRun(StrictModel):
    response: AiRunResponse
    request_hash: str
    idempotency_key_hash: str
    actor_uid: str
    sensitivity: Sensitivity
    evidence_refs: list[str]
    usage: dict[str, Any] = Field(default_factory=dict)
