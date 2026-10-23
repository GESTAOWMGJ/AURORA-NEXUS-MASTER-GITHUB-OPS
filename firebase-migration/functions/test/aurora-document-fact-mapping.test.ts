import assert from "node:assert/strict";
import test from "node:test";
import { mapDocumentFactCandidates, documentFactMapperClientSource, type DocumentFactMappingInput } from "../src/auroraDocumentFactMapping.ts";

const namespace = "http://www.portalfiscal.inf.br/nfe";
function base(): DocumentFactMappingInput {
  return { byteSha256: "a".repeat(64), byteLength: 100, extraction: { status: "COMPLETE", textSha256: "b".repeat(64),
    coverage: { totalUnits: 1, processedUnits: 1 } }, xmlLeaves: [], tables: [] };
}
function leaf(path: string, text: string) {
  const names = path.split("/");
  return { path: names, namespaceURI: namespace, namespacePath: names.map(() => namespace), text, locator: "xml/" + names.map(name => name + "[1]").join("/") };
}
function invoice(amount = "100.25", date = "2026-10-19T12:00:00-03:00"): DocumentFactMappingInput {
  return { ...base(), xmlLeaves: [leaf("nfeProc/NFe/infNFe/total/ICMSTot/vNF", amount), leaf("nfeProc/NFe/infNFe/ide/dhEmi", date)] };
}
function bank(rows: string[][] = [["19/10/2026", "CREDITO", "1.234,56", "2.000,00"]]): DocumentFactMappingInput {
  return { ...base(), tables: [{ columns: ["DATA", "TIPO", "VALOR", "SALDO"], rows, rowLocators: rows.map(() => "not-exported") }] };
}

test("NF-e decimal point is preserved as cents, not stripped like a grouping mark", () => {
  const result = mapDocumentFactCandidates(invoice());
  assert.equal(result.status, "HUMAN_REVIEW_REQUIRED");
  assert.deepEqual(result.candidates, [{ ruleId: "AURORA_NFE_TOTAL_V1", kind: "BILLING_INVOICE", amountCents: 10025,
    issueDate: "2026-10-19", issuedAt: "2026-10-19T12:00:00-03:00",
    fieldLocators: { amount: "xmlLeaf:0", date: "xmlLeaf:1" } }]);
  assert.deepEqual(result.warnings, ["INVOICE_IS_NOT_RECEIPT"]);
});

test("missing, ambiguous and invalid amounts never become zero", () => {
  for (const value of ["", "100,25", "1.000.25", "-1.00", "1e3", "100", "NaN", "90071992547409.92"])
    assert.equal(mapDocumentFactCandidates(invoice(value)).status, "INVALID_FACTS", value);
  assert.equal(mapDocumentFactCandidates(invoice("0.00")).candidates[0]?.amountCents, 0);
});

test("all XML ancestors need the official namespace and exact fiscal path", () => {
  const mixed = invoice(); mixed.xmlLeaves[0]!.namespacePath = ["urn:foreign", namespace, namespace, namespace, namespace, namespace];
  assert.equal(mapDocumentFactCandidates(mixed).candidates.length, 0);
  const foreign = invoice(); foreign.xmlLeaves[0]!.namespaceURI = "urn:foreign";
  assert.equal(mapDocumentFactCandidates(foreign).candidates.length, 0);
  const suffix = invoice(); suffix.xmlLeaves[0]!.path = ["arbitrary", "vNF"];
  assert.equal(mapDocumentFactCandidates(suffix).candidates.length, 0);
});

test("duplicate fiscal paths and two possible issue dates require review without candidates", () => {
  const duplicate = invoice(); duplicate.xmlLeaves = [...duplicate.xmlLeaves, duplicate.xmlLeaves[0]!];
  assert.equal(mapDocumentFactCandidates(duplicate).status, "CONFLICTING_FACTS");
  const twoDates = invoice(); twoDates.xmlLeaves = [...twoDates.xmlLeaves, leaf("nfeProc/NFe/infNFe/ide/dEmi", "2026-10-19")];
  assert.equal(mapDocumentFactCandidates(twoDates).status, "CONFLICTING_FACTS");
});

test("value and issue date must come from the same instantiated infNFe and NFe", () => {
  for (const ancestor of ["infNFe", "NFe"]) {
    const input = invoice(); input.xmlLeaves[1]!.locator = input.xmlLeaves[1]!.locator.replace(ancestor + "[1]", ancestor + "[2]");
    const result = mapDocumentFactCandidates(input);
    assert.equal(result.status, "CONFLICTING_FACTS"); assert.equal(result.candidates.length, 0);
  }
  const missing = invoice(); missing.xmlLeaves[1]!.locator = "";
  assert.equal(mapDocumentFactCandidates(missing).candidates.length, 0);
});

test("namespace prefix aliases retain identity without becoming raw exported locators", () => {
  const input = invoice();
  input.xmlLeaves[0]!.locator = "xml/p:nfeProc[1]/q:NFe[1]/r:infNFe[1]/s:total[1]/s:ICMSTot[1]/s:vNF[1]";
  input.xmlLeaves[1]!.locator = "xml/p:nfeProc[1]/q:NFe[1]/r:infNFe[1]/t:ide[1]/t:dhEmi[1]";
  const result = mapDocumentFactCandidates(input);
  assert.equal(result.candidates.length, 1);
  assert.equal(JSON.stringify(result).includes("p:nfeProc"), false);
});

test("dates reject impossible days, current-year inference and invalid timezone offsets", () => {
  for (const value of ["2026-02-29T12:00:00Z", "2024-02-30T12:00:00Z", "2026-10-19T24:00:00Z", "2026-10-19T12:60:00Z",
    "2026-10-19T12:00:00+14:01", "2026-10-19T12:00:00+01:99", "2026-10-19", "19/10"])
    assert.equal(mapDocumentFactCandidates(invoice("100.25", value)).status, "INVALID_FACTS", value);
  assert.equal(mapDocumentFactCandidates(invoice("100.25", "2024-02-29T12:00:00Z")).candidates.length, 1);
});

test("date-only fiscal field remains a date and never invents midnight, service competence or payment", () => {
  const input = invoice(); input.xmlLeaves = [input.xmlLeaves[0]!, leaf("nfeProc/NFe/infNFe/ide/dEmi", "2026-10-19")];
  const candidate = mapDocumentFactCandidates(input).candidates[0]!;
  assert.equal(candidate.kind, "BILLING_INVOICE");
  assert.equal(candidate.kind === "BILLING_INVOICE" && candidate.issuedAt, null);
  assert.equal(Object.hasOwn(candidate, "competence"), false);
  assert.equal(Object.hasOwn(candidate, "paid"), false);
});

test("bank candidates require explicit date, type, value and separate stated balance", () => {
  const result = mapDocumentFactCandidates(bank([["19/10/2026", "DÉBITO", "25,01", "-100,00"]]));
  assert.deepEqual(result.candidates, [{ ruleId: "AURORA_BANK_EXPLICIT_PTBR_V1", kind: "STATEMENT_ENTRY", amountCents: 2501,
    direction: "DEBIT", bookingDate: "2026-10-19", statedBalanceCents: -10000,
    fieldLocators: { amount: "table:0:row:0:column:2", date: "table:0:row:0:column:0", direction: "table:0:row:0:column:1",
      balance: "table:0:row:0:column:3" } }]);
  assert.deepEqual(result.warnings, ["BANK_ENTRY_IS_NOT_REVENUE"]);
});

test("bank mapping does not infer a year, sign, arbitrary numeric column or zero for absent value", () => {
  for (const row of [["19/10", "CREDITO", "1,00", ""], ["31/02/2026", "CREDITO", "1,00", ""],
    ["19/10/2026", "PIX", "1,00", ""], ["19/10/2026", "DEBITO", "-1,00", ""],
    ["19/10/2026", "CREDITO", "", ""], ["19/10/2026", "CREDITO", "1.23,00", ""]])
    assert.equal(mapDocumentFactCandidates(bank([row])).status, "INVALID_FACTS", JSON.stringify(row));
  assert.equal(mapDocumentFactCandidates(bank([["19/10/2026", "CREDITO", "0,00", ""]])).candidates[0]?.amountCents, 0);
});

test("missing balances remain unknown; no balance is derived from turnover", () => {
  const input = bank(); input.tables = [{ columns: ["DATA", "TIPO", "VALOR"], rows: [["19/10/2026", "CREDITO", "1,00"]], rowLocators: ["row"] }];
  const result = mapDocumentFactCandidates(input);
  assert.equal(result.candidates[0]?.kind === "STATEMENT_ENTRY" && result.candidates[0].statedBalanceCents, null);
});

test("ambiguous headers, ragged rows and malformed recognized rows do not produce partial facts", () => {
  const duplicate = bank(); duplicate.tables = [{ columns: ["DATA", "TIPO", "VALOR", "VALOR"], rows: [], rowLocators: [] }];
  assert.equal(mapDocumentFactCandidates(duplicate).status, "CONFLICTING_FACTS");
  assert.equal(mapDocumentFactCandidates(bank([["19/10/2026", "CREDITO", "1,00"]])).status, "INVALID_FACTS");
  assert.equal(mapDocumentFactCandidates(bank([["19/10/2026", "CREDITO", "1,00", ""], ["20/10/2026", "?", "1,00", ""]])).candidates.length, 0);
});

test("every pending or incomplete extraction blocks candidate generation", () => {
  for (const status of ["PARTIAL", "PENDING", "FAILED"]) {
    const input = invoice(); input.extraction.status = status;
    assert.equal(mapDocumentFactCandidates(input).status, "INCOMPLETE_EXTRACTION");
  }
  const short = invoice(); short.extraction.coverage.processedUnits = 0;
  assert.equal(mapDocumentFactCandidates(short).candidates.length, 0);
  const noHash = invoice(); noHash.extraction.textSha256 = null;
  assert.equal(mapDocumentFactCandidates(noHash).candidates.length, 0);
});

test("mapping budget rejects overflow without truncating successful-looking rows", () => {
  const input = bank(Array.from({ length: 129 }, () => ["19/10/2026", "CREDITO", "1,00", ""]));
  const result = mapDocumentFactCandidates(input);
  assert.equal(result.status, "LIMIT_EXCEEDED"); assert.equal(result.candidates.length, 0);
});

test("unrecognized tables remain explicit; arbitrary bank-looking text is not parsed", () => {
  assert.equal(mapDocumentFactCandidates(base()).status, "NO_SUPPORTED_LAYOUT");
  const input = bank(); input.tables = [...input.tables, { columns: ["other"], rows: [["PIX recebido 20/10 1.234,56"]], rowLocators: ["row"] }];
  assert.ok(mapDocumentFactCandidates(input).warnings.includes("UNMAPPED_TABLE_PRESENT"));
});

test("output is minimized, binds representation hashes, preserves input and never grants canonical authority", () => {
  const input = invoice(); input.xmlLeaves = [...input.xmlLeaves, leaf("nfeProc/NFe/infNFe/emit/xNome", "PRIVATE_NAME"),
    leaf("nfeProc/NFe/infNFe/emit/CNPJ", "PRIVATE_TAX_ID")];
  const before = JSON.stringify(input), result = mapDocumentFactCandidates(input), serialized = JSON.stringify(result);
  assert.equal(JSON.stringify(input), before);
  for (const secret of ["PRIVATE_NAME", "PRIVATE_TAX_ID", "not-exported", "sourceVersion", "externalDocumentId"]) assert.equal(serialized.includes(secret), false);
  assert.equal(result.representationByteSha256, input.byteSha256);
  assert.equal(result.extractedTextSha256, input.extraction.textSha256);
  assert.equal(result.reviewRequired, true); assert.equal(result.canonicalPromotionAllowed, false);
  assert.equal(result.nativeReady, false); assert.equal(result.sourceIndependent, false);
});

test("the same compiled factory runs without Node or network and produces the same minimized preview", () => {
  const browserMapper = new Function(documentFactMapperClientSource() + "; return documentFactMapper;")();
  for (const input of [invoice(), bank(), base()]) {
    assert.deepEqual(browserMapper.mapDocumentFactCandidates(input), mapDocumentFactCandidates(input));
  }
  assert.equal(/require\(|process\.|fetch\(/.test(documentFactMapperClientSource()), false);
});
