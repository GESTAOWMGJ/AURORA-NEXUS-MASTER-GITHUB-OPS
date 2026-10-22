"""Same packaged TypeScript engine, via a private Node pipe; raw text stays in RAM.

CLI output is a minimized preview/observation receipt. This module does not create
an executor, watch a folder, authorize a provider or complete an installation.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

import aurora_cloud_sync as sync

MAX_BYTES=1048576
MAX_OUTPUT=16*1048576
ASSET_MANIFEST='document-intake-manifest.json'
ASSET_FILES=('document_intake_core.cjs','document_fact_mapping.cjs','document_intake.cjs','document_intake.py')
MIMES={'.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.json':'application/json','.xml':'application/xml',
       '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       '.odt':'application/vnd.oasis.opendocument.text','.ods':'application/vnd.oasis.opendocument.spreadsheet',
       '.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.tif':'image/tiff','.tiff':'image/tiff'}

def _safe_path(value):
    path=Path(value).absolute()
    if '..' in path.parts:raise sync.SyncError('INTAKE_PATH_REJECTED')
    for part in (path,*path.parents):
        if part.is_symlink() or (hasattr(part,'is_junction') and part.is_junction()):
            # Standard immutable macOS aliases are not user-controlled links.
            if not (sys.platform=='darwin' and str(part) in ('/var','/tmp')
                    and str(part.resolve())=='/private'+str(part)):raise sync.SyncError('INTAKE_PATH_REJECTED')
    return path

def _regular_bytes(path,maximum):
    path=_safe_path(path)
    try:
        before=path.stat(follow_symlinks=False)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size>maximum:raise sync.SyncError('INTAKE_REGULAR_BOUNDED_FILE_REQUIRED')
        with path.open('rb') as stream:
            opened=os.fstat(stream.fileno());raw=stream.read(maximum+1);after=os.fstat(stream.fileno())
        named=path.stat(follow_symlinks=False)
        identity=lambda item:(item.st_dev,item.st_ino,item.st_size,item.st_mtime_ns,item.st_nlink)
        if len(raw)>maximum or not all(identity(item)==identity(before) for item in (opened,after,named)):
            raise sync.SyncError('INTAKE_SOURCE_CHANGED')
        return raw
    except sync.SyncError:raise
    except OSError:raise sync.SyncError('INTAKE_FILE_UNAVAILABLE') from None

def _json(raw):
    return json.loads(raw,object_pairs_hook=sync.unique_object,
        parse_constant=lambda _value:(_ for _ in ()).throw(ValueError('NONFINITE_JSON')))

def verify_assets(directory=None):
    directory=_safe_path(directory or Path(__file__).absolute().parent)
    try:manifest=_json(_regular_bytes(directory/ASSET_MANIFEST,16384))
    except (ValueError,UnicodeError):raise sync.SyncError('DOCUMENT_INTAKE_ASSET_MANIFEST_INVALID') from None
    if (not isinstance(manifest,dict) or set(manifest)!={'schemaVersion','generatorVersion','compilerVersion','sources','files'}
            or manifest['schemaVersion']!='aurora.document.intake.assets.v1' or manifest['generatorVersion']!='1.0.0'
            or not isinstance(manifest['compilerVersion'],str) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',manifest['compilerVersion'])
            or not isinstance(manifest['sources'],dict) or set(manifest['sources'])!={'auroraDocumentIntakeCore.ts','auroraDocumentFactMapping.ts'}
            or not isinstance(manifest['files'],dict) or set(manifest['files'])!=set(ASSET_FILES)
            or any(not isinstance(pin,str) or not re.fullmatch(r'[a-f0-9]{64}',pin)
                   for pin in [*manifest['sources'].values(),*manifest['files'].values()])):
        raise sync.SyncError('DOCUMENT_INTAKE_ASSET_MANIFEST_INVALID')
    for name,pin in manifest['files'].items():
        if hashlib.sha256(_regular_bytes(directory/name,MAX_BYTES)).hexdigest()!=pin:
            raise sync.SyncError('DOCUMENT_INTAKE_ASSET_CHANGED')
    return {'manifestSha256':hashlib.sha256(_regular_bytes(directory/ASSET_MANIFEST,16384)).hexdigest(),
            'sourceSha256':dict(manifest['sources']),'assetSha256':dict(manifest['files'])}

def _child_environment():
    # No bearer, OAuth grant, NODE_OPTIONS, NODE_PATH, Python path or user profile
    # reaches the extractor. All required modules are local and Node built-ins.
    return {**{key:os.environ[key] for key in ('SystemRoot','WINDIR','SYSTEMDRIVE') if key in os.environ},'TZ':'UTC'}

def _node(node=None):
    value=str(node) if node is not None else shutil.which('node')
    if not value:return None
    try:
        executable=Path(value).resolve(strict=True)
        if not executable.is_file():return None
        version=subprocess.run([str(executable),'--version'],stdin=subprocess.DEVNULL,capture_output=True,
            timeout=5,shell=False,env=_child_environment(),creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        match=re.fullmatch(rb'v([0-9]+)\.[0-9]+\.[0-9]+\r?\n?',version.stdout)
        return str(executable) if version.returncode==0 and match and int(match[1])>=22 else None
    except (OSError,subprocess.SubprocessError):return None

def _pending(raw):
    return {'schemaVersion':'aurora.document.intake.preview.v1','byteSha256':hashlib.sha256(raw).hexdigest(),'byteLength':len(raw),
        'extraction':{'status':'PENDING','method':None,'methodVersion':'1.0.0','textSha256':None,'textByteLength':0,
            'coverage':{'basis':'EXPECTED_PARTS','totalUnits':0,'processedUnits':0},'code':'BACKEND_REQUIRED'},
        'factCandidates':None,'nativeReady':False,'sourceIndependent':False,'installationComplete':False}

def _minimized_mapping(value):
    fields={'schemaVersion','mappingVersion','status','representationByteSha256','extractedTextSha256','evidenceAuthority',
            'reviewRequired','canonicalPromotionAllowed','nativeReady','sourceIndependent','candidates','warnings'}
    if (not isinstance(value,dict) or set(value)!=fields or value['schemaVersion']!='aurora.document.fact-candidates.v1'
        or value['mappingVersion']!='1.0.0' or value['status'] not in {'HUMAN_REVIEW_REQUIRED','NO_SUPPORTED_LAYOUT','INCOMPLETE_EXTRACTION','INVALID_FACTS','CONFLICTING_FACTS','LIMIT_EXCEEDED'}
        or value['evidenceAuthority']!='AUTHENTICATED_CLIENT_OBSERVATION_NOT_PROVIDER_SIGNATURE'
        or value['reviewRequired'] is not True or any(value[key] is not False for key in ('canonicalPromotionAllowed','nativeReady','sourceIndependent'))
        or not isinstance(value['candidates'],list) or len(value['candidates'])>128
        or not isinstance(value['warnings'],list) or len(value['warnings'])>3
        or any(item not in {'INVOICE_IS_NOT_RECEIPT','BANK_ENTRY_IS_NOT_REVENUE','UNMAPPED_TABLE_PRESENT'} for item in value['warnings'])):
        raise sync.SyncError('DOCUMENT_INTAKE_RESPONSE_INVALID')
    for candidate in value['candidates']:
        invoice=isinstance(candidate,dict) and candidate.get('kind')=='BILLING_INVOICE'
        expected={'ruleId','kind','amountCents','issueDate','issuedAt','fieldLocators'} if invoice else {
            'ruleId','kind','amountCents','direction','bookingDate','statedBalanceCents','fieldLocators'}
        locators={'amount','date'} if invoice else {'amount','date','direction','balance'}
        if (not isinstance(candidate,dict) or set(candidate)!=expected or candidate.get('ruleId')!=('AURORA_NFE_TOTAL_V1' if invoice else 'AURORA_BANK_EXPLICIT_PTBR_V1')
            or candidate.get('kind')!=('BILLING_INVOICE' if invoice else 'STATEMENT_ENTRY')
            or not isinstance(candidate.get('fieldLocators'),dict) or set(candidate['fieldLocators'])!=locators
            or any(item is not None and (not isinstance(item,str) or not 1<=len(item)<=4096) for item in candidate['fieldLocators'].values())
            or type(candidate.get('amountCents')) is not int or not 0<=candidate['amountCents']<=9007199254740991):
            raise sync.SyncError('DOCUMENT_INTAKE_RESPONSE_INVALID')
        if invoice:
            if not isinstance(candidate['issueDate'],str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',candidate['issueDate']):raise sync.SyncError('DOCUMENT_INTAKE_RESPONSE_INVALID')
            if candidate['issuedAt'] is not None and (not isinstance(candidate['issuedAt'],str) or len(candidate['issuedAt'])>40):raise sync.SyncError('DOCUMENT_INTAKE_RESPONSE_INVALID')
        elif (candidate['direction'] not in ('CREDIT','DEBIT') or not isinstance(candidate['bookingDate'],str)
              or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',candidate['bookingDate'])
              or candidate['statedBalanceCents'] is not None and (type(candidate['statedBalanceCents']) is not int or abs(candidate['statedBalanceCents'])>9007199254740991)):
            raise sync.SyncError('DOCUMENT_INTAKE_RESPONSE_INVALID')
    return value

def extract_bytes(raw,mime,*,node=None,directory=None):
    if not isinstance(raw,bytes) or not 1<=len(raw)<=MAX_BYTES:raise sync.SyncError('BOUNDED_DOCUMENT_BYTES_REQUIRED')
    if not isinstance(mime,str) or not re.fullmatch(r'[a-z0-9][a-z0-9.+-]{0,79}/[a-z0-9][a-z0-9.+-]{0,159}',mime):raise sync.SyncError('DOCUMENT_MIME_REQUIRED')
    pins=verify_assets(directory);executable=_node(node)
    if executable is None:return {**_pending(raw),'engineAssets':pins}
    directory=_safe_path(directory or Path(__file__).absolute().parent)
    request=json.dumps({'schemaVersion':'aurora.document.intake.request.v1','mime':mime,
        'bytesBase64':base64.b64encode(raw).decode('ascii')},separators=(',',':')).encode('ascii')
    try:
        result=subprocess.run([executable,'--no-warnings','--disable-proto=throw','--max-old-space-size=128',str(directory/'document_intake.cjs')],
            input=request,capture_output=True,timeout=15,shell=False,env=_child_environment(),cwd=str(directory),
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if len(result.stdout)>MAX_OUTPUT or result.returncode!=0:raise sync.SyncError('DOCUMENT_INTAKE_BACKEND_FAILED')
        value=_json(result.stdout)
        if not isinstance(value,dict) or set(value)!={'schemaVersion','core','factCandidates'} or value['schemaVersion']!='aurora.document.intake.result.v1':raise ValueError()
        core=value['core']
        if (not isinstance(core,dict) or set(core)!={'byteSha256','byteLength','text','segments','xmlLeaves','tables','extraction'}
            or core['byteSha256']!=hashlib.sha256(raw).hexdigest() or type(core['byteLength']) is not int or core['byteLength']!=len(raw)
            or not isinstance(core['text'],str) or len(core['text'].encode('utf-8'))>262144):raise ValueError()
        extraction=core['extraction'];text=core['text'].encode('utf-8')
        if (extraction.get('textSha256')!=(hashlib.sha256(text).hexdigest() if text else None)
            or extraction.get('textByteLength')!=len(text)):raise ValueError()
        mapping=_minimized_mapping(value['factCandidates'])
        if mapping['representationByteSha256']!=core['byteSha256'] or mapping['extractedTextSha256']!=extraction['textSha256']:raise ValueError()
        preview={'schemaVersion':'aurora.document.intake.preview.v1','byteSha256':core['byteSha256'],'byteLength':core['byteLength'],
            'extraction':extraction,'factCandidates':mapping,'nativeReady':False,'sourceIndependent':False,'installationComplete':False,'engineAssets':pins}
        # Reuse the closed transport validator before any output can be sent.
        observation_from_bytes(raw,mime,'synthetic','ERP','synthetic-validation',preview=preview)
        return preview
    except sync.SyncError:raise
    except (OSError,ValueError,TypeError,KeyError,AttributeError,UnicodeError,subprocess.SubprocessError):raise sync.SyncError('DOCUMENT_INTAKE_RESPONSE_INVALID') from None

def observation_from_bytes(raw,mime,org,source_system,document_id,*,provider='LOCAL_AGENT',expected_revision=0,
                           expected_previous_observation_hash=None,observed_at=None,preview=None,node=None,directory=None):
    if provider not in ('LOCAL_AGENT','MANUAL'):raise sync.SyncError('EXPLICIT_LOCAL_DOCUMENT_MODE_REQUIRED')
    if not isinstance(org,str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}',org):raise sync.SyncError('INVALID_ORGANIZATION')
    # A supplied preview is only an internal bridge result; byte identity is rechecked.
    if preview is None:preview=extract_bytes(raw,mime,node=node,directory=directory)
    byte_hash=hashlib.sha256(raw).hexdigest()
    if preview.get('byteSha256')!=byte_hash or preview.get('byteLength')!=len(raw):raise sync.SyncError('DOCUMENT_INTAKE_BYTE_BINDING_MISMATCH')
    timestamp=observed_at or datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    return sync.validate_observation_payload({'schemaVersion':'aurora.document.observation.v1','operation':'OBSERVE_DOCUMENT_EXTRACTION',
        'sourceSystem':source_system,'externalDocumentId':document_id,'observedAt':timestamp,'expectedRevision':expected_revision,
        'expectedPreviousObservationHash':expected_previous_observation_hash,
        'acquisition':{'provider':provider,'sourceObjectIdHash':sync.digest('local-document-v1:'+org+':'+provider+':'+document_id),
            'versionKind':'LOCAL_CONTENT_HASH','observedVersion':byte_hash,'representation':'ORIGINAL_BYTES',
            'sourceMimeType':mime,'acquiredMimeType':mime,'byteSha256':byte_hash,'byteLength':len(raw)},'extraction':preview['extraction']})

def observe_file(path,mime,org,source_system,document_id,*,origin='https://auroranexus.com.br',provider='MANUAL',
                 expected_revision=0,expected_previous_observation_hash=None,token=None,send=False,transport=sync.request_json,node=None):
    raw=_regular_bytes(path,MAX_BYTES);preview=extract_bytes(raw,mime,node=node)
    observation=observation_from_bytes(raw,mime,org,source_system,document_id,provider=provider,expected_revision=expected_revision,
        expected_previous_observation_hash=expected_previous_observation_hash,preview=preview)
    # No raw text, source path, XML tree or candidates go to the API.
    receipt=sync.synchronize_observation(observation,origin,org,token,send,transport)
    return {'schemaVersion':'aurora.document.intake.preview.v1','extraction':preview['extraction'],
        'factCandidates':preview['factCandidates'],'engineAssets':preview['engineAssets'],'observationReceipt':receipt,
        'nativeReady':False,'sourceIndependent':False,'installationComplete':False}

def main(argv=None):
    parser=argparse.ArgumentParser(description='Explicit document file, shared Aurora engine; no folder scan or installation acceptance.')
    parser.add_argument('--input',required=True);parser.add_argument('--mime');parser.add_argument('--org',required=True)
    parser.add_argument('--source-system',required=True,choices=['MV','TASY','ERP']);parser.add_argument('--document-id',required=True)
    parser.add_argument('--provider',choices=['LOCAL_AGENT','MANUAL'],default='MANUAL');parser.add_argument('--origin',default='https://auroranexus.com.br')
    parser.add_argument('--expected-revision',type=int,default=0);parser.add_argument('--previous-observation-hash');parser.add_argument('--send',action='store_true')
    args=parser.parse_args(argv)
    try:
        mime=args.mime or MIMES.get(Path(args.input).suffix.lower(),'application/octet-stream')
        result=observe_file(args.input,mime,args.org,args.source_system,args.document_id,origin=args.origin,provider=args.provider,
            expected_revision=args.expected_revision,expected_previous_observation_hash=args.previous_observation_hash,
            token=os.environ.get('AURORA_INTEGRATION_TOKEN'),send=args.send)
        print(json.dumps(result,sort_keys=True,allow_nan=False));return 0
    except (sync.SyncError,OSError,ValueError):
        print(json.dumps({'state':'BLOCKED','code':'DOCUMENT_INTAKE_PENDING','installationComplete':False}));return 2

if __name__=='__main__':raise SystemExit(main())
