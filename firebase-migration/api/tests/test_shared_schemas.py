import json
from pathlib import Path

from jsonschema import Draft202012Validator


SCHEMAS = Path(__file__).parents[2] / "schemas"
REPO_ROOT = Path(__file__).parents[3]
APP_CONTRACTS = REPO_ROOT / "app-foundation" / "contracts"


def reviewed_ai_run() -> dict:
    return {
        "schemaVersion": 1,
        "runId": "run-1",
        "orgId": "wmgj",
        "provider": "openai",
        "status": "COMPLETED_PENDING_REVIEW",
        "reviewState": "APPROVED",
        "model": "gpt-5.6",
        "promptVersion": "prompt-v1",
        "rulesetVersion": "rules-v1",
        "sensitivity": "RESTRICTED",
        "evidenceRefs": ["doc:1"],
        "inputHash": "a" * 64,
        "outputHash": "b" * 64,
        "result": {
            "executiveSummary": "Rascunho revisado.",
            "abstained": False,
            "findings": [],
            "missingEvidence": [],
            "recommendedActions": [],
            "limitations": ["Decisão humana registrada separadamente."],
            "needsHumanReview": True,
        },
        "createdAt": "2026-08-26T10:00:00Z",
        "reviewedAt": "2026-08-26T11:00:00Z",
        "reviewerUid": "auditor-1",
        "revision": 3,
    }


def test_shared_ai_run_schema_accepts_reviewed_completed_draft():
    schema = json.loads((SCHEMAS / "ai-run.schema.json").read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    assert list(validator.iter_errors(reviewed_ai_run())) == []


def _legacy_operational_status() -> dict:
    return {
        "status": "OK",
        "ultimaExecucao": "2026-09-30T12:00:00Z",
        "pipeline": {
            "pendentes": 0,
            "processando": 0,
            "processados": 1,
            "duplicados": 0,
            "erros": 0,
            "revisaoHumana": 0,
        },
        "auditoria": {"ok": True, "erros": [], "avisos": []},
        "acoesDisponiveis": ["diagnosticar"],
    }


def _operational_status_v2() -> dict:
    metric = lambda cents, confidence: {"centavos": cents, "confiabilidade": confidence}
    return {
        "schemaVersion": 2,
        "status": "CRITICO",
        "ultimaExecucao": "2026-09-30T12:00:00Z",
        "clientSkill": {
            "orgId": "wmgj",
            "clientSkillId": "aurora-client-wmgj",
            "mode": "trial",
            "environment": "hml",
            "baseVersion": "1.2.0",
            "clientVersion": "wmgj-1.2.0",
        },
        "pipeline": {
            "pendentes": 2,
            "processando": 0,
            "processados": 10,
            "duplicados": 0,
            "erros": 0,
            "revisaoHumana": 1,
        },
        "financialLeakage": {
            "receitaEmRisco": metric(10000, "EM_RISCO"),
            "dinheiroParado": metric(5000, "PENDENTE_DE_EVIDENCIA"),
            "receitaRecuperavel": metric(3000, "RECUPERAVEL_PROVAVEL"),
            "perdaEvitavel": metric(2000, "ESTIMADO"),
            "perdaProvavel": metric(1000, "PERDA_PROVAVEL"),
            "perdaConfirmada": metric(0, "PERDA_CONFIRMADA"),
        },
        "trialFriction": {
            "tentativasManuais": 2,
            "responsaveisAcionados": 1,
            "itensSemDono": 0,
            "itensVencidos": 1,
            "resolvidoClienteCentavos": 0,
            "travadoCentavos": 10000,
        },
        "organicPatcher": {
            "status": "AGUARDANDO_REVISAO",
            "lastCheckAt": "2026-09-30T12:00:00Z",
            "manifestId": "manifest-001",
            "executionMode": "READ_ONLY",
            "activationAllowed": False,
            "requiresHumanReview": True,
            "rollbackRecommended": False,
        },
        "auditoria": {"ok": True, "erros": [], "avisos": []},
        "acoesDisponiveis": [
            "diagnosticar",
            "simularPatchOrganico",
            "solicitarRevisaoPatch",
        ],
    }


def _organic_manifest() -> dict:
    return {
        "schemaVersion": "aurora.organic.patcher.manifest.v1",
        "manifestId": "manifest-001",
        "orgId": "wmgj",
        "clientSkillId": "aurora-client-wmgj",
        "platform": "web",
        "baseVersion": "1.2.0",
        "clientVersion": "wmgj-1.2.0",
        "mode": "trial",
        "environment": "hml",
        "executionMode": "READ_ONLY",
        "activationAllowed": False,
        "patches": [
            {
                "patchId": "patch-001",
                "module": "ui_dashboard",
                "reason": "Expose reviewed operational state",
                "operationNeed": "Render a reviewed card without mutating source data",
                "status": "waiting_human_review",
                "requiresHumanReview": True,
                "definitionFingerprint": "a" * 64,
                "evidenceRefs": ["b" * 64],
                "allowedSurfaces": ["web"],
            }
        ],
        "security": {
            "requiresAuth": True,
            "requiresMfaForReview": True,
            "requiresAppCheck": True,
            "noClientSecrets": True,
            "denyByDefault": True,
            "lgpdScopeRequired": True,
            "backendOnlySensitiveActions": True,
        },
        "audit": {
            "createdAt": "2026-09-30T12:00:00Z",
            "createdBy": "auditor-1",
            "hashAlgorithm": "SHA-256",
            "hash": "c" * 64,
            "rollbackPolicy": "not_applicable_read_only",
        },
    }


def test_operational_status_v1_remains_backward_compatible():
    schema = json.loads((APP_CONTRACTS / "operational-status.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    assert list(Draft202012Validator(schema).iter_errors(_legacy_operational_status())) == []


def test_operational_status_v1_rejects_v2_instead_of_silently_reinterpreting_it():
    schema = json.loads((APP_CONTRACTS / "operational-status.schema.json").read_text(encoding="utf-8"))
    assert list(Draft202012Validator(schema).iter_errors(_operational_status_v2()))


def test_operational_status_v2_accepts_extended_contract_and_separates_mode_environment():
    schema = json.loads((APP_CONTRACTS / "operational-status.v2.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    payload = _operational_status_v2()
    validator = Draft202012Validator(schema)
    assert list(validator.iter_errors(payload)) == []

    payload["clientSkill"]["mode"] = "hml"
    assert list(validator.iter_errors(payload))

    payload = _operational_status_v2()
    payload["clientSkill"]["environment"] = "trial"
    assert list(validator.iter_errors(payload))


def test_organic_patcher_manifest_is_read_only_and_human_review_gated():
    schema = json.loads((SCHEMAS / "organic-patcher.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)

    manifest = _organic_manifest()
    assert list(validator.iter_errors(manifest)) == []

    manifest = _organic_manifest()
    manifest["activationAllowed"] = True
    assert list(validator.iter_errors(manifest))

    manifest = _organic_manifest()
    manifest["patches"][0]["status"] = "applied"
    assert list(validator.iter_errors(manifest))

    manifest = _organic_manifest()
    manifest["patches"][0]["status"] = "pilot_approved"
    assert list(validator.iter_errors(manifest))

    manifest["patches"][0]["approval"] = {
        "revision": 1,
        "actorUid": "auditor-1",
        "planFingerprint": "d" * 64,
    }
    assert list(validator.iter_errors(manifest)) == []
