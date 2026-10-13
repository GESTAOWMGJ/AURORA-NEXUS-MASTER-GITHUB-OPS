"""Read-only, explicitly scoped provider adapters for the existing Aurora collector.

OAuth access tokens belong to the installed protected component, never the web UI.
The adapters return only reviewed canonical JSON exports; they do not mark arbitrary
mail bodies/PDFs as extracted facts. OAuth enrollment/refresh is an external prerequisite.
"""
import base64
import email
import imaplib
import json
import os
import re
import ssl
from urllib import request, parse, error

from aurora_cloud_sync import validate_payload, SyncError, unique_object

MAX_EXPORT_BYTES = 16384
MAX_PROVIDER_BYTES = 1048576
MAX_ITEMS = 20
PROVIDERS = {'GOOGLE_DRIVE', 'GMAIL', 'MICROSOFT_MAIL', 'IMAP'}


def exports(raw):
    if len(raw) > MAX_EXPORT_BYTES:
        raise SyncError('PROVIDER_EXPORT_TOO_LARGE')
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
    if parsed.scheme != 'https' or parsed.hostname not in {'www.googleapis.com', 'gmail.googleapis.com', 'graph.microsoft.com'} or parsed.username or parsed.password or parsed.fragment or parsed.port not in (None,443):
        raise SyncError('PROVIDER_DESTINATION_REJECTED')
    req = request.Request(url, headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
    try:
        with request.build_opener(NoRedirect(),request.HTTPSHandler(context=ssl.create_default_context())).open(req,timeout=20) as response:
            raw = response.read(MAX_PROVIDER_BYTES+1)
    except error.HTTPError as exc:
        raise SyncError('PROVIDER_AUTH_REQUIRED' if exc.code in (401,403) else 'PROVIDER_UNAVAILABLE') from None
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


def pull(source, transport=api, environment=os.environ, imap_factory=imaplib.IMAP4_SSL):
    provider=source.get('provider')
    if provider not in PROVIDERS:raise SyncError('PROVIDER_NOT_SUPPORTED')
    token=token_for(source,environment)
    rows=[]; pending=0
    if provider=='GOOGLE_DRIVE':
        folder=identifier(source.get('folderId'))
        query=parse.urlencode({'q':"'"+folder+"' in parents and trashed = false",'pageSize':MAX_ITEMS,'fields':'files(id,name,mimeType),nextPageToken'})
        result=transport('https://www.googleapis.com/drive/v3/files?'+query,token)
        for item in result.get('files',[])[:MAX_ITEMS]:
            if str(item.get('name','')).lower().endswith('.json'):
                raw=transport('https://www.googleapis.com/drive/v3/files/'+identifier(item.get('id'))+'?alt=media',token,True)
                rows.extend(exports(raw))
            else:pending+=1
        limited=bool(result.get('nextPageToken'))
    elif provider=='GMAIL':
        label=identifier(source.get('labelId'))
        result=transport('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+parse.urlencode({'labelIds':label,'maxResults':MAX_ITEMS}),token)
        part_budget=MAX_ITEMS
        def attachments(part,depth=0):
            nonlocal pending
            nonlocal part_budget
            if depth>8 or part_budget<=0:pending+=1;return
            part_budget-=1
            if str(part.get('filename','')).lower().endswith('.json'):
                data=part.get('body',{}).get('data')
                attachment=part.get('body',{}).get('attachmentId')
                if not data and attachment:
                    data=transport(message_url+'/attachments/'+identifier(attachment),token).get('data')
                if isinstance(data,str):
                    try:raw=base64.urlsafe_b64decode(data+'='*((-len(data))%4))
                    except ValueError:raise SyncError('PROVIDER_EXPORT_INVALID') from None
                    rows.extend(exports(raw))
            elif part.get('filename'):pending+=1
            for child in part.get('parts',[])[:MAX_ITEMS]:attachments(child,depth+1)
        for item in result.get('messages',[])[:MAX_ITEMS]:
            message_url='https://gmail.googleapis.com/gmail/v1/users/me/messages/'+identifier(item.get('id'))
            message=transport(message_url+'?format=full',token)
            if label not in message.get('labelIds',[]):raise SyncError('PROVIDER_SCOPE_MISMATCH')
            attachments(message.get('payload',{}))
        limited=bool(result.get('nextPageToken'))
    elif provider=='MICROSOFT_MAIL':
        folder=identifier(source.get('folderId'))
        result=transport('https://graph.microsoft.com/v1.0/me/mailFolders/'+folder+'/messages?$top=20&$select=id,hasAttachments',token)
        for item in result.get('value',[])[:MAX_ITEMS]:
            if not item.get('hasAttachments'):continue
            attachment_url='https://graph.microsoft.com/v1.0/me/messages/'+identifier(item.get('id'))+'/attachments?$top=20'
            data=transport(attachment_url,token)
            for attachment in data.get('value',[])[:MAX_ITEMS]:
                if str(attachment.get('name','')).lower().endswith('.json') and attachment.get('@odata.type')=='#microsoft.graph.fileAttachment':
                    try:raw=base64.b64decode(attachment.get('contentBytes',''),validate=True)
                    except ValueError:raise SyncError('PROVIDER_EXPORT_INVALID') from None
                    rows.extend(exports(raw))
                else:pending+=1
        limited=bool(result.get('@odata.nextLink'))
    else:
        host=source.get('host');user=source.get('user');folder=source.get('folder')
        if not isinstance(host,str) or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{1,250})',host) or not isinstance(user,str) or any(c in user for c in '\r\n\x00') or not isinstance(folder,str) or not folder or any(c in folder for c in '\r\n\x00'):
            raise SyncError('IMAP_SCOPE_REQUIRED')
        connection=imap_factory(host,993,ssl_context=ssl.create_default_context(),timeout=20)
        try:
            connection.authenticate('XOAUTH2',lambda _:('user='+user+'\x01auth=Bearer '+token+'\x01\x01').encode())
            if connection.select(folder,readonly=True)[0]!='OK':raise SyncError('IMAP_SCOPE_REQUIRED')
            typ,data=connection.uid('search',None,'ALL')
            if typ!='OK':raise SyncError('PROVIDER_UNAVAILABLE')
            ids=data[0].split();limited=len(ids)>MAX_ITEMS
            for uid in ids[-MAX_ITEMS:]:
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
                    if name and name.lower().endswith('.json'):rows.extend(exports(part.get_payload(decode=True) or b''))
                    elif name:pending+=1
        except imaplib.IMAP4.error:raise SyncError('PROVIDER_AUTH_REQUIRED') from None
        finally:
            try:connection.logout()
            except Exception:pass
    if len(rows)>MAX_ITEMS:raise SyncError('PROVIDER_EXPORT_LIMIT')
    return {'documents':rows,'pendingExtraction':pending,'coverageLimited':limited}
