"""Reproduce the closed PDF TEXT profile from one explicitly supplied npm archive.

Build-time tool only. No network, npm hooks, document input or runtime download.
The complete upstream CMap/font directories are packed, not selectively dropped.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
VERSION = '6.4.299'
ARCHIVE_SHA = '86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415'
ARCHIVE_SRI = 'sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g=='
UPSTREAM = 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz'
def digest(raw): return hashlib.sha256(raw).hexdigest()
def canonical(value): return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)+'\n').encode()
def publish(path,raw):
    """Replace a directory entry; never open a previous link/hardlink target.

    As with atomic-generated-file.mjs, the directory is the trusted checkout.
    No document value selects this path or supplies generated program bytes.
    """
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    staging=Path(tempfile.mkdtemp(prefix='.aurora-pdf-generated-',dir=path.parent))
    if staging.parent.resolve()!=path.parent.resolve():raise ValueError('PDF_STAGING_PATH_REJECTED')
    prepared=staging/path.name
    try:
        descriptor=os.open(prepared,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.replace(prepared,path)
    finally:
        if prepared.exists():prepared.unlink()
        staging.rmdir()

def profile(archive):
    raw=Path(archive).read_bytes()
    if len(raw)!=8539589 or digest(raw)!=ARCHIVE_SHA or 'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()!=ARCHIVE_SRI:
        raise ValueError('OFFICIAL_PDF_ARCHIVE_PIN_REQUIRED')
    files={}
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as tar:
        members=tar.getmembers()
        if len(members)>1000 or sum(item.size for item in members)>40*1024*1024: raise ValueError('UPSTREAM_ARCHIVE_LIMIT')
        for item in members:
            name=item.name.removeprefix('package/')
            if not item.isfile() or item.name!='package/'+name or '..' in name.split('/'):raise ValueError('UPSTREAM_ENTRY_REJECTED')
            if name in files:raise ValueError('UPSTREAM_DUPLICATE')
            if name in ('build/pdf.min.mjs','legacy/build/pdf.worker.min.mjs','LICENSE','package.json') or name.startswith(('cmaps/','standard_fonts/')):
                files[name]=tar.extractfile(item).read()
    if json.loads(files['package.json'])['version']!=VERSION:raise ValueError('UPSTREAM_VERSION_CONFLICT')
    entries=[];data=[];offset=0
    for name,content in sorted(files.items()):
        if not name.startswith(('cmaps/','standard_fonts/')):continue
        entries.append({'name':name,'offset':offset,'size':len(content),'sha256':digest(content)})
        offset+=len(content);data.append(content)
    if len(entries)!=185:raise ValueError('COMPLETE_CMAP_AND_FONT_PROFILE_REQUIRED')
    index=canonical({'schemaVersion':'aurora.pdf.text.data.v1','entries':entries})
    container=struct.pack('>I',len(index))+index+b''.join(data)
    notices=b'AURORA PDF TEXT PROFILE - upstream notices, unchanged below\n\n'
    for name in ('LICENSE','cmaps/LICENSE','standard_fonts/LICENSE_FOXIT','standard_fonts/LICENSE_LIBERATION'):
        if name in files:notices+=('\n--- '+name+' ---\n').encode()+files[name]+b'\n'
    core_license=(ROOT/'firebase-migration/scripts/pdf-text-vendor/core-js-3.50.0.LICENSE').read_bytes()
    if digest(core_license)!='b87653fff2d44426ab5cd4723cee3b1364dc8d35a0acdf098c54689543123bf8':raise ValueError('CORE_JS_LICENSE_PIN_REQUIRED')
    notices+=b'\n--- bundled core-js 3.50.0 / LICENSE (MIT) ---\n'+core_license+b'\n'
    result={'document_pdf_api.mjs':files['build/pdf.min.mjs'],
            'document_pdf_worker.mjs':files['legacy/build/pdf.worker.min.mjs'],
            'document_pdf_data.bin':container,'document_pdf_LICENSE.txt':notices}
    metadata={'schemaVersion':'aurora.pdf.text.vendor.v1','profile':'TEXT_ONLY_NO_RENDER_NO_OCR',
        'package':{'name':'pdfjs-dist','version':VERSION,'license':'Apache-2.0','upstream':UPSTREAM,
            'archiveSha256':ARCHIVE_SHA,'archiveIntegrity':ARCHIVE_SRI,
            'gitCommit':'d0991a0d53f3bb3a7307e3b83f279c1d117aafb3'},
        'runtimeDependencies':[], 'optionalCanvasRequired':False,'wasmEnabled':False,
        'bundledComponents':[{'name':'core-js','version':'3.50.0','license':'MIT','location':'legacy/build/pdf.worker.min.mjs',
            'licenseSource':'https://raw.githubusercontent.com/zloirock/core-js/v3.50.0/LICENSE','licenseSha256':digest(core_license)}],
        'included':['build/pdf.min.mjs','legacy/build/pdf.worker.min.mjs','cmaps/* (complete)','standard_fonts/* (complete)','upstream licenses'],
        'notUsed':['rendering','OCR','viewer','legacy API entrypoint','Wasm/image decoders','@napi-rs/canvas'],
        'files':{name:{'sha256':digest(content),'size':len(content)} for name,content in sorted(result.items())},
        'dataEntries':entries}
    result['document_pdf_vendor.json']=canonical(metadata)
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--archive',type=Path,required=True)
    parser.add_argument('--write',action='store_true');args=parser.parse_args()
    for name,raw in profile(args.archive).items():
        for directory in (ROOT/'aurora-coletor',ROOT/'firebase-migration/hosting/aurora-nexus/assets/document-intake'):
            target=directory/name
            if args.write:
                publish(target,raw)
            elif not target.is_file() or target.is_symlink() or target.read_bytes()!=raw:raise ValueError('PDF_VENDOR_DRIFT')
    runtime=(ROOT/'aurora-coletor/document_pdf_runtime.mjs').read_bytes().replace(b'\r\n',b'\n')
    pins={'profile':'PDFJS_6_4_299_TEXT_V1','files':{name:{'sha256':digest(raw),'size':len(raw)}
        for name,raw in sorted({**profile(args.archive),'document_pdf_runtime.mjs':runtime}.items())}}
    generated={ROOT/'aurora-coletor/document_pdf_pins.cjs':b"'use strict';\nmodule.exports="+canonical(pins).rstrip()+b';\n',
        ROOT/'firebase-migration/functions/src/auroraDocumentPdfAssets.ts':b'// Generated fixed text-only PDF profile; no document-supplied paths.\nexport const PDF_TEXT_ASSETS='+canonical(pins).rstrip()+b' as const;\n',
        ROOT/'firebase-migration/hosting/aurora-nexus/assets/document-intake/document_pdf_runtime.mjs':runtime}
    for path,raw in generated.items():
        if args.write:publish(path,raw)
        elif path.read_bytes()!=raw:raise ValueError('PDF_PROFILE_PIN_DRIFT')
    print(json.dumps({'status':'GENERATED' if args.write else 'VERIFIED','version':VERSION,'files':{name:{'sha256':digest(raw),'size':len(raw)} for name,raw in profile(args.archive).items()}}))
if __name__=='__main__':main()
