#!/usr/bin/env python3
"""Explicit, one-shot Windows/Linux transport to Aurora's canonical document API."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

FIELDS = ('sourceSystem externalDocumentId sourceVersion occurredAt documentType competence '
          'amountCents count workflowState slaDueAt documentFragility missingFieldsCount '
          'nativeReady sourceIndependent').split()
MAX_BYTES = 16384


class SyncError(ValueError):
    pass


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def timestamp(value):
    if not isinstance(value, str):
        raise SyncError('INVALID_TIMESTAMP')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except ValueError:
        raise SyncError('INVALID_TIMESTAMP') from None


def validate_payload(raw):
    if not isinstance(raw, dict) or set(raw) != set(FIELDS):
        raise SyncError('STRUCTURED_SCHEMA_REQUIRED')
    p = {key: raw[key] for key in FIELDS}
    enums = {
        'sourceSystem': {'MV', 'TASY', 'ERP'},
        'documentType': {'FINANCIAL', 'GLOSS', 'CONTRACT', 'PRODUCTION', 'REPORT', 'AUTHORIZATION', 'OTHER'},
        'workflowState': set('RECEIVED QUEUED CLASSIFIED EXTRACTED NORMALIZED VALIDATED PENDING_HUMAN_REVIEW PENDING_EVIDENCE BLOCKED FAILED'.split()),
        'documentFragility': {'NONE', 'DEGRADED_EXTRACTION', 'LOW_CONFIDENCE', 'MISSING_CANONICAL_FIELDS'},
    }
    for key, allowed in enums.items():
        if not isinstance(p[key], str) or p[key] not in allowed:
            raise SyncError('INVALID_ENUM')
    identifier = p['externalDocumentId']
    if (not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{1,159}', identifier)
            or not re.search(r'[A-Za-z]', identifier)
            or re.search(r'cpf|cns|paciente|patient|beneficiario|prontuario|medical[-_.:]?record', identifier, re.I)
            or re.search(r'\d{3}\.\d{3}\.\d{3}-\d{2}', identifier)):
        raise SyncError('OPAQUE_DOCUMENT_ID_REQUIRED')
    for key in ('sourceVersion', 'amountCents', 'count', 'missingFieldsCount'):
        value = p[key]
        if value is None and key in ('amountCents', 'count'):
            continue
        if type(value) is not int or not (int(key == 'sourceVersion') <= value <= 9007199254740991):
            raise SyncError('INVALID_INTEGER')
    for key in ('nativeReady', 'sourceIndependent'):
        if type(p[key]) is not bool:
            raise SyncError('INVALID_BOOLEAN')
    if p['competence'] is not None and (not isinstance(p['competence'], str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', p['competence'])):
        raise SyncError('INVALID_COMPETENCE')
    p['occurredAt'] = timestamp(p['occurredAt'])
    if p['slaDueAt'] is not None:
        p['slaDueAt'] = timestamp(p['slaDueAt'])
    if p['sourceIndependent'] and not p['nativeReady']:
        raise SyncError('NATIVE_READINESS_REQUIRED')
    if p['nativeReady']:
        if p['documentFragility'] != 'NONE' or p['missingFieldsCount']:
            raise SyncError('CANONICAL_FACTS_INCOMPLETE')
        if p['documentType'] in ('FINANCIAL', 'GLOSS') and (p['competence'] is None or p['amountCents'] is None):
            raise SyncError('CANONICAL_FACTS_INCOMPLETE')
        if p['documentType'] == 'PRODUCTION' and (p['competence'] is None or p['count'] is None):
            raise SyncError('CANONICAL_FACTS_INCOMPLETE')
    return p


def origin_url(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ('', '/')
            or parsed.port not in (None, 443)):
        raise SyncError('HTTPS_ORIGIN_REQUIRED')
    return 'https://' + parsed.netloc.lower()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SyncError('REDIRECT_BLOCKED')


def request_json(url, token, payload=None, idempotency=None):
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode()
        headers.update({'Content-Type': 'application/json', 'Idempotency-Key': idempotency})
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES or response.headers.get_content_type() != 'application/json':
                raise SyncError('INVALID_SERVER_RESPONSE')
            return response.status, json.loads(body)
    except urllib.error.HTTPError as error:
        code = 'RETRYABLE' if error.code in (408, 429) or error.code >= 500 else 'BLOCKED'
        raise SyncError(f'{code}_HTTP_{error.code}') from None
    except (urllib.error.URLError, TimeoutError):
        raise SyncError('RETRYABLE_TRANSPORT_ERROR') from None
    except (UnicodeError, json.JSONDecodeError):
        raise SyncError('INVALID_SERVER_RESPONSE') from None


def connect(origin, org, token, transport=request_json):
    origin = origin_url(origin)
    if not isinstance(org, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}', org):
        raise SyncError('INVALID_ORGANIZATION')
    if not isinstance(token, str) or not token or any(ch.isspace() for ch in token):
        raise SyncError('INTEGRATION_CREDENTIAL_REQUIRED')
    status, ping = transport(origin + '/api/integration/ping', token)
    if status != 200 or not isinstance(ping, dict) or ping.get('ok') is not True or ping.get('orgId') != org:
        raise SyncError('AUTHENTICATED_ORGANIZATION_MISMATCH')
    return {'connectionVerified': True}


def synchronize(raw, origin, org, token=None, send=False, transport=request_json):
    origin = origin_url(origin)
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}', org):
        raise SyncError('INVALID_ORGANIZATION')
    payload = validate_payload(raw)
    encoded = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    payload_hash = digest(encoded)
    idem = 'win-v1:' + digest(origin + ':' + org + ':' + encoded)
    document_id = digest(org + ':' + payload['sourceSystem'] + ':' + payload['externalDocumentId'])[:48]
    receipt = {'schemaVersion': 1, 'status': 'VALIDATED_NOT_SENT', 'payloadSha256': payload_hash,
               'idempotencyKey': idem, 'documentId': document_id, 'cloudReceiptVerified': False}
    if not send:
        return receipt
    connect(origin, org, token, transport)
    status, result = transport(origin + '/api/integration/documents', token, payload, idem)
    if (not isinstance(result, dict) or result.get('ok') is not True
            or result.get('documentId') != document_id or result.get('sourceSystem') != payload['sourceSystem']
            or result.get('nativeReady') is not payload['nativeReady']
            or result.get('sourceIndependent') is not payload['sourceIndependent']
            or not ((status == 202 and result.get('accepted') is True and result.get('duplicate') is False)
                    or (status == 200 and result.get('duplicate') is True and result.get('accepted') is False))):
        raise SyncError('CLOUD_RECEIPT_MISMATCH')
    receipt.update(status='DUPLICATE' if result['duplicate'] else 'ACCEPTED', cloudReceiptVerified=True)
    return receipt


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise SyncError('DUPLICATE_JSON_KEY')
        value[key] = item
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, help='Explicit structured JSON export; never a document folder')
    parser.add_argument('--origin', required=True)
    parser.add_argument('--org', required=True)
    parser.add_argument('--send', action='store_true', help='Send using AURORA_INTEGRATION_TOKEN from environment')
    args = parser.parse_args()
    try:
        with Path(args.input).open('rb') as stream:
            content = stream.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise SyncError('INPUT_TOO_LARGE')
        raw = json.loads(content, object_pairs_hook=unique_object)
        result = synchronize(raw, args.origin, args.org, os.environ.get('AURORA_INTEGRATION_TOKEN'), args.send)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, OSError) as error:
        code = str(error) if isinstance(error, SyncError) else 'INVALID_INPUT_OR_TRANSPORT'
        print(json.dumps({'status': 'BLOCKED', 'code': code, 'cloudReceiptVerified': False}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
