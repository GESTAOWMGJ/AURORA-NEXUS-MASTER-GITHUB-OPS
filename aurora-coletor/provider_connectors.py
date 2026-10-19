"""Read-only, explicitly scoped provider adapters for the existing Aurora collector.

OAuth access tokens belong to the installed protected component, never the web UI.
The adapters parse reviewed canonical JSON or explicitly headed CSV/XLSX tables;
they do not mark arbitrary mail bodies/PDFs as extracted facts. Google desktop
OAuth is opt-in and needs a separately registered client and personal consent.
No narrative or PHI is sent to the generic API.
"""
import base64
import csv
import email
import imaplib
import io
import json
import hashlib
import math
import os
import re
import secrets
import ssl
import stat
import time
import zipfile
import xml.etree.ElementTree as ET
from urllib import request, parse, error

from aurora_cloud_sync import validate_payload, SyncError, unique_object, FIELDS, ACQUISITION_SCHEMA, ACQUISITION_MIMES, record_text, digest
import client_secret_store as secret_store

MAX_EXPORT_BYTES = 16384
MAX_PROVIDER_BYTES = 1048576
MAX_ITEMS = 20
PROVIDERS = {'GOOGLE_DRIVE', 'GMAIL', 'MICROSOFT_MAIL', 'IMAP', 'NOTION', 'SLACK'}
EXPORT_SUFFIXES = ('.json', '.csv', '.xlsx')
GOOGLE_SCOPE='https://www.googleapis.com/auth/drive.readonly'
GOOGLE_OAUTH_SCHEMA='aurora.google.oauth.source.v1'
GOOGLE_GRANT_SCHEMA='aurora.google.oauth.grant.v1'
GOOGLE_CALLBACK_PATH='/aurora-google-oauth/callback'
GOOGLE_OAUTH_TTL_SECONDS=180


class ProviderAuthenticationError(SyncError):
    def __init__(self,status):
        super().__init__('PROVIDER_AUTH_REQUIRED')
        self.status=status


def google_oauth_credential_ref(org,instance_id,folder_id):
    binding=org+':'+instance_id+':GOOGLE_DRIVE:'+folder_id
    return 'AURORA_GOOGLE_OAUTH_'+hashlib.sha256(binding.encode()).hexdigest()[:32].upper()


def google_oauth_context(source,org,instance_id):
    if (not isinstance(source,dict) or set(source)!={'provider','folderId','oauth'}
            or source.get('provider')!='GOOGLE_DRIVE'
            or not isinstance(org,str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}',org)
            or not isinstance(instance_id,str) or not re.fullmatch(r'[a-f0-9]{32}',instance_id)):
        raise SyncError('GOOGLE_OAUTH_CONFIGURATION_REQUIRED')
    folder=identifier(source.get('folderId'));oauth=source['oauth']
    if (not isinstance(oauth,dict) or set(oauth)!={'schemaVersion','clientId','credentialRef','scopeProfile'}
            or oauth.get('schemaVersion')!=GOOGLE_OAUTH_SCHEMA
            or oauth.get('scopeProfile')!='DRIVE_READONLY_EXISTING_FOLDER'
            or oauth.get('credentialRef')!=google_oauth_credential_ref(org,instance_id,folder)
            or (oauth.get('clientId') is not None and (not isinstance(oauth['clientId'],str)
                or not re.fullmatch(r'[A-Za-z0-9_-]{8,220}\.apps\.googleusercontent\.com',oauth['clientId'])))):
        raise SyncError('GOOGLE_OAUTH_CONFIGURATION_REQUIRED')
    context={'orgId':org,'instanceId':instance_id,'provider':'GOOGLE_DRIVE','folderId':folder,
             'clientId':oauth['clientId'],'credentialRef':oauth['credentialRef'],'scopeProfile':oauth['scopeProfile']}
    context['bindingSha256']=secret_store.record_digest(context)
    return context


def _google_context(context,configured=True):
    if not isinstance(context,dict):raise SyncError('GOOGLE_OAUTH_CONFIGURATION_REQUIRED')
    expected=google_oauth_context({'provider':context.get('provider'),'folderId':context.get('folderId'),
        'oauth':{'schemaVersion':GOOGLE_OAUTH_SCHEMA,'clientId':context.get('clientId'),
                 'credentialRef':context.get('credentialRef'),'scopeProfile':context.get('scopeProfile')}},
        context.get('orgId'),context.get('instanceId'))
    if context!=expected or (configured and context['clientId'] is None):
        raise SyncError('GOOGLE_OAUTH_CONFIGURATION_REQUIRED')


def _google_time(clock):
    value=clock()
    if type(value) not in (int,float) or not math.isfinite(value) or not 0<value<9007199254740991:
        raise SyncError('GOOGLE_OAUTH_CLOCK_REQUIRED')
    return int(value)


def _google_redirect(value):
    try:
        uri=parse.urlsplit(value)
        valid=(uri.scheme=='http' and uri.hostname=='127.0.0.1' and uri.netloc=='127.0.0.1:'+str(uri.port)
               and uri.port is not None and 1<=uri.port<=65535 and uri.path==GOOGLE_CALLBACK_PATH
               and not uri.query and not uri.fragment and not uri.username and not uri.password)
    except (ValueError,TypeError):valid=False
    if not valid:raise SyncError('GOOGLE_OAUTH_REDIRECT_REJECTED')


def google_oauth_begin(context,redirect_uri,clock=time.time):
    _google_context(context);_google_redirect(redirect_uri)
    verifier=secrets.token_urlsafe(48);state=secrets.token_urlsafe(32)
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).decode('ascii').rstrip('=')
    fields={'client_id':context['clientId'],'redirect_uri':redirect_uri,'response_type':'code',
            'scope':GOOGLE_SCOPE,'code_challenge':challenge,'code_challenge_method':'S256','state':state,
            'access_type':'offline','prompt':'consent'}
    return {'context':dict(context),'redirectUri':redirect_uri,'startedAt':_google_time(clock),
            'codeVerifier':verifier,'state':state,
            'authorizationUrl':'https://accounts.google.com/o/oauth2/v2/auth?'+parse.urlencode(fields)}


def _google_error(value):
    code=value.get('error') if isinstance(value,dict) else None
    if code in ('invalid_client','unauthorized_client','invalid_scope'):
        raise SyncError('GOOGLE_OAUTH_CLIENT_CONFIGURATION_REQUIRED')
    if code in ('invalid_grant','access_denied','admin_policy_enforced'):
        raise SyncError('GOOGLE_OAUTH_REAUTHORIZATION_REQUIRED')
    raise SyncError('GOOGLE_OAUTH_UNAVAILABLE')


def google_oauth_token_request(fields):
    """Only Google's fixed TLS endpoint; authorization codes and tokens stay in RAM."""
    kind=fields.get('grant_type') if isinstance(fields,dict) else None
    expected={'client_id','grant_type','code','code_verifier','redirect_uri'} if kind=='authorization_code' else {'client_id','grant_type','refresh_token'}
    if (kind not in ('authorization_code','refresh_token') or set(fields)!=expected
            or any(not isinstance(value,str) or not value or len(value)>4096 or any(c in value for c in '\r\n\x00') for value in fields.values())):
        raise SyncError('GOOGLE_OAUTH_REQUEST_REJECTED')
    req=request.Request('https://oauth2.googleapis.com/token',data=parse.urlencode(fields).encode('ascii'),
        headers={'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},method='POST')
    try:
        with request.build_opener(NoRedirect(),request.HTTPSHandler(context=ssl.create_default_context())).open(req,timeout=20) as response:
            raw=response.read(16385)
            if response.status!=200 or response.headers.get_content_type()!='application/json' or len(raw)>16384:
                raise SyncError('GOOGLE_OAUTH_RESPONSE_INVALID')
    except error.HTTPError as exc:
        raw=exc.read(16385)
        if len(raw)>16384:raise SyncError('GOOGLE_OAUTH_RESPONSE_INVALID') from None
        try:value=json.loads(raw,object_pairs_hook=unique_object)
        except (ValueError,UnicodeError):raise SyncError('GOOGLE_OAUTH_UNAVAILABLE') from None
        _google_error(value)
    except (OSError,error.URLError):raise SyncError('GOOGLE_OAUTH_UNAVAILABLE') from None
    try:value=json.loads(raw,object_pairs_hook=unique_object)
    except (ValueError,UnicodeError):raise SyncError('GOOGLE_OAUTH_RESPONSE_INVALID') from None
    if not isinstance(value,dict):raise SyncError('GOOGLE_OAUTH_RESPONSE_INVALID')
    if 'error' in value:_google_error(value)
    return value


def _google_record(context,reply,now,previous=None):
    if not isinstance(reply,dict):raise SyncError('GOOGLE_OAUTH_RESPONSE_INVALID')
    if 'error' in reply:_google_error(reply)
    if reply.get('token_type')!='Bearer':raise SyncError('GOOGLE_OAUTH_RESPONSE_INVALID')
    scopes=reply.get('scope')
    granted=scopes.split(' ') if isinstance(scopes,str) else previous['grantedScopes'] if scopes is None and previous else []
    if granted!=[GOOGLE_SCOPE]:raise SyncError('GOOGLE_OAUTH_SCOPE_REQUIRED')
    access=reply.get('access_token');refresh=reply.get('refresh_token',previous['refreshToken'] if previous else None)
    if any(not isinstance(value,str) or not value or len(value)>4096 or any(not 33<=ord(c)<=126 for c in value) for value in (access,refresh)):
        raise SyncError('GOOGLE_OAUTH_RESPONSE_INVALID')
    expires=reply.get('expires_in');refresh_expires=reply.get('refresh_token_expires_in')
    if type(expires) is not int or not 1<=expires<=86400 or (refresh_expires is not None and (type(refresh_expires) is not int or not 1<=refresh_expires<=3153600000)):
        raise SyncError('GOOGLE_OAUTH_RESPONSE_INVALID')
    return {'schemaVersion':GOOGLE_GRANT_SCHEMA,**context,'tokenType':'Bearer','grantedScopes':granted,
            'accessToken':access,'refreshToken':refresh,'issuedAt':now,'accessExpiresAt':now+expires,
            'refreshExpiresAt':now+refresh_expires if refresh_expires is not None else previous['refreshExpiresAt'] if previous else None,
            'generation':previous['generation']+1 if previous else 1}


def google_oauth_complete(attempt,params,transport=google_oauth_token_request,clock=time.time):
    if not isinstance(attempt,dict) or set(attempt)!={'context','redirectUri','startedAt','codeVerifier','state','authorizationUrl'}:
        raise SyncError('GOOGLE_OAUTH_ATTEMPT_INVALID')
    context=attempt['context'];_google_context(context);_google_redirect(attempt['redirectUri'])
    if type(attempt['startedAt']) is not int:raise SyncError('GOOGLE_OAUTH_ATTEMPT_EXPIRED')
    age=_google_time(clock)-attempt['startedAt']
    if (not 0<=age<GOOGLE_OAUTH_TTL_SECONDS
            or not isinstance(attempt['codeVerifier'],str) or not re.fullmatch(r'[A-Za-z0-9._~-]{43,128}',attempt['codeVerifier'])
            or not isinstance(attempt['state'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}',attempt['state'])):
        raise SyncError('GOOGLE_OAUTH_ATTEMPT_EXPIRED')
    allowed={'code','state','error','scope','authuser','prompt','iss','error_description'}
    if (not isinstance(params,dict) or set(params)-allowed
            or any(not isinstance(value,str) or len(value)>2048 or any(c in value for c in '\r\n\x00') for value in params.values())
            or not secrets.compare_digest(params.get('state','').encode('utf-8'),attempt['state'].encode('ascii'))
            or ('code' in params)==('error' in params)
            or ('iss' in params and params['iss']!='https://accounts.google.com')
            or ('authuser' in params and not re.fullmatch(r'[0-9]{1,3}',params['authuser']))
            or ('prompt' in params and params['prompt'] not in ('consent','none','select_account'))
            or ('scope' in params and params['scope']!=GOOGLE_SCOPE)):
        raise SyncError('GOOGLE_OAUTH_CALLBACK_REJECTED')
    if 'error' in params:_google_error(params)
    if not params['code'] or any(c.isspace() for c in params['code']):raise SyncError('GOOGLE_OAUTH_CALLBACK_REJECTED')
    attempt['consumed']=True # No retry of a code after an uncertain exchange.
    reply=transport({'client_id':context['clientId'],'grant_type':'authorization_code',
        'code':params['code'],'code_verifier':attempt['codeVerifier'],'redirect_uri':attempt['redirectUri']})
    if not 0<=_google_time(clock)-attempt['startedAt']<GOOGLE_OAUTH_TTL_SECONDS:raise SyncError('GOOGLE_OAUTH_ATTEMPT_EXPIRED')
    return _google_record(context,reply,_google_time(clock))


def _google_validate_record(context,record):
    expected={'schemaVersion',*context,'tokenType','grantedScopes','accessToken','refreshToken','issuedAt','accessExpiresAt','refreshExpiresAt','generation'}
    if (not isinstance(record,dict) or set(record)!=expected or record.get('schemaVersion')!=GOOGLE_GRANT_SCHEMA
            or any(record.get(key)!=value for key,value in context.items()) or record.get('tokenType')!='Bearer'
            or record.get('grantedScopes')!=[GOOGLE_SCOPE]
            or type(record.get('generation')) is not int or not 1<=record['generation']<9007199254740991
            or any(type(record.get(key)) is not int or not 0<record[key]<9007199254740991 for key in ('issuedAt','accessExpiresAt'))
            or not 1<=record['accessExpiresAt']-record['issuedAt']<=86400
            or (record.get('refreshExpiresAt') is not None and (type(record['refreshExpiresAt']) is not int or record['refreshExpiresAt']<=record['issuedAt']))
            or any(not isinstance(record.get(key),str) or not record[key] or len(record[key])>4096
                   or any(not 33<=ord(c)<=126 for c in record[key]) for key in ('accessToken','refreshToken'))):
        raise SyncError('GOOGLE_OAUTH_BINDING_CONFLICT')
    secret_store.encode_record(record)
    return record


def google_oauth_load_record(state,context):
    _google_context(context)
    record=secret_store.load_record(state,context['orgId'],context['credentialRef'])
    return _google_validate_record(context,record) if record is not None else None


def google_oauth_record_digest(record):return secret_store.record_digest(record)


def google_oauth_save_record(state,context,record,expected_digest=None):
    _google_context(context);_google_validate_record(context,record)
    def replace(previous):
        if previous is not None:_google_validate_record(context,previous)
        if secret_store.record_digest(previous)!=expected_digest:raise SyncError('GOOGLE_OAUTH_RECORD_CHANGED')
        return record
    secret_store.update_record(state,context['orgId'],context['credentialRef'],replace)


def google_oauth_resolve(state,context,transport=google_oauth_token_request,clock=time.time,force_refresh=False):
    _google_context(context)
    if type(force_refresh) is not bool:raise SyncError('GOOGLE_OAUTH_REQUEST_REJECTED')
    refreshed=False
    def resolve(previous):
        nonlocal refreshed
        if previous is None:raise SyncError('GOOGLE_OAUTH_REAUTHORIZATION_REQUIRED')
        _google_validate_record(context,previous);now=_google_time(clock)
        if previous['issuedAt']>now+60:raise SyncError('GOOGLE_OAUTH_CLOCK_REQUIRED')
        if previous['refreshExpiresAt'] is not None and previous['refreshExpiresAt']<=now:
            raise SyncError('GOOGLE_OAUTH_REAUTHORIZATION_REQUIRED')
        if not force_refresh and previous['accessExpiresAt']>now+60:return previous
        reply=transport({'client_id':context['clientId'],'grant_type':'refresh_token','refresh_token':previous['refreshToken']})
        updated=_google_record(context,reply,_google_time(clock),previous);_google_validate_record(context,updated)
        refreshed=True
        return updated
    record=secret_store.update_record(state,context['orgId'],context['credentialRef'],resolve)
    return record['accessToken'],{'grantProtected':True,'refreshPerformedThisRun':refreshed}


def canonical_table(rows):
    """No guessed headers, monetary/date inference, formula evaluation or free text."""
    if not rows or len(rows) > MAX_ITEMS + 1 or len(rows[0]) != len(FIELDS) or set(rows[0]) != set(FIELDS):
        raise SyncError('EXPLICIT_CANONICAL_TABLE_HEADERS_REQUIRED')
    result = []
    for values in rows[1:]:
        if len(values) != len(FIELDS):
            raise SyncError('CANONICAL_TABLE_ROW_INVALID')
        row = dict(zip(rows[0], values))
        for key, value in row.items():
            if not isinstance(value, str) or len(value) > 512:
                raise SyncError('CANONICAL_TABLE_CELL_INVALID')
            if key in ('amountCents', 'count', 'competence', 'slaDueAt') and value in ('', 'null'):
                row[key] = None
            elif key in ('sourceVersion', 'amountCents', 'count', 'missingFieldsCount'):
                if not re.fullmatch(r'0|[1-9][0-9]{0,15}', value):
                    raise SyncError('CANONICAL_TABLE_INTEGER_REQUIRED')
                row[key] = int(value)
            elif key in ('nativeReady', 'sourceIndependent'):
                if value not in ('true', 'false'):
                    raise SyncError('CANONICAL_TABLE_BOOLEAN_REQUIRED')
                row[key] = value == 'true'
        result.append(validate_payload(row))
    if not result:
        raise SyncError('PROVIDER_EXPORT_LIMIT')
    return result


def xlsx_rows(raw):
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            names = [item.filename for item in entries]
            if (len(entries) > 64 or len(set(names)) != len(names)
                    or sum(item.file_size for item in entries) > 2 * MAX_PROVIDER_BYTES
                    or any(item.file_size > MAX_PROVIDER_BYTES or item.flag_bits & 1 or stat.S_ISLNK(item.external_attr >> 16)
                           or '\\' in item.filename or item.filename.startswith('/') or '..' in item.filename.split('/')
                           or ':' in item.filename or 'externalLinks/' in item.filename or item.filename.lower().endswith('.bin') for item in entries)):
                raise SyncError('BOUNDED_XLSX_REQUIRED')
            sheets = [name for name in names if re.fullmatch(r'xl/worksheets/sheet[0-9]+\.xml', name)]
            if len(sheets) != 1:
                raise SyncError('EXPLICIT_SINGLE_SHEET_REQUIRED')
            def xml(name):
                data = archive.read(name)
                if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
                    raise SyncError('XLSX_XML_DECLARATION_REJECTED')
                return ET.fromstring(data)
            shared = []
            if 'xl/sharedStrings.xml' in names:
                for item in xml('xl/sharedStrings.xml').findall('s:si', ns):
                    shared.append(''.join(node.text or '' for node in item.findall('.//s:t', ns)))
                    if len(shared) > 1024:
                        raise SyncError('XLSX_STRING_LIMIT')
            rows = []
            for source in xml(sheets[0]).findall('s:sheetData/s:row', ns):
                if len(rows) >= MAX_ITEMS + 1 or source.get('hidden') == '1':
                    raise SyncError('PROVIDER_EXPORT_LIMIT')
                cells = {}
                for cell in source.findall('s:c', ns):
                    match = re.fullmatch(r'([A-Z]{1,2})[1-9][0-9]*', cell.get('r', ''))
                    if not match or cell.find('s:f', ns) is not None:
                        raise SyncError('XLSX_FORMULA_OR_REFERENCE_REJECTED')
                    number = 0
                    for character in match[1]:
                        number = number * 26 + ord(character) - 64
                    if number > len(FIELDS) or number in cells:
                        raise SyncError('CANONICAL_TABLE_ROW_INVALID')
                    kind, value = cell.get('t'), cell.findtext('s:v', default='', namespaces=ns)
                    if kind == 'inlineStr':
                        value = ''.join(node.text or '' for node in cell.findall('.//s:t', ns))
                    elif kind == 's':
                        if not value.isdigit() or int(value) >= len(shared):
                            raise SyncError('XLSX_STRING_REFERENCE_REJECTED')
                        value = shared[int(value)]
                    elif kind == 'b':
                        if value not in ('0', '1'):
                            raise SyncError('CANONICAL_TABLE_BOOLEAN_REQUIRED')
                        value = 'true' if value == '1' else 'false'
                    elif kind not in (None, 'n', 'str'):
                        raise SyncError('XLSX_CELL_TYPE_REJECTED')
                    cells[number] = value
                rows.append([cells.get(number, '') for number in range(1, max(cells, default=0) + 1)])
            return rows
    except SyncError:
        raise
    except (zipfile.BadZipFile, ET.ParseError, KeyError, ValueError, RuntimeError):
        raise SyncError('XLSX_EXPORT_INVALID') from None


def exports(raw, filename='export.json'):
    extension = os.path.splitext(filename.lower())[1]
    if extension not in EXPORT_SUFFIXES:
        raise SyncError('DOCUMENT_EXTRACTION_REQUIRED')
    if len(raw) > (MAX_PROVIDER_BYTES if extension == '.xlsx' else MAX_EXPORT_BYTES):
        raise SyncError('PROVIDER_EXPORT_TOO_LARGE')
    if extension == '.xlsx':
        return canonical_table(xlsx_rows(raw))
    if extension == '.csv':
        try:
            rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig')), strict=True))
        except (UnicodeError, csv.Error):
            raise SyncError('CSV_EXPORT_INVALID') from None
        return canonical_table(rows)
    try:
        value = json.loads(raw.decode('utf-8-sig'), object_pairs_hook=unique_object)
    except (ValueError, UnicodeError):
        raise SyncError('PROVIDER_EXPORT_INVALID') from None
    rows = value if isinstance(value, list) else [value]
    if not rows or len(rows) > MAX_ITEMS:
        raise SyncError('PROVIDER_EXPORT_LIMIT')
    return [validate_payload(row) for row in rows]


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api(url, token, binary=False):
    parsed = parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'www.googleapis.com', 'gmail.googleapis.com', 'graph.microsoft.com', 'api.notion.com', 'slack.com'} or parsed.username or parsed.password or parsed.fragment or parsed.port not in (None,443):
        raise SyncError('PROVIDER_DESTINATION_REJECTED')
    headers={'Authorization':'Bearer '+token,'Accept':'application/json'}
    if parsed.hostname=='api.notion.com':
        if not re.fullmatch(r'/v1/(?:pages/[a-f0-9-]{36}|blocks/[a-f0-9-]{36}/children)',parsed.path):raise SyncError('PROVIDER_DESTINATION_REJECTED')
        headers['Notion-Version']='2025-09-03'
    if parsed.hostname=='slack.com' and parsed.path not in {'/api/auth.test','/api/conversations.info','/api/conversations.history'}:
        raise SyncError('PROVIDER_DESTINATION_REJECTED')
    req = request.Request(url, headers=headers, data=b'' if parsed.hostname=='slack.com' and parsed.path=='/api/auth.test' else None)
    try:
        with request.build_opener(NoRedirect(),request.HTTPSHandler(context=ssl.create_default_context())).open(req,timeout=20) as response:
            raw = response.read(MAX_PROVIDER_BYTES+1)
    except error.HTTPError as exc:
        if exc.code in (401,403):raise ProviderAuthenticationError(exc.code) from None
        raise SyncError('PROVIDER_UNAVAILABLE') from None
    except (OSError,error.URLError):
        raise SyncError('PROVIDER_UNAVAILABLE') from None
    if len(raw)>MAX_PROVIDER_BYTES:
        raise SyncError('PROVIDER_RESPONSE_TOO_LARGE')
    if binary:return raw
    try:return json.loads(raw)
    except ValueError:raise SyncError('PROVIDER_RESPONSE_INVALID') from None


def identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_=-]{1,240}',value):
        raise SyncError('PROVIDER_SCOPE_REQUIRED')
    return value


def token_for(source, environment=os.environ):
    name = source.get('tokenEnv')
    if not isinstance(name,str) or not re.fullmatch(r'AURORA_[A-Z0-9_]{3,70}',name):
        raise SyncError('PROTECTED_TOKEN_REFERENCE_REQUIRED')
    token=environment.get(name,'')
    if not token or any(c.isspace() for c in token):raise SyncError('PROVIDER_AUTH_REQUIRED')
    return token


def page_token(value):
    if value is None:return None
    if not isinstance(value,str) or not value or len(value)>4096 or any(c in value for c in '\r\n\x00'):
        raise SyncError('PROVIDER_CURSOR_INVALID')
    return value


def drive_pending(folder, item, code):
    # Names/paths and free text never enter the local queue or reports.
    file_id = identifier(item.get('id'))
    version = item.get('version')
    mime = item.get('mimeType')
    return {'schemaVersion': 'aurora.document.acquisition.pending.v1', 'provider': 'GOOGLE_DRIVE',
            'sourceObjectIdHash': digest('drive-v1:' + folder + ':' + file_id),
            'observedVersion': version if isinstance(version, str) and re.fullmatch(r'[1-9][0-9]{0,31}', version) else None,
            'sourceMimeType': mime if isinstance(mime, str) and re.fullmatch(r'[a-z0-9.+-]+/[a-z0-9.+-]{1,160}', mime) else 'application/octet-stream',
            'status': 'PENDING_EXTRACTION', 'code': code}


def drive_documents(folder, item, token, transport):
    """Materialize canonical facts with a client-observed byte acquisition proof.

    Sheets CSV is only Google's exported first sheet; never native workbook bytes
    or evidence that every sheet/row of the source workbook was acquired.
    """
    version = item.get('version'); mime = item.get('mimeType'); file_id = identifier(item.get('id'))
    if (not isinstance(version, str) or not re.fullmatch(r'[1-9][0-9]{0,31}', version)
            or not isinstance(mime, str) or mime not in ACQUISITION_MIMES):
        return [], drive_pending(folder, item, 'REVIEWED_MIME_AND_VERSION_REQUIRED')
    sheets = mime == 'application/vnd.google-apps.spreadsheet'
    prefix = 'https://www.googleapis.com/drive/v3/files/' + file_id
    url = prefix + ('/export?mimeType=text%2Fcsv' if sheets else '?alt=media')
    try:
        raw = transport(url, token, True)
        if not isinstance(raw, bytes) or not raw or len(raw) > MAX_PROVIDER_BYTES:
            raise SyncError('BOUNDED_ACQUIRED_BYTES_REQUIRED')
        # Provider version is observed on both sides of acquisition. This is not
        # a provider signature or a transactional native-document snapshot.
        after = transport(prefix + '?fields=id%2CmimeType%2Cversion', token)
        if not isinstance(after, dict) or any(after.get(key) != item.get(key) for key in ('id', 'mimeType', 'version')):
            raise SyncError('SOURCE_CHANGED_DURING_ACQUISITION')
        rows = exports(raw, 'representation' + ACQUISITION_MIMES[mime][0])
        if any('sourceEvidence' in row for row in rows):
            raise SyncError('NESTED_SOURCE_ACQUISITION_REJECTED')
    except ProviderAuthenticationError:
        raise
    except SyncError as exc:
        # Retain an exact, non-narrative reason; never exception content from a file.
        known = {'SOURCE_CHANGED_DURING_ACQUISITION', 'BOUNDED_ACQUIRED_BYTES_REQUIRED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE_TOO_LARGE'}
        return [], drive_pending(folder, item, str(exc) if str(exc) in known else 'CANONICAL_EXTRACTION_REQUIRED')
    result = []
    for index, row in enumerate(rows):
        text_hash = digest(record_text(row))
        proof = {'schemaVersion': ACQUISITION_SCHEMA, 'provider': 'GOOGLE_DRIVE',
                 'sourceObjectIdHash': digest('drive-v1:' + folder + ':' + file_id), 'observedVersion': version,
                 'sourceMimeType': mime, 'acquiredMimeType': 'text/csv' if sheets else mime,
                 'representation': 'GOOGLE_SHEETS_CSV_EXPORT' if sheets else 'ORIGINAL_BYTES',
                 'byteSha256': hashlib.sha256(raw).hexdigest(), 'byteLength': len(raw),
                 'extraction': {'method': ACQUISITION_MIMES[mime][1], 'version': '1.0.0', 'status': 'COMPLETE',
                                'coverage': 'EXPORTED_REPRESENTATION_ONLY', 'textFormat': 'CANONICAL_RECORD_JSON',
                                'textSha256': text_hash, 'rowFactsSha256': text_hash,
                                'rowIndex': index, 'rowCount': len(rows)}}
        result.append(validate_payload({**row, 'sourceEvidence': proof}))
    return result, None



def workspace_scope(source):
    """Closed, explicit scope; a ChatGPT connector is not an app credential."""
    provider=source.get('provider') if isinstance(source,dict) else None
    fields={'NOTION':{'provider','tokenEnv','pageId'},'SLACK':{'provider','tokenEnv','workspaceId','channelId'}}
    if provider not in fields or set(source)!=fields[provider]:raise SyncError('WORKSPACE_SOURCE_CONFIGURATION_REQUIRED')
    if not isinstance(source['tokenEnv'],str) or not re.fullmatch(r'AURORA_[A-Z0-9_]{3,70}',source['tokenEnv']):
        raise SyncError('PROTECTED_TOKEN_REFERENCE_REQUIRED')
    if provider=='NOTION':
        value=source['pageId']
        if not isinstance(value,str) or not re.fullmatch(r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}',value):
            raise SyncError('NOTION_PAGE_SCOPE_REQUIRED')
    elif (not isinstance(source['workspaceId'],str) or not re.fullmatch(r'T[A-Z0-9]{8,32}',source['workspaceId'])
          or not isinstance(source['channelId'],str) or not re.fullmatch(r'[CG][A-Z0-9]{8,32}',source['channelId'])):
        raise SyncError('SLACK_WORKSPACE_CHANNEL_SCOPE_REQUIRED')


def workspace_documents(source,token,transport,cursor):
    workspace_scope(source);provider=source['provider'];rows=[];pending=0
    def bounded(value,field,maximum=MAX_ITEMS):
        items=value.get(field) if isinstance(value,dict) else None
        if not isinstance(items,list) or len(items)>maximum or any(not isinstance(item,dict) for item in items):
            raise SyncError('BOUNDED_PROVIDER_PAGE_REQUIRED')
        return items
    def canonical_text(text):
        if not isinstance(text,str) or not text or len(text.encode('utf-8'))>MAX_EXPORT_BYTES:raise SyncError('CANONICAL_EXTRACTION_REQUIRED')
        return exports(text.encode('utf-8'))
    if provider=='NOTION':
        page=source['pageId'].lower();prefix='https://api.notion.com/v1/'
        before=transport(prefix+'pages/'+page,token)
        def identity(value):
            if (not isinstance(value,dict) or value.get('object')!='page' or not isinstance(value.get('id'),str) or value['id'].lower()!=page
                    or value.get('archived') is not False or value.get('in_trash',False) is not False
                    or not isinstance(value.get('last_edited_time'),str) or not value['last_edited_time']):
                raise SyncError('PROVIDER_SCOPE_MISMATCH')
            return value['last_edited_time']
        version=identity(before)
        params={'page_size':MAX_ITEMS}
        if cursor is not None:params['start_cursor']=page_token(cursor)
        result=transport(prefix+'blocks/'+page+'/children?'+parse.urlencode(params),token)
        for block in bounded(result,'results'):
            if block.get('parent')!={'type':'page_id','page_id':before['id']}:raise SyncError('PROVIDER_SCOPE_MISMATCH')
            code=block.get('code')
            if block.get('type')!='code' or block.get('has_children') is not False or not isinstance(code,dict) or code.get('language')!='json':
                pending+=1;continue
            parts=code.get('rich_text')
            if not isinstance(parts,list) or len(parts)>100 or any(not isinstance(part,dict) or part.get('type')!='text' or not isinstance(part.get('text'),dict) or not isinstance(part['text'].get('content'),str) for part in parts):
                pending+=1;continue
            try:rows.extend(canonical_text(''.join(part['text']['content'] for part in parts)))
            except SyncError:pending+=1
        if identity(transport(prefix+'pages/'+page,token))!=version:raise SyncError('SOURCE_CHANGED_DURING_ACQUISITION')
        more=result.get('has_more')
        if type(more) is not bool:raise SyncError('BOUNDED_PROVIDER_PAGE_REQUIRED')
        next_cursor=page_token(result.get('next_cursor')) if more else None
    else:
        prefix='https://slack.com/api/'
        auth=transport(prefix+'auth.test',token)
        if not isinstance(auth,dict) or auth.get('ok') is not True or auth.get('team_id')!=source['workspaceId']:
            raise SyncError('PROVIDER_SCOPE_MISMATCH')
        info=transport(prefix+'conversations.info?'+parse.urlencode({'channel':source['channelId']}),token)
        channel=info.get('channel') if isinstance(info,dict) else None
        if (not isinstance(info,dict) or info.get('ok') is not True or not isinstance(channel,dict) or channel.get('id')!=source['channelId']
                or channel.get('is_member') is not True or channel.get('is_ext_shared') is True or channel.get('is_shared') is True
                or channel.get('is_im') is True or channel.get('is_mpim') is True):raise SyncError('PROVIDER_SCOPE_MISMATCH')
        params={'channel':source['channelId'],'limit':15}
        if cursor is not None:params['cursor']=page_token(cursor)
        result=transport(prefix+'conversations.history?'+parse.urlencode(params),token)
        if not isinstance(result,dict) or result.get('ok') is not True:raise SyncError('PROVIDER_UNAVAILABLE')
        for item in bounded(result,'messages',15):
            text=item.get('text')
            if isinstance(text,str):
                match=re.fullmatch(r'```(?:json|aurora-json)\s*\n([\s\S]*?)\n```',text.strip())
                if match:text=match[1]
            try:rows.extend(canonical_text(text))
            except SyncError:pending+=1
            # Replies/files are never silently counted as acquired by channel history.
            if item.get('reply_count') or item.get('files'):pending+=1
        more=result.get('has_more',False)
        if type(more) is not bool:raise SyncError('BOUNDED_PROVIDER_PAGE_REQUIRED')
        metadata=result.get('response_metadata',{})
        if not isinstance(metadata,dict):raise SyncError('BOUNDED_PROVIDER_PAGE_REQUIRED')
        next_cursor=page_token(metadata.get('next_cursor') or None)
        if more and next_cursor is None:raise SyncError('PROVIDER_CURSOR_REQUIRED')
    if more and next_cursor is None:raise SyncError('PROVIDER_CURSOR_REQUIRED')
    if next_cursor is not None and next_cursor==cursor:raise SyncError('PROVIDER_CURSOR_NOT_ADVANCING')
    if len(rows)>MAX_ITEMS:raise SyncError('PROVIDER_EXPORT_LIMIT')
    return {'documents':rows,'pendingExtraction':pending,'pendingDocuments':[],
            'coverageLimited':next_cursor is not None,'nextCursor':next_cursor}

def pull(source, transport=api, environment=os.environ, imap_factory=imaplib.IMAP4_SSL, cursor=None, oauth_access_token=None):
    provider=source.get('provider')
    if provider not in PROVIDERS:raise SyncError('PROVIDER_NOT_SUPPORTED')
    if 'oauth' in source:
        oauth=source['oauth']
        if (provider!='GOOGLE_DRIVE' or set(source)!={'provider','folderId','oauth'}
                or not isinstance(oauth,dict) or set(oauth)!={'schemaVersion','clientId','credentialRef','scopeProfile'}
                or oauth.get('schemaVersion')!=GOOGLE_OAUTH_SCHEMA or oauth.get('scopeProfile')!='DRIVE_READONLY_EXISTING_FOLDER'
                or not isinstance(oauth.get('clientId'),str) or not oauth['clientId']
                or not isinstance(oauth_access_token,str)
                or not oauth_access_token or any(not 33<=ord(c)<=126 for c in oauth_access_token)):
            raise SyncError('GOOGLE_OAUTH_PROTECTED_GRANT_REQUIRED')
        token=oauth_access_token
    else:
        if oauth_access_token is not None:raise SyncError('GOOGLE_OAUTH_CONFIGURATION_REQUIRED')
        token=token_for(source,environment)
    if provider in ('NOTION','SLACK'):return workspace_documents(source,token,transport,cursor)
    rows=[]; pending=0;next_cursor=None;pending_documents=[]
    if provider=='GOOGLE_DRIVE':
        folder=identifier(source.get('folderId'))
        params={'q':"'"+folder+"' in parents and trashed = false",'pageSize':MAX_ITEMS,'fields':'files(id,mimeType,version),nextPageToken'}
        if cursor is not None:params['pageToken']=page_token(cursor)
        query=parse.urlencode(params)
        result=transport('https://www.googleapis.com/drive/v3/files?'+query,token)
        if not isinstance(result,dict):raise SyncError('BOUNDED_PROVIDER_PAGE_REQUIRED')
        files = result.get('files', [])
        if not isinstance(files, list) or len(files) > MAX_ITEMS or any(not isinstance(item, dict) for item in files):
            raise SyncError('BOUNDED_PROVIDER_PAGE_REQUIRED')
        for item in files:
            parsed, unresolved = drive_documents(folder, item, token, transport)
            rows.extend(parsed)
            if unresolved is not None: pending_documents.append(unresolved); pending += 1
        next_cursor=page_token(result.get('nextPageToken'))
        limited=next_cursor is not None
    elif provider=='GMAIL':
        label=identifier(source.get('labelId'))
        params={'labelIds':label,'maxResults':MAX_ITEMS}
        if cursor is not None:params['pageToken']=page_token(cursor)
        result=transport('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+parse.urlencode(params),token)
        part_budget=MAX_ITEMS
        def attachments(part,depth=0):
            nonlocal pending
            nonlocal part_budget
            if depth>8 or part_budget<=0:pending+=1;return
            part_budget-=1
            if str(part.get('filename','')).lower().endswith(EXPORT_SUFFIXES):
                data=part.get('body',{}).get('data')
                attachment=part.get('body',{}).get('attachmentId')
                if not data and attachment:
                    data=transport(message_url+'/attachments/'+identifier(attachment),token).get('data')
                if isinstance(data,str):
                    try:raw=base64.urlsafe_b64decode(data+'='*((-len(data))%4))
                    except ValueError:raise SyncError('PROVIDER_EXPORT_INVALID') from None
                    rows.extend(exports(raw, part['filename']))
            elif part.get('filename'):pending+=1
            for child in part.get('parts',[])[:MAX_ITEMS]:attachments(child,depth+1)
        for item in result.get('messages',[])[:MAX_ITEMS]:
            message_url='https://gmail.googleapis.com/gmail/v1/users/me/messages/'+identifier(item.get('id'))
            message=transport(message_url+'?format=full',token)
            if label not in message.get('labelIds',[]):raise SyncError('PROVIDER_SCOPE_MISMATCH')
            attachments(message.get('payload',{}))
        next_cursor=page_token(result.get('nextPageToken'))
        limited=next_cursor is not None
    elif provider=='MICROSOFT_MAIL':
        folder=identifier(source.get('folderId'))
        prefix='https://graph.microsoft.com/v1.0/me/mailFolders/'+folder+'/messages'
        url=prefix+'?$top=20&$select=id,hasAttachments'
        def scoped_link(link):
            link=page_token(link)
            if link is not None and (parse.urlsplit(link).scheme!='https' or parse.urlsplit(link).netloc!='graph.microsoft.com' or parse.urlsplit(link).path!=parse.urlsplit(prefix).path or parse.urlsplit(link).fragment):
                raise SyncError('PROVIDER_CURSOR_SCOPE_MISMATCH')
            return link
        if cursor is not None:url=scoped_link(cursor)
        result=transport(url,token)
        for item in result.get('value',[])[:MAX_ITEMS]:
            if not item.get('hasAttachments'):continue
            attachment_url='https://graph.microsoft.com/v1.0/me/messages/'+identifier(item.get('id'))+'/attachments?$top=20'
            data=transport(attachment_url,token)
            # Do not advance the message page while attachments remain unread.
            if data.get('@odata.nextLink'):raise SyncError('PROVIDER_ATTACHMENT_PAGINATION_PENDING')
            for attachment in data.get('value',[])[:MAX_ITEMS]:
                if str(attachment.get('name','')).lower().endswith(EXPORT_SUFFIXES) and attachment.get('@odata.type')=='#microsoft.graph.fileAttachment':
                    try:raw=base64.b64decode(attachment.get('contentBytes',''),validate=True)
                    except ValueError:raise SyncError('PROVIDER_EXPORT_INVALID') from None
                    rows.extend(exports(raw, attachment['name']))
                else:pending+=1
        next_cursor=scoped_link(result.get('@odata.nextLink'))
        limited=next_cursor is not None
    else:
        host=source.get('host');user=source.get('user');folder=source.get('folder')
        if not isinstance(host,str) or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{1,250})',host) or not isinstance(user,str) or any(c in user for c in '\r\n\x00') or not isinstance(folder,str) or not folder or any(c in folder for c in '\r\n\x00'):
            raise SyncError('IMAP_SCOPE_REQUIRED')
        connection=imap_factory(host,993,ssl_context=ssl.create_default_context(),timeout=20)
        try:
            connection.authenticate('XOAUTH2',lambda _:('user='+user+'\x01auth=Bearer '+token+'\x01\x01').encode())
            if connection.select(folder,readonly=True)[0]!='OK':raise SyncError('IMAP_SCOPE_REQUIRED')
            validity=connection.response('UIDVALIDITY')[1]
            uid_validity=(validity[0].decode() if validity and validity[0] else '')
            if not uid_validity.isdigit():raise SyncError('IMAP_UIDVALIDITY_REQUIRED')
            after=0
            if cursor is not None:
                if not isinstance(cursor,dict) or set(cursor)!={'uidValidity','afterUid'} or cursor['uidValidity']!=uid_validity or type(cursor['afterUid']) is not int or cursor['afterUid']<0:
                    raise SyncError('IMAP_CURSOR_RECONCILIATION_REQUIRED')
                after=cursor['afterUid']
            typ,data=connection.uid('search',None,'ALL')
            if typ!='OK':raise SyncError('PROVIDER_UNAVAILABLE')
            ids=sorted((int(uid) for uid in data[0].split() if int(uid)>after))
            limited=len(ids)>MAX_ITEMS
            page=ids[:MAX_ITEMS]
            next_cursor={'uidValidity':uid_validity,'afterUid':page[-1]} if limited else None
            for number in page:
                uid=str(number).encode()
                typ,sizes=connection.uid('fetch',uid,'(RFC822.SIZE)')
                size=b' '.join(x for x in sizes if isinstance(x,bytes))
                match=re.search(rb'RFC822.SIZE (\d+)',size)
                if not match or int(match[1])>MAX_PROVIDER_BYTES:pending+=1;continue
                typ,data=connection.uid('fetch',uid,'(BODY.PEEK[])')
                if typ!='OK':raise SyncError('PROVIDER_UNAVAILABLE')
                raw=next((x[1] for x in data if isinstance(x,tuple)),b'')
                if len(raw)>MAX_PROVIDER_BYTES:raise SyncError('PROVIDER_RESPONSE_TOO_LARGE')
                message=email.message_from_bytes(raw)
                for part in message.walk():
                    name=part.get_filename()
                    if name and name.lower().endswith(EXPORT_SUFFIXES):rows.extend(exports(part.get_payload(decode=True) or b'', name))
                    elif name:pending+=1
        except imaplib.IMAP4.error:raise SyncError('PROVIDER_AUTH_REQUIRED') from None
        finally:
            try:connection.logout()
            except Exception:pass
    if len(rows)>MAX_ITEMS:raise SyncError('PROVIDER_EXPORT_LIMIT')
    if next_cursor is not None and next_cursor==cursor:raise SyncError('PROVIDER_CURSOR_NOT_ADVANCING')
    return {'documents':rows,'pendingExtraction':pending,'pendingDocuments':pending_documents,
            'coverageLimited':limited,'nextCursor':next_cursor}
