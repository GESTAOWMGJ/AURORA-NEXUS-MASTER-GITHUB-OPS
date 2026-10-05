const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const id = 'abcdef1234567890';
const root = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const attachments = [
  { name: 'statement.pdf', content: Buffer.from('%PDF synthetic statement'), mime: 'application/pdf' },
  { name: 'receipt.pdf', content: Buffer.from('%PDF synthetic receipt'), mime: 'application/pdf' }
];
function fixture() {
  const state = { props: { WMGJ_SPREADSHEET_ID: 'synthetic-sheet', WMGJ_PASTA_ENTRADA_ID: 'synthetic-folder',
    WMGJ_FIRESTORE_ORG_ID: 'synthetic-org' }, files: {}, index: [], queue: [['DATA_ENTRADA','ORIGEM','ID_ORIGEM','NOME','TIPO','STATUS','TENTATIVAS','PROXIMA_ACAO','ULTIMO_ERRO','OBSERVACAO']],
    selected: [], writes: [], uploads: [], allocated: 0, locked: false, owned: false, failures: {}, attachments: structuredClone(attachments),
    actor: 'synthetic@example.invalid', siblingReads: 0 };
  function fail(point) { if (typeof state.failures[point] === 'number' && state.failures[point] > 1) { state.failures[point]--; return; } if (state.failures[point]) { delete state.failures[point]; throw Error('synthetic interruption with private content'); } }
  function blob(bytes) { return { getBytes: () => [...Buffer.from(bytes)], getContentType: () => 'application/pdf' }; }
  function file(data) { return { getId: () => data.id, getName: () => data.name, getSize: () => data.bytes.length,
    getMimeType: () => data.mime, getUrl: () => 'https://drive.example.invalid/' + data.id, isTrashed: () => !!data.trashed, getBlob: () => blob(data.bytes) }; }
  function sheet(kind, name) { return { getName: () => name, getLastRow: () => state[kind].length,
    getDataRange: () => ({ getValues: () => state[kind].map(r => [...r]) }),
    appendRow: row => { assert.equal(state.locked, true); fail(kind + ':before'); state[kind].push([...row]); state.writes.push(kind); fail(kind + ':after'); } }; }
  const index = sheet('index', '21_GMAIL_INDEXACAO_FATURAMENTO'), queue = sheet('queue', '15_FILA_PROCESSAMENTO');
  const spreadsheet = { getId: () => state.props.WMGJ_SPREADSHEET_ID, getSheetByName: name => name.startsWith('21_') ? index : queue };
  const props = { getProperty: key => state.props[key] ?? null, setProperty: (key,value) => {
    assert.equal(state.locked, true); fail('property:before'); state.props[key] = value; state.writes.push('property');
    if (key.startsWith('AURORA_GMAIL_ITEM_')) { const s = JSON.parse(value); fail('stage:' + s.stage); } fail('property:after');
  } };
  const extra = {
    Date, Number, RegExp, Session: { getEffectiveUser: () => ({ getEmail: () => state.actor }) },
    SpreadsheetApp: { openById: () => spreadsheet, flush() { fail('flush'); } },
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ hasLock: () => state.owned,
      tryLock: () => { if (state.locked) return false; state.locked = state.owned = true; return true; },
      releaseLock: () => { state.locked = state.owned = false; } }) },
    ScriptApp: { getScriptId: () => 'synthetic-script', getOAuthToken: () => 'synthetic-token' },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (alg, bytes) => [...crypto.createHash(alg).update(typeof bytes === 'string' ? bytes : Buffer.from(bytes)).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') + '=', newBlob: v => blob(typeof v === 'string' ? Buffer.from(v) : v), getUuid: () => crypto.randomUUID() },
    GmailApp: { getMessageById: selected => { state.selected.push(selected); return {
      getId: () => state.wrongId || selected, getAttachments: () => state.attachments.map(a => ({ getName: () => a.name,
        getContentType: () => a.mime, copyBlob: () => blob(a.content) })),
      getThread: () => ({ getId: () => 'synthetic-thread', getMessages: () => { state.siblingReads++; throw Error('sibling read'); } }),
      getSubject: () => state.subject || 'Synthetic statement', getFrom: () => 'sender@example.invalid', getTo: () => state.actor,
      getDate: () => new Date('2026-01-01T00:00:00Z') }; }, search: () => { throw Error('broad search'); } },
    DriveApp: { getFolderById: () => ({ getFiles: () => { const values = (state.hideFiles ? [] : Object.values(state.files)).filter(f => f.folder !== 'elsewhere').map(file); let i = 0;
      return { hasNext: () => i < values.length, next: () => values[i++] }; } }),
      getFileById: fid => { assert.ok(state.files[fid]); return file(state.files[fid]); } },
    UrlFetchApp: { fetch: (url, options) => {
      let code = 200, response;
      if (url.includes('generateIds')) { fail('allocate:before'); response = { ids: ['reserved-' + (++state.allocated)] }; }
      else if (url.includes('upload/')) {
        assert.equal(state.locked, true); fail('file:before');
        const body = Buffer.from(options.payload), text = body.toString();
        const jsonStart = text.indexOf('\r\n\r\n') + 4, jsonEnd = text.indexOf('\r\n--', jsonStart);
        const metadata = JSON.parse(text.slice(jsonStart, jsonEnd));
        const checkpoint = JSON.parse(state.props['AURORA_GMAIL_ITEM_' + metadata.appProperties.auroraReplayKey]);
        assert.equal(checkpoint.fileId, metadata.id);
        const mediaStart = body.indexOf('\r\n\r\n', jsonEnd) + 4;
        const bytes = body.subarray(mediaStart, body.lastIndexOf('\r\n--'));
        assert.equal(sha(bytes), metadata.appProperties.sha256);
        state.uploads.push(metadata);
        if (state.files[metadata.id]) code = 409;
        else { state.files[metadata.id] = { id: metadata.id, name: metadata.name, mime: metadata.mimeType, bytes }; state.writes.push('file'); }
        response = { id: metadata.id }; state.hideFiles=0; fail('file:after');
      } else {
        if (state.readFailure) { code = state.readFailure; response = {}; }
        else { const fid = decodeURIComponent(url.match(/files\/([^?]+)/)[1]); const hidden = !!state.hideFiles; response = state.files[fid] && !hidden ? { id: fid, trashed: !!state.files[fid].trashed } : {}; code = state.files[fid] && !hidden ? 200 : 404; if (hidden) state.hideFiles--;  }
      }
      return { getResponseCode: () => code, getContentText: () => JSON.stringify(response) };
    } }
  };
  function runtime() { const ctx = vm.createContext(extra);
    for (const source of ['00_CORE_WMGJ.gs','01_PIPELINE_CONFIABILIDADE_WMGJ.gs','04_EXTRACAO_DOCUMENTAL_WMGJ.gs','09_INDEXADOR_GMAIL_FATURAMENTO_WMGJ.gs','09B_BUSCA_GMAIL_AMPLA_WMGJ.gs','09C_DIAGNOSTICO_INGESTAO_GMAIL_WMGJ.gs','09D_REPLAY_MENSAGEM_GMAIL_WMGJ.gs','13_TRAVA_CONCORRENCIA_WATCHDOG_WMGJ.gs']) {
      vm.runInContext(fs.readFileSync(path.join(root,'src',source),'utf8'), ctx, { filename: source });
    } return ctx;
  }
  let ctx = runtime(); state.index.push(Array.from(ctx.cabecalhoCanonicoIndiceGmailWMGJ_()));
  function dry() { return ctx.replayMensagemGmailWMGJ(id); }
  function authorize(result = dry()) { state.props.AURORA_GMAIL_REPLAY_AUTHORIZATION = JSON.stringify({ actor: state.actor, messageId: id,
    manifestHash: result.manifestHash, dataClassification: 'INTERNAL', expiresAt: new Date(Date.now()+3600000).toISOString() }); return result.manifestHash; }
  function run(hash) { return ctx.replayMensagemGmailWMGJ(id, { dryRun: false, expectedManifestHash: hash }); }
  return { state, dry, authorize, run, ctx: () => ctx, restart: () => { ctx = runtime(); }, seed: (a=attachments[0], fid='legacy-file') => {
    state.files[fid] = { id: fid, name: a.name, mime: a.mime, bytes: Buffer.from(a.content) }; return fid;
  } };
}
function counts(f) { return [Object.keys(f.state.files).length, f.state.index.length-1, f.state.queue.length-1]; }
test('default dry-run is exact-message, SHA-256 and zero writes or pipeline effects', () => {
  const f = fixture(), result = f.dry();
  assert.equal(result.mode,'DRY_RUN'); assert.equal(result.replayExecuted,false);
  assert.deepEqual(f.state.selected,[id]); assert.equal(f.state.siblingReads,0);
  assert.deepEqual(f.state.writes,[]); assert.equal(f.state.allocated,0);
  assert.equal(result.manifest.attachments.find(a=>a.name==='statement.pdf').sha256, sha(attachments[0].content));
});
test('execute and repeat across fresh runtimes keep exactly two files/index/queue receipts', () => {
  const f=fixture(), hash=f.authorize(); const result=f.run(hash);
  assert.deepEqual(counts(f),[2,2,2]); assert.equal(result.pipelineExecuted,false); assert.equal(result.financialRecognition,false);
  f.restart(); const repeat=f.run(hash); assert.deepEqual(counts(f),[2,2,2]);
  assert.ok(repeat.receipts.every(r=>!r.changed && r.receipts.file && r.receipts.index && r.receipts.queue));
  assert.ok(f.state.index.slice(1).every(r=>r[17]==='' && r[19]===''));
});
for (const point of ['allocate:before','file:before','file:after','index:before','index:after','queue:before','queue:after',
  'stage:STARTED','stage:FILE_RESERVED','stage:FILE_VERIFIED','stage:INDEX_VERIFIED','stage:COMPLETE','property:before','property:after','flush']) {
  test('restart recovers ambiguous/partial write at '+point,()=>{
    const f=fixture(), hash=f.authorize(); f.state.failures[point]=true;
    assert.throws(()=>f.run(hash)); assert.equal(f.state.locked,false);
    f.restart(); f.run(hash); f.restart(); f.run(hash); assert.deepEqual(counts(f),[2,2,2]);
    const ledgers=Object.entries(f.state.props).filter(([k])=>k.startsWith('AURORA_GMAIL_ITEM_')).map(([,v])=>JSON.parse(v));
    assert.ok(ledgers.every(s=>s.stage==='COMPLETE' && s.receipts.file && s.receipts.index && s.receipts.queue));
    assert.ok(!JSON.stringify(ledgers).includes('private content'));
  });
}
test('pre-existing legacy orphan is reused by full content hash before creation',()=>{
  const f=fixture();f.seed();const hash=f.authorize();f.run(hash);assert.deepEqual(counts(f),[2,2,2]);assert.equal(f.state.uploads.length,1);
  assert.ok(f.state.index.some(r=>r[22]==='legacy-file'));
});
test('existing terminal index without queue only repairs missing destination',()=>{
  const f=fixture(), hash=f.authorize(); f.run(hash);f.state.queue.splice(1);f.restart();f.run(hash);assert.deepEqual(counts(f),[2,2,2]);assert.equal(f.state.uploads.length,2);
});
test('same bytes with distinct names reuse one file and queue while preserving both legacy identities',()=>{
  const f=fixture();f.state.attachments[1].content=f.state.attachments[0].content;const hash=f.authorize();f.run(hash);f.restart();f.run(hash);assert.deepEqual(counts(f),[1,2,1]);
});
test('scope/authorization changes and malformed IDs are rejected without writes',()=>{
  for (const mutation of ['missing','expired','actor','hash','scope','content']) {
    const f=fixture(), hash=f.authorize();
    if(mutation==='missing')delete f.state.props.AURORA_GMAIL_REPLAY_AUTHORIZATION;
    if(mutation==='expired'){const a=JSON.parse(f.state.props.AURORA_GMAIL_REPLAY_AUTHORIZATION);a.expiresAt='2000-01-01';f.state.props.AURORA_GMAIL_REPLAY_AUTHORIZATION=JSON.stringify(a);}
    if(mutation==='actor')f.state.actor='other@example.invalid';
    if(mutation==='hash')f.state.props.AURORA_GMAIL_REPLAY_AUTHORIZATION='{}';
    if(mutation==='scope')f.state.props.WMGJ_FIRESTORE_ORG_ID='other-org';
    if(mutation==='content')f.state.attachments[0].content=Buffer.from('changed');
    assert.throws(()=>f.run(hash),/NOT_AUTHORIZED/);assert.deepEqual(f.state.writes,[]);
  }
  const f=fixture();for(const value of [undefined,[],{},'subject:statement','thread:123',''])assert.throws(()=>f.ctx().replayMensagemGmailWMGJ(value),/MESSAGE_ID_INVALIDO/);
  assert.deepEqual(f.state.selected,[]);
});
test('all source and destination conflicts fail closed before writes',()=>{
  for(const issue of ['index','queue','ambiguous','wrong-id','same-identity','formula','limit']){
    const f=fixture();
    if(issue==='index')f.state.index[0][5]='COMPETENCIA';
    if(issue==='queue')f.state.queue[0][2]='WRONG';
    if(issue==='ambiguous'){f.seed();f.seed(attachments[0],'duplicate');}
    if(issue==='wrong-id')f.state.wrongId='1234567890abcdef';
    if(issue==='same-identity')f.state.attachments[1]=f.state.attachments[0];
    if(issue==='formula')f.state.subject='=HYPERLINK("https://example.invalid")';
    if(issue==='limit')f.state.attachments[0].content=Buffer.alloc(5*1024*1024+1);
    assert.throws(()=>f.dry());assert.deepEqual(f.state.writes,[]);
  }
});
test('hash drift, missing acknowledged files, and read failures never create a replacement',()=>{
  for(const kind of ['hash','missing','trashed','403','503']){
    const f=fixture(), hash=f.authorize();f.run(hash);f.state.writes=[];
    const fid=Object.keys(f.state.files)[0];
    if(kind==='hash')f.state.files[fid].bytes=Buffer.from('tampered');
    if(kind==='missing')delete f.state.files[fid];
    if(kind==='trashed')f.state.files[fid].trashed=true;
    if(['403','503'].includes(kind))f.state.readFailure=Number(kind);
    assert.throws(()=>f.run(hash));assert.deepEqual(f.state.writes,[]);assert.equal(f.state.uploads.length,2);
  }
});
test('every Gmail writer and queue producer shares the lock and nested calls preserve ownership',()=>{
  const f=fixture();f.state.locked=true;
  for(const fn of ['replayMensagemGmailWMGJ','indexarGmailFaturamentoWMGJ','indexarGmailFaturamentoWMGJ_V2','importarGmailWMGJ','enfileirarArquivosEntradaWMGJ_V3','prepararPipelineConfiavelWMGJ_Local_']) {
    assert.throws(()=>f.ctx()[fn](id),/LOCK_BUSY/);
  }
  assert.deepEqual(f.state.writes,[]);assert.deepEqual(f.state.selected,[]);
  f.state.owned=true;f.dry();assert.equal(f.state.locked,true);
});
test('a replay reservation is durable and makes legacy Gmail writers yield the exact message',()=>{
  const f=fixture(),hash=f.authorize();f.state.failures['file:after']=true;assert.throws(()=>f.run(hash));f.restart();
  assert.equal(f.ctx().mensagemReservadaReplayGmailWMGJ_(id),true);
  assert.equal(f.ctx().mensagemReservadaReplayGmailWMGJ_('1234567890abcdef'),false);
  for(const name of ['00_CORE_WMGJ.gs','09_INDEXADOR_GMAIL_FATURAMENTO_WMGJ.gs','09B_BUSCA_GMAIL_AMPLA_WMGJ.gs']){
    assert.match(fs.readFileSync(path.join(root,'src',name),'utf8'),/mensagemReservadaReplayGmailWMGJ_\(/);
  }
});
test('ambiguous upload followed by delayed visibility retries the SAME reserved ID (409)',()=>{
  const f=fixture(), hash=f.authorize();f.state.failures['file:after']=true;assert.throws(()=>f.run(hash));
  f.restart();f.state.hideFiles=100;f.run(hash);f.restart();f.run(hash);
  assert.deepEqual(counts(f),[2,2,2]);assert.equal(f.state.allocated,2);
  assert.equal(f.state.uploads[0].id,f.state.uploads[1].id);
});
test('legacy error/partial history is preserved, success is appended only once',()=>{
  const f=fixture(), dry=f.dry(), item=dry.manifest.attachments[0], r=Array(25).fill('');
  Object.assign(r,{0:new Date(),1:'v1.1.7-indexador-gmail-faturamento',2:'ERRO',5:id,9:item.name,12:item.legacyKey.split('|').at(-1)});
  f.state.index.push(r);const hash=f.authorize(dry);f.run(hash);f.restart();f.run(hash);
  assert.deepEqual(counts(f),[2,3,2]);assert.equal(f.state.index[1][2],'ERRO');
});
test('duplicate or mismatched queue/index entries stay blocked and preserved',()=>{
  for(const kind of ['queue-duplicate','queue-version','index-duplicate','ignored']){
    const f=fixture(),hash=f.authorize();f.run(hash);f.state.writes=[];
    if(kind==='queue-duplicate')f.state.queue.push([...f.state.queue[1]]);
    if(kind==='queue-version')f.state.queue[1][9]='SHA256='+'0'.repeat(64);
    if(kind==='index-duplicate')f.state.index.push([...f.state.index[1]]);
    if(kind==='ignored'){f.state.index[1][2]='IGNORADO_NAO_PERTINENTE';f.state.index[1][22]='';}
    assert.throws(()=>f.run(hash),/CONFLICT|REQUIRES_REVIEW/);assert.deepEqual(f.state.writes,[]);
  }
});
test('persisted identity/checkpoint corruption and sensitive or absent classifications fail closed',()=>{
  for(const kind of ['checkpoint','scope','classification']){
    const f=fixture(),hash=f.authorize();f.run(hash);f.state.writes=[];
    if(kind==='checkpoint'){const key=Object.keys(f.state.props).find(k=>k.startsWith('AURORA_GMAIL_ITEM_')); const s=JSON.parse(f.state.props[key]);s.sha256='0'.repeat(64);f.state.props[key]=JSON.stringify(s);}
    if(kind==='scope')f.state.props.WMGJ_PASTA_ENTRADA_ID='changed-folder';
    if(kind==='classification'){const a=JSON.parse(f.state.props.AURORA_GMAIL_REPLAY_AUTHORIZATION);a.dataClassification='CLINICAL_SENSITIVE';f.state.props.AURORA_GMAIL_REPLAY_AUTHORIZATION=JSON.stringify(a);}
    assert.throws(()=>f.run(hash));assert.deepEqual(f.state.writes,[]);
  }
});
test('watchdog and nested writer share one cached lock object, never releasing the outer lock',()=>{
  const f=fixture();const lock=f.ctx().obterTravaIngestaoGmailWMGJ_();assert.equal(lock.tryLock(),true);
  assert.equal(f.ctx().obterTravaIngestaoGmailWMGJ_(),lock);f.dry();assert.equal(f.state.locked,true);lock.releaseLock();
  assert.match(fs.readFileSync(path.join(root,'src/13_TRAVA_CONCORRENCIA_WATCHDOG_WMGJ.gs'),'utf8'),/var lock = obterTravaIngestaoGmailWMGJ_\(\)/);
});

test('completed first attachment stays idempotent while second attachment resumes',()=>{
  const f=fixture(),hash=f.authorize();f.state.failures['file:after']=2;assert.throws(()=>f.run(hash));
  assert.deepEqual(counts(f),[2,1,1]);f.restart();f.run(hash);f.restart();f.run(hash);assert.deepEqual(counts(f),[2,2,2]);
});

test('legacy import leaves replay-reserved messages and thread labels untouched',()=>{
  const f=fixture(),hash=f.authorize();f.run(hash);f.state.writes=[];const ctx=f.ctx();let mutations=0;
  ctx.getConfigWMGJ_=()=>({SHEETS:{FILA:'queue',MEMORIA:'memory'},GMAIL:{IMPORTAR:'import',PROCESSADO:'processed'}});
  ctx.garantirLabelsGmail_=()=>{};ctx.getPlanilha=()=>({});ctx.obterOuCriarAba_=()=>({appendRow:()=>{mutations++;}});
  ctx.carregarIds_=()=>new Set();ctx.registrarLogWMGJ_=()=>{};
  ctx.GmailApp.getUserLabelByName=()=>({getThreads:()=>[{getMessages:()=>[{getId:()=>id}],removeLabel:()=>{mutations++;}}]});
  assert.equal(ctx.importarGmailWMGJ().importados,0);assert.equal(mutations,0);assert.deepEqual(f.state.writes,[]);
});
