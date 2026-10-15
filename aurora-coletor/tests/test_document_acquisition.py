"""Synthetic bytes/provider responses only; no consent, source or HML access."""
import copy
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import aurora_cloud_sync as sync
import client_agent as agent
import provider_connectors as connectors
from test_cloud_sync import fixture, processed_response
from test_provider_connectors import table_csv, table_xlsx, table_values

ENV = {'AURORA_APP_TOKEN': 'synthetic-app-token', 'AURORA_GOOGLE_TOKEN': 'synthetic-provider-token'}
SOURCE = {'provider': 'GOOGLE_DRIVE', 'folderId': 'synthetic-approved-folder', 'tokenEnv': 'AURORA_GOOGLE_TOKEN'}


def acquired(mime='application/json', version='11', raw=None):
    raw = json.dumps(fixture()).encode() if raw is None else raw
    item = {'id': 'synthetic-file', 'mimeType': mime, 'version': version}
    transport = Mock(side_effect=[{'files': [item]}, raw, dict(item)])
    page = connectors.pull(SOURCE, transport, ENV)
    return page, raw, transport


def evidence_transport(ledger=None, reject_ack=False, pending=False):
    def transport(url, token, payload=None, key=None):
        if url.endswith('/ping'):
            return 200, {'ok': True, 'orgId': 'synthetic-org', 'reportAccepted': True}
        duplicate = ledger is not None and key in ledger
        if ledger is not None: ledger.add(key)
        response = processed_response(payload, duplicate)
        if 'sourceEvidence' in payload:
            response['installation']['sourceEvidenceHash'] = sync.source_evidence_hash(payload['sourceEvidence'])
            if not reject_ack: response['sourceEvidenceHash'] = response['installation']['sourceEvidenceHash']
        if pending: response['installation'] = {'state': 'PENDING_PROJECTION', 'firstIngestionVerified': False}
        return (200 if duplicate else 202), response
    return transport


class DocumentAcquisitionTests(unittest.TestCase):
    def test_mime_specific_structured_bytes_are_bound_to_normalized_materialized_records(self):
        for mime, raw in [('application/json', json.dumps(fixture()).encode()),
                          ('text/csv', table_csv(table_values(fixture()))),
                          ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', table_xlsx(table_values(fixture())))]:
            with self.subTest(mime=mime):
                page, _, transport = acquired(mime, raw=raw)
                self.assertEqual(page['pendingExtraction'], 0)
                row = page['documents'][0]; proof = row['sourceEvidence']
                self.assertEqual(proof['byteSha256'], hashlib.sha256(raw).hexdigest())
                self.assertEqual(proof['byteLength'], len(raw))
                self.assertEqual(proof['representation'], 'ORIGINAL_BYTES')
                self.assertEqual(proof['sourceMimeType'], mime)
                self.assertEqual(proof['extraction']['textSha256'], sync.digest(sync.record_text(row)))
                self.assertNotEqual(proof['byteSha256'], sync.canonical_snapshot_hash(row))
                self.assertEqual({key: row[key] for key in sync.FIELDS}, sync.validate_payload(fixture()))
                self.assertIn('?alt=media', transport.call_args_list[1].args[0])
                self.assertIn('?fields=id%2CmimeType%2Cversion', transport.call_args_list[2].args[0])

    def test_sheets_exports_csv_and_only_attests_the_exported_representation(self):
        raw = table_csv(table_values(fixture()))
        page, _, transport = acquired('application/vnd.google-apps.spreadsheet', raw=raw)
        proof = page['documents'][0]['sourceEvidence']
        self.assertIn('/export?mimeType=text%2Fcsv', transport.call_args_list[1].args[0])
        self.assertEqual(proof['representation'], 'GOOGLE_SHEETS_CSV_EXPORT')
        self.assertEqual(proof['acquiredMimeType'], 'text/csv')
        self.assertEqual(proof['extraction']['coverage'], 'EXPORTED_REPRESENTATION_ONLY')
        self.assertEqual(proof['byteSha256'], hashlib.sha256(raw).hexdigest())

    def test_native_docs_pdf_unknown_mime_and_missing_version_never_create_facts(self):
        for extra in [{'mimeType': 'application/pdf', 'version': '7'},
                      {'mimeType': 'application/vnd.google-apps.document', 'version': '7'},
                      {'mimeType': 'application/octet-stream', 'version': '7'}, {'mimeType': 'application/json'}]:
            with self.subTest(extra=extra):
                transport = Mock(return_value={'files': [{'id': 'synthetic-file', 'name': 'misleading.json', **extra}]})
                page = connectors.pull(SOURCE, transport, ENV)
                self.assertEqual(page['documents'], [])
                self.assertEqual(len(page['pendingDocuments']), 1)
                self.assertEqual(page['pendingExtraction'], 1)
                self.assertNotIn('misleading', json.dumps(page))
                self.assertEqual(transport.call_count, 1)

    def test_source_version_change_during_download_retains_pending_identity_and_no_facts(self):
        item = {'id': 'synthetic-file', 'mimeType': 'application/json', 'version': '7'}
        transport = Mock(side_effect=[{'files': [item]}, json.dumps(fixture()).encode(), {**item, 'version': '8'}])
        page = connectors.pull(SOURCE, transport, ENV)
        self.assertEqual(page['documents'], [])
        self.assertEqual(page['pendingDocuments'][0]['observedVersion'], '7')
        self.assertEqual(page['pendingDocuments'][0]['code'], 'SOURCE_CHANGED_DURING_ACQUISITION')

    def test_malformed_and_oversized_exports_retain_pending_instead_of_guessing_financial_values(self):
        for raw in (b'{"amount":"R$ 100.00","instructions":"execute"}', b'x' * (connectors.MAX_PROVIDER_BYTES + 1), b''):
            with self.subTest(length=len(raw)):
                page, _, _ = acquired(raw=raw)
                self.assertEqual(page['documents'], [])
                self.assertEqual(len(page['pendingDocuments']), 1)
                self.assertNotIn('R$', json.dumps(page))

    def test_scope_version_and_bounded_page_are_required(self):
        for item in ({'id': '../escape', 'mimeType': 'application/json', 'version': '2'},
                     {'id': 'synthetic-file', 'mimeType': 'application/json', 'version': '9'*33}):
            transport = Mock(return_value={'files': [item]})
            if item['id'] == '../escape':
                with self.assertRaises(sync.SyncError): connectors.pull(SOURCE, transport, ENV)
            else:
                page=connectors.pull(SOURCE,transport,ENV);self.assertEqual(page['pendingExtraction'],1)
            self.assertEqual(transport.call_count, 1)
        with self.assertRaisesRegex(sync.SyncError, 'BOUNDED_PROVIDER_PAGE'):
            connectors.pull(SOURCE, Mock(return_value={'files': [{}]*21}), ENV)
        with self.assertRaisesRegex(sync.SyncError, 'DESTINATION'):
            connectors.api('https://www.googleapis.com.evil.invalid/drive/v3/files', 'synthetic')

    def test_rows_bind_independently_and_cannot_reuse_proof_for_changed_facts(self):
        payloads = [fixture(), {**fixture(), 'externalDocumentId': 'synthetic-export-two', 'amountCents': 333}]
        page, _, _ = acquired(raw=json.dumps(payloads).encode())
        rows = page['documents']
        self.assertEqual([row['sourceEvidence']['extraction']['rowIndex'] for row in rows], [0, 1])
        self.assertTrue(all(row['sourceEvidence']['extraction']['rowCount'] == 2 for row in rows))
        self.assertNotEqual(rows[0]['sourceEvidence']['extraction']['textSha256'], rows[1]['sourceEvidence']['extraction']['textSha256'])
        for change in ({'amountCents': 1}, {'sourceVersion': 2}, {'externalDocumentId': 'synthetic-changed'}):
            with self.assertRaisesRegex(sync.SyncError, 'BINDING'): sync.validate_payload({**rows[0], **change})

    def test_closed_proof_rejects_extra_text_wrong_mime_status_coverage_and_dimensions(self):
        row = acquired()[0]['documents'][0]
        cases = [('narrative', 'forbidden'), ('byteLength', 0), ('observedVersion', '01'), ('provider', 'OTHER'),
                 ('acquiredMimeType', 'text/csv'), ('byteSha256', 'not-a-hash')]
        for key, value in cases:
            candidate = copy.deepcopy(row); candidate['sourceEvidence'][key] = value
            with self.subTest(key=key), self.assertRaises(sync.SyncError): sync.validate_payload(candidate)
        for key, value in [('status','PENDING'),('coverage','ENTIRE_SOURCE'),('rowIndex',1),('rowCount',21),('textSha256','f'*64)]:
            candidate=copy.deepcopy(row);candidate['sourceEvidence']['extraction'][key]=value
            with self.subTest(key=key),self.assertRaises(sync.SyncError):sync.validate_payload(candidate)

    def test_legacy_requests_remain_unchanged_and_evidence_requires_persisted_hash_ack(self):
        self.assertEqual(set(sync.validate_payload(fixture())), set(sync.FIELDS))
        row = acquired()[0]['documents'][0]
        with self.assertRaisesRegex(sync.SyncError, 'ACQUISITION_PROOF'):
            sync.synchronize(row, 'https://auroranexus.com.br', 'synthetic-org', 'synthetic', True, evidence_transport(reject_ack=True))
        ledger=set()
        first=sync.synchronize(row,'https://auroranexus.com.br','synthetic-org','synthetic',True,evidence_transport(ledger))
        second=sync.synchronize(row,'https://auroranexus.com.br','synthetic-org','synthetic',True,evidence_transport(ledger))
        self.assertEqual(second['status'],'DUPLICATE');self.assertEqual(first['sourceEvidenceHash'],second['sourceEvidenceHash'])
        next_row=acquired(version='12')[0]['documents'][0]
        self.assertEqual(sync.canonical_snapshot_hash(row),sync.canonical_snapshot_hash(next_row))
        self.assertNotEqual(first['idempotencyKey'],sync.synchronize(next_row,'https://auroranexus.com.br','synthetic-org')['idempotencyKey'])

    def test_same_facts_on_new_provider_revision_cannot_substitute_current_processing_for_old_acquisition(self):
        old=acquired(version='11')[0]['documents'][0]
        current=acquired(version='12')[0]['documents'][0]
        response=processed_response(old,duplicate=True,revision=2)
        response['sourceEvidenceHash']=sync.source_evidence_hash(old['sourceEvidence'])
        response['installation']['sourceEvidenceHash']=sync.source_evidence_hash(current['sourceEvidence'])
        transport=Mock(side_effect=[(200,{'ok':True,'orgId':'synthetic-org'}),(200,response)])
        with self.assertRaisesRegex(sync.SyncError,'PROCESSING_PROOF'):
            sync.synchronize(old,'https://auroranexus.com.br','synthetic-org','synthetic',True,transport)


class PendingAcquisitionQueueTests(unittest.TestCase):
    def config(self, base):
        return {'schemaVersion':agent.SCHEMA,'instanceId':'a'*32,'org':'synthetic-org','origin':'https://auroranexus.com.br',
                'stateDir':str(base/'state'),'roots':[],'providers':[dict(SOURCE)],'tokenEnv':'AURORA_APP_TOKEN',
                'authorization':{'approved':True,'actorRef':'synthetic-admin','documentRef':'synthetic-consent','expiresAt':'2099-01-01T00:00:00Z'}}

    def test_pending_identity_survives_source_disappearance_failure_and_database_reopen(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));item={'id':'synthetic-unparsed','mimeType':'application/pdf','version':'3'}
            pending=connectors.pull(SOURCE,Mock(return_value={'files':[item],'nextPageToken':'later'}),ENV)
            provider=Mock(side_effect=[pending,{'documents':[],'pendingExtraction':0,'pendingDocuments':[],'coverageLimited':False,'nextCursor':None},sync.SyncError('PROVIDER_UNAVAILABLE')])
            for _ in range(3):
                result=agent.cycle(config,ENV,evidence_transport(),provider,verify_installation=True)
                self.assertEqual(result['cloudPagesCommitted'],0)
                self.assertEqual(result['pendingExtraction'],1)
                self.assertFalse(result['cloudEnumerationComplete'])
                self.assertFalse(result['installationReadiness']['eligible'])
            self.assertEqual([call.kwargs['cursor'] for call in provider.call_args_list],[None,None,None])
            with closing(sqlite3.connect(Path(config['stateDir'])/'client-agent.sqlite3')) as conn:
                records=conn.execute("SELECT receipt FROM intake WHERE state='PENDING_EXTRACTION'").fetchall()
                self.assertEqual(len(records),1)
                self.assertEqual(json.loads(records[0][0])['acquisition']['observedVersion'],'3')
                dump='\n'.join(conn.iterdump())
                for private in ('synthetic-unparsed','pending.pdf',*ENV.values()):self.assertNotIn(private,dump)

    def test_only_same_object_version_and_all_processed_records_can_resolve_pending_and_advance(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));ready=acquired()[0]
            evidence=ready['documents'][0]['sourceEvidence']
            pending={'documents':[],'pendingExtraction':1,'pendingDocuments':[{
                'schemaVersion':'aurora.document.acquisition.pending.v1','provider':'GOOGLE_DRIVE',
                'sourceObjectIdHash':evidence['sourceObjectIdHash'],'observedVersion':evidence['observedVersion'],
                'sourceMimeType':evidence['sourceMimeType'],'status':'PENDING_EXTRACTION','code':'CANONICAL_EXTRACTION_REQUIRED'}],
                'coverageLimited':True,'nextCursor':'later'}
            provider=Mock(side_effect=[pending,ready,ready]);ledger=set()
            agent.cycle(config,ENV,evidence_transport(ledger),provider)
            still=agent.cycle(config,ENV,evidence_transport(ledger,pending=True),provider)
            self.assertEqual(still['pendingExtraction'],1);self.assertEqual(still['cloudPagesCommitted'],0)
            resumed=agent.cycle(config,ENV,evidence_transport(ledger),provider)
            self.assertEqual(resumed['pendingExtraction'],0);self.assertEqual(resumed['cloudPagesCommitted'],1)
            self.assertTrue(resumed['cloudSnapshotVerified']);self.assertEqual(len(ledger),1)
            with closing(sqlite3.connect(Path(config['stateDir'])/'client-agent.sqlite3')) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM intake WHERE state='EXTRACTION_RESOLVED'").fetchone()[0],1)

    def test_different_observed_version_does_not_silently_close_older_pending_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));ready=acquired(version='12')[0]
            item={'id':'synthetic-file','mimeType':'application/json','version':'11'}
            old=connectors.drive_pending(SOURCE['folderId'],item,'CANONICAL_EXTRACTION_REQUIRED')
            pending={'documents':[],'pendingExtraction':1,'pendingDocuments':[old],'coverageLimited':False,'nextCursor':None}
            provider=Mock(side_effect=[pending,ready])
            agent.cycle(config,ENV,evidence_transport(),provider)
            result=agent.cycle(config,ENV,evidence_transport(),provider)
            self.assertEqual(result['pendingExtraction'],1);self.assertEqual(result['cloudPagesCommitted'],0)
            self.assertFalse(result['installationReadiness']['eligible'])

    def test_partial_representation_cannot_resolve_a_retained_file_before_all_rows_have_receipts(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp))
            full=acquired(raw=json.dumps([fixture(),{**fixture(),'externalDocumentId':'synthetic-export-two'}]).encode())[0]
            proof=full['documents'][0]['sourceEvidence']
            item={'schemaVersion':'aurora.document.acquisition.pending.v1','provider':'GOOGLE_DRIVE',
                  'sourceObjectIdHash':proof['sourceObjectIdHash'],'observedVersion':proof['observedVersion'],
                  'sourceMimeType':proof['sourceMimeType'],'status':'PENDING_EXTRACTION','code':'CANONICAL_EXTRACTION_REQUIRED'}
            pending={'documents':[],'pendingExtraction':1,'pendingDocuments':[item],'coverageLimited':False,'nextCursor':None}
            partial={**full,'documents':full['documents'][:1]}
            provider=Mock(side_effect=[pending,partial,full]);ledger=set()
            agent.cycle(config,ENV,evidence_transport(ledger),provider)
            result=agent.cycle(config,ENV,evidence_transport(ledger),provider)
            self.assertEqual(result['pendingExtraction'],1);self.assertEqual(result['cloudPagesCommitted'],0)
            result=agent.cycle(config,ENV,evidence_transport(ledger),provider)
            self.assertEqual(result['pendingExtraction'],0);self.assertEqual(result['cloudPagesCommitted'],1)
            self.assertEqual(len(ledger),2)

    def test_legacy_committed_pending_counts_are_preserved_before_completed_traversal_rescan(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));empty={'documents':[],'pendingExtraction':0,'pendingDocuments':[],'coverageLimited':False,'nextCursor':None}
            provider=Mock(return_value=empty)
            agent.cycle(config,ENV,evidence_transport(),provider)
            with closing(sqlite3.connect(Path(config['stateDir'])/'client-agent.sqlite3')) as conn:
                conn.execute('UPDATE provider_pages SET pending_extraction=2');conn.commit()
            for _ in range(2):
                result=agent.cycle(config,ENV,evidence_transport(),provider)
                self.assertEqual(result['pendingExtraction'],2)
                self.assertEqual(result['cloudPagesCommitted'],0)
                self.assertFalse(result['cloudEnumerationComplete'])
            with closing(sqlite3.connect(Path(config['stateDir'])/'client-agent.sqlite3')) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM intake WHERE state='PENDING_EXTRACTION_AGGREGATE'").fetchone()[0],1)

    def test_one_file_resolution_is_durable_while_another_holds_cursor_and_first_file_disappears(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));ready=acquired()[0];row=ready['documents'][0];proof=row['sourceEvidence']
            pending_a={'schemaVersion':'aurora.document.acquisition.pending.v1','provider':'GOOGLE_DRIVE',
                'sourceObjectIdHash':proof['sourceObjectIdHash'],'observedVersion':proof['observedVersion'],
                'sourceMimeType':proof['sourceMimeType'],'status':'PENDING_EXTRACTION','code':'CANONICAL_EXTRACTION_REQUIRED'}
            pending_b=connectors.drive_pending(SOURCE['folderId'],{'id':'synthetic-file-b','mimeType':'application/pdf','version':'11'},
                                              'REVIEWED_MIME_AND_VERSION_REQUIRED')
            initial={'documents':[],'pendingExtraction':2,'pendingDocuments':[pending_a,pending_b],
                     'coverageLimited':True,'nextCursor':'later'}
            a_resolved={'documents':[row],'pendingExtraction':1,'pendingDocuments':[pending_b],
                        'coverageLimited':True,'nextCursor':'later'}
            a_absent={**a_resolved,'documents':[]}
            provider=Mock(side_effect=[initial,a_resolved,a_absent]);ledger=set()
            transport=Mock(side_effect=evidence_transport(ledger))
            agent.cycle(config,ENV,transport,provider,verify_installation=True)
            resolved=agent.cycle(config,ENV,transport,provider,verify_installation=True)
            self.assertEqual(resolved['pendingExtraction'],1);self.assertEqual(resolved['cloudPagesCommitted'],0)
            self.assertEqual(resolved['installationReadiness']['idempotentReplaysVerifiedThisRun'],1)
            with closing(sqlite3.connect(Path(config['stateDir'])/'client-agent.sqlite3')) as conn:
                history=conn.execute("SELECT receipt FROM intake WHERE state='EXTRACTION_RESOLVED'").fetchall()
                self.assertEqual(len(history),1)
                resolution=json.loads(history[0][0])['resolution']
                self.assertEqual(resolution['records'][0]['sourceEvidenceHash'],sync.source_evidence_hash(proof))
                self.assertEqual(conn.execute("SELECT count(*) FROM intake WHERE state='PENDING_EXTRACTION'").fetchone()[0],1)
            # A fresh cycle opens the database again, and A is no longer listed.
            later=agent.cycle(config,ENV,transport,provider,verify_installation=True)
            self.assertEqual(later['pendingExtraction'],1);self.assertEqual(later['cloudPagesCommitted'],0)
            self.assertFalse(later['installationReadiness']['eligible'])
            self.assertEqual([call.kwargs['cursor'] for call in provider.call_args_list],[None,None,None])
            with closing(sqlite3.connect(Path(config['stateDir'])/'client-agent.sqlite3')) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM intake WHERE state='EXTRACTION_RESOLVED'").fetchone()[0],1)
                self.assertEqual(conn.execute("SELECT count(*) FROM intake WHERE state='PENDING_EXTRACTION'").fetchone()[0],1)
            self.assertEqual(len(ledger),1)
            self.assertEqual(len([call for call in transport.call_args_list if call.args[0].endswith('/documents')]),2)


if __name__ == '__main__': unittest.main()
