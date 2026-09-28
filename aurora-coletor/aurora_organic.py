"""AURORA NEXUS: deterministic proposal memory, never a model trainer or executor.

Pure reducer: the trusted caller supplies verification and persists the returned
node in EXISTING application state. No I/O, database, network or activation.
Not wired into a deployed authenticated event stream by this module.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
import re
from typing import Callable

SCHEMA = 'aurora.organic.memory.v1'
EVENT_SCHEMA = 'aurora.organic.signal.v1'
KINDS = frozenset({'REWORK', 'VALIDATED_DECISION', 'BILLING_EXCEPTION', 'SECTOR_NEED', 'TOOL_OUTCOME'})
CATEGORIES = frozenset({'CONTRACT', 'FISCAL', 'FINANCIAL', 'PRODUCTION', 'GOVERNANCE', 'AUDIT'})
TEMPLATES = {'REWORK': 'REWORK_CHECKLIST', 'VALIDATED_DECISION': 'DECISION_REGISTER',
             'BILLING_EXCEPTION': 'EXCEPTION_REGISTER', 'SECTOR_NEED': 'SECTOR_INVENTORY'}
KEYS = frozenset({'schemaVersion', 'id', 'org', 'sector', 'kind', 'category', 'caseRef',
                  'evidenceRefs', 'decisionRef', 'toolId', 'outcome'})
DIGEST = re.compile(r'^[a-f0-9]{64}$')
REF = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,63}$')
MAX_EVENTS = 5000


class OrganicError(ValueError):
    """Sanitized, fail-closed error."""


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def _signal(raw: dict, org: str, sectors: frozenset[str]) -> dict:
    if not isinstance(raw, dict) or set(raw) != KEYS or raw.get('schemaVersion') != EVENT_SCHEMA:
        raise OrganicError('CLOSED_SIGNAL_SCHEMA_REQUIRED')
    event = deepcopy(raw)
    if event['org'] != org:
        raise OrganicError('CROSS_TENANT_SIGNAL')
    if not isinstance(event['sector'], str) or event['sector'] not in sectors:
        raise OrganicError('SECTOR_NOT_AUTHORIZED')
    if event['kind'] not in KINDS or event['category'] not in CATEGORIES:
        raise OrganicError('SIGNAL_VOCABULARY_REJECTED')
    if any(not isinstance(event[k], str) or not DIGEST.fullmatch(event[k]) for k in ('id', 'caseRef', 'decisionRef')):
        raise OrganicError('OPAQUE_HASH_REFERENCES_REQUIRED')
    evidence = event['evidenceRefs']
    if (not isinstance(evidence, list) or not 1 <= len(evidence) <= 20
            or any(not isinstance(x, str) or not DIGEST.fullmatch(x) for x in evidence)):
        raise OrganicError('BOUNDED_EVIDENCE_REFERENCES_REQUIRED')
    event['evidenceRefs'] = sorted(set(evidence))
    if event['kind'] == 'TOOL_OUTCOME':
        if (event['outcome'] not in ('BENEFIT', 'NO_BENEFIT', 'ADVERSE')
                or not isinstance(event['toolId'], str) or not re.fullmatch(r'[a-f0-9]{32,64}', event['toolId'])):
            raise OrganicError('TOOL_OUTCOME_INVALID')
    elif event['toolId'] is not None or event['outcome'] is not None:
        raise OrganicError('OUTCOME_FIELDS_NOT_APPLICABLE')
    return event


def reconcile(org: str, previous: dict | None, signals: list[dict], *,
              allowed_sectors: frozenset[str], verify: Callable[[dict], bool],
              known_tool_ids: frozenset[str] = frozenset()) -> dict:
    """Revalidate ALL signals, deduplicate cases, version read-only proposals.

    verify must be a trusted adapter checking actor, org, decision, evidence hash,
    revocation and validity. Payload flags are NOT proof. Adapter errors abort.
    Synthetic callbacks prove reducer semantics, NOT real identity or evidence.
    Returned data is a node for the existing store, never a new source of truth.
    """
    if not isinstance(org, str) or not REF.fullmatch(org):
        raise OrganicError('TENANT_REQUIRED')
    if not callable(verify) or not isinstance(allowed_sectors, frozenset) or not allowed_sectors:
        raise OrganicError('TRUSTED_VERIFIER_AND_SECTORS_REQUIRED')
    if any(not isinstance(s, str) or not REF.fullmatch(s) for s in allowed_sectors):
        raise OrganicError('SECTOR_REGISTRY_INVALID')
    old = deepcopy(previous) if previous else {}
    if old and (old.get('org') != org or old.get('schemaVersion') != SCHEMA):
        raise OrganicError('MEMORY_SCOPE_OR_SCHEMA_INVALID')
    old_events = old.get('signals', [])
    if not isinstance(signals, list) or not isinstance(old_events, list):
        raise OrganicError('SIGNAL_LIST_REQUIRED')
    if len(signals) > MAX_EVENTS or len(old_events) > MAX_EVENTS:
        raise OrganicError('MEMORY_LIMIT_REVIEW_REQUIRED')
    events = {}
    for raw in old_events + signals:
        event = _signal(raw, org, allowed_sectors)
        if event['id'] in events and events[event['id']] != event:
            raise OrganicError('EVENT_ID_CONTENT_CONFLICT')
        events[event['id']] = event
    if len(events) > MAX_EVENTS:
        raise OrganicError('MEMORY_LIMIT_REVIEW_REQUIRED')
    accepted, deferred = [], []
    for key in sorted(events):
        event = events[key]
        # A verifier cannot mutate the event stored by the reducer.
        if verify(deepcopy(event)) is True:
            accepted.append(event)
        else:
            deferred.append(key)
    groups, outcomes = defaultdict(list), defaultdict(dict)
    for event in accepted:
        if event['kind'] == 'TOOL_OUTCOME':
            if event['toolId'] not in known_tool_ids:
                raise OrganicError('UNKNOWN_OR_UNSCOPED_TOOL')
            prior = outcomes[event['toolId']].get(event['caseRef'])
            if prior is not None and prior != event['outcome']:
                raise OrganicError('CONFLICTING_OUTCOME_REQUIRES_REVIEW')
            outcomes[event['toolId']][event['caseRef']] = event['outcome']
        else:
            groups[(event['kind'], event['sector'], event['category'])].append(event)
    old_drafts = {x['id']: x for x in old.get('proposals', [])}
    if any(x.get('org') != org or x.get('activationAllowed') is not False for x in old_drafts.values()):
        raise OrganicError('PRIOR_PROPOSAL_SCOPE_INVALID')
    for before in old_drafts.values():
        definition = {k: v for k, v in before.items() if k not in ('definitionFingerprint', 'revision', 'history')}
        if digest(definition) != before.get('definitionFingerprint'):
            raise OrganicError('PRIOR_DEFINITION_INTEGRITY_MISMATCH')
    proposals = {}
    for (kind, sector, category), evidence in sorted(groups.items()):
        cases = {x['caseRef'] for x in evidence}
        sources = {ref for x in evidence for ref in x['evidenceRefs']}
        # Three distinct cases AND source references; repeated clicks do not qualify.
        if len(cases) < 3 or len(sources) < 3:
            continue
        ident = digest([org, 'organic-proposal-v1', kind, sector, category])
        definition = {'id': ident, 'org': org, 'sector': sector, 'category': category,
                      'template': TEMPLATES[kind], 'operation': 'COUNT_VALIDATED_SIGNALS',
                      'permissions': ['READ_SANITIZED_VALIDATED_SIGNALS'],
                      'activationAllowed': False, 'humanReviewRequired': True,
                      'status': 'GENERATED_AWAITING_HUMAN_REVIEW',
                      'distinctCases': len(cases), 'evidenceRefs': sorted(sources),
                      'signalRefs': sorted(x['id'] for x in evidence)}
        before = old_drafts.get(ident, {})
        fp = digest(definition)
        revision = before.get('revision', 0) + int(before.get('definitionFingerprint') != fp)
        history = list(before.get('history', []))
        if before and before.get('definitionFingerprint') != fp:
            history.append({'revision': before['revision'], 'definitionFingerprint': before['definitionFingerprint']})
        proposals[ident] = {**definition, 'definitionFingerprint': fp, 'revision': revision, 'history': history}
    # Preserve old definitions as non-executable history when evidence is revoked.
    for ident, before in old_drafts.items():
        if ident not in proposals:
            stale = deepcopy(before)
            stale['status'] = 'EVIDENCE_REVALIDATION_REQUIRED'
            stale['activationAllowed'] = False
            definition = {k: v for k, v in stale.items() if k not in ('definitionFingerprint', 'revision', 'history')}
            fp = digest(definition)
            if fp != before['definitionFingerprint']:
                stale['revision'] += 1
                stale['history'].append({'revision': before['revision'], 'definitionFingerprint': before['definitionFingerprint']})
                stale['definitionFingerprint'] = fp
            proposals[ident] = stale
    performance = []
    for tool, cases in sorted(outcomes.items()):
        counts = dict(sorted(Counter(cases.values()).items()))
        performance.append({'toolId': tool, 'distinctCases': len(cases), 'outcomes': counts,
                            'recommendation': 'REVIEW_OR_ROLLBACK' if counts.get('ADVERSE', 0) else 'HUMAN_EFFECTIVENESS_REVIEW'})
    return {'schemaVersion': SCHEMA, 'org': org, 'mode': 'SHADOW_PROPOSALS_ONLY',
            'modelTraining': False, 'activationAllowed': False,
            'signals': [events[k] for k in sorted(events)], 'deferredSignalRefs': deferred,
            'proposals': [proposals[k] for k in sorted(proposals)], 'performance': performance,
            'limitations': ['Not connected to deployed event ingestion.', 'Verification is a trusted-caller responsibility.',
                            'Counts are not causal evidence of benefit.', 'No financial, clinical or contractual mutation.']}
