"""Synthetic source -> canonical processing -> replay -> installation gate tests."""
import copy
import contextlib
import csv
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock,patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import aurora_cloud_sync as sync
import aurora_deployment as deployment
import client_agent as agent
import install_client_agent as installer
import provider_connectors as providers
from test_cloud_sync import fixture,processed_response,ORG

ORIGIN='https://auroranexus.com.br'
REQUIRED=('processingVerified','receiptPersisted','replayVerified','automationConfigured','automationVerified')


def accepted_response(payload,duplicate=False,configured=True,method='API_TOKEN'):
    result=processed_response(payload,duplicate=duplicate)
    proof=result['installation']
    ready=bool(duplicate and configured)
    proof['acceptance']={
        'schemaVersion':'aurora.installation.acceptance.v1','orgId':ORG,'canonicalOrigin':ORIGIN,
        'state':'INSTALLATION_INTEGRATION_VERIFIED' if ready else 'PENDING_AUTOMATION','eligible':ready,
        **{key:ready for key in REQUIRED},'automationScope':'AURORA_CANONICAL_PIPELINE',
        'method':method,'configurationHash':'a'*64,'receiptId':'b'*64,
        **{key:proof[key] for key in ('documentId','versionId','sourceVersion','canonicalSnapshotHash','verifiedAt')},
        'providerAccessVerified':False,'localCollectionVerified':False,'agentExecutionVerified':False,
        'processedFormat':'CANONICAL_STRUCTURED_JSON','globalDocumentAcquisitionVerified':False,
        'acquisitionModes':{'CLOUD_OAUTH':'PENDING_ADAPTER_EVIDENCE','LOCAL_AGENT':'PENDING_ADAPTER_EVIDENCE',
                            'API_TOKEN':'CANONICAL_PIPELINE_VERIFIED' if ready else 'PENDING_CONFIGURATION',
                            'MANUAL':'PENDING_CONFIGURATION'},
        'limitations':['PROVIDER_ACCESS_NOT_VERIFIED','LOCAL_COLLECTION_NOT_VERIFIED',
                       'AGENT_EXECUTION_NOT_VERIFIED','GLOBAL_EXTRACTION_NOT_VERIFIED']}
    return result


class CanonicalTransport:
    def __init__(self,configured=True,always_accepted=False):
        self.keys=set();self.posts=[];self.configured=configured;self.always_accepted=always_accepted
    def __call__(self,url,token,payload=None,key=None):
        if url.endswith('/ping'):return 200,{'ok':True,'orgId':ORG,'reportAccepted':True}
        duplicate=key in self.keys and not self.always_accepted
        self.keys.add(key);self.posts.append((payload,key))
        return (200 if duplicate else 202),accepted_response(payload,duplicate,self.configured)


def csv_bytes(payload):
    stream=io.StringIO(newline='');writer=csv.writer(stream)
    writer.writerow(sorted(sync.FIELDS))
    writer.writerow(['' if payload[key] is None else str(payload[key]).lower() if type(payload[key]) is bool
                     else str(payload[key]) for key in sorted(sync.FIELDS)])
    return stream.getvalue().encode('utf-8')


class InstallationIntegrationTests(unittest.TestCase):
    def test_authenticated_processing_and_duplicate_require_server_automation(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);state.chmod(0o700);transport=CanonicalTransport()
            result=deployment.integrate_installation(fixture(),ORIGIN,ORG,state,'SYNTHETIC-NOT-A-CREDENTIAL',transport=transport)
            self.assertTrue(result['eligible']);self.assertFalse(result['installationComplete'])
            self.assertFalse(result['globalIngestionVerified']);self.assertFalse(result['sourceAcquisitionCertified'])
            self.assertEqual(len(transport.posts),2);self.assertEqual(transport.posts[0],transport.posts[1])
            checkpoint=(state/deployment.STATE_NAME).read_text()
            for private in (ORG,ORIGIN,'SYNTHETIC-NOT-A-CREDENTIAL','amountCents','externalDocumentId'):
                self.assertNotIn(private,checkpoint)
    def test_processing_or_operational_complete_alone_cannot_install(self):
        for transport,code in [(CanonicalTransport(configured=False),'AUTHORITATIVE_AUTOMATION'),
                               (CanonicalTransport(always_accepted=True),'CURRENT_PROCESSING_REPLAY')]:
            with self.subTest(code=code),tempfile.TemporaryDirectory() as tmp:
                state=Path(tmp);state.chmod(0o700)
                with self.assertRaisesRegex(sync.SyncError,code):
                    deployment.integrate_installation(fixture(),ORIGIN,ORG,state,'synthetic',transport=transport)
    def test_method_hint_cannot_certify_oauth_local_or_manual(self):
        for method in ('CLOUD_OAUTH','LOCAL_AGENT'):
            transport=Mock()
            with self.assertRaisesRegex(sync.SyncError,'REAL_SOURCE_ADAPTER_REQUIRED'):
                deployment.integrate_installation(fixture(),ORIGIN,ORG,Path('/unused'),'synthetic',method,transport)
            transport.assert_not_called()
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);state.chmod(0o700)
            with self.assertRaisesRegex(sync.SyncError,'AUTHORITATIVE_AUTOMATION'):
                deployment.integrate_installation(fixture(),ORIGIN,ORG,state,'synthetic','MANUAL',CanonicalTransport())
    def test_installation_proof_cannot_be_issued_by_an_alternate_https_origin(self):
        transport=Mock()
        with self.assertRaisesRegex(sync.SyncError,'CANONICAL_INSTALLATION_ORIGIN_REQUIRED'):
            deployment.integrate_installation(fixture(),'https://other.example.invalid',ORG,Path('/unused'),
                                             'synthetic',transport=transport)
        transport.assert_not_called()
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);root=base/'source';root.mkdir()
            config={'schemaVersion':agent.SCHEMA,'instanceId':'c'*32,'org':ORG,
                'origin':'https://other.example.invalid','stateDir':str(base/'state'),'roots':[str(root)],
                'providers':[],'tokenEnv':'AURORA_APP_TOKEN','authorization':{'approved':True,
                'actorRef':'synthetic-admin','documentRef':'synthetic-consent','expiresAt':'2099-01-01T00:00:00Z'}}
            with self.assertRaisesRegex(sync.SyncError,'CANONICAL_INSTALLATION_ORIGIN_REQUIRED'):
                agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic'},transport,verify_installation=True)
            self.assertFalse((base/'state').exists());transport.assert_not_called()
    def test_cached_proof_is_reauthenticated_and_unknown_checkpoint_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);state.chmod(0o700)
            deployment.integrate_installation(fixture(),ORIGIN,ORG,state,'synthetic',transport=CanonicalTransport())
            deny=Mock(return_value=(401,{'ok':False}))
            with self.assertRaisesRegex(sync.SyncError,'AUTHENTICATED_PROCESSING_REQUIRED'):
                deployment.integrate_installation(fixture(),ORIGIN,ORG,state,'synthetic',transport=deny)
            self.assertEqual(deny.call_count,1)
            path=state/deployment.STATE_NAME;previous=json.loads(path.read_text());previous['unknownPreservedSetting']=True
            path.write_text(json.dumps(previous));before=path.read_bytes();network=Mock()
            with self.assertRaisesRegex(sync.SyncError,'CHECKPOINT_SCHEMA_CONFLICT'):
                deployment.run(fixture(),ORIGIN,ORG,state,'synthetic',send=True,transport=network)
            network.assert_not_called();self.assertEqual(path.read_bytes(),before)
    def test_acceptance_is_closed_strict_and_bound_to_current_processing(self):
        response=accepted_response(fixture(),True);proof=response['installation']
        baseline=proof['acceptance']
        mutations=[{'eligible':'true'},{'automationVerified':'true'},{'documentId':'c'*48},
                   {'sourceVersion':2},{'canonicalSnapshotHash':'c'*64},{'orgId':'other-org'},
                   {'providerAccessVerified':True},{'rawDocument':'must-not-persist'},
                   {'method':'CLOUD_OAUTH'},{'verifiedAt':'not-a-time'}]
        for change in mutations:
            with self.subTest(change=change):
                value={**copy.deepcopy(baseline),**change}
                with self.assertRaisesRegex(sync.SyncError,'ACCEPTANCE_MISMATCH'):
                    sync.installation_acceptance(fixture(),ORG,value,sync.processing_proof(fixture(),ORG,proof))


class SourceContinuationTests(unittest.TestCase):
    def test_pending_continuation_does_not_return_installed_exit_status(self):
        with patch.object(sys,'argv',['install_client_agent.py','--target','unused','--continue-integration']), \
             patch.object(installer,'continue_installation',return_value={'state':'PENDING_INTEGRATION','installationComplete':False}), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(installer.main(),2)
    def config(self,base,cloud=False):
        root=base/'exports';root.mkdir()
        return {'schemaVersion':agent.SCHEMA,'instanceId':'c'*32,'org':ORG,'origin':ORIGIN,
                'stateDir':str(base/'unused-state'),'roots':[] if cloud else [str(root)],
                'providers':[{'provider':'GOOGLE_DRIVE','folderId':'approved-folder','tokenEnv':'AURORA_GOOGLE_TOKEN'}] if cloud else [],
                'tokenEnv':'AURORA_APP_TOKEN','authorization':{'approved':True,'actorRef':'synthetic-admin',
                    'documentRef':'synthetic-consent','expiresAt':'2099-01-01T00:00:00Z'}}
    def source(self,base):
        path=base/'exports'/'approved.csv';path.write_bytes(csv_bytes(fixture()));os.utime(path,(1,1))
    def test_preparation_never_creates_startup_or_installed_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);config=self.config(base);target=base/'agent'
            with patch.object(installer.sys,'platform','darwin'),patch.object(installer.subprocess,'Popen') as process,patch.object(installer,'startup_payload') as startup:
                prepared=installer.install(target,config,startup=True)
            process.assert_not_called();self.assertEqual(prepared['state'],'PREPARED')
            startup.assert_not_called();self.assertTrue(prepared['startupRequested'])
            self.assertFalse(prepared['installationComplete']);self.assertFalse(prepared['startupInstalled'])
    def test_resume_uses_same_identity_queue_and_actual_local_csv_adapter(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);config=self.config(base);self.source(base);target=base/'agent'
            installer.install(target,config);cfg_before=(target/'agent-config.json').read_bytes()
            transport=CanonicalTransport()
            result=installer.continue_installation(target,{'AURORA_APP_TOKEN':'synthetic'},transport)
            self.assertEqual(result['state'],'INSTALLED');self.assertTrue(result['installationComplete'])
            self.assertEqual((target/'agent-config.json').read_bytes(),cfg_before)
            self.assertEqual(result['instanceId'],'c'*32);self.assertEqual(len(transport.posts),2)
            readiness=result['integrationReadiness']
            self.assertEqual(readiness['sourceModesVerifiedThisRun'],['LOCAL_AGENT'])
            self.assertEqual(readiness['proofScope'],'DIRECT_ADAPTER_EXECUTION_THIS_RUN')
            self.assertFalse(result['globalIngestionVerified']);self.assertFalse(result['agentExecutionVerified'])
            # An explicit revalidation reuses the queue, but cached receipts do not replace two fresh sends.
            installer.verify_existing_integration(target,{'AURORA_APP_TOKEN':'synthetic'},transport)
            self.assertEqual(len(transport.posts),4);self.assertEqual(len(transport.keys),1)
            with self.assertRaisesRegex(sync.SyncError,'RECONCILIATION'):
                installer.continue_installation(target,{'AURORA_APP_TOKEN':'synthetic'},transport)
    def test_real_scoped_provider_adapter_is_separate_from_server_pipeline_proof(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);config=self.config(base,cloud=True);target=base/'agent'
            installer.install(target,config)
            provider_api=Mock(side_effect=[{'files':[{'id':'synthetic-file','name':'canonical.csv'}]},csv_bytes(fixture())])
            def source_pull(source,environment,cursor):
                return providers.pull(source,provider_api,environment,cursor=cursor)
            result=installer.continue_installation(target,{'AURORA_APP_TOKEN':'synthetic','AURORA_GOOGLE_TOKEN':'synthetic-oauth'},CanonicalTransport(),source_pull)
            self.assertTrue(result['installationComplete']);self.assertEqual(provider_api.call_count,2)
            readiness=result['integrationReadiness']
            self.assertEqual(readiness['sourceModesVerifiedThisRun'],['CLOUD_OAUTH'])
            self.assertFalse(readiness['oauthEnrollmentOrRefreshPerformed'])
            self.assertFalse(readiness['canonicalPipelineAcceptance']['providerAccessVerified'])
            self.assertEqual(readiness['canonicalPipelineAcceptance']['acquisitionModes']['CLOUD_OAUTH'],'PENDING_ADAPTER_EVIDENCE')
    def test_ping_empty_sources_pending_documents_and_failed_automation_do_not_promote(self):
        for scenario in ('empty','unparsed','automation'):
            with self.subTest(scenario=scenario),tempfile.TemporaryDirectory() as tmp:
                base=Path(tmp);config=self.config(base);target=base/'agent'
                if scenario!='empty':self.source(base)
                if scenario=='unparsed':
                    path=base/'exports'/'pending.pdf';path.write_bytes(b'synthetic-unparsed');os.utime(path,(1,1))
                installer.install(target,config)
                saved=json.loads((target/'installation.json').read_text());saved['startRequested']=True
                (target/'installation.json').write_text(json.dumps(saved))
                with patch.object(installer.subprocess,'Popen') as process:
                    result=installer.continue_installation(target,{'AURORA_APP_TOKEN':'synthetic'},CanonicalTransport(configured=scenario!='automation'))
                process.assert_not_called();self.assertFalse(result['installationComplete'])
                self.assertEqual(result['state'],'PENDING_INTEGRATION');self.assertFalse(result['startupInstalled'])
    def test_watch_is_started_once_only_after_current_source_acceptance(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);config=self.config(base);self.source(base);target=base/'agent';installer.install(target,config)
            saved=json.loads((target/'installation.json').read_text());saved['startRequested']=True
            (target/'installation.json').write_text(json.dumps(saved))
            with patch.object(installer.subprocess,'Popen',return_value=Mock(pid=12345)) as process:
                result=installer.continue_installation(target,{'AURORA_APP_TOKEN':'SYNTHETIC-NOT-A-CREDENTIAL'},CanonicalTransport())
                with self.assertRaises(sync.SyncError):installer.continue_installation(target,{},Mock())
            process.assert_called_once();self.assertIn('--watch',process.call_args.args[0])
            self.assertNotIn('SYNTHETIC-NOT-A-CREDENTIAL',str(process.call_args))
            self.assertTrue(result['processStarted']);self.assertFalse(result['agentExecutionVerified'])
    def test_modified_staging_requires_reconciliation_without_source_or_transport_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);config=self.config(base);target=base/'agent';installer.install(target,config)
            (target/'bin'/'client_agent.py').write_bytes(b'modified');transport=Mock();provider=Mock()
            with self.assertRaisesRegex(sync.SyncError,'PACKAGE_CHANGED'):
                installer.continue_installation(target,{},transport,provider)
            transport.assert_not_called();provider.assert_not_called()


if __name__=='__main__':unittest.main()
