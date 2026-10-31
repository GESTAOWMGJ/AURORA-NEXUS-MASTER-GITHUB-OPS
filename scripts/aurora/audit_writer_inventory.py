#!/usr/bin/env python3
"""Reproducible source inventory, NOT proof of coverage of runtime effects.

Candidates deliberately include false positives (e.g. Map.set and response.set).
Reflection, generated code, provider state and installed binaries need review.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/validation/writer-inventory.json'
ROOTS = ('firebase-migration/functions/src/', 'src/', 'apps-script/', 'appsscript/',
         'firebase-migration/apps-script/', 'aurora-coletor/', 'desktop/',
         'scripts/', 'tools/', 'firebase-migration/scripts/', 'firebase-migration/api/')
SUFFIXES = {'.ts', '.js', '.cjs', '.mjs', '.gs', '.py', '.ps1', '.sh', '.swift'}
SINK = re.compile(r'\b(?:set|create|update|delete|add|commit|runTransaction|batch|bulkWriter|'
                  r'setValue|setValues|appendRow|clearContent|clearContents|deleteRow|deleteRows|'
                  r'createFile|createFolder|setContent|setTrashed|moveTo|makeCopy|insert|copy|'
                  r'setProperty|setProperties|deleteProperty|sendEmail|sendMessage|'
                  r'writeFile|writeFileSync|appendFile|appendFileSync|write_text|write_bytes|'
                  r'unlink|unlinkSync|rename|renameSync|replace|execute|executemany|fetch|urlopen)\s*\(')

def inventory():
    names = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
    files = []
    scanned = 0
    for name in sorted(set(names)):
        path = Path(name)
        if not name.startswith(ROOTS) or path.suffix not in SUFFIXES:
            continue
        if any(part in ('test','tests','__pycache__','node_modules','fixtures') for part in path.parts):
            continue
        if path.name.startswith(('test_', 'test-', 'test.')) or '.test.' in path.name:
            continue
        if name == 'scripts/aurora/audit_writer_inventory.py':
            continue
        scanned += 1
        raw = (ROOT / name).read_bytes()
        candidates, guarded = [], []
        for line, text in enumerate(raw.decode('utf-8').splitlines(),1):
            if SINK.search(text): candidates.append(line)
            if re.search(r'\bguardedCanonicalTransaction\s*\(',text): guarded.append(line)
        if candidates or guarded:
            files.append({'path':name,'sha256':hashlib.sha256(raw).hexdigest(),
                          'writeLikeLines':candidates,'guardedCallLines':guarded,
                          'coverage':'REQUIRES_EFFECT_AND_DESTINATION_REVIEW'})
    return {'schema':'aurora.writer-inventory.v1','guardian':'AURORA-REALTIME-PLATFORM-GUARDIAN-001',
            'scope':'REPOSITORY_SOURCE_ONLY','method':'CONSERVATIVE_LEXICAL_CANDIDATES',
            'allLegacyWritersEnforced':False,'runtimeInventoryVerified':False,
            'scannedFiles':scanned,'candidateFiles':len(files),
            'writeLikeLines':sum(len(f['writeLikeLines']) for f in files),'files':files}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    data=inventory();encoded=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
    if args.check:
        if not TARGET.exists() or TARGET.read_text()!=encoded:
            raise SystemExit('WRITER_INVENTORY_CHANGED: review affected effects, update inventory and coverage before promotion')
    else:
        TARGET.parent.mkdir(parents=True,exist_ok=True);TARGET.write_text(encoded)
    print(json.dumps({k:v for k,v in data.items() if k!='files'}))

if __name__=='__main__':main()
