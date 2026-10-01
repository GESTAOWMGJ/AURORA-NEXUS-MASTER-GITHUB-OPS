from collections.abc import Awaitable, Callable

import firebase_admin
from fastapi import Depends, Header, HTTPException, Path, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth
from firebase_admin import app_check as firebase_app_check

from .config import Settings, get_settings
from .models import Membership, Permission, Principal, Role, VerifiedIdentity
from .repositories import Repository, get_repository


ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.PLATFORM_ADMIN: frozenset(Permission),
    Role.ORG_ADMIN: frozenset(Permission),
    Role.DIRECTOR: frozenset(Permission),
    Role.AUDITOR: frozenset(Permission),
    Role.MEDICAL_AUDITOR: frozenset(Permission),
    Role.FINANCE: frozenset({Permission.DASHBOARD_READ, Permission.AI_RUN_READ}),
    Role.OPERATOR: frozenset({Permission.DASHBOARD_READ}),
    Role.VIEWER: frozenset({Permission.DASHBOARD_READ}),
}

bearer = HTTPBearer(auto_error=False)


def _ensure_firebase(settings: Settings) -> None:
    try:
        firebase_admin.get_app()
    except ValueError:
        options = {"projectId": settings.firebase_project_id} if settings.firebase_project_id else None
        firebase_admin.initialize_app(options=options)


async def get_identity(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    app_check_token: str | None = Header(default=None, alias="X-Firebase-AppCheck"),
    settings: Settings = Depends(get_settings),
) -> VerifiedIdentity:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_REQUIRED"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    _ensure_firebase(settings)
    if settings.require_app_check:
        if not app_check_token:
            raise HTTPException(status_code=401, detail={"code": "APP_CHECK_REQUIRED"})
        try:
            await run_in_threadpool(firebase_app_check.verify_token, app_check_token)
        except Exception as exc:
            raise HTTPException(status_code=401, detail={"code": "INVALID_APP_CHECK"}) from exc
    try:
        decoded = await run_in_threadpool(
            firebase_auth.verify_id_token,
            credentials.credentials,
            check_revoked=True,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_FIREBASE_TOKEN"},
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    uid = str(decoded.get("uid") or decoded.get("sub") or "")
    if not uid:
        raise HTTPException(status_code=401, detail={"code": "TOKEN_WITHOUT_UID"})
    firebase_claim = decoded.get("firebase") if isinstance(decoded.get("firebase"), dict) else {}
    authentication_methods = decoded.get("amr") if isinstance(decoded.get("amr"), list) else []
    mfa_verified = bool(firebase_claim.get("sign_in_second_factor") or "mfa" in authentication_methods)
    return VerifiedIdentity(uid=uid, mfa_verified=mfa_verified)


def require_permission(permission: Permission) -> Callable[..., Awaitable[Principal]]:
    async def dependency(
        org_id: str = Path(pattern=r"^[a-z0-9][a-z0-9_-]{1,63}$"),
        identity: VerifiedIdentity = Depends(get_identity),
        repository: Repository = Depends(get_repository),
    ) -> Principal:
        membership: Membership | None = await repository.get_membership(org_id, identity.uid)
        if membership is None or not membership.active:
            raise HTTPException(status_code=403, detail={"code": "ORG_MEMBERSHIP_REQUIRED"})
        if permission not in ROLE_PERMISSIONS.get(membership.role, frozenset()):
            raise HTTPException(status_code=403, detail={"code": "PERMISSION_DENIED"})
        return Principal(
            uid=identity.uid,
            org_id=org_id,
            role=membership.role,
            facility_ids=membership.facility_ids,
            all_facilities=membership.all_facilities,
            mfa_verified=identity.mfa_verified,
        )

    return dependency
