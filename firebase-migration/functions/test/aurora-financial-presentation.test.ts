import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildFinancialFocus, financialPresentationClient, formatFinancialCents } from "../src/auroraFinancialPresentation.ts";

function fixture() {
  return {
    environment: "SYNTHETIC_FIXTURE", mode: "READ_ONLY",
    projection: {
      competence: "2031-10", completeness: "COMPLETE", state: "VALIDATED",
      financialCents: { glossCents: 24000, receivedCents: 12300, invoicedCents: 45600 },
      dataQuality: { complete: true, sourcePresent: true },
      coverage: { evidencePercent: 100, reconciliationPercent: 100 },
      sources: [{ source: "synthetic-fixture", missing: false, completeness: "COMPLETE" }]
    },
    financialStatus: {
      competence: "2031-11", sourceComplete: true,
      amounts: { overduePayablesCents: 15000, revenueToCashGapCents: 39000 }
    }
  };
}

test("money rejects absence, coercible values, nonfinite and noncanonical cents", () => {
  for (const value of [null, undefined, "", "0", "15000", false, true, [], [100], {}, NaN,
    Infinity, -Infinity, 1.5, -1.5, Number.MAX_SAFE_INTEGER + 1, 0n]) {
    assert.equal(formatFinancialCents(value), "Sem fonte", String(value));
  }
});

test("known zero and signed balances remain valid, including negative fractions of a real", () => {
  assert.equal(formatFinancialCents(0), "R$\u00a00,00");
  assert.equal(formatFinancialCents(-0), "R$\u00a00,00");
  assert.equal(formatFinancialCents(15001), "R$\u00a0150,01");
  assert.equal(formatFinancialCents(-15001), "-R$\u00a0150,01");
  assert.equal(formatFinancialCents(-1), "-R$\u00a00,01");
});

test("maximum safe integer cents keep the exact final cent in both signs", () => {
  assert.equal(formatFinancialCents(Number.MAX_SAFE_INTEGER), "R$\u00a090.071.992.547.409,91");
  assert.equal(formatFinancialCents(-Number.MAX_SAFE_INTEGER), "-R$\u00a090.071.992.547.409,91");
});

test("overdue obligations outrank glosas and cash gap without aggregating exposures", () => {
  const result = buildFinancialFocus(fixture());
  assert.equal(result.tone, "danger");
  assert.equal(result.title, "Contas vencidas não esperam.");
  assert.equal(result.amountCents, 15000);
  assert.equal(result.period, "Competência 11/2031");
  assert.equal(result.nextHref, "#monthly-closing-summary");
  assert.equal(result.coverageIncomplete, false);
});

test("glosas follow overdue obligations and preserve their own projection competence", () => {
  const data = fixture(); data.financialStatus.amounts.overduePayablesCents = 0;
  const result = buildFinancialFocus(data);
  assert.equal(result.tone, "warn");
  assert.equal(result.title, "Receita em disputa.");
  assert.equal(result.amountCents, 24000);
  assert.equal(result.period, "Competência 10/2031");
  assert.equal(result.nextHref, "#gloss-summary");
  assert.match(result.explanation, /não comprova perda definitiva nem recuperação/);
});

test("cash gap is the canonical forecast versus balance, never invoiced minus received", () => {
  const data = fixture(); data.financialStatus.amounts.overduePayablesCents = 0; data.projection.financialCents.glossCents = 0;
  const result = buildFinancialFocus(data);
  assert.equal(result.title, "Faturar ainda não é receber.");
  assert.equal(result.amountCents, 39000);
  assert.notEqual(result.amountCents, data.projection.financialCents.invoicedCents - data.projection.financialCents.receivedCents);
  assert.match(result.explanation, /receita prevista e saldo do fechamento/);
  assert.match(result.explanation, /Não representa perda confirmada/);
});

test("invalid and signed risk amounts do not fabricate a positive priority", () => {
  for (const invalid of [null, undefined, "", false, [], NaN, Infinity, 1.5, -10, Number.MAX_SAFE_INTEGER + 1]) {
    const data: any = fixture();
    data.financialStatus.amounts.overduePayablesCents = invalid;
    data.projection.financialCents.glossCents = invalid;
    data.financialStatus.amounts.revenueToCashGapCents = invalid;
    const result = buildFinancialFocus(data);
    assert.equal(result.tone, "neutral", String(invalid));
    assert.equal(result.amountCents, null);
    assert.match(result.explanation, /não comprova ausência de obrigações ou perdas/);
  }
});

test("known zero and completely missing sources both use a neutral summary without claiming zero risk", () => {
  const data = fixture(); data.financialStatus.amounts.overduePayablesCents = 0;
  data.projection.financialCents.glossCents = 0; data.financialStatus.amounts.revenueToCashGapCents = 0;
  for (const input of [data, null, undefined, [], {}, { projection: { financialCents: {} } }]) {
    const result = buildFinancialFocus(input);
    assert.equal(result.tone, "neutral"); assert.equal(result.amountCents, null);
    assert.doesNotMatch(result.title + result.label + result.explanation, /sem perdas|risco zero|R\$\s*0/);
  }
});

test("partial, invalid, missing and unknown coverage require completing sources before deciding", () => {
  for (const change of [
    (data: any) => { data.financialStatus.sourceComplete = false; },
    (data: any) => { delete data.financialStatus.sourceComplete; },
    (data: any) => { data.projection.dataQuality.complete = false; },
    (data: any) => { data.projection.dataQuality.sourcePresent = false; },
    (data: any) => { data.projection.coverage.evidencePercent = 99; },
    (data: any) => { data.projection.coverage.reconciliationPercent = "100"; },
    (data: any) => { data.projection.completeness = "PARTIAL"; },
    (data: any) => { data.projection.sources[0].missing = true; },
    (data: any) => { data.projection.sources[0].completeness = "UNKNOWN"; },
    (data: any) => { data.projection.sources = []; }
  ]) {
    const data = fixture(); change(data);
    const result = buildFinancialFocus(data);
    assert.equal(result.coverageIncomplete, true);
    assert.match(result.explanation, /Valores do recorte\. Complete as fontes antes de decidir/);
    assert.equal(result.amountCents, 15000);
  }
  assert.equal(buildFinancialFocus({}).coverageIncomplete, true);
});

test("TEST_ONLY and synthetic inputs never promote fixtures to operational funds", () => {
  for (const [field, value] of [["environment", "TEST_ONLY"], ["mode", "TEST_ONLY"], ["synthetic", true]]) {
    const data: any = fixture(); data[field as string] = value;
    const result = buildFinancialFocus(data);
    assert.match(result.explanation, /Cenário de teste: valores sintéticos; não comprovam dinheiro da operação/);
    assert.doesNotMatch(result.title + result.label, /dinheiro real|distribuível|liberad[oa]/i);
  }
});

test("SHADOW and SHADOW_UPDATE qualify every focus without releasing distribution", () => {
  for (const mode of ["SHADOW", "SHADOW_UPDATE"]) {
    const data = fixture(); data.mode = mode;
    const result = buildFinancialFocus(data);
    assert.match(result.explanation, /Modo SHADOW: leitura observacional; não libera distribuição ou movimentação financeira/);
    assert.equal(result.amountCents, 15000);
  }
  const both = fixture(); both.mode = "SHADOW"; both.environment = "TEST_ONLY";
  assert.match(buildFinancialFocus(both).explanation, /Cenário de teste/);
});

test("period and all display copy reject hostile input; navigation uses fixed local anchors", () => {
  const data: any = fixture();
  data.financialStatus.competence = '<img src=x onerror="alert(1)">';
  data.projection.competence = "2031-13";
  data.title = "</script><script>alert(1)</script>";
  data.nextHref = "javascript:alert(1)";
  const result = buildFinancialFocus(data);
  assert.equal(result.period, "Competência não confirmada");
  assert.doesNotMatch(JSON.stringify(result), /<|>|javascript:|alert\(1\)/);
  assert.equal(result.nextHref, "#monthly-closing-summary");
  data.financialStatus.amounts.overduePayablesCents = 0;
  assert.equal(buildFinancialFocus(data).period, "Competência não confirmada");
});

test("presentation is pure and never mutates the bootstrap or authorizes financial movement", () => {
  const data = fixture(), before = structuredClone(data);
  Object.freeze(data.financialStatus.amounts); Object.freeze(data.financialStatus); Object.freeze(data);
  buildFinancialFocus(data); assert.deepEqual(data, before);
  assert.deepEqual(Object.keys(buildFinancialFocus(data)).sort(), ["amountCents", "coverageIncomplete", "explanation",
    "label", "nextHref", "nextLabel", "period", "title", "tone"].sort());
});

test("emitted browser functions parse and match pure helpers for malformed and valid fixtures", () => {
  const context = vm.createContext({ Intl, Number, BigInt, Array });
  vm.runInContext(financialPresentationClient() + "\nglobalThis.helpers={formatFinancialCents,buildFinancialFocus};", context);
  const browser = context.helpers;
  for (const value of [null, undefined, "", false, [], NaN, Infinity, 1.5, -1, 0, 12345, Number.MAX_SAFE_INTEGER]) {
    assert.equal(browser.formatFinancialCents(value), formatFinancialCents(value));
  }
  const complete = fixture(), shadow = fixture(), incomplete = fixture();
  shadow.mode = "SHADOW"; incomplete.financialStatus.sourceComplete = false;
  for (const input of [null, undefined, false, [], {}, complete, shadow, incomplete]) {
    assert.deepEqual(JSON.parse(JSON.stringify(browser.buildFinancialFocus(input))), buildFinancialFocus(input));
  }
  assert.doesNotMatch(financialPresentationClient(), /<\/script|fetch\(|innerHTML|localStorage|sessionStorage/);
});
