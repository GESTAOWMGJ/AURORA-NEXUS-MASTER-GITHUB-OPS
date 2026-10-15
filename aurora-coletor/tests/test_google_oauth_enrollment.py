"""Synthetic desktop consent tests: loopback only, never a provider request."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock,patch
from urllib import parse

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import client_agent as agent
import install_client_agent as installer
import provider_connectors as providers
from aurora_cloud_sync import SyncError


class GoogleEnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base=Path(self.temporary.name)
        self.target=self.base/'agent'
        org='synthetic-org';instance='a'*32;folder='synthetic-approved-folder'
        alias='AURORA_GOOGLE_OAUTH_'+hashlib.sha256((org+':'+instance+':GOOGLE_DRIVE:'+folder).encode()).hexdigest()[:32].upper()
        self.source={'provider':'GOOGLE_DRIVE','folderId':folder,'oauth':{
            'schemaVersion':'aurora.google.oauth.source.v1',
            'clientId':'123456789012-syntheticdesktop.apps.googleusercontent.com',
            'credentialRef':alias,'scopeProfile':'DRIVE_READONLY_EXISTING_FOLDER'}}
        self.config={'schemaVersion':agent.SCHEMA,'instanceId':instance,'org':org,
            'origin':'https://auroranexus.com.br','stateDir':str(self.target/'state'),
            'roots':[],'providers':[self.source],'tokenEnv':'AURORA_APP_TOKEN',
            'authorization':{'approved':True,'actorRef':'synthetic-admin',
                'documentRef':'synthetic-consent','expiresAt':'2099-01-01T00:00:00Z'}}
        self.transport=Mock(return_value=(200,{'ok':True,'orgId':org}))
        self.environment={'AURORA_APP_TOKEN':'synthetic-aurora-token'}
        self.context={'clientId':self.source['oauth']['clientId']}
        self.record={'synthetic':'protected-record'}
        self.threads=[];self.responses=[];self.thread_errors=[];self.redirects=[]
        self.addCleanup(self.finish_threads)

    def finish_threads(self):
        for thread in self.threads:
            thread.join(3)
            self.assertFalse(thread.is_alive(),'Synthetic callback thread did not terminate')
        self.assertEqual(self.thread_errors,[])

    def stage(self,installed=False,client_id=True):
        if not client_id:self.source['oauth']['clientId']=None
        result=installer.install(self.target,self.config)
        if installed:
            result.update(state='INSTALLED',installationComplete=True)
            installer.atomic_json(self.target/'installation.json',result)
        return result

    def snapshot(self):
        return {str(path.relative_to(self.target)):path.read_bytes()
                for path in self.target.rglob('*') if path.is_file()}

    def protocol(self,record=None):
        # The provider protocol is independently tested; here assert its orchestration.
        context={**self.context,'clientId':self.source['oauth']['clientId']}
        stack=contextlib.ExitStack()
        stack.enter_context(patch.object(providers,'google_oauth_context',return_value=context,create=True))
        self.load=stack.enter_context(patch.object(providers,'google_oauth_load_record',return_value=record,create=True))
        self.digest=stack.enter_context(patch.object(providers,'google_oauth_record_digest',return_value='old-digest' if record else None,create=True))
        self.complete=stack.enter_context(patch.object(providers,'google_oauth_complete',return_value=self.record,create=True))
        self.save=stack.enter_context(patch.object(providers,'google_oauth_save_record',create=True))
        def begin(ctx,redirect_uri,clock):
            self.redirects.append(redirect_uri)
            return {'authorizationUrl':'https://accounts.google.com/o/oauth2/v2/auth?'+parse.urlencode({'redirect_uri':redirect_uri,'state':'synthetic-state'}),
                'state':'synthetic-state','codeVerifier':'synthetic-verifier','startedAt':clock(),
                'redirectUri':redirect_uri,'context':ctx}
        self.begin=stack.enter_context(patch.object(providers,'google_oauth_begin',side_effect=begin,create=True))
        return stack

    def browser(self,requests=None):
        def open_browser(url):
            query=parse.parse_qs(parse.urlsplit(url).query)
            redirect=parse.urlsplit(query['redirect_uri'][0])
            host=redirect.netloc
            path=redirect.path
            state=query['state'][0]
            values=requests or [lambda host,path:'GET '+path+'?'+parse.urlencode({'state':state,
                'code':'synthetic-authorization-code'})+' HTTP/1.1\r\nHost: '+host+'\r\n\r\n']
            def callbacks():
                try:
                    for make in values:
                        raw=make(host,path)
                        with socket.create_connection(('127.0.0.1',redirect.port),timeout=2) as connection:
                            connection.sendall(raw.encode())
                            body=b''
                            while True:
                                chunk=connection.recv(4096)
                                if not chunk:break
                                body+=chunk
                            self.responses.append(body)
                except BaseException as exc:self.thread_errors.append(type(exc).__name__)
            thread=threading.Thread(target=callbacks,daemon=True);self.threads.append(thread);thread.start()
            return True
        return open_browser

    def authorize(self,**kwargs):
        return installer.authorize_google_drive(self.target,0,self.environment,self.transport,
            browser_opener=kwargs.pop('browser_opener',self.browser()),timeout_seconds=kwargs.pop('timeout_seconds',2),**kwargs)

    def test_pending_configuration_never_reads_any_secret_or_opens_network_browser(self):
        self.stage(client_id=False);before=self.snapshot()
        with self.protocol(),patch.object(agent,'load_secret') as secret:
            result=self.authorize(browser_opener=Mock(side_effect=AssertionError('browser forbidden')))
            status=installer.google_oauth_status(self.target,0,self.environment,self.transport)
            self.load.assert_not_called();self.begin.assert_not_called();self.save.assert_not_called();secret.assert_not_called()
        self.transport.assert_not_called()
        self.assertEqual(result,status)
        self.assertEqual(result,{'state':'PENDING_CONFIGURATION','provider':'GOOGLE_DRIVE',
            'grantProtected':False,'installationComplete':False,'globalIngestionVerified':False})
        self.assertEqual(before,self.snapshot())

    def test_success_uses_bound_listener_and_cas_without_installation_side_effects(self):
        self.stage();before=self.snapshot();token_transport=Mock()
        with self.protocol(),patch.object(agent,'cycle',side_effect=AssertionError('agent forbidden')):
            result=self.authorize(token_transport=token_transport)
            self.complete.assert_called_once()
            self.assertIs(self.complete.call_args.kwargs['transport'],token_transport)
            self.save.assert_called_once_with(self.target/'state',self.context,self.record,expected_digest=None)
        self.finish_threads()
        self.assertEqual(result,{'state':'AUTHORIZED','provider':'GOOGLE_DRIVE','grantProtected':True,
            'installationComplete':False,'globalIngestionVerified':False})
        self.assertEqual(before,self.snapshot())
        self.assertEqual(self.transport.call_args.args,('https://auroranexus.com.br/api/integration/ping','synthetic-aurora-token'))
        response=self.responses[0]
        for value in (b'no-store',b'no-referrer',b"default-src 'none'",b'200 OK'):self.assertIn(value,response)
        for value in (b'synthetic-state',b'authorization-code',b'verifier',b'accessToken'):self.assertNotIn(value,response)
        address=parse.urlsplit(self.redirects[0])
        with self.assertRaises(OSError):socket.create_connection(('127.0.0.1',address.port),timeout=.2)

    def test_installed_identity_is_allowed_but_receipt_and_config_are_preserved(self):
        self.stage(installed=True);before=self.snapshot()
        with self.protocol(record={'old':'grant'}):
            self.authorize()
            self.save.assert_called_once_with(self.target/'state',self.context,self.record,expected_digest='old-digest')
        self.assertEqual(before,self.snapshot())

    def test_real_pkce_protocol_with_mock_token_exchange_and_protected_store(self):
        self.stage();before=self.snapshot();saved=[]
        def protected_update(state,org,alias,replace):
            saved.append(replace(None))
            return saved[-1]
        token_transport=Mock(return_value={'token_type':'Bearer','scope':providers.GOOGLE_SCOPE,
            'access_token':'synthetic-access-token','refresh_token':'synthetic-refresh-token','expires_in':3600})
        with patch.object(providers.secret_store,'load_record',return_value=None),patch.object(providers.secret_store,'update_record',side_effect=protected_update) as protected_store:
            result=self.authorize(token_transport=token_transport,clock=lambda:1000000000)
        self.finish_threads();self.assertEqual(result['state'],'AUTHORIZED')
        fields=token_transport.call_args.args[0]
        self.assertEqual(set(fields),{'client_id','grant_type','code','code_verifier','redirect_uri'})
        self.assertEqual(fields['code'],'synthetic-authorization-code')
        self.assertEqual(fields['grant_type'],'authorization_code')
        self.assertGreaterEqual(len(fields['code_verifier']),43)
        self.assertEqual(saved[0]['orgId'],self.config['org'])
        self.assertEqual(saved[0]['instanceId'],self.config['instanceId'])
        self.assertEqual(saved[0]['credentialRef'],self.source['oauth']['credentialRef'])
        self.assertEqual(saved[0]['grantedScopes'],[providers.GOOGLE_SCOPE])
        self.assertEqual(saved[0]['accessExpiresAt'],1000003600)
        self.assertEqual(protected_store.call_args.args[:3],(self.target/'state',self.config['org'],self.source['oauth']['credentialRef']))
        self.assertEqual(before,self.snapshot())
        public=json.dumps(result).encode()+b''.join(self.responses)
        for private in (b'synthetic-access-token',b'synthetic-refresh-token',fields['code_verifier'].encode(),fields['code'].encode()):
            self.assertNotIn(private,public)

    def test_status_is_read_only_and_discloses_no_grant_material(self):
        self.stage();before=self.snapshot()
        with self.protocol(record={'accessToken':'do-not-disclose','refreshToken':'do-not-disclose'}),patch.object(installer.webbrowser,'open') as browser:
            result=installer.google_oauth_status(self.target,0,self.environment,self.transport)
            self.begin.assert_not_called();self.complete.assert_not_called();self.save.assert_not_called();browser.assert_not_called()
        self.assertEqual(result['state'],'PROTECTED_GRANT_PRESENT')
        self.assertTrue(result['grantProtected']);self.assertNotIn('Token',json.dumps(result));self.assertEqual(before,self.snapshot())

    def test_missing_grant_status_stays_pending(self):
        self.stage()
        with self.protocol():result=installer.google_oauth_status(self.target,0,self.environment,self.transport)
        self.assertEqual(result['state'],'PENDING_AUTHORIZATION');self.assertFalse(result['grantProtected'])

    def test_wrong_aurora_tenant_blocks_before_google_secret_browser_or_protocol(self):
        self.stage();self.transport.return_value=(200,{'ok':True,'orgId':'other-org'})
        with self.protocol(),self.assertRaisesRegex(SyncError,'AUTHENTICATED_ORGANIZATION_MISMATCH'):
            self.authorize(browser_opener=Mock(side_effect=AssertionError('browser forbidden')))
        self.load.assert_not_called();self.begin.assert_not_called();self.save.assert_not_called()

    def test_missing_root_token_reads_only_root_protected_alias(self):
        self.stage()
        with self.protocol(),patch.object(agent,'load_secret',return_value='synthetic-protected-root') as load:
            installer.google_oauth_status(self.target,0,{},self.transport)
            load.assert_called_once_with(self.target/'state','synthetic-org','AURORA_APP_TOKEN')
        self.assertEqual(self.transport.call_args.args[1],'synthetic-protected-root')

    def test_no_source_or_wrong_index_rejected_before_authentication(self):
        self.stage()
        for index in (-1,1,True,'0'):
            with self.subTest(index=index),self.assertRaisesRegex(SyncError,'GOOGLE_OAUTH_SOURCE_REQUIRED'):
                installer.google_oauth_status(self.target,index,self.environment,self.transport)
        self.transport.assert_not_called()

    def test_modified_package_or_config_blocks_before_browser(self):
        self.stage();(self.target/'bin/client_agent.py').write_text('changed')
        with self.protocol(),self.assertRaisesRegex(SyncError,'AGENT_PACKAGE_CHANGED'):
            self.authorize(browser_opener=Mock(side_effect=AssertionError('browser forbidden')))
        self.transport.assert_not_called();self.load.assert_not_called()

    def test_changed_staging_during_consent_blocks_token_exchange_and_save(self):
        self.stage();browser=self.browser()
        def changed(url):
            result=browser(url)
            (self.target/'agent-config.json').write_text('{}')
            return result
        with self.protocol(),self.assertRaises(SyncError):self.authorize(browser_opener=changed)
        self.complete.assert_not_called();self.save.assert_not_called()

    def test_changed_staging_during_exchange_blocks_save(self):
        self.stage()
        with self.protocol():
            def exchange(*args,**kwargs):
                (self.target/'bin/client_agent.py').write_text('changed')
                return self.record
            self.complete.side_effect=exchange
            with self.assertRaisesRegex(SyncError,'AGENT_PACKAGE_CHANGED'):self.authorize()
            self.save.assert_not_called()

    def test_grant_compare_and_swap_conflict_is_never_overwritten_or_retried(self):
        self.stage()
        with self.protocol(record={'old':'grant'}):
            self.save.side_effect=SyncError('GOOGLE_OAUTH_GRANT_CHANGED')
            with self.assertRaisesRegex(SyncError,'GOOGLE_OAUTH_GRANT_CHANGED'):self.authorize()
            self.save.assert_called_once()

    def test_browser_failure_closes_listener_and_does_not_exchange(self):
        self.stage()
        for opener in (Mock(return_value=False),Mock(side_effect=ValueError('private-url'))):
            with self.subTest(opener=opener),self.protocol():
                with self.assertRaisesRegex(SyncError,'^GOOGLE_OAUTH_BROWSER_REQUIRED$'):self.authorize(browser_opener=opener)
                self.complete.assert_not_called();self.save.assert_not_called()
                address=parse.urlsplit(self.redirects[-1])
                with self.assertRaises(OSError):socket.create_connection(('127.0.0.1',address.port),timeout=.2)

    def test_callback_timeout_closes_listener_without_persisting_attempt(self):
        self.stage();before=self.snapshot()
        with self.protocol(),self.assertRaisesRegex(SyncError,'^GOOGLE_OAUTH_CALLBACK_TIMEOUT$'):
            self.authorize(browser_opener=Mock(return_value=True),timeout_seconds=.03)
        self.assertEqual(before,self.snapshot());self.complete.assert_not_called();self.save.assert_not_called()

    def test_socket_failure_returns_only_stable_public_error(self):
        self.stage()
        with self.protocol(),patch.object(installer.socket,'socket',side_effect=OSError('private-operating-system-detail')):
            with self.assertRaisesRegex(SyncError,'^GOOGLE_OAUTH_CALLBACK_UNAVAILABLE$'):self.authorize()
            self.begin.assert_not_called();self.complete.assert_not_called();self.save.assert_not_called()

    def test_callback_rejects_eight_invalid_requests_and_closes(self):
        self.stage()
        cases=[lambda host,path:'GET '+path+'?state=synthetic-state&code=secret HTTP/1.1\r\nHost: wrong-host\r\n\r\n',
            lambda host,path:'POST '+path+'?state=synthetic-state&code=secret HTTP/1.1\r\nHost: '+host+'\r\n\r\n',
            lambda host,path:'GET /wrong?state=synthetic-state&code=secret HTTP/1.1\r\nHost: '+host+'\r\n\r\n',
            lambda host,path:'GET '+path+'?state=wrong&code=secret HTTP/1.1\r\nHost: '+host+'\r\n\r\n',
            lambda host,path:'GET '+path+'?state=synthetic-state&code=secret&code=other HTTP/1.1\r\nHost: '+host+'\r\n\r\n',
            lambda host,path:'GET '+path+'?state=synthetic-state&code=secret&unknown=1 HTTP/1.1\r\nHost: '+host+'\r\n\r\n',
            lambda host,path:'GET '+path+'?state=synthetic-state&code=secret HTTP/1.1\r\nHost: '+host+'\r\nHost: '+host+'\r\n\r\n',
            lambda host,path:'GET '+path+'?state=synthetic-state&code='+('x'*4096)+' HTTP/1.1\r\nHost: '+host+'\r\n\r\n']
        with self.protocol(),self.assertRaisesRegex(SyncError,'^GOOGLE_OAUTH_CALLBACK_LIMIT$'):
            self.authorize(browser_opener=self.browser(cases))
        self.finish_threads();self.assertEqual(len(self.responses),8)
        self.assertTrue(all(b'400 Bad Request' in response and b'secret' not in response for response in self.responses))
        self.complete.assert_not_called();self.save.assert_not_called()

    def test_provider_denial_reaches_protocol_with_no_error_echo_or_write(self):
        self.stage()
        denial=[lambda host,path:'GET '+path+'?state=synthetic-state&error=access_denied&error_description=private-description HTTP/1.1\r\nHost: '+host+'\r\n\r\n']
        with self.protocol():
            self.complete.side_effect=SyncError('GOOGLE_OAUTH_REAUTHORIZATION_REQUIRED')
            with self.assertRaisesRegex(SyncError,'^GOOGLE_OAUTH_REAUTHORIZATION_REQUIRED$'):
                self.authorize(browser_opener=self.browser(denial))
            self.save.assert_not_called()
        self.finish_threads();self.assertNotIn(b'private-description',self.responses[0])

    def test_standard_google_callback_extras_are_passed_only_in_memory(self):
        self.stage()
        callback=[lambda host,path:'GET '+path+'?'+parse.urlencode({'state':'synthetic-state','code':'synthetic-code',
            'scope':'https://www.googleapis.com/auth/drive.readonly','authuser':'0','prompt':'consent',
            'iss':'https://accounts.google.com'})+' HTTP/1.1\r\nHost: '+host+'\r\n\r\n']
        with self.protocol():
            self.authorize(browser_opener=self.browser(callback))
            self.assertEqual(self.complete.call_args.args[1]['authuser'],'0')

    def test_callback_timeout_and_source_selection_are_bounded(self):
        for timeout in (0,-1,181,True,'180'):
            with self.subTest(timeout=timeout),self.assertRaisesRegex(SyncError,'GOOGLE_OAUTH_CALLBACK_LIMIT_REQUIRED'):
                installer._google_consent_callback(self.context,Mock(),time.time,time.monotonic,timeout)

    def test_non_loopback_peer_is_rejected_without_read(self):
        connection=Mock()
        with self.assertRaisesRegex(SyncError,'GOOGLE_OAUTH_CALLBACK_REJECTED'):
            installer._google_callback_parameters(connection,('192.0.2.1',1234),'127.0.0.1:1234','state',time.monotonic()+1,time.monotonic)
        connection.recv.assert_not_called()

    def test_partial_request_cannot_extend_absolute_deadline(self):
        connection=Mock();connection.recv.return_value=b'GET '
        with self.assertRaisesRegex(SyncError,'^GOOGLE_OAUTH_CALLBACK_TIMEOUT$'):
            installer._google_callback_parameters(connection,('127.0.0.1',1234),'127.0.0.1:1234','state',10,Mock(side_effect=[9,10]))
        connection.recv.assert_called_once();connection.settimeout.assert_called_once_with(1)

    def test_non_ascii_callback_state_is_sanitized(self):
        connection=Mock()
        connection.recv.return_value=b'GET /aurora-google-oauth/callback?state=%C3%A9&code=private HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n'
        with self.assertRaisesRegex(SyncError,'^GOOGLE_OAUTH_CALLBACK_REJECTED$'):
            installer._google_callback_parameters(connection,('127.0.0.1',1234),'127.0.0.1:1234','state',time.monotonic()+1,time.monotonic)

    def test_configure_secrets_prompts_only_root_and_legacy_aliases(self):
        self.config['providers'].append({'provider':'GMAIL','labelId':'synthetic-label','tokenEnv':'AURORA_GMAIL_TOKEN'})
        with patch.object(installer,'store') as store,patch.object(installer.getpass,'getpass',return_value='synthetic-secret') as prompt:
            installer.install(self.target,self.config,configure_secrets=True)
        self.assertEqual([call.args[2] for call in store.call_args_list],['AURORA_APP_TOKEN','AURORA_GMAIL_TOKEN'])
        self.assertEqual(prompt.call_count,2)

    def test_cli_oauth_modes_reject_install_continue_and_start(self):
        base=['install_client_agent.py','--target',str(self.target),'--authorize-google-drive','0']
        for flags in (['--continue-integration'],['--google-oauth-status','0'],['--disable']):
            with self.subTest(flags=flags),patch.object(sys,'argv',base+flags),contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
                installer.main()
        for flags in (['--config','config.json'],['--startup'],['--configure-secrets'],['--start-now'],['--verify-integration']):
            with self.subTest(flags=flags),patch.object(sys,'argv',base+flags),self.assertRaisesRegex(SyncError,'EXISTING_STAGED_CONFIGURATION_REQUIRED'):
                installer.main()

    def test_cli_outputs_only_public_status_and_never_calls_install(self):
        result=installer._oauth_public_status('PENDING_CONFIGURATION')
        for flag,method in (('--authorize-google-drive','authorize_google_drive'),('--google-oauth-status','google_oauth_status')):
            output=io.StringIO()
            with self.subTest(flag=flag),patch.object(sys,'argv',['installer','--target',str(self.target),flag,'0']),patch.object(installer,method,return_value=result) as action,patch.object(installer,'install') as install,contextlib.redirect_stdout(output):
                self.assertEqual(installer.main(),2)
                action.assert_called_once_with(str(self.target),0);install.assert_not_called()
            self.assertEqual(json.loads(output.getvalue()),result)

    def test_cli_grant_presence_is_diagnostic_success_not_live_authorization(self):
        result=installer._oauth_public_status('PROTECTED_GRANT_PRESENT',True);output=io.StringIO()
        with patch.object(sys,'argv',['installer','--target',str(self.target),'--google-oauth-status','0']),patch.object(installer,'google_oauth_status',return_value=result),contextlib.redirect_stdout(output):
            self.assertEqual(installer.main(),0)
        self.assertEqual(json.loads(output.getvalue()),result)
        self.assertNotEqual(result['state'],'AUTHORIZED');self.assertFalse(result['installationComplete'])


if __name__=='__main__':unittest.main()
