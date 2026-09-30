from enum import StrEnum
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict


class ExecutionState(StrEnum):
    VERIFIED = "CONCLUIDO_E_VERIFICADO"
    PREPARED = "PREPARADO_NAO_EXECUTADO"
    PENDING = "PENDENTE_DE_APROVACAO"
    BLOCKED = "BLOQUEADO"


class ClinicalBoundary(StrEnum):
    NON_CLINICAL = "NON_CLINICAL"
    READINESS_ONLY = "CLINICAL_READINESS_ONLY"
    CLINICAL_USE_BLOCKED = "CLINICAL_USE_BLOCKED"


class Gate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Literal["G0", "G1", "G2", "G3", "G4"]
    label: str
    state: ExecutionState
    evidence: tuple[str, ...]
    blocking_reason: str | None = None


class DeploymentGuard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dry_run_default: Literal[True] = True
    production_deploy_enabled: Literal[False] = False
    real_data_migration_enabled: Literal[False] = False
    requires_human_approval: Literal[True] = True


class ReadinessSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    source: Literal["SYNTHETIC_DETERMINISTIC"] = "SYNTHETIC_DETERMINISTIC"
    boundary: ClinicalBoundary
    clinical_use_enabled: Literal[False] = False
    patient_communication_enabled: Literal[False] = False
    gates: tuple[Gate, ...]
    deploy: DeploymentGuard


READINESS_SNAPSHOT = ReadinessSnapshot(
    boundary=ClinicalBoundary.READINESS_ONLY,
    gates=(
        Gate(
            id="G0",
            label="Baseline e preservacao operacional",
            state=ExecutionState.VERIFIED,
            evidence=("frontend-build", "functions-build", "contract-tests-9-of-9"),
        ),
        Gate(
            id="G1",
            label="Controles criticos",
            state=ExecutionState.PREPARED,
            evidence=("tenant-negative-tests", "transactional-audit"),
        ),
        Gate(
            id="G2",
            label="Fronteira clinica",
            state=ExecutionState.PREPARED,
            evidence=("feature-flag-off", "clinical-use-fail-closed"),
        ),
        Gate(
            id="G3",
            label="CI e contratos",
            state=ExecutionState.PENDING,
            evidence=("workflow-defined",),
            blocking_reason="Independent approvals and a new CI run are required.",
        ),
        Gate(
            id="G4",
            label="Migracao dry-run",
            state=ExecutionState.PENDING,
            evidence=("synthetic-fixtures-only",),
            blocking_reason="No real source or destination may be accessed in this phase.",
        ),
    ),
    deploy=DeploymentGuard(),
)


app = FastAPI(
    title="WMGJ Clinical Readiness API",
    version="0.1.0",
    description=(
        "Read-only, synthetic contract surface. It does not provide clinical "
        "decisions, access real data, or enable deployment."
    ),
)


@app.get("/health", tags=["system"])
def health() -> dict[str, object]:
    return {"ok": True, "service": "wmgj-clinical-readiness", "schemaVersion": 1}


@app.get("/v1/readiness", response_model=ReadinessSnapshot, tags=["readiness"])
def get_readiness() -> ReadinessSnapshot:
    return READINESS_SNAPSHOT
