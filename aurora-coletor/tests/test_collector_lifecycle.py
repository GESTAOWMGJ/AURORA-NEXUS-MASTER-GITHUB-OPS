import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('collector_lifecycle', ROOT / 'aurora_collector.py')
collector = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(collector)


class CollectorConnectionLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.watch = root / 'input'
        self.watch.mkdir()
        self.state = root / 'state'
        self.config = {
            'watchDir': str(self.watch), 'stateDir': str(self.state),
            'allowedExtensions': ['.json'], 'maxFileBytes': 1024,
            'org': 'tenant-test', 'facility': 'TEST',
            'technicalIdentityId': 'collector-synthetic',
            'endpoint': 'https://synthetic.invalid/coletor',
        }
        self.connections = []
        self.addCleanup(self.close_connections)
        ensure_db = collector.ensure_db
        self.ensure_db = ensure_db

        def tracked_connection(state_dir):
            conn = ensure_db(state_dir)
            self.connections.append(conn)
            return conn

        tracker = patch.object(collector, 'ensure_db', side_effect=tracked_connection)
        tracker.start()
        self.addCleanup(tracker.stop)

    def close_connections(self):
        for conn in self.connections:
            conn.close()

    def assert_connection_closed(self):
        self.assertEqual(len(self.connections), 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            self.connections[0].execute('SELECT 1')

    def test_scan_success_releases_database_handle(self):
        self.assertEqual(collector.scan_counts(self.config), {'eligible': 0, 'state_ready': 1})
        self.assert_connection_closed()

    def test_database_initialization_error_releases_acquired_handle(self):
        database = Path(self.temp.name) / 'readonly.sqlite3'
        conn = sqlite3.connect(database)
        conn.execute('CREATE TABLE fixture (value TEXT)')
        conn.commit()
        conn.close()
        readonly = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
        self.connections.append(readonly)
        with patch.object(collector.sqlite3, 'connect', return_value=readonly):
            with self.assertRaises(sqlite3.OperationalError):
                self.ensure_db(self.state)
        self.assert_connection_closed()

    def test_scan_error_releases_database_handle(self):
        with patch.object(collector, 'iter_files', side_effect=OSError('synthetic scan failure')):
            with self.assertRaises(OSError):
                collector.scan_counts(self.config)
        self.assert_connection_closed()

    def prepare_transmission(self):
        sample = self.watch / 'synthetic.json'
        sample.write_text('{"synthetic":true}', encoding='utf-8')
        files = patch.object(collector, 'iter_files', return_value=[sample])
        token = patch.object(collector, 'require_token', return_value='synthetic-test-only-token')
        files.start()
        token.start()
        self.addCleanup(files.stop)
        self.addCleanup(token.stop)

    def test_transmission_success_releases_handle_and_preserves_receipt(self):
        self.prepare_transmission()

        def accepted(_endpoint, payload, _headers):
            return 200, json.dumps({
                'receiptId': 'synthetic-receipt', 'state': 'AWAITING_REVIEW',
                'normalizedContentHash': payload['file']['normalizedContentHash'],
            })

        with patch.object(collector, 'post_payload', side_effect=accepted):
            counts = collector.transmit_once(self.config)
        self.assertEqual(counts['sent'], 1)
        self.assert_connection_closed()
        conn = sqlite3.connect(self.state / 'collector-state.sqlite3')
        try:
            self.assertEqual(conn.execute('SELECT state, receipt_id FROM queue').fetchall(),
                             [('AWAITING_REVIEW', 'synthetic-receipt')])
        finally:
            conn.close()

    def test_authorization_failure_releases_handle_and_keeps_blocked_item(self):
        self.prepare_transmission()
        with patch.object(collector, 'post_payload', return_value=(401, '{}')):
            with self.assertRaises(collector.AuthorizationError):
                collector.transmit_once(self.config)
        self.assert_connection_closed()
        conn = sqlite3.connect(self.state / 'collector-state.sqlite3')
        try:
            self.assertEqual(conn.execute('SELECT state FROM queue').fetchall(), [('BLOCKED',)])
        finally:
            conn.close()

    def test_unexpected_transmission_failure_releases_database_handle(self):
        with patch.object(collector, 'require_token', return_value='synthetic-test-only-token'), \
             patch.object(collector, 'queue_status_counts', side_effect=RuntimeError('synthetic queue failure')):
            with self.assertRaises(RuntimeError):
                collector.transmit_once(self.config)
        self.assert_connection_closed()


if __name__ == '__main__':
    unittest.main()
