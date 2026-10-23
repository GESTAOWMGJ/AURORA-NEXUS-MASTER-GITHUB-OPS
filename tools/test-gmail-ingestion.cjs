const test = require('node:test');
require('./test-gmail-sanitized-status.cjs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function runtime(extra = {}) {
  const ctx = vm.createContext({ Date, LockService: { getScriptLock: () => ({ hasLock: () => false, tryLock: () => true, releaseLock() {} }) }, SpreadsheetApp: { flush() {} }, ...extra });
  for (const file of ['09_INDEXADOR_GMAIL_FATURAMENTO_WMGJ.gs', '09B_BUSCA_GMAIL_AMPLA_WMGJ.gs', '09C_DIAGNOSTICO_INGESTAO_GMAIL_WMGJ.gs', '09D_REPLAY_MENSAGEM_GMAIL_WMGJ.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), ctx);
  }
  return ctx;
}
function row(status = 'COPIADO_BRUTO_A_CLASSIFICAR_V2', file = 'synthetic-file') {
  const r = Array(25).fill('');
  Object.assign(r, { 0: new Date('2026-09-01T12:00:00Z'), 1: 'v1.1.7-indexador-gmail-faturamento',
    2: status, 5: 'abcdef1234567890', 9: 'statement.pdf', 12: 'synthetic-hash', 22: file });
  return r;
}
function sheet(data) {
  return { getLastRow: () => data.length, getDataRange: () => ({ getValues: () => data }) };
}
test('mixed header never turns VERSION into message identity and blocks writes', () => {
  const ctx = runtime(), header = Array.from(ctx.cabecalhoCanonicoIndiceGmailWMGJ_());
  header[1] = 'MESSAGE_ID'; header[5] = 'COMPETENCIA';
  const data = [header, row(), row()];
  const result = ctx.inspecionarIndiceGmailWMGJ_(data);
  assert.equal(result.schemaCompativel, false);
  assert.equal(result.registros[0].messageId, 'abcdef1234567890');
  assert.equal(result.chavesRepetidas, 1);
  assert.throws(() => ctx.carregarChavesGmailJaIndexadasWMGJ_(sheet(data)), /SCHEMA_MISMATCH/);
});
test('historical overlays remain explicit even if someone only restores the header', () => {
  const ctx = runtime(), overlay = row();
  overlay[1] = 'abcdef1234567890'; overlay[5] = '2026-08';
  const result = ctx.inspecionarIndiceGmailWMGJ_([ctx.cabecalhoCanonicoIndiceGmailWMGJ_(), overlay]);
  assert.equal(result.schemaCompativel, false);
  assert.deepEqual(Array.from(result.linhasNaoReconhecidas), [2]);
});
test('terminal records deduplicate while errors and copied-without-file remain retriable', () => {
  const ctx = runtime(), success = row();
  const error = row('ERRO', ''); error[9] = 'retry.pdf';
  const partial = row('COPIADO_BRUTO_A_CLASSIFICAR', ''); partial[9] = 'partial.pdf';
  const ignored = row('IGNORADO_NAO_PERTINENTE_V2', ''); ignored[9] = 'ignored.pdf';
  const missingHash = row('ERRO', ''); missingHash[12] = '';
  const map = ctx.carregarChavesGmailJaIndexadasWMGJ_(sheet([ctx.cabecalhoCanonicoIndiceGmailWMGJ_(), success, error, partial, ignored, missingHash]));
  assert.equal(Object.keys(map).length, 2);
  assert.equal(map['abcdef1234567890|statement.pdf|synthetic-hash'], true);
  assert.equal(map['abcdef1234567890|ignored.pdf|synthetic-hash'], true);
});
test('both indexers stop on incompatible schema before accessing Drive or Gmail', () => {
  let writes = 0;
  const bad = sheet([['DATA_IMPORTACAO', 'MESSAGE_ID'], row()]);
  const ctx = runtime({ getPlanilha: () => ({ getSheetByName: () => bad }),
    DriveApp: { getFolderById: () => { writes++; throw Error('unexpected'); } },
    GmailApp: { search: () => { writes++; throw Error('unexpected'); } } });
  for (const fn of [ctx.indexarGmailFaturamentoWMGJ, ctx.indexarGmailFaturamentoWMGJ_V2]) {
    assert.throws(() => fn({}), /SCHEMA_MISMATCH/);
  }
  assert.equal(writes, 0);
});
test('single-message diagnostic reads exact ID, hashes bytes, and performs no source mutations', () => {
  let selected = [], attachments = 0;
  const bytes = Buffer.from('%PDF synthetic fixture');
  const ctx = runtime({
    getPlanilha: () => ({ getId: () => 'synthetic-sheet', getSheetByName: () => sheet([ctx.cabecalhoCanonicoIndiceGmailWMGJ_()]) }),
    GmailApp: { getMessageById: id => { selected.push(id); return { getId: () => id,
      getAttachments: () => { attachments++; return [{ getName: () => 'statement.pdf', getContentType: () => 'application/pdf', copyBlob: () => ({ getBytes: () => [...bytes] }) }]; } }; } },
    ScriptApp: { getProjectTriggers: () => [] },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (a, b) => [...crypto.createHash(a).update(Buffer.from(b)).digest()], base64EncodeWebSafe: b => Buffer.from(b).toString('base64url') }
  });
  const result = ctx.diagnosticarMensagemGmailWMGJ('abcdef1234567890');
  assert.deepEqual(selected, ['abcdef1234567890']);
  assert.equal(attachments, 1);
  assert.equal(result.anexos[0].sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.replayExecutado, false);
  assert.equal(result.podeExecutarReplay, false);
  assert.equal(result.anexos[0].estado, 'AUSENTE_NO_INDICE_VERIFICAR_DRIVE');
});
test('diagnostic rejects a query, thread selector or missing ID before any read', () => {
  const ctx = runtime();
  for (const value of [undefined, {}, 'subject:statement', 'thread:any', '']) {
    assert.throws(() => ctx.diagnosticarMensagemGmailWMGJ(value), /MESSAGE_ID_INVALIDO/);
  }
});

test('canonical layout still blocks multiple destinations without choosing or modifying a file', () => {
  const ctx = runtime(), first = row(), second = row('COPIADO_BRUTO_A_CLASSIFICAR_V2', 'other-file');
  const data = [Array.from(ctx.cabecalhoCanonicoIndiceGmailWMGJ_()), first, first.slice(), second];
  const before = JSON.stringify(data);
  const result = ctx.inspecionarIndiceGmailWMGJ_(data);
  assert.equal(result.schemaCompativel, true);
  assert.equal(result.chavesDistintas, 1);
  assert.equal(result.repeticoesAlemPrimeira, 2);
  assert.equal(result.conflitosDestino.length, 1);
  assert.deepEqual(Array.from(result.conflitosDestino[0].linhas), [2, 3, 4]);
  assert.deepEqual(Array.from(result.conflitosDestino[0].arquivos), ['synthetic-file', 'other-file']);
  assert.throws(() => ctx.carregarChavesGmailJaIndexadasWMGJ_(sheet(data)), /DESTINATION_CONFLICT/);
  assert.equal(JSON.stringify(data), before);
});
test('both indexers block conflicting destinations before Drive or Gmail access', () => {
  let externalCalls = 0;
  const ctx = runtime({
    DriveApp: { getFolderById() { externalCalls++; throw Error('unexpected Drive read'); } },
    GmailApp: { search() { externalCalls++; throw Error('unexpected Gmail read'); } }
  });
  const data = [ctx.cabecalhoCanonicoIndiceGmailWMGJ_(), row(), row('COPIADO_BRUTO_A_CLASSIFICAR', 'other-file')];
  ctx.getPlanilha = () => ({ getSheetByName: () => sheet(data) });
  for (const fn of [ctx.indexarGmailFaturamentoWMGJ, ctx.indexarGmailFaturamentoWMGJ_V2]) {
    assert.throws(() => fn({}), /DESTINATION_CONFLICT/);
  }
  assert.equal(externalCalls, 0);
});
test('repeated same destination stays idempotent and distinct messages or versions are not collapsed', () => {
  const ctx = runtime(), first = row(), otherMessage = row(), otherVersion = row();
  otherMessage[5] = 'fedcba0987654321';
  otherVersion[12] = 'different-content-hash';
  const data = [ctx.cabecalhoCanonicoIndiceGmailWMGJ_(), first, first.slice(), otherMessage, otherVersion];
  const result = ctx.exigirContratoIndiceGmailWMGJ_(sheet(data));
  assert.equal(result.conflitosDestino.length, 0);
  assert.equal(result.chavesDistintas, 3);
  assert.equal(result.repeticoesAlemPrimeira, 1);
  assert.equal(Object.keys(ctx.carregarChavesGmailJaIndexadasWMGJ_(sheet(data))).length, 3);
});
test('diagnostic reports conflicts even when historical overlays independently block the schema', () => {
  const ctx = runtime(), overlay = row(); overlay[1] = 'legacy-layout';
  const data = [['legacy-header'], overlay, row(), row('ERRO', 'other-file')];
  const result = ctx.inspecionarIndiceGmailWMGJ_(data);
  assert.equal(result.schemaCompativel, false);
  assert.deepEqual(Array.from(result.linhasNaoReconhecidas), [2]);
  assert.equal(result.conflitosDestino.length, 1);
  assert.deepEqual(Array.from(result.conflitosDestino[0].linhas), [3, 4]);
  assert.throws(() => ctx.exigirContratoIndiceGmailWMGJ_(sheet(data)), /SCHEMA_MISMATCH/);
});

// Register the Drive first-cycle regressions in the existing ingestion CI gate.
require('./test-gmail-drive-onboarding.cjs');
require('./test-gmail-connector-status.cjs');
