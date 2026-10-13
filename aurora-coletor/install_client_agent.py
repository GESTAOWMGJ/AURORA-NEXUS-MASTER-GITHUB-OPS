"""Install one app-scoped lightweight intake component; preserve the existing app."""
import argparse
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

from aurora_deployment import safe_path
from aurora_cloud_sync import SyncError
from client_agent import validate,SCHEMA,VERSION
from client_secret_store import store

ASSETS=('client_agent.py','provider_connectors.py','client_secret_store.py','aurora_cloud_sync.py','aurora_deployment.py','install_client_agent.py','published_release.py')


def install(target,config,source=None,startup=False,configure_secrets=False,start_now=False):
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
    launcher=None
    if startup:
        if sys.platform=='darwin':
            parent=safe_path(Path.home()/'Library/LaunchAgents');parent.mkdir(parents=True,exist_ok=True)
            launcher=safe_path(parent/('br.com.auroranexus.client.'+config['org']+'.plist'))
            if launcher.exists():raise SyncError('EXISTING_STARTUP_REQUIRES_RECONCILIATION')
            content=plistlib.dumps({'Label':'br.com.auroranexus.client.'+config['org'],
                'ProgramArguments':[sys.executable,str(target/'bin/client_agent.py'),'--config',str(cfg),'--watch'],
                'RunAtLoad':True,'KeepAlive':False,'ProcessType':'Background','LowPriorityIO':True,'Nice':10})
        else:
            parent=safe_path(Path(os.environ['APPDATA'])/'Microsoft/Windows/Start Menu/Programs/Startup')
            launcher=safe_path(parent/('AURORA Client Agent-'+config['org']+'.cmd'))
            if launcher.exists():raise SyncError('EXISTING_STARTUP_REQUIRES_RECONCILIATION')
            values=[sys.executable,str(target/'bin/client_agent.py'),str(cfg)]
            if any(any(c in value for c in '\r\n"%&|<>^') for value in values):raise SyncError('STARTUP_PATH_REJECTED')
            content=('@echo off\r\n"'+values[0]+'" "'+values[1]+'" --config "'+values[2]+'" --watch\r\n').encode()
    target.mkdir(mode=0o700,parents=True);(target/'bin').mkdir(mode=0o700);(target/'state').mkdir(mode=0o700)
    if sys.platform=='win32':
        user=subprocess.check_output(['whoami.exe'],text=True).strip()
        subprocess.run(['icacls.exe',str(target),'/inheritance:r','/grant:r',user+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],check=True,capture_output=True)
    for name in ASSETS:shutil.copy2(source/name,target/'bin'/name)
    cfg=target/'agent-config.json';cfg.write_text(json.dumps(config,indent=2)+'\n');cfg.chmod(0o600)
    prepared={'component':'AURORA_CLIENT_AGENT','version':VERSION,'orgId':config['org'],'packageFiles':files,'startupPath':None,'state':'PREPARED','connectionVerified':False,'firstIngestionVerified':False}
    (target/'installation.json').write_text(json.dumps(prepared)+'\n');(target/'installation.json').chmod(0o600)
    if configure_secrets:
        aliases={config['tokenEnv'],*(p['tokenEnv'] for p in config.get('providers',[]))}
        for alias in sorted(aliases):store(target/'state',config['org'],alias,getpass.getpass('Credencial protegida '+alias+': '))
    if launcher:
        with launcher.open('xb') as handle:handle.write(content)
        launcher.chmod(0o600)
    receipt={'component':'AURORA_CLIENT_AGENT','version':VERSION,'orgId':config['org'],'schemaVersion':SCHEMA,
        'packageFiles':files,'startupInstalled':startup,'connectionVerified':False,'firstIngestionVerified':False,
        'providerConnectionsVerified':False,'existingApplicationPreserved':True,'processStarted':False,
        'startupPath':str(launcher) if launcher else None,
        'startupSha256':hashlib.sha256(launcher.read_bytes()).hexdigest() if launcher else None}
    (target/'installation.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if start_now:
        child=subprocess.Popen([sys.executable,str(target/'bin/client_agent.py'),'--config',str(cfg),'--watch'],
            stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0,start_new_session=sys.platform!='win32')
        receipt['processStarted']=True;receipt['processId']=child.pid
        (target/'installation.json').write_text(json.dumps(receipt,indent=2)+'\n')
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
    parser.add_argument('--start-now',action='store_true');args=parser.parse_args()
    if args.disable:print(json.dumps(disable(args.target)));return
    if not args.config:raise SyncError('CONFIG_REQUIRED')
    path=safe_path(args.config)
    if not path.is_file() or path.stat().st_nlink!=1 or path.stat().st_size>16384:raise SyncError('CONFIG_INTEGRITY_FAILED')
    result=install(args.target,json.loads(path.read_text()),startup=args.startup,configure_secrets=args.configure_secrets,start_now=args.start_now)
    print(json.dumps({k:v for k,v in result.items() if k not in ('packageFiles','startupPath')}))


if __name__=='__main__':
    try:main()
    except (SyncError,OSError,ValueError,subprocess.SubprocessError):
        print(json.dumps({'state':'BLOCKED','code':'CLIENT_INSTALLATION_REQUIRES_RECONCILIATION'}));raise SystemExit(2)
