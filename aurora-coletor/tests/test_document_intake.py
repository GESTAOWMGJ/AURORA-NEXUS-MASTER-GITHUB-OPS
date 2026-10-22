"""Actual synthetic bytes through the packaged SAME TS engine; no live service."""
import copy
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SOURCE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SOURCE))
import document_intake as intake
import aurora_cloud_sync as sync
import aurora_deployment as deployment
import install_client_agent as installer
import client_agent as agent
NODE=intake._node()

def packed(parts):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,content in parts.items():archive.writestr(name,content)
    return output.getvalue()

def docx(text='Synthetic document body'):
    return packed({'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
        'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>'})

class SyntheticServer:
    def __init__(self):self.documents={};self.receipts={};self.calls=[]
    def __call__(self,url,token,payload=None,idempotency=None):
        self.calls.append((url,token,payload,idempotency))
        if payload is None:return 200,{'ok':True,'orgId':'synthetic','service':'aurora-nexus-integration','keyId':'ik_'+'a'*16}
        value=sync.validate_observation_payload(payload)
        document_id=sync.digest('synthetic:'+value['sourceSystem']+':'+value['externalDocumentId'])[:48]
        observed_hash=sync.observation_hash(value,'synthetic');duplicate=document_id in self.documents
        if duplicate:self_test=self.documents[document_id];assert self_test==observed_hash
        self.documents[document_id]=observed_hash
        receipt_id=sync.digest('document-observation:ik_'+'a'*16+':'+idempotency);revision=1
        version_id=sync.digest('v1:sourceDocument:'+value['sourceSystem']+':'+sync.digest('synthetic:'+value['sourceSystem']+':'+value['externalDocumentId'])[:32]+':revision:1')[:48]
        result={'ok':True,'kind':'DUPLICATE' if duplicate else 'RECORDED','schemaVersion':sync.OBSERVATION_RECEIPT_SCHEMA,
            'code':'DOCUMENT_OBSERVATION_RECORDED','orgId':'synthetic','documentId':document_id,'receiptId':receipt_id,
            'versionId':version_id,'revision':revision,'observationHash':observed_hash,
            'acquisitionHash':sync.observation_acquisition_hash(value['acquisition']),'extractionStatus':value['extraction']['status'],
            'nativeReady':False,'sourceIndependent':False,'sourceVersion':None,'firstIngestionVerified':False,
            'operationalComplete':False,'recorded':not duplicate,'duplicate':duplicate,'accepted':False}
        self.receipts[receipt_id]=copy.deepcopy(result)
        return (200 if duplicate else 202),result


@unittest.skipUnless(NODE,'Node 22+ required for real local-engine assertions')
class DocumentIntakeTests(unittest.TestCase):
    def test_same_generated_assets_pass_source_recompile_gate(self):
        root=SOURCE.parent
        result=subprocess.run([NODE,str(root/'firebase-migration/scripts/generate-document-intake-assets.mjs'),'--check'],
            cwd=root,capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(json.loads(result.stdout)['status'],'GENERATED_BYTES_VERIFIED')
        self.assertEqual(set(deployment.ASSETS),set(installer.ASSETS));self.assertEqual(len(deployment.ASSETS),12)

    def test_actual_utf8_bytes_have_distinct_normalized_text_hash_and_no_narrative_in_public_preview(self):
        raw='Café\r\nNever export this narrative\r\n'.encode()
        result=intake.extract_bytes(raw,'text/plain')
        self.assertEqual(result['byteSha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(result['extraction']['textSha256'],hashlib.sha256('Café\nNever export this narrative\n'.encode()).hexdigest())
        self.assertEqual(result['extraction']['status'],'COMPLETE');self.assertEqual(result['extraction']['method'],'TEXT_UTF8')
        self.assertNotIn('Never export this narrative',json.dumps(result));self.assertNotIn('segments',result)
        self.assertFalse(result['nativeReady']);self.assertFalse(result['sourceIndependent']);self.assertFalse(result['installationComplete'])

    def test_actual_deflated_docx_requires_the_same_opc_and_namespace_contract(self):
        valid=intake.extract_bytes(docx(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        self.assertEqual(valid['extraction']['status'],'COMPLETE');self.assertEqual(valid['extraction']['method'],'DOCX_XML')
        malformed=intake.extract_bytes(packed({'word/document.xml':'<document>untrusted incomplete package</document>'}),
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        self.assertEqual(malformed['extraction']['status'],'FAILED');self.assertIsNone(malformed['extraction']['textSha256'])

    def test_nfe_and_statement_candidates_are_ephemeral_minimized_review_only(self):
        xml=b'<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe><ide><dhEmi>2026-10-20T10:30:00-03:00</dhEmi></ide><total><ICMSTot><vNF>1234.56</vNF></ICMSTot></total><infAdic><infCpl>Never export issuer account narrative</infCpl></infAdic></infNFe></NFe>'
        result=intake.extract_bytes(xml,'application/xml');mapped=result['factCandidates']
        self.assertEqual(mapped['status'],'HUMAN_REVIEW_REQUIRED');self.assertEqual(mapped['candidates'][0]['amountCents'],123456)
        self.assertNotIn('Never export issuer account narrative',json.dumps(result));self.assertFalse(mapped['canonicalPromotionAllowed'])
        csv=b'DATA,TIPO,VALOR\n01/10/2026,CREDITO,"1.234,56"\n'
        candidate=intake.extract_bytes(csv,'text/csv')['factCandidates']
        self.assertFalse(candidate['nativeReady']);self.assertFalse(candidate['sourceIndependent'])

    def test_pdf_image_and_unknown_formats_remain_pending_without_installing_or_guessing_backend(self):
        for mime,raw,code in [('application/pdf',b'%PDF-1.4 synthetic','BACKEND_REQUIRED'),('image/png',b'\x89PNG synthetic','BACKEND_REQUIRED'),
                              ('application/octet-stream',b'opaque synthetic','UNSUPPORTED_FORMAT')]:
            result=intake.extract_bytes(raw,mime)
            self.assertEqual(result['extraction']['status'],'PENDING');self.assertEqual(result['extraction']['code'],code)
            self.assertFalse(result['installationComplete']);self.assertIsNone(result['extraction']['textSha256'])

    def test_missing_runtime_and_incompatible_mime_or_size_cannot_claim_readiness(self):
        with patch.object(intake,'_node',return_value=None):pending=intake.extract_bytes(b'Synthetic','text/plain')
        self.assertEqual(pending['extraction']['code'],'BACKEND_REQUIRED');self.assertFalse(pending['installationComplete'])
        for raw in (b'',b'x'*(1048576+1)):
            with self.assertRaises(sync.SyncError):intake.extract_bytes(raw,'text/plain')
        with self.assertRaises(sync.SyncError):intake.extract_bytes(b'Synthetic','text/plain; token=forbidden')

    def test_child_uses_fixed_local_code_stdin_and_cleans_tokens_node_options_and_search_path(self):
        original=subprocess.run;calls=[]
        def checked(*args,**kwargs):calls.append((args,kwargs));return original(*args,**kwargs)
        with patch.dict(os.environ,{'NODE_OPTIONS':'--require=forbidden-synthetic-file','NODE_PATH':'forbidden-synthetic-modules',
                'AURORA_INTEGRATION_TOKEN':'synthetic-never-forward','GOOGLE_ACCESS_TOKEN':'synthetic-never-forward'}),patch.object(intake.subprocess,'run',side_effect=checked):
            result=intake.extract_bytes(b'Private synthetic body','text/plain')
        self.assertEqual(result['extraction']['status'],'COMPLETE')
        for args,kwargs in calls:
            self.assertFalse(kwargs['shell']);self.assertIsInstance(args[0],list)
            self.assertFalse(any(key in kwargs['env'] for key in ('NODE_OPTIONS','NODE_PATH','AURORA_INTEGRATION_TOKEN','GOOGLE_ACCESS_TOKEN','PYTHONPATH')))
            self.assertNotIn('Private synthetic body',' '.join(args[0]))
        self.assertEqual(len(calls),2)

    def test_local_bytes_to_observation_fake_persistence_and_exact_replay_never_become_installed_facts(self):
        raw='Faturamento sintético R$ 1.234,56\n'.encode()
        observation=intake.observation_from_bytes(raw,'text/plain','synthetic','ERP','synthetic-document',observed_at='2026-10-20T11:00:00.000Z')
        self.assertEqual(observation['acquisition']['observedVersion'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(observation['sourceSystem'],'ERP');self.assertNotIn('sourceVersion',observation)
        for field in ('text','amountCents','count','competence','nativeReady','sourceIndependent'):self.assertNotIn(field,observation)
        server=SyntheticServer()
        first=sync.synchronize_observation(observation,'https://synthetic.example.invalid','synthetic','synthetic-token',True,server)
        second=sync.synchronize_observation(observation,'https://synthetic.example.invalid','synthetic','synthetic-token',True,server,previous_receipt=first)
        self.assertEqual(first['status'],'OBSERVATION_RECORDED');self.assertEqual(second['status'],'OBSERVATION_DUPLICATE')
        self.assertEqual(first['idempotencyKey'],second['idempotencyKey']);self.assertEqual(len(server.documents),1);self.assertEqual(len(server.receipts),1)
        for receipt in (first,second):
            self.assertTrue(receipt['cloudReceiptVerified']);self.assertFalse(receipt['firstIngestionVerified'])
            self.assertFalse(receipt['operationalComplete']);self.assertFalse(receipt['installationComplete']);self.assertIsNone(receipt['sourceVersion'])
            self.assertNotIn('installationAcceptance',receipt)
        self.assertNotIn('Faturamento sintético',json.dumps(server.calls))

    def test_observation_receipt_cannot_promote_flags_version_or_rename_tenant(self):
        raw=b'Synthetic';observation=intake.observation_from_bytes(raw,'text/plain','synthetic','ERP','synthetic-document',observed_at='2026-10-20T11:00:00.000Z')
        for field,value in [('nativeReady',True),('sourceIndependent',True),('firstIngestionVerified',True),('operationalComplete',True),
                            ('sourceVersion',1),('orgId','other-org'),('observationHash','0'*64),('versionId','0'*48),('receiptId','0'*64)]:
            server=SyntheticServer()
            def changed(*args,**kwargs):
                status,result=server(*args,**kwargs)
                if len(args)>2 and args[2] is not None:result[field]=value
                return status,result
            with self.subTest(field=field),self.assertRaisesRegex(sync.SyncError,'DOCUMENT_OBSERVATION_RECEIPT_MISMATCH'):
                sync.synchronize_observation(observation,'https://synthetic.example.invalid','synthetic','synthetic-token',True,changed)

    def test_receipt_is_bound_to_authenticated_key_exact_idempotency_and_replayed_revision(self):
        observation=intake.observation_from_bytes(b'Synthetic','text/plain','synthetic','ERP','synthetic-document',observed_at='2026-10-20T11:00:00.000Z')
        for mode in ('other-key','other-idempotency'):
            server=SyntheticServer()
            def changed(*args,**kwargs):
                status,result=server(*args,**kwargs)
                if len(args)<3 and mode=='other-key':result['keyId']='ik_'+'b'*16
                elif len(args)>2 and mode=='other-idempotency':result['receiptId']=sync.digest('document-observation:ik_'+'a'*16+':different-key')
                return status,result
            with self.assertRaisesRegex(sync.SyncError,'DOCUMENT_OBSERVATION_RECEIPT_MISMATCH'):
                sync.synchronize_observation(observation,'https://synthetic.example.invalid','synthetic','synthetic-token',True,changed)
        server=SyntheticServer();first=sync.synchronize_observation(observation,'https://synthetic.example.invalid','synthetic','synthetic-token',True,server)
        changed=copy.deepcopy(first);changed['revision']=2
        with self.assertRaisesRegex(sync.SyncError,'DOCUMENT_OBSERVATION_REPLAY_MISMATCH'):
            sync.synchronize_observation(observation,'https://synthetic.example.invalid','synthetic','synthetic-token',True,server,previous_receipt=changed)

    def test_flat_package_runs_with_only_bundled_modules_and_blocks_changed_asset(self):
        with tempfile.TemporaryDirectory() as temporary:
            package=Path(temporary)/'package';package.mkdir()
            for name in deployment.ASSETS:shutil.copyfile(SOURCE/name,package/name)
            text=Path(temporary)/'explicit.txt';text.write_text('Never print the raw synthetic document',encoding='utf-8')
            command=[sys.executable,'-I','-B',str(package/'document_intake.py'),'--input',str(text),'--org','synthetic','--source-system','ERP','--document-id','synthetic-flat-document']
            # Python -I does not prepend a script directory; use an isolated
            # launcher which admits exactly the bundled directory, not this repo.
            launcher="import runpy,sys;sys.path.insert(0,sys.argv[1]);sys.argv=sys.argv[2:];runpy.run_path(sys.argv[0],run_name='__main__')"
            command=[sys.executable,'-I','-B','-c',launcher,str(package),*command[3:]]
            run=subprocess.run(command,capture_output=True,text=True,timeout=25,cwd=temporary)
            self.assertEqual(run.returncode,0,run.stderr);result=json.loads(run.stdout)
            self.assertEqual(result['extraction']['status'],'COMPLETE');self.assertFalse(result['installationComplete'])
            self.assertNotIn('Never print the raw synthetic document',run.stdout);self.assertNotIn(str(SOURCE),run.stdout)
            (package/'document_intake_core.cjs').write_text('throw Error("do not execute changed code")')
            blocked=subprocess.run(command,capture_output=True,text=True,timeout=25,cwd=temporary)
            self.assertEqual(blocked.returncode,2);self.assertFalse(json.loads(blocked.stdout)['installationComplete'])
            self.assertNotIn('do not execute changed code',blocked.stderr+blocked.stdout)

    def test_existing_agent_explicit_file_stays_inside_authorized_root_and_separate_from_watcher(self):
        with tempfile.TemporaryDirectory() as temporary:
            base=Path(temporary);root=base/'approved';root.mkdir();state=base/'state';state.mkdir();document=root/'explicit.txt';document.write_text('Synthetic authorized content')
            config={'schemaVersion':agent.SCHEMA,'org':'synthetic','origin':'https://synthetic.example.invalid','stateDir':str(state),
                'instanceId':'a'*32,'roots':[str(root)],'providers':[],'tokenEnv':'AURORA_SYNTHETIC_TOKEN',
                'authorization':{'approved':True,'actorRef':'synthetic-admin','documentRef':'synthetic-authorization','expiresAt':'2099-01-01T00:00:00Z'}}
            config_path=base/'config.json';config_path.write_text(json.dumps(config))
            args=['--config',str(config_path),'--observe-document',str(document),'--document-system','ERP','--document-id','synthetic-explicit-document']
            output=io.StringIO()
            with redirect_stdout(output):self.assertEqual(agent.main(args),0)
            self.assertFalse(json.loads(output.getvalue())['installationComplete']);self.assertEqual(list(state.iterdir()),[])
            with self.assertRaisesRegex(sync.SyncError,'SEPARATE_EXPLICIT_DOCUMENT'):
                agent.main(args+['--watch'])
            outside=base/'outside.txt';outside.write_text('outside authorized root');args[3]=str(outside)
            with self.assertRaisesRegex(sync.SyncError,'DOCUMENT_OUTSIDE_AUTHORIZED_ROOT'):agent.main(args)


if __name__=='__main__':unittest.main()
