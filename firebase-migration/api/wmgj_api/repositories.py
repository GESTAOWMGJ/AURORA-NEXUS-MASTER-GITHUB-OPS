import hashlib
import json
from collections.abc import Mapping
from datetime import UTC, datetime
from functools import lru_cache
from typing import Protocol
from uuid import uuid4

import firebase_admin
from fastapi.concurrency import run_in_threadpool
from firebase_admin import firestore as admin_firestore
from google.cloud import firestore as google_firestore

from .config import get_settings
from .errors import (
    IdempotencyConflictError,
    NotConfiguredError,
    NotFoundError,
    PolicyBlockedError,
    RevisionConflictError,
)
from .models import (
    AiRunResponse,
    AiRunStatus,
    DashboardSnapshot,
    Membership,
    ReviewDecision,
    ReviewRequest,
    ReviewResponse,
    ReviewState,
    Sensitivity,
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def deterministic_entity_id(entity_type: str, entity_key: str) -> str:
    return sha256(f"{entity_type}:{entity_key}")[:48]


def model_payload(model_type, data: Mapping[str, object]) -> dict[str, object]:
    aliases = {
        field.serialization_alias or field.alias or name
        for name, field in model_type.model_fields.items()
    }
    return {key: value for key, value in data.items() if key in aliases}


class Repository(Protocol):
    async def ready(self) -> bool: ...
    async def get_membership(self, org_id: str, uid: str) -> Membership | None: ...
    async def get_dashboard_snapshot(self, org_id: str, competence: str) -> DashboardSnapshot | None: ...
    async def reserve_ai_run(
        self,
        org_id: str,
        uid: str,
        idempotency_key: str,
        request_hash: str,
        sensitivity: Sensitivity,
        evidence_refs: list[str],
        model: str,
        prompt_version: str,
        ruleset_version: str,
    ) -> tuple[AiRunResponse, bool]: ...
    async def complete_ai_run(
        self,
        org_id: str,
        run_id: str,
        response: AiRunResponse,
        usage: Mapping[str, object],
    ) -> AiRunResponse: ...
    async def fail_ai_run(self, org_id: str, run_id: str) -> AiRunResponse: ...
    async def get_ai_run(self, org_id: str, run_id: str) -> AiRunResponse | None: ...
    async def review_ai_run(
        self,
        org_id: str,
        run_id: str,
        reviewer_uid: str,
        review: ReviewRequest,
    ) -> ReviewResponse: ...


class FirestoreRepository:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.firebase_project_id:
            raise NotConfiguredError("WMGJ_FIREBASE_PROJECT_ID is required")
        try:
            firebase_admin.get_app()
        except ValueError:
            firebase_admin.initialize_app(options={"projectId": settings.firebase_project_id})
        self.client = admin_firestore.client()

    async def ready(self) -> bool:
        def check() -> bool:
            next(self.client.collections(), None)
            return True

        try:
            return await run_in_threadpool(check)
        except Exception:
            return False

    async def get_membership(self, org_id: str, uid: str) -> Membership | None:
        def read() -> Membership | None:
            snapshot = self.client.document(f"organizations/{org_id}/members/{uid}").get()
            if not snapshot.exists:
                return None
            data = snapshot.to_dict() or {}
            return Membership.model_validate(model_payload(Membership, {"uid": uid, **data}))

        return await run_in_threadpool(read)

    async def get_dashboard_snapshot(self, org_id: str, competence: str) -> DashboardSnapshot | None:
        doc_id = deterministic_entity_id("dashboardSnapshot", competence)

        def read() -> DashboardSnapshot | None:
            snapshot = self.client.document(
                f"organizations/{org_id}/dashboardSnapshots/{doc_id}"
            ).get()
            if not snapshot.exists:
                return None
            data = snapshot.to_dict() or {}
            return DashboardSnapshot.model_validate(data)

        return await run_in_threadpool(read)

    async def reserve_ai_run(
        self,
        org_id: str,
        uid: str,
        idempotency_key: str,
        request_hash: str,
        sensitivity: Sensitivity,
        evidence_refs: list[str],
        model: str,
        prompt_version: str,
        ruleset_version: str,
    ) -> tuple[AiRunResponse, bool]:
        scope_hash = sha256(f"{org_id}:ai-runs:{uid}:{idempotency_key}")
        run_id = str(uuid4())
        now = datetime.now(UTC)
        response = AiRunResponse(
            run_id=run_id,
            org_id=org_id,
            status=AiRunStatus.PROCESSING,
            review_state=ReviewState.PENDING,
            model=model,
            prompt_version=prompt_version,
            ruleset_version=ruleset_version,
            sensitivity=sensitivity,
            evidence_refs=evidence_refs,
            input_hash=request_hash,
            created_at=now,
            revision=1,
        )

        def reserve() -> tuple[AiRunResponse, bool]:
            transaction = self.client.transaction()
            idem_ref = self.client.document(
                f"organizations/{org_id}/apiIdempotency/{scope_hash}"
            )
            run_ref = self.client.document(f"organizations/{org_id}/aiRuns/{run_id}")
            audit_ref = self.client.document(
                f"organizations/{org_id}/auditEvents/{sha256(f'AI_RUN_RESERVED:{run_id}')[:48]}"
            )

            @google_firestore.transactional
            def operation(tx: google_firestore.Transaction) -> tuple[AiRunResponse, bool]:
                existing = idem_ref.get(transaction=tx)
                if existing.exists:
                    data = existing.to_dict() or {}
                    if data.get("requestHash") != request_hash:
                        raise IdempotencyConflictError("idempotency key reused with another payload")
                    existing_run_id = str(data.get("runId") or "")
                    existing_run = self.client.document(
                        f"organizations/{org_id}/aiRuns/{existing_run_id}"
                    ).get(transaction=tx)
                    if not existing_run.exists:
                        raise NotFoundError("idempotency reservation points to a missing run")
                    stored_data = existing_run.to_dict() or {}
                    stored = AiRunResponse.model_validate(model_payload(AiRunResponse, stored_data))
                    return stored.model_copy(update={"duplicate": True}), False

                payload = response.model_dump(mode="python", by_alias=True)
                payload.update(
                    {
                        "actorUid": uid,
                        "sensitivity": sensitivity.value,
                        "evidenceRefs": evidence_refs,
                        "idempotencyKeyHash": scope_hash,
                        "requestHash": request_hash,
                    }
                )
                tx.create(run_ref, payload)
                tx.create(
                    idem_ref,
                    {
                        "orgId": org_id,
                        "runId": run_id,
                        "actorUid": uid,
                        "requestHash": request_hash,
                        "status": "PROCESSING",
                        "createdAt": now,
                    },
                )
                tx.create(
                    audit_ref,
                    {
                        "orgId": org_id,
                        "action": "AI_RUN_RESERVED",
                        "entityType": "aiRun",
                        "entityId": run_id,
                        "actor": {"type": "USER", "id": uid, "source": "FASTAPI"},
                        "afterHash": sha256(canonical_json(payload)),
                        "serverAt": now,
                        "schemaVersion": 1,
                    },
                )
                return response, True

            return operation(transaction)

        return await run_in_threadpool(reserve)

    async def complete_ai_run(
        self,
        org_id: str,
        run_id: str,
        response: AiRunResponse,
        usage: Mapping[str, object],
    ) -> AiRunResponse:
        def complete() -> AiRunResponse:
            transaction = self.client.transaction()
            run_ref = self.client.document(f"organizations/{org_id}/aiRuns/{run_id}")
            audit_ref = self.client.document(
                f"organizations/{org_id}/auditEvents/{sha256(f'AI_RUN_COMPLETED:{run_id}')[:48]}"
            )

            @google_firestore.transactional
            def operation(tx: google_firestore.Transaction) -> AiRunResponse:
                snapshot = run_ref.get(transaction=tx)
                if not snapshot.exists:
                    raise NotFoundError("AI run not found")
                previous = snapshot.to_dict() or {}
                current_revision = int(previous.get("revision") or 1)
                completed = response.model_copy(update={"revision": current_revision + 1})
                payload = completed.model_dump(mode="python", by_alias=True)
                tx.update(run_ref, {**payload, "usage": dict(usage), "completedAt": datetime.now(UTC)})
                tx.create(
                    audit_ref,
                    {
                        "orgId": org_id,
                        "action": "AI_RUN_COMPLETED",
                        "entityType": "aiRun",
                        "entityId": run_id,
                        "beforeHash": sha256(canonical_json(previous)),
                        "afterHash": sha256(canonical_json(payload)),
                        "serverAt": datetime.now(UTC),
                        "schemaVersion": 1,
                    },
                )
                return completed

            return operation(transaction)

        return await run_in_threadpool(complete)

    async def fail_ai_run(self, org_id: str, run_id: str) -> AiRunResponse:
        def fail() -> AiRunResponse:
            transaction = self.client.transaction()
            run_ref = self.client.document(f"organizations/{org_id}/aiRuns/{run_id}")

            @google_firestore.transactional
            def operation(tx: google_firestore.Transaction) -> AiRunResponse:
                snapshot = run_ref.get(transaction=tx)
                if not snapshot.exists:
                    raise NotFoundError("AI run not found")
                previous = snapshot.to_dict() or {}
                stored = AiRunResponse.model_validate(model_payload(AiRunResponse, previous))
                # Uma confirmação de commit pode se perder depois de a conclusão
                # já ter sido persistida. Nunca rebaixe um resultado terminal.
                if stored.status != AiRunStatus.PROCESSING:
                    return stored
                failed = stored.model_copy(
                    update={"status": AiRunStatus.FAILED, "revision": stored.revision + 1}
                )
                now = datetime.now(UTC)
                audit_ref = self.client.document(
                    "organizations/"
                    f"{org_id}/auditEvents/"
                    f"{sha256(f'AI_RUN_FAILED:{run_id}:{failed.revision}')[:48]}"
                )
                payload = failed.model_dump(mode="python", by_alias=True)
                tx.update(run_ref, {**payload, "failedAt": now})
                tx.create(
                    audit_ref,
                    {
                        "orgId": org_id,
                        "action": "AI_RUN_FAILED",
                        "entityType": "aiRun",
                        "entityId": run_id,
                        "beforeHash": sha256(canonical_json(previous)),
                        "afterHash": sha256(canonical_json(payload)),
                        "serverAt": now,
                        "schemaVersion": 1,
                    },
                )
                return failed

            return operation(transaction)

        return await run_in_threadpool(fail)

    async def get_ai_run(self, org_id: str, run_id: str) -> AiRunResponse | None:
        def read() -> AiRunResponse | None:
            snapshot = self.client.document(f"organizations/{org_id}/aiRuns/{run_id}").get()
            if not snapshot.exists:
                return None
            data = snapshot.to_dict() or {}
            return AiRunResponse.model_validate(model_payload(AiRunResponse, data))

        return await run_in_threadpool(read)

    async def review_ai_run(
        self,
        org_id: str,
        run_id: str,
        reviewer_uid: str,
        review: ReviewRequest,
    ) -> ReviewResponse:
        now = datetime.now(UTC)
        approval_id = str(uuid4())

        def decide() -> ReviewResponse:
            transaction = self.client.transaction()
            run_ref = self.client.document(f"organizations/{org_id}/aiRuns/{run_id}")
            approval_ref = self.client.document(
                f"organizations/{org_id}/approvals/{approval_id}"
            )
            audit_ref = self.client.document(
                f"organizations/{org_id}/auditEvents/{sha256(f'AI_RUN_REVIEWED:{approval_id}')[:48]}"
            )

            @google_firestore.transactional
            def operation(tx: google_firestore.Transaction) -> ReviewResponse:
                snapshot = run_ref.get(transaction=tx)
                if not snapshot.exists:
                    raise NotFoundError("AI run not found")
                data = snapshot.to_dict() or {}
                current_revision = int(data.get("revision") or 0)
                if current_revision != review.expected_revision:
                    raise RevisionConflictError("AI run revision changed")
                if data.get("status") != AiRunStatus.COMPLETED_PENDING_REVIEW.value:
                    raise RevisionConflictError("only completed AI drafts can be reviewed")
                allowed_refs = set(data.get("evidenceRefs") or [])
                review_refs = set(review.evidence_refs)
                if review.decision == ReviewDecision.APPROVED and not review_refs:
                    raise PolicyBlockedError("approval requires evidence references")
                if not review_refs.issubset(allowed_refs):
                    raise PolicyBlockedError("review referenced evidence outside the AI run")
                new_revision = current_revision + 1
                decision = ReviewResponse(
                    run_id=run_id,
                    decision=ReviewDecision(review.decision.value),
                    reviewer_uid=reviewer_uid,
                    reviewed_at=now,
                    revision=new_revision,
                )
                tx.update(
                    run_ref,
                    {
                        "reviewState": review.decision.value,
                        "reviewerUid": reviewer_uid,
                        "reviewedAt": now,
                        "revision": new_revision,
                    },
                )
                tx.create(
                    approval_ref,
                    {
                        "orgId": org_id,
                        "entityType": "aiRun",
                        "entityId": run_id,
                        "decision": review.decision.value,
                        "rationale": review.rationale,
                        "evidenceRefs": review.evidence_refs,
                        "reviewerUid": reviewer_uid,
                        "reviewedAt": now,
                        "expectedRevision": review.expected_revision,
                        "resultRevision": new_revision,
                    },
                )
                tx.create(
                    audit_ref,
                    {
                        "orgId": org_id,
                        "action": "AI_RUN_REVIEWED",
                        "entityType": "aiRun",
                        "entityId": run_id,
                        "actor": {"type": "USER", "id": reviewer_uid, "source": "FASTAPI"},
                        "decision": review.decision.value,
                        "approvalId": approval_id,
                        "serverAt": now,
                        "schemaVersion": 1,
                    },
                )
                return decision

            return operation(transaction)

        return await run_in_threadpool(decide)


@lru_cache
def get_repository() -> Repository:
    return FirestoreRepository()
