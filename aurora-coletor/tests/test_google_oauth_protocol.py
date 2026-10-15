"""OAuth is exercised with synthetic Google replies and the existing OS-store seam."""
import base64
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import Mock,patch
from urllib.error import HTTPError
from urllib.parse import parse_qs,urlsplit

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import provider_connectors as provider
import client_secret_store as store
import client_agent as agent
from test_cloud_sync import fixture
from test_installation_integration import CanonicalTransport

ORG='synthetic-org';INSTANCE='a'*32;CLIENT='12345678-synthetic.apps.googleusercontent.com';NOW=1792050000

def source(client=CLIENT):
    return {'provider':'GOOGLE_DRIVE','folderId':'synthetic-approved-folder','oauth':{
        'schemaVersion':provider.GOOGLE_OAUTH_SCHEMA,'clientId':client,
        'credentialRef':provider.google_oauth_credential_ref(ORG,INSTANCE,'synthetic-approved-folder'),
        'scopeProfile':'DRIVE_READONLY_EXISTING_FOLDER'}}

def context():return provider.google_oauth_context(source(),ORG,INSTANCE)
def reply(**changes):
    return {'access_token':'synthetic-access','refresh_token':'synthetic-refresh','expires_in':3600,
            'token_type':'Bearer','scope':provider.GOOGLE_SCOPE,**changes}
def grant():return provider._google_record(context(),reply(),NOW)

class MemoryStore:
    def __init__(self):self.values={};self.writes=[]
    def load(self,state,org,name):return self.values.get((org,name))
    def save(self,state,org,name,value):self.values[(org,name)]=value;self.writes.append(value)
    def patches(self):return patch.multiple(store,load=self.load,store=self.save)


class GoogleOAuthProtocolTests(unittest.TestCase):
    def begin(self,**kwargs):
        return provider.google_oauth_begin(context(),'http://127.0.0.1:12345'+provider.GOOGLE_CALLBACK_PATH,
                                           clock=lambda:NOW,**kwargs)
    def test_pkce_s256_and_state_are_unique_and_only_challenge_reaches_browser(self):
        first=self.begin();second=self.begin();query=parse_qs(urlsplit(first['authorizationUrl']).query)
        expected=base64.urlsafe_b64encode(hashlib.sha256(first['codeVerifier'].encode()).digest()).decode().rstrip('=')
        self.assertEqual(query['code_challenge'],[expected]);self.assertEqual(query['code_challenge_method'],['S256'])
        self.assertEqual(query['scope'],[provider.GOOGLE_SCOPE]);self.assertEqual(query['response_type'],['code'])
        self.assertNotEqual(first['state'],second['state']);self.assertNotEqual(first['codeVerifier'],second['codeVerifier'])
        self.assertNotIn(first['codeVerifier'],first['authorizationUrl']);self.assertNotIn('client_secret',query)
    def test_callback_exchanges_code_once_and_preserves_context_in_protected_record(self):
        attempt=self.begin();exchange=Mock(return_value=reply())
        record=provider.google_oauth_complete(attempt,{'state':attempt['state'],'code':'synthetic-code',
            'scope':provider.GOOGLE_SCOPE,'authuser':'0','iss':'https://accounts.google.com'},exchange,lambda:NOW)
        sent=exchange.call_args.args[0]
        self.assertEqual(set(sent),{'client_id','grant_type','code','code_verifier','redirect_uri'})
        self.assertEqual(sent['code_verifier'],attempt['codeVerifier']);self.assertEqual(record['bindingSha256'],context()['bindingSha256'])
        with self.assertRaises(provider.SyncError):provider.google_oauth_complete(attempt,{'state':attempt['state'],'code':'synthetic-code'},exchange,lambda:NOW)
        self.assertEqual(exchange.call_count,1)
    def test_callback_state_issuer_parameters_and_timeout_fail_before_exchange(self):
        changes=[{'state':'wrong'},{'code':''},{'code':'code\nvalue'},{'iss':'https://attacker.invalid'},
                 {'url':'https://attacker.invalid'},{'authuser':'injected'},{'scope':provider.GOOGLE_SCOPE+' extra'},
                 {'error':'access_denied'},{'state':None},{'state':'síntético'}]
        for change in changes:
            attempt=self.begin();params={'state':attempt['state'],'code':'synthetic-code',**change};exchange=Mock()
            with self.subTest(change=change),self.assertRaises(provider.SyncError):
                provider.google_oauth_complete(attempt,params,exchange,lambda:NOW)
            exchange.assert_not_called()
        for elapsed in (-1,180,500):
            attempt=self.begin();exchange=Mock()
            with self.subTest(elapsed=elapsed),self.assertRaises(provider.SyncError):
                provider.google_oauth_complete(attempt,{'state':attempt['state'],'code':'synthetic-code'},exchange,lambda:NOW+elapsed)
            exchange.assert_not_called()
    def test_code_is_not_retried_after_uncertain_exchange(self):
        attempt=self.begin();exchange=Mock(side_effect=provider.SyncError('GOOGLE_OAUTH_UNAVAILABLE'))
        params={'state':attempt['state'],'code':'synthetic-code'}
        for _ in range(2):
            with self.assertRaises(provider.SyncError):provider.google_oauth_complete(attempt,params,exchange,lambda:NOW)
        self.assertEqual(exchange.call_count,1)
    def test_only_numeric_loopback_exact_path_without_credentials_or_query_is_accepted(self):
        for uri in ('http://localhost:12345'+provider.GOOGLE_CALLBACK_PATH,'http://0.0.0.0:12345'+provider.GOOGLE_CALLBACK_PATH,
                    'https://127.0.0.1:12345'+provider.GOOGLE_CALLBACK_PATH,'http://127.0.0.1:12345/wrong',
                    'http://127.0.0.1:12345'+provider.GOOGLE_CALLBACK_PATH+'?next=evil',
                    'http://user@127.0.0.1:12345'+provider.GOOGLE_CALLBACK_PATH):
            with self.subTest(uri=uri),self.assertRaises(provider.SyncError):provider.google_oauth_begin(context(),uri)
    def test_missing_client_configuration_is_not_a_grant_and_legacy_mode_is_not_converted(self):
        ctx=provider.google_oauth_context(source(None),ORG,INSTANCE)
        with patch.object(store,'load_record') as load,patch.object(store,'update_record') as update:
            for action in (lambda:provider.google_oauth_begin(ctx,'http://127.0.0.1:12345'+provider.GOOGLE_CALLBACK_PATH),
                           lambda:provider.google_oauth_load_record(None,ctx),lambda:provider.google_oauth_resolve(None,ctx)):
                with self.assertRaisesRegex(provider.SyncError,'CONFIGURATION_REQUIRED'):action()
            load.assert_not_called();update.assert_not_called()
        for change in ({'tokenEnv':'AURORA_OLD_ACCESS'},{'oauth':{**source()['oauth'],'credentialRef':'AURORA_GOOGLE_OAUTH_'+'F'*32}},
                       {'oauth':{**source()['oauth'],'clientId':'https://attacker.invalid'}},
                       {'oauth':{**source()['oauth'],'scopeProfile':'ALL_DRIVE_WRITE'}}):
            with self.subTest(change=change),self.assertRaises(provider.SyncError):provider.google_oauth_context({**source(),**change},ORG,INSTANCE)
    def test_partial_extra_scopes_missing_refresh_and_unbounded_token_replies_fail(self):
        replies=[reply(scope=''),reply(scope=provider.GOOGLE_SCOPE+' extra'),reply(token_type='DPoP'),
                 reply(refresh_token=''),reply(access_token='token with whitespace'),reply(access_token='token\x01'),
                 reply(access_token='tóken'),reply(expires_in=True),
                 reply(expires_in=86401),reply(refresh_token_expires_in=-1),reply(access_token='x'*4097)]
        for invalid in replies:
            attempt=self.begin()
            with self.subTest(keys=sorted(invalid)),self.assertRaises(provider.SyncError):
                provider.google_oauth_complete(attempt,{'state':attempt['state'],'code':'synthetic'},Mock(return_value=invalid),lambda:NOW)
    def test_client_secret_is_never_inferred_or_fetched_for_a_rejected_client(self):
        attempt=self.begin();exchange=Mock(return_value={'error':'invalid_client','error_description':'synthetic-secret-must-not-leak'})
        with self.assertRaisesRegex(provider.SyncError,'^GOOGLE_OAUTH_CLIENT_CONFIGURATION_REQUIRED$'):
            provider.google_oauth_complete(attempt,{'state':attempt['state'],'code':'synthetic'},exchange,lambda:NOW)
        self.assertNotIn('client_secret',exchange.call_args.args[0])
    def test_token_transport_uses_only_fixed_tls_endpoint_post_and_no_redirect_handler(self):
        body=json.dumps(reply()).encode();response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.status=200;response.headers.get_content_type.return_value='application/json';response.read.return_value=body
        opener=Mock();opener.open.return_value=response
        fields={'client_id':CLIENT,'grant_type':'refresh_token','refresh_token':'synthetic-refresh'}
        with patch.object(provider.request,'build_opener',return_value=opener) as build:
            self.assertEqual(provider.google_oauth_token_request(fields),reply())
        req=opener.open.call_args.args[0]
        self.assertEqual(req.full_url,'https://oauth2.googleapis.com/token');self.assertEqual(req.method,'POST')
        self.assertNotIn('Authorization',req.headers);self.assertIsInstance(build.call_args.args[0],provider.NoRedirect)
        self.assertEqual(opener.open.call_args.kwargs['timeout'],20)
        self.assertIsNone(provider.NoRedirect().redirect_request(None,None,302,'',{},'https://attacker.invalid'))
    def test_protocol_errors_never_dump_google_bodies_or_tokens(self):
        for error_code,expected in [('invalid_client','CLIENT_CONFIGURATION_REQUIRED'),('invalid_grant','REAUTHORIZATION_REQUIRED')]:
            body=json.dumps({'error':error_code,'error_description':'synthetic-private-response'}).encode()
            network=Mock(side_effect=HTTPError('https://oauth2.googleapis.com/token',400,'private',{},io.BytesIO(body)))
            with patch.object(provider.request,'build_opener',return_value=Mock(open=network)):
                with self.assertRaisesRegex(provider.SyncError,expected) as caught:
                    provider.google_oauth_token_request({'client_id':CLIENT,'grant_type':'refresh_token','refresh_token':'synthetic-refresh'})
            self.assertNotIn('private',str(caught.exception));self.assertNotIn('synthetic-refresh',str(caught.exception))


class GoogleOAuthStoreRefreshTests(unittest.TestCase):
    def test_macos_same_keychain_identity_has_one_lock_across_state_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);first=home/'first';second=home/'second';first.mkdir();second.mkdir()
            with patch.object(store.sys,'platform','darwin'),patch.object(store.Path,'home',return_value=home):
                with store.record_guard(first,ORG,context()['credentialRef']):
                    with self.assertRaisesRegex(provider.SyncError,'PROTECTED_RECORD_BUSY'):
                        with store.record_guard(second,ORG,context()['credentialRef']):
                            self.fail('The same Keychain item acquired a second independent lock')
                with store.record_guard(second,ORG,context()['credentialRef']):pass
            self.assertFalse((first/'secrets').exists());self.assertFalse((second/'secrets').exists())
    def test_record_encoding_is_canonical_bounded_and_compatible_with_existing_secret_store(self):
        record=grant();encoded=store.encode_record(record)
        self.assertLessEqual(len(encoded),16384);self.assertFalse(any(c.isspace() for c in encoded))
        self.assertNotIn('synthetic-refresh',encoded)
        with tempfile.TemporaryDirectory() as tmp:
            memory=MemoryStore()
            with memory.patches():
                provider.google_oauth_save_record(Path(tmp),context(),record)
                self.assertEqual(provider.google_oauth_load_record(Path(tmp),context()),record)
                self.assertEqual(memory.writes,[encoded])
        with self.assertRaisesRegex(provider.SyncError,'TOO_LARGE'):store.encode_record({'value':'x'*12289})
    def test_incompatible_or_concurrently_changed_record_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp);memory=MemoryStore()
            with memory.patches():
                provider.google_oauth_save_record(state,context(),grant());before=dict(memory.values)
                with self.assertRaisesRegex(provider.SyncError,'RECORD_CHANGED'):provider.google_oauth_save_record(state,context(),grant())
                changed=grant();changed['clientId']='87654321-other.apps.googleusercontent.com'
                memory.values[(ORG,context()['credentialRef'])]=store.encode_record(changed)
                incompatible=dict(memory.values)
                with self.assertRaisesRegex(provider.SyncError,'BINDING_CONFLICT'):
                    provider.google_oauth_save_record(state,context(),grant(),provider.google_oauth_record_digest(changed))
                self.assertEqual(memory.values,incompatible);self.assertNotEqual(before,incompatible)
    def test_valid_access_token_does_not_refresh_or_rewrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            memory=MemoryStore();network=Mock()
            with memory.patches():
                provider.google_oauth_save_record(Path(tmp),context(),grant());before=list(memory.writes)
                token,proof=provider.google_oauth_resolve(Path(tmp),context(),network,lambda:NOW+30)
                self.assertEqual(token,'synthetic-access');self.assertFalse(proof['refreshPerformedThisRun'])
                self.assertEqual(memory.writes,before);network.assert_not_called()
    def test_expiring_token_refreshes_and_rotation_commits_only_after_old_binding_is_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            memory=MemoryStore();network=Mock(return_value=reply(access_token='new-access',refresh_token='rotated-refresh'))
            with memory.patches():
                provider.google_oauth_save_record(Path(tmp),context(),grant())
                token,proof=provider.google_oauth_resolve(Path(tmp),context(),network,lambda:NOW+3570)
                saved=provider.google_oauth_load_record(Path(tmp),context())
                self.assertEqual(token,'new-access');self.assertTrue(proof['refreshPerformedThisRun'])
                self.assertEqual(saved['generation'],2);self.assertEqual(saved['refreshToken'],'rotated-refresh')
                self.assertEqual(network.call_args.args[0],{'client_id':CLIENT,'grant_type':'refresh_token','refresh_token':'synthetic-refresh'})
    def test_refresh_without_rotation_preserves_refresh_token_and_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            memory=MemoryStore();response={'access_token':'new-access','token_type':'Bearer','expires_in':3600}
            with memory.patches():
                provider.google_oauth_save_record(Path(tmp),context(),grant())
                provider.google_oauth_resolve(Path(tmp),context(),Mock(return_value=response),lambda:NOW+3570)
                saved=provider.google_oauth_load_record(Path(tmp),context())
                self.assertEqual(saved['refreshToken'],'synthetic-refresh');self.assertEqual(saved['grantedScopes'],[provider.GOOGLE_SCOPE])
    def test_revoked_expired_or_invalid_refresh_keeps_previous_record(self):
        for response in ({'error':'invalid_grant'},reply(scope='wrong'),reply(access_token='bad token')):
            with tempfile.TemporaryDirectory() as tmp:
                memory=MemoryStore();network=Mock(return_value=response)
                with memory.patches():
                    provider.google_oauth_save_record(Path(tmp),context(),grant());before=dict(memory.values)
                    with self.assertRaises(provider.SyncError):provider.google_oauth_resolve(Path(tmp),context(),network,lambda:NOW+3570)
                    self.assertEqual(memory.values,before)
        with tempfile.TemporaryDirectory() as tmp:
            memory=MemoryStore();network=Mock();expired=provider._google_record(context(),reply(refresh_token_expires_in=30),NOW)
            with memory.patches():
                provider.google_oauth_save_record(Path(tmp),context(),expired)
                with self.assertRaisesRegex(provider.SyncError,'REAUTHORIZATION_REQUIRED'):
                    provider.google_oauth_resolve(Path(tmp),context(),network,lambda:NOW+31)
                network.assert_not_called()
    def test_wrong_org_instance_folder_alias_or_client_never_reaches_refresh(self):
        changes=[{'orgId':'other-org'},{'instanceId':'b'*32},{'folderId':'other-folder'},
                 {'credentialRef':'AURORA_GOOGLE_OAUTH_'+'F'*32},{'clientId':'87654321-other.apps.googleusercontent.com'}]
        for change in changes:
            with tempfile.TemporaryDirectory() as tmp:
                memory=MemoryStore();network=Mock()
                with memory.patches():
                    provider.google_oauth_save_record(Path(tmp),context(),grant())
                    altered={**grant(),**change};memory.values[(ORG,context()['credentialRef'])]=store.encode_record(altered)
                    before=dict(memory.values)
                    with self.subTest(change=change),self.assertRaisesRegex(provider.SyncError,'BINDING_CONFLICT'):
                        provider.google_oauth_resolve(Path(tmp),context(),network,lambda:NOW+3570)
                    self.assertEqual(memory.values,before);network.assert_not_called()
    def test_plain_legacy_token_or_noncanonical_record_is_not_implicitly_migrated(self):
        for encoded in ('legacy-token','eyJhIjogMX0',base64.urlsafe_b64encode(b'{"a":1,"a":2}').decode().rstrip('=')):
            with patch.object(store,'load',return_value=encoded):
                with self.subTest(encoded=encoded),self.assertRaisesRegex(provider.SyncError,'PROTECTED_RECORD_INVALID'):
                    store.load_record(None,ORG,context()['credentialRef'])


class GoogleOAuthAgentTests(unittest.TestCase):
    def config(self,base,client=CLIENT):
        return {'schemaVersion':agent.SCHEMA,'instanceId':INSTANCE,'org':ORG,'origin':'https://auroranexus.com.br',
                'stateDir':str(base/'state'),'roots':[],'providers':[source(client)],'tokenEnv':'AURORA_APP_TOKEN',
                'authorization':{'approved':True,'actorRef':'synthetic-admin','documentRef':'synthetic-consent','expiresAt':'2099-01-01T00:00:00Z'}}
    def test_missing_client_id_returns_pending_without_network_secret_store_or_state_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp),None);transport=Mock();pull=Mock()
            with patch.object(agent,'load_secret') as load,patch.object(agent,'google_oauth_resolve') as resolve:
                result=agent.cycle(config,{},transport,pull,verify_installation=True)
                self.assertEqual(result['state'],'PENDING_CONFIGURATION');self.assertFalse(result['installationReadiness']['eligible'])
                transport.assert_not_called();pull.assert_not_called();load.assert_not_called();resolve.assert_not_called()
                self.assertFalse(Path(config['stateDir']).exists())
    def test_wrong_aurora_tenant_blocks_before_oauth_resolution_and_provider_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));transport=Mock(return_value=(200,{'ok':True,'orgId':'other-org'}));pull=Mock()
            with patch.object(agent,'google_oauth_resolve') as resolve:
                with self.assertRaisesRegex(provider.SyncError,'ORGANIZATION_MISMATCH'):
                    agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic'},transport,pull)
                resolve.assert_not_called();pull.assert_not_called()
    def test_401_refreshes_once_and_preserves_canonical_receipt_and_replay_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=self.config(Path(tmp));page={'documents':[fixture()],'pendingExtraction':0,'coverageLimited':False,'nextCursor':None}
            pull=Mock(side_effect=[provider.ProviderAuthenticationError(401),page])
            with patch.object(agent,'google_oauth_resolve',side_effect=[('old-access',{'refreshPerformedThisRun':False}),('new-access',{'refreshPerformedThisRun':True})]) as resolve:
                result=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic','AURORA_OLD_ACCESS':'must-not-use'},CanonicalTransport(),pull,True)
            self.assertEqual(resolve.call_count,2);self.assertTrue(resolve.call_args.kwargs['force_refresh'])
            self.assertEqual(pull.call_count,2);self.assertEqual(pull.call_args.kwargs['oauth_access_token'],'new-access')
            self.assertEqual(pull.call_args.kwargs['environment'],{});self.assertTrue(result['installationReadiness']['eligible'])
            self.assertTrue(result['installationReadiness']['oauthEnrollmentOrRefreshPerformed']);self.assertFalse(result['fullSynchronizationVerified'])
    def test_403_or_revoked_refresh_never_uses_legacy_token_or_claims_installation(self):
        for code in (401,403):
            with tempfile.TemporaryDirectory() as tmp:
                config=self.config(Path(tmp));pull=Mock(side_effect=provider.ProviderAuthenticationError(code))
                results=[('old-access',{'refreshPerformedThisRun':False}),provider.SyncError('GOOGLE_OAUTH_REAUTHORIZATION_REQUIRED')]
                with patch.object(agent,'google_oauth_resolve',side_effect=results) as resolve:
                    result=agent.cycle(config,{'AURORA_APP_TOKEN':'synthetic','AURORA_OLD_ACCESS':'must-not-use'},CanonicalTransport(),pull,True)
                self.assertEqual(resolve.call_count,2 if code==401 else 1);self.assertEqual(pull.call_count,1)
                self.assertFalse(result['installationReadiness']['eligible']);self.assertEqual(result['receiptsConfirmed'],0)

if __name__=='__main__':unittest.main()
