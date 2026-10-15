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
ACQUISITION_SCHEMA = 'aurora.document.acquisition.v1'
ACQUISITION_MIMES = {
    'application/json': ('.json', 'AURORA_CANONICAL_JSON'),
    'text/csv': ('.csv', 'AURORA_CANONICAL_CSV'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ('.xlsx', 'AURORA_CANONICAL_XLSX'),
    'application/vnd.google-apps.spreadsheet': ('.csv', 'AURORA_CANONICAL_CSV'),
}


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
    if not isinstance(raw, dict) or set(raw) not in (set(FIELDS), set(FIELDS) | {'sourceEvidence'}):
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
    if 'sourceEvidence' in raw:
        p['sourceEvidence'] = validate_source_evidence(raw['sourceEvidence'], p)
    return p


def record_text(payload):
    """A canonical record representation, never the full original document text."""
    return json.dumps({key: payload[key] for key in sorted(FIELDS)}, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def source_evidence_hash(evidence):
    return digest(json.dumps(evidence, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False))


def validate_source_evidence(raw, payload):
    keys = {'schemaVersion', 'provider', 'sourceObjectIdHash', 'observedVersion', 'sourceMimeType',
            'acquiredMimeType', 'representation', 'byteSha256', 'byteLength', 'extraction'}
    extraction_keys = {'method', 'version', 'status', 'coverage', 'textFormat', 'textSha256',
                       'rowFactsSha256', 'rowIndex', 'rowCount'}
    if not isinstance(raw, dict) or set(raw) != keys or not isinstance(raw.get('extraction'), dict) or set(raw['extraction']) != extraction_keys:
        raise SyncError('SOURCE_ACQUISITION_PROOF_INVALID')
    source_mime = raw['sourceMimeType']; extraction = raw['extraction']
    if (raw['schemaVersion'] != ACQUISITION_SCHEMA or raw['provider'] != 'GOOGLE_DRIVE'
            or not isinstance(raw['sourceObjectIdHash'], str) or not re.fullmatch(r'[a-f0-9]{64}', raw['sourceObjectIdHash'])
            or not isinstance(raw['observedVersion'], str) or not re.fullmatch(r'[1-9][0-9]{0,31}', raw['observedVersion'])
            or not isinstance(source_mime, str) or source_mime not in ACQUISITION_MIMES
            or not isinstance(raw['byteSha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', raw['byteSha256'])
            or type(raw['byteLength']) is not int or not 1 <= raw['byteLength'] <= 1048576
            or extraction['version'] != '1.0.0' or extraction['status'] != 'COMPLETE'
            or extraction['coverage'] != 'EXPORTED_REPRESENTATION_ONLY'
            or extraction['textFormat'] != 'CANONICAL_RECORD_JSON'
            or type(extraction['rowCount']) is not int or not 1 <= extraction['rowCount'] <= 20
            or type(extraction['rowIndex']) is not int or not 0 <= extraction['rowIndex'] < extraction['rowCount']):
        raise SyncError('SOURCE_ACQUISITION_PROOF_INVALID')
    sheets = source_mime == 'application/vnd.google-apps.spreadsheet'
    if (raw['acquiredMimeType'] != ('text/csv' if sheets else source_mime)
            or raw['representation'] != ('GOOGLE_SHEETS_CSV_EXPORT' if sheets else 'ORIGINAL_BYTES')
            or extraction['method'] != ACQUISITION_MIMES[source_mime][1]
            or extraction['textSha256'] != digest(record_text(payload))
            or extraction['rowFactsSha256'] != extraction['textSha256']):
        raise SyncError('SOURCE_ACQUISITION_BINDING_MISMATCH')
    return {**raw, 'extraction': dict(extraction)}



def canonical_snapshot_hash(payload):
    # Preserve the field order of canonicalIntegrationDocument, not payload key order.
    facts = {
        'category': payload['documentType'].lower(), 'competence': payload['competence'],
        'nativeReady': payload['nativeReady'], 'sourceIndependent': payload['sourceIndependent'],
        'externalFetchRequired': not payload['sourceIndependent'], 'externalAiUsed': False,
        'documentFragility': payload['documentFragility'],
        'missingFieldsCount': payload['missingFieldsCount'], 'flowStage': 'FIREBASE_CANONICALIZED',
        'canonicalSnapshotVersion': 1, 'originSystem': payload['sourceSystem'],
        'originConnector': 'AURORA_INTEGRATION_API', 'sanitized': True,
    }
    for key in ('amountCents', 'count', 'slaDueAt'):
        if payload[key] is not None:
            facts[key] = payload[key]
    return digest(json.dumps(facts, separators=(',', ':'), ensure_ascii=True, allow_nan=False))


def processing_proof(payload, org, installation):
    pending_states = {'PENDING_REMOTE_PROOF', 'PENDING_SOURCE', 'PENDING_CANONICAL_DATA', 'PENDING_PROJECTION'}
    if installation is None:
        return {'state': 'PENDING_REMOTE_PROOF', 'firstIngestionVerified': False}
    if not isinstance(installation, dict):
        raise SyncError('CLOUD_PROCESSING_PROOF_MISMATCH')
    state = installation.get('state')
    ledger_fields = ('revision', 'versionId', 'canonicalSnapshotHash', 'sourceSystem', 'operationalComplete')
    # Older servers only attest readiness of a tenant's latest document, not this immutable version.
    if (state == 'FIRST_INGESTION_VERIFIED' and installation.get('firstIngestionVerified') is True
            and not any(key in installation for key in ledger_fields)):
        return {'state': 'PENDING_REMOTE_PROOF', 'firstIngestionVerified': False}
    if (isinstance(state, str) and state in pending_states
            and installation.get('firstIngestionVerified') is False
            and installation.get('operationalComplete') is not True):
        return {'state': state, 'firstIngestionVerified': False}
    source_hash = digest(org + ':' + payload['sourceSystem'] + ':' + payload['externalDocumentId'])
    revision = installation.get('revision')
    expected_version_id = (digest('v1:sourceDocument:' + payload['sourceSystem'] + ':'
                                + source_hash[:32] + ':revision:' + str(revision))[:48])
    if (state != 'FIRST_INGESTION_VERIFIED' or installation.get('firstIngestionVerified') is not True
            or type(installation.get('operationalComplete')) is not bool
            or installation.get('documentId') != source_hash[:48]
            or installation.get('sourceSystem') != payload['sourceSystem']
            or type(installation.get('sourceVersion')) is not int
            or installation['sourceVersion'] != payload['sourceVersion']
            or type(revision) is not int or not 1 <= revision <= 9007199254740991
            or installation.get('versionId') != expected_version_id
            or installation.get('canonicalSnapshotHash') != canonical_snapshot_hash(payload)
            or 'sourceEvidence' in payload and installation.get('sourceEvidenceHash') != source_evidence_hash(payload['sourceEvidence'])):
        raise SyncError('CLOUD_PROCESSING_PROOF_MISMATCH')
    try:
        verified_at = timestamp(installation.get('verifiedAt'))
    except SyncError:
        raise SyncError('CLOUD_PROCESSING_PROOF_MISMATCH') from None
    # First data can be verified before the authenticated setup is completed.
    return {'state': state, 'firstIngestionVerified': True,
            'operationalComplete': installation['operationalComplete'],
            'documentId': source_hash[:48], 'sourceSystem': payload['sourceSystem'],
            'sourceVersion': payload['sourceVersion'], 'revision': revision,
            'versionId': expected_version_id, 'canonicalSnapshotHash': canonical_snapshot_hash(payload),
            **({'sourceEvidenceHash':source_evidence_hash(payload['sourceEvidence'])} if 'sourceEvidence' in payload else {}),
            'verifiedAt': verified_at}


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
        headers['Content-Type']='application/json'
        if idempotency is not None:headers['Idempotency-Key']=idempotency
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


def installation_acceptance(payload, org, value, processing):
    """Validate the same-response server pipeline proof, never a client method hint."""
    if value is None:
        return None
    flags = ('processingVerified', 'receiptPersisted', 'replayVerified',
             'automationConfigured', 'automationVerified', 'providerAccessVerified',
             'localCollectionVerified', 'agentExecutionVerified')
    fields = {'schemaVersion', 'orgId', 'canonicalOrigin', 'state', 'eligible', 'automationScope',
              'method', 'configurationHash', 'receiptId', 'documentId', 'versionId', 'sourceVersion',
              'canonicalSnapshotHash', 'verifiedAt', 'acquisitionModes', 'limitations',
              'processedFormat', 'globalDocumentAcquisitionVerified', *flags}
    methods = {'CLOUD_OAUTH', 'API_TOKEN', 'LOCAL_AGENT', 'MANUAL', 'UNCONFIGURED'}
    if (not isinstance(value, dict) or set(value) != fields
            or value.get('schemaVersion') != 'aurora.installation.acceptance.v1'
            or value.get('orgId') != org or value.get('canonicalOrigin') != 'https://auroranexus.com.br'
            or value.get('automationScope') != 'AURORA_CANONICAL_PIPELINE'
            or value.get('processedFormat') != 'CANONICAL_STRUCTURED_JSON'
            or value.get('globalDocumentAcquisitionVerified') is not False
            or value.get('method') not in methods or type(value.get('eligible')) is not bool
            or any(type(value.get(flag)) is not bool for flag in flags)
            or any(value[flag] is not False for flag in ('providerAccessVerified', 'localCollectionVerified', 'agentExecutionVerified'))):
        raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
    for key, size in (('configurationHash', 64), ('receiptId', 64), ('documentId', 48),
                      ('versionId', 48), ('canonicalSnapshotHash', 64)):
        item = value.get(key)
        if item is not None and (not isinstance(item, str) or not re.fullmatch('[a-f0-9]{' + str(size) + '}', item)):
            raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
    source_version = value.get('sourceVersion')
    if source_version is not None and (type(source_version) is not int or not 1 <= source_version <= 9007199254740991):
        raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
    modes = value.get('acquisitionModes')
    if (not isinstance(modes, dict) or set(modes) != methods - {'UNCONFIGURED'}
            or any(not isinstance(code, str) or not re.fullmatch('[A-Z][A-Z0-9_]{0,79}', code) for code in modes.values())):
        raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
    limitations = value.get('limitations')
    if (not isinstance(limitations, list) or len(limitations) > 20
            or any(not isinstance(code, str) or not re.fullmatch('[A-Z][A-Z0-9_]{0,79}', code) for code in limitations)):
        raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
    result = {key: value[key] for key in fields if key in value}
    if value['verifiedAt'] is not None:
        try:result['verifiedAt']=timestamp(value['verifiedAt'])
        except (TypeError,SyncError):raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH') from None
    if not value['eligible']:
        if value.get('state') not in ('PENDING_PROCESSING','PENDING_RECEIPT','PENDING_REPLAY',
                                     'PENDING_AUTOMATION','PENDING_AUTHORITY','PENDING_ADAPTER_EVIDENCE'):
            raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
        return result
    if (value.get('state') != 'INSTALLATION_INTEGRATION_VERIFIED'
            or not all(value[flag] is True for flag in flags[:5])
            or value['method'] not in ('API_TOKEN', 'MANUAL')
            or processing.get('firstIngestionVerified') is not True):
        raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
    for key in ('documentId', 'versionId', 'sourceVersion', 'canonicalSnapshotHash'):
        if type(value.get(key)) is not type(processing.get(key)) or value.get(key) != processing.get(key):
            raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
    if (not isinstance(value.get('configurationHash'), str)
            or not re.fullmatch(r'[a-f0-9]{64}', value['configurationHash'])
            or not isinstance(value.get('receiptId'), str)
            or not re.fullmatch(r'[a-f0-9]{64}', value['receiptId'])):
        raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH')
    try:
        result['verifiedAt'] = timestamp(value['verifiedAt'])
    except (KeyError, SyncError):
        raise SyncError('INSTALLATION_ACCEPTANCE_MISMATCH') from None
    return result


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
    for key, expected in (('sourceVersion', payload['sourceVersion']),
                          ('canonicalSnapshotHash', canonical_snapshot_hash(payload))):
        if key in result and (type(result[key]) is not type(expected) or result[key] != expected):
            raise SyncError('CLOUD_RECEIPT_MISMATCH')
    proof = processing_proof(payload, org, result.get('installation'))
    if 'sourceEvidence' in payload:
        expected_evidence_hash=source_evidence_hash(payload['sourceEvidence'])
        if result.get('sourceEvidenceHash') != expected_evidence_hash:
            raise SyncError('CLOUD_ACQUISITION_PROOF_MISMATCH')
        receipt['sourceEvidenceHash']=expected_evidence_hash
    if proof['firstIngestionVerified'] and ('sourceVersion' not in result or 'canonicalSnapshotHash' not in result):
        raise SyncError('CLOUD_PROCESSING_PROOF_MISMATCH')
    receipt.update(status='DUPLICATE' if result['duplicate'] else 'ACCEPTED', cloudReceiptVerified=True,
                   processing=proof)
    acceptance = installation_acceptance(payload, org, (result.get('installation') or {}).get('acceptance'), proof)
    if acceptance is not None:
        receipt['installationAcceptance'] = acceptance
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
