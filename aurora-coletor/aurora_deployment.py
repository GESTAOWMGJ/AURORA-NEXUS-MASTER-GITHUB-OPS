#!/usr/bin/env python3
"""Resumable installation diagnostic using the existing canonical transport.

The local checkpoint is an operational cache, never cloud authorization or proof
of current remote data. No credentials, source paths or business values persist.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

import aurora_cloud_sync as sync

VERSION = '1.0.0'
SCHEMA = 'aurora.install.integration.v1'
STATE_NAME = 'integration-setup.json'
ASSETS = ('aurora_cloud_sync.py', 'aurora_deployment.py')


def safe_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute() or '..' in path.parts:
        raise sync.SyncError('ABSOLUTE_PATH_REQUIRED')
    for part in (path, *path.parents):
        if part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()):
            raise sync.SyncError('LINK_PATH_REJECTED')
    return path


def read_json(path):
    path = safe_path(path)
    if not path.is_file() or path.stat().st_nlink != 1:
        raise sync.SyncError('REGULAR_FILE_REQUIRED')
    with path.open('rb') as stream:
        content = stream.read(sync.MAX_BYTES + 1)
    if len(content) > sync.MAX_BYTES:
        raise sync.SyncError('INPUT_TOO_LARGE')
    return json.loads(content, object_pairs_hook=sync.unique_object)


def atomic_json(path, value):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.integration-', delete=False) as stream:
            temporary = Path(stream.name)
            os.chmod(temporary, 0o600)
            json.dump(value, stream, sort_keys=True, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


@contextmanager
def checkpoint_lock(directory):
    directory = safe_path(directory)
    if not directory.is_dir():
        raise sync.SyncError('EXISTING_STATE_DIRECTORY_REQUIRED')
    if os.name == 'posix' and stat.S_IMODE(directory.stat().st_mode) & 0o077:
        raise sync.SyncError('PRIVATE_STATE_DIRECTORY_REQUIRED')
    lock = directory / 'integration-setup.lock'
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise sync.SyncError('INSTALLATION_BUSY_OR_INTERRUPTED') from None
    try:
        os.close(descriptor)
        yield directory / STATE_NAME
    finally:
        lock.unlink()


def next_action(code):
    if code == 'INTEGRATION_CREDENTIAL_REQUIRED' or code in ('BLOCKED_HTTP_401', 'BLOCKED_HTTP_403'):
        return 'PROVISION_OR_REVALIDATE_SCOPED_CREDENTIAL_WITH_MFA'
    if code == 'BLOCKED_HTTP_404':
        return 'VERIFY_PROTECTED_DEPLOY_AND_INTEGRATION_ROUTES'
    if code.startswith('RETRYABLE_'):
        return 'RETRY_SAME_SAMPLE_AFTER_CONNECTION_RECOVERY'
    if code in ('CLOUD_RECEIPT_MISMATCH', 'AUTHENTICATED_ORGANIZATION_MISMATCH'):
        return 'RECONCILE_DESTINATION_AND_SERVER_RECEIPT'
    return 'REVIEW_BLOCKER_WITH_ADMINISTRATOR'


def run(raw, origin, org, state_dir, token=None, connect=False, send=False,
        transport=sync.request_json):
    # All input is validated before checkpoint or network effects.
    preview = sync.synchronize(raw, origin, org)
    binding = sync.digest(sync.origin_url(origin) + ':' + org)
    with checkpoint_lock(state_dir) as state_path:
        previous = read_json(state_path) if state_path.exists() or state_path.is_symlink() else None
        if previous is not None:
            if not isinstance(previous, dict) or previous.get('schemaVersion') != SCHEMA:
                raise sync.SyncError('CHECKPOINT_SCHEMA_CONFLICT')
            if previous.get('targetBinding') != binding:
                raise sync.SyncError('CHECKPOINT_TARGET_CONFLICT')
            if previous.get('sampleKey') != preview['idempotencyKey']:
                raise sync.SyncError('CHECKPOINT_SAMPLE_CONFLICT')
            if type(previous.get('attempt')) is not int or previous['attempt'] < 1:
                raise sync.SyncError('CHECKPOINT_SCHEMA_CONFLICT')
        old_receipt = previous.get('receipt') if previous else None
        if old_receipt is not None:
            expected = dict(preview, status=old_receipt.get('status') if isinstance(old_receipt, dict) else None,
                            cloudReceiptVerified=True)
            if old_receipt != expected or expected['status'] not in ('ACCEPTED', 'DUPLICATE'):
                raise sync.SyncError('CHECKPOINT_RECEIPT_CONFLICT')
        result = {
            'schemaVersion': SCHEMA, 'componentVersion': VERSION,
            'targetBinding': binding, 'sampleKey': preview['idempotencyKey'],
            'attempt': (previous['attempt'] if previous else 0) + 1,
            'updatedAt': datetime.now(timezone.utc).isoformat(),
            'status': 'LOCAL_VALIDATED', 'nextAction': 'VERIFY_AUTHENTICATED_CONNECTION',
            'connectionVerified': False, 'receiptVerifiedThisRun': False,
            'previousReceiptCached': old_receipt is not None,
            'receipt': old_receipt, 'fullSynchronizationVerified': False,
            'productionReleased': False,
        }
        # Never trust cached credentials/connections after a restart or rotation.
        if connect or send:
            try:
                if send and old_receipt is None:
                    receipt = sync.synchronize(raw, origin, org, token, True, transport)
                    result.update(connectionVerified=True, receiptVerifiedThisRun=True, receipt=receipt,
                                  status='SAMPLE_RECEIPT_VERIFIED', nextAction='RECONCILE_SAMPLE_IN_CANONICAL_STORAGE')
                else:
                    sync.connect(origin, org, token, transport)
                    result.update(connectionVerified=True, status='CONNECTION_VERIFIED',
                                  nextAction='AUTHORIZE_SAMPLE_SEND')
                    if old_receipt:
                        result.update(status='PREVIOUS_RECEIPT_CACHED', nextAction='RECONCILE_SAMPLE_IN_CANONICAL_STORAGE')
            except sync.SyncError as error:
                # Transport errors expose only stable codes, never response bodies.
                code = str(error)
                if not re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', code):
                    code = 'INTEGRATION_FAILED'
                result.update(status='BLOCKED', code=code, nextAction=next_action(code))
        atomic_json(state_path, result)
        return result


def install_assets(source, target):
    """Bundle the same reviewed transport in the existing installation; no service."""
    source, target = safe_path(source), safe_path(target)
    if not target.is_dir():
        raise sync.SyncError('EXISTING_INSTALLATION_REQUIRED')
    root = safe_path(target / 'integration')
    root.mkdir(mode=0o700, exist_ok=True)
    state = safe_path(root / 'state')
    state.mkdir(mode=0o700, exist_ok=True)
    destination = safe_path(root / VERSION)
    assets = {name: (source / name).read_bytes() for name in ASSETS}
    manifest = {'schemaVersion': SCHEMA, 'version': VERSION,
                'sha256': {name: hashlib.sha256(content).hexdigest() for name, content in assets.items()}}
    if destination.exists():
        if read_json(destination / 'manifest.json') != manifest:
            raise sync.SyncError('INSTALLED_COMPONENT_CONFLICT')
        for name, expected in manifest['sha256'].items():
            path = safe_path(destination / name)
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise sync.SyncError('INSTALLED_COMPONENT_CONFLICT')
        return {'version': VERSION, 'alreadyInstalled': True}
    staging = Path(tempfile.mkdtemp(prefix='.integration-staging-', dir=root))
    try:
        for name, content in assets.items():
            (staging / name).write_bytes(content)
        atomic_json(staging / 'manifest.json', manifest)
        staging.rename(destination)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return {'version': VERSION, 'alreadyInstalled': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, help='Explicit approved structured sample JSON')
    parser.add_argument('--origin', required=True)
    parser.add_argument('--org', required=True)
    parser.add_argument('--state-dir', required=True, help='Existing private installation state directory')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--connect', action='store_true', help='Authenticated ping only; no document POST')
    mode.add_argument('--send', action='store_true', help='Explicitly send the authorized sample once')
    args = parser.parse_args(argv)
    try:
        result = run(read_json(args.input), args.origin, args.org, args.state_dir,
                     os.environ.get('AURORA_INTEGRATION_TOKEN'), args.connect, args.send)
        print(json.dumps(result, sort_keys=True))
        return 2 if result['status'] == 'BLOCKED' else 0
    except (OSError, ValueError, TypeError) as error:
        code = str(error) if isinstance(error, sync.SyncError) else 'LOCAL_INSTALLATION_UNAVAILABLE'
        print(json.dumps({'status': 'BLOCKED', 'code': code, 'fullSynchronizationVerified': False}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
