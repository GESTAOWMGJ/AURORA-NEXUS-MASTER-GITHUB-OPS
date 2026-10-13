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
from provider_connectors import pull, exports
from client_secret_store import load as load_secret
import published_release as release

VERSION='1.0.1'
SCHEMA='aurora.client-agent.v1'
MAX_ENTRIES=200
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
        if not isinstance(source,dict) or set(source)-{'provider','tokenEnv','folderId','labelId','host','user','folder'}:
            raise sync.SyncError('PROVIDER_CONFIG_INVALID')
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
                if info.st_nlink!=1 or info.st_size==0 or info.st_size>262144 or time.time()-info.st_mtime<2:continue
                if path.suffix.lower()=='.json':
                    fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
                    try:
                        current=os.fstat(fd)
                        if current.st_ino!=info.st_ino or current.st_nlink!=1:raise sync.SyncError('SOURCE_CHANGED')
                        raw=os.read(fd,16385)
                        if len(raw)>16384:pending+=1;continue
                        try:rows.extend(exports(raw))
                        except sync.SyncError:pending+=1
                    finally:os.close(fd)
                elif path.suffix.lower() in FORMATS:pending+=1
                if len(rows)>=MAX_ENTRIES:limited=True;break
    return rows[:MAX_ENTRIES],pending,limited


def cycle(config,environment=os.environ,transport=sync.request_json,provider_pull=pull):
    roots,state=validate(config)
    if (state/'disabled.json').exists():raise sync.SyncError('AGENT_DISABLED')
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
    conn=queue(state);accepted=0;verified=0;waiting=0;provider_states=[];provider_errors=[]
    try:
        conn.execute('CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY, hash TEXT NOT NULL)')
        binding=sync.digest(json.dumps({k:config.get(k) for k in ('org','origin','roots','providers')},sort_keys=True))
        previous=conn.execute('SELECT hash FROM binding WHERE id=1').fetchone()
        if previous and previous[0]!=binding:raise sync.SyncError('SOURCE_STATE_BINDING_CHANGED')
        conn.execute('INSERT OR IGNORE INTO binding VALUES (1,?)',(binding,))
        conn.execute('CREATE TABLE IF NOT EXISTS provider_pages (id TEXT PRIMARY KEY, cursor TEXT, completed INTEGER NOT NULL, pending_extraction INTEGER NOT NULL, pages INTEGER NOT NULL)')
        conn.execute('CREATE TABLE IF NOT EXISTS provider_inflight (id TEXT PRIMARY KEY, hash TEXT NOT NULL)')
        conn.commit()
        sources=config.get('providers',[])
        ids=[sync.digest(config['org']+':'+json.dumps(source,sort_keys=True)) for source in sources]
        checkpoints={key:conn.execute('SELECT cursor,completed,pending_extraction,pages FROM provider_pages WHERE id=?',(key,)).fetchone() for key in ids}
        # A completed traversal is rescanned next cycle to discover later arrivals/changes.
        # Canonical receipts and idempotency remain in the existing intake table.
        if ids and all(checkpoints[key] and checkpoints[key][1] for key in ids):
            conn.executemany('DELETE FROM provider_pages WHERE id=?',[(key,) for key in ids]);conn.commit()
            checkpoints={key:None for key in ids}
        documents,pending,limited=local_documents(roots)
        if sources and len(documents)>MAX_ENTRIES//2:
            documents=documents[:MAX_ENTRIES//2];limited=True
        groups=[(None,documents,None)]
        budget=MAX_ENTRIES-len(documents)
        for source,key in zip(sources,ids):
            validate(config)
            if (state/'disabled.json').exists():raise sync.SyncError('AGENT_DISABLED')
            checkpoint=checkpoints[key]
            if checkpoint and checkpoint[1]:
                provider_states.append({'provider':source['provider'],'state':'READ_CONFIRMED','coverageLimited':False})
                continue
            if budget<20:
                provider_states.append({'provider':source['provider'],'state':'CONNECTION_PENDING'})
                continue
            try:
                cursor=json.loads(checkpoint[0]) if checkpoint and checkpoint[0] is not None else None
                result=provider_pull(source,environment=environment,cursor=cursor)
                if len(result['documents'])>budget:raise sync.SyncError('PROVIDER_PAGE_BUDGET_EXCEEDED')
                if result['coverageLimited'] and result.get('nextCursor') is None:raise sync.SyncError('PROVIDER_CURSOR_REQUIRED')
                page_hash=sync.digest(json.dumps({'documents':sorted(sync.digest(json.dumps(row,sort_keys=True)) for row in result['documents']),
                    'pendingExtraction':result['pendingExtraction'],'nextCursor':result.get('nextCursor')},sort_keys=True))
                inflight=conn.execute('SELECT hash FROM provider_inflight WHERE id=?',(key,)).fetchone()
                if inflight and inflight[0]!=page_hash:raise sync.SyncError('PROVIDER_PAGE_CHANGED_RECONCILIATION_REQUIRED')
                conn.execute('INSERT OR IGNORE INTO provider_inflight VALUES (?,?)',(key,page_hash));conn.commit()
                groups.append((key,result['documents'],result));budget-=len(result['documents'])
                provider_states.append({'provider':source['provider'],'state':'READ_CONFIRMED','coverageLimited':result['coverageLimited']})
            except (sync.SyncError,OSError,ValueError) as exc:
                provider_states.append({'provider':source.get('provider'),'state':'CONNECTION_PENDING'})
                provider_errors.append({'provider':source.get('provider'),'code':str(exc) if isinstance(exc,sync.SyncError) else 'PROVIDER_UNAVAILABLE'})
        for key,documents,page in groups:
            page_done=True
            for raw in documents:
                validate(config)
                if (state/'disabled.json').exists():raise sync.SyncError('AGENT_DISABLED')
                payload=sync.validate_payload(raw)
                identity=sync.digest(config['org']+':'+json.dumps(payload,sort_keys=True,separators=(',',':')))
                previous=conn.execute('SELECT state,attempts,next_attempt FROM intake WHERE hash=?',(identity,)).fetchone()
                if previous and previous[0]=='PROCESSING_VERIFIED':verified+=1;continue
                if previous and previous[2]>time.time():waiting+=1;page_done=False;continue
                attempts=(previous[1] if previous else 0)+1
                # Reserve before transport. A crash replays the same canonical key.
                conn.execute('INSERT INTO intake VALUES (?, ?, ?, NULL, 0) ON CONFLICT(hash) DO UPDATE SET state=excluded.state,attempts=excluded.attempts',
                             (identity,'PENDING',attempts));conn.commit()
                try:
                    receipt=sync.synchronize(payload,config['origin'],config['org'],token,True,transport)
                    done=receipt['processing']['firstIngestionVerified'] is True
                    state_name='PROCESSING_VERIFIED' if done else 'PROCESSING_PENDING'
                    conn.execute('UPDATE intake SET state=?,receipt=?,next_attempt=0 WHERE hash=?',(state_name,json.dumps({
                        'documentId':receipt['documentId'],'idempotencyKey':receipt['idempotencyKey'],
                        'payloadSha256':receipt['payloadSha256'],'processing':receipt['processing']}),identity));conn.commit()
                    accepted+=1;verified+=int(done);waiting+=int(not done);page_done &= done
                except (sync.SyncError,OSError):
                    conn.execute('UPDATE intake SET state=?,next_attempt=? WHERE hash=?',('RETRY',time.time()+min(3600,30*2**min(attempts-1,7)),identity));conn.commit();waiting+=1;page_done=False
            if key and page_done:
                cursor=page.get('nextCursor')
                conn.execute('INSERT INTO provider_pages VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor,completed=excluded.completed,pending_extraction=provider_pages.pending_extraction+excluded.pending_extraction,pages=provider_pages.pages+1',
                             (key,json.dumps(cursor) if cursor is not None else None,int(cursor is None),page['pendingExtraction']))
                conn.execute('DELETE FROM provider_inflight WHERE id=?',(key,))
                conn.commit()
            elif key:
                pending+=page['pendingExtraction']
        progress=[conn.execute('SELECT completed,pending_extraction,pages FROM provider_pages WHERE id=?',(key,)).fetchone() for key in ids]
        pending+=sum(row[1] for row in progress if row)
        complete=bool(ids) and all(row and row[0] for row in progress) and all(p['state']=='READ_CONFIRMED' for p in provider_states)
        cloud_verified=complete and pending==0 and waiting==0 and conn.execute("SELECT 1 FROM intake WHERE state='PROCESSING_VERIFIED' LIMIT 1").fetchone() is not None
        limited|=bool(ids) and not complete
    finally:conn.close()
    report_confirmed=False
    try:
        report_status,report=transport(config['origin'].rstrip('/')+'/api/integration/ping',token,{'component':'AURORA_CLIENT_AGENT','instanceId':config['instanceId'],'pendingExtraction':min(pending,10000),'providers':provider_states})
        report_confirmed=report_status==200 and report.get('ok') is True and report.get('reportAccepted') is True and report.get('orgId')==config['org']
    except (sync.SyncError,OSError):pass
    return {'schemaVersion':SCHEMA,'componentVersion':VERSION,'orgId':config['org'],'connectionVerified':True,'agentReportConfirmed':report_confirmed,
            'receiptsConfirmed':accepted,'processingReceiptsCached':verified,'pending':waiting,'pendingExtraction':pending,
            'coverageLimited':limited,'cloudEnumerationComplete':complete,'cloudSnapshotVerified':cloud_verified,
            'cloudPagesCommitted':sum(row[2] for row in progress if row),'providers':provider_states,
            'providerPendingCodes':provider_errors,'publishedRelease':published,'fullSynchronizationVerified':False}


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
