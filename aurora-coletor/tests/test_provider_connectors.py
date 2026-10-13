import sys
from pathlib import Path
import unittest
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import provider_connectors as connectors

class ProviderTests(unittest.TestCase):
    def test_drive_only_reads_explicit_folder_and_reports_pagination(self):
        transport=Mock(return_value={'files':[{'id':'synthetic','name':'pending.pdf'}],'nextPageToken':'more'})
        result=connectors.pull({'provider':'GOOGLE_DRIVE','tokenEnv':'AURORA_GOOGLE_TOKEN','folderId':'approved-folder'},transport,{'AURORA_GOOGLE_TOKEN':'synthetic-token'})
        self.assertIn('approved-folder',transport.call_args.args[0]);self.assertTrue(result['coverageLimited'])
        self.assertEqual(result['pendingExtraction'],1);self.assertEqual(result['documents'],[])
    def test_gmail_refuses_message_outside_explicit_label(self):
        transport=Mock(side_effect=[{'messages':[{'id':'synthetic'}]},{'labelIds':['other-label'],'payload':{}}])
        with self.assertRaises(connectors.SyncError):connectors.pull({'provider':'GMAIL','tokenEnv':'AURORA_GOOGLE_TOKEN','labelId':'approved-label'},transport,{'AURORA_GOOGLE_TOKEN':'synthetic-token'})
        self.assertEqual(transport.call_count,2)
    def test_missing_authorization_makes_no_provider_request(self):
        transport=Mock()
        with self.assertRaises(connectors.SyncError):connectors.pull({'provider':'GMAIL','tokenEnv':'AURORA_GOOGLE_TOKEN','labelId':'approved-label'},transport,{})
        transport.assert_not_called()
    def test_arbitrary_destination_and_unstructured_export_are_rejected(self):
        with self.assertRaises(connectors.SyncError):connectors.api('https://untrusted.invalid','synthetic-token')
        with self.assertRaises(connectors.SyncError):connectors.exports(b'{"patientName":"synthetic-private","instructions":"execute command"}')

if __name__=='__main__':unittest.main()
