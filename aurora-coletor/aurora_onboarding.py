#!/usr/bin/env python3
"""Local, authorized metadata discovery and declarative capability drafts.

This module is part of aurora-coletor, NOT another ingestion backend. It never
opens source document contents, uploads documents, executes generated code,
changes source files or activates capabilities. POSIX/macOS local discovery only.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import stat
import sys
import tempfile
import time
import unicodedata

VERSION = 'aurora.onboarding.v1'
ID = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$')
EXTENSIONS = frozenset('.pdf .doc .docx .odt .rtf .xls .xlsx .ods .csv .json .jsonl .xml .txt .md .png .jpg .jpeg .tif .tiff'.split())
BLOCKED = frozenset('system library applications node_modules vendor __pycache__ secrets credentials keychains backups prontuarios prontuario pacientes paciente clinical cloudstorage'.split() + ['mobile documents'])
HINTS = {
    'CONTRACT': ('contrato', 'aditivo', 'contract'),
    'FISCAL': ('nfse', 'nfs-e', 'nota fiscal', 'faturamento', 'invoice'),
    'FINANCIAL': ('extrato', 'repasse', 'recebimento', 'financeiro', 'pagamento'),
    'PRODUCTION': ('producao', 'produtividade', 'escala'),
    'GOVERNANCE': ('procedimento', 'protocolo', 'regimento', 'politica', 'pop-'),
    'AUDIT': ('glosa', 'auditoria', 'conciliacao'),
}
FIELDS = frozenset(('categoryHint', 'extension', 'sourceId', 'modifiedMonth'))


class GuardrailError(ValueError):
    """Sanitized fail-closed reason suitable for logs."""


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value.lower()) if not unicodedata.combining(c))


def forbidden(name):
    n = normalize(name)
    return (name.startswith('.') or n in BLOCKED or n.endswith(('.app', '.photoslibrary', '.keychain', '.keychain-db'))
            or any(term in n for term in ('credential', 'password', 'senha', 'secret', 'private_key', 'prontuario', 'paciente', 'patient')))


def canonical(path):
    p = Path(path).expanduser()
    if not p.is_absolute() or '..' in p.parts:
        raise GuardrailError('ABSOLUTE_EXPLICIT_PATH_REQUIRED')
    # Reject symlink components before resolving, including state-directory ancestors.
    for part in (p, *p.parents):
        if part.is_symlink():
            raise GuardrailError('SYMLINK_PATH_REJECTED')
    return p.resolve()


def approved_root(path):
    p = canonical(path)
    forbidden_roots = {Path('/'), Path('/Users'), Path('/home'), Path('/Volumes'), Path.home().resolve(), *(Path.home().resolve() / x for x in ('Desktop', 'Documents', 'Downloads'))}
    if p in forbidden_roots or any(forbidden(part) for part in p.parts[1:]):
        raise GuardrailError('BROAD_OR_PRIVATE_SCOPE_REJECTED')
    if not p.is_dir():
        raise GuardrailError('ROOT_UNAVAILABLE')
    return p


def validate(config):
    if config.get('schemaVersion') != VERSION:
        raise GuardrailError('CONFIG_SCHEMA_INVALID')
    if not ID.fullmatch(str(config.get('org', ''))):
        raise GuardrailError('TENANT_REQUIRED')
    auth = config.get('authorization', {})
    if auth.get('approved') is not True:
        raise GuardrailError('DISCOVERY_NOT_AUTHORIZED')
    if not all(ID.fullmatch(str(auth.get(k, ''))) for k in ('actorRef', 'documentRef')):
        raise GuardrailError('AUTHORIZATION_REFERENCE_REQUIRED')
    try:
        expiry = datetime.fromisoformat(auth['expiresAt'].replace('Z', '+00:00'))
    except (ValueError, TypeError, KeyError):
        raise GuardrailError('AUTHORIZATION_EXPIRY_REQUIRED') from None
    if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
        raise GuardrailError('AUTHORIZATION_EXPIRED')
    if os.name != 'posix' or not hasattr(os, 'O_NOFOLLOW'):
        raise GuardrailError('PLATFORM_REQUIRES_APPROVED_ADAPTER')
    if config.get('contentRead') is not False or config.get('networkUpload') is not False:
        raise GuardrailError('METADATA_ONLY_LOCAL_MODE_REQUIRED')
    raw_roots = config.get('roots', [])
    if not isinstance(raw_roots, list) or not 1 <= len(raw_roots) <= 20:
        raise GuardrailError('EXPLICIT_ROOTS_REQUIRED')
    roots = [approved_root(p) for p in raw_roots]
    state = canonical(config['stateDir'])
    for i, root in enumerate(roots):
        if root == state or root in state.parents or state in root.parents:
            raise GuardrailError('SOURCE_STATE_OVERLAP')
        for other in roots[:i]:
            if root == other or root in other.parents or other in root.parents:
                raise GuardrailError('OVERLAPPING_ROOTS')
    for field, low, high in [('maxEntries', 1, 50000), ('maxDepth', 0, 20), ('intervalSeconds', 60, 86400)]:
        value = config.get(field)
        if type(value) is not int or not low <= value <= high:
            raise GuardrailError('BOUNDED_LIMIT_REQUIRED_' + field)
    return roots, state


def category(name):
    n = normalize(name).replace('_', ' ')
    matches = [key for key, words in HINTS.items() if any(word in n for word in words)]
    return matches[0] if len(matches) == 1 else 'UNCLASSIFIED'


def inventory(config, roots):
    """Read directory entries/stat only, using no-follow directory descriptors."""
    rows, coverage = [], []
    remaining = config['maxEntries']
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    for root in roots:
        source_id = fingerprint([config['org'], str(root)])[:24]
        issues, excluded, examined = Counter(), Counter(), 0

        def walk(fd, relative, depth):
            nonlocal remaining, examined
            try:
                # scandir(fd) streams bounded enumeration, never opens document bytes.
                with os.scandir(fd) as entries:
                    for entry in entries:
                        if remaining <= 0:
                            issues['ENTRY_LIMIT'] += 1
                            return
                        remaining -= 1
                        examined += 1
                        if forbidden(entry.name):
                            excluded['PRIVATE_OR_SYSTEM'] += 1
                            continue
                        try:
                            info = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                            if stat.S_ISLNK(info.st_mode):
                                excluded['SYMLINK'] += 1
                                continue
                            rel = relative / entry.name
                            if stat.S_ISDIR(info.st_mode):
                                if depth >= config['maxDepth']:
                                    issues['DEPTH_LIMIT'] += 1
                                    continue
                                child = os.open(entry.name, flags, dir_fd=fd)
                                try:
                                    walk(child, rel, depth + 1)
                                finally:
                                    os.close(child)
                            elif stat.S_ISREG(info.st_mode):
                                extension = Path(entry.name).suffix.lower()
                                if info.st_nlink > 1:
                                    excluded['HARDLINK'] += 1
                                    continue
                                if extension not in EXTENSIONS:
                                    excluded['UNSUPPORTED_FORMAT'] += 1
                                    continue
                                doc_id = fingerprint([config['org'], source_id, str(rel)])
                                rows.append({'id': doc_id, 'org': config['org'], 'sourceId': source_id,
                                             'relativePath': str(rel), 'extension': extension,
                                             'sizeBytes': info.st_size, 'modifiedNs': info.st_mtime_ns,
                                             'modifiedMonth': datetime.fromtimestamp(info.st_mtime, timezone.utc).strftime('%Y-%m'),
                                             'categoryHint': category(entry.name), 'classification': 'UNVALIDATED_FILENAME_HINT',
                                             'metadataFingerprint': fingerprint([doc_id, info.st_size, info.st_mtime_ns]),
                                             'status': 'DISCOVERED_NOT_INGESTED', 'contentRead': False})
                        except (OSError, OverflowError, ValueError):
                            issues['ENTRY_UNAVAILABLE'] += 1
            except OSError:
                issues['DIRECTORY_UNAVAILABLE'] += 1

        try:
            fd = os.open(str(root), flags)
            try:
                walk(fd, Path('.'), 0)
            finally:
                os.close(fd)
        except OSError:
            issues['ROOT_UNAVAILABLE'] += 1
        coverage.append({'sourceId': source_id, 'enumerationComplete': not bool(issues),
                         'examined': examined, 'issues': dict(issues), 'excluded': dict(excluded)})
    return rows, coverage


def merge_catalog(org, rows, coverage, previous, captured):
    if previous and previous.get('org') != org:
        raise GuardrailError('CROSS_TENANT_STATE_REJECTED')
    old = {row['id']: row for row in previous.get('documents', [])}
    current, counters = {}, Counter()
    for row in rows:
        before = old.get(row['id'])
        state = 'NEW' if before is None else ('UNCHANGED' if before['metadataFingerprint'] == row['metadataFingerprint'] else 'CHANGED')
        counters[state] += 1
        current[row['id']] = {**row, 'change': state, 'version': (before.get('version', 1) if before else 0) + int(state != 'UNCHANGED'),
                              'firstSeenAt': before.get('firstSeenAt', captured) if before else captured,
                              'lastSeenAt': captured}
    complete = {item['sourceId'] for item in coverage if item['enumerationComplete']}
    for key, before in old.items():
        if key not in current:
            # Not seen is not a deletion, and incomplete coverage is never absence.
            current[key] = {**before, 'change': 'NOT_SEEN' if before['sourceId'] in complete else 'COVERAGE_UNKNOWN'}
            counters[current[key]['change']] += 1
    return {'schemaVersion': VERSION, 'org': org, 'capturedAt': captured,
            'documents': sorted(current.values(), key=lambda r: r['id']), 'coverage': coverage, 'changes': dict(counters)}


def capability_drafts(catalog):
    """Compose tenant-specific, read-only tools from a small declarative vocabulary."""
    counts = Counter(row['categoryHint'] for row in catalog['documents'] if row['change'] in ('NEW', 'CHANGED', 'UNCHANGED'))
    drafts = []
    for hint, count in sorted(counts.items()):
        if hint == 'UNCLASSIFIED' or count < 3:
            continue
        spec = {'schemaVersion': 'aurora.capability.draft.v1', 'org': catalog['org'],
                'id': fingerprint([catalog['org'], 'metadata-inventory-by-month-v1', hint])[:32],
                'title': 'Inventário ' + hint + ' por mês de modificação',
                'status': 'GENERATED_AWAITING_HUMAN_REVIEW', 'activationAllowed': False,
                'source': 'LOCAL_METADATA_CATALOG', 'category': hint, 'groupBy': 'modifiedMonth',
                'operation': 'COUNT', 'permissions': ['READ_LOCAL_METADATA'],
                'evidence': {'distinctDocuments': count},
                'limitations': ['Filename hints are unvalidated.', 'Modification month is not fiscal competence.', 'No financial or clinical inference.']}
        spec['definitionFingerprint'] = fingerprint(spec)
        # Test semantics on synthetic input only. This is not an integration/security certification.
        synthetic = {'org': catalog['org'], 'documents': [{'org': catalog['org'], 'categoryHint': hint, 'modifiedMonth': '2000-01', 'change': 'NEW'}, {'org': catalog['org'], 'categoryHint': 'OTHER', 'modifiedMonth': '2000-01', 'change': 'NEW'}]}
        if execute_draft(spec, synthetic, approved=True) != {'2000-01': 1}:
            raise GuardrailError('GENERATED_CAPABILITY_SELF_TEST_FAILED')
        drafts.append(spec)
    return {'schemaVersion': 'aurora.capability.catalog.v1', 'org': catalog['org'], 'drafts': drafts,
            'learningMode': 'DETERMINISTIC_LOCAL_PROFILE_NOT_MODEL_TRAINING'}


def execute_draft(spec, catalog, *, approved=False):
    """Explicit local preview only. Never eval/exec/import generated instructions."""
    if not approved:
        raise GuardrailError('EXPLICIT_PREVIEW_APPROVAL_REQUIRED')
    definition = {k: v for k, v in spec.items() if k != 'definitionFingerprint'}
    if fingerprint(definition) != spec.get('definitionFingerprint'):
        raise GuardrailError('CAPABILITY_INTEGRITY_MISMATCH')
    if spec.get('org') != catalog.get('org') or any(row.get('org') != catalog['org'] for row in catalog['documents']):
        raise GuardrailError('CROSS_TENANT_CAPABILITY_REJECTED')
    if (spec.get('operation') != 'COUNT' or spec.get('groupBy') not in FIELDS
            or spec.get('source') != 'LOCAL_METADATA_CATALOG' or spec.get('permissions') != ['READ_LOCAL_METADATA']
            or spec.get('activationAllowed') is not False):
        raise GuardrailError('CAPABILITY_OUTSIDE_APPROVED_VOCABULARY')
    return dict(sorted(Counter(str(row.get(spec['groupBy'], 'UNKNOWN')) for row in catalog['documents']
                               if row.get('categoryHint') == spec['category'] and row.get('change') in ('NEW', 'CHANGED', 'UNCHANGED')).items()))


def private_json(path, value):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.write-', delete=False) as out:
        temporary = Path(out.name)
        try:
            os.chmod(temporary, 0o600)
            json.dump(value, out, ensure_ascii=True, sort_keys=True, indent=2)
            out.write('\n'); out.flush(); os.fsync(out.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_private_json(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'r', encoding='utf-8') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise GuardrailError('REGULAR_LOCAL_CONFIG_REQUIRED')
        if os.fstat(stream.fileno()).st_size > 100 * 1024 * 1024:
            raise GuardrailError('LOCAL_STATE_LIMIT')
        return json.load(stream)


def run_once(config):
    roots, state = validate(config)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if stat.S_IMODE(state.stat().st_mode) & 0o077:
        raise GuardrailError('STATE_DIRECTORY_MUST_BE_PRIVATE')
    lock = state / '.scan.lock'
    try:
        lock_fd = os.open(str(lock), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        raise GuardrailError('SCAN_LOCK_PRESENT') from None
    try:
        os.close(lock_fd)
        previous_path = state / 'catalog.json'
        previous = read_private_json(previous_path) if previous_path.exists() or previous_path.is_symlink() else {}
        if previous and previous.get('org') != config['org']:
            raise GuardrailError('CROSS_TENANT_STATE_REJECTED')
        rows, coverage = inventory(config, roots)
        catalog = merge_catalog(config['org'], rows, coverage, previous, now_iso())
        drafts = capability_drafts(catalog)
        # One atomic bundle keeps the catalog and its generated drafts consistent.
        catalog['capabilityDrafts'] = drafts
        catalog['authorizationRef'] = config['authorization']['documentRef']
        private_json(previous_path, catalog)
        return {'status': 'LOCAL_DISCOVERY_COMPLETE' if all(c['enumerationComplete'] for c in coverage) else 'LOCAL_DISCOVERY_PARTIAL',
                'documentsObserved': len(rows), 'changes': catalog['changes'], 'capabilityDrafts': len(drafts['drafts']),
                'sourceContentsRead': 0, 'documentsUploaded': 0, 'capabilitiesActivated': 0}
    finally:
        lock.unlink(missing_ok=True)


def installation_config(args, target, watch_dir):
    approved = bool(getattr(args, 'authorize_discovery', False))
    config = {'schemaVersion': VERSION, 'org': args.org,
              'roots': getattr(args, 'discovery_root', None) or [str(watch_dir)],
              'stateDir': str(target / 'state' / 'onboarding'), 'contentRead': False, 'networkUpload': False,
              'maxEntries': 10000, 'maxDepth': 8, 'intervalSeconds': 900,
              'authorization': {'approved': approved, 'actorRef': getattr(args, 'discovery_actor_ref', None),
                                'documentRef': getattr(args, 'discovery_authorization_ref', None),
                                'expiresAt': getattr(args, 'discovery_expires_at', None)}}
    if approved:
        validate(config)
    return config


def install_assets(source, target, config):
    shutil.copy2(source / 'aurora_onboarding.py', target / 'bin' / 'aurora_onboarding.py')
    os.chmod(target / 'bin' / 'aurora_onboarding.py', 0o700)
    private_json(target / 'onboarding-config.json', config)
    command = [sys.executable, str(target / 'bin' / 'aurora_onboarding.py'), '--config', str(target / 'onboarding-config.json')]
    runner = target / 'discover.sh'
    runner.write_text('#!/bin/sh\nset -eu\nexec ' + ' '.join(shlex.quote(part) for part in command) + ' "$@"\n', encoding='utf-8')
    runner.chmod(0o700)
    plist = {'Label': 'br.com.auroranexus.onboarding.' + config['org'], 'ProgramArguments': command,
             'StartInterval': config['intervalSeconds'], 'RunAtLoad': False,
             'StandardOutPath': str(target / 'log' / 'onboarding.out.log'),
             'StandardErrorPath': str(target / 'log' / 'onboarding.err.log'), 'Umask': 0o077}
    path = target / 'aurora-onboarding.launchd.plist.example'
    path.write_bytes(plistlib.dumps(plist)); path.chmod(0o600)
    # Example only: no launchctl, login item, permission grant or background service activation.


def main(argv=None):
    parser = argparse.ArgumentParser(description='AURORA: descoberta institucional local autorizada; sem leitura de conteúdo ou transmissão')
    parser.add_argument('--config', required=True)
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args(argv)
    try:
        while True:
            path = canonical(args.config)
            config = read_private_json(path)  # Revocation and expiration are checked on every cycle.
            result = run_once(config)
            print(json.dumps(result, ensure_ascii=True), flush=True)
            if not args.watch:
                return 0
            time.sleep(config['intervalSeconds'])
    except KeyboardInterrupt:
        return 0
    except (GuardrailError, OSError, ValueError, KeyError, TypeError) as error:
        code = str(error) if isinstance(error, GuardrailError) else 'LOCAL_DISCOVERY_UNAVAILABLE'
        print(json.dumps({'status': 'BLOCKED', 'code': code}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
