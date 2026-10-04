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
