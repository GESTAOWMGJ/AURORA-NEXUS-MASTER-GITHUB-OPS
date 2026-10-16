"""Bounded PC/macOS intake using the existing canonical transport and receipt checks.

No arbitrary remote commands, global scan, model download or provider password.
Original files remain at their authorized source. Local state stores hashes and
receipts only; unparsed formats remain explicitly pending extraction.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time

import aurora_cloud_sync as sync
from aurora_deployment import safe_path
from provider_connectors import pull, exports, EXPORT_SUFFIXES, MAX_PROVIDER_BYTES, google_oauth_context, google_oauth_resolve, ProviderAuthenticationError
from client_secret_store import load as load_secret
import published_release as release

VERSION='1.0.4'
SCHEMA='aurora.client-agent.v1'
MAX_ENTRIES=200
SOURCE_PROOF_TTL_SECONDS=300
FORMATS={'.pdf','.doc','.docx','.odt','.rtf','.xls','.xlsx','.ods','.csv','.json','.jsonl','.xml','.txt','.md','.png','.jpg','.jpeg','.tif','.tiff'}


def validate(config):
    allowed={'schemaVersion','org','origin','stateDir','roots','providers','authorization','tokenEnv','intervalSeconds','instanceId','releaseControl'}
    if not isinstance(config,dict) or set(config)-allowed or config.get('schemaVersion')!=SCHEMA:
        raise sync.SyncError('CLIENT_CONFIG_INVALID')
    if not re.fullmatch(r'[a-f0-9]{32}',config.get('instanceId','')):raise sync.SyncError('CLIENT_INSTANCE_INVALID')
    org=config.get('org')
    if not isinstance(org,str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}',org):raise sync.SyncError('TENANT_REQUIRED')
    sync.origin_url(config.get('origin'))
    if 'releaseControl' in config:
        try:release.validate_control(config['releaseControl'])
        except release.ReleaseError:raise sync.SyncError('PUBLIC_RELEASE_CONFIGURATION_REQUIRED') from None
    auth=config.get('authorization',{})
    if auth.get('approved') is not True or not all(isinstance(auth.get(k),str) and re.fullmatch(r'[A-Za-z0-9_.:-]{2,160}',auth[k]) for k in ('actorRef','documentRef')):
        raise sync.SyncError('SOURCE_AUTHORIZATION_REQUIRED')
    expiry=datetime.fromisoformat(str(auth.get('expiresAt','')).replace('Z','+00:00'))
    if expiry.tzinfo is None or expiry<=datetime.now(timezone.utc):raise sync.SyncError('SOURCE_AUTHORIZATION_EXPIRED')
    token_env=config.get('tokenEnv')
    if not isinstance(token_env,str) or not re.fullmatch(r'AURORA_[A-Z0-9_]{3,70}',token_env):raise sync.SyncError('PROTECTED_TOKEN_REFERENCE_REQUIRED')
    roots=config.get('roots',[]);providers=config.get('providers',[])
    if not isinstance(roots,list) or len(roots)>12 or not isinstance(providers,list) or len(providers)>12 or not (roots or providers):
        raise sync.SyncError('EXPLICIT_SOURCE_REQUIRED')
    interval=config.get('intervalSeconds',60)
    if type(interval) is not int or not 60<=interval<=86400:raise sync.SyncError('BOUNDED_INTERVAL_REQUIRED')
    state=safe_path(config['stateDir']);checked=[]
    for raw in roots:
        root=safe_path(raw)
        if not root.is_dir() or root==Path(root.anchor) or root in {Path.home(),*(Path.home()/x for x in ('Documents','Desktop','Downloads'))}:
            raise sync.SyncError('BROAD_SOURCE_REJECTED')
        if any(part.lower() in {'windows','system32','program files','program files (x86)','library','applications','keychains','secrets','credentials','pacientes','prontuarios'} for part in root.parts):
            raise sync.SyncError('PRIVATE_SOURCE_REJECTED')
        if root==state or root in state.parents or state in root.parents or any(root==p or root in p.parents or p in root.parents for p in checked):
            raise sync.SyncError('SOURCE_STATE_OVERLAP')
        checked.append(root)
    for source in providers:
        if not isinstance(source,dict) or set(source)-{'provider','tokenEnv','folderId','labelId','host','user','folder','oauth'}:
            raise sync.SyncError('PROVIDER_CONFIG_INVALID')
        if 'oauth' in source:google_oauth_context(source,org,config['instanceId'])
    return checked,state


@contextmanager
def lock(state):
    state=safe_path(state);state.mkdir(mode=0o700,parents=True,exist_ok=True)
    target=safe_path(state/'client-agent.lock')
    fd=os.open(target,os.O_CREAT|os.O_RDWR|getattr(os,'O_NOFOLLOW',0),0o600)
    if not stat.S_ISREG(os.fstat(fd).st_mode) or os.fstat(fd).st_nlink!=1:
        os.close(fd);raise sync.SyncError('LOCK_INTEGRITY_FAILED')
    try:
        if os.name=='nt':
            import msvcrt
            if os.fstat(fd).st_size==0:os.write(fd,b'0')
            os.lseek(fd,0,os.SEEK_SET);msvcrt.locking(fd,msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:
        os.close(fd);raise sync.SyncError('AGENT_ALREADY_RUNNING') from None
    try:yield
    finally:os.close(fd) # The OS releases ownership after a real crash, too.


def queue(state):
    state.mkdir(mode=0o700,parents=True,exist_ok=True)
    path=safe_path(state/'client-agent.sqlite3')
    if path.exists() and (not path.is_file() or path.stat().st_nlink!=1):raise sync.SyncError('STATE_INTEGRITY_FAILED')
    conn=sqlite3.connect(path)
    try:path.chmod(0o600)
    except OSError:pass
    conn.execute('CREATE TABLE IF NOT EXISTS intake (hash TEXT PRIMARY KEY, state TEXT NOT NULL, attempts INTEGER NOT NULL, receipt TEXT, next_attempt REAL NOT NULL)')
    return conn


def local_documents(roots):
    rows=[];pending=0;examined=0;limited=False
    for root in roots:
        # Explicit input folders, no unbounded recursive or home-directory scan.
        with os.scandir(root) as entries:
            for entry in entries:
                if examined>=MAX_ENTRIES:limited=True;break
                examined+=1
                if entry.is_symlink() or not entry.is_file(follow_symlinks=False):continue
                path=safe_path(Path(entry.path));info=path.stat()
                if info.st_nlink!=1:pending+=1;continue
                if info.st_size==0 or info.st_size>MAX_PROVIDER_BYTES or time.time()-info.st_mtime<2:
                    if path.suffix.lower() in FORMATS:pending+=1
                    continue
                if path.suffix.lower() in EXPORT_SUFFIXES:
                    fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)|getattr(os,'O_BINARY',0))
                    try:
                        current=os.fstat(fd)
                        if current.st_ino!=info.st_ino or current.st_nlink!=1:raise sync.SyncError('SOURCE_CHANGED')
                        raw=os.read(fd,MAX_PROVIDER_BYTES+1)
                        if len(raw)>MAX_PROVIDER_BYTES:pending+=1;continue
                        try:rows.extend(exports(raw,path.name))
                        except sync.SyncError:pending+=1
                    finally:os.close(fd)
                elif path.suffix.lower() in FORMATS:pending+=1
                if len(rows)>=MAX_ENTRIES:limited=True;break
    return rows[:MAX_ENTRIES],pending,limited


def source_configuration_hash(config):
    # Only the closed public configuration and credential aliases, never tokens.
    public={key:config.get(key) for key in
        ('org','origin','roots','providers','tokenEnv','instanceId','releaseControl')}
    public['authorization']={key:config.get('authorization',{}).get(key) for key in
        ('approved','actorRef','documentRef','expiresAt')}
    return sync.digest(json.dumps(public,sort_keys=True))


def provider_page_hash(page):
    return sync.digest(json.dumps({'documents':sorted(sync.digest(json.dumps(row,sort_keys=True)) for row in page['documents']),
        'pendingExtraction':page['pendingExtraction'],'pendingDocuments':page.get('pendingDocuments',[]),
        'nextCursor':page.get('nextCursor')},sort_keys=True))


def retain_pending_documents(conn, config, key, page, cursor):
    pending = page.get('pendingDocuments', [])
    if (type(page.get('pendingExtraction')) is not int or not 0<=page['pendingExtraction']<=10000
            or not isinstance(pending, list) or len(pending) > 20 or len(pending) > page['pendingExtraction']):
        raise sync.SyncError('PENDING_DOCUMENT_IDENTITIES_REQUIRED')
    for item in pending:
        if (not isinstance(item, dict) or set(item) != {'schemaVersion','provider','sourceObjectIdHash','observedVersion','sourceMimeType','status','code'}
                or item.get('schemaVersion') != 'aurora.document.acquisition.pending.v1' or item.get('provider') != 'GOOGLE_DRIVE'
                or item.get('status') != 'PENDING_EXTRACTION'
                or not isinstance(item.get('sourceObjectIdHash'),str) or not re.fullmatch(r'[a-f0-9]{64}',item['sourceObjectIdHash'])
                or item.get('observedVersion') is not None and (not isinstance(item['observedVersion'],str) or not re.fullmatch(r'[1-9][0-9]{0,31}',item['observedVersion']))
                or not isinstance(item.get('sourceMimeType'),str) or not re.fullmatch(r'[a-z0-9.+-]+/[a-z0-9.+-]{1,160}',item['sourceMimeType'])
                or item.get('code') not in {'REVIEWED_MIME_AND_VERSION_REQUIRED','SOURCE_CHANGED_DURING_ACQUISITION','BOUNDED_ACQUIRED_BYTES_REQUIRED',
                                           'PROVIDER_UNAVAILABLE','PROVIDER_RESPONSE_TOO_LARGE','CANONICAL_EXTRACTION_REQUIRED'}):
            raise sync.SyncError('PENDING_DOCUMENT_IDENTITY_INVALID')
        identity=sync.digest(config['org']+':'+key+':pending:'+item['sourceObjectIdHash']+':'+str(item['observedVersion']))
        receipt=json.dumps({'sourceGroup':key,'acquisition':item},sort_keys=True)
        # Same database/intake queue, no raw content, names, paths or new executor.
        conn.execute('INSERT INTO intake VALUES (?, ?, 1, ?, 0) ON CONFLICT(hash) DO UPDATE SET state=excluded.state,receipt=excluded.receipt,attempts=intake.attempts+1',
                     (identity,'PENDING_EXTRACTION',receipt))
    unknown=page['pendingExtraction']-len(pending)
    if unknown:
        # Older adapters only report a count. Do not fabricate per-file identity
        # or let disappearance erase their extraction barrier on a later run.
        cursor_hash=sync.digest(json.dumps(cursor,sort_keys=True))
        identity=sync.digest(config['org']+':'+key+':pending-aggregate:'+cursor_hash)
        previous=conn.execute("SELECT receipt FROM intake WHERE hash=? AND state='PENDING_EXTRACTION_AGGREGATE'",(identity,)).fetchone()
        if previous:
            try:unknown=max(unknown,json.loads(previous[0])['pendingCount'])
            except (ValueError,KeyError,TypeError):raise sync.SyncError('PENDING_DOCUMENT_STATE_INVALID') from None
        receipt=json.dumps({'sourceGroup':key,'schemaVersion':'aurora.document.acquisition.pending-aggregate.v1',
                            'requestCursorHash':cursor_hash,'pendingCount':unknown,'scope':'LEGACY_ADAPTER_WITHOUT_FILE_IDENTITIES'},sort_keys=True)
        conn.execute('INSERT INTO intake VALUES (?, ?, 1, ?, 0) ON CONFLICT(hash) DO UPDATE SET receipt=excluded.receipt,attempts=intake.attempts+1',
                     (identity,'PENDING_EXTRACTION_AGGREGATE',receipt))
    conn.commit()


def pending_document_rows(conn, key=None):
    result=[]
    for identity, receipt in conn.execute("SELECT hash,receipt FROM intake WHERE state='PENDING_EXTRACTION'"):
        try: record=json.loads(receipt)
        except (ValueError,TypeError): raise sync.SyncError('PENDING_DOCUMENT_STATE_INVALID') from None
        if key is None or record.get('sourceGroup') == key: result.append((identity,record))
    return result


def pending_aggregate_count(conn, key=None):
    count=0
    for receipt, in conn.execute("SELECT receipt FROM intake WHERE state='PENDING_EXTRACTION_AGGREGATE'"):
        try:record=json.loads(receipt)
        except (ValueError,TypeError):raise sync.SyncError('PENDING_DOCUMENT_STATE_INVALID') from None
        if type(record.get('pendingCount')) is not int or not 1<=record['pendingCount']<=10000:
            raise sync.SyncError('PENDING_DOCUMENT_STATE_INVALID')
        if key is None or record.get('sourceGroup')==key:count+=record['pendingCount']
    return count


def resolve_pending_documents(conn, org, key, documents):
    # Only a complete processed representation of the very same object/version
    # closes a retained pending item. Disappearance/new versions do not erase it.
    completed={}
    for row in documents:
        evidence=row.get('sourceEvidence')
        if evidence:
            identity=sync.digest(org+':'+json.dumps(row,sort_keys=True,separators=(',',':')))
            stored=conn.execute("SELECT receipt FROM intake WHERE hash=? AND state='PROCESSING_VERIFIED'",(identity,)).fetchone()
            if not stored:continue
            receipt=json.loads(stored[0]);proof=receipt.get('processing',{})
            if receipt.get('sourceEvidenceHash')!=sync.source_evidence_hash(evidence) or proof.get('firstIngestionVerified') is not True:continue
            group=(evidence['sourceObjectIdHash'],evidence['observedVersion'])
            completed.setdefault(group,[]).append((evidence['extraction'],{
                'sourceEvidenceHash':receipt['sourceEvidenceHash'],'documentId':receipt['documentId'],
                **{name:proof[name] for name in ('versionId','revision','sourceVersion','canonicalSnapshotHash')}}))
    for identity,record in pending_document_rows(conn,key):
        item=record['acquisition']; rows=completed.get((item['sourceObjectIdHash'],item['observedVersion']),[])
        if rows and all(row['rowCount']==len(rows) for row,receipt in rows) and {row['rowIndex'] for row,receipt in rows}==set(range(len(rows))):
            record['resolution']={'state':'CANONICAL_PROCESSING_VERIFIED','records':[receipt for row,receipt in rows]}
            conn.execute("UPDATE intake SET state='EXTRACTION_RESOLVED',receipt=? WHERE hash=?",(json.dumps(record,sort_keys=True),identity))


def record_provider_page_proof(conn,key,cursor,page_hash,configuration_hash):
    # The caller commits this metadata with its in-flight reservation or cursor.
    # It never replaces the fresh processing/replay required by installation.
    conn.execute('INSERT INTO provider_page_proofs VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET request_cursor=excluded.request_cursor,page_hash=excluded.page_hash,configuration_hash=excluded.configuration_hash,checked_at=excluded.checked_at',
                 (key,json.dumps(cursor) if cursor is not None else None,page_hash,configuration_hash,time.time()))


def cycle(config,environment=os.environ,transport=sync.request_json,provider_pull=pull,verify_installation=False):
    if type(verify_installation) is not bool:raise sync.SyncError('EXPLICIT_INSTALLATION_VERIFICATION_REQUIRED')
    roots,state=validate(config)
    if verify_installation and sync.origin_url(config['origin'])!='https://auroranexus.com.br':
        raise sync.SyncError('CANONICAL_INSTALLATION_ORIGIN_REQUIRED')
    if (state/'disabled.json').exists():raise sync.SyncError('AGENT_DISABLED')
    sources=config.get('providers',[])
    if not roots and sources and all('oauth' in source and source['oauth']['clientId'] is None for source in sources):
        return {'schemaVersion':SCHEMA,'componentVersion':VERSION,'orgId':config['org'],'state':'PENDING_CONFIGURATION',
                'connectionVerified':False,'receiptsConfirmed':0,'fullSynchronizationVerified':False,
                'providerPendingCodes':[{'provider':'GOOGLE_DRIVE','code':'GOOGLE_OAUTH_CONFIGURATION_REQUIRED'}],
                'installationReadiness':{'status':'PENDING_CONFIGURATION','eligible':False,'installationComplete':False,
                    'globalIngestionVerified':False,'oauthEnrollmentOrRefreshPerformed':False}}
    environment=dict(environment)
    aliases={config['tokenEnv']}
    for alias in aliases:
        if not environment.get(alias):environment[alias]=load_secret(state,config['org'],alias) or ''
    token=environment.get(config['tokenEnv'],'')
    published=release.release_status(config.get('releaseControl'),config['org'],token,read_active='releaseControl' in config)
    if 'releaseControl' in config and published['status']!='PUBLISHED_COMPONENT_CURRENT_BYTES_VERIFIED':
        return {'schemaVersion':SCHEMA,'componentVersion':VERSION,'orgId':config['org'],'state':'PENDING_PUBLISHED_RELEASE',
                'publishedRelease':published,'connectionVerified':False,'receiptsConfirmed':0,'fullSynchronizationVerified':False}
    for alias in {p.get('tokenEnv','') for p in config.get('providers',[])}:
        if alias and not environment.get(alias):environment[alias]=load_secret(state,config['org'],alias) or ''
    # Verify the tenant before any source-content or provider access.
    sync.connect(config['origin'],config['org'],token,transport)
    configuration_hash=source_configuration_hash(config)
    def current_source_authorization():
        validate(config)
        if source_configuration_hash(config)!=configuration_hash:raise sync.SyncError('SOURCE_CONFIGURATION_CHANGED_DURING_CYCLE')
        if (state/'disabled.json').exists():raise sync.SyncError('AGENT_DISABLED')
    conn=queue(state);accepted=0;verified=0;waiting=0;provider_states=[];provider_errors=[]
    replays=0;fresh_processed=0;acceptances=[];source_modes=set();verified_source_groups=set();oauth_refreshed=False
    source_access_at={};page_cursors={};page_hashes={};revalidations=set()
    try:
        conn.execute('CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY, hash TEXT NOT NULL)')
        binding=sync.digest(json.dumps({k:config.get(k) for k in ('org','origin','roots','providers')},sort_keys=True))
        previous=conn.execute('SELECT hash FROM binding WHERE id=1').fetchone()
        if previous and previous[0]!=binding:raise sync.SyncError('SOURCE_STATE_BINDING_CHANGED')
        conn.execute('INSERT OR IGNORE INTO binding VALUES (1,?)',(binding,))
        conn.execute('CREATE TABLE IF NOT EXISTS provider_pages (id TEXT PRIMARY KEY, cursor TEXT, completed INTEGER NOT NULL, pending_extraction INTEGER NOT NULL, pages INTEGER NOT NULL)')
        conn.execute('CREATE TABLE IF NOT EXISTS provider_inflight (id TEXT PRIMARY KEY, hash TEXT NOT NULL)')
        conn.execute('CREATE TABLE IF NOT EXISTS provider_page_proofs (id TEXT PRIMARY KEY, request_cursor TEXT, page_hash TEXT NOT NULL, configuration_hash TEXT NOT NULL, checked_at REAL NOT NULL)')
        conn.commit()
        sources=config.get('providers',[])
        ids=[sync.digest(config['org']+':'+json.dumps(source,sort_keys=True)) for source in sources]
        checkpoints={key:conn.execute('SELECT cursor,completed,pending_extraction,pages FROM provider_pages WHERE id=?',(key,)).fetchone() for key in ids}
        for key,checkpoint in checkpoints.items():
            if checkpoint and checkpoint[2]:
                # Older agents advanced past count-only extraction pendencies.
                # Move that barrier into the same intake queue before a rescan
                # can replace traversal metadata. This does not invent file IDs.
                retain_pending_documents(conn,config,key,{'pendingExtraction':checkpoint[2]},
                                         {'legacyTraversalCursorHash':sync.digest(checkpoint[0] or 'null')})
                conn.execute('UPDATE provider_pages SET pending_extraction=0 WHERE id=?',(key,));conn.commit()
        checkpoints={key:conn.execute('SELECT cursor,completed,pending_extraction,pages FROM provider_pages WHERE id=?',(key,)).fetchone() for key in ids}
        # A completed traversal is rescanned next cycle to discover later arrivals/changes.
        # Canonical receipts and idempotency remain in the existing intake table.
        if not verify_installation and ids and all(checkpoints[key] and checkpoints[key][1] for key in ids):
            conn.executemany('DELETE FROM provider_pages WHERE id=?',[(key,) for key in ids])
            conn.executemany('DELETE FROM provider_page_proofs WHERE id=?',[(key,) for key in ids]);conn.commit()
            checkpoints={key:None for key in ids}
        documents,pending,limited=local_documents(roots)
        if roots:source_access_at['LOCAL_ROOTS']=time.time()
        if sources and len(documents)>MAX_ENTRIES//2:
            documents=documents[:MAX_ENTRIES//2];limited=True
        groups=[(None,documents,None)]
        budget=MAX_ENTRIES-len(documents)
        for source,key in zip(sources,ids):
            current_source_authorization()
            checkpoint=checkpoints[key]
            if checkpoint and checkpoint[1] and not verify_installation:
                provider_states.append({'provider':source['provider'],'state':'READ_CONFIRMED','coverageLimited':False})
                continue
            if budget<20:
                provider_states.append({'provider':source['provider'],'state':'CONNECTION_PENDING'})
                continue
            try:
                oauth_context=google_oauth_context(source,config['org'],config['instanceId']) if 'oauth' in source else None
                if oauth_context is not None and oauth_context['clientId'] is None:
                    raise sync.SyncError('GOOGLE_OAUTH_CONFIGURATION_REQUIRED')
                proof=conn.execute('SELECT request_cursor,page_hash,configuration_hash,checked_at FROM provider_page_proofs WHERE id=?',(key,)).fetchone()
                inflight=conn.execute('SELECT hash FROM provider_inflight WHERE id=?',(key,)).fetchone()
                age=time.time()-proof[3] if proof else None
                invalid=not proof or proof[2]!=configuration_hash or not age>=0
                stale=invalid or age>=SOURCE_PROOF_TTL_SECONDS
                if inflight and invalid:raise sync.SyncError('PROVIDER_SOURCE_PROOF_RECONCILIATION_REQUIRED')
                if verify_installation and checkpoint:
                    if stale and not inflight:
                        # Old EOF or changed consent cannot certify this closure. Keep
                        # intake/history. An expired in-flight page instead needs a
                        # fresh read at the same cursor and the identical hash below.
                        conn.execute('DELETE FROM provider_pages WHERE id=?',(key,))
                        conn.execute('DELETE FROM provider_page_proofs WHERE id=?',(key,));conn.commit()
                        checkpoint=None;checkpoints[key]=None;proof=None
                revalidating=bool(verify_installation and checkpoint and checkpoint[1])
                cursor=json.loads(checkpoint[0]) if checkpoint and checkpoint[0] is not None else None
                if revalidating:cursor=json.loads(proof[0]) if proof[0] is not None else None
                if oauth_context is None:
                    result=provider_pull(source,environment=environment,cursor=cursor)
                else:
                    access,oauth_proof=google_oauth_resolve(state,oauth_context)
                    oauth_refreshed|=oauth_proof['refreshPerformedThisRun']
                    current_source_authorization()
                    try:result=provider_pull(source,environment={},cursor=cursor,oauth_access_token=access)
                    except sync.SyncError as exc:
                        if not isinstance(exc,ProviderAuthenticationError) or exc.status!=401:raise
                        current_source_authorization()
                        access,oauth_proof=google_oauth_resolve(state,oauth_context,force_refresh=True)
                        oauth_refreshed|=oauth_proof['refreshPerformedThisRun']
                        current_source_authorization()
                        result=provider_pull(source,environment={},cursor=cursor,oauth_access_token=access)
                current_source_authorization()
                source_access_at[key]=time.time()
                if len(result['documents'])>budget:raise sync.SyncError('PROVIDER_PAGE_BUDGET_EXCEEDED')
                if result['coverageLimited'] and result.get('nextCursor') is None:raise sync.SyncError('PROVIDER_CURSOR_REQUIRED')
                page_hash=provider_page_hash(result)
                if revalidating and (result.get('nextCursor') is not None or result['coverageLimited'] or page_hash!=proof[1]):
                    raise sync.SyncError('PROVIDER_PAGE_CHANGED_RECONCILIATION_REQUIRED')
                if inflight and inflight[0]!=page_hash:raise sync.SyncError('PROVIDER_PAGE_CHANGED_RECONCILIATION_REQUIRED')
                retain_pending_documents(conn,config,key,result,cursor)
                # An extraction-pending page has no cursor-commit reservation.
                # Existing canonical intake receipts remain idempotent; retained
                # object/version identities prevent disappearance from closing it.
                if not result['pendingExtraction'] and not pending_document_rows(conn,key) and not pending_aggregate_count(conn,key):
                    conn.execute('INSERT OR IGNORE INTO provider_inflight VALUES (?,?)',(key,page_hash))
                record_provider_page_proof(conn,key,cursor,page_hash,configuration_hash);conn.commit()
                page_cursors[key]=cursor;page_hashes[key]=page_hash
                if revalidating:revalidations.add(key)
                groups.append((key,result['documents'],result));budget-=len(result['documents'])
                provider_states.append({'provider':source['provider'],'state':'READ_CONFIRMED','coverageLimited':result['coverageLimited']})
            except (sync.SyncError,OSError,ValueError) as exc:
                provider_states.append({'provider':source.get('provider'),'state':'CONNECTION_PENDING'})
                provider_errors.append({'provider':source.get('provider'),'code':str(exc) if isinstance(exc,sync.SyncError) else 'PROVIDER_UNAVAILABLE'})
        for key,documents,page in groups:
            page_done=True
            for raw in documents:
                current_source_authorization()
                payload=sync.validate_payload(raw)
                identity=sync.digest(config['org']+':'+json.dumps(payload,sort_keys=True,separators=(',',':')))
                previous=conn.execute('SELECT state,attempts,next_attempt FROM intake WHERE hash=?',(identity,)).fetchone()
                if previous and previous[0]=='PROCESSING_VERIFIED' and not verify_installation:verified+=1;continue
                if previous and previous[2]>time.time():waiting+=1;page_done=False;continue
                attempts=(previous[1] if previous else 0)+1
                # Reserve before transport. A crash replays the same canonical key.
                conn.execute('INSERT INTO intake VALUES (?, ?, ?, NULL, 0) ON CONFLICT(hash) DO UPDATE SET state=excluded.state,attempts=excluded.attempts',
                             (identity,'PENDING',attempts));conn.commit()
                try:
                    receipt=sync.synchronize(payload,config['origin'],config['org'],token,True,transport)
                    done=receipt['processing']['firstIngestionVerified'] is True
                    if verify_installation and done:
                        replay=sync.synchronize(payload,config['origin'],config['org'],token,True,transport)
                        if (replay['status']!='DUPLICATE' or replay['processing']['firstIngestionVerified'] is not True
                                or any(replay[field]!=receipt[field] for field in ('documentId','idempotencyKey','payloadSha256'))):
                            raise sync.SyncError('CURRENT_PROCESSING_REPLAY_REQUIRED')
                        receipt=replay;replays+=1;fresh_processed+=1
                        acceptances.append(receipt.get('installationAcceptance'))
                        source_modes.add('CLOUD_OAUTH' if key else 'LOCAL_AGENT')
                        verified_source_groups.add(key or 'LOCAL_ROOTS')
                    state_name='PROCESSING_VERIFIED' if done else 'PROCESSING_PENDING'
                    conn.execute('UPDATE intake SET state=?,receipt=?,next_attempt=0 WHERE hash=?',(state_name,json.dumps({
                        'documentId':receipt['documentId'],'idempotencyKey':receipt['idempotencyKey'],
                        'payloadSha256':receipt['payloadSha256'],'processing':receipt['processing'],
                        **({'sourceEvidenceHash':receipt['sourceEvidenceHash']} if 'sourceEvidenceHash' in receipt else {})}),identity));conn.commit()
                    accepted+=1;verified+=int(done);waiting+=int(not done);page_done &= done
                except (sync.SyncError,OSError):
                    conn.execute('UPDATE intake SET state=?,next_attempt=? WHERE hash=?',('RETRY',time.time()+min(3600,30*2**min(attempts-1,7)),identity));conn.commit();waiting+=1;page_done=False
            if key and page_done:
                resolve_pending_documents(conn,config['org'],key,documents)
                # A processed file stays resolved even while another file holds
                # this page's cursor. Closing SQLite must not roll it back.
                conn.commit()
                page_done=not page['pendingExtraction'] and not pending_document_rows(conn,key) and not pending_aggregate_count(conn,key)
            if key and page_done:
                cursor=page.get('nextCursor')
                if key not in revalidations:
                    conn.execute('INSERT INTO provider_pages VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor,completed=excluded.completed,pending_extraction=provider_pages.pending_extraction+excluded.pending_extraction,pages=provider_pages.pages+1',
                                 (key,json.dumps(cursor) if cursor is not None else None,int(cursor is None),page['pendingExtraction']))
                record_provider_page_proof(conn,key,page_cursors[key],page_hashes[key],configuration_hash)
                conn.execute('DELETE FROM provider_inflight WHERE id=?',(key,))
                conn.commit()
        pending+=len(pending_document_rows(conn))+pending_aggregate_count(conn)
        progress=[conn.execute('SELECT completed,pending_extraction,pages FROM provider_pages WHERE id=?',(key,)).fetchone() for key in ids]
        pending+=sum(row[1] for row in progress if row)
        complete=bool(ids) and all(row and row[0] for row in progress) and all(p['state']=='READ_CONFIRMED' for p in provider_states)
        cloud_verified=complete and pending==0 and waiting==0 and conn.execute("SELECT 1 FROM intake WHERE state='PROCESSING_VERIFIED' LIMIT 1").fetchone() is not None
        limited|=bool(ids) and not complete
    finally:conn.close()
    current_source_authorization()
    report_confirmed=False
    try:
        report_status,report=transport(config['origin'].rstrip('/')+'/api/integration/ping',token,{'component':'AURORA_CLIENT_AGENT','instanceId':config['instanceId'],'pendingExtraction':min(pending,10000),'providers':provider_states})
        report_confirmed=report_status==200 and report.get('ok') is True and report.get('reportAccepted') is True and report.get('orgId')==config['org']
    except (sync.SyncError,OSError):pass
    current_source_authorization()
    readiness={'schemaVersion':'aurora.installation.source-readiness.v1','status':'PENDING','eligible':False,
               'sourceAdapterVerifiedThisRun':bool(fresh_processed),'sourceModesVerifiedThisRun':sorted(source_modes),
               'processingReceiptsVerifiedThisRun':fresh_processed,'idempotentReplaysVerifiedThisRun':replays,
               'automationScope':'AURORA_CANONICAL_PIPELINE','installationComplete':False,
               'proofScope':'DIRECT_ADAPTER_EXECUTION_THIS_RUN',
               'globalIngestionVerified':False,'oauthEnrollmentOrRefreshPerformed':oauth_refreshed}
    required_groups=set(ids)|({'LOCAL_ROOTS'} if roots else set())
    source_proofs_fresh=all(key in source_access_at and 0<=time.time()-source_access_at[key]<SOURCE_PROOF_TTL_SECONDS for key in required_groups)
    readiness.update(sourceProofsFreshThisRun=source_proofs_fresh,sourceProofTtlSeconds=SOURCE_PROOF_TTL_SECONDS)
    full_synchronization_verified=False
    if (verify_installation and fresh_processed and replays==fresh_processed and report_confirmed
            and waiting==0 and pending==0 and not limited and not provider_errors
            and complete and cloud_verified and required_groups<=verified_source_groups and source_proofs_fresh
            and all(isinstance(item,dict) and item.get('eligible') is True for item in acceptances)):
        full_synchronization_verified=True
        readiness.update(status='INSTALLATION_INTEGRATION_VERIFIED',eligible=True,
                         canonicalPipelineAcceptance=acceptances[-1],
                         globalIngestionVerified=True)
    return {'schemaVersion':SCHEMA,'componentVersion':VERSION,'orgId':config['org'],'connectionVerified':True,'agentReportConfirmed':report_confirmed,
            'receiptsConfirmed':accepted,'processingReceiptsCached':verified,'pending':waiting,'pendingExtraction':pending,
            'coverageLimited':limited,'cloudEnumerationComplete':complete,'cloudSnapshotVerified':cloud_verified,
            'cloudPagesCommitted':sum(row[2] for row in progress if row),'providers':provider_states,
            'providerPendingCodes':provider_errors,'publishedRelease':published,'fullSynchronizationVerified':full_synchronization_verified,
            'installationReadiness':readiness}


def main(argv=None):
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--once',action='store_true');parser.add_argument('--watch',action='store_true')
    parser.add_argument('--release-status',action='store_true',help='Public release preflight without source reads or state writes')
    parser.add_argument('--read-active',action='store_true',help='Explicit authenticated canonical GET, only with --release-status')
    args=parser.parse_args(argv)
    config_path=safe_path(args.config)
    if not config_path.is_file() or config_path.stat().st_nlink!=1:raise sync.SyncError('CONFIG_INTEGRITY_FAILED')
    config=json.loads(config_path.read_text())
    _,state=validate(config)
    if args.read_active and not args.release_status:raise sync.SyncError('EXPLICIT_RELEASE_STATUS_REQUIRED')
    if args.release_status:
        if args.once or args.watch:raise sync.SyncError('SEPARATE_RELEASE_STATUS_REQUIRED')
        result=release.release_status(config.get('releaseControl'),config['org'],os.environ.get(config['tokenEnv']) if args.read_active else None,args.read_active)
        print(json.dumps(result,sort_keys=True));return 0 if result['currentPointerVerified'] else 2
    if not (args.once or args.watch):print(json.dumps({'state':'VALIDATED_NOT_STARTED','orgId':config['org']}));return 0
    with lock(state):
        binding=hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()
        while True:
            # Re-read authorization before every cycle; revocation or expiry stops source access.
            config=json.loads(config_path.read_text());validate(config)
            if hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()!=binding:
                raise sync.SyncError('SOURCE_CONFIGURATION_CHANGED_RESTART_REQUIRED')
            try:result=cycle(config)
            except sync.SyncError as exc:
                print(json.dumps({'state':'BLOCKED','code':str(exc)}));return 2
            status=safe_path(state/'client-agent-status.json');temporary=safe_path(state/'client-agent-status.new')
            temporary.write_text(json.dumps(result)+'\n');temporary.chmod(0o600);os.replace(temporary,status)
            print(json.dumps(result),flush=True)
            if not args.watch:return 0
            time.sleep(config.get('intervalSeconds',60))


if __name__=='__main__':
    try:raise SystemExit(main())
    except (sync.SyncError,ValueError,OSError):
        print(json.dumps({'state':'BLOCKED','code':'CLIENT_CONFIGURATION_OR_SOURCE_REQUIRED'}));raise SystemExit(2)
