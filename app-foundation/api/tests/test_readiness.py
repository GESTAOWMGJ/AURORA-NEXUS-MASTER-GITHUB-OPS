from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_health_is_minimal_and_non_clinical() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "service": "wmgj-clinical-readiness",
        "schemaVersion": 1,
    }


def test_readiness_is_synthetic_and_fail_closed() -> None:
    response = client.get("/v1/readiness")
    payload = response.json()

    assert response.status_code == 200
    assert payload["source"] == "SYNTHETIC_DETERMINISTIC"
    assert payload["clinical_use_enabled"] is False
    assert payload["patient_communication_enabled"] is False
    assert payload["deploy"] == {
        "dry_run_default": True,
        "production_deploy_enabled": False,
        "real_data_migration_enabled": False,
        "requires_human_approval": True,
    }
    assert [gate["id"] for gate in payload["gates"]] == ["G0", "G1", "G2", "G3", "G4"]
    assert any(gate["state"] == "PENDENTE_DE_APROVACAO" for gate in payload["gates"])


def test_no_clinical_action_route_is_exposed() -> None:
    openapi = client.get("/openapi.json").json()

    assert set(openapi["paths"]) == {"/health", "/v1/readiness"}
    assert all("post" not in methods for methods in openapi["paths"].values())
