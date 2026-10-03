"""Read-only boot observation kernel. No HTTP route, cloud client or writes.

BootReadPort is a trusted server adapter, never a request-body deserializer.
Its production Auth/App Check/Firestore adapter is intentionally not connected.
"""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
from typing import Protocol

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError


SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schemas/organic-patcher.schema.json"
PLATFORMS = frozenset({"web", "pwa", "desktop-macos", "desktop-windows", "ios", "android"})
TRUST_MAX_AGE = timedelta(seconds=60)
MANIFEST_MAX_AGE = timedelta(hours=24)
MAX_MANIFEST_BYTES = 262_144
MAX_DISTINCT_EVIDENCE = 256
HASH = re.compile(r"[a-f0-9]{64}")
RFC3339 = re.compile(r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})")


class BootObservationError(ValueError):
    """Only fixed codes may cross the future transport boundary."""


@dataclass(frozen=True)
class ServerBootContext:
    org_id: str
    client_skill_id: str
    actor_uid: str
    base_version: str
    client_version: str
    mode: str
    environment: str
    platforms: frozenset[str]
    checkpoint_revision: int
    manifest_hash: str
    checked_at: datetime
    session_verified: bool
    app_check_verified: bool
    organization_active: bool
    membership_active: bool
    observation_allowed: bool
    lgpd_scope_valid: bool


@dataclass(frozen=True)
class PatchEvidence:
    org_id: str
    client_skill_id: str
    patch_id: str
    definition_fingerprint: str
    evidence_refs: frozenset[str]
    checkpoint_revision: int
    checked_at: datetime
    current: bool
    # Must be computed from the current approval/reviewer record by the server,
    # including MFA at review. Never copied from manifest.approval alone.
    reviewer_active: bool = False
    reviewer_mfa_verified: bool = False
    approval_revision: int | None = None
    approval_actor_uid: str | None = None
    approval_plan_fingerprint: str | None = None


class BootReadPort(Protocol):
    def authorize(self) -> ServerBootContext: ...
    def read_manifest(self, context: ServerBootContext) -> object: ...
    def verify_patch(self, context: ServerBootContext, patch: dict) -> PatchEvidence: ...


@dataclass(frozen=True)
class BootObservation:
    public_status: dict
    audit_intent: dict


def _deny(code: str):
    raise BootObservationError(code)


def _fresh(value: datetime, now: datetime, maximum: timedelta) -> bool:
    return (isinstance(value, datetime) and value.tzinfo is not None
            and timedelta(0) <= now - value <= maximum)


def _canonical(value: object) -> bytes:
    # Same sorted-key / ASCII-escaped convention as AURORA-ORG-001 Python.
    # Schema keys are ASCII; approval revisions must be safe integers below.
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def manifest_fingerprint(manifest: dict) -> str:
    """Integrity only: this is not a signature or proof of authorization."""
    value = deepcopy(manifest)
    value["audit"].pop("hash", None)
    return hashlib.sha256(_canonical(value)).hexdigest()


@lru_cache(maxsize=1)
def _validator():
    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
    except (OSError, ValueError, SchemaError):
        raise BootObservationError("BOOT_SCHEMA_UNAVAILABLE") from None
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _context(context: ServerBootContext, now: datetime):
    if not isinstance(context, ServerBootContext):
        _deny("SERVER_CONTEXT_REQUIRED")
    if not all(value is True for value in (
        context.session_verified, context.app_check_verified, context.organization_active,
        context.membership_active, context.observation_allowed, context.lgpd_scope_valid,
    )):
        _deny("BOOT_ACCESS_DENIED")
    if (not isinstance(context.org_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,79}", context.org_id)
            or not isinstance(context.client_skill_id, str)
            or not re.fullmatch(r"aurora-client-[a-z0-9_-]{1,106}", context.client_skill_id)
            or not isinstance(context.actor_uid, str) or not 1 <= len(context.actor_uid) <= 128
            or not isinstance(context.manifest_hash, str) or not HASH.fullmatch(context.manifest_hash)
            or type(context.checkpoint_revision) is not int or context.checkpoint_revision < 1
            or not isinstance(context.platforms, frozenset) or not context.platforms
            or not context.platforms.issubset(PLATFORMS)
            or context.mode not in {"trial", "contracted"}
            or context.environment != "hml"):
        _deny("BOOT_SCOPE_INVALID")
    if not _fresh(context.checked_at, now, TRUST_MAX_AGE):
        _deny("BOOT_AUTHORIZATION_STALE")


def _same_context(first: ServerBootContext, second: ServerBootContext) -> bool:
    # The second read can have a newer verification time, but scope, permission,
    # versions and manifest pointer cannot change during this observation.
    return all(getattr(first, field) == getattr(second, field)
               for field in first.__dataclass_fields__ if field != "checked_at")


def observe_boot(port: BootReadPort, request: object, *, now: datetime | None = None) -> BootObservation:
    """Observe fresh server-bound state; never approve/apply/execute a patch.

    request contains client-declared compatibility only, not trusted identity.
    The future server adapter must revalidate identity and all source records
    on every call, including repeats. There is no cache of evidence or auth.
    """
    if now is not None and (not isinstance(now, datetime) or now.tzinfo is None):
        _deny("BOOT_CLOCK_INVALID")
    def clock():
        return now if now is not None else datetime.now(timezone.utc)
    if (not isinstance(request, dict) or set(request) != {"platform", "baseVersion", "clientVersion"}
            or not isinstance(request.get("platform"), str)
            or request.get("platform") not in PLATFORMS
            or not isinstance(request.get("baseVersion"), str) or not 1 <= len(request["baseVersion"]) <= 40
            or not isinstance(request.get("clientVersion"), str) or not 1 <= len(request["clientVersion"]) <= 80):
        _deny("BOOT_REQUEST_INVALID")
    try:
        context = port.authorize()
        _context(context, clock())
        if (request["platform"] not in context.platforms or request["baseVersion"] != context.base_version
                or request["clientVersion"] != context.client_version):
            _deny("BOOT_CLIENT_INCOMPATIBLE")
        raw = port.read_manifest(context)
        try:
            encoded = _canonical(raw)
            if len(encoded) > MAX_MANIFEST_BYTES:
                _deny("BOOT_MANIFEST_TOO_LARGE")
            manifest = json.loads(encoded)
        except (TypeError, ValueError, RecursionError) as error:
            if isinstance(error, BootObservationError):
                raise
            raise BootObservationError("BOOT_MANIFEST_INVALID") from None
        if not _validator().is_valid(manifest):
            _deny("BOOT_MANIFEST_INVALID")
        expected = {"orgId": context.org_id, "clientSkillId": context.client_skill_id,
                    "platform": request["platform"], "baseVersion": context.base_version,
                    "clientVersion": context.client_version, "mode": context.mode,
                    "environment": context.environment}
        if any(manifest[key] != value for key, value in expected.items()):
            _deny("BOOT_MANIFEST_SCOPE_MISMATCH")
        # JSON Schema date-time checking has optional dependencies. Enforce
        # the timestamp boundary even when that format checker is unavailable.
        timestamp = manifest["audit"]["createdAt"]
        if not RFC3339.fullmatch(timestamp):
            _deny("BOOT_MANIFEST_INVALID")
        try:
            created = datetime.fromisoformat(timestamp.upper().replace("Z", "+00:00"))
        except ValueError:
            _deny("BOOT_MANIFEST_INVALID")
        if not _fresh(created, clock(), MANIFEST_MAX_AGE):
            _deny("BOOT_MANIFEST_STALE")
        if not (manifest_fingerprint(manifest) == manifest["audit"]["hash"] == context.manifest_hash):
            _deny("BOOT_MANIFEST_INTEGRITY_MISMATCH")
        patches = manifest["patches"]
        if len({patch["patchId"] for patch in patches}) != len(patches):
            _deny("BOOT_PATCH_ID_CONFLICT")
        if len({ref for patch in patches for ref in patch["evidenceRefs"]}) > MAX_DISTINCT_EVIDENCE:
            _deny("BOOT_EVIDENCE_LIMIT")
        counts = {"reviewRequired": 0, "readOnlyPilotRecorded": 0, "blocked": 0,
                  "rollbackReviewRequired": 0, "rolledBackRecorded": 0}
        decisions = []
        verified_at = []
        for patch in patches:
            approval = patch.get("approval")
            if approval and (type(approval["revision"]) is not int or approval["revision"] > 2**53 - 1):
                _deny("BOOT_APPROVAL_REVISION_INVALID")
            if request["platform"] not in patch["allowedSurfaces"]:
                counts["blocked"] += 1
                decisions.append([patch["patchId"], "SURFACE_NOT_ALLOWED"])
                continue
            proof = port.verify_patch(context, deepcopy(patch))
            if (not isinstance(proof, PatchEvidence) or proof.org_id != context.org_id
                    or proof.client_skill_id != context.client_skill_id or proof.patch_id != patch["patchId"]
                    or type(proof.checkpoint_revision) is not int or proof.checkpoint_revision != context.checkpoint_revision
                    or proof.definition_fingerprint != patch["definitionFingerprint"]
                    or proof.evidence_refs != frozenset(patch["evidenceRefs"])
                    or not _fresh(proof.checked_at, clock(), TRUST_MAX_AGE) or proof.current is not True):
                counts["blocked"] += 1
                decisions.append([patch["patchId"], "CURRENT_SCOPED_EVIDENCE_REQUIRED"])
                continue
            verified_at.append(proof.checked_at)
            state = patch["status"]
            if state == "pilot_approved":
                if (proof.reviewer_active is not True or proof.reviewer_mfa_verified is not True
                        or type(proof.approval_revision) is not int
                        or proof.approval_revision != approval["revision"]
                        or proof.approval_actor_uid != approval["actorUid"]
                        or proof.approval_plan_fingerprint != approval["planFingerprint"]):
                    decision = "blocked"
                else:
                    decision = "readOnlyPilotRecorded"
            elif state == "rollback_recommended":
                decision = "rollbackReviewRequired"
            elif state == "rolled_back":
                decision = "rolledBackRecorded"
            elif state == "blocked":
                decision = "blocked"
            else:
                decision = "reviewRequired"
            counts[decision] += 1
            decisions.append([patch["patchId"], decision])
        current_context = port.authorize()
        finished_at = clock()
        _context(context, finished_at)
        _context(current_context, finished_at)
        if any(not _fresh(checked_at, finished_at, TRUST_MAX_AGE) for checked_at in verified_at):
            _deny("BOOT_EVIDENCE_STALE")
        if not _same_context(context, current_context):
            _deny("BOOT_SNAPSHOT_CHANGED")
    except BootObservationError:
        raise
    except Exception:
        # Adapter/transport exceptions may contain resource paths or secrets.
        raise BootObservationError("BOOT_OBSERVATION_UNAVAILABLE") from None
    public_status = {"schemaVersion": "aurora.boot-observation.v1", "state": "OBSERVED_READ_ONLY",
                     "executionMode": "READ_ONLY", "activationAllowed": False,
                     "requiresHumanReview": True, "patchApplied": False,
                     "counts": counts, "rollbackRecommended": any(p["status"] == "rollback_recommended" for p in patches),
                     "rollbackPolicy": "not_applicable_read_only"}
    # Private, deterministic audit intent for the existing audit mechanism.
    # Returning this intent is explicitly not an audit write or local receipt.
    observation_id = hashlib.sha256(_canonical([
        context.org_id, context.client_skill_id, context.actor_uid,
        context.checkpoint_revision, context.manifest_hash, sorted(decisions),
    ])).hexdigest()
    audit_intent = {"type": "BOOT_MANIFEST_OBSERVED", "orgId": context.org_id,
                    "clientSkillId": context.client_skill_id, "actorUid": context.actor_uid,
                    "manifestHash": context.manifest_hash, "checkpointRevision": context.checkpoint_revision,
                    "observationId": observation_id, "observedAt": clock().isoformat(), "persisted": False,
                    "sensitivity": "INTERNAL", "sanitized": True}
    return BootObservation(public_status=public_status, audit_intent=audit_intent)
