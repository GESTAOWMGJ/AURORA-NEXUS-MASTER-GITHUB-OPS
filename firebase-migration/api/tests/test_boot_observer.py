"""Synthetic server ports only; no Firebase, credentials, HTTP or native device."""
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json

import pytest
from jsonschema import Draft202012Validator

from wmgj_api import boot_observer

from wmgj_api.boot_observer import (
    BootObservationError, PatchEvidence, ServerBootContext,
    manifest_fingerprint, observe_boot,
)

NOW = datetime(2026, 10, 3, 0, 20, tzinfo=timezone.utc)


def manifest(platform="web"):
    value = {
        "schemaVersion": "aurora.organic.patcher.manifest.v1", "manifestId": "manifest-private-001",
        "orgId": "wmgj", "clientSkillId": "aurora-client-wmgj", "platform": platform,
        "baseVersion": "1.2.0", "clientVersion": "client-1.2.0", "mode": "trial", "environment": "hml",
        "executionMode": "READ_ONLY", "activationAllowed": False,
        "patches": [{"patchId": "patch-private-001", "module": "ui_dashboard",
                     "reason": "PRIVATE_REASON", "operationNeed": "PRIVATE_OPERATION_NEED",
                     "status": "waiting_human_review", "requiresHumanReview": True,
                     "definitionFingerprint": "a" * 64, "evidenceRefs": ["b" * 64],
                     "allowedSurfaces": [platform]}],
        "security": {key: True for key in ["requiresAuth", "requiresMfaForReview", "requiresAppCheck",
                     "noClientSecrets", "denyByDefault", "lgpdScopeRequired", "backendOnlySensitiveActions"]},
        "audit": {"createdAt": NOW.isoformat(), "createdBy": "private-author", "hashAlgorithm": "SHA-256",
                  "hash": "0" * 64, "rollbackPolicy": "not_applicable_read_only"},
    }
    value["audit"]["hash"] = manifest_fingerprint(value)
    return value


class FakeServer:
    def __init__(self, platform="web"):
        self.manifest = manifest(platform)
        self.context = ServerBootContext(
            org_id="wmgj", client_skill_id="aurora-client-wmgj", actor_uid="private-viewer",
            base_version="1.2.0", client_version="client-1.2.0", mode="trial", environment="hml",
            platforms=frozenset({platform}), checkpoint_revision=3, manifest_hash=self.manifest["audit"]["hash"],
            checked_at=NOW, session_verified=True, app_check_verified=True, organization_active=True,
            membership_active=True, observation_allowed=True, lgpd_scope_valid=True,
        )
        self.request = {"platform": platform, "baseVersion": "1.2.0", "clientVersion": "client-1.2.0"}
        self.proofs = {"patch-private-001": PatchEvidence(
            org_id="wmgj", client_skill_id="aurora-client-wmgj", patch_id="patch-private-001",
            definition_fingerprint="a" * 64, evidence_refs=frozenset({"b" * 64}),
            checkpoint_revision=3, checked_at=NOW, current=True,
        )}
        self.final_context = None
        self.calls = []

    def authorize(self):
        self.calls.append("authorize")
        return self.final_context if self.calls.count("authorize") > 1 and self.final_context is not None else self.context

    def read_manifest(self, context):
        self.calls.append("read_manifest")
        return deepcopy(self.manifest)

    def verify_patch(self, context, patch):
        self.calls.append("verify_patch")
        return self.proofs[patch["patchId"]]

    def seal(self):
        self.manifest["audit"]["hash"] = manifest_fingerprint(self.manifest)
        self.context = replace(self.context, manifest_hash=self.manifest["audit"]["hash"])

    def observe(self, **kwargs):
        return observe_boot(self, self.request, now=NOW, **kwargs)


def assert_denied(port, code):
    with pytest.raises(BootObservationError, match="^" + code + "$"):
        port.observe()


@pytest.mark.parametrize("platform", ["web", "pwa", "desktop-macos", "desktop-windows", "ios", "android"])
def test_every_concrete_platform_observes_read_only_without_activating(platform):
    server = FakeServer(platform)
    before = deepcopy(server.manifest)
    result = server.observe()
    assert result.public_status["counts"]["reviewRequired"] == 1
    assert result.public_status["activationAllowed"] is False
    assert result.public_status["patchApplied"] is False
    assert result.audit_intent["persisted"] is False
    assert server.calls == ["authorize", "read_manifest", "verify_patch", "authorize"]
    assert server.manifest == before


@pytest.mark.parametrize("field", ["session_verified", "app_check_verified", "organization_active", "membership_active", "observation_allowed", "lgpd_scope_valid"])
def test_access_denied_before_reading_manifest(field):
    server = FakeServer()
    server.context = replace(server.context, **{field: False})
    assert_denied(server, "BOOT_ACCESS_DENIED")
    assert server.calls == ["authorize"]


@pytest.mark.parametrize("payload", [None, {}, {"platform": []}, {"platform": "wrapper", "baseVersion": "1.2.0", "clientVersion": "client-1.2.0"}])
def test_invalid_requests_never_touch_server_records(payload):
    server = FakeServer()
    server.request = payload
    assert_denied(server, "BOOT_REQUEST_INVALID")
    assert server.calls == []


@pytest.mark.parametrize("field,value", [("orgId", "other"), ("clientSkillId", "aurora-client-other"), ("appCheckVerified", True), ("mfaVerified", True), ("activationAllowed", True)])
def test_request_cannot_inject_authorization_or_scope(field, value):
    server = FakeServer()
    server.request[field] = value
    assert_denied(server, "BOOT_REQUEST_INVALID")
    assert server.calls == []


@pytest.mark.parametrize("field,value", [("platform", "ios"), ("baseVersion", "2.0.0"), ("clientVersion", "unreviewed")])
def test_client_declared_version_and_platform_must_match_server_policy(field, value):
    server = FakeServer()
    server.request[field] = value
    assert_denied(server, "BOOT_CLIENT_INCOMPATIBLE")
    assert "read_manifest" not in server.calls


@pytest.mark.parametrize("field,value", [("orgId", "other"), ("clientSkillId", "aurora-client-other"), ("platform", "ios"), ("environment", "production"), ("mode", "contracted"), ("clientVersion", "old"), ("baseVersion", "old")])
def test_manifest_scope_cannot_be_reassigned_by_self_hash(field, value):
    server = FakeServer()
    server.manifest[field] = value
    server.seal()
    assert_denied(server, "BOOT_MANIFEST_SCOPE_MISMATCH")


@pytest.mark.parametrize("change", [
    {"activationAllowed": True}, {"executionMode": "WRITE"}, {"token": "PRIVATE_TOKEN"},
    {"schemaVersion": "future-version"},
])
def test_canonical_schema_rejects_activation_write_and_extra_secret_fields(change):
    server = FakeServer()
    server.manifest.update(change)
    server.seal()
    assert_denied(server, "BOOT_MANIFEST_INVALID")


def test_applied_state_is_rejected_by_canonical_schema():
    server = FakeServer()
    server.manifest["patches"][0]["status"] = "applied"
    server.seal()
    assert_denied(server, "BOOT_MANIFEST_INVALID")


@pytest.mark.parametrize("seconds", [-1, 61])
def test_stale_or_future_authorization_is_rejected(seconds):
    server = FakeServer()
    server.context = replace(server.context, checked_at=NOW - timedelta(seconds=seconds))
    assert_denied(server, "BOOT_AUTHORIZATION_STALE")


@pytest.mark.parametrize("seconds", [-1, 86401])
def test_stale_or_future_manifest_is_rejected(seconds):
    server = FakeServer()
    server.manifest["audit"]["createdAt"] = (NOW - timedelta(seconds=seconds)).isoformat()
    server.seal()
    assert_denied(server, "BOOT_MANIFEST_STALE")


def test_changing_manifest_and_its_self_hash_cannot_replace_server_pointer():
    server = FakeServer()
    server.manifest["patches"][0]["reason"] = "changed"
    server.manifest["audit"]["hash"] = manifest_fingerprint(server.manifest)
    assert_denied(server, "BOOT_MANIFEST_INTEGRITY_MISMATCH")


def test_duplicate_patch_ids_block_instead_of_overwriting_a_proposal():
    server = FakeServer()
    server.manifest["patches"].append(deepcopy(server.manifest["patches"][0]))
    server.seal()
    assert_denied(server, "BOOT_PATCH_ID_CONFLICT")


@pytest.mark.parametrize("change", [
    {"org_id": "other"}, {"client_skill_id": "aurora-client-other"}, {"patch_id": "other"},
    {"definition_fingerprint": "c" * 64}, {"evidence_refs": frozenset({"c" * 64})},
    {"checkpoint_revision": 4}, {"checkpoint_revision": True}, {"current": False},
    {"checked_at": NOW - timedelta(seconds=61)}, {"checked_at": NOW + timedelta(seconds=1)},
])
def test_evidence_must_be_fresh_current_and_bound_to_same_scope(change):
    server = FakeServer()
    server.proofs["patch-private-001"] = replace(server.proofs["patch-private-001"], **change)
    result = server.observe()
    assert result.public_status["counts"]["blocked"] == 1
    assert result.public_status["counts"]["reviewRequired"] == 0


def approve(server):
    server.manifest["patches"][0].update(status="pilot_approved", approval={
        "revision": 1, "actorUid": "private-reviewer", "planFingerprint": "d" * 64,
    })
    server.seal()


def test_approval_fields_in_manifest_alone_cannot_promote_a_pilot():
    server = FakeServer()
    approve(server)
    assert server.observe().public_status["counts"]["blocked"] == 1


def test_verified_pilot_is_still_read_only_and_not_a_patch_receipt():
    server = FakeServer()
    approve(server)
    server.proofs["patch-private-001"] = replace(server.proofs["patch-private-001"],
        reviewer_active=True, reviewer_mfa_verified=True, approval_revision=1,
        approval_actor_uid="private-reviewer", approval_plan_fingerprint="d" * 64)
    result = server.observe()
    assert result.public_status["counts"]["readOnlyPilotRecorded"] == 1
    assert result.public_status["activationAllowed"] is False
    assert result.public_status["patchApplied"] is False
    server.proofs["patch-private-001"] = replace(server.proofs["patch-private-001"], reviewer_mfa_verified=False)
    assert server.observe().public_status["counts"]["blocked"] == 1


@pytest.mark.parametrize("change,code", [({"membership_active": False}, "BOOT_ACCESS_DENIED"),
                                      ({"checkpoint_revision": 4}, "BOOT_SNAPSHOT_CHANGED"),
                                      ({"manifest_hash": "f" * 64}, "BOOT_SNAPSHOT_CHANGED")])
def test_final_revalidation_catches_revocation_and_concurrent_change(change, code):
    server = FakeServer()
    server.final_context = replace(server.context, **change)
    assert_denied(server, code)


def test_repeat_is_deterministic_but_revalidates_evidence_instead_of_caching():
    server = FakeServer()
    first, second = server.observe(), server.observe()
    assert first == second
    assert server.calls.count("authorize") == 4
    assert server.calls.count("verify_patch") == 2
    server.proofs["patch-private-001"] = replace(server.proofs["patch-private-001"], current=False)
    third = server.observe()
    assert third.public_status["counts"]["blocked"] == 1
    assert third.audit_intent["observationId"] != first.audit_intent["observationId"]


def test_public_projection_contains_no_private_identifiers_text_fingerprints_or_intent():
    result = FakeServer().observe()
    public = json.dumps(result.public_status)
    for private in ["wmgj", "private", "PRIVATE", "a" * 64, "b" * 64, "orgId", "actorUid", "manifestHash", "observationId"]:
        assert private not in public
    assert result.audit_intent["persisted"] is False


def test_adapter_errors_are_redacted():
    server = FakeServer()
    def failed(context, patch):
        raise RuntimeError("PRIVATE_TOKEN_AND_SOURCE_PATH")
    server.verify_patch = failed
    assert_denied(server, "BOOT_OBSERVATION_UNAVAILABLE")


def test_rollback_recommendation_cannot_disappear_when_evidence_is_revoked():
    server = FakeServer()
    server.manifest["patches"][0]["status"] = "rollback_recommended"
    server.seal()
    server.proofs["patch-private-001"] = replace(server.proofs["patch-private-001"], current=False)
    result = server.observe()
    assert result.public_status["counts"]["blocked"] == 1
    assert result.public_status["rollbackRecommended"] is True


def test_disallowed_surface_is_blocked_without_executing_or_verifying_patch():
    server = FakeServer()
    server.manifest["patches"][0]["allowedSurfaces"] = ["backend-only"]
    server.seal()
    assert server.observe().public_status["counts"]["blocked"] == 1
    assert "verify_patch" not in server.calls


def test_invalid_server_context_is_not_accepted_as_a_request_dictionary():
    server = FakeServer()
    server.context = {"session_verified": True, "app_check_verified": True}
    assert_denied(server, "SERVER_CONTEXT_REQUIRED")


def test_large_manifest_is_bounded_before_schema_validation():
    server = FakeServer()
    server.manifest["oversized"] = "x" * 262_144
    assert_denied(server, "BOOT_MANIFEST_TOO_LARGE")


def test_total_distinct_evidence_budget_is_bounded():
    server = FakeServer()
    template = server.manifest["patches"][0]
    server.manifest["patches"] = [{**template, "patchId": f"patch-{i:03d}",
                                 "evidenceRefs": [f"{i * 20 + j:064x}" for j in range(20)]} for i in range(13)]
    server.seal()
    assert_denied(server, "BOOT_EVIDENCE_LIMIT")


def test_naive_manifest_time_is_invalid_and_never_assumes_server_timezone():
    server = FakeServer()
    server.manifest["audit"]["createdAt"] = "2026-10-03T00:20:00"
    server.seal()
    with pytest.raises(BootObservationError):
        server.observe()


@pytest.mark.parametrize("timestamp", ["2026-10-03 00:20:00+00:00", "20261003T002000+0000", "2026-10-03T00:20:00"])
def test_timestamp_is_strict_even_without_optional_format_checker(monkeypatch, timestamp):
    schema = json.loads(boot_observer.SCHEMA_PATH.read_text())
    monkeypatch.setattr(boot_observer, "_validator", lambda: Draft202012Validator(schema))
    server = FakeServer()
    server.manifest["audit"]["createdAt"] = timestamp
    server.seal()
    assert_denied(server, "BOOT_MANIFEST_INVALID")


def test_packaging_without_canonical_schema_fails_closed(monkeypatch, tmp_path):
    monkeypatch.setattr(boot_observer, "SCHEMA_PATH", tmp_path / "missing-schema.json")
    boot_observer._validator.cache_clear()
    try:
        assert_denied(FakeServer(), "BOOT_SCHEMA_UNAVAILABLE")
    finally:
        boot_observer._validator.cache_clear()


def test_evidence_expiring_during_observation_cannot_be_returned_as_current(monkeypatch):
    class Clock(datetime):
        instant = NOW

        @classmethod
        def now(cls, tz=None):
            return cls.instant

    monkeypatch.setattr(boot_observer, "datetime", Clock)
    server = FakeServer()
    # Use the clock's datetime class so isinstance checks remain realistic.
    verified = Clock.fromisoformat((NOW - timedelta(seconds=59)).isoformat())
    server.context = replace(server.context, checked_at=Clock.fromisoformat(NOW.isoformat()))
    server.proofs["patch-private-001"] = replace(server.proofs["patch-private-001"], checked_at=verified)
    original_authorize = server.authorize

    def authorize():
        result = original_authorize()
        if server.calls.count("authorize") == 2:
            Clock.instant = NOW + timedelta(seconds=2)
        return result

    server.authorize = authorize
    with pytest.raises(BootObservationError, match="^BOOT_EVIDENCE_STALE$"):
        observe_boot(server, server.request)
