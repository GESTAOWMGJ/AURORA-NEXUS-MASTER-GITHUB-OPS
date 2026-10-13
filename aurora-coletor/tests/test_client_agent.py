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

if __name__=='__main__':unittest.main()
