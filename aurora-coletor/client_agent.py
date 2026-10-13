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

VERSION='1.0.0'
SCHEMA='aurora.client-agent.v1'
MAX_ENTRIES=200
FORMATS={'.pdf','.doc','.docx','.odt','.rtf','.xls','.xlsx','.ods','.csv','.json','.jsonl','.xml','.txt','.md','.png','.jpg','.jpeg','.tif','.tiff'}


def validate(config):
    allowed={'schemaVersion','org','origin','stateDir','roots','providers','authorization','tokenEnv','intervalSeconds','instanceId'}
    if not isinstance(config,dict) or set(config)-allowed or config.get('schemaVersion')!=SCHEMA:
        raise sync.SyncError('CLIENT_CONFIG_INVALID')
    if not re.fullmatch(r'[a-f0-9]{32}',config.get('instanceId','')):raise sync.SyncError('CLIENT_INSTANCE_INVALID')
    org=config.get('org')
    if not isinstance(org,str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}',org):raise sync.SyncError('TENANT_REQUIRED')
    sync.origin_url(config.get('origin'))
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
    aliases={config['tokenEnv'],*(p.get('tokenEnv','') for p in config.get('providers',[]))}
    for alias in aliases:
        if not environment.get(alias):environment[alias]=load_secret(state,config['org'],alias) or ''
    token=environment.get(config['tokenEnv'],'')
    # Verify the tenant before any source-content or provider access.
    sync.connect(config['origin'],config['org'],token,transport)
    documents,pending,limited=local_documents(roots)
    provider_states=[]
    for source in config.get('providers',[]):
        try:
            result=provider_pull(source,environment=environment)
            documents.extend(result['documents']);pending+=result['pendingExtraction'];limited|=result['coverageLimited']
            provider_states.append({'provider':source['provider'],'state':'READ_CONFIRMED','coverageLimited':result['coverageLimited']})
        except (sync.SyncError,OSError,ValueError):
            provider_states.append({'provider':source.get('provider'),'state':'CONNECTION_PENDING'})
    conn=queue(state);accepted=0;verified=0;waiting=0
    try:
        for raw in documents[:MAX_ENTRIES]:
            if (state/'disabled.json').exists():raise sync.SyncError('AGENT_DISABLED')
            payload=sync.validate_payload(raw)
            identity=sync.digest(config['org']+':'+json.dumps(payload,sort_keys=True,separators=(',',':')))
            previous=conn.execute('SELECT state,attempts,next_attempt FROM intake WHERE hash=?',(identity,)).fetchone()
            if previous and previous[0]=='PROCESSING_VERIFIED':verified+=1;continue
            if previous and previous[2]>time.time():waiting+=1;continue
            attempts=(previous[1] if previous else 0)+1
            # Reserve before transport; a crash after remote commit replays the same canonical key.
            conn.execute('INSERT INTO intake VALUES (?, ?, ?, NULL, 0) ON CONFLICT(hash) DO UPDATE SET state=excluded.state,attempts=excluded.attempts',
                         (identity,'PENDING',attempts));conn.commit()
            try:
                receipt=sync.synchronize(payload,config['origin'],config['org'],token,True,transport)
                done=receipt['processing']['firstIngestionVerified'] is True
                state_name='PROCESSING_VERIFIED' if done else 'PROCESSING_PENDING'
                conn.execute('UPDATE intake SET state=?,receipt=?,next_attempt=0 WHERE hash=?',(state_name,json.dumps({
                    'documentId':receipt['documentId'],'idempotencyKey':receipt['idempotencyKey'],
                    'payloadSha256':receipt['payloadSha256'],'processing':receipt['processing']}),identity));conn.commit()
                accepted+=1;verified+=int(done);waiting+=int(not done)
            except (sync.SyncError,OSError):
                conn.execute('UPDATE intake SET state=?,next_attempt=? WHERE hash=?',('RETRY',time.time()+min(3600,30*2**min(attempts-1,7)),identity));conn.commit();waiting+=1
    finally:conn.close()
    report_confirmed=False
    try:
        report_status,report=transport(config['origin'].rstrip('/')+'/api/integration/ping',token,{'component':'AURORA_CLIENT_AGENT','instanceId':config['instanceId'],'pendingExtraction':min(pending,10000),'providers':provider_states})
        report_confirmed=report_status==200 and report.get('ok') is True and report.get('reportAccepted') is True and report.get('orgId')==config['org']
    except (sync.SyncError,OSError):pass
    return {'schemaVersion':SCHEMA,'componentVersion':VERSION,'orgId':config['org'],'connectionVerified':True,'agentReportConfirmed':report_confirmed,
            'receiptsConfirmed':accepted,'processingReceiptsCached':verified,'pending':waiting,'pendingExtraction':pending,
            'coverageLimited':limited or len(documents)>MAX_ENTRIES,'providers':provider_states,'fullSynchronizationVerified':False}


def main(argv=None):
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--once',action='store_true');parser.add_argument('--watch',action='store_true')
    args=parser.parse_args(argv)
    config_path=safe_path(args.config)
    if not config_path.is_file() or config_path.stat().st_nlink!=1:raise sync.SyncError('CONFIG_INTEGRITY_FAILED')
    config=json.loads(config_path.read_text())
    _,state=validate(config)
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
