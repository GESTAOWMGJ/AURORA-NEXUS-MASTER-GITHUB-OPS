class WmgjError(Exception):
    code = "WMGJ_ERROR"


class NotConfiguredError(WmgjError):
    code = "NOT_CONFIGURED"


class NotFoundError(WmgjError):
    code = "NOT_FOUND"


class PermissionDeniedError(WmgjError):
    code = "PERMISSION_DENIED"


class PolicyBlockedError(WmgjError):
    code = "POLICY_BLOCKED"


class IdempotencyConflictError(WmgjError):
    code = "IDEMPOTENCY_CONFLICT"


class RevisionConflictError(WmgjError):
    code = "REVISION_CONFLICT"


class UpstreamServiceError(WmgjError):
    code = "UPSTREAM_SERVICE_ERROR"
