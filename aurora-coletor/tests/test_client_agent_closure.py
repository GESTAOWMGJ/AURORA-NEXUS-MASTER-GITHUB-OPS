"""Unequal provider traversals: fresh, authorized closure with synthetic seams only."""
import copy
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import client_agent as agent
from test_cloud_sync import fixture,ORG
from test_installation_integration import CanonicalTransport


class Pages:
    def __init__(self,lengths):
        self.lengths=lengths;self.calls=[];self.pending={};self.changed=set();self.empty=set();self.on_pull=None
    def __call__(self,source,environment,cursor):
        label=source['folderId'];index=0 if cursor is None else int(cursor.split('-')[1])
        self.calls.append((label,cursor))
        if self.on_pull:self.on_pull(label,index)
        following='page-'+str(index+1) if index+1<self.lengths[label] else None
        payload={**fixture(),'externalDocumentId':'synthetic-'+label+'-'+str(index)}
        if label in self.changed:payload['sourceVersion']+=1
        return {'documents':[] if label in self.empty else [payload],
                'pendingExtraction':self.pending.get(label,0),'coverageLimited':following is not None,'nextCursor':following}


class InterruptedClosure(BaseException):pass


class ClientAgentClosureTests(unittest.TestCase):
    environment={'AURORA_APP_TOKEN':'synthetic-app-token','AURORA_GOOGLE_TOKEN':'synthetic-provider-token'}
    def config(self,base,lengths):
        return {'schemaVersion':agent.SCHEMA,'instanceId':'c'*32,'org':ORG,'origin':'https://auroranexus.com.br',
                'stateDir':str(base/'state'),'roots':[],
                'providers':[{'provider':'GOOGLE_DRIVE','folderId':label,'tokenEnv':'AURORA_GOOGLE_TOKEN'} for label in lengths],
                'tokenEnv':'AURORA_APP_TOKEN','authorization':{'approved':True,'actorRef':'synthetic-admin',
                    'documentRef':'synthetic-consent','expiresAt':'2099-01-01T00:00:00Z'}}
    def run_cycle(self,config,provider,transport):
        return agent.cycle(config,self.environment,transport,provider,verify_installation=True)
    @contextmanager
    def database(self,config):
        conn=sqlite3.connect(Path(config['stateDir'])/'client-agent.sqlite3')
        try:
            with conn:yield conn
        finally:conn.close()
    def assert_pending(self,result):
        self.assertFalse(result['installationReadiness']['eligible'])
        self.assertFalse(result['fullSynchronizationVerified'])

    def test_arbitrary_unequal_page_counts_close_with_fresh_reads_and_replays_per_source(self):
        for lengths in [(1,2),(2,1),(2,3),(3,2),(1,4),(4,1)]:
            with self.subTest(lengths=lengths),tempfile.TemporaryDirectory() as tmp:
                shape=dict(zip(('scope-a','scope-b'),lengths));config=self.config(Path(tmp),shape)
                provider=Pages(shape);transport=CanonicalTransport()
                for index in range(max(lengths)):
                    before=len(transport.posts);result=self.run_cycle(config,provider,transport)
                    if index+1<max(lengths):self.assert_pending(result)
                ready=result['installationReadiness']
                self.assertTrue(ready['eligible']);self.assertTrue(ready['sourceProofsFreshThisRun'])
                self.assertEqual(ready['processingReceiptsVerifiedThisRun'],2)
                self.assertEqual(ready['idempotentReplaysVerifiedThisRun'],2)
                self.assertEqual(len(transport.posts)-before,4)
                self.assertEqual(result['cloudPagesCommitted'],sum(lengths))
                self.assertEqual(len(transport.keys),sum(lengths))
                self.assertEqual(len(provider.calls),2*max(lengths))
                self.assertFalse(ready['globalIngestionVerified'])
                with self.database(config) as conn:
                    persisted='\n'.join(conn.iterdump())
                for raw in ('externalDocumentId','amountCents',*self.environment.values()):self.assertNotIn(raw,persisted)

    def test_completed_multi_page_source_revalidates_its_final_request_cursor_without_counting_a_new_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            lengths={'scope-a':2,'scope-b':3};config=self.config(Path(tmp),lengths)
            provider=Pages(lengths);transport=CanonicalTransport()
            for _ in range(3):result=self.run_cycle(config,provider,transport)
            self.assertTrue(result['installationReadiness']['eligible'])
            self.assertEqual(provider.calls,[('scope-a',None),('scope-b',None),('scope-a','page-1'),
                ('scope-b','page-1'),('scope-a','page-1'),('scope-b','page-2')])
            self.assertEqual(result['cloudPagesCommitted'],5)

    def test_nonpublic_authorization_extras_are_not_hashed_or_persisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            lengths={'scope-a':1};config=self.config(Path(tmp),lengths)
            public_hash=agent.source_configuration_hash(config)
            private='SYNTHETIC-NONPUBLIC-AUTHORIZATION-EXTRA'
            config['authorization']['password']=private
            result=self.run_cycle(config,Pages(lengths),CanonicalTransport())
            self.assertTrue(result['installationReadiness']['eligible'])
            with self.database(config) as conn:
                self.assertEqual(conn.execute('SELECT configuration_hash FROM provider_page_proofs').fetchone()[0],public_hash)
                persisted='\n'.join(conn.iterdump())
            self.assertNotIn(private,persisted);self.assertNotIn(agent.sync.digest(private),persisted)

    def test_cached_eof_never_substitutes_current_provider_access_or_canonical_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            lengths={'scope-a':1,'scope-b':2};config=self.config(Path(tmp),lengths)
            provider=Pages(lengths);transport=CanonicalTransport()
            self.run_cycle(config,provider,transport);self.assertTrue(self.run_cycle(config,provider,transport)['installationReadiness']['eligible'])
            before=len(transport.posts)
            denied=Mock(side_effect=agent.sync.SyncError('PROVIDER_AUTH_REQUIRED'))
            result=self.run_cycle(config,denied,transport)
            self.assert_pending(result);self.assertEqual(denied.call_count,2);self.assertEqual(len(transport.posts),before)
            result=self.run_cycle(config,provider,transport)
            self.assertTrue(result['installationReadiness']['eligible']);self.assertEqual(len(transport.posts),before+4)
            result=self.run_cycle(config,provider,CanonicalTransport(always_accepted=True))
            self.assert_pending(result)

    def test_legacy_eof_without_new_metadata_rescans_without_discarding_canonical_intake(self):
        with tempfile.TemporaryDirectory() as tmp:
            lengths={'scope-a':1,'scope-b':2};config=self.config(Path(tmp),lengths)
            provider=Pages(lengths);transport=CanonicalTransport()
            for _ in range(2):self.run_cycle(config,provider,transport)
            with self.database(config) as conn:
                history=conn.execute('SELECT count(*) FROM intake').fetchone()[0]
                conn.execute('DROP TABLE provider_page_proofs')
            before=len(provider.calls);result=self.run_cycle(config,provider,transport)
            self.assert_pending(result);self.assertEqual(provider.calls[before:],[('scope-a',None),('scope-b',None)])
            with self.database(config) as conn:self.assertEqual(conn.execute('SELECT count(*) FROM intake').fetchone()[0],history)
            self.assertTrue(self.run_cycle(config,provider,transport)['installationReadiness']['eligible'])

    def test_expired_traversal_metadata_restarts_scope_but_preserves_intake_and_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            lengths={'scope-a':1,'scope-b':2};config=self.config(Path(tmp),lengths)
            provider=Pages(lengths);transport=CanonicalTransport();now=[1000.0]
            with patch.object(agent.time,'time',side_effect=lambda:now[0]):
                self.run_cycle(config,provider,transport)
                with self.database(config) as conn:history=conn.execute('SELECT count(*) FROM intake').fetchone()[0]
                now[0]+=agent.SOURCE_PROOF_TTL_SECONDS+1
                before=len(provider.calls);result=self.run_cycle(config,provider,transport)
                self.assert_pending(result);self.assertEqual(provider.calls[before:],[('scope-a',None),('scope-b',None)])
                with self.database(config) as conn:self.assertEqual(conn.execute('SELECT count(*) FROM intake').fetchone()[0],history)
                self.assertTrue(self.run_cycle(config,provider,transport)['installationReadiness']['eligible'])
            self.assertEqual(len(transport.keys),3)

    def test_current_closure_expires_when_an_earlier_source_read_is_too_old(self):
        with tempfile.TemporaryDirectory() as tmp:
            lengths={'scope-a':1,'scope-b':1};config=self.config(Path(tmp),lengths)
            provider=Pages(lengths);transport=CanonicalTransport();now=[1000.0]
            provider.on_pull=lambda label,index:now.__setitem__(0,now[0]+agent.SOURCE_PROOF_TTL_SECONDS+1) if label=='scope-b' else None
            with patch.object(agent.time,'time',side_effect=lambda:now[0]):
                result=self.run_cycle(config,provider,transport)
                self.assert_pending(result);self.assertFalse(result['installationReadiness']['sourceProofsFreshThisRun'])
                provider.on_pull=None
                self.assertTrue(self.run_cycle(config,provider,transport)['installationReadiness']['eligible'])

    def test_first_inflight_page_rejects_changed_consent_or_invalid_proof_without_losing_history(self):
        for scenario in ('consent','future','legacy'):
            with self.subTest(scenario=scenario),tempfile.TemporaryDirectory() as tmp:
                lengths={'scope-a':1};config=self.config(Path(tmp),lengths)
                provider=Pages(lengths);transport=CanonicalTransport();now=[1000.0]
                def pending(url,token,payload=None,key=None):
                    status,result=transport(url,token,payload,key)
                    if payload and 'sourceSystem' in payload:
                        result['installation']={'state':'PENDING_PROJECTION','firstIngestionVerified':False}
                    return status,result
                with patch.object(agent.time,'time',side_effect=lambda:now[0]):
                    self.assert_pending(self.run_cycle(config,provider,pending))
                    with self.database(config) as conn:
                        before=conn.execute('SELECT * FROM intake').fetchall()
                        inflight=conn.execute('SELECT * FROM provider_inflight').fetchall()
                        if scenario=='legacy':conn.execute('DELETE FROM provider_page_proofs')
                    if scenario=='consent':config['authorization']['documentRef']='renewed-consent'
                    elif scenario=='future':now[0]-=1
                    denied=Mock();result=self.run_cycle(config,denied,transport)
                    self.assert_pending(result);denied.assert_not_called()
                    self.assertEqual(result['providerPendingCodes'][0]['code'],'PROVIDER_SOURCE_PROOF_RECONCILIATION_REQUIRED')
                    with self.database(config) as conn:
                        self.assertEqual(conn.execute('SELECT * FROM intake').fetchall(),before)
                        self.assertEqual(conn.execute('SELECT * FROM provider_inflight').fetchall(),inflight)

    def test_expired_inflight_page_revalidates_same_cursor_after_crash_or_backoff(self):
        for failure in ('before-commit','after-commit','retry'):
            for changed in (False,True):
                with self.subTest(failure=failure,changed=changed),tempfile.TemporaryDirectory() as tmp:
                    lengths={'scope-a':2};config=self.config(Path(tmp),lengths)
                    provider=Pages(lengths);transport=CanonicalTransport();now=[1000.0]
                    with patch.object(agent.time,'time',side_effect=lambda:now[0]):
                        self.assert_pending(self.run_cycle(config,provider,transport))
                        def interrupted(url,token,payload=None,key=None):
                            if payload and payload.get('externalDocumentId')=='synthetic-scope-a-1':
                                if failure=='after-commit':transport(url,token,payload,key)
                                if failure=='retry':raise OSError('synthetic transient failure')
                                raise InterruptedClosure()
                            return transport(url,token,payload,key)
                        if failure=='retry':
                            # The fifth real retry delay is 480s, beyond proof TTL.
                            for _ in range(5):
                                self.assert_pending(self.run_cycle(config,provider,interrupted))
                                with self.database(config) as conn:
                                    due=conn.execute("SELECT next_attempt FROM intake WHERE state='RETRY'").fetchone()[0]
                                delay=due-now[0];now[0]=due
                            self.assertGreater(delay,agent.SOURCE_PROOF_TTL_SECONDS)
                        else:
                            with self.assertRaises(InterruptedClosure):self.run_cycle(config,provider,interrupted)
                            now[0]+=agent.SOURCE_PROOF_TTL_SECONDS+1
                        with self.database(config) as conn:
                            before=conn.execute('SELECT * FROM intake').fetchall()
                            inflight=conn.execute('SELECT * FROM provider_inflight').fetchall()
                            checkpoint=conn.execute('SELECT * FROM provider_pages').fetchall()
                        if changed:provider.changed.add('scope-a')
                        calls=len(provider.calls);posts=len(transport.posts)
                        result=self.run_cycle(config,provider,transport)
                        self.assertEqual(provider.calls[calls:],[('scope-a','page-1')])
                        if changed:
                            self.assert_pending(result)
                            self.assertEqual(result['providerPendingCodes'][0]['code'],'PROVIDER_PAGE_CHANGED_RECONCILIATION_REQUIRED')
                            self.assertEqual(len(transport.posts),posts)
                            with self.database(config) as conn:
                                self.assertEqual(conn.execute('SELECT * FROM intake').fetchall(),before)
                                self.assertEqual(conn.execute('SELECT * FROM provider_inflight').fetchall(),inflight)
                                self.assertEqual(conn.execute('SELECT * FROM provider_pages').fetchall(),checkpoint)
                        else:
                            self.assertTrue(result['installationReadiness']['eligible'])
                            self.assertTrue(result['installationReadiness']['sourceProofsFreshThisRun'])
                            self.assertEqual(result['installationReadiness']['idempotentReplaysVerifiedThisRun'],1)
                            self.assertEqual(len(transport.posts)-posts,2)
                            self.assertEqual(result['cloudPagesCommitted'],2)
                            self.assertEqual(len(transport.keys),2)
                            with self.database(config) as conn:
                                self.assertEqual(conn.execute('SELECT count(*) FROM provider_inflight').fetchone()[0],0)

    def test_revoked_or_changed_authorization_cannot_reuse_prior_source_proof(self):
        with tempfile.TemporaryDirectory() as tmp:
            lengths={'scope-a':1,'scope-b':2};config=self.config(Path(tmp),lengths)
            provider=Pages(lengths);transport=CanonicalTransport();self.run_cycle(config,provider,transport)
            config['authorization']['approved']=False;denied=Mock()
            with self.assertRaisesRegex(agent.sync.SyncError,'SOURCE_AUTHORIZATION_REQUIRED'):self.run_cycle(config,denied,denied)
            denied.assert_not_called()
            config['authorization']['approved']=True;config['authorization']['documentRef']='renewed-consent'
            before=len(provider.calls);result=self.run_cycle(config,provider,transport)
            self.assert_pending(result);self.assertEqual(provider.calls[before:],[('scope-a',None),('scope-b',None)])
            self.assertTrue(self.run_cycle(config,provider,transport)['installationReadiness']['eligible'])

    def test_revocation_after_report_and_source_change_during_pull_fail_closed(self):
        for stage in ('pull','report'):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as tmp:
                lengths={'scope-a':1};config=self.config(Path(tmp),lengths);provider=Pages(lengths);transport=CanonicalTransport()
                if stage=='pull':provider.on_pull=lambda *_:config['authorization'].update(approved=False)
                def call(url,token,payload=None,key=None):
                    result=transport(url,token,payload,key)
                    if stage=='report' and payload and payload.get('component')=='AURORA_CLIENT_AGENT':config['authorization']['approved']=False
                    return result
                with self.assertRaisesRegex(agent.sync.SyncError,'SOURCE_AUTHORIZATION_REQUIRED'):self.run_cycle(config,provider,call)

    def test_changed_completed_page_or_config_does_not_silently_advance(self):
        with tempfile.TemporaryDirectory() as tmp:
            lengths={'scope-a':1,'scope-b':2};config=self.config(Path(tmp),lengths);provider=Pages(lengths);transport=CanonicalTransport()
            self.run_cycle(config,provider,transport);provider.changed.add('scope-a')
            result=self.run_cycle(config,provider,transport);self.assert_pending(result)
            self.assertEqual(result['providerPendingCodes'][0]['code'],'PROVIDER_PAGE_CHANGED_RECONCILIATION_REQUIRED')
            changed=copy.deepcopy(config);changed['providers'][0]['folderId']='other-scope';denied=Mock()
            with self.assertRaisesRegex(agent.sync.SyncError,'SOURCE_STATE_BINDING_CHANGED'):self.run_cycle(changed,denied,transport)
            denied.assert_not_called()

    def test_pending_extraction_and_empty_source_stay_pending_without_inflating_page_counts(self):
        for scenario in ('pending','empty'):
            with self.subTest(scenario=scenario),tempfile.TemporaryDirectory() as tmp:
                lengths={'scope-a':1,'scope-b':2};config=self.config(Path(tmp),lengths);provider=Pages(lengths);transport=CanonicalTransport()
                if scenario=='pending':provider.pending['scope-a']=1
                else:provider.empty.add('scope-a')
                for _ in range(3):result=self.run_cycle(config,provider,transport);self.assert_pending(result)
                self.assertEqual(result['cloudPagesCommitted'],2 if scenario=='pending' else 3)
                self.assertEqual(result['pendingExtraction'],1 if scenario=='pending' else 0)

    def test_interrupted_closure_before_or_after_remote_commit_reuses_same_keys(self):
        for after_remote in (False,True):
            with self.subTest(after_remote=after_remote),tempfile.TemporaryDirectory() as tmp:
                lengths={'scope-a':1,'scope-b':2};config=self.config(Path(tmp),lengths);provider=Pages(lengths);transport=CanonicalTransport()
                self.run_cycle(config,provider,transport)
                def interrupted(url,token,payload=None,key=None):
                    if payload and payload.get('externalDocumentId')=='synthetic-scope-b-1':
                        if after_remote:transport(url,token,payload,key)
                        raise InterruptedClosure()
                    return transport(url,token,payload,key)
                with self.assertRaises(InterruptedClosure):self.run_cycle(config,provider,interrupted)
                result=self.run_cycle(config,provider,transport)
                self.assertTrue(result['installationReadiness']['eligible']);self.assertEqual(len(transport.keys),3)
                self.assertEqual(result['cloudPagesCommitted'],3)


if __name__=='__main__':unittest.main()
