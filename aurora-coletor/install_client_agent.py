"""Install one app-scoped lightweight intake component; preserve the existing app."""
import argparse
from contextlib import contextmanager
import getpass
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import uuid

from aurora_deployment import safe_path,read_json,atomic_json
import aurora_cloud_sync as sync
from aurora_cloud_sync import SyncError
import client_agent as agent
from client_agent import validate,SCHEMA,VERSION
from provider_connectors import pull
from client_secret_store import store

ASSETS=('client_agent.py','provider_connectors.py','client_secret_store.py','aurora_cloud_sync.py','aurora_deployment.py','install_client_agent.py','published_release.py')


def install(target,config,source=None,startup=False,configure_secrets=False,start_now=False,
            verify_integration=False,environment=os.environ,transport=sync.request_json,provider_pull=pull):
    target=safe_path(target);source=Path(source or __file__).resolve().parent
    if target.exists():raise SyncError('EXISTING_AGENT_REQUIRES_RECONCILIATION')
    config={**config,'instanceId':config.get('instanceId') or uuid.uuid4().hex,'stateDir':str(target/'state')}
    validate(config) # Validate source authorization before creating or copying anything.
    if startup and sys.platform not in ('win32','darwin'):raise SyncError('NATIVE_STARTUP_PLATFORM_REQUIRED')
    files={}
    for name in ASSETS:
        asset=source/name
        if asset.is_symlink() or not asset.is_file() or asset.stat().st_nlink!=1:raise SyncError('AGENT_PACKAGE_INCOMPLETE')
        files[name]=hashlib.sha256(asset.read_bytes()).hexdigest()
    cfg=target/'agent-config.json'
    target.mkdir(mode=0o700,parents=True);(target/'bin').mkdir(mode=0o700);(target/'state').mkdir(mode=0o700)
    if sys.platform=='win32':
        user=subprocess.check_output(['whoami.exe'],text=True).strip()
        subprocess.run(['icacls.exe',str(target),'/inheritance:r','/grant:r',user+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],check=True,capture_output=True)
    for name in ASSETS:shutil.copy2(source/name,target/'bin'/name)
    cfg=target/'agent-config.json';cfg.write_text(json.dumps(config,indent=2)+'\n');cfg.chmod(0o600)
    prepared={'component':'AURORA_CLIENT_AGENT','version':VERSION,'orgId':config['org'],'schemaVersion':SCHEMA,
        'instanceId':config['instanceId'],'configurationSha256':hashlib.sha256(cfg.read_bytes()).hexdigest(),
        'packageFiles':files,'startupPath':None,'state':'PREPARED','connectionVerified':False,'firstIngestionVerified':False,
        'startupRequested':startup,'startRequested':start_now,'startupInstalled':False,'processStarted':False,
        'existingApplicationPreserved':True,'installationComplete':False,'globalIngestionVerified':False}
    atomic_json(target/'installation.json',prepared)
    if configure_secrets:
        aliases={config['tokenEnv'],*(p['tokenEnv'] for p in config.get('providers',[]))}
        for alias in sorted(aliases):store(target/'state',config['org'],alias,getpass.getpass('Credencial protegida '+alias+': '))
    if verify_integration or start_now:
        return continue_installation(target,environment,transport,provider_pull)
    return prepared


@contextmanager
def installation_guard(target):
    path=safe_path(target/'installation.lock')
    try:descriptor=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError:raise SyncError('INSTALLATION_BUSY_OR_INTERRUPTED') from None
    try:
        os.close(descriptor)
        yield
    finally:path.unlink()


def verified_staging(target,allow_installed=False):
    receipt=read_json(target/'installation.json');cfg=safe_path(target/'agent-config.json')
    if (receipt.get('component')!='AURORA_CLIENT_AGENT' or receipt.get('version')!=VERSION
            or receipt.get('state') not in (('PREPARED','PENDING_INTEGRATION','INSTALLED') if allow_installed else ('PREPARED','PENDING_INTEGRATION'))
            or (receipt.get('installationComplete') is not (receipt.get('state')=='INSTALLED'))
            or set(receipt.get('packageFiles',{}))!=set(ASSETS)):
        raise SyncError('EXISTING_AGENT_REQUIRES_RECONCILIATION')
    config=read_json(cfg);validate(config)
    if (config['instanceId']!=receipt.get('instanceId') or config['org']!=receipt.get('orgId')
            or config['stateDir']!=str(target/'state')
            or hashlib.sha256(cfg.read_bytes()).hexdigest()!=receipt.get('configurationSha256')):
        raise SyncError('AGENT_CONFIGURATION_CHANGED')
    for name,digest in receipt['packageFiles'].items():
        path=safe_path(target/'bin'/name)
        if not path.is_file() or path.stat().st_nlink!=1 or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
            raise SyncError('AGENT_PACKAGE_CHANGED')
    return receipt,config


def verify_existing_integration(target,environment=os.environ,transport=sync.request_json,provider_pull=pull):
    """Fresh proof from this existing identity; no install, startup or extra executor."""
    target=safe_path(target)
    with installation_guard(target):
        receipt,config=verified_staging(target,allow_installed=True)
        with agent.lock(Path(config['stateDir'])):
            report=agent.cycle(config,environment,transport,provider_pull,verify_installation=True)
        current,current_config=verified_staging(target,allow_installed=True)
        if current!=receipt or current_config!=config:raise SyncError('AGENT_CONFIGURATION_CHANGED')
        readiness=report.get('installationReadiness',{})
        if readiness.get('eligible') is not True:raise SyncError('REAL_SOURCE_AUTOMATION_INTEGRATION_REQUIRED')
        return readiness


def startup_payload(target,config):
    cfg=target/'agent-config.json'
    if sys.platform=='darwin':
        parent=safe_path(Path.home()/'Library/LaunchAgents')
        launcher=safe_path(parent/('br.com.auroranexus.client.'+config['org']+'.plist'))
        content=plistlib.dumps({'Label':'br.com.auroranexus.client.'+config['org'],
            'ProgramArguments':[sys.executable,'-B',str(target/'bin/client_agent.py'),'--config',str(cfg),'--watch'],
            'RunAtLoad':True,'KeepAlive':False,'ProcessType':'Background','LowPriorityIO':True,'Nice':10})
    elif sys.platform=='win32':
        parent=safe_path(Path(os.environ['APPDATA'])/'Microsoft/Windows/Start Menu/Programs/Startup')
        launcher=safe_path(parent/('AURORA Client Agent-'+config['org']+'.cmd'))
        values=[sys.executable,str(target/'bin/client_agent.py'),str(cfg)]
        if any(any(c in value for c in '\r\n"%&|<>^') for value in values):raise SyncError('STARTUP_PATH_REJECTED')
        content=('@echo off\r\n"'+values[0]+'" -B "'+values[1]+'" --config "'+values[2]+'" --watch\r\n').encode()
    else:raise SyncError('NATIVE_STARTUP_PLATFORM_REQUIRED')
    if launcher.exists():raise SyncError('EXISTING_STARTUP_REQUIRES_RECONCILIATION')
    return launcher,content


def continue_installation(target,environment=os.environ,transport=sync.request_json,provider_pull=pull):
    """Resume this staged identity and queue; never create a second collector."""
    target=safe_path(target)
    with installation_guard(target):
        receipt,config=verified_staging(target)
        staged=dict(receipt)
        try:
            with agent.lock(Path(config['stateDir'])):
                report=agent.cycle(config,environment,transport,provider_pull,verify_installation=True)
        except (SyncError,OSError,ValueError):
            receipt.update(state='PENDING_INTEGRATION',installationComplete=False,
                           nextAction='REVALIDATE_AUTHORIZED_SOURCE_AND_CANONICAL_AUTOMATION')
            atomic_json(target/'installation.json',receipt)
            return receipt
        current,current_config=verified_staging(target)
        if current!=staged or current_config!=config:raise SyncError('AGENT_CONFIGURATION_CHANGED')
        readiness=report.get('installationReadiness',{})
        receipt.update(state='PENDING_INTEGRATION',connectionVerified=report.get('connectionVerified') is True,
                       firstIngestionVerified=bool(readiness.get('processingReceiptsVerifiedThisRun',0)),
                       integrationReadiness=readiness,installationComplete=False)
        if readiness.get('eligible') is not True:
            atomic_json(target/'installation.json',receipt)
            return receipt
        launcher=None
        if receipt['startupRequested']:
            launcher,content=startup_payload(target,config)
            launcher.parent.mkdir(parents=True,exist_ok=True)
            with launcher.open('xb') as handle:
                handle.write(content);handle.flush();os.fsync(handle.fileno())
            launcher.chmod(0o600)
        receipt.update(state='INSTALLED',installationComplete=True,automationIntegrationVerified=True,
                       startupInstalled=launcher is not None,startupPath=str(launcher) if launcher else None,
                       startupSha256=hashlib.sha256(launcher.read_bytes()).hexdigest() if launcher else None,
                       providerConnectionsVerified='CLOUD_OAUTH' in readiness['sourceModesVerifiedThisRun'],
                       agentExecutionVerified=False,globalIngestionVerified=False)
        # Commit before starting: an interrupted continuation must not launch another instance.
        atomic_json(target/'installation.json',receipt)
        if receipt['startRequested']:
            child=subprocess.Popen([sys.executable,'-B',str(target/'bin/client_agent.py'),'--config',str(target/'agent-config.json'),'--watch'],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0,start_new_session=sys.platform!='win32')
            receipt.update(processStarted=True,processId=child.pid)
            atomic_json(target/'installation.json',receipt)
        return receipt


def disable(target):
    target=safe_path(target);receipt=json.loads((target/'installation.json').read_text())
    if receipt.get('component')!='AURORA_CLIENT_AGENT':raise SyncError('UNKNOWN_AGENT')
    for name,digest in receipt.get('packageFiles',{}).items():
        if name not in ASSETS or hashlib.sha256(safe_path(target/'bin'/name).read_bytes()).hexdigest()!=digest:
            raise SyncError('AGENT_PACKAGE_CHANGED')
    startup=receipt.get('startupPath')
    if startup:
        path=safe_path(startup)
        if path.exists():
            if hashlib.sha256(path.read_bytes()).hexdigest()!=receipt.get('startupSha256'):raise SyncError('STARTUP_CHANGED')
            path.unlink()
    marker=safe_path(target/'state/disabled.json');marker.write_text(json.dumps({'orgId':receipt['orgId'],'state':'DISABLED'})+'\n');marker.chmod(0o600)
    return {'state':'DISABLE_REQUESTED','credentialsAndReceiptsPreserved':True,'processExitPending':True}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--target',required=True);parser.add_argument('--config');parser.add_argument('--disable',action='store_true')
    parser.add_argument('--startup',action='store_true');parser.add_argument('--configure-secrets',action='store_true')
    parser.add_argument('--start-now',action='store_true')
    parser.add_argument('--verify-integration',action='store_true',help='Read the approved source and require processing plus replay before promotion')
    parser.add_argument('--continue-integration',action='store_true',help='Resume the same staged configuration, instance and queue')
    args=parser.parse_args()
    if args.disable:print(json.dumps(disable(args.target)));return
    if args.continue_integration:
        if args.config or args.startup or args.configure_secrets or args.start_now or args.verify_integration:
            raise SyncError('EXISTING_STAGED_CONFIGURATION_REQUIRED')
        result=continue_installation(args.target)
        print(json.dumps({k:v for k,v in result.items() if k not in ('packageFiles','startupPath')}))
        return 0 if result.get('installationComplete') is True else 2
    if not args.config:raise SyncError('CONFIG_REQUIRED')
    path=safe_path(args.config)
    if not path.is_file() or path.stat().st_nlink!=1 or path.stat().st_size>16384:raise SyncError('CONFIG_INTEGRITY_FAILED')
    result=install(args.target,json.loads(path.read_text()),startup=args.startup,configure_secrets=args.configure_secrets,
                   start_now=args.start_now,verify_integration=args.verify_integration)
    print(json.dumps({k:v for k,v in result.items() if k not in ('packageFiles','startupPath')}))
    return 2 if (args.verify_integration or args.start_now) and result.get('installationComplete') is not True else 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except (SyncError,OSError,ValueError,subprocess.SubprocessError):
        print(json.dumps({'state':'BLOCKED','code':'CLIENT_INSTALLATION_REQUIRES_RECONCILIATION'}));raise SystemExit(2)
