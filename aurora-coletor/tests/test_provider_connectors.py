import sys
import csv
import io
import json
import zipfile
from xml.sax.saxutils import escape
from pathlib import Path
import unittest
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import provider_connectors as connectors
from test_cloud_sync import fixture


def table_values(payload):
    headers=sorted(connectors.FIELDS)
    values=['' if payload[key] is None else str(payload[key]).lower() if type(payload[key]) is bool else str(payload[key]) for key in headers]
    return [headers,values]


def table_csv(rows):
    stream=io.StringIO(newline='');csv.writer(stream).writerows(rows)
    return stream.getvalue().encode('utf-8-sig')


def table_xlsx(rows,formula=False,extra=None):
    xml=['<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for index,row in enumerate(rows,1):
        xml.append('<row r="'+str(index)+'">')
        for column,value in enumerate(row,1):
            reference=chr(64+column)+str(index)
            xml.append('<c r="'+reference+'" t="inlineStr">'+('<f>1+1</f>' if formula and index==2 and column==1 else '')+'<is><t>'+escape(value)+'</t></is></c>')
        xml.append('</row>')
    xml.append('</sheetData></worksheet>')
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('xl/worksheets/sheet1.xml',''.join(xml))
        for name,raw in (extra or {}).items():archive.writestr(name,raw)
    return stream.getvalue()

class ProviderTests(unittest.TestCase):
    def test_csv_xlsx_and_json_produce_identical_explicit_canonical_facts(self):
        payload=fixture();rows=table_values(payload)
        for name,raw in [('approved.csv',table_csv(rows)),('approved.xlsx',table_xlsx(rows)),('approved.json',json.dumps(payload).encode())]:
            with self.subTest(name=name):self.assertEqual(connectors.exports(raw,name),[connectors.validate_payload(payload)])
    def test_csv_refuses_guessed_headers_monetary_dates_booleans_and_extra_rows(self):
        baseline=table_values(fixture())
        for field,value in [('amountCents','123.45'),('nativeReady','yes'),('occurredAt','01/01/2026'),('sourceVersion','1.0')]:
            rows=[list(row) for row in baseline];rows[1][rows[0].index(field)]=value
            with self.subTest(field=field),self.assertRaises(connectors.SyncError):connectors.exports(table_csv(rows),'approved.csv')
        for rows in [[['patientName'],['synthetic-private']],baseline+[baseline[1]]*20,[baseline[0]+['instructions'],baseline[1]+['execute']]]:
            with self.assertRaises(connectors.SyncError):connectors.exports(table_csv(rows),'approved.csv')
    def test_xlsx_rejects_formula_multisheet_links_traversal_and_expansion_limits(self):
        rows=table_values(fixture())
        cases=[table_xlsx(rows,formula=True),table_xlsx(rows,extra={'xl/worksheets/sheet2.xml':'<worksheet/>'}),
               table_xlsx(rows,extra={'../outside':'synthetic'}),table_xlsx(rows,extra={'xl/externalLinks/link.xml':'<external/>'}),
               table_xlsx(rows,extra={'xl/vbaProject.bin':'synthetic'}),table_xlsx(rows,extra={'oversized.xml':'a'*(connectors.MAX_PROVIDER_BYTES+1)})]
        for raw in cases:
            with self.subTest(size=len(raw)),self.assertRaises(connectors.SyncError):connectors.exports(raw,'approved.xlsx')
    def test_unparsed_document_is_pending_not_a_canonical_json_export(self):
        for name in ('pending.pdf','pending.docx','pending.png'):
            with self.assertRaisesRegex(connectors.SyncError,'DOCUMENT_EXTRACTION_REQUIRED'):connectors.exports(b'synthetic',name)
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

    def test_drive_and_gmail_resume_the_same_scoped_cursor(self):
        from urllib.parse import urlsplit,parse_qs
        for provider,scope in [('GOOGLE_DRIVE',{'folderId':'approved-folder'}),('GMAIL',{'labelId':'approved-label'})]:
            transport=Mock(return_value={})
            result=connectors.pull({'provider':provider,'tokenEnv':'AURORA_GOOGLE_TOKEN',**scope},transport,{'AURORA_GOOGLE_TOKEN':'synthetic-token'},cursor='page+two/=')
            params=parse_qs(urlsplit(transport.call_args.args[0]).query)
            self.assertEqual(params['pageToken'],['page+two/='])
            self.assertFalse(result['coverageLimited']);self.assertIsNone(result['nextCursor'])

    def test_microsoft_next_link_cannot_escape_the_authorized_folder(self):
        source={'provider':'MICROSOFT_MAIL','tokenEnv':'AURORA_MICROSOFT_TOKEN','folderId':'approved-folder'}
        env={'AURORA_MICROSOFT_TOKEN':'synthetic-token'}
        for cursor in ['https://untrusted.invalid/messages','https://graph.microsoft.com/v1.0/me/mailFolders/other-folder/messages?$skip=20']:
            transport=Mock()
            with self.assertRaisesRegex(connectors.SyncError,'SCOPE_MISMATCH'):connectors.pull(source,transport,env,cursor=cursor)
            transport.assert_not_called()
        cursor='https://graph.microsoft.com/v1.0/me/mailFolders/approved-folder/messages?$skiptoken=synthetic'
        transport=Mock(return_value={'value':[]})
        connectors.pull(source,transport,env,cursor=cursor)
        self.assertEqual(transport.call_args.args[0],cursor)

    def test_repeated_cursor_cannot_claim_progress(self):
        transport=Mock(return_value={'files':[],'nextPageToken':'same'})
        with self.assertRaisesRegex(connectors.SyncError,'NOT_ADVANCING'):
            connectors.pull({'provider':'GOOGLE_DRIVE','folderId':'approved','tokenEnv':'AURORA_GOOGLE_TOKEN'},transport,{'AURORA_GOOGLE_TOKEN':'synthetic-token'},cursor='same')

    def test_imap_resume_is_uidvalidity_bound_and_readonly(self):
        from unittest.mock import MagicMock
        connection=MagicMock()
        connection.select.return_value=('OK',[])
        connection.response.return_value=('UIDVALIDITY',[b'123'])
        connection.uid.side_effect=lambda command,*args: ('OK',[b'1 2 3']) if command=='search' else ('OK',[b'1 (RFC822.SIZE 9999999)'])
        factory=Mock(return_value=connection)
        source={'provider':'IMAP','tokenEnv':'AURORA_MAIL_TOKEN','host':'imap.example.invalid','user':'synthetic-user','folder':'approved-folder'}
        env={'AURORA_MAIL_TOKEN':'synthetic-token'}
        result=connectors.pull(source,environment=env,imap_factory=factory,cursor={'uidValidity':'123','afterUid':2})
        connection.select.assert_called_once_with('approved-folder',readonly=True)
        fetches=[c.args for c in connection.uid.call_args_list if c.args[0]=='fetch']
        self.assertEqual(fetches,[('fetch',b'3','(RFC822.SIZE)')]);self.assertEqual(result['pendingExtraction'],1)
        with self.assertRaisesRegex(connectors.SyncError,'RECONCILIATION'):
            connectors.pull(source,environment=env,imap_factory=factory,cursor={'uidValidity':'old','afterUid':2})

if __name__=='__main__':unittest.main()
