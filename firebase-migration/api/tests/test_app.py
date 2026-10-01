import wmgj_api.app as app_module
import pytest
from wmgj_api.auth import get_identity
from wmgj_api.config import Settings
from wmgj_api.errors import PolicyBlockedError
from wmgj_api.models import AiAnalysisRequest, Principal, Role, VerifiedIdentity


def analysis_payload(sensitivity="RESTRICTED", task_type="AUDIT_FINDING_DRAFT"):
    return {
        "taskType": task_type,
        "purpose": "Preparar rascunho de achado para revisão humana",
        "sensitivity": sensitivity,
        "dataMinimized": True,
        "humanReviewRequired": True,
        "evidence": [
            {
                "evidenceRef": "doc:1",
                "fact": "A conciliação consta como pendente.",
                "sourceType": "DOCUMENT",
            }
        ],
    }


def test_openai_execution_kill_switch_defaults_off():
    assert Settings().openai_execution_enabled is False


def test_director_cannot_enable_clinical_ai_without_clinical_role():
    request = AiAnalysisRequest.model_validate(
        analysis_payload("CLINICAL_SENSITIVE", "CLINICAL_AUDIT_DRAFT")
    )
    principal = Principal(
        uid="director",
        org_id="wmgj",
        role=Role.DIRECTOR,
        all_facilities=True,
        mfa_verified=True,
    )
    settings = Settings(openai_execution_enabled=True, clinical_ai_enabled=True)
    with pytest.raises(PolicyBlockedError, match="medical audit permission"):
        app_module.enforce_ai_policy(request, principal, settings)


def test_health_live_is_not_operational_health(client):
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert "pipeline" not in response.json()


def test_dashboard_keeps_freshness_completeness_and_severity_separate(client):
    response = client.get(
        "/v1/organizations/wmgj/dashboards/operational",
        params={"competence": "2026-08"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["freshness"]["state"] == "DELAYED"
    assert body["snapshot"]["completeness"] == "PARTIAL"
    assert body["snapshot"]["severity"] == "ATTENTION"


def test_org_wide_dashboard_rejects_facility_scoped_membership(client, fake_repository):
    fake_repository.memberships[("wmgj", "admin")] = fake_repository.memberships[
        ("wmgj", "admin")
    ].model_copy(update={"all_facilities": False, "facility_ids": ["unit-a"]})
    response = client.get(
        "/v1/organizations/wmgj/dashboards/operational",
        params={"competence": "2026-08"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ORG_WIDE_SCOPE_REQUIRED"


def test_clinical_ai_is_blocked_by_default(client, fake_repository):
    response = client.post(
        "/v1/organizations/wmgj/ai-runs",
        headers={"Idempotency-Key": "clinical-run-0001"},
        json=analysis_payload("CLINICAL_SENSITIVE", "CLINICAL_AUDIT_DRAFT"),
    )
    assert response.status_code == 422
    assert response.json()["code"] == "POLICY_BLOCKED"
    assert fake_repository.runs == {}


def test_direct_identifier_is_blocked_before_openai(client, fake_repository):
    payload = analysis_payload()
    payload["evidence"][0]["fact"] = "CPF 123.456.789-00 consta no documento."
    response = client.post(
        "/v1/organizations/wmgj/ai-runs",
        headers={"Idempotency-Key": "pii-block-0001"},
        json=payload,
    )
    assert response.status_code == 422
    assert fake_repository.runs == {}


def test_validation_error_does_not_echo_sensitive_input(client):
    payload = analysis_payload()
    payload["evidence"][0]["fact"] = "SEGREDO-QUE-NAO-PODE-VOLTAR"
    payload["evidence"][0]["unexpected"] = "PACIENTE-IDENTIFICAVEL"
    response = client.post(
        "/v1/organizations/wmgj/ai-runs",
        headers={"Idempotency-Key": "redacted-error-0001"},
        json=payload,
    )
    serialized = response.text
    assert response.status_code == 422
    assert response.json()["code"] == "REQUEST_VALIDATION_ERROR"
    assert "SEGREDO-QUE-NAO-PODE-VOLTAR" not in serialized
    assert "PACIENTE-IDENTIFICAVEL" not in serialized


def test_ai_run_is_typed_auditable_and_pending_review(client):
    response = client.post(
        "/v1/organizations/wmgj/ai-runs",
        headers={"Idempotency-Key": "audit-run-0001"},
        json=analysis_payload(),
    )
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "COMPLETED_PENDING_REVIEW"
    assert body["reviewState"] == "PENDING"
    assert body["result"]["needsHumanReview"] is True
    assert body["responseId"] == "resp_test"
    assert body["revision"] == 2


def test_identical_replay_returns_same_run_and_conflict_rejects_changed_body(client):
    headers = {"Idempotency-Key": "audit-run-0002"}
    first = client.post("/v1/organizations/wmgj/ai-runs", headers=headers, json=analysis_payload())
    replay = client.post("/v1/organizations/wmgj/ai-runs", headers=headers, json=analysis_payload())
    changed = analysis_payload()
    changed["purpose"] = "Preparar outro rascunho com escopo materialmente diferente"
    conflict = client.post("/v1/organizations/wmgj/ai-runs", headers=headers, json=changed)

    assert first.status_code == 202
    assert replay.status_code == 200
    assert replay.json()["runId"] == first.json()["runId"]
    assert replay.json()["duplicate"] is True
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"


def test_human_review_uses_expected_revision(client):
    created = client.post(
        "/v1/organizations/wmgj/ai-runs",
        headers={"Idempotency-Key": "audit-run-0003"},
        json=analysis_payload(),
    ).json()
    reviewed = client.post(
        f"/v1/organizations/wmgj/ai-runs/{created['runId']}/reviews",
        json={
            "decision": "APPROVED",
            "expectedRevision": created["revision"],
            "rationale": "Evidência conferida no documento original pelo auditor.",
            "evidenceRefs": ["doc:1"],
        },
    )
    stale = client.post(
        f"/v1/organizations/wmgj/ai-runs/{created['runId']}/reviews",
        json={
            "decision": "REJECTED",
            "expectedRevision": created["revision"],
            "rationale": "Tentativa concorrente com revisão já ultrapassada.",
            "evidenceRefs": ["doc:1"],
        },
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["revision"] == created["revision"] + 1
    assert stale.status_code == 409


def test_human_review_requires_mfa(client):
    created = client.post(
        "/v1/organizations/wmgj/ai-runs",
        headers={"Idempotency-Key": "audit-run-mfa-0001"},
        json=analysis_payload(),
    ).json()

    async def password_only_identity() -> VerifiedIdentity:
        return VerifiedIdentity(uid="admin", mfa_verified=False)

    app_module.app.dependency_overrides[get_identity] = password_only_identity
    response = client.post(
        f"/v1/organizations/wmgj/ai-runs/{created['runId']}/reviews",
        json={
            "decision": "APPROVED",
            "expectedRevision": created["revision"],
            "rationale": "Evidência conferida, mas a sessão não possui MFA.",
            "evidenceRefs": ["doc:1"],
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "MFA_REQUIRED"


def test_human_approval_requires_original_evidence_reference(client):
    created = client.post(
        "/v1/organizations/wmgj/ai-runs",
        headers={"Idempotency-Key": "audit-run-evidence-0001"},
        json=analysis_payload(),
    ).json()
    response = client.post(
        f"/v1/organizations/wmgj/ai-runs/{created['runId']}/reviews",
        json={
            "decision": "APPROVED",
            "expectedRevision": created["revision"],
            "rationale": "A referência informada não pertence à execução revisada.",
            "evidenceRefs": ["doc:outside"],
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "POLICY_BLOCKED"


def test_human_review_rejects_direct_identifier_in_rationale(client):
    created = client.post(
        "/v1/organizations/wmgj/ai-runs",
        headers={"Idempotency-Key": "audit-run-review-pii-0001"},
        json=analysis_payload(),
    ).json()
    response = client.post(
        f"/v1/organizations/wmgj/ai-runs/{created['runId']}/reviews",
        json={
            "decision": "APPROVED",
            "expectedRevision": created["revision"],
            "rationale": "Conferido com CPF 123.456.789-00 no documento original.",
            "evidenceRefs": ["doc:1"],
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "POLICY_BLOCKED"


def test_openapi_contains_no_second_ingestion_writer(client):
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/v1/organizations/{org_id}/ai-runs" in paths
    assert all("ingestion" not in path for path in paths)
