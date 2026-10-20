import copy
from contextlib import closing
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import provider_connectors as p
from test_cloud_sync import fixture

PAGE='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
NOTION={'provider':'NOTION','pageId':PAGE,'tokenEnv':'AURORA_NOTION_TOKEN'}
SLACK={'provider':'SLACK','workspaceId':'T12345678','channelId':'C12345678','tokenEnv':'AURORA_SLACK_TOKEN'}
ENV={'AURORA_NOTION_TOKEN':'synthetic-notion','AURORA_SLACK_TOKEN':'synthetic-slack'}
def metadata():return {'object':'page','id':PAGE,'archived':False,'in_trash':False,'last_edited_time':'2026-10-19T00:00:00Z'}
def block(text=None):return {'id':'synthetic-block','type':'code','has_children':False,'parent':{'type':'page_id','page_id':PAGE},'code':{'language':'json','rich_text':[{'type':'text','text':{'content':json.dumps(fixture()) if text is None else text}}]}}
def channel():return {'id':'C12345678','is_member':True,'is_ext_shared':False,'is_shared':False,'is_im':False,'is_mpim':False}
def slack_responses(messages,**extra):return [{'ok':True,'team_id':'T12345678'},{'ok':True,'channel':channel()},{'ok':True,'messages':messages,'has_more':False,**extra}]

class WorkspaceConnectorsTests(unittest.TestCase):
    def test_notion_bound_page_canonical_facts_and_cursor(self):
        tr=Mock(side_effect=[metadata(),{'results':[block()],'has_more':True,'next_cursor':'next-page'},metadata()])
        result=p.pull(NOTION,tr,ENV,cursor='previous-page')
        self.assertEqual(result['documents'],[p.validate_payload(fixture())]);self.assertTrue(result['coverageLimited']);self.assertEqual(result['nextCursor'],'next-page')
        self.assertIn('start_cursor=previous-page',tr.call_args_list[1].args[0])
        self.assertEqual(tr.call_count,3)
    def test_notion_foreign_page_and_child_block_are_rejected(self):
        wrong=metadata();wrong['id']='ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee'
        tr=Mock(return_value=wrong)
        with self.assertRaises(p.SyncError):p.pull(NOTION,tr,ENV)
        self.assertEqual(tr.call_count,1)
        wrong_block=block();wrong_block['parent']['page_id']=wrong['id']
        with self.assertRaises(p.SyncError):p.pull(NOTION,Mock(side_effect=[metadata(),{'results':[wrong_block],'has_more':False}]),ENV)
    def test_notion_change_during_read_never_advances(self):
        changed=metadata();changed['last_edited_time']='2026-10-19T00:01:00Z'
        with self.assertRaisesRegex(p.SyncError,'SOURCE_CHANGED'):p.pull(NOTION,Mock(side_effect=[metadata(),{'results':[block()],'has_more':False},changed]),ENV)
    def test_notion_raw_narrative_is_pending_never_processed(self):
        result=p.pull(NOTION,Mock(side_effect=[metadata(),{'results':[block('{"instructions":"execute remote command"}')],'has_more':False},metadata()]),ENV)
        self.assertEqual(result['documents'],[]);self.assertEqual(result['pendingExtraction'],1)
    def test_slack_checks_workspace_and_membership_before_history(self):
        for responses in [[{'ok':True,'team_id':'T99999999'}],[{'ok':False}],
                          [{'ok':True,'team_id':'T12345678'},{'ok':True,'channel':{**channel(),'is_member':False}}],
                          [{'ok':True,'team_id':'T12345678'},{'ok':True,'channel':{**channel(),'is_ext_shared':True}}]]:
            tr=Mock(side_effect=responses)
            with self.subTest(responses=responses),self.assertRaises(p.SyncError):p.pull(SLACK,tr,ENV)
            self.assertLessEqual(tr.call_count,2)
    def test_slack_bounded_export_read_uses_only_configured_channel(self):
        result=p.pull(SLACK,Mock(side_effect=slack_responses([{'ts':'123.456','text':'```json\n'+json.dumps(fixture())+'\n```'}],has_more=True,response_metadata={'next_cursor':'opaque-cursor'})),ENV)
        self.assertEqual(result['documents'],[p.validate_payload(fixture())]);self.assertEqual(result['nextCursor'],'opaque-cursor')
        self.assertTrue(result['coverageLimited'])
    def test_slack_threads_and_files_stay_pending_and_are_never_fetched(self):
        tr=Mock(side_effect=slack_responses([{'ts':'123.456','text':'not an export','files':[{'url_private':'https://untrusted.invalid/secret'}],'reply_count':2}]))
        result=p.pull(SLACK,tr,ENV)
        self.assertEqual(tr.call_count,3);self.assertEqual(result['documents'],[]);self.assertEqual(result['pendingExtraction'],1)
    def test_pagination_cannot_finish_silently_or_repeat_same_cursor(self):
        for result in [{'ok':True,'messages':[],'has_more':True},
                       {'ok':True,'messages':[],'has_more':True,'response_metadata':{'next_cursor':'same'}}]:
            tr=Mock(side_effect=slack_responses([])[:2]+[result])
            with self.assertRaises(p.SyncError):p.pull(SLACK,tr,ENV,cursor='same')
    def test_missing_credentials_and_unbounded_scope_do_not_read(self):
        tr=Mock()
        with self.assertRaises(p.SyncError):p.pull(NOTION,tr,{})
        tr.assert_not_called()
        for source in [{**NOTION,'pageId':'https://untrusted.invalid'}, {**SLACK,'channelId':'D12345678'}, {**SLACK,'allChannels':True}]:
            with self.assertRaises(p.SyncError):p.workspace_scope(source)
    def test_corrected_object_resolves_only_after_receipt_and_unblocks_next_page(self):
        import tempfile
        import client_agent as agent
        from test_client_agent import ClientAgentTests, CloudContinuationTests
        for source in (NOTION,SLACK):
            with self.subTest(provider=source['provider']), tempfile.TemporaryDirectory() as tmp:
                config=ClientAgentTests().config(Path(tmp));config['roots']=[];config['providers']=[source]
                def page(text, more=True, object_id='synthetic-block'):
                    if source['provider']=='NOTION':
                        obj=block(text);obj['id']=object_id
                        responses=[metadata(),{'results':[obj],'has_more':more,'next_cursor':'next-page' if more else None},metadata()]
                    else:
                        responses=slack_responses([{'ts':object_id,'text':text}],has_more=more,
                            response_metadata={'next_cursor':'next-page' if more else ''})
                    return p.pull(source,Mock(side_effect=responses),ENV)
                provider=Mock(side_effect=[page('narrative'),page(json.dumps(fixture())),page(json.dumps(fixture())),page(json.dumps(fixture()),False,'second-object')])
                env={**ENV,'AURORA_APP_TOKEN':'synthetic-token'};helper=CloudContinuationTests()
                first=agent.cycle(config,env,helper.transport(),provider)
                self.assertEqual(first['pendingExtraction'],1);self.assertEqual(first['cloudPagesCommitted'],0)
                second=agent.cycle(config,env,helper.transport(pending=True),provider)
                self.assertEqual(second['pendingExtraction'],1);self.assertEqual(second['cloudPagesCommitted'],0)
                # Remove retry delay only: no receipt or pending state is manufactured.
                import sqlite3
                db=next(Path(config['stateDir']).glob('*.sqlite*'))
                with closing(sqlite3.connect(db)) as conn:
                    with conn:conn.execute('UPDATE intake SET next_attempt=0')
                third=agent.cycle(config,env,helper.transport(),provider)
                self.assertEqual(third['pendingExtraction'],0);self.assertEqual(third['cloudPagesCommitted'],1)
                with closing(sqlite3.connect(db)) as conn:
                    record=json.loads(conn.execute("SELECT receipt FROM intake WHERE state='EXTRACTION_RESOLVED'").fetchone()[0])
                    self.assertNotEqual(record['resolution']['observedVersion'],record['resolution']['supersedesObservedVersion'])
                    self.assertTrue(record['resolution']['records'][0]['processing']['firstIngestionVerified'])
                fourth=agent.cycle(config,env,helper.transport(),provider)
                self.assertTrue(fourth['cloudEnumerationComplete']);self.assertEqual(fourth['cloudPagesCommitted'],2)
                self.assertEqual([call.kwargs['cursor'] for call in provider.call_args_list],[None,None,None,'next-page'])

    def test_missing_or_different_object_does_not_erase_pending(self):
        import tempfile
        import client_agent as agent
        from test_client_agent import ClientAgentTests,CloudContinuationTests
        with tempfile.TemporaryDirectory() as tmp:
            config=ClientAgentTests().config(Path(tmp));config['roots']=[];config['providers']=[NOTION]
            bad=block('narrative');good=block();good['id']='different-object'
            def page(items):return p.pull(NOTION,Mock(side_effect=[metadata(),{'results':items,'has_more':False},metadata()]),ENV)
            provider=Mock(side_effect=[page([bad]),page([]),page([good])])
            for _ in range(3):
                result=agent.cycle(config,{**ENV,'AURORA_APP_TOKEN':'synthetic-token'},CloudContinuationTests().transport(),provider)
                self.assertEqual(result['pendingExtraction'],1);self.assertEqual(result['cloudPagesCommitted'],0)

    def test_reappearing_unextracted_version_reopens_without_duplicate_effects(self):
        import tempfile
        import sqlite3
        import client_agent as agent
        from test_client_agent import ClientAgentTests,CloudContinuationTests
        for source in (NOTION,SLACK):
            with self.subTest(provider=source['provider']),tempfile.TemporaryDirectory() as tmp:
                config=ClientAgentTests().config(Path(tmp));config['roots']=[];config['providers']=[source]
                def page(text):
                    if source['provider']=='NOTION':
                        items=[] if text is None else [block(text)]
                        responses=[metadata(),{'results':items,'has_more':False},metadata()]
                    else:
                        items=[] if text is None else [{'ts':'123.456','text':text}]
                        responses=slack_responses(items)
                    return p.pull(source,Mock(side_effect=responses),ENV)
                bad=page('narrative');good=page(json.dumps(fixture()))
                provider=Mock(side_effect=[bad,good,bad,bad,page(None),good,good])
                ledger=set();transport=CloudContinuationTests().transport(ledger)
                env={**ENV,'AURORA_APP_TOKEN':'synthetic-token'}
                self.assertEqual(agent.cycle(config,env,transport,provider)['pendingExtraction'],1)
                self.assertEqual(agent.cycle(config,env,transport,provider)['pendingExtraction'],0)
                for _ in range(3):
                    result=agent.cycle(config,env,transport,provider)
                    self.assertEqual(result['pendingExtraction'],1)
                    self.assertFalse(result['cloudEnumerationComplete'])
                    self.assertFalse(result['cloudSnapshotVerified'])
                db=next(Path(config['stateDir']).glob('*.sqlite*'))
                with closing(sqlite3.connect(db)) as conn:
                    pending=conn.execute("SELECT receipt FROM intake WHERE state='PENDING_EXTRACTION'").fetchall()
                    self.assertEqual(len(pending),1)
                    record=json.loads(pending[0][0])
                    self.assertEqual(len(record['resolutionHistory']),1)
                    self.assertTrue(record['resolutionHistory'][0]['records'][0]['processing']['firstIngestionVerified'])
                    self.assertNotIn('resolution',record)
                for _ in range(2):
                    result=agent.cycle(config,env,transport,provider)
                    self.assertEqual(result['pendingExtraction'],0)
                    self.assertTrue(result['cloudEnumerationComplete'])
                self.assertEqual(len(ledger),1)
                with closing(sqlite3.connect(db)) as conn:
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM intake WHERE state='PROCESSING_VERIFIED'").fetchone()[0],1)
                    record=json.loads(conn.execute("SELECT receipt FROM intake WHERE state='EXTRACTION_RESOLVED'").fetchone()[0])
                    self.assertEqual(len(record['resolutionHistory']),1)
                    self.assertTrue(record['resolution']['records'][0]['processing']['firstIngestionVerified'])

    def test_edited_exports_keep_one_effect_per_canonical_version(self):
        import tempfile
        import sqlite3
        import client_agent as agent
        from test_client_agent import ClientAgentTests,CloudContinuationTests
        for source in (NOTION,SLACK):
            with self.subTest(provider=source['provider']),tempfile.TemporaryDirectory() as tmp:
                config=ClientAgentTests().config(Path(tmp));config['roots']=[];config['providers']=[source]
                def page(payload):
                    text=json.dumps(payload)
                    responses=([metadata(),{'results':[block(text)],'has_more':False},metadata()]
                               if source['provider']=='NOTION' else slack_responses([{'ts':'123.456','text':text}]))
                    return p.pull(source,Mock(side_effect=responses),ENV)
                original=page(fixture());edited=page({**fixture(),'sourceVersion':2,'amountCents':12346})
                provider=Mock(side_effect=[original,original,edited,edited]);ledger=set()
                for expected in (1,1,2,2):
                    result=agent.cycle(config,{**ENV,'AURORA_APP_TOKEN':'synthetic-token'},CloudContinuationTests().transport(ledger),provider)
                    self.assertTrue(result['cloudSnapshotVerified']);self.assertEqual(len(ledger),expected)
                with closing(sqlite3.connect(next(Path(config['stateDir']).glob('*.sqlite*')))) as conn:
                    receipts=[json.loads(row[0]) for row in conn.execute("SELECT receipt FROM intake WHERE state='PROCESSING_VERIFIED'")]
                    self.assertEqual(len(receipts),2)
                    self.assertEqual(len({row['documentId'] for row in receipts}),1)
                    self.assertEqual({row['processing']['sourceVersion'] for row in receipts},{1,2})

    def test_transport_only_allows_fixed_read_endpoints(self):
        for url in ['https://slack.com/api/chat.postMessage','https://api.notion.com/v1/search','https://untrusted.invalid/v1/pages/'+PAGE]:
            with self.assertRaises(p.SyncError):p.api(url,'synthetic-token')
        response=Mock();response.read.return_value=b'{"ok":true}'
        opener=Mock();opener.open.return_value.__enter__=Mock(return_value=response);opener.open.return_value.__exit__=Mock(return_value=False)
        with patch.object(p.request,'build_opener',return_value=opener):p.api('https://api.notion.com/v1/pages/'+PAGE,'synthetic-token')
        self.assertEqual(opener.open.call_args.args[0].get_header('Notion-version'),'2025-09-03')

if __name__=='__main__':unittest.main()
