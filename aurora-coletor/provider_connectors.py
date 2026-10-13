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


def page_token(value):
    if value is None:return None
    if not isinstance(value,str) or not value or len(value)>4096 or any(c in value for c in '\r\n\x00'):
        raise SyncError('PROVIDER_CURSOR_INVALID')
    return value


def pull(source, transport=api, environment=os.environ, imap_factory=imaplib.IMAP4_SSL, cursor=None):
    provider=source.get('provider')
    if provider not in PROVIDERS:raise SyncError('PROVIDER_NOT_SUPPORTED')
    token=token_for(source,environment)
    rows=[]; pending=0;next_cursor=None
    if provider=='GOOGLE_DRIVE':
        folder=identifier(source.get('folderId'))
        params={'q':"'"+folder+"' in parents and trashed = false",'pageSize':MAX_ITEMS,'fields':'files(id,name,mimeType),nextPageToken'}
        if cursor is not None:params['pageToken']=page_token(cursor)
        query=parse.urlencode(params)
        result=transport('https://www.googleapis.com/drive/v3/files?'+query,token)
        for item in result.get('files',[])[:MAX_ITEMS]:
            if str(item.get('name','')).lower().endswith('.json'):
                raw=transport('https://www.googleapis.com/drive/v3/files/'+identifier(item.get('id'))+'?alt=media',token,True)
                rows.extend(exports(raw))
            else:pending+=1
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
                if str(attachment.get('name','')).lower().endswith('.json') and attachment.get('@odata.type')=='#microsoft.graph.fileAttachment':
                    try:raw=base64.b64decode(attachment.get('contentBytes',''),validate=True)
                    except ValueError:raise SyncError('PROVIDER_EXPORT_INVALID') from None
                    rows.extend(exports(raw))
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
                    if name and name.lower().endswith('.json'):rows.extend(exports(part.get_payload(decode=True) or b''))
                    elif name:pending+=1
        except imaplib.IMAP4.error:raise SyncError('PROVIDER_AUTH_REQUIRED') from None
        finally:
            try:connection.logout()
            except Exception:pass
    if len(rows)>MAX_ITEMS:raise SyncError('PROVIDER_EXPORT_LIMIT')
    if next_cursor is not None and next_cursor==cursor:raise SyncError('PROVIDER_CURSOR_NOT_ADVANCING')
    return {'documents':rows,'pendingExtraction':pending,'coverageLimited':limited,'nextCursor':next_cursor}
