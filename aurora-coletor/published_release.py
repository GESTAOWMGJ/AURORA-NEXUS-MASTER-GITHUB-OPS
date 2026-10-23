"""Public release identity consumer. Isolated signatures are candidates only.

The optional cryptography backend is needed only for release verification. Its
absence blocks this operation without installing dependencies or weakening trust.
Bearer values live in the caller's process and are never returned or persisted.
The canonical release control plane never changes the document ingest origin.
"""
import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import ssl
import stat
import time
from urllib import request
import weakref

ORIGIN = 'https://auroranexus.com.br'
READ_URL = ORIGIN + '/api/integration/active-release'
SOURCE = 'platformRuntime/activeRelease'
COMPONENTS = ('server', 'web', 'satellite', 'iaMaster', 'windowsIntegration')
CHECKS = ('ciPassed', 'humanReviewApproved', 'protectedDeploySucceeded', 'smokePassed')
TISS_MASTER_FILES = frozenset(('tiss-tool.cjs', 'tiss-browser.cjs', 'tiss-local.js',
                               'client-agent/aurora_tiss.py', 'tiss-fixtures/sadt-valid.xml'))
_CANDIDATES = weakref.WeakSet()
_ACTIVE = weakref.WeakKeyDictionary()


class ReleaseError(Exception):
    """Only fixed safe codes cross this interface."""


def demand(condition, code):
    if not condition:
        raise ReleaseError(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def _hex(value, length):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{' + str(length) + '}', value) is not None


def _exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def _version(value):
    return isinstance(value, str) and len(value) <= 80 and re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?', value) is not None


def _utc(value):
    if not isinstance(value, str) or len(value) != 24:
        return None
    try:
        parsed = datetime.strptime(value, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)
        return parsed.timestamp() if parsed.isoformat(timespec='milliseconds').replace('+00:00', 'Z') == value else None
    except ValueError:
        return None


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def signing_bytes(certificate):
    return ('AURORA_ACTIVE_RELEASE_V' + str(certificate['schemaVersion']) + '\0' + canonical(certificate)).encode('utf-8')


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        demand(key not in result, 'DUPLICATE_RELEASE_FIELD')
        result[key] = value
    return result


def parse(raw):
    try:
        return json.loads(raw, object_pairs_hook=_pairs, parse_constant=lambda _: (_ for _ in ()).throw(ReleaseError('INVALID_RELEASE_JSON')))
    except ReleaseError:
        raise
    except Exception:
        raise ReleaseError('INVALID_RELEASE_JSON') from None


@dataclass(frozen=True, eq=False)
class Candidate:
    certificate_bytes: bytes
    certificate_sha256: str
    complete_signed_set: bool
    status: str = 'CANDIDATE_UNVERIFIED'

    @property
    def certificate(self):
        return parse(self.certificate_bytes)


class ActivePin:
    """Identity token registered only after the native authenticated TLS read."""
    pass


def verify_candidate(envelope, trust, expected_source, now=None):
    demand(_exact(trust, ('publicKeySpkiPem', 'publicKeySha256'))
           and isinstance(trust['publicKeySpkiPem'], str) and len(trust['publicKeySpkiPem']) <= 8192
           and _hex(trust['publicKeySha256'], 64), 'TRUSTED_PUBLIC_KEY_REQUIRED')
    demand(_hex(expected_source, 40), 'EXPECTED_SOURCE_REQUIRED')
    demand(_exact(envelope, ('certificate', 'signature'))
           and isinstance(envelope['signature'], str) and re.fullmatch('[A-Za-z0-9_-]{86}', envelope['signature']), 'INVALID_RELEASE_ENVELOPE')
    certificate = envelope['certificate']
    demand(_exact(certificate, ('schemaVersion', 'sourceSha', 'productVersion', 'canonicalOrigin', 'releaseRunId', 'ciRunId',
                               'publishedAtUtc', 'status', 'checks', 'components'))
           and type(certificate['schemaVersion']) is int and certificate['schemaVersion'] in (1, 2)
           and _hex(certificate['sourceSha'], 40) and _version(certificate['productVersion'])
           and certificate['canonicalOrigin'] == ORIGIN and certificate['status'] == 'ACTIVE'
           and _utc(certificate['publishedAtUtc']) is not None
           and all(isinstance(certificate[key], str) and re.fullmatch('[1-9][0-9]{0,19}', certificate[key]) for key in ('releaseRunId', 'ciRunId'))
           and _exact(certificate['checks'], CHECKS) and all(certificate['checks'][key] is True for key in CHECKS), 'INVALID_RELEASE_CERTIFICATE')
    components = certificate['components']
    names = COMPONENTS if certificate['schemaVersion'] == 2 else ('server', 'web') + (('satellite',) if isinstance(components, dict) and 'satellite' in components else ())
    demand(_exact(components, names), 'INVALID_COMPONENT_COVERAGE')
    for pin in components.values():
        demand(_exact(pin, ('version', 'sourceSha', 'manifestSha256')) and _version(pin['version'])
               and pin['sourceSha'] == certificate['sourceSha'] and _hex(pin['manifestSha256'], 64), 'INVALID_COMPONENT_PIN')
    signed = signing_bytes(certificate)
    demand(len(signed) <= 16384 and certificate['sourceSha'] == expected_source, 'EXPECTED_SOURCE_CONFLICT')
    now = time.time() if now is None else now
    demand(type(now) in (int, float) and math.isfinite(now) and now >= 0 and _utc(certificate['publishedAtUtc']) <= now, 'INVALID_PUBLICATION_TIME')
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        raise ReleaseError('RELEASE_CRYPTO_BACKEND_UNAVAILABLE') from None
    try:
        key = serialization.load_pem_public_key(trust['publicKeySpkiPem'].encode('ascii'))
        demand(isinstance(key, Ed25519PublicKey) and digest(key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)) == trust['publicKeySha256'], 'UNTRUSTED_RELEASE_KEY')
        signature = base64.urlsafe_b64decode(envelope['signature'] + '==')
        demand(base64.urlsafe_b64encode(signature).decode('ascii').rstrip('=') == envelope['signature'], 'RELEASE_SIGNATURE_REJECTED')
        key.verify(signature, signed)
    except ReleaseError:
        raise
    except Exception:
        raise ReleaseError('RELEASE_SIGNATURE_REJECTED') from None
    candidate = Candidate(canonical(certificate).encode('utf-8'), digest(signed), certificate['schemaVersion'] == 2)
    _CANDIDATES.add(candidate)
    return candidate


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def read_active_pin(bearer, trust, expected_source, expected_org):
    demand(isinstance(expected_org, str) and re.fullmatch('[a-z0-9][a-z0-9-]{1,62}', expected_org), 'EXPECTED_ORGANIZATION_REQUIRED')
    demand(isinstance(bearer, str) and 0 < len(bearer) <= 8192 and '\r' not in bearer and '\n' not in bearer, 'PROCESS_BEARER_REQUIRED')
    nonce, requested = secrets.token_hex(32), time.time()
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    opener = request.build_opener(request.ProxyHandler({}), _NoRedirect(), request.HTTPSHandler(context=context))
    req = request.Request(READ_URL, method='GET', headers={'Authorization': 'Bearer ' + bearer,
                          'X-Aurora-Release-Nonce': nonce, 'Accept': 'application/json'})
    try:
        with opener.open(req, timeout=10) as response:
            demand(response.status == 200 and response.geturl() == READ_URL
                   and re.match(r'application/json(?:;|$)', response.headers.get('Content-Type', ''), re.I)
                   and re.search(r'(?:^|,)\s*no-store(?:\s*,|$)', response.headers.get('Cache-Control', ''), re.I), 'CANONICAL_RELEASE_READ_REJECTED')
            raw = response.read(65537)
            demand(len(raw) <= 65536, 'RELEASE_RESPONSE_TOO_LARGE')
    except ReleaseError:
        raise
    except Exception:
        raise ReleaseError('CANONICAL_RELEASE_READ_FAILED') from None
    body, now = parse(raw), time.time()
    demand(_exact(body, ('schemaVersion', 'source', 'canonicalOrigin', 'orgId', 'requestNonce', 'observedAtUtc', 'certificateSha256',
                        'envelope', 'runtime', 'componentCoverage', 'nativeMacInstallation', 'deviceInstallationVerified'))
           and body['schemaVersion'] == 'aurora.active-release-read.v1' and body['source'] == SOURCE
           and body['canonicalOrigin'] == ORIGIN and body['orgId'] == expected_org and body['requestNonce'] == nonce
           and body['nativeMacInstallation'] == 'UNVERIFIED' and body['deviceInstallationVerified'] is False, 'CANONICAL_RESPONSE_BINDING_REJECTED')
    observed = _utc(body['observedAtUtc'])
    demand(observed is not None and requested - 30 <= observed <= now + 30 and now - observed <= 60, 'STALE_CANONICAL_RESPONSE')
    candidate = verify_candidate(body['envelope'], trust, expected_source, now)
    certificate = candidate.certificate
    demand(body['certificateSha256'] == candidate.certificate_sha256 and _exact(body['runtime'], ('sourceSha', 'serverManifestSha256', 'webManifestSha256'))
           and body['runtime']['sourceSha'] == certificate['sourceSha']
           and body['runtime']['serverManifestSha256'] == certificate['components']['server']['manifestSha256']
           and body['runtime']['webManifestSha256'] == certificate['components']['web']['manifestSha256'], 'CANONICAL_RUNTIME_CONFLICT')
    covered = [name for name in COMPONENTS if name in certificate['components']]
    coverage = body['componentCoverage']
    demand(_exact(coverage, ('status', 'complete', 'requiredComponents', 'coveredComponents', 'missingComponents'))
           and coverage['requiredComponents'] == list(COMPONENTS) and coverage['coveredComponents'] == covered
           and coverage['missingComponents'] == [name for name in COMPONENTS if name not in covered]
           and coverage['complete'] is candidate.complete_signed_set
           and coverage['status'] == ('COMPLETE_SIGNED_COMPONENT_SET' if candidate.complete_signed_set else 'PARTIAL'), 'CANONICAL_COVERAGE_CONFLICT')
    pin = ActivePin()
    _ACTIVE[pin] = (candidate, now, expected_org)
    return pin


def require_active(pin, now=None, expected_org=None):
    demand(isinstance(pin, ActivePin), 'FRESH_CANONICAL_V2_PIN_REQUIRED')
    current = _ACTIVE.get(pin)
    now = time.time() if now is None else now
    demand(current is not None and current[0].complete_signed_set and 0 <= now - current[1] <= 30
           and (expected_org is None or expected_org == current[2]), 'FRESH_CANONICAL_V2_PIN_REQUIRED')
    return current[0]


TISS_XSD_FILES = frozenset((
    'client-agent/tiss-schemas/4.03.00/tissAssinaturaDigital_v1.01.xsd',
    'client-agent/tiss-schemas/4.03.00/tissComplexTypesV4_03_00.xsd',
    'client-agent/tiss-schemas/4.03.00/tissGuiasV4_03_00.xsd',
    'client-agent/tiss-schemas/4.03.00/tissSimpleTypesV4_03_00.xsd',
    'client-agent/tiss-schemas/4.03.00/tissV4_03_00.xsd',
    'client-agent/tiss-schemas/4.03.00/xmldsig-core-schema.xsd',
))


def ia_master_manifest_shape(manifest):
    """Recognize package composition only; this does not verify or authorize it."""
    if not isinstance(manifest, dict) or not isinstance(manifest.get('files'), dict):
        return False
    names = manifest['files']
    if not all(isinstance(name, str) for name in names):
        return False
    folded = {name.casefold() for name in names}
    if len(folded) != len(names):
        return False
    if len(names) == 34:
        return 'tissTool' not in manifest and folded.isdisjoint(TISS_MASTER_FILES)
    tool = manifest.get('tissTool')
    return (((len(names) == 39 and isinstance(tool, dict) and tool.get('version') == '1.0.0')
             or (len(names) == 45 and isinstance(tool, dict) and tool.get('version') == '1.0.1'
                 and TISS_XSD_FILES.issubset(names))) and TISS_MASTER_FILES.issubset(names)
            and _exact(tool, ('id', 'version', 'configured', 'processing', 'realPortalEnabled', 'submissionEnabled'))
            and tool['id'] == 'AURORA-TISS-SADT-001'
            and tool['processing'] == 'LOCAL_EPHEMERAL'
            and tool['configured'] is False and tool['realPortalEnabled'] is False
            and tool['submissionEnabled'] is False)


def assess_manifest(candidate, component, manifest_bytes, file_bytes):
    demand(candidate in _CANDIDATES and candidate.complete_signed_set and component in ('iaMaster', 'windowsIntegration'), 'V2_COMPONENT_COVERAGE_REQUIRED')
    expected = candidate.certificate['components'][component]
    demand(isinstance(manifest_bytes, bytes) and len(manifest_bytes) <= 65536 and digest(manifest_bytes) == expected['manifestSha256'], 'SIGNED_MANIFEST_BYTES_CONFLICT')
    manifest = parse(manifest_bytes)
    demand(isinstance(manifest, dict) and isinstance(file_bytes, dict)
           and all(isinstance(value, bytes) for value in file_bytes.values()), 'INVALID_PACKAGE_MANIFEST')
    source = manifest.get('sourceRevision') if component == 'iaMaster' else manifest.get('sourceSha')
    demand(manifest.get('component') == ('AURORA_IA_MASTER' if component == 'iaMaster' else 'AURORA_WINDOWS_INTEGRATION')
           and source == expected['sourceSha'] and manifest.get('version') == expected['version']
           and isinstance(manifest.get('files'), dict)
           and (component != 'iaMaster' or (manifest.get('dirty') is False and manifest.get('externalAiEnabled') is False
                                          and manifest.get('nodeMinimumMajor') == 22)), 'PACKAGE_IDENTITY_CONFLICT')
    names = manifest['files']
    demand(all(isinstance(name, str) for name in names) and all(isinstance(name, str) for name in file_bytes), 'PACKAGE_CLOSURE_CONFLICT')
    demand(set(file_bytes) == set(names) and len({name.casefold() for name in names}) == len(names)
           and (ia_master_manifest_shape(manifest) if component == 'iaMaster' else len(names) == 7)
           and (component != 'windowsIntegration' or set(names) == set(WINDOWS_FILES))
           and sum(len(value) for value in file_bytes.values()) <= 32 * 1024 * 1024, 'PACKAGE_CLOSURE_CONFLICT')
    for name, expected_hash in names.items():
        demand(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_./-]{1,200}', name)
               and not any(not part or part in ('.', '..') or part.startswith('.') or re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)', part, re.I) for part in name.split('/'))
               and name != 'manifest.json' and _hex(expected_hash, 64)
               and isinstance(file_bytes[name], bytes) and digest(file_bytes[name]) == expected_hash, 'PACKAGE_FILE_BYTES_CONFLICT')
    return {'status': 'SIGNED_COMPONENT_BYTES_VERIFIED', 'sourceSha': source, 'manifestSha256': expected['manifestSha256'],
            'version': expected['version'], 'currentPointerVerified': False, 'installed': False, 'allClientsSynchronized': False}


WINDOWS_FILES = ('client_agent.py', 'provider_connectors.py', 'client_secret_store.py', 'install_client_agent.py',
                 'aurora_cloud_sync.py', 'aurora_deployment.py', 'published_release.py')


def validate_control(control):
    demand(_exact(control, ('trust', 'expectedSourceSha', 'manifestPath')) and _hex(control['expectedSourceSha'], 40)
           and _exact(control['trust'], ('publicKeySpkiPem', 'publicKeySha256'))
           and isinstance(control['trust']['publicKeySpkiPem'], str) and len(control['trust']['publicKeySpkiPem']) <= 8192
           and _hex(control['trust']['publicKeySha256'], 64)
           and isinstance(control['manifestPath'], str) and Path(control['manifestPath']).is_absolute()
           and Path(control['manifestPath']).name == 'windowsIntegration-manifest.json', 'PUBLIC_RELEASE_CONFIGURATION_REQUIRED')
    return control


def _public_bytes(value, maximum):
    # The existing deployment path policy rejects user-controlled links/junctions.
    from aurora_deployment import safe_path
    target = safe_path(value)
    path_before = target.stat()
    demand(target.is_file() and path_before.st_nlink == 1 and path_before.st_size <= maximum, 'PUBLIC_PACKAGE_FILE_REQUIRED')
    fd = os.open(target, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0))
    try:
        before = os.fstat(fd)
        data = os.read(fd, maximum + 1)
        after = os.fstat(fd)
        observed = target.stat()
        fields = ('st_dev', 'st_ino', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        # CPython Windows currently exposes path ctime as creation time and
        # descriptor ctime as change time. Compare each snapshot consistently;
        # inode/device/size/mtime still bind the path to the opened descriptor.
        demand(stat.S_ISREG(before.st_mode) and len(data) == before.st_size <= maximum
               and all(getattr(before, key) == getattr(after, key) for key in fields)
               and all(getattr(path_before, key) == getattr(observed, key) for key in fields)
               and all(getattr(before, key) == getattr(observed, key) for key in fields if key != 'st_ctime_ns'), 'PUBLIC_PACKAGE_CHANGED')
        return data
    finally:
        os.close(fd)


def release_status(control, org, bearer=None, read_active=False):
    """Shared preflight for existing adapter and agent; no documents or state writes."""
    result = {'status': 'PENDING_CANONICAL_READ_REQUIRED', 'canonicalOrigin': ORIGIN,
              'ingestTargetChanged': False, 'currentPointerVerified': False, 'localComponentBytesVerified': False,
              'activated': False, 'allClientsSynchronized': False}
    if control is None:
        result['status'] = 'PENDING_PUBLIC_RELEASE_CONFIGURATION'
        return result
    try:
        validate_control(control)
        if not read_active:
            return result
        if not bearer:
            result['status'] = 'PENDING_PROCESS_CREDENTIAL'
            return result
        pin = read_active_pin(bearer, control['trust'], control['expectedSourceSha'], org)
        candidate = _ACTIVE[pin][0]
        if not candidate.complete_signed_set:
            result['status'] = 'PENDING_V2_COMPONENT_COVERAGE'
            return result
        require_active(pin, expected_org=org)
        manifest = _public_bytes(control['manifestPath'], 65536)
        files = {name: _public_bytes(Path(__file__).parent / name, 32 * 1024 * 1024) for name in WINDOWS_FILES}
        proof = assess_manifest(candidate, 'windowsIntegration', manifest, files)
        require_active(pin, expected_org=org)  # Expiry after all bounded file reads.
        result.update(status='PUBLISHED_COMPONENT_CURRENT_BYTES_VERIFIED', currentPointerVerified=True,
                      localComponentBytesVerified=True, sourceSha=proof['sourceSha'], manifestSha256=proof['manifestSha256'])
    except ReleaseError as error:
        result.update(status='PENDING_PUBLISHED_RELEASE', code=str(error))
    except Exception:
        result.update(status='PENDING_PUBLISHED_RELEASE', code='PUBLIC_RELEASE_METADATA_UNAVAILABLE')
    return result
