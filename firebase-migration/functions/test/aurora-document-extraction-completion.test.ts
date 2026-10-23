import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../../src/04_EXTRACAO_DOCUMENTAL_WMGJ.gs", import.meta.url), "utf8");

function sheetFixture(name: string, values: string[][]) {
  return {
    getName: () => name,
    getLastRow: () => values.length,
    getLastColumn: () => Math.max(0, ...values.map(row => row.length)),
    getRange: (startRow: number, startColumn: number, rowCount: number, columnCount: number) => {
      for (const value of [startRow, startColumn, rowCount, columnCount]) assert.ok(Number.isSafeInteger(value) && value > 0);
      return { getDisplayValues: () => Array.from({ length: rowCount }, (_, r) =>
        Array.from({ length: columnCount }, (_, c) => values[startRow - 1 + r]?.[startColumn - 1 + c] ?? "")) };
    },
    getDataRange: () => ({ getDisplayValues: () => values.map(row => row.slice()) })
  };
}

function sandbox(): any {
  const context: any = {
    MimeType: { GOOGLE_DOCS: "application/vnd.google-apps.document", GOOGLE_SHEETS: "application/vnd.google-apps.spreadsheet",
      PLAIN_TEXT: "text/plain", PDF: "application/pdf" },
    DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => "Conteúdo sintético autorizado" }) }) },
    SpreadsheetApp: { openById: () => ({ getSheets: () => [sheetFixture("Dados",
      [["referencia", "competencia"], ["SYNTHETIC", "2026-10"]])] }) },
    Utilities: { sleep() {} },
    DriveApp: { getFileById: () => ({ setTrashed() {} }) }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function file(mime: string, id = "synthetic-document") {
  return { getMimeType: () => mime, getId: () => id, getName: () => "documento-sintetico",
    getBlob: () => ({ getDataAsString: () => "Conteúdo sintético autorizado" }) };
}

test("existing Docs, Sheets, text, CSV and JSON extractors require real nonempty content", () => {
  const ctx = sandbox();
  for (const [mime, method] of [
    [ctx.MimeType.GOOGLE_DOCS, "google_docs_text"], [ctx.MimeType.GOOGLE_SHEETS, "google_sheets_values"],
    ["text/plain", "blob_text"], ["text/csv", "blob_text"], ["application/json", "blob_text"]
  ]) {
    const result = ctx.extrairConteudoArquivoWMGJ_V1_(file(mime));
    assert.equal(result.metodo, method);
    assert.equal(ctx.extracaoDocumentalCompletaWMGJ_(result), true);
  }
});

test("PDF, image and Office reuse the existing Drive conversion instead of metadata as proof", () => {
  const ctx = sandbox();
  const calls: any[] = [];
  let trashed = 0;
  ctx.Drive = { Files: { copy(resource: any, id: string, options: any) {
    calls.push({ resource, id, options }); return { id: "synthetic-temporary-conversion" };
  } } };
  ctx.DriveApp = { getFileById: () => ({ setTrashed(value: boolean) { if (value) trashed++; } }) };
  const formats = ["application/pdf", "image/png", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
  for (const mime of formats) {
    const result = ctx.extrairConteudoArquivoWMGJ_V1_(file(mime));
    assert.equal(result.metodo, "drive_api_ocr_convert");
    assert.equal(ctx.extracaoDocumentalCompletaWMGJ_(result), true);
  }
  assert.equal(calls.length, formats.length);
  assert.ok(calls.every(call => call.options.ocr === true && call.options.ocrLanguage === "pt"));
  assert.equal(trashed, formats.length);
});

test("missing conversion, service errors, unknown formats and empty content remain pending extraction", () => {
  const ctx = sandbox();
  for (const mime of ["application/pdf", "image/png", "application/octet-stream"]) {
    const result = ctx.extrairConteudoArquivoWMGJ_V1_(file(mime));
    assert.equal(result.ok, false);
    assert.equal(ctx.extracaoDocumentalCompletaWMGJ_(result), false);
  }
  ctx.DocumentApp = { openById() { throw new Error("synthetic unavailable"); } };
  assert.equal(ctx.extracaoDocumentalCompletaWMGJ_(ctx.extrairConteudoArquivoWMGJ_V1_(file(ctx.MimeType.GOOGLE_DOCS))), false);
  ctx.DocumentApp = { openById: () => ({ getBody: () => ({ getText: () => "   " }) }) };
  assert.equal(ctx.extracaoDocumentalCompletaWMGJ_(ctx.extrairConteudoArquivoWMGJ_V1_(file(ctx.MimeType.GOOGLE_DOCS))), false);
  ctx.SpreadsheetApp = { openById: () => ({ getSheets: () => [sheetFixture("Empty", [["", " "]])] }) };
  assert.equal(ctx.extrairTextoGoogleSheetsWMGJ_V1_("synthetic-sheet"), "");
  assert.equal(ctx.extracaoDocumentalCompletaWMGJ_(ctx.extrairConteudoArquivoWMGJ_V1_(file(ctx.MimeType.GOOGLE_SHEETS))), false);
  for (const result of [null, { ok: true, metodo: "metadata_fallback", texto: "metadata", tamanhoTexto: 8 },
    { ok: true, metodo: "blob_text", texto: "text", tamanhoTexto: 100 },
    { ok: false, metodo: "blob_text", texto: "text", tamanhoTexto: 4 },
    { ok: true, metodo: "unregistered_adapter", texto: "text", tamanhoTexto: 4 }]) {
    assert.equal(ctx.extracaoDocumentalCompletaWMGJ_(result), false);
  }
});

test("Sheets emits headers only for real content and includes every nonempty tab beyond row 200", () => {
  const ctx = sandbox();
  const lateTable = Array.from({ length: 201 }, (_, index) => index === 200 ? ["linha201", "42"] : ["", " "]);
  ctx.SpreadsheetApp = { openById: () => ({ getSheets: () => [
    sheetFixture("Empty", []), sheetFixture("Whitespace", [["", " "]]),
    sheetFixture("Late", lateTable), sheetFixture("Dados", [["referencia", "competencia"], ["SYNTHETIC", "2026-10"]])
  ] }) };
  const result = ctx.extrairConteudoArquivoWMGJ_V1_(file(ctx.MimeType.GOOGLE_SHEETS));
  assert.equal(ctx.extracaoDocumentalCompletaWMGJ_(result), true);
  assert.equal(result.texto, "ABA: Late\nlinha201 | 42\nABA: Dados\nreferencia | competencia\nSYNTHETIC | 2026-10");
  assert.equal(result.tamanhoTexto, result.texto.length);
});

test("queue continues other documents but never classifies, mirrors or completes a metadata fallback; retry resumes", () => {
  const ctx = sandbox();
  const headers = ["STATUS", "ID_ORIGEM", "ORIGEM", "TENTATIVAS", "OBSERVACAO", "DATA_ENTRADA"];
  const rows = [["PENDENTE", "synthetic-pdf", "DRIVE", 0, "", ""],
    ["PENDENTE", "synthetic-text", "DRIVE", 0, "", ""]];
  const queue = { getLastRow: () => rows.length + 1, getDataRange: () => ({ getValues: () => [headers, ...rows] }) };
  const memory = new Set<string>();
  const classified: string[] = [], mirrored: string[] = [];
  ctx.garantirAbasControleExtracaoWMGJ_V1_ = () => {};
  ctx.garantirAbaExtracoesDocumentaisWMGJ_V1_ = () => {};
  ctx.getConfigWMGJ_Compat_ = () => ({ SHEETS: { FILA: "queue", MEMORIA: "memory" } });
  ctx.getPlanilhaWMGJ_Compat_ = () => ({ getSheetByName: (name: string) => name === "queue" ? queue : {} });
  ctx.mapearCabecalhoWMGJ_Compat_ = () => Object.fromEntries(headers.map((name, index) => [name, index]));
  ctx.atualizarLinhaFilaWMGJ_Compat_ = (_queue: any, row: number, index: any, fields: any) => {
    for (const [name, value] of Object.entries(fields)) if (name in index) (rows[row - 2] as any)[index[name]] = value;
  };
  ctx.DriveApp = { getFileById: (id: string) => id.startsWith("synthetic-temporary")
    ? { setTrashed() {} } : file(id.endsWith("pdf") ? "application/pdf" : "text/plain", id) };
  ctx.gerarHashArquivoWMGJ_Compat_ = () => "a".repeat(64);
  ctx.documentoJaProcessadoWMGJ_Compat_ = (id: string) => memory.has(id);
  ctx.firestoreMirrorObrigatorioWMGJ_ = () => true;
  ctx.firestoreMirrorJaConfirmadoWMGJ_ = (id: string) => mirrored.includes(id);
  ctx.registrarExtracaoDocumentalWMGJ_V1_ = () => {};
  ctx.classificarDocumentoGeminiOuFallbackWMGJ_V1_ = (_extraction: any, document: any) => {
    classified.push(document.getId()); return { categoria: "outro" };
  };
  ctx.validarDocumentoJsonWMGJ_Compat_ = (dados: any) => ({ ok: true, dados });
  ctx.espelharDocumentoProcessadoFirestoreWMGJ_ = (document: any) => {
    mirrored.push(document.getId()); return { ok: true, required: true, status: "ACCEPTED" };
  };
  ctx.registrarFirestoreMirrorWMGJ_ = () => {};
  ctx.registrarDocumentoMemoriaWMGJ_Compat_ = (_memory: any, document: any) => memory.add(document.idOrigem);
  ctx.montarResumoMemoriaExtracaoWMGJ_V1_ = () => "synthetic-summary";
  ctx.registrarLogWMGJ_Compat_ = () => {};
  const first = ctx.processarFilaComExtracaoRealWMGJ_V1(20);
  assert.equal(first.ok, false);
  assert.equal(first.pendentesExtracao, 1);
  assert.equal(first.processados, 1);
  assert.equal(rows[0][0], "ERRO_REPROCESSAR");
  assert.equal(rows[1][0], "PROCESSADO");
  assert.deepEqual(classified, ["synthetic-text"]);
  assert.deepEqual(mirrored, ["synthetic-text"]);
  assert.equal(memory.has("synthetic-pdf"), false);
  ctx.Drive = { Files: { copy: () => ({ id: "synthetic-temporary-conversion" }) } };
  const resumed = ctx.processarFilaComExtracaoRealWMGJ_V1(20);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.pendentesExtracao, 0);
  assert.equal(resumed.processados, 1);
  assert.equal(rows[0][0], "PROCESSADO");
  assert.equal(memory.size, 2);
  const repeated = ctx.processarFilaComExtracaoRealWMGJ_V1(20);
  assert.equal(repeated.processados, 0);
  assert.equal(mirrored.length, 2);
});
