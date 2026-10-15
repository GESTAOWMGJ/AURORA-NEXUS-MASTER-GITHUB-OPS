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
from unittest.mock import Mock,call,patch

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
                            'API_TOKEN':'CANONICAL_PIPELINE_VERIFIED' if ready and method=='API_TOKEN' else 'PENDING_CONFIGURATION',
                            'MANUAL':'CANONICAL_PIPELINE_VERIFIED' if ready and method=='MANUAL' else 'PENDING_CONFIGURATION'},
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
    def test_method_hint_cannot_certify_oauth_or_local(self):
        for method in ('CLOUD_OAUTH','LOCAL_AGENT'):
            transport=Mock()
            with self.assertRaisesRegex(sync.SyncError,'REAL_SOURCE_ADAPTER_REQUIRED'):
                deployment.integrate_installation(fixture(),ORIGIN,ORG,Path('/unused'),'synthetic',method,transport)
            transport.assert_not_called()
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


def manual_readback(payload=None, revision=1):
    payload=fixture() if payload is None else payload
    result=accepted_response(payload,True,method='MANUAL')
    proof=processed_response(payload,True,revision=revision)['installation']
    acceptance=result['installation']['acceptance']
    acceptance.update({key:proof[key] for key in
        ('documentId','versionId','sourceVersion','canonicalSnapshotHash','verifiedAt')})
    return {'ok':True,'service':'aurora-nexus-integration','orgId':ORG,'keyId':'ik_'+'c'*16,
            'installation':{**proof,'acceptance':acceptance}}


class ManualInstallationReadbackTests(unittest.TestCase):
    def verify(self,transport,state=None,payload=None,token='synthetic-read-only'):
        return deployment.integrate_installation(fixture() if payload is None else payload,
            ORIGIN,ORG,state,token,'MANUAL',transport)
    def test_exact_manual_receipt_is_read_twice_without_post_or_checkpoint_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);checkpoint=state/deployment.STATE_NAME
            checkpoint.write_bytes(b'unrelated checkpoint must remain untouched')
            anchor=state/'ia-master';anchor.mkdir();(anchor/'installation.json').write_bytes(b'preserved identity')
            before={str(path.relative_to(state)):path.read_bytes() for path in state.rglob('*') if path.is_file()}
            first=manual_readback();second=copy.deepcopy(first)
            second['installation']['verifiedAt']='2026-01-01T01:00:01.000Z'
            second['installation']['acceptance']['verifiedAt']='2026-01-01T01:00:02.000Z'
            transport=Mock(side_effect=[(200,first),(200,second)])
            with patch.object(deployment,'run',side_effect=AssertionError('manual cannot send or write')), \
                 patch.object(deployment,'checkpoint_lock',side_effect=AssertionError('manual cannot lock state')), \
                 patch.object(deployment,'atomic_json',side_effect=AssertionError('manual cannot write')):
                result=self.verify(transport,state)
            expected=sync.synchronize(fixture(),ORIGIN,ORG)
            url=ORIGIN+'/api/integration/ping?documentId='+expected['documentId']
            self.assertEqual(transport.call_args_list,[call(url,'synthetic-read-only'),call(url,'synthetic-read-only')])
            self.assertEqual(before,{str(path.relative_to(state)):path.read_bytes() for path in state.rglob('*') if path.is_file()})
            self.assertTrue(result['eligible']);self.assertEqual(result['method'],'MANUAL')
            for flag in REQUIRED:self.assertIs(result[flag],True)
            self.assertTrue(result['replayPersistedVerified']);self.assertFalse(result['documentReplayPerformedByInstaller'])
            for flag in ('installationComplete','checkpointChanged','globalIngestionVerified','sourceAcquisitionCertified'):
                self.assertIs(result[flag],False)
            self.assertEqual(result['proofScope'],'AUTHENTICATED_MANUAL_RECEIPT_READBACK')
            self.assertNotIn('synthetic-read-only',json.dumps(result))
            self.assertNotIn('amountCents',json.dumps(result))
    def test_manual_does_not_need_or_create_a_state_directory(self):
        for state in (None,Path('not-an-authorized-state-directory')):
            transport=Mock(side_effect=[(200,manual_readback()),(200,manual_readback())])
            with patch.object(deployment,'safe_path',side_effect=AssertionError('manual must ignore state')):
                self.assertTrue(self.verify(transport,state)['eligible'])
    def test_invalid_input_origin_or_missing_credential_never_calls_transport(self):
        for payload,token in [(dict(fixture(),patientName='forbidden'),'synthetic'),
                              (fixture(),None),(fixture(),''),(fixture(),'bad token')]:
            with self.subTest(payload=sorted(payload),token=token):
                transport=Mock()
                with self.assertRaises(sync.SyncError):self.verify(transport,payload=payload,token=token)
                transport.assert_not_called()
        transport=Mock()
        with self.assertRaisesRegex(sync.SyncError,'CANONICAL_INSTALLATION_ORIGIN_REQUIRED'):
            deployment.integrate_installation(fixture(),'https://other.example.invalid',ORG,None,
                'synthetic','MANUAL',transport)
        transport.assert_not_called()
    def test_authentication_failure_or_wrong_reader_tenant_service_is_rejected(self):
        cases=[(status,manual_readback()) for status in (401,403,500)]
        for change in ({'ok':False},{'ok':1},{'orgId':'other-org'},{'service':'other-service'},
                       {'keyId':'web_'+'a'*32},{'keyId':None}):
            cases.append((200,{**manual_readback(),**change}))
        cases.extend([(200,None),(200,[])])
        for response in cases:
            with self.subTest(status=response[0],response_type=type(response[1]).__name__):
                transport=Mock(return_value=response)
                with self.assertRaisesRegex(sync.SyncError,'ORGANIZATION_MISMATCH'):self.verify(transport)
                self.assertEqual(transport.call_count,1)
    def test_pending_processing_or_missing_receipt_is_rejected(self):
        cases=[None,{'state':'PENDING_PROJECTION','firstIngestionVerified':False,'operationalComplete':False}]
        for proof in cases:
            result=manual_readback();result['installation']=proof
            with self.subTest(proof=proof),self.assertRaisesRegex(sync.SyncError,'AUTHENTICATED_PROCESSING_REQUIRED'):
                self.verify(Mock(return_value=(200,result)))
        result=manual_readback();del result['installation']['acceptance']
        with self.assertRaisesRegex(sync.SyncError,'AUTHORITATIVE_AUTOMATION'):self.verify(Mock(return_value=(200,result)))
    def test_document_payload_identity_and_immutable_version_must_match(self):
        changes=[{'documentId':'f'*48},{'sourceSystem':'TASY'},{'sourceVersion':2},
                 {'revision':True},{'versionId':'f'*48},{'canonicalSnapshotHash':'f'*64}]
        for change in changes:
            result=manual_readback();result['installation'].update(change)
            with self.subTest(change=change),self.assertRaisesRegex(sync.SyncError,'CLOUD_PROCESSING_PROOF_MISMATCH'):
                self.verify(Mock(return_value=(200,result)))
        for payload in (dict(fixture(),externalDocumentId='different-export'),dict(fixture(),amountCents=12346)):
            with self.subTest(payload=payload),self.assertRaisesRegex(sync.SyncError,'CLOUD_PROCESSING_PROOF_MISMATCH'):
                self.verify(Mock(return_value=(200,manual_readback())),payload=payload)
    def test_manual_cannot_adopt_api_or_unverified_processing_replay_and_automation(self):
        changes=[{'method':'API_TOKEN'},{'eligible':False}]+[{flag:False} for flag in REQUIRED]
        changes.append({'acquisitionModes':{**manual_readback()['installation']['acceptance']['acquisitionModes'],
                                           'MANUAL':'PENDING_CONFIGURATION'}})
        for change in changes:
            result=manual_readback();result['installation']['acceptance'].update(change)
            with self.subTest(change=change),self.assertRaises(sync.SyncError):self.verify(Mock(return_value=(200,result)))
    def test_acceptance_schema_tenant_version_and_flags_are_checked_strictly(self):
        changes=[{'orgId':'other-org'},{'documentId':'f'*48},{'versionId':'f'*48},
                 {'sourceVersion':2},{'canonicalSnapshotHash':'f'*64},{'configurationHash':'bad'},
                 {'receiptId':'bad'},{'verifiedAt':'not-a-date'},{'automationVerified':'true'},
                 {'providerAccessVerified':True},{'rawDocument':'forbidden'}]
        for change in changes:
            result=manual_readback();result['installation']['acceptance'].update(change)
            with self.subTest(change=change),self.assertRaisesRegex(sync.SyncError,'INSTALLATION_ACCEPTANCE_MISMATCH'):
                self.verify(Mock(return_value=(200,result)))
    def test_reader_revision_receipt_or_configuration_change_between_reads_is_rejected(self):
        changed_reader=manual_readback();changed_reader['keyId']='ik_'+'d'*16
        changed_configuration=manual_readback();changed_configuration['installation']['acceptance']['configurationHash']='d'*64
        changed_receipt=manual_readback();changed_receipt['installation']['acceptance']['receiptId']='d'*64
        for second in (changed_reader,changed_configuration,changed_receipt,manual_readback(revision=2)):
            transport=Mock(side_effect=[(200,manual_readback()),(200,second)])
            with self.subTest(second=second),self.assertRaisesRegex(sync.SyncError,'MANUAL_INSTALLATION_READBACK_CHANGED'):
                self.verify(transport)
            self.assertEqual(transport.call_count,2)
    def test_second_read_revocation_or_missing_replay_cannot_use_first_read(self):
        missing_replay=manual_readback();missing_replay['installation']['acceptance']['replayVerified']=False
        for second in ((401,{'ok':False}),(200,missing_replay)):
            transport=Mock(side_effect=[(200,manual_readback()),second])
            with self.subTest(second=second),self.assertRaises(sync.SyncError):self.verify(transport)
            self.assertEqual(transport.call_count,2)


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
