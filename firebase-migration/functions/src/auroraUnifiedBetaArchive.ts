/** Pure, bounded public-package verification and deterministic finalization.
 * This module never reads credentials, writes files, executes payloads or fetches URLs.
 * Publisher CLI and private download runtime use exactly this implementation. */
import { createHash, createPublicKey } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { verifyActiveReleaseEnvelope, type ActiveReleaseEnvelope } from './auroraActiveRelease.js';

export const UNIFIED_NAME = 'Aurora-Nexus-Beta-One.zip';
export const UNIFIED_MAX_ARCHIVE = 16 * 1024 * 1024;
export const UNIFIED_MAX_FILE = 8 * 1024 * 1024;
export const UNIFIED_MAX_EXPANDED = 32 * 1024 * 1024;
export const UNIFIED_MAX_ENTRIES = 2048;
export const COMPONENTS = ['server','web','satellite','iaMaster','windowsIntegration'] as const;
const SATELLITES = ['AURORA-NEXUS-Instalar.exe','AURORA-NEXUS-Mac-HML.zip','AURORA-NEXUS-Windows-Beta.zip','AURORA-NEXUS-Windows-x64-HML.exe'];
const PORTAL = 'https://auroranexus.com.br/portal';
// These source helpers are not covered by component manifests. Pin them to reviewed
// source, never to an unsigned self-reported delivery index. Python normalizes LF.
export const UNIFIED_HELPERS = Object.freeze({
  'README.md': 'ee2358f80f2ca9da490ee3f9ba0972eb24800a4fe13fe892393129e17fa008b4',
  'VERIFY.py': '80c85b90e2a7d9ee7689e02976e707491205fe0b6601f6139fc88f0ad91469ea'
});
type Row = Record<string, any>;
type Budget = { expanded: number; entries: number };
export const unifiedDigest = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const need: (condition: unknown, code: string) => asserts condition = (condition, code) => { if (!condition) throw Error(code); };
const row = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const sameKeys = (value: Row, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value,k));
const same = (a: unknown,b: unknown) => canonical(a) === canonical(b);
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (row(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  need(value === null || ['boolean','string'].includes(typeof value) || typeof value === 'number' && Number.isSafeInteger(value), 'INVALID_CANONICAL_VALUE');
  return JSON.stringify(value);
}
const jsonBytes = (value: unknown) => Buffer.from(canonical(value)+'\n','utf8');

/** Strict JSON reader: duplicate keys, non-finite/unsafe numbers and excess nesting fail. */
export function parseUnifiedJson(bytes: Uint8Array): any {
  need(bytes.length <= 2 * 1024 * 1024, 'JSON_TOO_LARGE');
  const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  let at=0;
  const space=()=>{while (at<text.length && /[\t\n\r ]/.test(text[at]!)) at++;};
  const string=():string=>{
    const start=at++; need(text[start]==='"','INVALID_JSON');
    while(at<text.length){const c=text[at++]!; if(c==='"') { const result=JSON.parse(text.slice(start,at)); need(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result),'INVALID_JSON_UNICODE'); return result; }
      if(c==='\\') {need(at<text.length,'INVALID_JSON');at++;} else need(c.charCodeAt(0)>=32,'INVALID_JSON');}
    throw Error('INVALID_JSON');
  };
  const value=(depth:number):any=>{
    need(depth<=32,'JSON_TOO_DEEP');space();const c=text[at];
    if(c==='"')return string();
    if(c==='{') {at++;space();const out:Row=Object.create(null);if(text[at]==='}') {at++;return out;}
      for(let count=0;;count++){need(count<10000,'JSON_TOO_MANY_KEYS');space();const key=string();need(!Object.hasOwn(out,key),'DUPLICATE_JSON_KEY');space();need(text[at++]===':','INVALID_JSON');out[key]=value(depth+1);space();const end=text[at++];if(end==='}')return out;need(end===',','INVALID_JSON');}}
    if(c==='[') {at++;space();const out:any[]=[];if(text[at]===']'){at++;return out;}for(;;){need(out.length<10000,'JSON_TOO_MANY_ITEMS');out.push(value(depth+1));space();const end=text[at++];if(end===']')return out;need(end===',','INVALID_JSON');}}
    for(const [literal,result] of [['true',true],['false',false],['null',null]] as const)if(text.startsWith(literal,at)){at+=literal.length;return result;}
    const number=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    need(number,'INVALID_JSON');at+=number[0].length;const result=Number(number[0]);need(Number.isSafeInteger(result),'INVALID_JSON_NUMBER');return result;
  };
  const result=value(0);space();need(at===text.length,'INVALID_JSON');return result;
}

export function safeUnifiedName(name: string): void {
  // Current five-component output uses ASCII paths. Reject Unicode filenames
  // rather than pretend JavaScript lowercasing implements Unicode casefold.
  need(typeof name==='string' && name.length>0 && name.length<=240 && /^[\x20-\x7e]+$/.test(name)
    && !/[\\:\x00]/.test(name),'UNSAFE_ZIP_PATH');
  need(name.split('/').every(p=>p && p!=='.' && p!=='..' && !/[ .]$/.test(p)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p)), 'UNSAFE_ZIP_PATH');
}
const CRC_TABLE=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function unifiedCrc32(bytes:Uint8Array):number {let crc=0xffffffff;for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]!^(crc>>>8);return (crc^0xffffffff)>>>0;}

/** ZIP32 only, complete contiguous local/central records, no descriptors/extras/comments.
 * Limits are shared by the outer archive and all nested component archives. */
export function readUnifiedZip(input: Uint8Array, budget:Budget={expanded:0,entries:0}): Map<string,Buffer> {
  const data=Buffer.from(input);need(data.length>=22 && data.length<=UNIFIED_MAX_ARCHIVE,'ZIP_SIZE_REJECTED');
  const end=data.length-22;need(data.readUInt32LE(end)===0x06054b50 && data.readUInt16LE(end+20)===0,'ZIP_END_REJECTED');
  const count=data.readUInt16LE(end+10),centralSize=data.readUInt32LE(end+12),centralOffset=data.readUInt32LE(end+16);
  need(data.readUInt16LE(end+4)===0 && data.readUInt16LE(end+6)===0 && data.readUInt16LE(end+8)===count
    && count>0 && count<65535 && centralOffset!==0xffffffff && centralSize!==0xffffffff
    && centralOffset+centralSize===end,'ZIP_DIRECTORY_REJECTED');
  need(budget.entries+count<=UNIFIED_MAX_ENTRIES,'ZIP_ENTRY_LIMIT');budget.entries+=count;
  const files=new Map<string,Buffer>(),folded=new Set<string>();let central=centralOffset,localEnd=0;
  for(let index=0;index<count;index++){
    need(central+46<=end && data.readUInt32LE(central)===0x02014b50,'ZIP_CENTRAL_REJECTED');
    const made=data.readUInt16LE(central+4),version=data.readUInt16LE(central+6),flags=data.readUInt16LE(central+8),method=data.readUInt16LE(central+10);
    const crc=data.readUInt32LE(central+16),compressed=data.readUInt32LE(central+20),expanded=data.readUInt32LE(central+24);
    const length=data.readUInt16LE(central+28),extra=data.readUInt16LE(central+30),comment=data.readUInt16LE(central+32),disk=data.readUInt16LE(central+34);
    const internal=data.readUInt16LE(central+36),external=data.readUInt32LE(central+38),offset=data.readUInt32LE(central+42);
    need(version<=20 && [0,0x800].includes(flags) && [0,8].includes(method) && disk===0 && !extra && !comment && !internal
      && [0,3].includes(made>>>8) && compressed!==0xffffffff && expanded<=UNIFIED_MAX_FILE && compressed<=UNIFIED_MAX_ARCHIVE
      && offset===localEnd && central+46+length<=end,'ZIP_ENTRY_REJECTED');
    const mode=external>>>16;need((mode&0xf000)===0 || (mode&0xf000)===0x8000,'ZIP_TYPE_REJECTED');
    need(!(external&0x10),'ZIP_DIRECTORY_ENTRY_REJECTED');
    const nameBytes=data.subarray(central+46,central+46+length);const name=new TextDecoder('utf-8',{fatal:true}).decode(nameBytes);safeUnifiedName(name);
    need(!folded.has(name.toLowerCase()),'ZIP_NAME_COLLISION');folded.add(name.toLowerCase());
    need(offset+30<=centralOffset && data.readUInt32LE(offset)===0x04034b50,'ZIP_LOCAL_REJECTED');
    need(data.readUInt16LE(offset+4)===version && data.readUInt16LE(offset+6)===flags && data.readUInt16LE(offset+8)===method
      && data.readUInt32LE(offset+10)===data.readUInt32LE(central+12) && data.readUInt32LE(offset+14)===crc
      && data.readUInt32LE(offset+18)===compressed && data.readUInt32LE(offset+22)===expanded
      && data.readUInt16LE(offset+26)===length && data.readUInt16LE(offset+28)===0,'ZIP_LOCAL_CENTRAL_CONFLICT');
    const start=offset+30+length;localEnd=start+compressed;
    need(localEnd<=centralOffset && data.subarray(offset+30,start).equals(nameBytes),'ZIP_LOCAL_NAME_CONFLICT');
    need(budget.expanded+expanded<=UNIFIED_MAX_EXPANDED,'ZIP_EXPANSION_LIMIT');budget.expanded+=expanded;
    const encoded=data.subarray(start,localEnd);let content:Buffer;
    if(method===0){need(compressed===expanded,'ZIP_STORED_SIZE_CONFLICT');content=Buffer.from(encoded);}
    else {const decoded=inflateRawSync(encoded,{maxOutputLength:Math.max(1,expanded),info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
      need(decoded.engine.bytesWritten===compressed,'ZIP_DEFLATE_TRAILING_BYTES');content=decoded.buffer;}
    need(content.length===expanded && unifiedCrc32(content)===crc,'ZIP_CONTENT_INTEGRITY_CONFLICT');
    files.set(name,content);central+=46+length;
  }
  need(central===end && localEnd===centralOffset,'ZIP_UNEXPECTED_BYTES');return files;
}

/** Stored output removes compressor/library-version differences between CI and runtime. */
export function writeUnifiedZip(files:Map<string,Buffer>):Buffer {
  need(files.size>0 && files.size<=UNIFIED_MAX_ENTRIES,'ZIP_ENTRY_LIMIT');
  const locals:Buffer[]=[],centrals:Buffer[]=[],folded=new Set<string>();let offset=0;
  for(const name of [...files.keys()].sort()){
    safeUnifiedName(name);need(!folded.has(name.toLowerCase()),'ZIP_NAME_COLLISION');folded.add(name.toLowerCase());
    const bytes=files.get(name)!;need(bytes.length<=UNIFIED_MAX_FILE,'ZIP_FILE_LIMIT');const encoded=Buffer.from(name,'ascii'),crc=unifiedCrc32(bytes);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x5c21,12);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(encoded.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x5c21,14);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(encoded.length,28);
    central.writeUInt32LE(0x81a40000,38);central.writeUInt32LE(offset,42);
    locals.push(local,encoded,bytes);centrals.push(central,encoded);offset+=30+encoded.length+bytes.length;need(offset<=UNIFIED_MAX_ARCHIVE,'ZIP_SIZE_REJECTED');
  }
  const central=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);
  end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);const result=Buffer.concat([...locals,central,end]);need(result.length<=UNIFIED_MAX_ARCHIVE,'ZIP_SIZE_REJECTED');return result;
}

function accessPage(platform:string):Buffer {return Buffer.from('<!doctype html><html lang="pt-BR"><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA NEXUS</title><p>Acesso '+platform+' ao mesmo portal privado.</p>'+
  '<p><a href="'+PORTAL+'">Abrir AURORA NEXUS</a></p><p>Use sua identidade individual e MFA. Este acesso web não é IPA/APK,'+
  ' não instala um aplicativo nativo e não comprova aceite no dispositivo.</p></html>\n');}
function adoption():Row {return {
  web:{kind:'CANONICAL_PRIVATE_PORTAL',entry:PORTAL,acceptance:'PENDING'},
  windows:{kind:'EDGE_APP_ACCESS_CLIENT',package:'AURORA-NEXUS-Instalar.exe',editorSignature:'PENDING',nativeReceipt:'PENDING',acceptance:'PENDING'},
  mac:{kind:'EXISTING_MAC_APP',appName:'Aurora Nexus HML-0.2.0-hml.20261001.app',bundleIdentifier:'br.com.auroranexus.desktop.hml',bundleVersion:'1',shortVersion:'0.2.0',identityPreserved:true,appleSignature:'PENDING',nativeReceipt:'PENDING',acceptance:'PENDING'},
  ios:{kind:'NATIVE_IOS_REQUESTED',requestedDistribution:'NATIVE_TESTFLIGHT_APP_STORE',nativeDeliveryStatus:'PENDING_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE',availableWebChannel:'EXISTING_PWA',entry:PORTAL,nativeAppStoreBuild:false,acceptance:'PENDING'},
  android:{kind:'EXISTING_PWA',entry:PORTAL,nativePlayStoreBuild:false,acceptance:'PENDING'}};}
function installationPolicy():Row {return {schemaVersion:'aurora.installation.acceptance.v1',status:'PENDING',methods:['CLOUD_OAUTH','API_TOKEN','LOCAL_AGENT','MANUAL'],
  requiredFlags:['processingVerified','receiptPersisted','replayVerified','automationConfigured','automationVerified','eligible'],operationalProofsIncluded:false,installationComplete:false,loginPingAndCiAreProcessingProof:false};}
function records(files:Map<string,Buffer>):Row {return Object.fromEntries([...files.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,b])=>[name,{sha256:unifiedDigest(b),size:b.length}]));}
function verifyComponent(bytes:Buffer,manifestBytes:Buffer,manifest:Row,budget:Budget):Map<string,Buffer> {
  need(row(manifest.files) && Object.keys(manifest.files).length>0,'INVALID_COMPONENT_FILES');const files=readUnifiedZip(bytes,budget);
  need(files.size===Object.keys(manifest.files).length+1 && files.get('manifest.json')?.equals(manifestBytes),'COMPONENT_MANIFEST_CONFLICT');
  for(const [name,hash] of Object.entries(manifest.files)){safeUnifiedName(name);need(name!=='manifest.json' && typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash)
    && files.has(name) && unifiedDigest(files.get(name)!)===hash,'COMPONENT_BYTES_CONFLICT');}return files;
}

export type UnifiedFinalization={ bytes:Buffer;sha256:string;sourceSha:string;productVersion:string;certificateSha256:string;delivery:Row };
/** Prepromotion checks are deliberately unsigned and cannot confer active authority. */
export function verifyUnifiedCandidate(input:Uint8Array,source:string,expectedComponents?:Row,expectedVersion?:string):{files:Map<string,Buffer>;index:Row;oldIdentity:Row} {
  need(/^[a-f0-9]{40}$/.test(source),'EXACT_SOURCE_REQUIRED');
  const candidate=Buffer.from(input),budget={expanded:0,entries:0};
  const files=readUnifiedZip(candidate,budget);need(files.has('candidate-manifest.json'),'CANDIDATE_MANIFEST_REQUIRED');const index=parseUnifiedJson(files.get('candidate-manifest.json')!);
  need(writeUnifiedZip(files).equals(candidate),'NONCANONICAL_CANDIDATE_ZIP');
  need(files.get('candidate-manifest.json')!.equals(jsonBytes(index)),'NONCANONICAL_CANDIDATE_INDEX');
  need(row(index) && sameKeys(index,['schemaVersion','status','complete','releaseId','productVersion','sourceSha','certificateSha256','identity','components','adoption','installationAcceptancePolicy','files','allDeclaredPayloadsPresent','missingTargets'])
    && index.schemaVersion==='aurora.unified-beta-candidate.v1' && index.status==='PREPARADO' && index.complete===false && index.sourceSha===source && index.certificateSha256===null
    && index.allDeclaredPayloadsPresent===true && row(index.components) && sameKeys(index.components,COMPONENTS)
    && typeof index.productVersion==='string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(index.productVersion)
    && (!expectedComponents||same(index.components,expectedComponents)) && (!expectedVersion||index.productVersion===expectedVersion),'CANDIDATE_IDENTITY_CONFLICT');
  for(const pin of Object.values(index.components))need(row(pin)&&sameKeys(pin,['sourceSha','version','manifestSha256'])&&pin.sourceSha===source&&typeof pin.version==='string'&&pin.version.length<=80&&/^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(pin.version)&&/^[a-f0-9]{64}$/.test(pin.manifestSha256),'INVALID_CANDIDATE_PIN');
  const certificate={components:index.components as Row,productVersion:index.productVersion as string};
  need(certificate.components.server.version===certificate.productVersion&&certificate.components.web.version===certificate.productVersion,'PRODUCT_VERSION_CONFLICT');
  const original=new Map(files);original.delete('candidate-manifest.json');need(same(index.files,records(original)),'CANDIDATE_CLOSURE_CONFLICT');
  const manifests:Record<string,Row>={},required=new Set(['candidate-manifest.json','README.md','VERIFY.py']);
  for(const component of COMPONENTS){const path='manifests/'+component+'-manifest.json',bytes=files.get(path),pin=certificate.components[component]!;need(bytes,'ALL_MANIFESTS_REQUIRED');required.add(path);
    need(unifiedDigest(bytes)===pin.manifestSha256,'SIGNED_MANIFEST_CONFLICT');const manifest=parseUnifiedJson(bytes);need(row(manifest) && manifest.dirty!==true,'INVALID_MANIFEST');
    const field=component==='iaMaster'?'sourceRevision':component==='satellite'?'sourceCommit':'sourceSha';
    need(manifest[field]===source && manifest.version===pin.version && ['sourceSha','sourceCommit','sourceRevision'].every(k=>!Object.hasOwn(manifest,k)||manifest[k]===source)
      && ['version','clientVersion'].every(k=>!Object.hasOwn(manifest,k)||manifest[k]===pin.version),'MANIFEST_IDENTITY_CONFLICT');manifests[component]=manifest;}
  for(const component of ['server','web']){const entries=manifests[component]!.files;need(row(entries) && Object.keys(entries).length>0,'RUNTIME_CLOSURE_REQUIRED');
    for(const [name,hash] of Object.entries(entries)){safeUnifiedName(name);need(/^lib\/[A-Za-z0-9._/-]+\.js$/.test(name) && typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash),'INVALID_RUNTIME_FILE');
      const path='payloads/'+component+'/'+name;required.add(path);need(files.has(path)&&unifiedDigest(files.get(path)!)===hash,'RUNTIME_PAYLOAD_CONFLICT');}}
  for(const component of ['iaMaster','windowsIntegration']){const path='payloads/'+component+'/'+component+'-package.zip';required.add(path);need(files.has(path),'COMPONENT_PACKAGE_REQUIRED');verifyComponent(files.get(path)!,files.get('manifests/'+component+'-manifest.json')!,manifests[component]!,budget);}
  const satellites=manifests.satellite!.files;need(Array.isArray(satellites) && satellites.length===4 && same(satellites.map(x=>x?.name).sort(),SATELLITES),'SATELLITE_CLOSURE_CONFLICT');
  for(const item of satellites){const path='payloads/satellite/'+item.name;required.add(path);need(row(item)&&item.signed===false&&Number.isSafeInteger(item.size)&&files.get(path)?.length===item.size&&unifiedDigest(files.get(path)!)===item.sha256,'SATELLITE_PAYLOAD_CONFLICT');}
  const windows=files.get('payloads/satellite/AURORA-NEXUS-Windows-Beta.zip')!,winFiles=readUnifiedZip(windows,budget);need(winFiles.has('manifest.json'),'WINDOWS_MANIFEST_REQUIRED');const winManifest=parseUnifiedJson(winFiles.get('manifest.json')!);
  need(row(winManifest)&&winManifest.sourceCommit===source,'WINDOWS_SOURCE_CONFLICT');verifyComponent(windows,winFiles.get('manifest.json')!,winManifest,budget);
  const mac=readUnifiedZip(files.get('payloads/satellite/AURORA-NEXUS-Mac-HML.zip')!,budget);const plist=mac.get('Aurora Nexus HML.app/Contents/Info.plist');need(plist,'CHOSEN_MAC_BUNDLE_REQUIRED');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(plist);need(!/<!ENTITY/i.test(xml),'MAC_PLIST_REJECTED');
  for(const [name,value] of Object.entries({CFBundleIdentifier:'br.com.auroranexus.desktop.hml',CFBundleName:'Aurora Nexus HML',CFBundleVersion:'1',CFBundleShortVersionString:'0.2.0'})){
    const match=[...xml.matchAll(new RegExp('<key>'+name+'</key>\\s*<string>([^<]*)</string>','g'))];need(match.length===1&&match[0]![1]===value,'CHOSEN_MAC_IDENTITY_CONFLICT');}
  for(const target of ['web','ios','android']){const path='access/'+target+'/index.html';required.add(path);need(files.get(path)?.equals(accessPage(target)),'ACCESS_ENTRY_REQUIRED');}
  for(const [name,hash] of Object.entries(UNIFIED_HELPERS))need(files.has(name)&&unifiedDigest(files.get(name)!)===hash,'REVIEWED_HELPER_REQUIRED');
  need(files.size===required.size&&[...files.keys()].every(n=>required.has(n)),'UNEXPECTED_CANDIDATE_FILE');
  const oldIdentity={releaseId:'aurora-'+certificate.productVersion+'-'+source,productVersion:certificate.productVersion,sourceSha:source,certificateSha256:null};
  need(same(index.identity,oldIdentity)&&Object.entries(oldIdentity).every(([k,v])=>index[k]===v)&&same(index.adoption,adoption())&&same(index.installationAcceptancePolicy,installationPolicy())&&same(index.missingTargets,['ios-native']),'CANDIDATE_RELEASE_ID_CONFLICT');
  return {files,index,oldIdentity};
}

export function finalizeUnifiedBeta(options:{candidate:Uint8Array;envelope:unknown;publicKeySpkiPem:string;trustedPublicKeySha256:string;sourceSha:string;expectedCandidateSha256?:string;now?:number}):UnifiedFinalization {
  need(/^[a-f0-9]{40}$/.test(options.sourceSha) && /^[a-f0-9]{64}$/.test(options.trustedPublicKeySha256),'EXACT_TRUST_CONTEXT_REQUIRED');
  const key=createPublicKey(options.publicKeySpkiPem);need(key.asymmetricKeyType==='ed25519' && unifiedDigest(key.export({type:'spki',format:'der'}))===options.trustedPublicKeySha256,'TRUST_ANCHOR_CONFLICT');
  const checked=verifyActiveReleaseEnvelope(options.envelope,options.publicKeySpkiPem,{expectedSourceSha:options.sourceSha,now:options.now});
  need(checked.status==='CANDIDATE_UNVERIFIED' && checked.certificate.schemaVersion===2 && Object.values(checked.certificate.checks).every(v=>v===true),'SIGNED_CERTIFICATE_REQUIRED');
  const certificate=checked.certificate,source=options.sourceSha,candidate=Buffer.from(options.candidate);
  need(!options.expectedCandidateSha256 || unifiedDigest(candidate)===options.expectedCandidateSha256,'PREPROMOTION_CANDIDATE_CONFLICT');
  const {files,index,oldIdentity}=verifyUnifiedCandidate(candidate,source,certificate.components,certificate.productVersion);
  files.set('trust/certificate.json',jsonBytes(certificate));
  files.set('trust/public-trust.json',jsonBytes({publicKeySpkiPem:key.export({type:'spki',format:'pem'}).toString(),publicKeySha256:options.trustedPublicKeySha256}));
  files.set('trust/release-envelope-signed.json',jsonBytes(options.envelope as ActiveReleaseEnvelope));
  const identity={...oldIdentity,certificateSha256:checked.certificateSha256};
  const delivery={schemaVersion:'aurora.unified-beta-delivery.v1',status:'PREPARADO',complete:false,...identity,identity,components:certificate.components,adoption:index.adoption,
    installationAcceptancePolicy:index.installationAcceptancePolicy,files:records(files),candidateSha256:unifiedDigest(candidate),allDeclaredPayloadsPresent:true,publicationAvailability:'PENDING',missingTargets:index.missingTargets,
    remainingGates:['FINAL_ARTIFACT_AVAILABILITY','WINDOWS_EDITOR_SIGNATURE_AND_NATIVE_ACCEPTANCE','MAC_APPLE_SIGNATURE_AND_NATIVE_ACCEPTANCE','IOS_NATIVE_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE','ANDROID_PWA_DEVICE_ACCEPTANCE']};
  files.set('release-envelope.json',jsonBytes(delivery));files.set('SHA256SUMS',Buffer.from([...files.keys()].sort().map(n=>unifiedDigest(files.get(n)!)+'  '+n+'\n').join('')));
  const bytes=writeUnifiedZip(files);return {bytes,sha256:unifiedDigest(bytes),sourceSha:source,productVersion:certificate.productVersion,certificateSha256:checked.certificateSha256,delivery};
}
