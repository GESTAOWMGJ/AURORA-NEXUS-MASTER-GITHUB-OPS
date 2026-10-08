#!/usr/bin/env python3
"""Bounded real HML ingestion test; never certifies cloud/Xeon executor failover."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

PROJECT = "wmgj-hml-jfn-20260927"
NUMBER = "299889357292"
ORG = "wmgj"
FUNCTION = "ingestWmgjEvent"
SECRET = "WMGJ_INGEST_HMAC_KEYRING"
REGION = "southamerica-east1"
FS = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents"
BASE = FS + "/organizations/" + ORG


class GateError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise GateError("REDIRECT_BLOCKED")


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def request(url, headers, payload=None):
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as res:
            raw = res.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise GateError("RESPONSE_TOO_LARGE")
            return res.status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise GateError("TRANSPORT_OR_JSON_FAILED") from None


def cli(executable, args, raw=False):
    try:
        result = subprocess.run([executable, *args, "--quiet"], capture_output=True,
                                text=True, timeout=30,
                                env=dict(os.environ, CLOUDSDK_CORE_LOG_HTTP="false",
                                         CLOUDSDK_CORE_DISABLE_PROMPTS="1"))
    except (OSError, subprocess.TimeoutExpired):
        raise GateError("GCLOUD_QUERY_FAILED") from None
    if result.returncode:
        raise GateError("GCLOUD_QUERY_DENIED_OR_FAILED")  # Never print credential-bearing stderr.
    try:
        return result.stdout.strip() if raw else json.loads(result.stdout)
    except ValueError:
        raise GateError("GCLOUD_METADATA_INVALID") from None


def firestore_get(path, token):
    code, doc = request(BASE + ("/" + path if path else ""), {"Authorization": "Bearer " + token})
    if code == 404:
        return None
    if code != 200:
        raise GateError("FIRESTORE_READ_HTTP_" + str(code))
    return doc


def exact_query(collection, field, value, token):
    query = {"structuredQuery": {
        "select": {"fields": [{"fieldPath": "__name__"}, {"fieldPath": "revision"}]},
        "from": [{"collectionId": collection}],
        "where": {"fieldFilter": {"field": {"fieldPath": field}, "op": "EQUAL",
                                  "value": {"stringValue": value}}},
        "limit": 2}}
    code, data = request(BASE + ":runQuery",
                         {"Authorization": "Bearer " + token, "Content-Type": "application/json"}, query)
    if code != 200 or not isinstance(data, list):
        raise GateError("FIRESTORE_QUERY_HTTP_" + str(code))
    return [item["document"] for item in data if "document" in item]


def synthetic_event(tag):
    key = "aurora-hml-resume:" + tag
    return {"schemaVersion": 1, "eventId": "hml-" + tag, "eventType": "ENTITY_UPSERT",
            "orgId": ORG, "occurredAt": datetime.now(timezone.utc).isoformat(),
            "sourceVersion": 1, "idempotencyKey": key, "entityType": "invoice",
            "entityKey": key, "actor": {"type": "SYSTEM", "id": "hml-acceptance",
                                       "source": "WINDOWS_XEON_TEST"},
            "source": {"system": "MANUAL", "sourceId": key},
            "workflowState": "PENDING_EVIDENCE", "reviewState": "NOT_REQUIRED",
            "riskLevel": "LOW", "sensitivity": "INTERNAL", "competence": "2099-12",
            "documentType": "FINANCIAL",
            "record": {"is_test": True, "amountCents": 0, "totalCents": 0,
                       "currency": "BRL", "status": "TEST_ONLY"},
            "metadata": {"sourceContext": "SYNTHETIC_HML_ACCEPTANCE",
                         "nonDestructive": True}}


def signed_headers(body, event, key_id, secret):
    timestamp = str(int(time.time()))
    nonce = "hml-" + uuid.uuid4().hex
    canonical = "\n".join(["WMGJ-HMAC-V2", "POST", "application/json",
                            timestamp, nonce, key_id, ORG,
                            event["idempotencyKey"], digest(body)])
    signature = hmac.new(bytes.fromhex(secret), canonical.encode(), hashlib.sha256).hexdigest()
    return {"Content-Type": "application/json", "X-WMGJ-Signature-Version": "v2",
            "X-WMGJ-Timestamp": timestamp, "X-WMGJ-Nonce": nonce,
            "X-WMGJ-Key-Id": key_id, "X-WMGJ-Org-Id": ORG,
            "X-WMGJ-Idempotency-Key": event["idempotencyKey"],
            "X-WMGJ-Signature": signature}


def post(url, body, headers):
    # URL and port are validated from the configured HML function before calling.
    from urllib.parse import urlsplit
    parsed = urlsplit(url)
    conn = http.client.HTTPSConnection(parsed.hostname, timeout=20)
    try:
        conn.request("POST", parsed.path or "/", body=body, headers=headers)
        response = conn.getresponse()
        raw = response.read(65537)
        if len(raw) > 65536:
            raise GateError("INGEST_RESPONSE_TOO_LARGE")
        return response.status, json.loads(raw)
    except (OSError, ValueError, http.client.HTTPException):
        raise GateError("INGEST_TRANSPORT_FAILED") from None
    finally:
        conn.close()


def worker():
    config = json.loads(sys.stdin.readline())
    if config["phase"] == "BEFORE_SEND":
        print("READY_BEFORE_SEND", flush=True)
    else:
        from urllib.parse import urlsplit
        parsed = urlsplit(config["url"])
        conn = http.client.HTTPSConnection(parsed.hostname, timeout=20)
        conn.request("POST", parsed.path or "/", body=config["body"].encode(),
                     headers=config["headers"])
        # Deliberately do not call getresponse or write a local acceptance receipt.
        print("SENT_WITHOUT_READING_ACK", flush=True)
    time.sleep(60)


def start_worker(config):
    child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker"],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    child.stdin.write(json.dumps(config) + "\n")
    child.stdin.flush()
    child.stdin.close()
    messages = queue.Queue()
    threading.Thread(target=lambda: messages.put(child.stdout.readline().strip()), daemon=True).start()
    try:
        marker = messages.get(timeout=10)
    except queue.Empty:
        stop_owned(child)
        raise GateError("WORKER_START_TIMEOUT") from None
    expected = "READY_BEFORE_SEND" if config["phase"] == "BEFORE_SEND" else "SENT_WITHOUT_READING_ACK"
    if marker != expected or child.poll() is not None:
        stop_owned(child)
        raise GateError("WORKER_PHASE_UNVERIFIED")
    return child


def stop_owned(child):
    if child.poll() is None:
        child.kill()
    child.wait(timeout=5)


def verify_once(event, token, before=None):
    entity_id = digest("invoice:" + event["entityKey"])[:48]
    idem_id = digest(event["idempotencyKey"])
    doc = firestore_get("invoices/" + entity_id, token)
    idem = firestore_get("integrationEvents/" + idem_id, token)
    audit = firestore_get("auditEvents/" + idem_id, token)
    counts = {
        "canonicalEntities": len(exact_query("invoices", "entityKey", event["entityKey"], token)),
        "idempotencyRecords": len(exact_query("integrationEvents", "entityId", entity_id, token)),
        "immutableVersions": len(exact_query("entityVersions", "entityId", entity_id, token)),
        "businessAuditEvents": len(exact_query("auditEvents", "entityId", entity_id, token))}
    if not doc or not idem or not audit or any(counts[k] != 1 for k in ("canonicalEntities", "idempotencyRecords", "businessAuditEvents")):
        raise GateError("EXACTLY_ONE_EFFECT_NOT_VERIFIED")
    if doc["fields"].get("is_test", {}).get("booleanValue") is not True:
        raise GateError("SYNTHETIC_MARKER_MISSING")
    declared_revision = doc["fields"].get("revision", {}).get("integerValue")
    revision = int(declared_revision) if declared_revision is not None else None
    current_contract = revision == 1 and counts["immutableVersions"] == 1
    legacy_contract = revision is None and counts["immutableVersions"] == 0
    if not (current_contract or legacy_contract):
        raise GateError("REVISION_OR_IMMUTABLE_VERSION_INVALID")
    if before and (doc.get("updateTime") != before.get("updateTime") or doc != before):
        raise GateError("DUPLICATE_CHANGED_CANONICAL_ENTITY")
    return {"counts": counts, "revision": revision, "currentIngestionContractVerified": current_contract, "entityId": entity_id,
            "idempotencySha256": idem_id, "entityUpdateTime": doc["updateTime"],
            "entityReceiptSha256": digest(json.dumps(doc, sort_keys=True, separators=(",", ":")))}


def preflight(gcloud):
    project = cli(gcloud, ["projects", "describe", PROJECT,
                          "--format=json(projectId,projectNumber,lifecycleState)"])
    if project != {"projectId": PROJECT, "projectNumber": NUMBER, "lifecycleState": "ACTIVE"}:
        raise GateError("HML_PROJECT_IDENTITY_UNVERIFIED")
    function = cli(gcloud, ["functions", "describe", FUNCTION, "--gen2", "--region", REGION,
                           "--project", PROJECT, "--format=json(name,updateTime,serviceConfig,buildConfig.entryPoint)"])
    service = function.get("serviceConfig", {})
    url = service.get("uri", "")
    if (function.get("buildConfig", {}).get("entryPoint") != FUNCTION
            or url != "https://ingestwmgjevent-f3ok7rswpa-rj.a.run.app"):
        raise GateError("EXPECTED_HML_FUNCTION_UNVERIFIED")
    bindings = [v for v in service.get("secretEnvironmentVariables", [])
                if v.get("key") == SECRET and v.get("secret") == SECRET and v.get("projectId") == PROJECT]
    if len(bindings) != 1 or not str(bindings[0].get("version", "")).isdigit():
        raise GateError("CONFIGURED_SECRET_VERSION_UNVERIFIED")
    ring = json.loads(cli(gcloud, ["secrets", "versions", "access", bindings[0]["version"],
                                  "--secret", SECRET, "--project", PROJECT], raw=True))
    now = datetime.now(timezone.utc)
    eligible = []
    for key_id, entry in ring.items():
        if (entry.get("active") is True and ORG in entry.get("orgIds", [])
                and "invoice" in entry.get("entityTypes", [])
                and re.fullmatch(r"[a-fA-F0-9]{64}", entry.get("secret", ""))):
            if entry.get("notBefore") and datetime.fromisoformat(entry["notBefore"].replace("Z", "+00:00")) > now:
                continue
            if entry.get("expiresAt") and datetime.fromisoformat(entry["expiresAt"].replace("Z", "+00:00")) <= now:
                continue
            eligible.append((key_id, entry["secret"]))
    if len(eligible) != 1:
        raise GateError("EXISTING_SCOPED_HMAC_CREDENTIAL_UNAVAILABLE_OR_AMBIGUOUS")
    token = cli(gcloud, ["auth", "print-access-token"], raw=True)
    org = firestore_get("", token)
    expected = {"active": {"booleanValue": True}, "environment": {"stringValue": "HOMOLOGATION"},
                "projectionMode": {"stringValue": "SHADOW"}, "sourceMutation": {"booleanValue": False},
                "productionMutation": {"booleanValue": False}, "clinicalSensitiveEnabled": {"booleanValue": False}}
    if not org or any(org["fields"].get(k) != v for k, v in expected.items()):
        raise GateError("HML_ORGANIZATION_GUARDRAILS_UNVERIFIED")
    return url, eligible[0], token, {"functionUpdateTime": function.get("updateTime"),
                                    "functionRevision": service.get("revision"),
                                    "configuredSecretVersion": bindings[0]["version"]}


def execute(gcloud, source_sha, progress, progress_path):
    url, (key_id, secret), token, backend = preflight(gcloud)
    event = synthetic_event(uuid.uuid4().hex)
    body = json.dumps(event, separators=(",", ":")).encode()
    entity_id = digest("invoice:" + event["entityKey"])[:48]
    progress.update({"interruptionEntityId": entity_id,
                     "interruptionIdempotencySha256": digest(event["idempotencyKey"]),
                     "interruptionEvent": event})
    with progress_path.open("x", encoding="utf-8") as stream:
        json.dump(progress, stream, sort_keys=True, indent=2)
    if firestore_get("invoices/" + entity_id, token):
        raise GateError("SYNTHETIC_ID_ALREADY_EXISTS")
    child = start_worker({"phase": "BEFORE_SEND"})
    stop_owned(child)
    if firestore_get("invoices/" + entity_id, token):
        raise GateError("PRE_SEND_INTERRUPTION_PERSISTED_EFFECT")
    child = start_worker({"phase": "AFTER_SEND", "url": url, "body": body.decode(),
                          "headers": signed_headers(body, event, key_id, secret)})
    try:
        deadline = time.monotonic() + 30
        committed = None
        while time.monotonic() < deadline:
            committed = firestore_get("invoices/" + entity_id, token)
            if committed:
                break
            if child.poll() is not None:
                raise GateError("WORKER_DIED_BEFORE_CONTROLLED_INTERRUPTION")
            time.sleep(0.5)
        if not committed:
            raise GateError("CLOUD_COMMIT_NOT_OBSERVED_BEFORE_TIMEOUT")
        if child.poll() is not None:
            raise GateError("WORKER_NOT_ALIVE_AT_COMMIT_OBSERVATION")
        stop_owned(child)
    finally:
        stop_owned(child)
    barrier = threading.Barrier(2)
    def retry():
        headers = signed_headers(body, event, key_id, secret)
        barrier.wait(timeout=5)
        return post(url, body, headers)
    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = [future.result() for future in [pool.submit(retry), pool.submit(retry)]]
    for status, receipt in receipts:
        if (status != 200 or receipt.get("ok") is not True or receipt.get("duplicate") is not True
                or receipt.get("accepted") is not False or receipt.get("entityId") != entity_id):
            raise GateError("RESTART_DUPLICATE_RECEIPT_NOT_VERIFIED")
    proof = verify_once(event, token, before=committed)
    # Independent initial race, exactly one effect for its own logical key.
    race_event = synthetic_event(uuid.uuid4().hex)
    progress.update({"raceEntityId": digest("invoice:" + race_event["entityKey"])[:48],
                     "raceIdempotencySha256": digest(race_event["idempotencyKey"]),
                     "raceEvent": race_event})
    with progress_path.open("w", encoding="utf-8") as stream:
        json.dump(progress, stream, sort_keys=True, indent=2)
    if firestore_get("invoices/" + progress["raceEntityId"], token):
        raise GateError("RACE_SYNTHETIC_ID_ALREADY_EXISTS")
    race_body = json.dumps(race_event, separators=(",", ":")).encode()
    race_barrier = threading.Barrier(2)
    def contender():
        headers = signed_headers(race_body, race_event, key_id, secret)
        race_barrier.wait(timeout=5)
        return post(url, race_body, headers)
    with ThreadPoolExecutor(max_workers=2) as pool:
        raced = [f.result() for f in [pool.submit(contender), pool.submit(contender)]]
    if sorted(s for s, _ in raced) != [200, 202]:
        raise GateError("FIRST_ATTEMPT_RACE_NOT_SINGLE_ACCEPTANCE")
    if sum(r.get("accepted") is True for _, r in raced) != 1 or sum(r.get("duplicate") is True for _, r in raced) != 1:
        raise GateError("FIRST_ATTEMPT_RACE_RECEIPTS_INVALID")
    race_proof = verify_once(race_event, token)
    return {"schemaVersion": "aurora.hml.interruption-resume.v1", "projectId": PROJECT,
            "verifiedAt": datetime.now(timezone.utc).isoformat(), "sourceInspectionSha": source_sha,
            "testScriptSha256": digest(Path(__file__).read_bytes()), "backend": backend,
            "state": ("HML_INGESTION_INTERRUPTION_RESUME_VERIFIED" if proof["currentIngestionContractVerified"] and race_proof["currentIngestionContractVerified"] else "HML_INGESTION_DEDUP_OBSERVED_LEGACY_BACKEND"),
            "currentIngestionContractVerified": proof["currentIngestionContractVerified"] and race_proof["currentIngestionContractVerified"],
            "preSendKillNoEffect": True, "postCommitWorkerKilledWithoutReadingAck": True,
            "sameIdempotencyKeyOnResume": True, "restartResponses": [s for s, _ in receipts],
            "canonicalEntityUnchangedByRetries": True, "interruptionCase": proof,
            "concurrentFirstAttemptResponses": [s for s, _ in raced], "concurrentIngestionCase": race_proof,
            "scope": "HMAC_V2_INGESTION_ON_EXISTING_HML_BACKEND",
            "distributedExecutorLeaseFencingVerified": False, "cloudXeonFailoverExecuted": False,
            "fullDistributedAcceptance": False, "productionVerified": False,
            "syntheticCases": 2, "persistedBusinessEffectsPerKey": 1,
            "secretPersistedOrPrinted": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--gcloud")
    parser.add_argument("--output")
    parser.add_argument("--source-sha")
    args = parser.parse_args()
    if args.worker:
        worker()
        return 0
    if not args.execute:
        print(json.dumps({"mode": "PLAN_ONLY", "projectId": PROJECT, "syntheticCases": 2,
                          "fullDistributedAcceptance": False}))
        return 0
    if not args.gcloud or not args.output or not re.fullmatch(r"[a-f0-9]{40}", args.source_sha or ""):
        parser.error("--execute requires --gcloud, --output and --source-sha")
    output = Path(args.output)
    if not output.is_absolute() or not output.parent.is_dir() or output.exists():
        parser.error("output must be a new file in an existing absolute evidence directory")
    progress = {"projectId": PROJECT, "sourceInspectionSha": args.source_sha}
    progress_path = output.with_suffix(".progress.json")
    if progress_path.exists():
        parser.error("progress evidence file already exists")
    try:
        result = execute(args.gcloud, args.source_sha, progress, progress_path)
        exit_code = 0
    except (GateError, ValueError, KeyError) as exc:
        result = {"schemaVersion": "aurora.hml.interruption-resume.v1", "state": "BLOCKED",
                  "code": str(exc) if isinstance(exc, GateError) else "INVALID_METADATA",
                  "fullDistributedAcceptance": False, "progress": progress}
        exit_code = 2
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, sort_keys=True, indent=2)
        stream.write("\n")
    print(json.dumps(result, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
