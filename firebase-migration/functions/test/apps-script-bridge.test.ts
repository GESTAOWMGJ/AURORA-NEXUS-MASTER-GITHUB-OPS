import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { canonicalHmacV2Payload, type HmacV2Headers } from "../src/security.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationRoot = path.resolve(testDir, "../..");

function appsScriptContext(): Record<string, unknown> {
  const context: Record<string, unknown> = {
    Logger: { log() {} },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest(_algorithm: string, value: string | number[]) {
        const data = Array.isArray(value) ? Buffer.from(value) : Buffer.from(String(value), "utf8");
        return [...createHash("sha256").update(data).digest()];
      },
      computeHmacSha256Signature(value: string, secret: string) {
        return [...createHmac("sha256", secret).update(value).digest()];
      },
      getUuid() { return "0f719f5a-0806-4b2b-a40c-717371d275ee"; }
    }
  };
  vm.createContext(context);
  for (const relative of ["apps-script/FirestoreBridge.gs", "apps-script/MigrationDryRun.gs"]) {
    vm.runInContext(fs.readFileSync(path.join(migrationRoot, relative), "utf8"), context, {
      filename: relative
    });
  }
  return context;
}

test("bridge normaliza risco PT/EN para enum canônico", () => {
  const context = appsScriptContext() as any;
  assert.equal(context.wmgjFirestoreRiskLevel_("baixo"), "LOW");
  assert.equal(context.wmgjFirestoreRiskLevel_("médio"), "MEDIUM");
  assert.equal(context.wmgjFirestoreRiskLevel_("alto"), "HIGH");
  assert.equal(context.wmgjFirestoreRiskLevel_("crítico"), "CRITICAL");
  assert.equal(context.wmgjFirestoreRiskLevel_("desconhecido"), "MEDIUM");
});

test("normalizador BRL preserva zero, sinal e converte para centavos inteiros", () => {
  const context = appsScriptContext() as any;
  assert.equal(context.wmgjFirestoreBrlToCents_(1234.56, "R$ 1.234,56"), 123456);
  assert.equal(context.wmgjFirestoreBrlToCents_("1.234,56", "1.234,56"), 123456);
  assert.equal(context.wmgjFirestoreBrlToCents_("R$ 1.234,56", "R$ 1.234,56"), 123456);
  assert.equal(context.wmgjFirestoreBrlToCents_("0,00", "0,00"), 0);
  assert.equal(context.wmgjFirestoreBrlToCents_("-12,34", "-12,34"), -1234);
  assert.equal(context.wmgjFirestoreBrlToCents_("", ""), null);
});

test("normalizador BRL falha fechado em formato ambíguo, precisão ou faixa inválida", () => {
  const context = appsScriptContext() as any;
  for (const value of ["1,234.56", "12,345", "1e3", "não é valor"]) {
    assert.throws(() => context.wmgjFirestoreBrlToCents_(value, value), /MONEY_/);
  }
  assert.throws(() => context.wmgjFirestoreBrlToCents_(Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)), /MONEY_/);
});

test("adaptador por aba mantém o texto-fonte e adiciona campo canônico", () => {
  const context = appsScriptContext() as any;
  const headers = ["Número NF", "Valor Total"];
  const sourceRecord = context.wmgjFirestoreRowObject_(headers, ["NF-1", "R$ 1.234,56"]);
  const raw = ["NF-1", 1234.56];
  const display = ["NF-1", "R$ 1.234,56"];
  const normalized = context.wmgjFirestoreAddCanonicalMoney_(headers, raw, display, sourceRecord, {
    totalCents: ["valor_total"]
  });
  assert.equal(normalized.valor_total, "R$ 1.234,56");
  assert.equal(normalized.totalCents, 123456);
  assert.equal(raw[1], 1234.56);
});

test("bridge usa a revisão temporal da fonte antes do horário de envio", () => {
  const context = appsScriptContext() as any;
  const source = vm.runInContext('new Date("2026-08-25T10:00:00.123Z")', context);
  const sent = vm.runInContext('new Date("2026-08-26T18:00:00.000Z")', context);
  assert.equal(context.wmgjFirestoreSourceVersion_(source, sent), source.getTime());
  assert.equal(context.wmgjFirestoreSourceVersion_(null, sent), sent.getTime());
});

test("entityKey de planilha é estável e não contém rowHash", () => {
  const context = appsScriptContext() as any;
  const record = { numero_nf: "123", competencia: "2026-08", status: "PENDENTE" };
  const first = context.wmgjFirestoreEntityKey_("06_NFS_E", record, 2, "a".repeat(64));
  const second = context.wmgjFirestoreEntityKey_("06_NFS_E", record, 2, "b".repeat(64));
  assert.equal(first, second);
  assert.equal(first, "06_NFS_E:legacy-row:2");
  assert.equal(
    context.wmgjFirestoreEntityKey_("06_NFS_E", { chave_acesso: "NFE-UNICA" }, 2),
    "06_NFS_E:NFE-UNICA"
  );
  assert.equal(
    context.wmgjFirestoreEntityKey_("SEM_CHAVE", {}, 9),
    "SEM_CHAVE:legacy-row:9"
  );
});

test("primeiro backfill identifica cabeçalhos clínicos para quarentena fail-closed", () => {
  const context = appsScriptContext() as any;
  assert.deepEqual(
    [...context.wmgjFirestoreClinicalHeaders_([
      "Competência",
      "Nome do paciente",
      "CPF",
      "Diagnóstico",
      "Número do prontuário"
    ])],
    ["cpf", "diagnostico", "nome_do_paciente", "numero_do_prontuario"]
  );
  assert.deepEqual(
    [...context.wmgjFirestoreClinicalHeaders_(["Competência", "CNPJ", "Médico prestador"])],
    []
  );
});

test("migrador quarentena aba clínica sem ler linhas nem avançar checkpoint", () => {
  const context = appsScriptContext() as any;
  const calls: Array<{ row: number; rows: number }> = [];
  const logs: Array<{ event: string; status: string; payload: any }> = [];
  context.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty() { return null; },
        setProperty() { throw new Error("CHECKPOINT_NAO_DEVE_AVANCAR"); }
      };
    }
  };
  context.wmgjFirestoreLog_ = (event: string, status: string, payload: any) => {
    logs.push({ event, status, payload });
  };
  const sheet = {
    getLastRow() { return 3; },
    getLastColumn() { return 2; },
    getRange(row: number, _column: number, rows: number) {
      calls.push({ row, rows });
      if (row === 1 && rows === 1) {
        return { getDisplayValues() { return [["Competência", "CPF paciente"]]; } };
      }
      throw new Error("LINHAS_CLINICAS_NAO_DEVEM_SER_LIDAS");
    }
  };
  const spreadsheet = {
    getId() { return "sheet-clinical"; },
    getSheetByName() { return sheet; }
  };

  const result = context.wmgjFirestoreMigrarAba_(
    spreadsheet,
    "ABA_CLINICA",
    { entityType: "sourceDocument", sensitivity: "RESTRICTED" },
    10,
    { orgId: "wmgj", dryRun: false }
  );

  assert.equal(result.ok, false);
  assert.equal(result.quarantined, true);
  assert.equal(result.checkpointAdvanced, false);
  assert.deepEqual(calls, [{ row: 1, rows: 1 }]);
  assert.equal(logs[0]?.event, "MIGRATION_QUARANTINE");
  assert.equal(logs[0]?.status, "ERRO");
  assert.deepEqual([...logs[0]?.payload.blockedHeaders], ["cpf_paciente"]);
});

test("canonical HMAC v2 do Apps Script é idêntico ao servidor", () => {
  const context = appsScriptContext() as any;
  const body = JSON.stringify({ orgId: "wmgj", idempotencyKey: "idem-1" });
  const headers: HmacV2Headers = {
    signatureVersion: "v2",
    timestamp: "1787767200",
    nonce: "0f719f5a-0806-4b2b-a40c-717371d275ee",
    keyId: "apps-script-2026-08",
    orgId: "wmgj",
    idempotencyKey: "idem-1",
    signature: "",
    method: "POST",
    contentType: "application/json"
  };
  const bridge = context.wmgjFirestoreCanonicalHmacV2_(body, headers);
  const server = canonicalHmacV2Payload(Buffer.from(body, "utf8"), headers);
  assert.equal(bridge, server);
});

test("bridge só aceita resposta 2xx com confirmação inequívoca", () => {
  const context = appsScriptContext() as any;
  assert.equal(context.wmgjFirestoreRespostaAceita_({
    ok: true,
    accepted: true,
    duplicate: false,
    eventId: "event-1",
    entityId: "entity-1"
  }), true);
  assert.equal(context.wmgjFirestoreRespostaAceita_({ ok: true, accepted: true }), false);
  assert.equal(context.wmgjFirestoreRespostaAceita_({
    ok: true,
    accepted: true,
    duplicate: true,
    eventId: "event-1",
    entityId: "entity-1"
  }), false);
});

test("actor do Apps Script é pseudonimizado antes do evento", () => {
  const context = appsScriptContext() as any;
  context.Session = {
    getEffectiveUser() {
      return { getEmail() { return "Auditor@Example.com"; } };
    }
  };
  const actorId = context.wmgjFirestoreActorId_();
  assert.match(actorId, /^apps-script:[a-f0-9]{32}$/);
  assert.doesNotMatch(actorId, /auditor|example/i);
});
