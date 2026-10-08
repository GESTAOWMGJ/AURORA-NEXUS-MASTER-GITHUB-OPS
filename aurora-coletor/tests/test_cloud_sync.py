import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('sync', Path(__file__).resolve().parents[1] / 'aurora_cloud_sync.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
ORIGIN = 'https://aurora.example.invalid'
ORG = 'synthetic-org'


def fixture():
    return dict(sourceSystem='ERP', externalDocumentId='synthetic-export-001', sourceVersion=1,
                occurredAt='2026-01-01T00:00:00Z', documentType='FINANCIAL', competence='2026-01',
                amountCents=12345, count=None, workflowState='PENDING_HUMAN_REVIEW', slaDueAt=None,
                documentFragility='NONE', missingFieldsCount=0, nativeReady=True, sourceIndependent=True)


def response(payload, duplicate=False):
    return dict(ok=True, accepted=not duplicate, duplicate=duplicate,
                documentId=sync.digest(ORG + ':' + payload['sourceSystem'] + ':' + payload['externalDocumentId'])[:48],
                sourceSystem=payload['sourceSystem'], nativeReady=payload['nativeReady'],
                sourceIndependent=payload['sourceIndependent'])



def processed_response(payload, duplicate=False, revision=1, org=ORG):
    normalized = sync.validate_payload(payload)
    source_hash = sync.digest(org + ':' + normalized['sourceSystem'] + ':' + normalized['externalDocumentId'])
    receipt = response(normalized, duplicate)
    receipt.update(sourceVersion=normalized['sourceVersion'],
                   canonicalSnapshotHash=sync.canonical_snapshot_hash(normalized))
    receipt['installation'] = {
        'state': 'FIRST_INGESTION_VERIFIED', 'firstIngestionVerified': True,
        'operationalComplete': True, 'documentId': source_hash[:48],
        'sourceSystem': normalized['sourceSystem'], 'sourceVersion': normalized['sourceVersion'],
        'revision': revision,
        'versionId': sync.digest('v1:sourceDocument:' + normalized['sourceSystem'] + ':'
                                 + source_hash[:32] + ':revision:' + str(revision))[:48],
        'canonicalSnapshotHash': sync.canonical_snapshot_hash(normalized),
        'verifiedAt': '2026-01-01T01:00:00.000Z',
    }
    return receipt


class SyncTests(unittest.TestCase):
    def transport(self, payload, duplicate=False):
        return Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}),
                                 (200 if duplicate else 202, response(payload, duplicate))])

    def test_default_never_transmits_or_changes_source(self):
        payload = fixture()
        before = copy.deepcopy(payload)
        transport = Mock()
        receipt = sync.synchronize(payload, ORIGIN, ORG, transport=transport)
        transport.assert_not_called()
        self.assertEqual(payload, before)
        self.assertFalse(receipt['cloudReceiptVerified'])

    def test_no_credential_never_calls_network(self):
        transport = Mock()
        with self.assertRaisesRegex(sync.SyncError, 'CREDENTIAL'):
            sync.synchronize(fixture(), ORIGIN, ORG, send=True, transport=transport)
        transport.assert_not_called()

    def test_wrong_tenant_blocks_post(self):
        transport = Mock(return_value=(200, {'ok': True, 'orgId': 'other-org'}))
        with self.assertRaisesRegex(sync.SyncError, 'ORGANIZATION_MISMATCH'):
            sync.synchronize(fixture(), ORIGIN, ORG, 'synthetic-key', True, transport)
        self.assertEqual(transport.call_count, 1)

    def test_accepted_receipt_and_idempotent_retry(self):
        payload = fixture()
        first = sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, self.transport(payload))
        retry = sync.synchronize(payload, ORIGIN, ORG, 'rotated-synthetic-key', True, self.transport(payload, True))
        self.assertEqual(first['status'], 'ACCEPTED')
        self.assertEqual(retry['status'], 'DUPLICATE')
        self.assertEqual(first['idempotencyKey'], retry['idempotencyKey'])
        self.assertTrue(retry['cloudReceiptVerified'])
        self.assertNotIn('synthetic-key', json.dumps(first))
        self.assertNotIn('amountCents', first)

    def test_idempotency_binds_target_org_and_content(self):
        payload = fixture()
        first = sync.synchronize(payload, ORIGIN, ORG)
        for origin, org, body in [(ORIGIN, 'other-org', payload),
                                  ('https://other.example.invalid', ORG, payload),
                                  (ORIGIN, ORG, dict(payload, amountCents=12346))]:
            self.assertNotEqual(first['idempotencyKey'], sync.synchronize(body, origin, org)['idempotencyKey'])

    def test_invalid_receipts_never_claim_sync(self):
        payload = fixture()
        for change in ({'documentId': 'wrong'}, {'accepted': False}, {'duplicate': True},
                       {'nativeReady': False}, {'sourceSystem': 'MV'}, {'ok': False}):
            transport = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, dict(response(payload), **change))])
            with self.subTest(change=change), self.assertRaisesRegex(sync.SyncError, 'RECEIPT'):
                sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, transport)

    def test_server_conflict_and_auth_failure_are_not_retried(self):
        for code in ('BLOCKED_HTTP_401', 'BLOCKED_HTTP_409', 'RETRYABLE_HTTP_503'):
            transport = Mock(side_effect=sync.SyncError(code))
            with self.subTest(code=code), self.assertRaisesRegex(sync.SyncError, code):
                sync.synchronize(fixture(), ORIGIN, ORG, 'synthetic-key', True, transport)
            self.assertEqual(transport.call_count, 1)

    def test_rejects_narrative_phi_and_incomplete_facts_before_network(self):
        for change in ({'patientName': 'synthetic'}, {'externalDocumentId': 'patient-001'},
                       {'amountCents': None}, {'amountCents': True}, {'sourceVersion': 0},
                       {'missingFieldsCount': 1}, {'occurredAt': '2026-01-01'},
                       {'amountCents': 9007199254740992}, {'nativeReady': False}):
            transport = Mock()
            with self.subTest(change=change), self.assertRaises(sync.SyncError):
                sync.synchronize(dict(fixture(), **change), ORIGIN, ORG, 'synthetic-key', True, transport)
            transport.assert_not_called()



    def test_canonical_snapshot_matches_backend_golden_vectors(self):
        # Generated from canonicalIntegrationDocument in the real TypeScript backend.
        cases = [
            (fixture(), '493c13aebca51cb7f6b34c471d5c031fc4fc5b0d648fe82ff81ec103eef3e4c4'),
            (dict(fixture(), amountCents=None, count=9007199254740991, documentType='PRODUCTION',
                  slaDueAt='2026-02-01T03:00:00+03:00'),
             '9d13dcdb2ede18be7627e337f6529056ffd8f60b14bb526b645ec66a9bf61e85'),
            (dict(fixture(), amountCents=9007199254740991, count=0, sourceSystem='TASY', sourceVersion=13),
             '37bda04eac8fc670d615d196c55c6c5f6a84a94d02d7c1aaa61bbfceeae76b8a'),
        ]
        for payload, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(sync.canonical_snapshot_hash(sync.validate_payload(payload)), expected)

    def test_processing_proof_requires_exact_document_version_hash_and_ledger_identity(self):
        payload = fixture()
        valid = processed_response(payload, True)
        for change in ({'documentId': 'a' * 48}, {'sourceSystem': 'MV'},
                       {'sourceVersion': 2}, {'sourceVersion': True}, {'revision': 0},
                       {'revision': True}, {'versionId': 'b' * 48},
                       {'canonicalSnapshotHash': 'c' * 64}, {'verifiedAt': 'not-a-date'},
                       {'firstIngestionVerified': False}, {'operationalComplete': False}):
            invalid = copy.deepcopy(valid)
            invalid['installation'].update(change)
            network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (200, invalid)])
            with self.subTest(change=change), self.assertRaisesRegex(sync.SyncError, 'PROCESSING_PROOF'):
                sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, network)
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (200, valid)])
        receipt = sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, network)
        self.assertTrue(receipt['processing']['firstIngestionVerified'])
        self.assertEqual(receipt['processing']['revision'], 1)

    def test_matching_document_from_another_tenant_cannot_prove_processing(self):
        payload = fixture()
        invalid = processed_response(payload, True, org='other-org')
        network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (200, invalid)])
        with self.assertRaisesRegex(sync.SyncError, 'PROCESSING_PROOF'):
            sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, network)

    def test_outer_receipt_provenance_and_missing_processing_evidence_fail_closed(self):
        payload = fixture()
        for change in ({'sourceVersion': 2}, {'canonicalSnapshotHash': 'a' * 64}):
            invalid = dict(processed_response(payload), **change)
            network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, invalid)])
            with self.subTest(change=change), self.assertRaisesRegex(sync.SyncError, 'RECEIPT'):
                sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, network)
        for key in ('sourceVersion', 'canonicalSnapshotHash'):
            invalid = processed_response(payload)
            del invalid[key]
            network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, invalid)])
            with self.subTest(missing=key), self.assertRaisesRegex(sync.SyncError, 'PROCESSING_PROOF'):
                sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, network)
        legacy_proof = {key: value for key, value in processed_response(payload)['installation'].items()
                        if key in ('state', 'firstIngestionVerified', 'documentId', 'sourceVersion', 'verifiedAt')}
        for installation in (None, legacy_proof,
                             {'state': 'PENDING_PROJECTION', 'firstIngestionVerified': False}):
            pending = dict(response(payload), installation=installation)
            network = Mock(side_effect=[(200, {'ok': True, 'orgId': ORG}), (202, pending)])
            receipt = sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, network)
            self.assertTrue(receipt['cloudReceiptVerified'])
            self.assertFalse(receipt['processing']['firstIngestionVerified'])

    def test_ping_processing_flags_are_not_document_evidence(self):
        payload = fixture()
        ping = dict(ok=True, orgId=ORG, installation=processed_response(payload)['installation'])
        network = Mock(side_effect=[(200, ping), (202, response(payload))])
        receipt = sync.synchronize(payload, ORIGIN, ORG, 'synthetic-key', True, network)
        self.assertFalse(receipt['processing']['firstIngestionVerified'])

    def test_invalid_origins_block_credentials(self):
        for origin in ('http://aurora.invalid', 'https://user:secret@aurora.invalid',
                       'https://aurora.invalid?token=x', 'https://aurora.invalid/path', 'https://aurora.invalid:8080'):
            with self.subTest(origin=origin), self.assertRaises(sync.SyncError):
                sync.origin_url(origin)

    def test_redirect_never_forwards_bearer(self):
        with self.assertRaisesRegex(sync.SyncError, 'REDIRECT_BLOCKED'):
            sync.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.invalid')

    def test_duplicate_json_keys_rejected(self):
        with self.assertRaisesRegex(sync.SyncError, 'DUPLICATE_JSON_KEY'):
            json.loads('{"amountCents": 1, "amountCents": 2}', object_pairs_hook=sync.unique_object)

    def test_timezone_normalization_preserves_idempotency(self):
        payload = fixture()
        self.assertEqual(sync.synchronize(payload, ORIGIN, ORG)['idempotencyKey'],
                         sync.synchronize(dict(payload, occurredAt='2025-12-31T21:00:00-03:00'), ORIGIN, ORG)['idempotencyKey'])


if __name__ == '__main__':
    unittest.main()
