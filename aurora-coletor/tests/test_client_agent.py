import sys
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import client_agent as agent
import install_client_agent as installer

class ClientAgentTests(unittest.TestCase):
    def config(self,base):
        root=base/'exports';root.mkdir()
        return dict(schemaVersion=agent.SCHEMA,instanceId='a'*32,org='synthetic-org',origin='https://auroranexus.com.br',stateDir=str(base/'state'),roots=[str(root)],providers=[],tokenEnv='AURORA_APP_TOKEN',authorization=dict(approved=True,actorRef='synthetic-admin',documentRef='synthetic-consent',expiresAt='2099-01-01T00:00:00Z'))
    def test_wrong_tenant_blocks_before_reading_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));transport=Mock(return_value=(200,{'ok':True,'orgId':'other-org'}))
            with self.assertRaises(agent.sync.SyncError):agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},transport)
            self.assertEqual(transport.call_count,1)
            self.assertFalse(Path(config['stateDir']).exists())
    def test_empty_source_reports_communication_without_claiming_ingestion(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));transport=Mock(side_effect=[(200,{'ok':True,'orgId':'synthetic-org'}),(200,{'ok':True,'orgId':'synthetic-org','reportAccepted':True})])
            result=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},transport)
            self.assertTrue(result['agentReportConfirmed']);self.assertEqual(result['receiptsConfirmed'],0)
            self.assertFalse(result['fullSynchronizationVerified'])
            report=transport.call_args.args[2];self.assertEqual(report['instanceId'],'a'*32)
            self.assertNotIn('roots',report)
    def test_install_preserves_existing_target_and_proves_only_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);config=self.config(base);target=base/'agent'
            receipt=installer.install(target,config)
            self.assertFalse(receipt['connectionVerified']);self.assertFalse(receipt['firstIngestionVerified'])
            original=(target/'agent-config.json').read_bytes()
            with self.assertRaises(agent.sync.SyncError):installer.install(target,config)
            self.assertEqual((target/'agent-config.json').read_bytes(),original)
            installer.disable(target)
            with self.assertRaises(agent.sync.SyncError):agent.cycle(json.loads((target/'agent-config.json').read_text()),{'AURORA_APP_TOKEN':'synthetic-token'},Mock())

class CloudContinuationTests(unittest.TestCase):
    config=ClientAgentTests.config
    def cloud_config(self, base):
        config=self.config(base)
        config['roots']=[]
        config['providers']=[{'provider':'GOOGLE_DRIVE','folderId':'approved-folder','tokenEnv':'AURORA_GOOGLE_TOKEN'}]
        return config

    def transport(self, ledger=None, pending=False):
        from test_cloud_sync import processed_response
        def call(url,token,payload=None,key=None):
            if url.endswith('/ping'):return 200,{'ok':True,'orgId':'synthetic-org','reportAccepted':True}
            if ledger is not None:
                duplicate=key in ledger
                ledger.add(key)
            else:duplicate=False
            response=processed_response(payload,duplicate=duplicate)
            if pending:response['installation']={'state':'PENDING_PROJECTION','firstIngestionVerified':False}
            return (200 if duplicate else 202),response
        return call

    def page(self, name='synthetic-page-one', next_cursor=None, pending=0):
        from test_cloud_sync import fixture
        return {'documents':[{**fixture(),'externalDocumentId':name}],'pendingExtraction':pending,
                'coverageLimited':next_cursor is not None,'nextCursor':next_cursor}

    def test_pages_resume_across_cycles_and_complete_only_with_processed_receipts(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.cloud_config(Path(tmp));ledger=set()
            provider=Mock(side_effect=[self.page(next_cursor='page-two'),self.page('synthetic-page-two')])
            first=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token','AURORA_GOOGLE_TOKEN':'synthetic-token'},self.transport(ledger),provider)
            self.assertFalse(first['cloudEnumerationComplete']);self.assertEqual(first['cloudPagesCommitted'],1)
            second=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token','AURORA_GOOGLE_TOKEN':'synthetic-token'},self.transport(ledger),provider)
            self.assertTrue(second['cloudEnumerationComplete']);self.assertTrue(second['cloudSnapshotVerified'])
            self.assertEqual(second['cloudPagesCommitted'],2);self.assertEqual(len(ledger),2)
            self.assertEqual([c.kwargs['cursor'] for c in provider.call_args_list],[None,'page-two'])
            self.assertFalse(second['fullSynchronizationVerified'])

    def test_pending_processing_keeps_page_cursor_and_replays_idempotently(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.cloud_config(Path(tmp));ledger=set();provider=Mock(return_value=self.page(next_cursor='page-two'))
            first=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},self.transport(ledger,pending=True),provider)
            self.assertEqual(first['cloudPagesCommitted'],0);self.assertFalse(first['cloudSnapshotVerified'])
            second=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},self.transport(ledger),provider)
            self.assertEqual(second['cloudPagesCommitted'],1);self.assertEqual(len(ledger),1)
            self.assertEqual([c.kwargs['cursor'] for c in provider.call_args_list],[None,None])

    def test_legacy_pending_count_holds_cursor_and_survives_source_disappearance(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.cloud_config(Path(tmp));provider=Mock(side_effect=[self.page(next_cursor='page-two',pending=2),self.page('synthetic-two')])
            agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},self.transport(),provider)
            result=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},self.transport(),provider)
            self.assertFalse(result['cloudEnumerationComplete']);self.assertEqual(result['pendingExtraction'],2)
            self.assertEqual(result['cloudPagesCommitted'],0)
            self.assertEqual([call.kwargs['cursor'] for call in provider.call_args_list],[None,None])
            self.assertFalse(result['cloudSnapshotVerified'])

    def test_changed_inflight_page_or_tenant_does_not_silently_advance(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.cloud_config(Path(tmp));provider=Mock(side_effect=[self.page(next_cursor='two'),self.page('changed-document',next_cursor='two')])
            agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},self.transport(pending=True),provider)
            result=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},self.transport(),provider)
            self.assertEqual(result['cloudPagesCommitted'],0);self.assertFalse(result['cloudEnumerationComplete'])
            self.assertEqual(result['providers'][0]['state'],'CONNECTION_PENDING')
            changed={**config,'org':'different-org'}
            with self.assertRaisesRegex(agent.sync.SyncError,'BINDING_CHANGED'):
                agent.cycle(changed,{'AURORA_APP_TOKEN':'synthetic-token'},lambda *args:(200,{'ok':True,'orgId':'different-org'}),Mock())

    def test_completed_scope_is_rescanned_without_duplicate_remote_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.cloud_config(Path(tmp));provider=Mock(return_value=self.page());ledger=set()
            for _ in range(2):
                result=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},self.transport(ledger),provider)
                self.assertTrue(result['cloudSnapshotVerified'])
            self.assertEqual(len(ledger),1);self.assertEqual(provider.call_count,2)

    def test_actual_process_crash_before_and_after_remote_commit_reuses_same_key(self):
        import subprocess,os
        driver=r'''
import json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1]);sys.path.insert(0,sys.argv[2])
import client_agent as agent
from test_cloud_sync import fixture,processed_response
config=json.loads(Path(sys.argv[3]).read_text()); ledger_file=Path(sys.argv[4]); stage=sys.argv[5]
def provider(*args,**kwargs):
    if stage=='before':os._exit(45)
    return {'documents':[fixture()],'pendingExtraction':0,'coverageLimited':False,'nextCursor':None}
def transport(url,token,payload=None,key=None):
    if url.endswith('/ping'):return 200,{'ok':True,'orgId':'synthetic-org','reportAccepted':True}
    ledger=json.loads(ledger_file.read_text()) if ledger_file.exists() else []
    duplicate=key in ledger
    if not duplicate:ledger.append(key)
    ledger_file.write_text(json.dumps(ledger))
    if stage=='after':os._exit(46)
    return (200 if duplicate else 202),processed_response(payload,duplicate)
with agent.lock(Path(config['stateDir'])):
    result=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic-token'},transport,provider)
print(json.dumps(result))
'''
        for stage in ('before','after'):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as tmp:
                base=Path(tmp);config=self.cloud_config(base);cfg=base/'config.json';cfg.write_text(json.dumps(config));ledger=base/'remote-ledger.json'
                args=[sys.executable,'-c',driver,str(Path(agent.__file__).parent),str(Path(__file__).parent),str(cfg),str(ledger)]
                first=subprocess.run(args+[stage],capture_output=True,text=True,timeout=15)
                self.assertEqual(first.returncode,45 if stage=='before' else 46,first.stderr)
                resumed=subprocess.run(args+['resume'],capture_output=True,text=True,timeout=15)
                self.assertEqual(resumed.returncode,0,resumed.stderr)
                result=json.loads(resumed.stdout);self.assertTrue(result['cloudSnapshotVerified'])
                self.assertEqual(len(json.loads(ledger.read_text())),1)
                repeated=subprocess.run(args+['resume'],capture_output=True,text=True,timeout=15)
                self.assertEqual(repeated.returncode,0,repeated.stderr)
                self.assertEqual(len(json.loads(ledger.read_text())),1)


if __name__=='__main__':unittest.main()
