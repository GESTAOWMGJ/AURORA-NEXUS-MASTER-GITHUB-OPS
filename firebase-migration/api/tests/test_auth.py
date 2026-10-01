import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import wmgj_api.auth as auth_module
from wmgj_api.auth import get_identity
from wmgj_api.config import Settings


def credentials() -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials="firebase-id-token")


@pytest.mark.asyncio
async def test_app_check_is_required_by_default(monkeypatch):
    monkeypatch.setattr(auth_module, "_ensure_firebase", lambda _settings: None)
    with pytest.raises(HTTPException) as error:
        await get_identity(
            credentials=credentials(),
            app_check_token=None,
            settings=Settings(firebase_project_id="test-project"),
        )
    assert error.value.status_code == 401
    assert error.value.detail["code"] == "APP_CHECK_REQUIRED"


@pytest.mark.asyncio
async def test_identity_carries_verified_mfa_claim(monkeypatch):
    monkeypatch.setattr(auth_module, "_ensure_firebase", lambda _settings: None)
    monkeypatch.setattr(
        auth_module.firebase_app_check,
        "verify_token",
        lambda token: {"sub": "app"} if token == "valid-app-check" else None,
    )
    monkeypatch.setattr(
        auth_module.firebase_auth,
        "verify_id_token",
        lambda token, check_revoked: {
            "uid": "user-1",
            "firebase": {"sign_in_second_factor": "totp"},
        },
    )

    identity = await get_identity(
        credentials=credentials(),
        app_check_token="valid-app-check",
        settings=Settings(firebase_project_id="test-project"),
    )

    assert identity.uid == "user-1"
    assert identity.mfa_verified is True


@pytest.mark.asyncio
async def test_invalid_app_check_fails_before_id_token(monkeypatch):
    monkeypatch.setattr(auth_module, "_ensure_firebase", lambda _settings: None)

    def invalid_app_check(_token):
        raise ValueError("invalid")

    monkeypatch.setattr(auth_module.firebase_app_check, "verify_token", invalid_app_check)
    with pytest.raises(HTTPException) as error:
        await get_identity(
            credentials=credentials(),
            app_check_token="invalid-app-check",
            settings=Settings(firebase_project_id="test-project"),
        )
    assert error.value.status_code == 401
    assert error.value.detail["code"] == "INVALID_APP_CHECK"
