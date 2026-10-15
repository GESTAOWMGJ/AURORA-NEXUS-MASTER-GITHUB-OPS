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
import secrets
import time

import aurora_cloud_sync as sync

VERSION = '1.0.5'
CHECKPOINT_VERSIONS = ('1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4', VERSION)
SCHEMA = 'aurora.install.integration.v1'
STATE_NAME = 'integration-setup.json'
ASSETS = ('client_agent.py', 'provider_connectors.py', 'client_secret_store.py', 'install_client_agent.py',
          'aurora_cloud_sync.py', 'aurora_deployment.py', 'published_release.py')
CHECKPOINT_FIELDS = {'schemaVersion', 'componentVersion', 'targetBinding', 'sampleKey', 'attempt', 'updatedAt',
                     'status', 'nextAction', 'connectionVerified', 'receiptVerifiedThisRun',
                     'processingVerifiedThisRun', 'processingProof', 'previousReceiptCached', 'receipt',
                     'fullSynchronizationVerified', 'productionReleased', 'code', 'installationAcceptance'}


def _trusted_platform_alias(part):
    """Allow only immutable macOS root aliases; reject all user-controlled links."""
    if sys.platform != 'darwin':
        return False
    aliases = {
        '/tmp': '/private/tmp',
        '/var': '/private/var',
        '/etc': '/private/etc',
    }
    expected = aliases.get(str(part))
    if expected is None:
        return False
    try:
        return str(part.resolve(strict=True)) == expected
    except OSError:
        return False


def safe_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute() or '..' in path.parts:
        raise sync.SyncError('ABSOLUTE_PATH_REQUIRED')
    for part in (path, *path.parents):
        linked = part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction())
        if linked and not _trusted_platform_alias(part):
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
    if code in ('CLOUD_RECEIPT_MISMATCH', 'CLOUD_PROCESSING_PROOF_MISMATCH', 'AUTHENTICATED_ORGANIZATION_MISMATCH'):
        return 'RECONCILE_DESTINATION_AND_SERVER_RECEIPT'
    return 'REVIEW_BLOCKER_WITH_ADMINISTRATOR'


def run(raw, origin, org, state_dir, token=None, connect=False, send=False,
        transport=sync.request_json):
    # All input is validated before checkpoint or network effects.
    preview = sync.synchronize(raw, origin, org)
    binding = sync.digest(sync.origin_url(origin) + ':' + org)
    marker = safe_path(safe_path(state_dir) / 'ia-master' / 'installation.json')
    if marker.exists() or marker.is_symlink():
        raise sync.SyncError('EXPLICIT_CHECKPOINT_TRANSITION_REQUIRED')
    with checkpoint_lock(state_dir) as state_path:
        if safe_path(marker).exists() or marker.is_symlink():
            raise sync.SyncError('EXPLICIT_CHECKPOINT_TRANSITION_REQUIRED')
        previous = read_json(state_path) if state_path.exists() or state_path.is_symlink() else None
        if previous is not None:
            if (not isinstance(previous, dict) or set(previous) - CHECKPOINT_FIELDS
                    or previous.get('schemaVersion') != SCHEMA
                    or previous.get('componentVersion') not in CHECKPOINT_VERSIONS):
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
        old_processing = previous.get('processingProof') if previous else None
        if old_processing is not None:
            try:
                proof = sync.processing_proof(sync.validate_payload(raw), org, old_processing)
            except sync.SyncError:
                raise sync.SyncError('CHECKPOINT_RECEIPT_CONFLICT') from None
            if old_receipt is None or proof != old_processing:
                raise sync.SyncError('CHECKPOINT_RECEIPT_CONFLICT')
        result = {
            'schemaVersion': SCHEMA, 'componentVersion': VERSION,
            'targetBinding': binding, 'sampleKey': preview['idempotencyKey'],
            'attempt': (previous['attempt'] if previous else 0) + 1,
            'updatedAt': datetime.now(timezone.utc).isoformat(),
            'status': 'LOCAL_VALIDATED', 'nextAction': 'VERIFY_AUTHENTICATED_CONNECTION',
            'connectionVerified': False, 'receiptVerifiedThisRun': False,
            'processingVerifiedThisRun': False, 'processingProof': old_processing,
            'previousReceiptCached': old_receipt is not None,
            'receipt': old_receipt, 'fullSynchronizationVerified': False,
            'productionReleased': False,
        }
        # Never trust cached credentials/connections after a restart or rotation.
        if connect or send:
            try:
                if send:
                    # Replay the same canonical payload/key so the existing server can resume projection.
                    receipt = sync.synchronize(raw, origin, org, token, True, transport)
                    proof = receipt.pop('processing')
                    acceptance = receipt.pop('installationAcceptance', None)
                    result.update(connectionVerified=True, receiptVerifiedThisRun=True, receipt=receipt,
                                  processingProof=proof, processingVerifiedThisRun=proof['firstIngestionVerified'],
                                  status='SAMPLE_RECEIPT_VERIFIED',
                                  nextAction=('RETRY_SAME_SAMPLE_FOR_CANONICAL_PROCESSING'
                                              if not proof['firstIngestionVerified'] else
                                              'VERIFY_CONTINUITY_WITH_SUBSEQUENT_EVENTS'
                                              if proof['operationalComplete'] else 'COMPLETE_AUTHENTICATED_SETUP'))
                    if acceptance is not None:
                        result['installationAcceptance'] = acceptance
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
        saved = dict(result)
        if 'installationAcceptance' in saved:
            # The checkpoint keeps opaque bindings, not a tenant/origin identifier or an authorization cache.
            saved['installationAcceptance'] = {key: value for key, value in saved['installationAcceptance'].items()
                                               if key not in ('orgId', 'canonicalOrigin')}
        if safe_path(marker).exists() or marker.is_symlink():
            raise sync.SyncError('EXPLICIT_CHECKPOINT_TRANSITION_REQUIRED')
        atomic_json(safe_path(state_path), saved)
        return result


def _read_manual_installation(raw, origin, org, token, transport):
    """Read an existing manual receipt twice; never import, replay or write a checkpoint."""
    payload = sync.validate_payload(raw)
    preview = sync.synchronize(payload, origin, org)
    if not isinstance(token, str) or not token or any(character.isspace() for character in token):
        raise sync.SyncError('INTEGRATION_CREDENTIAL_REQUIRED')
    url = sync.origin_url(origin) + '/api/integration/ping?documentId=' + preview['documentId']
    previous_binding = None
    for _ in range(2):
        status, response = transport(url, token)
        if (status != 200 or not isinstance(response, dict) or response.get('ok') is not True
                or response.get('orgId') != org or response.get('service') != 'aurora-nexus-integration'
                or not isinstance(response.get('keyId'), str)
                or not re.fullmatch(r'ik_[a-f0-9]{16}', response['keyId'])):
            raise sync.SyncError('AUTHENTICATED_ORGANIZATION_MISMATCH')
        installation = response.get('installation')
        proof = sync.processing_proof(payload, org, installation)
        if proof.get('firstIngestionVerified') is not True:
            raise sync.SyncError('AUTHENTICATED_PROCESSING_REQUIRED')
        acceptance = sync.installation_acceptance(payload, org, installation.get('acceptance'), proof)
        if (not isinstance(acceptance, dict) or acceptance.get('eligible') is not True
                or acceptance.get('method') != 'MANUAL'
                or acceptance['acquisitionModes']['MANUAL'] != 'CANONICAL_PIPELINE_VERIFIED'
                or not all(acceptance.get(key) is True for key in
                           ('processingVerified', 'receiptPersisted', 'replayVerified',
                            'automationConfigured', 'automationVerified'))):
            raise sync.SyncError('AUTHORITATIVE_AUTOMATION_INTEGRATION_REQUIRED')
        # Server observation times may advance. The authenticated reader, exact
        # revision and persisted receipt/configuration must remain unchanged.
        binding = sync.digest(json.dumps({
            'readerKeyId': response['keyId'],
            'processing': {key: value for key, value in proof.items() if key != 'verifiedAt'},
            'acceptance': {key: value for key, value in acceptance.items() if key != 'verifiedAt'},
        }, sort_keys=True, separators=(',', ':'), allow_nan=False))
        if previous_binding is not None and binding != previous_binding:
            raise sync.SyncError('MANUAL_INSTALLATION_READBACK_CHANGED')
        previous_binding = binding
    return {**acceptance, 'installationComplete': False,
            'targetBinding': sync.digest(sync.origin_url(origin) + ':' + org),
            'sampleKey': preview['idempotencyKey'], 'checkpointChanged': False,
            'proofScope': 'AUTHENTICATED_MANUAL_RECEIPT_READBACK',
            'replayPersistedVerified': True, 'documentReplayPerformedByInstaller': False,
            'globalIngestionVerified': False, 'sourceAcquisitionCertified': False}


def integrate_installation(raw, origin, org, state_dir, token=None, method='API_TOKEN', transport=sync.request_json):
    """Current authenticated processing + replay gate; cloud/local require their real source adapter."""
    if method not in ('API_TOKEN', 'MANUAL'):
        raise sync.SyncError('REAL_SOURCE_ADAPTER_REQUIRED')
    if sync.origin_url(origin)!='https://auroranexus.com.br':
        raise sync.SyncError('CANONICAL_INSTALLATION_ORIGIN_REQUIRED')
    if method == 'MANUAL':
        return _read_manual_installation(raw, origin, org, token, transport)
    first = run(raw, origin, org, state_dir, token=token, send=True, transport=transport)
    if (first.get('connectionVerified') is not True or first.get('receiptVerifiedThisRun') is not True
            or first.get('processingVerifiedThisRun') is not True):
        raise sync.SyncError('AUTHENTICATED_PROCESSING_REQUIRED')
    replay = run(raw, origin, org, state_dir, token=token, send=True, transport=transport)
    if (replay.get('connectionVerified') is not True or replay.get('receiptVerifiedThisRun') is not True
            or replay.get('processingVerifiedThisRun') is not True
            or replay.get('targetBinding') != first['targetBinding'] or replay.get('sampleKey') != first['sampleKey']
            or replay.get('receipt', {}).get('status') != 'DUPLICATE'
            or any(replay['receipt'].get(key) != first['receipt'].get(key)
                   for key in ('payloadSha256', 'idempotencyKey', 'documentId'))):
        raise sync.SyncError('CURRENT_PROCESSING_REPLAY_REQUIRED')
    acceptance = replay.get('installationAcceptance')
    if (not isinstance(acceptance, dict) or acceptance.get('eligible') is not True
            or acceptance.get('method') != method
            or not all(acceptance.get(key) is True for key in
                       ('processingVerified', 'receiptPersisted', 'replayVerified', 'automationConfigured', 'automationVerified'))):
        raise sync.SyncError('AUTHORITATIVE_AUTOMATION_INTEGRATION_REQUIRED')
    # This is authorization to promote the selected installation, not an installation receipt.
    return {**acceptance, 'installationComplete': False,
            'targetBinding': replay['targetBinding'], 'sampleKey': replay['sampleKey'],
            'globalIngestionVerified': False, 'sourceAcquisitionCertified': False}


TRANSITION_SCHEMA = 'aurora.checkpoint.transition.v1'
TRANSITION_FIELDS = {'schemaVersion', 'stateDirectory', 'packageDirectory', 'expectedPreviousSha256',
                     'expectedPreviousTargetBinding', 'expectedPreviousSampleKey', 'nextOrigin',
                     'nextTargetBinding', 'nextSampleKey', 'payloadSha256', 'method', 'orgId',
                     'expectedSourceSha', 'expectedCertificateSha256', 'iaAnchor', 'previousTransition',
                     'publicReleaseControl', 'envelope'}
_TRANSITION_OWNERS = set()


def _transition_demand(condition, code):
    if not condition:
        raise sync.SyncError(code)


def _transition_encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                       allow_nan=False) + '\n').encode('utf-8')


def _transition_hash(value):
    return hashlib.sha256(value).hexdigest()


def _transition_hex(value, length=64):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{' + str(length) + '}', value) is not None


def _transition_bytes(value, maximum=65536):
    path = safe_path(value)
    before = path.stat()
    _transition_demand(path.is_file() and before.st_nlink == 1 and before.st_size <= maximum,
                       'CHECKPOINT_TRANSITION_REGULAR_FILE_REQUIRED')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0))
    try:
        opened = os.fstat(fd)
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(maximum + 1)
        after, observed = os.fstat(fd), path.stat()
        fields = ('st_dev', 'st_ino', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        _transition_demand(stat.S_ISREG(opened.st_mode) and len(data) == opened.st_size <= maximum
                           and all(getattr(opened, key) == getattr(after, key) for key in fields)
                           and all(getattr(before, key) == getattr(observed, key) for key in fields)
                           and all(getattr(opened, key) == getattr(observed, key)
                                   for key in fields if key != 'st_ctime_ns'), 'CHECKPOINT_TRANSITION_FILE_CHANGED')
        return data
    finally:
        os.close(fd)


def _transition_json(data):
    return json.loads(data, object_pairs_hook=sync.unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(sync.SyncError('INVALID_TRANSITION_JSON')))


def checkpoint_transition_plan(plan, raw=None):
    """Pure explicit plan validation. A plan is neither authorization nor a receipt."""
    _transition_demand(isinstance(plan, dict) and set(plan) == TRANSITION_FIELDS
                       and plan.get('schemaVersion') == TRANSITION_SCHEMA, 'EXPLICIT_CHECKPOINT_TRANSITION_PLAN_REQUIRED')
    for name in ('stateDirectory', 'packageDirectory'):
        _transition_demand(isinstance(plan[name], str) and Path(plan[name]).is_absolute()
                           and '..' not in Path(plan[name]).parts, 'ABSOLUTE_PATH_REQUIRED')
    _transition_demand(plan['method'] == 'API_TOKEN' and plan['nextOrigin'] == 'https://auroranexus.com.br'
                       and isinstance(plan['orgId'], str)
                       and re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}', plan['orgId']), 'CANONICAL_CHECKPOINT_TRANSITION_REQUIRED')
    for name in ('expectedPreviousSha256', 'expectedPreviousTargetBinding', 'nextTargetBinding',
                 'payloadSha256', 'expectedCertificateSha256'):
        _transition_demand(_transition_hex(plan[name]), 'INVALID_CHECKPOINT_TRANSITION_BINDING')
    _transition_demand(_transition_hex(plan['expectedSourceSha'], 40)
                       and all(isinstance(plan[name], str) and re.fullmatch(r'win-v1:[a-f0-9]{64}', plan[name])
                               for name in ('expectedPreviousSampleKey', 'nextSampleKey')),
                       'INVALID_CHECKPOINT_TRANSITION_BINDING')
    control, anchor, previous = plan['publicReleaseControl'], plan['iaAnchor'], plan['previousTransition']
    _transition_demand(isinstance(control, dict) and set(control) == {'trust', 'expectedSourceSha', 'manifestPath'}
                       and control['expectedSourceSha'] == plan['expectedSourceSha']
                       and isinstance(control['manifestPath'], str) and Path(control['manifestPath']).is_absolute()
                       and Path(control['manifestPath']).name == 'windowsIntegration-manifest.json'
                       and isinstance(control['trust'], dict)
                       and set(control['trust']) == {'publicKeySpkiPem', 'publicKeySha256'}
                       and isinstance(control['trust']['publicKeySpkiPem'], str)
                       and len(control['trust']['publicKeySpkiPem']) <= 8192
                       and _transition_hex(control['trust']['publicKeySha256']), 'PUBLIC_RELEASE_CONFIGURATION_REQUIRED')
    _transition_demand(isinstance(anchor, dict) and set(anchor) == {'attemptDirectory', 'journalSha256'}
                       and isinstance(anchor['attemptDirectory'], str) and Path(anchor['attemptDirectory']).is_absolute()
                       and _transition_hex(anchor['journalSha256']), 'SIGNED_IA_CHECKPOINT_ANCHOR_REQUIRED')
    if previous is not None:
        _transition_demand(isinstance(previous, dict) and set(previous) == {'directory', 'commitSha256'}
                           and isinstance(previous['directory'], str) and Path(previous['directory']).is_absolute()
                           and _transition_hex(previous['commitSha256']), 'CHECKPOINT_TRANSITION_CHAIN_REQUIRED')
    _transition_demand(isinstance(plan['envelope'], dict) and set(plan['envelope']) == {'certificate', 'signature'},
                       'PUBLIC_RELEASE_ENVELOPE_REQUIRED')
    _transition_demand(plan['nextTargetBinding'] == sync.digest(plan['nextOrigin'] + ':' + plan['orgId']),
                       'CHECKPOINT_TRANSITION_TARGET_CONFLICT')
    if raw is not None:
        preview = sync.synchronize(raw, plan['nextOrigin'], plan['orgId'])
        _transition_demand(preview['payloadSha256'] == plan['payloadSha256']
                           and preview['idempotencyKey'] == plan['nextSampleKey'], 'CHECKPOINT_TRANSITION_SAMPLE_CONFLICT')
    return {'schemaVersion': TRANSITION_SCHEMA, 'status': 'EXPLICIT_PLAN_NOT_AUTHORITY',
            'planSha256': _transition_hash(_transition_encoded(plan)), 'checkpointChanged': False,
            'currentPointerVerified': False, 'installationComplete': False, 'allClientsSynchronized': False}


def _transition_checkpoint(data, plan, previous=False):
    value = _transition_json(data)
    _transition_demand(isinstance(value, dict) and not set(value) - CHECKPOINT_FIELDS
                       and value.get('schemaVersion') == SCHEMA and value.get('componentVersion') in CHECKPOINT_VERSIONS
                       and type(value.get('attempt')) is int
                       and 1 <= value['attempt'] <= 9007199254740991 - int(previous),
                       'CHECKPOINT_SCHEMA_CONFLICT')
    prefix = 'expectedPrevious' if previous else 'next'
    _transition_demand(value.get('targetBinding') == plan[prefix + 'TargetBinding']
                       and value.get('sampleKey') == plan[prefix + 'SampleKey'], 'CHECKPOINT_TRANSITION_PREDECESSOR_CONFLICT')
    # Historical receipts are deliberately opaque. They never authenticate this transition.
    return value


def _transition_record(directory, commit_sha, state, org):
    directory = safe_path(directory)
    _transition_demand(directory.parent == state / 'checkpoint-transitions'
                       and _transition_hex(directory.name), 'CHECKPOINT_TRANSITION_CHAIN_REQUIRED')
    encoded = _transition_bytes(directory / 'plan.json')
    plan = _transition_json(encoded)
    checkpoint_transition_plan(plan)
    _transition_demand(encoded == _transition_encoded(plan) and _transition_hash(encoded) == directory.name
                       and Path(plan['stateDirectory']) == state and plan['orgId'] == org,
                       'CHECKPOINT_TRANSITION_CHAIN_CONFLICT')
    commit_bytes = _transition_bytes(directory / 'commit.json')
    commit = _transition_json(commit_bytes)
    _transition_demand(_transition_hash(commit_bytes) == commit_sha and isinstance(commit, dict)
                       and set(commit) == {'schemaVersion', 'planSha256', 'previousSha256', 'nextSha256', 'proofSha256'}
                       and commit['schemaVersion'] == 'aurora.checkpoint.transition.commit.v1'
                       and commit['planSha256'] == directory.name
                       and commit['previousSha256'] == plan['expectedPreviousSha256'], 'CHECKPOINT_TRANSITION_CHAIN_CONFLICT')
    for name, key in (('checkpoint.previous', 'previousSha256'), ('checkpoint.next', 'nextSha256'), ('proof.json', 'proofSha256')):
        _transition_demand(_transition_hash(_transition_bytes(directory / name)) == commit[key],
                           'CHECKPOINT_TRANSITION_CHAIN_CHANGED')
    _transition_checkpoint(_transition_bytes(directory / 'checkpoint.previous'), plan, True)
    _transition_checkpoint(_transition_bytes(directory / 'checkpoint.next'), plan)
    return plan, commit


def _transition_authority(plan, token):
    import published_release as release
    control = release.validate_control(plan['publicReleaseControl'])
    candidate = release.verify_candidate(plan['envelope'], control['trust'], plan['expectedSourceSha'])
    _transition_demand(candidate.complete_signed_set and candidate.certificate_sha256 == plan['expectedCertificateSha256'],
                       'CHECKPOINT_TRANSITION_CERTIFICATE_CONFLICT')
    pin = release.read_active_pin(token, control['trust'], plan['expectedSourceSha'], plan['orgId'])
    live = release.require_active(pin, expected_org=plan['orgId'])
    _transition_demand(live.certificate_sha256 == candidate.certificate_sha256,
                       'CHECKPOINT_TRANSITION_CERTIFICATE_CONFLICT')
    return release, candidate, pin


def _transition_local(plan, release, candidate):
    state, package = safe_path(plan['stateDirectory']), safe_path(plan['packageDirectory'])
    _transition_demand(state.is_dir() and package == safe_path(Path(__file__).absolute().parent),
                       'SAME_INSTALLED_CHECKPOINT_REQUIRED')
    if os.name == 'posix':
        _transition_demand(not stat.S_IMODE(state.stat().st_mode) & 0o077, 'PRIVATE_STATE_DIRECTORY_REQUIRED')
    files = {name: _transition_bytes(package / name, 32 * 1024 * 1024) for name in ASSETS}
    component = release.assess_manifest(candidate, 'windowsIntegration',
                                        _transition_bytes(plan['publicReleaseControl']['manifestPath']), files)
    _transition_demand(component['version'] == VERSION, 'CHECKPOINT_TRANSITION_COMPONENT_VERSION_CONFLICT')
    anchor = safe_path(plan['iaAnchor']['attemptDirectory'])
    _transition_demand(anchor.parent.name == 'installation-rollbacks'
                       and re.fullmatch(r'published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', anchor.name),
                       'SIGNED_IA_CHECKPOINT_ANCHOR_REQUIRED')
    journal_bytes = _transition_bytes(anchor / 'journal.json')
    _transition_demand(_transition_hash(journal_bytes) == plan['iaAnchor']['journalSha256'], 'SIGNED_IA_CHECKPOINT_ANCHOR_CHANGED')
    journal = _transition_json(journal_bytes)
    root, ia_state = anchor.parent.parent, state / 'ia-master'
    ia_package = root / 'components' / 'ia-master' / '1.0.1'
    trust = plan['publicReleaseControl']['trust']
    _transition_demand(journal.get('schemaVersion') == 'aurora.published.activation.v2'
                       and journal.get('phase') == 'COMPLETED' and anchor.name == 'published-' + str(journal.get('id'))
                       and journal.get('stateDir') == str(ia_state) and journal.get('packageDir') == str(ia_package)
                       and journal.get('helperPath') == str(root / 'server-location-manager.cjs')
                       and journal.get('sourceSha') == plan['expectedSourceSha']
                       and journal.get('certificateSha256') == plan['expectedCertificateSha256']
                       and journal.get('trustedPublicKeySha256') == trust['publicKeySha256'], 'SIGNED_IA_CHECKPOINT_ANCHOR_REQUIRED')
    anchored = release.verify_candidate(journal.get('acceptedEnvelope'), trust, journal['sourceSha'])
    _transition_demand(anchored.certificate_sha256 == candidate.certificate_sha256
                       and journal.get('manifestSha256') == anchored.certificate['components']['iaMaster']['manifestSha256'],
                       'SIGNED_IA_CHECKPOINT_ANCHOR_CONFLICT')
    manifest_bytes = _transition_bytes(ia_package / 'manifest.json')
    manifest = _transition_json(manifest_bytes)
    _transition_demand(isinstance(manifest.get('files'), dict), 'SIGNED_IA_CHECKPOINT_ANCHOR_CONFLICT')
    # assess_manifest validates each name; bound names before opening any local path.
    names = manifest['files']
    _transition_demand(len(names) == 34 and all(isinstance(name, str)
                       and re.fullmatch(r'[A-Za-z0-9_./-]{1,200}', name)
                       and all(part not in ('', '.', '..') and not part.startswith('.') for part in name.split('/'))
                       for name in names), 'SIGNED_IA_CHECKPOINT_ANCHOR_CONFLICT')
    ia_files = {name: _transition_bytes(ia_package / name, 32 * 1024 * 1024) for name in names}
    release.assess_manifest(anchored, 'iaMaster', manifest_bytes, ia_files)
    observed_names = {path.relative_to(ia_package).as_posix() for path in ia_package.rglob('*') if path.is_file()}
    _transition_demand(observed_names == set(names) | {'manifest.json'}, 'SIGNED_IA_CHECKPOINT_ANCHOR_CONFLICT')
    tree = {name: _transition_hash(data) for name, data in {**ia_files, 'manifest.json': manifest_bytes}.items()}
    _transition_demand(_transition_hash(release.canonical(tree).encode()) == journal.get('nextTreeSha256'),
                       'SIGNED_IA_CHECKPOINT_ANCHOR_CHANGED')
    metadata_bytes = _transition_bytes(ia_state / 'installation.json')
    metadata, identity, runtime = _transition_json(metadata_bytes), journal.get('identity'), journal.get('runtimeProof')
    _transition_demand(isinstance(identity, dict) and set(identity) == {'control', 'organization', 'checkpoint'}
                       and all(_transition_hex(value) for value in identity.values())
                       and _transition_hash(metadata_bytes) == journal.get('nextMetadataSha256')
                       and metadata.get('organization') == plan['orgId'] and metadata.get('sourceRevision') == journal['sourceSha']
                       and metadata.get('rollbackPath') == str(anchor)
                       and metadata.get('publishedCertificateSha256') == journal['certificateSha256']
                       and metadata.get('signedComponentManifestSha256') == journal['manifestSha256']
                       and metadata.get('binding') == '127.0.0.1' and metadata.get('externalAiEnabled') is False
                       and metadata.get('existingClientPreserved') is True and metadata.get('version') == '1.1.0'
                       and isinstance(runtime, dict) and runtime.get('localProcessesVerified') is True
                       and runtime.get('modelAvailable') is True and runtime.get('sourceSha') == journal['sourceSha']
                       and runtime.get('manifestSha256') == journal['manifestSha256'], 'SIGNED_IA_CHECKPOINT_ANCHOR_CONFLICT')
    _transition_demand(_transition_hash(_transition_bytes(ia_state / 'control.key', 4096)) == identity['control']
                       and _transition_hash(_transition_bytes(ia_state / 'organization.txt', 256)) == identity['organization']
                       and _transition_bytes(ia_state / 'organization.txt', 256).decode().strip() == plan['orgId'],
                       'PRESERVED_IA_IDENTITY_CHANGED')
    needed, ref, seen = plan['expectedPreviousSha256'], plan['previousTransition'], set()
    while ref is not None:
        _transition_demand(ref['directory'] not in seen and len(seen) < 64, 'CHECKPOINT_TRANSITION_CHAIN_CYCLE_OR_LIMIT')
        seen.add(ref['directory'])
        prior, commit = _transition_record(ref['directory'], ref['commitSha256'], state, plan['orgId'])
        _transition_demand(commit['nextSha256'] == needed, 'CHECKPOINT_TRANSITION_CHAIN_CONFLICT')
        _transition_demand(prior['publicReleaseControl']['trust'] == trust
                           and prior['packageDirectory'] == plan['packageDirectory']
                           and prior['iaAnchor'] == plan['iaAnchor']
                           and prior['expectedSourceSha'] == plan['expectedSourceSha']
                           and prior['expectedCertificateSha256'] == plan['expectedCertificateSha256'],
                           'CHECKPOINT_TRANSITION_CHAIN_CONFLICT')
        prior_candidate = release.verify_candidate(prior['envelope'], trust, prior['expectedSourceSha'])
        _transition_demand(prior_candidate.complete_signed_set
                           and prior_candidate.certificate_sha256 == prior['expectedCertificateSha256'],
                           'CHECKPOINT_TRANSITION_CHAIN_CONFLICT')
        needed, ref = prior['expectedPreviousSha256'], prior['previousTransition']
    _transition_demand(needed == identity['checkpoint'], 'CHECKPOINT_TRANSITION_IA_PREDECESSOR_CONFLICT')


def _transition_server(plan, raw, token, transport):
    first = sync.synchronize(raw, plan['nextOrigin'], plan['orgId'], token, True, transport)
    replay = sync.synchronize(raw, plan['nextOrigin'], plan['orgId'], token, True, transport)
    _transition_demand(first.get('processing', {}).get('firstIngestionVerified') is True
                       and replay.get('processing', {}).get('firstIngestionVerified') is True
                       and replay.get('status') == 'DUPLICATE'
                       and all(replay.get(key) == first.get(key) for key in
                               ('payloadSha256', 'idempotencyKey', 'documentId'))
                       and all(replay['processing'].get(key) == first['processing'].get(key) for key in
                               ('documentId', 'sourceSystem', 'sourceVersion', 'revision', 'versionId', 'canonicalSnapshotHash')),
                       'CURRENT_PROCESSING_REPLAY_REQUIRED')
    acceptance = replay.get('installationAcceptance')
    _transition_demand(isinstance(acceptance, dict) and acceptance.get('eligible') is True
                       and acceptance.get('method') == plan['method']
                       and all(acceptance.get(key) is True for key in
                               ('processingVerified', 'receiptPersisted', 'replayVerified', 'automationConfigured', 'automationVerified')),
                       'AUTHORITATIVE_AUTOMATION_INTEGRATION_REQUIRED')
    receipt = {key: value for key, value in replay.items() if key not in ('processing', 'installationAcceptance')}
    return {'schemaVersion': 'aurora.checkpoint.transition.proof.v1', 'receipt': receipt,
            'processingProof': replay['processing'], 'installationAcceptance': acceptance}


def _transition_same_proof(saved, fresh):
    _transition_demand(isinstance(saved, dict) and set(saved) == set(fresh)
                       and saved.get('schemaVersion') == fresh['schemaVersion']
                       and saved.get('receipt') == fresh['receipt'], 'CHECKPOINT_TRANSITION_PROOF_CHANGED')
    for name in ('processingProof', 'installationAcceptance'):
        _transition_demand(isinstance(saved.get(name), dict)
                           and {key: value for key, value in saved[name].items() if key != 'verifiedAt'}
                           == {key: value for key, value in fresh[name].items() if key != 'verifiedAt'},
                           'CHECKPOINT_TRANSITION_CURRENT_PROOF_CONFLICT')


def _transition_fresh_acceptance(proof):
    try:
        observed = datetime.fromisoformat(proof['installationAcceptance']['verifiedAt'].replace('Z', '+00:00')).timestamp()
    except (KeyError, TypeError, ValueError, AttributeError):
        raise sync.SyncError('FRESH_INSTALLATION_AUTHORITY_REQUIRED') from None
    _transition_demand(-30 <= time.time() - observed <= 30, 'FRESH_INSTALLATION_AUTHORITY_REQUIRED')


def _transition_current_server(plan, raw, token, transport, proof):
    url = plan['nextOrigin'] + '/api/integration/ping?documentId=' + proof['receipt']['documentId']
    status, body = transport(url, token)
    _transition_demand(status == 200 and isinstance(body, dict) and body.get('ok') is True
                       and body.get('orgId') == plan['orgId'] and isinstance(body.get('keyId'), str)
                       and re.fullmatch(r'ik_[a-f0-9]{16}', body['keyId']), 'CURRENT_INSTALLATION_AUTHORITY_REQUIRED')
    installation = body.get('installation')
    processing = sync.processing_proof(raw, plan['orgId'], installation)
    acceptance = sync.installation_acceptance(raw, plan['orgId'],
                                             installation.get('acceptance') if isinstance(installation, dict) else None, processing)
    _transition_demand(isinstance(acceptance, dict) and acceptance.get('eligible') is True
                       and acceptance.get('method') == 'API_TOKEN'
                       and acceptance.get('receiptId') == sync.digest('integration-document:' + body['keyId']
                                                                    + ':' + proof['receipt']['idempotencyKey']),
                       'AUTHORITATIVE_AUTOMATION_INTEGRATION_REQUIRED')
    current = {'schemaVersion': proof['schemaVersion'], 'receipt': proof['receipt'],
               'processingProof': processing, 'installationAcceptance': acceptance}
    _transition_same_proof(proof, current)
    _transition_fresh_acceptance(current)
    return current


def _transition_exclusive(path, data):
    path = safe_path(path)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_BINARY', 0), 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _transition_process_running(pid):
    if type(pid) is not int or pid <= 0:
        return True
    if os.name == 'nt':
        # Signal zero is not a portable Windows liveness probe. Query a handle;
        # this path never sends a signal or terminates another process.
        import ctypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = (ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong)
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_ulong)
        kernel.WaitForSingleObject.restype = ctypes.c_ulong
        kernel.CloseHandle.argtypes = (ctypes.c_void_p,)
        handle = kernel.OpenProcess(0x00100000 | 0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() != 87
        try:
            return kernel.WaitForSingleObject(handle, 0) != 0
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except (OSError, PermissionError):
        return True


def _transition_native_guard(lock):
    """Crash-released exclusion for recovery; no persistent second lock to clear."""
    if os.name == 'nt':
        import ctypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateMutexW.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p)
        kernel.CreateMutexW.restype = ctypes.c_void_p
        kernel.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_ulong)
        kernel.WaitForSingleObject.restype = ctypes.c_ulong
        kernel.ReleaseMutex.argtypes = (ctypes.c_void_p,)
        kernel.CloseHandle.argtypes = (ctypes.c_void_p,)
        name = 'Local\\AuroraCheckpointTransition-' + sync.digest(os.path.normcase(str(lock.absolute())))
        handle = kernel.CreateMutexW(None, False, name)
        _transition_demand(bool(handle), 'CHECKPOINT_TRANSITION_NATIVE_LOCK_REQUIRED')
        outcome = kernel.WaitForSingleObject(handle, 0)
        if outcome not in (0, 128):
            kernel.CloseHandle(handle)
            raise sync.SyncError('INSTALLATION_BUSY_OR_INTERRUPTED')
        def release_guard():
            kernel.ReleaseMutex(handle)
            kernel.CloseHandle(handle)
        return release_guard
    import fcntl
    descriptor = os.open(safe_path(lock), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(descriptor)
        raise sync.SyncError('INSTALLATION_BUSY_OR_INTERRUPTED') from None
    return lambda: os.close(descriptor)


def _transition_checkpoint_execute(plan, raw, token, transport, recover):
    """Transition this checkpoint only, with current native release and server authority.

    Immutable local artifacts prove lineage, never authorization. Recovery repeats
    the real canonical processing/replay gate and never authenticates old receipts.
    """
    checkpoint_transition_plan(plan, raw)
    state, encoded_plan = safe_path(plan['stateDirectory']), _transition_encoded(plan)
    plan_sha = _transition_hash(encoded_plan)
    directory = state / 'checkpoint-transitions' / plan_sha
    active, lock = state / STATE_NAME, state / 'integration-setup.lock'
    release, candidate, pin = _transition_authority(plan, token)
    _transition_local(plan, release, candidate)
    backup = directory / 'checkpoint.previous'
    previous = _transition_bytes(backup) if recover and (backup.exists() or backup.is_symlink()) else _transition_bytes(active)
    _transition_demand(_transition_hash(previous) == plan['expectedPreviousSha256'], 'CHECKPOINT_TRANSITION_PREDECESSOR_CHANGED')
    old = _transition_checkpoint(previous, plan, True)
    fresh_proof = _transition_server(plan, raw, token, transport)
    release, candidate, pin = _transition_authority(plan, token)
    _transition_local(plan, release, candidate)
    release.require_active(pin, expected_org=plan['orgId'])
    owner = {'schemaVersion': 'aurora.checkpoint.transition.lock.v1', 'planSha256': plan_sha,
             'pid': os.getpid(), 'owner': secrets.token_hex(32)}
    lock_bytes, new_lock = _transition_encoded(owner), False
    if lock.exists() or lock.is_symlink():
        _transition_demand(recover, 'INSTALLATION_BUSY_OR_INTERRUPTED')
        existing_bytes = _transition_bytes(lock, 4096)
        existing = _transition_json(existing_bytes)
        _transition_demand(isinstance(existing, dict)
                           and set(existing) == {'schemaVersion', 'planSha256', 'pid', 'owner'}
                           and existing.get('schemaVersion') == owner['schemaVersion']
                           and existing.get('planSha256') == plan_sha and _transition_hex(existing.get('owner'))
                           and (existing['pid'] == os.getpid() and existing['owner'] not in _TRANSITION_OWNERS
                                or not _transition_process_running(existing['pid'])), 'INSTALLATION_BUSY_OR_INTERRUPTED')
        _transition_demand(directory.is_dir(), 'CHECKPOINT_TRANSITION_RECOVERY_MATERIAL_REQUIRED')
        _transition_demand(_transition_bytes(lock, 4096) == existing_bytes, 'CHECKPOINT_TRANSITION_LOCK_CHANGED')
        lock_bytes = existing_bytes
    else:
        _transition_exclusive(lock, lock_bytes)
        new_lock = True
    try:
        release_guard = _transition_native_guard(lock)
    except Exception:
        if new_lock and _transition_bytes(lock, 4096) == lock_bytes:
            lock.unlink()
        raise
    _TRANSITION_OWNERS.add(owner['owner'])
    moved_path = directory / 'checkpoint.moved.previous'
    publication_started = recover and (moved_path.exists() or moved_path.is_symlink())
    completed = False
    try:
        _transition_demand(_transition_bytes(lock, 4096) == lock_bytes, 'CHECKPOINT_TRANSITION_LOCK_CHANGED')
        if directory.exists():
            _transition_demand(recover, 'EXPLICIT_CHECKPOINT_RECOVERY_REQUIRED')
            plan_path = directory / 'plan.json'
            if plan_path.exists() or plan_path.is_symlink():
                _transition_demand(_transition_bytes(plan_path) == encoded_plan, 'CHECKPOINT_TRANSITION_JOURNAL_CHANGED')
            else:
                _transition_exclusive(plan_path, encoded_plan)
        else:
            parent = safe_path(directory.parent)
            parent.mkdir(mode=0o700, exist_ok=True)
            directory.mkdir(mode=0o700)
            _transition_exclusive(directory / 'plan.json', encoded_plan)
        for name, data in (('checkpoint.previous', previous),):
            destination = directory / name
            if destination.exists():
                _transition_demand(_transition_bytes(destination) == data, 'CHECKPOINT_TRANSITION_PREDECESSOR_CHANGED')
            else:
                _transition_exclusive(destination, data)
        proof_path, next_path = directory / 'proof.json', directory / 'checkpoint.next'
        proof_bytes = _transition_bytes(proof_path) if proof_path.exists() else _transition_encoded(fresh_proof)
        proof = _transition_json(proof_bytes)
        _transition_same_proof(proof, fresh_proof)
        acceptance = {key: value for key, value in proof['installationAcceptance'].items()
                      if key not in ('orgId', 'canonicalOrigin')}
        next_value = {'schemaVersion': SCHEMA, 'componentVersion': VERSION,
                      'targetBinding': plan['nextTargetBinding'], 'sampleKey': plan['nextSampleKey'],
                      'attempt': old['attempt'] + 1, 'updatedAt': datetime.now(timezone.utc).isoformat(),
                      'status': 'SAMPLE_RECEIPT_VERIFIED', 'nextAction': 'VERIFY_CONTINUITY_WITH_SUBSEQUENT_EVENTS',
                      'connectionVerified': True, 'receiptVerifiedThisRun': True, 'processingVerifiedThisRun': True,
                      'processingProof': proof['processingProof'], 'previousReceiptCached': False,
                      'receipt': proof['receipt'], 'installationAcceptance': acceptance,
                      'fullSynchronizationVerified': False, 'productionReleased': False}
        next_bytes = _transition_bytes(next_path) if next_path.exists() else _transition_encoded(next_value)
        saved_next = _transition_checkpoint(next_bytes, plan)
        _transition_demand({key: value for key, value in saved_next.items() if key != 'updatedAt'}
                           == {key: value for key, value in next_value.items() if key != 'updatedAt'},
                           'CHECKPOINT_TRANSITION_NEXT_CONFLICT')
        for target, data in ((next_path, next_bytes), (proof_path, proof_bytes)):
            if not target.exists():
                _transition_exclusive(target, data)
        commit = {'schemaVersion': 'aurora.checkpoint.transition.commit.v1', 'planSha256': plan_sha,
                  'previousSha256': plan['expectedPreviousSha256'], 'nextSha256': _transition_hash(next_bytes),
                  'proofSha256': _transition_hash(proof_bytes)}
        commit_bytes = _transition_encoded(commit)
        # A current TLS observation is renewed after the document requests and
        # bounded local reads. Recheck every local CAS input after that await.
        current_authority = _transition_current_server(plan, raw, token, transport, fresh_proof)
        release, candidate, pin = _transition_authority(plan, token)
        _transition_local(plan, release, candidate)
        for name, data in (('plan.json', encoded_plan), ('checkpoint.previous', previous),
                           ('checkpoint.next', next_bytes), ('proof.json', proof_bytes)):
            _transition_demand(_transition_bytes(directory / name) == data, 'CHECKPOINT_TRANSITION_JOURNAL_CHANGED')
        _transition_demand(_transition_bytes(lock, 4096) == lock_bytes, 'CHECKPOINT_TRANSITION_LOCK_CHANGED')
        release.require_active(pin, expected_org=plan['orgId'])
        _transition_fresh_acceptance(current_authority)
        moved = directory / 'checkpoint.moved.previous'
        active_bytes = _transition_bytes(active) if active.exists() or active.is_symlink() else None
        if active_bytes == next_bytes and recover:
            publication_started = True
            _transition_demand(_transition_bytes(moved) == previous, 'CHECKPOINT_TRANSITION_MOVED_PREDECESSOR_CHANGED')
        else:
            if not (active_bytes == previous or (recover and active_bytes is None
                    and _transition_bytes(moved) == previous)):
                publication_started = True
                raise sync.SyncError('CHECKPOINT_TRANSITION_CONCURRENT_WRITER')
            if active_bytes is not None:
                _transition_demand(not moved.exists() and not moved.is_symlink(), 'CHECKPOINT_TRANSITION_RECOVERY_REQUIRED')
                publication_started = True
                active.rename(moved)
                _transition_demand(_transition_bytes(moved) == previous, 'CHECKPOINT_TRANSITION_CONCURRENT_WRITER')
            else:
                publication_started = True
            release.require_active(pin, expected_org=plan['orgId'])
            try:
                _transition_exclusive(active, next_bytes)
            except FileExistsError:
                raise sync.SyncError('CHECKPOINT_TRANSITION_CONCURRENT_WRITER') from None
        _transition_demand(_transition_bytes(active) == next_bytes
                           and _transition_bytes(moved) == previous
                           and _transition_bytes(lock, 4096) == lock_bytes, 'CHECKPOINT_TRANSITION_CONCURRENT_WRITER')
        release.require_active(pin, expected_org=plan['orgId'])
        current_authority = _transition_current_server(plan, raw, token, transport, fresh_proof)
        release, candidate, pin = _transition_authority(plan, token)
        _transition_local(plan, release, candidate)
        for name, data in (('plan.json', encoded_plan), ('checkpoint.previous', previous),
                           ('checkpoint.next', next_bytes), ('proof.json', proof_bytes)):
            _transition_demand(_transition_bytes(directory / name) == data, 'CHECKPOINT_TRANSITION_JOURNAL_CHANGED')
        _transition_demand(_transition_bytes(active) == next_bytes
                           and _transition_bytes(moved) == previous
                           and _transition_bytes(lock, 4096) == lock_bytes, 'CHECKPOINT_TRANSITION_CONCURRENT_WRITER')
        release.require_active(pin, expected_org=plan['orgId'])
        _transition_fresh_acceptance(current_authority)
        commit_path = directory / 'commit.json'
        if commit_path.exists():
            _transition_demand(recover and _transition_bytes(commit_path) == commit_bytes, 'CHECKPOINT_TRANSITION_COMMIT_CONFLICT')
        else:
            _transition_exclusive(commit_path, commit_bytes)
        _transition_demand(_transition_bytes(commit_path) == commit_bytes
                           and _transition_bytes(active) == next_bytes
                           and _transition_bytes(moved) == previous
                           and _transition_bytes(lock, 4096) == lock_bytes,
                           'CHECKPOINT_TRANSITION_CONCURRENT_WRITER')
        release.require_active(pin, expected_org=plan['orgId'])
        completed = True
        return {'status': 'CHECKPOINT_TRANSITION_COMMITTED', 'planSha256': plan_sha,
                'checkpointTransition': {'directory': str(directory), 'commitSha256': _transition_hash(commit_bytes)},
                'previousSha256': commit['previousSha256'], 'nextSha256': commit['nextSha256'],
                'installationAcceptance': current_authority['installationAcceptance'],
                'targetBinding': plan['nextTargetBinding'], 'sampleKey': plan['nextSampleKey'],
                'installationComplete': False, 'allClientsSynchronized': False, 'checkpointChanged': True}
    finally:
        _TRANSITION_OWNERS.discard(owner['owner'])
        # Unknown publication retains the owned lock and every predecessor byte.
        # A foreign writer's lock is never removed during cleanup.
        try:
            if completed or not publication_started:
                if lock.exists() and _transition_bytes(lock, 4096) == lock_bytes:
                    lock.unlink()
        finally:
            release_guard()


def transition_checkpoint(plan, raw, token, transport=sync.request_json, recover=False):
    checkpoint_transition_plan(plan, raw)
    # Neither the caller nor a transport callback can mutate reviewed bindings
    # while the synchronous native readers are waiting for network responses.
    plan, raw = _transition_json(_transition_encoded(plan)), sync.validate_payload(raw)
    import published_release as release
    try:
        return _transition_checkpoint_execute(plan, raw, token, transport, recover)
    except release.ReleaseError as error:
        raise sync.SyncError(str(error)) from None


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
    parser.add_argument('--input', help='Explicit approved structured sample JSON')
    parser.add_argument('--origin')
    parser.add_argument('--org')
    parser.add_argument('--state-dir', help='Existing private installation state directory')
    parser.add_argument('--release-plan', action='store_true', help='Public release preflight; no checkpoint or document transport')
    parser.add_argument('--release-config', help='Explicit public trust/source/component-manifest JSON')
    parser.add_argument('--read-active', action='store_true', help='Explicit canonical authenticated GET with --release-plan')
    parser.add_argument('--checkpoint-transition-plan', help='Explicit reviewed same-checkpoint transition JSON; preview only by default')
    transition_mode = parser.add_mutually_exclusive_group()
    transition_mode.add_argument('--checkpoint-transition-execute', action='store_true')
    transition_mode.add_argument('--checkpoint-transition-recover', action='store_true')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--connect', action='store_true', help='Authenticated ping only; no document POST')
    mode.add_argument('--send', action='store_true', help='Send or replay the same explicitly authorized sample once')
    args = parser.parse_args(argv)
    try:
        if args.checkpoint_transition_execute or args.checkpoint_transition_recover:
            if not args.checkpoint_transition_plan:
                raise sync.SyncError('EXPLICIT_CHECKPOINT_TRANSITION_PLAN_REQUIRED')
        if args.checkpoint_transition_plan:
            if args.connect or args.send or args.release_plan or args.release_config or args.read_active or args.origin or args.state_dir:
                raise sync.SyncError('SEPARATE_CHECKPOINT_TRANSITION_REQUIRED')
            plan = read_json(args.checkpoint_transition_plan)
            if args.org is not None and args.org != plan.get('orgId'):
                raise sync.SyncError('AUTHENTICATED_ORGANIZATION_MISMATCH')
            raw = read_json(args.input) if args.input else None
            if args.checkpoint_transition_execute or args.checkpoint_transition_recover:
                if raw is None:
                    raise sync.SyncError('EXPLICIT_SAMPLE_TARGET_STATE_REQUIRED')
                result = transition_checkpoint(plan, raw, os.environ.get('AURORA_INTEGRATION_TOKEN'),
                                               recover=args.checkpoint_transition_recover)
            else:
                result = checkpoint_transition_plan(plan, raw)
            print(json.dumps(result, sort_keys=True))
            return 0
        if not args.org:
            raise sync.SyncError('EXPLICIT_ORGANIZATION_REQUIRED')
        if args.read_active and not args.release_plan:
            raise sync.SyncError('EXPLICIT_RELEASE_PLAN_REQUIRED')
        if args.release_plan or args.release_config:
            import published_release as release
            if args.release_plan and (args.connect or args.send):raise sync.SyncError('SEPARATE_RELEASE_PLAN_REQUIRED')
            control = read_json(args.release_config) if args.release_config else None
            published = release.release_status(control, args.org, os.environ.get('AURORA_INTEGRATION_TOKEN')
                                              if args.read_active or args.connect or args.send else None,
                                              args.read_active or args.connect or args.send)
            if args.release_plan or published['status'] != 'PUBLISHED_COMPONENT_CURRENT_BYTES_VERIFIED':
                print(json.dumps(published, sort_keys=True));return 0 if published['currentPointerVerified'] else 2
        if not all((args.input, args.origin, args.state_dir)):raise sync.SyncError('EXPLICIT_SAMPLE_TARGET_STATE_REQUIRED')
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
